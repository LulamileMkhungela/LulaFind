import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { ChatService } from '../../core/services/chat.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { CheckInStatus, ChatMessage } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

/**
 * Chats, drawn the way Messenger draws its list:
 *
 *   a search box for the conversations you already have
 *   your face, name and a "new message" action
 *   one row per thread: face with presence, name, the last thing said, the
 *   time, and the unread pip
 *
 * The gate rule ("you can message someone when either person follows the
 * other") is a fact about the screen, so it is one quiet line under the list
 * header - not a paragraph standing between someone and their messages.
 */
@Component({
  selector: 'lf-chats',
  standalone: true,
  imports: [IonContent, TopNavComponent, IconComponent, AvatarComponent, EmptyComponent],
  template: `
    <lf-top-nav heading="Chats" />

    <ion-content class="lf-page lf-plain">
      @if (!auth.signedIn()) {
        <lf-empty icon="lock" title="Sign in to see your messages"
                  message="Chats are private and tied to your account." actionLabel="Sign in" (action)="goAuth()" />
      } @else {
        <div class="head">
          <div class="search">
            <lf-icon name="search" [size]="16" [weight]="'regular'" />
            <input #q type="search" enterkeyhint="search" autocomplete="off" [placeholder]="'Search messages'"
                   [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Search your chats" />
            @if (query()) {
              <button class="clear" type="button" (click)="clear(q)" aria-label="Clear search"><lf-icon name="x" [size]="14" [weight]="'bold'" /></button>
            }
          </div>
          <button class="new" type="button" (click)="goDiscover()" aria-label="Find someone to message">
            <lf-icon name="plus" [size]="20" [weight]="'bold'" />
          </button>
        </div>

        <div class="hint">
          <lf-icon name="lock" [size]="13" />
          <span>You can message someone when either person follows the other.</span>
        </div>

        @if (!threads().length) {
          <lf-empty icon="chat" title="No conversations yet"
                    message="Follow someone on a case and you can message each other."
                    actionLabel="Browse the feed" (action)="goHome()" />
        } @else if (!visible().length) {
          <div class="none">
            <lf-icon name="search" [size]="20" />
            <strong>No chat matches "{{ query().trim() }}"</strong>
            <button type="button" class="lf-btn lf-btn--ghost lf-btn--sm" (click)="query.set('')">Clear search</button>
          </div>
        } @else {
          <div class="list">
            @for (t of visible(); track t.id) {
              <button class="thread" [class.unread]="(t.unread[me()] ?? 0) > 0" (click)="open(t.id)">
                <span class="face">
                  <lf-avatar [src]="avatarOf(t)" [name]="nameOf(t)" [size]="52" [status]="statusOf(t)" />
                </span>
                <span class="grow">
                  <span class="row">
                    <strong class="who">{{ nameOf(t) }}</strong>
                    <span class="when">{{ timeAgo(t.lastMessageAt) }}</span>
                  </span>
                  <span class="row">
                    <span class="said">{{ preview(t.id) }}</span>
                    @if ((t.unread[me()] ?? 0) > 0) {
                      <span class="pip">{{ (t.unread[me()] ?? 0) > 99 ? '99+' : t.unread[me()] }}</span>
                    }
                  </span>
                  @if (postOf(t.postId); as p) {
                    <span class="context"><lf-icon name="pin" [size]="11" />{{ p.title }}</span>
                  }
                </span>
              </button>
            }
          </div>
        }
      }
    </ion-content>
  `,
  styles: [`
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 16px 8px; background: var(--lf-card); box-sizing: border-box; }
    .search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px;
      border-radius: 999px; background: var(--lf-input); color: var(--lf-muted); box-sizing: border-box; }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ion-text-color);
      font: inherit; font-size: 15px; padding: 0; }
    .search input::placeholder { color: var(--lf-muted); }
    .search input::-webkit-search-cancel-button { display: none; }
    .clear { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 50%;
      background: var(--lf-card-2); color: var(--lf-muted); cursor: pointer; padding: 0; }
    .new { flex: none; width: 38px; height: 38px; border: 0; border-radius: 50%; background: var(--lf-card-2);
      color: var(--ion-text-color); display: grid; place-items: center; cursor: pointer; }
    .new:hover { background: var(--lf-hover); }

    .hint { display: flex; align-items: center; gap: 6px; padding: 0 16px 10px; background: var(--lf-card);
      color: var(--lf-muted); font-size: 11.5px; line-height: 1.35; }
    .hint lf-icon { flex: none; }

    .list { display: flex; flex-direction: column; background: var(--lf-card); padding: 2px 0 24px;
      border-top: 1px solid var(--lf-line-soft); }
    .thread { display: flex; gap: 12px; align-items: flex-start; width: 100%; padding: 10px 16px; border: 0;
      background: transparent; color: inherit; text-align: left; cursor: pointer; font-family: inherit; box-sizing: border-box; }
    .thread + .thread { border-top: 1px solid var(--lf-line-soft); }
    .thread:hover, .thread:active { background: var(--lf-hover); }
    .face { flex: none; display: inline-flex; }
    .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .who { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .thread.unread .who { font-weight: 800; }
    .when { flex: none; color: var(--lf-muted); font-size: 11.5px; }
    .said { flex: 1; min-width: 0; color: var(--lf-muted); font-size: 13.5px; line-height: 1.35;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .thread.unread .said { color: var(--ion-text-color); font-weight: 600; }
    .pip { flex: none; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px;
      background: var(--lf-badge); color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; }
    .context { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; max-width: 100%;
      color: var(--lf-muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .context lf-icon { flex: none; }
    .none { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 36px 16px;
      color: var(--lf-muted); text-align: center; }
    .none strong { color: var(--ion-text-color); font-size: 14.5px; }
    @media (min-width: 768px) { .list, .head, .hint { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; } }
  `]
})
export class ChatsComponent {
  protected chat = inject(ChatService);
  protected data = inject(DataService);
  protected auth = inject(AuthService);
  private router = inject(Router);

