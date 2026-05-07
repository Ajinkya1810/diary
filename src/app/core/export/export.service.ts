import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import { DbService, StoredEntry, MediaRecord, Tag } from '../db/db.service';
import { EncryptedField } from '../crypto/crypto.service';
import { OpfsService } from '../media/opfs.service';
import { VaultService } from '../vault/vault.service';
import { EntryService } from '../entry/entry.service';

const u8ToB64 = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
};
const b64ToU8 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

const serField = (f: EncryptedField) => ({ iv: u8ToB64(f.iv), ct: u8ToB64(f.ct) });
const desField = (f: { iv: string; ct: string }): EncryptedField => ({ iv: b64ToU8(f.iv), ct: b64ToU8(f.ct) });

interface BackupV1 {
  version: 1;
  exportedAt: number;
  vaultMeta: { salt: string; verifierIv: string; verifierCt: string } | null;
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
    private entrySvc: EntryService,
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
    const filename = `diary-backup-${date}.diarybackup`;
    await this.shareOrDownload(
      new Blob([JSON.stringify(backup)], { type: 'application/octet-stream' }),
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

  async exportPdf(): Promise<void> {
    const entries = await this.entrySvc.listAll();
    if (!entries.length) throw new Error('No entries to export.');

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 190;
    const ML = 10; const MT = 15;
    let y = MT;

    const nextPage = () => { doc.addPage(); y = MT; };
    const checkY = (needed: number) => { if (y + needed > 287) nextPage(); };

    // Cover page
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(40, 40, 40);
    doc.text('My Diary', 105, 130, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      105, 142, { align: 'center' },
    );
    doc.text(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`, 105, 150, { align: 'center' });

    for (const entry of entries) {
      doc.addPage();
      y = MT;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      const dateStr = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      doc.text(dateStr.toUpperCase(), ML, y);
      y += 7;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(20, 20, 20);
      const titleLines = doc.splitTextToSize(entry.title || 'Untitled', W);
      checkY(titleLines.length * 8);
      doc.text(titleLines, ML, y);
      y += titleLines.length * 8 + 4;

      doc.setDrawColor(200, 200, 200);
      doc.line(ML, y, ML + W, y);
      y += 6;

      if (entry.bodyText.trim()) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(50, 50, 50);
        for (const para of entry.bodyText.split(/\n+/)) {
          if (!para.trim()) continue;
          const lines = doc.splitTextToSize(para, W);
          checkY(lines.length * 5.5 + 4);
          doc.text(lines, ML, y);
          y += lines.length * 5.5 + 4;
        }
      }
    }

    const date = new Date().toISOString().slice(0, 10);
    const pdfBlob = doc.output('blob');
    await this.shareOrDownload(pdfBlob, `diary-${date}.pdf`);
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
