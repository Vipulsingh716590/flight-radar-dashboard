import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { FlightsService, type SourceStatus } from '../flights/flights.service.js';
import { HistoryService } from '../history/history.service.js';
import { FLIGHT_PROVIDERS, ProviderError, type FlightProvider } from './aircraft.js';

const MAX_BACKOFF_MS = 5 * 60_000;
/** Cool-down after a failure that did not say how long to wait. */
const DEFAULT_COOLDOWN_MS = 2 * 60_000;

/**
 * Background poller. The browser never talks to a provider: this loop is the
 * only caller, runs one cycle at a time, and tries providers in priority
 * order, falling back when one is rate-limited or failing.
 */
@Injectable()
export class IngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private readonly statuses = new Map<string, SourceStatus>();
  private readonly cooldownUntil = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private consecutiveFailures = 0;

  constructor(
    @Inject(FLIGHT_PROVIDERS) private readonly providers: FlightProvider[],
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FlightsService) private readonly flights: FlightsService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {
    for (const provider of providers) {
      this.statuses.set(provider.name, {
        name: provider.name,
        state: 'idle',
        lastSuccessAt: null,
        lastError: null,
        retryAt: null,
      });
    }
  }

  onModuleInit(): void {
    this.flights.setPollInterval(this.config.pollIntervalMs);
    this.flights.reportSources(this.sourceList());
    // Do not block application start-up on the first (slow) sweep.
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.runCycle(), delayMs);
  }

  private async runCycle(): Promise<void> {
    const started = Date.now();
    let delay = this.config.pollIntervalMs;
    try {
      const ok = await this.pollProviders();
      if (ok) {
        this.consecutiveFailures = 0;
      } else {
        this.consecutiveFailures += 1;
        // Exponential back-off while every provider is failing.
        delay = Math.min(delay * 2 ** this.consecutiveFailures, MAX_BACKOFF_MS);
        this.logger.warn(`All providers failed; retrying in ${Math.round(delay / 1000)}s`);
      }
    } catch (error) {
      this.logger.error(`Unexpected ingest error: ${describe(error)}`);
    }
    this.logger.log(`Cycle finished in ${Math.round((Date.now() - started) / 1000)}s`);
    this.schedule(delay);
  }

  /** Returns true when a provider delivered data. */
  private async pollProviders(): Promise<boolean> {
    for (const provider of this.providers) {
      const status = this.statuses.get(provider.name)!;
      const until = this.cooldownUntil.get(provider.name) ?? 0;
      if (until > Date.now()) continue;

      try {
        const result = await provider.fetchAircraft();
        status.state = 'ok';
        status.lastSuccessAt = new Date().toISOString();
        status.lastError = null;
        status.retryAt = null;
        this.cooldownUntil.delete(provider.name);
        // Providers that were skipped or not needed this cycle stay as they were.
        const snapshot = this.flights.update(result.aircraft, {
          source: provider.name,
          partial: result.partial,
          sources: this.sourceList(),
        });
        // Fire and forget: storing history must not delay the next poll.
        void this.history.record(snapshot, !this.flights.routesPending);
        this.logger.log(
          `${provider.name}: ${result.aircraft.length} aircraft in area, ` +
            `${snapshot.summary.airborne} airborne over India` +
            (result.partial ? ' (partial)' : ''),
        );
        return true;
      } catch (error) {
        status.state = 'down';
        status.lastError = describe(error);
        const cooldown =
          error instanceof ProviderError && error.retryAfterMs
            ? error.retryAfterMs
            : DEFAULT_COOLDOWN_MS;
        this.cooldownUntil.set(provider.name, Date.now() + cooldown);
        status.retryAt = new Date(Date.now() + cooldown).toISOString();
        this.logger.warn(`${provider.name} failed: ${status.lastError}`);
      }
    }
    // Keep serving the last known flights, but tell clients the sources are down.
    this.flights.reportSources(this.sourceList());
    return false;
  }

  private sourceList(): SourceStatus[] {
    return this.providers.map((provider) => ({ ...this.statuses.get(provider.name)! }));
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? 'request timed out' : error.message;
  }
  return String(error);
}
