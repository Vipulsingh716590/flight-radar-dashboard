import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import bcrypt from 'bcryptjs';
import type { DataSource } from 'typeorm';
import { AirportsController } from './airports/airports.controller.js';
import { AirportsService } from './airports/airports.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { USER_STORE, type UserStore } from './auth/auth.types.js';
import { LoginRateLimiter } from './auth/login-rate-limiter.js';
import { TokenService } from './auth/token.service.js';
import { BCRYPT_COST } from './auth/user-store.js';
import { APP_CONFIG, loadConfig } from './config/app-config.js';
import { createDataSource, DATA_SOURCE } from './db/data-source.js';
import { PgUserStore, seedAdmin } from './db/pg-user-store.js';
import { AIRPORTS, AirportDirectory } from './flights/airports.js';
import { FlightsController } from './flights/flights.controller.js';
import { FlightsService, INDIA_FILTER } from './flights/flights.service.js';
import { HistoryService } from './history/history.service.js';
import { StatsController } from './history/stats.controller.js';
import { TrackController } from './history/track.controller.js';
import { StatsService } from './history/stats.service.js';
import { loadIndiaFilter } from './flights/india-filter.js';
import { RouteLookupService } from './flights/route-lookup.service.js';
import { FLIGHT_PROVIDERS, type FlightProvider } from './ingest/aircraft.js';
import { IngestService } from './ingest/ingest.service.js';
import { AdsbFiProvider } from './ingest/providers/adsbfi.provider.js';
import { OpenSkyProvider } from './ingest/providers/opensky.provider.js';
import { buildTiles } from './ingest/tiles.js';
import { StreamController } from './stream/stream.controller.js';

/** Failures tolerated per email, as a multiple of the per-IP limit. */
const EMAIL_LIMIT_FACTOR = 4;

/** Closes the connection pool on shutdown (factory providers have no destroy hook). */
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}

@Module({
  controllers: [
    AuthController,
    FlightsController,
    StatsController,
    AirportsController,
    TrackController,
    StreamController,
  ],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: DATA_SOURCE,
      inject: [APP_CONFIG],
      useFactory: async (config: ReturnType<typeof loadConfig>) => {
        if (!config.databaseUrl) {
          throw new Error(
            'DATABASE_URL is not set. Start PostgreSQL (docker compose up -d postgres, or ' +
              'npm run db:dev without Docker) and set DATABASE_URL in backend/.env.',
          );
        }
        return createDataSource(config.databaseUrl, config.databaseSsl);
      },
    },
    DatabaseLifecycle,
    {
      provide: USER_STORE,
      inject: [APP_CONFIG, DATA_SOURCE],
      useFactory: async (config: ReturnType<typeof loadConfig>, dataSource: DataSource) => {
        await seedAdmin(dataSource, config.auth);
        return new PgUserStore(dataSource);
      },
    },
    {
      provide: AuthService,
      inject: [APP_CONFIG, USER_STORE],
      useFactory: async (config: ReturnType<typeof loadConfig>, users: UserStore) => {
        const { auth } = config;
        const windowMs = auth.loginWindowMinutes * 60_000;
        if (auth.authDisabled) {
          new Logger('Auth').warn(
            'AUTH_DISABLED=true: sign-in is OFF and every request is a local admin. Local development only.',
          );
        }
        if (auth.jwtSecretGenerated) {
          new Logger('Auth').warn(
            'JWT_SECRET is not set: using a random secret, so sessions end whenever the server restarts',
          );
        }
        // Local development can switch the lockout off; config refuses that in production.
        const maxAttempts = auth.loginRateLimitEnabled ? auth.loginMaxAttempts : Number.MAX_SAFE_INTEGER;
        if (!auth.loginRateLimitEnabled) {
          new Logger('Auth').warn('Login rate limit is OFF (LOGIN_RATE_LIMIT=off): local development only');
        }
        return new AuthService(
          users,
          new TokenService(auth.jwtSecret, auth.sessionHours * 3600),
          new LoginRateLimiter(maxAttempts, windowMs),
          new LoginRateLimiter(
            auth.loginRateLimitEnabled ? maxAttempts * EMAIL_LIMIT_FACTOR : maxAttempts,
            windowMs,
          ),
          await bcrypt.hash(auth.jwtSecret.slice(0, 16), BCRYPT_COST),
        );
      },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: INDIA_FILTER,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof loadConfig>) =>
        loadIndiaFilter(config.indiaGeoJsonPath, config.indiaBufferKm, config.neighboursGeoJsonPath),
    },
    {
      provide: FLIGHT_PROVIDERS,
      inject: [APP_CONFIG, INDIA_FILTER],
      useFactory: (
        config: ReturnType<typeof loadConfig>,
        indiaFilter: ReturnType<typeof loadIndiaFilter>,
      ): FlightProvider[] => {
        const logger = new Logger('Providers');
        const available: Record<string, () => FlightProvider> = {
          adsbfi: () => {
            const tiles = buildTiles(indiaFilter.area);
            logger.log(`adsb.fi sweep uses ${tiles.length} tiles per cycle`);
            return new AdsbFiProvider(tiles, config.userAgent);
          },
          opensky: () => new OpenSkyProvider(config.openSky, config.userAgent),
        };
        const providers: FlightProvider[] = [];
        for (const name of config.providerOrder) {
          const create = available[name];
          if (create) providers.push(create());
          else logger.warn(`Unknown provider "${name}" in PROVIDER_ORDER, ignoring`);
        }
        if (providers.length === 0) throw new Error('PROVIDER_ORDER names no known provider');
        return providers;
      },
    },
    {
      provide: AIRPORTS,
      inject: [APP_CONFIG],
      useFactory: (config: ReturnType<typeof loadConfig>) =>
        AirportDirectory.load(config.airportsJsonPath),
    },
    RouteLookupService,
    FlightsService,
    HistoryService,
    StatsService,
    AirportsService,
    IngestService,
  ],
})
export class AppModule {}
