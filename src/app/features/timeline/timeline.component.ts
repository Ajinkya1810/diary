import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { DbService, Entry } from '../../core/db/db.service';
import { MediaService } from '../../core/media/media.service';

interface MonthGroup {
  label: string;
  entries: Entry[];
}

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './timeline.component.html',
  styleUrl: './timeline.component.scss',
})
export class TimelineComponent implements OnInit, OnDestroy {
  groups = signal<MonthGroup[]>([]);
  loading = signal(true);
  thumbUrls = signal<Map<string, string[]>>(new Map());

  private objectUrls: string[] = [];

  constructor(private db: DbService, private mediaSvc: MediaService, private router: Router) {}

  async ngOnInit() {
    const all = await this.db.entries.orderBy('date').reverse().toArray();
    this.groups.set(this.groupByMonth(all));
    this.loading.set(false);
    await this.loadThumbnails(all);
  }

  ngOnDestroy() {
    this.objectUrls.forEach(u => URL.revokeObjectURL(u));
  }

  private async loadThumbnails(entries: Entry[]) {
    const map = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.mediaIds?.length) continue;
      const records = await this.mediaSvc.getEntryMedia(entry.id);
      const urls: string[] = [];
      for (const r of records.slice(0, 3)) {
        const url = URL.createObjectURL(r.thumbnailBlob);
        this.objectUrls.push(url);
        urls.push(url);
      }
      if (urls.length) map.set(entry.id, urls);
    }
    this.thumbUrls.set(map);
  }

  private groupByMonth(entries: Entry[]): MonthGroup[] {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const [year, month] = e.date.split('-');
      const label = new Date(+year, +month - 1, 1).toLocaleDateString('en-US', {
        month: 'long', year: 'numeric',
      });
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(e);
    }
    return Array.from(map.entries()).map(([label, entries]) => ({ label, entries }));
  }

  thumbsFor(entryId: string): string[] {
    return this.thumbUrls().get(entryId) ?? [];
  }

  moodEmoji(mood: number | null): string {
    return mood ? MOOD_EMOJI[mood] ?? '' : '';
  }

  preview(text: string): string {
    return text.slice(0, 120);
  }

  dayNum(date: string): string {
    return String(new Date(date + 'T12:00:00').getDate()).padStart(2, '0');
  }

  dayName(date: string): string {
    return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  }

  openEntry(id: string) { this.router.navigate(['/entry', id]); }
  newEntry() { this.router.navigate(['/entry', 'new']); }
}
