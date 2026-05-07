import { Injectable } from '@angular/core';
import { DbService, Entry, StoredEntry } from '../db/db.service';
import { VaultService } from '../vault/vault.service';
import { CryptoService } from '../crypto/crypto.service';

@Injectable({ providedIn: 'root' })
export class EntryService {
  constructor(
    private db: DbService,
    private vault: VaultService,
    private crypto: CryptoService,
  ) {}

  async listAll(): Promise<Entry[]> {
    const key = this.vault.requireKey();
    const stored = await this.db.entries.orderBy('date').reverse().toArray();
    return Promise.all(stored.map(s => this.toPlain(s, key)));
  }

  async get(id: string): Promise<Entry | null> {
    const key = this.vault.requireKey();
    const stored = await this.db.entries.get(id);
    if (!stored) return null;
    return this.toPlain(stored, key);
  }

  async add(entry: Omit<Entry, 'id'>): Promise<string> {
    const key = this.vault.requireKey();
    const id = crypto.randomUUID();
    const stored = await this.toStored({ id, ...entry } as Entry, key);
    await this.db.entries.add(stored);
    return id;
  }

  async update(id: string, partial: Partial<Pick<Entry, 'title' | 'bodyHtml' | 'bodyText' | 'date' | 'mood' | 'updatedAt'>>): Promise<void> {
    const key = this.vault.requireKey();
    const updates: Record<string, unknown> = {};
    if (partial.date !== undefined) updates['date'] = partial.date;
    if (partial.mood !== undefined) updates['mood'] = partial.mood;
    if (partial.updatedAt !== undefined) updates['updatedAt'] = partial.updatedAt;
    if (partial.title !== undefined) updates['title'] = await this.crypto.encryptString(key, partial.title);
    if (partial.bodyHtml !== undefined) updates['bodyHtml'] = await this.crypto.encryptString(key, partial.bodyHtml);
    if (partial.bodyText !== undefined) updates['bodyText'] = await this.crypto.encryptString(key, partial.bodyText);
    await this.db.entries.update(id, updates as any);
  }

  async delete(id: string): Promise<void> {
    await this.db.entries.delete(id);
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
}
