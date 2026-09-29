import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { AssistantService, AssistantAnswer } from '../../core/services/assistant.service';
import { DataService } from '../../core/services/data.service';
import { POST_TYPE_META, Post, Spotlight, UserProfile, provinceName } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

interface ChatMsg {
  id: number;
  role: 'user' | 'bot';
  text: string;
  answer?: AssistantAnswer;
}

let nextId = 1;

/**
 * Lula — floating assistant.
 *
 * A round button pinned above the tab bar on every screen. Tap it, type a
 * name (or anything), and Lula pulls every matching post, profile and
 * Spotlight community, then explains what it found in plain words.
 */
@Component({
  selector: 'lf-assistant',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent],
  template: `
    @if (visible()) {
      @if (open()) {
        <div class="lf-assistant__scrim" (click)="close()"></div>
        <section class="lf-assistant__panel" role="dialog" aria-label="Lula assistant">
          <header class="lf-assistant__head">
            <span class="lf-assistant__bot"><lf-icon name="sparkle" [size]="18" /></span>
            <div class="lf-assistant__title">
              <strong>Lula</strong>
              <span><i class="dot"></i>Online · answers from your LulaFind data</span>
            </div>
            <button class="lf-assistant__x" type="button" (click)="close()" aria-label="Close assistant">
              <lf-icon name="x" [size]="18" />
            </button>
          </header>

          <div class="lf-assistant__msgs" #scrollBox>
            @for (m of messages(); track m.id) {
              @if (m.role === 'user') {
                <p class="bubble bubble--user">{{ m.text }}</p>
              } @else {
                <div class="bubble bubble--bot">
                  <p>{{ m.text }}</p>
                  @if (m.answer; as a) {
                    @if (a.posts.length) {
                      <div class="res-label">Posts</div>
                      @for (p of a.posts; track p.id) {
                        <a class="res" [routerLink]="'/post/' + p.id" (click)="close()">
                          @if (p.media[0]?.src) {
                            <img class="res__thumb" [src]="p.media[0].src" alt="" loading="lazy" />
                          } @else {
                            <span class="res__thumb res__thumb--icon"><lf-icon [name]="typeIcon(p)" [size]="16" /></span>
                          }
                          <span class="res__txt">
                            <strong>{{ postTitle(p) }}</strong>
                            <small>{{ typeLabel(p) }} · {{ townOf(p) }} · {{ timeAgo(p.updatedAt) }} · {{ statusOf(p) }}</small>
                          </span>
                          <lf-icon name="chevronRight" [size]="16" />
                        </a>
                      }
                    }
                    @if (a.users.length) {
                      <div class="res-label">People</div>
                      @for (u of a.users; track u.id) {
                        <a class="res" [routerLink]="'/user/' + u.id" (click)="close()">
                          <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="38" />
                          <span class="res__txt">
                            <strong>{{ u.displayName }}</strong>
                            <small>&#64;{{ u.handle }}@if (u.town) { · {{ u.town }} }</small>
                          </span>
                          <lf-icon name="chevronRight" [size]="16" />
                        </a>
                      }
                    }
                    @if (a.spotlights.length) {
                      <div class="res-label">Spotlight communities</div>
                      @for (s of a.spotlights; track s.id) {
                        <a class="res" [routerLink]="'/spotlight/' + s.id" (click)="close()">
                          <span class="res__thumb res__thumb--icon"><lf-icon name="users" [size]="16" /></span>
                          <span class="res__txt">
                            <strong>{{ s.surname }}</strong>
                            <small>{{ s.followers }} members</small>
                          </span>
                          <lf-icon name="chevronRight" [size]="16" />
                        </a>
                      }
                    }
                    @if (a.suggestions.length) {
                      <div class="chips">
                        @for (s of a.suggestions; track s) {
                          <button type="button" (click)="ask(s)">{{ s }}</button>
                        }
                      </div>
                    }
                  }
                </div>
              }
            }
            @if (busy()) {
              <div class="bubble bubble--bot typing" aria-label="Lula is typing">
                <span></span><span></span><span></span>
              </div>
            }
          </div>

          <form class="lf-assistant__input" (submit)="send($event)">
            <input
              [value]="draft()"
              (input)="draft.set($any($event.target).value)"
              placeholder="Type a name, town, case number…"
              aria-label="Ask Lula"
              autocomplete="off" />
            <button type="submit" [disabled]="busy() || !draft().trim()" aria-label="Send">
              <lf-icon name="send" [size]="18" />
            </button>
          </form>
        </section>
      } @else {
        <button class="lf-assistant__fab" type="button" (click)="toggle()" aria-label="Ask Lula, your LulaFind helper">
          <lf-icon name="sparkle" [size]="24" />
          <span class="lf-assistant__fab-txt">Ask Lula</span>
        </button>
      }
    }
  `,
  styles: [`
    :host { display: contents; }
    .lf-assistant__fab {
      position: fixed;
      right: 16px;
      bottom: calc(var(--lf-tabbar-h) + var(--lf-safe-bottom) + 18px);
      z-index: 90;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 52px;
      padding: 0 18px 0 14px;
      border: 0;
      border-radius: 999px;
      background: var(--lf-primary);
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: var(--lf-shadow-lg);
    }
    .lf-assistant__fab:active { transform: scale(.96); }
    .lf-assistant__scrim {
      position: fixed;
      inset: 0;
      z-index: 94;
      background: var(--lf-scrim);
    }
    .lf-assistant__panel {
      position: fixed;
      z-index: 95;
      right: 12px;
      left: 12px;
      bottom: calc(var(--lf-tabbar-h) + var(--lf-safe-bottom) + 12px);
      display: flex;
      flex-direction: column;
      height: min(560px, calc(100dvh - var(--lf-tabbar-h) - 140px));
      min-height: 380px;
      background: var(--lf-card);
      border-radius: 18px;
      box-shadow: var(--lf-shadow-lg);
      overflow: hidden;
    }
    @media (min-width: 700px) {
      .lf-assistant__panel { left: auto; width: 400px; right: 24px; }
      .lf-assistant__fab { right: 24px; }
    }
    .lf-assistant__head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 12px 12px 14px;
      background: var(--lf-primary);
      color: #fff;
      flex-shrink: 0;
    }
    .lf-assistant__bot {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: rgba(255,255,255,.22);
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .lf-assistant__title { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .lf-assistant__title strong { font-size: 16px; }
    .lf-assistant__title span { font-size: 12px; opacity: .9; display: flex; align-items: center; gap: 5px; }
    .lf-assistant__title .dot { width: 7px; height: 7px; border-radius: 50%; background: #31a24c; box-shadow: 0 0 0 2px #fff; }
    .lf-assistant__x {
      width: 36px; height: 36px;
      border: 0; border-radius: 50%;
      background: rgba(255,255,255,.18);
      color: #fff; cursor: pointer;
      display: grid; place-items: center;
    }
    .lf-assistant__msgs {
      flex: 1;
      overflow-y: auto;
      padding: 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: var(--lf-bg);
    }
    .bubble { margin: 0; max-width: 88%; padding: 10px 13px; border-radius: 16px; font-size: 14px; line-height: 1.42; }
    .bubble--user { align-self: flex-end; background: var(--lf-primary); color: #fff; border-bottom-right-radius: 6px; }
    .bubble--bot { align-self: flex-start; background: var(--lf-card); color: var(--ion-text-color); border-bottom-left-radius: 6px; box-shadow: var(--lf-shadow); max-width: 94%; }
    .bubble--bot > p { margin: 0 0 4px; }
    .bubble--bot > p:last-child { margin-bottom: 0; }
    .typing { display: inline-flex; gap: 5px; padding: 14px 16px; }
    .typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--lf-muted); animation: pulse 1.1s infinite; }
    .typing span:nth-child(2) { animation-delay: .18s; }
    .typing span:nth-child(3) { animation-delay: .36s; }
    @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    .res-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; color: var(--lf-muted); margin: 10px 0 6px; }
    .res {
      display: flex; align-items: center; gap: 9px;
      padding: 7px 8px 7px 7px;
      border-radius: 12px;
      background: var(--lf-card-2);
      color: inherit;
      text-decoration: none;
      margin-bottom: 6px;
    }
    .res:active { filter: brightness(.94); }
    .res__thumb { width: 38px; height: 38px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
    .res__thumb--icon { display: grid; place-items: center; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .res__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .res__txt strong { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .res__txt small { font-size: 12px; color: var(--lf-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .chips button {
      border: 1px solid var(--lf-primary);
      background: transparent;
      color: var(--lf-link);
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 700;
      border-radius: 999px;
      padding: 6px 11px;
      cursor: pointer;
    }
    .lf-assistant__input {
      display: flex;
      gap: 8px;
      padding: 10px 12px calc(12px + var(--lf-safe-bottom));
      background: var(--lf-card);
      border-top: 1px solid var(--lf-line-soft);
      flex-shrink: 0;
    }
    .lf-assistant__input input {
      flex: 1;
      min-width: 0;
      height: 44px;
      border: 0;
      border-radius: 999px;
      background: var(--lf-input);
      color: var(--ion-text-color);
      font-family: inherit;
      font-size: 15px;
      padding: 0 16px;
      outline: none;
    }
    .lf-assistant__input input:focus { box-shadow: 0 0 0 2px var(--lf-primary); }
    .lf-assistant__input button {
      width: 44px; height: 44px;
      border: 0; border-radius: 50%;
      background: var(--lf-primary);
      color: #fff; cursor: pointer;
      display: grid; place-items: center;
      flex-shrink: 0;
    }
    .lf-assistant__input button:disabled { opacity: .45; }
  `]
})
export class AssistantComponent {
  private bot = inject(AssistantService);
  protected data = inject(DataService);
  private router = inject(Router);

