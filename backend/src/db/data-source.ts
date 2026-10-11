import { DataSource } from 'typeorm';
import {
  AirportEntity,
  FlightSnapshotEntity,
  StatsHourlyEntity,
  UserEntity,
} from './entities.js';
import { InitialSchema1760000000000 } from './migrations/1760000000000-initial-schema.js';

export const DATA_SOURCE = Symbol('DATA_SOURCE');

/**
 * Connects and applies pending migrations. The schema is only ever changed by
 * migrations (never `synchronize`), so deployments are predictable.
 */
export type SslMode = 'off' | 'require' | 'verify';

export async function createDataSource(url: string, ssl: SslMode = 'off'): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [UserEntity, AirportEntity, FlightSnapshotEntity, StatsHourlyEntity],
    migrations: [InitialSchema1760000000000],
    // `require` encrypts without checking the certificate: many managed providers use
    // a CA that is not in the container's bundle. `verify` also validates it.
    ssl: ssl === 'off' ? false : { rejectUnauthorized: ssl === 'verify' },
    synchronize: false,
    migrationsRun: false,
    extra: { max: 10, connectionTimeoutMillis: 10_000 },
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}
