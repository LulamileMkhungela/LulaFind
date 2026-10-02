import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { ChatState, PostCardComponent } from '../../shared/components/post-card.component';
import { StoryRailComponent } from '../../shared/components/story-rail.component';
import { PeopleRailComponent } from '../../shared/components/people-rail.component';
import { FilterBarComponent } from '../../shared/components/filter-bar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PlatformService } from '../../core/services/platform.service';
import { Post, ReactionKind } from '../../core/models/types';
import { feedWithRails } from '../../core/utils/feed';
import { LookoutService } from '../../core/services/lookout.service';
import { timeAgo } from '../../core/utils/format';

@Component({
  selector: 'lf-home',
  standalone: true,
  imports: [
    IonContent, IonRefresher, IonRefresherContent, IonSkeletonText,
    TopNavComponent, IconComponent, EmptyComponent, PostCardComponent, StoryRailComponent, PeopleRailComponent, FilterBarComponent,
    RouterLink
  ],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content pullingText="Pull to refresh"></ion-refresher-content>
      </ion-refresher>

      <!-- A safety check waiting on you: nothing else on this screen matters more. -->
      @if (duePrompts().length) {
        <a class="checkprompt" [routerLink]="'/lookout/' + duePrompts()[0].lookout.id">
          <lf-icon name="shield" [size]="20" />
          <div class="lf-grow">
            <strong>{{ duePrompts()[0].headline }}</strong>
            <span class="lf-small">{{ duePrompts()[0].sub }}</span>
          </div>
          <lf-icon name="chevronRight" [size]="16" />
        </a>
      }

      <!-- Facebook Feed Filter Chips -->
      <lf-filter-bar
        [filter]="data.filter()"
        [missingCount]="missingPip()"
        (filterChange)="data.setFilter($event)"
        (reset)="data.resetFilter()" />

      <!-- The network never answered: say so and offer a retry, never spin for ever. -->
      @if (data.connectionLost() && !data.feed().length && !data.loading()) {
        <div class="offline" role="alert">
          <lf-icon name="wifiOff" [size]="22" />
          <strong>LulaFind can't reach the network</strong>
          <p>Check your connection and try again. Nothing you posted has been lost.</p>
          <button class="lf-btn lf-btn--primary" type="button" (click)="data.retryFeed()">Try again</button>
        </div>
      }

      @if (data.loading() && !data.feed().length && !data.connectionLost()) {
        @for (i of [1, 2, 3]; track i) {
          <div class="skel">
            <div class="skel__head"><ion-skeleton-text class="skel__av"></ion-skeleton-text><div class="lf-grow"><ion-skeleton-text style="width:40%;height:12px"></ion-skeleton-text><ion-skeleton-text style="width:24%;height:10px"></ion-skeleton-text></div></div>
            <ion-skeleton-text style="height:14px;width:90%"></ion-skeleton-text>
            <ion-skeleton-text style="height:14px;width:70%"></ion-skeleton-text>
            <ion-skeleton-text style="height:180px;margin-top:10px"></ion-skeleton-text>
          </div>
        }
      }

      @if (!data.loading() && !data.feed().length && !data.connectionLost()) {
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

    </ion-content>
  `,
  styles: [`
    .checkprompt { display: flex; align-items: center; gap: 12px; margin: 10px var(--lf-gap); padding: 13px 14px;
      border-radius: var(--lf-radius); background: color-mix(in srgb, var(--lf-beacon) 16%, var(--lf-card));
      color: inherit; text-decoration: none; box-shadow: var(--lf-shadow); }
    .checkprompt div { display: flex; flex-direction: column; gap: 2px; }
    .checkprompt span { color: var(--lf-muted); }
    .offline { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 28px 16px;
      padding: 22px 18px; border: 1px solid var(--lf-line); border-radius: 14px; background: var(--lf-card); text-align: center; }
    .offline strong { font-size: 16px; }
    .offline p { margin: 0 0 8px; font-size: 13.5px; color: var(--lf-muted); line-height: 1.4; }
    .skel {
      background: var(--lf-card);
      margin: 0 0 8px;
      padding: 12px 16px 16px;
      box-shadow: var(--lf-shadow);
      display: flex; flex-direction: column; gap: 6px;
    }
    .skel__head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .skel__av { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }


    @media (min-width: 700px) {
      .composer, .skel { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; border-radius: var(--lf-radius); }
      .composer { margin-top: 12px; }
    }
  `]
})
export class HomeComponent {
  protected data = inject(DataService);
  protected auth = inject(AuthService);
  protected lookouts = inject(LookoutService);
  protected chat = inject(ChatService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private toast = inject(ToastController);

  /**
   * Safety checks waiting on the viewer, newest first. This is the one thing
   * that outranks the feed: someone they follow has been out of contact for 24
   * hours and only they can answer.
   */
  readonly duePrompts = computed(() => {
    const me = this.auth.user();
    if (!me) return [];
    return this.lookouts.waitingOnMe()
      .map((lookout) => {
        const who = this.data.authorOf(lookout.userId)?.displayName ?? 'Someone you follow';
        return {
          lookout,
          headline: `Is ${who} okay?`,
          sub: `They set a lookout ${timeAgo(lookout.startedAt)} - answer to close it or flag them.`
        };
      })
      .filter((p) => !!p.lookout);
  });

  readonly missingPip = computed(() =>
    this.data.feed().filter((p) => p.type === 'missing' && p.status === 'active').length
  );

  readonly displayedFeed = computed(() => this.data.feed());

  /** Stories after post 8, People after post 16, then alternate every eight. */
  readonly feedItems = computed(() => feedWithRails(this.displayedFeed(), 8));

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
      void this.platform.haptic('light');
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
      if (thread) await this.router.navigate(['/chats/thread', thread.id]);
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
