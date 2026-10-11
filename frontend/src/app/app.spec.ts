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
  airport: { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International Airport', city: 'New Delhi', lat: 28.5, lon: 77.1 },
  updatedAt: '2026-10-10T06:00:00.000Z',
  arrivals: [
    { id: 'abc', callsign: 'AIC470', airline: 'Air India', aircraftType: 'A320', other: { code: 'BOM', city: 'Mumbai' }, altitudeM: 9000, speedMs: 220, distanceKm: 312 },
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
  origin: { code: 'LHR', name: 'London Heathrow', city: 'London', country: 'GB', lat: 51.47, lon: -0.46, inIndia: false },
  destination: { code: 'SIN', name: 'Changi', city: 'Singapore', country: 'SG', lat: 1.36, lon: 103.99, inIndia: false },
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
    return { fixture, router, root: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) };
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
    it('shows brand, four navigation links and the account, and opens one stream', async () => {
      signIn();
      const { root } = await open('/');
      expect(root.querySelector('.brand')?.textContent).toContain('Flight Radar India');
      const links = [...root.querySelectorAll<HTMLAnchorElement>('nav a')].map((a) => a.textContent?.trim());
      expect(links).toEqual(['Live map', 'Flights', 'Insights', 'Airports']);
      expect(root.textContent).toContain('admin@example.com');
      expect(FlightStreamCount()).toBe(1);
      expect(FakeEventSource.instances[0]?.url).toBe('/api/stream');
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
      expect(root.querySelector('[data-testid="feed-status"]')?.textContent).toContain('Connecting');
    });
  });

  describe('map options', () => {
    it('switches the legend between route type and altitude', async () => {
      signIn();
      const { fixture, root } = await open('/');
      expect(root.querySelector('.legend-title')?.textContent).toContain('Route type');

      const altitude = [...root.querySelectorAll<HTMLButtonElement>('.seg button')].find((b) =>
        b.textContent?.includes('Altitude'),
      )!;
      altitude.click();
      await fixture.whenStable();

      expect(TestBed.inject(MapSettings).colorBy()).toBe('altitude');
      expect(root.querySelector('.legend-title')?.textContent).toContain('Altitude');
      expect(root.querySelectorAll('.legend .item').length).toBe(7);
    });

    it('reports how many aircraft are in view', async () => {
      signIn();
      const { fixture, root } = await open('/');
      expect(root.querySelector('[data-testid="in-view"]')).toBeNull();
      TestBed.inject(MapSettings).inView.set(42);
      await fixture.whenStable();
      expect(root.querySelector('[data-testid="in-view"]')?.textContent).toContain('42 aircraft in view');
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
            { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International Airport', city: 'New Delhi', lat: 28.5, lon: 77.1 },
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
      expect(root.querySelector('app-global-search .results')?.textContent).toContain('No flights or airports match');
    });
  });

  describe('Flights page (/flights)', () => {
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
      http.expectOne((r) => r.url === '/api/stats/hourly' && r.params.get('hours') === '24').flush({ points: [] });
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

    it('explains when the board cannot be loaded', async () => {
      signIn();
      const { fixture, root, http } = await open('/airports/ZZZ');
      http.expectOne('/api/airports/ZZZ').flush({ message: 'Unknown airport' }, { status: 404, statusText: 'Not Found' });
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

      http.expectOne('/api/auth/login').flush({ message: 'Invalid email or password' }, { status: 401, statusText: 'Unauthorized' });
      await settle(fixture);

      expect(root.querySelector('[data-testid="login-error"]')?.textContent).toContain('Invalid email or password');
      expect(router.url).toBe('/login');
      expect(TestBed.inject(Auth).user()).toBeNull();
    });

    it('signs in and lands on the live map', async () => {
      const { fixture, router, root, http } = await open('/login');
      (root.querySelector('#email') as HTMLInputElement).value = 'admin@example.com';
      (root.querySelector('#password') as HTMLInputElement).value = 'right-password';
      root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

      http.expectOne('/api/auth/login').flush({ user: { email: 'admin@example.com', role: 'admin' } });
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
      origin: { code: 'HSR', name: 'Rajkot', city: 'Rajkot', country: 'IN', lat: 22.31, lon: 70.78, inIndia: true },
      destination: { code: 'DEL', name: 'Delhi', city: 'New Delhi', country: 'IN', lat: 28.56, lon: 77.1, inIndia: true },
    };
    TestBed.inject(FlightStream).snapshot.set(snapshotOf([misfit]));
    TestBed.inject(FlightSelection).select(misfit.id);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-flight-card .progress')).toBeNull();
    expect(root.querySelector('[data-testid="route-mismatch"]')?.textContent).toContain('callsign may be re-used');
  });
});
