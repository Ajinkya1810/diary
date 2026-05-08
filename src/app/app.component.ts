import { Component, OnDestroy, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { VaultService } from './core/vault/vault.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    @if (updateAvailable()) {
      <div class="update-banner">
        <span>New version ready</span>
        <button (click)="applyUpdate()">Reload</button>
        <button class="dismiss" (click)="updateAvailable.set(false)">✕</button>
      </div>
    }
    <router-outlet />
    <div class="signature" aria-hidden="true">Ajinkya</div>
  `,
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnDestroy {
  updateAvailable = signal(false);
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = () => {
    if (document.hidden) {
      this.lockTimer = setTimeout(() => this.vault.lock(), 2 * 60 * 1000);
    } else {
      if (this.lockTimer) { clearTimeout(this.lockTimer); this.lockTimer = null; }
    }
  };

  constructor(private vault: VaultService, private theme: ThemeService, private swUpdate: SwUpdate) {
    this.theme.applyInitial();
    document.addEventListener('visibilitychange', this.onVisibility);

    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => this.updateAvailable.set(true));
      // Periodic check every 30 min
      setInterval(() => this.swUpdate.checkForUpdate().catch(() => {}), 30 * 60 * 1000);
    }
  }

  async applyUpdate() {
    if (!this.swUpdate.isEnabled) { window.location.reload(); return; }
    await this.swUpdate.activateUpdate();
    window.location.reload();
  }

  ngOnDestroy() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.lockTimer) clearTimeout(this.lockTimer);
  }
}
