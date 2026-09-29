import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IconComponent } from './icon.component';
import { LogoComponent } from './logo.component';
import { DataService } from '../../core/services/data.service';

/**
 * The app's top navigation, LinkedIn-style: the logo image on its own, then
 * Search, then Notifications.
 *
 * Every page renders this instead of hand-rolling its own bar. It is a real
 * `ion-header` + `ion-toolbar`, which is what gives Ionic the height it needs
 * to push `ion-content` down - a bare `div` inside `ion-header` collapses to
 * zero height and the page content scrolls over the bar (the "top nav is cut
 * off" bug).
 *
 * On brand pages the search pill stretches between the logo and the bell; on
 * titled pages the title takes the middle, so search shrinks to its icon to
 * keep every screen one tap from search. Chats live in the bottom navigation
 * with their unread badge.
 *
 * A page that needs its own action on the right passes
 * `<button lf-nav-end>...</button>`; it is projected before the standard
 * buttons rather than replacing them.
 */
@Component({
  selector: 'lf-top-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, RouterLink, IconComponent, LogoComponent],
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          @if (title()) {
            <button class="lf-round-btn" type="button" (click)="back()" aria-label="Go back">
              <lf-icon name="arrowLeft" [size]="20" [weight]="2.4" />
            </button>
          } @else {
            <a class="brand" routerLink="/home" aria-label="LulaFind home">
              <lf-logo [size]="32" label="LulaFind" />
            </a>
          }
        </ion-buttons>

        @if (title()) { <ion-title>{{ title() }}</ion-title> }

        <ion-buttons slot="end" class="nav-end" [class.grow]="!title()">
          <ng-content select="[lf-nav-end]" />
          @if (!title()) {
            <a class="lf-search-pill" routerLink="/search" aria-label="Search LulaFind">
              <lf-icon name="search" [size]="17" [weight]="2.2" />
              <span>Search</span>
            </a>
          } @else {
            <a class="lf-round-btn" routerLink="/search" aria-label="Search">
              <lf-icon name="search" [size]="19" [weight]="2.2" />
            </a>
          }
          <a class="lf-round-btn" routerLink="/notifications" aria-label="Notifications">
            <lf-icon name="bell" [size]="19" [filled]="alerts() > 0" />
            @if (alerts() > 0) { <span class="dot">{{ alerts() > 99 ? '99+' : alerts() }}</span> }
          </a>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
  `,
  styles: [`
    :host { display: block; }
    .nav-end { display: flex; align-items: center; gap: 8px; }
    .nav-end.grow { flex: 1; min-width: 0; }
    /* LinkedIn's search field next to the logo: a tap opens full search. */
    .lf-search-pill {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      height: 34px;
      padding: 0 10px;
      border-radius: 7px;
      background: var(--lf-card-2);
      color: var(--lf-muted);
      text-decoration: none;
      font-size: 14px;
    }
    .lf-search-pill:active { filter: brightness(.94); }
    .lf-search-pill span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `]
})
export class TopNavComponent {
  private router = inject(Router);
  private data = inject(DataService);

  /** Empty shows the brand instead of a back button and a title. */
  readonly title = input('');
  /** Where the back button goes. Defaults to the browser history, then /home. */
  readonly backTo = input('/home');

  readonly alerts = computed(() => this.data.unreadNotifications());

  back(): void {
    const fallback = this.backTo() || '/home';
    // Prefer real history so a deep link (a shared post) still feels like Back.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    void this.router.navigateByUrl(fallback);
  }
}
