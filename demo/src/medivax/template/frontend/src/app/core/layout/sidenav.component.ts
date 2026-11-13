import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidenav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="nav">
      <a routerLink="/pazienti" routerLinkActive="active">Pazienti</a>
      <a routerLink="/scadenze" routerLinkActive="active">Scadenze</a>
      <a routerLink="/vaccini" routerLinkActive="active">Vaccini</a>
    </nav>
  `,
  styles: `
    .nav { display: flex; flex-direction: column; padding: 12px 8px; background: var(--surface); border-right: 1px solid var(--border); }
    a { padding: 8px 12px; border-radius: 6px; color: var(--text); text-decoration: none; }
    a:hover { background: var(--bg); }
    a.active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
  `,
})
export class SidenavComponent {}
