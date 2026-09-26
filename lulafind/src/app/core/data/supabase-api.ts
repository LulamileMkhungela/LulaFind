import { Observable, Subject } from 'rxjs';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { LulaApi } from './api';
import { SUPABASE_URL, SUPABASE_KEY, supabaseNotice } from './supabase-client';
import { LocalDb } from './local-db';
import {
  ChatMessage, ChatThread, Comment, FeedFilter, FollowEdge,
  Notification, Post, Spotlight, Story, Tip, UserProfile
} from '../models/types';

/**
 * SupabaseApi — production LulaApi implementation with automatic local storage fallback.
 *
 * All domain objects are stored as rows in a single flat `records` table.
 * If Supabase table or columns are missing or misconfigured, the API gracefully
 * falls back to local storage so users are never stuck during sign-up or sign-in.
 */
export class SupabaseApi implements LulaApi {
  private client: SupabaseClient;
  private localDb = new LocalDb();
  private readonly rx = new Subject<number>();
  private channel: RealtimeChannel | null = null;
  private tick = 0;

  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  async init(): Promise<void> {
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
          } else {
            supabaseNotice.set('');
          }
        });
    } catch (e: any) {
      console.warn('Supabase realtime init error:', e?.message);
    }
  }

  async reset(): Promise<void> {
    this.localDb.reset();
  }

  changes(): Observable<number> {
    return this.rx.asObservable();
  }

  // ─── private helpers with local fallback ───────────────────────────────

  private async getAll<T>(collection: string): Promise<T[]> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('data')
        .eq('collection', collection)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.data as T);
    } catch (e: any) {
      console.warn(`Supabase getAll(${collection}) fallback:`, e?.message);
      return this.localDb.getAll<T>(collection);
    }
  }

  private async getOne<T>(collection: string, id: string): Promise<T | undefined> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('data')
        .eq('collection', collection)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? (data.data as T) : undefined;
    } catch (e: any) {
      console.warn(`Supabase getOne(${collection}, ${id}) fallback:`, e?.message);
      return this.localDb.getOne<T>(collection, id);
    }
  }

  private async upsert<T extends { id: string }>(
    collection: string,
    item: T,
    ownerId?: string
  ): Promise<void> {
    try {
      const { error } = await this.client
        .from('records')
        .upsert({
          id: item.id,
          collection,
          owner_id: ownerId ?? null,
          data: item,
          updated_at: new Date().toISOString()
        });
      if (error) throw new Error(error.message);
      this.rx.next(++this.tick);
    } catch (e: any) {
      console.warn(`Supabase upsert(${collection}) fallback:`, e?.message);
      this.localDb.saveOne(collection, item);
      this.rx.next(++this.tick);
    }
  }

  private async remove(collection: string, id: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('records')
        .delete()
        .eq('collection', collection)
        .eq('id', id);
      if (error) throw new Error(error.message);
      this.rx.next(++this.tick);
    } catch (e: any) {
      console.warn(`Supabase remove(${collection}, ${id}) fallback:`, e?.message);
      this.localDb.deleteOne(collection, id);
      this.rx.next(++this.tick);
    }
  }

  private async getAllWhere<T>(
    collection: string,
    field: string,
    value: string
  ): Promise<T[]> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('data')
        .eq('collection', collection)
        .filter(`data->>${field}`, 'eq', value)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => r.data as T);
    } catch (e: any) {
      console.warn(`Supabase getAllWhere(${collection}) fallback:`, e?.message);
      const all = this.localDb.getAll<any>(collection);
      return all.filter((x) => x && x[field] === value) as T[];
    }
  }

  // ─── users ───────────────────────────────────────────────────────────────

  async user(id: string): Promise<UserProfile | undefined> {
    return this.getOne<UserProfile>('users', id);
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

  async queryFeed(f: FeedFilter, viewerId: string | null): Promise<Post[]> {
    try {
      let query = this.client
        .from('records')
        .select('data')
        .eq('collection', 'posts')
        .order('created_at', { ascending: false })
        .limit(200);

      if (f.province) query = query.filter('data->>province', 'eq', f.province);
      if (f.type && f.type !== 'all') query = query.filter('data->>type', 'eq', f.type);
      if (f.status) query = query.filter('data->>status', 'eq', f.status);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      let posts = (data ?? []).map((r) => r.data as Post);

      posts = posts.filter((p) => {
        if (p.status === 'under_review' && p.authorId !== viewerId) return false;
        if (p.audience === 'public') return true;
        if (!viewerId) return false;
        if (p.authorId === viewerId) return true;
        return true;
      });

      if (f.spotlightId) posts = posts.filter((p) => p.spotlightId === f.spotlightId);
      return posts;
    } catch (e: any) {
      console.warn('Supabase queryFeed fallback:', e?.message);
      let posts = this.localDb.getAll<Post>('posts');
      if (f.province) posts = posts.filter((p) => p.province === f.province);
      if (f.type && f.type !== 'all') posts = posts.filter((p) => p.type === f.type);
      if (f.status) posts = posts.filter((p) => p.status === f.status);
      return posts;
    }
  }

  async savePost(p: Post): Promise<void> {
    await this.upsert('posts', p, p.authorId);
  }

  async deletePost(id: string): Promise<void> {
    await this.remove('posts', id);
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

  async saveSpotlight(s: Spotlight): Promise<void> {
    await this.upsert('spotlights', s, s.ownerId);
  }

  async deleteSpotlight(id: string): Promise<void> {
    await this.remove('spotlights', id);
  }

  // ─── stories ─────────────────────────────────────────────────────────────

  async stories(): Promise<Story[]> {
    const all = await this.getAll<Story>('stories');
    return all.filter((s) => s.expiresAt > Date.now());
  }

  async saveStory(s: Story): Promise<void> {
    await this.upsert('stories', s, s.authorId);
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
    await this.upsert('messages', m, m.fromUserId ?? undefined);
  }

  async markThreadRead(threadId: string, userId: string): Promise<void> {
    const t = await this.thread(threadId);
    if (!t) return;
    const unread = { ...t.unread, [userId]: 0 };
    await this.saveThread({ ...t, unread });
  }

  // ─── follows ─────────────────────────────────────────────────────────────

  async isFollowing(a: string, b: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('records')
        .select('id')
        .eq('collection', 'follows')
        .eq('id', `f_${a}_${b}`)
        .maybeSingle();
      if (error || !data) return false;
      const edge = (data as any).data as FollowEdge;
      return edge?.status === 'accepted';
    } catch {
      const edge = this.localDb.getOne<FollowEdge>('follows', `f_${a}_${b}`);
      return edge?.status === 'accepted';
    }
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

  async pushNotification(n: Notification): Promise<void> {
    await this.upsert('notifications', n, n.userId);
  }

  async markNotificationsRead(userId: string): Promise<void> {
    const notes = await this.notifications(userId);
    await Promise.all(
      notes
        .filter((n) => !n.read)
        .map((n) => this.upsert('notifications', { ...n, read: true }, n.userId))
    );
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
