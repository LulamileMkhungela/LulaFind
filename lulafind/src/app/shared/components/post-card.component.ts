import { Component, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { ToastController } from '@ionic/angular/toast-controller';
import { Post, POST_TYPE_META, UserProfile, provinceName } from '../../core/models/types';
import { compact, timeAgo, urgency } from '../../core/utils/format';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { ReactionsSheetComponent } from './reactions-sheet.component';
import { PosterVisualComponent } from './poster-visual.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

export type ChatState = 'off' | 'locked-vote' | 'locked-follow' | 'open';

/**
 * LinkedIn-style feed card: activity line ("Lerato liked this"), actor header
 * with headline, case chips, the generated poster, reaction summary, the
 * latest comment in full, and the Like / Comment / Repost / Share bar.
 *
 * The words stay LulaFind ("Idea" is the like - the chat gate, notifications
 * and the detail page all speak of ideas), only the shape is LinkedIn. "No
 * idea" lives on the detail page and in the home feed's more-menu so the bar
 * stays four clean actions. Repost is handled inside the card so it works on
 * every screen without each parent wiring it up.
 */
@Component({
  selector: 'lf-post-card',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent, ReactionsSheetComponent, PosterVisualComponent],
  template: `
    <article class="li-card lf-fade-in"
             [class.li-card--critical]="isCritical()"
             [class.li-card--found]="post.status === 'found'"
             [class.li-card--preview]="preview">
      @if (activity(); as act) {
        <div class="li-activity">
          <lf-avatar [src]="data.avatarFor(data.authorOf(act.userId))" [name]="act.displayName" [size]="20" />
          <span><strong>{{ act.displayName }}</strong> {{ act.kind === 'like' ? 'liked this' : 'commented on this' }}</span>
        </div>
      }

      <header class="li-head">
        <div class="li-actor" [routerLink]="preview ? null : authorRoute()">
          <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="48"
                     [status]="authorStatus()" />
          <div class="li-actor-meta">
            <span class="li-name">{{ authorName() }}</span>
            <span class="li-headline">{{ headline() }}</span>
            <span class="li-sub">
              <span>{{ timeAgo(post.updatedAt) }}</span>
              <span>·</span>
              <span>{{ provinceName(post.province) }}</span>
              <span>·</span>
              <lf-icon [name]="audienceIcon()" [size]="12" />
            </span>
          </div>
        </div>
        <div class="li-head-side">
          @if (showFollow()) {
            <button class="li-follow" [class.on]="followingAuthor() || followRequested()"
                    [attr.aria-pressed]="followingAuthor() || followRequested()" (click)="onFollow($event)">
              {{ followingAuthor() ? 'Following' : followRequested() ? 'Requested' : '+ Follow' }}
            </button>
          }
          <button class="li-more" (click)="onMore($event)" aria-label="More options">
            <lf-icon name="more" [size]="20" />
          </button>
        </div>
      </header>

      <div class="li-chips">
        <span class="li-chip" [class.li-chip--danger]="post.type === 'missing' || post.type === 'danger'"
              [class.li-chip--success]="post.status === 'found'">
          <lf-icon [name]="meta().icon" [size]="12" /> {{ statusLabel() }}
        </span>
        @if (post.reward) { <span class="li-chip li-chip--beacon">Reward offered</span> }
        @if (post.escalation.consentGranted) {
          <span class="li-chip li-chip--success">Family notified</span>
        }
      </div>

      @if (post.reshareOf; as orig) {
        <a class="li-reshare" [routerLink]="preview ? null : '/post/' + orig.postId">
          <lf-icon name="refresh" [size]="14" [weight]="2.4" />
          <span>Reshared from <strong>{{ orig.authorName }}</strong> · View original</span>
        </a>
      }

      <div class="li-body" [routerLink]="preview ? null : '/post/' + post.id">
        @if (posterType()) {
          <lf-poster-visual [post]="post" [showPhoto]="posterShowsPhoto()" />
        } @else {
          <h3 class="li-post-title">{{ post.title }}</h3>
          @if (post.subject?.name) {
            <div class="li-fact-row">
              <lf-icon name="user" [size]="14" />
              <strong>{{ post.subject.name }}</strong>
              @if (post.subject && post.subject.age !== null) {
                <span class="li-muted">· {{ post.subject.age }} {{ ageWord() }}</span>
              }
            </div>
          }
          @if (post.lastSeenWhere) {
            <div class="li-fact-row">
              <lf-icon name="pin" [size]="14" />
              <span>Last seen: {{ post.lastSeenWhere }}</span>
            </div>
          }
          <p class="li-post-text" [class.lf-clamp-4]="!expanded()">{{ post.body }}</p>
          @if (longBody()) {
            <button class="li-readmore" (click)="toggleExpand($event)">
              {{ expanded() ? 'See less' : 'See more' }}
            </button>
          }
        }
      </div>

      @if (post.media.length && !posterShowsPhoto()) {
        <div class="li-media" [routerLink]="preview ? null : '/post/' + post.id">
          @if (post.media.length === 1) {
            <img class="li-media-img" [src]="post.media[0].src" [alt]="post.title" loading="lazy" />
          } @else {
            <div class="li-grid" [attr.data-count]="visibleMedia().length">
              @for (m of visibleMedia(); track m.id; let i = $index) {
                <div class="li-grid__tile">
                  <img [src]="m.src" [alt]="m.caption ?? ''" loading="lazy" />
                  @if (i === visibleMedia().length - 1 && extraMedia() > 0) {
                    <span class="li-grid__more">+{{ extraMedia() }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      @if (post.upvotes > 0 || post.downvotes > 0 || post.commentCount > 0 || reposts() > 0) {
        <div class="li-summary">
          <div class="li-reacts">
            @if (post.upvotes > 0 || post.downvotes > 0) {
              <button class="li-reacted" type="button" (click)="openReactions($event)" aria-label="See who reacted">
                <span class="li-badges">
                  @if (post.upvotes > 0) {
                    <span class="li-badge li-badge--like"><lf-icon name="thumbup" [size]="11" [filled]="true" /></span>
                  }
                  @if (post.downvotes > 0) {
                    <span class="li-badge li-badge--down"><lf-icon name="thumbdown" [size]="11" [filled]="true" /></span>
                  }
                </span>
                <span class="li-reacted__txt">{{ reactedLabel() }}</span>
              </button>
            }
          </div>
          <div class="li-counts" [routerLink]="preview ? null : '/post/' + post.id">
            @if (post.commentCount > 0) {
              <span>{{ compact(post.commentCount) }} {{ post.commentCount === 1 ? 'comment' : 'comments' }}</span>
            }
            @if (reposts() > 0) {
              @if (post.commentCount > 0) { <span>·</span> }
              <span>{{ compact(reposts()) }} {{ reposts() === 1 ? 'repost' : 'reposts' }}</span>
            }
          </div>
        </div>
      }

      @if (commentPreview(); as act) {
        <button class="li-comment-preview" type="button" (click)="goComments($event)"
                [attr.aria-label]="'Read ' + act.displayName + '\\'s comment'">
          <lf-avatar [src]="data.avatarFor(data.authorOf(act.userId))" [name]="act.displayName" [size]="32" />
          <span class="li-comment-bubble">
            <span class="li-comment-head"><strong>{{ act.displayName }}</strong> · {{ timeAgo(act.at) }}</span>
            <span class="li-comment-txt">{{ act.body }}</span>
          </span>
        </button>
      }

      <div class="li-actions">
        <button class="li-action" [class.active]="myVote() === 'up'" [attr.aria-pressed]="myVote() === 'up'" (click)="onVote('up')">
          <lf-icon name="thumbup" [size]="20" [filled]="myVote() === 'up'" />
          <span>Idea</span>
        </button>

        <button class="li-action" (click)="comment.emit()">
          <lf-icon name="comment" [size]="20" />
          <span>Comment</span>
        </button>

        <button class="li-action" (click)="repost($event)" [disabled]="reposting()">
          <lf-icon name="refresh" [size]="20" />
          <span>Repost</span>
        </button>

        <button class="li-action" (click)="share.emit()">
          <lf-icon name="send" [size]="19" />
          <span>Share</span>
        </button>
      </div>

      @if (post.chatEnabled && !isMine()) {
        <button class="li-chat-cta" [class.open]="chatState === 'open'" (click)="chat.emit()">
          <lf-icon [name]="chatState === 'open' ? 'unlock' : 'lock'" [size]="15" />
          {{ chatLabel() }}
        </button>
      }

      <lf-reactions-sheet [post]="post" [open]="showReactions()" (close)="showReactions.set(false)" />
    </article>
  `,
  styles: [`
    .li-card {
      background: var(--lf-card);
      margin: 0 0 8px;
      overflow: hidden;
      box-shadow: var(--lf-shadow);
      position: relative;
    }
    .li-card--critical { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-signal); }
    .li-card--found { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-ubuntu); }
    @media (min-width: 700px) {
      .li-card { border-radius: var(--lf-radius); max-width: var(--lf-maxw); margin: 0 auto 12px; }
    }
    .li-card--preview .li-actor,
    .li-card--preview .li-body,
    .li-card--preview .li-media,
    .li-card--preview .li-counts { cursor: default; }

    .li-activity {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px 0;
      font-size: 13px;
      color: var(--lf-muted);
    }
    .li-activity strong { font-weight: 600; color: var(--ion-text-color); }

    .li-head { display: flex; gap: 8px; padding: 10px 8px 0 16px; }
    .li-actor { flex: 1; min-width: 0; display: flex; gap: 10px; cursor: pointer; }
    .li-actor-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
    .li-name { font-size: 15px; font-weight: 700; color: var(--ion-text-color);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .li-headline { font-size: 13px; color: var(--lf-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .li-sub { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--lf-muted); margin-top: 1px; }
    .li-head-side { display: flex; align-items: flex-start; gap: 2px; flex-shrink: 0; }
    .li-follow {
      background: none;
      border: 0;
      color: var(--lf-primary);
      font-family: inherit;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
      padding: 8px 6px;
      white-space: nowrap;
    }
    .li-follow.on { color: var(--lf-muted); font-weight: 600; }
    .li-more {
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none;
      border: 0;
      color: var(--lf-muted);
      cursor: pointer;
      border-radius: 50%;
    }
    .li-more:hover { background: var(--lf-hover); }

    .li-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 16px 0; }
    .li-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
      background: var(--lf-card-2); color: var(--ion-text-color);
    }
    .li-chip--danger { background: color-mix(in srgb, var(--lf-signal) 12%, transparent); color: var(--lf-signal); }
    .li-chip--success { background: color-mix(in srgb, var(--lf-ubuntu) 14%, transparent); color: var(--lf-ubuntu); }
    .li-chip--beacon { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }

    .li-reshare {
      display: flex; align-items: center; gap: 6px;
      margin: 8px 16px 0; padding: 8px 10px;
      border-radius: 6px;
      background: var(--lf-primary-soft);
      color: var(--lf-primary-soft-text);
      font-size: 13px; font-weight: 600;
      text-decoration: none;
    }
    .li-reshare:active { filter: brightness(.94); }

    .li-body { padding: 6px 16px 10px; cursor: pointer; }
    .li-post-title { font-size: 17px; font-weight: 700; color: var(--ion-text-color); margin: 0 0 4px; line-height: 1.3; }
    .li-fact-row { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--lf-muted); margin-bottom: 3px; }
    .li-fact-row strong { color: var(--ion-text-color); font-weight: 600; }
    .li-muted { color: var(--lf-muted); }
    .li-post-text { font-size: 15px; color: var(--ion-text-color); line-height: 1.34; margin: 6px 0 0; white-space: pre-line; }
    .li-readmore { background: none; border: 0; color: var(--lf-muted); font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer; padding: 0; margin-top: 2px; }
    .li-readmore:hover { text-decoration: underline; }

    .li-media { width: 100%; overflow: hidden; background: var(--lf-card-2); cursor: pointer; }
    .li-media-img { width: 100%; object-fit: cover; max-height: 520px; display: block; }
    .li-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    .li-grid[data-count="3"] .li-grid__tile:first-child { grid-column: 1 / -1; aspect-ratio: 2 / 1; }
    .li-grid__tile { position: relative; aspect-ratio: 1 / 1; overflow: hidden; }
    .li-grid__tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .li-grid__more {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .45); color: #fff;
      font-size: 30px; font-weight: 700;
    }

    .li-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0 16px;
      padding: 8px 0;
      font-size: 14px;
      color: var(--lf-muted);
    }
    .li-reacts { display: flex; align-items: center; min-width: 0; }
    .li-badges { display: inline-flex; align-items: center; flex-shrink: 0; }
    .li-badge {
      width: 18px; height: 18px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff;
      box-shadow: 0 0 0 2px var(--lf-card);
      margin-left: -5px;
    }
    .li-badge:first-child { margin-left: 0; }
    .li-badge--like { background: #0a66c2; }
    .li-badge--down { background: var(--lf-signal); }
    .li-reacted {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 2px 4px 2px 0;
      min-width: 0;
      text-align: left;
    }
    .li-reacted:hover .li-reacted__txt { text-decoration: underline; }
    .li-reacted__txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .li-counts { display: flex; align-items: center; gap: 5px; cursor: pointer; flex-shrink: 0; }

    .li-comment-preview {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      width: calc(100% - 32px);
      margin: 0 16px 10px;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .li-comment-bubble {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 8px 12px;
      border-radius: 4px 12px 12px 12px;
      background: var(--lf-card-2);
    }
    .li-comment-head { font-size: 12px; color: var(--lf-muted); }
    .li-comment-head strong { font-size: 13px; color: var(--ion-text-color); }
    .li-comment-txt {
      font-size: 14px;
      line-height: 1.35;
      color: var(--ion-text-color);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .li-actions {
      display: flex;
      align-items: center;
      margin: 0 8px;
      padding: 4px 0;
      border-top: 1px solid var(--lf-line-soft);
    }
    .li-action {
      flex: 1;
      min-width: 0;
      height: 44px;
      border: 0;
      background: transparent;
      color: var(--lf-muted);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      border-radius: 4px;
      white-space: nowrap;
    }
    .li-action:hover { background: var(--lf-hover); }
    .li-action.active { color: var(--lf-primary); }
    .li-action:disabled { opacity: .5; }
    @media (max-width: 370px) {
      .li-action span { font-size: 13px; }
    }

    .li-chat-cta {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: calc(100% - 24px); margin: 0 12px 10px;
      height: 36px; border: 0; border-radius: 6px;
      background: var(--lf-card-2);
      color: var(--ion-text-color); font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .li-chat-cta.open { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
  `]
})
export class PostCardComponent implements OnInit, OnChanges {
  private router = inject(Router);
  private sheetCtl = inject(ActionSheetController);
  private toast = inject(ToastController);
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
  reposting = signal(false);
  /** “Who reacted” sheet. */
  showReactions = signal(false);
  /** First few Idea voters, for the "X, Y and N others" line. Loaded lazily per card. */
  reactedPreview = signal<UserProfile[]>([]);
  private reactedFor = '';

