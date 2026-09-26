import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { IonInfiniteScroll } from '@ionic/angular/ion-infinite-scroll';
import { IonInfiniteScrollContent } from '@ionic/angular/ion-infinite-scroll-content';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
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
import { KvStore } from '../../core/data/local-db';

@Component({
  selector: 'lf-home',
  standalone: true,
  imports: [
    IonContent, IonHeader, IonToolbar, IonRefresher, IonRefresherContent,
    IonInfiniteScroll, IonInfiniteScrollContent, IonSkeletonText,
    RouterLink, IconComponent, AvatarComponent, EmptyComponent, PostCardComponent, StoryRailComponent, FilterBarComponent
  ],
  template: `
    <ion-header translucent="true">
      <ion-toolbar>
        <div class="topbar">
          <div class="brand">
            <span class="mark">Lula</span><span class="mark mark--2">Find</span>
          </div>
          <div class="tools">
            <button class="help" routerLink="/help" aria-label="Get help"><lf-icon name="phone" [size]="16" /> Help</button>
            <button class="lf-icon-btn" routerLink="/search" aria-label="Search"><lf-icon name="search" [size]="20" /></button>
            <button class="lf-icon-btn" routerLink="/tips" aria-label="Tips"><lf-icon name="info" [size]="20" /></button>
            <button class="lf-icon-btn bell" routerLink="/notifications" aria-label="Notifications">
              <lf-icon name="bell" [size]="20" />
              @if (data.unreadNotifications() > 0) { <span class="lf-badge">{{ data.unreadNotifications() }}</span> }
            </button>
          </div>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      <ion-refresher slot="fixed" (ionRefresh)="onRefresh($event)">
        <ion-refresher-content pullingText="Pull to refresh"></ion-refresher-content>
      </ion-refresher>

      <lf-story-rail (addStory)="onAddStory()" />

      <lf-filter-bar
        [filter]="data.filter()"
        [missingCount]="missingPip()"
        (filterChange)="data.setFilter($event)"
        (reset)="data.resetFilter()" />

      @if (checkedIn().length) {
        <section class="now" aria-label="People who checked in">
          <p>Right now</p>
          <div class="faces">
            @for (u of checkedIn(); track u.id) {
              <a [routerLink]="'/user/' + u.id">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="48" [status]="data.statusOf(u)" />
                <strong>{{ firstName(u) }}</strong>
                <em [attr.data-status]="data.statusOf(u)">{{ statusWord(u) }}</em>
              </a>
            }
          </div>
        </section>
      }
      @if (openCount()) {
        <p class="pulse">{{ openCount() }} still open in this feed. Counted from posts here, not a police score.</p>
      }

      @if (showBroughtHome()) {
        <section class="brought" aria-label="Brought home">
          <header>
            <div>
              <strong>Brought home</strong>
              <span>{{ data.broughtHome().length }} found</span>
            </div>
            <button type="button" (click)="showFound()">See all</button>
          </header>
          @if (guideOpen()) {
            <p class="coach">
              <lf-icon name="check" [size]="14" />
              <span>These are home. Tap one. Open searches stay below.</span>
              <button type="button" (click)="dismissGuide()">Got it</button>
            </p>
          }
          <div class="lf-scroller faces">
            @for (p of data.broughtHome(); track p.id; let i = $index) {
              <a class="face" [routerLink]="'/post/' + p.id" [style.animation-delay.ms]="i * 70">
                <span class="ring">
                  @if (isItem(p)) {
                    <span class="item"><lf-icon [name]="kindIcon(p)" [size]="22" /></span>
                  } @else {
                    <lf-avatar src="" [name]="personName(p)" [size]="52" />
                  }
                  <span class="tick"><lf-icon name="check" [size]="11" /></span>
                </span>
                <strong>{{ shortName(p) }}</strong>
                <em>{{ homeKind(p) }}</em>
              </a>
            }
          </div>
        </section>
      }

      @if (data.loading() && !data.feed().length) {
        @for (i of [1, 2, 3]; track i) {
          <div class="lf-card"><ion-skeleton-text style="height:150px"></ion-skeleton-text></div>
        }
      }

      @if (!data.loading() && !data.feed().length && !featuredFound()) {
        <lf-empty icon="search" title="No cases here yet"
                  message="Posts people create will show in this feed. Nothing is filled in for you."
                  actionLabel="Reset filters" (action)="data.resetFilter()" />
      }

      @if (!data.feed().length && featuredFound(); as lone) {
        <p class="home-note">Nothing still open in this filter. This one came home.</p>
        <lf-post-card
          [post]="lone"
          [author]="data.authorOf(lone.authorId) ?? null"
          [chatState]="chatStateOf(lone)"
          (vote)="onVote(lone, $event)"
          (comment)="onComment(lone)"
          (share)="onShare(lone)"
          (chat)="onChat(lone)"
          (more)="onMore(lone)"
          (savedChange)="onSave(lone)" />
      }

      @if (hasLiveDanger()) {
        <p class="danger-note"><lf-icon name="alert" [size]="15" /> Danger nearby</p>
      }

      @for (p of orderedFeed(); track p.id; let i = $index) {
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
        @if (i === featureSlot() && featuredFound(); as found) {
          <p class="home-note">One that came home</p>
          <lf-post-card
            [post]="found"
            [author]="data.authorOf(found.authorId) ?? null"
            [chatState]="chatStateOf(found)"
            (vote)="onVote(found, $event)"
            (comment)="onComment(found)"
            (share)="onShare(found)"
            (chat)="onChat(found)"
            (more)="onMore(found)"
            (savedChange)="onSave(found)" />
        }
      }

      @if (data.feed().length) {
        <div class="lf-fab-note">
          You have seen {{ data.feed().length }} post(s) matching this filter.
          <a routerLink="/tips">Read what to do in the first 72 hours</a>
        </div>
      }

      <ion-infinite-scroll threshold="180px" (ionInfinite)="onInfinite($event)">
        <ion-infinite-scroll-content loadingSpinner="circles" loadingText="Loading more"></ion-infinite-scroll-content>
      </ion-infinite-scroll>
    </ion-content>

  `,
  styles: [`
    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 0 6px 0 16px; }
    .brand { font-size: 26px; font-weight: 900; letter-spacing: -1.2px; }
    .mark { color: var(--lf-beacon); }
    .mark--2 { color: var(--ion-text-color); }
    .tools { display: flex; align-items: center; }
    .help { display: inline-flex; align-items: center; gap: 4px; margin-right: 2px; border: 0;
      background: var(--lf-signal); color: #fff; font-weight: 800; font-size: 13px;
      border-radius: 999px; padding: 6px 12px; }
    .now { padding: 2px 0 4px; }
    .now > p { margin: 0 16px 6px; font-size: 13px; font-weight: 800; }
    .now .faces { display: flex; gap: 14px; overflow-x: auto; padding: 0 16px 8px; }
    .now a { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 72px;
      text-decoration: none; color: inherit; }
    .now a:active { transform: scale(.96); }
    .now strong { font-size: 12px; max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .now em { font-size: 11px; font-style: normal; font-weight: 800; text-align: center; }
    .now em[data-status="safe"] { color: var(--lf-ubuntu); }
    .now em[data-status="unfamiliar"] { color: var(--lf-marigold); }
    .now em[data-status="need_help"] { color: var(--lf-signal); }
    .pulse { margin: 0 16px 10px; font-size: 12.5px; line-height: 1.35; font-weight: 700; color: var(--lf-muted); }
    .bell { position: relative; }
    .bell .lf-badge { position: absolute; top: 2px; right: 0; font-size: 10px; min-width: 16px; height: 16px; }
    .sheet { padding: 18px var(--lf-gap) 32px; }
    .sheet p { margin: 6px 0 14px; }
    .plist { display: flex; flex-direction: column; gap: 4px; }
    .prow { display: flex; align-items: center; gap: 10px; padding: 13px 12px; border-radius: 12px;
      border: 1px solid transparent; background: transparent; color: inherit; font-size: 15px;
      font-weight: 600; text-align: left; cursor: pointer; }
    .prow:active { background: var(--lf-card-2); }
    .prow.on { border-color: var(--lf-beacon); background: color-mix(in srgb, var(--lf-beacon) 12%, transparent); }
    .lf-fab-note a { color: var(--lf-beacon); }
    .brought { margin: 4px 0 8px; }
    .brought header { display: flex; align-items: baseline; justify-content: space-between;
      padding: 8px var(--lf-gap) 2px; }
    .brought header strong { font-size: 15px; }
    .brought header span { margin-left: 8px; font-size: 12px; color: var(--lf-ubuntu); font-weight: 800; }
    .brought header button, .coach button { background: none; border: 0; color: var(--lf-beacon);
      font-weight: 800; font-size: 13px; cursor: pointer; padding: 4px; }
    .coach { display: flex; align-items: center; gap: 8px; margin: 6px var(--lf-gap) 2px; padding: 8px 10px;
      border-radius: 12px; background: color-mix(in srgb, var(--lf-ubuntu) 14%, transparent);
      color: var(--lf-ubuntu); font-size: 12.5px; font-weight: 700; }
    .coach span { flex: 1; }
    .coach lf-icon { flex: none; }
    .faces { padding-top: 8px; padding-bottom: 12px; }
    .face { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 84px;
      color: inherit; text-decoration: none; animation: home-in .55s cubic-bezier(.2,.8,.2,1) both; }
    .face:active { transform: scale(.96); }
    .face strong { font-size: 12px; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .face em { font-style: normal; font-size: 10.5px; color: var(--lf-muted); max-width: 80px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ring { position: relative; width: 58px; height: 58px; border-radius: 50%; padding: 2px;
      background: conic-gradient(from 200deg, var(--lf-ubuntu), color-mix(in srgb, var(--lf-ubuntu) 35%, transparent), var(--lf-ubuntu));
      display: flex; align-items: center; justify-content: center; }
    .item { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: var(--lf-card); color: var(--lf-ubuntu); border: 2px solid var(--ion-background-color); }
    .tick { position: absolute; right: -2px; bottom: -2px; width: 18px; height: 18px; border-radius: 50%;
      background: var(--lf-ubuntu); color: #04150c; display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--ion-background-color); animation: tick-pop .45s .25s both; }
    .home-note { margin: 14px var(--lf-gap) 0; font-size: 12px; font-weight: 800; letter-spacing: .3px;
      color: var(--lf-ubuntu); text-transform: uppercase; }
    .danger-note { display: flex; align-items: center; gap: 8px; margin: 12px var(--lf-gap) 0; padding: 10px 14px;
      border-radius: 16px; font-size: 13px; font-weight: 800; color: #ffd9d1;
      background: color-mix(in srgb, var(--lf-signal) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--lf-signal) 36%, transparent);
      backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); }
    @keyframes home-in { from { transform: translateY(6px); } to { transform: none; } }
    @keyframes tick-pop { from { transform: scale(0); } to { transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .face, .tick { animation: none; }
    }
  `]
})
export class HomeComponent {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private chat = inject(ChatService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private toast = inject(ToastController);
  private sheetCtl = inject(ActionSheetController);
  private alertCtl = inject(AlertController);
  private mod = inject(ModerationService);


  readonly missingPip = computed(() =>
    this.data.feed().filter((p) => p.type === 'missing' && p.status === 'active').length
  );

  /** Live danger alerts stay at the top so a new case cannot push them down. */
  readonly orderedFeed = computed(() => {
    const list = this.data.feed();
    const live = list.filter((p) => p.type === 'danger' && !p.danger?.clearedAt);
    const rest = list.filter((p) => !(p.type === 'danger' && !p.danger?.clearedAt));
    return [...live, ...rest];
  });

  readonly hasLiveDanger = computed(() => this.orderedFeed().some((p) => p.type === 'danger' && !p.danger?.clearedAt));

  readonly myProvince = computed(() => this.data.filter().province);

  private chatGates = signal<Record<string, ChatState>>({});

  private guide = new KvStore('lulafind.guide');
  readonly guideOpen = signal(!this.guide.get('home', false));

  constructor() {
    void this.chat.load();
    effect(() => {
      const n = this.data.feed().length + this.data.broughtHome().length;
      if (n >= 0) void this.recomputeGates();
    });
    // keep pulling the latest posts while the app is open
    this.data.startAutoSync();
  }

  /** Found cases sit on the newsfeed itself, unless the feed is already the Found list. */
  showBroughtHome(): boolean {
    return this.data.filter().status !== 'found' && this.data.broughtHome().length > 0;
  }

  readonly featuredFound = computed(() => {
    if (this.data.filter().status !== 'active') return null;
    return this.data.broughtHome()[0] ?? null;
  });

  /** Drop one found card into the open-search list so the feed itself shows a homecoming. */
  featureSlot(): number {
    return Math.min(1, Math.max(0, this.orderedFeed().length - 1));
  }

  /** Red and orange first, so a check-in is a face with a word, not a colour key. */
  readonly checkedIn = computed(() => {
    const rank = { need_help: 0, unfamiliar: 1, safe: 2 };
    return Object.values(this.data.authors())
      .filter((u) => this.data.statusOf(u))
      .sort((a, b) => rank[this.data.statusOf(a)!] - rank[this.data.statusOf(b)!])
      .slice(0, 8);
  });

  readonly openCount = computed(() =>
    this.data.feed().filter((p) => p.status === 'active' && (p.type === 'missing' || p.type === 'vehicle' || p.type === 'pet' || p.type === 'danger')).length
  );

  firstName(u: UserProfile): string {
    return u.displayName.split(' ')[0] || u.displayName;
  }

  statusWord(u: UserProfile): string {
    const s = this.data.statusOf(u);
    return s ? CHECK_IN_COPY[s].short : '';
  }

  showFound(): void {
    this.data.setFilter({ status: 'found' });
  }

  dismissGuide(): void {
    this.guide.set('home', true);
    this.guideOpen.set(false);
  }

  isItem(p: Post): boolean {
    return p.type === 'vehicle' || p.type === 'pet' || !p.subject?.name?.trim();
  }

  kindIcon(p: Post): string {
    return POST_TYPE_META[p.type]?.icon ?? 'check';
  }

  personName(p: Post): string {
    return p.subject?.name?.trim() || this.shortName(p);
  }

  shortName(p: Post): string {
    const named = p.subject?.name?.trim();
    if (named) return named.split(/\s+/)[0];
    if (p.type === 'vehicle') return 'Vehicle';
    if (p.type === 'pet') return 'Pet';
    const cleaned = p.title.replace(/^FOUND:\s*/i, '').replace(/^We found\s+/i, '');
    return cleaned.split(/\s+/)[0] || 'Found';
  }

  homeKind(p: Post): string {
    const where = p.outcome?.whereaboutsFound?.trim();
    if (where) return where.length > 24 ? where.slice(0, 22) + '…' : where;
    return p.town || 'Safe';
  }

  private async recomputeGates(): Promise<void> {
    const gates: Record<string, ChatState> = {};
    const posts = [...this.data.feed(), ...this.data.broughtHome()];
    for (const p of posts) {
      if (!p.chatEnabled) { gates[p.id] = 'off'; continue; }
      const g = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
      gates[p.id] = g.allowed ? 'open' : g.step === 'vote' ? 'locked-vote' : g.step === 'follow' ? 'locked-follow' : 'off';
    }
    this.chatGates.set(gates);
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
    // The mock layer returns the whole matching set; this hook is where cursor
    // paging plugs in for Firestore (orderBy updatedAt + startAfter).
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
      if (v === 'up') {
        const t = await this.toast.create({
          message: 'Thanks. Chat with the poster is one step closer - follow them to open it.',
          duration: 2600,
          position: 'bottom'
        });
        await t.present();
      }
    } catch (e: any) {
      await this.show(e?.message ?? 'Could not record your vote');
    }
  }

