import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  bodyHtml: string;
  bodyText: string;
  mood: number | null;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class DbService extends Dexie {
  entries!: Table<Entry, string>;
  tags!: Table<Tag, string>;

  constructor() {
    super('diary');
    this.version(1).stores({
      entries: 'id, date, createdAt, updatedAt',
      tags: 'id, name',
    });
  }
}
