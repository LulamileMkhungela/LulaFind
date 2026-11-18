import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';

@Component({
  selector: 'lf-shortcuts', standalone: true,
  imports: [IonContent, RouterLink, IconComponent, TopNavComponent],
  template: `
    <lf-top-nav heading="Shortcuts" />
    <ion-content class="lf-page"><main class="shortcuts">
      <h1>Shortcuts</h1>
      <a routerLink="/safety"><lf-icon name="shield" /> Safety</a>
      <a routerLink="/tips"><lf-icon name="info" /> Tips</a>
      <a routerLink="/found"><lf-icon name="check" /> People found</a>
      <a routerLink="/faqs"><lf-icon name="info" /> FAQs</a>
      <a routerLink="/help"><lf-icon name="phone" /> Get help</a>
      @if (auth.user()?.isAdmin) { <a routerLink="/admin"><lf-icon name="shield" /> Admin moderation</a> }
    </main></ion-content>
  `,
  styles: [`
    .shortcuts { max-width:var(--lf-maxw); margin:auto; padding:16px var(--lf-gap); }
    h1 { font-size:20px; margin:0 0 12px; }
    a { display:flex; align-items:center; gap:14px; min-height:48px; border-bottom:1px solid var(--lf-line); color:var(--ion-text-color); text-decoration:none; font-weight:600; }
    a lf-icon { color:var(--lf-primary); }
  `]
})
export class ShortcutsComponent { protected readonly auth = inject(AuthService); }
