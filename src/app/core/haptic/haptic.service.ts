import { Injectable, signal } from '@angular/core';

const KEY = 'diary.hapticsEnabled';

@Injectable({ providedIn: 'root' })
export class HapticService {
  private readonly supported = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  enabled = signal<boolean>(this.load());

  setEnabled(v: boolean): void {
    this.enabled.set(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }

  toggle(): void { this.setEnabled(!this.enabled()); }

  tap(): void { this.fire(10); }
  select(): void { this.fire(15); }
  success(): void { this.fire([20, 40, 20]); }
  warn(): void { this.fire([30, 60, 30, 60]); }

  private fire(pattern: number | number[]): void {
    if (!this.supported || !this.enabled()) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  private load(): boolean {
    try {
      const v = localStorage.getItem(KEY);
      if (v === '0') return false;
      return true; // default on
    } catch { return true; }
  }
}
