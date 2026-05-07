import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

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
  thumbnailBlob: Blob;
  createdAt: number;
}

@Injectable({ providedIn: 'root' })
export class DbService extends Dexie {
  entries!: Table<Entry, string>;
  tags!: Table<Tag, string>;
  media!: Table<MediaRecord, string>;

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
    }).upgrade(tx => {
      return tx.table('entries').toCollection().modify(entry => {
        if (!entry.mediaIds) entry.mediaIds = [];
      });
    });
  }
}
