import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { ChatState, PostCardComponent } from '../../shared/components/post-card.component';
import { PeopleRailComponent } from '../../shared/components/people-rail.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PlatformService } from '../../core/services/platform.service';
import { prioritizeLocalPosts } from '../../core/utils/local-area';
import { Post, ReactionKind, provinceName } from '../../core/models/types';
import { feedWithRails } from '../../core/utils/feed';
import { LookoutService } from '../../core/services/lookout.service';
import { timeAgo } from '../../core/utils/format';

@Component({
  selector: 'lf-home',
  standalone: true,
  imports: [
    IonContent, IonRefresher, IonRefresherContent, IonSkeletonText,
    TopNavComponent, IconComponent, AvatarComponent, EmptyComponent, PostCardComponent, PeopleRailComponent,
    RouterLink
  ],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content pullingText="Pull to refresh"></ion-refresher-content>
      </ion-refresher>

      <!-- LinkedIn-style feed scope: discovery stays separate from the member's
           actual network. The scope is part of the data query, not a visual
           filter, so a refresh cannot leak a For you post into Network. -->
      <nav class="feed-scopes" role="tablist" aria-label="Home feed">
        <button type="button" role="tab" [class.active]="data.filter().scope === 'for-you'"
                [attr.aria-selected]="data.filter().scope === 'for-you'"
                (click)="setScope('for-you')">For you</button>
        <button type="button" role="tab" [class.active]="data.filter().scope === 'network'"
                [attr.aria-selected]="data.filter().scope === 'network'"
                (click)="setScope('network')">Network</button>
      </nav>

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

      <!--
        Home is the feed. "What should I do next?" used to be answered here as
        well as on Me, from the same nextBestStep() - two screens giving the same
        advice, which is one screen too many. The advice lives on Me, next to the
        impact it is about; a person who has not started yet still gets the
        empty-state invitation below.
      -->

      <!-- While you were away: the honest answer to "what did I miss?" - new
           cases (and how many are in your own province), movement on the cases
           you follow, and anything new in the Spotlights you are part of. -->
      @if (catchUpOpen() && catchUp().total) {
        <section class="catchup" aria-label="While you were away">
          <div class="catchup__head">
            <lf-icon name="sparkle" [size]="18" />
            <strong>While you were away</strong>
            <button type="button" class="catchup__x" (click)="dismissCatchUp()" aria-label="Dismiss">
              <lf-icon name="x" [size]="16" />
            </button>
          </div>
          <ul class="catchup__list">
            @if (catchUp().newCases; as n) {
              @if (n) {
                <li>
                  <a [routerLink]="'/home'" (click)="dismissCatchUp()">
                    <strong>{{ n }} new {{ n === 1 ? 'case' : 'cases' }}</strong>
                    @if (catchUp().nearYou) { <span>· {{ catchUp().nearYou }} in {{ myProvinceName() }}, near you</span> }
                  </a>
                </li>
              }
            }
            @if (catchUp().followed; as n) {
              @if (n) { <li><a [routerLink]="'/saved'" (click)="dismissCatchUp()"><strong>{{ n }} {{ n === 1 ? 'update' : 'updates' }}</strong> <span>on cases you follow</span></a></li> }
            }
            @if (catchUp().spotlight; as n) {
              @if (n) { <li><a [routerLink]="'/spotlight'" (click)="dismissCatchUp()"><strong>{{ n }} new {{ n === 1 ? 'post' : 'posts' }}</strong> <span>in your Spotlights</span></a></li> }
            }
          </ul>
          <button type="button" class="lf-btn lf-btn--ghost lf-btn--sm" (click)="dismissCatchUp()">Dismiss</button>
        </section>
      }

      @if (data.filter().scope === 'network') {
        <section class="network-context" aria-label="Your network">
          <div class="network-context__header"><div><strong>Your network</strong>
            <span>People you follow, your followers and follow requests.</span></div></div>
          <div class="network-actions" aria-label="Network connections">
            <a class="network-action" routerLink="/discover" [queryParams]="{ tab: 'following' }"><lf-icon name="users" [size]="17" /><span><strong>Following</strong><small>{{ data.followingIds().length }} people</small></span></a>
            <a class="network-action" routerLink="/discover" [queryParams]="{ tab: 'followers' }"><lf-icon name="users" [size]="17" /><span><strong>Followers</strong><small>{{ data.followerIds().length }} people</small></span></a>
            <a class="network-action" routerLink="/discover" [queryParams]="{ tab: 'requests' }"><lf-icon name="user" [size]="17" /><span><strong>Follow requests</strong><small>{{ data.followRequests().length }} pending</small></span></a>
          </div>
        </section>
      }
      @if (data.filter().scope === 'for-you') {
      <!--
        The composer strip. The round + in the header writes a post, but a
        timeline that opens straight onto other people's news with no way to
        say anything reads as a news reader, not a social app. This is the
        one-line version: your face, the prompt, and the three things people
        actually post here.
      -->
      @if (auth.signedIn()) {
        <div class="composer">
          <a class="composer__ask" routerLink="/new">
            <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="38" />
            <span class="composer__pill">{{ composerPrompt() }}</span>
          </a>
          <div class="composer__row">
            <a class="composer__action" routerLink="/create/missing"><lf-icon name="search" [size]="18" />Missing</a>
            <a class="composer__action" routerLink="/create/sighting"><lf-icon name="pin" [size]="18" />Sighting</a>
            <a class="composer__action composer__action--danger" routerLink="/create/danger"><lf-icon name="alert" [size]="18" />Danger</a>
          </div>
        </div>
      }

      <!-- The feed is intentionally not gated by visible chips or hidden
           local filters. For you and Network are the only scopes; privacy and
           audience rules remain enforced by the active backend. -->
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
                  message="Posts people create will show in this feed." />
      }

      <!-- Network posts stay as one stream. Stories are rendered only in the
           Network context above; For you does not inject story cards. -->
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
        } @else if (item.kind === 'people') {
          <lf-people-rail />
        }
      }
      }

    </ion-content>
  `,
  styles: [`
    /* For you / Network, drawn the way LinkedIn's mobile bar is: a flat,
       full-width row under the app bar, hairline underneath, the inactive label
       in muted grey, the active one in ink with a thick underline. No pill,
       no container - the tab *is* the row. */
    /* The composer strip: your face, the prompt, then the three post kinds. */
    .composer { margin: 10px var(--lf-gap) 10px; padding: 10px 12px 8px; border-radius: var(--lf-radius);
      background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .composer__ask { display: flex; align-items: center; gap: 10px; min-height: 40px; text-decoration: none; color: inherit; }
    .composer__pill { flex: 1; min-width: 0; height: 38px; display: flex; align-items: center; padding: 0 16px;
      border-radius: 999px; background: var(--lf-input); color: var(--lf-muted); font-size: 14.5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .composer__ask:active .composer__pill { background: var(--lf-hover); }
    .composer__row { display: flex; align-items: center; gap: 3px; margin-top: 8px; padding-top: 8px;
      border-top: 1px solid var(--lf-line-soft); }
    .composer__action { flex: 1 1 0; min-width: 0; min-height: 36px; display: inline-flex; align-items: center;
      justify-content: center; gap: 7px; border-radius: 6px; color: var(--lf-muted); text-decoration: none;
      font-size: 13.5px; font-weight: 600; white-space: nowrap; }
    .composer__action lf-icon { color: var(--lf-primary); }
    .composer__action--danger lf-icon { color: var(--lf-signal); }
    .composer__action:hover, .composer__action:active { background: var(--lf-hover); }

    .feed-scopes { position: sticky; top: 0; z-index: 10; display: flex; margin: 0; padding: 0; border: 0; border-bottom: 1px solid var(--lf-line); border-radius: 0; background: var(--lf-bg); }
    .feed-scopes button { flex: 1; min-height: 54px; margin: 0 2px -1px; padding: 0 12px; border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 19px; font-weight: 600; letter-spacing: .1px; cursor: pointer; transition: color .15s ease, border-color .15s ease; }
    .feed-scopes button:hover { color: var(--ion-text-color); background: transparent; }
    .feed-scopes button.active { color: var(--ion-text-color); font-weight: 800; border-bottom-color: var(--ion-text-color); background: transparent; box-shadow: none; }
    .network-context { margin: 8px var(--lf-gap) 10px; padding: 12px 2px; }
    .network-context__header { display: flex; align-items: flex-start; gap: 10px; }
    .network-context__header > div { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .network-context__header strong { font-size: 15px; }
    .network-context__header span { color: var(--lf-muted); font-size: 12px; line-height: 1.35; }
    .network-context__open { display: inline-flex; align-items: center; gap: 1px; flex: none; padding: 4px 0 4px 8px; color: var(--lf-primary); text-decoration: none; }
    .network-actions { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 11px; }
    .network-action { display: inline-flex; align-items: flex-start; gap: 7px; min-width: 0; padding: 8px 0; border: 0; border-bottom: 2px solid var(--lf-line-soft); background: transparent; color: inherit; text-decoration: none; font: inherit; text-align: left; cursor: pointer; }
    .network-action:hover { border-bottom-color: var(--lf-primary); }
    .network-action > lf-icon { flex: none; color: var(--lf-primary); margin-top: 1px; }
    .network-action span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .network-action strong { font-size: 12.5px; line-height: 1.2; }
    .network-action small { color: var(--lf-muted); font-size: 10.5px; line-height: 1.25; }
    .network-stories { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--lf-line-soft); }
    .network-stories__head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 3px; }
    .network-stories__head strong { font-size: 13px; }
    .network-stories__head span { color: var(--lf-muted); font-size: 11px; }
    .story-scopes { display: flex; gap: 4px; margin: 4px 0 6px; }
    .story-scopes button { border: 0; border-radius: 999px; padding: 5px 10px; background: var(--lf-card-2); color: var(--lf-muted); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
    .story-scopes button.active { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .network-stories lf-story-rail { margin: 0 -2px; border-radius: var(--lf-radius); box-shadow: var(--lf-shadow); }
    .network-strip { display: flex; align-items: center; gap: 9px; overflow-x: auto; margin-top: 11px; padding-top: 10px; border-top: 1px solid var(--lf-line-soft); scrollbar-width: none; }
    .network-strip::-webkit-scrollbar { display: none; }
    .network-strip__label { flex: none; color: var(--lf-muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .35px; }
    .network-person, .network-spotlight { flex: none; display: inline-flex; align-items: center; gap: 5px; color: inherit; text-decoration: none; font-size: 12px; font-weight: 600; }
    .network-person { flex-direction: column; align-items: flex-start; gap: 3px; min-width: 76px; max-width: 128px; }
    .network-person__name { font-weight: 700; }
    .network-person__status { color: var(--lf-primary); font-size: 11px; white-space: nowrap; }
    .network-person__note { max-width: 128px; overflow: hidden; color: var(--lf-muted); font-size: 11px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
    .network-spotlight { padding: 5px 8px 5px 5px; border-radius: 999px; background: var(--lf-card-2); }
    .network-spotlight__mark { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--lf-primary); color: #fff; font-weight: 800; }
    .network-empty { margin: 10px 0 0; color: var(--lf-muted); font-size: 13px; }
    @media (min-width: 700px) { .feed-scopes, .network-context { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; } }

    .start { position: relative; margin: 10px var(--lf-gap) 0; padding: 13px 14px 12px; border-radius: 14px;
      background: linear-gradient(150deg, color-mix(in srgb, var(--lf-primary) 13%, var(--lf-card)), var(--lf-card) 72%);
      box-shadow: var(--lf-shadow); }
    .start__x { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 26px; height: 26px;
      border: 0; border-radius: 50%; background: transparent; color: var(--lf-muted); cursor: pointer; }
    .start__row { display: flex; gap: 11px; align-items: flex-start; padding-right: 22px; }
    .start__ic { display: grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 11px;
      background: var(--lf-card); color: var(--lf-primary-soft-text); box-shadow: 0 0 0 1px var(--lf-line-soft); }
    .start__body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .start__eyebrow { font-size: 10.5px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase; color: var(--lf-primary-soft-text); }
    .start__body strong { font-size: 14.5px; line-height: 1.25; }
    .start__body p { margin: 1px 0 0; font-size: 12.5px; line-height: 1.35; color: var(--lf-muted); }
    .start__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px; }
    .start__foot .lf-btn { display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
    .start__go { display: inline-flex; align-items: center; gap: 2px; font-size: 12.5px; font-weight: 700;
      color: var(--lf-primary-soft-text); text-decoration: none; }
    .catchup { margin: 10px var(--lf-gap) 0; padding: 12px 14px; border-radius: var(--lf-radius);
      background: var(--lf-card); box-shadow: var(--lf-shadow); display: flex; flex-direction: column; gap: 8px; }
    .catchup__head { display: flex; align-items: center; gap: 8px; }
    .catchup__head strong { flex: 1; font-size: 15px; }
    .catchup__x { border: 0; background: transparent; color: var(--lf-muted); cursor: pointer; padding: 2px; }
    .catchup__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    .catchup__list a { color: inherit; text-decoration: none; font-size: 14px; }
    .catchup__list strong { font-weight: 700; }
    .catchup__list span { color: var(--lf-muted); }
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
    }
  `]
})
export class HomeComponent {
  protected data = inject(DataService);
  protected auth = inject(AuthService);

  /**
   * "While you were away" - what is new since this account last looked.
   *
   * Shown until it is dismissed, and dismissing is what moves the marker, so
   * nobody is told the same news twice. A brand-new account has no marker yet
   * and sees nothing, which is right: there is nothing behind them.
   */
  readonly catchUp = computed(() => {
    const s = this.data.sinceLastVisit();
    return {
      newCases: s.newCases.length,
      nearYou: s.nearYou,
      followed: s.followed.length,
      spotlight: s.spotlight.length,
      total: s.newCases.length + s.followed.length + s.spotlight.length
    };
  });
  readonly catchUpOpen = signal(true);

  myProvinceName(): string {
    return provinceName(this.auth.user()?.province ?? 'GP');
  }

  dismissCatchUp(): void {
    this.catchUpOpen.set(false);
    this.data.markVisited();
  }
  /** The reader's own face and first name, for the composer strip. */
  readonly myAvatar = computed(() => this.auth.userAvatar());
  readonly myName = computed(() => this.auth.user()?.displayName ?? 'You');
  /** The prompt moves with the hour: morning asks for help, evening asks for an update. */
  readonly composerPrompt = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Ask your community for help…';
    if (hour < 18) return 'Share something that might help…';
    return 'Update your community…';
  });

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


  readonly displayedFeed = computed(() => {
    const posts = this.data.feed();
    if (this.data.filter().scope !== 'for-you') return posts;
    const user = this.auth.user();
    return prioritizeLocalPosts(posts, user ? { province: user.province, town: user.town ?? '' } : null);
  });

  /** Stories have one home: Network. Keep the For you stream clean, and keep
   * Network posts in one continuous stream rather than inserting extra cards. */
  readonly storyScope = signal<'following' | 'followers' | 'public'>('following');
  readonly feedItems = computed(() => {
    const scope = this.data.filter().scope;
    return feedWithRails(this.displayedFeed(), 8)
      .filter((item) => item.kind !== 'stories')
      .filter((item) => scope !== 'network' || item.kind === 'post');
  });

  private chatGates = signal<Record<string, ChatState>>({});
  private chatGateSeq = 0;

  constructor() {
    void this.chat.load();
    effect(() => {
      const n = this.data.feed().length;
      this.data.followingIds();
      this.data.followerIds();
      this.auth.user();
      if (n >= 0) void this.recomputeGates();
    });
    this.data.startAutoSync();
  }

  networkStatusLabel(status: string | null | undefined): string {
    switch (status) {
      case 'need_help': return 'Needs help';
      case 'watch_me': return 'Watch me';
      case 'unfamiliar': return 'Status update';
      case 'safe': return "I'm safe";
      default: return 'Status update';
    }
  }

  setScope(scope: 'for-you' | 'network'): void {
    if (this.data.filter().scope === scope) return;
    this.data.setFilter({ scope });
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
    const request = ++this.chatGateSeq;
    const entries = await Promise.all(this.data.feed().map(async (p): Promise<[string, ChatState]> => {
      if (!p.chatEnabled) return [p.id, 'off' as ChatState];
      const g = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
      const state: ChatState = g.allowed ? 'open' : g.step === 'follow' ? 'locked-follow' : 'off';
      return [p.id, state];
    }));
    if (request === this.chatGateSeq) this.chatGates.set(Object.fromEntries(entries));
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
      const thread = await this.chat.ensureThread(p, p.authorId);
      if (thread) await this.router.navigate(['/chats/thread', thread.id]);
      return;
    }
    if (g.step === 'follow') await this.router.navigate(['/user', p.authorId]);
    else if (g.step === 'disabled') await this.show(g.reason);
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
