import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATA_SOURCE } from '../db/data-source.js';
import { FlightSnapshotEntity } from '../db/entities.js';
import type { FlightSnapshot } from '../flights/flights.service.js';

/** Rows per INSERT; 13 columns x 500 stays far below PostgreSQL's 65535 parameter limit. */
const INSERT_CHUNK = 500;
const PURGE_INTERVAL_MS = 6 * 3_600_000;

/**
 * Writes what the live view shows into PostgreSQL:
 *  - one `flight_snapshots` row per flight per poll cycle (kept RETENTION_DAYS),
 *  - a running average per hour in `stats_hourly` (kept forever, a few rows/day).
 *
 * Failures are logged and swallowed: history must never take the live
 * dashboard down.
 */
@Injectable()
export class HistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistoryService.name);
  private purgeTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    void this.purge();
    this.purgeTimer = setInterval(() => void this.purge(), PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  /**
   * Persists one poll cycle. Returns false (and logs) when the database refused it.
   *
   * `includeStats: false` still stores the snapshot rows but keeps the cycle out
   * of the hourly averages (used while routes are unresolved, which would
   * otherwise count every flight as "route unknown").
   */
  async record(snapshot: FlightSnapshot, includeStats = true): Promise<boolean> {
    if (!snapshot.updatedAt || snapshot.flights.length === 0) return false;
    const observedAt = new Date(snapshot.updatedAt);
    const rows = snapshot.flights.map((flight) => ({
      icao24: flight.id,
      callsign: flight.callsign,
      airline: flight.airline,
      lat: flight.lat,
      lon: flight.lon,
      altitudeM: flight.alt,
      speedMs: flight.speed,
      heading: flight.heading,
      onGround: flight.onGround,
      origin: flight.origin?.code ?? null,
      destination: flight.destination?.code ?? null,
      kind: flight.kind,
      observedAt,
    }));

    try {
      await this.dataSource.transaction(async (manager) => {
        for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
          await manager.insert(FlightSnapshotEntity, rows.slice(start, start + INSERT_CHUNK));
        }
        // A cycle with missing tiles under-counts everything; keep it out of the averages.
        if (includeStats && !snapshot.partial) await upsertHourly(manager, observedAt, snapshot);
      });
      return true;
    } catch (error) {
      this.logger.warn(`Could not store history: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.retentionDays * 86_400_000);
    try {
      const result = await this.dataSource
        .createQueryBuilder()
        .delete()
        .from(FlightSnapshotEntity)
        .where('observed_at < :cutoff', { cutoff })
        .execute();
      const removed = result.affected ?? 0;
      if (removed > 0) this.logger.log(`Purged ${removed} snapshot rows older than ${this.config.retentionDays} days`);
      return removed;
    } catch (error) {
      this.logger.warn(`Snapshot purge failed: ${error instanceof Error ? error.message : error}`);
      return 0;
    }
  }
}

/**
 * Folds one sample into the hour's running averages. Done in SQL so concurrent
 * writers (or a restart mid-hour) stay correct.
 */
async function upsertHourly(
  manager: { query(sql: string, parameters: unknown[]): Promise<unknown> },
  at: Date,
  snapshot: FlightSnapshot,
): Promise<void> {
  const hour = new Date(at);
  hour.setUTCMinutes(0, 0, 0);
  const s = snapshot.summary;
  const avg = (column: string) =>
    `${column} = (stats_hourly.${column} * stats_hourly.samples + EXCLUDED.${column}) / (stats_hourly.samples + 1)`;

  await manager.query(
    `INSERT INTO stats_hourly
       (hour, samples, airborne, arrivals, departures, domestic, overflights, unknown_route, peak_airborne)
     VALUES ($1, 1, $2::float8, $3::float8, $4::float8, $5::float8, $6::float8, $7::float8, $8::int)
     ON CONFLICT (hour) DO UPDATE SET
       ${avg('airborne')},
       ${avg('arrivals')},
       ${avg('departures')},
       ${avg('domestic')},
       ${avg('overflights')},
       ${avg('unknown_route')},
       peak_airborne = GREATEST(stats_hourly.peak_airborne, EXCLUDED.peak_airborne),
       samples = stats_hourly.samples + 1`,
    [hour, s.airborne, s.arrivals, s.departures, s.domestic, s.overflights, s.unknownRoute, s.airborne],
  );
}
