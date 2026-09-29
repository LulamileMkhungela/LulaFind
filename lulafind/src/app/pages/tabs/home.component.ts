import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { IonInfiniteScroll } from '@ionic/angular/ion-infinite-scroll';
import { IonInfiniteScrollContent } from '@ionic/angular/ion-infinite-scroll-content';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { ChatState, PostCardComponent } from '../../shared/components/post-card.component';
import { StoryRailComponent } from '../../shared/components/story-rail.component';
import { PeopleRailComponent } from '../../shared/components/people-rail.component';
import { FilterBarComponent } from '../../shared/components/filter-bar.component';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { UserProfile } from '../../core/models/types';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PlatformService } from '../../core/services/platform.service';
import { POST_TYPE_META, Post, ReactionKind } from '../../core/models/types';
import { feedWithRails } from '../../core/utils/feed';

@Component({
  selector: 'lf-home',
  standalone: true,
  imports: [
    IonContent, IonRefresher, IonRefresherContent,
    IonInfiniteScroll, IonInfiniteScrollContent, IonSkeletonText,
    TopNavComponent, IconComponent, EmptyComponent, PostCardComponent, StoryRailComponent, PeopleRailComponent, FilterBarComponent
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
        <!-- Nothing in the feed: the story card goes on its own, at the top. -->
        <lf-story-rail (addStory)="onAddStory()" />
        <lf-empty icon="search" title="No cases here yet"
                  message="Posts people create will show in this feed."
                  actionLabel="Reset filters" (action)="data.resetFilter()" />
      }

      <!-- Stories and People appear after every 8th post, and nowhere else. -->
      @for (item of feedItems(); track item.key) {
        @if (item.post; as p) {
          <lf-post-card
            [post]="p"
            [author]="data.authorOf(p.authorId) ?? null"
            [chatState]="chatStateOf(p)"
            (vote)="onVote(p, $event)"
            (comment)="onComment(p)"
            (chat)="onChat(p)"
            (savedChange)="onSave(p)" />
        } @else if (item.kind === 'stories') {
          <lf-story-rail (addStory)="onAddStory()" />
        } @else {
          <lf-people-rail />
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
  `]
})
export class HomeComponent {
  protected data = inject(DataService);
  protected auth = inject(AuthService);
  protected chat = inject(ChatService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private toast = inject(ToastController);

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

  /**
   * Stories after the 8th post, People after the 16th, Stories after the 24th
   * and so on. A feed too short to reach an 8th post still gets one story rail,
   * after its last post, so the story card is never unreachable.
   * `feedWithRails` is a plain function so the rule can be tested on its own.
   */
  readonly feedItems = computed(() => feedWithRails(this.displayedFeed(), 8, { shortRail: true }));

  private chatGates = signal<Record<string, ChatState>>({});

  constructor() {
    void this.chat.load();
    effect(() => {
      const n = this.data.feed().length;
      if (n >= 0) void this.recomputeGates();
    });
    this.data.startAutoSync();
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
      const state: ChatState = g.allowed ? 'open' : g.step === 'follow' ? 'locked-follow' : 'off';
      return [p.id, state];
    }));
    this.chatGates.set(Object.fromEntries(entries));
  }

  chatStateOf(p: Post): ChatState {
    if (p.authorId === this.auth.viewerId) return 'off';
    return this.chatGates()[p.id] ?? 'locked-follow';
  }

  async onRefresh(e: any): Promise<void> {
    await this.data.refresh();
    await this.chat.load();
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

  async onVote(p: Post, v: ReactionKind): Promise<void> {
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

  async onSave(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const saved = await this.data.toggleSaved(p.id);
    await this.show(saved ? 'Saved. Find it in Menu → Saved.' : 'Removed from Saved');
  }

  async onChat(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const g = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
    if (g.allowed) {
      const thread = await this.chat.ensureThread(p, p.authorId, 'vote');
      if (thread) await this.router.navigate(['/chat', thread.id]);
      return;
    }
    // Chat is mutual-follow only. Following is the honest next step, so the
    // button takes you to the person rather than pretending a reaction helps.
    await this.router.navigate(['/user', p.authorId]);
  }

  async onAddStory(): Promise<void> {
    if (!(await this.needAuth())) return;
    await this.router.navigate(['/create-story']);
  }

  private async show(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }
}