  protected readonly timeAgo = timeAgo;
  protected readonly me = computed(() => this.auth.viewerId ?? '');
  readonly threads = computed(() => this.chat.threads());
  readonly previews = signal<Record<string, ChatMessage | null>>({});
  /** What the person typed into the chat search. Kept here so it survives a refresh. */
  readonly query = signal('');

  /** Threads that match the search, newest first - the order a person expects. */
  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = [...this.threads()].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    if (!q) return list;
    return list.filter((t) => this.nameOf(t).toLowerCase().includes(q) || this.preview(t.id).toLowerCase().includes(q));
  });

  constructor() { void this.loadThreads(); }

  ionViewWillEnter(): void { void this.loadThreads(); }

  /**
   * Load the inbox and every preview in one pass.
   *
   * The previews used to be fetched one thread at a time, and each one
   * awaited its own message query, so an inbox of eight conversations meant
   * eight sequential round-trips before the list looked alive. They now go out
   * together, and only for threads that actually have messages to show.
   */
  private async loadThreads(): Promise<void> {
    try {
      await this.chat.load();
      const done = this.previews();
      const wanted = this.chat.threads().filter((t) => !(t.id in done));
      const entries = await Promise.all(wanted.map(async (thread) => {
        try { return [thread.id, await this.chat.latestMessage(thread.id)] as const; }
        catch { return [thread.id, null] as const; }
      }));
      if (entries.length) this.previews.set({ ...this.previews(), ...Object.fromEntries(entries) });
    } catch { /* the empty/list state remains accurate if chat is offline */ }
  }

  otherId(participantIds: string[]): string {
    return participantIds.find((id) => id !== this.auth.viewerId) ?? '';
  }

  nameOf(t: { participantIds: string[] }): string {
    return this.data.authorOf(this.otherId(t.participantIds))?.displayName ?? 'Member';
  }

  avatarOf(t: { participantIds: string[] }): string {
    return this.data.avatarFor(this.data.authorOf(this.otherId(t.participantIds)));
  }

  /** The other person's safety ring, so a chat list is also a "are they okay" list. */
  statusOf(t: { participantIds: string[] }): CheckInStatus | null {
    return this.data.authorOf(this.otherId(t.participantIds))?.checkIn?.status ?? null;
  }

  preview(threadId: string): string {
    const message = this.previews()[threadId];
    if (!message) return 'No messages yet';
    if (message.kind === 'system') return 'Private conversation opened';
    const content = message.body || (message.media?.kind === 'video' ? 'Video sent' : message.media ? 'Photo sent' : 'Message');
    return `${message.fromUserId === this.auth.viewerId ? 'You: ' : ''}${content}`.slice(0, 72);
  }

  postOf(id: string | null) {
    return id ? this.data.post(id) : null;
  }

  clear(input: HTMLInputElement): void {
    this.query.set('');
    input.value = '';
    input.focus();
  }

  open(id: string): void {
    void this.router.navigate(['/chats/thread', id]);
  }

  goAuth(): void { void this.router.navigate(['/auth']); }
  goHome(): void { void this.router.navigate(['/home']); }
  goDiscover(): void { void this.router.navigate(['/discover'], { queryParams: { tab: 'following' } }); }
}
