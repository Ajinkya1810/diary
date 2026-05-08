import { Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Entry, Tag } from '../../core/db/db.service';
import { EntryService } from '../../core/entry/entry.service';
import { MediaService } from '../../core/media/media.service';
import { SearchService } from '../../core/search/search.service';
import { TagService } from '../../core/tag/tag.service';
import { StorageService } from '../../core/storage/storage.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

interface MonthGroup { label: string; entries: Entry[]; }
interface CalendarCell { date: string; day: number; inMonth: boolean; isToday: boolean; entry?: Entry; }
const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
const VIEW_MODE_KEY = 'diary.viewMode';

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule, ThemeToggleComponent],
  templateUrl: './timeline.component.html',
  styleUrl: './timeline.component.scss',
})
export class TimelineComponent implements OnInit, OnDestroy {
  groups = signal<MonthGroup[]>([]);
  searchResults = signal<Entry[] | null>(null);
  loading = signal(true);
  thumbUrls = signal<Map<string, string[]>>(new Map());
  tagMap = signal<Map<string, Tag>>(new Map());
  filterTagId = signal<string | null>(null);
  onThisDay = signal<Entry[]>([]);
  searchQuery = '';
  viewMode = signal<'timeline' | 'calendar'>(
    (localStorage.getItem(VIEW_MODE_KEY) as 'timeline' | 'calendar') ?? 'timeline'
  );
  calendarYM = signal<{ year: number; month: number }>(this.currentYM());
  entriesByDate = signal<Map<string, Entry>>(new Map());
  private allEntries: Entry[] = [];
  private objectUrls: string[] = [];
  private searchTimer: any = null;

  constructor(
    private entrySvc: EntryService,
    private mediaSvc: MediaService,
    private searchSvc: SearchService,
    private tagSvc: TagService,
    public storage: StorageService,
    private router: Router,
  ) {}

  showPersistBanner(): boolean { return this.storage.shouldShowPersistBanner(); }
  dismissPersistBanner(): void { this.storage.dismissPersistBanner(); }

  async ngOnInit() {
    await this.entrySvc.purgeExpired().catch(() => 0);
    this.maybeReapOrphans();
    const [all, tags] = await Promise.all([this.entrySvc.listAll(), this.tagSvc.listAll()]);
    this.allEntries = all;
    this.tagMap.set(new Map(tags.map(t => [t.id, t])));
    // P3: persist tokens incrementally; only entries with changed updatedAt get re-tokenized.
    this.searchSvc.ensureIndex(all).catch(() => { /* ignore */ });
    this.applyFilter();
    this.entriesByDate.set(new Map(all.map(e => [e.date, e])));
    this.computeOnThisDay(all);
    this.loading.set(false);
    await this.loadThumbnails(all);
  }

  private computeOnThisDay(all: Entry[]) {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = today.getFullYear();
    const matches = all.filter(e => {
      const [y, m, d] = e.date.split('-');
      return m === mm && d === dd && +y < yyyy;
    });
    this.onThisDay.set(matches);
  }

  yearsAgo(date: string): string {
    const y = +date.split('-')[0];
    const diff = new Date().getFullYear() - y;
    if (diff <= 0) return '';
    return diff === 1 ? '1 year ago' : `${diff} years ago`;
  }

  private applyFilter() {
    const tagId = this.filterTagId();
    const list = tagId
      ? this.allEntries.filter(e => (e.tagIds ?? []).includes(tagId))
      : this.allEntries;
    this.groups.set(this.groupByMonth(list));
  }

  toggleTagFilter(tagId: string) {
    this.filterTagId.set(this.filterTagId() === tagId ? null : tagId);
    this.applyFilter();
  }

  clearTagFilter() {
    this.filterTagId.set(null);
    this.applyFilter();
  }

