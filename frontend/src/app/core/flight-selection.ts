import { Injectable, signal } from '@angular/core';

/** Which flight (icao24) is highlighted; shared by the list and the map. */
@Injectable({ providedIn: 'root' })
export class FlightSelection {
  readonly selectedId = signal<string | null>(null);

  select(id: string | null): void {
    this.selectedId.set(id);
  }
}
