import { Component } from '@angular/core';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button class="theme-toggle" (click)="theme.toggleMode()"
      [attr.aria-label]="theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      title="Toggle theme">
      {{ theme.mode() === 'dark' ? '☀' : '🌙' }}
    </button>
  `,
  styles: [`
    .theme-toggle {
      background: none;
      border: none;
      color: var(--text-3);
      font-size: 1.125rem;
      cursor: pointer;
      padding: 4px 6px;
      line-height: 1;
      transition: color 0.15s, transform 0.2s;
    }
    .theme-toggle:hover { color: var(--text-2); }
    .theme-toggle:active { transform: scale(0.9); }
  `],
})
export class ThemeToggleComponent {
  constructor(public theme: ThemeService) {}
}
