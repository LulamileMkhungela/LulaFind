import { bootstrapApplication } from '@angular/platform-browser';
import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { registerCoreIcons } from './app/core/theme/icon-registry';

registerCoreIcons();
defineCustomElements(window).catch(() => void 0);

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
