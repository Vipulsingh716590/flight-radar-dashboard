import { ALTITUDE_BANDS, altitudeBand, routeLabel, searchText } from './format';
import type { Flight } from './flight.models';

describe('altitudeBand', () => {
  const FT = 0.3048;

  it.each([
    [0, 0],
    [500 * FT, 0],
    [1_000 * FT, 1],
    [4_999 * FT, 1],
    [10_000 * FT, 3],
    [35_000 * FT, 5],
    [41_000 * FT, 6],
    [60_000 * FT, 6],
  ])('%d m falls into band %d', (metres, band) => {
    expect(altitudeBand(metres)).toBe(band);
  });

  it('puts an unknown altitude in the lowest band', () => {
    expect(altitudeBand(null)).toBe(0);
  });

  it('has a colour for every band', () => {
    expect(ALTITUDE_BANDS.length).toBe(7);
    expect(new Set(ALTITUDE_BANDS.map((b) => b.color)).size).toBe(ALTITUDE_BANDS.length);
  });
});

describe('flight text helpers', () => {
  const flight = {
    id: 'abc123',
    callsign: 'AIC470',
    airline: 'Air India',
    reg: 'VT-ABC',
    type: 'A320',
    origin: { code: 'DEL', city: 'New Delhi', name: null, country: 'IN', lat: null, lon: null, inIndia: true },
    destination: { code: 'BOM', city: 'Mumbai', name: null, country: 'IN', lat: null, lon: null, inIndia: true },
  } as unknown as Flight;

  it('builds a route label and an em dash when nothing is known', () => {
    expect(routeLabel(flight)).toBe('DEL → BOM');
    expect(routeLabel({ ...flight, origin: null, destination: null })).toBe('—');
    expect(routeLabel({ ...flight, origin: null })).toBe('? → BOM');
  });

  it('makes airline, airport and city searchable', () => {
    const text = searchText(flight);
    for (const part of ['aic470', 'air india', 'vt-abc', 'a320', 'del', 'new delhi', 'mumbai']) {
      expect(text).toContain(part);
    }
  });
});
