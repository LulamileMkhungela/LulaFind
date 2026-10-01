import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { AlertController } from '@ionic/angular/alert-controller';
import { ToastController } from '@ionic/angular/toast-controller';

import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { IconComponent } from '../../shared/components/icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { CHECK_IN_COPY, SafetyService } from '../../core/services/safety.service';
import { CheckInStatus, UserProfile } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

type Tab = 'following' | 'followers' | 'requests' | 'statuses';

/**
 * Discover - the fourth bottom tab.
 *
 * Who is around you, and how are they: the people you follow, the people who
 * follow you, the follow requests waiting on you, and the statuses members have
 * set for themselves. A status can be acted on directly from the list.
 *
 * It replaces the old Friends page at /connections (that route still works) and
 * the Photo tab, which only duplicated Create.
 */
@Component({
  selector: 'lf-discover',
  standalone: true,
  imports: [IonContent, TopNavComponent, RouterLink, AvatarComponent, EmptyComponent, IconComponent],
  template: `
    <lf-top-nav heading="Discover" />

    <ion-content class="lf-page lf-plain">
      <div class="seg" role="tablist" aria-label="Discover">
        <button class="pill" role="tab" [class.on]="tab() === 'following'" (click)="tab.set('following')">
          Following · {{ data.followingIds().length }}
        </button>
        <button class="pill" role="tab" [class.on]="tab() === 'followers'" (click)="tab.set('followers')">
          Followers · {{ data.followerIds().length }}
        </button>
        <button class="pill" role="tab" [class.on]="tab() === 'requests'" (click)="tab.set('requests')">
          Requests @if (data.followRequests().length) { <em class="lf-badge">{{ data.followRequests().length }}</em> }
        </button>
        <button class="pill" role="tab" [class.on]="tab() === 'statuses'" (click)="tab.set('statuses')">
          Statuses @if (statusPeople().length) { <em class="lf-badge">{{ statusPeople().length }}</em> }
        </button>
      </div>

      @if (tab() === 'statuses') {
        <!-- Your own status first: the three answers a person can give. -->
        <section class="mine">
          <h2 class="mine__q">How are you right now?</h2>
          <div class="mine__row">
            @for (s of choices; track s.key) {
              <button class="choice" type="button" [attr.data-key]="s.key"
                      [class.on]="myStatus() === s.key" [disabled]="saving()"
                      (click)="setStatus(s.key)">
                <lf-icon [name]="s.icon" [size]="20" [weight]="2.2" />
                <span>{{ s.label }}</span>
              </button>
            }
          </div>
          @if (myStatus()) {
            <button class="clear" type="button" [disabled]="saving()" (click)="setStatus(null)">Clear my status</button>
          }
          <p class="mine__note">
            <lf-icon name="alert" [size]="14" />
            <span>{{ helpNote }}</span>
          </p>
        </section>

        @if (!statusPeople().length) {
          <lf-empty icon="users" title="No statuses right now"
                    message="When people you follow set a status - I'm safe, I need help, or watch me - it shows here." />
        } @else {
          <div class="list lf-safe-bottom">
            @for (r of statusPeople(); track r.id) {
              <div class="row">
                <a [routerLink]="['/user', r.id]" class="who">
                  <lf-avatar [src]="data.avatarFor(r.u)" [name]="r.u?.displayName ?? '?'" [size]="56"
                             [status]="r.status" />
                  <div class="txt">
                    <strong>{{ r.u?.displayName ?? 'A member' }}</strong>
                    <span class="pillstatus" [attr.data-key]="r.status">
                      <lf-icon [name]="iconFor(r.status)" [size]="13" [weight]="2.4" />
                      {{ labelFor(r.status) }}
                    </span>
                    <span class="lf-tiny lf-muted">
                      @if (r.u?.town) { {{ r.u!.town }} · }
                      @if (r.at) { {{ timeAgo(r.at) }} }
                    </span>
                  </div>
                </a>
                <div class="acts">
                  @if (!iFollow(r.id)) {
                    <button class="lf-btn lf-btn--primary lf-btn--sm" [disabled]="busy() === r.id" (click)="follow(r)">Follow</button>
                  }
                  @if (r.status === 'need_help' || r.status === 'watch_me') {
                    <button class="lf-btn lf-btn--sm" [disabled]="busy() === r.id" (click)="checkOn(r)">Check on them</button>
                  }
                </div>
              </div>
            }
          </div>
        }
      } @else if (!rows().length) {
        <lf-empty icon="users" [title]="emptyTitle()" [message]="emptyText()" />
      } @else {
        <div class="list lf-safe-bottom">
          @for (r of rows(); track r.id) {
            <div class="row">
              <a [routerLink]="['/user', r.id]" class="who">
                <lf-avatar [src]="data.avatarFor(r.u)" [name]="r.u?.displayName ?? '?'" [size]="56" />
                <div class="txt">
                  <strong>{{ r.u?.displayName ?? 'A member' }}</strong>
                  <span class="lf-tiny lf-muted">
                    @if (r.u?.handle) { &#64;{{ r.u!.handle }} · }
                    @switch (tab()) {
                      @case ('requests') { wants to follow you }
                      @case ('following') { {{ followsBack(r.id) ? 'Friends · you follow each other' : 'You follow them' }} }
                      @default { {{ iFollow(r.id) ? 'Friends · you follow each other' : 'Follows you' }} }
                    }
                  </span>
                </div>
              </a>
              <div class="acts">
                @switch (tab()) {
                  @case ('requests') {
                    <button class="lf-btn lf-btn--primary lf-btn--sm" [disabled]="busy() === r.id" (click)="respond(r.id, true)">Confirm</button>
                    <button class="lf-btn lf-btn--sm" [disabled]="busy() === r.id" (click)="respond(r.id, false)">Delete</button>
                  }
                  @case ('following') {
                    <button class="lf-btn lf-btn--sm" [disabled]="busy() === r.id" (click)="unfollow(r)">Unfollow</button>
                  }
                  @default {
                    @if (!iFollow(r.id)) {
                      <button class="lf-btn lf-btn--primary lf-btn--sm" [disabled]="busy() === r.id" (click)="follow(r)">Follow back</button>
                    }
                    <button class="lf-btn lf-btn--sm" [disabled]="busy() === r.id" (click)="remove(r)">Remove</button>
                  }
                }
              </div>
            </div>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .seg { display: flex; gap: 8px; padding: 4px var(--lf-gap) 10px; overflow-x: auto; scrollbar-width: none; }
    .seg::-webkit-scrollbar { display: none; }
    .pill { flex: none; height: 34px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer; font: inherit;
      font-size: 14px; font-weight: 600; background: var(--lf-card-2); color: var(--ion-text-color);
      display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .pill.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .pill .lf-badge { font-style: normal; }

    .mine { background: var(--lf-card); box-shadow: var(--lf-shadow); padding: 14px var(--lf-gap) 12px; margin-bottom: 8px; }
    .mine__q { margin: 0 0 10px; font-size: 16px; font-weight: 700; }
    .mine__row { display: flex; gap: 8px; flex-wrap: wrap; }
    /* Each status keeps one colour everywhere it appears, so the colour alone
       tells you what it means: green safe, red help, amber watch. */
    .choice { flex: 1 1 30%; min-width: 104px; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      height: 42px; border: 1px solid var(--lf-line); border-radius: 8px; background: var(--lf-card-2);
      color: var(--ion-text-color); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
    .choice[data-key="safe"].on { background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); border-color: var(--lf-ubuntu); color: var(--lf-ubuntu); }
    .choice[data-key="need_help"].on { background: color-mix(in srgb, var(--lf-signal) 16%, transparent); border-color: var(--lf-signal); color: var(--lf-signal-text); }
    .choice[data-key="watch_me"].on { background: color-mix(in srgb, var(--lf-marigold) 18%, transparent); border-color: var(--lf-marigold); }
    .choice:disabled { opacity: .6; }
    .clear { margin-top: 10px; background: none; border: 0; padding: 0; color: var(--lf-link);
      font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
    .mine__note { display: flex; align-items: flex-start; gap: 6px; margin: 10px 0 0; font-size: 12.5px;
      color: var(--lf-muted); line-height: 1.35; }
    .mine__note lf-icon { margin-top: 1px; flex-shrink: 0; }

    .list { background: var(--lf-card); box-shadow: var(--lf-shadow); margin-top: 8px; }
    @media (min-width: 768px) { .mine, .list { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; border-radius: var(--lf-radius); } }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px var(--lf-gap); flex-wrap: wrap; }
    .who { flex: 1 1 200px; min-width: 0; display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; }
    .txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .txt strong { font-size: 16px; font-weight: 600; }
    .acts { display: flex; gap: 8px; margin-left: auto; }
    .pillstatus { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start;
      padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .pillstatus[data-key="safe"] { background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); color: var(--lf-ubuntu); }
    .pillstatus[data-key="need_help"] { background: color-mix(in srgb, var(--lf-signal) 16%, transparent); color: var(--lf-signal-text); }
    .pillstatus[data-key="watch_me"] { background: color-mix(in srgb, var(--lf-marigold) 20%, transparent); color: var(--lf-marigold); }
  `]
})
export class DiscoverComponent {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private safety = inject(SafetyService);
  private route = inject(ActivatedRoute);
  private alert = inject(AlertController);
  private toast = inject(ToastController);
  protected readonly timeAgo = timeAgo;