  async onComment(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    await this.router.navigate(['/post', p.id], { fragment: 'comments' });
  }

  async onShare(p: Post): Promise<void> {
    const text = `${p.title}\n\n${p.body.slice(0, 220)}${p.body.length > 220 ? '…' : ''}\n\n${p.contactValue ? 'Contact: ' + p.contactValue : ''}\n\nShared from LulaFind`;
    const mode = await this.platform.share(p.title, text, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id);
    await this.show(mode === 'native' ? 'Shared' : 'Copied to clipboard');
  }

  async onSave(p: Post): Promise<void> {
    const saved = await this.data.toggleSaved(p.id);
    await this.show(saved ? 'Saved to your watchlist' : 'Removed from watchlist');
  }

  async onChat(p: Post): Promise<void> {
    if (!(await this.needAuth())) return;
    const gate = await this.chat.gate(p, p.khumbu?.claimedByUserId === this.auth.viewerId);
    if (gate.allowed) {
      const thread = await this.chat.ensureThread(p, p.authorId, 'vote');
      if (thread) await this.router.navigate(['/chat', thread.id]);
      return;
    }
    if (gate.step === 'disabled') {
      await this.show(gate.reason);
      return;
    }
    if (gate.step === 'vote') {
      await this.show('Upvote this post first ("I have an idea") - that is how the poster knows you can help.');
      return;
    }
    const sheet = await this.sheetCtl.create({
      header: 'One step away',
      subHeader: 'You upvoted, so you have a lead. Private chat opens once you both follow each other - this keeps chats between people who actually want to talk.',
      buttons: [
        {
          text: `Follow ${this.data.authorOf(p.authorId)?.displayName ?? 'them'}`,
          handler: async () => {
            await this.data.toggleFollow(p.authorId);
            await this.recomputeGates();
            await this.show('Following. When they follow back, chat unlocks.');
          }
        },
        { text: 'Not now', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  /**
   * The three-dot menu, kept to what other apps use:
   *   - Report
   *   - Don't want to see this
   * and, on your own post, Edit / Mark as found / Delete.
   *
   * Escalate and Request location check are deliberately NOT here - they live
   * on the post itself where the poster can see what they are agreeing to.
   * Copy link is on the post too. "Open the community" is gone as well: a
   * poster may not belong to any Spotlight, and the post may not have been
   * made in one.
   */
  async onMore(p: Post): Promise<void> {
    const mine = this.data.canEdit(p);
    const sheet = await this.sheetCtl.create({
      header: p.title.slice(0, 40),
      buttons: [
        ...(mine
          ? [
              { text: 'Edit post', icon: 'pencil' as const, handler: () => void this.router.navigate(['/post', p.id, 'edit']) },
              { text: 'Mark as found', icon: 'checkmark-circle' as const, handler: () => void this.router.navigate(['/post', p.id], { fragment: 'found' }) },
              { text: 'Delete post', role: 'destructive' as const, icon: 'trash' as const, handler: async () => { await this.data.deletePost(p.id); await this.show('Post deleted'); } }
            ]
          : [
              { text: 'Report', role: 'destructive' as const, icon: 'flag' as const, handler: () => this.report(p) },
              { text: "Don't want to see this", icon: 'eye-off' as const, handler: () => this.hidePost(p) }
            ]),
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  /** Hide the post from this device, with an undo. */
  async hidePost(p: Post): Promise<void> {
    await this.data.hidePost(p.id);
    const t = await this.toast.create({
      message: 'You will not see this post again',
      duration: 6000,
      position: 'bottom',
      buttons: [{ text: 'Undo', role: 'cancel', handler: () => void this.data.unhidePost(p.id) }]
    });
    await t.present();
  }

  /** Report a post - the person chooses a reason, an admin works the queue. */
  async report(p: Post): Promise<void> {
    if (!this.auth.signedIn()) {
      await this.show('Sign in to report a post');
      await this.router.navigate(['/auth'], { queryParams: { next: '/home' } });
      return;
    }
    const reasons = this.mod.reasons;
    const pick = await this.alertCtl.create({
      header: 'Report this post',
      message: 'Tell us what is wrong. A LulaFind admin reviews every report.',
      inputs: reasons.map((r) => ({ name: 'reason', type: 'radio' as const, label: r.label, value: r.id })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send report',
          handler: async (v: any) => {
            try {
              await this.mod.report({ target: 'post', targetId: p.id, summary: p.title, reason: v?.reason ?? 'other' });
              await this.show('Report sent. Thank you - an admin will look at it.');
            } catch (e: any) {
              await this.show(e?.message ?? 'Could not send the report');
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
