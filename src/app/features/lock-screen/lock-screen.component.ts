import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { VaultService } from '../../core/vault/vault.service';
import { InstallService } from '../../core/install/install.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';
import { BUILD_LABEL } from '../../version';

@Component({
  selector: 'app-lock-screen',
  standalone: true,
  imports: [CommonModule, FormsModule, ThemeToggleComponent],
  templateUrl: './lock-screen.component.html',
  styleUrl: './lock-screen.component.scss',
})
export class LockScreenComponent implements OnInit {
  readonly buildLabel = BUILD_LABEL;
  mode = signal<'loading' | 'setup' | 'unlock'>('loading');
  passcode = '';
  confirm = '';
  warningAcknowledged = false;
  error = signal('');
  busy = signal(false);
  refreshing = signal(false);

  constructor(
    private vault: VaultService,
    private router: Router,
    private swUpdate: SwUpdate,
    public install: InstallService,
  ) {}

  async hardRefresh() {
    this.refreshing.set(true);
    try {
      if (this.swUpdate.isEnabled) {
        await this.swUpdate.checkForUpdate();
        await this.swUpdate.activateUpdate();
      }
    } finally {
      window.location.reload();
    }
  }

  async ngOnInit() {
    const initialized = await this.vault.isInitialized();
    this.mode.set(initialized ? 'unlock' : 'setup');
  }

  async submit() {
    this.error.set('');
    if (this.mode() === 'setup') await this.setup();
    else await this.unlock();
  }

  private async setup() {
    if (this.passcode.length < 6) { this.error.set('Passcode must be at least 6 characters.'); return; }
    if (this.passcode !== this.confirm) { this.error.set('Passcodes do not match.'); return; }
    if (!this.warningAcknowledged) { this.error.set('Please acknowledge the warning.'); return; }
    this.busy.set(true);
    try {
      await this.vault.setupPasscode(this.passcode);
      this.router.navigate(['/timeline']);
    } catch {
      this.error.set('Setup failed. Please try again.');
      this.busy.set(false);
    }
  }

  private async unlock() {
    if (!this.passcode) { this.error.set('Enter your passcode.'); return; }
    this.busy.set(true);
    const ok = await this.vault.unlock(this.passcode);
    if (ok) {
      this.router.navigate(['/timeline']);
    } else {
      this.error.set('Wrong passcode.');
      this.passcode = '';
      this.busy.set(false);
    }
  }

  get migrating() { return this.vault.migrating; }
}
