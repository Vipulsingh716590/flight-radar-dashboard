import { Injectable } from '@angular/core';

/**
 * Settings read from `/config.json` when the app starts, so one build runs
 * against any backend. In Docker the file is written from `API_BASE_URL` at
 * container start; on Netlify it is a committed file.
 *
 * - `apiBaseUrl: ""` (default): the API is on the same origin (`/api/...`),
 *   typically through a reverse proxy. Cookies stay first-party.
 * - `apiBaseUrl: "https://api.example.com"`: the API is on another origin.
 *   Requests then carry credentials, which needs CORS and
 *   `COOKIE_SAMESITE=none` (or a shared parent domain) on the backend.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeConfig {
  private base = '';

  /** No trailing slash; empty string means same origin. */
  get apiBase(): string {
    return this.base;
  }

  /** True when the API lives on another origin than the page. */
  get crossOrigin(): boolean {
    return this.base !== '';
  }

  async load(): Promise<void> {
    try {
      const response = await fetch(new URL('config.json', document.baseURI), { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { apiBaseUrl?: unknown };
      this.base = normaliseBase(body.apiBaseUrl);
    } catch {
      // No config file (e.g. unit tests, plain static hosting): same-origin API.
      this.base = '';
    }
  }

  /** Turns `/api/...` into an absolute URL when the API is on another origin. */
  url(path: string): string {
    return `${this.base}${path}`;
  }
}

/** Accepts only an http(s) origin; anything else is ignored rather than trusted. */
export function normaliseBase(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}
