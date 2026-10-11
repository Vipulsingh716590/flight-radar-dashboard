import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { auditTime, Observable, Subject, Subscription } from 'rxjs';
import type { Aircraft } from '../ingest/aircraft.js';
import { AIRPORTS, AirportDirectory } from './airports.js';
import { classifyFlight, type FlightKind, type InIndia } from './flight-kind.js';
import { IndiaFilter } from './india-filter.js';
import { RouteLookupService, type RouteAirport } from './route-lookup.service.js';

export const INDIA_FILTER = Symbol('INDIA_FILTER');

/** Hourly stats are skipped while more than this share of callsigns is unresolved. */
const UNRESOLVED_SHARE_LIMIT = 0.2;

/** How long route arrivals are batched before clients get a refreshed snapshot. */
const ROUTE_REFRESH_MS = 2_000;

export interface SourceStatus {
  name: string;
  state: 'ok' | 'down' | 'idle';
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Provider is being skipped until this time (rate limited). */
  retryAt: string | null;
}

export interface AirportDto {
  /** IATA code, or ICAO when the airport has no IATA code. */
  code: string;
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  /** null when neither OurAirports nor the route feed says which country it is in. */
  inIndia: boolean | null;
}

/** Wire format sent to the browser. Units: metres, metres/second, degrees. */
export interface FlightDto {
  id: string;
  callsign: string | null;
  airline: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  speed: number | null;
  heading: number | null;
  vrate: number | null;
  onGround: boolean;
  reg: string | null;
  type: string | null;
  squawk: string | null;
  /** Epoch ms of the position fix. */
  t: number;
  /** null while the route is unknown; never guessed. */
  origin: AirportDto | null;
  destination: AirportDto | null;
  kind: FlightKind;
}

export interface FlightSummary {
  total: number;
  airborne: number;
  onGround: number;
  /** Airborne flights by relation to India. They add up to `airborne`. */
  arrivals: number;
  departures: number;
  domestic: number;
  overflights: number;
  unknownRoute: number;
}

export interface FlightSnapshot {
  /** When the data was last refreshed from a provider; null before the first success. */
  updatedAt: string | null;
  /** Provider that produced the current data. */
  source: string | null;
  /** True when part of India could not be fetched in the last cycle. */
  partial: boolean;
  pollIntervalMs: number;
  sources: SourceStatus[];
  summary: FlightSummary;
  flights: FlightDto[];
}

const EMPTY_SUMMARY: FlightSummary = {
  total: 0,
  airborne: 0,
  onGround: 0,
  arrivals: 0,
  departures: 0,
  domestic: 0,
  overflights: 0,
  unknownRoute: 0,
};

/**
 * Holds the latest India-only snapshot and notifies subscribers (the SSE
 * stream) whenever it changes. On provider failure the previous flights are
 * kept ("last known data") and only the source statuses change. Routes are
 * resolved in the background and folded into the snapshot as they arrive.
 */
@Injectable()
export class FlightsService implements OnModuleDestroy {
  private current: FlightSnapshot;
  private readonly changes = new Subject<FlightSnapshot>();
  /** Latest India-only, de-duplicated aircraft; routes are applied on top. */
  private aircraft: Aircraft[] = [];
  private readonly routeSubscription: Subscription;

  constructor(
    @Inject(INDIA_FILTER) private readonly indiaFilter: IndiaFilter,
    @Inject(AIRPORTS) private readonly airports: AirportDirectory,
    @Inject(RouteLookupService) private readonly routes: RouteLookupService,
  ) {
    this.current = {
      updatedAt: null,
      source: null,
      partial: false,
      pollIntervalMs: 75_000,
      sources: [],
      summary: { ...EMPTY_SUMMARY },
      flights: [],
    };
    this.routeSubscription = this.routes.updates$
      .pipe(auditTime(ROUTE_REFRESH_MS))
      .subscribe(() => this.applyRoutes());
  }

  onModuleDestroy(): void {
    this.routeSubscription.unsubscribe();
  }

  get snapshot(): FlightSnapshot {
    return this.current;
  }

