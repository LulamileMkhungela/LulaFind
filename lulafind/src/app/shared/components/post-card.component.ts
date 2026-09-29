import { Component, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Post, POST_TYPE_META, REACTIONS, ReactionKind, UserProfile, isReaction, provinceName } from '../../core/models/types';
import { alreadySaid, compact, headingIsNew, timeAgo, urgency } from '../../core/utils/format';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { ReactionsSheetComponent } from './reactions-sheet.component';
import { ReactionButtonComponent } from './reaction-button.component';
import { ReactionIconComponent } from './reaction-icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { PostActionsService } from '../../core/services/post-actions.service';

export type ChatState = 'off' | 'locked-follow' | 'open';

/**
 * The LinkedIn feed card, adapted to LulaFind's rules:
 *
 *   optional "X reposted this" line
 *   avatar · name + Follow · headline · time · province · globe · "…"
 *   three lines of text with a muted "…see more"
 *   media, or the original post in a frame when this is a reshare
 *   stats: reaction icons + count .......... comments / reposts
 *   action bar: react (hold for the tray) · Comment · Repost · Send
 *
 * Two things are deliberately not LinkedIn's: the category chip above the text
 * (this app is about missing people, and the chip is how a case is labelled)
 * and the private-chat row under the action bar (chat only opens for "Have an
 * idea" plus a mutual follow).
 */
