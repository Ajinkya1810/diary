import { Component, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VaultService } from './core/vault/vault.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnDestroy {
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = () => {
    if (document.hidden) {
      this.lockTimer = setTimeout(() => this.vault.lock(), 2 * 60 * 1000);
    } else {
      if (this.lockTimer) { clearTimeout(this.lockTimer); this.lockTimer = null; }
    }
  };

  constructor(private vault: VaultService, private theme: ThemeService) {
    this.theme.applyInitial();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.lockTimer) clearTimeout(this.lockTimer);
  }
}
