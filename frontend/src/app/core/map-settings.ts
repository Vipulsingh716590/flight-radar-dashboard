import { Injectable, signal } from '@angular/core';
import type { ColorBy } from './format';

/** Map display options and live read-outs shared between the map and its overlays. */
@Injectable({ providedIn: 'root' })
export class MapSettings {
  readonly colorBy = signal<ColorBy>('route');
  /** Airborne aircraft inside the current map view; null until the map reports it. */
  readonly inView = signal<number | null>(null);
  readonly showAirports = signal(true);
}
