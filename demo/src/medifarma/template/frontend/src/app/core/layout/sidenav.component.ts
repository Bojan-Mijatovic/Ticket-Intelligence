import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidenav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="nav">
      <a routerLink="/prescrizioni" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Prescrizioni</a>
      <a routerLink="/prescrizioni/nuova" routerLinkActive="active">Nuova prescrizione</a>
      <a routerLink="/magazzino" routerLinkActive="active">Magazzino</a>
      <a routerLink="/farmaci" routerLinkActive="active">Farmaci</a>
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
