import { Component, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Post, POST_TYPE_META, UserProfile, provinceName } from '../../core/models/types';
import { compact, timeAgo, urgency } from '../../core/utils/format';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { ReactionsSheetComponent } from './reactions-sheet.component';
import { PosterVisualComponent } from './poster-visual.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { SearchFocus, searchFocus } from '../../core/utils/search-focus';

export type ChatState = 'off' | 'locked-vote' | 'locked-follow' | 'open';

/**
 * Facebook-style feed card:
 * Author row with Facebook Follow link, post text, media,
 * Facebook engagement stats bar (Likes/Comments/Shares),
 * and Facebook action bar (Like / Comment / Share).
 */
@Component({
  selector: 'lf-post-card',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent, ReactionsSheetComponent, PosterVisualComponent],
  template: `
    <article class="fb-card lf-fade-in"
             [class.fb-card--critical]="isCritical()"
             [class.fb-card--found]="post.status === 'found'"
             [class.fb-card--preview]="preview">
      <header class="fb-card-header" [routerLink]="preview ? null : authorRoute()">
        <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="40"
                   [status]="authorStatus()" />
        <div class="fb-author-meta">
          <div class="fb-author-row">
            <span class="fb-author-name">{{ authorName() }}</span>
            @if (showFollow()) {
              <span class="fb-dot">·</span>
              <button class="fb-follow-link" [class.on]="followingAuthor()" [class.requested]="followRequested()"
                      [attr.aria-pressed]="followingAuthor() || followRequested()" (click)="onFollow($event)">
                {{ followingAuthor() ? 'Following' : followRequested() ? 'Requested' : 'Follow' }}
              </button>
            }
          </div>
          <div class="fb-sub-meta">
            <span>{{ timeAgo(post.updatedAt) }}</span>
            <span class="fb-dot">·</span>
            <span>{{ provinceName(post.province) }}</span>
            <span class="fb-dot">·</span>
            <lf-icon name="users" [size]="12" />
          </div>
        </div>
        <button class="fb-more-btn" (click)="onMore($event)" aria-label="More options">
          <lf-icon name="more" [size]="18" />
        </button>
      </header>

      <div class="fb-chips">
        <span class="fb-chip" [class.fb-chip--danger]="post.type === 'missing' || post.type === 'danger'"
              [class.fb-chip--success]="post.status === 'found'">
          <lf-icon [name]="meta().icon" [size]="12" /> {{ statusLabel() }}
        </span>
        @if (post.reward) { <span class="fb-chip fb-chip--beacon">Reward offered</span> }
        @if (post.escalation.consentGranted) {
          <span class="fb-chip fb-chip--success">Family notified</span>
        }
      </div>

      <div class="fb-card-body" [routerLink]="preview ? null : '/post/' + post.id">
        @if (posterType()) {
          <lf-poster-visual [post]="post" [showPhoto]="posterShowsPhoto()" />
        } @else {
        <h3 class="fb-post-title">{{ post.title }}</h3>
        @if (post.type === 'vehicle') {
          <div class="fb-fact-row">
            <lf-icon name="car" [size]="14" />
            <span><strong>Stolen vehicle:</strong> {{ post.subject?.vehicle || post.title }}</span>
          </div>
        } @else if (post.type === 'pet') {
          <div class="fb-fact-row">
            <lf-icon name="paw" [size]="14" />
            <span><strong>Lost pet:</strong> {{ post.subject?.name || 'Pet' }}</span>
          </div>
        } @else if (post.subject?.name && post.type !== 'story' && post.type !== 'danger') {
          <div class="fb-fact-row">
            <lf-icon name="user" [size]="14" />
            <strong>{{ post.subject.name }}</strong>
            @if (post.subject && post.subject.age !== null) {
              <span class="fb-muted">· {{ post.subject.age }} {{ ageWord() }}</span>
            }
          </div>
        }
        @if (post.lastSeenWhere) {
          <div class="fb-fact-row">
            <lf-icon name="pin" [size]="14" />
            <span>Last seen: {{ post.lastSeenWhere }}</span>
          </div>
        }
        <p class="fb-post-text" [class.lf-clamp-4]="!expanded()">{{ post.body }}</p>
        @if (longBody()) {
          <button class="fb-readmore" (click)="toggleExpand($event)">
            {{ expanded() ? 'See less' : 'See more' }}
          </button>
        }
        }
      </div>

      @if (post.media.length && !posterShowsPhoto()) {
        <div class="fb-media" [routerLink]="preview ? null : '/post/' + post.id">
          @if (post.media.length === 1) {
            <img class="fb-media-img" [src]="post.media[0].src" [alt]="post.title" loading="lazy" />
          } @else {
            <div class="fb-grid" [attr.data-count]="visibleMedia().length">
              @for (m of visibleMedia(); track m.id; let i = $index) {
                <div class="fb-grid__tile">
                  <img [src]="m.src" [alt]="m.caption ?? ''" loading="lazy" />
                  @if (i === visibleMedia().length - 1 && extraMedia() > 0) {
                    <span class="fb-grid__more">+{{ extraMedia() }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Facebook reaction summary: who reacted, not just how many. Tap to see faces. -->
      @if (post.upvotes > 0 || post.downvotes > 0 || post.commentCount > 0 || post.shares > 0) {
        <div class="fb-stats-bar">
          <div class="fb-stats-likes">
            @if (post.upvotes > 0 || post.downvotes > 0) {
              <button class="fb-reacted" type="button" (click)="openReactions($event)" aria-label="See who reacted">
                <span class="fb-stack">
                  @for (u of reactedPreview(); track u.id) {
                    <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="20" />
                  }
                  @if (!reactedPreview().length) {
                    <span class="fb-like-icon"><lf-icon name="bulb" [size]="11" [weight]="2.6" /></span>
                  }
                </span>
                <span class="fb-reacted__txt">{{ reactedLabel() }}</span>
              </button>
            }
          </div>
          <div class="fb-stats-right" [routerLink]="preview ? null : '/post/' + post.id">
            @if (post.commentCount > 0) { <span>{{ compact(post.commentCount) }} {{ post.commentCount === 1 ? 'comment' : 'comments' }}</span> }
            @if (post.shares > 0) { <span>{{ compact(post.shares) }} {{ post.shares === 1 ? 'share' : 'shares' }}</span> }
          </div>
        </div>
      }

      <!-- Facebook action bar: Idea / No idea / Comment / Share -->
      <div class="fb-actions-row">
        <button class="fb-action-btn" [class.active]="myVote() === 'up'" [attr.aria-pressed]="myVote() === 'up'" (click)="onVote('up')">
          <lf-icon name="bulb" [size]="20" [filled]="myVote() === 'up'" />
          <span>Idea</span>
        </button>

        <button class="fb-action-btn" [class.active-down]="myVote() === 'down'" [attr.aria-pressed]="myVote() === 'down'" (click)="onVote('down')">
          <lf-icon name="bulbOff" [size]="20" />
          <span>No idea</span>
        </button>

        <button class="fb-action-btn" (click)="comment.emit()">
          <lf-icon name="comment" [size]="19" />
          <span>Comment</span>
        </button>

        <button class="fb-action-btn" (click)="share.emit()">
          <lf-icon name="share" [size]="19" />
          <span>Share</span>
        </button>
      </div>

      @if (post.chatEnabled && !isMine()) {
        <button class="fb-chat-cta" [class.open]="chatState === 'open'" (click)="chat.emit()">
          <lf-icon [name]="chatState === 'open' ? 'unlock' : 'lock'" [size]="15" />
          {{ chatLabel() }}
        </button>
      }

      <lf-reactions-sheet [post]="post" [open]="showReactions()" (close)="showReactions.set(false)" />
    </article>
  `,
  styles: [`
    /* Mobile Facebook: edge-to-edge cards separated by the grey page. */
    .fb-card {
      background: var(--lf-card);
      margin: 0 0 8px;
      overflow: hidden;
      box-shadow: var(--lf-shadow);
      position: relative;
    }
    .fb-card--critical { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-signal); }
    .fb-card--found { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-ubuntu); }
    .fb-card--preview .fb-card-header,
    .fb-card--preview .fb-card-body,
    .fb-card--preview .fb-media,
    .fb-card--preview .fb-stats-bar,
    .fb-card--preview .fb-stats-right { cursor: default; }
    @media (min-width: 700px) {
      .fb-card { border-radius: var(--lf-radius); max-width: var(--lf-maxw); margin: 0 auto 12px; }
    }

    .fb-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 8px 0 16px;
      cursor: pointer;
    }
    .fb-author-meta { flex: 1; min-width: 0; }
    .fb-author-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .fb-author-name { font-weight: 600; font-size: 15px; color: var(--ion-text-color);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fb-dot { color: var(--lf-muted); font-size: 13px; }
    .fb-follow-link {
      background: none;
      border: 0;
      color: var(--lf-link);
      font-family: inherit;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
    }
    .fb-follow-link.on,
    .fb-follow-link.requested { color: var(--lf-muted); }
    .fb-sub-meta {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 13px;
      color: var(--lf-muted);
      margin-top: 1px;
    }
    .fb-more-btn {
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none;
      border: 0;
      color: var(--lf-muted);
      cursor: pointer;
      border-radius: 50%;
      align-self: flex-start;
    }
    .fb-more-btn:hover { background: var(--lf-hover); }

    .fb-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 16px 0; }
    .fb-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
      background: var(--lf-card-2); color: var(--ion-text-color);
    }
    .fb-chip--danger { background: color-mix(in srgb, var(--lf-signal) 12%, transparent); color: var(--lf-signal); }
    .fb-chip--success { background: color-mix(in srgb, var(--lf-ubuntu) 14%, transparent); color: var(--lf-ubuntu); }
    .fb-chip--beacon { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }

    .fb-card-body { padding: 8px 16px 12px; cursor: pointer; }
    .fb-post-title { font-size: 17px; font-weight: 700; color: var(--ion-text-color); margin: 0 0 4px; line-height: 1.3; }
    .fb-fact-row { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--lf-muted); margin-bottom: 3px; }
    .fb-fact-row strong { color: var(--ion-text-color); font-weight: 600; }
    .fb-muted { color: var(--lf-muted); }
    .fb-post-text { font-size: 15px; color: var(--ion-text-color); line-height: 1.34; margin: 6px 0 0; white-space: pre-line; }
    .fb-readmore { background: none; border: 0; color: var(--lf-muted); font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer; padding: 0; margin-top: 2px; }
    .fb-readmore:hover { text-decoration: underline; }

    .fb-media { width: 100%; overflow: hidden; background: var(--lf-card-2); cursor: pointer; }
    .fb-media-img { width: 100%; object-fit: cover; max-height: 520px; display: block; }
    .fb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    .fb-grid[data-count="3"] .fb-grid__tile:first-child { grid-column: 1 / -1; aspect-ratio: 2 / 1; }
    .fb-grid__tile { position: relative; aspect-ratio: 1 / 1; overflow: hidden; }
    .fb-grid__tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .fb-grid__more {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .45); color: #fff;
      font-size: 30px; font-weight: 700;
    }

    .fb-stats-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0 16px;
      padding: 10px 0;
      font-size: 15px;
      color: var(--lf-muted);
      cursor: pointer;
    }
    .fb-stats-likes { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .fb-like-icon {
      width: 18px; height: 18px; border-radius: 50%;
      background: linear-gradient(180deg, #18afff, #0062df); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 2px var(--lf-card);
    }
    .fb-reacted {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 2px 4px 2px 0;
      min-width: 0;
      text-align: left;
    }
    .fb-reacted:hover .fb-reacted__txt { text-decoration: underline; }
    .fb-stack { display: inline-flex; align-items: center; flex-shrink: 0; }
    .fb-stack lf-avatar { margin-left: -7px; box-shadow: 0 0 0 2px var(--lf-card); border-radius: 50%; }
    .fb-stack lf-avatar:first-child { margin-left: 0; }
    .fb-reacted__txt {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-size: 14px;
    }
    .fb-stats-right { display: flex; align-items: center; gap: 12px; cursor: pointer; flex-shrink: 0; }

    .fb-actions-row {
      display: flex;
      align-items: center;
      margin: 0 12px;
      padding: 4px 0;
      border-top: 1px solid var(--lf-line-soft);
    }
    .fb-action-btn {
      flex: 1;
      min-width: 0;
      height: 36px;
      border: 0;
      background: transparent;
      color: var(--lf-muted);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      cursor: pointer;
      border-radius: 4px;
      white-space: nowrap;
    }
    .fb-action-btn:hover, .fb-action-btn:active { background: var(--lf-hover); }
    .fb-action-btn.active { color: var(--lf-primary); }
    .fb-action-btn.active-down { color: var(--lf-signal); }
    @media (max-width: 370px) {
      .fb-action-btn span { font-size: 13px; }
    }

    .fb-chat-cta {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: calc(100% - 24px); margin: 0 12px 10px;
      height: 36px; border: 0; border-radius: 6px;
      background: var(--lf-card-2);
      color: var(--ion-text-color); font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .fb-chat-cta.open { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }

  `]
})
export class PostCardComponent implements OnInit, OnChanges {
  private router = inject(Router);
  private lookOn = signal<boolean | null>(null);
  @Input({ required: true }) post!: Post;
  @Input() author: UserProfile | null = null;
  @Input() chatState: ChatState = 'off';
  /**
   * The composer's Generate preview: the exact feed card, but every link and
   * action is inert so a tap cannot vote, follow or navigate mid-preview.
   */
  @Input() preview = false;

