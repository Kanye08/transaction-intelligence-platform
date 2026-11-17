/** The authenticated principal, derived from a verified JWT. */
export interface AuthUser {
  userId: string;
  organisationId: string;
  email: string;
  role: string;
}

/** JWT payload shape. `sub` is the user id, `org` the tenant. */
export interface JwtPayload {
  sub: string;
  org: string;
  email: string;
  role: string;
}
