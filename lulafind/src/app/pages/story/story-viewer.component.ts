import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { Story } from '../../core/models/types';
import { countdown, timeAgo } from '../../core/utils/format';
import { storyBg } from '../../core/data/seed';

@Component({
  selector: 'lf-story-viewer',
  standalone: true,
  imports: [IconComponent, AvatarComponent],
  template: `
    <div class="viewer" [style.background]="bg()">
      <div class="bars">
        @for (s of rail(); track s.id) {
          <div class="bar" [class.active]="s.id === id()" [class.done]="indexOf(s.id) < currentIndex()">
            <span [style.width.%]="s.id === id() ? pct() : indexOf(s.id) < currentIndex() ? 100 : 0"></span>
          </div>
        }
      </div>

      <header>
        <lf-avatar [src]="avatar()" [name]="authorName()" [size]="36" />
        <div class="lf-grow">
          <strong>{{ authorName() }}</strong>
          <span class="lf-tiny lf-muted">{{ timeAgo(story()?.createdAt) }} · {{ countdown(remaining()) }}</span>
        </div>
        @if (story()?.authorId === me()) {
          <button class="lf-icon-btn" (click)="del()"><lf-icon name="trash" [size]="18" /></button>
        }
        <button class="lf-icon-btn" (click)="close()"><lf-icon name="x" [size]="22" /></button>
      </header>

      @if (!story()) {
        <p class="lf-small" style="padding:24px">This story has ended. Stories disappear 24 hours after they are posted.</p>
      } @else {
        <main (click)="advance()">
          @if (story()!.media.length) {
            <img [src]="story()!.media[0].src" class="shot" alt="" />
          }
          <div class="text">{{ story()!.text }}</div>
        </main>

        <div class="replies">
          @for (r of story()!.replies; track r.id) {
            <div class="reply">
              <lf-avatar [src]="data.avatarFor(data.authorOf(r.authorId))" [name]="data.authorOf(r.authorId)?.displayName ?? ''" [size]="24" />
              <span>{{ data.authorOf(r.authorId)?.displayName }}: {{ r.body }}</span>
            </div>
          }
          <p class="lf-tiny lf-muted">{{ story()!.viewers.length }} viewed</p>
        </div>

        <footer>
          <input #box placeholder="Reply to {{ authorName() }}…" (keydown.enter)="reply(box.value); box.value = ''" />
          <button class="lf-icon-btn send" (click)="reply(box.value); box.value = ''"><lf-icon name="send" [size]="18" /></button>
        </footer>
      }
    </div>
  `,
  styles: [`
    .viewer { position: fixed; inset: 0; display: flex; flex-direction: column; z-index: 200;
      background-size: cover; background-position: center; }
    .bars { display: flex; gap: 4px; padding: 12px 12px 0; }
    .bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,.28); overflow: hidden; }
    .bar span { display: block; height: 100%; background: #fff; transition: width .3s linear; }
    header { display: flex; align-items: center; gap: 10px; padding: 10px 8px; color: #fff; }
    header div { display: flex; flex-direction: column; line-height: 1.25; }
    header .lf-muted { color: rgba(255,255,255,.75); }
    main { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; cursor: pointer; }
    .shot { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }
    .text { position: relative; z-index: 2; padding: 30px 26px; font-size: 22px; font-weight: 800; line-height: 1.35;
      color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,.55); text-align: center; }
    .replies { padding: 0 16px 8px; display: flex; flex-direction: column; gap: 6px; max-height: 26vh; overflow: auto; }
    .reply { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #fff;
      background: rgba(0,0,0,.35); padding: 6px 10px; border-radius: 999px; align-self: flex-start; }
    .lf-muted { color: rgba(255,255,255,.7); }
    footer { display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      padding-bottom: calc(max(10px, var(--lf-safe-bottom, 0px)) + var(--keyboard-offset, 0px)); }
    footer input { flex: 1; min-height: 44px; border-radius: 999px; border: 1px solid rgba(255,255,255,.3);
      background: rgba(0,0,0,.3); color: #fff; padding: 0 16px; font-size: 14px; outline: none; }
    footer input::placeholder { color: rgba(255,255,255,.6); }
    .send { color: #fff; }
  `]
})
export class StoryViewerComponent implements OnInit, OnDestroy {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected readonly timeAgo = timeAgo;
  protected readonly countdown = countdown;

  id = signal('');
  pct = signal(0);
  private timer: any;

  readonly me = computed(() => this.auth.viewerId);
  readonly rail = computed(() => this.data.visibleStories());
  readonly story = computed(() => this.rail().find((s) => s.id === this.id()) ?? null);
  readonly authorName = computed(() => this.data.authorOf(this.story()?.authorId ?? '')?.displayName ?? 'Member');
  readonly avatar = computed(() => this.data.avatarFor(this.data.authorOf(this.story()?.authorId ?? '')));
  readonly bg = computed(() => storyBg(this.story()?.bgHue ?? 220));

  ngOnInit(): void {
    this.id.set(this.route.snapshot.paramMap.get('id') ?? '');
    void this.data.markStorySeen(this.id());
    this.start();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private start(): void {
    clearInterval(this.timer);
    this.pct.set(0);
    let n = 0;
    this.timer = setInterval(() => {
      n += 2;
      this.pct.set(Math.min(100, n));
      if (n >= 100) this.advance();
    }, 100);
  }

  indexOf(id: string): number {
    return this.rail().findIndex((s) => s.id === id);
  }

  currentIndex(): number {
    return this.indexOf(this.id());
  }

  remaining(): number {
    return Math.max(0, (this.story()?.expiresAt ?? Date.now()) - Date.now());
  }

  advance(): void {
    const next = this.rail()[this.currentIndex() + 1];
    if (next) {
      this.id.set(next.id);
      void this.data.markStorySeen(next.id);
      this.start();
    } else {
      this.close();
    }
  }

  async reply(body: string): Promise<void> {
    const text = body.trim();
    if (!text) return;
    await this.data.replyToStory(this.id(), text);
  }

  async del(): Promise<void> {
    await this.data.deleteStory(this.id());
    this.close();
  }

  close(): void {
    void this.router.navigate(['/home']);
  }
}
