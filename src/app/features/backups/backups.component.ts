import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BackupService, SnapshotInfo } from '../../core/backup/backup.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-backups',
  standalone: true,
  imports: [CommonModule, ThemeToggleComponent],
  templateUrl: './backups.component.html',
  styleUrl: './backups.component.scss',
})
export class BackupsComponent implements OnInit {
  snapshots = signal<SnapshotInfo[]>([]);
  loading = signal(true);
  error = signal('');
  busyId = signal<string | null>(null);

  constructor(private backupSvc: BackupService, private router: Router) {}

  async ngOnInit() {
    await this.refresh();
    this.loading.set(false);
  }

  private async refresh() {
    this.snapshots.set(await this.backupSvc.list());
  }

  async snapshotNow() {
    this.busyId.set('new');
    this.error.set('');
    try {
      await this.backupSvc.snapshotNow();
      await this.refresh();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Snapshot failed.');
    } finally {
      this.busyId.set(null);
    }
  }

  async restore(id: string) {
    if (!confirm('Restore this snapshot? Current diary will be REPLACED. App will lock.')) return;
    this.busyId.set(id);
    this.error.set('');
    try {
      await this.backupSvc.restore(id);
      // restore() ends with vault.lock() → /lock navigation
    } catch (e: any) {
      this.error.set(e?.message ?? 'Restore failed.');
      this.busyId.set(null);
    }
  }

  async remove(id: string) {
    if (!confirm('Delete this snapshot? Cannot undo.')) return;
    await this.backupSvc.deleteSnapshot(id);
    await this.refresh();
  }

  formatTs(ts: number): string {
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  back() { this.router.navigate(['/settings']); }
}
