import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

export interface RouteAirport {
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 country code as reported by adsbdb. */
  country: string | null;
  lat: number | null;
  lon: number | null;
}

export interface FlightRoute {
  airline: string | null;
  origin: RouteAirport | null;
  destination: RouteAirport | null;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const ROUTE_FETCHER = Symbol('ROUTE_FETCHER');

/** ICAO airline designator + flight number, e.g. AIC170, IGO720F. Skips registrations. */
const AIRLINE_CALLSIGN = /^[A-Z]{3}[0-9]{1,4}[A-Z]{0,2}$/;

const BASE_URL = 'https://api.adsbdb.com/v0/callsign';
const REQUEST_TIMEOUT_MS = 8_000;
/** Gap between requests; adsbdb publishes no limit, so stay polite. */
const REQUEST_GAP_MS = 300;
/** A callsign adsbdb does not know may appear later, so retry after this long. */
const NEGATIVE_TTL_MS = 6 * 60 * 60_000;
/** Cool-down for a single callsign after a network error or 5xx. */
const FAILURE_BACKOFF_MS = 5 * 60_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

interface AdsbdbAirport {
  country_iso_name?: string;
  iata_code?: string;
  icao_code?: string;
  municipality?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
}

interface AdsbdbResponse {
  response?: {
    flightroute?: {
      airline?: { name?: string } | null;
      origin?: AdsbdbAirport | null;
      destination?: AdsbdbAirport | null;
    };
  } | string;
}

/**
 * Looks up origin/destination by callsign via adsbdb.com.
 *
 * - Routes that were found are cached for the life of the process (a callsign's
 *   route does not change within a day); unknown callsigns are retried after 6 h.
 * - Lookups run in the background, one at a time, so they never delay the
 *   position stream. Subscribers are notified when a route arrives.
 * - The data is schedule-based (callsign -> route), so it can be wrong for
 *   re-used or re-routed callsigns. It is shown as such, never "corrected".
 */
@Injectable()
export class RouteLookupService implements OnModuleDestroy {
  private readonly logger = new Logger(RouteLookupService.name);
  private readonly cache = new Map<string, { route: FlightRoute | null; expiresAt: number | null }>();
  private readonly failedUntil = new Map<string, number>();
  private readonly updatesSubject = new Subject<string>();
  private pending: string[] = [];
  private draining = false;
  private stopped = false;
  private pausedUntil = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(ROUTE_FETCHER) private readonly fetcher: Fetcher = fetch,
  ) {}

  /**
   * Share (0..1) of the airline-style callsigns that have no lookup result yet.
   * A callsign whose lookup failed recently counts as resolved: it will not
   * improve soon and must not block anything that waits for "settled" routes.
   */
  unresolvedShare(callsigns: Iterable<string | null>): number {
    const now = Date.now();
    const seen = new Set<string>();
    let unresolved = 0;
    for (const raw of callsigns) {
      if (!raw) continue;
      const callsign = normalise(raw);
      if (!AIRLINE_CALLSIGN.test(callsign) || seen.has(callsign)) continue;
      seen.add(callsign);
      if (this.get(callsign) === undefined && (this.failedUntil.get(callsign) ?? 0) <= now) {
        unresolved += 1;
      }
    }
    return seen.size === 0 ? 0 : unresolved / seen.size;
  }

  /** Emits a callsign each time a route for it became available. */
  get updates$(): Observable<string> {
    return this.updatesSubject.asObservable();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /** `undefined` = not looked up yet, `null` = looked up, route unknown. */
  get(callsign: string | null): FlightRoute | null | undefined {
    if (!callsign) return null;
    const entry = this.cache.get(normalise(callsign));
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) return undefined;
    return entry.route;
  }

  /**
   * Replaces the pending queue with the callsigns the dashboard currently
   * needs, skipping anything cached or recently failed.
   */
  enqueue(callsigns: Iterable<string | null>): void {
    const wanted = new Set<string>();
    const now = Date.now();
    for (const raw of callsigns) {
      if (!raw) continue;
      const callsign = normalise(raw);
      if (!AIRLINE_CALLSIGN.test(callsign)) continue;
      if (this.get(callsign) !== undefined) continue;
      if ((this.failedUntil.get(callsign) ?? 0) > now) continue;
      wanted.add(callsign);
    }
    this.pending = [...wanted];
    if (this.pending.length > 0 && !this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (!this.stopped && this.pending.length > 0) {
        const wait = this.pausedUntil - Date.now();
        if (wait > 0) {
          await sleep(wait);
          continue;
        }
        const callsign = this.pending.shift()!;
        await this.lookup(callsign);
        await sleep(REQUEST_GAP_MS);
      }
    } finally {
      this.draining = false;
    }
  }

  private async lookup(callsign: string): Promise<void> {
    try {
      const response = await this.fetcher(`${BASE_URL}/${encodeURIComponent(callsign)}`, {
        headers: { 'User-Agent': this.config.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 404) {
        this.cache.set(callsign, { route: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
        return;
      }
      if (response.status === 429) {
        const header = Number(response.headers.get('Retry-After'));
        this.pausedUntil =
          Date.now() + (Number.isFinite(header) && header > 0 ? header * 1000 : DEFAULT_RATE_LIMIT_PAUSE_MS);
        this.pending.unshift(callsign);
        this.logger.warn('adsbdb rate limit hit; pausing route lookups');
        return;
      }
      if (!response.ok) {
        this.failedUntil.set(callsign, Date.now() + FAILURE_BACKOFF_MS);
        return;
      }

      const route = parseRoute((await response.json()) as AdsbdbResponse);
      this.cache.set(callsign, route ? { route, expiresAt: null } : { route: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
      if (route) this.updatesSubject.next(callsign);
    } catch {
      // Network error or timeout: try this callsign again later, keep going with the others.
      this.failedUntil.set(callsign, Date.now() + FAILURE_BACKOFF_MS);
    }
  }
}

export function parseRoute(body: AdsbdbResponse): FlightRoute | null {
  const route = typeof body.response === 'object' ? body.response?.flightroute : undefined;
  if (!route) return null;
  const airport = (raw: AdsbdbAirport | null | undefined): RouteAirport | null =>
    raw && (raw.icao_code || raw.iata_code)
      ? {
          icao: raw.icao_code || null,
          iata: raw.iata_code || null,
          name: raw.name || null,
          city: raw.municipality || null,
          country: raw.country_iso_name || null,
          lat: typeof raw.latitude === 'number' ? raw.latitude : null,
          lon: typeof raw.longitude === 'number' ? raw.longitude : null,
        }
      : null;
  const origin = airport(route.origin);
  const destination = airport(route.destination);
  if (!origin && !destination) return null;
  return { airline: route.airline?.name || null, origin, destination };
}

function normalise(callsign: string): string {
  return callsign.trim().toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
