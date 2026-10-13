import { describe, expect, it } from 'vitest';
import { IndiaFilter, loadIndiaFilter, type IndiaArea } from './india-filter.js';

/** A 10x10 degree square, enough to test the filter mechanics in isolation. */
const square: IndiaArea = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [70, 10],
        [80, 10],
        [80, 20],
        [70, 20],
        [70, 10],
      ],
    ],
  },
};

describe('IndiaFilter (synthetic polygon)', () => {
  const filter = new IndiaFilter(square);

  it('accepts points inside and rejects points outside', () => {
    expect(filter.contains(15, 75)).toBe(true);
    expect(filter.contains(25, 75)).toBe(false);
    expect(filter.contains(15, 65)).toBe(false);
  });

  it('rejects non-finite coordinates instead of throwing', () => {
    expect(filter.contains(Number.NaN, 75)).toBe(false);
    expect(filter.contains(15, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('IndiaFilter (real India boundary)', () => {
  const strict = loadIndiaFilter('data/india.geojson', 0);
  const withBuffer = loadIndiaFilter('data/india.geojson', 50, 'data/neighbours.geojson');

  it.each([
    ['Delhi', 28.61, 77.21],
    ['Mumbai', 19.08, 72.88],
    ['Chennai', 13.08, 80.27],
    ['Kolkata', 22.57, 88.36],
    ['Srinagar', 34.08, 74.8],
    ['Port Blair (Andaman)', 11.62, 92.73],
  ])('treats %s as India', (_name, lat, lon) => {
    expect(strict.contains(lat, lon)).toBe(true);
    expect(withBuffer.contains(lat, lon)).toBe(true);
  });

  it.each([
    ['Karachi', 24.86, 67.0],
    ['Lahore', 31.55, 74.34],
    ['Kathmandu', 27.7, 85.32],
    ['Colombo', 6.93, 79.86],
    ['Dubai', 25.2, 55.27],
    ['Bangkok', 13.75, 100.5],
    ['Dhaka', 23.81, 90.41],
  ])('treats %s as outside India', (_name, lat, lon) => {
    expect(strict.contains(lat, lon)).toBe(false);
    expect(withBuffer.contains(lat, lon)).toBe(false);
  });

  it('the buffer keeps coastal traffic just offshore', () => {
    // ~20 km west of Mumbai, over the Arabian Sea.
    expect(strict.contains(19.08, 72.7)).toBe(false);
    expect(withBuffer.contains(19.08, 72.7)).toBe(true);
  });

  it('the buffer never reaches over neighbouring land', () => {
    // Lahore is ~25 km from the border: inside a 50 km buffer, but Pakistani land.
    expect(withBuffer.contains(31.55, 74.34)).toBe(false);
  });
});

describe('IndiaFilter (pre-built buffered area)', () => {
  const computed = loadIndiaFilter('data/india.geojson', 50, 'data/neighbours.geojson');
  const prebuilt = loadIndiaFilter(
    'data/india.geojson',
    50,
    'data/neighbours.geojson',
    'data/india-buffered.geojson',
  );

  it.each([
    ['Delhi', 28.61, 77.21, true],
    ['offshore Mumbai (20 km)', 19.08, 72.7, true],
    ['Chennai', 13.08, 80.27, true],
    ['Lahore (buffer must not reach neighbouring land)', 31.55, 74.34, false],
    ['Karachi', 24.86, 67.0, false],
    ['Colombo', 6.93, 79.86, false],
    ['Dubai', 25.2, 55.27, false],
  ])('%s gives the same answer as buffering at start-up', (_name, lat, lon, expected) => {
    expect(prebuilt.contains(lat, lon)).toBe(expected);
    expect(prebuilt.contains(lat, lon)).toBe(computed.contains(lat, lon));
  });

  it('ignores a pre-built file made for a different buffer distance', () => {
    // 50 km file, 150 km requested: it must be recomputed, so ~100 km offshore is still India.
    const wide = loadIndiaFilter('data/india.geojson', 150, undefined, 'data/india-buffered.geojson');
    expect(wide.contains(19.08, 71.8)).toBe(true); // ~100 km west of Mumbai
    expect(prebuilt.contains(19.08, 71.8)).toBe(false);
  });

  it('falls back to buffering when the pre-built file is missing', () => {
    const fallback = loadIndiaFilter('data/india.geojson', 50, undefined, 'data/does-not-exist.geojson');
    expect(fallback.contains(19.08, 72.7)).toBe(true);
  });
});