  readonly tab = signal<Tab>((this.route.snapshot.queryParamMap.get('tab') as Tab) || 'statuses');
  readonly busy = signal<string | null>(null);
  readonly saving = signal(false);
  private readonly people = signal<Record<string, UserProfile>>({});
  private readonly asked = new Set<string>();

  readonly choices: { key: CheckInStatus; icon: string; label: string }[] = [
    { key: 'safe', icon: 'check', label: 'I\'m Safe' },
    { key: 'need_help', icon: 'alert', label: 'I Need Help' },
    { key: 'watch_me', icon: 'eye', label: 'Watch Me' }
  ];

  readonly helpNote = 'I Need Help and Watch Me alert the people who follow you. Use I Need Help only when you are genuinely in danger - in an emergency call 10111.';

  readonly myStatus = computed(() => this.auth.user()?.checkIn?.status ?? null);

  /** People you follow who have a status set, newest first. */
  readonly statusPeople = computed(() => {
    const me = this.auth.viewerId;
    const out: { id: string; u: UserProfile | null; status: CheckInStatus; at: number | null }[] = [];
    for (const id of this.data.followingIds()) {
      if (id === me) continue;
      const u = this.data.authorOf(id);
      if (!u?.checkIn) continue;
      out.push({ id, u, status: u.checkIn.status, at: u.checkIn.at ?? null });
    }
    return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  });

