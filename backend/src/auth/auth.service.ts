import bcrypt from 'bcryptjs';
import type { Role, UserStore } from './auth.types.js';
import type { LoginRateLimiter } from './login-rate-limiter.js';
import type { TokenService } from './token.service.js';

export type LoginResult =
  | { ok: true; token: string; user: { email: string; role: Role } }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number };

export class AuthService {
  constructor(
    private readonly users: UserStore,
    private readonly tokens: TokenService,
    /** Strict: failures per client IP. */
    private readonly ipLimiter: LoginRateLimiter,
    /**
     * Looser: failures per target email, across all IPs. Kept well above the IP
     * limit so a stranger cannot lock the real user out by failing a few times.
     */
    private readonly emailLimiter: LoginRateLimiter,
    /** Hash compared against when the email is unknown, so timing does not reveal valid emails. */
    private readonly decoyHash: string,
  ) {}

  async login(email: string, password: string, clientIp: string): Promise<LoginResult> {
    const emailKey = `email:${email.trim().toLowerCase()}`;
    const ipKey = `ip:${clientIp}`;

    const wait = Math.max(
      this.ipLimiter.retryAfterSeconds(ipKey),
      this.emailLimiter.retryAfterSeconds(emailKey),
    );
    if (wait > 0) return { ok: false, reason: 'rate_limited', retryAfterSeconds: wait };

    const user = await this.users.findByEmail(email);
    const matches = await bcrypt.compare(password, user?.passwordHash ?? this.decoyHash);
    if (!user || !matches) {
      this.ipLimiter.recordFailure(ipKey);
      this.emailLimiter.recordFailure(emailKey);
      return { ok: false, reason: 'invalid' };
    }

    this.ipLimiter.reset(ipKey);
    this.emailLimiter.reset(emailKey);
    const token = await this.tokens.sign(user);
    return { ok: true, token, user: { email: user.email, role: user.role } };
  }

  verifyToken(token: string) {
    return this.tokens.verify(token);
  }
}
