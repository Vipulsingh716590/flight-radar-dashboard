import { Controller, Inject, MessageEvent, Req, Sse } from '@nestjs/common';
import { concat, interval, map, merge, Observable, of, takeUntil, timer } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { FlightsService } from '../flights/flights.service.js';

/** Proxies and load balancers drop idle connections; a ping keeps it open. */
const KEEPALIVE_MS = 25_000;

@Controller()
export class StreamController {
  constructor(@Inject(FlightsService) private readonly flights: FlightsService) {}

  /**
   * Server-Sent Events. A new client immediately receives the latest
   * snapshot, then one event per refresh. The browser's EventSource
   * reconnects by itself if the connection drops.
   */
  @Sse('stream')
  stream(@Req() request: AuthenticatedRequest): Observable<MessageEvent> {
    const snapshots = concat(of(this.flights.snapshot), this.flights.snapshots$).pipe(
      map((snapshot): MessageEvent => ({ type: 'snapshot', data: snapshot })),
    );
    const pings = interval(KEEPALIVE_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { at: new Date().toISOString() } })),
    );
    // The session was checked when the connection opened; end the stream when
    // it expires so a token cannot be used beyond its lifetime.
    const expiresInMs = Math.max(0, (request.user?.exp ?? 0) * 1000 - Date.now());
    return merge(snapshots, pings).pipe(takeUntil(timer(expiresInMs)));
  }
}
