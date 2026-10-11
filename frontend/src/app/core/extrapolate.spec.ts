import type { Flight } from './flight.models';
import { MAX_EXTRAPOLATION_S, project } from './extrapolate';

const base: Flight = {
  id: 'abc123',
  callsign: 'TEST1',
  airline: null,
  lat: 20,
  lon: 78,
  alt: 10000,
  speed: 250,
  heading: 0,
  vrate: 0,
  onGround: false,
  reg: null,
  type: null,
  squawk: null,
  t: 1_000_000,
  origin: null,
  destination: null,
  kind: 'unknown',
};

describe('project', () => {
  it('moves north along heading 0', () => {
    const [lon, lat] = project(base, base.t + 10_000);
    expect(lon).toBeCloseTo(78, 6);
    // 250 m/s * 10 s = 2.5 km = ~0.0225 deg of latitude.
    expect(lat - 20).toBeCloseTo(0.02246, 4);
  });

  it('moves east along heading 90, wider in degrees of longitude than latitude', () => {
    const [lon, lat] = project({ ...base, heading: 90 }, base.t + 10_000);
    expect(lat).toBeCloseTo(20, 6);
    expect(lon - 78).toBeGreaterThan(0.0224);
  });

  it('does not move without speed or heading', () => {
    expect(project({ ...base, speed: null }, base.t + 10_000)).toEqual([78, 20]);
    expect(project({ ...base, heading: null }, base.t + 10_000)).toEqual([78, 20]);
  });

  it('stops extrapolating after the cap and never moves backwards in time', () => {
    const capped = project(base, base.t + 3_600_000);
    const atCap = project(base, base.t + MAX_EXTRAPOLATION_S * 1000);
    expect(capped).toEqual(atCap);
    expect(project(base, base.t - 5000)).toEqual([78, 20]);
  });
});
