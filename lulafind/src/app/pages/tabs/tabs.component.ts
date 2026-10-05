import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar } from '@ionic/angular/ion-tab-bar';
import { IonTabButton } from '@ionic/angular/ion-tab-button';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';

/**
 * Bottom navigation: Home, Spotlight, Create, Network, Menu.
 *
 * Chats used to sit here. It moved to the top navigation beside the bell, where
 * it keeps its unread badge, and the Photo tab - which only duplicated Create -
 * became Network: discovery, people search, the people you follow, your
 * followers, follow requests, stories and members' statuses.
 *
 * Menu is your own profile, which is where Settings and everything else lives.
 */
@Component({
  selector: 'lf-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonLabel, IconComponent, AvatarComponent],
  template: `
    <ion-tabs (ionTabsDidChange)="active.set($event.tab)">
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home">
          <lf-icon name="home" [size]="24" [filled]="active() === 'home'" />
          <ion-label>Home</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="spotlight">
          <lf-icon name="users" [size]="24" [weight]="active() === 'spotlight' ? 2.6 : 2" />
          <ion-label>Spotlight</ion-label>
        </ion-tab-button>

        <button class="bar-btn create" type="button" (click)="create()" aria-label="Create a post">
          <span class="create-disc"><lf-icon name="plus" [size]="24" [weight]="2.6" /></span>
          <ion-label>Create</ion-label>
        </button>

        <ion-tab-button tab="discover">
          <div class="wrap">
            <lf-icon name="compass" [size]="24" [filled]="active() === 'discover'" />
            @if (requests() > 0) { <span class="tab-dot">{{ requests() > 99 ? '99+' : requests() }}</span> }
          </div>
          <ion-label>Network</ion-label>
        </ion-tab-button>

        <button class="bar-btn menu" type="button" (click)="openMenu()" aria-label="Your profile and menu">
          <span class="wrap">
            @if (auth.signedIn()) {
              <lf-avatar [src]="auth.userAvatar()" [name]="auth.user()?.displayName ?? ''" [size]="24" />
            } @else {
              <lf-icon name="menu" [size]="24" />
            }
          </span>
          <ion-label>Menu</ion-label>
        </button>
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
      font-size: 11px;
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
  private router = inject(Router);
  private data = inject(DataService);
  protected auth = inject(AuthService);

  readonly requests = computed(() => this.data.followRequests().length);
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
    return ['home', 'spotlight', 'discover', 'me'].includes(first) ? first : '';
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
