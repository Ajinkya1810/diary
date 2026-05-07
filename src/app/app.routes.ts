import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'timeline', pathMatch: 'full' },
  {
    path: 'timeline',
    loadComponent: () =>
      import('./features/timeline/timeline.component').then(m => m.TimelineComponent),
  },
  {
    path: 'entry/new',
    loadComponent: () =>
      import('./features/entry-edit/entry-edit.component').then(m => m.EntryEditComponent),
  },
  {
    path: 'entry/:id/edit',
    loadComponent: () =>
      import('./features/entry-edit/entry-edit.component').then(m => m.EntryEditComponent),
  },
  {
    path: 'entry/:id',
    loadComponent: () =>
      import('./features/entry-detail/entry-detail.component').then(m => m.EntryDetailComponent),
  },
];
