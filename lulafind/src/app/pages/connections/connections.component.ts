import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { AlertController } from '@ionic/angular/alert-controller';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { UserProfile } from '../../core/models/types';

type Tab = 'requests' | 'following' | 'followers';

/**
 * Friends-style page: follow requests, people you follow, people who follow you.
 * Accept or decline requests, unfollow, or remove a follower - all in one place.
 */
@Component({
  selector: 'lf-connections',
  standalone: true,
  imports: [IonContent, IonHeader, RouterLink, IconComponent, AvatarComponent, EmptyComponent],
  template: `
    <ion-header class="fb-head">
      <div class="fb-head__bar">
        <button class="lf-round-btn back" (click)="back()" aria-label="Back"><lf-icon name="arrowLeft" [size]="20" [weight]="2.4" /></button>
        <h1 class="fb-head__title sm">Friends</h1>
      </div>
      <div class="seg" role="tablist">
        <button class="pill" role="tab" [class.on]="tab() === 'requests'" (click)="tab.set('requests')">
          Requests @if (data.followRequests().length) { <em class="lf-badge">{{ data.followRequests().length }}</em> }
        </button>
        <button class="pill" role="tab" [class.on]="tab() === 'following'" (click)="tab.set('following')">Following · {{ data.followingIds().length }}</button>
        <button class="pill" role="tab" [class.on]="tab() === 'followers'" (click)="tab.set('followers')">Followers · {{ data.followerIds().length }}</button>
      </div>
    </ion-header>

    <ion-content class="lf-page">
      @if (!rows().length) {
        <lf-empty icon="users" [title]="emptyTitle()" [message]="emptyText()" />
      } @else {
        <div class="list lf-safe-bottom">
          @for (r of rows(); track r.id) {
            <div class="row">
              <a [routerLink]="'/user/' + r.id" class="who">
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
                      <button class="lf-btn lf-btn--primary lf-btn--sm" [disabled]="busy() === r.id" (click)="followBack(r)">Follow back</button>
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
    .fb-head__title.sm { font-size: 20px; }
    .fb-head__bar { justify-content: flex-start; }
    .back { margin-right: 8px; }
    .seg { display: flex; gap: 8px; padding: 4px var(--lf-gap) 10px; overflow-x: auto; scrollbar-width: none; }
    .pill { flex: none; height: 34px; padding: 0 14px; border: 0; border-radius: 999px; cursor: pointer; font: inherit;
      font-size: 14px; font-weight: 600; background: var(--lf-card-2); color: var(--ion-text-color);
      display: inline-flex; align-items: center; gap: 6px; }
    .pill.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .pill .lf-badge { font-style: normal; }
    .list { background: var(--lf-card); box-shadow: var(--lf-shadow); margin-top: 8px; }
    @media (min-width: 768px) { .list { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; border-radius: var(--lf-radius); } }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px var(--lf-gap); flex-wrap: wrap; }
    .who { flex: 1 1 200px; min-width: 0; display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; }
    .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt strong { font-size: 16px; font-weight: 600; }
    .acts { display: flex; gap: 8px; margin-left: auto; }
  `]
})
export class ConnectionsComponent {
  protected data = inject(DataService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private alert = inject(AlertController);
  private toast = inject(ToastController);

  readonly tab = signal<Tab>((this.route.snapshot.queryParamMap.get('tab') as Tab) || 'requests');
  readonly busy = signal<string | null>(null);
  private readonly people = signal<Record<string, UserProfile>>({});
  private readonly asked = new Set<string>();

  readonly ids = computed(() => {
    switch (this.tab()) {
      case 'requests': return this.data.followRequests().map((r) => r.followerId);
      case 'following': return this.data.followingIds();
      default: return this.data.followerIds();
    }
  });

  readonly rows = computed(() => this.ids().map((id): { id: string; u: UserProfile | null } =>
    ({ id, u: (this.people()[id] as UserProfile | undefined) ?? this.data.authorOf(id) ?? null })));

  constructor() {
    void this.data.loadFollowRequests();
    void this.data.loadUserScoped();
    if (!this.route.snapshot.queryParamMap.get('tab') && !this.data.followRequests().length) this.tab.set('following');
    effect(() => {
      const missing = this.ids().filter((id) => !this.asked.has(id));
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

  emptyTitle(): string {
    return this.tab() === 'requests' ? 'No follow requests' : this.tab() === 'following' ? 'You are not following anyone' : 'No followers yet';
  }
  emptyText(): string {
    return this.tab() === 'requests'
      ? 'When someone asks to follow you, you can confirm or delete it here.'
      : this.tab() === 'following'
        ? 'Follow people from their profile or a post. Private chat opens when you follow each other.'
        : 'People who follow you show up here.';
  }

  back(): void {
    if (history.length > 1) history.back(); else void this.router.navigate(['/me']);
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

  followBack(r: { id: string; u: UserProfile | null }): Promise<void> {
    return this.run(r.id, () => this.data.toggleFollow(r.id), `Following ${r.u?.displayName ?? ''}`.trim());
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
