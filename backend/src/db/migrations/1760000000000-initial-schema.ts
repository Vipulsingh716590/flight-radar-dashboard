import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1760000000000 implements MigrationInterface {
  name = 'InitialSchema1760000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await runner.query(`CREATE UNIQUE INDEX users_email_key ON users (email)`);

    await runner.query(`
      CREATE TABLE airports (
        id    TEXT PRIMARY KEY,
        iata  TEXT,
        icao  TEXT,
        name  TEXT NOT NULL,
        city  TEXT,
        lat   DOUBLE PRECISION NOT NULL,
        lon   DOUBLE PRECISION NOT NULL
      )`);
    await runner.query(`CREATE INDEX airports_iata_idx ON airports (iata)`);
    await runner.query(`CREATE INDEX airports_icao_idx ON airports (icao)`);

    await runner.query(`
      CREATE TABLE flight_snapshots (
        id          BIGSERIAL PRIMARY KEY,
        icao24      TEXT NOT NULL,
        callsign    TEXT,
        airline     TEXT,
        lat         DOUBLE PRECISION NOT NULL,
        lon         DOUBLE PRECISION NOT NULL,
        altitude_m  REAL,
        speed_ms    REAL,
        heading     REAL,
        on_ground   BOOLEAN NOT NULL,
        origin      TEXT,
        destination TEXT,
        kind        TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL
      )`);
    await runner.query(`CREATE INDEX flight_snapshots_observed_at_idx ON flight_snapshots (observed_at)`);
    await runner.query(
      `CREATE INDEX flight_snapshots_icao24_observed_at_idx ON flight_snapshots (icao24, observed_at)`,
    );

    await runner.query(`
      CREATE TABLE stats_hourly (
        hour          TIMESTAMPTZ PRIMARY KEY,
        samples       INTEGER NOT NULL,
        airborne      DOUBLE PRECISION NOT NULL,
        arrivals      DOUBLE PRECISION NOT NULL,
        departures    DOUBLE PRECISION NOT NULL,
        domestic      DOUBLE PRECISION NOT NULL,
        overflights   DOUBLE PRECISION NOT NULL,
        unknown_route DOUBLE PRECISION NOT NULL,
        peak_airborne INTEGER NOT NULL
      )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS stats_hourly`);
    await runner.query(`DROP TABLE IF EXISTS flight_snapshots`);
    await runner.query(`DROP TABLE IF EXISTS airports`);
    await runner.query(`DROP TABLE IF EXISTS users`);
  }
}