  @Output() vote = new EventEmitter<'up' | 'down'>();
  @Output() comment = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();
  @Output() chat = new EventEmitter<void>();
  @Output() more = new EventEmitter<Post>();
  @Output() savedChange = new EventEmitter<void>();
  @Output() follow = new EventEmitter<Post>();

  protected data = inject(DataService);
  private auth = inject(AuthService);

  saved = signal(false);
  followingAuthor = signal(false);
  followRequested = signal(false);
  expanded = signal(false);
  /** “Who reacted” sheet. */
  showReactions = signal(false);
  /** First few Idea voters, for the face stack. Loaded lazily per card. */
  reactedPreview = signal<UserProfile[]>([]);
  private reactedFor = '';

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
  readonly authorStatus = computed(() =>
    this.post?.anonymous && !this.isMine() ? null : this.data.statusOf(this.author));
  readonly statusWord = computed(() => {
    const s = this.authorStatus();
    return s ? CHECK_IN_COPY[s].short : '';
  });
  readonly authorRoute = computed(() =>
    this.post?.anonymous && !this.isMine() ? ['/post/' + this.post.id] : ['/user/' + (this.author?.id ?? '')]
  );
  readonly longBody = computed(() => (this.post?.body?.trim().length ?? 0) > 190);

  readonly visibleMedia = computed(() => this.post?.media.slice(0, 4) ?? []);
  readonly extraMedia = computed(() => Math.max(0, (this.post?.media.length ?? 0) - 4));

