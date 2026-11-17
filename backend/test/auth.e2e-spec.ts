import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './app-factory';
import { bearer, login, resetDatabase, seedTwoTenants, SeededTenants, TEST_PASSWORD } from './fixtures';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: SeededTenants;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    tenants = await seedTwoTenants(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a token carrying the user and their organisation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: tenants.orgA.email, password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({
      email: tenants.orgA.email,
      organisation: { id: tenants.orgA.id, name: tenants.orgA.name },
    });
    // The hash must never leave the server.
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$2');
  });

  it('accepts the email case-insensitively', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: tenants.orgA.email.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);
  });

  it('rejects a wrong password and an unknown email identically', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: tenants.orgA.email, password: 'NotThePassword1!' })
      .expect(401);

    const unknownEmail = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: TEST_PASSWORD })
      .expect(401);

    // User enumeration protection: both answers are byte-identical.
    expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
    expect(wrongPassword.body.detail).toBe('Invalid email or password');
  });

  it('validates the login payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(response.body.status).toBe(400);
    expect(response.body.validationErrors).toEqual(
      expect.arrayContaining([
        'A valid email address is required',
        'Password must be at least 8 characters',
      ]),
    );
  });

  it('rejects unknown properties in the payload', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: tenants.orgA.email, password: TEST_PASSWORD, organisationId: 'org-b' })
      .expect(400);
  });

  it('protects every route by default', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/accounts').expect(401);
    await request(app.getHttpServer())
      .get('/api/accounts')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('returns the authenticated profile', async () => {
    const token = await login(app, tenants.orgA.email);
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(response.body).toMatchObject({
      id: tenants.orgA.userId,
      email: tenants.orgA.email,
      organisation: { slug: tenants.orgA.slug },
    });
  });

  it('refuses a token signed with a different secret', async () => {
    const { JwtService } = await import('@nestjs/jwt');
    const forged = new JwtService().sign(
      { sub: tenants.orgB.userId, org: tenants.orgB.id, email: tenants.orgB.email, role: 'OWNER' },
      { secret: 'an-attackers-own-secret-value-32-chars' },
    );

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', bearer(forged))
      .expect(401);
  });

  it('rate limits repeated login attempts', async () => {
    // A dedicated app, so the throttler counter starts from zero rather than
    // being shared with the logins performed by the tests above.
    const isolated = await createTestApp();
    const limit = Number(process.env.LOGIN_RATE_LIMIT);
    const attempts: number[] = [];

    for (let i = 0; i < limit + 5; i += 1) {
      const response = await request(isolated.getHttpServer())
        .post('/api/auth/login')
        .send({ email: tenants.orgA.email, password: 'WrongPassword1!' });
      attempts.push(response.status);
    }

    expect(attempts).toContain(429);
    await isolated.close();
  });
});
