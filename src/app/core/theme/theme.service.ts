import { Injectable, signal } from '@angular/core';

export type Theme = 'neon' | 'oled' | 'midnight' | 'sunset';
export type Mode = 'dark' | 'light';

const THEME_KEY = 'diary.theme';
const MODE_KEY = 'diary.mode';
const DEFAULT_THEME: Theme = 'neon';
const DEFAULT_MODE: Mode = 'dark';

const THEMES: { id: Theme; label: string; bg: string; accent: string }[] = [
  { id: 'neon',     label: 'Neon',     bg: '#000000', accent: '#FF2D78' },
  { id: 'oled',     label: 'OLED',     bg: '#000000', accent: '#7EECC8' },
  { id: 'midnight', label: 'Midnight', bg: '#0d1421', accent: '#a78bfa' },
  { id: 'sunset',   label: 'Sunset',   bg: '#1a0e1f', accent: '#ff7e6b' },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  current = signal<Theme>(this.loadTheme());
  mode = signal<Mode>(this.loadMode());

  themes() { return THEMES; }

  set(theme: Theme): void {
    this.current.set(theme);
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
    document.documentElement.setAttribute('data-mode', mode);
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'dark' ? 'light' : 'dark');
  }

  applyInitial(): void {
    document.documentElement.setAttribute('data-theme', this.current());
    document.documentElement.setAttribute('data-mode', this.mode());
  }

  private loadTheme(): Theme {
    try {
      const t = localStorage.getItem(THEME_KEY) as Theme | null;
      if (t && THEMES.some(x => x.id === t)) return t;
    } catch { /* ignore */ }
    return DEFAULT_THEME;
  }

  private loadMode(): Mode {
    try {
      const m = localStorage.getItem(MODE_KEY) as Mode | null;
      if (m === 'dark' || m === 'light') return m;
    } catch { /* ignore */ }
    return DEFAULT_MODE;
  }
}
