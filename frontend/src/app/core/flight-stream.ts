import { computed, inject, Injectable, signal } from '@angular/core';
import { Auth } from './auth';
import { RuntimeConfig } from './runtime-config';
import type { FlightSnapshot } from './flight.models';

export type FeedState = 'connecting' | 'waiting' | 'live' | 'partial' | 'stale' | 'down' | 'offline';

/** Do not hammer /me when the connection flaps. */
const SESSION_CHECK_INTERVAL_MS = 10_000;

/**
 * Subscribes to the backend's Server-Sent Events stream and exposes the
 * latest snapshot as signals. EventSource reconnects on its own after a
 * dropped connection. The dashboard calls {@link connect} when it opens and
 * {@link disconnect} when it closes (logout), so no stream outlives a session.
 */
@Injectable({ providedIn: 'root' })
export class FlightStream {
  private readonly auth = inject(Auth);
  private readonly config = inject(RuntimeConfig);
  private source: EventSource | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private lastSessionCheck = 0;

  readonly snapshot = signal<FlightSnapshot | null>(null);
  readonly connected = signal(false);
  /** Ticks every second so "updated N s ago" and staleness stay current. */
  readonly now = signal(Date.now());

  readonly updatedAtMs = computed(() => {
    const iso = this.snapshot()?.updatedAt;
    return iso ? Date.parse(iso) : null;
  });

  readonly ageSeconds = computed(() => {
    const updated = this.updatedAtMs();
    return updated === null ? null : Math.max(0, Math.round((this.now() - updated) / 1000));
  });

  /** Single user-facing health state for the status chip. */
  readonly state = computed<FeedState>(() => {
    const snapshot = this.snapshot();
    if (!this.connected()) return snapshot ? 'offline' : 'connecting';
    if (!snapshot) return 'connecting';
    const allDown = snapshot.sources.length > 0 && snapshot.sources.every((s) => s.state === 'down');
    if (snapshot.updatedAt === null) return allDown ? 'down' : 'waiting';
    if (allDown) return 'down';
    const age = this.ageSeconds() ?? 0;
    if (age * 1000 > snapshot.pollIntervalMs * 2.5) return 'stale';
    return snapshot.partial ? 'partial' : 'live';
  });

  connect(): void {
    if (this.source) return;
    // Cross-origin API: the session cookie is only sent when credentials are requested.
    const source = new EventSource(this.config.url('/api/stream'), {
      withCredentials: this.config.crossOrigin,
    });
    this.source = source;
    source.onopen = () => this.connected.set(true);
    source.onerror = () => {
      this.connected.set(false);
      this.checkSession();
    };
    source.addEventListener('snapshot', (event) => {
      this.snapshot.set(JSON.parse((event as MessageEvent<string>).data) as FlightSnapshot);
      this.connected.set(true);
    });
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.connected.set(false);
    this.snapshot.set(null);
  }

  /** EventSource hides the HTTP status, so ask /me whether the session is the problem. */
  private checkSession(): void {
    const now = Date.now();
    if (now - this.lastSessionCheck < SESSION_CHECK_INTERVAL_MS) return;
    this.lastSessionCheck = now;
    void this.auth.verifySession();
  }
}