  protected readonly compact = compact;
  protected readonly timeAgo = timeAgo;
  protected readonly provinceName = provinceName;

  readonly meta = computed(() => POST_TYPE_META[this.post?.type ?? 'story']);
  readonly isCritical = computed(() => urgency(this.post) === 'critical');
  readonly isMine = computed(() => this.post?.authorId === this.auth.viewerId);
  readonly myVote = computed(() => (this.post ? this.data.myVote(this.post) : null));
  readonly reposts = computed(() => this.post?.repostCount ?? 0);
  readonly authorName = computed(() =>
    this.post?.anonymous && !this.isMine() ? 'Anonymous' : this.author?.displayName ?? 'LulaFind member'
  );
  readonly authorAvatar = computed(() => this.data.avatarFor(this.post?.anonymous && !this.isMine() ? null : this.author));
  readonly authorStatus = computed(() =>
    this.post?.anonymous && !this.isMine() ? null : this.data.statusOf(this.author));
  /** LinkedIn headline under the name: their bio, else their town. Never leaks for anonymous posts. */
  readonly headline = computed(() => {
    if (this.post?.anonymous && !this.isMine()) return 'LulaFind member';
    return this.author?.bio?.trim() || this.author?.town?.trim() || 'LulaFind member';
  });
  readonly audienceIcon = computed(() => {
    const audience = this.post?.audience;
    return audience === 'public' ? 'globe' : audience === 'followers' ? 'users' : 'award';
  });
  readonly authorRoute = computed(() =>
    this.post?.anonymous && !this.isMine() ? ['/post/' + this.post.id] : ['/user/' + (this.author?.id ?? '')]
  );
  readonly longBody = computed(() => (this.post?.body?.trim().length ?? 0) > 190);

