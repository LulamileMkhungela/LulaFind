import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar } from '@ionic/angular/ion-tab-bar';
import { IonTabButton } from '@ionic/angular/ion-tab-button';
import { IconComponent } from '../../shared/components/icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Bottom navigation: Home, Spotlight, Create, Menu.
 *
 * Chats moved to the top navigation beside the bell, where it keeps its unread
 * badge. The former Discover/Network workspace is reached from Home → Network,
 * so the primary navigation stays focused on posting, cases and profile.
 *
 * Menu is your own profile, which is where Settings and everything else lives.
 */
@Component({
  selector: 'lf-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonLabel, IconComponent],
  template: `
    <ion-tabs (ionTabsDidChange)="active.set($event.tab)">
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home">
          <lf-icon name="home" [size]="24" [filled]="active() === 'home'" />
          <ion-label>Home</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="view">
          <lf-icon name="eye" [size]="24" />
          <ion-label>View</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="spotlight">
          <lf-icon name="users" [size]="24" [weight]="active() === 'spotlight' ? 2.6 : 2" />
          <ion-label>Spotlight</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="notifications">
          <span class="wrap"><lf-icon name="bell" [size]="24" />
            @if (data.unreadNotifications() > 0) { <span class="tab-dot">{{ data.unreadNotifications() > 99 ? '99+' : data.unreadNotifications() }}</span> }
          </span>
          <ion-label>Notifications</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="shortcuts">
          <lf-icon name="grid" [size]="24" />
          <ion-label>Shortcuts</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    ion-tab-bar {
      height: calc(var(--lf-tabbar-h) + var(--lf-safe-bottom));
      padding: 0;
    }
    ion-tab-button {
      --color: var(--lf-muted);
      --color-selected: var(--lf-primary);
      --ripple-color: var(--lf-hover);
      background: transparent;
      padding: 4px 0 2px;
      position: relative;
    }
    /* Facebook's blue bar over the active tab */
    ion-tab-button.tab-selected::before {
      content: '';
      position: absolute;
      top: 0; left: 22%; right: 22%;
      height: 3px;
      border-radius: 0 0 3px 3px;
      background: var(--lf-primary);
    }
    ion-label {
      font-size: clamp(9px, 2.7vw, 11px);
      font-weight: 500;
      margin-top: 3px;
      white-space: nowrap;
    }
    ion-tab-button.tab-selected ion-label { font-weight: 600; }

    /* Create and Menu are plain buttons styled to sit in the same bar. */
    .bar-btn {
      flex: 1 1 0;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 0;
      padding: 4px 0 2px;
      border: 0;
      background: transparent;
      color: var(--lf-muted);
      font-family: inherit;
      cursor: pointer;
    }
    .bar-btn:active { filter: brightness(.92); }
    .bar-btn ion-label { color: inherit; }
    .create-disc {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      margin-top: 1px;
      border-radius: 50%;
      background: var(--lf-primary);
      color: #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, .28);
    }
    .bar-btn:active .create-disc { transform: scale(.94); }
    .bar-btn.create ion-label, .bar-btn.menu ion-label { color: var(--lf-muted); font-weight: 600; }

    .wrap { position: relative; display: inline-flex; }
    .tab-dot {
      position: absolute; top: -5px; right: -9px; min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 9px; background: var(--lf-badge); color: #fff; font-size: 10.5px; font-weight: 700;
      line-height: 17px; text-align: center; box-shadow: 0 0 0 2px var(--lf-tabbar); box-sizing: border-box;
    }
  `]
})
export class TabsComponent {
  protected data = inject(DataService);
  private router = inject(Router);
  protected auth = inject(AuthService);

  readonly active = signal(TabsComponent.tabOf(typeof location !== 'undefined' ? location.pathname : '/home'));

  constructor() {
    // Keeps the selected state right after a deep link or a Back press too.
    this.router.events.subscribe((ev) => {
      if (ev instanceof NavigationEnd) this.active.set(TabsComponent.tabOf(ev.urlAfterRedirects));
    });
  }

  private static tabOf(url: string): string {
    const first = url.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? 'home';
    // Chats is no longer a tab, so /chats lights nothing up - as on LinkedIn,
    // where a pushed page leaves the bar unselected.
    return ['home', 'view', 'spotlight', 'notifications', 'shortcuts'].includes(first) ? first : '';
  }

  create(): void {
    const target = this.auth.signedIn() ? '/new' : '/auth?next=/new';
    void this.router.navigateByUrl(target);
  }

  /** Menu is your own profile; Settings and the rest hang off it. */
  openMenu(): void {
    void this.router.navigateByUrl(this.auth.signedIn() ? '/me' : '/auth');
  }
}
