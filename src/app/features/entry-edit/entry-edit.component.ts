import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MediaRecord, Tag } from '../../core/db/db.service';
import { EntryService } from '../../core/entry/entry.service';
import { MediaService } from '../../core/media/media.service';
import { TagService } from '../../core/tag/tag.service';
import { DraftService } from '../../core/draft/draft.service';
import { EditorComponent } from '../../shared/editor/editor.component';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

interface PendingMedia { file: File; previewUrl: string; type: 'image' | 'video' | 'audio'; }

@Component({
  selector: 'app-entry-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, EditorComponent, ThemeToggleComponent],
  templateUrl: './entry-edit.component.html',
  styleUrl: './entry-edit.component.scss',
})
export class EntryEditComponent implements OnInit, OnDestroy {
  isEdit = false;
  entryId: string | null = null;
  loaded = signal(false);
  saving = signal(false);
  mediaError = signal('');
  quotaWarning = signal('');

  title = '';
  date = this.todayStr();
  bodyHtml = '';
  bodyText = '';
  mood: number | null = null;
  moods = [1, 2, 3, 4, 5];
  moodEmoji = MOOD_EMOJI;

  allTags: Tag[] = [];
  selectedTagIds = new Set<string>();
  newTagName = '';
  addingTag = false;

  existingMedia: MediaRecord[] = [];
  existingThumbUrls = new Map<string, string>();
  removedMediaIds: string[] = [];
  pendingMedia: PendingMedia[] = [];
  private ownedUrls: string[] = [];

  recording = signal(false);
  recordSeconds = signal(0);
  private mediaRecorder: MediaRecorder | null = null;
  private recordStream: MediaStream | null = null;
  private recordChunks: BlobPart[] = [];
  private recordTimer: any = null;
  private readonly MAX_RECORD_SECONDS = 300;

  draftRestored = signal(false);
  private draftTimer: any = null;
  private draftSlot = 'new';

  constructor(
    private entrySvc: EntryService,
    private mediaSvc: MediaService,
    private tagSvc: TagService,
    private draftSvc: DraftService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    const [tags] = await Promise.all([this.tagSvc.listAll()]);
    this.allTags = tags;

    const dateParam = this.route.snapshot.queryParamMap.get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) this.date = dateParam;

    if (id && id !== 'new') {
      this.isEdit = true;
      this.entryId = id;
      this.draftSlot = id;
      const entry = await this.entrySvc.get(id);
      if (entry) {
        this.title = entry.title;
        this.date = entry.date;
        this.bodyHtml = entry.bodyHtml;
        this.bodyText = entry.bodyText;
        this.mood = entry.mood;
        this.selectedTagIds = new Set(entry.tagIds ?? []);
        this.existingMedia = await this.mediaSvc.getEntryMedia(id);
        for (const m of this.existingMedia) {
          try {
            const blob = await this.mediaSvc.getThumbnailBlob(m);
            const url = URL.createObjectURL(blob);
            this.ownedUrls.push(url);
            this.existingThumbUrls.set(m.id, url);
          } catch { /* skip */ }
        }
      }
    }

    // Restore draft if present and newer than the persisted entry
    const draft = await this.draftSvc.load(this.draftSlot);
    if (draft) {
      this.title = draft.title;
      this.date = draft.date;
      this.bodyHtml = draft.bodyHtml;
      this.bodyText = draft.bodyText;
      this.mood = draft.mood;
      this.selectedTagIds = new Set(draft.tagIds);
      this.draftRestored.set(true);
      setTimeout(() => this.draftRestored.set(false), 4000);
    }

