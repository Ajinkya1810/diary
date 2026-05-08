import { Injectable, signal } from '@angular/core';

export type Theme = 'neon' | 'oled' | 'midnight' | 'sunset';

const THEME_KEY = 'diary.theme';
const DEFAULT_THEME: Theme = 'neon';

const THEMES: { id: Theme; label: string; bg: string; accent: string }[] = [
  { id: 'neon',     label: 'Neon',     bg: '#000000', accent: '#FF2D78' },
  { id: 'oled',     label: 'OLED',     bg: '#000000', accent: '#7EECC8' },
  { id: 'midnight', label: 'Midnight', bg: '#0d1421', accent: '#a78bfa' },
  { id: 'sunset',   label: 'Sunset',   bg: '#1a0e1f', accent: '#ff7e6b' },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  current = signal<Theme>(this.load());

  themes() { return THEMES; }

  set(theme: Theme): void {
    this.current.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }

  applyInitial(): void {
    document.documentElement.setAttribute('data-theme', this.current());
  }

  private load(): Theme {
    try {
      const t = localStorage.getItem(THEME_KEY) as Theme | null;
      if (t && THEMES.some(x => x.id === t)) return t;
    } catch { /* ignore */ }
    return DEFAULT_THEME;
  }
}
