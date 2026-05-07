import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="editor-wrapper">
      <div class="toolbar">
        <button type="button" (click)="exec('bold')"
          [class.active]="editor?.isActive('bold')">B</button>
        <button type="button" (click)="exec('italic')"
          [class.active]="editor?.isActive('italic')"><em>I</em></button>
        <button type="button" (click)="exec('heading')"
          [class.active]="editor?.isActive('heading',{level:2})">H2</button>
        <button type="button" (click)="exec('bulletList')"
          [class.active]="editor?.isActive('bulletList')">•—</button>
        <button type="button" (click)="exec('orderedList')"
          [class.active]="editor?.isActive('orderedList')">1.</button>
      </div>
      <div #editorEl class="editor-content"></div>
    </div>
  `,
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorEl') editorEl!: ElementRef<HTMLDivElement>;
  @Input() initialHtml = '';
  @Output() htmlChange = new EventEmitter<string>();
  @Output() textChange = new EventEmitter<string>();

  editor: Editor | null = null;

  ngAfterViewInit() {
    this.editor = new Editor({
      element: this.editorEl.nativeElement,
      extensions: [StarterKit],
      content: this.initialHtml,
      onUpdate: ({ editor }) => {
        this.htmlChange.emit(editor.getHTML());
        this.textChange.emit(editor.getText());
      },
    });
  }

  exec(cmd: string) {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    if (cmd === 'bold') chain.toggleBold().run();
    else if (cmd === 'italic') chain.toggleItalic().run();
    else if (cmd === 'heading') chain.toggleHeading({ level: 2 }).run();
    else if (cmd === 'bulletList') chain.toggleBulletList().run();
    else if (cmd === 'orderedList') chain.toggleOrderedList().run();
  }

  ngOnDestroy() {
    this.editor?.destroy();
  }
}
