import type { Airport, Flight } from './flight.models';
import { haversineKm, routeProgress } from './geo';

const airport = (code: string, lat: number | null, lon: number | null): Airport => ({
  code,
  name: null,
  city: null,
  country: null,
  lat,
  lon,
  inIndia: null,
});

const flight = (overrides: Partial<Flight>): Flight => ({
  id: 'abc123',
  callsign: 'TEST1',
  airline: null,
  lat: 0,
  lon: 0,
  alt: 10000,
  speed: 230,
  heading: 90,
  vrate: 0,
  onGround: false,
  reg: null,
  type: null,
  squawk: null,
  t: 0,
  origin: null,
  destination: null,
  kind: 'unknown',
  ...overrides,
});

describe('haversineKm', () => {
  it('matches the known Delhi-Mumbai distance (~1150 km)', () => {
    const km = haversineKm(28.5556, 77.0952, 19.0887, 72.8679);
    expect(km).toBeGreaterThan(1130);
    expect(km).toBeLessThan(1170);
  });

  it('is zero for the same point', () => {
    expect(haversineKm(12, 34, 12, 34)).toBe(0);
  });
});

describe('routeProgress', () => {
  const origin = airport('AAA', 0, 0);
  const destination = airport('BBB', 0, 10);

  it('is about halfway at the midpoint of a straight route', () => {
    const progress = routeProgress(flight({ lat: 0, lon: 5, origin, destination }))!;
    expect(progress.fraction).toBeCloseTo(0.5, 2);
    expect(progress.flownKm).toBeCloseTo(progress.remainingKm, 0);
  });

  it('is 0 at the origin and 1 at the destination', () => {
    expect(routeProgress(flight({ lat: 0, lon: 0.0001, origin, destination }))!.fraction).toBeLessThan(0.01);
    expect(routeProgress(flight({ lat: 0, lon: 10, origin, destination }))!.fraction).toBeGreaterThan(0.99);
  });

  it('is plausible on and near the route line, implausible far off it', () => {
    // Midpoint of the route.
    expect(routeProgress(flight({ lat: 0, lon: 5, origin, destination }))!.plausible).toBe(true);
    // A little off the line (about 220 km north of a ~1100 km route): normal routing.
    expect(routeProgress(flight({ lat: 2, lon: 5, origin, destination }))!.plausible).toBe(true);
    // Thousands of km away from the route: the callsign's route is not this flight's.
    expect(routeProgress(flight({ lat: 25, lon: 5, origin, destination }))!.plausible).toBe(false);
  });

  it('returns null when a route end or its coordinates are unknown', () => {
    expect(routeProgress(flight({ origin, destination: null }))).toBeNull();
    expect(routeProgress(flight({ origin, destination: airport('CCC', null, null) }))).toBeNull();
    expect(routeProgress(flight({}))).toBeNull();
  });
});
