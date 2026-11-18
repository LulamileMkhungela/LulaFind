import { SearchCommand } from '../utils/search-coordination';
import { Observable, Subject } from 'rxjs';
import {
  ChatMessage, ChatThread, Comment, Lookout, FeedFilter, FollowEdge, MediaItem, Notification, Post, Spotlight, Story, StoryReply, StoryView, Tip, UserProfile, UserReport
} from '../models/types';
import { LulaApi, SavePostOptions } from './api';
import { answerBlocker, hasAnswered, withAnswer } from '../utils/lookout';
import { lookoutCasePost } from '../utils/lookout-case';
import { canReadPostAudience } from '../utils/audience';

/*
 * Cloud Firestore + Firebase Auth implementation.
 *
 * The firebase SDK is imported lazily (dynamic import) so the JS bundle stays
 * small and the app keeps working with zero config in mock mode.
 *
 * Activate by setting environment.dataMode = 'firebase' and filling in the
 * firebase config in src/environments/environment*.ts.
 *
 * Suggested Firestore layout
 *   users/{uid}                         UserProfile
 *   posts/{postId}                      Post
 *   posts/{postId}/comments/{commentId} Comment
 *   spotlights/{spotlightId}            Spotlight
 *   stories/{storyId}                   Story
 *   threads/{threadId}                  ChatThread
 *   threads/{threadId}/messages/{msgId} ChatMessage
 *   follows/{followerId__followingId}   FollowEdge
 *   notifications/{userId}/items/{id}   Notification
 *   tips/{tipId}                        Tip (read-only, managed in the console)
 *
 * Suggested security rules: see docs/FIRESTORE_RULES.md
 */
export class FirebaseApi implements LulaApi {
  private app: any;
  private fs: any;
  private q: any;
  private rx = new Subject<number>();
  private rev = 0;

  constructor(private config: Record<string, string>) { }

  private tick(): void {
    this.rev++;
    this.rx.next(this.rev);
  }

