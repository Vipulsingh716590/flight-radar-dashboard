import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadConfig, loadEnvFile } from './config/app-config.js';

async function bootstrap() {
  // Must run before AppModule is imported/evaluated so providers see the env.
  loadEnvFile();
  const config = loadConfig();
  const { AppModule } = await import('./app.module.js');

  // abortOnError:false lets start-up failures reach the catch below, where they are
  // printed in full (otherwise a hosted deploy can die with only "exited with status 1").
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { abortOnError: false });
  // Behind a reverse proxy the client IP (used by the login rate limiter) is in X-Forwarded-For.
  if (config.auth.trustProxyHops > 0) app.set('trust proxy', config.auth.trustProxyHops);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  // Browsers may only call this API from the configured frontend origin.
  app.enableCors({ origin: config.frontendOrigin, credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap').log(
    `API on http://localhost:${config.port}/api (CORS origin ${config.frontendOrigin})`,
  );
}

try {
  await bootstrap();
} catch (error) {
  // Plain console output: it must appear even if Nest's logger never started.
  console.error('FATAL: the API could not start.');
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
}
