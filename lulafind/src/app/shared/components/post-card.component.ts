import { Component, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Post, POST_TYPE_META, UserProfile, provinceName } from '../../core/models/types';
import { compact, timeAgo, urgency } from '../../core/utils/format';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { SearchFocus, searchFocus } from '../../core/utils/search-focus';

export type ChatState = 'off' | 'locked-vote' | 'locked-follow' | 'open';

/**
 * Quora-style feed card: author row, chips, title, body preview, media, counters,
 * then the action bar (Idea / No idea / Comment / Share / Save) and the
 * chat-unlock CTA.
 */
@Component({
  selector: 'lf-post-card',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent],
  template: `
    <article class="lf-card lf-fade-in"
             [class.lf-card--critical]="isCritical()"
             [class.lf-card--found]="post.status === 'found'"
             [class.lf-card--khumbu]="post.type === 'khumbulekhaya'"
             [class.lf-card--danger]="post.type === 'danger' && !post.danger?.clearedAt"
             [class.lf-card--clear]="!!post.danger?.clearedAt">
      @if (post.status === 'found') {
        <span class="home-stamp" aria-hidden="true">HOME</span>
      }
      @if (post.danger?.clearedAt) {
        <span class="home-stamp clear" aria-hidden="true">CLEAR</span>
      }

      <header class="row" [routerLink]="authorRoute()">
        <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="38"
                   [status]="authorStatus()" />
        <div class="grow">
          <div class="who">
            <span class="name">{{ authorName() }}</span>
            @if (statusWord()) {
              <span class="status-word" [attr.data-status]="authorStatus()">{{ statusWord() }}</span>
            }
            @if (author?.verified) { <lf-icon name="award" [size]="13" /> }
            @if (post.anonymous && !isMine()) { <span class="lf-chip lf-chip--ghost lf-tiny">anonymous</span> }
            @if (showFollow()) {
              <button class="follow" [class.on]="followingAuthor()" (click)="onFollow($event)">
                <lf-icon [name]="followingAuthor() ? 'check' : 'plus'" [size]="12" />
                {{ followingAuthor() ? 'Following' : 'Follow' }}
              </button>
            }
          </div>
          <div class="lf-meta">
            <span>{{ roleLine() }}</span>
            <span class="dot">·</span>
            <span>{{ timeAgo(post.updatedAt) }}</span>
          </div>
        </div>
        <button class="lf-icon-btn" (click)="onMore($event)">
          <lf-icon name="more" [size]="18" />
        </button>
      </header>

      <div class="chips">
        <span class="lf-chip" [class.lf-chip--danger]="post.type === 'missing' || (post.type === 'danger' && !post.danger?.clearedAt)"
              [class.lf-chip--warn]="post.type === 'khumbulekhaya'"
              [class.lf-chip--success]="post.status === 'found' || !!post.danger?.clearedAt">
          <lf-icon [name]="meta().icon" [size]="12" /> {{ statusLabel() }}
        </span>
        @if (isCritical()) {
          <span class="lf-chip lf-chip--danger lf-pulse"><lf-icon name="alert" [size]="12" /> First 72 hours</span>
        }
        @if (post.reward) { <span class="lf-chip lf-chip--beacon">Reward offered</span> }
        @if (post.escalation.consentGranted) {
          <span class="lf-chip lf-chip--success"><lf-icon name="phone" [size]="12" /> Family called</span>
        }
        @if (post.audience !== 'public') {
          <span class="lf-chip lf-chip--ghost"><lf-icon name="lock" [size]="12" /> {{ audienceLabel() }}</span>
        }
      </div>

      <div class="lf-card__body" [routerLink]="'/post/' + post.id">
        <h3 class="lf-title">{{ post.title }}</h3>
        @if (post.subject?.name) {
          <div class="fact who">
            <lf-icon name="user" [size]="13" />
            <strong>{{ post.subject.name }}</strong>
            @if (post.subject && post.subject.age !== null) {
              <span class="lf-muted">· {{ post.subject.age }} {{ ageWord() }}</span>
            }
          </div>
        }
        <div class="fact where">
          <lf-icon name="pin" [size]="13" />
          <span><strong>{{ provinceName(post.province) }}</strong>
            @if (post.town) { <span class="lf-muted"> · {{ post.town }}</span> }</span>
          @if (post.type === 'danger' && post.lastSeenWhere) {
            <small>{{ post.danger?.clearedAt ? 'Cleared' : 'Reported' }} {{ timeAgo(post.danger?.clearedAt ?? post.createdAt) }} · {{ post.lastSeenWhere }}</small>
          } @else if (post.lastSeenWhere) {
            <small>Last seen {{ timeAgo(post.lastSeenAt) }} · {{ post.lastSeenWhere }}</small>
          }
        </div>
        <p class="lf-prose preview" [class.lf-clamp-4]="!expanded()">{{ post.body }}</p>
        @if (longBody()) {
          <button class="readmore" (click)="toggleExpand($event)">
            {{ expanded() ? 'Show less' : 'Read more' }}
            <lf-icon [name]="expanded() ? 'chevronDown' : 'chevronRight'" [size]="13" />
          </button>
        }
        @if (post.khumbu?.subjectResponse === 'not_going_home') {
          <div class="answered">
            <lf-icon name="check" [size]="14" />
            <span>They answered: <strong>safe, but not coming home</strong></span>
          </div>
        }
        @if (post.khumbu?.subjectResponse === 'going_home') {
          <div class="answered ok">
            <lf-icon name="home" [size]="14" />
            <span>They answered: <strong>coming home</strong></span>
          </div>
        }
        @if (post.status === 'found' && post.outcome.whereaboutsFound) {
          <div class="answered ok">
            <lf-icon name="award" [size]="14" />
            <span>Found · {{ post.outcome.whereaboutsFound }}</span>
          </div>
        }
      </div>

      @if (post.media.length) {
        <div class="media" [routerLink]="'/post/' + post.id">
          @if (post.media.length === 1) {
            @if (post.media[0].kind === 'video') {
              <div class="vid"><video [src]="post.media[0].src" preload="metadata" class="lf-media"></video>
                <span class="play"><lf-icon name="video" [size]="20" /></span></div>
            } @else {
              <img class="lf-media" [src]="post.media[0].src" [alt]="post.media[0].caption ?? post.title" loading="lazy" decoding="async" />
            }
          } @else {
            <div class="lf-grid-2">
              @for (m of visibleMedia(); track m.id; let i = $index; let last = $last) {
                <div class="cell">
                  <img class="lf-media" [src]="m.src" [alt]="m.caption ?? ''" loading="lazy" decoding="async" />
                  @if (last && hiddenCount() > 0) {
                    <span class="more">+{{ hiddenCount() }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      @if (focus(); as f) {
        <div class="look" [attr.data-ring]="f.ring">
          <span>
            <strong>{{ f.title }}</strong>
            <em>{{ f.where }}@if (lookCount()) { · {{ lookCount() }} looking }</em>
          </span>
          @if (!isMine()) {
            <button type="button" [class.on]="looking()" (click)="onLook($event)">
              {{ looking() ? 'Looking' : "I'm looking" }}
            </button>
          }
        </div>
      }

      <div class="counters" [routerLink]="'/post/' + post.id">
        @if (post.type === 'danger') {
          <span class="counter">{{ post.danger?.stillIds?.length ?? 0 }} say still happening</span>
          <span class="counter">{{ post.danger?.clearIds?.length ?? 0 }} say it is clear</span>
        } @else if (post.upvotes > 0) {
          <span class="counter"><lf-icon name="bulb" [size]="12" /> {{ compact(post.upvotes) }} have an idea</span>
        }
        @if (post.commentCount > 0) { <span class="counter">{{ compact(post.commentCount) }} comments</span> }
        @if (post.shares > 0) { <span class="counter">{{ compact(post.shares) }} shares</span> }
        @if (post.views > 0) { <span class="counter right">{{ compact(post.views) }} views</span> }
      </div>

      <div class="lf-actions">
        @if (post.type === 'danger') {
          <button class="lf-action lf-action--down" [class.lf-on]="dangerMine() === 'still'" (click)="onDanger(true)"
                  aria-label="Still happening">
            <lf-icon name="alert" [size]="18" /> <span>Still happening</span>
          </button>
          <button class="lf-action lf-action--up" [class.lf-on]="dangerMine() === 'clear'" (click)="onDanger(false)"
                  aria-label="It is clear">
            <lf-icon name="check" [size]="18" /> <span>It's clear</span>
          </button>
        } @else {
        <button class="lf-action lf-action--up" [class.lf-on]="myVote() === 'up'" (click)="onVote('up')"
                aria-label="I have an idea">
          <lf-icon [name]="myVote() === 'up' ? 'bulb' : 'bulb'" [size]="18" /> <span>Idea</span>
        </button>
        <button class="lf-action lf-action--down" [class.lf-on]="myVote() === 'down'" (click)="onVote('down')"
                aria-label="I have no idea">
          <lf-icon name="bulbOff" [size]="18" /> <span>No idea</span>
        </button>
        }
        <button class="lf-action" (click)="comment.emit()">
          <lf-icon name="comment" [size]="18" /> <span>Comment</span>
        </button>
        <button class="lf-action" (click)="share.emit()">
          <lf-icon name="share" [size]="18" /> <span>Share</span>
        </button>
        <button class="lf-action lf-action--save" [class.lf-on]="saved()" (click)="onSave()">
          <lf-icon name="bookmark" [size]="18" />
        </button>
      </div>

      @if (post.chatEnabled && !isMine()) {
        <button class="chatcta" (click)="chat.emit()">
          <lf-icon [name]="chatState === 'open' ? 'unlock' : 'lock'" [size]="15" />
          {{ chatLabel() }}
        </button>
      }
    </article>
  `,
  styles: [`
    .row { display: flex; align-items: center; gap: 10px; padding: 12px 14px 0; }
    .grow { flex: 1; min-width: 0; }
    .who { display: flex; align-items: center; gap: 5px; font-weight: 700; font-size: 14.5px; flex-wrap: wrap; }
    .who lf-icon { color: var(--lf-beacon); }
    .status-word { font-size: 11px; font-weight: 800; letter-spacing: .1px; padding: 2px 7px; border-radius: 999px; }
    .status-word[data-status="safe"] { color: var(--lf-ubuntu); background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); }
    .status-word[data-status="unfamiliar"] { color: var(--lf-marigold); background: color-mix(in srgb, var(--lf-marigold) 18%, transparent); }
    .status-word[data-status="need_help"] { color: var(--lf-signal); background: color-mix(in srgb, var(--lf-signal) 16%, transparent); }
    .look { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin: 8px 14px 0; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--lf-line); }
    .look strong { display: block; font-size: 13px; }
    .look em { display: block; font-style: normal; font-size: 12px; color: var(--lf-muted); }
    .look button { border: 0; border-radius: 999px; padding: 7px 10px; font-weight: 800; font-size: 12px;
      background: var(--lf-beacon); color: #1a1200; cursor: pointer; }
    .look button.on { background: color-mix(in srgb, var(--lf-ubuntu) 22%, transparent); color: var(--lf-ubuntu); }
    .look button:active { transform: scale(.96); }
    .look[data-ring="green"] { border-color: color-mix(in srgb, var(--lf-ubuntu) 45%, transparent); }
    .look[data-ring="amber"] { border-color: color-mix(in srgb, var(--lf-marigold) 50%, transparent); }
    .look[data-ring="red"] { border-color: color-mix(in srgb, var(--lf-signal) 45%, transparent); }
    .dot { opacity: .5; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 14px 0; }
    .lf-card__body { padding: 10px 16px 12px; }
    .fact { display: flex; align-items: baseline; gap: 6px; font-size: 13px; margin-top: 7px; flex-wrap: wrap; }
    .fact lf-icon { color: var(--lf-muted); flex: none; transform: translateY(1.5px); }
    .fact small { flex-basis: 100%; padding-left: 19px; font-size: 12px; color: var(--lf-muted); margin-top: 2px; }
    .fact.where { margin: 7px 0 0; }
    .preview { margin: 6px 0 0; opacity: .92; white-space: pre-line; }
    .readmore { display: inline-flex; align-items: center; gap: 3px; margin-top: 6px; padding: 2px 0;
      background: none; border: 0; color: var(--lf-beacon); font-size: 12.5px; font-weight: 800;
      cursor: pointer; }
    .readmore:active { opacity: .7; }
    .answered { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px;
      padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--lf-marigold) 16%, transparent); }
    .answered.ok { background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); }
    .media { border-top: 1px solid var(--lf-line); }
    .cell { position: relative; }
    .more { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: rgba(6, 10, 24, .62); color: #fff; font-size: 24px; font-weight: 800; letter-spacing: -.5px; }
    .vid { position: relative; }
    .play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      color: #fff; background: rgba(6, 10, 24, .3); }
    .follow { display: inline-flex; align-items: center; gap: 3px; margin-left: 4px; padding: 3px 9px;
      border-radius: 999px; border: 1px solid var(--lf-beacon); background: transparent; color: var(--lf-beacon);
      font-size: 11.5px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .follow.on { border-color: var(--lf-line); color: var(--lf-muted); }
    .follow:active { transform: scale(.96); }
    .counters { display: flex; gap: 14px; padding: 8px 16px 0; font-size: 12px; color: var(--lf-muted); flex-wrap: wrap; }
    .counter { display: inline-flex; align-items: center; gap: 5px; }
    .counter.right { margin-left: auto; }
    .lf-card--khumbu { border-color: color-mix(in srgb, var(--lf-marigold) 40%, var(--lf-line)); }
    .chatcta { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
      min-height: 44px; border: 0; border-top: 1px solid var(--lf-line); background: var(--lf-card-2);
      color: var(--lf-beacon); font-weight: 700; font-size: 13.5px; cursor: pointer; }
    .chatcta:active { filter: brightness(1.15); }
    :host { display: block; }
    article { position: relative; }
    article:active { transform: scale(.992); }
    .home-stamp.clear { background: var(--lf-ubuntu); color: #04150c; }
    .home-stamp { position: absolute; top: 46px; right: 14px; z-index: 2; pointer-events: none;
      transform: rotate(-8deg); border: 2px solid var(--lf-ubuntu); color: var(--lf-ubuntu);
      font-size: 11px; font-weight: 900; letter-spacing: 1.4px; padding: 2px 7px; border-radius: 6px;
      background: color-mix(in srgb, var(--lf-card) 82%, transparent);
      animation: stamp-in .5s cubic-bezier(.2,.8,.2,1.3) both; }
    @keyframes stamp-in { from { opacity: 0; transform: rotate(-18deg) scale(1.4); } to { opacity: 1; transform: rotate(-8deg) scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      article:active { transform: none; }
      .home-stamp { animation: none; }
    }
  `]
})
export class PostCardComponent implements OnInit, OnChanges {
  private router = inject(Router);
  private lookOn = signal<boolean | null>(null);
  @Input({ required: true }) post!: Post;
  @Input() author: UserProfile | null = null;
  @Input() chatState: ChatState = 'off';

