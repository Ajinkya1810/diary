import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Entry, MediaRecord, Tag } from '../../core/db/db.service';
import { EntryService } from '../../core/entry/entry.service';
import { MediaService } from '../../core/media/media.service';
import { TagService } from '../../core/tag/tag.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
interface LoadedMedia { record: MediaRecord; url: string; thumbUrl?: string; }

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
  tags = signal<Tag[]>([]);
  lightboxUrl = signal<string | null>(null);
  private objectUrls: string[] = [];

  constructor(
    private entrySvc: EntryService,
    private mediaSvc: MediaService,
    private tagSvc: TagService,
    private router: Router,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
  ) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    const entry = await this.entrySvc.get(id);
    if (entry) {
      this.entry.set(entry);
      this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(entry.bodyHtml));
      const [, tags] = await Promise.all([
        this.loadMedia(id),
        this.tagSvc.getByIds(entry.tagIds ?? []),
      ]);
      this.tags.set(tags);
    }
  }

  ngOnDestroy() { this.objectUrls.forEach(u => URL.revokeObjectURL(u)); }

  private async loadMedia(entryId: string) {
    const records = await this.mediaSvc.getEntryMedia(entryId);
    const loaded: LoadedMedia[] = [];
    for (const record of records) {
      try {
        const blob = await this.mediaSvc.getMediaBlob(record);
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        let thumbUrl: string | undefined;
        if (record.type === 'video') {
          const thumbBlob = await this.mediaSvc.getThumbnailBlob(record);
          thumbUrl = URL.createObjectURL(thumbBlob);
          this.objectUrls.push(thumbUrl);
        }
        loaded.push({ record, url, thumbUrl });
      } catch { /* skip missing */ }
    }
    this.media.set(loaded);
  }

  timeAgo(ms: number): string {
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  openLightbox(url: string) { this.lightboxUrl.set(url); }
  closeLightbox() { this.lightboxUrl.set(null); }
  moodEmoji(mood: number | null): string { return mood ? MOOD_EMOJI[mood] ?? '' : ''; }
  edit() { this.router.navigate(['/entry', this.entry()!.id, 'edit']); }
  back() { this.router.navigate(['/timeline']); }
}
