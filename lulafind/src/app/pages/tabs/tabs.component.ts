import { Component, computed, inject, signal } from '@angular/core';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar, IonTabButton } from '@ionic/angular';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ChatService } from '../../core/services/chat.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Facebook-style bottom navigation: Home, Spotlight, Chats, Notifications, Menu.
 * Creating a post lives where Facebook puts it: the "+" in the Home header and
 * the "What's on your mind?" composer.
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

        <ion-tab-button tab="chats">
          <div class="wrap">
            <lf-icon name="messenger" [size]="24" [weight]="active() === 'chats' ? 2.4 : 1.8" />
            @if (unread() > 0) { <span class="count">{{ unread() > 99 ? '99+' : unread() }}</span> }
          </div>
          <ion-label>Chats</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="notifications">
          <div class="wrap">
            <lf-icon name="bell" [size]="24" [filled]="active() === 'notifications'" />
            @if (alerts() > 0) { <span class="count">{{ alerts() > 99 ? '99+' : alerts() }}</span> }
          </div>
          <ion-label>Notifications</ion-label>
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
    .wrap { position: relative; display: inline-flex; }
    .count {
      position: absolute;
      top: -5px;
      left: 14px;
      background: var(--lf-badge);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      border-radius: 999px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 2px var(--lf-tabbar);
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
  private chat = inject(ChatService);
  private data = inject(DataService);
  protected auth = inject(AuthService);

  readonly active = signal('home');
  readonly unread = computed(() => this.chat.unreadTotal());
  readonly alerts = computed(() => this.data.unreadNotifications());
}
