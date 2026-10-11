import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/app-config.js';
import { Public, Roles } from './auth.decorators.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { TokenService } from './token.service.js';
import { createSeedUserStore, InMemoryUserStore } from './user-store.js';

const SECRET = 'x'.repeat(40);
const PASSWORD = 'correct horse battery staple';

describe('TokenService', () => {
  const tokens = new TokenService(SECRET, 3600);

  it('round-trips email and role', async () => {
    const token = await tokens.sign({ email: 'a@example.com', role: 'viewer' });
    const session = await tokens.verify(token);
    expect(session).toMatchObject({ email: 'a@example.com', role: 'viewer' });
    expect(session!.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('rejects garbage, a wrong secret and tampered tokens', async () => {
    const token = await tokens.sign({ email: 'a@example.com', role: 'admin' });
    expect(await tokens.verify('not-a-jwt')).toBeNull();
    expect(await new TokenService('y'.repeat(40), 3600).verify(token)).toBeNull();
    // Flip the role claim in the payload without re-signing.
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'a@example.com', role: 'admin', exp: 9_999_999_999, iss: 'flight-radar-india' })).toString('base64url');
    expect(await tokens.verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const expired = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('a@example.com')
      .setIssuer('flight-radar-india')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));
    expect(await tokens.verify(expired)).toBeNull();
  });

  it('rejects tokens carrying an unknown role', async () => {
    const odd = await new SignJWT({ role: 'superuser' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('a@example.com')
      .setIssuer('flight-radar-india')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await tokens.verify(odd)).toBeNull();
  });
});

describe('LoginRateLimiter', () => {
  it('blocks after the maximum failures and reports the wait', () => {
    let now = 1_000_000;
    const limiter = new LoginRateLimiter(3, 60_000, () => now);
    expect(limiter.retryAfterSeconds('ip:1')).toBe(0);
    limiter.recordFailure('ip:1');
    limiter.recordFailure('ip:1');
    expect(limiter.retryAfterSeconds('ip:1')).toBe(0);
    limiter.recordFailure('ip:1');
    expect(limiter.retryAfterSeconds('ip:1')).toBe(60);
    now += 30_000;
    expect(limiter.retryAfterSeconds('ip:1')).toBe(30);
  });

  it('lets attempts through again after the window and keeps keys independent', () => {
    let now = 0;
    const limiter = new LoginRateLimiter(1, 1000, () => now);
    limiter.recordFailure('ip:1');
    expect(limiter.retryAfterSeconds('ip:1')).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds('ip:2')).toBe(0);
    now = 1001;
    expect(limiter.retryAfterSeconds('ip:1')).toBe(0);
  });

  it('applies the strictest of several keys', () => {
    const limiter = new LoginRateLimiter(1, 60_000, () => 0);
    limiter.recordFailure('email:a');
    expect(limiter.retryAfterSeconds('ip:fresh', 'email:a')).toBe(60);
  });
});

