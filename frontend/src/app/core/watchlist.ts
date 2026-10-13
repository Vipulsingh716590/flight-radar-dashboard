import { Injectable, computed, signal } from '@angular/core';
import type { Flight } from './flight.models';

const STORAGE_KEY = 'fr-watchlist';
const MAX_ITEMS = 50;

export interface WatchItem {
  /** icao24 hex, the stable id of an aircraft. */
  id: string;
  /** What to show while the aircraft is not in range: callsign or registration. */
  label: string;
}

/**
 * Flights the user starred. Kept in this browser (localStorage); there is no
 * account-level storage, so it does not follow the user to another device.
 */
@Injectable({ providedIn: 'root' })
export class Watchlist {
  readonly items = signal<WatchItem[]>(load());
  readonly ids = computed(() => new Set(this.items().map((item) => item.id)));

  has(id: string): boolean {
    return this.ids().has(id);
  }

  toggle(flight: Pick<Flight, 'id' | 'callsign' | 'reg'>): void {
    if (this.has(flight.id)) {
      this.remove(flight.id);
      return;
    }
    const label = flight.callsign ?? flight.reg ?? flight.id.toUpperCase();
    this.update([{ id: flight.id, label }, ...this.items()].slice(0, MAX_ITEMS));
  }

  remove(id: string): void {
    this.update(this.items().filter((item) => item.id !== id));
  }

  private update(items: WatchItem[]): void {
    this.items.set(items);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage blocked: the list works for this visit only.
    }
  }
}

function load(): WatchItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is WatchItem =>
          typeof item?.id === 'string' && typeof item?.label === 'string',
      )
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}
