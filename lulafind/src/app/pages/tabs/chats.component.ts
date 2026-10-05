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
import { ChatMessage } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

@Component({
  selector: 'lf-chats',
  standalone: true,
  imports: [IonContent, TopNavComponent, IconComponent, AvatarComponent, EmptyComponent],
  template: `
    <lf-top-nav heading="Chats" />

    <ion-content class="lf-page lf-plain">
      <div class="gate-note">
        <lf-icon name="lock" [size]="16" />
        <span>You can message someone once <strong>you follow each other</strong>.</span>
      </div>

      @if (!auth.signedIn()) {
        <lf-empty icon="lock" title="Sign in to see your messages"
                  message="Chats are private and tied to your account." actionLabel="Sign in" (action)="goAuth()" />
      } @else if (!threads().length) {
        <lf-empty icon="chat" title="No conversations yet"
                  message="Follow someone on a case and you can message each other."
                  actionLabel="Browse the feed" (action)="goHome()" />
      } @else {
        <div class="list">
          @for (t of threads(); track t.id) {
            <button class="thread" (click)="open(t.id)">
              <lf-avatar [src]="avatarOf(t)" [name]="nameOf(t)" [size]="50" />
              <div class="grow">
                <div class="lf-row-between">
                  <strong>{{ nameOf(t) }}</strong>
                  <span class="lf-tiny lf-muted">{{ timeAgo(t.lastMessageAt) }}</span>
                </div>
                <div class="lf-row-between">
                  <span class="lf-small lf-muted lf-ellipsis">{{ preview(t.id) }}</span>
                  @if ((t.unread[me()] ?? 0) > 0) { <span class="lf-badge">{{ t.unread[me()] }}</span> }
                </div>
                @if (postOf(t.postId)) {
                  <span class="lf-chip lf-tiny"><lf-icon name="pin" [size]="11" /> {{ postOf(t.postId)!.title.slice(0, 34) }}</span>
                }
              </div>
            </button>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .gate-note { display: flex; gap: 8px; align-items: center; padding: 10px 16px; font-size: 13px; line-height: 1.35;
      color: var(--lf-muted); background: var(--lf-card); border-bottom: 1px solid var(--lf-line-soft); }
    .gate-note strong { color: var(--ion-text-color); font-weight: 600; }
    .list { display: flex; flex-direction: column; background: var(--lf-card); padding: 4px 0 24px; }
    .thread.lula { width: 100%; background: var(--lf-card); border-bottom: 1px solid var(--lf-line-soft); padding: 12px 16px; box-sizing: border-box; }
    .lula-badge { display: grid; place-items: center; width: 50px; height: 50px; border-radius: 50%; background: var(--lf-card-2); flex-shrink: 0; }
    .pin { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--lf-muted); }
    .thread { display: flex; gap: 12px; align-items: center; padding: 8px 16px; border: 0;
      background: transparent; color: inherit; text-align: left; cursor: pointer; font-family: inherit; }
    .thread:hover, .thread:active { background: var(--lf-hover); }
    .thread strong { font-size: 15px; font-weight: 600; }
    @media (min-width: 768px) { .list, .gate-note { max-width: var(--lf-maxw); margin: 0 auto; } }
    .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .lf-chip { align-self: flex-start; margin-top: 2px; }
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

  constructor() { void this.loadThreads(); }

  ionViewWillEnter(): void { void this.loadThreads(); }

  private async loadThreads(): Promise<void> {
    try {
      await this.chat.load();
      const entries = await Promise.all(this.chat.threads().map(async (thread) => [
        thread.id, await this.chat.latestMessage(thread.id)
      ] as const));
      this.previews.set(Object.fromEntries(entries));
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

  open(id: string): void {
    void this.router.navigate(['/chats/thread', id]);
  }


  goAuth(): void {
    void this.router.navigate(['/auth']);
  }

  goHome(): void {
    void this.router.navigate(['/home']);
  }
}
