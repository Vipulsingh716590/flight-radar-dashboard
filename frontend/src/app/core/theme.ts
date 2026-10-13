import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'fr-theme';

/**
 * Light / dark theme. The choice is remembered in localStorage; without one the
 * operating system preference decides. Applied as `data-theme` on <html>, which
 * the CSS variables in styles.scss react to (and the map/charts read).
 *
 * The attribute is written synchronously together with the signal, so anything
 * that reacts to the signal already sees the new CSS variables.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<Theme>('dark');

  constructor() {
    this.set(this.initial(), false);
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark', true);
  }

  set(theme: Theme, remember = true): void {
    this.document.documentElement.dataset['theme'] = theme;
    this.document.documentElement.style.colorScheme = theme;
    this.theme.set(theme);
    if (!remember) return;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode or blocked storage: the theme simply is not remembered.
    }
  }

  private initial(): Theme {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // fall through to the system preference
    }
    const prefersLight =
      typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }
}
