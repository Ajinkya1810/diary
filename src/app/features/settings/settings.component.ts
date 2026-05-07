import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Tag } from '../../core/db/db.service';
import { TagService } from '../../core/tag/tag.service';
import { ExportService } from '../../core/export/export.service';

type ActionState = 'idle' | 'busy' | 'done' | 'error';

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

  backupState = signal<ActionState>('idle');
  importState = signal<ActionState>('idle');
  pdfState = signal<ActionState>('idle');
  errorMsg = signal('');

  constructor(
    private tagSvc: TagService,
    private exportSvc: ExportService,
    private router: Router,
  ) {}

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

  async exportBackup() {
    this.backupState.set('busy');
    this.errorMsg.set('');
    try {
      await this.exportSvc.exportBackup();
      this.backupState.set('done');
      setTimeout(() => this.backupState.set('idle'), 3000);
    } catch (e: any) {
      this.errorMsg.set(e.message ?? 'Export failed.');
      this.backupState.set('error');
    }
  }

  async onImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm('Import backup? This will REPLACE all current data and lock the app. Continue?')) return;
    this.importState.set('busy');
    this.errorMsg.set('');
    try {
      await this.exportSvc.importBackup(file);
      // vault.lock() navigates to /lock — no further code runs
    } catch (e: any) {
      this.errorMsg.set(e.message ?? 'Import failed.');
      this.importState.set('error');
    }
  }

  async exportPdf() {
    this.pdfState.set('busy');
    this.errorMsg.set('');
    try {
      await this.exportSvc.exportPdf();
      this.pdfState.set('done');
      setTimeout(() => this.pdfState.set('idle'), 3000);
    } catch (e: any) {
      this.errorMsg.set(e.message ?? 'PDF export failed.');
      this.pdfState.set('error');
    }
  }

  back() { this.router.navigate(['/timeline']); }
}
