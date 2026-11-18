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

/** Messaging requires an accepted follow in either direction and both people allowing messages. */
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

  /** A connection in either direction is sufficient; pending requests are not. */
  async gatePerson(peerId: string): Promise<ChatGate> {
    const me = this.auth.viewerId;
    if (!me) return { allowed: false, step: 'sign_in' };
    if (me === peerId) return { allowed: false, step: 'disabled', reason: 'You cannot message yourself.' };
    const [peer, iFollow, followsMe] = await Promise.all([
      this.api.user(peerId), this.api.isFollowing(me, peerId), this.api.isFollowing(peerId, me)
    ]);
    const self = this.auth.user();
    if (!peer || peer.suspended || self?.suspended || self?.privacy?.allowMessages === false || peer.privacy?.allowMessages === false ||
        self?.blockedUserIds?.includes(peerId) || peer.blockedUserIds?.includes(me)) {
      return { allowed: false, step: 'disabled', reason: 'Messaging is unavailable. Check your message settings or contact the person another way.' };
    }
    if (!iFollow && !followsMe) {
      return { allowed: false, step: 'follow', reason: 'You can message when either of you follows the other.', peerId };
    }
    return { allowed: true, reason: 'open' };
  }

  async gate(post: Post, _claimedByViewer = false): Promise<ChatGate> {
    if (!post.chatEnabled) return { allowed: false, step: 'disabled', reason: 'The poster turned chat off for this post. Use the comments instead.' };
    return this.gatePerson(post.authorId);
  }

  /** Find an existing thread with this person (optionally about this post) or create one. */
  async ensureThread(post: Post | null, peerId: string, unlockedVia: ChatThread['unlockedVia'] = 'follow'): Promise<ChatThread | null> {
    const me = this.auth.viewerId;
    if (!me || me === peerId || (post && !post.chatEnabled)) return null;
    const gate = await this.gatePerson(peerId);
    if (!gate.allowed) return null;
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
        ? `Chat opened from "${post.title}". Be kind, be careful, and never send money to a stranger.`
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
    const thread = await this.api.thread(threadId);
    const peerId = thread?.participantIds.find((id) => id !== me);
    if (!thread?.participantIds.includes(me) || !peerId) throw new Error('This conversation is unavailable.');
    const post = thread.postId ? await this.api.post(thread.postId) : null;
    if (thread.postId && !post?.chatEnabled) throw new Error('The poster turned chat off for this post.');
    const gate = await this.gatePerson(peerId);
    if (!gate.allowed) throw new Error(gate.step === 'sign_in' ? 'Sign in to message.' : gate.reason);
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
