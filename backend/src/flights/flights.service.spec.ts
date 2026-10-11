import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../ingest/aircraft.js';
import { AirportDirectory } from './airports.js';
import { FlightsService } from './flights.service.js';
import { IndiaFilter, type IndiaArea } from './india-filter.js';
import type { FlightRoute, RouteLookupService } from './route-lookup.service.js';

/** Everything between lon 60-100 / lat 0-40 counts as India for these tests. */
const area: IndiaArea = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[60, 0], [100, 0], [100, 40], [60, 40], [60, 0]]],
  },
};

const airports = new AirportDirectory([
  { icao: 'VIDP', iata: 'DEL', name: 'Indira Gandhi', city: 'New Delhi', lat: 28.55, lon: 77.1 },
  { icao: 'VABB', iata: 'BOM', name: 'Chhatrapati Shivaji', city: 'Mumbai', lat: 19.09, lon: 72.87 },
]);

const airport = (iata: string, icao: string, country: string) => ({
  iata,
  icao,
  country,
  name: null,
  city: null,
  lat: null,
  lon: null,
});

const ROUTES: Record<string, FlightRoute | null> = {
  DOM100: { airline: 'Air India', origin: airport('DEL', 'VIDP', 'IN'), destination: airport('BOM', 'VABB', 'IN') },
  ARR200: { airline: 'Emirates', origin: airport('DXB', 'OMDB', 'AE'), destination: airport('DEL', 'VIDP', 'IN') },
  DEP300: { airline: 'Air India', origin: airport('BOM', 'VABB', 'IN'), destination: airport('LHR', 'EGLL', 'GB') },
  OVR400: { airline: 'Qatar', origin: airport('DOH', 'OTHH', 'QA'), destination: airport('SIN', 'WSSS', 'SG') },
  // Origin abroad, destination airport missing from OurAirports -> country code decides.
  ARR500: { airline: 'Foo', origin: airport('DXB', 'OMDB', 'AE'), destination: airport('XXX', 'VZZZ', 'IN') },
  UNK600: null,
};

const fakeRoutes = {
  updates$: { pipe: () => ({ subscribe: () => ({ unsubscribe() {} }) }) },
  enqueue() {},
  get: (callsign: string | null) => (callsign && callsign in ROUTES ? ROUTES[callsign] : undefined),
} as unknown as RouteLookupService;

const plane = (callsign: string, overrides: Partial<Aircraft> = {}): Aircraft => ({
  icao24: callsign.toLowerCase(),
  callsign,
  lat: 20,
  lon: 78,
  altitudeM: 10_000,
  speedMs: 230,
  headingDeg: 90,
  verticalRateMs: 0,
  onGround: false,
  registration: null,
  aircraftType: null,
  squawk: null,
  positionAt: 1_000,
  ...overrides,
});

function service() {
  return new FlightsService(new IndiaFilter(area), airports, fakeRoutes);
}

const meta = { source: 'test', partial: false, sources: [] };

describe('FlightsService tagging', () => {
  it('tags arrivals, departures, domestic, overflights and unknown routes', () => {
    const { flights, summary } = service().update(
      [plane('DOM100'), plane('ARR200'), plane('DEP300'), plane('OVR400'), plane('UNK600'), plane('NEW700')],
      meta,
    );
    const kind = (id: string) => flights.find((f) => f.callsign === id)?.kind;
    expect(kind('DOM100')).toBe('domestic');
    expect(kind('ARR200')).toBe('arrival');
    expect(kind('DEP300')).toBe('departure');
    expect(kind('OVR400')).toBe('overflight');
    expect(kind('UNK600')).toBe('unknown');
    expect(kind('NEW700')).toBe('unknown');
    expect(summary).toMatchObject({
      airborne: 6,
      domestic: 1,
      arrivals: 1,
      departures: 1,
      overflights: 1,
      unknownRoute: 2,
    });
  });

  it('falls back to the route feed country when OurAirports lacks the airport', () => {
    const { flights } = service().update([plane('ARR500')], meta);
    expect(flights[0]?.kind).toBe('arrival');
    expect(flights[0]?.destination?.inIndia).toBe(true);
  });

  it('counts only airborne flights in the kind totals', () => {
    const { summary } = service().update(
      [plane('DOM100'), plane('ARR200', { onGround: true, altitudeM: null })],
      meta,
    );
    expect(summary).toMatchObject({ total: 2, airborne: 1, onGround: 1, domestic: 1, arrivals: 0 });
  });

  it('drops positions outside India and de-duplicates by icao24', () => {
    const { flights } = service().update(
      [
        plane('DOM100', { positionAt: 1_000 }),
        plane('DOM100', { positionAt: 2_000, lat: 21 }),
        plane('OUT900', { lat: 55, lon: 10 }),
      ],
      meta,
    );
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ callsign: 'DOM100', lat: 21, t: 2_000 });
  });
});
