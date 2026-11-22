import {
  ChatMessage, ChatThread, Comment, FeedFilter, FollowEdge, Lookout, Notification, Post, Spotlight, Story, Tip, UserReport,
  ReactionKind, UserProfile, defaultPrivacy, isReaction
} from '../models/types';
import { seedComments, seedPosts, seedSpotlights, seedStories, seedTips, seedUsers } from './seed';
import { canReadPostAudience } from '../utils/audience';
import { answerBlocker, hasAnswered, withAnswer } from '../utils/lookout';
import { lookoutCasePost } from '../utils/lookout-case';

/**
 * Durable key/value store used by the mock data layer.
 * Tries localStorage first, falls back to memory (Safari private mode / SSR).
 */
export class KvStore {
  private memory = new Map<string, string>();
  /** false in Node / unit tests - everything then lives in memory for the session. */
  private readonly hasLs: boolean;

  constructor(private prefix: string) {
    this.hasLs = typeof localStorage !== 'undefined';
  }

  private k(key: string): string {
    return `${this.prefix}.${key}`;
  }

  get<T>(key: string, fallback: T): T {
    try {
      const raw = this.hasLs ? localStorage.getItem(this.k(key)) : (this.memory.get(this.k(key)) ?? null);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return this.memory.has(this.k(key)) ? (JSON.parse(this.memory.get(this.k(key))!) as T) : fallback;
    }
  }

  set(key: string, value: unknown): void {
    const raw = JSON.stringify(value);
    this.memory.set(this.k(key), raw);
    if (!this.hasLs) return;
    try {
      localStorage.setItem(this.k(key), raw);
    } catch {
      /* storage full or blocked - memory copy still works for this session */
    }
  }

  remove(key: string): void {
    this.memory.delete(this.k(key));
    if (!this.hasLs) return;
    try {
      localStorage.removeItem(this.k(key));
    } catch {
      /* ignore */
    }
  }

  clearAll(): void {
    this.memory.clear();
    if (!this.hasLs) return;
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(this.prefix))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    this.memory.clear();
  }
}

/**
 * Deep copy for anything that gets stored in a signal or handed to a component.
 * Signals compare by reference and callers mutate what they are given, so a
 * shallow copy is not enough for objects that hold arrays (memberIds, media,
 * voterIds...). A shared nested array is exactly how a UI ends up showing
 * stale or corrupted data.
 */
const clone = <T>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);

export interface DbSnapshot {
  users: UserProfile[];
  posts: Post[];
  comments: Comment[];
  spotlights: Spotlight[];
  stories: Story[];
  threads: ChatThread[];
  messages: ChatMessage[];
  follows: FollowEdge[];
  notifications: Notification[];
  tips: Tip[];
  lookouts: Lookout[];
}

const VERSION_KEY = 'seedVersion';
const SEED_VERSION = 10;
/** Live phones never load the old demo snapshot. Version 9 is an empty store. */
const LIVE_VERSION = 9;

/** A membership change waiting for the server to accept it. */
export interface PendingMembership {
  spotlightId: string;
  memberId: string;
  joining: boolean;
  at: number;
}

/** Kept beside the snapshot, not inside it: it is about the account, not the data. */
const PENDING_MEMBERSHIP_KEY = 'pendingSpotlightMemberships';

export const emptyDb = (): DbSnapshot => ({
  users: [],
  posts: [],
  comments: [],
  spotlights: [],
  stories: [],
  threads: [],
  messages: [],
  follows: [],
  notifications: [],
  tips: [],
  lookouts: []
});

/**
 * In-memory database with localStorage persistence.
 * Every mutating method returns a fresh array reference so signal-based
 * components re-render without change-detection gymnastics.
 */
export class LocalDb {
  private store = new KvStore('lulafind.db');
  // Reports are separate from the demo/live snapshot so a report cannot be
  // accidentally wiped by a data-shape migration. MockApi still exercises the
  // same durable adapter contract as SupabaseApi.
  private reportStore = new KvStore('lulafind.reports');
  private db: DbSnapshot;
  private rev = 0;
  private listeners = new Set<() => void>();
  /**
   * Tests pass true and still receive the fixture cases.
   * The running app passes false and starts empty. Fake people are not data.
   */
  private readonly seedDemo: boolean;

