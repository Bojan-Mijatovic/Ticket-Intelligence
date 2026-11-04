import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'agenda' },
  {
    path: 'agenda',
    loadComponent: () => import('./features/agenda/search-mask/search-mask.component').then((m) => m.SearchMaskComponent),
  },
  {
    path: 'prenotazioni',
    loadComponent: () => import('./features/booking/booking-list.component').then((m) => m.BookingListComponent),
  },
  {
    path: 'pazienti',
    loadComponent: () => import('./features/patients/patient-search.component').then((m) => m.PatientSearchComponent),
  },
  {
    path: 'report',
    loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent),
  },
];
