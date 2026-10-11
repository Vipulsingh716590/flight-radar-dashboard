import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../db/data-source.js';
import { AIRPORTS, AirportDirectory } from '../flights/airports.js';
import type { FlightDto } from '../flights/flights.service.js';
import { FlightsService } from '../flights/flights.service.js';
import { haversineKm } from './geo.js';

export interface AirportInfo {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
}

export interface BoardFlight {
  id: string;
  callsign: string | null;
  airline: string | null;
  aircraftType: string | null;
  /** The other end of the route: origin for arrivals, destination for departures. */
  other: { code: string; city: string | null } | null;
  altitudeM: number | null;
  speedMs: number | null;
  /** Straight-line distance from the aircraft to this airport. */
  distanceKm: number;
}

export interface AirportBoard {
  airport: AirportInfo;
  updatedAt: string | null;
  /** Airborne flights whose route says they are heading here, nearest first. */
  arrivals: BoardFlight[];
  /** Airborne flights that departed from here, nearest first (most recently left). */
  departures: BoardFlight[];
}

/** Compact airport record for drawing pins on the map. */
export interface AirportPin {
  code: string;
  icao: string | null;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  size: 'large' | 'medium' | 'small';
}

const SEARCH_LIMIT_MAX = 20;
const IMPORT_CHUNK = 200;

/** Airport lookup/search (PostgreSQL) and the live arrivals/departures board. */
@Injectable()
export class AirportsService implements OnModuleInit {
  private readonly logger = new Logger(AirportsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(AIRPORTS) private readonly directory: AirportDirectory,
    @Inject(FlightsService) private readonly flights: FlightsService,
  ) {}

  /** Keeps the `airports` table in step with the OurAirports extract shipped in data/. */
  async onModuleInit(): Promise<void> {
    const airports = this.directory.all;
    const [{ count }] = (await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM airports`)) as {
      count: number;
    }[];
    if (count === airports.length) return;

    for (let start = 0; start < airports.length; start += IMPORT_CHUNK) {
      const rowParams: unknown[] = [];
      const rows = airports.slice(start, start + IMPORT_CHUNK).map((airport, index) => {
        rowParams.push(
          airport.icao ?? `IATA:${airport.iata}`,
          airport.iata,
          airport.icao,
          airport.name,
          airport.city,
          airport.lat,
          airport.lon,
        );
        const b = index * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
      });
      await this.dataSource.query(
        `INSERT INTO airports (id, iata, icao, name, city, lat, lon) VALUES ${rows.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           iata = EXCLUDED.iata, icao = EXCLUDED.icao, name = EXCLUDED.name,
           city = EXCLUDED.city, lat = EXCLUDED.lat, lon = EXCLUDED.lon`,
        rowParams,
      );
    }
    this.logger.log(`Imported ${airports.length} airports into PostgreSQL`);
  }

  /** Every airport that has an IATA code (the ones passengers see), from the in-memory file. */
  pins(): AirportPin[] {
    return this.directory.all
      .filter((airport) => airport.iata)
      .map((airport) => ({
        code: airport.iata!,
        icao: airport.icao,
        name: airport.name,
        city: airport.city,
        lat: airport.lat,
        lon: airport.lon,
        size: airport.type === 'large_airport' ? 'large' : airport.type === 'medium_airport' ? 'medium' : 'small',
      }));
  }

  async find(code: string): Promise<AirportInfo | null> {
    const key = code.trim().toUpperCase();
    const rows: AirportInfo[] = await this.dataSource.query(
      `SELECT iata, icao, name, city, lat, lon FROM airports WHERE iata = $1 OR icao = $1 LIMIT 1`,
      [key],
    );
    return rows[0] ?? null;
  }

  /** Matches code, name or city; exact code matches first. */
  async search(query: string, limit: number): Promise<AirportInfo[]> {
    const text = query.trim();
    if (text.length < 2) return [];
    const pattern = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    return this.dataSource.query(
      `SELECT iata, icao, name, city, lat, lon
         FROM airports
        WHERE iata ILIKE $1 OR icao ILIKE $1 OR name ILIKE $2 OR city ILIKE $2
        ORDER BY COALESCE(UPPER(iata) = UPPER($3) OR UPPER(icao) = UPPER($3), false) DESC,
                 (iata IS NOT NULL) DESC, name
        LIMIT $4::int`,
      [text, pattern, text, Math.min(limit, SEARCH_LIMIT_MAX)],
    );
  }

  async board(code: string): Promise<AirportBoard | null> {
    const airport = await this.find(code);
    if (!airport) return null;
    const { flights, updatedAt } = this.flights.snapshot;
    return buildBoard(airport, flights, updatedAt);
  }
}

/** Splits the live flights into arrivals and departures for one airport. */
export function buildBoard(
  airport: AirportInfo,
  flights: readonly FlightDto[],
  updatedAt: string | null,
): AirportBoard {
  const codes = new Set([airport.iata, airport.icao].filter((code): code is string => !!code));
  const arrivals: BoardFlight[] = [];
  const departures: BoardFlight[] = [];

  for (const flight of flights) {
    if (flight.onGround) continue;
    const toHere = flight.destination !== null && codes.has(flight.destination.code);
    const fromHere = flight.origin !== null && codes.has(flight.origin.code);
    // A route that starts and ends here (training loop) is shown as a departure only.
    if (!toHere && !fromHere) continue;

    const distanceKm = Math.round(haversineKm(flight.lat, flight.lon, airport.lat, airport.lon));
    const other = fromHere ? flight.destination : flight.origin;
    const entry: BoardFlight = {
      id: flight.id,
      callsign: flight.callsign,
      airline: flight.airline,
      aircraftType: flight.type,
      other: other ? { code: other.code, city: other.city } : null,
      altitudeM: flight.alt,
      speedMs: flight.speed,
      distanceKm,
    };
    (fromHere ? departures : arrivals).push(entry);
  }

  const byDistance = (a: BoardFlight, b: BoardFlight) => a.distanceKm - b.distanceKm;
  return { airport, updatedAt, arrivals: arrivals.sort(byDistance), departures: departures.sort(byDistance) };
}
