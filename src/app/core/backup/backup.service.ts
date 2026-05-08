import { Injectable } from '@angular/core';
import { DbService } from '../db/db.service';
import { ExportService } from '../export/export.service';

const MAX_SNAPSHOTS = 3;
const SNAPSHOT_DEBOUNCE_MS = 5 * 60 * 1000;       // at most one in-memory trigger per 5 min
const SNAPSHOT_MIN_GAP_MS  = 24 * 60 * 60 * 1000; // at most one IDB write per 24h
const LAST_KEY = 'diary.lastSnapshotAt';

export interface SnapshotInfo {
  id: string;
  ts: number;
  sizeBytes: number;
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private debounceTimer: any = null;

  constructor(private db: DbService, private exportSvc: ExportService) {}

  /** Schedule a snapshot soon if one isn't already pending. Safe to call from any save path. */
  scheduleSnapshot(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.snapshotIfDue().catch(() => { /* ignore */ });
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  /** Force a snapshot regardless of debounce/gap. Used by Settings → Backup Now. */
  async snapshotNow(): Promise<SnapshotInfo> {
    const blob = await this.exportSvc.serializeBackup();
    const row = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      sizeBytes: blob.size,
      payload: blob,
    };
    await this.db.backupSnapshots.add(row);
    await this.prune();
    try { localStorage.setItem(LAST_KEY, String(row.ts)); } catch { /* ignore */ }
    return { id: row.id, ts: row.ts, sizeBytes: row.sizeBytes };
  }

  async list(): Promise<SnapshotInfo[]> {
    const rows = await this.db.backupSnapshots.orderBy('ts').reverse().toArray();
    return rows.map(({ id, ts, sizeBytes }) => ({ id, ts, sizeBytes }));
  }

  async getPayload(id: string): Promise<Blob | null> {
    const row = await this.db.backupSnapshots.get(id);
    return row?.payload ?? null;
  }

  /** Restore from a snapshot blob via the hardened importBackup path. */
  async restore(id: string): Promise<void> {
    const blob = await this.getPayload(id);
    if (!blob) throw new Error('Snapshot not found.');
    await this.exportSvc.importBackup(blob);
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.db.backupSnapshots.delete(id);
  }

  private async snapshotIfDue(): Promise<void> {
    const last = +(localStorage.getItem(LAST_KEY) ?? 0);
    if (last && Date.now() - last < SNAPSHOT_MIN_GAP_MS) return;
    await this.snapshotNow();
  }

  private async prune(): Promise<void> {
    const rows = await this.db.backupSnapshots.orderBy('ts').reverse().toArray();
    const toDelete = rows.slice(MAX_SNAPSHOTS).map(r => r.id);
    if (toDelete.length) await this.db.backupSnapshots.bulkDelete(toDelete);
  }
}
