import { Aircraft, FlightProvider, ProviderError, ProviderResult } from '../aircraft.js';
import { INDIA_BBOX } from '../tiles.js';

const STATES_URL = 'https://opensky-network.org/api/states/all';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const REQUEST_TIMEOUT_MS = 15_000;
/** OpenSky tokens live 30 minutes; refresh a little early. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/** OpenSky `states/all` vector layout (indices per the REST API docs). */
type StateVector = [
  icao24: string,
  callsign: string | null,
  originCountry: string,
  timePosition: number | null,
  lastContact: number,
  longitude: number | null,
  latitude: number | null,
  baroAltitude: number | null,
  onGround: boolean,
  velocity: number | null,
  trueTrack: number | null,
  verticalRate: number | null,
  ...rest: unknown[],
];

/**
 * OpenSky Network REST API. One bounding-box request covers all of India but
 * costs 4 credits (area > 400 sq deg); anonymous users get 400 credits/day,
 * OAuth2 client users 4000/day. That is why it is the fallback by default.
 */
export class OpenSkyProvider implements FlightProvider {
  readonly name = 'opensky';

  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: { clientId?: string; clientSecret?: string },
    private readonly userAgent: string,
  ) {}

  async fetchAircraft(): Promise<ProviderResult> {
    const params = new URLSearchParams({
      lamin: String(INDIA_BBOX.minLat),
      lamax: String(INDIA_BBOX.maxLat),
      lomin: String(INDIA_BBOX.minLon),
      lomax: String(INDIA_BBOX.maxLon),
    });
    const headers: Record<string, string> = { 'User-Agent': this.userAgent };
    const token = await this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response = await fetch(`${STATES_URL}?${params}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401 && token) {
      // Token revoked or expired early: fetch a new one once and retry.
      this.token = null;
      headers.Authorization = `Bearer ${await this.getToken()}`;
      response = await fetch(`${STATES_URL}?${params}`, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get('X-Rate-Limit-Retry-After-Seconds'));
      throw new ProviderError(
        'OpenSky credit limit reached (HTTP 429)',
        (Number.isFinite(wait) && wait > 0 ? wait : 3600) * 1000,
      );
    }
    if (!response.ok) throw new ProviderError(`OpenSky HTTP ${response.status}`);

    const body = (await response.json()) as { time?: number; states?: StateVector[] | null };
    const aircraft: Aircraft[] = [];
    for (const state of body.states ?? []) {
      const parsed = toAircraft(state);
      if (parsed) aircraft.push(parsed);
    }
    return { aircraft, partial: false };
  }

  private async getToken(): Promise<string | null> {
    const { clientId, clientSecret } = this.credentials;
    if (!clientId || !clientSecret) return null;
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.userAgent },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new ProviderError(`OpenSky token request failed (HTTP ${response.status})`);
    const body = (await response.json()) as { access_token: string; expires_in?: number };
    const lifetimeMs = (body.expires_in ?? 1800) * 1000;
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + lifetimeMs - TOKEN_SAFETY_MARGIN_MS,
    };
    return this.token.value;
  }
}

function toAircraft(state: StateVector): Aircraft | null {
  const [icao24, callsign, , timePosition, lastContact, lon, lat, baroAltitude, onGround] = state;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const squawk = state[14];
  return {
    icao24: icao24.toLowerCase(),
    callsign: callsign?.trim() || null,
    lat,
    lon,
    altitudeM: onGround ? null : baroAltitude,
    speedMs: state[9] as number | null,
    headingDeg: state[10] as number | null,
    verticalRateMs: state[11] as number | null,
    onGround,
    registration: null,
    aircraftType: null,
    squawk: typeof squawk === 'string' ? squawk : null,
    positionAt: (timePosition ?? lastContact) * 1000,
  };
}
