import { Routes } from '@angular/router';
import { unlockedGuard } from './core/auth/unlocked.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'timeline', pathMatch: 'full' },
  {
    path: 'lock',
    loadComponent: () =>
      import('./features/lock-screen/lock-screen.component').then(m => m.LockScreenComponent),
  },
  {
    path: 'timeline',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/timeline/timeline.component').then(m => m.TimelineComponent),
  },
  {
    path: 'entry/new',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/entry-edit/entry-edit.component').then(m => m.EntryEditComponent),
  },
  {
    path: 'entry/:id/edit',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/entry-edit/entry-edit.component').then(m => m.EntryEditComponent),
  },
  {
    path: 'entry/:id',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/entry-detail/entry-detail.component').then(m => m.EntryDetailComponent),
  },
  {
    path: 'settings',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/settings/settings.component').then(m => m.SettingsComponent),
  },
  {
    path: 'help',
    loadComponent: () =>
      import('./features/help/help.component').then(m => m.HelpComponent),
  },
  {
    path: 'trash',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/trash/trash.component').then(m => m.TrashComponent),
  },
  {
    path: 'backups',
    canActivate: [unlockedGuard],
    loadComponent: () =>
      import('./features/backups/backups.component').then(m => m.BackupsComponent),
  },
];