  protected readonly timeAgo = timeAgo;

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly draft = signal('');
  readonly messages = signal<ChatMsg[]>([]);
  private greeted = false;

  /** Hidden on sign-in, onboarding and the fullscreen story viewer. */
  private readonly hidden = signal(false);
  readonly visible = computed(() => !this.hidden());

  constructor() {
    const sync = (url: string): void => {
      const hide = url.startsWith('/auth') || url.startsWith('/onboarding') || url.startsWith('/story/');
      this.hidden.set(hide);
      if (hide) this.open.set(false);
    };
    sync(this.router.url);
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => sync(e.urlAfterRedirects));
    // Keep the newest message in view.
    effect(() => {
      this.messages();
      this.busy();
      setTimeout(() => {
        document.querySelector('.lf-assistant__msgs')?.scrollTo({
          top: 999999, behavior: 'smooth'
        });
      }, 60);
    });
  }

  toggle(): void {
    this.open.set(!this.open());
    if (this.open() && !this.greeted) {
      this.greeted = true;
      const g = this.bot.greeting();
      this.messages.set([{ id: nextId++, role: 'bot', text: g.text, answer: g }]);
    }
  }

  close(): void {
    this.open.set(false);
  }

  send(e: Event): void {
    e.preventDefault();
    const text = this.draft().trim();
    if (!text || this.busy()) return;
    this.draft.set('');
    void this.askRun(text);
  }

  ask(text: string): void {
    if (this.busy()) return;
    void this.askRun(text);
  }

  private async askRun(text: string): Promise<void> {
    this.messages.update((all) => [...all, { id: nextId++, role: 'user', text }]);
    this.busy.set(true);
    try {
      const answer = await this.bot.ask(text);
      this.messages.update((all) => [...all, { id: nextId++, role: 'bot', text: answer.text, answer }]);
    } catch {
      this.messages.update((all) => [...all, {
        id: nextId++, role: 'bot',
        text: 'Something went wrong on my side. Try again, or use Search from the bottom bar.'
      }]);
    } finally {
      this.busy.set(false);
    }
  }

  postTitle(p: Post): string {
    return p.subject?.name?.trim() || p.title;
  }

  typeLabel(p: Post): string {
    return POST_TYPE_META[p.type]?.label ?? 'Post';
  }

  typeIcon(p: Post): string {
    return POST_TYPE_META[p.type]?.icon ?? 'book';
  }

  townOf(p: Post): string {
    return p.town || provinceName(p.province);
  }

  statusOf(p: Post): string {
    if (p.status === 'found') return 'Found';
    if (p.status === 'not_going_home') return 'Answered';
    return `${p.upvotes} ideas`;
  }
}
