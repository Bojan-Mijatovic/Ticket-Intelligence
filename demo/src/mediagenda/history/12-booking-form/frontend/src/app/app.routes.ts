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
    path: 'prenotazioni/nuova',
    loadComponent: () => import('./features/booking/booking-form.component').then((m) => m.BookingFormComponent),
  },
  {
    path: 'pazienti',
    loadComponent: () => import('./features/patients/patient-search.component').then((m) => m.PatientSearchComponent),
  },
  {
    path: 'pazienti/nuovo',
    loadComponent: () => import('./features/patients/patient-form.component').then((m) => m.PatientFormComponent),
  },
  {
    path: 'pazienti/:id',
    loadComponent: () => import('./features/patients/patient-form.component').then((m) => m.PatientFormComponent),
  },
];
