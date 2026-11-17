import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { AuthUser, JwtPayload } from '../../common/auth/auth-user';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';

export interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organisation: { id: string; name: string; slug: string };
  };
}

@Injectable()
export class AuthService {
  constructor(
    // Login is one of the few deliberately unscoped queries: the tenant is not
    // known until the user has been identified and their password verified.
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organisation: true },
    });

    // Always run a hash comparison so a missing user and a wrong password take
    // a comparable amount of time, and always return the same error.
    const hash = user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordMatches = await bcrypt.compare(password, hash);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = {
      sub: user.id,
      org: user.organisationId,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.auth.jwtSecret,
      // The value is validated as a duration string (e.g. '12h') by config.
      expiresIn: this.config.auth.jwtExpiresIn as JwtSignOptions['expiresIn'],
    });

    return {
      accessToken,
      expiresIn: this.config.auth.jwtExpiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organisation: {
          id: user.organisation.id,
          name: user.organisation.name,
          slug: user.organisation.slug,
        },
      },
    };
  }

  /** Current user details, resolved inside the caller's own tenant. */
  async profile(principal: AuthUser): Promise<LoginResult['user']> {
    const user = await this.prisma.user.findFirst({
      where: { id: principal.userId, organisationId: principal.organisationId },
      include: { organisation: true },
    });

    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisation: {
        id: user.organisation.id,
        name: user.organisation.name,
        slug: user.organisation.slug,
      },
    };
  }

  static hashPassword(password: string, rounds: number): Promise<string> {
    return bcrypt.hash(password, rounds);
  }
}