  async init(): Promise<void> {
    const [{ initializeApp }, firestore] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore')
    ]);
    this.app = initializeApp(this.config as any);
    this.fs = firestore;
    this.q = firestore;
    this.listen();
  }

  /**
   * Other phones see a new case, comment, or message without a refresh.
   * A denied rule must not crash the app — the error callback is enough.
   */
  private listen(): void {
    const db = this.fs.getFirestore(this.app);
    const watch = (ref: any) => {
      try {
        this.q.onSnapshot(ref, () => this.tick(), () => undefined);
      } catch {
        /* rules or an index are not ready yet */
      }
    };
    watch(this.col('posts'));
    watch(this.col('users'));
    watch(this.col('stories'));
    watch(this.col('threads'));
    watch(this.col('follows'));
    watch(this.col('spotlights'));
    try {
      watch(this.q.collectionGroup(db, 'comments'));
      watch(this.q.collectionGroup(db, 'messages'));
    } catch {
      /* top-level listeners still run */
    }
  }

  private col(name: string): any {
    return this.q.collection(this.fs.getFirestore(this.app), name);
  }
  private doc(path: string): any {
    return this.q.doc(this.fs.getFirestore(this.app), path);
  }

  private async getOne<T>(path: string): Promise<T | undefined> {
    const snap = await this.q.getDoc(this.doc(path));
    return snap.exists() ? ({ ...(snap.data() as object), id: snap.id } as T) : undefined;
  }

  private async getList<T>(ref: any): Promise<T[]> {
    const snap = await this.q.getDocs(ref);
    return snap.docs.map((d: any) => ({ ...(d.data() as object), id: d.id }) as T);
  }

  private async set(path: string, data: Record<string, unknown>): Promise<void> {
    await this.q.setDoc(this.doc(path), data, { merge: true });
    this.tick();
  }

  private async remove(path: string): Promise<void> {
    await this.q.deleteDoc(this.doc(path));
    this.tick();
  }

  async reset(): Promise<void> {
    // Intentionally not implemented client-side. Use the Firestore console or an
    // Admin SDK script; a client must never be able to wipe production data.
    throw new Error('reset() is not permitted against Firestore.');
  }

  /* users */
  async user(id: string) { return this.getOne<UserProfile>(`users/${id}`); }
  async users() { return this.getList<UserProfile>(this.col('users')); }
  async saveUser(u: UserProfile) { await this.set(`users/${u.id}`, u as unknown as Record<string, unknown>); }
  async deleteUser(id: string) { await this.remove(`users/${id}`); }

  /* search */
  /**
   * Firestore has no full-text search (and no paid extension in this project),
   * so the newest slice is pulled and refined the same way the feed query
   * refines it. Every word of the query is looked for, not the whole phrase, so
   * "Thabo Ndlela" still finds a poster written "Ndlela, Thabo".
   */
  async searchPosts(q: string, limit = 40) {
    const words = searchWords(q);
    if (!words.length) return [];
    return (await this.posts())
      .filter((p) => {
        const hay = [p.title, p.body, p.town, p.caseNumber ?? '', p.subject?.name ?? '',
          p.subject?.surname ?? '', p.lastSeenWhere ?? ''].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, limit);
  }
  /** Members whose name, surname or handle contains every word typed. */
  async searchUsers(q: string, limit = 20) {
    const words = searchWords(q, 1);
    if (!words.length) return [];
    return (await this.users())
      .filter((u) => !u.suspended && words.every((w) =>
        `${u.displayName} ${u.surname} ${u.handle}`.toLowerCase().includes(w)))
      .slice(0, limit);
  }

  /* posts */
  async post(id: string) { return this.getOne<Post>(`posts/${id}`); }
  async posts() {
    return this.getList<Post>(this.q.query(this.col('posts'), this.q.orderBy('updatedAt', 'desc'), this.q.limit(200)));
  }
  async postsByAuthor(authorId: string) {
    return (await this.posts())
      .filter((p) => p.authorId === authorId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  /** Cases held for review, straight from the collection - not the feed. */
  async postsForReview() {
    const all = await this.getList<Post>(this.q.query(this.col('posts'), this.q.where('status', '==', 'under_review')));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Cases that closed as found, straight from the collection. */
  async foundCases() {
    const all = await this.getList<Post>(this.q.query(this.col('posts'), this.q.where('status', '==', 'found')));
    return all.sort((a, b) => (b.outcome?.foundAt ?? b.updatedAt) - (a.outcome?.foundAt ?? a.updatedAt));
  }

  /**
   * Patch fields on a post inside a Firestore transaction, so two writers
   * cannot overwrite each other with stale copies.
   */
  async coordinateSearch(_id: string, _command: SearchCommand, _actorId: string): Promise<Post> {
    // Fail closed: the optional Firestore adapter has no equivalent server command.
    // Do not replace this with an insecure client-side read/modify/write.
    throw new Error('Search coordination requires the Supabase backend. No change was saved.');
  }

  async patchPost(id: string, patch: Partial<Post>) {
    const ref = this.doc(`posts/${id}`);
    const next = await this.q.runTransaction(this.fs.getFirestore(this.app), async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return undefined;
      const merged = { ...(snap.data() as Post), ...patch, id };
      tx.set(ref, merged, { merge: true });
      return merged;
    });
    return next as Post | undefined;
  }

  async queryFeed(f: FeedFilter, viewerId: string | null) {
    // Firestore cannot express every filter combination server-side, so we pull
    // the newest slice and refine in memory. Swap in composite indexes when the
    // dataset grows.
    let all = await this.posts();
    const following = new Set< string >();
    const followers = new Set< string >();
    if (viewerId) {
      const [followingEdges, followerEdges] = await Promise.all([
        this.followsFor(viewerId, 'following'),
        this.followsFor(viewerId, 'followers')
      ]);
      followingEdges.forEach((edge) => following.add(edge.followingId));
      followerEdges.forEach((edge) => followers.add(edge.followerId));
    }
    all = all.filter((p) => p.status !== 'under_review' || p.authorId === viewerId)
      .filter((p) => canReadPostAudience(p, { viewerId, following }));
    if (f.scope === 'network') {
      const joined = new Set((await this.spotlights()).filter((spotlight) => !!viewerId && spotlight.memberIds.includes(viewerId)).map((spotlight) => spotlight.id));
      const network = new Set([...(viewerId ? [viewerId] : []), ...following, ...followers]);
      all = all.filter((p) => network.has(p.authorId) || (!!p.spotlightId && joined.has(p.spotlightId)));
    }
    if (f.type !== 'all') all = all.filter((p) => p.type === f.type);
    if (f.province !== 'all') all = all.filter((p) => p.province === f.province);
    if (f.status === 'active') all = all.filter((p) => p.status === 'active' || p.status === 'under_review');
    if (f.status === 'found') all = all.filter((p) => p.status === 'found');
    if (f.query.trim()) {
      const needle = f.query.trim().toLowerCase();
      all = all.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.body.toLowerCase().includes(needle) ||
          (p.subject?.name.toLowerCase().includes(needle) ?? false)
      );
    }
    return all;
  }
  async savePost(p: Post, options?: SavePostOptions) {
    // Firestore has no conditional update through this adapter, so re-read and
    // compare in the client before overwriting. Racy in the same way the app
    // already is with two devices, but it stops the common single-device case.
    if (options?.ifUnchangedSince !== undefined) {
      const current = await this.getOne<Post>(`posts/${p.id}`);
      if (current && current.updatedAt !== options.ifUnchangedSince) return false;
    }
    await this.set(`posts/${p.id}`, p as unknown as Record<string, unknown>);
    return true;
  }
  async deletePost(id: string) { await this.remove(`posts/${id}`); }

  /* be on the lookout */

  async lookouts() {
    return this.getList<Lookout>(this.q.query(this.col('lookouts'), this.q.orderBy('startedAt', 'desc'), this.q.limit(200)));
  }
  async saveLookout(l: Lookout) { await this.set(`lookouts/${l.id}`, l as unknown as Record<string, unknown>); }
  async patchLookout(id: string, patch: Partial<Lookout>) {
    const ref = this.doc(`lookouts/${id}`);
    const next = await this.q.runTransaction(this.fs.getFirestore(this.app), async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return undefined;
      const merged = { ...(snap.data() as Lookout), ...patch, id };
      tx.set(ref, merged, { merge: true });
      return merged;
    });
    return next as Lookout | undefined;
  }

  /**
   * A follower answers "are they okay?". The decision runs inside a
   * transaction so the last answer cannot be lost to a stale read, and the
   * case LulaFind publishes is written in the same transaction as the answer
   * that caused it.
   */
  async answerLookout(id: string, byUserId: string, ok: boolean) {
    const ref = this.doc(`lookouts/${id}`);
    const next = await this.q.runTransaction(this.fs.getFirestore(this.app), async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return undefined;
      const current = snap.data() as Lookout;
      if (hasAnswered(current, byUserId)) return current;
      const blocked = answerBlocker(current, byUserId);
      if (blocked) throw new Error(blocked);
      let merged = withAnswer(current, byUserId, ok);

      if (merged.status === 'escalated' && !merged.escalatedPostId) {
        const ownerSnap = await tx.get(this.doc(`users/${merged.userId}`));
        const owner = ownerSnap.exists() ? (ownerSnap.data() as UserProfile) : undefined;
        if (owner?.privacy?.allowSafetyAlertPosts === true) {
          const post = lookoutCasePost(merged, owner, []);
          tx.set(this.doc(`posts/${post.id}`), post as unknown as Record<string, unknown>);
          merged = { ...merged, escalatedPostId: post.id };
        }
      }
      tx.set(ref, merged, { merge: true });
      return merged;
    });
    return next as Lookout | undefined;
  }

  /** "I'm here": delete the case the app published for this lookout. */
  async deleteLookoutCase(lookoutId: string) {
    const mine = await this.posts();
    for (const post of mine.filter((p) => p.lookoutId === lookoutId)) {
      await this.remove(`posts/${post.id}`);
    }
  }

  /* comments */
  async commentsFor(postId: string) {
    const list = await this.getList<Comment>(this.q.query(this.col(`posts/${postId}/comments`), this.q.orderBy('createdAt', 'desc')));
    return list.sort((a, b) => b.upvotes - a.upvotes);
  }
  async saveComment(c: Comment) { await this.set(`posts/${c.postId}/comments/${c.id}`, c as unknown as Record<string, unknown>); }
  async deleteComment(id: string, postId?: string) {
    if (postId) {
      await this.remove(`posts/${postId}/comments/${id}`);
    } else {
      // Fallback: postId unknown — skip (avoids wrong-path deletion)
      console.warn('FirebaseApi.deleteComment called without postId; deletion skipped.');
    }
  }

  /* spotlights */
  async spotlights() { return this.getList<Spotlight>(this.col('spotlights')); }
  async spotlight(id: string) { return this.getOne<Spotlight>(`spotlights/${id}`); }
  /** Posts filed to one Spotlight. Reading is public; posting needs membership. */
  async postsInSpotlight(spotlightId: string) { return (await this.posts()).filter((p) => p.spotlightId === spotlightId); }
  async linkSpotlightPost(spotlightId: string, postId: string, linking: boolean): Promise<void> {
    const sp = await this.spotlight(spotlightId);
    if (!sp) return;
    const rest = sp.postIds.filter((x) => x !== postId);
    await this.saveSpotlight({ ...sp, postIds: linking ? [postId, ...rest] : rest });
  }
  async saveSpotlight(s: Spotlight) { await this.set(`spotlights/${s.id}`, s as unknown as Record<string, unknown>); }
  /**
   * Join or leave.
   *
   * Firestore's `spotlights` update rule allows a signed-in user to rewrite the
   * row as long as nobody is removed from `memberIds` (see
   * `lulafind/docs/FIRESTORE_RULES.md`), so joining is a plain write. Leaving
   * removes an entry, which the rule cannot allow the leaver to do, so it goes
   * through the owner - and if that is not this person, the change is kept on the
   * device instead of refusing them with a permission error.
   */
  async setSpotlightMembership(id: string, memberId: string, joining: boolean) {
    const spotlight = await this.spotlight(id);
    if (!spotlight) return undefined;
    const memberIds = joining
      ? [...new Set([...spotlight.memberIds, memberId])]
      : spotlight.memberIds.filter((current) => current !== memberId);
    const next = { ...spotlight, memberIds, followers: memberIds.length };
    try {
      await this.saveSpotlight(next);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      // "Missing or insufficient permissions" is Firestore's wording, not the
      // person's mistake. Say which rule and keep the change on this device.
      console.warn(`Firestore refused the Spotlight membership change (${joining ? 'join' : 'leave'}): ${message}. ` +
        'Update the spotlights match in docs/FIRESTORE_RULES.md - leaving needs the member-led rule.', message);
    }
    return next;
  }
  async deleteSpotlight(id: string) { await this.remove(`spotlights/${id}`); }

  /* stories */
  async uploadMedia(_ownerId: string, item: MediaItem) { return item; }
  /** No Storage bucket is configured for this project, so a src is already final. */
  async resolveMedia(src: string) { return src; }
  async stories() {
    const all = await this.getList<Story>(this.q.query(this.col('stories'), this.q.orderBy('createdAt', 'desc'), this.q.limit(100)));
    return all.filter((s) => s.expiresAt > Date.now());
  }
  async saveStory(s: Story) {
    // Audience-visible story documents must not embed private insights.
    await this.set(`stories/${s.id}`, { ...s, replies: [], viewers: [] } as unknown as Record<string, unknown>);
  }
  async storyRepliesFor(storyId: string) {
    return this.getList<StoryReply>(this.col(`stories/${storyId}/replies`));
  }
  async saveStoryReply(reply: StoryReply) {
    await this.set(`stories/${reply.storyId}/replies/${reply.id}`, reply as unknown as Record<string, unknown>);
  }
  async storyViewsFor(storyId: string) {
    return this.getList<StoryView>(this.col(`stories/${storyId}/views`));
  }
  async saveStoryView(view: StoryView) {
    await this.set(`stories/${view.storyId}/views/${view.id}`, view as unknown as Record<string, unknown>);
  }

  /* chat */
  async threadsFor(userId: string) {
    const all = await this.getList<ChatThread>(this.q.query(this.col('threads'), this.q.orderBy('lastMessageAt', 'desc'), this.q.limit(100)));
    return all.filter((t) => t.participantIds.includes(userId));
  }
  async thread(id: string) { return this.getOne<ChatThread>(`threads/${id}`); }
  async saveThread(t: ChatThread) { await this.set(`threads/${t.id}`, t as unknown as Record<string, unknown>); }
  async messages(threadId: string) {
    return this.getList<ChatMessage>(this.q.query(this.col(`threads/${threadId}/messages`), this.q.orderBy('at', 'asc')));
  }
  async saveMessage(m: ChatMessage) { await this.set(`threads/${m.threadId}/messages/${m.id}`, m as unknown as Record<string, unknown>); }
  async markThreadRead(threadId: string, userId: string) {
    await this.q.updateDoc(this.doc(`threads/${threadId}`), { [`unread.${userId}`]: 0 });
    this.tick();
  }

  /* follows */
  async isFollowing(a: string, b: string) {
    return (await this.followStatus(a, b)) === 'accepted';
  }
  async followStatus(a: string, b: string): Promise<FollowEdge['status'] | null> {
    const snap = await this.q.getDoc(this.doc(`follows/${a}__${b}`));
    return snap.exists() ? (snap.data() as FollowEdge | undefined)?.status ?? null : null;
  }
  async followsFor(userId: string, direction: 'followers' | 'following'): Promise<FollowEdge[]> {
    const all = await this.getList<FollowEdge>(this.col('follows'));
    return all.filter((edge) =>
      edge.status === 'accepted' && (direction === 'followers' ? edge.followingId === userId : edge.followerId === userId)
    );
  }
  /**
   * Follow someone. Returns 'pending' when they approve requests first.
   * Firestore rules must allow writing your own followerId only.
   */
  async follow(a: string, b: string): Promise<'accepted' | 'pending'> {
    const target = await this.user(b);
    const status: FollowEdge['status'] = target?.privacy?.requireFollowApproval ? 'pending' : 'accepted';
    const edge: FollowEdge = { id: `${a}__${b}`, followerId: a, followingId: b, at: Date.now(), status };
    await this.set(`follows/${edge.id}`, edge as unknown as Record<string, unknown>);
    return status;
  }
  async unfollow(a: string, b: string) { await this.remove(`follows/${a}__${b}`); }
  async followRequests(userId: string) {
    const all = await this.getList<FollowEdge>(this.col('follows'));
    return all
      .filter((e) => e.followingId === userId && e.status === 'pending')
      .sort((x, y) => y.at - x.at);
  }
  async respondFollowRequest(followerId: string, userId: string, accept: boolean) {
    const id = `${followerId}__${userId}`;
    if (!accept) { await this.remove(`follows/${id}`); return; }
    const snap = await this.q.getDoc(this.doc(`follows/${id}`));
    const edge = snap.data() as FollowEdge | undefined;
    if (!edge) return;
    await this.set(`follows/${id}`, { ...edge, status: 'accepted' } as unknown as Record<string, unknown>);
  }
  async followerCount(userId: string) {
    const all = await this.getList<FollowEdge>(this.col('follows'));
    return all.filter((e) => e.followingId === userId && e.status === 'accepted').length;
  }
  async followingCount(userId: string) {
    const all = await this.getList<FollowEdge>(this.col('follows'));
    return all.filter((e) => e.followerId === userId).length;
  }

  /* notifications */
  async notifications(userId: string) {
    return this.getList<Notification>(
      this.q.query(this.col(`notifications/${userId}/items`), this.q.orderBy('at', 'desc'), this.q.limit(100))
    );
  }
  async pushNotification(n: Notification) { await this.set(`notifications/${n.userId}/items/${n.id}`, n as unknown as Record<string, unknown>); }
  async reportsFor(userId: string): Promise<UserReport[]> {
    const viewer = await this.user(userId);
    const ref = viewer?.isAdmin === true
      ? this.col('reports')
      : this.q.query(this.col('reports'), this.q.where('byUserId', '==', userId));
    return this.getList<UserReport>(ref);
  }
  async saveReport(report: UserReport): Promise<void> {
    await this.set(`reports/${report.id}`, report as unknown as Record<string, unknown>);
  }
  async markNotificationsRead(userId: string) {
    const items = await this.getList<Notification>(this.col(`notifications/${userId}/items`));
    for (const n of items) await this.set(`notifications/${userId}/items/${n.id}`, { ...n, read: true });
  }

  /*
   * Device tokens. This Firebase path is the old mock-shaped backend and is not
   * the one the app ships (dataMode is 'supabase'); push tokens live in
   * public.push_tokens there, written by SupabaseApi. These are no-ops so the
   * interface is honoured rather than silently half-implemented.
   */
  async savePushToken(_token: string, _platform: string, _appVersion: string): Promise<void> {}
  async forgetPushToken(_token: string): Promise<void> {}

  /* tips */
  async tips() { return this.getList<Tip>(this.col('tips')); }

  changes(): Observable<number> { return this.rx.asObservable(); }
}

/**
 * Split what was typed into the words that must all appear, so a search is as
 * forgiving as the search page: "Thabo Ndlela" finds a poster titled
 * "Ndlela, Thabo" and a handle pasted with its @ still matches.
 */
function searchWords(q: string, minLength = 2): string[] {
  return q.trim().toLowerCase().replace(/^@/, '').split(/\s+/).filter((w) => w.length >= minLength);
}