  @Output() vote = new EventEmitter<'up' | 'down'>();
  @Output() comment = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();
  @Output() chat = new EventEmitter<void>();
  @Output() more = new EventEmitter<Post>();
  @Output() savedChange = new EventEmitter<void>();
  @Output() follow = new EventEmitter<Post>();

  private data = inject(DataService);
  private auth = inject(AuthService);

  saved = signal(false);
  followingAuthor = signal(false);
  /** "Read more" state for long bodies. */
  expanded = signal(false);

  protected readonly compact = compact;
  protected readonly timeAgo = timeAgo;
  protected readonly provinceName = provinceName;

  readonly meta = computed(() => POST_TYPE_META[this.post?.type ?? 'story']);
  readonly isCritical = computed(() => urgency(this.post) === 'critical');
  readonly isMine = computed(() => this.post?.authorId === this.auth.viewerId);
  readonly myVote = computed(() => (this.post ? this.data.myVote(this.post) : null));
  readonly authorName = computed(() =>
    this.post?.anonymous && !this.isMine() ? 'Anonymous' : this.author?.displayName ?? 'LulaFind member'
  );
  readonly authorAvatar = computed(() => this.data.avatarFor(this.post?.anonymous && !this.isMine() ? null : this.author));
  /** Green / amber / red ring when the author has a visible check-in. */
  readonly authorStatus = computed(() =>
    this.post?.anonymous && !this.isMine() ? null : this.data.statusOf(this.author));
  readonly statusWord = computed(() => {
    const s = this.authorStatus();
    return s ? CHECK_IN_COPY[s].short : '';
  });
  readonly authorRoute = computed(() =>
    this.post?.anonymous && !this.isMine() ? ['/post/' + this.post.id] : ['/user/' + (this.author?.id ?? '')]
  );
  /** Only offer "Read more" when the body is actually being cut off. */
  readonly longBody = computed(() => (this.post?.body?.trim().length ?? 0) > 190 ||
    (this.post?.body?.includes('\n\n') ?? false));

