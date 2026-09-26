import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonTabs } from '@ionic/angular/ion-tabs';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonTabBar, IonTabButton } from '@ionic/angular';
import { IconComponent } from '../../shared/components/icon.component';
import { ChatService } from '../../core/services/chat.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'lf-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonLabel, IconComponent],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home">
          <lf-icon name="home" [size]="22" />
          <ion-label>Home</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="spotlight">
          <lf-icon name="users" [size]="22" />
          <ion-label>Spotlight</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="create" (click)="openCreate($event)">
          <div class="fab"><lf-icon name="plus" [size]="26" [weight]="2.4" /></div>
        </ion-tab-button>

        <ion-tab-button tab="chats">
          <div class="wrap">
            <lf-icon name="chat" [size]="22" />
            @if (unread() > 0) { <span class="lf-badge">{{ unread() }}</span> }
          </div>
          <ion-label>Chats</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="me">
          <div class="wrap">
            <lf-icon name="user" [size]="22" />
            @if (alerts() > 0) { <span class="lf-badge dot"></span> }
          </div>
          <ion-label>Me</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    ion-tab-bar {
      width: calc(100% - 20px);
      left: 10px;
      right: 10px;
      bottom: calc(8px + var(--lf-safe-bottom, env(safe-area-inset-bottom, 0px)));
      height: 64px;
      padding: 4px 6px;
      border-radius: 26px;
      border: 1px solid var(--lf-line);
      overflow: visible;
    }
    ion-tab-button { --padding-top: 2px; --padding-bottom: 2px; margin: 4px 2px; border-radius: 18px; transition: transform .12s ease; }
    ion-tab-button:active:not(:has(.fab)) { transform: scale(.96); }
    ion-tab-button:active .fab { transform: translateY(-8px) scale(.94); }
    ion-tab-button.tab-selected:not(:has(.fab)) {
      background: color-mix(in srgb, var(--lf-beacon) 18%, transparent);
    }
    ion-tab-button.tab-selected lf-icon { color: var(--lf-beacon); }
    ion-label { font-size: 11px; font-weight: 700; letter-spacing: .1px; }
    @media (min-width: 768px) {
      ion-tab-bar { max-width: 680px; left: 50%; right: auto; transform: translateX(-50%); }
    }
    .fab { width: 52px; height: 52px; border-radius: 18px; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(160deg, #ffe08a, var(--lf-beacon) 42%, var(--lf-marigold)); color: #1a1200;
      box-shadow: 0 10px 24px color-mix(in srgb, var(--lf-beacon) 40%, transparent);
      transform: translateY(-8px); }
    .wrap { position: relative; }
    .lf-badge { position: absolute; top: -6px; right: -10px; }
    .lf-badge.dot { min-width: 9px; width: 9px; height: 9px; padding: 0; top: -1px; right: -4px; background: var(--lf-beacon); }
  `]
})
export class TabsComponent {
  private chat = inject(ChatService);
  private data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly unread = computed(() => this.chat.unreadTotal());
  readonly alerts = computed(() => this.data.unreadNotifications());

  /** The plus opens the composer itself. It is not a second menu. */
  openCreate(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.auth.signedIn()) {
      void this.router.navigate(['/auth'], { queryParams: { next: '/new' } });
      return;
    }
    void this.router.navigate(['/new']);
  }
}
