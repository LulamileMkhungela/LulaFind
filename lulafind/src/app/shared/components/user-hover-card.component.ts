import { Component, Directive, ElementRef, HostListener, Input, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { UserHoverService } from '../../core/services/user-hover.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PostActionsService } from '../../core/services/post-actions.service';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { UserProfile, provinceName } from '../../core/models/types';

/**
 * Puts a profile hovercard on a name. On a mouse, or on keyboard focus. Never on
 * tap - a thumb on a name means "open this profile", which is what the link under
 * the finger already does.
 */
@Directive({ selector: '[lfUserHover]', standalone: true })
export class UserHoverDirective {
  @Input('lfUserHover') userId = '';

  constructor(private hover: UserHoverService, private el: ElementRef<HTMLElement>) {}

  private get host(): HTMLElement {
    return this.el.nativeElement;
  }

  @HostListener('mouseenter')
  @HostListener('focusin')
  onEnter(): void {
    if (this.userId && !this.touchOnly()) this.hover.show(this.userId, this.host);
  }

  @HostListener('mouseleave')
  @HostListener('focusout')
  onLeave(): void {
    this.hover.hideSoon();
  }

  /** `(pointer: coarse)` is a finger; a laptop with a touchscreen is not. */
  private touchOnly(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;
  }
}

/**
 * LinkedIn's hovercard: who this is, and the two things you usually want to do
 * about it. Rendered once, by the shell, at the trigger's rectangle.
 */
@Component({
  selector: 'lf-user-hover-host',
  standalone: true,
  imports: [RouterLink, DecimalPipe, AvatarComponent, IconComponent],
  template: `
    @if (user(); as u) {
      <div class="card" role="dialog" aria-label="{{ u.displayName }}'s profile" [style.top.px]="place().top"
           [style.left.px]="place().left" (mouseenter)="hover.show(u.id, anchorOrThis())" (mouseleave)="hover.hideSoon()"
           (keydown.escape)="hover.close()">
        <a class="head" [routerLink]="'/user/' + u.id" (click)="hover.close()">
          <lf-avatar [src]="avatar()" [name]="u.displayName" [size]="64" [ring]="true" />
          <div class="who">
            <strong>{{ u.displayName }}@if (u.verified) { <lf-icon name="check" [size]="13" /> }</strong>
            <span class="handle">{{ '@' + u.handle }}</span>
            @if (u.bio) { <span class="bio">{{ u.bio }}</span> }
            <span class="meta">
              {{ u.followers > 99 ? (u.followers / 1000 | number: '1.1') + 'k' : u.followers }} followers ·
              {{ placeOf(u) }}
            </span>
          </div>
        </a>
        @if (!isMine()) {
        <div class="acts">
          <button type="button" class="lf-pill" [class.on]="following()" [disabled]="busy()" (click)="follow(u.id)">
            {{ busy() ? '…' : following() ? 'Following' : '+ Follow' }}
          </button>
          <button type="button" class="lf-pill ghost" [disabled]="busy()" (click)="message(u.id)">
            <lf-icon name="chat" [size]="15" /> {{ mutual() ? 'Message' : 'Follow to message' }}
          </button>
          <a class="lf-pill ghost" [routerLink]="'/user/' + u.id" (click)="hover.close()">View profile</a>
        </div>
        }
        @if (note()) { <p class="note" role="status">{{ note() }}</p> }
      </div>
    }
  `,
  styles: [`
    :host { position: static; }
    .card { position: fixed; z-index: 1400; width: min(330px, calc(100vw - 20px)); display: flex; flex-direction: column;
      gap: 10px; padding: 14px; border: 1px solid var(--lf-line-soft); border-radius: 10px; background: var(--lf-card);
      color: var(--ion-text-color); box-shadow: var(--lf-shadow); animation: lf-hover-in .12s ease-out; box-sizing: border-box; }
    @keyframes lf-hover-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
    .head { display: flex; gap: 12px; align-items: flex-start; color: inherit; text-decoration: none; min-width: 0; }
    .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .who strong { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
    .handle { color: var(--lf-muted); font-size: 12.5px; }
    .bio { font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .meta { color: var(--lf-muted); font-size: 12px; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .lf-pill { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--lf-primary-fill); background: var(--lf-primary-fill); color: var(--lf-primary-text);
      font: inherit; font-size: 13px; font-weight: 600; text-decoration: none; }
    .lf-pill.on, .lf-pill.ghost { background: none; color: var(--lf-primary-text); border-color: var(--lf-line); }
    .lf-pill.ghost { color: var(--lf-link); }
    .lf-pill[disabled] { opacity: .6; cursor: default; }
    .note { margin: 0; font-size: 12px; color: var(--lf-muted); }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  `]
})
export class UserHoverCardComponent {
  protected hover = inject(UserHoverService);
  private data = inject(DataService);
  private auth = inject(AuthService);
  private chat = inject(ChatService);
  private actions = inject(PostActionsService);
  private router = inject(Router);
  private el = inject(ElementRef);

  readonly busy = signal(false);
  readonly note = signal('');
  private follows = signal(false);
  private followsFor = '';

  readonly user = computed(() => {
    const id = this.hover.userId();
    if (!id) return null;
    // Reading a profile the feed has never cached is the one case that needs a
    // fetch; the signal below re-runs when it lands.
    void this.followingFor(id);
    return this.data.authorOf(id) ?? null;
  });

  readonly following = computed(() => {
    const id = this.hover.userId();
    return !!id && this.followsFor === id && this.follows();
  });
  readonly mutual = computed(() => {
    const id = this.hover.userId();
    return !!id && this.data.followingIds().includes(id) && this.data.followerIds().includes(id);
  });

  /** The card sits under the name, or above it when the bottom of the screen is near. */
  place(): { top: number; left: number } {
    const box = this.hover.box();
    const host = this.el.nativeElement as HTMLElement;
    const height = host.querySelector('.card')?.getBoundingClientRect().height || 190;
    const width = 330;
    if (!box) return { top: 0, left: 0 };
    const below = box.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 8) : below;
    const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 12);
    return { top, left };
  }

  /** Escape closes it from anywhere, which is what a keyboard user expects. */
  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.hover.close();
  }

  /** The card's own element, so moving the pointer into it keeps it open. */
  anchorOrThis(): HTMLElement {
    return this.el.nativeElement as HTMLElement;
  }

  /** Your own hovercard offers the profile, not a button to follow yourself. */
  isMine(): boolean {
    return this.hover.userId() === this.auth.viewerId;
  }

  avatar(): string {
    return this.data.avatarFor(this.user());
  }

  placeOf(u: UserProfile): string {
    const town = u.town?.trim();
    const province = u.province ? provinceName(u.province) : '';
    return [town, province].filter(Boolean).join(', ') || 'South Africa';
  }

  private nowMessage(now: boolean): string {
    return now ? 'You will see their posts in your feed' : 'Unfollowed';
  }

  private followingFor(id: string): void {
    if (this.followsFor === id) return;
    this.followsFor = id;
    void this.data.isFollowing(id).then((v) => {
      if (this.hover.userId() === id) this.follows.set(v);
    }).catch(() => undefined);
  }

  async follow(id: string): Promise<void> {
    if (!this.auth.signedIn()) {
      this.note.set('Sign in to follow people.');
      return;
    }
    this.busy.set(true);
    try {
      const now = await this.data.toggleFollow(id);
      this.follows.set(now);
      await this.actions.toast(this.nowMessage(now));
      await this.data.loadUserScoped().catch(() => undefined);
    } catch (e: unknown) {
      this.note.set(e instanceof Error ? e.message : 'Could not change that follow.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * A thread exists between people who follow each other, so the button says which
   * of the two it is doing - and never promises a message that will be refused.
   */
  async message(id: string): Promise<void> {
    if (!this.auth.signedIn()) {
      this.note.set('Sign in to message members.');
      return;
    }
    if (!this.mutual()) {
      this.note.set('You can message each other once you follow them and they follow you back.');
      return;
    }
    this.hover.close();
    const thread = await this.chat.ensureThread(null, id, 'friend').catch(() => null);
    if (thread) await this.router.navigate(['/chat', thread.id]);
    else await this.router.navigate(['/chats']);
  }
}