  /**
   * True while a meaningful share of airborne callsigns has not been looked up
   * yet, i.e. the tags are not representative (typically right after a restart
   * or a long pause). A few new callsigns appear every cycle, so a small
   * unresolved share is normal.
   */
  get routesPending(): boolean {
    const callsigns = this.aircraft.filter((a) => !a.onGround).map((a) => a.callsign);
    return this.routes.unresolvedShare(callsigns) > UNRESOLVED_SHARE_LIMIT;
  }

  get snapshots$(): Observable<FlightSnapshot> {
    return this.changes.asObservable();
  }

  /** Applies a successful provider response. */
  update(
    aircraft: Aircraft[],
    meta: { source: string; partial: boolean; sources: SourceStatus[]; at?: Date },
  ): FlightSnapshot {
    this.aircraft = this.toIndiaAircraft(aircraft);
    this.routes.enqueue(this.aircraft.filter((a) => !a.onGround).map((a) => a.callsign));
    this.current = {
      ...this.current,
      updatedAt: (meta.at ?? new Date()).toISOString(),
      source: meta.source,
      partial: meta.partial,
      sources: meta.sources,
      ...this.build(),
    };
    this.changes.next(this.current);
    return this.current;
  }

  /** Keeps the last known flights but publishes new provider health. */
  reportSources(sources: SourceStatus[]): void {
    this.current = { ...this.current, sources };
    this.changes.next(this.current);
  }

  setPollInterval(pollIntervalMs: number): void {
    this.current = { ...this.current, pollIntervalMs };
  }

  /** Re-derives flights from the same positions once new routes are cached. */
  private applyRoutes(): void {
    if (this.aircraft.length === 0) return;
    this.current = { ...this.current, ...this.build() };
    this.changes.next(this.current);
  }

  private build(): Pick<FlightSnapshot, 'flights' | 'summary'> {
    const flights = this.aircraft.map((plane) => this.toDto(plane));
    const summary: FlightSummary = { ...EMPTY_SUMMARY, total: flights.length };
    for (const flight of flights) {
      if (flight.onGround) {
        summary.onGround += 1;
        continue;
      }
      summary.airborne += 1;
      switch (flight.kind) {
        case 'arrival':
          summary.arrivals += 1;
          break;
        case 'departure':
          summary.departures += 1;
          break;
        case 'domestic':
          summary.domestic += 1;
          break;
        case 'overflight':
          summary.overflights += 1;
          break;
        default:
          summary.unknownRoute += 1;
      }
    }
    return { flights, summary };
  }

  private toDto(plane: Aircraft): FlightDto {
    const route = this.routes.get(plane.callsign);
    const origin = this.toAirport(route?.origin ?? null);
    const destination = this.toAirport(route?.destination ?? null);
    return {
      id: plane.icao24,
      callsign: plane.callsign,
      airline: route?.airline ?? null,
      lat: plane.lat,
      lon: plane.lon,
      alt: plane.altitudeM,
      speed: plane.speedMs,
      heading: plane.headingDeg,
      vrate: plane.verticalRateMs,
      onGround: plane.onGround,
      reg: plane.registration,
      type: plane.aircraftType,
      squawk: plane.squawk,
      t: plane.positionAt,
      origin,
      destination,
      kind: classifyFlight(origin?.inIndia ?? null, destination?.inIndia ?? null),
    };
  }

  private toAirport(raw: RouteAirport | null): AirportDto | null {
    if (!raw) return null;
    const code = raw.iata ?? raw.icao;
    if (!code) return null;
    // OurAirports decides "in India"; adsbdb's country code covers airports it lacks.
    const known = this.airports.find(raw.icao) ?? this.airports.find(raw.iata);
    const inIndia: InIndia = known ? true : raw.country ? raw.country === 'IN' : null;
    return {
      code,
      name: known?.name ?? raw.name,
      city: known?.city ?? raw.city,
      country: raw.country,
      lat: known?.lat ?? raw.lat,
      lon: known?.lon ?? raw.lon,
      inIndia,
    };
  }

  /** India-only, one entry per icao24. */
  private toIndiaAircraft(aircraft: Aircraft[]): Aircraft[] {
    const byId = new Map<string, Aircraft>();
    for (const plane of aircraft) {
      if (!this.indiaFilter.contains(plane.lat, plane.lon)) continue;
      const existing = byId.get(plane.icao24);
      if (existing && existing.positionAt >= plane.positionAt) continue;
      byId.set(plane.icao24, plane);
    }
    return [...byId.values()];
  }
}