  readonly ids = computed(() => {
    switch (this.tab()) {
      case 'requests': return this.data.followRequests().map((r) => r.followerId);
      case 'following': return this.data.followingIds();
      case 'statuses': return this.statusPeople().map((r) => r.id);
      default: return this.data.followerIds();
    }
  });

  readonly rows = computed(() => this.ids().map((id): { id: string; u: UserProfile | null } =>
    ({ id, u: (this.people()[id] as UserProfile | undefined) ?? this.data.authorOf(id) ?? null })));

  constructor() {
    void this.data.loadFollowRequests();
    void this.data.loadUserScoped();
    effect(() => {
      const ids = [...this.statusPeople().map((r) => r.id), ...this.ids()];
      const missing = ids.filter((id) => !this.asked.has(id));
      missing.forEach((id) => this.asked.add(id));
      if (missing.length) void this.data.people(missing).then((list) => {
        const next = { ...this.people() };
        for (const u of list) { next[u.id] = u; this.data.touchAuthor(u); }
        this.people.set(next);
      });
    });
  }

  iFollow(id: string): boolean { return this.data.followingIds().includes(id); }
  followsBack(id: string): boolean { return this.data.followerIds().includes(id); }

  labelFor(s: CheckInStatus): string { return CHECK_IN_COPY[s].label; }
  iconFor(s: CheckInStatus): string {
    return s === 'need_help' ? 'alert' : s === 'watch_me' ? 'eye' : 'check';
  }

