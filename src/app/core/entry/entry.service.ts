import { Injectable, effect } from '@angular/core';
import { DbService, Entry, StoredEntry, MediaRecord } from '../db/db.service';
import { VaultService } from '../vault/vault.service';
import { CryptoService } from '../crypto/crypto.service';
import { OpfsService } from '../media/opfs.service';

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

@Injectable({ providedIn: 'root' })
export class EntryService {
  // P1: cache decrypted entries keyed by id; invalidated by updatedAt mismatch.
  private cache = new Map<string, { updatedAt: number; plain: Entry }>();

  constructor(
    private db: DbService,
    private vault: VaultService,
    private crypto: CryptoService,
    private opfs: OpfsService,
  ) {
    // Drop decrypted cache on lock.
    effect(() => {
      this.vault.lockedAt();
      this.cache.clear();
    });
  }

  /** Drop the entire decrypted-entry cache. Called on lock. */
  clearCache(): void { this.cache.clear(); }

  async listAll(): Promise<Entry[]> {
    const key = this.vault.requireKey();
    const stored = await this.db.entries.orderBy('date').reverse().toArray();
    const active = stored.filter(s => !s.deletedAt);
    return Promise.all(active.map(s => this.toPlainCached(s, key)));
  }

  async listDeleted(): Promise<Entry[]> {
    const key = this.vault.requireKey();
    const stored = await this.db.entries.toArray();
    const trashed = stored.filter(s => !!s.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    return Promise.all(trashed.map(s => this.toPlainCached(s, key)));
  }

  async get(id: string): Promise<Entry | null> {
    const key = this.vault.requireKey();
    const stored = await this.db.entries.get(id);
    if (!stored) return null;
    return this.toPlainCached(stored, key);
  }

  private async toPlainCached(stored: StoredEntry, key: CryptoKey): Promise<Entry> {
    const cached = this.cache.get(stored.id);
    if (cached && cached.updatedAt === stored.updatedAt) {
      // Reuse decrypted plaintext but refresh non-encrypted fields in case mediaIds/tagIds/deletedAt changed.
      return { ...cached.plain, ...stored, title: cached.plain.title, bodyHtml: cached.plain.bodyHtml, bodyText: cached.plain.bodyText };
    }
    const plain = await this.toPlain(stored, key);
    this.cache.set(stored.id, { updatedAt: stored.updatedAt, plain });
    return plain;
  }

  async add(entry: Omit<Entry, 'id'>): Promise<string> {
    const key = this.vault.requireKey();
    const id = crypto.randomUUID();
    const stored = await this.toStored({ id, ...entry } as Entry, key);
    await this.db.entries.add(stored);
    return id;
  }

  async update(id: string, partial: Partial<Pick<Entry, 'title' | 'bodyHtml' | 'bodyText' | 'date' | 'mood' | 'tagIds' | 'updatedAt'>>): Promise<void> {
    const key = this.vault.requireKey();
    const updates: Record<string, unknown> = {};
    if (partial.date !== undefined) updates['date'] = partial.date;
    if (partial.mood !== undefined) updates['mood'] = partial.mood;
    if (partial.tagIds !== undefined) updates['tagIds'] = partial.tagIds;
    if (partial.updatedAt !== undefined) updates['updatedAt'] = partial.updatedAt;
    if (partial.title !== undefined) updates['title'] = await this.crypto.encryptString(key, partial.title);
    if (partial.bodyHtml !== undefined) updates['bodyHtml'] = await this.crypto.encryptString(key, partial.bodyHtml);
    if (partial.bodyText !== undefined) updates['bodyText'] = await this.crypto.encryptString(key, partial.bodyText);
    await this.db.entries.update(id, updates as any);
    this.cache.delete(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.entries.update(id, { deletedAt: Date.now() } as any);
    this.cache.delete(id);
  }

  /**
   * D2: write an entry plus add/remove media records inside a single Dexie
   * transaction so a crash mid-way leaves the DB in a consistent state.
   * OPFS writes happen separately (caller is responsible).
   */
  async saveAtomic(opts: {
    entryId: string;
    isNew: boolean;
    fields: {
      title: string;
      date: string;
      bodyHtml: string;
      bodyText: string;
      mood: number | null;
      tagIds: string[];
    };
    addMediaRecords: MediaRecord[];
    removeMediaIds: string[];
    now: number;
  }): Promise<void> {
    const key = this.vault.requireKey();
    const [encTitle, encBodyHtml, encBodyText] = await Promise.all([
      this.crypto.encryptString(key, opts.fields.title),
      this.crypto.encryptString(key, opts.fields.bodyHtml),
      this.crypto.encryptString(key, opts.fields.bodyText),
    ]);

    await this.db.transaction('rw', this.db.entries, this.db.media, async () => {
      if (opts.isNew) {
        const stored: StoredEntry = {
          id: opts.entryId,
          date: opts.fields.date,
          title: encTitle,
          bodyHtml: encBodyHtml,
          bodyText: encBodyText,
          mood: opts.fields.mood,
          tagIds: opts.fields.tagIds,
          mediaIds: opts.addMediaRecords.map(r => r.id),
          createdAt: opts.now,
          updatedAt: opts.now,
        };
        await this.db.entries.add(stored);
      } else {
        await this.db.entries.update(opts.entryId, {
          date: opts.fields.date,
          title: encTitle,
          bodyHtml: encBodyHtml,
          bodyText: encBodyText,
          mood: opts.fields.mood,
          tagIds: opts.fields.tagIds,
          updatedAt: opts.now,
        } as any);
        if (opts.removeMediaIds.length || opts.addMediaRecords.length) {
          await this.db.entries.where('id').equals(opts.entryId).modify((e: any) => {
            const kept = (e.mediaIds ?? []).filter((id: string) => !opts.removeMediaIds.includes(id));
            e.mediaIds = [...kept, ...opts.addMediaRecords.map(r => r.id)];
          });
        }
        for (const mid of opts.removeMediaIds) {
          await this.db.media.delete(mid);
        }
      }
      for (const rec of opts.addMediaRecords) {
        await this.db.media.add(rec);
      }
    });
    this.cache.delete(opts.entryId);
  }

  async restore(id: string): Promise<void> {
    await this.db.entries.update(id, { deletedAt: undefined } as any);
    this.cache.delete(id);
  }

  async hardDelete(id: string): Promise<void> {
    const media = await this.db.media.where('entryId').equals(id).toArray();
    for (const m of media) {
      await this.opfs.deleteBlob(m.opfsPath).catch(() => {});
      await this.db.media.delete(m.id);
    }
    await this.db.entries.delete(id);
    await this.db.searchTokens.delete(id).catch(() => {});
    this.cache.delete(id);
  }

  async purgeExpired(): Promise<number> {
    const now = Date.now();
    // Skip if last run was very recent (avoid thrashing on rapid timeline navs).
    const lastRaw = +(localStorage.getItem('diary.lastPurgeAt') ?? 0);
    if (lastRaw && now - lastRaw < 60 * 60 * 1000) return 0;
    // Clock-went-backward guard.
    if (lastRaw && now < lastRaw) {
      // Don't purge — system clock anomaly. Reset the marker to "now" so we resume safely later.
      try { localStorage.setItem('diary.lastPurgeAt', String(now)); } catch { /* ignore */ }
      return 0;
    }

    const margin = TRASH_TTL_MS + 24 * 60 * 60 * 1000; // extra day so borderline entries don't vanish on slight skew
    const stored = await this.db.entries.toArray();
    const expired = stored.filter(s =>
      s.deletedAt &&
      s.deletedAt <= now &&            // never trust a future deletedAt
      (now - s.deletedAt) > margin,
    );
    for (const e of expired) await this.hardDelete(e.id);

    try { localStorage.setItem('diary.lastPurgeAt', String(now)); } catch { /* ignore */ }
    if (expired.length) this.appendPurgeLog(expired.map(e => e.id), now);
    return expired.length;
  }

  private appendPurgeLog(ids: string[], ts: number): void {
    try {
      const raw = localStorage.getItem('diary.purgeLog');
      const log: { ts: number; ids: string[] }[] = raw ? JSON.parse(raw) : [];
      log.push({ ts, ids });
      // keep last 100 events only
      const trimmed = log.slice(-100);
      localStorage.setItem('diary.purgeLog', JSON.stringify(trimmed));
    } catch { /* ignore */ }
  }

  daysUntilPurge(deletedAt: number): number {
    const elapsed = Date.now() - deletedAt;
    const remaining = TRASH_TTL_MS - elapsed;
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }

  async modifyMediaIds(id: string, fn: (ids: string[]) => string[]): Promise<void> {
    await this.db.entries.where('id').equals(id).modify(e => {
      e.mediaIds = fn(e.mediaIds ?? []);
    });
  }

  private async toStored(entry: Entry, key: CryptoKey): Promise<StoredEntry> {
    const [title, bodyHtml, bodyText] = await Promise.all([
      this.crypto.encryptString(key, entry.title),
      this.crypto.encryptString(key, entry.bodyHtml),
      this.crypto.encryptString(key, entry.bodyText),
    ]);
    return { ...entry, title, bodyHtml, bodyText };
  }

  private async toPlain(stored: StoredEntry, key: CryptoKey): Promise<Entry> {
    const [title, bodyHtml, bodyText] = await Promise.all([
      this.crypto.decryptString(key, stored.title),
      this.crypto.decryptString(key, stored.bodyHtml),
      this.crypto.decryptString(key, stored.bodyText),
    ]);
    return { ...stored, title, bodyHtml, bodyText };
  }

  static readonly TRASH_TTL_MS = TRASH_TTL_MS;
}
