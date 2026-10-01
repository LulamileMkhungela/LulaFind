import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IconComponent } from './icon.component';
import { LogoComponent } from './logo.component';
import { AvatarComponent } from './avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { ChatService } from '../../core/services/chat.service';

/**
 * The app's top navigation, laid out like LinkedIn's mobile header.
 *
 *   Root pages  [your photo]  [ search bar that fills the space ]  [bell]
 *   Inner pages [back]  Title  ............................  [page action] [bell]
 *
 * The photo opens your profile menu, the search bar opens Search, Chats carries
 * its unread badge, and the bell is always the last thing on the right.
 *
 * It is a real `ion-header` + `ion-toolbar`: that is what gives Ionic the
 * height it needs to push `ion-content` down. A page that needs its own action
 * passes `<button lf-nav-end>...</button>`; it is projected before the bell.
 */
@Component({
  selector: 'lf-top-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, RouterLink, IconComponent, LogoComponent, AvatarComponent],
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        @if (title()) {
          <ion-buttons slot="start">
            <button class="lf-round-btn" type="button" (click)="back()" aria-label="Go back">
              <lf-icon name="arrowLeft" [size]="20" [weight]="2.4" />
            </button>
          </ion-buttons>
          <ion-title>{{ title() }}</ion-title>
        } @else {
          <div class="row">
            @if (signedIn()) {
              <a class="me" routerLink="/me" aria-label="Your profile and menu">
                <lf-avatar [src]="avatar()" [name]="name()" [size]="32" />
              </a>
            } @else {
              <a class="me" routerLink="/auth" aria-label="Sign in"><lf-logo [size]="32" label="LulaFind" /></a>
            }

            @if (heading()) {
              <h1 class="heading">{{ heading() }}</h1>
            } @else {
              <a class="search" routerLink="/search" aria-label="Search LulaFind">
                <lf-icon name="search" [size]="17" [weight]="2.2" />
                <span>Search</span>
              </a>
            }
          </div>
        }

        <ion-buttons slot="end">
          <ng-content select="[lf-nav-end]" />
          <!-- Chats left the bottom bar for the top one, so it keeps its badge here. -->
          <a class="lf-round-btn" routerLink="/chats" aria-label="Chats">
            <lf-icon name="messenger" [size]="22" [filled]="unread() > 0" />
            @if (unread() > 0) { <span class="dot">{{ unread() > 99 ? '99+' : unread() }}</span> }
          </a>
          <a class="lf-round-btn" routerLink="/notifications" aria-label="Notifications">
            <lf-icon name="bell" [size]="22" [filled]="alerts() > 0" />
            @if (alerts() > 0) { <span class="dot">{{ alerts() > 99 ? '99+' : alerts() }}</span> }
          </a>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
  `,
  styles: [`
    :host { display: block; }
    /* Fills the whole toolbar between the left edge and the bell, so the search
       pill takes every pixel LinkedIn's does. */
    .row { flex: 1 1 0; width: 0; display: flex; align-items: center; gap: 10px; padding: 0 0 0 12px; min-width: 0; }
    .me { display: inline-flex; flex-shrink: 0; border-radius: 50%; text-decoration: none; }
    /* LinkedIn's search: a pill that takes every pixel between photo and bell. */
    .search {
      flex: 1 1 auto;
      min-width: 0;
      height: 36px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      border-radius: 6px;
      background: var(--lf-card-2);
      color: var(--lf-muted);
      font-size: 15px;
      text-decoration: none;
    }
    .search span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .heading { flex: 1; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.2px;
      color: var(--ion-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `]
})
export class TopNavComponent {
  private router = inject(Router);
  private auth = inject(AuthService);
  private data = inject(DataService);
  private chat = inject(ChatService);

  /** Set on inner pages: shows a back button and the title instead of the search bar. */
  readonly title = input('');
  /** Set on a bottom-tab page that is not Home (e.g. Chats): photo, heading, bell. */
  readonly heading = input('');
  /** Where the back button goes. Defaults to the browser history, then /home. */
  readonly backTo = input('/home');

  readonly signedIn = computed(() => this.auth.signedIn());
  readonly avatar = computed(() => this.auth.userAvatar());
  readonly name = computed(() => this.auth.user()?.displayName ?? '');
  readonly alerts = computed(() => this.data.unreadNotifications());
  readonly unread = computed(() => this.chat.unreadTotal());

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
