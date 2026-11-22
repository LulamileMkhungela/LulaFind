import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';




import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { ReactionKind } from '../../core/models/types';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { PostCardComponent } from '../../shared/components/post-card.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { PlatformService } from '../../core/services/platform.service';
import { ModerationService } from '../../core/services/moderation.service';
import { LookoutService } from '../../core/services/lookout.service';
import { SafetyService, CHECK_IN_COPY } from '../../core/services/safety.service';
import { lastSeenOf } from '../../core/utils/lookout';
import {
  BADGES, earnedBadges, impactOf, pointsOf, progressFor
} from '../../core/models/impact';
import { CheckInStatus, Post, UserProfile, provinceName } from '../../core/models/types';
import { compact, contributorLabel, dayMonth, timeAgo } from '../../core/utils/format';
import { cover } from '../../core/data/seed';

@Component({
  selector: 'lf-profile',
  standalone: true,
  imports: [IonContent, IonSkeletonText, RouterLink, IconComponent, AvatarComponent, EmptyComponent, PostCardComponent, TopNavComponent],
  template: `
    <lf-top-nav [title]="u()?.displayName ?? 'Profile'" backTo="/home" />

    <ion-content class="lf-page">
      <div class="page-title">
        <h1>Profile</h1>
        <button class="lf-icon-btn" (click)="more()" aria-label="More"><lf-icon name="more" [size]="20" /></button>
      </div>
      @if (!u()) {
        <div class="lf-card"><ion-skeleton-text style="height:200px"></ion-skeleton-text></div>
      } @else {
        <div class="hero" [attr.data-status]="checkIn()?.status ?? null">
          <img class="banner" [src]="banner()" alt="" />
          <div class="ident">
            <lf-avatar [src]="avatar()" [name]="u()!.displayName" [size]="82"
               [status]="checkIn()?.status ?? null" />
            <h1 class="lf-h2">
              {{ u()!.displayName }}
              @if (u()!.verified) {
                <span class="tick" role="img" title="Verified member" aria-label="Verified member">
                  <lf-icon name="award" [size]="16" [filled]="true" />
                </span>
              }
              @if (u()!.isAdmin) { <span class="lf-chip lf-chip--success lf-tiny">admin</span> }
              @if (u()!.suspended) { <span class="lf-chip lf-chip--danger lf-tiny">suspended</span> }
            </h1>
            <div class="lf-meta">&#64;{{ u()!.handle }}@if (showLocation()) { · {{ location() }} }</div>
            @if (contributorLabel(u()!.contributorCredits)) {
              <span class="lf-contrib" [class.top]="mostNamed()">{{ contributorLabel(u()!.contributorCredits) }}</span>
            }
            @if (u()!.bio) { <p class="bio">{{ u()!.bio }}</p> }

            @if (showStats()) {
              <div class="stats">
                <div><strong>{{ compact(u()!.followers) }}</strong><span>followers</span></div>
                <div><strong>{{ compact(u()!.following) }}</strong><span>following</span></div>
                <!--
                  One number, one meaning. This used to print karma - a field
                  nothing ever incremented - while the level below it came from a
                  different tally, so a member could show 347 help points and
                  "Level 1, Neighbour" at the same time. The points shown here are
                  the points the level is calculated from.
                -->
                <div><strong>{{ compact(points()) }}</strong><span>impact points</span></div>
                <div><strong>{{ posts().length }}</strong><span>posts</span></div>
              </div>

              <!--
                On your own profile the level is a door to your impact; on
                someone else's it is one line of context, never a comparison.
                Both go through showStats, so a member who hid their numbers
                hides this too - there is no side channel to what they turned off.
              -->
              @if (isMe()) {
                <a class="level" routerLink="/progress">
                  <lf-icon name="sparkle" [size]="16" />
                  <span class="level__name">Level {{ progress().level.level }} · {{ progress().level.name }}</span>
                  <span class="level__pts">{{ myPoints() }} pts</span>
                  <lf-icon name="chevronRight" [size]="15" />
                </a>
              } @else if (theirLevel(); as lvl) {
                <p class="level level--static">
                  <lf-icon name="sparkle" [size]="15" />
                  <span class="level__name">Level {{ lvl.level.level }} · {{ lvl.level.name }}</span>
                  @if (lvl.next) { <span class="level__pts">{{ lvl.toNext }} to {{ lvl.next.name }}</span> }
                </p>
              }

              <!-- The badges a person actually earned. Locked ones are not listed
                   on someone else's profile: a wall of grey is a nag, not a welcome. -->
              @if (badges().length) {
                <div class="badge-row" [attr.aria-label]="isMe() ? 'Your badges' : 'Badges earned'">
                  @for (b of shownBadges(); track b.id) {
                    <span class="badge-pill" [title]="b.how">
                      <lf-icon [name]="b.icon" [size]="13" /> {{ b.name }}
                    </span>
                  }
                  @if (isMe()) {
                    <a class="badge-more" routerLink="/progress">See all {{ allBadges().length }}</a>
                  } @else if (moreBadges() > 0) {
                    <a class="badge-more" [routerLink]="'/progress'" aria-label="All badges">+{{ moreBadges() }} more</a>
                  }
                </div>
              }
            }

            <!-- safety status -->
            @if (checkIn()) {
              <div class="checkin" [class.safe]="checkIn()!.status === 'safe'"
                   [class.warn]="checkIn()!.status === 'unfamiliar'" [class.bad]="checkIn()!.status === 'need_help'">
                <lf-icon [name]="checkIn()!.status === 'safe' ? 'check' : checkIn()!.status === 'unfamiliar' ? 'map' : 'alert'" [size]="18" />
                <div class="lf-grow">
                  <strong>{{ checkInLabel() }}</strong>
                  <span class="lf-small">{{ timeAgo(checkIn()!.at) }}@if (checkIn()!.note) { · {{ checkIn()!.note }} }</span>
                  @if (checkIn()!.liveShareOn && checkIn()!.location) {
                    <span class="lf-small live">
                      <lf-icon name="target" [size]="12" /> sharing live location
                      @if (isMe()) { · {{ liveLeft() }} left }
                    </span>
                  }
                </div>
              </div>
            }

            <!-- last seen: the same for everyone who looks at this profile -->
            @if (lastSeen()) {
              <div class="lastseen" [class.bad]="lastSeen()!.status === 'need_help'">
                <lf-icon name="target" [size]="18" />
                <div class="lf-grow">
                  <strong>Last seen {{ timeAgo(lastSeen()!.at) }}</strong>
                  <span class="lf-small">
                    @if (lastSeen()!.place) { {{ lastSeen()!.place }} · }
                    @else { Place not shared · }
                    last check-in said "{{ statusWord(lastSeen()!.status) }}"
                  </span>
                </div>
              </div>
            }

            <!-- an open lookout about this person -->
            @if (openLookout()) {
              <a class="lookout" [class.bad]="openLookout()!.status === 'escalated'" [routerLink]="'/lookout/' + openLookout()!.id">
                <lf-icon name="shield" [size]="18" />
                <div class="lf-grow">
                  <strong>{{ lookoutHeadline() }}</strong>
                  <span class="lf-small">{{ lookoutSub() }}</span>
                </div>
                <lf-icon name="chevronRight" [size]="16" />
              </a>
            }

            <div class="acts">
              @if (!isMe()) {
                <button class="lf-btn lf-btn--sm" [class.lf-btn--ghost]="following() || followRequested()" (click)="toggleFollow()">
                  <lf-icon [name]="following() ? 'check' : followRequested() ? 'clock' : 'plus'" [size]="15" />
                  {{ following() ? 'Following' : followRequested() ? 'Requested' : 'Follow' }}
                </button>
                <button class="lf-btn lf-btn--sm" (click)="share()"><lf-icon name="share" [size]="15" /> Share</button>
                @if (canMessage()) {
                  <button class="lf-btn lf-btn--sm lf-btn--ghost" (click)="message()"><lf-icon name="chat" [size]="15" /> Message</button>
                }
              } @else {
                <button class="lf-btn lf-btn--sm lf-btn--ghost" routerLink="/me"><lf-icon name="edit" [size]="15" /> Edit profile</button>
                @if (openLookout()) {
                  <a class="lf-btn lf-btn--sm lf-btn--primary" [routerLink]="'/lookout/' + openLookout()!.id">
                    <lf-icon name="shield" [size]="15" /> I'm here
                  </a>
                } @else {
                  <a class="lf-btn lf-btn--sm lf-btn--primary" routerLink="/safety">
                    <lf-icon name="shield" [size]="15" /> Be on the lookout
                  </a>
                }
                <button class="lf-btn lf-btn--sm lf-btn--ghost" (click)="checkInSheet()">
                  <lf-icon name="target" [size]="15" /> More options
                </button>
              }
            </div>
            @if (isMe()) {
              <div class="quick">
                <span class="quick-label">How are you right now?</span>
                <div class="quick-row">
                  <button class="quickbtn safe" [class.on]="checkIn()?.status === 'safe'"
                          [disabled]="saving()" (click)="quickCheckIn('safe')">
                    <lf-icon name="check" [size]="17" /> I am safe
                  </button>
                  <button class="quickbtn help" [class.on]="checkIn()?.status === 'need_help'"
                          [disabled]="saving()" (click)="quickCheckIn('need_help')">
                    <lf-icon name="alert" [size]="17" /> I need help
                  </button>
                </div>
                @if (saving()) { <p class="lf-small lf-muted" style="margin:2px 0 0">Saving…</p> }
                @if (checkInError() && !saving()) { <p class="err">{{ checkInError() }}</p> }
              </div>
            }
          </div>
        </div>

        @if (showSpotlights() && spotlights().length) {
          <h3 class="section">Spotlight communities</h3>
          <div class="lf-scroller">
            @for (s of spotlights(); track s.id) {
              <a class="sp" [routerLink]="'/spotlight/' + s.id">
                <strong>{{ s.surname }}</strong>
                <span>{{ s.postIds.length }} posts</span>
              </a>
            }
          </div>
        }

        <h3 class="section">Posts</h3>
        @if (postsLoading()) {
          <p class="lf-muted lf-small">Loading posts…</p>
        } @else if (!posts().length) {
          <lf-empty icon="book" title="No public posts yet" message="Posts set to followers-only or spotlight-only will not appear here." />
        }
        @for (p of posts(); track p.id) {
          <lf-post-card [post]="p" [author]="u()!" chatState="off"
                        (vote)="vote(p, $event)" (comment)="open(p)" />
        }
      }
    </ion-content>

    @if (checking()) {
      <div class="sheetwrap" (click)="checking.set(false)">
        <div class="sheet" (click)="$event.stopPropagation()">
          <div class="lf-row-between">
            <h3 class="lf-h2">How are you?</h3>
            <button class="lf-icon-btn" (click)="checking.set(false)"><lf-icon name="x" [size]="20" /></button>
          </div>
          <p class="lf-small lf-muted">
            Your answer shows on your profile. You do not have to set one. Nothing is shared unless you choose to.
          </p>
          <div class="choices">
            @for (c of checkInOptions; track c.key) {
              <button class="choice" [class.on]="picked() === c.key" (click)="picked.set(c.key)">
                <lf-icon [name]="c.icon" [size]="20" />
                <span><strong>{{ c.label }}</strong><small>{{ c.detail }}</small></span>
              </button>
            }
          </div>
          <label class="row-check">
            <input type="checkbox" [checked]="shareLocation()" (change)="shareLocation.set($any($event.target).checked)" />
            <span>Attach where I am now</span>
          </label>
          <label class="row-check">
            <input type="checkbox" [checked]="live()" (change)="live.set($any($event.target).checked)" />
            <span>Share my live location for 1 hour (it stops by itself)</span>
          </label>
          @if (checkInError()) { <p class="err">{{ checkInError() }}</p> }
          <div class="row">
            <button class="lf-btn lf-btn--ghost" (click)="clearStatus()">Clear my status</button>
            <button class="lf-btn lf-btn--primary" [disabled]="!picked() || safetyBusy()" (click)="doCheckIn()">
              {{ safetyBusy() ? 'Saving…' : 'Check in' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .hero { position: relative; }
    .banner { width: 100%; height: 132px; object-fit: cover; display: block; }
    .ident { padding: 0 var(--lf-gap) 16px; margin-top: -42px; display: flex; flex-direction: column; gap: 8px; }
    .ident h1 { display: flex; align-items: center; gap: 6px; margin: 0; flex-wrap: wrap; }
    .ident h1 lf-icon { color: var(--lf-beacon); }
    .bio { margin: 0; font-size: 14px; line-height: 1.5; }
    .stats { display: flex; gap: 18px; }
    .stats div { display: flex; flex-direction: column; }
    .stats strong { font-size: 17px; }
    .stats span { font-size: 11.5px; color: var(--lf-muted); }
    /* The level line: a door on your own profile, one quiet fact on anyone else's. */
    .level { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 11px; border-radius: 999px;
      background: color-mix(in srgb, var(--lf-primary) 10%, transparent); color: var(--ion-text-color);
      font-size: 13px; font-weight: 650; text-decoration: none; align-self: flex-start; }
    .level lf-icon { color: var(--lf-primary); }
    .level__name { white-space: nowrap; }
    .level__pts { margin-left: auto; font-weight: 600; font-size: 12.5px; color: var(--lf-muted); font-variant-numeric: tabular-nums; }
    .level--static { background: none; padding: 4px 0 0; border-radius: 0; color: var(--lf-muted); font-weight: 600; }
    .level--static lf-icon { color: var(--lf-signal); }
    .badge-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .badge-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px;
      font-size: 12px; font-weight: 650; background: var(--lf-card); border: 1px solid var(--lf-line);
      color: var(--ion-text-color); }
    .badge-pill lf-icon { color: var(--lf-signal); }
    .badge-more { font-size: 12.5px; font-weight: 650; align-self: center; color: var(--lf-primary); text-decoration: none; }
    .quick { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding: 12px 13px;
      border-radius: var(--lf-radius); background: var(--lf-card); border: 0; box-shadow: var(--lf-shadow); }
    .quick-label { font-size: 12.5px; font-weight: 700; color: var(--lf-muted); }
    .quick-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .quickbtn { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      min-height: 46px; border-radius: 12px; border: 1.5px solid var(--lf-line);
      background: transparent; color: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
    .quickbtn:active { transform: scale(.98); }
    .quickbtn.safe { border-color: var(--lf-ubuntu); color: var(--lf-ubuntu); }
    .quickbtn.safe.on { background: var(--lf-ubuntu); color: #fff; border-color: var(--lf-ubuntu); }
    .quickbtn.help { border-color: var(--lf-signal); color: var(--lf-signal-text); }
    .quickbtn.help.on { background: var(--lf-signal); color: #fff; border-color: var(--lf-signal); }
    .quickbtn:disabled { opacity: .55; cursor: wait; }
    /* The verified badge beside the name: the same mark the feed card draws. */
    .tick { display: inline-flex; vertical-align: -2px; margin-left: 4px; color: var(--lf-primary); }
    /* The status tick: a small filled disc, the way a verified mark reads. */
    .statustick { display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%; color: #fff; vertical-align: -2px; }
    .statustick[data-key="safe"] { background: var(--lf-ubuntu); }
    .statustick[data-key="need_help"] { background: var(--lf-signal); }
    .statustick[data-key="watch_me"], .statustick[data-key="unfamiliar"] { background: var(--lf-marigold); color: #1a1204; }
    /* The whole profile is tinted by the status, so the colour reads at a glance. */
    .hero[data-status="safe"] { box-shadow: inset 0 3px 0 var(--lf-ubuntu); }
    .hero[data-status="need_help"] { box-shadow: inset 0 3px 0 var(--lf-signal); }
    .hero[data-status="watch_me"], .hero[data-status="unfamiliar"] { box-shadow: inset 0 3px 0 var(--lf-marigold); }
    .checkin { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: 12px;
      background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); }
    .checkin div { display: flex; flex-direction: column; gap: 1px; }
    .checkin.warn { background: color-mix(in srgb, var(--lf-marigold) 18%, transparent); }
    .checkin.bad { background: color-mix(in srgb, var(--lf-signal) 18%, transparent); }
    .checkin .live { display: inline-flex; align-items: center; gap: 5px; color: var(--lf-ubuntu); font-weight: 700; }
    .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .lastseen, .lookout { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: 12px;
      background: var(--lf-card-2); color: inherit; text-decoration: none; }
    .lastseen div, .lookout div { display: flex; flex-direction: column; gap: 1px; }
    .lastseen.bad { background: color-mix(in srgb, var(--lf-signal) 16%, transparent); }
    .lookout { box-shadow: 0 0 0 1px var(--lf-line) inset; }
    .lookout.bad { box-shadow: 0 0 0 2px var(--lf-signal) inset; }
    .section { padding: 16px var(--lf-gap) 6px; font-size: 15px; font-weight: 700; }
    .sp { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); color: inherit; text-decoration: none; min-width: 140px; }
    .sp span { font-size: 11.5px; color: var(--lf-muted); }
    .sheetwrap { position: fixed; inset: 0; z-index: 40; background: var(--lf-scrim);
      display: flex; align-items: flex-end; justify-content: center; }
    .sheet { width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto; background: var(--lf-card);
      border-radius: 18px 18px 0 0; padding: 18px 18px 30px; display: flex; flex-direction: column; gap: 10px; }
    .sheet p { margin: 0; line-height: 1.5; }
    .choices { display: flex; flex-direction: column; gap: 8px; }
    .choice { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px;
      border: 1px solid var(--lf-line); background: var(--lf-card-2); color: inherit; text-align: left; cursor: pointer; }
    .choice.on { border-color: var(--lf-beacon); background: color-mix(in srgb, var(--lf-beacon) 12%, transparent); }
    .choice span { display: flex; flex-direction: column; gap: 2px; }
    .choice small { color: var(--lf-muted); font-size: 12px; line-height: 1.35; }
    .row-check { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--lf-muted); }
    .row-check input { width: 19px; height: 19px; accent-color: var(--lf-beacon); }
    .row { display: flex; gap: 10px; margin-top: 6px; }
    .row .lf-btn { flex: 1; }
    .err { color: var(--lf-signal); font-size: 12.5px; }
  `]
})
export class ProfileComponent implements OnInit {
  protected data = inject(DataService);
  protected auth = inject(AuthService);
  private chat = inject(ChatService);
  private platform = inject(PlatformService);
  private mod = inject(ModerationService);
  private safety = inject(SafetyService);
  private lookouts = inject(LookoutService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  protected readonly compact = compact;
  protected readonly dayMonth = dayMonth;
  protected readonly timeAgo = timeAgo;
  protected readonly contributorLabel = contributorLabel;
  readonly mostNamed = signal(false);
  protected readonly provinceName = provinceName;
  protected statusWord(status: string): string {
    return status === 'need_help' ? 'I need help' : status === 'unfamiliar' ? 'unfamiliar place' : 'safe';
  }
  protected lookoutHeadline(): string {
    const l = this.openLookout();
    if (!l) return '';
    if (l.status === 'escalated') return 'Flagged as a possible missing person';
    if (this.isMe()) return `Your lookout: ${l.area}`;
    if (this.waitingOnMe()) return `Are they okay?`;
    return `Be on the lookout: ${l.area}`;
  }
  protected lookoutSub(): string {
    const l = this.openLookout();
    if (!l) return '';
    if (l.status === 'escalated') return l.escalatedPostId ? 'A case has been opened. Open it to help look.' : 'Followers said something is wrong.';
    if (l.status === 'checking') return `${l.answers.length} of ${l.askedIds.length} followers answered`;
    return `Followers are asked in ${Math.max(0, Math.round((l.checkAt - Date.now()) / 3600000))} h`;
  }

  readonly checkInOptions = [
    { key: 'safe' as CheckInStatus, icon: 'check', label: CHECK_IN_COPY.safe.label, detail: CHECK_IN_COPY.safe.detail },
    { key: 'unfamiliar' as CheckInStatus, icon: 'map', label: CHECK_IN_COPY.unfamiliar.label, detail: CHECK_IN_COPY.unfamiliar.detail },
    { key: 'need_help' as CheckInStatus, icon: 'alert', label: CHECK_IN_COPY.need_help.label, detail: CHECK_IN_COPY.need_help.detail }
  ];

  u = signal<UserProfile | null>(null);
  following = signal(false);
  followRequested = signal(false);
  checking = signal(false);
  picked = signal<CheckInStatus | null>(null);
  shareLocation = signal(false);
  live = signal(false);
  private tick = signal(0);

  readonly isMe = computed(() => this.u()?.id === this.auth.viewerId);

  /**
   * Levels are public only as far as the member's own privacy allows: the same
   * `showStats` switch that hides followers and points hides these, because
   * a hidden number with a visible level next to it is still the number.
   */
  readonly myImpact = computed(() => this.data.myImpact());
  readonly myPoints = computed(() => this.data.myPoints());
  readonly progress = computed(() => progressFor(this.myPoints()));
  /** The single number behind the level, for the person whose profile this is. */
  readonly points = computed(() => (this.isMe() ? this.data.myPoints() : pointsOf(this.u())));

  readonly theirLevel = computed(() => {
    const u = this.u();
    if (!u || this.isMe()) return null;
    return progressFor(pointsOf(u));
  });
  /**
   * Four badges is a summary; twelve is a CV. On your own profile the rest is one
   * tap away, and on someone else's a count is enough to know there is more.
   */
  readonly shownBadges = computed(() => (this.isMe() ? this.badges() : this.badges().slice(0, 4)));
  readonly moreBadges = computed(() => Math.max(0, this.badges().length - 4));

  readonly badges = computed(() => {
    const u = this.u();
    if (!u || u.privacy?.showStats === false) return [];
    return earnedBadges(impactOf(u), { found: u.contributorCredits ?? 0 });
  });
  readonly allBadges = computed(() => BADGES);
  readonly avatar = computed(() => this.data.avatarFor(this.u()));
  readonly banner = computed(() => cover(this.u()?.surname || this.u()?.displayName || 'LulaFind'));
  readonly location = computed(() => this.auth.locationLabel(this.u()));
  /**
   * Loaded from the database in `ngOnInit`, not by filtering the viewer's
   * feed: the feed is audience-filtered, so someone else's profile used to
   * show "0 posts" even when they had written plenty.
   */
  readonly posts = signal<Post[]>([]);
  readonly postsLoading = signal(false);
  readonly spotlights = computed(() => {
    const id = this.u()?.id;
    return id ? this.data.spotlights().filter((s) => s.memberIds.includes(id)) : [];
  });

  /** Privacy: only show what this person allows. */
  readonly showLocation = computed(() => this.isMe() || this.u()?.privacy?.showLocation === true);
  readonly showStats = computed(() => this.isMe() || this.u()?.privacy?.showStats !== false);
  readonly showSpotlights = computed(() => this.isMe() || this.u()?.privacy?.showSpotlights !== false);
  readonly canMessage = computed(() => !this.u()?.suspended && this.u()?.privacy?.allowMessages !== false);

  readonly checkIn = computed(() => {
    void this.tick();
    return this.safety.visibleCheckIn(this.u(), this.auth.viewerId);
  });

  /** Local to the quick buttons so they react the instant you tap. */
  readonly saving = signal(false);

  /** The open lookout about this person, if there is one. */
  readonly openLookout = computed(() => {
    const id = this.u()?.id;
    return id ? this.lookouts.openLookoutFor(id) : null;
  });
  readonly waitingOnMe = computed(() => {
    const me = this.auth.viewerId;
    return !!me && this.openLookout()?.askedIds.includes(me) && !this.lookouts.hasAnswered(this.openLookout()!, me);
  });

  /**
   * Last seen, shown to every viewer.
   *
   * If this person has ever checked in, everyone can see when, and whether the
   * check-in said they were safe or needed help. The place follows the
   * person's own setting; the time never hides.
   */
  readonly lastSeen = computed(() => {
    void this.tick();
    const u = this.u();
    if (!u) return null;
    if (!this.data.canSeeStatus(u, this.auth.viewerId)) return null;
    const canSeePlace = this.isMe() || u.privacy?.showLastSeen !== false;
    return lastSeenOf(u, this.openLookout(), { canSeePlace });
  });

  readonly safetyBusy = computed(() => this.safety.busy());
  readonly checkInError = computed(() => this.safety.error());

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.u.set((await this.data.profile(id)) ?? null);
    const [followState] = await Promise.all([this.data.followStatus(id), this.loadPosts(id)]);
    this.following.set(followState === 'accepted');
    this.followRequested.set(followState === 'pending');
    await this.loadBadge();
  }

