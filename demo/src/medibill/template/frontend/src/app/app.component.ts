import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './core/layout/header.component';
import { SidenavComponent } from './core/layout/sidenav.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidenavComponent],
  template: `
    <app-header />
    <div class="shell">
      <app-sidenav />
      <main class="content"><router-outlet /></main>
    </div>
  `,
  styles: `
    .shell { display: grid; grid-template-columns: 200px 1fr; min-height: calc(100vh - 52px); }
    .content { padding: 20px 24px 48px; min-width: 0; }
    @media (max-width: 800px) { .shell { grid-template-columns: 1fr; } }
  `,
})
export class AppComponent {}
