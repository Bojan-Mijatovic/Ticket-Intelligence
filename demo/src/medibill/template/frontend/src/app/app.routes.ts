import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'addebiti' },
  {
    path: 'addebiti',
    loadComponent: () => import('./features/charges/charges.component').then((m) => m.ChargesComponent),
  },
  {
    path: 'ricevute',
    loadComponent: () => import('./features/receipts/receipts.component').then((m) => m.ReceiptsComponent),
  },
  {
    path: 'esenzioni',
    loadComponent: () => import('./features/exemptions/exemptions.component').then((m) => m.ExemptionsComponent),
  },
  {
    path: 'tariffario',
    loadComponent: () => import('./features/tariffs/tariffs.component').then((m) => m.TariffsComponent),
  },
  {
    path: 'report',
    loadComponent: () => import('./features/reports/report.component').then((m) => m.ReportComponent),
  },
];