  filterTagName(): string {
    const id = this.filterTagId();
    return id ? (this.tagMap().get(id)?.name ?? '') : '';
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

  private async applySearch() {
    const q = this.searchQuery.trim();
    if (!q) { this.searchResults.set(null); return; }
    const ids = await this.searchSvc.search(q);
    if (!ids) { this.searchResults.set([]); return; }
    this.searchResults.set(this.allEntries.filter(e => ids.has(e.id)));
  }

  private async loadThumbnails(entries: Entry[]) {
    // P2: fan-out per entry to a fixed concurrency pool. Update the signal as
    // each entry's thumbnails arrive so the UI fills in progressively.
    const map = new Map<string, string[]>();
    const queue: Entry[] = entries.filter(e => e.mediaIds?.length);
    const POOL = 6;

    const runOne = async (entry: Entry) => {
      try {
        const records = (await this.mediaSvc.getEntryMedia(entry.id)).slice(0, 3);
        const blobs = await Promise.all(records.map(r =>
          this.mediaSvc.getThumbnailBlob(r).catch(() => null),
        ));
        const urls = blobs.filter((b): b is Blob => !!b).map(b => {
          const url = URL.createObjectURL(b);
          this.objectUrls.push(url);
          return url;
        });
        if (urls.length) {
          map.set(entry.id, urls);
          // emit incremental update so timeline rerenders without waiting for the rest
          this.thumbUrls.set(new Map(map));
        }
      } catch { /* ignore */ }
    };

    // Round-robin pool
    let idx = 0;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < POOL; i++) {
      workers.push((async () => {
        while (idx < queue.length) {
          const entry = queue[idx++];
          await runOne(entry);
        }
      })());
    }
    await Promise.all(workers);
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

  // ---------- Calendar view ----------

  toggleView() {
    this.setView(this.viewMode() === 'timeline' ? 'calendar' : 'timeline');
  }

  setView(v: 'timeline' | 'calendar') {
    this.viewMode.set(v);
    localStorage.setItem(VIEW_MODE_KEY, v);
  }

  calendarLabel(): string {
    const { year, month } = this.calendarYM();
    return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  prevMonth() {
    const { year, month } = this.calendarYM();
    const d = new Date(year, month - 1, 1);
    this.calendarYM.set({ year: d.getFullYear(), month: d.getMonth() });
  }

  nextMonth() {
    const { year, month } = this.calendarYM();
    const d = new Date(year, month + 1, 1);
    this.calendarYM.set({ year: d.getFullYear(), month: d.getMonth() });
  }

  todayMonth() { this.calendarYM.set(this.currentYM()); }

  // P6: computed so it only recalculates when calendarYM or entriesByDate change.
  calendarCells = computed<CalendarCell[]>(() => {
    const { year, month } = this.calendarYM();
    const first = new Date(year, month, 1);
    const startDay = first.getDay(); // 0=Sun
    const lastDate = new Date(year, month + 1, 0).getDate();
    const todayStr = this.todayStr();
    const map = this.entriesByDate();

    const cells: CalendarCell[] = [];
    // leading blanks (prev month tail)
    const prevLast = new Date(year, month, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
      const day = prevLast - i;
      const d = new Date(year, month - 1, day);
      const dateStr = this.formatDate(d);
      cells.push({ date: dateStr, day, inMonth: false, isToday: false, entry: map.get(dateStr) });
    }
    // current month
    for (let day = 1; day <= lastDate; day++) {
      const d = new Date(year, month, day);
      const dateStr = this.formatDate(d);
      cells.push({ date: dateStr, day, inMonth: true, isToday: dateStr === todayStr, entry: map.get(dateStr) });
    }
    // trailing blanks to fill 6 rows × 7 cols = 42
    while (cells.length < 42) {
      const lastCell = cells[cells.length - 1];
      const d = new Date(lastCell.date + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      const dateStr = this.formatDate(d);
      cells.push({ date: dateStr, day: d.getDate(), inMonth: false, isToday: false, entry: map.get(dateStr) });
    }
    return cells;
  });

  onDayTap(cell: CalendarCell) {
    if (cell.entry) this.router.navigate(['/entry', cell.entry.id]);
    else this.router.navigate(['/entry', 'new'], { queryParams: { date: cell.date } });
  }

  private currentYM() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  private maybeReapOrphans() {
    const last = +(localStorage.getItem('diary.lastOrphanReap') ?? 0);
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    this.mediaSvc.reapOrphans()
      .then(() => localStorage.setItem('diary.lastOrphanReap', String(Date.now())))
      .catch(() => { /* ignore */ });
  }

  private todayStr(): string { return this.formatDate(new Date()); }

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
