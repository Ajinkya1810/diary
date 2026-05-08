import { Injectable, signal } from '@angular/core';

const DISMISS_KEY = 'diary.persistBannerDismissed';
const DISMISS_DAYS = 14;

@Injectable({ providedIn: 'root' })
export class StorageService {
  persisted = signal<boolean | null>(null); // null = unknown / unsupported

  /** Call after vault unlock. Best-effort persistence request + state read. */
  async ensurePersisted(): Promise<void> {
    if (!navigator.storage?.persist) {
      this.persisted.set(null);
      return;
    }
    try {
      // If already persisted, this resolves true without prompting.
      const ok = await navigator.storage.persist();
      this.persisted.set(ok);
    } catch {
      this.persisted.set(false);
    }
  }

  shouldShowPersistBanner(): boolean {
    if (this.persisted() !== false) return false;
    try {
      const v = localStorage.getItem(DISMISS_KEY);
      if (!v) return true;
      const days = (Date.now() - +v) / (24 * 60 * 60 * 1000);
      return days >= DISMISS_DAYS;
    } catch { return true; }
  }

  dismissPersistBanner(): void {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  }

  async usage(): Promise<{ usedMb: number; quotaMb: number; pct: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      usedMb: Math.round(usage / 1024 / 1024),
      quotaMb: Math.round(quota / 1024 / 1024),
      pct: quota ? Math.round((usage / quota) * 100) : 0,
    };
  }
}
