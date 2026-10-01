import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar } from '@ionic/angular/ion-tab-bar';
import { IonTabButton } from '@ionic/angular/ion-tab-button';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { MediaService } from '../../core/services/media.service';

/**
 * Bottom navigation: Home, Spotlight, Create, Discover, Menu.
 *
 * The photo action opens the camera/photo chooser and carries the selection
 * into the post composer. Menu/profile remains available from the top photo.
 * Search and Notifications live in the top navigation, like LinkedIn.
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

        <button class="bar-btn photo" type="button" (click)="addPhoto()" [disabled]="photoBusy()"
                [attr.aria-busy]="photoBusy()" aria-label="Create a post with a photo">
          <span class="wrap"><lf-icon name="image" [size]="24" [weight]="photoBusy() ? 2.6 : 2" /></span>
          <ion-label>{{ photoBusy() ? 'Opening…' : 'Photo' }}</ion-label>
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
    .bar-btn.create ion-label, .bar-btn.photo ion-label { color: var(--lf-muted); font-weight: 600; }
    .bar-btn.photo:disabled { opacity: .65; cursor: wait; }

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
  protected auth = inject(AuthService);
  private chat = inject(ChatService);
  private media = inject(MediaService);
  private toast = inject(ToastController);

  readonly unread = computed(() => this.chat.unreadTotal());
  readonly photoBusy = signal(false);
  readonly active = signal(TabsComponent.tabOf(typeof location !== 'undefined' ? location.pathname : '/home'));

  constructor() {
    // Keeps the selected state right after a deep link or a Back press too.
    this.router.events.subscribe((ev) => {
      if (ev instanceof NavigationEnd) this.active.set(TabsComponent.tabOf(ev.urlAfterRedirects));
    });
  }

  private static tabOf(url: string): string {
    const first = url.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? 'home';
    if (first === 'chat') return 'chats';
    return ['home', 'spotlight', 'chats', 'me'].includes(first) ? first : 'home';
  }

  create(): void {
    const target = this.auth.signedIn() ? '/new' : '/auth?next=/new';
    void this.router.navigateByUrl(target);
  }

  async addPhoto(): Promise<void> {
    if (this.photoBusy()) return;
    if (!this.auth.signedIn()) {
      await this.router.navigateByUrl('/auth?next=/new');
      return;
    }

    this.photoBusy.set(true);
    try {
      const picked = await this.media.pickImage({ quality: 76 });
      if (!picked) {
        const message = this.media.lastError() || this.media.notice();
        if (message) await this.toast.create({ message, duration: 2600, position: 'bottom' }).then((x) => x.present());
        return;
      }
      const src = await this.media.compress(picked.src, 1200);
      await this.router.navigateByUrl('/new', {
        state: { photoAttachment: { ...picked, src }, mediaNotice: this.media.notice() }
      });
    } finally {
      this.photoBusy.set(false);
    }
  }
}
