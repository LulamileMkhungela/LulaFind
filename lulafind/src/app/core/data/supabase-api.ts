import { Observable, Subject } from 'rxjs';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { FirebaseAuthBridge, firebaseAuthConfigured } from './firebase-auth';
import { LulaApi, SavePostOptions } from './api';
import { answerBlocker } from '../utils/lookout';
import { SUPABASE_URL, SUPABASE_KEY, supabaseNotice } from './supabase-client';
import { LocalDb } from './local-db';
import {
  ChatMessage, ChatThread, Lookout, Comment, FeedFilter, FollowEdge, MediaItem,
  Notification, Post, Spotlight, Story, StoryReply, StoryView, Tip, UserProfile
} from '../models/types';

/**
 * True when Postgres refused the row and a fresh token is worth one retry.
 *
 * A missing or expired Firebase token makes `lula_uid()` return NULL, and
 * PostgREST reports that as a row-level-security error. The same wording is
 * also what an upsert of a brand-new story or post produces — that case is
 * avoided by inserting first (see `putRecord`), not by signing out.
 */
function isIdentityError(message: string): boolean {
  return /row-level security|invalid JWT|JWT expired|not authenticated|401|PGRST301/i.test(message ?? '');
}

/**
 * What `lula_debug_identity()` reports about the current request. Every field
 * maps to a condition the write policies actually test, so a NULL or FALSE here
 * is a specific, fixable problem rather than a generic "write failed".
 */
export interface IdentityReportFields {
  /** The UID the database reads out of the request token. NULL = signed out as far as Postgres is concerned. */
  dbUid: string | null;
  /** The UID the app believes is signed in. */
  appUid: string | null;
  /** `dbUid === appUid`. FALSE with both non-null means the roles/claims setup is wrong. */
  dbUidMatchesAppUid: boolean;
  /** A suspended account is refused by the insert policy, exactly like an identity failure. */
  suspended: boolean;
  /** The one-line verdict: FALSE means an INSERT cannot succeed yet. */
  canWrite: boolean;
  /** supabase/post-interactions.sql was run. Voting, sharing and Spotlight edits go through this RPC. */
  postInteractRpc: boolean;
  /** Also from post-interactions.sql; missing it breaks Spotlight linking only. */
  spotlightRpc: boolean;
}

/** The fields the database reported, plus the app's reading of them. */
export interface IdentityReport extends IdentityReportFields {
  /** Plain English, ready to paste into a bug report. */
  message: string;
}

/** Turns the report above into the next action to take. */
function describeIdentity(r: IdentityReportFields): string {
  if (r.dbUidMatchesAppUid && !r.suspended) {
    return 'Supabase recognises this account and allows writes. If a write still fails, the collection is not this one - check the app banner.';
  }
  if (r.suspended) {
    return 'This account is suspended. Every write is refused by row-level security until an admin lifts it in the Admin screen.';
  }
  if (r.dbUid && r.appUid && !r.dbUidMatchesAppUid) {
    return `The app is signed in as ${r.appUid} but the database sees ${r.dbUid}. ` +
      'Two accounts are in play - sign out and in again, and check that the Firebase custom claim role is set the same way in both places.';
  }
  return 'Supabase cannot see your Firebase account (dbUid is null), so every write is denied by row-level security. ' +
    'Turn on Authentication -> Third-Party Auth -> Firebase for project "lulafinds-app", then sign out and in.';
}

/**
 * SupabaseApi — production LulaApi implementation with automatic local storage fallback.
 *
 * All domain objects are stored as rows in a single flat `records` table.
 * If Supabase table or columns are missing or misconfigured, the API gracefully
 * falls back to local storage so users are never stuck during sign-up or sign-in.
 */
export class SupabaseApi implements LulaApi {
  readonly client: SupabaseClient;
  private localDb = new LocalDb();
  private readonly rx = new Subject<number>();
  private channel: RealtimeChannel | null = null;
  private tick = 0;

  /**
   * Firebase Auth owns accounts. Supabase is told who is calling by the
   * Firebase ID token (Third-Party Auth), so supabase.auth is not used.
   */
  readonly authBridge: FirebaseAuthBridge | null;

  constructor() {
    this.authBridge = firebaseAuthConfigured() ? new FirebaseAuthBridge() : null;
    const bridge = this.authBridge;
    this.client = bridge
      ? createClient(SUPABASE_URL, SUPABASE_KEY, { accessToken: () => bridge.idToken() })
      : createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
  }

  /** Who is calling - the Firebase UID when Firebase Auth is on. */
  private async currentUid(): Promise<string | null> {
    if (this.authBridge) return this.authBridge.uid();
    const { data } = await this.client.auth.getSession();
    return data.session?.user?.id ?? null;
  }

