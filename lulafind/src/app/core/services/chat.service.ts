import { Injectable, computed, inject, signal } from '@angular/core';
import { LULA_API } from '../data/api';
import { ChatMessage, ChatThread, MediaItem, Post, ReactionKind } from '../models/types';
import { uid } from '../utils/format';
import { AuthService } from './auth.service';

export type ChatGate =
  | { allowed: true; reason: 'open' }
  | { allowed: false; step: 'sign_in' }
  | { allowed: false; step: 'follow'; reason: string; peerId: string }
  | { allowed: false; step: 'disabled'; reason: string };

/**
 * Private chat, and only one way in: **you follow each other**.
 *
 * Reactions have nothing to do with it - a reaction is just a reaction, and
 * the app never tells anyone that reacting will "unlock" a chat. If you follow
 * someone and they follow you back, the two of you can message each other.
 *
 * Two exceptions, both intentional:
 *  - the poster themself, who can always be messaged about their own post;
 *  - someone who claimed a KhumbulEkhaya post as "this is me", because the whole
 *    point is that they can reach the family without being exposed.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private api = inject(LULA_API);
  private auth = inject(AuthService);

  readonly threads = signal<ChatThread[]>([]);
  readonly openThreadId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly sending = signal(false);

  readonly unreadTotal = computed(() => {
    const me = this.auth.viewerId;
    if (!me) return 0;
    return this.threads().reduce((sum, t) => sum + (t.unread[me] ?? 0), 0);
  });

  /**
   * LinkedIn's "Seen": your last real message, read. There is no per-message tick
   * in this app and none should be invented - one line, on the last thing you sent.
   */
  readonly peerSeen = computed(() => {
    const me = this.auth.viewerId;
    const list = this.messages();
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.kind === 'system' || m.fromUserId !== me) continue;
      return m.read;
    }
    return false;
  });

  /** Who is typing right now in the open thread - their id, or ''. */
  readonly typingPeer = computed(() => {
    const me = this.auth.viewerId;
    const typing = this.threads().find((t) => t.id === this.openThreadId())?.typing;
    if (!typing) return '';
    const now = Date.now();
    for (const [id, at] of Object.entries(typing)) {
      if (id !== me && now - at < 6_000) return id;
    }
    return '';
  });

  async load(): Promise<void> {
    const me = this.auth.viewerId;
    if (!me) {
      this.threads.set([]);
      return;
    }
    this.threads.set(await this.api.threadsFor(me));
  }

  async openThread(threadId: string): Promise<void> {
    const me = this.auth.viewerId;
    this.openThreadId.set(threadId);
    this.messages.set(await this.api.messages(threadId));
    if (me) await this.api.markThreadRead(threadId, me);
    await this.load();
  }

  async latestMessage(threadId: string): Promise<ChatMessage | null> {
    const messages = await this.api.messages(threadId);
    return messages[messages.length - 1] ?? null;
  }

  /** Keep inbox order and unread badges in sync across Local, Firebase and Supabase. */
  private async storeMessage(message: ChatMessage): Promise<void> {
    const thread = await this.api.thread(message.threadId);
    await this.api.saveMessage(message);
    if (!thread) return;

    const unread = { ...thread.unread };
    for (const participantId of thread.participantIds) {
      if (participantId !== message.fromUserId) {
        unread[participantId] = (unread[participantId] ?? 0) + 1;
      }
    }
    await this.api.saveThread({ ...thread, lastMessageAt: message.at, unread });
  }

  async refreshOpenThread(): Promise<void> {
    const threadId = this.openThreadId();
    const me = this.auth.viewerId;
    if (!threadId || !me) return;
    const fresh = await this.api.messages(threadId);
    this.messages.set(fresh);
    if (fresh.some((message) => message.fromUserId !== me && !message.read)) {
      await this.api.markThreadRead(threadId, me);
    }
    await this.load();
  }

  async close(): Promise<void> {
    this.openThreadId.set(null);
    this.messages.set([]);
  }

  /**
   * Is chat open between the viewer and this post's author?
   *
   * One rule: you follow each other. There is no reaction step, and the UI must
   * never suggest there is one.
   */
  async gate(post: Post, claimedByViewer = false): Promise<ChatGate> {
    const me = this.auth.viewerId;
    if (!post.chatEnabled) {
      return { allowed: false, step: 'disabled', reason: 'The poster turned chat off for this post. Use the comments instead.' };
    }
    if (!me) return { allowed: false, step: 'sign_in' };
    if (me === post.authorId) return { allowed: true, reason: 'open' };
    if (claimedByViewer || post.khumbu?.claimedByUserId === me) return { allowed: true, reason: 'open' };

    const mutual =
      (await this.api.isFollowing(me, post.authorId)) && (await this.api.isFollowing(post.authorId, me));
    if (!mutual) {
      return {
        allowed: false,
        step: 'follow',
        reason: 'You can message each other once you follow each other.',
        peerId: post.authorId
      };
    }
    return { allowed: true, reason: 'open' };
  }

  /** Find an existing thread with this person (optionally about this post) or create one. */
  async ensureThread(post: Post | null, peerId: string, unlockedVia: ChatThread['unlockedVia'] = 'follow'): Promise<ChatThread | null> {
    const me = this.auth.viewerId;
    if (!me || me === peerId) return null;
    const existing = (await this.api.threadsFor(me)).find(
      (t) => t.participantIds.includes(peerId) && (!post || t.postId === post.id)
    );
    if (existing) {
      await this.openThread(existing.id);
      return existing;
    }
    const now = Date.now();
    const thread: ChatThread = {
      id: uid('th'),
      participantIds: [me, peerId],
      postId: post?.id ?? null,
      createdAt: now,
      lastMessageAt: now,
      unread: { [me]: 0, [peerId]: 0 },
      unlockedVia
    };
    await this.api.saveThread(thread);
    await this.storeMessage({
      id: uid('m'),
      threadId: thread.id,
      fromUserId: 'system' as string,
      body: post
        ? `Private chat opened from "${post.title}". You follow each other. Everything here is only visible to the two of you.`
        : 'Private chat opened. Be kind, be careful, and never send money to a stranger.',
      at: now,
      read: false,
      kind: 'system',
      postId: post?.id
    });
    await this.load();
    await this.openThread(thread.id);
    return thread;
  }

  /**
   * Send a message. Either the text or the attachment has to be there -
   * an empty bubble with nothing in it is never sent.
   */
  async send(body: string, media?: MediaItem | null): Promise<void> {
    const me = this.auth.viewerId;
    const threadId = this.openThreadId();
    const text = body.trim();
    if (!me || !threadId || (!text && !media)) return;
    this.sending.set(true);
    try {
      await this.storeMessage({
        id: uid('m'),
        threadId,
        fromUserId: me,
        body: text,
        at: Date.now(),
        read: false,
        kind: 'text',
        media: media ?? null
      });
      this.messages.set(await this.api.messages(threadId));
      // Out with the message goes the "typing" marker, so the other side stops
      // watching dots that have nothing behind them.
      await this.writeTyping(threadId, me, 0);
      await this.load();
    } finally {
      this.sending.set(false);
    }
  }

  /* --------------------- the message's own actions --------------------- */

  /**
   * The reaction a message keeps: one per person, keyed by who reacted, so the
   * bubble shows small faces the way LinkedIn's does. Tapping the kind you already
   * chose takes it off.
   */
  async reactMessage(messageId: string, kind: ReactionKind | null): Promise<boolean> {
    const me = this.auth.viewerId;
    const threadId = this.openThreadId();
    if (!me || !threadId) return false;
    const message = (await this.api.messages(threadId)).find((m) => m.id === messageId);
    if (!message || message.kind === 'system' || message.unsent) return false;
    const reactions = { ...(message.reactions ?? {}) };
    if (kind && reactions[me] === kind) delete reactions[me];
    else if (kind) reactions[me] = kind;
    else delete reactions[me];
    await this.api.saveMessage({ ...message, reactions });
    this.messages.set(await this.api.messages(threadId));
    return true;
  }

  /** Editing is text-only and yours only. LinkedIn stamps the row "Edited". */
  async editMessage(messageId: string, body: string): Promise<boolean> {
    const me = this.auth.viewerId;
    const threadId = this.openThreadId();
    const text = body.trim();
    if (!me || !threadId || !text) return false;
    const message = (await this.api.messages(threadId)).find((m) => m.id === messageId);
    if (!message || message.fromUserId !== me || message.kind !== 'text' || message.unsent) return false;
    if (message.body === text) return true;
    await this.api.saveMessage({ ...message, body: text, editedAt: Date.now() });
    this.messages.set(await this.api.messages(threadId));
    return true;
  }

  /**
   * "Unsend" for both sides at once. The row stays so the thread still lines up -
   * the words, the attachment and the reactions go, and what is left says what
   * happened. That is LinkedIn's behaviour, and it is the honest one: a message
   * that silently disappears leaves the other person wondering about a bug.
   */
  async unsendMessage(messageId: string): Promise<boolean> {
    const me = this.auth.viewerId;
    const threadId = this.openThreadId();
    if (!me || !threadId) return false;
    const message = (await this.api.messages(threadId)).find((m) => m.id === messageId);
    if (!message || message.fromUserId !== me || message.kind === 'system' || message.unsent) return false;
    await this.api.saveMessage({ ...message, unsent: true, body: '', media: null, reactions: {}, editedAt: null });
    this.messages.set(await this.api.messages(threadId));
    return true;
  }

  /* ----------------------------- typing ----------------------------- */

  private typedAt = 0;
  private typingStop?: ReturnType<typeof setTimeout>;

  /**
   * Called on every keystroke in an open room. It writes at most one marker every
   * couple of seconds, and schedules the clear - so "typing" ends even if the
   * person walks away mid-sentence.
   */
  noteTyping(): void {
    const me = this.auth.viewerId;
    const threadId = this.openThreadId();
    if (!me || !threadId) return;
    const now = Date.now();
    if (now - this.typedAt > 2_000) {
      this.typedAt = now;
      void this.writeTyping(threadId, me, now);
    }
    clearTimeout(this.typingStop);
    this.typingStop = setTimeout(() => {
      this.typedAt = 0;
      void this.writeTyping(threadId, me, 0);
    }, 3_000);
  }

  /** Leaving the room: no stale dots for whoever opens it next. */
  stopTyping(): void {
    const me = this.auth.viewerId;
    const threadId = this.openThreadId();
    clearTimeout(this.typingStop);
    this.typedAt = 0;
    if (me && threadId) void this.writeTyping(threadId, me, 0);
  }

  private async writeTyping(threadId: string, userId: string, at: number): Promise<void> {
    try {
      const thread = await this.api.thread(threadId);
      if (!thread) return;
      const typing = { ...(thread.typing ?? {}) };
      if (at === 0) delete typing[userId];
      else typing[userId] = at;
      // lastMessageAt must not move: a typing marker is not a message.
      await this.api.saveThread({ ...thread, typing });
    } catch { /* a typing marker is the least important write in the app */ }
  }

  /**
   * "Send" on LinkedIn: the post carried into a private thread as a message the
   * other person can read and answer, with an optional note on top.
   *
   * LulaFind's one rule still applies - a thread exists between people who follow
   * each other - so callers should only offer this for mutual follows and say so
   * plainly when they cannot. Returns false rather than throwing when the two are
   * not connected, because on LinkedIn a tap on Send always lands somewhere.
   */
  async sendPost(post: Post, peerId: string, note = ''): Promise<boolean> {
    const me = this.auth.viewerId;
    if (!me || me === peerId) return false;
    const mutual = (await this.api.isFollowing(me, peerId)) && (await this.api.isFollowing(peerId, me));
    if (!mutual) return false;
    const thread = await this.ensureThread(post, peerId);
    if (!thread) return false;
    const text = note.trim() ? `${note.trim()}\n\n${post.title}` : post.title;
    await this.storeMessage({
      id: uid('m'),
      threadId: thread.id,
      fromUserId: me,
      body: text,
      at: Date.now(),
      read: false,
      kind: 'text',
      postId: post.id
    });
    await this.openThread(thread.id);
    return true;
  }

  /**
   * The people a post can be sent to: everyone you follow who follows you back.
   * Built in `PostActionsService`, which owns the caches the sheet renders from.
   */

  async systemNote(threadId: string, body: string, postId?: string): Promise<void> {
    const now = Date.now();
    await this.storeMessage({
      id: uid('m'),
      threadId,
      fromUserId: 'system',
      body,
      at: now,
      read: false,
      kind: 'system',
      postId
    });
    if (this.openThreadId() === threadId) this.messages.set(await this.api.messages(threadId));
    await this.load();
  }

  async markAllRead(): Promise<void> {
    const me = this.auth.viewerId;
    if (!me) return;
    for (const t of this.threads()) await this.api.markThreadRead(t.id, me);
    await this.load();
  }
}
