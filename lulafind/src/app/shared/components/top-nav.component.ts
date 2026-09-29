import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { IconComponent } from './icon.component';
import { LogoComponent } from './logo.component';
import { ChatService } from '../../core/services/chat.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * The app's top navigation.
 *
 * Every page renders this instead of hand-rolling its own bar. It is a real
 * `ion-header` + `ion-toolbar`, which is what gives Ionic the height it needs
 * to push `ion-content` down - a bare `div` inside `ion-header` collapses to
 * zero height and the page content scrolls over the bar (the "top nav is cut
 * off" bug).
 *
 * Create, Search, Chats and Notifications live here on every screen, next to
 * the brand - like the classic header. Create and Search are also in the
 * bottom navigation, where the thumb already is.
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
              <lf-logo [size]="28" label="LulaFind" />
              <span class="wordmark">lulafind</span>
            </a>
          }
        </ion-buttons>

        @if (title()) { <ion-title>{{ title() }}</ion-title> }

        <ion-buttons slot="end">
          <ng-content select="[lf-nav-end]" />
          <button class="lf-round-btn" type="button" (click)="create()" aria-label="Create a post or story">
            <lf-icon name="plus" [size]="20" [weight]="2.4" />
          </button>
          <a class="lf-round-btn" routerLink="/search" aria-label="Search">
            <lf-icon name="search" [size]="19" [weight]="2.2" />
          </a>
          <a class="lf-round-btn" routerLink="/chats" aria-label="Chats">
            <lf-icon name="messenger" [size]="19" [weight]="2" />
            @if (chats() > 0) { <span class="dot">{{ chats() > 99 ? '99+' : chats() }}</span> }
          </a>
          <a class="lf-round-btn" routerLink="/notifications" aria-label="Notifications">
            <lf-icon name="bell" [size]="19" [filled]="alerts() > 0" />
            @if (alerts() > 0) { <span class="dot">{{ alerts() > 99 ? '99+' : alerts() }}</span> }
          </a>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
  `,
  styles: [`:host { display: block; }`]
})
export class TopNavComponent {
  private router = inject(Router);
  private chat = inject(ChatService);
  private data = inject(DataService);
  private auth = inject(AuthService);
  private sheetCtl = inject(ActionSheetController);

  /** Empty shows the LulaFind brand instead of a back button and a title. */
  readonly title = input('');
  /** Where the back button goes. Defaults to the browser history, then /home. */
  readonly backTo = input('/home');

  readonly chats = computed(() => this.chat.unreadTotal());
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

  /**
   * Same Create sheet as the bottom tab's + button: a feed post or a
   * 24-hour story. Guests are sent to sign in first, then straight to the
   * form they picked.
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
}
