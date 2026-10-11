/** Mirrors the backend wire format (see backend/src/flights/flights.service.ts). Units: m, m/s, deg. */

export type FlightKind = 'arrival' | 'departure' | 'domestic' | 'overflight' | 'unknown';

export interface Airport {
  /** IATA code, or ICAO when the airport has no IATA code. */
  code: string;
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  inIndia: boolean | null;
}

export interface Flight {
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
  origin: Airport | null;
  destination: Airport | null;
  kind: FlightKind;
}

export interface SourceStatus {
  name: string;
  state: 'ok' | 'down' | 'idle';
  lastSuccessAt: string | null;
  lastError: string | null;
  retryAt: string | null;
}

export interface FlightSummary {
  total: number;
  airborne: number;
  onGround: number;
  arrivals: number;
  departures: number;
  domestic: number;
  overflights: number;
  unknownRoute: number;
}

export interface FlightSnapshot {
  updatedAt: string | null;
  source: string | null;
  partial: boolean;
  pollIntervalMs: number;
  sources: SourceStatus[];
  summary: FlightSummary;
  flights: Flight[];
}
