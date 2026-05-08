import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Entry } from '../../core/db/db.service';
import { EntryService } from '../../core/entry/entry.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

@Component({
  selector: 'app-trash',
  standalone: true,
  imports: [CommonModule, ThemeToggleComponent],
  templateUrl: './trash.component.html',
  styleUrl: './trash.component.scss',
})
export class TrashComponent implements OnInit {
  entries = signal<Entry[]>([]);
  loading = signal(true);

  constructor(private entrySvc: EntryService, private router: Router) {}

  async ngOnInit() {
    await this.refresh();
    this.loading.set(false);
  }

  private async refresh() {
    this.entries.set(await this.entrySvc.listDeleted());
  }

  async restore(id: string) {
    await this.entrySvc.restore(id);
    await this.refresh();
  }

  async deleteForever(id: string) {
    if (!confirm('Permanently delete this entry and its media? This cannot be undone.')) return;
    await this.entrySvc.hardDelete(id);
    await this.refresh();
  }

  async emptyTrash() {
    const list = this.entries();
    if (!list.length) return;
    if (!confirm(`Permanently delete all ${list.length} entries? This cannot be undone.`)) return;
    for (const e of list) await this.entrySvc.hardDelete(e.id);
    await this.refresh();
  }

  daysLeft(e: Entry): number {
    return e.deletedAt ? this.entrySvc.daysUntilPurge(e.deletedAt) : 0;
  }

  moodEmoji(mood: number | null): string { return mood ? MOOD_EMOJI[mood] ?? '' : ''; }
  back() { this.router.navigate(['/settings']); }
}
