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

interface BackupVaultMeta {
  salt: string;
  verifierIv: string;
  verifierCt: string;
  format?: 'v2';
  saltMaster?: string;
  dekWrappedUser?: { iv: string; ct: string };
  dekWrappedMaster?: { iv: string; ct: string };
}

interface Backup {
  version: 1 | 2;
  exportedAt: number;
  vaultMeta: BackupVaultMeta | null;
  entries: any[];
  tags: Tag[];
  media: { records: any[]; blobs: Record<string, string> };
  checksum?: string;  // sha256 hex; only in v2
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

    const payload = {
      version: 2 as const,
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

    const checksum = await this.sha256Hex(this.canonicalize(payload));
    const backup: Backup = { ...payload, checksum };

    const date = new Date().toISOString().slice(0, 10);
    const filename = `diary-backup-${date}.json`;
    await this.shareOrDownload(
      new Blob([JSON.stringify(backup)], { type: 'application/json' }),
      filename,
    );
    try { localStorage.setItem('diary.lastBackup', String(Date.now())); } catch { /* ignore */ }
  }

  lastBackupMs(): number | null {
    try {
      const raw = localStorage.getItem('diary.lastBackup');
      return raw ? +raw : null;
    } catch { return null; }
  }

  daysSinceBackup(): number | null {
    const ts = this.lastBackupMs();
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  }

  async importBackup(file: File): Promise<void> {
    // 1. Parse + validate BEFORE touching any data
    let backup: Backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error('Backup file is not valid JSON.');
    }
    this.validateBackup(backup);

    // 2. Verify checksum if present (v2)
    if (backup.version === 2 && backup.checksum) {
      const { checksum, ...rest } = backup;
      const expected = await this.sha256Hex(this.canonicalize(rest));
      if (expected !== checksum) {
        throw new Error('Backup file is corrupt (checksum mismatch).');
      }
    }

    // 3. Pre-decode all encrypted fields so a malformed entry surfaces BEFORE we touch DB
    const decodedVaultMeta = backup.vaultMeta ? this.decodeVaultMeta(backup.vaultMeta) : null;
    const decodedEntries: StoredEntry[] = backup.entries.map((e: any) => ({
      ...e,
      title: desField(e.title),
      bodyHtml: desField(e.bodyHtml),
      bodyText: desField(e.bodyText),
    }));
    const decodedMediaRecords: MediaRecord[] = backup.media.records.map((r: any) => ({
      ...r,
      thumbnailData: desField(r.thumbnailData),
    }));

    // 4. Atomic DB swap inside a single Dexie transaction. Rolls back on any failure.
    await this.db.transaction(
      'rw', this.db.entries, this.db.media, this.db.tags, this.db.vaultMeta,
      async () => {
        await Promise.all([
          this.db.entries.clear(),
          this.db.media.clear(),
          this.db.tags.clear(),
          this.db.vaultMeta.clear(),
        ]);
        if (decodedVaultMeta) await this.db.vaultMeta.put(decodedVaultMeta);
        if (decodedEntries.length) await this.db.entries.bulkPut(decodedEntries);
        if (backup.tags.length) await this.db.tags.bulkPut(backup.tags);
        if (decodedMediaRecords.length) await this.db.media.bulkPut(decodedMediaRecords);
      },
    );

    // 5. Write OPFS blobs AFTER DB commit. If this step fails partway, DB references
    //    some missing blobs — UI handles missing media gracefully via try/catch.
    await this.opfs.clearDir('media').catch(() => {});
    for (const [path, b64] of Object.entries(backup.media.blobs)) {
      try {
        await this.opfs.writeBlob(path, new Blob([b64ToU8(b64)]));
      } catch { /* keep going so partial restore is better than full failure */ }
    }

    this.vault.lock();
  }

  // ── Validation ──

  private validateBackup(b: any): asserts b is Backup {
    if (!b || typeof b !== 'object') throw new Error('Backup is empty or not an object.');
    if (b.version !== 1 && b.version !== 2) {
      throw new Error(`Unsupported backup version (${b.version}).`);
    }
    if (typeof b.exportedAt !== 'number') throw new Error('Backup missing exportedAt timestamp.');
    if (!Array.isArray(b.entries)) throw new Error('Backup missing entries array.');
    if (!Array.isArray(b.tags)) throw new Error('Backup missing tags array.');
    if (!b.media || typeof b.media !== 'object') throw new Error('Backup missing media section.');
    if (!Array.isArray(b.media.records)) throw new Error('Backup missing media.records array.');
    if (!b.media.blobs || typeof b.media.blobs !== 'object') throw new Error('Backup missing media.blobs map.');

    if (b.vaultMeta !== null && (typeof b.vaultMeta !== 'object' || !b.vaultMeta.salt
      || !b.vaultMeta.verifierIv || !b.vaultMeta.verifierCt)) {
      throw new Error('Backup vaultMeta is malformed.');
    }

    for (let i = 0; i < b.entries.length; i++) {
      const e = b.entries[i];
      if (!e || typeof e !== 'object') throw new Error(`Entry #${i} is not an object.`);
      if (typeof e.id !== 'string') throw new Error(`Entry #${i} missing id.`);
      if (typeof e.date !== 'string') throw new Error(`Entry #${i} missing date.`);
      this.validateEncryptedField(e.title, `entries[${i}].title`);
      this.validateEncryptedField(e.bodyHtml, `entries[${i}].bodyHtml`);
      this.validateEncryptedField(e.bodyText, `entries[${i}].bodyText`);
    }

    for (let i = 0; i < b.media.records.length; i++) {
      const r = b.media.records[i];
      if (!r || typeof r.id !== 'string') throw new Error(`Media #${i} missing id.`);
      if (typeof r.opfsPath !== 'string') throw new Error(`Media #${i} missing opfsPath.`);
      this.validateEncryptedField(r.thumbnailData, `media.records[${i}].thumbnailData`);
    }
  }

  private validateEncryptedField(f: any, where: string): void {
    if (!f || typeof f !== 'object' || typeof f.iv !== 'string' || typeof f.ct !== 'string') {
      throw new Error(`Backup ${where} is malformed (expected { iv, ct }).`);
    }
  }

  private decodeVaultMeta(vm: BackupVaultMeta) {
    return {
      id: 'singleton' as const,
      salt: b64ToU8(vm.salt),
      verifierIv: b64ToU8(vm.verifierIv),
      verifierCt: b64ToU8(vm.verifierCt),
      ...(vm.format ? { format: vm.format } : {}),
      ...(vm.saltMaster ? { saltMaster: b64ToU8(vm.saltMaster) } : {}),
      ...(vm.dekWrappedUser ? { dekWrappedUser: desField(vm.dekWrappedUser) } : {}),
      ...(vm.dekWrappedMaster ? { dekWrappedMaster: desField(vm.dekWrappedMaster) } : {}),
    };
  }

  // ── Checksum ──

  private async sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Stable JSON: keys sorted at every level. Required for reproducible checksum.
  private canonicalize(o: unknown): string {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(v => this.canonicalize(v)).join(',') + ']';
    const keys = Object.keys(o as Record<string, unknown>).sort();
    return '{' + keys.map(k =>
      JSON.stringify(k) + ':' + this.canonicalize((o as Record<string, unknown>)[k])
    ).join(',') + '}';
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
