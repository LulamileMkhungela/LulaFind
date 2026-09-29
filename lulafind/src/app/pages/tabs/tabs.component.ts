import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar, IonTabButton } from '@ionic/angular';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Bottom navigation: Home, Spotlight, Create, Search, Menu.
 *
 * Create and Search used to sit in the Home header; they are thumb targets, so
 * they live down here now. Chats and Notifications moved up to the top
 * navigation (`lf-top-nav`) where they are one tap away on every screen.
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

        <button class="bar-btn" type="button" (click)="search()" aria-label="Search LulaFind">
          <lf-icon name="search" [size]="24" [weight]="2.2" />
          <ion-label>Search</ion-label>
        </button>

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
  private sheetCtl = inject(ActionSheetController);

  readonly active = signal('home');

  /**
   * The + button offers both: a feed post and a 24-hour story.
   * Guests are sent to sign in first, then straight to the form they picked.
   */
  async create(): Promise<void> {
    const signedIn = this.auth.signedIn();
    const go = (target: string): void => {
      if (signedIn) void this.router.navigateByUrl(target);
      else void this.router.navigate(['/auth'], { queryParams: { next: target } });
    };
    const sheet = await this.sheetCtl.create({
      header: 'Create',
      buttons: [
        {
          text: 'Create post',
          icon: 'document-text' as const,
          handler: () => go('/new')
        },
        {
          text: 'Create story',
          icon: 'camera' as const,
          handler: () => go('/create-story')
        },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  search(): void {
    void this.router.navigateByUrl('/search');
  }
}
