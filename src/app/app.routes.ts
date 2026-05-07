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
];
