import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class HapticService {
  private supported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  tap(): void { this.fire(10); }
  select(): void { this.fire(15); }
  success(): void { this.fire([20, 40, 20]); }
  warn(): void { this.fire([30, 60, 30, 60]); }

  private fire(pattern: number | number[]): void {
    if (!this.supported) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}
