import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light' | 'glass';

/** Themes offered in the header menu. `glass` is the dark blue-grey one with a lime accent. */
export const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'glass', label: 'Glass' },
];

export const isTheme = (value: unknown): value is Theme => THEMES.some((t) => t.id === value);

const STORAGE_KEY = 'fr-theme';

/**
 * Colour theme (dark, light, glass). The choice is remembered in localStorage; without one the
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

  /** Cycles dark -> light -> glass -> dark. */
  toggle(): void {
    const index = THEMES.findIndex((t) => t.id === this.theme());
    this.set(THEMES[(index + 1) % THEMES.length]!.id, true);
  }

  set(theme: Theme, remember = true): void {
    this.document.documentElement.dataset['theme'] = theme;
    this.document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
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
      if (isTheme(saved)) return saved;
    } catch {
      // fall through to the system preference
    }
    const prefersLight =
      typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }
}