    this.loaded.set(true);
    this.checkQuota();
    this.startDraftAutosave();
  }

  private startDraftAutosave() {
    this.draftTimer = setInterval(() => this.saveDraft(), 3000);
  }

  private async saveDraft() {
    if (!this.loaded() || this.saving()) return;
    await this.draftSvc.save(this.draftSlot, {
      title: this.title,
      date: this.date,
      bodyHtml: this.bodyHtml,
      bodyText: this.bodyText,
      mood: this.mood,
      tagIds: [...this.selectedTagIds],
      ts: Date.now(),
    });
  }

  ngOnDestroy() {
    this.pendingMedia.forEach(p => URL.revokeObjectURL(p.previewUrl));
    this.ownedUrls.forEach(u => URL.revokeObjectURL(u));
    if (this.draftTimer) clearInterval(this.draftTimer);
    this.cleanupRecording();
  }

  async startRecording() {
    if (this.recording()) return;
    this.mediaError.set('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordStream = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      this.mediaRecorder = recorder;
      this.recordChunks = [];
      this.recordSeconds.set(0);

      recorder.ondataavailable = e => { if (e.data.size > 0) this.recordChunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(this.recordChunks, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type });
        const previewUrl = URL.createObjectURL(blob);
        this.pendingMedia = [...this.pendingMedia, { file, previewUrl, type: 'audio' }];
        this.cleanupRecording();
      };

      recorder.start();
      this.recording.set(true);
      this.recordTimer = setInterval(() => {
        const next = this.recordSeconds() + 1;
        this.recordSeconds.set(next);
        if (next >= this.MAX_RECORD_SECONDS) this.stopRecording();
      }, 1000);
    } catch {
      this.mediaError.set('Mic access denied or unavailable.');
      this.cleanupRecording();
    }
  }

  stopRecording() {
    if (!this.recording() || !this.mediaRecorder) return;
    this.recording.set(false);
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = null; }
    try { this.mediaRecorder.stop(); } catch { /* already stopped */ }
  }

  recordTimeStr(): string {
    const s = this.recordSeconds();
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  private cleanupRecording() {
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = null; }
    this.recordStream?.getTracks().forEach(t => t.stop());
    this.recordStream = null;
    this.mediaRecorder = null;
    this.recording.set(false);
  }

  todayStr(): string { return new Date().toISOString().slice(0, 10); }
  onHtmlChange(html: string) { this.bodyHtml = html; }
  onTextChange(text: string) { this.bodyText = text; }
  setMood(m: number) { this.mood = this.mood === m ? null : m; }
  thumbFor(id: string): string { return this.existingThumbUrls.get(id) ?? ''; }
  isTagSelected(id: string): boolean { return this.selectedTagIds.has(id); }

  toggleTag(id: string) {
    if (this.selectedTagIds.has(id)) this.selectedTagIds.delete(id);
    else this.selectedTagIds.add(id);
  }

  async createTag() {
    const name = this.newTagName.trim();
    if (!name) return;
    const tag = await this.tagSvc.create(name);
    this.allTags = [...this.allTags, tag].sort((a, b) => a.name.localeCompare(b.name));
    this.selectedTagIds.add(tag.id);
    this.newTagName = '';
    this.addingTag = false;
  }

  async onFilePick(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.mediaError.set('');
    for (const file of files) await this.addPending(file);
  }

  private async addPending(file: File) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    if (!isImage && !isVideo && !isAudio) { this.mediaError.set('Only images, videos, audio supported.'); return; }
    if (isVideo && file.size > 50 * 1024 * 1024) { this.mediaError.set('Video must be under 50 MB.'); return; }
    if (isAudio && file.size > 20 * 1024 * 1024) { this.mediaError.set('Audio must be under 20 MB.'); return; }
    const previewUrl = URL.createObjectURL(file);
    const type: PendingMedia['type'] = isImage ? 'image' : isVideo ? 'video' : 'audio';
    this.pendingMedia = [...this.pendingMedia, { file, previewUrl, type }];
  }

  removePending(i: number) {
    URL.revokeObjectURL(this.pendingMedia[i].previewUrl);
    this.pendingMedia = this.pendingMedia.filter((_, idx) => idx !== i);
  }

  removeExisting(id: string) {
    this.removedMediaIds.push(id);
    this.existingMedia = this.existingMedia.filter(m => m.id !== id);
  }

  async save() {
    this.saving.set(true);
    this.mediaError.set('');
    const now = Date.now();
    const tagIds = [...this.selectedTagIds];
    let entryId = this.entryId;
    try {
      if (this.isEdit && entryId) {
        await this.entrySvc.update(entryId, {
          title: this.title, date: this.date,
          bodyHtml: this.bodyHtml, bodyText: this.bodyText,
          mood: this.mood, tagIds, updatedAt: now,
        });
      } else {
        entryId = await this.entrySvc.add({
          title: this.title, date: this.date,
          bodyHtml: this.bodyHtml, bodyText: this.bodyText,
          mood: this.mood, tagIds, mediaIds: [],
          createdAt: now, updatedAt: now,
        });
      }
      for (const mid of this.removedMediaIds) {
        const rec = await this.mediaSvc.getEntryMedia(entryId!).then(ms => ms.find(m => m.id === mid));
        if (rec) await this.mediaSvc.deleteMedia(rec, entryId!);
      }
      for (const p of this.pendingMedia) {
        try { await this.mediaSvc.addMedia(entryId!, p.file); }
        catch (e: any) { this.mediaError.set(e.message ?? 'Failed to save media.'); }
      }
      this.draftSvc.clear(this.draftSlot);
      if (this.draftSlot === 'new' && entryId) this.draftSvc.clear(entryId);
      this.router.navigate(['/entry', entryId]);
    } catch {
      this.saving.set(false);
    }
  }

  async deleteEntry() {
    if (!this.entryId) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    const media = await this.mediaSvc.getEntryMedia(this.entryId);
    for (const m of media) await this.mediaSvc.deleteMedia(m, this.entryId);
    await this.entrySvc.delete(this.entryId);
    this.draftSvc.clear(this.entryId);
    this.router.navigate(['/timeline']);
  }

  cancel() {
    if (this.isEdit && this.entryId) this.router.navigate(['/entry', this.entryId]);
    else this.router.navigate(['/timeline']);
  }

  private async checkQuota() {
    const q = await this.mediaSvc.checkQuota();
    if (q && q.pct >= 80) this.quotaWarning.set(`Storage ${q.pct}% full (${q.usedMb}/${q.totalMb} MB). Back up soon.`);
  }
}
