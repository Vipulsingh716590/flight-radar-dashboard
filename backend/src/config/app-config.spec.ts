import { describe, expect, it } from 'vitest';
import { loadConfig } from './app-config.js';

const SECRET = 'x'.repeat(40);

describe('loadConfig: production safety', () => {
  it('refuses to start in production without a JWT secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET is required/);
  });

  it('rejects a JWT secret that is too short', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('generates a random secret in development and flags it', () => {
    const a = loadConfig({}).auth;
    const b = loadConfig({}).auth;
    expect(a.jwtSecretGenerated).toBe(true);
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
    expect(a.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('marks the cookie Secure in production and whenever SameSite is none', () => {
    expect(loadConfig({ JWT_SECRET: SECRET }).auth.cookieSecure).toBe(false);
    expect(loadConfig({ JWT_SECRET: SECRET, NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
    const cross = loadConfig({ JWT_SECRET: SECRET, COOKIE_SAMESITE: 'none' }).auth;
    expect(cross.cookieSameSite).toBe('none');
    expect(cross.cookieSecure).toBe(true);
  });

  it('rejects an unknown SameSite value', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET, COOKIE_SAMESITE: 'sometimes' })).toThrow(/COOKIE_SAMESITE/);
  });
});

describe('loadConfig: database', () => {
  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['false', 'off'],
    ['require', 'require'],
    ['TRUE', 'require'],
    ['verify', 'verify'],
  ])('DATABASE_SSL=%s -> %s', (value, expected) => {
    expect(loadConfig({ JWT_SECRET: SECRET, DATABASE_SSL: value }).databaseSsl).toBe(expected);
  });

  it('rejects a mistyped DATABASE_SSL instead of silently disabling TLS', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET, DATABASE_SSL: 'ssl' })).toThrow(/DATABASE_SSL/);
  });
});

describe('loadConfig: polling and proxies', () => {
  it('never polls faster than once a minute (adsb.fi allows 1 request/second)', () => {
    expect(loadConfig({ JWT_SECRET: SECRET, POLL_INTERVAL_SECONDS: '5' }).pollIntervalMs).toBe(75_000);
    expect(loadConfig({ JWT_SECRET: SECRET, POLL_INTERVAL_SECONDS: '120' }).pollIntervalMs).toBe(120_000);
  });

  it('defaults to no proxy hops and the standard provider order', () => {
    const config = loadConfig({ JWT_SECRET: SECRET });
    expect(config.auth.trustProxyHops).toBe(0);
    expect(config.providerOrder).toEqual(['adsbfi', 'opensky']);
  });
});

describe('loadConfig: login lockout switch', () => {
  it('is on by default', () => {
    expect(loadConfig({ JWT_SECRET: SECRET }).auth.loginRateLimitEnabled).toBe(true);
  });

  it('can be switched off for local development', () => {
    expect(loadConfig({ JWT_SECRET: SECRET, LOGIN_RATE_LIMIT: 'off' }).auth.loginRateLimitEnabled).toBe(false);
  });

  it('refuses to be switched off in production', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: SECRET, NODE_ENV: 'production', LOGIN_RATE_LIMIT: 'off' }),
    ).toThrow(/not allowed when NODE_ENV=production/);
  });

  it('rejects an unknown value instead of guessing', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET, LOGIN_RATE_LIMIT: 'maybe' })).toThrow(/LOGIN_RATE_LIMIT/);
  });
});