describe('AuthService', () => {
  let service: AuthService;
  let hash: string;

  beforeAll(async () => {
    // Low cost keeps the suite fast; production uses BCRYPT_COST.
    hash = await bcrypt.hash(PASSWORD, 4);
  });

  function build(maxFailures = 3, emailFactor = 4) {
    service = new AuthService(
      new InMemoryUserStore([{ email: 'admin@example.com', passwordHash: hash, role: 'admin' }]),
      new TokenService(SECRET, 3600),
      new LoginRateLimiter(maxFailures, 60_000),
      new LoginRateLimiter(maxFailures * emailFactor, 60_000),
      bcrypt.hashSync('decoy', 4),
    );
    return service;
  }

  it('logs in with correct credentials, case-insensitively on email', async () => {
    const result = await build().login(' Admin@Example.com ', PASSWORD, '1.1.1.1');
    expect(result).toMatchObject({ ok: true, user: { email: 'admin@example.com', role: 'admin' } });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const s = build();
    expect(await s.login('admin@example.com', 'wrong', '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
    expect(await s.login('nobody@example.com', PASSWORD, '1.1.1.1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('locks out a client after repeated failures, even for the right password', async () => {
    const s = build(2);
    await s.login('admin@example.com', 'bad1', '9.9.9.9');
    await s.login('admin@example.com', 'bad2', '9.9.9.9');
    const result = await s.login('admin@example.com', PASSWORD, '9.9.9.9');
    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('does not let a stranger lock the real user out from other addresses', async () => {
    const s = build(2, 4);
    // Attacker burns their own IP's budget (2) - and a few more tries from other IPs.
    for (const ip of ['6.6.6.1', '6.6.6.2', '6.6.6.3']) {
      await s.login('admin@example.com', 'guess-1', ip);
      await s.login('admin@example.com', 'guess-2', ip);
    }
    // 6 failures on the email, still under the email limit of 8: the owner gets in.
    expect((await s.login('admin@example.com', PASSWORD, '7.7.7.7')).ok).toBe(true);
  });

  it('still stops a distributed attack once the email limit is reached', async () => {
    const s = build(1, 2);
    await s.login('admin@example.com', 'x', '8.8.8.1');
    await s.login('admin@example.com', 'x', '8.8.8.2');
    const result = await s.login('admin@example.com', PASSWORD, '8.8.8.3');
    expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('clears the counters after a successful login', async () => {
    const s = build(2);
    await s.login('admin@example.com', 'bad', '2.2.2.2');
    expect((await s.login('admin@example.com', PASSWORD, '2.2.2.2')).ok).toBe(true);
    await s.login('admin@example.com', 'bad', '2.2.2.2');
    expect((await s.login('admin@example.com', PASSWORD, '2.2.2.2')).ok).toBe(true);
  });
});

describe('createSeedUserStore', () => {
  const base = loadConfig({ JWT_SECRET: SECRET }).auth;

  it('hashes the plain admin password and never stores it', async () => {
    const store = await createSeedUserStore({
      ...base,
      adminEmail: 'admin@example.com',
      adminPassword: PASSWORD,
    });
    const user = await store.findByEmail('ADMIN@example.com');
    expect(user?.role).toBe('admin');
    expect(user?.passwordHash).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, user!.passwordHash)).toBe(true);
  });

  it('accepts a pre-computed bcrypt hash', async () => {
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const store = await createSeedUserStore({ ...base, adminEmail: 'a@example.com', adminPasswordHash: passwordHash });
    expect((await store.findByEmail('a@example.com'))?.passwordHash).toBe(passwordHash);
  });

  it.each([
    ['no email', { adminEmail: null, adminPassword: PASSWORD }],
    ['bad email', { adminEmail: 'nope', adminPassword: PASSWORD }],
    ['no password', { adminEmail: 'a@example.com' }],
    ['short password', { adminEmail: 'a@example.com', adminPassword: 'short' }],
    ['malformed hash', { adminEmail: 'a@example.com', adminPasswordHash: 'plaintext' }],
  ])('fails fast on %s', async (_label, override) => {
    await expect(createSeedUserStore({ ...base, ...override })).rejects.toThrow();
  });
});

describe('AuthGuard', () => {
  const config = loadConfig({ JWT_SECRET: SECRET });
  const tokens = new TokenService(SECRET, 3600);
  const auth = new AuthService(
    new InMemoryUserStore([]),
    tokens,
    new LoginRateLimiter(5, 60_000),
    new LoginRateLimiter(20, 60_000),
    'x',
  );
  const guard = new AuthGuard(new Reflector(), auth, config);

  class Controller {
    open() {}
    @Public()
    publicRoute() {}
    @Roles('admin')
    adminOnly() {}
  }

  const context = (handler: () => void, cookie?: string) => {
    const request: { cookies: Record<string, string>; user?: unknown } = {
      cookies: cookie ? { [config.auth.cookieName]: cookie } : {},
    };
    const ctx = {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  };

  const controller = new Controller();

  it('lets @Public routes through without a cookie', async () => {
    expect(await guard.canActivate(context(controller.publicRoute).ctx)).toBe(true);
  });

  it('rejects requests without a cookie or with an invalid one', async () => {
    await expect(guard.canActivate(context(controller.open).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(context(controller.open, 'junk').ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid session and exposes it on the request', async () => {
    const token = await tokens.sign({ email: 'v@example.com', role: 'viewer' });
    const { ctx, request } = context(controller.open, token);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.user).toMatchObject({ email: 'v@example.com', role: 'viewer' });
  });

  it('enforces @Roles: viewer is forbidden, admin allowed', async () => {
    const viewer = await tokens.sign({ email: 'v@example.com', role: 'viewer' });
    const admin = await tokens.sign({ email: 'a@example.com', role: 'admin' });
    await expect(guard.canActivate(context(controller.adminOnly, viewer).ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await guard.canActivate(context(controller.adminOnly, admin).ctx)).toBe(true);
  });
});
