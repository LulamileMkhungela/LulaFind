import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IconComponent } from './icon.component';
import { LogoComponent } from './logo.component';
import { AvatarComponent } from './avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { BackStackService } from '../../core/services/back-stack.service';

/**
 * The app's top navigation, laid out like LinkedIn's mobile header.
 *
 *   Every page  [back]  [your photo|search or title] .........  [page action] [bell]
 *
 * The product rule is "from everywhere, you can always go back", so even the
 * tab roots carry the arrow - deep links and stray taps never strand anyone.
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
        @if (title() || backTo()) {
          <ion-buttons slot="start">
            <button class="lf-round-btn" type="button" (click)="back()" aria-label="Go back">
              <lf-icon name="arrowLeft" [size]="20" [weight]="'bold'" />
            </button>
          </ion-buttons>
          <ion-title>{{ title() }}</ion-title>
        } @else {
          <div class="row">
            @if (!isHome()) {
              <button class="lf-round-btn row-back" type="button" (click)="back()" aria-label="Go back">
                <lf-icon name="arrowLeft" [size]="20" [weight]="'bold'" />
              </button>
            }
            @if (signedIn()) {
              <a class="me" routerLink="/me" aria-label="Your profile and menu">
                <lf-avatar [src]="avatar()" [name]="name()" [size]="32" [status]="status()" />
              </a>
            } @else {
              <a class="me" routerLink="/auth" aria-label="Sign in"><lf-logo [size]="32" label="LulaFind" /></a>
            }

            @if (heading()) {
              <h1 class="heading">{{ heading() }}</h1>
            } @else {
              <!--
                A real search field, not a link to one. Type here and the phone
                keyboard does the work (autocorrect, suggestions, its own emoji
                key) - no custom keypad to fight with.
              -->
              <form class="search" role="search" (submit)="submitSearch($event)">
                <lf-icon name="search" [size]="17" [weight]="'regular'" />
                <input #searchInput name="q" type="search" enterkeyhint="search"
                       autocomplete="off" autocorrect="on" autocapitalize="none" spellcheck="false"
                       [value]="query()"
                       (input)="onSearchInput($any($event.target).value)"
                       (focus)="searchOpen.set(true)"
                       [placeholder]="compact() ? 'Search' : 'Search LulaFind'"
                       aria-label="Search LulaFind" />
                @if (query()) {
                  <button class="clear" type="button" (click)="clearSearch($event)" aria-label="Clear search">
                    <lf-icon name="x" [size]="15" [weight]="'bold'" />
                  </button>
                }
              </form>
              <a class="nav-ico create-link" routerLink="/new" aria-label="Create a post" title="Create a post"><lf-icon name="plus" [size]="24" /></a>
            }
          </div>
        }

        <ion-buttons slot="end">
          <ng-content select="[lf-nav-end]" />
          <!--
            Chats and the bell are bare glyphs on the toolbar, the way LinkedIn
            draws them - no filled circle behind either one. The unread pip still
            rides the top-right corner.
          -->
          <a class="nav-ico" routerLink="/chats" aria-label="Chats">
            <lf-icon name="messenger" [size]="24" [filled]="unread() > 0" />
            @if (unread() > 0) { <span class="dot">{{ unread() > 99 ? '99+' : unread() }}</span> }
          </a>

        </ion-buttons>
      </ion-toolbar>
    </ion-header>
  `,
  styles: [`
    :host { display: block; }
    /* Fills the whole toolbar between the left edge and the bell, so the search
       pill takes every pixel LinkedIn's does. */
    /*
     * flex-basis auto with auto width, not 0.
     *
     * flex: 1 1 0 with width: 0 looked right but measured 12px - the row never
     * grew, and the search field inside it collapsed to a 24px stub with the
     * placeholder invisible. With a real basis the row takes 298px of the
     * toolbar and the field fills it, still shrinking first when space is tight.
     */
    .row { flex: 1 1 auto; width: auto; display: flex; align-items: center; gap: 10px; padding: 0 0 0 12px; min-width: 0; }
    .row-back { margin: 0 -2px 0 -8px; flex: none; }
    @media (max-width: 400px) { .row { gap: 8px; } .row-back { width: 36px; height: 36px; } }
    .me { display: inline-flex; flex-shrink: 0; border-radius: 50%; text-decoration: none; }
    /* The search field that takes every pixel between photo and bell. */
    .search {
      flex: 1 1 auto;
      min-width: 0;
      height: 36px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-radius: 6px;
      background: var(--lf-card-2);
      color: var(--lf-muted);
    }
    .search:focus-within { box-shadow: 0 0 0 2px var(--lf-primary); }
    .search input {
      flex: 1 1 auto;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ion-text-color);
      font: inherit;
      font-size: 15px;
    }
    .search input::placeholder { color: var(--lf-muted); }
    /* hide the WebKit search decorations: the pill is the field */
    .search input::-webkit-search-decoration,
    .search input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
    .search .clear {
      flex: none;
      width: 22px; height: 22px;
      display: grid; place-items: center;
      border: 0; border-radius: 50%;
      background: transparent; color: var(--lf-muted);
      cursor: pointer;
    }
    .search .clear:hover { background: var(--lf-hover); }
    /* Bare toolbar glyphs: no circle, no fill, just the icon and its pip. */
    .nav-ico {
      position: relative;
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px;
      margin-inline: 2px;
      border-radius: 8px;
      background: transparent;
      color: var(--ion-text-color);
      text-decoration: none;
    }
    .nav-ico:active { background: var(--lf-hover); }
    .nav-ico .dot {
      position: absolute;
      top: 2px; right: 2px;
      min-width: 18px; height: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9px;
      background: var(--lf-badge);
      color: #fff;
      font-size: 11px; font-weight: 700; line-height: 1;
    }
    .heading { flex: 1; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.2px;
      color: var(--ion-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `]
})
export class TopNavComponent {
  private router = inject(Router);
  private auth = inject(AuthService);
  private chat = inject(ChatService);
  private backStack = inject(BackStackService);

  /**
   * Set on inner pages: shows a back button and the title instead of the
   * search bar. A page with no title and no backTo is a root page.
   * `backTo` is where the back button lands when there is no in-app history
   * (a deep link) - in-app history always wins. It used to default to /home,
   * which made the back button conditional on this input being set, and one
   * page that set backTo without a title silently lost its only way back.
   */
  readonly title = input('');
  /** Set on a bottom-tab page that is not Home (e.g. Chats): photo, heading, bell. */
  readonly heading = input('');
  /** Where the back button goes when there is no history. Empty = no back button. */
  readonly backTo = input('');

  isHome(): boolean { return this.router.url.split(/[?#]/)[0] === '/home'; }

  readonly signedIn = computed(() => this.auth.signedIn());
  readonly avatar = computed(() => this.auth.userAvatar());
  readonly name = computed(() => this.auth.user()?.displayName ?? '');
  readonly status = computed(() => this.auth.user()?.checkIn?.status ?? null);
  readonly unread = computed(() => this.chat.unreadTotal());

  /**
   * Small phone: the row shares its pixels between back, avatar and icons,
   * so the search placeholder shortens to fit instead of clipping mid-word.
   */
  readonly compact = signal(false);

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(max-width: 400px)');
      this.compact.set(mq.matches);
      mq.addEventListener('change', (e) => this.compact.set(e.matches));
    }
  }

  /**
   * The search field's text. Kept in the component so the box survives a
   * re-render while the person is still typing.
   */
  readonly query = signal('');
  readonly searchOpen = signal(false);

  onSearchInput(value: string): void {
    this.query.set(value);
    this.searchOpen.set(true);
  }

  submitSearch(e: Event): void {
    e.preventDefault();
    const q = this.query().trim();
    if (!q) return;
    this.searchOpen.set(false);
    void this.router.navigate(['/search'], { queryParams: { q } });
  }

  clearSearch(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.query.set('');
    const input = (e.target as HTMLElement).closest('.search')?.querySelector('input');
    input?.focus();
  }

  back(): void {
    this.backStack.go(this.backTo() || '/home');
  }
}
