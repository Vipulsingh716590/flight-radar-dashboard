import { Injectable, computed, signal } from '@angular/core';
import type { Flight, FlightKind } from './flight.models';
import { emergencyOf } from './emergency';
import { altitudeBand, type ColorBy } from './format';

/** 2D flat map, 3D tilted map with terrain, or a 3D globe. */
export type MapView = '2d' | '3d' | 'globe';

/** Aviation units (ft, kt, ft/min) or metric (m, km/h, m/s). */
export type Units = 'aviation' | 'metric';

/** Map display options and live read-outs shared between the map and its overlays. */
@Injectable({ providedIn: 'root' })
export class MapSettings {
  readonly colorBy = signal<ColorBy>('route');
  /** Airborne aircraft inside the current map view; null until the map reports it. */
  readonly inView = signal<number | null>(null);
  readonly showAirports = signal(true);
  readonly view = signal<MapView>('2d');
  /** Chase camera: keeps the selected flight centred and looks along its heading. */
  readonly follow = signal(false);
  readonly units = signal<Units>('aviation');

  /** Filters: what is hidden (so "nothing hidden" is the default and needs no state). */
  readonly hiddenKinds = signal<ReadonlySet<FlightKind>>(new Set());
  readonly hiddenBands = signal<ReadonlySet<number>>(new Set());
  readonly knownRouteOnly = signal(false);
  readonly activeFilterCount = computed(
    () => this.hiddenKinds().size + this.hiddenBands().size + (this.knownRouteOnly() ? 1 : 0),
  );

  /** Weather: rain radar overlay (RainViewer) and its playback state. */
  readonly radar = signal(false);
  readonly radarPlaying = signal(true);
  /** Epoch seconds of the radar frame on screen, reported by the map. */
  readonly radarTime = signal<number | null>(null);
  readonly radarError = signal(false);

  /** Map centre, reported by the map after it moves (used for local weather). */
  readonly center = signal<{ lat: number; lon: number } | null>(null);
  /** Ask the map to fly somewhere; `n` makes repeated requests to the same place distinct. */
  readonly flyTo = signal<{ lat: number; lon: number; zoom: number; n: number } | null>(null);

  passes(flight: Flight): boolean {
    // An emergency is never filtered out.
    if (emergencyOf(flight)) return true;
    if (this.hiddenKinds().has(flight.kind)) return false;
    if (this.hiddenBands().has(altitudeBand(flight.alt))) return false;
    if (this.knownRouteOnly() && (!flight.origin || !flight.destination)) return false;
    return true;
  }

  toggleKind(kind: FlightKind): void {
    this.hiddenKinds.update((set) => toggled(set, kind));
  }

  toggleBand(band: number): void {
    this.hiddenBands.update((set) => toggled(set, band));
  }

  resetFilters(): void {
    this.hiddenKinds.set(new Set());
    this.hiddenBands.set(new Set());
    this.knownRouteOnly.set(false);
  }

  fly(lat: number, lon: number, zoom = 8): void {
    this.flyTo.update((previous) => ({ lat, lon, zoom, n: (previous?.n ?? 0) + 1 }));
  }
}

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