  async setStatus(status: CheckInStatus | null): Promise<void> {
    this.saving.set(true);
    try {
      if (status === null) await this.safety.clearCheckIn();
      else await this.safety.checkIn({ status });
    } catch (e: any) {
      await this.toast.create({ message: e?.message ?? 'Could not save your status', duration: 2600, position: 'bottom' }).then((t) => t.present());
    } finally {
      this.saving.set(false);
    }
  }

  emptyTitle(): string {
    switch (this.tab()) {
      case 'requests': return 'No follow requests';
      case 'following': return 'You are not following anyone';
      default: return 'No followers yet';
    }
  }
  emptyText(): string {
    switch (this.tab()) {
      case 'requests': return 'When someone asks to follow you, you can confirm or delete it here.';
      case 'following': return 'Follow people from their profile or a post. Private chat opens when you follow each other.';
      default: return 'People who follow you show up here.';
    }
  }

  private async run(id: string, job: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(id);
    try {
      await job();
      await this.toast.create({ message: done, duration: 1800, position: 'bottom' }).then((t) => t.present());
    } catch (e: any) {
      await this.toast.create({ message: e?.message ?? 'Something went wrong', duration: 2400, position: 'bottom' }).then((t) => t.present());
    } finally {
      this.busy.set(null);
    }
  }

  respond(id: string, accept: boolean): Promise<void> {
    return this.run(id, () => this.data.respondToFollowRequest(id, accept), accept ? 'Request confirmed' : 'Request deleted');
  }

  follow(r: { id: string; u: UserProfile | null }): Promise<void> {
    return this.run(r.id, () => this.data.toggleFollow(r.id), `Following ${r.u?.displayName ?? ''}`.trim());
  }

  /** Reaching out to someone who asked for help or to be watched. */
  checkOn(r: { id: string; u: UserProfile | null }): Promise<void> {
    return this.run(r.id, () => this.data.notify({
      userId: r.id,
      kind: 'checkin',
      title: `${this.auth.user()?.displayName ?? 'Someone'} checked on you`,
      body: 'They saw your status and wanted you to know someone is there.',
      route: '/notifications',
      postId: null
    }), `${r.u?.displayName ?? 'They'} has been told you checked on them`);
  }

  async unfollow(r: { id: string; u: UserProfile | null }): Promise<void> {
    const a = await this.alert.create({
      header: `Unfollow ${r.u?.displayName ?? 'this person'}?`,
      message: 'Their posts stop being boosted in your feed, and private chat closes unless you follow each other again.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Unfollow', role: 'destructive', handler: () => { void this.run(r.id, () => this.data.toggleFollow(r.id), 'Unfollowed'); } }
      ]
    });
    await a.present();
  }

  async remove(r: { id: string; u: UserProfile | null }): Promise<void> {
    const a = await this.alert.create({
      header: `Remove ${r.u?.displayName ?? 'this follower'}?`,
      message: 'They will not be told. They can ask to follow you again.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Remove', role: 'destructive', handler: () => { void this.run(r.id, () => this.data.removeFollower(r.id), 'Follower removed'); } }
      ]
    });
    await a.present();
  }
}
