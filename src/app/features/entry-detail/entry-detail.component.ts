import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { DbService, Entry, MediaRecord } from '../../core/db/db.service';
import { MediaService } from '../../core/media/media.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

interface LoadedMedia {
  record: MediaRecord;
  url: string;
}

@Component({
  selector: 'app-entry-detail',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './entry-detail.component.html',
  styleUrl: './entry-detail.component.scss',
})
export class EntryDetailComponent implements OnInit, OnDestroy {
  entry = signal<Entry | null>(null);
  safeHtml = signal<SafeHtml>('');
  media = signal<LoadedMedia[]>([]);
  lightboxUrl = signal<string | null>(null);

  private objectUrls: string[] = [];

  constructor(
    private db: DbService,
    private mediaSvc: MediaService,
    private router: Router,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
  ) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    const entry = await this.db.entries.get(id);
    if (entry) {
      this.entry.set(entry);
      this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(entry.bodyHtml));
      await this.loadMedia(id);
    }
  }

  ngOnDestroy() {
    this.objectUrls.forEach(u => URL.revokeObjectURL(u));
  }

  private async loadMedia(entryId: string) {
    const records = await this.mediaSvc.getEntryMedia(entryId);
    const loaded: LoadedMedia[] = [];
    for (const record of records) {
      try {
        const blob = await this.mediaSvc.getMediaBlob(record);
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        loaded.push({ record, url });
      } catch { /* skip missing blobs */ }
    }
    this.media.set(loaded);
  }

  openLightbox(url: string) { this.lightboxUrl.set(url); }
  closeLightbox() { this.lightboxUrl.set(null); }

  moodEmoji(mood: number | null): string {
    return mood ? MOOD_EMOJI[mood] ?? '' : '';
  }

  edit() { this.router.navigate(['/entry', this.entry()!.id, 'edit']); }
  back() { this.router.navigate(['/timeline']); }
}
