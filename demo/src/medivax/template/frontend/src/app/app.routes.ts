import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'pazienti' },
  {
    path: 'pazienti',
    loadComponent: () => import('./features/patients/patient-search.component').then((m) => m.PatientSearchComponent),
  },
  {
    path: 'pazienti/:id',
    loadComponent: () => import('./features/patients/patient-card.component').then((m) => m.PatientCardComponent),
  },
  {
    path: 'vaccini',
    loadComponent: () => import('./features/vaccines/vaccines.component').then((m) => m.VaccinesComponent),
  },
  {
    path: 'scadenze',
    loadComponent: () => import('./features/due/due.component').then((m) => m.DueComponent),
  },
];
