import { readFileSync } from 'node:fs';

export interface Airport {
  icao: string | null;
  iata: string | null;
  name: string;
  city: string | null;
  lat: number;
  lon: number;
  /** OurAirports size class. */
  type?: 'large_airport' | 'medium_airport' | 'small_airport';
}

export const AIRPORTS = Symbol('AIRPORTS');

/**
 * Indian airports from OurAirports (see backend/data/airports-in.json).
 * This is the authority for "is this airport in India?" when tagging flights.
 */
export class AirportDirectory {
  private readonly byIcao = new Map<string, Airport>();
  private readonly byIata = new Map<string, Airport>();

  /** Every airport in the file, in file order. */
  readonly all: readonly Airport[];

  constructor(airports: Airport[]) {
    this.all = airports;
    for (const airport of airports) {
      if (airport.icao) this.byIcao.set(airport.icao.toUpperCase(), airport);
      if (airport.iata) this.byIata.set(airport.iata.toUpperCase(), airport);
    }
  }

  static load(path: string): AirportDirectory {
    return new AirportDirectory(JSON.parse(readFileSync(path, 'utf8')) as Airport[]);
  }

  /** Accepts a 4-letter ICAO or 3-letter IATA code. */
  find(code: string | null | undefined): Airport | null {
    if (!code) return null;
    const key = code.trim().toUpperCase();
    return (key.length === 4 ? this.byIcao.get(key) : this.byIata.get(key)) ?? null;
  }

  isIndian(code: string | null | undefined): boolean {
    return this.find(code) !== null;
  }
}