  async init(): Promise<void> {
    // `await window.__lulaDebugWhoAmI()` in the console answers "who does the
    // database think I am?". Documented in supabase/check-setup.sql.
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>)['__lulaDebugWhoAmI'] = () => this.whoAmI();
      // `await window.__lulaDebugStorage()` answers the photo-and-story version
      // of the same question. Requires supabase/fix-photo-uploads.sql.
      (window as unknown as Record<string, unknown>)['__lulaDebugStorage'] = () => this.storageReport();
    }
    try {
      this.channel = this.client
        .channel('records-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'records' },
          () => { this.rx.next(++this.tick); }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            supabaseNotice.set('Live updates unavailable. Pull to refresh manually.');
          }
        });
    } catch (e: any) {
      console.warn('Supabase realtime init error:', e?.message);
    }
  }

  async reset(): Promise<void> {
    this.localDb.reset();
  }

  /**
   * Diagnostics. `window.__lulaDebugWhoAmI()` answers "who does the database
   * think I am?" using the same token and the same helper the write policies
   * use. It is the quickest way to tell an app bug from a backend switch that
   * has not been flipped yet.
   */
  async whoAmI(): Promise<IdentityReport> {
    const appUid = await this.currentUid();
    // Preferred: the database tells us, in one call, everything the write
    // policies depend on - including the two things that look identical from
    // the outside ("violates row-level security policy"): a UID that does not
    // match, and a suspended account.
    const { data, error } = await this.client.rpc('lula_debug_identity', { app_uid: appUid ?? '' });
    if (!error && data && typeof data === 'object') {
      const r = data as IdentityReport;
      return { ...r, appUid, message: describeIdentity(r) };
    }
    // Fall back to the bare identity when schema.sql has not been re-run.
    const bare = await this.client.rpc('lula_uid');
    if (bare.error) {
      return { dbUid: null, appUid, dbUidMatchesAppUid: false, suspended: false,
        canWrite: false, postInteractRpc: false, spotlightRpc: false,
        message: `lula_debug_identity() is not available (${bare.error.message}). Re-run supabase/schema.sql.` };
    }
    const uid = (bare.data as string | null) ?? null;
    const r: IdentityReportFields = { dbUid: uid, appUid, dbUidMatchesAppUid: !!uid && uid === appUid,
      suspended: false, canWrite: !!uid, postInteractRpc: false, spotlightRpc: false };
    return { ...r, message: describeIdentity(r) };
  }

  /**
   * Diagnostics for photo, story and comment uploads.
   *
   * An upload needs two things to line up: the bucket and its four policies
   * must exist, and the folder the app writes into must equal the UID the
   * database reads out of the request token. When they do not, Postgres says
   * "new row violates row-level security policy" and gives no hint which half
   * is wrong. This says which half.
   */
  async storageReport(): Promise<{ ok: boolean; message: string; details: Record<string, unknown> }> {
    const appUid = await this.currentUid();
    const { data, error } = await this.client.rpc('lula_debug_storage', { app_uid: appUid ?? '' });
    if (!error && data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      const verdict = String(d['verdict'] ?? '');
      return { ok: verdict.startsWith('PASS'), message: verdict, details: d };
    }
    return {
      ok: false,
      message: 'lula_debug_storage() is not installed. Run supabase/fix-photo-uploads.sql in the Supabase SQL editor.',
      details: { error: error?.message ?? 'no data returned', appUid }
    };
  }

  changes(): Observable<number> {
    return this.rx.asObservable();
  }

  // ─── private helpers with local fallback ───────────────────────────────

  private storagePath(src: string | undefined): string | null {
    if (!src) return null;
    const marker = 'storage://photos/';
    if (src.startsWith(marker)) return src.slice(marker.length);
    try {
      const url = new URL(src);
      const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/photos\/(.+)$/);
      return match?.[1] ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  private async signedStorageUrl(path: string): Promise<string | null> {
    const { data, error } = await this.client.storage.from('photos').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      console.warn('Could not sign a private photo URL:', error?.message ?? 'no signed URL returned');
      return null;
    }
    return data.signedUrl;
  }

  private async signRecordMedia<T>(collection: string, record: T): Promise<T> {
    if (collection !== 'posts' && collection !== 'stories' && collection !== 'comments') return record;
    const value = record as T & {
      media?: MediaItem[];
      poster?: { templateId: string; media: MediaItem; createdAt: number } | null;
    };
    const signItem = async (item: MediaItem): Promise<MediaItem> => {
      const path = this.storagePath(item.src);
      if (!path) return item;
      const src = await this.signedStorageUrl(path);
      return { ...item, src: src ?? '' };
    };
    const media = Array.isArray(value.media)
      ? await Promise.all(value.media.map((item) => signItem(item)))
      : value.media;
    const poster = collection === 'posts' && value.poster?.media
      ? { ...value.poster, media: await signItem(value.poster.media) }
      : value.poster;
    if (media === value.media && poster === value.poster) return record;
    return { ...value, media, poster };
  }

  private persistRecordMedia<T>(collection: string, record: T): T {
    if (collection !== 'posts' && collection !== 'stories' && collection !== 'comments') return record;
    const value = record as T & {
      media?: MediaItem[];
      poster?: { templateId: string; media: MediaItem; createdAt: number } | null;
    };
    const persistItem = (item: MediaItem): MediaItem => {
      const path = this.storagePath(item.src);
      return path ? { ...item, src: `storage://photos/${path}` } : item;
    };
    const media = Array.isArray(value.media) ? value.media.map((item) => persistItem(item)) : value.media;
    const poster = collection === 'posts' && value.poster?.media
      ? { ...value.poster, media: persistItem(value.poster.media) }
      : value.poster;
    if (media === value.media && poster === value.poster) return record;
    return { ...value, media, poster };
  }

  private async getAll<T>(collection: string): Promise<T[]> {
    try {
      const { data, error } = collection === 'users'
        ? await this.client.from('lula_user_profiles_public').select('payload').order('updated_at', { ascending: false })
        : await this.client.from('records').select('payload').eq('collection', collection).order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return await Promise.all((data ?? []).map((r) => this.signRecordMedia(collection, r.payload as T)));
    } catch (e: any) {
      console.warn(`Supabase getAll(${collection}) fallback:`, e?.message);
      return this.localDb.getAll<T>(collection);
    }
  }

  private async getOne<T>(collection: string, id: string): Promise<T | undefined> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('payload')
        .eq('collection', collection)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? await this.signRecordMedia(collection, data.payload as T) : undefined;
    } catch (e: any) {
      console.warn(`Supabase getOne(${collection}, ${id}) fallback:`, e?.message);
      return this.localDb.getOne<T>(collection, id);
    }
  }

  private async upsert<T extends { id: string }>(
    collection: string,
    item: T,
    ownerId?: string,
    options?: SavePostOptions
  ): Promise<boolean> {
    // The insert policy compares owner_id with the Firebase UID in the request
    // token. A missing owner can never match, so fill it in before writing.
    const owner = ownerId ?? (await this.currentUid());
    const row = {
      id: item.id,
      collection,
      owner_id: owner ?? null,
      payload: this.persistRecordMedia(collection, item),
      updated_at: Date.now()
    };
    if (options?.ifUnchangedSince !== undefined) {
      // Compare-and-set: only write if nobody else has touched the record since
      // it was read. A background write that was overtaken therefore changes
      // nothing instead of putting back a version the person has moved on from.
      const base = (item as unknown as { updatedAt?: number }).updatedAt;
      const { data, error } = await this.client
        .from('records')
        .update({ payload: row.payload, updated_at: row.updated_at })
        .eq('id', item.id)
        .eq('collection', collection)
        .eq('payload->>updatedAt', String(options.ifUnchangedSince))
        .select('id');
      if (error) {
        // The row may not exist yet, or the caller may not be allowed to update
        // it. Fall back to the ordinary write rather than losing the change.
        console.warn(`Supabase conditional update(${collection}) fell back:`, error.message);
        await this.write(collection, () => this.putRecord(row), { owner });
        return true;
      }
      if (base === undefined) return true;
      const applied = (data ?? []).length > 0;
      if (applied) {
        this.rx.next(++this.tick);
        supabaseNotice.set('');
      } else {
        console.info(`Supabase conditional update(${collection}) skipped ${item.id}: it changed after it was read.`);
      }
      return applied;
    }
    await this.write(collection, () => this.putRecord(row), { owner });
    return true;
  }

  /**
   * Insert a new row, or update it when that id is already stored.
   *
   * Do not use PostgREST upsert for this. `INSERT ... ON CONFLICT DO UPDATE`
   * also runs the UPDATE policy, and the live update policy cannot see a story
   * or a post that does not exist yet. That is reported as
   * "new row violates row-level security policy" even though a plain insert of
   * the same row is allowed — which is why a Spotlight could be saved and a
   * story or post could not. An update of a row that is already there is fine.
   */
  private async putRecord(row: { id: string; collection: string; owner_id: string | null; payload: unknown; updated_at: number }): Promise<{ error: { message: string; code?: string } | null }> {
    const inserted = await this.client.from('records').insert(row);
    if (!inserted.error || !this.isDuplicate(inserted.error)) return inserted;
    return this.client
      .from('records')
      .update({ payload: row.payload, updated_at: row.updated_at })
      .eq('collection', row.collection)
      .eq('id', row.id);
  }

  /** Postgres unique_violation, however PostgREST spells it. */
  private isDuplicate(error: { code?: string; message?: string }): boolean {
    return error.code === '23505' || /duplicate key|already exists/i.test(error.message ?? '');
  }

  /**
   * Every write goes through here.
   *
   * A row-level-security rejection on a plain insert means the database could
   * not see who was calling, so the row is retried once with a freshly minted
   * ID token. If it still fails, the person is told what actually went wrong
   * instead of a raw Postgres message, and the reason is written to the banner
   * so it is visible on the page and not only in the console.
   */
  private async write(
    collection: string,
    send: () => PromiseLike<{ error: { message: string; code?: string } | null }>,
    ctx: { owner?: string | null } = {}
  ): Promise<void> {
    let error = (await send()).error;
    if (error && isIdentityError(error.message)) {
      // Force a new ID token and try the same write once more.
      await this.refreshIdentity();
      const retry = await send();
      if (!retry.error) {
        this.rx.next(++this.tick);
        return;
      }
      error = retry.error;
    }
    if (!error) {
      this.rx.next(++this.tick);
      supabaseNotice.set('');
      return;
    }
    const reason = this.explain(collection, error.message, ctx.owner ?? null);
    console.warn(`Supabase upsert(${collection}) failed:`, error.message, '-', reason);
    throw new Error(reason);
  }

  /** Ask Firebase for a brand new ID token. */
  private async refreshIdentity(): Promise<void> {
    const bridge = this.authBridge as (FirebaseAuthBridge & { forceToken?: () => Promise<void> }) | null;
    if (!bridge) return;
    try { await bridge.forceToken?.(); } catch { /* the retry below reports the real error */ }
  }

  /**
   * Turns a Postgres/PostgREST error into something a person can act on.
   * The `lula_uid()` helper returns NULL when Supabase cannot read the
   * Firebase UID out of the request, and every write is then denied - so that
   * case gets its own message and its own banner.
   */
  private explain(collection: string, message: string, owner: string | null): string {
    if (isIdentityError(message)) {
      supabaseNotice.set(
        'That save was refused by the database, so nothing was stored. Try again. ' +
        'If it keeps happening, sign out and sign in so the database can see this account.'
      );
      return 'Nothing was saved. Try again — you do not need to sign out first.';
    }
    if (/row-level security/i.test(message)) {
      return `LulaFind could not save this because the database would not accept it. Please try again.`;
    }
    if (/duplicate key/i.test(message)) {
      return 'That already exists.';
    }
    if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
      return 'No connection. Check your internet and try again.';
    }
    void collection; void owner;
    return `Could not save: ${message}`;
  }

  private async remove(collection: string, id: string): Promise<void> {
    const { error } = await this.client
      .from('records')
      .delete()
      .eq('collection', collection)
      .eq('id', id);
    if (error) {
      console.warn(`Supabase remove(${collection}, ${id}) failed:`, error.message);
      throw new Error(`Could not delete ${collection}: ${error.message}`);
    }
    this.rx.next(++this.tick);
  }

  private async getAllWhere<T>(
    collection: string,
    field: string,
    value: string
  ): Promise<T[]> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('payload')
        .eq('collection', collection)
        .filter(`payload->>${field}`, 'eq', value)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return await Promise.all((data ?? []).map((r) => this.signRecordMedia(collection, r.payload as T)));
    } catch (e: any) {
      console.warn(`Supabase getAllWhere(${collection}) fallback:`, e?.message);
      const all = this.localDb.getAll<any>(collection);
      return all.filter((x) => x && x[field] === value) as T[];
    }
  }

  // ─── users ───────────────────────────────────────────────────────────────

  async user(id: string): Promise<UserProfile | undefined> {
    try {
      if ((await this.currentUid()) === id) return this.getOne<UserProfile>('users', id);
      const { data, error } = await this.client
        .from('lula_user_profiles_public')
        .select('payload')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? (data.payload as UserProfile) : undefined;
    } catch (e: any) {
      console.warn(`Supabase user(${id}) fallback:`, e?.message);
      return this.localDb.user(id);
    }
  }

  async users(): Promise<UserProfile[]> {
    return this.getAll<UserProfile>('users');
  }

  async saveUser(u: UserProfile): Promise<void> {
    await this.upsert('users', u, u.id);
  }

  async deleteUser(id: string): Promise<void> {
    await this.remove('users', id);
  }

  // ─── posts ───────────────────────────────────────────────────────────────

  async post(id: string): Promise<Post | undefined> {
    return this.getOne<Post>('posts', id);
  }

  async posts(): Promise<Post[]> {
    return this.getAll<Post>('posts');
  }

  /**
   * Posts written by one person, for their profile page.
   *
   * The home feed is filtered for the viewer, so filtering *it* by author used
   * to show "0 posts" on someone else's profile. RLS still decides what comes
   * back: followers-only and Spotlight-only posts are removed unless the viewer
   * is allowed to see them, so the number matches the list.
   */
  async postsByAuthor(authorId: string): Promise<Post[]> {
    if (!authorId) return [];
    try {
      const { data, error } = await this.client
        .from('records')
        .select('payload')
        .eq('collection', 'posts')
        .eq('payload->>authorId', authorId)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return await Promise.all((data ?? []).map((row) => this.signRecordMedia('posts', row.payload as Post)));
    } catch {
      // Older rows may predate the indexed payload; fall back to a scan.
      return (await this.posts()).filter((p) => p.authorId === authorId);
    }
  }

  /**
   * Cases held for review. Queried directly, because queryFeed hides them from
   * everyone except the author and would hand the moderation screen an empty list.
   */
  async postsForReview(): Promise<Post[]> {
    const { data, error } = await this.client
      .from('records')
      .select('payload')
      .eq('collection', 'posts')
      // status lives inside the payload jsonb - the records table has no status column
      .filter('payload->>status', 'eq', 'under_review')
      .order('updated_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    const posts = await Promise.all((data ?? []).map((row) => this.signRecordMedia('posts', row.payload as Post)));
    return posts.filter((p) => p.status === 'under_review');
  }

  /**
   * Cases that closed as found, for the reunions page. Read directly from the
   * records, because the feed hides found cases by design.
   */
  async foundCases(): Promise<Post[]> {
    const { data, error } = await this.client
      .from('records')
      .select('payload')
      .eq('collection', 'posts')
      .filter('payload->>status', 'eq', 'found')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const posts = await Promise.all((data ?? []).map((row) => this.signRecordMedia('posts', row.payload as Post)));
    return posts.filter((p) => p.status === 'found');
  }

  /**
   * Patch fields on a post with a jsonb merge inside the database, so a second
   * writer cannot clobber the first with a copy it read earlier. Needs
   * `lula_patch_post` from supabase/schema.sql.
   */
  async patchPost(id: string, patch: Partial<Post>): Promise<Post | undefined> {
    const { error } = await this.client.rpc('lula_patch_post', {
      post_id: id,
      patch: { ...patch, id } as unknown as Record<string, unknown>
    });
    if (error) throw new Error(error.message);
    return this.post(id);
  }

  async queryFeed(f: FeedFilter, viewerId: string | null): Promise<Post[]> {
    try {
      // RLS is the source of truth for private audiences. Fetch the visible
      // records first, then apply the same sort/status/query rules as LocalDb.
      const { data, error } = await this.client
        .from('records')
        .select('payload')
        .eq('collection', 'posts')
        .order('updated_at', { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      let posts = await Promise.all((data ?? []).map((row) => this.signRecordMedia('posts', row.payload as Post)));
      const [viewer, people] = await Promise.all([
        viewerId ? this.user(viewerId) : Promise.resolve(undefined),
        f.query.trim() ? this.users() : Promise.resolve([])
      ]);
      posts = (await this.applyVisibility(posts, viewerId)).filter((p) => {
        if (f.type !== 'all' && p.type !== f.type) return false;
        if (f.province !== 'all' && p.province !== f.province) return false;
        if (f.spotlightId && p.spotlightId !== f.spotlightId) return false;
        if (f.status === 'active' && p.status !== 'active' && p.status !== 'under_review') return false;
        if (f.status === 'found' && p.status !== 'found') return false;
        if (f.query.trim()) {
          const q = f.query.trim().toLowerCase();
          const author = people.find((u) => u.id === p.authorId);
          const haystack = [p.title, p.body, p.town, p.caseNumber ?? '', p.subject?.name ?? '',
            p.subject?.surname ?? '', p.vehicleDetails?.makeModel ?? '', author?.displayName ?? ''].join(' ').toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
      switch (f.sort) {
        case 'hot':
          posts.sort((a, b) => this.score(b) - this.score(a));
          break;
        case 'oldest':
          posts.sort((a, b) => a.createdAt - b.createdAt);
          break;
        case 'nearby':
          posts.sort((a, b) => Number(b.province === viewer?.province) - Number(a.province === viewer?.province));
          break;
        default:
          posts.sort((a, b) => b.updatedAt - a.updatedAt);
      }
      return posts;
    } catch (e: any) {
      console.warn('Supabase queryFeed fallback:', e?.message);
      let posts = this.localDb.getAll<Post>('posts');
      if (f.type !== 'all') posts = posts.filter((p) => p.type === f.type);
      if (f.province !== 'all') posts = posts.filter((p) => p.province === f.province);
      if (f.status === 'active') posts = posts.filter((p) => p.status === 'active' || p.status === 'under_review');
      if (f.status === 'found') posts = posts.filter((p) => p.status === 'found');
      if (f.spotlightId) posts = posts.filter((p) => p.spotlightId === f.spotlightId);
      return posts;
    }
  }

  /**
   * The review and audience rules the feed applies, in one place.
   *
   * Search uses this too, so a result can never be more visible than the post
   * is in the feed: a child case held for review, a followers-only update and a
   * surname-only Spotlight post all stay exactly as private as they were.
   */
  private async applyVisibility(posts: Post[], viewerId: string | null): Promise<Post[]> {
    const spots = posts.some((p) => p.audience === 'surname') ? await this.spotlights() : [];
    const following = new Set<string>();
    if (viewerId) {
      await Promise.all(posts.filter((p) => p.authorId !== viewerId && p.audience === 'followers')
        .map(async (p) => { if (await this.isFollowing(viewerId, p.authorId)) following.add(p.authorId); }));
    }
    return posts.filter((p) => {
      if (p.status === 'under_review' && p.authorId !== viewerId) return false;
      if (p.audience === 'followers' && p.authorId !== viewerId && !following.has(p.authorId)) return false;
      if (p.audience === 'surname' && p.authorId !== viewerId) {
        const spot = spots.find((s) => s.id === p.spotlightId);
        if (!viewerId || !spot || !spot.memberIds.includes(viewerId)) return false;
      }
      return true;
    });
  }

  /* ─── search ────────────────────────────────────────────────────────────── */

  /**
   * Search the whole posts collection on the server.
   *
   * Records live as jsonb in `payload`, so the query is
   * `payload->>field ilike %needle%`. PostgREST splits its `or(...)` expression
   * on commas and parentheses, and LIKE treats `%` and `_` as wildcards, so the
   * needle is escaped first - a surname with an apostrophe or a `%` in a case
   * number must not change the shape of the query. RLS decides which rows this
   * viewer may read at all; the audience and review rules are then applied
   * exactly as they are for the feed.
   */
  async searchPosts(q: string, limit = 40): Promise<Post[]> {
    const needle = q.trim();
    if (needle.length < 2) return [];
    const pattern = likePattern(needle);
    try {
      const { data, error } = await this.client
        .from('records')
        .select('payload')
        .eq('collection', 'posts')
        .or(SEARCH_POST_FIELDS.map((field) => `payload->>${field}.ilike.${pattern}`).join(','))
        .order('updated_at', { ascending: false })
        .limit(limit * 2);
      if (error) throw new Error(error.message);
      const viewerId = await this.currentUid();
      const rows = await Promise.all((data ?? []).map((row) => this.signRecordMedia('posts', row.payload as Post)));
      return (await this.applyVisibility(rows, viewerId)).slice(0, limit);
    } catch (e: any) {
      // The network is the only thing that failed: answer from what is stored
      // on this device rather than showing an empty search.
      console.warn('Supabase searchPosts fallback:', e?.message);
      return this.localDb.searchPosts(q, limit);
    }
  }

  /**
   * Search members by name, surname or handle.
   *
   * The public profiles view keeps one jsonb `payload` per member, so the same
   * escaping rules apply. Suspended accounts are filtered out here as well as
   * locally, so a suspended member cannot surface through search.
   */
  async searchUsers(q: string, limit = 20): Promise<UserProfile[]> {
    const needle = q.trim().replace(/^@/, '');
    if (!needle) return [];
    const pattern = likePattern(needle);
    try {
      const { data, error } = await this.client
        .from('lula_user_profiles_public')
        .select('payload')
        .or(SEARCH_USER_FIELDS.map((field) => `payload->>${field}.ilike.${pattern}`).join(','))
        .limit(limit * 2);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => row.payload as UserProfile)
        .filter((u) => !u.suspended)
        .slice(0, limit);
    } catch (e: any) {
      console.warn('Supabase searchUsers fallback:', e?.message);
      return this.localDb.searchUsers(q, limit);
    }
  }

  private score(post: Post): number {
    const ageHours = Math.max(1, (Date.now() - post.createdAt) / 3_600_000);
    return (post.upvotes * 3 + post.commentCount * 5 + post.shares * 2) / Math.pow(ageHours, 0.55);
  }

  /**
   * Authors save their own post directly. Everyone else (voting, sharing,
   * "I'm looking", search zones, danger updates, Home Sweet Home answers,
   * reports) goes through lula_post_interact, which accepts only those
   * narrow changes - see supabase/post-interactions.sql.
   */
  async savePost(p: Post, options?: SavePostOptions): Promise<boolean> {
    const me = await this.currentUid();
    if (!me || me === p.authorId) {
      return this.upsert('posts', p, p.authorId, options);
    }
    const { error } = await this.client.rpc('lula_post_interact', {
      post_id: p.id,
      next: this.persistRecordMedia('posts', p)
    });
    if (error) {
      // Admins moderate with a direct write.
      if (/Authors and admins/i.test(error.message)) {
        return this.upsert('posts', p, p.authorId, options);
      }
      throw new Error(error.message);
    }
    this.rx.next(++this.tick);
    return true;
  }

  async linkSpotlightPost(spotlightId: string, postId: string, linking: boolean): Promise<void> {
    const { error } = await this.client.rpc('lula_link_spotlight_post', {
      spotlight_id: spotlightId, post_id: postId, linking
    });
    if (error) throw new Error(`Could not update the Spotlight: ${error.message}`);
    this.rx.next(++this.tick);
  }

  async deletePost(id: string): Promise<void> {
    await this.remove('posts', id);
  }

  // —— be on the lookout ————————————————————————————————————————————————

  /** RLS decides what this returns: my own lookouts, and those I follow. */
  async lookouts(): Promise<Lookout[]> {
    const all = await this.getAll<Lookout>('lookouts');
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async saveLookout(l: Lookout): Promise<void> {
    await this.upsert('lookouts', l, l.userId);
  }

  async patchLookout(id: string, patch: Partial<Lookout>): Promise<Lookout | undefined> {
    const { error } = await this.client.rpc('lula_patch_lookout', { lookout_id: id, patch: { ...patch, id } });
    if (error) {
      console.warn('Supabase patchLookout failed:', error.message);
      return undefined;
    }
    this.rx.next(++this.tick);
    return this.getOne<Lookout>('lookouts', id);
  }

  /**
   * A follower answers "are they okay?".
   *
   * This goes through one SECURITY DEFINER function because the decision spans
   * rows the answerer does not own: their answer, and - when they say something
   * is wrong - a case published on the person's behalf. Doing it in one
   * statement also means two followers answering at once cannot both read the
   * same "everyone said yes" state and both close the lookout.
   */
  async answerLookout(id: string, byUserId: string, ok: boolean): Promise<Lookout | undefined> {
    /* The database enforces this too (lula_answer_lookout); the check here is
       what gives the same message offline and online. */
    const local = (await this.getAll<Lookout>('lookouts')).find((l) => l.id === id);
    const blocked = local ? answerBlocker(local, byUserId) : null;
    if (blocked) throw new Error(blocked);
    const { error } = await this.client.rpc('lula_answer_lookout', {
      lookout_id: id, answerer: byUserId, they_are_ok: ok
    });
    if (error) {
      console.warn('Supabase answerLookout failed:', error.message);
      throw new Error(error.message);
    }
    this.rx.next(++this.tick);
    try {
      return await this.getOne<Lookout>('lookouts', id);
    } catch {
      return undefined;
    }
  }

  /** "I'm here": delete the case the app published for this lookout. */
  async deleteLookoutCase(lookoutId: string): Promise<void> {
    const { data, error } = await this.client
      .from('records')
      .select('id')
      .eq('collection', 'posts')
      .filter('payload->>lookoutId', 'eq', lookoutId);
    if (error) {
      console.warn('Supabase deleteLookoutCase lookup failed:', error.message);
      return;
    }
    for (const row of data ?? []) {
      await this.remove('posts', (row as { id: string }).id);
    }
  }

  // ─── comments ────────────────────────────────────────────────────────────

  async commentsFor(postId: string): Promise<Comment[]> {
    return this.getAllWhere<Comment>('comments', 'postId', postId);
  }

  async saveComment(c: Comment): Promise<void> {
    await this.upsert('comments', c, c.authorId);
  }

  async deleteComment(id: string, _postId?: string): Promise<void> {
    await this.remove('comments', id);
  }

  // ─── spotlights ──────────────────────────────────────────────────────────

  async spotlights(): Promise<Spotlight[]> {
    return this.getAll<Spotlight>('spotlights');
  }

  async spotlight(id: string): Promise<Spotlight | undefined> {
    return this.getOne<Spotlight>('spotlights', id);
  }


  /**
   * Posts filed to one Spotlight, read from the whole collection.
   *
   * A Spotlight page is public reading: joining is what lets you post. The
   * server-side rule lives in `lula_post_visible`; run
   * supabase/spotlight-public-read.sql so the database agrees with this query.
   */
  async postsInSpotlight(spotlightId: string): Promise<Post[]> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('payload')
        .eq('collection', 'posts')
        .eq('payload->>spotlightId', spotlightId)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return await Promise.all((data ?? []).map((row) => this.signRecordMedia('posts', row.payload as Post)));
    } catch (e: any) {
      console.warn('Supabase postsInSpotlight fallback:', e?.message);
      return this.localDb.postsInSpotlight(spotlightId);
    }
  }

  async saveSpotlight(s: Spotlight): Promise<void> {
    await this.upsert('spotlights', s, s.ownerId);
  }

  async setSpotlightMembership(id: string, memberId: string, joining: boolean): Promise<Spotlight | undefined> {
    if ((await this.currentUid()) !== memberId) throw new Error('Sign in to change your Spotlight membership');
    const { data, error } = await this.client.rpc('lula_set_spotlight_membership', {
      spotlight_id: id,
      joining
    });
    if (error) throw new Error(`Could not update Spotlight membership: ${error.message}`);
    this.rx.next(++this.tick);
    return data as Spotlight | undefined;
  }

  async deleteSpotlight(id: string): Promise<void> {
    await this.remove('spotlights', id);
  }

  // ─── media ────────────────────────────────────────────────────────────────

  async uploadMedia(ownerId: string, item: MediaItem): Promise<MediaItem> {
    let path = this.storagePath(item.src);
    if (item.src.startsWith('data:')) {
      if (!ownerId) throw new Error('Sign in before uploading media');
      const blob = await fetch(item.src).then((response) => response.blob());
      // A video is allowed to be much larger than a photo: the composer
      // downscales photos before they get here, but a phone clip is already
      // compressed and cannot be re-encoded in the browser.
      const limit = item.kind === 'video' ? VIDEO_MAX_BYTES : PHOTO_MAX_BYTES;
      if (blob.size > limit) {
        const mb = Math.round(limit / (1024 * 1024));
        throw new Error(item.kind === 'video'
          ? `Choose a video smaller than ${mb} MB`
          : `Choose a photo smaller than ${mb} MB`);
      }
      const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || (item.kind === 'video' ? 'mp4' : 'jpg');
      path = `${ownerId}/${item.id}.${extension}`;
      const { error } = await this.client.storage.from('photos').upload(path, blob, {
        cacheControl: '3600', upsert: true, contentType: blob.type || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg')
      });
      if (error) {
        // Row-level security here means the bucket policy refused the folder,
        // which is an identity or setup problem - not a problem with the photo.
        // Say so, and point at the one command that names the exact cause.
        const rls = /row-level security|violates/i.test(error.message);
        throw new Error(rls
          ? 'Photo upload was refused by the database. In the app console run: await window.__lulaDebugStorage()'
          : `Could not upload media: ${error.message}`);
      }
    }
    if (!path) return item;
    const src = await this.signedStorageUrl(path);
    if (!src) throw new Error('Could not create a private photo link. Check the photo bucket policies.');
    return { ...item, src };
  }

  // ─── stories ─────────────────────────────────────────────────────────────

  async stories(): Promise<Story[]> {
    const all = await this.getAll<Story>('stories');
    return all.filter((s) => s.expiresAt > Date.now());
  }

  async saveStory(s: Story): Promise<void> {
    // Stories are written straight with the author's UID as owner_id. A story
    // that gets rejected here is the one the person is trying to share right
    // now, so it fails loudly rather than falling back to a local copy.
    await this.upsert('stories', s, s.authorId);
  }

  async storyRepliesFor(storyId: string): Promise<StoryReply[]> {
    // Legacy embedded replies are migrated to story_replies by story-privacy.sql.
    // Never merge the local demo seed into a live user's story insights.
    const stored = await this.getAllWhere<StoryReply>('story_replies', 'storyId', storyId);
    return stored.sort((a, b) => a.at - b.at);
  }

  async saveStoryReply(reply: StoryReply): Promise<void> {
    await this.upsert('story_replies', reply, reply.authorId);
  }

  async storyViewsFor(storyId: string): Promise<StoryView[]> {
    // Legacy embedded view ids are migrated by story-privacy.sql; do not expose
    // bundled demo viewers as live insights.
    const stored = await this.getAllWhere<StoryView>('story_views', 'storyId', storyId);
    return stored.sort((a, b) => a.at - b.at);
  }

  async saveStoryView(view: StoryView): Promise<void> {
    await this.upsert('story_views', view, view.viewerId);
  }

  // ─── chat ─────────────────────────────────────────────────────────────────

  async threadsFor(userId: string): Promise<ChatThread[]> {
    const all = await this.getAll<ChatThread>('threads');
    return all.filter((t) => t.participantIds.includes(userId));
  }

  async thread(id: string): Promise<ChatThread | undefined> {
    return this.getOne<ChatThread>('threads', id);
  }

  async saveThread(t: ChatThread): Promise<void> {
    await this.upsert('threads', t, t.participantIds[0] ?? undefined);
  }

  async messages(threadId: string): Promise<ChatMessage[]> {
    const all = await this.getAllWhere<ChatMessage>('messages', 'threadId', threadId);
    return all.sort((a, b) => a.at - b.at);
  }

  async saveMessage(m: ChatMessage): Promise<void> {
    // System bubbles are still written by a signed-in participant. The sender
    // label is deliberately `system` in the payload; `owner_id` is the caller's UID.
    const ownerId = m.fromUserId === 'system'
      ? await this.currentUid()
      : m.fromUserId;
    await this.upsert('messages', m, ownerId ?? undefined);
  }

  async markThreadRead(threadId: string, userId: string): Promise<void> {
    const t = await this.thread(threadId);
    if (!t) return;
    const unread = { ...t.unread, [userId]: 0 };
    await this.saveThread({ ...t, unread });
  }

  // ─── follows ─────────────────────────────────────────────────────────────

  async isFollowing(a: string, b: string): Promise<boolean> {
    return (await this.followStatus(a, b)) === 'accepted';
  }

  async followStatus(a: string, b: string): Promise<FollowEdge['status'] | null> {
    try {
      return (await this.getOne<FollowEdge>('follows', `f_${a}_${b}`))?.status ?? null;
    } catch {
      return this.localDb.followStatus(a, b);
    }
  }

  async followsFor(userId: string, direction: 'followers' | 'following'): Promise<FollowEdge[]> {
    const field = direction === 'followers' ? 'followingId' : 'followerId';
    const all = await this.getAllWhere<FollowEdge>('follows', field, userId);
    return all.filter((edge) => edge.status === 'accepted');
  }

  async follow(a: string, b: string): Promise<'accepted' | 'pending'> {
    const target = await this.user(b);
    const needsApproval = target?.privacy?.requireFollowApproval === true;
    const status: FollowEdge['status'] = needsApproval ? 'pending' : 'accepted';
    const edge: FollowEdge = {
      id: `f_${a}_${b}`,
      followerId: a,
      followingId: b,
      at: Date.now(),
      status
    };
    await this.upsert('follows', edge, a);
    return status;
  }

  async unfollow(a: string, b: string): Promise<void> {
    await this.remove('follows', `f_${a}_${b}`);
  }

  async followRequests(userId: string): Promise<FollowEdge[]> {
    const all = await this.getAllWhere<FollowEdge>('follows', 'followingId', userId);
    return all.filter((e) => e.status === 'pending');
  }

  async respondFollowRequest(followerId: string, userId: string, accept: boolean): Promise<void> {
    const id = `f_${followerId}_${userId}`;
    if (accept) {
      const edge = await this.getOne<FollowEdge>('follows', id);
      if (edge) await this.upsert('follows', { ...edge, status: 'accepted' }, followerId);
    } else {
      await this.remove('follows', id);
    }
  }

  async followerCount(userId: string): Promise<number> {
    const all = await this.getAllWhere<FollowEdge>('follows', 'followingId', userId);
    return all.filter((e) => e.status === 'accepted').length;
  }

  async followingCount(userId: string): Promise<number> {
    const all = await this.getAllWhere<FollowEdge>('follows', 'followerId', userId);
    return all.filter((e) => e.status === 'accepted').length;
  }

  // ─── notifications ───────────────────────────────────────────────────────

  async notifications(userId: string): Promise<Notification[]> {
    return this.getAllWhere<Notification>('notifications', 'userId', userId);
  }

  /**
   * Write a notification for its recipient.
   *
   * The row's owner must be the person writing it - the actor - because the
   * insert policy compares owner_id with the caller. The old code fell back to
   * the *recipient* when the actor could not be read, which produces a row the
   * database can only refuse. And because every caller awaits this right after
   * saving something real (a post, a comment, a follow), that refusal came back
   * as "Nothing was saved" on an action that had in fact been saved - the post
   * was there when the person went back for it.
   *
   * Delivering a notification is a side effect of someone else's action, so it
   * is now best-effort: a failure is logged and never thrown on to the save that
   * caused it.
   */
  async pushNotification(n: Notification): Promise<void> {
    const actor = await this.currentUid();
    if (!actor) {
      console.warn(`pushNotification(${n.kind}) skipped: no signed-in identity to own the row.`);
      return;
    }
    try {
      await this.upsert('notifications', n, actor);
    } catch (e) {
      console.warn(`pushNotification(${n.kind}) could not be written:`, (e as Error)?.message ?? e);
    }
  }

  async markNotificationsRead(userId: string): Promise<void> {
    const notes = await this.notifications(userId);
    await Promise.all(
      notes
        .filter((n) => !n.read)
        .map((n) => this.upsert('notifications', { ...n, read: true }, n.userId))
    );
  }

  // ─── push device tokens ─────────────────────────────────────────────────
  // The row-level security on public.push_tokens keys user_id off lula_uid(),
  // exactly like every other write here. There is no way to file a token
  // against another account even by asking nicely.

  /**
   * File this device's FCM token against the signed-in account.
   *
   * Upsert on the token, not on the user: FCM reissues tokens on reinstall and
   * on restore to a new phone, and a reissued token belongs to whoever is
   * signed in when it arrives. Overwriting by token moves it to the right
   * person and refreshes last_seen_at, instead of leaving a second row that
   * would deliver someone else's notifications.
   */
  async savePushToken(token: string, platform: string, appVersion: string): Promise<void> {
    const owner = await this.currentUid();
    // No identity means the insert policy would refuse it anyway. Say so
    // rather than letting the caller think the device is registered.
    if (!owner) throw new Error('Sign in before registering this device for notifications.');
    const { error } = await this.client
      .from('push_tokens')
      .upsert(
        {
          token,
          user_id: owner,
          platform,
          app_version: appVersion,
          last_seen_at: new Date().toISOString()
        },
        { onConflict: 'token' }
      );
    if (error) throw new Error(`Could not register this device: ${error.message}`);
  }

  /** Drop just this device's token - signing out must not silence the tablet. */
  async forgetPushToken(token: string): Promise<void> {
    const owner = await this.currentUid();
    if (!owner) return;
    const { error } = await this.client
      .from('push_tokens')
      .delete()
      .eq('token', token)
      .eq('user_id', owner);
    // A token that is already gone is the desired end state, not a failure.
    if (error) throw new Error(`Could not remove this device: ${error.message}`);
  }

  // ─── tips ────────────────────────────────────────────────────────────────

  async tips(): Promise<Tip[]> {
    try {
      const tips = await this.getAll<Tip>('tips');
      return tips.length ? tips : [];
    } catch {
      return [];
    }
  }
}

/**
 * The fields a free-text post search looks at. Kept in step with LocalDb's
 * matcher so the same words find the same case on any backend.
 */
const SEARCH_POST_FIELDS = ['title', 'body', 'town', 'caseNumber', 'subject', 'lastSeenWhere'] as const;

/** The fields a member search looks at. */
const SEARCH_USER_FIELDS = ['displayName', 'surname', 'handle'] as const;

/** Video files are the exception to the photo limit: a phone clip is bigger. */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
/** Photos are downscaled in the composer, so this is what arrives at the bucket. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Escape a search needle for PostgREST and SQL LIKE.
 *
 * In `or=(...)` PostgREST uses commas and parentheses to separate expressions,
 * and LIKE reads `%` and `_` as wildcards. A needle containing any of them -
 * "50%" in a case note, an address in brackets - is quoted with a backslash so
 * it is searched for literally instead of changing the query.
 */
export function likePattern(needle: string): string {
  return `%${needle.replace(/([\\%_,()])/g, '\\$1')}%`;
}
