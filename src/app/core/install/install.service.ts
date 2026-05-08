import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'diary.installPromptDismissed';

@Injectable({ providedIn: 'root' })
export class InstallService {
  available = signal(false);
  private deferred: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    if (this.isInstalled()) return;
    if (this.dismissed()) return;
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.available.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.available.set(false);
      this.deferred = null;
    });
  }

  async prompt(): Promise<void> {
    if (!this.deferred) return;
    await this.deferred.prompt();
    await this.deferred.userChoice;
    this.deferred = null;
    this.available.set(false);
  }

  dismiss(): void {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    this.available.set(false);
  }

  isInstalled(): boolean {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
  }

  private dismissed(): boolean {
    try {
      const v = localStorage.getItem(DISMISS_KEY);
      if (!v) return false;
      const days = (Date.now() - +v) / (24 * 60 * 60 * 1000);
      return days < 14; // re-prompt after 2 weeks
    } catch { return false; }
  }
}
