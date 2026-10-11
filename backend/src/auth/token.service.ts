import { jwtVerify, SignJWT } from 'jose';
import { ROLES, type Role, type SessionUser } from './auth.types.js';

const ISSUER = 'flight-radar-india';
const ALGORITHM = 'HS256';

/** Signs and verifies session tokens (HS256 JWT). */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly sessionSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(user: { email: string; role: Role }): Promise<string> {
    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(user.email)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.sessionSeconds}s`)
      .sign(this.key);
  }

  /** Returns the session, or null for anything invalid, expired or tampered with. */
  async verify(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
      });
      const role = payload['role'] as Role;
      if (!payload.sub || !payload.exp || !ROLES.includes(role)) return null;
      return { email: payload.sub, role, exp: payload.exp };
    } catch {
      return null;
    }
  }
}
