import {
  Aircraft,
  FEET_TO_M,
  FlightProvider,
  FPM_TO_MS,
  KNOTS_TO_MS,
  ProviderError,
  ProviderResult,
} from '../aircraft.js';
import type { Tile } from '../tiles.js';

/** Subset of the readsb/ADSBexchange-v2 aircraft object that adsb.fi returns. */
interface AdsbFiAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  /** Feet, or the string "ground". */
  alt_baro?: number | 'ground';
  alt_geom?: number;
  /** Knots. */
  gs?: number;
  /** Track over ground, degrees. */
  track?: number;
  /** Feet per minute. */
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  /** Seconds since the position was last updated. */
  seen_pos?: number;
}

/** Positions older than this are not "live"; the feed keeps ghosts for a while. */
const MAX_POSITION_AGE_S = 120;

/**
 * adsb.fi open data API (https://github.com/adsbfi/opendata).
 * Public endpoints allow 1 request/second and 250 NM per query, so India is
 * swept tile by tile, strictly one request at a time.
 */
export class AdsbFiProvider implements FlightProvider {
  readonly name = 'adsbfi';

  private static readonly BASE_URL = 'https://opendata.adsb.fi/api/v3';
  private static readonly MIN_GAP_MS = 1100;
  private static readonly REQUEST_TIMEOUT_MS = 10_000;

  constructor(
    private readonly tiles: Tile[],
    private readonly userAgent: string,
  ) {}

  async fetchAircraft(): Promise<ProviderResult> {
    const byIcao = new Map<string, Aircraft>();
    let failures = 0;
    let lastError: unknown;

    for (const [index, tile] of this.tiles.entries()) {
      if (index > 0) await sleep(AdsbFiProvider.MIN_GAP_MS);
      try {
        for (const aircraft of await this.fetchTile(tile)) {
          // Tiles overlap; keep the freshest fix for a plane seen in several.
          const existing = byIcao.get(aircraft.icao24);
          if (!existing || aircraft.positionAt > existing.positionAt) {
            byIcao.set(aircraft.icao24, aircraft);
          }
        }
      } catch (error) {
        // A 429 means we are already over the limit - hammering further tiles
        // only extends the IP restriction, so give up for this cycle.
        if (error instanceof ProviderError && error.retryAfterMs) throw error;
        failures += 1;
        lastError = error;
      }
    }

    if (failures === this.tiles.length) {
      throw lastError instanceof Error ? lastError : new ProviderError('adsb.fi: all tiles failed');
    }
    return { aircraft: [...byIcao.values()], partial: failures > 0 };
  }

  private async fetchTile(tile: Tile): Promise<Aircraft[]> {
    const url = `${AdsbFiProvider.BASE_URL}/lat/${tile.lat}/lon/${tile.lon}/dist/${tile.radiusNm}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(AdsbFiProvider.REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429) {
      throw new ProviderError('adsb.fi rate limit (HTTP 429)', 5 * 60_000);
    }
    if (!response.ok) throw new ProviderError(`adsb.fi HTTP ${response.status}`);

    const body = (await response.json()) as { ac?: AdsbFiAircraft[]; now?: number };
    const now = typeof body.now === 'number' ? body.now : Date.now();
    const aircraft: Aircraft[] = [];
    for (const raw of body.ac ?? []) {
      const parsed = toAircraft(raw, now);
      if (parsed) aircraft.push(parsed);
    }
    return aircraft;
  }
}

function toAircraft(raw: AdsbFiAircraft, nowMs: number): Aircraft | null {
  // "~" prefixes non-ICAO (TIS-B) addresses, which are not unique aircraft ids.
  if (!raw.hex || raw.hex.startsWith('~')) return null;
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
  const age = raw.seen_pos ?? 0;
  if (age > MAX_POSITION_AGE_S) return null;

  const onGround = raw.alt_baro === 'ground';
  const altitudeFt = typeof raw.alt_baro === 'number' ? raw.alt_baro : (raw.alt_geom ?? null);
  const verticalRate = raw.baro_rate ?? raw.geom_rate;

  return {
    icao24: raw.hex.toLowerCase(),
    callsign: clean(raw.flight),
    lat: raw.lat,
    lon: raw.lon,
    altitudeM: altitudeFt === null || onGround ? null : altitudeFt * FEET_TO_M,
    speedMs: typeof raw.gs === 'number' ? raw.gs * KNOTS_TO_MS : null,
    headingDeg: typeof raw.track === 'number' ? raw.track : null,
    verticalRateMs: typeof verticalRate === 'number' ? verticalRate * FPM_TO_MS : null,
    onGround,
    registration: clean(raw.r),
    aircraftType: clean(raw.t),
    squawk: clean(raw.squawk),
    positionAt: Math.round(nowMs - age * 1000),
  };
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
