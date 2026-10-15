import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import type { Flight, FlightKind } from '../core/flight.models';
import { FlightSelection } from '../core/flight-selection';
import { FlightStream } from '../core/flight-stream';
import { feet, KIND_COLOR, KIND_LABEL, KINDS, knots, routeLabel, searchText } from '../core/format';

type SortKey = 'callsign' | 'airline' | 'route' | 'altitude' | 'speed';

/** Searchable, filterable, sortable table of airborne flights. */
@Component({
  selector: 'app-flight-list',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './flight-list.html',
  styleUrl: './flight-list.scss',
})
export class FlightList {
  private readonly stream = inject(FlightStream);
  private readonly selection = inject(FlightSelection);
  private readonly router = inject(Router);

  /** Phones get big route cards instead of the table. */
  protected readonly cards = signal(false);

  constructor() {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 640px)');
    this.cards.set(query.matches);
    const onChange = (event: MediaQueryListEvent) => this.cards.set(event.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }

  protected readonly kinds = KINDS;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly kindColor = KIND_COLOR;
  protected readonly selectedId = this.selection.selectedId;

  protected readonly query = signal('');
  /** Empty set = no kind filter (show everything). */
  protected readonly activeKinds = signal<ReadonlySet<FlightKind>>(new Set());
  protected readonly sortKey = signal<SortKey>('callsign');
  protected readonly sortDesc = signal(false);

  private readonly airborne = computed(() =>
    (this.stream.snapshot()?.flights ?? []).filter((flight) => !flight.onGround),
  );

  protected readonly rows = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const kinds = this.activeKinds();
    const filtered = this.airborne().filter(
      (flight) =>
        (kinds.size === 0 || kinds.has(flight.kind)) &&
        (needle === '' || searchText(flight).includes(needle)),
    );
    const direction = this.sortDesc() ? -1 : 1;
    const key = this.sortKey();
    return [...filtered].sort((a, b) => direction * compare(a, b, key));
  });

  protected readonly total = computed(() => this.airborne().length);
  /** How many airborne flights have both ends of their route. */
  protected readonly withRoute = computed(() => this.airborne().filter(hasRoute).length);

  protected kindCount(kind: FlightKind): number {
    return this.airborne().filter((flight) => flight.kind === kind).length;
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected toggleKind(kind: FlightKind): void {
    const next = new Set(this.activeKinds());
    if (!next.delete(kind)) next.add(kind);
    this.activeKinds.set(next);
  }

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDesc.update((desc) => !desc);
    } else {
      this.sortKey.set(key);
      // Numbers are more useful biggest-first, text A-Z.
      this.sortDesc.set(key === 'altitude' || key === 'speed');
    }
  }

  protected arrow(key: SortKey): string {
    return this.sortKey() === key ? (this.sortDesc() ? '▼' : '▲') : '';
  }

  protected select(flight: Flight): void {
    // Show the plane on the live map.
    this.selection.select(flight.id);
    void this.router.navigate(['/']);
  }

  protected hasRoute = hasRoute;
  /** Why a card has no route: private/unscheduled flights are not in route databases. */
  protected noRouteNote = (flight: Flight) =>
    flight.airline
      ? 'Route not available for this callsign'
      : 'Private, cargo or unscheduled flight: no route data';
  protected route = routeLabel;
  protected altitudeFt = (flight: Flight) => feet(flight.alt);
  protected speedKt = (flight: Flight) => knots(flight.speed);
  protected end = (flight: Flight, side: 'origin' | 'destination') => flight[side];
  protected title = (flight: Flight) => flight.callsign ?? flight.id.toUpperCase();
}

function compare(a: Flight, b: Flight, key: SortKey): number {
  switch (key) {
    case 'altitude':
      return (a.alt ?? -1) - (b.alt ?? -1);
    case 'speed':
      return (a.speed ?? -1) - (b.speed ?? -1);
    case 'airline':
      return (a.airline ?? '').localeCompare(b.airline ?? '');
    case 'route':
      return routeLabel(a).localeCompare(routeLabel(b));
    default:
      // Flights whose route is known first: private/unscheduled ones (VT-xxx
      // registrations) otherwise end up together at the bottom of an A-Z list.
      return (
        Number(hasRoute(b)) - Number(hasRoute(a)) ||
        (a.callsign ?? a.id).localeCompare(b.callsign ?? b.id)
      );
  }
}

function hasRoute(flight: Flight): boolean {
  return flight.origin !== null && flight.destination !== null;
}
