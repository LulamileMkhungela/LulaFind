import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { PostActionsService } from '../../core/services/post-actions.service';
import { Post, provinceName } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

/**
 * "Repost with your thoughts", laid out like LinkedIn's composer: who you are
 * and who can see it, an empty box asking what you want to talk about, and the
 * original post attached underneath.
 */
@Component({
  selector: 'lf-repost',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonButtons, IconComponent, AvatarComponent],
  template: `
    <ion-header [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="icon-btn" type="button" (click)="close()" aria-label="Close"><lf-icon name="x" [size]="22" /></button>
        </ion-buttons>
        <ion-buttons slot="end">
          <button class="post-btn" type="button" [disabled]="busy() || !original()" (click)="submit()">
            {{ busy() ? 'Posting…' : 'Post' }}
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      <main class="wrap">
        <div class="me">
          <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="48" />
          <div class="me__text">
            <strong>{{ myName() }}</strong>
            <span class="aud"><lf-icon name="globe" [size]="13" /> Post to anyone</span>
          </div>
        </div>

        <textarea class="thoughts" rows="5" maxlength="1500" placeholder="What do you want to talk about?"
                  [value]="text()" (input)="text.set($any($event.target).value)" aria-label="Your thoughts"></textarea>

        @if (error()) { <p class="err" role="alert"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }

        @if (original(); as o) {
          <div class="embed">
            <div class="embed__head">
              <lf-avatar [src]="originalAvatar()" [name]="originalName()" [size]="40" />
              <div>
                <strong>{{ originalName() }}</strong>
                <span>{{ timeAgo(o.createdAt) }} · {{ provinceName(o.province) }}</span>
              </div>
            </div>
            <h3>{{ o.title }}</h3>
            <p>{{ o.body }}</p>
            @if (o.media.length) { <img [src]="o.media[0].src" [alt]="o.title" /> }
          </div>
        } @else if (missing()) {
          <p class="err"><lf-icon name="info" [size]="15" /> That post is not available to repost.</p>
        }
      </main>
    </ion-content>
  `,
  styles: [`
    .icon-btn { width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--ion-text-color); }
    .post-btn { height: 32px; padding: 0 18px; margin-right: 8px; border: 0; border-radius: 16px; background: var(--lf-primary); color: #fff; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .post-btn:disabled { opacity: .5; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 14px 16px 40px; }
    .me { display: flex; align-items: center; gap: 12px; }
    .me__text { display: flex; flex-direction: column; gap: 2px; }
    .me__text strong { font-size: 16px; font-weight: 600; }
    .aud { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--lf-muted); }
    .thoughts { display: block; width: 100%; box-sizing: border-box; min-height: 120px; margin: 14px 0 12px; padding: 0; border: 0; outline: 0; resize: none;
      background: transparent; color: var(--ion-text-color); font: inherit; font-size: 18px; line-height: 1.4; }
    .thoughts::placeholder { color: var(--lf-muted); }
    .embed { padding: 12px; border: 1px solid var(--lf-line); border-radius: 8px; }
    .embed__head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .embed__head div { display: flex; flex-direction: column; }
    .embed__head strong { font-size: 15px; font-weight: 600; }
    .embed__head span { font-size: 12.5px; color: var(--lf-muted); }
    .embed h3 { margin: 0 0 4px; font-size: 16px; }
    .embed p { margin: 0; font-size: 14px; line-height: 1.38; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
    .embed img { display: block; width: calc(100% + 24px); margin: 10px -12px -12px; max-height: 260px; object-fit: cover; border-radius: 0 0 8px 8px; }
    .err { display: flex; align-items: center; gap: 6px; color: var(--lf-signal); font-size: 14px; }
  `]
})
export class RepostComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private data = inject(DataService);
  private auth = inject(AuthService);
  private actions = inject(PostActionsService);

  protected readonly timeAgo = timeAgo;
  protected readonly provinceName = provinceName;

  readonly original = signal<Post | null>(null);
  readonly missing = signal(false);
  readonly text = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  readonly myName = computed(() => this.auth.user()?.displayName ?? 'You');
  readonly myAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly originalName = computed(() => {
    const o = this.original();
    return o ? this.data.authorOf(o.authorId)?.displayName ?? 'LulaFind member' : '';
  });
  readonly originalAvatar = computed(() => {
    const o = this.original();
    return this.data.avatarFor(o ? this.data.authorOf(o.authorId) : null);
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const found = await this.data.loadPost(id);
    if (!found) { this.missing.set(true); return; }
    this.original.set(found.repostOf ? (await this.data.loadPost(found.repostOf)) ?? found : found);
  }

  close(): void {
    if (typeof window !== 'undefined' && window.history.length > 1) window.history.back();
    else void this.router.navigate(['/home']);
  }

  async submit(): Promise<void> {
    const o = this.original();
    if (!o || this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      const copy = await this.data.repost(o.id, this.text());
      await this.router.navigate(['/home'], { replaceUrl: true });
      await this.actions.toast('Repost successful', { text: 'View post', handler: () => void this.router.navigate(['/post', copy.id]) });
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Could not repost. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