  /**
   * `demo` = use the built-in sample dataset instead of an empty live database.
   *
   * The sample data is seeded once and then behaves like any other database:
   * what a person does in demo mode (onboarding, a post, a comment) survives a
   * reload, which is what makes the app reviewable end to end. Settings has an
   * explicit "reset app data" for starting over; wiping on every page load - as
   * this used to do - made the whole app look like it had forgotten the session.
   */
  constructor(demo = false) {
    this.seedDemo = demo;
    if (this.seedDemo) {
      const stored = this.store.get<DbSnapshot | null>('snapshot', null);
      const storedVersion = this.store.get<number>(VERSION_KEY, 0);
      if (stored && stored.users?.length && storedVersion === SEED_VERSION) {
        this.db = stored;
        this.migrate();
      } else {
        this.db = this.seed();
        this.store.set(VERSION_KEY, SEED_VERSION);
        this.persist();
      }
      return;
    }
    const stored = this.store.get<DbSnapshot | null>('snapshot', null);
    const storedVersion = this.store.get<number>(VERSION_KEY, 0);
    if (stored && storedVersion === LIVE_VERSION && !this.looksLikeDemo(stored)) {
      this.db = stored;
      this.migrate();
    } else {
      this.db = this.emptyLive();
      this.store.set(VERSION_KEY, LIVE_VERSION);
      this.persist();
    }
  }

  /** A leftover preview snapshot full of invented people must not come back. */
  private looksLikeDemo(stored: DbSnapshot): boolean {
    return (
      stored.users?.some((u) => u.id === 'u_demo') === true ||
      stored.posts?.some((p) => p.id === 'p_thato' || p.id === 'p_johan') === true
    );
  }

  /** Instructions stay. Invented cases, chats and accounts do not. */
  private emptyLive(): DbSnapshot {
    const db = emptyDb();
    db.tips = seedTips() as unknown as Tip[];
    return db;
  }

  /** Fill in fields added after a snapshot was first written. */
  private migrate(): void {
    let touched = false;
    for (const u of this.db.users) {
      if (!u.privacy) { u.privacy = defaultPrivacy(); touched = true; }
      if (u.isAdmin === undefined) { u.isAdmin = u.id === 'u_demo'; touched = true; }
      if (u.suspended === undefined) { u.suspended = false; touched = true; }
      if (u.checkIn === undefined) { u.checkIn = null; touched = true; }
      if (u.privacy && u.privacy.requireFollowApproval === undefined) {
        u.privacy.requireFollowApproval = false; touched = true;
      }
      /* The safety-post choice: off by default, and only ever the person's to make. */
      if (u.privacy && u.privacy.showLastSeen === undefined) { u.privacy.showLastSeen = true; touched = true; }
      if (u.privacy && u.privacy.allowSafetyAlertPosts === undefined) { u.privacy.allowSafetyAlertPosts = false; touched = true; }
      if (u.privacy && u.privacy.safetyAlertAudience === undefined) { u.privacy.safetyAlertAudience = 'followers'; touched = true; }
      if (u.privacy && u.privacy.safetyAlertSpotlightId === undefined) { u.privacy.safetyAlertSpotlightId = null; touched = true; }
    }
    for (const e of this.db.follows) {
      if (!e.status) { e.status = 'accepted'; touched = true; }
    }
    for (const st of this.db.stories) {
      if (!st.audience) { st.audience = 'public'; st.spotlightId = null; touched = true; }
    }
    if (!Array.isArray((this.db as Partial<DbSnapshot>).lookouts)) { this.db.lookouts = []; touched = true; }
    for (const l of this.db.lookouts ?? []) {
      if (l.askedAt === undefined) { l.askedAt = null; touched = true; }
    }
    /*
     * 'pet' is now 'announcement'.
     *
     * A lost dog and a found wallet are the same act - announcing something the
     * neighbourhood should know - so the separate type went. Posts written
     * before that change keep pointing at a type that no longer exists, which
     * would drop them out of every filter; this moves them over on first load
     * rather than leaving them stranded in the database.
     */
    for (const p of this.db.posts) {
      if ((p.type as string) === 'pet') { p.type = 'announcement'; touched = true; }
    }
    if (touched) this.persist();
  }