  readonly visibleMedia = computed(() => this.post?.media.slice(0, 4) ?? []);
  readonly hiddenCount = computed(() => Math.max(0, (this.post?.media.length ?? 0) - 4));

  /** Hide the Follow button on your own posts and on anonymous ones. */
  readonly showFollow = computed(() => {
    if (this.isMine()) return false;
    if (this.post?.anonymous) return false;
    return !!this.author?.id;
  });

  async ngOnInit(): Promise<void> {
    this.syncFollow();
    this.saved.set(this.data.savedIds().includes(this.post?.id ?? ''));
  }

  ngOnChanges(): void {
    this.lookOn.set(null);
    this.syncFollow();
  }

  focus(): SearchFocus | null {
    return this.post ? searchFocus(this.post) : null;
  }

  looking(): boolean {
    if (this.lookOn() !== null) return this.lookOn()!;
    const me = this.auth.viewerId;
    return !!me && (this.post?.lookingIds ?? []).includes(me);
  }

  lookCount(): number {
    return this.post?.lookingIds?.length ?? 0;
  }

  async onLook(ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.post) return;
    if (!this.auth.signedIn()) {
      void this.router.navigate(['/auth'], { queryParams: { next: '/post/' + this.post.id } });
      return;
    }
    try {
      this.lookOn.set(await this.data.markLooking(this.post.id));
    } catch {
      this.lookOn.set(null);
    }
  }

  private syncFollow(): void {
    const id = this.post?.authorId;
    if (!id) return;
    void this.data.isFollowing(id).then((v) => this.followingAuthor.set(v));
  }

  async onFollow(e: Event): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!this.auth.signedIn() || !this.post) return;
    try {
      this.followingAuthor.set(await this.data.toggleFollow(this.post.authorId));
    } catch {
      /* the caller shows the message */
    }
    this.follow.emit(this.post);
  }

  statusLabel(): string {
    if (!this.post) return '';
    if (this.post.status === 'found') return 'FOUND';
    if (this.post.status === 'not_going_home') return 'Answered';
    if (this.post.status === 'under_review') return 'Under review';
    return POST_TYPE_META[this.post.type].label;
  }

  ageWord(): string {
    const age = this.post.subject?.age ?? 0;
    if (age === 0) return 'months old';
    if (age === 1) return 'year old';
    return 'years old';
  }

  audienceLabel(): string {
    return this.post.audience === 'followers' ? 'Followers only' : 'Spotlight only';
  }

  roleLine(): string {
    const rel = this.post.subject?.relationship;
    if (this.post.anonymous && !this.isMine()) return 'Posted anonymously';
    return rel ? `Reports as: ${rel}` : this.author?.town || provinceName(this.post.province);
  }

  chatLabel(): string {
    switch (this.chatState) {
      case 'open': return 'Private chat is open';
      case 'locked-follow': return 'Follow each other to open chat';
      case 'locked-vote': return 'Upvote to unlock private chat';
      default: return 'Chat with the poster';
    }
  }

  toggleExpand(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.expanded.update((v) => !v);
  }

  onVote(v: 'up' | 'down'): void {
    this.vote.emit(v);
  }

  dangerMine(): 'still' | 'clear' | null {
    const me = this.auth.viewerId;
    if (!me || !this.post.danger) return null;
    if (this.post.danger.stillIds.includes(me)) return 'still';
    if (this.post.danger.clearIds.includes(me)) return 'clear';
    return null;
  }

  async onDanger(still: boolean): Promise<void> {
    try {
      await this.data.respondDanger(this.post.id, still);
    } catch {
      /* sign-in and missing-alert errors stay quiet here; the form already explains sign-in */
    }
  }

  onSave(): void {
    this.saved.update((s) => !s);
    this.savedChange.emit();
  }

  onMore(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.more.emit(this.post);
  }
}
