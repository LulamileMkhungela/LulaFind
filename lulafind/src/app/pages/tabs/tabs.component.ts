import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar } from '@ionic/angular/ion-tab-bar';
import { IonTabButton } from '@ionic/angular/ion-tab-button';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';

/**
 * Bottom navigation: Home, Spotlight, Create, Chats, Menu.
 *
 * Chats is a real tab, so it shows as selected while you are in it. Search
 * lives in the top navigation's search bar and Notifications is the bell at
 * its right end (`lf-top-nav`), like LinkedIn.
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

        <ion-tab-button tab="chats">
          <div class="wrap">
            <lf-icon name="messenger" [size]="24" [filled]="active() === 'chats'" [weight]="active() === 'chats' ? 2.4 : 2" />
            @if (unread() > 0) { <span class="tab-dot">{{ unread() > 99 ? '99+' : unread() }}</span> }
          </div>
          <ion-label>Chats</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="me">
          <div class="wrap">
            @if (auth.signedIn()) {
              <span class="me" [class.on]="active() === 'me'">
                <lf-avatar [src]="auth.userAvatar()" [name]="auth.user()?.displayName ?? ''" [size]="24" />
              </span>
              <span class="menu-pip"><lf-icon name="menu" [size]="9" [weight]="3" /></span>
            } @else {
              <lf-icon name="menu" [size]="24" [weight]="active() === 'me' ? 2.6 : 2" />
            }
          </div>
          <ion-label>Menu</ion-label>
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
      font-size: 11px;
      font-weight: 500;
      margin-top: 3px;
      white-space: nowrap;
    }
    ion-tab-button.tab-selected ion-label { font-weight: 600; }

    /* Create and Search are plain buttons styled to sit in the same bar. */
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
    .bar-btn.create ion-label { color: var(--lf-muted); font-weight: 600; }

    .wrap { position: relative; display: inline-flex; }
    .tab-dot {
      position: absolute; top: -5px; right: -9px; min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 9px; background: var(--lf-badge); color: #fff; font-size: 10.5px; font-weight: 700;
      line-height: 17px; text-align: center; box-shadow: 0 0 0 2px var(--lf-tabbar); box-sizing: border-box;
    }
    .me { display: inline-flex; border-radius: 50%; }
    .me.on { box-shadow: 0 0 0 2px var(--lf-tabbar), 0 0 0 4px var(--lf-primary); }
    .menu-pip {
      position: absolute;
      right: -4px;
      bottom: -3px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--lf-card-2);
      color: var(--ion-text-color);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 2px var(--lf-tabbar);
    }
  `]
})
export class TabsComponent {
  private router = inject(Router);
  protected auth = inject(AuthService);
  private data = inject(DataService);
  private chat = inject(ChatService);

  readonly unread = computed(() => this.chat.unreadTotal());
  readonly active = signal(TabsComponent.tabOf(typeof location !== 'undefined' ? location.pathname : '/home'));

  constructor() {
    // Keeps the selected state right after a deep link or a Back press too.
    this.router.events.subscribe((ev) => {
      if (ev instanceof NavigationEnd) this.active.set(TabsComponent.tabOf(ev.urlAfterRedirects));
    });
  }

  private static tabOf(url: string): string {
    const first = url.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? 'home';
    return ['home', 'spotlight', 'chats', 'me'].includes(first) ? first : 'home';
  }

  create(): void {
    const target = this.auth.signedIn() ? '/new' : '/auth?next=/new';
    void this.router.navigateByUrl(target);
  }
}