  private seed(): DbSnapshot {
    const db = emptyDb();
    db.users = seedUsers();
    db.posts = seedPosts();
    db.comments = seedComments();
    db.spotlights = seedSpotlights();
    db.stories = seedStories();
    db.tips = seedTips() as unknown as Tip[];

    // wire spotlights <-> posts
    for (const p of db.posts) {
      if (p.spotlightId) db.spotlights.find((s) => s.id === p.spotlightId)?.postIds.push(p.id);
      p.commentCount = db.comments.filter((c) => c.postId === p.id).length;
    }
    // The demo user reacts to a couple of things so the UI shows an active state.
    const voted = db.posts.find((p) => p.id === 'p_johan');
    if (voted) voted.voterIds['u_demo'] = 'like';
    /*
     * Every reaction count has faces behind it.
     *
     * The cards carried an `upvotes` number with no voters at all, so a post
     * could read "412" and then open a Reactions sheet saying "No reactions yet":
     * the number and the list were two different facts. Each post now gets a
     * stable slice of the community as its known voters, and the count is never
     * smaller than the list it can actually show. Bigger counts stay - a case can
     * be shared far beyond this small demo network - and the sheet states how
     * many more people reacted, so nothing is claimed that cannot be shown.
     *
     * `u_demo` is deliberately left out: the signed-in person's own reaction is
     * theirs to give, never pre-seeded behind their back.
     */
    const voters = db.users.filter((u) => u.id !== 'u_mod' && u.id !== 'u_demo').map((u) => u.id);
    const kinds: ReactionKind[] = ['like', 'support', 'sad', 'up'];
    db.posts.forEach((p, index) => {
      if (p.upvotes <= 0) return;
      const size = Math.max(3, Math.min(voters.length, 4 + ((index * 5) % 7)));
      for (let i = 0; i < size; i++) {
        const uid = voters[(index * 3 + i * 2) % voters.length];
        if (uid !== p.authorId && !p.voterIds[uid]) p.voterIds[uid] = kinds[(index + i) % kinds.length];
      }
      const known = Object.values(p.voterIds).filter((v) => isReaction(v)).length;
      p.upvotes = Math.max(p.upvotes, known);
    });
    // some follows so the demo user has a network
    const edges: [string, string][] = [
      ['u_demo', 'u_lerato'], ['u_demo', 'u_kabelo'], ['u_demo', 'u_sipho'], ['u_demo', 'u_ayanda'],
      ['u_lerato', 'u_demo'], ['u_kabelo', 'u_demo'], ['u_sipho', 'u_demo'], ['u_ayanda', 'u_demo'],
      ['u_naledi', 'u_demo'], ['u_pieter', 'u_demo']
    ];
    db.follows = edges.map(([a, b], i) => ({ id: `f${i}`, followerId: a, followingId: b, at: Date.now() - i * 86400000, status: 'accepted' as const }));

    // one existing thread with the demo user so chat isn't empty
    const t: ChatThread = {
      id: 'th_demo_c2',
      participantIds: ['u_demo', 'u_kabelo'],
      postId: 'p_thato',
      createdAt: Date.now() - 3600_000 * 5,
      lastMessageAt: Date.now() - 3600_000,
      unread: { u_demo: 1, u_kabelo: 0 },
      unlockedVia: 'follow'
    };
    db.threads = [t];
    db.messages = [
      { id: 'm_1', threadId: t.id, fromUserId: 'u_demo', body: 'Kabelo, thank you for the Quantum lead. Can you introduce me to the spaza owner?', at: Date.now() - 3600_000 * 5, read: true, kind: 'text', postId: 'p_thato' },
      { id: 'm_2', threadId: t.id, fromUserId: 'u_kabelo', body: 'Of course. She is wary of police so I will bring you. I am at the rank from 07:00 tomorrow.', at: Date.now() - 3600_000 * 4, read: true, kind: 'text' },
      { id: 'm_3', threadId: t.id, fromUserId: 'u_demo', body: 'I will be there. Should I bring the printed poster?', at: Date.now() - 3600_000 * 3, read: true, kind: 'text' },
      { id: 'm_4', threadId: t.id, fromUserId: 'u_kabelo', body: 'Yes - and the school photo, not the taxi rank one. She remembers faces, not places.', at: Date.now() - 3600_000, read: false, kind: 'text' }
    ];

    db.notifications = [
      {
        id: 'n1', userId: 'u_demo', kind: 'vote', title: 'Your case is trending in Gauteng',
        body: `Help find Thato Mokoena has ${db.posts.find((p) => p.id === 'p_thato')?.upvotes ?? 0} reactions and 187 reposts.`, at: Date.now() - 3600_000 * 2,
        read: false, route: '/post/p_thato', postId: 'p_thato'
      },
      {
        id: 'n2', userId: 'u_demo', kind: 'escalation', title: 'Station case number saved',
        body: 'ORL/441/09/2026. LulaFind did not send this case.', at: Date.now() - 3600_000 * 9,
        read: false, route: '/post/p_thato', postId: 'p_thato'
      },
      {
        id: 'n3', userId: 'u_demo', kind: 'comment', title: 'Kabelo Nkosi added a lead',
        body: 'White Quantum heading towards Roodepoort around 10:00 on Tuesday.', at: Date.now() - 3600_000 * 20,
        read: true, route: '/post/p_thato', postId: 'p_thato'
      },
      {
        id: 'n4', userId: 'u_demo', kind: 'follow', title: 'Naledi Dlamini started following you',
        body: 'Nurse. Missing-persons volunteer since 2019.', at: Date.now() - 3600_000 * 30,
        read: true, route: '/user/u_naledi', postId: null
      },
      {
        id: 'n5', userId: 'u_demo', kind: 'outcome', title: 'Did you get help?',
        body: 'Hendrik Botha\u2019s case is still open. Let us know if he is home so we can stop the search.',
        at: Date.now() - 3600_000 * 1, read: false, route: '/post/p_johan', postId: 'p_johan'
      },
      {
        id: 'n6', userId: 'u_demo', kind: 'danger', title: 'Violence nearby',
        body: 'Bree taxi rank, north entrance, Johannesburg CBD. Stay away and do not approach.',
        at: Date.now() - 12 * 60_000, read: false, route: '/post/p_danger_bree', postId: 'p_danger_bree'
      }
    ];
    return db;
  }

