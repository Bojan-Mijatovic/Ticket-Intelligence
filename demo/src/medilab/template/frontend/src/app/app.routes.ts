import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'richieste' },
  {
    path: 'richieste',
    loadComponent: () => import('./features/orders/order-list.component').then((m) => m.OrderListComponent),
  },
  {
    path: 'richieste/nuova',
    loadComponent: () => import('./features/orders/order-form.component').then((m) => m.OrderFormComponent),
  },
  {
    path: 'campioni',
    loadComponent: () => import('./features/samples/sample-acceptance.component').then((m) => m.SampleAcceptanceComponent),
  },
  {
    path: 'richieste/:id/risultati',
    loadComponent: () => import('./features/results/result-entry.component').then((m) => m.ResultEntryComponent),
  },
  {
    path: 'referti/:id',
    loadComponent: () => import('./features/reports/report-view.component').then((m) => m.ReportViewComponent),
  },
  {
    path: 'catalogo',
    loadComponent: () => import('./features/catalog/exam-catalog.component').then((m) => m.ExamCatalogComponent),
  },
];
