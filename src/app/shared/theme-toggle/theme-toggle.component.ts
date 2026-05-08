import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [RouterLink],
  template: `
    <span class="header-tools">
      <button class="tool-btn" (click)="openHelp()" aria-label="Help" title="Help & About">ⓘ</button>
      <button class="tool-btn" (click)="theme.toggleMode()"
        [attr.aria-label]="theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        title="Toggle theme">
        {{ theme.mode() === 'dark' ? '☀' : '🌙' }}
      </button>
    </span>
  `,
  styles: [`
    .header-tools { display: inline-flex; align-items: center; gap: 2px; }
    .tool-btn {
      background: none;
      border: none;
      color: var(--text-3);
      font-size: 1.0625rem;
      cursor: pointer;
      padding: 4px 6px;
      line-height: 1;
      transition: color 0.15s, transform 0.2s;
    }
    .tool-btn:hover { color: var(--text-2); }
    .tool-btn:active { transform: scale(0.9); }
  `],
})
export class ThemeToggleComponent {
  constructor(public theme: ThemeService, private router: Router) {}
  openHelp() { this.router.navigate(['/help']); }
}