  private persist(): void {
    this.rev++;
    this.store.set('snapshot', this.db);
    this.listeners.forEach((fn) => fn());
  }

  /** Subscribe to any data change. Returns an unsubscribe fn. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): DbSnapshot {
    return this.db;
  }

  revision(): number {
    return this.rev;
  }

  /* ------------------------- generic storage helpers ------------------------- */
  getAll<T>(collection: string): T[] {
    const dbAny = this.db as any;
    if (Array.isArray(dbAny[collection])) {
      return dbAny[collection].map((x: any) => clone(x));
    }
    return [];
  }

  getOne<T>(collection: string, id: string): T | undefined {
    const items = this.getAll<any>(collection);
    const item = items.find((x: any) => x && x.id === id);
    return item ? clone(item) : undefined;
  }

  saveOne<T extends { id: string }>(collection: string, item: T): void {
    const dbAny = this.db as any;
    if (!Array.isArray(dbAny[collection])) {
      dbAny[collection] = [];
    }
    const idx = dbAny[collection].findIndex((x: any) => x && x.id === item.id);
    if (idx !== -1) dbAny[collection][idx] = clone(item);
    else dbAny[collection].unshift(clone(item));
    this.persist();
  }

  deleteOne(collection: string, id: string): void {
    const dbAny = this.db as any;
    if (Array.isArray(dbAny[collection])) {
      dbAny[collection] = dbAny[collection].filter((x: any) => x && x.id !== id);
      this.persist();
    }
  }

  /* ------------------------- users ------------------------- */
  users(): UserProfile[] { return this.db.users.map((u) => clone(u)); }
  user(id: string): UserProfile | undefined {
    const u = this.db.users.find((x) => x.id === id);
    return u ? clone(u) : undefined;
  }
  userByHandle(handle: string): UserProfile | undefined {
    const h = handle.replace(/^@/, '').toLowerCase();
    return this.db.users.find((u) => u.handle.toLowerCase() === h);
  }
  upsertUser(u: UserProfile): void {
    const i = this.db.users.findIndex((x) => x.id === u.id);
    if (i >= 0) this.db.users[i] = u; else this.db.users.push(u);
    this.persist();
  }
  removeUser(id: string): void {
    this.db.users = this.db.users.filter((u) => u.id !== id);
    this.db.posts = this.db.posts.filter((p) => p.authorId !== id);
    this.persist();
  }

  /**
   * Free-text search over every stored post.
   *
   * Uses the same matcher as the feed's `query` filter, so a search behaves the
   * same wherever it is typed. Cases held for review stay hidden from the
   * public; the caller merges in whatever the viewer's own feed may show them.
   */
  searchPosts(q: string, limit = 40, viewerId: string | null = null): Post[] {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const viewer = viewerId ? this.user(viewerId) : undefined;
    const following = new Set(this.db.follows
      .filter((edge) => edge.followerId === viewerId && edge.status === 'accepted')
      .map((edge) => edge.followingId));
    return this.db.posts
      .filter((p) => p.status !== 'under_review' || p.authorId === viewerId || viewer?.isAdmin === true)
      .filter((p) => canReadPostAudience(p, { viewerId, following }))
      .filter((p) => this.matchesQuery(p, needle))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((p) => clone(p));
  }

