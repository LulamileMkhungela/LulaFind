import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonModal } from '@ionic/angular/ion-modal';
import { IonInput } from '@ionic/angular/ion-input';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonSelect } from '@ionic/angular/ion-select';
import { IonSelectOption } from '@ionic/angular/ion-select-option';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonToggle } from '@ionic/angular/ion-toggle';
import { ToastController } from '@ionic/angular/toast-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { ReactionKind } from '../../core/models/types';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { PostCardComponent } from '../../shared/components/post-card.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { PlatformService } from '../../core/services/platform.service';
import { ModerationService } from '../../core/services/moderation.service';
import { compact, contributorLabel, parseFullName } from '../../core/utils/format';
import { PROVINCES, ProvinceCode, Post, UserProfile, defaultPrivacy, provinceName } from '../../core/models/types';
import { CHECK_IN_COPY, RING_KEY, SafetyService } from '../../core/services/safety.service';
import { MediaService } from '../../core/services/media.service';

import { KeyboardDirective } from '../../shared/keyboard.directive';

@Component({
  selector: 'lf-me',
  standalone: true,
  imports: [
    IonContent, TopNavComponent, IonModal, IonInput, IonTextarea, IonSelect, IonSelectOption, IonItem, IonLabel, IonToggle,
    RouterLink, IconComponent, AvatarComponent, EmptyComponent, PostCardComponent, KeyboardDirective],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page">
      <div class="page-title">
        <h1>Menu</h1>
        <a class="lf-round-btn" routerLink="/settings" aria-label="Settings"><lf-icon name="settings" [size]="19" /></a>
      </div>
      @if (!me()) {
        <lf-empty icon="user" title="You are browsing as a guest"
                  message="You can read every public case. Sign in to post, vote, comment and chat."
                  actionLabel="Sign in / Sign up" (action)="goAuth()" />
      } @else {
        <div class="hero">
          <div class="cover" aria-hidden="true"></div>
          <button class="face" type="button" (click)="addPhoto()" [attr.aria-label]="me()!.avatarUrl ? 'Change profile photo' : 'Add a profile photo'">
            <lf-avatar [src]="avatar()" [name]="me()!.displayName" [size]="128"
                       [status]="me()!.checkIn?.status ?? null" />
            <span class="cam"><lf-icon name="image" [size]="18" /></span>
          </button>
          <div>
            <h1 class="name">
              {{ me()!.displayName }}
              @if (me()!.verified) { <lf-icon name="award" [size]="18" /> }
            </h1>
            <div class="lf-meta">&#64;{{ me()!.handle }} · {{ location() }}</div>
            @if (contributorLabel(me()!.contributorCredits)) {
              <span class="lf-contrib" [class.top]="mostNamed()" style="margin-top:6px">{{ contributorLabel(me()!.contributorCredits) }}</span>
            }
          </div>
          @if (me()!.bio) { <p class="bio">{{ me()!.bio }}</p> }
          <div class="stats">
            <button type="button" (click)="openPeople('followers')"><strong>{{ data.followerIds().length }}</strong><span>followers</span></button>
            <button type="button" (click)="openPeople('following')"><strong>{{ data.followingIds().length }}</strong><span>following</span></button>
            <div><strong>{{ compact(me()!.karma) }}</strong><span>help points</span></div>
          </div>
          @if (people()) {
            <div class="requests">
              <div class="lf-row-between">
                <h3 class="lf-h2">{{ people() === 'followers' ? 'People who follow you' : 'People you follow' }}</h3>
                <button class="lf-btn lf-btn--ghost lf-btn--sm" type="button" (click)="people.set(null)">Close</button>
              </div>
              @if (!peopleRows().length) {
                <p class="lf-small lf-muted">No one here yet.</p>
              }
              @for (u of peopleRows(); track u.id) {
                <div class="req">
                  <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="40" />
                  <div class="lf-grow">
                    <strong>{{ u.displayName }}</strong>
                    <span class="lf-small lf-muted">&#64;{{ u.handle }}</span>
                  </div>
                  @if (people() === 'following') {
                    <button class="lf-btn lf-btn--sm lf-btn--ghost" type="button" (click)="unfollow(u.id)">Unfollow</button>
                  }
                  <a class="lf-btn lf-btn--sm" [routerLink]="'/user/' + u.id">View</a>
                </div>
              }
            </div>
          }
          @if (statusLine()) {
            <div class="status" [attr.data-status]="me()!.checkIn?.status">
              <lf-icon [name]="me()!.checkIn?.status === 'safe' ? 'check' : 'alert'" [size]="15" />
              {{ statusLine() }}
              <button type="button" class="clear" (click)="clearStatus()">Clear</button>
            </div>
          }
          <p class="ring-key">{{ ringKey }}</p>
          <div class="actions">
            <button class="lf-btn lf-btn--primary" routerLink="/user/{{ me()!.id }}">
              <lf-icon name="shield" [size]="16" /> Check in
            </button>
            <button class="lf-btn" (click)="editing.set(true); prepareEdit()">
              <lf-icon name="edit" [size]="16" /> Edit profile
            </button>
            <button class="lf-btn icon-only" (click)="shareProfile()" aria-label="Share profile">
              <lf-icon name="share" [size]="16" />
            </button>
          </div>
        </div>

        <div class="tabs menu-tabs" role="tablist" aria-label="Menu sections">
          @for (t of menuTabs; track t.key) {
            <button class="tab" [class.on]="menuTab() === t.key" [id]="'menu-tab-' + t.key"
                    role="tab" [attr.aria-selected]="menuTab() === t.key" [attr.aria-controls]="'menu-panel-' + t.key"
                    (click)="menuTab.set(t.key)">
              {{ t.label }}
            </button>
          }
        </div>

        @if (menuTab() === 'shortcuts') {
          <section class="menu-panel" id="menu-panel-shortcuts" role="tabpanel" aria-labelledby="menu-tab-shortcuts">
            <div class="quick">
              <a class="q" routerLink="/connections"><span class="qi qi-blue"><lf-icon name="users" [size]="20" /></span><span>Friends</span>
                @if (data.followRequests().length) { <em class="lf-badge">{{ data.followRequests().length }}</em> }</a>
              <button class="q" type="button" (click)="createStory()"><span class="qi qi-blue"><lf-icon name="image" [size]="20" /></span><span>Add a Story</span></button>
              <a class="q" routerLink="/safety"><span class="qi qi-green"><lf-icon name="shield" [size]="20" /></span><span>Safety</span></a>
              <a class="q" routerLink="/tips"><span class="qi qi-yellow"><lf-icon name="info" [size]="20" /></span><span>Tips</span></a>
              @if (isAdmin()) {
                <a class="q" routerLink="/admin"><span class="qi qi-red"><lf-icon name="shield" [size]="20" /></span><span>Admin</span>
                  @if (mod.openCount() > 0) { <em class="lf-badge">{{ mod.openCount() }}</em> }</a>
              }
              <a class="q" routerLink="/found"><span class="qi qi-green"><lf-icon name="check" [size]="20" /></span><span>People found</span></a>
              <a class="q" routerLink="/faqs"><span class="qi qi-blue"><lf-icon name="info" [size]="20" /></span><span>FAQs</span></a>
              <a class="q" routerLink="/help"><span class="qi qi-red"><lf-icon name="phone" [size]="20" /></span><span>Get help</span></a>
              <button class="q" type="button" (click)="signOut()"><span class="qi qi-grey"><lf-icon name="logout" [size]="20" /></span><span>Sign out</span></button>
            </div>

            @if (data.followRequests().length) {
              <div class="requests">
                <div class="lf-row-between">
                  <h3 class="lf-h2"><lf-icon name="users" [size]="16" /> Follow requests</h3>
                  <a class="see-all" routerLink="/connections" [queryParams]="{ tab: 'requests' }">See all</a>
                </div>
                @for (r of requestPeople(); track r.id) {
                  <div class="req">
                    <lf-avatar [src]="data.avatarFor(r.u)" [name]="r.u?.displayName ?? 'Member'" [size]="40" />
                    <div class="lf-grow">
                      <strong>{{ r.u?.displayName ?? 'Member' }}</strong>
                      <span class="lf-small lf-muted">wants to follow you</span>
                    </div>
                    <button class="lf-btn lf-btn--sm" (click)="respond(r.id, true)">Accept</button>
                    <button class="lf-btn lf-btn--sm lf-btn--ghost" (click)="respond(r.id, false)">Decline</button>
                  </div>
                }
              </div>
            }
          </section>
        } @else {
          <section class="menu-panel menu-posts" [id]="'menu-panel-' + menuTab()" role="tabpanel"
                   [attr.aria-labelledby]="'menu-tab-' + menuTab()">
            <h2 class="fb-section-title">{{ menuTab() === 'posts' ? 'Posts' : 'Saved posts' }}</h2>
            @if (visible().length) {
              @for (p of visible(); track p.id) {
                <lf-post-card [post]="p" [author]="data.authorOf(p.authorId) ?? null" chatState="off"
                              (vote)="vote(p, $event)" (comment)="open(p)" />
              }
            } @else {
              <lf-empty [icon]="menuTab() === 'saved' ? 'bookmark' : 'book'" [title]="emptyTitle()"
                        [message]="emptyMessage()" [actionLabel]="emptyActionLabel()" (action)="emptyAction()" />
            }
          </section>
        }
      }
    </ion-content>

    <ion-modal [isOpen]="editing()" (didDismiss)="editing.set(false)" [initialBreakpoint]="0.8" [breakpoints]="[0.5, 0.8, 1]">
      <ng-template>
        <div class="sheet">
          <h3 class="lf-h2">Edit profile</h3>
          @if (formError()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ formError() }}</p> }
          <div class="ident-lock">
            <lf-avatar [src]="avatar()" [name]="me()!.displayName" [size]="36" />
            <div>
              <span class="k">Name</span>
              <strong>{{ me()!.displayName }}</strong>
              <span class="k">Username &#64;{{ me()!.handle }}</span>
            </div>
            <lf-icon name="lock" [size]="15" />
          </div>
          <p class="lf-small lf-muted">Your name is set from signup and cannot be changed. Everything else here is yours to edit.</p>
          <button class="lf-btn lf-btn--ghost lf-btn--block" type="button" (click)="addPhoto()">
            <lf-icon name="image" [size]="15" /> {{ me()!.avatarUrl ? 'Change profile photo' : 'Add profile photo' }}
          </button>
          @if (me()!.avatarUrl) {
            <button class="lf-btn lf-btn--ghost lf-btn--block" type="button" (click)="removePhoto()">Use initials instead</button>
          }
          <ion-item><ion-label position="stacked">Town</ion-label>
            <ion-input [value]="form.town" (ionInput)="form.town = $any($event.target).value"></ion-input></ion-item>
          <ion-item><ion-label position="stacked">Province</ion-label>
            <ion-select [value]="form.province" (ionChange)="form.province = $any($event.detail).value" placeholder="Province">
              @for (p of provinces; track p.code) { <ion-select-option [value]="p.code">{{ p.name }}</ion-select-option> }
            </ion-select></ion-item>
          <ion-item><ion-label position="stacked">Bio</ion-label>
            <ion-textarea lfKeyboard rows="3" [value]="form.bio" (ionInput)="form.bio = $any($event.target).value"></ion-textarea></ion-item>

          <ion-item>
            <ion-label>
              <strong>Let LulaFind match me to cases</strong><br />
              <span class="lf-muted lf-small">We ask you first if your name matches a case.</span>
            </ion-label>
            <ion-toggle [checked]="form.findableProfile" (ionChange)="form.findableProfile = $any($event.detail).checked"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-label>
              <strong>Safety beacon</strong><br />
              <span class="lf-muted lf-small">Send "I am safe" check-ins with your location to people you choose.</span>
            </ion-label>
            <ion-toggle [checked]="form.safetyBeacon" (ionChange)="form.safetyBeacon = $any($event.detail).checked"></ion-toggle>
          </ion-item>

          <h4 class="lf-h2" style="margin:14px 0 6px">What other people see</h4>
          <ion-item>
            <ion-label><strong>Show my town and province</strong></ion-label>
            <ion-toggle [checked]="form.showLocation" (ionChange)="form.showLocation = $any($event.detail).checked"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-label><strong>Show my follower numbers</strong></ion-label>
            <ion-toggle [checked]="form.showStats" (ionChange)="form.showStats = $any($event.detail).checked"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-label><strong>Show my Spotlight communities</strong></ion-label>
            <ion-toggle [checked]="form.showSpotlights" (ionChange)="form.showSpotlights = $any($event.detail).checked"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-label><strong>Let people message me</strong></ion-label>
            <ion-toggle [checked]="form.allowMessages" (ionChange)="form.allowMessages = $any($event.detail).checked"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-label>
              <strong>Ask my followers to check on me</strong><br />
              <span class="lf-muted lf-small">Only if a live location share ends and I have not said I am safe.</span>
            </ion-label>
            <ion-toggle [checked]="form.notifyFollowersOnExpiry" (ionChange)="form.notifyFollowersOnExpiry = $any($event.detail).checked"></ion-toggle>
          </ion-item>
          <ion-item>
            <ion-label>
              <strong>Approve follow requests</strong><br />
              <span class="lf-muted lf-small">
                Off: anyone can follow you straight away. On: they send a request you accept or decline.
              </span>
            </ion-label>
            <ion-toggle [checked]="form.requireFollowApproval"
                        (ionChange)="form.requireFollowApproval = $any($event.detail).checked"></ion-toggle>
          </ion-item>

          <div class="row">
            <button class="lf-btn lf-btn--ghost" (click)="editing.set(false)">Cancel</button>
            <button class="lf-btn lf-btn--primary" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `,
  styles: [`
    .hero { position: relative; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 10px;
      background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .cover { height: 150px; margin: 0 -16px -76px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--lf-primary) 55%, var(--lf-card)), color-mix(in srgb, var(--lf-primary) 18%, var(--lf-card-2))); }
    .face { position: relative; align-self: flex-start; border: 0; background: transparent; color: inherit; padding: 0; cursor: pointer;
      border-radius: 50%; box-shadow: 0 0 0 4px var(--lf-card); }
    .cam { position: absolute; right: 2px; bottom: 6px; width: 34px; height: 34px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; background: var(--lf-card-2); color: var(--ion-text-color);
      box-shadow: 0 0 0 2px var(--lf-card); }
    .name { display: flex; align-items: center; gap: 6px; margin: 4px 0 2px; font-size: 24px; font-weight: 700; letter-spacing: -.3px; }
    .name lf-icon { color: var(--lf-primary); }
    .bio { margin: 0; font-size: 15px; line-height: 1.34; }
    .actions { display: flex; gap: 8px; }
    .actions .lf-btn { flex: 1; }
    .actions .icon-only { flex: 0 0 44px; padding: 0; }
    .status { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; padding: 6px 10px; flex-wrap: wrap;
      border-radius: 6px; font-size: 13px; font-weight: 600;
      background: color-mix(in srgb, var(--lf-marigold) 18%, transparent); }
    .clear { border: 0; background: transparent; color: var(--lf-link); font-weight: 600; font-size: 13px; cursor: pointer; }
    .status.safe, .status[data-status="safe"] { background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; }
    .stats div, .stats button { display: flex; align-items: center; gap: 4px; min-height: 40px;
      border: 0; background: transparent; color: inherit; padding: 0 6px; margin: -10px -6px; cursor: pointer; font-family: inherit; }
    .stats strong { font-size: 15px; font-weight: 700; }
    .stats span { font-size: 15px; color: var(--lf-muted); }
    .menu-tabs { margin-top: 8px; }
    .menu-tabs .tab { flex: 1; }
    .menu-panel { padding-bottom: 8px; }
    .quick { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 0 var(--lf-gap) 8px; }
    .q { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px;
      border-radius: var(--lf-radius); border: 0; background: var(--lf-card); box-shadow: var(--lf-shadow);
      color: inherit; text-decoration: none; text-align: left; font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
    .q:active { background: var(--lf-hover); }
    .q .lf-badge { position: absolute; top: 12px; right: 12px; }
    .qi { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .qi-blue { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .qi-green { background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); color: var(--lf-ubuntu); }
    .qi-yellow { background: color-mix(in srgb, var(--lf-marigold) 20%, transparent); color: #c98f00; }
    .qi-green { background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); color: var(--lf-ubuntu); }
    .qi-red { background: color-mix(in srgb, var(--lf-signal) 14%, transparent); color: var(--lf-signal-text); }
    .qi-grey { background: var(--lf-card-2); color: var(--ion-text-color); }
    .qi-purple { background: color-mix(in srgb, #a33bc2 16%, transparent); color: #a33bc2; }
    .qi-teal { background: color-mix(in srgb, #1bb5a3 16%, transparent); color: #12998a; }
    .q .lf-count { position: absolute; top: 14px; right: 14px; font-style: normal; font-size: 13px; color: var(--lf-muted); font-weight: 600; }
    .see-all { color: var(--lf-link); font-size: 15px; font-weight: 600; text-decoration: none; }
    .tabs { display: flex; gap: 8px; padding: 0 var(--lf-gap) 10px; overflow-x: auto; scrollbar-width: none; }
    .tab { height: 36px; padding: 0 14px; border-radius: 999px; border: 0; background: var(--lf-card-2);
      color: var(--ion-text-color); font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer; white-space: nowrap; }
    .tab.on { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); border-color: transparent; }
    @media (min-width: 700px) {
      .hero { max-width: var(--lf-maxw); margin: 0 auto; border-radius: 0 0 var(--lf-radius) var(--lf-radius); overflow: hidden; }
      .quick, .tabs { max-width: var(--lf-maxw); margin: 0 auto; box-sizing: border-box; }
    }
    .requests { margin: 8px var(--lf-gap) 0; padding: 12px; border-radius: var(--lf-radius);
      background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .requests h3 { display: flex; align-items: center; gap: 7px; margin: 0; }
    .req { display: flex; align-items: center; gap: 9px; padding: 9px 0; border-top: 1px solid var(--lf-line); }
    .req strong { display: block; font-size: 14px; }
    .req span { display: block; }
    .field-err { color: var(--lf-signal-text); font-size: 12px; font-weight: 600; margin: -2px 0 6px 4px; }
    .ident-lock { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin: 4px 0 8px;
      border-radius: 8px; border: 1px dashed var(--lf-line); background: var(--lf-card-2); }
    .ident-lock .k { display: block; font-size: 11px; color: var(--lf-muted); font-weight: 700; }
    .ident-lock lf-icon { margin-left: auto; color: var(--lf-muted); }
    .err { display: flex; align-items: center; gap: 8px; color: var(--lf-signal-text); font-size: 13px; margin: 6px 0 0; }
    ion-item.bad { --border-color: var(--lf-signal); box-shadow: inset 0 0 0 1.5px var(--lf-signal); }
    .sheet { padding: 20px var(--lf-gap) 34px; }
    .row { display: flex; gap: 10px; margin-top: 18px; }
    .row .lf-btn { flex: 1; }
  `]
})
export class MeComponent {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private toast = inject(ToastController);
  private safety = inject(SafetyService);
  private media = inject(MediaService);
  private alert = inject(AlertController);
  private actionSheet = inject(ActionSheetController);
  protected mod = inject(ModerationService);

  protected readonly compact = compact;
  protected readonly provinceName = provinceName;
  protected readonly provinces = PROVINCES;
  protected readonly contributorLabel = contributorLabel;
  readonly mostNamed = signal(false);

  editing = signal(false);
  /** The pending requests with each requester's profile attached. */
  readonly requestPeople = computed(() =>
    this.data.followRequests().map((r) => ({ id: r.followerId, u: this.data.authorOf(r.followerId) ?? null }))
  );

  async respond(followerId: string, accept: boolean): Promise<void> {
    try {
      await this.data.respondToFollowRequest(followerId, accept);
      await this.toast.create({
        message: accept ? 'Accepted. They can follow you now.' : 'Request declined.',
        duration: 1800, position: 'bottom'
      }).then((t) => t.present());
    } catch (e: any) {
      await this.toast.create({ message: e?.message ?? 'Could not update the request', duration: 2200, position: 'bottom' })
        .then((t) => t.present());
    }
  }

  readonly menuTab = signal<'shortcuts' | 'posts' | 'saved'>('shortcuts');
  readonly menuTabs = [
    { key: 'shortcuts' as const, label: 'All shortcuts' },
    { key: 'posts' as const, label: 'Posts' },
    { key: 'saved' as const, label: 'Saved' }
  ];

  form = {
    displayName: '', handle: '', surname: '', town: '',
    province: 'GP' as ProvinceCode, bio: '', findableProfile: true, safetyBeacon: false,
    showLocation: false, showStats: true, showSpotlights: true, allowMessages: true,
    notifyFollowersOnExpiry: true, requireFollowApproval: false
  };

  readonly me = computed(() => this.auth.user());
  readonly avatar = computed(() => this.data.avatarFor(this.me()));
  readonly location = computed(() => this.auth.locationLabel(this.me()));
  /** The viewer's own posts at every stage - see DataService.myPosts. */
  readonly myPosts = computed(() => this.data.myPosts());
  readonly visible = computed(() => this.menuTab() === 'saved' ? this.data.savedPosts() : this.myPosts());

  constructor() {
    this.syncForm();
    void this.loadRequests();
    void this.loadBadge();
    void this.data.loadSaved();
  }

  /**
   * Pull the pending requests, then make sure each requester's profile is in
   * the author cache so the row can show a name and a picture.
   */
  private async loadRequests(): Promise<void> {
    await this.data.loadFollowRequests();
    for (const r of this.data.followRequests()) {
      if (!this.data.authorOf(r.followerId)) {
        const u = await this.data.profile(r.followerId);
        if (u) this.data.touchAuthor(u);
      }
    }
  }

  private syncForm(): void {
    const u = this.me();
    if (!u) return;
    const p = u.privacy ?? defaultPrivacy();
    this.form = {
      displayName: u.displayName, handle: u.handle, surname: u.surname, town: u.town,
      province: u.province ?? 'GP', bio: u.bio, findableProfile: u.findableProfile, safetyBeacon: u.safetyBeacon,
      showLocation: p.showLocation, showStats: p.showStats, showSpotlights: p.showSpotlights,
      allowMessages: p.allowMessages, notifyFollowersOnExpiry: p.notifyFollowersOnExpiry,
      requireFollowApproval: p.requireFollowApproval
    };
  }

  emptyTitle(): string {
    return this.menuTab() === 'saved' ? 'Nothing saved yet' : 'You have not posted yet';
  }

  emptyMessage(): string {
    return this.menuTab() === 'saved'
      ? 'Posts you save from the feed will show up here.'
      : 'Anything you post shows up here instantly.';
  }

  emptyActionLabel(): string {
    return this.menuTab() === 'saved' ? 'Browse the feed' : 'Create a post';
  }

  emptyAction(): void {
    if (this.menuTab() === 'saved') void this.router.navigateByUrl('/home');
    else this.create();
  }

  touched = { name: false };
  readonly saving = signal(false);
  readonly formError = signal('');
  /** loaded once when the sheet opens, so typing stays instant */
  readonly handles = signal<string[]>([]);

  nameOk(): boolean {
    return parseFullName(this.form.displayName) !== null;
  }

  nameError(): string {
    return this.nameOk() ? '' : 'Enter your first name and surname';
  }

  /** Locked. Changes only when the second name changes. */
  lockedHandle(): string {
    const me = this.me();
    return this.auth.previewHandle(this.form.displayName, this.handles(), me?.handle ?? '', me?.surname ?? '');
  }

  /** Called when the edit sheet opens. */
  async prepareEdit(): Promise<void> {
    this.touched = { name: false };
    this.formError.set('');
    this.handles.set(await this.data.allHandles());
  }

  async addPhoto(): Promise<void> {
    if (this.saving()) return;
    this.formError.set('');
    const sheet = await this.actionSheet.create({
      header: 'Profile photo',
      buttons: [
        { text: 'Take a photo', icon: 'camera', handler: () => { void this.pickProfilePhoto('camera'); } },
        { text: 'Choose from photos', icon: 'image', handler: () => { void this.pickProfilePhoto('gallery'); } },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  private async pickProfilePhoto(source: 'camera' | 'gallery'): Promise<void> {
    const item = await this.media.pickImage({ source, quality: 70 });
    const notice = this.media.notice();
    if (!item) {
      const message = this.media.lastError() || notice;
      if (message) {
        this.formError.set(message);
        await this.toast.create({ message, duration: 2600, position: 'bottom' }).then((x) => x.present());
      }
      return;
    }
    this.saving.set(true);
    try {
      if (notice) await this.toast.create({ message: notice, duration: 2800, position: 'bottom' }).then((x) => x.present());
      // 360px is plenty for a round avatar and keeps the profile row small.
      const src = await this.media.compress(item.src, 360);
      await this.auth.updateProfile({ avatarUrl: src });
      this.data.touchAuthor(this.me()!);
      await this.toast.create({ message: 'Profile photo saved', duration: 1400, position: 'bottom' }).then((x) => x.present());
    } catch (e: any) {
      // Never claim success when the write did not land.
      const message = e?.message ?? 'Could not save the photo. Try a smaller picture.';
      this.formError.set(message);
      await this.toast.create({ message, duration: 2800, position: 'bottom' }).then((x) => x.present());
    } finally {
      this.saving.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    this.formError.set('');
    this.saving.set(true);
    try {
      await this.auth.updateProfile({ avatarUrl: '' });
      this.data.touchAuthor(this.me()!);
    } catch (e: any) {
      this.formError.set(e?.message ?? 'Could not remove the photo.');
    } finally {
      this.saving.set(false);
    }
  }

  async save(): Promise<void> {
    this.formError.set('');
    this.saving.set(true);
    try {
      const {
        showLocation, showStats, showSpotlights, allowMessages,
        notifyFollowersOnExpiry, requireFollowApproval
      } = this.form;
      await this.auth.updateProfile({
        town: this.form.town.trim(),
        province: this.form.province,
        bio: this.form.bio.trim(),
        findableProfile: this.form.findableProfile,
        safetyBeacon: this.form.safetyBeacon,
        privacy: {
          /* keep every choice this form does not show - the safety-post
             settings live in the Safety centre and must survive an edit here. */
          ...defaultPrivacy(), ...(this.me()?.privacy ?? {}),
          showLocation, showStats, showSpotlights, allowMessages,
          autoShareLocation: false, notifyFollowersOnExpiry, requireFollowApproval
        }
      });
      this.data.touchAuthor(this.me()!);
      this.editing.set(false);
      void this.loadBadge();
      // Re-read the row so the screen shows what the database actually holds.
      void this.data.refreshProfile(this.me()!.id);
      await this.toast.create({ message: 'Profile saved', duration: 1600, position: 'bottom' }).then((t) => t.present());
    } catch (e: any) {
      this.formError.set(e?.message ?? 'Could not save your profile');
    } finally {
      this.saving.set(false);
    }
  }

  private async loadBadge(): Promise<void> {
    const n = this.me()?.contributorCredits ?? 0;
    if (n <= 0) { this.mostNamed.set(false); return; }
    this.mostNamed.set(n >= await this.data.topContributorCount());
  }

  readonly isAdmin = computed(() => this.auth.user()?.isAdmin === true);

  protected readonly ringKey = RING_KEY;

  async clearStatus(): Promise<void> {
    await this.safety.clearCheckIn();
    const t = await this.toast.create({ message: 'Check-in cleared. The ring is gone.', duration: 1600, position: 'bottom' });
    await t.present();
  }

  statusLine(): string {
    const c = this.me()?.checkIn;
    if (!c) return '';
    const copy = CHECK_IN_COPY[c.status];
    const label = `${copy.ring} · ${copy.short}`;
    return c.liveShareOn ? `${label} · sharing live location` : label;
  }

  people = signal<'followers' | 'following' | null>(null);
  peopleRows = signal<UserProfile[]>([]);

  async openPeople(kind: 'followers' | 'following'): Promise<void> {
    this.people.set(kind);
    const ids = kind === 'followers' ? this.data.followerIds() : this.data.followingIds();
    this.peopleRows.set(await this.data.people(ids));
  }

  async unfollow(id: string): Promise<void> {
    try {
      await this.data.toggleFollow(id);
      await this.openPeople('following');
    } catch (e: unknown) {
      await this.toast.create({ message: e instanceof Error ? e.message : 'Could not unfollow', duration: 2200, position: 'bottom' }).then((x) => x.present());
    }
  }

  async shareProfile(): Promise<void> {
    const u = this.me();
    if (!u) return;
    await this.platform.share(`${u.displayName} on LulaFind`, `Follow ${u.displayName} on LulaFind`, this.platform.link(`/user/${u.id}`));
  }

  async vote(p: Post, v: ReactionKind): Promise<void> {
    try { await this.data.vote(p.id, v); } catch { /* DataService restored every cached list. */ }
  }

  open(p: Post): void {
    void this.router.navigate(['/post', p.id]);
  }

  more(p: Post): void {
    void this.router.navigate(['/post', p.id]);
  }

  async share(p: Post): Promise<void> {
    await this.platform.share(p.title, `${p.title}\n\nShared from LulaFind`, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id);
  }

  create(): void {
    void this.router.navigate(['/create']);
  }

  createStory(): void {
    void this.router.navigate(['/create-story']);
  }

  goAuth(): void {
    void this.router.navigate(['/auth']);
  }

  async signOut(): Promise<void> {
    const a = await this.alert.create({
      header: 'Sign out?',
      message: 'Your posts stay live. You can sign back in any time.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Sign out', role: 'destructive', handler: () => void this.auth.signOut() }
      ]
    });
    await a.present();
  }
}
