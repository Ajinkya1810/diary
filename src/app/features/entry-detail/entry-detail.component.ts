import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { DbService, Entry } from '../../core/db/db.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const MOOD_EMOJI: Record<number, string> = { 1: '😞', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

@Component({
  selector: 'app-entry-detail',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './entry-detail.component.html',
  styleUrl: './entry-detail.component.scss',
})
export class EntryDetailComponent implements OnInit {
  entry = signal<Entry | null>(null);
  safeHtml = signal<SafeHtml>('');

  constructor(
    private db: DbService,
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
    }
  }

  moodEmoji(mood: number | null): string {
    return mood ? MOOD_EMOJI[mood] ?? '' : '';
  }

  edit() {
    this.router.navigate(['/entry', this.entry()!.id, 'edit']);
  }

  back() {
    this.router.navigate(['/timeline']);
  }
}
