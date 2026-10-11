import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../db/data-source.js';

export interface HourlyPoint {
  /** Start of the hour, ISO 8601 UTC. */
  hour: string;
  /** Averages over the poll cycles inside the hour. */
  airborne: number;
  arrivals: number;
  departures: number;
  domestic: number;
  overflights: number;
  unknownRoute: number;
  peakAirborne: number;
  samples: number;
}

export interface TopAirport {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  /** Distinct aircraft seen airborne heading there / leaving from there. */
  arrivals: number;
  departures: number;
  total: number;
}

export interface AirlineShare {
  airline: string;
  flights: number;
  /** Percent of all flights with a known airline in the window. */
  share: number;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Barometric altitude in metres; null on the ground or when unknown. */
  alt: number | null;
  /** Epoch ms. */
  t: number;
}

export const MAX_WINDOW_HOURS = 168;

/** Clamps an untrusted query-string number into [min, max]. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Read-side queries over the history tables, used by the charts. */
@Injectable()
export class StatsService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async hourly(hours: number): Promise<HourlyPoint[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT hour, airborne, arrivals, departures, domestic, overflights,
              unknown_route, peak_airborne, samples
         FROM stats_hourly
        WHERE hour >= date_trunc('hour', now()) - make_interval(hours => $1::int)
        ORDER BY hour`,
      [hours],
    );
    const round = (value: unknown) => Math.round(Number(value) * 10) / 10;
    return rows.map((row) => ({
      hour: new Date(row['hour'] as string | Date).toISOString(),
      airborne: round(row['airborne']),
      arrivals: round(row['arrivals']),
      departures: round(row['departures']),
      domestic: round(row['domestic']),
      overflights: round(row['overflights']),
      unknownRoute: round(row['unknown_route']),
      peakAirborne: Number(row['peak_airborne']),
      samples: Number(row['samples']),
    }));
  }

  /** Recorded path of one aircraft, oldest first. */
  async track(icao24: string, hours: number): Promise<TrackPoint[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT lat, lon, altitude_m, observed_at
         FROM flight_snapshots
        WHERE icao24 = $1
          AND observed_at >= now() - make_interval(hours => $2::int)
        ORDER BY observed_at`,
      [icao24, hours],
    );
    return rows.map((row) => ({
      lat: Number(row['lat']),
      lon: Number(row['lon']),
      alt: row['altitude_m'] === null ? null : Number(row['altitude_m']),
      t: new Date(row['observed_at'] as string | Date).getTime(),
    }));
  }

  /** Indian airports only (the join is against the India airports table). */
  async topAirports(hours: number, limit: number): Promise<TopAirport[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT a.iata, a.icao, a.name, a.city,
              COALESCE(SUM(t.arrivals), 0)::int   AS arrivals,
              COALESCE(SUM(t.departures), 0)::int AS departures
         FROM (
           SELECT destination AS code, COUNT(DISTINCT icao24) AS arrivals, 0 AS departures
             FROM flight_snapshots
            WHERE observed_at >= now() - make_interval(hours => $1::int)
              AND NOT on_ground AND destination IS NOT NULL
            GROUP BY destination
           UNION ALL
           SELECT origin AS code, 0 AS arrivals, COUNT(DISTINCT icao24) AS departures
             FROM flight_snapshots
            WHERE observed_at >= now() - make_interval(hours => $1::int)
              AND NOT on_ground AND origin IS NOT NULL
            GROUP BY origin
         ) t
         JOIN airports a ON a.iata = t.code OR a.icao = t.code
        GROUP BY a.id, a.iata, a.icao, a.name, a.city
        ORDER BY SUM(t.arrivals) + SUM(t.departures) DESC, a.name
        LIMIT $2::int`,
      [hours, limit],
    );
    return rows.map((row) => {
      const arrivals = Number(row['arrivals']);
      const departures = Number(row['departures']);
      return {
        iata: (row['iata'] as string | null) ?? null,
        icao: (row['icao'] as string | null) ?? null,
        name: String(row['name']),
        city: (row['city'] as string | null) ?? null,
        arrivals,
        departures,
        total: arrivals + departures,
      };
    });
  }

  /** Top airlines by distinct aircraft; everything beyond `limit` is folded into "Other". */
  async airlines(hours: number, limit: number): Promise<AirlineShare[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT airline, COUNT(DISTINCT icao24)::int AS flights
         FROM flight_snapshots
        WHERE observed_at >= now() - make_interval(hours => $1::int)
          AND NOT on_ground AND airline IS NOT NULL
        GROUP BY airline
        ORDER BY flights DESC, airline`,
      [hours],
    );
    return foldAirlines(
      rows.map((row) => ({ airline: String(row['airline']), flights: Number(row['flights']) })),
      limit,
    );
  }
}

/** Pure part of {@link StatsService.airlines}, split out so it can be tested without a database. */
export function foldAirlines(
  sorted: { airline: string; flights: number }[],
  limit: number,
): AirlineShare[] {
  const total = sorted.reduce((sum, row) => sum + row.flights, 0);
  if (total === 0) return [];
  const share = (flights: number) => Math.round((flights / total) * 1000) / 10;

  const top = sorted.slice(0, limit).map((row) => ({ ...row, share: share(row.flights) }));
  const otherFlights = sorted.slice(limit).reduce((sum, row) => sum + row.flights, 0);
  if (otherFlights > 0) top.push({ airline: 'Other', flights: otherFlights, share: share(otherFlights) });
  return top;
}