@Component({
  selector: 'lf-post-card',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent, ReactionButtonComponent, ReactionIconComponent, ReactionsSheetComponent],
  template: `
    @if (!gone()) {
    <article class="fb-card lf-fade-in"
             [class.fb-card--critical]="isCritical()"
             [class.fb-card--found]="post.status === 'found'">
      @if (activity(); as act) {
        <a class="fb-activity" [routerLink]="['/user', act.userId]"><strong>{{ act.name }}</strong> {{ act.verb }}</a>
      }
      @if (post.repostOf) {
        <!-- LinkedIn puts the reposter's line above everything else on a reshare. -->
        <div class="fb-reposted">
          <lf-icon name="repost" [size]="14" [weight]="2.4" />
          <span><strong>{{ reposterLine() }}</strong></span>
        </div>
      }

      <header class="fb-card-header" [routerLink]="authorRoute()">
        <lf-avatar [src]="authorAvatar()" [name]="authorName()" [size]="48"
                   [status]="authorStatus()" />
        <div class="fb-author-meta">
          <div class="fb-author-row">
            <span class="fb-author-name">{{ authorName() }}</span>
            @if (showFollow()) {
              <span class="fb-dot">·</span>
              <button class="fb-follow-link" [class.on]="followingAuthor()" [class.requested]="followRequested()"
                      [attr.aria-pressed]="followingAuthor() || followRequested()" (click)="onFollow($event)">
                {{ followingAuthor() ? 'Following' : followRequested() ? 'Requested' : '+ Follow' }}
              </button>
            }
          </div>
          @if (authorHeadline()) { <span class="fb-headline">{{ authorHeadline() }}</span> }
          <div class="fb-sub-meta">
            <span>{{ timeAgo(post.createdAt) }}</span>
            @if (post.editedAt) {
              <span class="fb-dot">·</span>
              <span class="fb-edited" [attr.title]="'Edited ' + timeAgo(post.editedAt)">Edited</span>
            }
            <span class="fb-dot">·</span>
            <span>{{ provinceName(post.province) }}</span>
            <span class="fb-dot">·</span>
            <lf-icon name="globe" [size]="12" />
          </div>
        </div>
        <button class="fb-more-btn" (click)="onMore($event)" aria-label="More options">
          <lf-icon name="more" [size]="20" />
        </button>
      </header>

      @if (post.repostOf) {
        <!-- A repost: the reposter's own words, then the original inside a frame. -->
        @if (post.body.trim()) {
          <div class="fb-card-body fb-card-body--thoughts" [routerLink]="'/post/' + post.id">
            <p class="fb-post-text" [class.fb-clamp]="!expanded()">{{ post.body }}</p>
            @if (longBody()) {
              <button class="fb-readmore" (click)="toggleExpand($event)">{{ expanded() ? 'See less' : '\u2026see more' }}</button>
            }
          </div>
        }
        @if (original(); as o) {
          <a class="fb-embed" [routerLink]="'/post/' + o.id">
            <div class="fb-embed__head">
              <lf-avatar [src]="originalAvatar()" [name]="originalName()" [size]="40" />
              <div>
                <strong>{{ originalName() }}</strong>
                @if (originalHeadline(o)) { <span>{{ originalHeadline(o) }}</span> }
                <span class="fb-embed__when">{{ timeAgo(o.createdAt) }}@if (o.editedAt) { · Edited } · <lf-icon name="globe" [size]="11" /></span>
              </div>
            </div>
            <h3 class="fb-post-title">{{ o.title }}</h3>
            <p class="fb-embed__text">{{ o.body }}</p>
            @if (o.media.length) { <img class="fb-embed__img" [src]="o.media[0].src" [alt]="o.title" loading="lazy" /> }
          </a>
        } @else {
          <div class="fb-embed fb-embed--gone">
            <lf-icon name="info" [size]="16" />
            {{ originalMissing() ? 'This post is no longer available.' : 'Loading the original post…' }}
          </div>
        }
      } @else {
      <div class="fb-chips">
        <span class="fb-chip" [class.fb-chip--danger]="post.type === 'missing'"
              [class.fb-chip--success]="post.status === 'found'">
          <lf-icon [name]="meta().icon" [size]="12" /> {{ statusLabel() }}
        </span>
      </div>

      <div class="fb-card-body" [routerLink]="'/post/' + post.id">
        @if (showHeading()) { <h3 class="fb-post-title">{{ post.title }}</h3> }
        @if (post.type === 'pet') {
          <div class="fb-fact-row">
            <lf-icon name="paw" [size]="14" />
            <span><strong>Lost pet:</strong> {{ post.subject?.name || 'Pet' }}</span>
          </div>
        } @else if (post.subject?.name && !said(post.subject.name)) {
          <div class="fb-fact-row">
            <lf-icon name="user" [size]="14" />
            <strong>{{ post.subject.name }}</strong>
            @if (post.subject && post.subject.age !== null) {
              <span class="fb-muted">· {{ post.subject.age }} {{ ageWord() }}</span>
            }
          </div>
        }
        @if (post.lastSeenWhere && !said(post.lastSeenWhere)) {
          <div class="fb-fact-row">
            <lf-icon name="pin" [size]="14" />
            <span>Last seen: {{ post.lastSeenWhere }}</span>
          </div>
        }
        <p class="fb-post-text" [class.fb-clamp]="!expanded()">{{ post.body }}</p>
        @if (longBody()) {
          <button class="fb-readmore" (click)="toggleExpand($event)">
            {{ expanded() ? 'See less' : '\u2026see more' }}
          </button>
        }
      </div>

      @if (post.media.length) {
        <div class="fb-media" [routerLink]="'/post/' + post.id">
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
      }

      <!-- Reaction summary, like LinkedIn: the top reactions, then the count. Real counts only. -->
      @if (post.upvotes > 0 || post.commentCount > 0 || post.shares > 0) {
        <div class="fb-stats-bar" [routerLink]="'/post/' + post.id">
          <div class="fb-stats-likes">
            @if (post.upvotes > 0) {
              <span class="fb-stack" role="button" tabindex="0" aria-label="See who reacted" (click)="openReactions($event)" (keydown.enter)="openReactions($event)">
                @for (k of topKinds(); track k) { <lf-reaction-icon [kind]="k" [size]="18" [ring]="true" /> }
              </span>
              <span role="button" tabindex="0" (click)="openReactions($event)" (keydown.enter)="openReactions($event)">{{ compact(post.upvotes) }}</span>
            }
          </div>
          <div class="fb-stats-right">
            @if (post.commentCount > 0) { <span>{{ compact(post.commentCount) }} {{ post.commentCount === 1 ? 'comment' : 'comments' }}</span> }
            @if (post.shares > 0) { <span>{{ compact(post.shares) }} {{ post.shares === 1 ? 'repost' : 'reposts' }}</span> }
          </div>
        </div>
      }

      <!-- LinkedIn action bar: react (hold for more), Comment, Repost, Send -->
      <div class="fb-actions-row">
        <lf-reaction-button [value]="myVote()" (react)="onReact($event)" />

        <button class="fb-action-btn" (click)="comment.emit()">
          <lf-icon name="comment" [size]="20" />
          <span>Comment</span>
        </button>

        <button class="fb-action-btn" (click)="onRepost()">
          <lf-icon name="repost" [size]="20" />
          <span>Repost</span>
        </button>

        <button class="fb-action-btn" (click)="onSend()">
          <lf-icon name="send" [size]="19" />
          <span>Send</span>
        </button>
      </div>

      @if (post.chatEnabled && !isMine() && !post.repostOf) {
        <button class="fb-chat-cta" [class.open]="chatState === 'open'" (click)="chat.emit()">
          <lf-icon [name]="chatState === 'open' ? 'unlock' : 'lock'" [size]="15" />
          {{ chatLabel() }}
        </button>
      }
    </article>
    <lf-reactions-sheet [post]="post" [open]="reactionsOpen()" (close)="reactionsOpen.set(false)" />
    }
  `,
  styles: [`
    /* Mobile Facebook: edge-to-edge cards separated by the grey page. */
    .fb-card {
      background: var(--lf-card);
      margin: 0 0 8px;
      box-shadow: var(--lf-shadow);
      position: relative;
      /* visible, so the reaction tray can open above the action bar */
    }
    .fb-card--critical { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-signal); }
    .fb-card--found { box-shadow: var(--lf-shadow), inset 0 3px 0 var(--lf-ubuntu); }
    @media (min-width: 700px) {
      .fb-card { border-radius: var(--lf-radius); max-width: var(--lf-maxw); margin: 0 auto 12px; }
    }

    .fb-activity {
      display: block; padding: 8px 16px 0; font-size: 12px; line-height: 1.3;
      color: var(--lf-muted); text-decoration: none;
    }
    .fb-activity strong { font-weight: 600; color: inherit; }
    .fb-card-header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 8px 0 16px;
      cursor: pointer;
    }
    .fb-author-meta { flex: 1; min-width: 0; }
    .fb-author-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .fb-author-name { font-weight: 600; font-size: 14px; color: var(--ion-text-color);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* LinkedIn's second header line: who the person is, one line, muted. */
    .fb-headline {
      display: block; font-size: 12px; color: var(--lf-muted); line-height: 1.3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* LinkedIn clamps feed text to three lines and offers a muted "…see more". */
    .fb-clamp {
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
      overflow: hidden; white-space: normal;
    }
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
    .fb-post-text { font-size: 14.5px; color: var(--ion-text-color); line-height: 1.4; margin: 6px 0 0; white-space: pre-line; }
    .fb-readmore { background: none; border: 0; color: var(--lf-muted); font-family: inherit; font-weight: 400; font-size: 14.5px; cursor: pointer; padding: 0; margin-top: 2px; }
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
      padding: 8px 0;
      font-size: 13px;
      color: var(--lf-muted);
      cursor: pointer;
    }
    .fb-stats-likes { display: flex; align-items: center; gap: 6px; }
    .fb-stack { display: inline-flex; }
    .fb-stack lf-reaction-icon + lf-reaction-icon { margin-left: -5px; }
    .fb-edited { font-style: normal; }
    .fb-card-body--thoughts { padding-bottom: 8px; }
    /* LinkedIn's line above a reshared post. */
    .fb-reposted {
      display: flex; align-items: center; gap: 7px;
      padding: 12px 16px 0;
      color: var(--lf-muted);
      font-size: 13.5px;
      line-height: 1.2;
    }
    .fb-reposted strong { font-weight: 600; color: var(--ion-text-color); }

    .fb-embed { display: block; margin: 4px 16px 12px; padding: 12px; border: 1px solid var(--lf-line); border-radius: 8px;
      color: inherit; text-decoration: none; background: transparent; }
    .fb-embed:hover { background: var(--lf-hover); }
    .fb-embed__head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .fb-embed__head div { display: flex; flex-direction: column; min-width: 0; }
    .fb-embed__head strong { font-size: 14px; font-weight: 600; }
    .fb-embed__head span { font-size: 12px; color: var(--lf-muted); }
    .fb-embed__head .fb-embed__when { display: inline-flex; align-items: center; gap: 4px; }
    .fb-embed__text { margin: 0; font-size: 14px; line-height: 1.35; color: var(--ion-text-color);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
    .fb-embed__img { display: block; width: calc(100% + 24px); margin: 10px -12px -12px; max-height: 260px; object-fit: cover; border-radius: 0 0 8px 8px; }
    .fb-embed--gone { display: flex; align-items: center; gap: 8px; color: var(--lf-muted); font-size: 14px; }
    .fb-media { border-radius: 0; }
    .fb-like-icon {
      width: 18px; height: 18px; border-radius: 50%;
      background: linear-gradient(180deg, #18afff, #0062df); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 0 0 2px var(--lf-card);
    }
    .fb-stats-right { display: flex; align-items: center; gap: 12px; }

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

  @Output() vote = new EventEmitter<ReactionKind>();
  @Output() comment = new EventEmitter<void>();
  @Output() chat = new EventEmitter<void>();
  @Output() savedChange = new EventEmitter<void>();
  @Output() follow = new EventEmitter<Post>();

  private data = inject(DataService);
  private auth = inject(AuthService);
  private actions = inject(PostActionsService);

  /** Set once this card's post was deleted, so it disappears at once. */
  readonly gone = signal(false);
  readonly original = signal<Post | null>(null);
  readonly originalMissing = signal(false);

  saved = signal(false);
  followingAuthor = signal(false);
  followRequested = signal(false);
  expanded = signal(false);

  protected readonly compact = compact;
  protected readonly timeAgo = timeAgo;
  protected readonly provinceName = provinceName;

  readonly meta = computed(() => POST_TYPE_META[this.post?.type ?? 'missing']);
  readonly isCritical = computed(() => urgency(this.post) === 'critical');
  readonly isMine = computed(() => this.post?.authorId === this.auth.viewerId);
  readonly myVote = computed(() => (this.post ? this.data.myVote(this.post) : null));
  readonly authorName = computed(() =>
    this.post?.anonymous && !this.isMine() ? 'Anonymous' : this.author?.displayName ?? 'LulaFind member'
  );
  readonly originalName = computed(() => {
    const o = this.original();
    if (!o) return '';
    return o.anonymous ? 'Anonymous' : this.data.authorOf(o.authorId)?.displayName ?? 'LulaFind member';
  });
  readonly originalAvatar = computed(() => {
    const o = this.original();
    return this.data.avatarFor(o && !o.anonymous ? this.data.authorOf(o.authorId) : null);
  });
  /** Up to three reaction kinds, most given first, for the little stack next to the count. */
  readonly topKinds = computed<ReactionKind[]>(() => {
    const counts = new Map<ReactionKind, number>();
    for (const v of Object.values(this.post?.voterIds ?? {})) {
      if (isReaction(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const order = REACTIONS.map((r) => r.key);
    const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0])).map(([k]) => k);
    return (kinds.length ? kinds : ['up' as ReactionKind]).slice(0, 3);
  });
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

  /** LinkedIn's second header line: the poster's own line about themselves. */
  readonly authorHeadline = computed(() =>
    this.post?.anonymous && !this.isMine() ? '' : (this.author?.bio ?? '').trim());

  /** "You reposted this" / "Thabo Nkosi reposted this" - LinkedIn's reshare line. */
  reposterLine(): string {
    return this.isMine() ? 'You reposted this' : `${this.authorName()} reposted this`;
  }

  /** The original author's sub-line inside the embed box: their headline, as LinkedIn shows. */
  originalHeadline(o: Post): string {
    const bio = (this.data.authorOf(o.authorId)?.bio ?? '').trim();
    return bio || provinceName(o.province);
  }

  readonly visibleMedia = computed(() => this.post?.media.slice(0, 4) ?? []);
  readonly extraMedia = computed(() => Math.max(0, (this.post?.media.length ?? 0) - 4));

  readonly showFollow = computed(() => {
    if (this.isMine()) return false;
    if (this.post?.anonymous) return false;
    return !!this.author?.id;
  });

  async ngOnInit(): Promise<void> {
    this.syncFollow();
    this.loadOriginal();
    this.saved.set(this.data.savedIds().includes(this.post?.id ?? ''));
  }

  ngOnChanges(): void {
    this.syncFollow();
    this.loadOriginal();
  }

  /** LinkedIn's line above a post: who commented on it or reacted to it last. Not shown on your own activity or on reposts. */
  activity(): { userId: string; name: string; verb: string } | null {
    const p = this.post;
    if (!p || p.repostOf) return null;
    const me = this.auth.viewerId;
    const c = p.lastComment, l = p.lastLike;
    const useComment = !!c && (!l || c.at >= l.at);
    const who = useComment ? c : l;
    if (!who || who.userId === me || who.userId === p.authorId) return null;
    return { userId: who.userId, name: who.displayName, verb: useComment ? 'commented on this' : 'reacted to this' };
  }

  readonly reactionsOpen = signal(false);
  openReactions(e: Event): void { e.preventDefault(); e.stopPropagation(); this.reactionsOpen.set(true); }

  private loadOriginal(): void {
    const id = this.post?.repostOf;
    if (!id) return;
    const known = this.data.post(id);
    if (known) this.original.set(known);
    void this.data.loadPost(id).then((fresh) => {
      if (fresh) { this.original.set(fresh); this.originalMissing.set(false); }
      else if (!known) this.originalMissing.set(true);
    }).catch(() => { if (!known) this.originalMissing.set(true); });
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
    if (!this.post) return;
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

  /** Heading, name and last-seen lines are shown only when the post has not already said them. */
  showHeading(): boolean { return headingIsNew(this.post.title, this.post.body); }
  said(value: string | null | undefined): boolean { return alreadySaid(value, this.post.title, this.post.body); }

  ageWord(): string {
    const age = this.post.subject?.age ?? 0;
    return age === 1 ? 'year old' : 'years old';
  }

  chatLabel(): string {
    switch (this.chatState) {
      case 'open': return 'Message them';
      case 'locked-follow': return 'Follow each other to message';
      default: return 'Message the poster';
    }
  }

  toggleExpand(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.expanded.update((v) => !v);
  }

  onReact(kind: ReactionKind): void {
    this.vote.emit(kind);
  }

  onRepost(): void { void this.actions.openRepost(this.post); }
  onSend(): void { void this.actions.send(this.post); }

  onSave(): void {
    this.saved.update((s) => !s);
    this.savedChange.emit();
  }

  onMore(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    void this.actions.openMenu(this.post, () => this.gone.set(true));
  }
}
