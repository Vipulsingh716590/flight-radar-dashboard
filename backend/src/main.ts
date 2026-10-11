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

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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

await bootstrap();
