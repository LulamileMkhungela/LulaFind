import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { LULA_API } from '../data/api';
import {
  AlertPrefs, Audience, CasePlan, CaseStepId, Comment, DangerAlert, GeoPoint, FeedFilter, FollowEdge, Lookout, MediaItem, Notification, Post, PostType, Spotlight, Story, StoryReply, StoryView, Tip, UserProfile,
  VoteValue, ReactionKind, REACTIONS, RETIRED_POST_TYPES, isReaction, VehicleDetails, dangerLabel, emptyFilter, provinceName
} from '../models/types';
import { avatar, cover, hueOf, scene } from '../data/seed';
import { HOUR, DAY, compact, uid } from '../utils/format';
import { withTimeout } from '../utils/net';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';
import { SUPPORT_EMAIL } from '../config';

/** The subset of a post its author (or an admin) may change after publishing. */
export interface UpdatePostInput {
  title?: string;
  body?: string;
  media?: Post['media'];
  poster?: Post['poster'];
  province?: Post['province'];
  town?: string;
  lastSeenAt?: number | null;
  lastSeenWhere?: string;
  geo?: Post['geo'];
  contactLabel?: string;
  contactValue?: string;
  contactVisibleTo?: Post['contactVisibleTo'];
  caseNumber?: string | null;
  reward?: string | null;
  subject?: Post['subject'];
  vehicleDetails?: VehicleDetails | null;
  audience?: Post['audience'];
  spotlightId?: string | null;
  chatEnabled?: boolean;
  allowComments?: boolean;
  anonymous?: boolean;
  askWanted?: boolean;
  khumbu?: Post['khumbu'];
  danger?: Post['danger'];
  plan?: CasePlan | null;
}

export interface CreatePostInput {
  type: PostType;
  title: string;
  body: string;
  media: Post['media'];
  province: Post['province'];
  town: string;
  lastSeenAt: number | null;
  lastSeenWhere: string;
  geo: Post['geo'];
  contactLabel: string;
  contactValue: string;
  contactVisibleTo: Post['contactVisibleTo'];
  caseNumber: string | null;
  reward: string | null;
  subject: Post['subject'];
  vehicleDetails?: VehicleDetails | null;
  audience: Post['audience'];
  spotlightId: string | null;
  chatEnabled: boolean;
  allowComments: boolean;
  anonymous: boolean;
  askWanted: boolean;
  khumbu: Post['khumbu'];
  danger?: DangerAlert | null;
  /**
   * Required for a case about someone under 18: the poster confirms they are the
   * guardian, or have the guardian's permission, to publish it. Same rule the
   * community platforms apply, and the reason the child review queue exists.
   */
  guardianConsent?: boolean;
}

/**
 * The heart of the app. Everything the feed, post detail, spotlight, stories,
 * follows, voting and consent flows need goes through here so that swapping
 * mock -> Firestore never touches a component.
 */
/** Keeps the first copy of each post, so a list never shows the same post twice. */
export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

@Injectable({ providedIn: 'root' })
export class DataService {
  private api = inject(LULA_API);
  private auth = inject(AuthService);
  private settings = inject(SettingsService);

  /* --------------------------- state --------------------------- */
  readonly filter = signal<FeedFilter>(emptyFilter());
  readonly feed = signal<Post[]>([]);
  /** Found cases matching the current type and province. Shown on the newsfeed, not only behind the Found filter. */
  readonly broughtHome = signal<Post[]>([]);
  /**
   * Live "be on the lookout" records the viewer may see - their own and those
   * of the people they follow.
   */
  readonly lookouts = signal<Lookout[]>([]);
  readonly loading = signal(false);
  /**
   * Bumped on every sync. Time-based rules (a 24-hour lookout coming due) hang
   * off this instead of their own timer, so they run exactly when the app next
   * talks to the network.
   */
  readonly syncTick = signal(0);
  /**
   * The last read never came back. Set when a load times out or the network
   * refuses the request, so a screen can say so and offer a retry instead of
   * showing its loading state for ever.
   */
  readonly connectionLost = signal(false);
  readonly spotlights = signal<Spotlight[]>([]);
  readonly stories = signal<Story[]>([]);
  readonly tips = signal<Tip[]>([]);
  readonly notifications = signal<Notification[]>([]);
  readonly savedIds = signal<string[]>([]);
  /** Full posts for the Saved page, newest save first. Deleted posts drop out. */
  readonly savedPosts = signal<Post[]>([]);
  /** Posts the user tapped "Don't want to see this" on. Per device, per account. */
  readonly hiddenIds = signal<string[]>([]);
  readonly followingIds = signal<string[]>([]);
  /** people who follow the signed-in account */
  readonly followerIds = signal<string[]>([]);

  readonly unreadNotifications = computed(() => this.notifications().filter((n) => !n.read).length);
  /**
   * The viewer's own posts, whatever stage they are at.
   *
   * This cannot be a filter over the feed: the feed is the public active list, so
   * a mother's case would vanish from her own profile the day it was marked
   * found - exactly when she needs to show it to someone.
   */
  readonly myAuthored = signal<Post[]>([]);
  readonly myPosts = computed(() => this.myAuthored());
  readonly activeMissingCount = computed(
    () => this.feed().filter((p) => p.type === 'missing' && p.status === 'active').length
  );

  /** Post cache keyed by id so detail pages and cards stay consistent. */
  readonly cache = signal<Record<string, Post>>({});

  /** User cache so cards can render author names/avatars without N queries. */
  readonly authors = signal<Record<string, UserProfile>>({});

  readonly authorOf = (id: string): UserProfile | undefined => this.authors()[id];

  /** Push a freshly saved profile into the author cache so cards update at once. */
  touchAuthor(u: UserProfile): void {
    this.authors.set({ ...this.authors(), [u.id]: u });
  }

  /** True when the signed-in person may edit or remove this post. */
  canEdit(p: Post | null | undefined): boolean {
    if (!p) return false;
    const me = this.auth.user();
    if (!me) return false;
    return p.authorId === me.id || me.isAdmin === true;
  }

  private changeSub: Subscription | null = null;

  constructor() {
    this.auth.attachApi(this.api);
    // Any write anywhere in the data layer re-queries the feed and refreshes the
    // cache, so cards, detail pages and counters can never disagree.
    this.changeSub = this.api.changes().subscribe(() => {
      void this.loadFeed();
      if (this.auth.viewerId) void this.loadUserScoped();
      void this.loadStatic();
    });
    effect(() => {
      // reload whenever the viewer or any filter value changes
      const f = this.filter();
      const uid_ = this.auth.user()?.id ?? null;
      void this.loadFeed(f, uid_);
    });
    effect(() => {
      // a different account has its own hidden-post list
      this.loadViewerPrefs();
      if (this.auth.user()?.id) void this.loadUserScoped();
      void this.loadFeed();
    });
  }

  changes() {
    return toObservable(this.feed);
  }

  /* ------------------------- auto-sync ------------------------- */
  private poll: ReturnType<typeof setInterval> | null = null;

