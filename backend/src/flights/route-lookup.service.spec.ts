import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/app-config.js';
import { parseRoute, RouteLookupService } from './route-lookup.service.js';

const DELHI_AMRITSAR = {
  response: {
    flightroute: {
      airline: { name: 'Air India' },
      origin: { iata_code: 'DEL', icao_code: 'VIDP', country_iso_name: 'IN', name: 'Indira Gandhi', municipality: 'New Delhi' },
      destination: { iata_code: 'ATQ', icao_code: 'VIAR', country_iso_name: 'IN', name: 'Amritsar', municipality: 'Amritsar' },
    },
  },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Resolves once the service has emitted `count` route updates (or time runs out). */
function untilUpdates(service: RouteLookupService, count: number): Promise<void> {
  return new Promise((resolve) => {
    let seen = 0;
    const timer = setTimeout(resolve, 3000);
    service.updates$.subscribe(() => {
      if (++seen >= count) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

describe('parseRoute', () => {
  it('maps an adsbdb response', () => {
    const route = parseRoute(DELHI_AMRITSAR);
    expect(route?.airline).toBe('Air India');
    expect(route?.origin).toMatchObject({ iata: 'DEL', icao: 'VIDP', country: 'IN' });
    expect(route?.destination?.iata).toBe('ATQ');
  });

  it('returns null for "unknown callsign" and empty routes', () => {
    expect(parseRoute({ response: 'unknown callsign' })).toBeNull();
    expect(parseRoute({ response: { flightroute: { origin: null, destination: null } } })).toBeNull();
  });
});

describe('RouteLookupService', () => {
  const config = loadConfig({});

  it('looks a callsign up once and then serves it from cache', async () => {
    const fetcher = vi.fn(async () => json(200, DELHI_AMRITSAR));
    const service = new RouteLookupService(config, fetcher);
    const done = untilUpdates(service, 1);

    expect(service.get('AIC470')).toBeUndefined();
    service.enqueue(['AIC470']);
    await done;

    expect(service.get('AIC470')?.destination?.iata).toBe('ATQ');
    // Second request for the same callsign (any case/whitespace) must not hit the network.
    service.enqueue([' aic470 ']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('only queries airline-style callsigns', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      json(404, { response: 'unknown callsign' }),
    );
    const service = new RouteLookupService(config, fetcher);
    service.enqueue(['VTABC', 'N12345', '', null, '12', 'IGO720F']);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/IGO720F');
  });

  it('reports the share of airline callsigns that were never looked up', async () => {
    const fetcher = vi.fn(async () => json(200, DELHI_AMRITSAR));
    const service = new RouteLookupService(config, fetcher);
    const callsigns = ['AIC470', 'IGO720F', 'VTABC', null];

    // VTABC (a registration) and null are not looked up at all and do not count.
    expect(service.unresolvedShare(callsigns)).toBe(1);
    expect(service.unresolvedShare([])).toBe(0);

    const done = untilUpdates(service, 2);
    service.enqueue(callsigns);
    await done;
    expect(service.unresolvedShare(callsigns)).toBe(0);
    expect(service.unresolvedShare([...callsigns, 'AXB123'])).toBeCloseTo(1 / 3, 5);
  });

  it('remembers unknown callsigns as null instead of re-asking', async () => {
    const fetcher = vi.fn(async () => json(404, { response: 'unknown callsign' }));
    const service = new RouteLookupService(config, fetcher);
    service.enqueue(['XYZ999']);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(service.get('XYZ999')).toBeNull();
    service.enqueue(['XYZ999']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures as "unknown": a network error leaves the route unresolved', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });
    const service = new RouteLookupService(config, fetcher);
    service.enqueue(['AIC470']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(service.get('AIC470')).toBeUndefined();
  });
});
