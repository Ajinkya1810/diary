import { Injectable } from '@angular/core';
import { DbService, Tag } from '../db/db.service';

@Injectable({ providedIn: 'root' })
export class TagService {
  constructor(private db: DbService) {}

  listAll(): Promise<Tag[]> {
    return this.db.tags.orderBy('name').toArray();
  }

  async create(name: string): Promise<Tag> {
    const tag: Tag = { id: crypto.randomUUID(), name: name.trim() };
    await this.db.tags.add(tag);
    return tag;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.db.tags.update(id, { name: name.trim() });
  }

  async delete(id: string): Promise<void> {
    await this.db.entries.toCollection().modify((e: any) => {
      if (Array.isArray(e.tagIds) && e.tagIds.includes(id)) {
        e.tagIds = e.tagIds.filter((t: string) => t !== id);
      }
    });
    await this.db.tags.delete(id);
  }

  getByIds(ids: string[]): Promise<Tag[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.db.tags.where('id').anyOf(ids).toArray();
  }
}