  private async loadPosts(id: string): Promise<void> {
    this.postsLoading.set(true);
    try {
      this.posts.set(await this.data.postsByAuthor(id));
    } catch {
      this.posts.set([]);
    } finally {
      this.postsLoading.set(false);
    }
  }

  private async loadBadge(): Promise<void> {
    const n = this.u()?.contributorCredits ?? 0;
    if (n <= 0) { this.mostNamed.set(false); return; }
    this.mostNamed.set(n >= await this.data.topContributorCount());
  }

  /** Icon shown in the tick beside the name, one per status. */
  statusIcon(status: string): string {
    return status === 'need_help' ? 'alert' : status === 'watch_me' ? 'eye' : status === 'unfamiliar' ? 'map' : 'check';
  }

  checkInLabel(): string {
    const s = this.checkIn()?.status;
    return s ? `${CHECK_IN_COPY[s].ring} · ${CHECK_IN_COPY[s].short}` : '';
  }

  liveLeft(): string {
    const until = this.checkIn()?.liveUntil;
    if (!until) return '';
    const secs = Math.max(0, Math.round((until - Date.now()) / 1000));
    const m = Math.floor(secs / 60);
    return `${m}:${String(secs % 60).padStart(2, '0')}`;
  }

  /**
   * One tap from the profile. No sheet, no extra steps, no location - the two
   * answers people actually need in a hurry. The full sheet stays available for
   * "unfamiliar place", attaching a location and the 1-hour live share.
   */
  async quickCheckIn(status: 'safe' | 'need_help'): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.safety.checkIn({ status });
      this.u.set((await this.data.profile(this.u()!.id)) ?? null);
      await this.say(status === 'safe' ? 'Marked safe. Your ring is green.' : 'Help requested. Your followers are being told.');
    } catch {
      /* the panel under the buttons shows why */
    } finally {
      this.saving.set(false);
    }
  }

  async checkInSheet(): Promise<void> {
    this.picked.set(this.safety.myCheckIn()?.status ?? null);
    this.shareLocation.set(false);
    this.live.set(!!this.safety.myCheckIn()?.liveShareOn);
    this.checking.set(true);
    if (this.live()) this.startTicking();
  }

  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private startTicking(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick.update((n) => n + 1), 1000);
  }

  async doCheckIn(): Promise<void> {
    const status = this.picked();
    if (!status) return;
    try {
      await this.safety.checkIn({ status, shareLocation: this.shareLocation(), live: this.live() });
      this.u.set((await this.data.profile(this.u()!.id)) ?? null);
      this.checking.set(false);
      await this.say(this.live() ? 'Checked in. Your live location stops in 1 hour.' : 'Checked in.');
    } catch {
      /* the sheet shows the reason */
    }
  }

  async clearStatus(): Promise<void> {
    await this.safety.clearCheckIn();
    this.u.set((await this.data.profile(this.u()!.id)) ?? null);
    this.checking.set(false);
    await this.say('Status cleared');
  }

  async toggleFollow(): Promise<void> {
    const u = this.u();
    if (!u) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/user/' + u.id } });
      return;
    }
    try {
      await this.data.toggleFollow(u.id);
      const state = await this.data.followStatus(u.id);
      this.following.set(state === 'accepted');
      this.followRequested.set(state === 'pending');
      const updated = await this.data.refreshProfile(u.id);
      if (updated) this.u.set(updated);
    } catch (e: any) {
      await this.say(e?.message ?? 'Could not follow');
    }
  }

  async message(): Promise<void> {
    const u = this.u();
    if (!u) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth']);
      return;
    }
    const gate = await this.chat.gatePerson(u.id);
    if (!gate.allowed) {
      await this.say(gate.step === 'sign_in' ? 'Sign in to message.' : gate.reason);
      return;
    }
    const thread = await this.chat.ensureThread(null, u.id, 'friend');
    if (thread) await this.router.navigate(['/chats/thread', thread.id]);
  }

  async share(): Promise<void> {
    const u = this.u();
    if (!u) return;
    await this.platform.share(`${u.displayName} on LulaFind`, `${u.displayName} - LulaFind`, this.platform.link(`/user/${u.id}`));
  }

  async vote(p: Post, v: ReactionKind): Promise<void> {
    const saving = this.data.vote(p.id, v);
    this.posts.update((items) => items.map((item) => item.id === p.id ? (this.data.post(p.id) ?? item) : item));
    try { await saving; } catch { /* DataService restored the previous copy. */ }
    this.posts.update((items) => items.map((item) => item.id === p.id ? (this.data.post(p.id) ?? item) : item));
  }

  open(p: Post): void {
    void this.router.navigate(['/post', p.id]);
  }

  async sharePost(p: Post): Promise<void> {
    await this.platform.share(p.title, `${p.title}\n\nShared from LulaFind`, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id);
  }

  async more(): Promise<void> {
    const u = this.u();
    if (!u) return;
    if (this.isMe()) {
      await this.router.navigate(['/me']);
      return;
    }
    const a = await this.alert.create({
      header: u.displayName,
      buttons: [
        { text: 'Share profile', handler: () => void this.share() },
        { text: 'Report this person', role: 'destructive', handler: () => void this.report() },
        ...(this.mod.isAdmin()
          ? [
              { text: u.suspended ? 'Unsuspend (admin)' : 'Suspend (admin)', role: 'destructive' as const, handler: () => void this.suspend(u) },
              { text: 'Remove this person (admin)', role: 'destructive' as const, handler: () => void this.remove(u) }
            ]
          : []),
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await a.present();
  }

  async report(): Promise<void> {
    const u = this.u();
    if (!u) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/user/' + u.id } });
      return;
    }
    const a = await this.alert.create({
      header: `Report ${u.displayName}`,
      message: 'A LulaFind admin reviews every report.',
      inputs: this.mod.reasons.map((r) => ({ name: 'reason', type: 'radio' as const, label: r.label, value: r.id })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send report',
          handler: async (v: any) => {
            try {
              await this.mod.report({ target: 'user', targetId: u.id, summary: u.displayName, reason: v?.reason ?? 'other' });
              await this.say('Report saved for moderation. Email alerts depend on the server configuration.');
            } catch (e: any) {
              await this.say(e?.message ?? 'Could not send the report');
            }
          }
        }
      ]
    });
    await a.present();
  }

  async suspend(u: UserProfile): Promise<void> {
    const a = await this.alert.create({
      header: u.suspended ? 'Lift the suspension?' : 'Suspend this person?',
      inputs: [{ name: 'note', type: 'text', placeholder: 'Reason (they will see this)' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          role: 'destructive',
          handler: async (v: any) => {
            await this.mod.suspendUser(u.id, String(v?.note ?? '').trim() || 'No reason given', !u.suspended);
            this.u.set((await this.data.profile(u.id)) ?? null);
            await this.say(u.suspended ? 'Suspension lifted' : 'Account suspended');
          }
        }
      ]
    });
    await a.present();
  }

  async remove(u: UserProfile): Promise<void> {
    const a = await this.alert.create({
      header: 'Remove this person?',
      message: `${u.displayName} and everything they posted will be deleted.`,
      inputs: [{ name: 'note', type: 'text', placeholder: 'Reason' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async (v: any) => {
            await this.mod.removeUser(u.id, String(v?.note ?? '').trim() || 'No reason given');
            await this.data.refresh();
            await this.router.navigate(['/home']);
          }
        }
      ]
    });
    await a.present();
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }
}
