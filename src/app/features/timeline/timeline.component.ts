import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Entry, Tag } from '../../core/db/db.service';
import { EntryService } from '../../core/entry/entry.service';
import { MediaService } from '../../core/media/media.service';
import { SearchService } from '../../core/search/search.service';
import { TagService } from '../../core/tag/tag.service';

interface MonthGroup { label: string; entries: Entry[]; }
const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline.component.html',
  styleUrl: './timeline.component.scss',
})
export class TimelineComponent implements OnInit, OnDestroy {
  groups = signal<MonthGroup[]>([]);
  searchResults = signal<Entry[] | null>(null);
  loading = signal(true);
  thumbUrls = signal<Map<string, string[]>>(new Map());
  tagMap = signal<Map<string, Tag>>(new Map());
  searchQuery = '';
  private allEntries: Entry[] = [];
  private objectUrls: string[] = [];
  private searchTimer: any = null;

  constructor(
    private entrySvc: EntryService,
    private mediaSvc: MediaService,
    private searchSvc: SearchService,
    private tagSvc: TagService,
    private router: Router,
  ) {}

  async ngOnInit() {
    const [all, tags] = await Promise.all([this.entrySvc.listAll(), this.tagSvc.listAll()]);
    this.allEntries = all;
    this.tagMap.set(new Map(tags.map(t => [t.id, t])));
    this.searchSvc.buildIndex(all);
    this.groups.set(this.groupByMonth(all));
    this.loading.set(false);
    await this.loadThumbnails(all);
  }

  ngOnDestroy() {
    this.objectUrls.forEach(u => URL.revokeObjectURL(u));
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  onSearchInput() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applySearch(), 200);
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults.set(null);
  }

  private applySearch() {
    const q = this.searchQuery.trim();
    if (!q) { this.searchResults.set(null); return; }
    const ids = this.searchSvc.search(q);
    if (!ids) { this.searchResults.set([]); return; }
    this.searchResults.set(this.allEntries.filter(e => ids.has(e.id)));
  }

  private async loadThumbnails(entries: Entry[]) {
    const map = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.mediaIds?.length) continue;
      const records = await this.mediaSvc.getEntryMedia(entry.id);
      const urls: string[] = [];
      for (const r of records.slice(0, 3)) {
        try {
          const blob = await this.mediaSvc.getThumbnailBlob(r);
          const url = URL.createObjectURL(blob);
          this.objectUrls.push(url);
          urls.push(url);
        } catch { /* skip */ }
      }
      if (urls.length) map.set(entry.id, urls);
    }
    this.thumbUrls.set(map);
  }

  private groupByMonth(entries: Entry[]): MonthGroup[] {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const [year, month] = e.date.split('-');
      const label = new Date(+year, +month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(e);
    }
    return Array.from(map.entries()).map(([label, entries]) => ({ label, entries }));
  }

  tagsFor(entry: Entry): Tag[] {
    const map = this.tagMap();
    return (entry.tagIds ?? []).map(id => map.get(id)).filter(Boolean) as Tag[];
  }

  thumbsFor(id: string): string[] { return this.thumbUrls().get(id) ?? []; }
  moodEmoji(mood: number | null): string { return mood ? MOOD_EMOJI[mood] ?? '' : ''; }
  preview(text: string): string { return text.slice(0, 100); }
  dayNum(date: string): string { return String(new Date(date + 'T12:00:00').getDate()).padStart(2, '0'); }
  dayName(date: string): string { return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }); }
  openEntry(id: string) { this.router.navigate(['/entry', id]); }
  newEntry() { this.router.navigate(['/entry', 'new']); }
  settings() { this.router.navigate(['/settings']); }
}
