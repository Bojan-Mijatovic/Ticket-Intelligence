import { Component } from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="header">
      <span class="logo">MediLab</span>
      <span class="section">Laboratorio analisi</span>
      <span class="user">Tecnico di laboratorio demo</span>
    </header>
  `,
  styles: `
    .header { display: flex; align-items: center; gap: 16px; height: 52px; padding: 0 24px; background: var(--primary); color: var(--primary-ink); }
    .logo { font-weight: 700; font-size: 16px; }
    .section { opacity: 0.85; }
    .user { margin-left: auto; font-size: 12px; opacity: 0.85; }
  `,
})
export class HeaderComponent {}
