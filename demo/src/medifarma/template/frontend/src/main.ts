import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Prices in the catalog are shown in the Italian format (€ 1,13).
registerLocaleData(localeIt);

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
