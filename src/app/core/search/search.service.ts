import { Injectable } from '@angular/core';
import { Entry } from '../db/db.service';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private index = new Map<string, Set<string>>();

  buildIndex(entries: Entry[]): void {
    this.index.clear();
    for (const entry of entries) this.indexEntry(entry);
  }

  updateEntry(entry: Entry): void {
    this.removeEntry(entry.id);
    this.indexEntry(entry);
  }

  removeEntry(id: string): void {
    for (const ids of this.index.values()) ids.delete(id);
  }

  search(query: string): Set<string> | null {
    const tokens = this.tokenize(query);
    if (!tokens.length) return null;
    let result: Set<string> | null = null;
    for (const token of tokens) {
      // prefix match
      const matches = new Set<string>();
      for (const [key, ids] of this.index) {
        if (key.startsWith(token)) ids.forEach(id => matches.add(id));
      }
      if (result === null) { result = matches; }
      else { result = new Set<string>([...result].filter((id: string) => matches.has(id))); }
    }
    return result;
  }

  private indexEntry(entry: Entry): void {
    const tokens = this.tokenize(`${entry.title} ${entry.bodyText}`);
    for (const token of tokens) {
      if (!this.index.has(token)) this.index.set(token, new Set());
      this.index.get(token)!.add(entry.id);
    }
  }

  tokenize(text: string): string[] {
    return [...new Set(
      text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2 && t.length <= 50)
    )];
  }
}
