import { describe, expect, it } from 'vitest';
import { nightRing, subsolarPoint, sunAltitude } from './solar';

describe('solar position', () => {
  it('has the sun over the Tropic of Cancer at the June solstice', () => {
    const sun = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(sun.lat).toBeGreaterThan(23);
    expect(sun.lat).toBeLessThan(23.6);
    expect(Math.abs(sun.lon)).toBeLessThan(3);
  });

  it('has the sun near the equator at the equinox', () => {
    const sun = subsolarPoint(new Date('2026-03-20T14:46:00Z'));
    expect(Math.abs(sun.lat)).toBeLessThan(0.6);
  });

  it('puts New Delhi in daylight at noon IST and in the dark at midnight IST', () => {
    expect(sunAltitude(28.6, 77.2, new Date('2026-10-13T06:30:00Z'))).toBeGreaterThan(40);
    expect(sunAltitude(28.6, 77.2, new Date('2026-10-12T18:30:00Z'))).toBeLessThan(-40);
  });
});

describe('night ring', () => {
  /** Latitude of the terminator at a longitude, from the ring (linear between points). */
  function terminator(ring: [number, number][], lon: number): number {
    const points = ring.filter(([, lat]) => Math.abs(lat) <= 89.9 || true).slice(0, -3);
    for (let i = 0; i < points.length - 1; i += 1) {
      const [lon1, lat1] = points[i]!;
      const [lon2, lat2] = points[i + 1]!;
      if (lon >= lon1 && lon <= lon2) return lat1 + ((lat2 - lat1) * (lon - lon1)) / (lon2 - lon1);
    }
    throw new Error('longitude outside ring');
  }

  it.each([
    '2026-03-20T10:00:00Z',
    '2026-06-21T00:00:00Z',
    '2026-10-13T17:45:00Z',
    '2026-12-21T06:00:00Z',
  ])('agrees with the sun altitude on a grid at %s', (iso) => {
    const date = new Date(iso);
    const ring = nightRing(date, 0, 2);
    const nightPoleIsSouth = subsolarPoint(date).lat >= 0;
    let checked = 0;
    for (let lat = -70; lat <= 70; lat += 10) {
      for (let lon = -170; lon <= 170; lon += 20) {
        const altitude = sunAltitude(lat, lon, date);
        if (Math.abs(altitude) < 4) continue; // too close to the line for a linear ring
        const edge = terminator(ring, lon);
        const inRing = nightPoleIsSouth ? lat < edge : lat > edge;
        expect(inRing, `${lat},${lon} alt ${altitude.toFixed(1)}`).toBe(altitude < 0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('is closed and stays within the map', () => {
    const ring = nightRing(new Date('2026-10-13T12:00:00Z'));
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });
});
