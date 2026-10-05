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
import { MediaImageComponent, MediaVideoComponent } from '../../shared/components/media-image.component';
import { UserHoverDirective } from '../../shared/components/user-hover-card.component';
import { ReactionIconComponent } from '../../shared/components/reaction-icon.component';
import { ChatService } from '../../core/services/chat.service';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatMessage, MediaItem, REACTIONS, ReactionKind } from '../../core/models/types';
import { clockTime } from '../../core/utils/format';
import { MediaService } from '../../core/services/media.service';

import { KeyboardDirective } from '../../shared/keyboard.directive';

@Component({
  selector: 'lf-chat-room',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonButtons, IonBackButton, IonTextarea, RouterLink, IconComponent, AvatarComponent, KeyboardDirective, MediaImageComponent, MediaVideoComponent, ReactionIconComponent, UserHoverDirective],
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
          <button class="lf-icon-btn" (click)="toggleSearch()" [attr.aria-pressed]="searchOpen()"
                  [attr.aria-label]="searchOpen() ? 'Close search' : 'Search in this conversation'">
            <lf-icon [name]="searchOpen() ? 'x' : 'search'" [size]="20" />
          </button>
          <button class="lf-icon-btn" [routerLink]="'/user/' + peerId()" [lfUserHover]="peerId()" aria-label="Open profile"><lf-icon name="user" [size]="20" /></button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    @if (searchOpen()) {
      <div class="find">
        <lf-icon name="search" [size]="15" />
        <input #q type="search" [value]="query()" (input)="setQuery(q.value)" (keydown.escape)="closeSearch()"
               placeholder="Search in this conversation" aria-label="Search in this conversation" />
        @if (query()) { <span class="hits">{{ shown().length }}</span> }
      </div>
    }

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
          @for (m of shown(); track m.id; let i = $index) {
            @if (dayBoundary(i); as day) { <div class="day-divider"><span>{{ day }}</span></div> }
            @if (m.kind === 'system') {
              <div class="sys"><lf-icon name="lock" [size]="13" /><span>{{ m.body }}</span></div>
            } @else {
              <div class="msg" [class.mine]="m.fromUserId === me()" [class.continued]="!showMessageHeader(i)"
                   [class.open]="openActs() === m.id">
                @if (m.fromUserId !== me()) {
                  @if (showMessageHeader(i)) {
                    <lf-avatar [src]="peerAvatar()" [name]="peerName()" [size]="30" />
                  } @else { <span class="avatar-space" aria-hidden="true"></span> }
                }
                <div class="msg-stack">
                  @if (showMessageHeader(i)) {
                    <div class="msg-meta"><strong>{{ m.fromUserId === me() ? 'You' : peerName() }}</strong></div>
                  }
                  @if (m.unsent) {
                    <!-- Unsend leaves the gap on both sides, the way LinkedIn does. -->
                    <div class="bubble bubble--gone"><p><lf-icon name="lock" [size]="13" /> {{ unsentLabel(m) }}</p></div>
                  } @else {
                    <div class="bubble">
                      @if (m.media?.kind === 'video') {
                        <lf-media-video [src]="m.media!.src" label="Video sent in this chat" />
                      } @else if (m.media) {
                        <lf-media-img [src]="m.media.src" alt="Photo sent in this chat" />
                      }
                      @if (m.body) { <p>{{ m.body }}</p> }
                      <span class="msg-time">{{ clockTime(m.at) }}@if (m.editedAt) { · Edited }</span>
                    </div>
                    @for (f of facesOn(m); track f.key) {
                      <button type="button" class="face" [class.mine]="f.mine" (click)="react(m, f.key)"
                              [attr.aria-label]="(f.mine ? 'Remove your ' : 'React ') + f.label">
                        <lf-reaction-icon [kind]="f.key" [size]="16" /><span>{{ f.count }}</span>
                      </button>
                    }
                    <div class="acts">
                      @for (r of REACTIONS; track r.key) {
                        <button type="button" class="act" [attr.aria-pressed]="myFace(m) === r.key" (click)="react(m, r.key)"
                                [attr.aria-label]="(myFace(m) === r.key ? 'Remove your ' : 'React ') + r.label">
                          <lf-reaction-icon [kind]="r.key" [size]="18" />
                        </button>
                      }
                      @if (canManage(m)) {
                        <button type="button" class="act txt" (click)="startEdit(m)"><lf-icon name="edit" [size]="13" /> Edit</button>
                        <button type="button" class="act txt" (click)="unsend(m)"><lf-icon name="trash" [size]="13" /> Unsend</button>
                      }
                      @if (m.body) {
                        <button type="button" class="act txt" (click)="copy(m)">
                          <lf-icon name="copy" [size]="13" /> {{ copied() === m.id ? 'Copied' : 'Copy' }}
                        </button>
                      }
                    </div>
                    @if (m.fromUserId === me() && isLastMine(m)) { <div class="status">{{ tick(m) }}</div> }
                  }
                </div>
                <button type="button" class="more" (click)="toggleActs(m)"
                        [attr.aria-label]="'Actions for this message'"><lf-icon name="more" [size]="16" /></button>
              </div>
            }
          }
          @if (query() && !shown().length && chat.messages().length) {
            <p class="no-hits">Nothing in this conversation says “{{ query() }}”.</p>
          }
          @if (chat.typingPeer()) {
            <div class="typing" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{{ peerName() }} is typing</div>
          }
        </div>
      </div>
    </ion-content>

    @if (sendError()) { <p class="send-error" role="alert">{{ sendError() }}</p> }
    @if (edit(); as m) {
      <div class="editbar">
        <label for="lf-edit-body" class="lf-tiny lf-muted">Editing your message</label>
        <textarea id="lf-edit-body" rows="2" [value]="editText()" (input)="editText.set($any($event.target).value)"
                  (keydown.escape)="cancelEdit()"></textarea>
        <div class="editbar-acts">
          <button type="button" class="cancel" (click)="cancelEdit()">Cancel</button>
          <button type="button" class="go" [disabled]="!editText().trim()" (click)="saveEdit()">Save</button>
        </div>
      </div>
    } @else {
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
                      (ionInput)="onType($any($event.target).value)"
                      (keydown.enter)="$event.preventDefault(); send()"></ion-textarea>
        <button class="lf-icon-btn send" (click)="send()" [disabled]="chat.sending() || (!draft.trim() && !pending())">
          <lf-icon name="send" [size]="22" [filled]="true" />
        </button>
      </div>
    </div>
    }
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
    .find { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--lf-line);
      background: var(--lf-card); color: var(--lf-muted); }
    .find input { flex: 1; min-width: 0; border: none; background: none; color: var(--ion-text-color); font: inherit;
      font-size: 14px; outline: none; padding: 4px 0; }
    .find .hits { font-size: 11px; font-weight: 600; color: var(--lf-primary); }
    .no-hits { margin: 10px 0; font-size: 13px; color: var(--lf-muted); text-align: center; }
    .typing { display: flex; align-items: center; gap: 7px; margin-top: 4px; font-size: 12px; color: var(--lf-muted); }
    .typing .dots { display: inline-flex; gap: 3px; }
    .typing .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--lf-muted); opacity: .35;
      animation: lf-typing 1.1s infinite; }
    .typing .dots i:nth-child(2) { animation-delay: .18s; }
    .typing .dots i:nth-child(3) { animation-delay: .36s; }
    @keyframes lf-typing { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }
    .face { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; margin-top: 1px; padding: 2px 7px 2px 4px;
      border: 1px solid var(--lf-line-soft); border-radius: 999px; background: var(--lf-card); color: var(--lf-muted);
      font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
    .msg.mine .face { align-self: flex-end; }
    .face.mine { border-color: var(--lf-primary); color: var(--lf-primary); background: var(--lf-primary-soft); }
    .acts { display: flex; align-items: center; gap: 2px; margin-top: 1px; opacity: 0; transition: opacity .12s ease; }
    .msg.mine .acts { justify-content: flex-end; }
    .msg:hover .acts, .msg:focus-within .acts, .msg.open .acts { opacity: 1; }
    .act { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border: none; border-radius: 999px;
      background: none; color: var(--lf-muted); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
    .act:hover { background: var(--lf-hover); color: var(--lf-primary); }
    .act[aria-pressed="true"] { background: var(--lf-primary-soft); color: var(--lf-primary); }
    .status { font-size: 10px; color: var(--lf-muted); padding: 0 4px; }
    .bubble--gone p { display: flex; align-items: center; gap: 6px; color: var(--lf-muted); font-style: italic; }
    .more { flex: none; align-self: center; width: 26px; height: 26px; border: none; border-radius: 50%; cursor: pointer;
      background: none; color: var(--lf-muted); display: none; place-items: center; }
    @media (hover: none) { .acts { opacity: 0; } .msg.open .acts { opacity: 1; } .more { display: grid; } }
    .editbar { position: fixed; left: 0; right: 0; bottom: var(--keyboard-offset, 0px); display: flex; flex-direction: column;
      gap: 6px; padding: 10px 14px; padding-bottom: max(10px, var(--lf-safe-bottom, 0px)); background: var(--lf-card);
      border-top: 1px solid var(--lf-line-soft); }
    .editbar textarea { box-sizing: border-box; width: 100%; padding: 9px 12px; border: 1px solid var(--lf-line);
      border-radius: 10px; background: var(--lf-input); color: var(--ion-text-color); font: inherit; font-size: 15px; resize: none; }
    .editbar-acts { display: flex; justify-content: flex-end; gap: 8px; }
    .editbar-acts button { border: none; border-radius: 999px; padding: 7px 16px; font: inherit; font-size: 13px;
      font-weight: 600; cursor: pointer; background: none; color: var(--lf-muted); }
    .editbar-acts .go { background: var(--lf-primary-fill); color: var(--lf-primary-text); }
    .editbar-acts .go[disabled] { opacity: .5; cursor: default; }
    @media (prefers-reduced-motion: reduce) { .typing .dots i { animation: none; opacity: .6; } .acts { transition: none; } }
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

  /**
   * In-thread search, LinkedIn's magnifier. Filtering the list rather than
   * stepping through hits keeps the day dividers honest: what you see is only
   * what matches.
   */
  public searchOpen = signal(false);
  public query = signal('');
  /** The message whose action row is open. Touch has no hover, so it needs a tap. */
  public openActs = signal('');
  /** A message being edited in place, and the text in the box. */
  public edit = signal<ChatMessage | null>(null);
  public editText = signal('');
  /** Which message was just copied, so the button can say so for a moment. */
  public copied = signal('');

  /** The reaction faces offered on a message: the same set a post gets. */
  protected readonly REACTIONS = REACTIONS;

  /**
   * What the thread shows. A search narrows it; otherwise every message, unsent
   * ones included - the gap is the point of unsending, and hiding the row would
   * leave the other person wondering.
   */
  readonly shown = computed(() => {
    const list = this.chat.messages();
    const q = this.query().trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => !m.unsent && (m.body || '').toLowerCase().includes(q));
  });

  /** The four faces and who gave them, in the order the tray lists them. */
  public facesOn(m: ChatMessage): { key: ReactionKind; label: string; count: number; mine: boolean }[] {
    const me = this.me() ?? '';
    const given = new Map<ReactionKind, number>();
    for (const k of Object.values(m.reactions ?? {})) {
      if (REACTIONS.some((r) => r.key === k)) given.set(k, (given.get(k) ?? 0) + 1);
    }
    return REACTIONS.filter((r) => given.has(r.key)).map((r) => ({
      key: r.key, label: r.label, count: given.get(r.key) ?? 0, mine: (m.reactions ?? {})[me] === r.key
    }));
  }

  public myFace(m: ChatMessage): ReactionKind | null {
    return (m.reactions ?? {})[this.me() ?? ''] ?? null;
  }

  /** Tapping a face you already gave takes it back, like the post tray. */
  public async react(m: ChatMessage, key: ReactionKind): Promise<void> {
    await this.chat.reactMessage(m.id, this.myFace(m) === key ? null : key);
    this.openActs.set('');
  }

  public toggleActs(m: ChatMessage): void {
    this.openActs.set(this.openActs() === m.id ? '' : m.id);
  }

  /** Only your own, only a message that still has words, never a system note. */
  public canManage(m: ChatMessage): boolean {
    return m.fromUserId === this.me() && m.kind === 'text' && !m.unsent;
  }

  public startEdit(m: ChatMessage): void {
    this.edit.set(m);
    this.editText.set(m.body);
    this.openActs.set('');
  }

  public cancelEdit(): void {
    this.edit.set(null);
    this.editText.set('');
  }

  public async saveEdit(): Promise<void> {
    const m = this.edit();
    const body = this.editText().trim();
    if (!m || !body) return;
    if (await this.chat.editMessage(m.id, body)) this.cancelEdit();
    else {
      this.sendError.set('That message could not be changed. It may have been unsent, or saved somewhere else first.');
      this.cancelEdit();
    }
  }

  /**
   * One tap, no dialog. LinkedIn's unsend is immediate and says so in the gap it
   * leaves; a confirmation here would only hide what happened.
   */
  public async unsend(m: ChatMessage): Promise<void> {
    if (this.edit()?.id === m.id) this.cancelEdit();
    await this.chat.unsendMessage(m.id);
    this.openActs.set('');
  }

  public unsentLabel(m: ChatMessage): string {
    return m.fromUserId === this.me() ? 'You unsent a message' : this.peerName() + ' unsent a message';
  }

  /**
   * The read marker a thread carries is a flag, not a timestamp, so the line says
   * Seen and not Seen at 14:32 - a time we do not have would be a made-up one.
   */
  public tick(m: ChatMessage): string {
    return m.read ? 'Seen' : 'Delivered';
  }

  /** The tick belongs under the last thing you sent, not under all of them. */
  readonly lastMine = computed(() => {
    const me = this.me();
    return [...this.chat.messages()].reverse().find((m) => m.fromUserId === me && m.kind !== 'system')?.id ?? '';
  });

  public isLastMine(m: ChatMessage): boolean {
    return m.id === this.lastMine() && !m.unsent;
  }

  public async copy(m: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard?.writeText(m.body);
      this.copied.set(m.id);
      setTimeout(() => { if (this.copied() === m.id) this.copied.set(''); }, 1600);
    } catch {
      this.sendError.set('Your browser would not let LulaFind copy that. Long-press the message instead.');
    }
    this.openActs.set('');
  }

  public toggleSearch(): void {
    const next = !this.searchOpen();
    this.searchOpen.set(next);
    if (!next) this.query.set('');
  }

  public closeSearch(): void {
    this.searchOpen.set(false);
    this.query.set('');
  }

  public setQuery(value: string): void {
    this.query.set(value);
  }

  /** Every keystroke leaves a marker for the other side, at most one every 2s. */
  public onType(value: string): void {
    this.draft = value;
    this.chat.noteTyping();
  }

  readonly me = computed(() => this.auth.viewerId);
  readonly thread = computed(() => this.chat.threads().find((t) => t.id === this.route.snapshot.paramMap.get('threadId')));
  readonly peerId = computed(() => this.thread()?.participantIds.find((id) => id !== this.auth.viewerId) ?? '');
  readonly peer = computed(() => this.data.authorOf(this.peerId()));
  readonly peerName = computed(() => this.peer()?.displayName ?? 'Member');
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
    // A marker left behind would keep saying "typing" to the other person.
    this.chat.stopTyping();
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
    const messages = this.shown();
    const current = messages[index];
    const previous = messages[index - 1];
    return !previous || !current || previous.kind === 'system' || current.kind === 'system'
      || previous.fromUserId !== current.fromUserId || current.at - previous.at > 5 * 60_000;
  }

  /** A visible date divider keeps long conversations readable. */
  dayBoundary(index: number): string | null {
    const messages = this.shown();
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