  readonly visibleMedia = computed(() => this.post?.media.slice(0, 4) ?? []);
  readonly extraMedia = computed(() => Math.max(0, (this.post?.media.length ?? 0) - 4));

  /** The freshest of the last like and the last comment - null on quiet posts. */
  readonly activity = computed(() => {
    const p = this.post;
    if (!p) return null;
    const like = p.lastLike;
    const comment = p.lastComment;
    if (like && (!comment || like.at >= comment.at)) return { kind: 'like' as const, ...like };
    if (comment) return { kind: 'comment' as const, ...comment };
    return null;
  });

  /** The comment preview under the summary - null unless a comment is the latest activity. */
  readonly commentPreview = computed(() => {
    const act = this.activity();
    return act?.kind === 'comment' ? act : null;
  });

  readonly showFollow = computed(() => {
    if (this.isMine()) return false;
    if (this.post?.anonymous) return false;
    return !!this.author?.id;
  });

  /** Case posts render as generated posters; plain status posts keep the classic body. */
  readonly posterType = computed(() => !!this.post && this.post.type !== 'story');
  /**
   * A single photo lives inside the poster. A video or a gallery stays in the
   * media grid below it, and the poster renders text-only.
   */
  readonly posterShowsPhoto = computed(() =>
    this.posterType() && this.post.media.length === 1 && this.post.media[0].kind === 'image'
  );

