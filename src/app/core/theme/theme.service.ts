import { Injectable, signal } from '@angular/core';

export type Mode = 'dark' | 'light';

const MODE_KEY = 'diary.mode';
const DEFAULT_MODE: Mode = 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  mode = signal<Mode>(this.loadMode());

  setMode(mode: Mode): void {
    this.mode.set(mode);
    document.documentElement.setAttribute('data-mode', mode);
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  }

  toggleMode(): void {
    this.setMode(this.mode() === 'dark' ? 'light' : 'dark');
  }

  applyInitial(): void {
    document.documentElement.setAttribute('data-mode', this.mode());
  }

  private loadMode(): Mode {
    try {
      const m = localStorage.getItem(MODE_KEY) as Mode | null;
      if (m === 'dark' || m === 'light') return m;
    } catch { /* ignore */ }
    return DEFAULT_MODE;
  }
}
