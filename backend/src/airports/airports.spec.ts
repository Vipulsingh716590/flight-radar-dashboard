import { describe, expect, it } from 'vitest';
import type { FlightDto } from '../flights/flights.service.js';
import { clampInt, foldAirlines } from '../history/stats.service.js';
import { buildBoard, type AirportInfo } from './airports.service.js';
import { haversineKm } from './geo.js';

const DELHI: AirportInfo = { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi', city: 'New Delhi', lat: 28.5556, lon: 77.0952 };

const airport = (code: string, city: string | null = null) => ({
  code,
  name: null,
  city,
  country: null,
  lat: null,
  lon: null,
  inIndia: null,
});

function flight(id: string, overrides: Partial<FlightDto>): FlightDto {
  return {
    id,
    callsign: id.toUpperCase(),
    airline: null,
    lat: 20,
    lon: 78,
    alt: 10_000,
    speed: 230,
    heading: 0,
    vrate: 0,
    onGround: false,
    reg: null,
    type: 'A320',
    squawk: null,
    t: 0,
    origin: null,
    destination: null,
    kind: 'unknown',
    ...overrides,
  };
}

describe('haversineKm', () => {
  it('is zero for identical points and symmetric', () => {
    expect(haversineKm(10, 20, 10, 20)).toBe(0);
    expect(haversineKm(28.55, 77.1, 19.09, 72.87)).toBeCloseTo(haversineKm(19.09, 72.87, 28.55, 77.1), 6);
  });

  it('matches the known Delhi-Mumbai distance (~1150 km)', () => {
    const km = haversineKm(28.5556, 77.0952, 19.0887, 72.8679);
    expect(km).toBeGreaterThan(1130);
    expect(km).toBeLessThan(1170);
  });
});

describe('buildBoard', () => {
  const flights: FlightDto[] = [
    flight('far-in', { lat: 19, lon: 72, origin: airport('BOM', 'Mumbai'), destination: airport('DEL') }),
    flight('near-in', { lat: 28.7, lon: 77.2, origin: airport('LHR', 'London'), destination: airport('VIDP') }),
    flight('just-out', { lat: 28.6, lon: 77.1, origin: airport('DEL'), destination: airport('DXB', 'Dubai') }),
    flight('elsewhere', { origin: airport('BOM'), destination: airport('BLR') }),
    flight('grounded', { onGround: true, origin: airport('DEL'), destination: airport('BOM') }),
    flight('unknown', {}),
  ];
  const board = buildBoard(DELHI, flights, '2026-10-10T00:00:00.000Z');

  it('matches by IATA or ICAO and ignores unrelated and grounded flights', () => {
    expect(board.arrivals.map((f) => f.id)).toEqual(['near-in', 'far-in']);
    expect(board.departures.map((f) => f.id)).toEqual(['just-out']);
  });

  it('sorts nearest first and reports the other end of the route', () => {
    expect(board.arrivals[0]?.distanceKm).toBeLessThan(board.arrivals[1]!.distanceKm);
    expect(board.arrivals[0]?.other).toEqual({ code: 'LHR', city: 'London' });
    expect(board.departures[0]?.other).toEqual({ code: 'DXB', city: 'Dubai' });
  });

  it('passes the airport and timestamp through', () => {
    expect(board.airport).toBe(DELHI);
    expect(board.updatedAt).toBe('2026-10-10T00:00:00.000Z');
  });

  it('is empty when no flight is related to the airport', () => {
    const empty = buildBoard(DELHI, [flights[3]!], null);
    expect(empty.arrivals).toHaveLength(0);
    expect(empty.departures).toHaveLength(0);
  });
});

describe('foldAirlines', () => {
  const rows = [
    { airline: 'IndiGo', flights: 50 },
    { airline: 'Air India', flights: 30 },
    { airline: 'SpiceJet', flights: 10 },
    { airline: 'Vistara', flights: 6 },
    { airline: 'Akasa', flights: 4 },
  ];

  it('folds the tail into "Other" and shares add up to ~100', () => {
    const result = foldAirlines(rows, 3);
    expect(result.map((r) => r.airline)).toEqual(['IndiGo', 'Air India', 'SpiceJet', 'Other']);
    expect(result.at(-1)).toMatchObject({ flights: 10, share: 10 });
    expect(result.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(100, 0);
  });

  it('adds no "Other" row when everything fits', () => {
    expect(foldAirlines(rows, 10)).toHaveLength(5);
  });

  it('returns nothing when there is no data', () => {
    expect(foldAirlines([], 5)).toEqual([]);
  });
});

describe('clampInt', () => {
  it.each([
    ['12', 24, 1, 168, 12],
    ['9999', 24, 1, 168, 168],
    ['-5', 24, 1, 168, 1],
    ['abc', 24, 1, 168, 24],
    [undefined, 24, 1, 168, 24],
    ['7.9', 24, 1, 168, 7],
  ])('clampInt(%s) -> %s', (value, fallback, min, max, expected) => {
    expect(clampInt(value, fallback, min, max)).toBe(expected);
  });
});