  async ngOnInit(): Promise<void> {
    this.syncFollow();
    this.saved.set(this.data.savedIds().includes(this.post?.id ?? ''));
    void this.loadReactedPreview();
  }

  ngOnChanges(): void {
    this.syncFollow();
    void this.loadReactedPreview();
  }

  /** First names of the people behind the Idea count, LinkedIn-style. */
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

  /** The comment preview opens the thread, exactly like the Comment button. */
  goComments(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    if (this.preview) return;
    this.comment.emit();
  }

  /**
   * Repost onto the viewer's own wall. Handled here - not by the parent - so
   * every feed, search result and profile card reposts the same way. Guests
   * are sent to sign in first.
   */
  async repost(e: Event): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (this.preview || this.reposting() || !this.post) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: this.router.url } });
      return;
    }
    const sheet = await this.sheetCtl.create({
      header: 'Repost to your wall?',
      subHeader: 'Your followers will see this post with your name on it.',
      buttons: [
        {
          text: 'Repost',
          icon: 'refresh' as const,
          handler: () => { void this.doRepost(); }
        },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  private async doRepost(): Promise<void> {
    if (!this.post || this.reposting()) return;
    this.reposting.set(true);
    try {
      await this.data.reshare(this.post.id);
      const t = await this.toast.create({ message: 'Reposted to your wall', duration: 2200, position: 'bottom' });
      await t.present();
    } catch (err: any) {
      const t = await this.toast.create({
        message: err?.message ?? 'Could not repost', duration: 2600, position: 'bottom'
      });
      await t.present();
    } finally {
      this.reposting.set(false);
    }
  }
}