  /** Case posts render as generated posters; plain status posts keep the classic body. */
  readonly posterType = computed(() => !!this.post && this.post.type !== 'story');
  /**
   * A single photo lives inside the poster. A video or a gallery stays in the
   * media grid below it, and the poster renders text-only.
   */
  readonly posterShowsPhoto = computed(() =>
    this.posterType() && this.post.media.length === 1 && this.post.media[0].kind === 'image'
  );

  readonly showFollow = computed(() => {
    if (this.isMine()) return false;
    if (this.post?.anonymous) return false;
    return !!this.author?.id;
  });

  async ngOnInit(): Promise<void> {
    this.syncFollow();
    this.saved.set(this.data.savedIds().includes(this.post?.id ?? ''));
    void this.loadReactedPreview();
  }

  ngOnChanges(): void {
    this.syncFollow();
    void this.loadReactedPreview();
  }

  /** First names of the people behind the Idea count, Facebook-style. */
  reactedLabel(): string {
    if (!this.post) return '';
    const names = this.reactedPreview().map((u) => u.displayName.split(' ')[0]);
    const total = this.post.upvotes;
    if (!total) return this.post.downvotes ? `${compact(this.post.downvotes)} no idea` : '';
    if (!names.length) return `${compact(total)} ${total === 1 ? 'idea' : 'ideas'}`;
    if (total === 1) return names[0] ?? '1 idea';
    if (total === 2 && names.length >= 2) return `${names[0]} and ${names[1]}`;
    if (names.length >= 2) return `${names[0]}, ${names[1]} and ${compact(total - 2)} other${total - 2 === 1 ? '' : 's'}`;
    return `${names[0]} and ${compact(total - 1)} other${total - 1 === 1 ? '' : 's'}`;
  }

