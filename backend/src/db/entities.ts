import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

// Column types are spelled out on purpose: the build does not emit decorator
// metadata under every tool (tests, bundlers), so nothing is inferred.

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('increment', { type: 'int' })
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'text' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text' })
  role!: 'admin' | 'viewer';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

@Entity('airports')
export class AirportEntity {
  /** Prefer ICAO as the key; airports without one fall back to `IATA:xxx`. */
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Index()
  @Column({ type: 'text', nullable: true })
  iata!: string | null;

  @Index()
  @Column({ type: 'text', nullable: true })
  icao!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'double precision' })
  lat!: number;

  @Column({ type: 'double precision' })
  lon!: number;
}

@Entity('flight_snapshots')
@Index(['icao24', 'observedAt'])
export class FlightSnapshotEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  icao24!: string;

  @Column({ type: 'text', nullable: true })
  callsign!: string | null;

  @Column({ type: 'text', nullable: true })
  airline!: string | null;

  @Column({ type: 'double precision' })
  lat!: number;

  @Column({ type: 'double precision' })
  lon!: number;

  @Column({ name: 'altitude_m', type: 'real', nullable: true })
  altitudeM!: number | null;

  @Column({ name: 'speed_ms', type: 'real', nullable: true })
  speedMs!: number | null;

  @Column({ type: 'real', nullable: true })
  heading!: number | null;

  @Column({ name: 'on_ground', type: 'boolean' })
  onGround!: boolean;

  /** IATA code (ICAO if the airport has none), as shown on the dashboard. */
  @Column({ type: 'text', nullable: true })
  origin!: string | null;

  @Column({ type: 'text', nullable: true })
  destination!: string | null;

  @Column({ type: 'text' })
  kind!: string;

  @Index()
  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;
}

@Entity('stats_hourly')
export class StatsHourlyEntity {
  /** Start of the hour (UTC). */
  @PrimaryColumn({ type: 'timestamptz' })
  hour!: Date;

  /** Number of poll cycles averaged into this row. */
  @Column({ type: 'int' })
  samples!: number;

  /** Averages over the hour's samples. */
  @Column({ type: 'double precision' })
  airborne!: number;

  @Column({ type: 'double precision' })
  arrivals!: number;

  @Column({ type: 'double precision' })
  departures!: number;

  @Column({ type: 'double precision' })
  domestic!: number;

  @Column({ type: 'double precision' })
  overflights!: number;

  @Column({ name: 'unknown_route', type: 'double precision' })
  unknownRoute!: number;

  @Column({ name: 'peak_airborne', type: 'int' })
  peakAirborne!: number;
}