  /** Free-text search over members by name, surname or handle. */
  searchUsers(q: string, limit = 20): UserProfile[] {
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    if (!needle) return [];
    return this.db.users
      .filter((u) => !u.suspended && `${u.displayName} ${u.surname} ${u.handle}`.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((u) => clone(u));
  }

  /* ------------------------- posts ------------------------- */
  posts(): Post[] { return this.db.posts.map((p) => clone(p)); }
  postsByAuthor(authorId: string): Post[] { return this.db.posts.filter((p) => p.authorId === authorId).map((p) => clone(p)); }
  /**
   * Cases that closed as found, newest first. The feed leaves found cases out on
   * purpose, so the reunions page asks for them directly.
   */
  foundCases(): Post[] {
    return this.db.posts
      .filter((p) => p.status === 'found' && p.outcome?.found === true)
      .sort((a, b) => (b.outcome?.foundAt ?? b.updatedAt) - (a.outcome?.foundAt ?? a.updatedAt))
      .map((p) => clone(p));
  }

  /** Everything held for review, for the moderation screen. Never the feed. */
  postsForReview(): Post[] {
    return this.db.posts
      .filter((p) => p.status === 'under_review')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((p) => clone(p));
  }
  post(id: string): Post | undefined {
    const p = this.db.posts.find((x) => x.id === id);
    return p ? clone(p) : undefined;
  }

  /**
   * Last write wins, by the app's own `updatedAt` clock, and an optional
   * compare-and-set for background writes.
   *
   * A background job (the "did you get help?" nudge) reads a post, then writes
   * it back a moment later. If you edited or closed the case in between, that
   * late write would quietly undo your change - which is exactly how a saved
   * edit appears to vanish. `ifUnchangedSince` makes the write conditional, and
   * an incoming record older than the stored one is always dropped.
   * Returns true when the record was stored.
   */
  upsertPost(p: Post, options?: { ifUnchangedSince?: number }): boolean {
    const i = this.db.posts.findIndex((x) => x.id === p.id);
    if (i < 0) {
      this.db.posts.unshift(p);
      this.persist();
      return true;
    }
    const stored = this.db.posts[i];
    if (options?.ifUnchangedSince !== undefined && stored.updatedAt !== options.ifUnchangedSince) return false;
    if ((stored.updatedAt ?? 0) > (p.updatedAt ?? 0)) return false;
    this.db.posts[i] = p;
    this.persist();
    return true;
  }
  /**
   * Apply a field patch to the stored post in one step.
   *
   * This store is synchronous and this method never awaits, so the read and the
   * write cannot be split by another writer - which is the whole point.
   */
  patchPost(id: string, patch: Partial<Post>): Post | undefined {
    const i = this.db.posts.findIndex((p) => p.id === id);
    if (i < 0) return undefined;
    const next = { ...this.db.posts[i], ...patch, id } as Post;
    this.db.posts[i] = next;
    this.persist();
    return clone(next);
  }

  /* --------------------------- be on the lookout --------------------------- */

  lookouts(): Lookout[] {
    return ((this.db as unknown as { lookouts?: Lookout[] }).lookouts ?? []).map((l) => clone(l));
  }

  saveLookout(l: Lookout): void {
    const dbAny = this.db as unknown as { lookouts?: Lookout[] };
    if (!dbAny.lookouts) dbAny.lookouts = [];
    const i = dbAny.lookouts.findIndex((x) => x.id === l.id);
    if (i >= 0) dbAny.lookouts[i] = clone(l);
    else dbAny.lookouts.unshift(clone(l));
    this.persist();
  }

  patchLookout(id: string, patch: Partial<Lookout>): Lookout | undefined {
    const dbAny = this.db as unknown as { lookouts?: Lookout[] };
    const list = dbAny.lookouts ?? [];
    const i = list.findIndex((l) => l.id === id);
    if (i < 0) return undefined;
    list[i] = { ...list[i], ...patch, id } as Lookout;
    this.persist();
    return clone(list[i]);
  }

  /**
   * A follower's answer. The rules live in core/utils/lookout.ts so the same
   * decision runs here, in Firestore and in Postgres.
   */
  answerLookout(id: string, byUserId: string, ok: boolean): Lookout | undefined {
    const current = this.lookouts().find((l) => l.id === id);
    if (!current) return undefined;
    if (hasAnswered(current, byUserId)) return current;
    const blocked = answerBlocker(current, byUserId);
    if (blocked) throw new Error(blocked);
    if (!this.db.follows.some((f) => f.followerId === byUserId && f.followingId === current.userId
      && (f.status ?? 'accepted') === 'accepted')) {
      throw new Error('Only the people who follow them can answer this');
    }
    let next = withAnswer(current, byUserId, ok);
    if (next.status === 'escalated' && !next.escalatedPostId) {
      next = { ...next, escalatedPostId: this.publishLookoutCase(next) };
    }
    this.saveLookout(next);
    return next;
  }

  /**
   * LulaFind publishes the case itself, on the person's behalf, only when they
   * allowed it. Returns the new post id, or null when they did not.
   */
  publishLookoutCase(lookout: Lookout): string | null {
    const owner = this.db.users.find((u) => u.id === lookout.userId);
    if (!owner || owner.privacy?.allowSafetyAlertPosts !== true) return null;
    const post = lookoutCasePost(lookout, owner, this.db.posts);
    this.db.posts.unshift(post);
    this.persist();
    return post.id;
  }

  /** "I'm here": the case the app published is removed with the lookout. */
  deleteLookoutCase(lookoutId: string): void {
    const doomed = this.db.posts.filter((p) => p.lookoutId === lookoutId);
    if (!doomed.length) return;
    this.db.posts = this.db.posts.filter((p) => p.lookoutId !== lookoutId);
    const ids = new Set(doomed.map((p) => p.id));
    this.db.comments = this.db.comments.filter((c) => !ids.has(c.postId));
    for (const s of this.db.spotlights) s.postIds = s.postIds.filter((x) => !ids.has(x));
    this.persist();
  }

  deletePost(id: string): void {
    this.db.posts = this.db.posts.filter((p) => p.id !== id);
    this.db.comments = this.db.comments.filter((c) => c.postId !== id);
    for (const s of this.db.spotlights) s.postIds = s.postIds.filter((x) => x !== id);
    this.persist();
  }

  filtered(f: FeedFilter, viewerId: string | null, viewer: UserProfile | undefined): Post[] {
    const following = new Set(this.db.follows.filter((e) => e.followerId === viewerId && e.status === 'accepted').map((e) => e.followingId));
    const followers = new Set(this.db.follows.filter((e) => e.followingId === viewerId && e.status === 'accepted').map((e) => e.followerId));
    let list = this.db.posts.slice();

    if (f.scope === 'network') {
      // Network is deliberately narrower than For you: a post must come from
      // someone in either direction, or from a Spotlight the viewer belongs to.
      // Checking membership here (rather than only in the component) keeps a
      // followers-only post from leaking when the tab is refreshed.
      const networkPeople = new Set([...(viewerId ? [viewerId] : []), ...following, ...followers]);
      const joinedSpotlights = new Set(
        this.db.spotlights.filter((s) => !!viewerId && s.memberIds.includes(viewerId)).map((s) => s.id)
      );
      list = list.filter((p) => networkPeople.has(p.authorId) || (!!p.spotlightId && joinedSpotlights.has(p.spotlightId)));
    }

    if (f.type !== 'all') list = list.filter((p) => p.type === f.type);
    if (f.province !== 'all') list = list.filter((p) => p.province === f.province);
    if (f.spotlightId) list = list.filter((p) => p.spotlightId === f.spotlightId);
    // A case held for review is only visible to the person who posted it and to
    // admins. The feed must never show an unchecked child case to the public.
    list = list.filter((p) => p.status !== 'under_review' || p.authorId === viewerId || viewer?.isAdmin === true);
    if (f.status === 'active') list = list.filter((p) => p.status === 'active' || p.status === 'under_review');
    if (f.status === 'found') list = list.filter((p) => p.status === 'found');

    if (f.query.trim()) {
      const q = f.query.trim().toLowerCase();
      list = list.filter((p) => this.matchesQuery(p, q));
    }

    // audience enforcement - the shared rule, so this backend and the live one
    // cannot answer the same question differently.
    list = list.filter((p) => canReadPostAudience(p, { viewerId, following }));

    switch (f.sort) {
      case 'hot':
        list.sort((a, b) => this.score(b) - this.score(a));
        break;
      case 'oldest':
        list.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'nearby':
        list.sort((a, b) => (a.province === viewer?.province ? -1 : 0) - (b.province === viewer?.province ? -1 : 0));
        break;
      default:
        list.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return list;
  }

  private score(p: Post): number {
    const ageH = Math.max(1, (Date.now() - p.createdAt) / 3600_000);
    return (p.upvotes * 3 + p.commentCount * 5 + p.shares * 2) / Math.pow(ageH, 0.55);
  }

  /**
   * What "free text" means for a case: the words on the poster, the case number
   * quoted by SAPS, the town, the last-seen town, and the author's name.
   * One definition, so the feed filter and search can never drift apart.
   */
  private matchesQuery(p: Post, needle: string): boolean {
    const author = this.user(p.authorId);
    const hay = [
      p.title, p.body, p.town, p.caseNumber ?? '',
      p.subject?.name ?? '', p.subject?.surname ?? '', author?.displayName ?? ''
    ].join(' ').toLowerCase();
    return hay.includes(needle);
  }

  /* ------------------------- comments ------------------------- */
  comments(): Comment[] { return this.db.comments.map((c) => clone(c)); }
  commentsFor(postId: string): Comment[] {
    return this.db.comments.filter((c) => c.postId === postId).sort((a, b) => b.upvotes - a.upvotes || a.createdAt - b.createdAt).map((c) => clone(c));
  }
  upsertComment(c: Comment): void {
    const i = this.db.comments.findIndex((x) => x.id === c.id);
    if (i >= 0) this.db.comments[i] = c; else this.db.comments.push(c);
    this.persist();
  }
  deleteComment(id: string): void {
    this.db.comments = this.db.comments.filter((c) => c.id !== id && c.parentId !== id);
    this.persist();
  }

  /* ------------------------- spotlights ------------------------- */
  spotlights(): Spotlight[] { return this.db.spotlights.map((s) => clone(s)); }

  /**
   * Posts filed to one Spotlight, newest first.
   *
   * No audience test: a Spotlight page is a public noticeboard, and everyone
   * who opens it sees what the community filed there. Joining is what lets you
   * add to it. Review rules still apply - see `searchPosts`.
   */
  postsInSpotlight(spotlightId: string): Post[] {
    return this.db.posts
      .filter((p) => p.spotlightId === spotlightId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => clone(p));
  }
  spotlight(id: string): Spotlight | undefined {
    const sp = this.db.spotlights.find((x) => x.id === id);
    return sp ? clone(sp) : undefined;
  }
  upsertSpotlight(s: Spotlight): void {
    const i = this.db.spotlights.findIndex((x) => x.id === s.id);
    if (i >= 0) this.db.spotlights[i] = s; else this.db.spotlights.push(s);
    this.persist();
  }

  deleteSpotlight(id: string): void {
    this.db.spotlights = this.db.spotlights.filter((s) => s.id !== id);
    this.persist();
  }

  /** Join or leave, in the device store. The member count is the list length. */
  setSpotlightMembership(spotlightId: string, memberId: string, joining: boolean): Spotlight | undefined {
    const sp = this.spotlight(spotlightId);
    if (!sp) return undefined;
    const memberIds = joining
      ? (sp.memberIds.includes(memberId) ? sp.memberIds : [...sp.memberIds, memberId])
      : sp.memberIds.filter((id) => id !== memberId);
    const next = { ...sp, memberIds, followers: memberIds.length };
    this.upsertSpotlight(next);
    return next;
  }

  /**
   * A membership change the server has not accepted yet.
   *
   * A join refused by row-level security used to leave the person with a
   * "permission denied" toast and no way in. Instead the change is kept here and
   * replayed on the next refresh, so the community works on this device from the
   * moment they tap Join and the server catches up when it can.
   */
  queueSpotlightMembership(spotlightId: string, memberId: string, joining: boolean): void {
    const same = (op: PendingMembership): boolean => op.spotlightId === spotlightId && op.memberId === memberId;
    const queue = this.pendingSpotlightMemberships();
    const oppositeQueued = queue.some((op) => same(op) && op.joining !== joining);
    const kept = queue.filter((op) => !same(op));
    this.store.set(PENDING_MEMBERSHIP_KEY, oppositeQueued ? kept : [...kept, { spotlightId, memberId, joining, at: Date.now() }]);
  }

  pendingSpotlightMemberships(): PendingMembership[] {
    return this.store.get<PendingMembership[]>(PENDING_MEMBERSHIP_KEY, []);
  }

  clearPendingSpotlightMembership(spotlightId: string): void {
    const queue = this.pendingSpotlightMemberships();
    const kept = queue.filter((op) => op.spotlightId !== spotlightId);
    if (kept.length === queue.length) return;
    this.store.set(PENDING_MEMBERSHIP_KEY, kept);
  }

  /** The community's own list of posts, filed or unfiled on this device. */
  linkSpotlightPost(spotlightId: string, postId: string, linking: boolean): Spotlight | undefined {
    const sp = this.spotlight(spotlightId);
    if (!sp) return undefined;
    const postIds = linking ? [...new Set([postId, ...sp.postIds])] : sp.postIds.filter((id) => id !== postId);
    const next = { ...sp, postIds };
    this.upsertSpotlight(next);
    return next;
  }

  /* ------------------------- stories ------------------------- */
  stories(viewerId: string | null = null): Story[] {
    const now = Date.now();
    const following = new Set(this.db.follows
      .filter((edge) => edge.followerId === viewerId && edge.status === 'accepted')
      .map((edge) => edge.followingId));
    const memberSpotlights = new Set(this.db.spotlights
      .filter((sp) => !!viewerId && sp.memberIds.includes(viewerId))
      .map((sp) => sp.id));
    return this.db.stories
      .filter((s) => s.expiresAt > now)
      .filter((s) => s.authorId === viewerId || s.audience === 'public'
        || (s.audience === 'followers' && following.has(s.authorId))
        || (s.audience === 'surname' && !!s.spotlightId && memberSpotlights.has(s.spotlightId)))
      .map((s) => clone(s));
  }
  story(id: string): Story | undefined {
    const st = this.db.stories.find((x) => x.id === id && x.expiresAt > Date.now());
    return st ? clone(st) : undefined;
  }
  upsertStory(s: Story): void {
    const i = this.db.stories.findIndex((x) => x.id === s.id);
    if (i >= 0) this.db.stories[i] = s; else this.db.stories.unshift(s);
    this.persist();
  }

  /* ------------------------- chat ------------------------- */
  threads(): ChatThread[] { return this.db.threads.map((t) => clone(t)); }
  thread(id: string): ChatThread | undefined {
    const t = this.db.threads.find((x) => x.id === id);
    return t ? clone(t) : undefined;
  }
  threadsFor(userId: string): ChatThread[] {
    return this.db.threads.filter((t) => t.participantIds.includes(userId)).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }
  upsertThread(t: ChatThread): void {
    const i = this.db.threads.findIndex((x) => x.id === t.id);
    if (i >= 0) this.db.threads[i] = t; else this.db.threads.push(t);
    this.persist();
  }
  messages(threadId: string): ChatMessage[] {
    return this.db.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.at - b.at).map((m) => clone(m));
  }
  upsertMessage(m: ChatMessage): void {
    // An id that is already in the thread is an edit, a reaction or a read mark,
    // not a second copy of the message: replace it where it stands and leave the
    // inbox preview alone, because that message arrived some time ago.
    const at = this.db.messages.findIndex((x) => x.id === m.id);
    if (at >= 0) {
      this.db.messages[at] = m;
      this.persist();
      return;
    }
    this.db.messages.push(m);
    const t = this.thread(m.threadId);
    if (t) {
      t.lastMessageAt = m.at;
      t.unread = { ...t.unread };
      for (const pid of t.participantIds) {
        if (pid !== m.fromUserId) t.unread[pid] = (t.unread[pid] ?? 0) + 1;
      }
    }
    this.persist();
  }
  markThreadRead(threadId: string, userId: string): void {
    const t = this.thread(threadId);
    if (!t) return;
    t.unread = { ...t.unread, [userId]: 0 };
    for (const m of this.db.messages) if (m.threadId === threadId && m.fromUserId !== userId) m.read = true;
    this.persist();
  }

  /* ------------------------- follows ------------------------- */
  follows(): FollowEdge[] { return this.db.follows.map((f) => clone(f)); }
  /** Only accepted edges count as followers / following. */
  followersOf(userId: string): FollowEdge[] {
    return this.db.follows.filter((e) => e.followingId === userId && e.status === 'accepted');
  }
  followingOf(userId: string): FollowEdge[] {
    return this.db.follows.filter((e) => e.followerId === userId && e.status === 'accepted');
  }
  /** Requests waiting on this person's decision, newest first. */
  followRequestsFor(userId: string): FollowEdge[] {
    return this.db.follows
      .filter((e) => e.followingId === userId && e.status === 'pending')
      .sort((a, b) => b.at - a.at)
      .map((e) => clone(e));
  }
  /** Is there any edge at all, pending or accepted? Stops duplicate requests. */
  hasFollowEdge(a: string, b: string): boolean {
    return this.db.follows.some((e) => e.followerId === a && e.followingId === b);
  }
  isFollowing(a: string, b: string): boolean {
    return this.db.follows.some((e) => e.followerId === a && e.followingId === b && e.status === 'accepted');
  }
  followStatus(a: string, b: string): FollowEdge['status'] | null {
    return this.db.follows.find((e) => e.followerId === a && e.followingId === b)?.status ?? null;
  }
  setFollowStatus(a: string, b: string, status: FollowEdge['status']): void {
    const e = this.db.follows.find((x) => x.followerId === a && x.followingId === b);
    if (e) { e.status = status; this.persist(); }
  }
  upsertFollow(edge: FollowEdge | null): void {
    if (!edge) return;
    if (!this.hasFollowEdge(edge.followerId, edge.followingId)) this.db.follows.push(edge);
    this.persist();
  }
  removeFollow(a: string, b: string): void {
    this.db.follows = this.db.follows.filter((e) => !(e.followerId === a && e.followingId === b));
    this.persist();
  }

  /* ------------------------- notifications ------------------------- */
  notifications(userId: string): Notification[] {
    return this.db.notifications.filter((n) => n.userId === userId).sort((a, b) => b.at - a.at).map((n) => clone(n));
  }
  pushNotification(n: Notification): void {
    this.db.notifications.unshift(n);
    this.persist();
  }
  markNotificationsRead(userId: string): void {
    for (const n of this.db.notifications) if (n.userId === userId) n.read = true;
    this.persist();
  }

  /* ------------------------- moderation reports ------------------------- */
  reportsFor(userId: string): UserReport[] {
    const all = this.reportStore.get<UserReport[]>('all', []);
    const admin = this.db.users.find((u) => u.id === userId)?.isAdmin === true;
    return all.filter((r) => admin || r.byUserId === userId).sort((a, b) => b.at - a.at).map((r) => clone(r));
  }
  saveReport(report: UserReport): void {
    const all = this.reportStore.get<UserReport[]>('all', []);
    const next = [report, ...all.filter((r) => r.id !== report.id)];
    this.reportStore.set('all', next);
    this.rev++;
    this.listeners.forEach((fn) => fn());
  }

  /* ------------------------- tips ------------------------- */
  tips(): Tip[] { return this.db.tips.map((t) => clone(t)); }

  /* ------------------------- reset ------------------------- */
  reset(): void {
    this.db = this.seedDemo ? this.seed() : this.emptyLive();
    this.reportStore.clearAll();
    this.persist();
  }
}