  openReactions(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.preview) return;
    this.showReactions.set(true);
  }

  private async loadReactedPreview(): Promise<void> {
    const id = this.post?.id ?? '';
    if (!id || this.reactedFor === id + ':' + this.post.upvotes) return;
    this.reactedFor = id + ':' + this.post.upvotes;
    const ids = Object.entries(this.post.voterIds ?? {})
      .filter(([, v]) => v === 'up').map(([uid]) => uid).slice(0, 3);
    if (!ids.length) { this.reactedPreview.set([]); return; }
    const cached = ids.map((uid) => this.data.authorOf(uid)).filter((u): u is UserProfile => !!u);
    const missing = ids.filter((uid) => !cached.some((u) => u.id === uid));
    if (!missing.length) { this.reactedPreview.set(cached); return; }
    try {
      const fresh = await this.data.people(missing);
      for (const u of fresh) this.data.touchAuthor(u);
      this.reactedPreview.set(ids.map((uid) =>
        cached.find((u) => u.id === uid) ?? fresh.find((u) => u.id === uid)
      ).filter((u): u is UserProfile => !!u));
    } catch { this.reactedPreview.set(cached); }
  }

  private syncFollow(): void {
    const id = this.post?.authorId;
    if (!id) return;
    void this.data.followStatus(id).then((status) => {
      this.followingAuthor.set(status === 'accepted');
      this.followRequested.set(status === 'pending');
    });
  }

  async onFollow(e: Event): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (!this.post || this.preview) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { mode: 'signin', next: this.router.url } });
      return;
    }
    try {
      await this.data.toggleFollow(this.post.authorId);
      const status = await this.data.followStatus(this.post.authorId);
      this.followingAuthor.set(status === 'accepted');
      this.followRequested.set(status === 'pending');
      this.follow.emit(this.post);
    } catch { /* the profile has a full follow control with feedback */ }
  }

  statusLabel(): string {
    if (!this.post) return '';
    if (this.post.status === 'found') return 'Found - home safe';
    return POST_TYPE_META[this.post.type].label;
  }

  ageWord(): string {
    const age = this.post.subject?.age ?? 0;
    return age === 1 ? 'year old' : 'years old';
  }

  chatLabel(): string {
    switch (this.chatState) {
      case 'open': return 'Private chat is open';
      case 'locked-follow': return 'Follow each other to chat';
      case 'locked-vote': return 'Upvote to unlock chat';
      default: return 'Chat with poster';
    }
  }

  toggleExpand(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.expanded.update((v) => !v);
  }

  onVote(v: 'up' | 'down'): void {
    if (this.preview) return;
    this.vote.emit(v);
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
