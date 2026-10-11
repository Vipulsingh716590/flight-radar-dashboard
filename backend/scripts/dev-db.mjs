// Development-only PostgreSQL for machines without Docker.
//
// Uses the `embedded-postgres` package (real PostgreSQL binaries, data kept in
// backend/.dev-postgres). Production and normal development use the
// `postgres` service in docker-compose.yml instead.
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const DATABASE = process.env.DEV_DB_NAME ?? 'flightradar';
const pg = new EmbeddedPostgres({
  databaseDir: '.dev-postgres',
  user: 'flightradar',
  password: 'flightradar',
  port: Number(process.env.DEV_DB_PORT ?? 5432),
  persistent: true,
});

if (!existsSync('.dev-postgres/PG_VERSION')) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(DATABASE);
} catch {
  // Already exists from a previous run.
}
console.log(
  `READY postgres://flightradar:flightradar@localhost:${process.env.DEV_DB_PORT ?? 5432}/${DATABASE}`,
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Keep the process alive while PostgreSQL runs.
setInterval(() => {}, 1 << 30);
