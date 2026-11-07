import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'prescrizioni' },
  {
    path: 'prescrizioni',
    loadComponent: () => import('./features/prescriptions/prescription-list.component').then((m) => m.PrescriptionListComponent),
  },
  {
    path: 'prescrizioni/nuova',
    loadComponent: () => import('./features/prescriptions/prescription-form.component').then((m) => m.PrescriptionFormComponent),
  },
  {
    path: 'erogazione/:id',
    loadComponent: () => import('./features/dispensing/dispensing.component').then((m) => m.DispensingComponent),
  },
  {
    path: 'magazzino',
    loadComponent: () => import('./features/stock/stock.component').then((m) => m.StockComponent),
  },
  {
    path: 'farmaci',
    loadComponent: () => import('./features/drugs/drug-catalog.component').then((m) => m.DrugCatalogComponent),
  },
];
