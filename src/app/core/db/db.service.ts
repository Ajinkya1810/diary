import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { EncryptedField } from '../crypto/crypto.service';

// Plaintext shape — used throughout the UI
export interface Entry {
  id: string;
  date: string;
  title: string;
  bodyHtml: string;
  bodyText: string;
  mood: number | null;
  tagIds: string[];
  mediaIds: string[];
  createdAt: number;
  updatedAt: number;
}

// On-disk shape — encrypted text fields
export interface StoredEntry extends Omit<Entry, 'title' | 'bodyHtml' | 'bodyText'> {
  title: EncryptedField;
  bodyHtml: EncryptedField;
  bodyText: EncryptedField;
}

export interface Tag {
  id: string;
  name: string;
}

export interface MediaRecord {
  id: string;
  entryId: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  opfsPath: string;
  thumbnailData: EncryptedField;
  createdAt: number;
}

export interface VaultMeta {
  id: 'singleton';
  salt: Uint8Array;
  verifierIv: Uint8Array;
  verifierCt: Uint8Array;
}

@Injectable({ providedIn: 'root' })
export class DbService extends Dexie {
  entries!: Table<StoredEntry, string>;
  tags!: Table<Tag, string>;
  media!: Table<MediaRecord, string>;
  vaultMeta!: Table<VaultMeta, string>;

  constructor() {
    super('diary');
    this.version(1).stores({
      entries: 'id, date, createdAt, updatedAt',
      tags: 'id, name',
    });
    this.version(2).stores({
      entries: 'id, date, createdAt, updatedAt',
      tags: 'id, name',
      media: 'id, entryId, createdAt',
    });
    this.version(3).stores({
      entries: 'id, date, createdAt, updatedAt',
      tags: 'id, name',
      media: 'id, entryId, createdAt',
      vaultMeta: 'id',
    }).upgrade(tx =>
      // Wipe plaintext data — incompatible with encrypted schema
      Promise.all([tx.table('entries').clear(), tx.table('media').clear()])
    );
  }
}
