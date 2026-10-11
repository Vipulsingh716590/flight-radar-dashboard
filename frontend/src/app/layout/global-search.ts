import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Api, type AirportInfo } from '../core/api';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import type { Flight } from '../core/flight.models';
import { routeLabel, searchText } from '../core/format';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
const MAX_FLIGHTS = 6;

interface Hit {
  kind: 'flight' | 'airport';
  key: string;
  title: string;
  detail: string;
  /** What to open. */
  flightId?: string;
  airportCode?: string;
}

/**
 * One search box for everything (like Flightradar24's top bar): live flights
 * by callsign / airline / registration / airport, and airports by code, name
 * or city. Picking a flight shows it on the map; an airport opens its board.
 */
@Component({
  selector: 'app-global-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './global-search.html',
  styleUrl: './global-search.scss',
})
export class GlobalSearch implements OnDestroy {
  private readonly api = inject(Api);
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly open = signal(false);
  private readonly airports = signal<AirportInfo[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  private readonly flightHits = computed<Hit[]>(() => {
    const needle = this.query().trim().toLowerCase();
    if (needle.length < MIN_CHARS) return [];
    const flights = this.stream.snapshot()?.flights ?? [];
    const matches: Flight[] = [];
    for (const flight of flights) {
      if (flight.onGround || !searchText(flight).includes(needle)) continue;
      matches.push(flight);
    }
    // Callsigns that start with the text first, then the rest.
    matches.sort((a, b) => rank(a, needle) - rank(b, needle));
    return matches.slice(0, MAX_FLIGHTS).map((flight) => ({
      kind: 'flight' as const,
      key: `f:${flight.id}`,
      title: flight.callsign ?? flight.id.toUpperCase(),
      detail: [flight.airline, routeLabel(flight) === '—' ? null : routeLabel(flight)]
        .filter(Boolean)
        .join(' · '),
      flightId: flight.id,
    }));
  });

  private readonly airportHits = computed<Hit[]>(() =>
    this.airports().map((airport) => {
      const code = airport.iata ?? airport.icao ?? '';
      return {
        kind: 'airport' as const,
        key: `a:${airport.icao ?? airport.iata}`,
        title: code,
        detail: [airport.name, airport.city].filter(Boolean).join(' · '),
        airportCode: code,
      };
    }),
  );

  protected readonly hits = computed<Hit[]>(() => [...this.flightHits(), ...this.airportHits()]);
  protected readonly showPanel = computed(
    () => this.open() && this.query().trim().length >= MIN_CHARS,
  );

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.query.set(text);
    this.open.set(true);
    if (this.timer) clearTimeout(this.timer);
    if (text.trim().length < MIN_CHARS) {
      this.airports.set([]);
      return;
    }
    this.timer = setTimeout(() => void this.searchAirports(text.trim()), DEBOUNCE_MS);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.open.set(false);
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Enter') {
      const first = this.hits()[0];
      if (first) this.choose(first);
    }
  }

  protected choose(hit: Hit): void {
    this.open.set(false);
    this.query.set('');
    this.airports.set([]);
    if (hit.kind === 'flight' && hit.flightId) {
      this.selection.select(hit.flightId);
      void this.router.navigate(['/']);
    } else if (hit.airportCode) {
      void this.router.navigate(['/airports', hit.airportCode]);
    }
  }

  /** Delay closing so a click on a result is handled before the panel disappears. */
  protected onBlur(): void {
    setTimeout(() => this.open.set(false), 150);
  }

  private async searchAirports(text: string): Promise<void> {
    const seq = ++this.seq;
    try {
      const result = await this.api.searchAirports(text);
      if (seq === this.seq) this.airports.set(result.slice(0, 5));
    } catch {
      if (seq === this.seq) this.airports.set([]);
    }
  }
}

function rank(flight: Flight, needle: string): number {
  const callsign = (flight.callsign ?? '').toLowerCase();
  if (callsign === needle) return 0;
  if (callsign.startsWith(needle)) return 1;
  return 2;
}
