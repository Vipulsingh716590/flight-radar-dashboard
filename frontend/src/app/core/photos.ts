import { Injectable } from '@angular/core';

/**
 * Aircraft photos from the Planespotters.net public API (no key). Called from
 * the browser. Photos belong to their photographers: the card must show the
 * credit and link back, which is why both are part of the result.
 */
const API = 'https://api.planespotters.net/pub/photos';
const TIMEOUT_MS = 6000;

export interface AircraftPhoto {
  src: string;
  link: string;
  photographer: string;
}

@Injectable({ providedIn: 'root' })
export class AircraftPhotos {
  /** One lookup per aircraft per visit; misses are cached too. */
  private readonly cache = new Map<string, Promise<AircraftPhoto | null>>();

  photo(icao24: string, reg: string | null): Promise<AircraftPhoto | null> {
    let result = this.cache.get(icao24);
    if (!result) {
      result = this.lookup(`hex/${encodeURIComponent(icao24)}`).then(
        (found) => found ?? (reg ? this.lookup(`reg/${encodeURIComponent(reg)}`) : null),
      );
      this.cache.set(icao24, result);
    }
    return result;
  }

  private async lookup(path: string): Promise<AircraftPhoto | null> {
    try {
      const response = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        photos?: {
          link: string;
          photographer: string;
          thumbnail_large?: { src: string };
          thumbnail?: { src: string };
        }[];
      };
      const first = body.photos?.[0];
      const src = first?.thumbnail_large?.src ?? first?.thumbnail?.src;
      return first && src ? { src, link: first.link, photographer: first.photographer } : null;
    } catch {
      return null;
    }
  }
}
