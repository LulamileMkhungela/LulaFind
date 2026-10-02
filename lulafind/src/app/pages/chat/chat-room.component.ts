import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IonBackButton } from '@ionic/angular/ion-back-button';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ChatService } from '../../core/services/chat.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { MediaItem } from '../../core/models/types';
import { clockTime } from '../../core/utils/format';
import { MediaService } from '../../core/services/media.service';

import { KeyboardDirective } from '../../shared/keyboard.directive';

@Component({
  selector: 'lf-chat-room',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTextarea, RouterLink, IconComponent, AvatarComponent, KeyboardDirective],
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/chats" text=""></ion-back-button></ion-buttons>
        <div class="peer">
          <lf-avatar [src]="peerAvatar()" [name]="peerName()" [size]="34" />
          <div class="peer-copy">
            <strong>{{ peerName() }}</strong>
            <span class="lf-tiny lf-muted">{{ peerHandle() }}</span>
            @if (peerHeadline()) { <span class="peer-headline">{{ peerHeadline() }}</span> }
          </div>
        </div>
        <ion-buttons slot="end">
          <button class="lf-icon-btn" [routerLink]="'/user/' + peerId()"><lf-icon name="user" [size]="20" /></button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page lf-plain room">
      @if (post()) {
        <a class="casebar" [routerLink]="'/post/' + post()!.id">
          <lf-icon name="pin" [size]="16" />
          <span class="casebar-copy"><small>About this post</small><strong class="lf-ellipsis">{{ post()!.title }}</strong></span>
          <lf-icon name="chevronRight" [size]="16" />
        </a>
      }

      <div class="notice">
        <lf-icon name="lock" [size]="14" />
        Private chat - you follow each other. Never send money to a stranger.
      </div>

      <div class="thread-frame">
        <div class="msgs" aria-label="Conversation">
          @if (!chat.messages().length) {
            <div class="thread-empty"><span><lf-icon name="chat" [size]="22" /></span><strong>Start the conversation</strong><p>Messages stay private between you and {{ peerName() }}.</p></div>
          }
          @for (m of chat.messages(); track m.id; let i = $index) {
            @if (dayBoundary(i); as day) { <div class="day-divider"><span>{{ day }}</span></div> }
            @if (m.kind === 'system') {
              <div class="sys"><lf-icon name="lock" [size]="13" /><span>{{ m.body }}</span></div>
            } @else {
              <div class="msg" [class.mine]="m.fromUserId === me()" [class.continued]="!showMessageHeader(i)">
                @if (m.fromUserId !== me()) {
                  @if (showMessageHeader(i)) {
                    <lf-avatar [src]="peerAvatar()" [name]="peerName()" [size]="30" />
                  } @else { <span class="avatar-space" aria-hidden="true"></span> }
                }
                <div class="msg-stack">
                  @if (showMessageHeader(i)) {
                    <div class="msg-meta"><strong>{{ m.fromUserId === me() ? 'You' : peerName() }}</strong></div>
                  }
                  <div class="bubble">
                    @if (m.media?.kind === 'video') {
                      <video [src]="m.media!.src" controls playsinline preload="metadata" aria-label="Video sent in this chat"></video>
                    } @else if (m.media) {
                      <a [href]="m.media.src" target="_blank" rel="noopener"><img [src]="m.media.src" alt="Photo sent in this chat" loading="lazy" /></a>
                    }
                    @if (m.body) { <p>{{ m.body }}</p> }
                    <span class="msg-time">{{ clockTime(m.at) }}</span>
                  </div>
                </div>
              </div>
            }
          }
        </div>
      </div>
    </ion-content>

    @if (sendError()) { <p class="send-error" role="alert">{{ sendError() }}</p> }
    <div class="composer">
      @if (pending()) {
        <div class="pending">
          <img [src]="pending()!.src" alt="Photo ready to send" />
          <span>Photo ready to send</span>
          <button class="rm" (click)="clearPending()" aria-label="Remove photo"><lf-icon name="x" [size]="14" /></button>
        </div>
      }
      <div class="bar">
        <button type="button" class="ico" (click)="attach()" aria-label="Attach a photo"><lf-icon name="image" [size]="22" /></button>
        <button type="button" class="ico" (click)="attach(true)" aria-label="Take a photo"><lf-icon name="camera" [size]="22" /></button>
        <!--
          No custom emoji keypad: the phone keyboard already has emoji,
          autocorrect and word suggestions, and it is the one people know. These
          attributes ask for them explicitly - without them a webview can put up
          a bare keyboard with no suggestions and no emoji key at all.
        -->
        <ion-textarea lfKeyboard rows="1" autoGrow placeholder="Message…" [value]="draft"
                      inputmode="text" enterkeyhint="send"
                      autocorrect="on" autocomplete="on" autocapitalize="sentences" spellcheck="true"
                      aria-label="Message"
                      (ionInput)="draft = $any($event.target).value"
                      (keydown.enter)="$event.preventDefault(); send()"></ion-textarea>
        <button class="lf-icon-btn send" (click)="send()" [disabled]="chat.sending() || (!draft.trim() && !pending())">
          <lf-icon name="send" [size]="22" [filled]="true" />
        </button>
      </div>
    </div>
  `,
  styles: [`
    .peer { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .peer-copy { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
    .peer-copy > strong { max-width: 42vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .peer-headline { max-width: 50vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--lf-muted); font-size: 10px; }
    .room { --padding-bottom: 104px; }
    .casebar { display: flex; align-items: center; gap: 8px; margin: 10px var(--lf-gap); padding: 11px 13px;
      border-radius: 9px; border: 1px solid var(--lf-line-soft); background: var(--lf-card);
      color: inherit; text-decoration: none; font-size: 13px; font-weight: 600; }
    .casebar > :first-child { color: var(--lf-primary); }
    .casebar-copy { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
    .casebar-copy small { color: var(--lf-muted); font-size: 10px; font-weight: 500; }
    .casebar-copy strong { color: var(--ion-text-color); font-size: 13px; }
    .notice { display: flex; align-items: flex-start; gap: 8px; max-width: 690px; margin: 0 auto 8px; padding: 8px 14px;
      color: var(--lf-muted); font-size: 12px; line-height: 1.4; }
    .notice lf-icon { flex: none; color: var(--lf-primary); }
    .thread-frame { min-height: calc(100% - 48px); padding: 6px 0 20px; }
    .msgs { display: flex; flex-direction: column; gap: 7px; width: min(100%, 720px); box-sizing: border-box; margin: 0 auto; padding: 6px var(--lf-gap) 24px; }
    .thread-empty { display: flex; flex-direction: column; align-items: center; gap: 7px; margin: auto; padding: 35px 24px; color: var(--lf-muted); text-align: center; }
    .thread-empty > span { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--lf-primary-soft); color: var(--lf-primary); }
    .thread-empty strong { color: var(--ion-text-color); font-size: 15px; }
    .thread-empty p { margin: 0; font-size: 13px; }
    .day-divider { display: flex; align-items: center; gap: 10px; margin: 14px 0 6px; color: var(--lf-muted); font-size: 11px; font-weight: 600; }
    .day-divider::before, .day-divider::after { content: ''; height: 1px; flex: 1; background: var(--lf-line-soft); }
    .day-divider span { flex: none; }
    .sys { align-self: center; display: flex; align-items: center; gap: 6px; max-width: 88%; margin: 7px 0; padding: 7px 12px;
      border-radius: 8px; background: var(--lf-bg); color: var(--lf-muted); font-size: 11px; line-height: 1.35; text-align: center; }
    .sys lf-icon { flex: none; color: var(--lf-primary); }
    .msg { display: flex; gap: 7px; align-items: flex-end; max-width: min(86%, 560px); align-self: flex-start; }
    .msg.mine { align-self: flex-end; }
    .msg.continued { margin-top: -4px; }
    .avatar-space { flex: 0 0 30px; }
    .msg-stack { display: flex; flex-direction: column; gap: 3px; min-width: 0; max-width: 100%; }
    .msg.mine .msg-stack { align-items: flex-end; }
    .msg-meta { display: flex; align-items: baseline; gap: 7px; padding: 0 4px; color: var(--lf-muted); font-size: 11px; }
    .msg-meta strong { color: var(--ion-text-color); font-size: 12px; font-weight: 700; }
    .bubble { max-width: 100%; box-sizing: border-box; padding: 9px 12px 6px; border: 1px solid var(--lf-line-soft);
      border-radius: 12px 12px 12px 4px; background: var(--lf-card); color: var(--ion-text-color); box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    .msg.mine .bubble { border-color: color-mix(in srgb, var(--lf-primary) 22%, var(--lf-line-soft)); border-radius: 12px 12px 4px 12px;
      background: var(--lf-primary-soft); color: var(--ion-text-color); }
    .bubble p { margin: 0 0 3px; font-size: 15px; line-height: 1.38; white-space: pre-wrap; word-break: break-word; }
    .msg-time { display: block; color: var(--lf-muted); font-size: 10px; line-height: 1.2; text-align: right; }
    .bubble img, .bubble video { display: block; max-width: min(260px, 62vw); width: 100%; max-height: 320px; border-radius: 8px; margin-bottom: 5px; object-fit: contain; }
    .bar { display: flex; align-items: flex-end; gap: 8px; width: 100%; }
    .ico { flex: none; width: 36px; height: 36px; border: none; border-radius: 50%; cursor: pointer;
      background: transparent; color: var(--lf-primary); display: grid; place-items: center; }
    .ico:hover { background: var(--lf-hover); }
    .ico.on { background: var(--lf-primary-soft); }
    .em:active { background: var(--lf-card-2); }
    .pending { display: flex; align-items: center; gap: 9px; width: 100%; padding-bottom: 8px;
      border-bottom: 1px solid var(--lf-line); margin-bottom: 8px; }
    .pending img { width: 42px; height: 42px; object-fit: cover; border-radius: 9px; }
    .pending span { font-size: 12px; color: var(--lf-muted); flex: 1; }
    .pending .rm { flex: none; width: 26px; height: 26px; border: none; border-radius: 50%; cursor: pointer;
      background: var(--lf-card-2); color: var(--lf-muted); display: grid; place-items: center; }
    .send-error { position: fixed; z-index: 12; left: 12px; right: 12px; bottom: calc(66px + var(--keyboard-offset, 0px)); max-width: 680px; margin: 0 auto;
      padding: 8px 11px; border-radius: 7px; background: #ffebe9; color: #b42318; font-size: 12px; }
    .composer { position: fixed; left: 0; right: 0; bottom: var(--keyboard-offset, 0px); display: flex; flex-direction: column;
      padding: 10px 14px; padding-bottom: max(10px, var(--lf-safe-bottom, 0px));
      padding-left: max(14px, var(--lf-safe-left, 0px)); padding-right: max(14px, var(--lf-safe-right, 0px));
      padding-top: 8px;
      background: var(--lf-card);
      border-top: 1px solid var(--lf-line-soft); }
    .bar { align-items: center; gap: 4px; }
    .bar ion-textarea { flex: 1; --background: var(--lf-input); border-radius: 20px; --padding-start: 14px; --padding-end: 14px;
      --padding-top: 9px; --padding-bottom: 9px; min-height: 38px; font-size: 15px; margin: 0 4px; }
    .send { background: transparent; color: var(--lf-primary); width: 38px; height: 38px; }
    .send[disabled] { opacity: .4; }
  `]
})
export class ChatRoomComponent implements OnInit, OnDestroy {
  @ViewChild(IonContent) private content?: IonContent;

  protected chat = inject(ChatService);
  protected data = inject(DataService);
  private media = inject(MediaService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  protected readonly clockTime = clockTime;
  protected readonly sendError = signal('');
  draft = '';
  private timer: any;

  protected pending = signal<MediaItem | null>(null);

  readonly me = computed(() => this.auth.viewerId);
  readonly thread = computed(() => this.chat.threads().find((t) => t.id === this.route.snapshot.paramMap.get('threadId')));
  readonly peerId = computed(() => this.thread()?.participantIds.find((id) => id !== this.auth.viewerId) ?? '');
  readonly peer = computed(() => this.data.authorOf(this.peerId()));
  readonly peerName = computed(() => this.peer()?.displayName ?? 'LulaFind member');
  readonly peerHandle = computed(() => (this.peer() ? '@' + this.peer()!.handle : ''));
  readonly peerHeadline = computed(() => this.peer()?.bio ?? '');
  readonly peerAvatar = computed(() => this.data.avatarFor(this.peer()));
  readonly post = computed(() => {
    const id = this.thread()?.postId;
    return id ? this.data.post(id) ?? null : null;
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('threadId');
    if (!id) return;
    await this.chat.load();
    await this.chat.openThread(id);
    setTimeout(() => void this.scrollToLatest(true), 0);
    this.timer = setInterval(() => void this.refreshMessages(), 4000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    void this.chat.close();
  }

  private async refreshMessages(): Promise<void> {
    const previous = this.chat.messages().at(-1)?.id;
    await this.chat.refreshOpenThread().catch(() => undefined);
    if (previous !== this.chat.messages().at(-1)?.id) await this.scrollToLatest(false);
  }

  private async scrollToLatest(force: boolean): Promise<void> {
    if (!this.content) return;
    const el = await this.content.getScrollElement();
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
    if (force || nearBottom) await this.content.scrollToBottom(120);
  }

  /** Show one sender line for a run of messages, like a professional inbox thread. */
  showMessageHeader(index: number): boolean {
    const messages = this.chat.messages();
    const current = messages[index];
    const previous = messages[index - 1];
    return !previous || !current || previous.kind === 'system' || current.kind === 'system'
      || previous.fromUserId !== current.fromUserId || current.at - previous.at > 5 * 60_000;
  }

  /** A visible date divider keeps long conversations readable. */
  dayBoundary(index: number): string | null {
    const messages = this.chat.messages();
    const current = messages[index];
    const previous = messages[index - 1];
    if (!current) return null;
    const day = new Date(current.at);
    if (previous) {
      const before = new Date(previous.at);
      if (day.getFullYear() === before.getFullYear() && day.getMonth() === before.getMonth() && day.getDate() === before.getDate()) return null;
    }
    const today = new Date();
    if (day.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {})
    }).format(day);
  }

  /** Attach a photo from the gallery, or straight from the camera. */
  protected async attach(camera = false): Promise<void> {
    try {
      const m = await this.media.pickImage({ source: camera ? 'camera' : 'gallery', quality: 78 });
      if (m) this.pending.set({ ...m, src: await this.media.compress(m.src, 1200) });
    } catch {
      /* the picker was cancelled or blocked - nothing to send */
    }
  }

  protected clearPending(): void {
    this.pending.set(null);
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    const photo = this.pending();
    if (!text && !photo) return;
    this.sendError.set('');
    try {
      await this.chat.send(text, photo);
      this.draft = '';
      this.pending.set(null);
      await this.scrollToLatest(true);
    } catch (e) {
      this.draft = text;
      this.pending.set(photo);
      this.sendError.set(e instanceof Error ? e.message : 'Could not send. Your message is still here.');
    }
  }
}
