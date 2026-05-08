import { Injectable } from '@angular/core';
import { DbService, StoredEntry, MediaRecord, Tag } from '../db/db.service';
import { EncryptedField } from '../crypto/crypto.service';
import { OpfsService } from '../media/opfs.service';
import { VaultService } from '../vault/vault.service';

const u8ToB64 = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
};
const b64ToU8 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

const serField = (f: EncryptedField) => ({ iv: u8ToB64(f.iv), ct: u8ToB64(f.ct) });
const desField = (f: { iv: string; ct: string }): EncryptedField => ({ iv: b64ToU8(f.iv), ct: b64ToU8(f.ct) });

interface BackupV1VaultMeta {
  salt: string;
  verifierIv: string;
  verifierCt: string;
  // v2 (DEK pattern + master code) — optional for backwards compat
  format?: 'v2';
  saltMaster?: string;
  dekWrappedUser?: { iv: string; ct: string };
  dekWrappedMaster?: { iv: string; ct: string };
}

interface BackupV1 {
  version: 1;
  exportedAt: number;
  vaultMeta: BackupV1VaultMeta | null;
  entries: any[];
  tags: Tag[];
  media: { records: any[]; blobs: Record<string, string> };
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  constructor(
    private db: DbService,
    private opfs: OpfsService,
    private vault: VaultService,
  ) {}

  async exportBackup(): Promise<void> {
    const [entries, tags, mediaRecords, vaultMeta] = await Promise.all([
      this.db.entries.toArray(),
      this.db.tags.toArray(),
      this.db.media.toArray(),
      this.db.vaultMeta.get('singleton'),
    ]);

    const blobs: Record<string, string> = {};
    for (const rec of mediaRecords) {
      try {
        const blob = await this.opfs.readBlob(rec.opfsPath);
        const ab = await blob.arrayBuffer();
        blobs[rec.opfsPath] = u8ToB64(new Uint8Array(ab));
      } catch { /* skip missing */ }
    }

    const backup: BackupV1 = {
      version: 1,
      exportedAt: Date.now(),
      vaultMeta: vaultMeta ? {
        salt: u8ToB64(vaultMeta.salt),
        verifierIv: u8ToB64(vaultMeta.verifierIv),
        verifierCt: u8ToB64(vaultMeta.verifierCt),
        ...(vaultMeta.format ? { format: vaultMeta.format } : {}),
        ...(vaultMeta.saltMaster ? { saltMaster: u8ToB64(vaultMeta.saltMaster) } : {}),
        ...(vaultMeta.dekWrappedUser ? { dekWrappedUser: serField(vaultMeta.dekWrappedUser) } : {}),
        ...(vaultMeta.dekWrappedMaster ? { dekWrappedMaster: serField(vaultMeta.dekWrappedMaster) } : {}),
      } : null,
      entries: entries.map(e => ({
        ...e,
        title: serField(e.title),
        bodyHtml: serField(e.bodyHtml),
        bodyText: serField(e.bodyText),
      })),
      tags,
      media: {
        records: mediaRecords.map(r => ({
          ...r,
          thumbnailData: serField(r.thumbnailData),
        })),
        blobs,
      },
    };

    const date = new Date().toISOString().slice(0, 10);
    const filename = `diary-backup-${date}.json`;
    await this.shareOrDownload(
      new Blob([JSON.stringify(backup)], { type: 'application/json' }),
      filename,
    );
  }

  async importBackup(file: File): Promise<void> {
    const backup: BackupV1 = JSON.parse(await file.text());
    if (backup.version !== 1) throw new Error('Unsupported backup version.');

    await Promise.all([
      this.db.entries.clear(),
      this.db.media.clear(),
      this.db.tags.clear(),
      this.db.vaultMeta.clear(),
    ]);

    // Clear OPFS media directory
    await this.opfs.clearDir('media').catch(() => {});

    if (backup.vaultMeta) {
      const vm = backup.vaultMeta;
      await this.db.vaultMeta.put({
        id: 'singleton',
        salt: b64ToU8(vm.salt),
        verifierIv: b64ToU8(vm.verifierIv),
        verifierCt: b64ToU8(vm.verifierCt),
        ...(vm.format ? { format: vm.format } : {}),
        ...(vm.saltMaster ? { saltMaster: b64ToU8(vm.saltMaster) } : {}),
        ...(vm.dekWrappedUser ? { dekWrappedUser: desField(vm.dekWrappedUser) } : {}),
        ...(vm.dekWrappedMaster ? { dekWrappedMaster: desField(vm.dekWrappedMaster) } : {}),
      });
    }

    const entries: StoredEntry[] = backup.entries.map((e: any) => ({
      ...e,
      title: desField(e.title),
      bodyHtml: desField(e.bodyHtml),
      bodyText: desField(e.bodyText),
    }));
    await this.db.entries.bulkPut(entries);
    await this.db.tags.bulkPut(backup.tags);

    const records: MediaRecord[] = backup.media.records.map((r: any) => ({
      ...r,
      thumbnailData: desField(r.thumbnailData),
    }));
    await this.db.media.bulkPut(records);

    for (const [path, b64] of Object.entries(backup.media.blobs)) {
      await this.opfs.writeBlob(path, new Blob([b64ToU8(b64)]));
    }

    this.vault.lock();
  }

  // Web Share API on iOS (gesture-context-safe), <a> fallback on desktop
  private async shareOrDownload(blob: Blob, filename: string): Promise<void> {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
}
