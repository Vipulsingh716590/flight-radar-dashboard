import { Injectable, signal } from '@angular/core';
import type { ColorBy } from './format';

/** 2D flat map, 3D tilted map with terrain, or a 3D globe. */
export type MapView = '2d' | '3d' | 'globe';

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
}
