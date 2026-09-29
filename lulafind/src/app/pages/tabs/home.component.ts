import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { IonInfiniteScroll } from '@ionic/angular/ion-infinite-scroll';
import { IonInfiniteScrollContent } from '@ionic/angular/ion-infinite-scroll-content';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ChatState, PostCardComponent } from '../../shared/components/post-card.component';
import { PeopleSuggestComponent } from '../../shared/components/people-suggest.component';
import { FeedStoriesComponent } from '../../shared/components/feed-stories.component';
import { FilterBarComponent } from '../../shared/components/filter-bar.component';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { UserProfile } from '../../core/models/types';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PlatformService } from '../../core/services/platform.service';
import { ModerationService } from '../../core/services/moderation.service';
import { POST_TYPE_META, Post } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';
import { storyBg } from '../../core/data/seed';

@Component({
  selector: 'lf-home',
  standalone: true,
  imports: [
    IonContent, IonRefresher, IonRefresherContent,
    IonInfiniteScroll, IonInfiniteScrollContent, IonSkeletonText,
    TopNavComponent, IconComponent, EmptyComponent, AvatarComponent,
    PostCardComponent, PeopleSuggestComponent, FeedStoriesComponent, FilterBarComponent
  ],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page" [scrollY]="!isGuestLocked()">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content pullingText="Pull to refresh"></ion-refresher-content>
      </ion-refresher>

      <!-- Facebook Feed Filter Chips -->
      <lf-filter-bar
        [filter]="data.filter()"
        [missingCount]="missingPip()"
        (filterChange)="data.setFilter($event)"
        (reset)="data.resetFilter()" />

      <!-- First section as you scroll: People you may know (Facebook style) -->
      <lf-people-suggest
        [people]="suggestions()"
        (seeAll)="goPeople()"
        (removed)="dismissSuggestion($event)" />

      @if (data.loading() && !data.feed().length) {
        @for (i of [1, 2, 3]; track i) {
          <div class="skel">
            <div class="skel__head"><ion-skeleton-text class="skel__av"></ion-skeleton-text><div class="lf-grow"><ion-skeleton-text style="width:40%;height:12px"></ion-skeleton-text><ion-skeleton-text style="width:24%;height:10px"></ion-skeleton-text></div></div>
            <ion-skeleton-text style="height:14px;width:90%"></ion-skeleton-text>
            <ion-skeleton-text style="height:14px;width:70%"></ion-skeleton-text>
            <ion-skeleton-text style="height:180px;margin-top:10px"></ion-skeleton-text>
          </div>
        }
      }

      @if (!data.loading() && !data.feed().length) {
        <lf-empty icon="search" title="No cases here yet"
                  message="Posts people create will show in this feed."
                  actionLabel="Reset filters" (action)="data.resetFilter()" />
      }

      <!-- Posts with a Stories block every few scrolls -->
      @for (p of displayedFeed(); track p.id; let i = $index) {
        <lf-post-card
          [post]="p"
          [author]="data.authorOf(p.authorId) ?? null"
          [chatState]="chatStateOf(p)"
          (vote)="onVote(p, $event)"
          (comment)="onComment(p)"
          (share)="onShare(p)"
          (chat)="onChat(p)"
          (more)="onMore(p)"
          (savedChange)="onSave(p)" />
        @if (showStoriesAfter(i)) {
          <lf-feed-stories (addStory)="onAddStory()" (seeAll)="storiesSheet.set(true)" />
        }
      }

      @if (isGuestLocked()) {
        <div class="guest-scroll-lock" role="region" aria-label="Sign in or Create Account">
          <div class="guest-scroll-lock__card">
            <span class="guest-scroll-lock__badge">
              <lf-icon name="lock" [size]="28" />
            </span>
            <h2 class="guest-scroll-lock__title">Sign in or Create an Account to view more</h2>
            <p class="guest-scroll-lock__body">
              You have viewed 4 posts in guest preview mode. Join LulaFind to view full case details and help bring missing people home across South Africa.
            </p>
            <div class="guest-scroll-lock__btns">
              <button class="lf-btn lf-btn--success lf-btn--block" (click)="goSignUp()">
                Create new account
              </button>
              <button class="lf-btn lf-btn--primary lf-btn--block" (click)="goSignIn()">
                Log in
              </button>
            </div>
          </div>
        </div>
      }

      @if (auth.signedIn()) {
        <ion-infinite-scroll threshold="180px" (ionInfinite)="onInfinite($event)">
          <ion-infinite-scroll-content loadingSpinner="circles" loadingText="Loading more"></ion-infinite-scroll-content>
        </ion-infinite-scroll>
      }
    </ion-content>

    <!-- All stories sheet (from “See all”) -->
    @if (storiesSheet()) {
      <div class="sheetwrap" (click)="storiesSheet.set(false)">
        <div class="sheet" role="dialog" aria-label="All stories" (click)="$event.stopPropagation()">
          <div class="sheet__head">
            <h3>Stories</h3>
            <button class="x" type="button" (click)="storiesSheet.set(false)" aria-label="Close">
              <lf-icon name="x" [size]="20" />
            </button>
          </div>
          <button class="lf-btn lf-btn--primary lf-btn--block" type="button" (click)="onAddStory()">
            <lf-icon name="plus" [size]="16" /> Create story
          </button>
          @if (!allStories().length) {
            <p class="sheet__empty">No stories yet. Be the first — stories disappear after 24 hours.</p>
          } @else {
            <div class="story-grid">
              @for (s of allStories(); track s.id) {
                <button class="story-cell" type="button" (click)="goStory(s.id)" [style.background]="storyBg(s.bgHue)">
                  @if (s.media[0]?.src) {
                    <img [src]="s.media[0].src" alt="" loading="lazy" />
                  } @else if (s.text) {
                    <span class="story-cell__txt">{{ s.text }}</span>
                  }
                  <span class="story-cell__who">
                    <lf-avatar [src]="data.avatarFor(data.authorOf(s.authorId))" [name]="data.authorOf(s.authorId)?.displayName ?? 'Member'" [size]="26" />
                    <span class="story-cell__meta">
                      <strong>{{ data.authorOf(s.authorId)?.displayName ?? 'Member' }}</strong>
                      <small>{{ timeAgo(s.createdAt) }}</small>
                    </span>
                  </span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .skel {
      background: var(--lf-card);
      margin: 0 0 8px;
      padding: 12px 16px 16px;
      box-shadow: var(--lf-shadow);
      display: flex; flex-direction: column; gap: 6px;
    }
    .skel__head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .skel__av { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }

    .guest-scroll-lock {
      margin: 8px 0 28px;
      padding: 24px 20px;
      background: var(--lf-card);
      box-shadow: var(--lf-shadow);
      text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 12px;
    }
    .guest-scroll-lock__badge {
      display: flex; align-items: center; justify-content: center;
      width: 56px; height: 56px; border-radius: 50%;
      background: var(--lf-primary-soft); color: var(--lf-primary-soft-text);
    }
    .guest-scroll-lock__title { margin: 0; font-size: 20px; font-weight: 700; color: var(--ion-text-color); }
    .guest-scroll-lock__body { margin: 0; font-size: 15px; line-height: 1.4; color: var(--lf-muted); }
    .guest-scroll-lock__btns { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 360px; margin-top: 4px; }

    @media (min-width: 700px) {
      .composer, .skel, .guest-scroll-lock { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; border-radius: var(--lf-radius); }
      .composer { margin-top: 12px; }
    }

    .sheetwrap {
      position: fixed; inset: 0; z-index: 120;
      background: var(--lf-scrim);
      display: flex; align-items: flex-end; justify-content: center;
    }
    .sheet {
      width: 100%; max-width: 520px;
      max-height: 86vh;
      overflow-y: auto;
      background: var(--lf-card);
      border-radius: 18px 18px 0 0;
      padding: 14px 16px calc(24px + var(--lf-safe-bottom));
      display: flex; flex-direction: column; gap: 10px;
    }
    .sheet__head { display: flex; align-items: center; justify-content: space-between; }
    .sheet__head h3 { margin: 0; font-size: 18px; font-weight: 700; }
    .x {
      width: 36px; height: 36px;
      border: 0; border-radius: 50%;
      background: var(--lf-card-2);
      color: var(--ion-text-color);
      cursor: pointer;
      display: grid; place-items: center;
    }
    .sheet__empty { color: var(--lf-muted); font-size: 14px; text-align: center; padding: 16px 0; }
    .story-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .story-cell {
      position: relative;
      aspect-ratio: 3 / 4;
      border: 0;
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      padding: 0;
      color: #fff;
      text-align: left;
      font-family: inherit;
    }
    .story-cell img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .story-cell__txt {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 12px;
      font-size: 14px; font-weight: 700; line-height: 1.35;
      text-align: center;
    }
    .story-cell__who {
      position: absolute; left: 0; right: 0; bottom: 0;
      display: flex; align-items: center; gap: 7px;
      padding: 18px 8px 8px;
      background: linear-gradient(transparent, rgba(0,0,0,.6));
    }
    .story-cell__meta { display: flex; flex-direction: column; min-width: 0; }
    .story-cell__meta strong { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .story-cell__meta small { font-size: 11px; opacity: .85; }
  `]
})
export class HomeComponent {
  protected data = inject(DataService);
  protected auth = inject(AuthService);
  protected chat = inject(ChatService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private toast = inject(ToastController);
  private sheetCtl = inject(ActionSheetController);
  private alertCtl = inject(AlertController);
  private mod = inject(ModerationService);

  protected readonly timeAgo = timeAgo;
  protected readonly storyBg = storyBg;

  readonly missingPip = computed(() =>
    this.data.feed().filter((p) => p.type === 'missing' && p.status === 'active').length
  );

  readonly isGuestLocked = computed(() => !this.auth.signedIn() && this.data.feed().length >= 4);

  readonly displayedFeed = computed(() => {
    const feed = this.data.feed();
    if (!this.auth.signedIn()) {
      return feed.slice(0, 4);
    }
    return feed;
  });

  /** “People you may know” — the first section of the feed. */
  readonly suggestions = signal<UserProfile[]>([]);
  /** All-stories sheet from “See all”. */
  readonly storiesSheet = signal(false);
  readonly allStories = computed(() => this.data.visibleStories());

  private chatGates = signal<Record<string, ChatState>>({});

  constructor() {
    void this.chat.load();
    void this.loadSuggestions();
    effect(() => {
      const n = this.data.feed().length;
      if (n >= 0) void this.recomputeGates();
    });
    // Following someone refreshes the suggestions so the rail never goes stale.
    effect(() => {
      const n = this.data.followingIds().length + this.data.followRequests().length;
      if (n >= 0) void this.loadSuggestions();
    });
    this.data.startAutoSync();
  }

  /** Stories sit inside the feed: after the 2nd post, then every 5 posts. */
  showStoriesAfter(index: number): boolean {
    if (this.displayedFeed().length <= 1) return index === 0;
    return index === 1 || (index + 1) % 5 === 0;
  }

  async loadSuggestions(): Promise<void> {
    try {
      this.suggestions.set(await this.data.suggestedPeople(10));
    } catch {
      this.suggestions.set([]);
    }
  }

  dismissSuggestion(id: string): void {
    this.suggestions.update((all) => all.filter((u) => u.id !== id));
  }

  goPeople(): void {
    void this.router.navigate(['/search']);
  }

  goStory(id: string): void {
    this.storiesSheet.set(false);
    void this.router.navigate(['/story', id]);
  }

  goSignUp(): void {
    void this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
  }

  goSignIn(): void {
    void this.router.navigate(['/auth']);
  }

  private async recomputeGates(): Promise<void> {
    // One round trip per post, all at once. Awaiting them in a loop made the
    // feed take visibly longer to settle after every refresh.
    const entries = await Promise.all(this.data.feed().map(async (p): Promise<[string, ChatState]> => {
      if (!p.chatEnabled) return [p.id, 'off' as ChatState];
      const g = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
      const state: ChatState = g.allowed ? 'open' : g.step === 'vote' ? 'locked-vote' : g.step === 'follow' ? 'locked-follow' : 'off';
      return [p.id, state];
    }));
    this.chatGates.set(Object.fromEntries(entries));
  }

  chatStateOf(p: Post): ChatState {
    if (p.authorId === this.auth.viewerId) return 'off';
    return this.chatGates()[p.id] ?? 'locked-vote';
  }

  async onRefresh(e: any): Promise<void> {
    await this.data.refresh();
    await this.chat.load();
    await this.loadSuggestions();
    await this.recomputeGates();
    e.target.complete();
  }

  onInfinite(e: any): void {
    setTimeout(() => e.target.complete(), 450);
  }

  private async needAuth(): Promise<boolean> {
    if (this.auth.signedIn()) return true;
    const t = await this.toast.create({
      message: 'Sign in to do that',
      duration: 2600,
      position: 'bottom',
      buttons: [{ text: 'Sign in', role: 'cancel', handler: () => void this.router.navigate(['/auth']) }]
    });
    await t.present();
    return false;
  }

  async onVote(p: Post, v: 'up' | 'down'): Promise<void> {
    if (!(await this.needAuth())) return;
    try {
      await this.data.vote(p.id, v);
      await this.platform.haptic('light');
      await this.recomputeGates();
    } catch (e: any) {
      await this.show(e?.message ?? 'Could not record your vote');
    }
  }

  async onComment(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    await this.router.navigate(['/post', p.id], { fragment: 'comments' });
  }

  async onShare(p: Post): Promise<void> {
    const text = `${p.title}\n\n${p.body.slice(0, 220)}\n\nShared from LulaFind`;
    const mode = await this.platform.share(p.title, text, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id);
    await this.show(mode === 'native' ? 'Shared' : 'Copied to clipboard');
  }

  async onSave(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const saved = await this.data.toggleSaved(p.id);
    await this.show(saved ? 'Saved. Find it in Menu → Saved.' : 'Removed from Saved');
  }

  async onChat(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const thread = await this.chat.ensureThread(p, p.authorId, 'vote');
    if (thread) await this.router.navigate(['/chat', thread.id]);
  }

  async onMore(p: Post): Promise<void> {
    const mine = this.data.canEdit(p);
    const saved = this.data.savedIds().includes(p.id);
    const sheet = await this.sheetCtl.create({
      header: p.title.slice(0, 40),
      buttons: [
        { text: saved ? 'Unsave post' : 'Save post', icon: 'bookmark' as const, handler: () => void this.onSave(p) },
        ...(mine
          ? [
            { text: 'Edit post', icon: 'pencil' as const, handler: () => void this.router.navigate(['/post', p.id, 'edit']) },
            { text: 'Mark as found', icon: 'checkmark-circle' as const, handler: () => void this.router.navigate(['/post', p.id], { fragment: 'found' }) },
            { text: 'Delete post', role: 'destructive' as const, icon: 'trash' as const, handler: async () => { await this.data.deletePost(p.id); } }
          ]
          : [
            { text: 'Report', role: 'destructive' as const, icon: 'flag' as const, handler: () => this.report(p) }
          ]),
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  async report(p: Post): Promise<void> {
    if (!this.auth.signedIn()) {
      await this.show('Sign in to report a post');
      await this.router.navigate(['/auth'], { queryParams: { next: '/home' } });
      return;
    }
    const reasons = this.mod.reasons;
    const pick = await this.alertCtl.create({
      header: 'Report this post',
      inputs: reasons.map((r) => ({ name: 'reason', type: 'radio' as const, label: r.label, value: r.id })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send report',
          handler: async (v: any) => {
            try {
              await this.mod.report({ target: 'post', targetId: p.id, summary: p.title, reason: v?.reason ?? 'other' });
              await this.show('Report sent.');
            } catch (e: any) {
              await this.show(e?.message ?? 'Could not send report');
            }
          }
        }
      ]
    });
    await pick.present();
  }

  async onAddStory(): Promise<void> {
    if (!(await this.needAuth())) return;
    this.storiesSheet.set(false);
    await this.router.navigate(['/create-story']);
  }

  private async show(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }
}
