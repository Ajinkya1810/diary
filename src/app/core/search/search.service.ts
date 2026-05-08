import { Injectable } from '@angular/core';
import { DbService, Entry } from '../db/db.service';

@Injectable({ providedIn: 'root' })
export class SearchService {
  // P3: search now backed by Dexie's `searchTokens` multi-entry index
  // (`*tokens`). The in-memory index is only used as a transient
  // backwards-compat path for callers that still call buildIndex.
  private memoryIndex = new Map<string, Set<string>>();
  private memoryHasData = false;

  constructor(private db: DbService) {}

  /**
   * Idempotent: ensures the persistent searchTokens table is in sync with
   * current entries. Cheap to call on every timeline load.
   */
  async ensureIndex(entries: Entry[]): Promise<void> {
    const existing = new Map<string, string[]>(
      (await this.db.searchTokens.toArray()).map(r => [r.entryId, r.tokens]),
    );
    const tasks: Promise<unknown>[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.id);
      const tokens = this.tokenize(`${entry.title} ${entry.bodyText}`);
      const prev = existing.get(entry.id);
      if (!prev || !this.tokenSetsEqual(prev, tokens)) {
        tasks.push(this.db.searchTokens.put({ entryId: entry.id, tokens }));
      }
    }
    // Drop tokens for entries that no longer exist
    for (const id of existing.keys()) {
      if (!seen.has(id)) tasks.push(this.db.searchTokens.delete(id));
    }
    if (tasks.length) await Promise.all(tasks);
    this.memoryHasData = false; // future searches will use IDB
  }

  /** Backwards-compat in-memory build. Newer paths should call ensureIndex. */
  buildIndex(entries: Entry[]): void {
    this.memoryIndex.clear();
    for (const entry of entries) this.indexInMemory(entry);
    this.memoryHasData = true;
  }

  async updateEntry(entry: Entry): Promise<void> {
    const tokens = this.tokenize(`${entry.title} ${entry.bodyText}`);
    await this.db.searchTokens.put({ entryId: entry.id, tokens });
  }

  async removeEntry(id: string): Promise<void> {
    await this.db.searchTokens.delete(id);
  }

  /**
   * Async prefix-AND search via IDB. Returns null when the query is empty.
   */
  async search(query: string): Promise<Set<string> | null> {
    const tokens = this.tokenize(query);
    if (!tokens.length) return null;

    // For each query token: collect entry ids whose stored tokens start with it.
    let result: Set<string> | null = null;
    for (const t of tokens) {
      const matches = new Set<string>();
      // Dexie supports startsWith on multi-entry indexed primitive arrays.
      await this.db.searchTokens
        .where('tokens').startsWith(t)
        .each(row => matches.add(row.entryId));
      result = result === null ? matches : new Set([...result].filter(id => matches.has(id)));
      if (!result.size) return result;
    }
    return result;
  }

  /** Sync prefix-AND search against in-memory index. Used by code not yet migrated to async. */
  searchSync(query: string): Set<string> | null {
    if (!this.memoryHasData) return new Set(); // empty until ensureIndex/buildIndex is called
    const tokens = this.tokenize(query);
    if (!tokens.length) return null;
    let result: Set<string> | null = null;
    for (const token of tokens) {
      const matches = new Set<string>();
      for (const [key, ids] of this.memoryIndex) {
        if (key.startsWith(token)) ids.forEach(id => matches.add(id));
      }
      result = result === null ? matches : new Set([...result].filter(id => matches.has(id)));
    }
    return result;
  }

  tokenize(text: string): string[] {
    return [...new Set(
      text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2 && t.length <= 50)
    )];
  }

  private indexInMemory(entry: Entry): void {
    const tokens = this.tokenize(`${entry.title} ${entry.bodyText}`);
    for (const token of tokens) {
      if (!this.memoryIndex.has(token)) this.memoryIndex.set(token, new Set());
      this.memoryIndex.get(token)!.add(entry.id);
    }
  }

  private tokenSetsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    for (const t of b) if (!sa.has(t)) return false;
    return true;
  }
}