  /**
   * Pull the latest posts on a timer so a phone left open on the feed keeps
   * showing new cases. In Firebase mode this is where the onSnapshot listener
   * goes; the rest of the app does not change.
   */
  startAutoSync(everyMs = 45_000): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.syncTick.update((n) => n + 1);
      void this.loadFeed();
      void this.loadStatic();
    }, everyMs);
  }

  stopAutoSync(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /** Stop reacting to data-layer changes (used when tearing the app down). */
  dispose(): void {
    this.changeSub?.unsubscribe();
    this.changeSub = null;
    this.stopAutoSync();
  }

  /* ------------------------ be on the lookout ----------------------- */

  /**
   * Readers that must run when lookouts arrive - the 24-hour check hangs off
   * this, so it can never run against a list that has not loaded yet.
   */
  private lookoutListeners: (() => void | Promise<void>)[] = [];

  onLookoutsLoaded(fn: () => void | Promise<void>): void {
    this.lookoutListeners.push(fn);
  }

  /** Read every lookout this viewer is allowed to see. */
  async loadLookouts(): Promise<Lookout[]> {
    try {
      const list = (await this.api.lookouts()).sort((a, b) => b.startedAt - a.startedAt);
      this.lookouts.set(list);
      /* A safety check must name the person it is about, not "someone". */
      void this.cacheAuthors(list.map((l) => l.userId));
      for (const fn of this.lookoutListeners) {
        try { await fn(); } catch (err) { console.warn('lookout listener failed:', err); }
      }
      return list;
    } catch (err) {
      console.warn('Lookouts could not be loaded:', err instanceof Error ? err.message : err);
      return this.lookouts();
    }
  }

  /** The open lookout of one person, if any. */
  openLookout(userId: string): Lookout | null {
    return this.lookouts().find((l) => l.userId === userId && (l.status === 'active' || l.status === 'checking')) ?? null;
  }

  /** Every lookout about one person, newest first - their safety history. */
  lookoutsFor(userId: string): Lookout[] {
    return this.lookouts().filter((l) => l.userId === userId);
  }

  /** Keep the local copy in step after a write. */
  mergeLookout(next: Lookout): void {
    const list = this.lookouts();
    const i = list.findIndex((l) => l.id === next.id);
    this.lookouts.set(i >= 0 ? list.map((l) => (l.id === next.id ? next : l)) : [next, ...list]);
  }

  /* --------------------------- feed ---------------------------- */
  async loadFeed(f: FeedFilter = this.filter(), viewerId: string | null = this.auth.viewerId): Promise<Post[]> {
    this.loading.set(true);
    try {
      const list = uniqueById((await this.readFeed(f, viewerId)).filter((p) => !RETIRED_POST_TYPES.includes(p.type)));
      this.connectionLost.set(false);
      const hidden = this.hiddenIds();
      const visible = hidden.length ? list.filter((p) => !hidden.includes(p.id)) : list;
      this.feed.set(visible);
      this.mergeCache(list);
      if (f.status === 'found') {
        this.broughtHome.set(visible);
      } else {
        const found = uniqueById((await this.readFeed({ ...f, status: 'found' }, viewerId)).filter((p) => !RETIRED_POST_TYPES.includes(p.type)));
        const shown = (hidden.length ? found.filter((p) => !hidden.includes(p.id)) : found)
          .sort((a, b) => (b.outcome?.foundAt ?? b.updatedAt) - (a.outcome?.foundAt ?? a.updatedAt));
        this.broughtHome.set(shown);
        this.mergeCache(found);
      }
      return visible;
    } catch (err) {
      // A stalled cellphone connection used to leave the feed loading for ever.
      // Now the screen is told, and the person can try again.
      this.connectionLost.set(true);
      console.warn('Feed load failed:', err instanceof Error ? err.message : err);
      return this.feed();
    } finally {
      this.loading.set(false);
    }
  }

  /** One feed read, with a deadline so a dead connection cannot hang the screen. */
  private readFeed(f: FeedFilter, viewerId: string | null): Promise<Post[]> {
    return withTimeout(this.api.queryFeed(f, viewerId), 12_000, 'The feed');
  }

  /** Try the feed again after a failed load. Used by the "Try again" button. */
  async retryFeed(): Promise<void> {
    this.connectionLost.set(false);
    await this.loadFeed();
  }

  setFilter(patch: Partial<FeedFilter>): void {
    this.filter.set({ ...this.filter(), ...patch });
  }

  resetFilter(): void {
    this.filter.set(emptyFilter());
  }

  /**
   * Put a freshly saved post straight into the cache. Every service that writes
   * a post must call this, otherwise the feed and the detail page can disagree
   * until the next re-query lands.
   */
  touch(post: Post): void {
    this.cache.set({ ...this.cache(), [post.id]: post });
  }

  /**
   * Fold fetched posts into the cache.
   *
   * Two requests for the same post can land out of order - the feed arrives
   * after you have already edited the case, or a background check finishes
   * late. Writing blindly meant the older copy won and the edit silently
   * vanished from the screen. The cache therefore keeps whichever record was
   * updated most recently, and only writes when something actually changed.
   */
  private mergeCache(posts: Post[]): void {
    const next = { ...this.cache() };
    let changed = false;
    for (const p of posts) {
      const held = next[p.id];
      if (held && (held.updatedAt ?? 0) > (p.updatedAt ?? 0)) continue;
      if (held === p) continue;
      next[p.id] = p;
      changed = true;
    }
    if (changed) this.cache.set(next);
    void this.cacheAuthors(posts.map((p) => p.authorId));
  }

  private async cacheAuthors(ids: string[]): Promise<void> {
    const missing = [...new Set(ids.filter(Boolean))].filter((id) => !this.authors()[id]);
    if (!missing.length) return;
    const loaded = await Promise.all(missing.map((id) => this.api.user(id)));
    const found: Record<string, UserProfile> = {};
    missing.forEach((id, i) => { if (loaded[i]) found[id] = loaded[i]!; });
    this.authors.set({ ...this.authors(), ...found });
  }

  post(id: string): Post | undefined {
    return this.cache()[id] ?? this.feed().find((p) => p.id === id);
  }

  async loadPost(id: string): Promise<Post | undefined> {
    const p = await this.api.post(id);
    if (p) {
      p.commentCount = (await this.api.commentsFor(id)).length;
      this.mergeCache([p]);
    }
    return p;
  }

  async refresh(): Promise<void> {
    await Promise.all([this.loadFeed(), this.loadUserScoped(), this.loadStatic()]);
  }

  async loadStatic(): Promise<void> {
    const [spots, rawStories, tips] = await Promise.all([this.api.spotlights(), this.api.stories(), this.api.tips()]);
    this.syncTick.update((n) => n + 1);
    void this.loadLookouts();
    this.spotlights.set(spots);
    const me = this.auth.viewerId;
    // The story rail only ever shows the first handful, and each story costs an
    // extra view query. Cap it so a long history cannot stall the feed.
    const capped = rawStories.slice(0, 24);
    const stories = await Promise.all(capped.map(async (story) => {
      const [views, replies] = await Promise.all([
        this.api.storyViewsFor(story.id),
        story.authorId === me ? this.api.storyRepliesFor(story.id) : Promise.resolve([] as StoryReply[])
      ]);
      const isOwner = story.authorId === me;
      // Older rows may have embedded projections; current Supabase records keep
      // replies/views in private collections, so these fields can be absent.
      const legacyViewers = story.viewers ?? [];
      const legacyReplies = story.replies ?? [];
      const viewerIds = isOwner
        ? [...new Set([...legacyViewers, ...views.map((view) => view.viewerId)])]
        : me && views.some((view) => view.viewerId === me) ? [me] : [];
      const replyMap = new Map([...legacyReplies, ...replies].map((reply) => [reply.id, reply]));
      return {
        ...story,
        viewers: viewerIds,
        replies: isOwner ? [...replyMap.values()].sort((a, b) => a.at - b.at) : []
      };
    }));
    this.stories.set(stories);
    this.tips.set(tips);
    void this.cacheAuthors(stories.flatMap((story) => [
      ...(story.replies ?? []).map((reply) => reply.authorId), ...(story.viewers ?? [])
    ]));
  }

  async loadUserScoped(): Promise<void> {
    const id = this.auth.viewerId;
    if (!id) {
      this.notifications.set([]);
      this.followingIds.set([]);
      this.followerIds.set([]);
      this.followRequests.set([]);
      this.myAuthored.set([]);
      return;
    }
    const [notes, following, followers, requests, mine] = await Promise.all([
      this.api.notifications(id),
      this.api.followsFor(id, 'following'),
      this.api.followsFor(id, 'followers'),
      this.api.followRequests(id),
      this.api.postsByAuthor(id).catch(() => [] as Post[])
    ]);
    this.notifications.set(notes);
    this.myAuthored.set([...mine].sort((a, b) => b.createdAt - a.createdAt));
    this.followingIds.set(following.map((edge) => edge.followingId));
    this.followerIds.set(followers.map((edge) => edge.followerId));
    this.followRequests.set(requests);
    void this.checkWatched();
  }

  /* ------------------------- voting ---------------------------- */
  /**
   * React to a post. Tapping the reaction you already gave takes it back;
   * tapping a different one swaps it. Every reaction except the retired
   * "No idea" counts towards `upvotes`.
   */
  async vote(postId: string, value: ReactionKind): Promise<Post | undefined> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to react');
    if (this.auth.user()?.suspended) throw new Error('Your account is suspended');
    // Feed cards are already cached. Use that copy and paint the reaction before
    // waiting for the network; fetching the post + all comments first made a tap
    // feel delayed even when the card was right in front of the person.
    const p = this.post(postId) ?? await this.loadPost(postId);
    if (!p) return undefined;
    const current: VoteValue = p.voterIds[me] ?? null;
    const next: VoteValue = current === value ? null : value;

    const nextPost: Post = {
      ...p,
      voterIds: { ...p.voterIds, [me]: next },
      upvotes: Math.max(0, p.upvotes + (isReaction(next) ? 1 : 0) - (isReaction(current) ? 1 : 0)),
      // A fresh reaction refreshes the feed's "X reacted to this" line. Taking
      // it back keeps the last known person so the line never blinks empty.
      lastLike: isReaction(next)
        ? { userId: me, displayName: this.auth.user()?.displayName ?? 'Someone', at: Date.now() }
        : p.lastLike ?? null
    };
    this.replacePostViews(nextPost);
    try {
      await this.api.savePost(nextPost);
    } catch (error) {
      this.replacePostViews(p);
      throw error;
    }
    if (isReaction(next) && !isReaction(current) && p.authorId !== me) {
      const who = this.auth.user()?.displayName ?? 'Someone';
      const label = REACTIONS.find((r) => r.key === next)?.label.toLowerCase() ?? 'reacted';
      // Notifications are secondary to the immediate reaction; do not make a
      // successful tap wait on the notification write.
      void this.notify({
        userId: p.authorId, kind: 'vote',
        title: next === 'up' ? `${who} has an idea about your post` : `${who} reacted (${label}) to your post`,
        body: `${p.subject?.name?.trim() || p.title} · open it to chat or read their comment.`,
        route: `/post/${p.id}`, postId: p.id
      }).catch(() => undefined);
    }
    return nextPost;
  }

  /** Replace a post in the view signals as well as the cache (used optimistically). */
  private replacePostViews(post: Post): void {
    this.mergeCache([post]);
    this.feed.update((items) => items.map((item) => item.id === post.id ? post : item));
    this.broughtHome.update((items) => items.map((item) => item.id === post.id ? post : item));
    this.myAuthored.update((items) => items.map((item) => item.id === post.id ? post : item));
  }

  myVote(p: Post): VoteValue {
    const me = this.auth.viewerId;
    return (me ? p.voterIds[me] : null) ?? null;
  }

  /* ------------------------ comments --------------------------- */
  async comments(postId: string): Promise<Comment[]> {
    return this.api.commentsFor(postId);
  }

  async addComment(input: {
    postId: string;
    body: string;
    parentId?: string | null;
    isLead?: boolean;
    sighting?: Comment['sighting'];
    markGuess?: string;
    media?: MediaItem[];
  }): Promise<Comment> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to comment');
    if (this.auth.user()?.suspended) throw new Error('Your account is suspended');
    const body = input.body.trim();
    const media = await Promise.all((input.media ?? []).map((item) => this.api.uploadMedia(me, item)));
    if (!body && !media.length) throw new Error('Write a comment or attach a photo/video');
    const p = this.post(input.postId) ?? await this.loadPost(input.postId);
    if (!p) throw new Error('That post is not available');
    const c: Comment = {
      id: uid('c'),
      postId: input.postId,
      parentId: input.parentId ?? null,
      authorId: me,
      body,
      createdAt: Date.now(),
      upvotes: 0,
      likedIds: [],
      isLead: input.isLead ?? false,
      media: media.length ? media : undefined,
      sighting: input.sighting,
      markGuess: input.markGuess || undefined
    };
    await this.api.saveComment(c);

    // Keep the top-level comment preview and count fresh without making the
    // person wait for another full feed download. Replies count too but do not
    // replace the feed's top-level comment preview.
    const topLevel = !c.parentId;
    const next: Post = {
      ...p,
      commentCount: p.commentCount + 1,
      updatedAt: Date.now(),
      lastComment: topLevel
        ? { userId: me, displayName: this.auth.user()?.displayName ?? 'Someone', body: c.body.slice(0, 280), at: c.createdAt }
        : p.lastComment ?? null
    };
    try {
      await this.api.savePost(next);
    } catch (error) {
      // A comment is already saved; do not tell the author it failed because a
      // secondary feed-counter/preview write failed. The detail still renders
      // the saved comment, and a future refresh can rebuild the counter.
      console.warn('Could not refresh the comment preview:', error);
    }
    this.replacePostViews(next);

    if (p.authorId !== me) {
      void this.api.pushNotification({
        id: uid('n'),
        userId: p.authorId,
        kind: input.isLead ? 'vote' : 'comment',
        title: `${input.isLead ? 'New lead on' : 'Comment on'} your post`,
        body: c.body.slice(0, 110) || 'A photo or video was attached',
        at: Date.now(),
        read: false,
        route: `/post/${p.id}`,
        postId: p.id
      }).catch(() => undefined);
    }
    return c;
  }

  /**
   * Family-only check: confirm or reject a mark (physical description detail)
   * that a commenter named on a lead. The result becomes public so searchers
   * know whether this lead matched; the actual words stay private.
   */
  async checkLeadMark(c: Comment, result: 'match' | 'no'): Promise<void> {
    const p = this.cache()[c.postId] ?? (await this.api.post(c.postId));
    if (!p) throw new Error('That post is not here any more');
    if (!this.canEdit(p)) throw new Error('Only the poster can check a mark');
    await this.api.saveComment({ ...c, markCheck: result });
  }

  /** Like or un-like a comment. One like per person. */
  async voteComment(c: Comment): Promise<Comment> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to like a comment');
    const likers = new Set(c.likedIds ?? []);
    const had = likers.has(me);
    if (had) likers.delete(me); else likers.add(me);
    // Move the running count by one: older comments carry likes from before likers were tracked.
    const next: Comment = { ...c, likedIds: [...likers], upvotes: Math.max(0, c.upvotes + (had ? -1 : 1)) };
    await this.api.saveComment(next);
    return next;
  }

  /** Change your own comment's text. It is then marked as edited. */
  async editComment(c: Comment, body: string): Promise<Comment> {
    const me = this.auth.viewerId;
    if (!me || c.authorId !== me) throw new Error('You can only edit your own comment');
    const text = body.trim();
    if (!text) throw new Error('A comment cannot be empty');
    const next: Comment = { ...c, body: text, editedAt: Date.now() };
    await this.api.saveComment(next);
    return next;
  }

  async deleteComment(c: Comment): Promise<void> {
    await this.api.deleteComment(c.id, c.postId);
    const p = await this.loadPost(c.postId);
    if (p) {
      const remaining = await this.api.commentsFor(c.postId);
      const latestTop = remaining
        .filter((x) => !x.parentId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const next = {
        ...p,
        commentCount: remaining.length,
        lastComment: latestTop
          ? {
              userId: latestTop.authorId,
              displayName: this.authorOf(latestTop.authorId)?.displayName ?? 'Someone',
              body: latestTop.body.slice(0, 280),
              at: latestTop.createdAt
            }
          : null
      };
      await this.api.savePost(next);
      this.mergeCache([next]);
    }
  }

  /* ------------------------- posting --------------------------- */
  async createPost(input: CreatePostInput): Promise<Post> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to post');
    if (me.suspended) throw new Error(`Your account is suspended. Contact ${SUPPORT_EMAIL} if you think this is a mistake.`);
    if (RETIRED_POST_TYPES.includes(input.type)) throw new Error('That kind of post is no longer available.');
    if (input.title.trim().length < 8) throw new Error('Give your post a clear title (at least 8 characters)');
    if (input.body.trim().length < 30) throw new Error('Describe what happened in detail - at least 30 characters. Details save lives.');
    if (!input.province) throw new Error('Choose the province where this happened');
    if (input.type !== 'story' && !input.town.trim()) throw new Error('Choose the town or suburb where this happened');
    if (input.type === 'danger' && !input.lastSeenWhere.trim()) throw new Error('Say the place where you saw this');
    if (input.type === 'danger' && !input.danger?.kind) throw new Error('Choose what kind of danger you saw');
    if (input.type === 'khumbulekhaya' && !input.khumbu) throw new Error('Add the basic details about when they left home');
    if (isChildSubject(input) && !input.guardianConsent) {
      throw new Error('A case about a child can only be posted by their guardian, or with the guardian\u2019s permission');
    }
    if (input.audience === 'surname') {
      if (!input.spotlightId) throw new Error('Choose which Spotlight community should see this');
      this.requireMembership(input.spotlightId);
    }
    if (input.media.length > 1 && input.media.some((m) => m.kind === 'video')) {
      throw new Error('Choose photos or one video - not both');
    }

    const media = await Promise.all(input.media.map((item) => this.api.uploadMedia(me.id, item)));
    const now = Date.now();
    const post: Post = {
      id: uid('p'),
      type: input.type,
      status: input.type === 'missing' && (input.subject?.age ?? 99) < 18 ? 'under_review' : 'active',
      authorId: me.id,
      anonymous: input.anonymous,
      askWanted: input.askWanted,
      title: input.title.trim(),
      body: input.body.trim(),
      media,
      province: input.province,
      town: input.town.trim(),
      lastSeenAt: input.lastSeenAt,
      lastSeenWhere: input.lastSeenWhere.trim(),
      geo: input.geo,
      contactLabel: input.contactLabel,
      contactValue: input.contactValue.trim(),
      contactVisibleTo: input.contactVisibleTo,
      caseNumber: input.caseNumber?.trim() || null,
      reward: input.reward?.trim() || null,
      plan: isCasePost({ type: input.type } as Post)
        ? { done: input.caseNumber?.trim() ? { case_number: true } : {}, updatedAt: now }
        : null,
      createdAt: now,
      updatedAt: now,
      subject: input.type === 'vehicle' ? null : input.subject,
      vehicleDetails: input.type === 'vehicle' ? input.vehicleDetails ?? null : null,
      audience: input.audience,
      spotlightId: input.audience === 'surname' ? input.spotlightId : null,
      chatEnabled: input.chatEnabled,
      allowComments: input.allowComments,
      allowShare: true,
      upvotes: 0,
      commentCount: 0,
      shares: 0,
      views: 0,
      savedBy: 0,
      voterIds: {},
      lastLike: null,
      lastComment: null,
      escalation: { requested: false, consentGranted: false, consentAt: null, partners: [] },
      consent: input.guardianConsent
        ? [{ kind: 'guardian' as const, label: 'Guardian permission to publish a child case', granted: true, at: now, expiresAt: null }]
        : [],
      sightingVerified: null,
      searchParty: null,
      locationCheck: {
        subjectRegisteredInApp: false,
        requestedBy: null,
        requestedAt: null,
        consentFromSubject: 'none',
        consentAt: null,
        points: [],
        deviceReachable: false,
        lastKnownAt: null,
        note: ''
      },
      khumbu: input.khumbu,
      danger: input.type === 'danger'
        ? { kind: input.danger!.kind, stillIds: [], clearIds: [], clearedAt: null }
        : null,
      outcome: { found: false, foundAt: null, whereaboutsFound: '', closedBy: null, note: '' },
      events: [{ at: now, kind: 'claimed', byUserId: me.id, note: input.type === 'danger' ? 'Danger alert posted' : input.anonymous ? 'Anonymous post - identity verified privately' : 'Posted by family/close contact' }],
      flags: [],
      outcomeNudgeAt: null
    };
    await this.api.savePost(post);
    if (post.type === 'danger') await this.alertProvince(post);
    // A child case is held for review first, so its alert goes out on approval.
    if (isCasePost(post) && post.status === 'active') await this.alertCase(post);
    if (post.spotlightId) {
      // the post is already live; a failed Spotlight index must not look like a failed post
      await this.api.linkSpotlightPost(post.spotlightId, post.id, true).catch((e) => console.warn(e?.message));
    }
    this.mergeCache([post]);
    this.myAuthored.update((list) => [post, ...list.filter((x) => x.id !== post.id)]);
    await this.loadFeed();
    return post;
  }

  /**
   * Edit a published post. Only the author or an admin may call this - votes,
   * escalation, consent and outcome are deliberately not editable.
   */
  async updatePost(id: string, patch: UpdatePostInput): Promise<Post | undefined> {
    const me = this.auth.user();
    const p = await this.loadPost(id);
    if (!me || !p) throw new Error('That post is not here any more');
    if (p.authorId !== me.id && me.isAdmin !== true) throw new Error('Only the person who posted this can edit it');

    if (patch.title !== undefined && patch.title.trim().length < 8) {
      throw new Error('The title must be at least 8 characters');
    }
    if (patch.body !== undefined && patch.body.trim().length < 30) {
      throw new Error('The description must be at least 30 characters');
    }
    if (patch.province !== undefined && !patch.province) throw new Error('Choose a province');
    // Changing the audience to a community is also posting there. Check the
    // final audience even if the Spotlight id stayed the same, since someone
    // may have left or been removed from that community since the last edit.
    const nextAudience = patch.audience ?? p.audience;
    const nextSpotlightId = patch.spotlightId !== undefined ? patch.spotlightId : p.spotlightId;
    if (nextAudience === 'surname') {
      if (!nextSpotlightId) throw new Error('Choose which Spotlight community should see this');
      this.requireMembership(nextSpotlightId);
    }
    const media = patch.media
      ? await Promise.all(patch.media.map((item) => this.api.uploadMedia(me.id, item)))
      : p.media;
    const poster = patch.poster === undefined
      ? p.poster ?? null
      : patch.poster
        ? { ...patch.poster, media: await this.api.uploadMedia(me.id, patch.poster.media) }
        : null;

    const next: Post = {
      ...p,
      title: patch.title !== undefined ? patch.title.trim() : p.title,
      body: patch.body !== undefined ? patch.body.trim() : p.body,
      media,
      poster,
      province: patch.province ?? p.province,
      town: patch.town !== undefined ? patch.town.trim() : p.town,
      lastSeenAt: patch.lastSeenAt !== undefined ? patch.lastSeenAt : p.lastSeenAt,
      lastSeenWhere: patch.lastSeenWhere !== undefined ? patch.lastSeenWhere.trim() : p.lastSeenWhere,
      geo: patch.geo !== undefined ? patch.geo : p.geo,
      contactLabel: patch.contactLabel ?? p.contactLabel,
      contactValue: patch.contactValue !== undefined ? patch.contactValue.trim() : p.contactValue,
      contactVisibleTo: patch.contactVisibleTo ?? p.contactVisibleTo,
      caseNumber: patch.caseNumber !== undefined ? patch.caseNumber?.trim() || null : p.caseNumber,
      reward: patch.reward !== undefined ? patch.reward?.trim() || null : p.reward,
      subject: patch.subject !== undefined ? patch.subject : p.subject,
      vehicleDetails: patch.vehicleDetails !== undefined ? patch.vehicleDetails : p.vehicleDetails ?? null,
      audience: nextAudience,
      spotlightId: nextAudience === 'surname' ? nextSpotlightId : null,
      chatEnabled: patch.chatEnabled ?? p.chatEnabled,
      allowComments: patch.allowComments ?? p.allowComments,
      anonymous: patch.anonymous ?? p.anonymous,
      askWanted: patch.askWanted ?? p.askWanted,
      khumbu: patch.khumbu !== undefined ? patch.khumbu : p.khumbu,
      danger: patch.danger !== undefined ? patch.danger : p.danger,
      updatedAt: Date.now(),
      editedAt: Date.now()
    };

    await this.api.savePost(next);

    // keep the community's post list in step when the spotlight changed
    const before = p.spotlightId;
    const after = next.spotlightId;
    if (before && before !== after) {
      await this.api.linkSpotlightPost(before, next.id, false).catch((e) => console.warn(e?.message));
    }
    if (after) {
      await this.api.linkSpotlightPost(after, next.id, true).catch((e) => console.warn(e?.message));
    }

    this.mergeCache([next]);
    await this.loadStatic();
    await this.loadFeed();
    return next;
  }

  /**
   * Delete a post and confirm it is really gone: the post is read back after
   * the delete, so a delete the server refused is reported instead of assumed.
   * A repost of it stays but shows "This post is no longer available".
   */
  async deletePost(id: string): Promise<boolean> {
    const before = await this.loadPost(id);
    if (!before) return true;
    await this.api.deletePost(id);
    /*
     * Every list the deleted post could be sitting in, not just the feed. It
     * used to clear the feed and saved posts only, so a post deleted from the
     * Menu stayed on the Menu - the page was reading `myAuthored`, which nothing
     * had touched.
     */
    const drop = (list: Post[]) => list.filter((p) => p.id !== id);
    this.feed.set(drop(this.feed()));
    this.savedPosts.set(drop(this.savedPosts()));
    this.myAuthored.set(drop(this.myAuthored()));
    this.broughtHome.set(drop(this.broughtHome()));
    this.cache.update((c) => { const rest = { ...c }; delete rest[id]; return rest; });
    await this.loadFeed();
    const still = await this.api.post(id).catch(() => null);
    return !still;
  }

  /* ------------------------- reposts --------------------------- */
  /**
   * Repost a public post to your own followers, like LinkedIn. With no
   * `thoughts` it is an instant repost; with text it carries your comment above
   * the original. Reposting a repost reposts the original, so cards never nest.
   */
  async repost(originalId: string, thoughts = ''): Promise<Post> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to repost');
    if (me.suspended) throw new Error('Your account is suspended');
    const shown = await this.loadPost(originalId);
    if (!shown) throw new Error('That post is not here any more');
    const original = shown.repostOf ? (await this.loadPost(shown.repostOf)) ?? shown : shown;
    if (original.authorId === me.id) throw new Error('You cannot repost your own post');
    if (original.audience !== 'public') throw new Error('Only public posts can be reposted');
    if (original.anonymous) throw new Error('Anonymous posts cannot be reposted');
    if (!original.allowShare) throw new Error('The author turned off sharing for this post');
    const now = Date.now();
    const copy: Post = {
      ...original,
      id: uid('p'),
      authorId: me.id,
      anonymous: false,
      title: original.title,
      body: thoughts.trim(),
      media: [],
      repostOf: original.id,
      createdAt: now,
      updatedAt: now,
      editedAt: null,
      audience: 'public',
      spotlightId: null,
      chatEnabled: false,
      allowComments: true,
      allowShare: true,
      subject: null,
      vehicleDetails: null,
      upvotes: 0, commentCount: 0, shares: 0, views: 0, savedBy: 0,
      voterIds: {},
      lookingIds: [],
      searchParty: null,
      khumbu: null,
      danger: null,
      sightingVerified: null,
      escalation: { requested: false, consentGranted: false, consentAt: null, partners: [] },
      consent: [],
      events: [],
      flags: [],
      outcomeNudgeAt: null,
      status: 'active',
      contactValue: '',
      caseNumber: null,
      reward: null
    };
    await this.api.savePost(copy);
    this.mergeCache([copy]);
    await this.recordShare(original.id).catch(() => undefined);
    if (original.authorId !== me.id) {
      await this.notify({
        userId: original.authorId, kind: 'repost',
        title: `${me.displayName} reposted your post`,
        body: thoughts.trim() ? thoughts.trim().slice(0, 120) : original.title,
        route: `/post/${original.id}`, postId: original.id
      }).catch(() => undefined);
    }
    await this.loadFeed();
    return copy;
  }

  /** Your own repost of a post, if you made one. */
  async myRepostOf(originalId: string): Promise<Post | null> {
    const me = this.auth.viewerId;
    if (!me) return null;
    const mine = await this.api.postsByAuthor(me).catch(() => [] as Post[]);
    return mine.find((p) => p.repostOf === originalId) ?? null;
  }

  private requireMembership(spotlightId: string | null | undefined): void {
    if (!spotlightId) return;
    if (this.auth.user()?.isAdmin === true && !this.spotlights().some((s) => s.id === spotlightId)) return;
    if (!this.isMember(spotlightId)) {
      const name = this.spotlights().find((s) => s.id === spotlightId)?.surname;
      throw new Error(`Join ${name ? `the ${name} community` : 'that community'} before you post to it.`);
    }
  }

  async registerView(postId: string): Promise<void> {
    const p = await this.loadPost(postId);
    if (!p) return;
    const next = { ...p, views: p.views + 1 };
    await this.api.savePost(next);
    this.mergeCache([next]);
  }

  async recordShare(postId: string): Promise<void> {
    const p = await this.loadPost(postId);
    if (!p) return;
    const next = { ...p, shares: p.shares + 1 };
    await this.api.savePost(next);
    this.mergeCache([next]);
    await this.loadFeed();
  }

  /* ------------------------- saved ----------------------------- */
  async toggleSaved(postId: string): Promise<boolean> {
    if (!this.auth.viewerId) throw new Error('Sign in to save posts');
    const has = this.savedIds().includes(postId);
    // newest first, so the Saved page reads like Facebook's
    const next = has ? this.savedIds().filter((x) => x !== postId) : [postId, ...this.savedIds()];
    this.savedIds.set(next);
    this.savedPosts.set(has
      ? this.savedPosts().filter((p) => p.id !== postId)
      : [this.post(postId), ...this.savedPosts()].filter((p): p is Post => !!p));
    if (!has) {
      // Start watching from now, so only news after the save is announced.
      const p = this.post(postId);
      if (p) this.rememberWatch([p]);
    }
    this.persistViewerPrefs();
    try {
      await this.auth.updateProfile({ savedPostIds: next });
    } catch {
      /* offline - the device copy is kept and re-sent with the next profile save */
    }
    return !has;
  }

  /** Load every saved post for the Saved page. */
  async loadSaved(): Promise<Post[]> {
    const ids = this.savedIds();
    const posts = (await Promise.all(ids.map((id) => this.loadPost(id).catch(() => undefined))))
      .filter((p): p is Post => !!p);
    this.savedPosts.set(posts);
    // forget posts that were deleted
    if (posts.length !== ids.length && this.auth.viewerId) {
      const alive = posts.map((p) => p.id);
      this.savedIds.set(alive);
      this.persistViewerPrefs();
      void this.auth.updateProfile({ savedPostIds: alive }).catch(() => undefined);
    }
    return posts;
  }

  /* ------------------ watched-post updates ---------------------- */
  /**
   * Tell the viewer when a post they saved, or a post in a Spotlight they
   * joined, gets new Ideas or is marked found.
   *
   * Runs on this phone against a small snapshot (ideas count + found) kept per
   * account. The first time a post is seen it is only remembered, so joining a
   * busy Spotlight does not flood the bell. The poster already gets their own
   * Idea alerts, so their own posts are skipped here.
   */
  private watchBusy = false;
  private watchAt = 0;

  private get watchKey(): string {
    return `lulafind.watch.${this.auth.viewerId ?? 'anon'}`;
  }

  private readWatch(): Record<string, { up: number; found: boolean }> {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.watchKey) : null;
      const v = raw ? JSON.parse(raw) : {};
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  }

  private writeWatch(v: Record<string, { up: number; found: boolean }>): void {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(this.watchKey, JSON.stringify(v)); } catch { /* quota */ }
  }

  private rememberWatch(posts: Post[]): void {
    const snap = this.readWatch();
    for (const p of posts) snap[p.id] = { up: p.upvotes, found: p.status === 'found' };
    this.writeWatch(snap);
  }

  async checkWatched(force = false): Promise<number> {
    const me = this.auth.viewerId;
    if (!me || this.watchBusy) return 0;
    if (!force && Date.now() - this.watchAt < 60_000) return 0;
    this.watchBusy = true;
    this.watchAt = Date.now();
    try {
      const why = new Map<string, string>();
      for (const id of this.savedIds()) why.set(id, 'a post you saved');
      for (const sp of this.spotlights().filter((s) => s.memberIds.includes(me))) {
        const posts = await this.api.queryFeed({ ...emptyFilter(), status: 'all', spotlightId: sp.id }, me).catch(() => [] as Post[]);
        this.mergeCache(posts);
        for (const p of posts.slice(0, 40)) if (!why.has(p.id)) why.set(p.id, `the ${sp.surname} spotlight`);
      }
      let sent = 0;
      // "Did you get help?" - ask the poster once a case has real traction.
      const mine = Object.values(this.cache()).filter((p) => p.authorId === me && p.status === 'active'
        && (p.type === 'missing' || p.type === 'khumbulekhaya')
        && (p.upvotes >= 15 || p.commentCount >= 2)
        && (!p.outcomeNudgeAt || Date.now() - p.outcomeNudgeAt > 3 * DAY));
      for (const p of mine) {
        const who = p.subject?.name?.trim() || 'them';
        await this.api.pushNotification({
          id: uid('n'), userId: me, kind: 'outcome',
          title: `Did you get help finding ${who}?`,
          body: `${p.upvotes} reactions and ${p.commentCount} comments. If ${who} is home, tap to mark them found.`,
          at: Date.now(), read: false, route: `/post/${p.id}`, postId: p.id
        });
        await this.setOutcomeNudged(p.id).catch(() => undefined);
        sent++;
      }
      if (!why.size) {
        if (sent) this.notifications.set(await this.api.notifications(me));
        return sent;
      }

      const snap = this.readWatch();
      for (const [id, where] of why) {
        const p = this.post(id) ?? (await this.api.post(id).catch(() => undefined));
        if (!p) continue;
        const was = snap[id];
        const found = p.status === 'found';
        snap[id] = { up: p.upvotes, found };
        if (!was || p.authorId === me) continue;
        const who = p.subject?.name?.trim() || p.title;
        if (found && !was.found) {
          await this.api.pushNotification({
            id: uid('n'), userId: me, kind: 'outcome',
            title: p.outcome?.whereaboutsFound && p.type === 'khumbulekhaya' ? `Whereabouts found: ${who}` : `${who} has been found`,
            body: `Update on ${where}.${p.outcome?.whereaboutsFound ? ' ' + p.outcome.whereaboutsFound : ''}`,
            at: Date.now(), read: false, route: `/post/${p.id}`, postId: p.id
          });
          sent++;
        } else if (!found && p.upvotes > was.up) {
          const n = p.upvotes - was.up;
          await this.api.pushNotification({
            id: uid('n'), userId: me, kind: 'vote',
            title: n === 1 ? `Someone reacted to ${who}` : `${n} people reacted to ${who}`,
            body: `Someone reacted on ${where}. Open it to read the leads.`,
            at: Date.now(), read: false, route: `/post/${p.id}`, postId: p.id
          });
          sent++;
        }
      }
      this.writeWatch(snap);
      if (sent) this.notifications.set(await this.api.notifications(me));
      return sent;
    } finally {
      this.watchBusy = false;
    }
  }

  /** localStorage key for "don't want to see this", scoped per account. */
  private get hiddenKey(): string {
    return `lulafind.hidden.${this.auth.viewerId ?? 'anon'}`;
  }

  private get savedKey(): string {
    return `lulafind.saved.${this.auth.viewerId ?? 'anon'}`;
  }

  private persistViewerPrefs(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this.hiddenKey, JSON.stringify(this.hiddenIds()));
      localStorage.setItem(this.savedKey, JSON.stringify(this.savedIds()));
    } catch { /* private mode / full quota - the choice lasts for this session only */ }
  }

  /** Restore this account's hidden posts. Called when the viewer changes. */
  private loadViewerPrefs(): void {
    // Saved posts: the profile copy wins, the device copy covers offline saves.
    const fromProfile = untracked(() => this.auth.user()?.savedPostIds) ?? null;
    try {
      if (typeof localStorage === 'undefined') { this.hiddenIds.set([]); this.savedIds.set(fromProfile ?? []); return; }
      const raw = localStorage.getItem(this.hiddenKey);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      this.hiddenIds.set(Array.isArray(list) ? list : []);
      const rawSaved = localStorage.getItem(this.savedKey);
      const local = rawSaved ? (JSON.parse(rawSaved) as string[]) : [];
      this.savedIds.set(fromProfile ?? (Array.isArray(local) ? local : []));
    } catch {
      this.hiddenIds.set([]);
      this.savedIds.set(fromProfile ?? []);
    }
  }

  /**
   * "Don't want to see this." The post is dropped from this device's feed.
   * Nothing is reported and the poster is not told - this is a personal filter,
   * not moderation. Undo is offered by the caller.
   */
  async hidePost(postId: string): Promise<void> {
    if (this.hiddenIds().includes(postId)) return;
    this.hiddenIds.set([...this.hiddenIds(), postId]);
    this.feed.set(this.feed().filter((p) => p.id !== postId));
    this.persistViewerPrefs();
  }

  async unhidePost(postId: string): Promise<void> {
    if (!this.hiddenIds().includes(postId)) return;
    this.hiddenIds.set(this.hiddenIds().filter((x) => x !== postId));
    this.persistViewerPrefs();
    await this.loadFeed();
  }

  /* ------------------------ following -------------------------- */
  async followStatus(targetId: string): Promise<'accepted' | 'pending' | null> {
    const me = this.auth.viewerId;
    if (!me || me === targetId) return null;
    return this.api.followStatus(me, targetId);
  }

  async isFollowing(targetId: string): Promise<boolean> {
    const me = this.auth.viewerId;
    if (!me || me === targetId) return false;
    return this.api.isFollowing(me, targetId);
  }

  async toggleFollow(targetId: string): Promise<boolean> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to follow');
    if (me === targetId) throw new Error('You cannot follow yourself');
    if (this.auth.user()?.suspended) throw new Error('Your account is suspended');
    const existing = await this.api.followStatus(me, targetId);
    if (existing === 'accepted') {
      await this.api.unfollow(me, targetId);
      this.followingIds.set(this.followingIds().filter((x) => x !== targetId));
      return false;
    }
    if (existing === 'pending') {
      await this.api.unfollow(me, targetId);
      return false;
    }
    const outcome = await this.api.follow(me, targetId);
    if (outcome === 'pending') {
      // They approve requests first. Nothing counts until they say yes.
      await this.api.pushNotification({
        id: uid('n'), userId: targetId, kind: 'follow',
        title: 'New follow request',
        body: `${this.auth.user()?.displayName ?? 'Someone'} asked to follow you.`,
        at: Date.now(), read: false, route: '/connections', postId: null
      });
      return false;
    }
    this.followingIds.set([...new Set([...this.followingIds(), targetId])]);
    await this.api.pushNotification({
      id: uid('n'),
      userId: targetId,
      kind: 'follow',
      title: `${this.auth.user()?.displayName ?? 'Someone'} started following you`,
      body: 'Tap to view their profile.',
      at: Date.now(),
      read: false,
      route: `/user/${me}`,
      postId: null
    });
    return true;
  }

  async mutualFollow(otherId: string): Promise<boolean> {
    const me = this.auth.viewerId;
    if (!me) return false;
    return (await this.api.isFollowing(me, otherId)) && (await this.api.isFollowing(otherId, me));
  }

  /* ------------------------ spotlights ------------------------- */
  async createSpotlight(input: { surname: string; tagline: string; about: string; province: Spotlight['province'] }): Promise<Spotlight> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to create a spotlight');
    const surname = input.surname.trim().replace(/\s+/g, ' ');
    if (surname.length < 2) throw new Error('Enter a surname (at least 2 letters)');
    if (!/^[a-zA-Z'\-\s]+$/.test(surname)) throw new Error('A surname can only contain letters');
    if (!input.province) throw new Error('Choose the province this community belongs to');
    const all = await this.api.spotlights();
    const sameName = all.filter((s) => s.surname.toLowerCase() === surname.toLowerCase());
    if (sameName.some((s) => s.province === input.province)) {
      throw new Error(
        `A "${surname}" spotlight already exists in ${provinceName(input.province)}. ` +
        `Join that one instead of creating a second.`
      );
    }
    const sp: Spotlight = {
      id: uid('sp'),
      surname,
      tagline: input.tagline.trim() || `The ${surname} community on LulaFind`,
      coverHue: hueOf(surname),
      ownerId: me.id,
      adminIds: [me.id],
      memberIds: [me.id],
      postIds: [],
      followers: 1,
      province: input.province ?? me.province,
      verified: false,
      createdAt: Date.now(),
      about: input.about.trim()
    };
    await this.api.saveSpotlight(sp);
    await this.loadStatic();
    await this.loadFeed();
    return sp;
  }

  /**
   * Joining is instant - no admin approval. Anyone may join any community and
   * post to it straight away. Returns false if they were already a member.
   */
  async joinSpotlight(id: string): Promise<boolean> {
    const me = this.auth.user();
    const sp = await this.api.spotlight(id);
    if (!me || !sp) throw new Error('That community is not here any more');
    if (me.suspended) throw new Error('Your account is suspended, so you cannot join communities');
    if (sp.memberIds.includes(me.id)) return false;
    const joined = await this.api.setSpotlightMembership(id, me.id, true);
    if (!joined) throw new Error('That community is not here any more');
    await this.loadStatic();
    return true;
  }

  async leaveSpotlight(id: string): Promise<void> {
    const me = this.auth.viewerId;
    const sp = await this.api.spotlight(id);
    if (!me || !sp || !sp.memberIds.includes(me)) return;
    if (sp.ownerId === me) throw new Error('You created this community. Delete it instead of leaving.');
    const left = await this.api.setSpotlightMembership(id, me, false);
    if (!left) return;
    await this.loadStatic();
  }

  /**
   * Edit a spotlight's mutable fields (tagline and about text).
   * Only the owner or an admin may call this.
   */
  async updateSpotlight(id: string, patch: { tagline: string; about: string }): Promise<Spotlight> {
    const me = this.auth.user();
    const sp = await this.api.spotlight(id);
    if (!me || !sp) throw new Error('That community is not here any more');
    if (sp.ownerId !== me.id && !sp.adminIds.includes(me.id)) {
      throw new Error('Only the community owner can edit this');
    }
    const updated: Spotlight = {
      ...sp,
      tagline: patch.tagline.trim() || sp.tagline,
      about: patch.about.trim()
    };
    await this.api.saveSpotlight(updated);
    await this.loadStatic();
    return updated;
  }

  /**
   * Permanently delete a spotlight. Only the owner may do this.
   * Posts that referenced the spotlight remain on the feed.
   */
  async deleteSpotlight(id: string): Promise<void> {
    const me = this.auth.user();
    const sp = await this.api.spotlight(id);
    if (!me || !sp) return;
    if (sp.ownerId !== me.id && !me.isAdmin) {
      throw new Error('Only the community owner can delete this');
    }
    await this.api.deleteSpotlight(id);
    await this.loadStatic();
  }

  /** Find a community by surname (and optionally province). */
  spotlightForSurname(surname: string, province?: string | null): Spotlight | undefined {
    const needle = surname.trim().toLowerCase();
    if (!needle) return undefined;
    const all = this.spotlights();
    return (
      all.find((s) => s.province === province && s.surname.toLowerCase() === needle) ??
      all.find((s) => s.surname.toLowerCase() === needle)
    );
  }

  /** Communities the signed-in person has joined or created - used by the composer. */
  readonly mySpotlights = computed(() => {
    const me = this.auth.viewerId;
    return me ? this.spotlights().filter((s) => s.memberIds.includes(me)) : [];
  });

  isMember(spotlightId: string | null): boolean {
    const me = this.auth.viewerId;
    if (!me || !spotlightId) return false;
    return !!this.spotlights().find((s) => s.id === spotlightId && s.memberIds.includes(me));
  }

  /**
   * Everything for a Spotlight page: posts filed into it, plus any post about
   * a person with that surname (so nobody has to scroll the whole feed).
   * Independent of the home feed filters; found cases included.
   */
  async postsForSpotlight(sp: Spotlight): Promise<Post[]> {
    const me = this.auth.viewerId;
    const needle = sp.surname.trim().toLowerCase();
    const all = await this.api.queryFeed({ ...emptyFilter(), status: 'all', sort: 'recent' }, me);
    const hidden = this.hiddenIds();
    const list = all.filter((p) => !RETIRED_POST_TYPES.includes(p.type) && !hidden.includes(p.id) && (
      p.spotlightId === sp.id ||
      (p.type !== 'danger' && !!needle && (
        (p.subject?.surname ?? '').trim().toLowerCase() === needle ||
        (p.subject?.name ?? '').trim().toLowerCase().split(/\s+/).includes(needle)
      ))
    ));
    this.mergeCache(list);
    return uniqueById(list).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Posts on someone's profile, straight from the database rather than by
   * filtering the viewer's feed. Returns them and caches the authors so the
   * cards render with names and avatars.
   */
  async postsByAuthor(authorId: string): Promise<Post[]> {
    const list = uniqueById(await this.api.postsByAuthor(authorId))
      .filter((p) => !RETIRED_POST_TYPES.includes(p.type) && !this.hiddenIds().includes(p.id))
      .sort((a, b) => b.createdAt - a.createdAt);
    this.mergeCache(list);
    return list;
  }

  spotlightPosts(id: string): Post[] {
    return this.feed().filter((p) => p.spotlightId === id);
  }

  spotlightCover(s: Spotlight): string {
    return cover(`${s.surname} family`, s.coverHue || undefined);
  }

  /* -------------------------- stories -------------------------- */
  async createStory(input: {
    text: string;
    media: Story['media'];
    bgHue: number;
    audience?: Audience;
    spotlightId?: string | null;
  }): Promise<Story> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to post a story');
    if (me.suspended) throw new Error('Your account is suspended');
    if (!input.text.trim() && !input.media.length) throw new Error('Add a photo or some words');
    const audience = input.audience ?? 'public';
    if (audience === 'surname' && (!input.spotlightId || !this.isMember(input.spotlightId))) {
      throw new Error('Choose a Spotlight community you have joined.');
    }
    if (input.media.length > 3 || input.media.some((item) => item.kind !== 'image')) {
      throw new Error('A story can contain up to three photos. Video stories are not available yet.');
    }
    const media = await Promise.all(input.media.map((item) => this.api.uploadMedia(me.id, item)));
    const now = Date.now();
    const s: Story = {
      id: uid('s'),
      authorId: me.id,
      createdAt: now,
      expiresAt: now + 24 * HOUR,
      media,
      text: input.text.trim(),
      bgHue: input.bgHue,
      viewers: [],
      replies: [],
      audience,
      spotlightId: audience === 'surname' ? input.spotlightId ?? null : null
    };
    await this.api.saveStory(s);
    // Put the new story straight in the rail. A full loadStatic() here was a
    // round trip per story in the app, which is why posting felt like a stall.
    this.stories.update((all) => [s, ...all.filter((x) => x.id !== s.id)]);
    void this.loadStatic();
    return s;
  }

  /** Stories the signed-in person is allowed to see, newest first. */
  readonly visibleStories = computed(() => {
    const me = this.auth.viewerId;
    const all = this.stories();
    return all.filter((s) => {
      if (s.authorId === me) return true;
      if (s.audience === 'public') return true;
      if (!me) return false;
      if (s.audience === 'followers') return this.followingIds().includes(s.authorId);
      if (s.audience === 'surname') {
        if (!s.spotlightId) return false;
        const sp = this.spotlights().find((x) => x.id === s.spotlightId);
        return !!sp && sp.memberIds.includes(me);
      }
      return true;
    });
  });

  async markStorySeen(storyId: string): Promise<void> {
    const me = this.auth.viewerId;
    const s = this.visibleStories().find((x) => x.id === storyId);
    if (!s || !me || s.authorId === me || s.viewers.includes(me)) return;
    const views = await this.api.storyViewsFor(storyId);
    if (views.some((view) => view.viewerId === me)) return;
    const view: StoryView = { id: `sv_${storyId}_${me}`, storyId, viewerId: me, at: Date.now() };
    await this.api.saveStoryView(view);
    this.patchStory(storyId, (story) =>
      story.authorId === me
        ? story
        : { ...story, viewers: story.viewers.includes(me) ? story.viewers : [...story.viewers, me] });
  }

  /** Update one story in place, without re-querying the whole story rail. */
  private patchStory(id: string, change: (story: Story) => Story): void {
    this.stories.update((all) => all.map((s) => (s.id === id ? change(s) : s)));
  }

  async replyToStory(storyId: string, body: string): Promise<void> {
    const me = this.auth.viewerId;
    const text = body.trim();
    const s = this.visibleStories().find((x) => x.id === storyId);
    if (!me) throw new Error('Sign in to reply to a story');
    if (!s) throw new Error('This story is no longer available to you');
    if (!text) throw new Error('Write a reply first');
    const reply: StoryReply = { id: uid('r'), storyId, authorId: me, body: text, at: Date.now() };
    await this.api.saveStoryReply(reply);
    if (s.authorId !== me) {
      await this.notify({
        userId: s.authorId,
        kind: 'story_reply',
        title: 'A reply to your story',
        body: `${this.auth.user()?.displayName ?? 'Someone'}: ${text.slice(0, 100)}`,
        route: `/story/${s.id}`,
        postId: null
      });
    }
    this.patchStory(storyId, (story) =>
      story.authorId === me && !story.replies.some((r) => r.id === reply.id)
        ? { ...story, replies: [...story.replies, reply].sort((a, b) => a.at - b.at) }
        : story);
  }

  async deleteStory(storyId: string): Promise<void> {
    const s = this.stories().find((x) => x.id === storyId);
    if (!s) return;
    if (s.authorId !== this.auth.viewerId) throw new Error('Only the person who shared this story can remove it');
    await this.api.saveStory({ ...s, expiresAt: 0 });
    this.stories.update((all) => all.filter((x) => x.id !== storyId));
  }

  /* --------------------- outcome / found ----------------------- */
  /**
   * Closes a case as found. Called either by the poster confirming, or after the
   * "did you get help?" nudge is answered yes.
   */
  async markFound(postId: string, opts: { whereabouts: string; note?: string; asWhereaboutsOnly?: boolean; finderUserId?: string | null }): Promise<Post | undefined> {
    const me = this.auth.viewerId;
    const p = await this.loadPost(postId);
    if (!p) return undefined;

    // Credit the member they selected. A case credits one person, once.
    let finderUserId = p.outcome?.finderUserId ?? null;
    let finderName = p.outcome?.finderName ?? '';
    const want = opts.finderUserId ?? null;
    if (want && !finderUserId) {
      const finder = await this.api.user(want);
      if (finder && finder.suspended !== true) {
        const credits = (finder.contributorCredits ?? 0) + 1;
        const updated = { ...finder, contributorCredits: credits };
        await this.api.saveUser(updated);
        this.touchAuthor(updated);
        this.auth.syncUser(updated);
        finderUserId = finder.id;
        finderName = finder.displayName;
        const subject = p.subject?.name?.trim() || 'someone';
        await this.notify({
          userId: finder.id,
          kind: 'outcome',
          title: 'You earned a contributor badge',
          body: `You were named as the person who found ${subject}. Your badge is now x${credits}.`,
          route: `/user/${finder.id}`,
          postId: p.id
        });
      }
    }

    const next: Post = {
      ...p,
      status: 'found',
      updatedAt: Date.now(),
      outcome: {
        found: true,
        foundAt: Date.now(),
        whereaboutsFound: opts.whereabouts.trim(),
        closedBy: me,
        note: opts.note?.trim() || (opts.asWhereaboutsOnly ? 'Whereabouts confirmed - case closed.' : 'Found safe.'),
        finderUserId,
        finderName
      },
      events: [
        ...p.events,
        {
          at: Date.now(),
          kind: opts.asWhereaboutsOnly ? 'whereabouts_found' : 'found',
          byUserId: me,
          note: finderName ? `${opts.whereabouts} · found by ${finderName}` : opts.whereabouts
        }
      ]
    };
    await this.api.savePost(next);
    this.mergeCache([next]);
    // Their own profile shows the case at every stage, found included.
    this.myAuthored.update((list) => list.map((x) => (x.id === next.id ? next : x)));
    await this.loadFeed();
    return next;
  }

  /**
   * Stamp a post with "we have already asked whether they were found".
   *
   * This runs in the background, minutes or hours after the post was read. The
   * write is conditional on the record still being exactly what we read: if the
   * case has since been edited or closed by someone else, the nudge is dropped
   * rather than putting an old copy of the case back.
   */
  async setOutcomeNudged(postId: string): Promise<void> {
    const p = await this.loadPost(postId);
    if (!p) return;
    const now = Date.now();
    const next = { ...p, outcomeNudgeAt: now, updatedAt: now };
    const applied = await this.api.savePost(next, { ifUnchangedSince: p.updatedAt });
    if (applied) this.mergeCache([next]);
  }

  /** The poster confirms the case is still open; keep a visible, saved update. */
  async confirmStillSearching(postId: string): Promise<Post> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to update this case');
    if (this.auth.user()?.suspended) throw new Error('Your account is suspended');
    const p = this.post(postId) ?? await this.loadPost(postId);
    if (!p) throw new Error('That post is not here any more');
    if (p.authorId !== me) throw new Error('Only the person who posted this can update the case');
    if (p.status !== 'active' && p.status !== 'under_review') {
      throw new Error('This case is no longer open. Its status has not been changed.');
    }
    if (p.type !== 'missing' && p.type !== 'khumbulekhaya') {
      throw new Error('This status update is only available on a missing-person case');
    }

    const now = Date.now();
    const event = {
      at: now,
      kind: 'still_searching' as const,
      byUserId: me,
      note: 'The poster confirmed that they are still searching. The case remains open.'
    };
    const updated = await this.api.patchPost(postId, {
      events: [...(p.events ?? []), event],
      outcomeNudgeAt: now,
      updatedAt: now
    });
    if (!updated) throw new Error('Could not save the case update. Try again.');
    this.replacePostViews(updated);
    return updated;
  }

  /* --------------------- Home Sweet Home flow -------------------- */
  /** The subject claims the post: "this is me". */
  async claimKhumbuPost(postId: string): Promise<Post | undefined> {
    const me = this.auth.viewerId;
    const p = await this.loadPost(postId);
    if (!me || !p) return undefined;
    if ((p.subject?.age ?? 99) < 18) {
      throw new Error('You cannot claim a case involving a child under 18 online');
    }
    const khumbu = p.khumbu ?? {
      daysOut: null,
      leftHomeAt: null,
      reasonGuess: '',
      claimedByUserId: null,
      claimedAt: null,
      subjectResponse: 'none' as const,
      subjectNote: '',
      wantedAnswers: { yes: 0, no: 0, myVote: null }
    };
    const next: Post = {
      ...p,
      khumbu: { ...khumbu, claimedByUserId: me, claimedAt: Date.now() },
      events: [...p.events, { at: Date.now(), kind: 'claimed', byUserId: me, note: 'Person in the post says: this is me' }]
    };
    await this.api.savePost(next);
    this.mergeCache([next]);
    await this.loadFeed();
    return next;
  }

  /** The subject answers: coming home, or safe but not coming home. */
  async subjectRespond(postId: string, response: NonNullable<Post['khumbu']>['subjectResponse'], note: string): Promise<Post | undefined> {
    const me = this.auth.viewerId;
    const p = await this.loadPost(postId);
    if (!me || !p || !p.khumbu) return undefined;
    const next: Post = {
      ...p,
      status: response === 'not_going_home' ? 'not_going_home' : p.status,
      khumbu: { ...p.khumbu, subjectResponse: response, subjectNote: note.trim() },
      events: [
        ...p.events,
        { at: Date.now(), kind: response === 'not_going_home' ? 'not_going_home' : 'going_home', byUserId: me, note }
      ]
    };
    await this.api.savePost(next);
    this.mergeCache([next]);
    if (p.authorId !== me) {
      await this.api.pushNotification({
        id: uid('n'),
        userId: p.authorId,
        kind: 'claim',
        title: response === 'not_going_home' ? 'They are safe but not coming home' : 'They answered your Home Sweet Home',
        body: note.trim() || (response === 'not_going_home' ? 'They asked that you respect this.' : 'They are coming home.'),
        at: Date.now(),
        read: false,
        route: `/post/${p.id}`,
        postId: p.id
      });
    }
    await this.loadFeed();
    return next;
  }

  /** Community answers the "Are they being wanted?" question. */
  async answerWanted(postId: string, answer: boolean): Promise<Post | undefined> {
    const me = this.auth.viewerId;
    const p = await this.loadPost(postId);
    if (!me || !p || !p.khumbu) return undefined;
    const w = p.khumbu.wantedAnswers;
    const changed = w.myVote === answer ? null : w.myVote;
    const next: Post = {
      ...p,
      khumbu: {
        ...p.khumbu,
        wantedAnswers: {
          yes: Math.max(0, w.yes + (answer ? 1 : 0) - (changed === true ? 1 : 0)),
          no: Math.max(0, w.no + (answer ? 0 : 1) - (changed === false ? 1 : 0)),
          myVote: answer
        }
      }
    };
    await this.api.savePost(next);
    this.mergeCache([next]);
    return next;
  }

  /* ------------------------- reporting ------------------------- */
  async flag(postId: string, reason: string): Promise<void> {
    const me = this.auth.viewerId;
    const p = await this.loadPost(postId);
    if (!p || !me) return;
    await this.api.savePost({
      ...p,
      flags: [...p.flags, { reason, byUserId: me, at: Date.now(), resolved: false }]
    });
  }

  /**
   * Tell other people in the same province. The poster already knows.
   * The alert stays on the feed for everyone; the notice is for people nearby.
   */
  /* --------------------------- case alerts ---------------------- */

  /**
   * Tell the right people a new case is live.
   *
   * The whole point of a missing-person app is this one message, so the rules are
   * explicit and each member's own alert preferences (Settings -> Alerts, kept on
   * their profile) decide whether they get it:
   *
   *  - the master push switch off means nothing at all;
   *  - "missing children only" silences everything except under-18 cases;
   *  - the alert province narrows it to one province, or all nine;
   *  - a case with no coordinates still goes out by province, because an address
   *    nobody has yet must never stop an alert.
   *
   * Returns how many members were reached, which the admin review screen shows.
   */
  async alertCase(post: Post): Promise<number> {
    if (!isCasePost(post) || post.status !== 'active') return 0;
    const child = isChildCase(post);
    const users = await this.api.users().catch(() => [] as UserProfile[]);
    const place = [post.town, provinceName(post.province)].filter(Boolean).join(', ');
    let sent = 0;
    for (const u of users) {
      if (u.id === post.authorId || u.suspended) continue;
      const prefs = u.alertPrefs ?? null;
      if (prefs) {
        if (!prefs.enabled) continue;
        if (prefs.childrenOnly && !child) continue;
        if (prefs.province !== 'all' && prefs.province !== post.province) continue;
      } else if (u.province && u.province !== post.province) {
        // No saved preferences: province-level alerts, never a silent drop.
        continue;
      }
      await this.api.pushNotification({
        id: uid('n'),
        userId: u.id,
        kind: 'missing',
        title: child ? 'A child is missing nearby' : 'A new missing case nearby',
        body: `${post.subject?.name?.trim() || 'Someone'} · ${place}. Open the case for the poster.`,
        at: Date.now(),
        read: false,
        route: `/post/${post.id}`,
        postId: post.id
      });
      sent++;
    }
    return sent;
  }

  /**
   * Where this phone last saw itself, if the member ever shared a location.
   * Used only to say how far a case alert is from them. Nothing is uploaded.
   */
  devicePoint(): GeoPoint | null {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lulafind.lastLocation') : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { point?: GeoPoint };
      const point = parsed?.point;
      return point && typeof point.lat === 'number' && typeof point.lng === 'number' ? point : null;
    } catch {
      return null;
    }
  }

  /** Cases that closed as found, for the reunions page. */
  closedCases(): Promise<Post[]> {
    return this.api.foundCases();
  }

  /**
   * Tick a step on a case's first-hours checklist. Author or admin only.
   * Nothing here is public: the checklist is the family's own working sheet.
   */
  async tickStep(postId: string, step: CaseStepId, done: boolean): Promise<Post | undefined> {
    const me = this.auth.user();
    const p = await this.loadPost(postId);
    if (!me || !p) throw new Error('That post is not here any more');
    if (p.authorId !== me.id && me.isAdmin !== true) throw new Error('Only the person who posted this can change the plan');
    const plan: CasePlan = { done: { ...(p.plan?.done ?? {}) }, officerName: p.plan?.officerName, officerContact: p.plan?.officerContact, updatedAt: Date.now() };
    plan.done[step] = done;
    if (!done) delete plan.done[step];
    const next = await this.api.patchPost(postId, { plan, updatedAt: Date.now() });
    if (next) this.touch(next);
    return next;
  }

  /** Save the investigating officer once, for the family's own eyes. */
  async saveOfficer(postId: string, officerName: string, officerContact: string): Promise<Post | undefined> {
    const me = this.auth.user();
    const p = await this.loadPost(postId);
    if (!me || !p) throw new Error('That post is not here any more');
    if (p.authorId !== me.id && me.isAdmin !== true) throw new Error('Only the person who posted this can add that');
    const plan: CasePlan = {
      done: { ...(p.plan?.done ?? {}) },
      officerName: officerName.trim(),
      officerContact: officerContact.trim(),
      updatedAt: Date.now()
    };
    if (plan.officerName && plan.officerContact) plan.done.officer_details = true;
    const next = await this.api.patchPost(postId, { plan, updatedAt: Date.now() });
    if (next) this.touch(next);
    return next;
  }

  /**
   * Keep the signed-in member's alert preferences on their profile, so a case
   * posted from any phone can be matched to them.
   */
  async saveAlertPrefs(prefs: AlertPrefs): Promise<void> {
    const me = this.auth.user();
    if (!me) return;
    const updated: UserProfile = { ...me, alertPrefs: prefs };
    await this.api.saveUser(updated);
    this.touchAuthor(updated);
    this.auth.syncUser(updated);
  }

  private async alertProvince(post: Post): Promise<void> {
    const users = await this.api.users();
    const kind = dangerLabel(post.danger?.kind);
    const place = [post.lastSeenWhere, post.town].filter(Boolean).join(', ');
    for (const u of users) {
      if (u.id === post.authorId || u.suspended) continue;
      if (u.province !== post.province) continue;
      await this.api.pushNotification({
        id: uid('n'),
        userId: u.id,
        kind: 'danger',
        title: `${kind} nearby`,
        body: `${place}. Stay away and do not approach.`,
        at: Date.now(),
        read: false,
        route: `/post/${post.id}`,
        postId: post.id
      });
    }
    if (this.auth.viewerId) await this.loadUserScoped();
  }

  /**
   * A viewer says the danger is still happening, or that it has cleared.
   * The person who posted can clear it at once. Three other people saying
   * it is clear also clears it, so one tap cannot hide a real alert.
   */
  async respondDanger(postId: string, still: boolean): Promise<Post | undefined> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to respond');
    const p = await this.loadPost(postId);
    if (!p || p.type !== 'danger' || !p.danger) throw new Error('That alert is not here');
    const stillIds = p.danger.stillIds.filter((id) => id !== me.id);
    const clearIds = p.danger.clearIds.filter((id) => id !== me.id);
    if (still) stillIds.push(me.id);
    else clearIds.push(me.id);
    const authorClears = !still && me.id === p.authorId;
    const communityClears = clearIds.length >= 3;
    const clearedAt = still
      ? null
      : (authorClears || communityClears ? (p.danger.clearedAt ?? Date.now()) : p.danger.clearedAt);
    const next: Post = {
      ...p,
      danger: { ...p.danger, stillIds, clearIds, clearedAt },
      updatedAt: Date.now()
    };
    await this.api.savePost(next);
    this.touch(next);
    if (me.id !== p.authorId) {
      await this.notify({
        userId: p.authorId,
        kind: 'danger',
        title: still ? 'Someone says it is still happening' : 'Someone says it has cleared',
        body: p.lastSeenWhere || p.town,
        route: `/post/${p.id}`,
        postId: p.id
      });
    }
    await this.loadFeed();
    return next;
  }

  /* ---------------------- notifications ------------------------ */
  async markNotificationsRead(): Promise<void> {
    const me = this.auth.viewerId;
    if (!me) return;
    await this.api.markNotificationsRead(me);
    await this.loadUserScoped();
  }

  async notify(n: Omit<Notification, 'id' | 'at' | 'read'>): Promise<void> {
    await this.api.pushNotification({ ...n, id: uid('n'), at: Date.now(), read: false });
    await this.loadUserScoped();
  }

  /* --------------------------- users --------------------------- */
  async profile(id: string): Promise<UserProfile | undefined> {
    return this.api.user(id);
  }

  /**
   * Re-read one profile from the database and push it into the author cache.
   * Called after a profile is saved so the screen shows what was actually
   * stored, not what the form hoped for.
   */
  async refreshProfile(id: string): Promise<UserProfile | undefined> {
    const u = await this.api.user(id);
    if (u) this.touchAuthor(u);
    return u;
  }

  /**
   * Load multiple user profiles by id in one call.
   * Used by the followers / following sheet in the Me tab.
   */
  async people(ids: string[]): Promise<UserProfile[]> {
    if (!ids.length) return [];
    const results = await Promise.all(ids.map((id) => this.api.user(id)));
    return results.filter((u): u is UserProfile => u !== undefined);
  }

  /**
   * Search every case the viewer may see, not just the page in memory.
   *
   * The backend runs the query, so a case posted last month is still found on
   * the day it matters. Hits already in the feed are merged in and de-duplicated
   * so a post made seconds ago answers immediately, before the next page of the
   * feed has arrived. One character is not enough to search on - it matches
   * almost everything and the request is not worth sending.
   */
  async searchPosts(q: string): Promise<Post[]> {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    let fromApi: Post[] = [];
    try {
      fromApi = await this.api.searchPosts(q);
    } catch {
      // Offline or the query failed: the copies on this device still answer.
    }
    const fromFeed = this.feed().filter((p) => this.matchesQuery(p, needle));
    const seen = new Set<string>();
    return [...fromApi, ...fromFeed].filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  /**
   * Find members by name, surname or handle across the whole member list - not
   * only the authors whose posts happen to be loaded. Profiles are pushed into
   * the author cache so a result card renders without a second round trip.
   */
  async searchUsers(q: string): Promise<UserProfile[]> {
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    if (!needle) return [];
    let hits: UserProfile[] = [];
    try {
      hits = await this.api.searchUsers(q);
    } catch {
      hits = await this.api.users();
    }
    const seen = new Set<string>();
    const out = hits.filter((u) => {
      if (u.suspended || seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
    out.forEach((u) => this.touchAuthor(u));
    return out;
  }

  /** The same fields the feed's free-text filter reads. One definition. */
  private matchesQuery(p: Post, needle: string): boolean {
    const author = this.authorOf(p.authorId);
    return [
      p.title, p.body, p.town, p.caseNumber ?? '',
      p.subject?.name ?? '', p.subject?.surname ?? '', author?.displayName ?? ''
    ].join(' ').toLowerCase().includes(needle);
  }

  /**
   * Every member who has the name that was typed, so the poster can pick the
   * right person. "John" returns every John. "John Doe" returns people who
   * have both words. Exact full-name matches come first.
   */
  async usersWithName(q: string): Promise<UserProfile[]> {
    const needle = q.trim().toLowerCase().replace(/\s+/g, ' ');
    const words = needle.split(' ').filter((w) => w.length >= 2);
    if (needle.length < 2 || !words.length) return [];
    const all = await this.api.users();
    const hits = all.filter((u) => {
      if (u.suspended) return false;
      const hay = `${u.displayName} ${u.surname}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    hits.sort((a, b) => {
      const ae = a.displayName.toLowerCase() === needle ? 0 : 1;
      const be = b.displayName.toLowerCase() === needle ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.displayName.localeCompare(b.displayName);
    });
    return hits;
  }

  /** Highest contributor count. A person at this number is the most named. */
  async topContributorCount(): Promise<number> {
    const all = await this.api.users();
    return all.reduce((m, u) => Math.max(m, u.contributorCredits ?? 0), 0);
  }

  /** Every username in use - lets a form check availability before saving. */
  async allHandles(): Promise<string[]> {
    try {
      return (await this.api.users()).map((u) => u.handle);
    } catch {
      return [];
    }
  }

  /**
   * “People you may know” for the newsfeed.
   *
   * Everyone except you, anyone you already follow (or asked to follow), and
   * suspended accounts. Same province first, then same surname community,
   * then everyone else — newest accounts last so the rail feels alive.
   */
  async suggestedPeople(limit = 10): Promise<UserProfile[]> {
    const me = this.auth.user();
    const all = await this.api.users().catch(() => [] as UserProfile[]);
    const following = new Set(this.followingIds());
    const requested = new Set(this.followRequests().map((r) => r.followerId));
    const scored = all
      .filter((u) => {
        if (!me && !u) return false;
        if (me && u.id === me.id) return false;
        if (u.suspended) return false;
        if (following.has(u.id) || requested.has(u.id)) return false;
        return true;
      })
      .map((u) => {
        let score = 0;
        if (me?.province && u.province === me.province) score += 30;
        if (me?.surname && u.surname.toLowerCase() === me.surname.toLowerCase()) score += 20;
        if (me?.town && u.town.toLowerCase() === me.town.toLowerCase()) score += 10;
        if ((u.contributorCredits ?? 0) > 0) score += 5;
        return { u, score };
      })
      .sort((a, b) => b.score - a.score || b.u.createdAt - a.u.createdAt);
    return scored.slice(0, limit).map((s) => s.u);
  }

  /**
   * The check-in status a viewer is allowed to see on an avatar ring.
   * The person always sees their own; everyone else only when the person has
   * not hidden their location. Returns null when there is nothing to show.
   */
  statusOf(u?: UserProfile | null, viewerId: string | null = this.auth.viewerId): UserProfile['checkIn'] extends null ? never : (import('../models/types').CheckInStatus | null) {
    const c = u?.checkIn;
    if (!u || !c) return null;
    if (u.id === viewerId) return c.status;
    if (!u.privacy?.showLocation && c.location) return null;
    if (c.liveShareOn && c.liveUntil && c.liveUntil <= Date.now()) return c.status;
    return c.status;
  }

  /* ---------------------- follow requests ---------------------- */

  /** Requests waiting on the signed-in person's decision. */
  readonly followRequests = signal<FollowEdge[]>([]);

  async loadFollowRequests(): Promise<void> {
    const me = this.auth.viewerId;
    if (!me) { this.followRequests.set([]); return; }
    this.followRequests.set(await this.api.followRequests(me));
  }

  /** Accept or decline one request. */
  /** Stop someone following you. They are not told. */
  async removeFollower(followerId: string): Promise<void> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to manage followers');
    await this.api.unfollow(followerId, me);
    this.followerIds.set(this.followerIds().filter((x) => x !== followerId));
    await this.loadUserScoped();
  }

  async respondToFollowRequest(followerId: string, accept: boolean): Promise<void> {
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to manage follow requests');
    await this.api.respondFollowRequest(followerId, me, accept);
    await this.api.pushNotification({
      id: uid('n'), userId: followerId,
      kind: accept ? 'follow' : 'system',
      title: accept ? 'Follow request accepted' : 'Follow request declined',
      body: accept
        ? `${this.auth.user()?.displayName ?? 'They'} accepted your request. You can follow each other now.`
        : `${this.auth.user()?.displayName ?? 'They'} declined your request.`,
      at: Date.now(), read: false,
      route: accept ? `/user/${me}` : null, postId: null
    });
    await this.loadFollowRequests();
    await this.loadUserScoped();
  }

  /* ------------------------- search party ------------------------- */

  /**
   * Open a ground search on a case. The poster (or an admin) names a meeting
   * point and the areas to cover; volunteers claim an area so nobody searches
   * the same street twice while another is untouched.
   */
  async openSearchParty(postId: string, meetAt: string, meetWhen: number | null, zones: string[]): Promise<void> {
    const p = this.cache()[postId] ?? (await this.api.post(postId));
    if (!p) throw new Error('That post does not exist');
    if (!this.canEdit(p)) throw new Error('Only the poster can open a search party');
    const list = zones.map((name) => ({
      id: uid('z'), name: name.trim(), priority: 'medium' as const, takenBy: null, done: false, note: ''
    })).filter((z) => z.name);
    const next = await this.api.patchPost(postId, {
      searchParty: { open: true, meetAt: meetAt.trim(), meetWhen, zones: list },
      updatedAt: Date.now()
    });
    if (next) this.touch(next);
    await this.loadFeed();
  }

  /** A volunteer claims an area of the search. */
  async claimSearchZone(postId: string, zoneId: string): Promise<void> {
    const p = this.cache()[postId] ?? (await this.api.post(postId));
    if (!p?.searchParty) throw new Error('That case has no open search party');
    const me = this.auth.viewerId;
    if (!me) throw new Error('Sign in to join a search party');
    // Re-read first: a volunteer is claiming one zone while someone else may be
    // claiming another, and only the searchParty field is written back.
    const fresh = (await this.api.post(postId)) ?? p;
    const party = fresh.searchParty ?? p.searchParty;
    const zones = party.zones.map((z) =>
      z.id === zoneId ? { ...z, takenBy: z.takenBy === me ? null : me } : z
    );
    const next = await this.api.patchPost(postId, { searchParty: { ...party, zones }, updatedAt: Date.now() });
    if (next) this.touch(next);
    await this.loadFeed();
  }

  /**
   * One tap: I am looking near the last-seen place.
   * Tells the poster only. A second tap takes it back.
   * Returns whether you are looking now.
   */
  async markLooking(postId: string): Promise<boolean> {
    const me = this.auth.user();
    if (!me) throw new Error('Sign in to say you are looking');
    const p = this.cache()[postId] ?? (await this.api.post(postId));
    if (!p) throw new Error('That post does not exist');
    if (p.status !== 'active') throw new Error('This search is closed');
    if (p.authorId === me.id) throw new Error('The family already knows you are on this');
    const ids = new Set(p.lookingIds ?? []);
    const on = !ids.has(me.id);
    if (on) ids.add(me.id);
    else ids.delete(me.id);
    const next = { ...p, lookingIds: [...ids], updatedAt: Date.now() };
    await this.api.savePost(next);
    this.touch(next);
    if (on) {
      const place = p.lastSeenWhere?.trim() || p.town || 'the last-seen place';
      await this.api.pushNotification({
        id: uid('n'),
        userId: p.authorId,
        kind: 'system',
        title: `${me.displayName.split(' ')[0]} is looking`,
        body: `Near ${place}.`,
        at: Date.now(),
        read: false,
        route: `/post/${p.id}`,
        postId: p.id
      });
    }
    await this.loadFeed();
    return on;
  }

  /** Mark an area searched. */
  async completeSearchZone(postId: string, zoneId: string, note = ''): Promise<void> {
    const p = this.cache()[postId] ?? (await this.api.post(postId));
    if (!p?.searchParty) throw new Error('That case has no open search party');
    // Same reason as claiming a zone: re-read, then write back only this field.
    const fresh = (await this.api.post(postId)) ?? p;
    const party = fresh.searchParty ?? p.searchParty;
    const zones = party.zones.map((z) =>
      z.id === zoneId ? { ...z, done: !z.done, note: note.trim().slice(0, 200) || z.note } : z
    );
    const next = await this.api.patchPost(postId, { searchParty: { ...party, zones }, updatedAt: Date.now() });
    if (next) this.touch(next);
    await this.loadFeed();
  }

  /* --------------------------- misc ---------------------------- */
  /**
   * The picture to show for a person.
   *
   * A photo the person uploaded always wins. Falling straight through to the
   * generated initials is what made "profile photo saved" look like nothing
   * had happened: the row saved, but every avatar on the app ignored it.
   */
  avatarFor(u?: UserProfile | null): string {
    if (!u) return avatar('Anonymous');
    return u.avatarUrl || avatar(u.displayName, u.avatarHue);
  }

  sceneFor(title: string, tone: 'street' | 'home' | 'map' | 'night' = 'street'): string {
    return scene(title, title, tone);
  }

  displayName(p: Post, u?: UserProfile | null): string {
    if (p.anonymous && this.auth.viewerId !== p.authorId) return 'Anonymous';
    return u?.displayName ?? 'LulaFind member';
  }

  provinceLabel(code: string): string {
    return provinceName(code);
  }

  compact(n: number): string {
    return compact(n);
  }

  get demoMode(): boolean {
    return true;
  }

  async resetDemoData(): Promise<void> {
    await this.api.reset();
    await this.loadStatic();
    await this.loadFeed();
  }

  /** How stale is the newest post - used for the "live" pill in the header. */
  get newestAt(): number {
    return this.feed().reduce((max, p) => Math.max(max, p.updatedAt), 0) || Date.now() - DAY;
  }
}

/** Public case types that deserve an alert when they go live. */
function isCasePost(p: Post): boolean {
  return p.type === 'missing' || p.type === 'khumbulekhaya';
}

/** A child case: the one kind that must never be silenced. */
function isChildCase(p: Post): boolean {
  const age = p.subject?.age;
  return typeof age === 'number' && age < 18;
}

/** Does this post describe someone under 18? */
function isChildSubject(input: CreatePostInput): boolean {
  if (input.type !== 'missing' && input.type !== 'khumbulekhaya') return false;
  const age = input.subject?.age;
  return typeof age === 'number' && age < 18;
}
