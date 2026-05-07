import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { DbService, Entry } from '../../core/db/db.service';
import { EditorComponent } from '../../shared/editor/editor.component';

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

@Component({
  selector: 'app-entry-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, EditorComponent],
  templateUrl: './entry-edit.component.html',
  styleUrl: './entry-edit.component.scss',
})
export class EntryEditComponent implements OnInit {
  isEdit = false;
  entryId: string | null = null;
  saving = signal(false);

  title = '';
  date = this.todayStr();
  bodyHtml = '';
  bodyText = '';
  mood: number | null = null;
  moods = [1, 2, 3, 4, 5];
  moodEmoji = MOOD_EMOJI;

  constructor(private db: DbService, private router: Router, private route: ActivatedRoute) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isEdit = true;
      this.entryId = id;
      const entry = await this.db.entries.get(id);
      if (entry) {
        this.title = entry.title;
        this.date = entry.date;
        this.bodyHtml = entry.bodyHtml;
        this.bodyText = entry.bodyText;
        this.mood = entry.mood;
      }
    }
  }

  todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  onHtmlChange(html: string) { this.bodyHtml = html; }
  onTextChange(text: string) { this.bodyText = text; }
  setMood(m: number) { this.mood = this.mood === m ? null : m; }

  async save() {
    this.saving.set(true);
    const now = Date.now();
    if (this.isEdit && this.entryId) {
      await this.db.entries.update(this.entryId, {
        title: this.title,
        date: this.date,
        bodyHtml: this.bodyHtml,
        bodyText: this.bodyText,
        mood: this.mood,
        updatedAt: now,
      });
      this.router.navigate(['/entry', this.entryId]);
    } else {
      const id = crypto.randomUUID();
      await this.db.entries.add({
        id,
        title: this.title,
        date: this.date,
        bodyHtml: this.bodyHtml,
        bodyText: this.bodyText,
        mood: this.mood,
        tagIds: [],
        createdAt: now,
        updatedAt: now,
      });
      this.router.navigate(['/entry', id]);
    }
  }

  async deleteEntry() {
    if (!this.entryId) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    await this.db.entries.delete(this.entryId);
    this.router.navigate(['/timeline']);
  }

  cancel() {
    if (this.isEdit && this.entryId) {
      this.router.navigate(['/entry', this.entryId]);
    } else {
      this.router.navigate(['/timeline']);
    }
  }
}
