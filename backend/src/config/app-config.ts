import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

/** DI token for the resolved {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AuthConfig {
  /** HS256 signing secret for session tokens (min 32 chars). */
  jwtSecret: string;
  /** True when the secret was generated for this run (sessions die on restart). */
  jwtSecretGenerated: boolean;
  sessionHours: number;
  cookieName: string;
  /** "none" is needed when frontend and API are on different sites (Netlify + Render). */
  cookieSameSite: 'lax' | 'strict' | 'none';
  cookieSecure: boolean;
  /** Seed admin: the only user until Phase 4 adds the users table. */
  adminEmail: string | null;
  adminPassword: string | null;
  adminPasswordHash: string | null;
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  /** Express "trust proxy" hops, so rate limiting sees real client IPs behind a proxy. */
  trustProxyHops: number;
}

export interface AppConfig {
  port: number;
  /** Only this origin may call the API from a browser (CORS). */
  frontendOrigin: string;
  /** Delay between the end of one poll cycle and the start of the next. */
  pollIntervalMs: number;
  /** Provider names in priority order; later ones are fallbacks. */
  providerOrder: string[];
  /** How far beyond the India land border a position still counts as "India". */
  indiaBufferKm: number;
  indiaGeoJsonPath: string;
  /** Land of neighbouring countries; the buffer never applies over it. */
  neighboursGeoJsonPath: string;
  /** Indian airports (from OurAirports) used to tag arrivals/departures. */
  airportsJsonPath: string;
  /** PostgreSQL connection string (required). */
  databaseUrl: string;
  /**
   * TLS to the database: `off`, `require` (encrypted, certificate not checked)
   * or `verify` (encrypted and the certificate must be valid).
   */
  databaseSsl: 'off' | 'require' | 'verify';
  /** Per-cycle flight snapshots older than this are deleted; hourly stats are kept. */
  retentionDays: number;
  openSky: { clientId?: string; clientSecret?: string };
  userAgent: string;
  auth: AuthConfig;
}

/** Loads `.env` (Node built-in, no dotenv dependency) if the file exists. */
export function loadEnvFile(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function num(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  return {
    port: num(env.PORT, 3000, 1),
    frontendOrigin: env.FRONTEND_ORIGIN?.trim() || 'http://localhost:4200',
    // adsb.fi allows 1 req/s and a full India sweep needs ~20 requests, so
    // anything under 60 s would only ever queue up behind the previous cycle.
    pollIntervalMs: num(env.POLL_INTERVAL_SECONDS, 75, 60) * 1000,
    providerOrder: (env.PROVIDER_ORDER ?? 'adsbfi,opensky')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
    indiaBufferKm: num(env.INDIA_BUFFER_KM, 50, 0),
    indiaGeoJsonPath: env.INDIA_GEOJSON_PATH?.trim() || 'data/india.geojson',
    neighboursGeoJsonPath: env.NEIGHBOURS_GEOJSON_PATH?.trim() || 'data/neighbours.geojson',
    airportsJsonPath: env.AIRPORTS_JSON_PATH?.trim() || 'data/airports-in.json',
    databaseUrl: env.DATABASE_URL?.trim() ?? '',
    databaseSsl: parseSsl(env.DATABASE_SSL),
    retentionDays: num(env.RETENTION_DAYS, 7, 1),
    openSky: {
      clientId: env.OPENSKY_CLIENT_ID?.trim() || undefined,
      clientSecret: env.OPENSKY_CLIENT_SECRET?.trim() || undefined,
    },
    userAgent:
      env.USER_AGENT?.trim() || 'flight-radar-india/0.1 (non-commercial dashboard)',
    auth: loadAuthConfig(env, production),
  };
}

function loadAuthConfig(env: NodeJS.ProcessEnv, production: boolean): AuthConfig {
  const configured = env.JWT_SECRET?.trim();
  if (configured && configured.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  if (!configured && production) {
    throw new Error('JWT_SECRET is required in production');
  }
  const sameSite = (env.COOKIE_SAMESITE ?? 'lax').trim().toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('COOKIE_SAMESITE must be lax, strict or none');
  }
  // Browsers reject SameSite=None cookies that are not Secure.
  const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production || sameSite === 'none';

  return {
    jwtSecret: configured ?? randomBytes(48).toString('base64url'),
    jwtSecretGenerated: !configured,
    sessionHours: num(env.SESSION_HOURS, 8, 1),
    cookieName: env.COOKIE_NAME?.trim() || 'fr_session',
    cookieSameSite: sameSite as AuthConfig['cookieSameSite'],
    cookieSecure: secure,
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH?.trim() || null,
    loginMaxAttempts: num(env.LOGIN_MAX_ATTEMPTS, 5, 1),
    loginWindowMinutes: num(env.LOGIN_WINDOW_MINUTES, 15, 1),
    trustProxyHops: num(env.TRUST_PROXY_HOPS, 0, 0),
  };
}

function parseSsl(value: string | undefined): AppConfig['databaseSsl'] {
  const mode = (value ?? 'off').trim().toLowerCase();
  if (mode === 'off' || mode === 'false' || mode === '') return 'off';
  if (mode === 'require' || mode === 'true') return 'require';
  if (mode === 'verify') return 'verify';
  throw new Error('DATABASE_SSL must be off, require or verify');
}
