import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/app-config.js';
import { createDataSource } from '../db/data-source.js';
import type { FlightDto, FlightSnapshot } from '../flights/flights.service.js';
import { HistoryService } from './history.service.js';
import { StatsService } from './stats.service.js';

/**
 * Runs against a real PostgreSQL. Skipped unless TEST_DATABASE_URL is set,
 * e.g. TEST_DATABASE_URL=postgres://flightradar:flightradar@localhost:5432/flightradar
 * It uses a throwaway schema, so existing data is never touched.
 */
const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('history + stats (PostgreSQL)', () => {
  const schema = `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let dataSource: DataSource;
  let history: HistoryService;
  let stats: StatsService;

  const flight = (id: string, overrides: Partial<FlightDto>): FlightDto => ({
    id,
    callsign: id.toUpperCase(),
    airline: null,
    lat: 20,
    lon: 78,
    alt: 10_000,
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

  const snapshot = (at: Date, flights: FlightDto[], partial = false): FlightSnapshot => ({
    updatedAt: at.toISOString(),
    source: 'test',
    partial,
    pollIntervalMs: 75_000,
    sources: [],
    summary: {
      total: flights.length,
      airborne: flights.filter((f) => !f.onGround).length,
      onGround: flights.filter((f) => f.onGround).length,
      arrivals: flights.filter((f) => f.kind === 'arrival').length,
      departures: flights.filter((f) => f.kind === 'departure').length,
      domestic: flights.filter((f) => f.kind === 'domestic').length,
      overflights: 0,
      unknownRoute: flights.filter((f) => f.kind === 'unknown').length,
    },
    flights,
  });

  beforeAll(async () => {
    const admin = await createDataSource(url!);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.destroy();
    // Isolate every connection of this test in its own schema.
    dataSource = await createDataSource(`${url}${url!.includes('?') ? '&' : '?'}options=-csearch_path%3D${schema}`);
    await dataSource.query(`INSERT INTO airports (id, iata, icao, name, lat, lon) VALUES ('VIDP','DEL','VIDP','Delhi',28.5,77.1)`);
    history = new HistoryService(dataSource, loadConfig({ DATABASE_URL: url! }));
    stats = new StatsService(dataSource);
  });

  afterAll(async () => {
    await dataSource?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await dataSource?.destroy();
  });

  it('stores snapshot rows and averages samples within the hour', async () => {
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    const t1 = new Date(hour.getTime() + 60_000);
    const t2 = new Date(hour.getTime() + 120_000);

    const a = flight('aaa', { airline: 'IndiGo', kind: 'arrival', origin: { code: 'DXB', name: null, city: null, country: null, lat: null, lon: null, inIndia: false }, destination: { code: 'DEL', name: null, city: null, country: null, lat: null, lon: null, inIndia: true } });
    const b = flight('bbb', { airline: 'IndiGo', kind: 'domestic' });
    const c = flight('ccc', { airline: 'Air India', kind: 'departure', origin: { code: 'DEL', name: null, city: null, country: null, lat: null, lon: null, inIndia: true } });

    expect(await history.record(snapshot(t1, [a, b]))).toBe(true); // airborne 2
    expect(await history.record(snapshot(t2, [a, b, c, flight('ddd', {})]))).toBe(true); // airborne 4

    const [{ count }] = await dataSource.query(`SELECT COUNT(*)::int AS count FROM flight_snapshots`);
    expect(count).toBe(6);

    const points = await stats.hourly(2);
    const point = points.find((p) => p.hour === hour.toISOString());
    expect(point).toMatchObject({ samples: 2, airborne: 3, peakAirborne: 4 });
  });

  it('keeps partial cycles out of the hourly averages but stores their rows', async () => {
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    const before = (await stats.hourly(2)).find((p) => p.hour === hour.toISOString())!;
    await history.record(snapshot(new Date(hour.getTime() + 180_000), [flight('eee', {})], true));
    const after = (await stats.hourly(2)).find((p) => p.hour === hour.toISOString())!;
    expect(after.samples).toBe(before.samples);
    expect(after.airborne).toBe(before.airborne);
  });

  it('keeps cycles with unresolved routes out of the hourly averages when asked to', async () => {
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    const before = (await stats.hourly(2)).find((p) => p.hour === hour.toISOString())!;
    const stored = await history.record(snapshot(new Date(hour.getTime() + 240_000), [flight('fff', {})]), false);
    const after = (await stats.hourly(2)).find((p) => p.hour === hour.toISOString())!;
    expect(stored).toBe(true);
    expect(after.samples).toBe(before.samples);
    const [{ count }] = await dataSource.query(`SELECT COUNT(*)::int AS count FROM flight_snapshots WHERE icao24 = 'fff'`);
    expect(count).toBe(1);
  });

  it('returns the recorded path of one aircraft, oldest first', async () => {
    const t = new Date();
    await history.record(snapshot(new Date(t.getTime() - 120_000), [flight('trk001', { lat: 10, lon: 70, alt: 5000 })]));
    await history.record(snapshot(t, [flight('trk001', { lat: 11, lon: 71, alt: 6000 })]));
    const points = await stats.track('trk001', 1);
    expect(points.map((p) => [p.lat, p.lon])).toEqual([[10, 70], [11, 71]]);
    expect(points[0]!.t).toBeLessThan(points[1]!.t);
    expect(await stats.track('nosuch', 1)).toEqual([]);
  });

  it('ranks Indian airports and shares by distinct aircraft', async () => {
    const airports = await stats.topAirports(24, 10);
    expect(airports[0]).toMatchObject({ iata: 'DEL', arrivals: 1, departures: 1, total: 2 });

    const airlines = await stats.airlines(24, 5);
    expect(airlines.find((x) => x.airline === 'IndiGo')?.flights).toBe(2);
    expect(airlines.find((x) => x.airline === 'Air India')?.flights).toBe(1);
  });

  it('purges snapshots older than the retention window only', async () => {
    await dataSource.query(
      `INSERT INTO flight_snapshots (icao24, lat, lon, on_ground, kind, observed_at)
       VALUES ('old', 1, 1, false, 'unknown', now() - interval '30 days')`,
    );
    const removed = await history.purge();
    expect(removed).toBeGreaterThanOrEqual(1);
    const [{ count }] = await dataSource.query(`SELECT COUNT(*)::int AS count FROM flight_snapshots WHERE icao24 = 'old'`);
    expect(count).toBe(0);
    const [{ recent }] = await dataSource.query(`SELECT COUNT(*)::int AS recent FROM flight_snapshots`);
    expect(recent).toBeGreaterThan(0);
  });
});
