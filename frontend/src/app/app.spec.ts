import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { vi } from 'vitest';
import { App } from './app';
import { routes } from './app.routes';
import { Auth } from './core/auth';
import type { AirportBoard } from './core/api';
import { FlightSelection } from './core/flight-selection';
import { FlightStream } from './core/flight-stream';
import type { Flight, FlightSnapshot } from './core/flight.models';
import { MapSettings } from './core/map-settings';
import { ThemeService } from './core/theme';

/** Minimal EventSource stand-in: jsdom has none, and tests must not hit the network. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

const BOARD: AirportBoard = {
  airport: {
    iata: 'DEL',
    icao: 'VIDP',
    name: 'Indira Gandhi International Airport',
    city: 'New Delhi',
    lat: 28.5,
    lon: 77.1,
  },
  updatedAt: '2026-10-10T06:00:00.000Z',
  arrivals: [
    {
      id: 'abc',
      callsign: 'AIC470',
      airline: 'Air India',
      aircraftType: 'A320',
      other: { code: 'BOM', city: 'Mumbai' },
      altitudeM: 9000,
      speedMs: 220,
      distanceKm: 312,
    },
  ],
  departures: [],
};

const SIA317: Flight = {
  id: '420f57',
  callsign: 'SIA317',
  airline: 'Singapore Airlines',
  lat: 27,
  lon: 78,
  alt: 11_000,
  speed: 250,
  heading: 120,
  vrate: -4,
  onGround: false,
  reg: '9V-SKA',
  type: 'A388',
  squawk: '1234',
  t: Date.now(),
  origin: {
    code: 'LHR',
    name: 'London Heathrow',
    city: 'London',
    country: 'GB',
    lat: 51.47,
    lon: -0.46,
    inIndia: false,
  },
  destination: {
    code: 'SIN',
    name: 'Changi',
    city: 'Singapore',
    country: 'SG',
    lat: 1.36,
    lon: 103.99,
    inIndia: false,
  },
  kind: 'overflight',
};

function snapshotOf(flights: Flight[]): FlightSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    source: 'adsbfi',
    partial: false,
    pollIntervalMs: 75_000,
    sources: [{ name: 'adsbfi', state: 'ok', lastSuccessAt: null, lastError: null, retryAt: null }],
    summary: {
      total: flights.length,
      airborne: flights.length,
      onGround: 0,
      arrivals: 0,
      departures: 0,
      domestic: 0,
      overflights: flights.length,
      unknownRoute: 0,
    },
    flights,
  };
}

describe('pages and navigation', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    localStorage.removeItem('fr-watchlist');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const signIn = (role: 'admin' | 'viewer' = 'admin') =>
    TestBed.inject(Auth).user.set({ email: 'admin@example.com', role });

  async function open(path: string) {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(path);
    await fixture.whenStable();
    return {
      fixture,
      router,
      root: fixture.nativeElement as HTMLElement,
      http: TestBed.inject(HttpTestingController),
    };
  }

  /** Lets promise continuations (firstValueFrom) run, then waits for rendering. */
  async function settle(fixture: { whenStable(): Promise<unknown> }) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  describe('access', () => {
    it('sends anonymous visitors to /login and does not open the live stream', async () => {
      const { router, root } = await open('/flights');
      expect(router.url).toBe('/login');
      expect(root.querySelector('form')).not.toBeNull();
      expect(FlightStreamCount()).toBe(0);
    });

    it('keeps signed-in users off the login page', async () => {
      signIn('viewer');
      const { router } = await open('/login');
      expect(router.url).toBe('/');
    });
  });

  describe('shell', () => {
    it('shows the rail with four pages, the account button, and opens one stream', async () => {
      signIn();
      const { root } = await open('/');
      expect(root.querySelector('nav.rail .logo')?.getAttribute('aria-label')).toContain(
        'Flight Radar India',
      );
      const links = [...root.querySelectorAll<HTMLElement>('nav.rail .item .label')].map((l) =>
        l.textContent?.trim(),
      );
      expect(links).toEqual(['Live map', 'Flights', 'Insights', 'Airports']);
      expect(
        root.querySelector('[data-testid="account-button"]')?.getAttribute('aria-label'),
      ).toContain('admin@example.com');
      expect(root.querySelector('[data-testid="account-menu"]')).toBeNull();
      expect(FlightStreamCount()).toBe(1);
      expect(FakeEventSource.instances[0]?.url).toBe('/api/stream');
    });

    it('marks the current page in the rail', async () => {
      signIn();
      const { root } = await open('/flights');
      const active = [...root.querySelectorAll<HTMLElement>('nav.rail .item.on .label')].map((l) =>
        l.textContent?.trim(),
      );
      expect(active).toEqual(['Flights']);
    });

    it('opens the account menu with email and role, and closes it on Escape', async () => {
      signIn('viewer');
      const { fixture, root } = await open('/');
      root.querySelector<HTMLButtonElement>('[data-testid="account-button"]')!.click();
      await fixture.whenStable();

      const menu = root.querySelector('[data-testid="account-menu"]');
      expect(menu?.textContent).toContain('admin@example.com');
      expect(menu?.textContent).toContain('viewer');
      expect(menu?.textContent).toContain('Sign out');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="account-menu"]')).toBeNull();
    });

    it('signs out from the account menu and returns to /login', async () => {
      signIn();
      const { fixture, router, root, http } = await open('/');
      root.querySelector<HTMLButtonElement>('[data-testid="account-button"]')!.click();
      await fixture.whenStable();
      [...root.querySelectorAll<HTMLButtonElement>('[data-testid="account-menu"] button')]
        .find((b) => b.textContent?.includes('Sign out'))!
        .click();
      await settle(fixture);

      http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);
      await settle(fixture);
      expect(router.url).toBe('/login');
      expect(TestBed.inject(Auth).user()).toBeNull();
      expect(FakeEventSource.instances[0]?.closed).toBe(true);
    });

    it('offers dark, light and glass themes and remembers the choice', async () => {
      signIn();
      localStorage.removeItem('fr-theme');
      const { fixture, root } = await open('/');
      const theme = TestBed.inject(ThemeService);

      for (const id of ['glass', 'light', 'dark'] as const) {
        root.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')!.click();
        await fixture.whenStable();
        root.querySelector<HTMLButtonElement>(`[data-testid="theme-${id}"]`)!.click();
        await fixture.whenStable();

        expect(theme.theme()).toBe(id);
        expect(document.documentElement.dataset['theme']).toBe(id);
        expect(localStorage.getItem('fr-theme')).toBe(id);
      }
    });

    it('keeps the same live stream while moving between pages', async () => {
      signIn();
      const { router, fixture } = await open('/');
      await router.navigateByUrl('/flights');
      await fixture.whenStable();
      await router.navigateByUrl('/insights');
      await fixture.whenStable();
      expect(FlightStreamCount()).toBe(1);
      expect(FakeEventSource.instances[0]?.closed).toBe(false);
    });
  });

  describe('Live map page (/)', () => {
    it('shows the counters before data arrives', async () => {
      signIn();
      const { root } = await open('/');
      expect(root.querySelector('app-map-page')).not.toBeNull();
      expect(root.querySelector('[data-testid="airborne-count"]')?.textContent?.trim()).toBe('—');
      expect(root.querySelector('[data-testid="feed-status"]')?.textContent).toContain(
        'Connecting',
      );
    });
  });

  describe('map options', () => {
    it('switches the legend between route type and altitude', async () => {
      signIn();
      const { fixture, root } = await open('/');
      expect(root.querySelector('.legend-title')?.textContent).toContain('Route type');

      // Display options live in the Settings panel.
      expect(root.querySelector('[data-testid="panel-settings"]')).toBeNull();
      root.querySelector<HTMLButtonElement>('[data-testid="tool-settings"]')!.click();
      await fixture.whenStable();

      const altitude = [
        ...root.querySelectorAll<HTMLButtonElement>('[data-testid="panel-settings"] .seg button'),
      ].find((b) => b.textContent?.includes('Altitude'))!;
      altitude.click();
      await fixture.whenStable();

      expect(TestBed.inject(MapSettings).colorBy()).toBe('altitude');
      expect(root.querySelector('.legend-title')?.textContent).toContain('Altitude');
      expect(root.querySelectorAll('.legend .item').length).toBe(7);
    });

    it('filters planes by route type and altitude and counts active filters', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const settings = TestBed.inject(MapSettings);
      const low = { ...SIA317, id: 'low001', alt: 500, kind: 'arrival' as const };
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317, low]));

      root.querySelector<HTMLButtonElement>('[data-testid="tool-filters"]')!.click();
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="filter-summary"]')?.textContent).toContain(
        'Showing 2 of 2',
      );

      root.querySelector<HTMLButtonElement>('[data-testid="kind-arrival"]')!.click();
      await fixture.whenStable();
      expect(settings.hiddenKinds().has('arrival')).toBe(true);
      expect(root.querySelector('[data-testid="filter-summary"]')?.textContent).toContain(
        'Showing 1 of 2',
      );
      expect(root.querySelector('[data-testid="filter-count"]')?.textContent).toContain('1');

      root.querySelector<HTMLButtonElement>('[data-testid="filters-reset"]')!.click();
      await fixture.whenStable();
      expect(settings.activeFilterCount()).toBe(0);
      expect(root.querySelector('[data-testid="filter-count"]')).toBeNull();
    });

    it('shows weather from Open-Meteo for the map centre', async () => {
      signIn();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            current: {
              temperature_2m: 26.7,
              wind_speed_10m: 12,
              wind_direction_10m: 90,
              cloud_cover: 40,
              precipitation: 0,
              weather_code: 2,
              visibility: 9000,
              pressure_msl: 1012,
              time: '2026-10-13T16:45',
            },
            hourly: { wind_speed_250hPa: [55], wind_direction_250hPa: [286] },
          }),
          { status: 200 },
        ),
      );
      const { fixture, root } = await open('/');
      root.querySelector<HTMLButtonElement>('[data-testid="tool-weather"]')!.click();
      await fixture.whenStable();
      await fixture.whenStable();

      const text = root.querySelector('[data-testid="weather-now"]')?.textContent ?? '';
      expect(text).toContain('27°C');
      expect(text).toContain('Partly cloudy');
      expect(text).toContain('E 12 kt');
      expect(text).toContain('WNW 55 kt');
      expect(String(fetchSpy.mock.calls[0]![0])).toContain('api.open-meteo.com');
      fetchSpy.mockRestore();
    });

    it('switches units on the flight card', async () => {
      signIn();
      const { fixture, root } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      TestBed.inject(FlightSelection).select(SIA317.id);
      TestBed.inject(MapSettings).units.set('metric');
      await fixture.whenStable();
      const text = root.querySelector('app-flight-card')?.textContent ?? '';
      expect(text).toContain('km/h');
      expect(text).not.toContain('36,089 ft');
    });

    it('warns about emergency squawks and keeps them visible through filters', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const settings = TestBed.inject(MapSettings);
      const mayday = { ...SIA317, id: 'emg001', callsign: 'AIC101', squawk: '7700' };
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317, mayday]));
      settings.knownRouteOnly.set(true);
      settings.hiddenKinds.set(new Set([mayday.kind]));
      await fixture.whenStable();

      const banner = root.querySelector('[data-testid="emergency-banner"]');
      expect(banner?.textContent).toContain('AIC101');
      expect(banner?.textContent).toContain('General emergency');
      expect(settings.passes(mayday)).toBe(true);

      banner!.querySelector('button')!.click();
      await fixture.whenStable();
      expect(TestBed.inject(FlightSelection).selectedId()).toBe('emg001');
      expect(root.querySelector('[data-testid="card-emergency"]')?.textContent).toContain('7700');
    });

    it('saves flights to the watchlist and lists them under Saved', async () => {
      signIn();
      const { fixture, root } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      TestBed.inject(FlightSelection).select(SIA317.id);
      await fixture.whenStable();

      root.querySelector<HTMLButtonElement>('[data-testid="watch-button"]')!.click();
      await fixture.whenStable();
      expect(JSON.parse(localStorage.getItem('fr-watchlist')!)[0].id).toBe(SIA317.id);

      TestBed.inject(FlightSelection).select(null);
      await fixture.whenStable();
      root.querySelector<HTMLButtonElement>('[data-testid="tool-saved"]')!.click();
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="saved-list"]')?.textContent).toContain('SIA317');
    });

    it('shows an aircraft photo with the photographer credit', async () => {
      signIn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              photos: [
                {
                  link: 'https://www.planespotters.net/photo/1',
                  photographer: 'Jane Spotter',
                  thumbnail_large: { src: 'https://t.plnspttrs.net/1_280.jpg' },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      );
      const { fixture, root } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      TestBed.inject(FlightSelection).select(SIA317.id);
      await fixture.whenStable();
      await fixture.whenStable();

      const photo = root.querySelector('[data-testid="aircraft-photo"]');
      expect(photo?.textContent).toContain('Jane Spotter');
      expect(photo?.querySelector('img')?.getAttribute('src')).toContain('plnspttrs.net');
    });

    it('toggles the day / night shading from Settings', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const settings = TestBed.inject(MapSettings);
      expect(settings.dayNight()).toBe(false);
      root.querySelector<HTMLButtonElement>('[data-testid="tool-settings"]')!.click();
      await fixture.whenStable();
      root.querySelector<HTMLInputElement>('[data-testid="day-night-toggle"]')!.click();
      await fixture.whenStable();
      expect(settings.dayNight()).toBe(true);
    });

    it('loads recorded history and plays it back from the Replay panel', async () => {
      signIn();
      const { fixture, root, http } = await open('/');
      const t0 = Date.parse('2026-10-13T10:00:00Z');
      const frame = (t: number, lat: number) => ({
        t,
        f: [['rpl001', lat, 75, 90, 9000, 'domestic', 'RPL1', null, null]],
      });

      root.querySelector<HTMLButtonElement>('[data-testid="tool-replay"]')!.click();
      await fixture.whenStable();
      http.match('/api/replay/range').forEach((r) => r.flush({ from: t0, to: t0 + 600_000 }));
      await fixture.whenStable();

      root.querySelector<HTMLButtonElement>('[data-testid="replay-start"]')!.click();
      await fixture.whenStable();
      http.match('/api/replay/range').forEach((r) => r.flush({ from: t0, to: t0 + 600_000 }));
      await fixture.whenStable();
      const request = http.expectOne((r) => r.url === '/api/replay');
      expect(request.request.params.get('minutes')).toBe('60');
      request.flush({
        from: t0,
        minutes: 60,
        truncated: false,
        frames: [frame(t0, 12), frame(t0 + 75_000, 12.2)],
      });
      await fixture.whenStable();

      expect(root.querySelector('[data-testid="replay-chip"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="replay-controls"]')).not.toBeNull();

      root.querySelector<HTMLButtonElement>('[data-testid="replay-exit"]')!.click();
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="replay-chip"]')).toBeNull();
    });

    it('explains when replay is not available', async () => {
      signIn();
      const { fixture, root, http } = await open('/');
      root.querySelector<HTMLButtonElement>('[data-testid="tool-replay"]')!.click();
      await fixture.whenStable();
      http
        .match('/api/replay/range')
        .forEach((r) => r.flush(null, { status: 404, statusText: 'Not Found' }));
      await fixture.whenStable();
      root.querySelector<HTMLButtonElement>('[data-testid="replay-start"]')!.click();
      await fixture.whenStable();
      http
        .match('/api/replay/range')
        .forEach((r) => r.flush(null, { status: 404, statusText: 'Not Found' }));
      await fixture.whenStable();
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="replay-error"]')?.textContent).toContain(
        'not available',
      );
    });

    it('toggles short trails from Settings', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const settings = TestBed.inject(MapSettings);
      root.querySelector<HTMLButtonElement>('[data-testid="tool-settings"]')!.click();
      await fixture.whenStable();
      root.querySelector<HTMLInputElement>('[data-testid="trails-toggle"]')!.click();
      await fixture.whenStable();
      expect(settings.trails()).toBe(true);
    });

    it('reports how many aircraft are in view', async () => {
      signIn();
      const { fixture, root } = await open('/');
      expect(root.querySelector('[data-testid="in-view"]')).toBeNull();
      TestBed.inject(MapSettings).inView.set(42);
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="in-view"]')?.textContent).toContain(
        '42 aircraft in view',
      );
    });
  });

  describe('flight card', () => {
    it('shows origin, destination, progress and numbers for the selected flight', async () => {
      signIn();
      const { fixture, root } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      TestBed.inject(FlightSelection).select(SIA317.id);
      await fixture.whenStable();

      const card = root.querySelector('app-flight-card')!;
      expect(card.textContent).toContain('SIA317');
      expect(card.textContent).toContain('A388');
      expect(card.textContent).toContain('Singapore Airlines');
      expect(card.textContent).toContain('LHR');
      expect(card.textContent).toContain('SIN');
      expect(card.querySelector('.progress')).not.toBeNull();
      expect(card.textContent).toContain('km flown');
      expect(card.textContent).toContain('36,089 ft');
      expect(card.textContent).toContain('9V-SKA');
    });

    it('follows the flight in 3D from the card and stops when asked or when closed', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const settings = TestBed.inject(MapSettings);
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      TestBed.inject(FlightSelection).select(SIA317.id);
      await fixture.whenStable();

      const button = () => root.querySelector<HTMLButtonElement>('[data-testid="follow-button"]')!;
      expect(button().textContent).toContain('Follow in 3D');
      button().click();
      await fixture.whenStable();
      expect(settings.view()).toBe('3d');
      expect(settings.follow()).toBe(true);
      expect(button().textContent).toContain('Stop following');

      root.querySelector<HTMLButtonElement>('app-flight-card .close')!.click();
      await fixture.whenStable();
      expect(settings.follow()).toBe(false);
    });

    it('switches the map between 2D, 3D and globe', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const settings = TestBed.inject(MapSettings);
      root.querySelector<HTMLButtonElement>('[data-testid="view-3d"]')!.click();
      await fixture.whenStable();
      expect(settings.view()).toBe('3d');
      root.querySelector<HTMLButtonElement>('[data-testid="view-globe"]')!.click();
      await fixture.whenStable();
      expect(settings.view()).toBe('globe');
    });

    it('closes with the close button and says so when the flight left the area', async () => {
      signIn();
      const { fixture, root } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([]));
      TestBed.inject(FlightSelection).select('gone00');
      await fixture.whenStable();
      expect(root.querySelector('app-flight-card')?.textContent).toContain('Out of range');

      root.querySelector<HTMLButtonElement>('app-flight-card .close')!.click();
      await fixture.whenStable();
      expect(TestBed.inject(FlightSelection).selectedId()).toBeNull();
      expect(root.querySelector('app-flight-card .card')).toBeNull();
    });

    it('does not draw a progress bar when airport coordinates are unknown', async () => {
      signIn();
      const { fixture, root } = await open('/');
      const noCoords = { ...SIA317, origin: { ...SIA317.origin!, lat: null, lon: null } };
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([noCoords]));
      TestBed.inject(FlightSelection).select(noCoords.id);
      await fixture.whenStable();
      expect(root.querySelector('app-flight-card')?.textContent).toContain('SIA317');
      expect(root.querySelector('app-flight-card .progress')).toBeNull();
    });
  });

  describe('global search', () => {
    function type(root: HTMLElement, text: string) {
      const input = root.querySelector<HTMLInputElement>('app-global-search input')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }

    it('finds a live flight by airline and opens it on the map', async () => {
      signIn();
      const { fixture, router, root } = await open('/flights');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      type(root, 'singapore');
      await fixture.whenStable();

      const result = root.querySelector<HTMLButtonElement>('app-global-search .results button')!;
      expect(result.textContent).toContain('SIA317');
      expect(result.textContent).toContain('LHR → SIN');

      result.click();
      await settle(fixture);
      await settle(fixture);
      expect(TestBed.inject(FlightSelection).selectedId()).toBe(SIA317.id);
      expect(router.url).toBe('/');
    });

    it('also searches airports and opens their board', async () => {
      signIn();
      const { fixture, router, root, http } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([]));
      type(root, 'delhi');
      await new Promise((resolve) => setTimeout(resolve, 350));

      http
        .expectOne((r) => r.url === '/api/airports' && r.params.get('search') === 'delhi')
        .flush({
          airports: [
            {
              iata: 'DEL',
              icao: 'VIDP',
              name: 'Indira Gandhi International Airport',
              city: 'New Delhi',
              lat: 28.5,
              lon: 77.1,
            },
          ],
        });
      await settle(fixture);

      const result = root.querySelector<HTMLButtonElement>('app-global-search .results button')!;
      expect(result.textContent).toContain('DEL');
      result.click();
      await settle(fixture);
      await settle(fixture);
      http.match('/api/airports/DEL').forEach((r) => r.flush(BOARD));
      expect(router.url).toBe('/airports/DEL');
    });

    it('says when nothing matches and ignores one-letter queries', async () => {
      signIn();
      const { fixture, root } = await open('/');
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([SIA317]));
      type(root, 's');
      await fixture.whenStable();
      expect(root.querySelector('app-global-search .results')).toBeNull();

      type(root, 'zzzzzz');
      await fixture.whenStable();
      expect(root.querySelector('app-global-search .results')?.textContent).toContain(
        'No flights or airports match',
      );
    });
  });

  describe('Flights page (/flights)', () => {
    it('lists flights with a known route before private / unscheduled ones', async () => {
      signIn();
      const { fixture, root } = await open('/flights');
      const noRoute = {
        ...SIA317,
        id: 'aaa111',
        callsign: 'AAA1',
        origin: null,
        destination: null,
      };
      TestBed.inject(FlightStream).snapshot.set(snapshotOf([noRoute, SIA317]));
      await fixture.whenStable();
      const rows = [...root.querySelectorAll('app-flight-list tbody tr')].map(
        (r) => r.textContent ?? '',
      );
      expect(rows[0]).toContain('SIA317');
      expect(rows[1]).toContain('AAA1');
      expect(root.querySelector('app-flight-list .summary')?.textContent).toContain(
        '1 with a known route',
      );
    });

    it('renders the flight table with its own URL', async () => {
      signIn();
      const { router, root } = await open('/flights');
      expect(router.url).toBe('/flights');
      expect(root.querySelector('app-flights-page app-flight-list table')).not.toBeNull();
      expect(root.querySelector('app-map-page')).toBeNull();
      expect(root.textContent).toContain('Waiting for flight data');
    });
  });

  describe('Insights page (/insights)', () => {
    it('loads the three history datasets', async () => {
      signIn();
      const { fixture, root, http } = await open('/insights');
      http
        .expectOne((r) => r.url === '/api/stats/hourly' && r.params.get('hours') === '24')
        .flush({ points: [] });
      http.expectOne((r) => r.url === '/api/stats/top-airports').flush({ airports: [] });
      http.expectOne((r) => r.url === '/api/stats/airlines').flush({ airlines: [] });
      await settle(fixture);

      expect(root.textContent).toContain('Traffic by hour');
      expect(root.textContent).toContain('Busiest airports');
      expect(root.textContent).toContain('Airline share');
      expect(root.textContent).toContain('No history yet');
    });
  });

  describe('Airports page (/airports/:code)', () => {
    it('shows only the search without a code', async () => {
      signIn();
      const { root, http } = await open('/airports');
      http.expectNone((r) => r.url.startsWith('/api/airports/'));
      expect(root.querySelector('input[type="search"]')).not.toBeNull();
      expect(root.textContent).toContain('Search for an airport');
    });

    it('loads the board for the code in the URL', async () => {
      signIn();
      const { fixture, root, http } = await open('/airports/DEL');
      http.expectOne('/api/airports/DEL').flush(BOARD);
      await settle(fixture);

      expect(root.querySelector('h2')?.textContent).toContain('DEL');
      expect(root.textContent).toContain('AIC470');
      expect(root.textContent).toContain('Mumbai');
      expect(root.textContent).toContain('312');
    });

    it('shows the decoded METAR for the airport', async () => {
      signIn();
      const fetchStub = vi
        .fn()
        .mockResolvedValue(
          new Response('VIDP 131730Z 27008KT 3500 HZ FEW035 27/21 Q1016 NOSIG=', { status: 200 }),
        );
      vi.stubGlobal('fetch', fetchStub);
      const { fixture, root, http } = await open('/airports/DEL');
      http.expectOne('/api/airports/DEL').flush(BOARD);
      await settle(fixture);
      await settle(fixture);

      const text = root.querySelector('[data-testid="metar"]')?.textContent ?? '';
      expect(String(fetchStub.mock.calls[0]![0])).toContain('metar.vatsim.net/VIDP');
      expect(root.querySelector('[data-testid="metar-category"]')?.textContent).toContain('IFR');
      expect(text).toContain('8 kt');
      expect(text).toContain('1016 hPa');
      expect(text).toContain('27°C');
    });

    it('explains when the board cannot be loaded', async () => {
      signIn();
      const { fixture, root, http } = await open('/airports/ZZZ');
      http
        .expectOne('/api/airports/ZZZ')
        .flush({ message: 'Unknown airport' }, { status: 404, statusText: 'Not Found' });
      await settle(fixture);
      expect(root.textContent).toContain('Could not load the board for ZZZ');
    });
  });

  describe('sign-in form', () => {
    it('shows a friendly error for wrong credentials and stays on /login', async () => {
      const { fixture, router, root, http } = await open('/login');
      (root.querySelector('#email') as HTMLInputElement).value = 'admin@example.com';
      (root.querySelector('#password') as HTMLInputElement).value = 'wrong';
      root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

      http
        .expectOne('/api/auth/login')
        .flush(
          { message: 'Invalid email or password' },
          { status: 401, statusText: 'Unauthorized' },
        );
      await settle(fixture);

      expect(root.querySelector('[data-testid="login-error"]')?.textContent).toContain(
        'Invalid email or password',
      );
      expect(router.url).toBe('/login');
      expect(TestBed.inject(Auth).user()).toBeNull();
    });

    it('signs in and lands on the live map', async () => {
      const { fixture, router, root, http } = await open('/login');
      (root.querySelector('#email') as HTMLInputElement).value = 'admin@example.com';
      (root.querySelector('#password') as HTMLInputElement).value = 'right-password';
      root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

      http
        .expectOne('/api/auth/login')
        .flush({ user: { email: 'admin@example.com', role: 'admin' } });
      await settle(fixture);
      await settle(fixture);

      expect(router.url).toBe('/');
      expect(TestBed.inject(Auth).user()?.role).toBe('admin');
    });
  });
});

