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
import { ChatState, PostCardComponent } from '../../shared/components/post-card.component';
import { StoryRailComponent } from '../../shared/components/story-rail.component';
import { FilterBarComponent } from '../../shared/components/filter-bar.component';
import { CHECK_IN_COPY } from '../../core/services/safety.service';
import { UserProfile } from '../../core/models/types';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PlatformService } from '../../core/services/platform.service';
import { ModerationService } from '../../core/services/moderation.service';
import { POST_TYPE_META, Post } from '../../core/models/types';

@Component({
  selector: 'lf-home',
  standalone: true,
  imports: [
    IonContent, IonRefresher, IonRefresherContent,
    IonInfiniteScroll, IonInfiniteScrollContent, IonSkeletonText,
    TopNavComponent, IconComponent, EmptyComponent, PostCardComponent, StoryRailComponent, FilterBarComponent
  ],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page" [scrollY]="!isGuestLocked()">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content pullingText="Pull to refresh"></ion-refresher-content>
      </ion-refresher>

      <!-- Facebook Stories Rail -->
      <lf-story-rail (addStory)="onAddStory()" />

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
        <lf-empty icon="search" title="No cases here yet"
                  message="Posts people create will show in this feed."
                  actionLabel="Reset filters" (action)="data.resetFilter()" />
      }

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
  private sheetCtl = inject(ActionSheetController);
  private alertCtl = inject(AlertController);
  private mod = inject(ModerationService);

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
    await this.router.navigate(['/create-story']);
  }

  private async show(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }
}
