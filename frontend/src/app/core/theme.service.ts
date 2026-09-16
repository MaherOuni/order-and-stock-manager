import { Injectable, computed, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'orderstock-theme';

/**
 * Light or dark, chosen explicitly and remembered.
 *
 * The OS preference is deliberately not consulted: light is the product's default, and a
 * manager who picks dark on the terminal behind the counter should keep it whatever the
 * machine's system setting says.
 *
 * The same value is applied by an inline script in index.html before first paint — without
 * that, a dark-mode user gets a white flash on every load.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(read());

  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => {
      const theme = this.theme();

      document.documentElement.dataset['theme'] = theme;

      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // Private mode; the choice just will not survive the tab.
      }
    });
  }

  toggle(): void {
    this.theme.update((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  set(theme: Theme): void {
    this.theme.set(theme);
  }
}

function read(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
