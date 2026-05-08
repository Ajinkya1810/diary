import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';
import { BUILD_LABEL } from '../../version';

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule, ThemeToggleComponent],
  templateUrl: './help.component.html',
  styleUrl: './help.component.scss',
})
export class HelpComponent {
  readonly buildLabel = BUILD_LABEL;
  constructor(private router: Router) {}
  back() { this.router.navigate(['/settings']); }
}
