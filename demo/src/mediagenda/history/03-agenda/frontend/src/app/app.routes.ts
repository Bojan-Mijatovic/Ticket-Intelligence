import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'agenda' },
  {
    path: 'agenda',
    loadComponent: () => import('./features/agenda/search-mask/search-mask.component').then((m) => m.SearchMaskComponent),
  },
];