function FlightStreamCount(): number {
  return FakeEventSource.instances.length;
}

describe('flight card route sanity', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    localStorage.removeItem('fr-watchlist');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('warns instead of drawing progress when the plane is nowhere near its route', async () => {
    TestBed.inject(Auth).user.set({ email: 'admin@example.com', role: 'admin' });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();

    // Rajkot -> Delhi route, but the aircraft is over Karnataka.
    const misfit: Flight = {
      ...SIA317,
      lat: 14.5,
      lon: 75.5,
      origin: {
        code: 'HSR',
        name: 'Rajkot',
        city: 'Rajkot',
        country: 'IN',
        lat: 22.31,
        lon: 70.78,
        inIndia: true,
      },
      destination: {
        code: 'DEL',
        name: 'Delhi',
        city: 'New Delhi',
        country: 'IN',
        lat: 28.56,
        lon: 77.1,
        inIndia: true,
      },
    };
    TestBed.inject(FlightStream).snapshot.set(snapshotOf([misfit]));
    TestBed.inject(FlightSelection).select(misfit.id);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-flight-card .progress')).toBeNull();
    expect(root.querySelector('[data-testid="route-mismatch"]')?.textContent).toContain(
      'callsign may be re-used',
    );
  });
});

describe('sign-in switched off on the server (local development)', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    localStorage.removeItem('fr-watchlist');
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows "Login off" instead of the account menu and has no Sign out button', async () => {
    const auth = TestBed.inject(Auth);
    auth.user.set({ email: 'local@flightradar.local', role: 'admin' });
    auth.authDisabled.set(true);

    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="auth-off"]')?.textContent).toContain('Login off');
    expect(
      [...root.querySelectorAll('button')].some((b) => b.textContent?.includes('Sign out')),
    ).toBe(false);
  });

  it('restore() remembers that the server has sign-in off', async () => {
    const http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(Auth);
    const done = auth.restore();
    http.expectOne('/api/auth/me').flush({
      user: { email: 'local@flightradar.local', role: 'admin' },
      authDisabled: true,
    });
    await done;
    expect(auth.authDisabled()).toBe(true);
    expect(auth.user()?.role).toBe('admin');
  });
});
