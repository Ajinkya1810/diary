import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Tag } from '../../core/db/db.service';
import { TagService } from '../../core/tag/tag.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  tags = signal<Tag[]>([]);
  newTagName = '';
  editingId = signal<string | null>(null);
  editingName = '';

  constructor(private tagSvc: TagService, private router: Router) {}

  async ngOnInit() { await this.reload(); }

  private async reload() { this.tags.set(await this.tagSvc.listAll()); }

  async addTag() {
    const name = this.newTagName.trim();
    if (!name) return;
    await this.tagSvc.create(name);
    this.newTagName = '';
    await this.reload();
  }

  startEdit(tag: Tag) { this.editingId.set(tag.id); this.editingName = tag.name; }

  async saveEdit(id: string) {
    if (this.editingName.trim()) await this.tagSvc.rename(id, this.editingName);
    this.editingId.set(null);
    await this.reload();
  }

  cancelEdit() { this.editingId.set(null); }

  async deleteTag(id: string) {
    if (!confirm('Delete tag? It will be removed from all entries.')) return;
    await this.tagSvc.delete(id);
    await this.reload();
  }

  back() { this.router.navigate(['/timeline']); }
}
