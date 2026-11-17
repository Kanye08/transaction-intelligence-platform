import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createTestApp } from './app-factory';

describe('Health and error contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the API and the database as up', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('echoes a caller-supplied correlation id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', 'trace-me-123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('trace-me-123');
  });

  it('returns RFC 7807 problem details for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 404, title: 'Not Found', code: 'NOT_FOUND' });
    expect(response.body.requestId).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('at Object');
  });
});
