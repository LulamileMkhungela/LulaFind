import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonSearchbar } from '@ionic/angular/ion-searchbar';
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
import { PlatformService } from '../../core/services/platform.service';
import { MediaService } from '../../core/services/media.service';
import { Post, Spotlight, UserProfile, provinceName } from '../../core/models/types';
import { compact, timeAgo } from '../../core/utils/format';

/**
 * One surname's community, laid out the way LinkedIn lays a group out:
 *
 *   cover banner, with the community's round mark sitting on its bottom edge
 *   name · tagline · "N members · N posts"
 *   Join (or the member's actions) pinned at the end of that header
 *   a sticky tab row: Posts | Members | About
 *   inside Posts: a "Start a post" row for members, then the community feed
 *
 * The one thing that is deliberately not LinkedIn's is what a post is *about*:
 * cases, sightings and updates filed by surname, and anyone may join and post
 * without an approval queue.
 */
@Component({
  selector: 'lf-spotlight-detail',
  standalone: true,
  imports: [
    IonContent, IonSearchbar, IonSkeletonText, RouterLink, IconComponent, AvatarComponent, EmptyComponent,
    PostCardComponent, TopNavComponent
  ],
  template: `
    <lf-top-nav backTo="/spotlight" [title]="sp()?.surname ? sp()!.surname + ' Spotlight' : 'Spotlight'">
      <div lf-nav-end>
        <button class="nav-act" type="button" (click)="share()" aria-label="Share this spotlight">
          <lf-icon name="share" [size]="19" />
        </button>
        @if (owner()) {
          <button class="nav-act" type="button" (click)="menu()" aria-label="Community options">
            <lf-icon name="more" [size]="19" />
          </button>
        }
      </div>
    </lf-top-nav>

    <ion-content class="lf-page">
      @if (!sp()) {
        <div class="lf-card"><ion-skeleton-text style="height:180px"></ion-skeleton-text></div>
      } @else {
        <!-- ── cover + identity, exactly LinkedIn's group header ── -->
        <header class="cover">
          <img class="banner" [src]="coverOf()" [alt]="sp()!.surname + ' cover'" />
          <div class="ident">
            <img class="mark" [src]="coverOf()" alt="" />
            <div class="ident-copy">
              <h1>{{ sp()!.surname }} <span class="tag">Spotlight</span></h1>
              @if (sp()!.verified) { <p class="verified"><lf-icon name="check" [size]="12" /> verified family page</p> }
              <p class="tagline">{{ sp()!.tagline }}</p>
              <p class="counts">
                <strong>{{ compact(sp()!.followers) }}</strong> {{ sp()!.followers === 1 ? 'member' : 'members' }}
                <span class="dot">·</span>
                <strong>{{ all().length }}</strong> {{ all().length === 1 ? 'post' : 'posts' }}
                <span class="dot">·</span>
                {{ sp()!.adminIds.length }} {{ sp()!.adminIds.length === 1 ? 'admin' : 'admins' }}
                @if (sp()!.province) { <span class="dot">·</span> {{ provinceName(sp()!.province ?? undefined) }} }
              </p>
            </div>
          </div>

          <div class="acts">
            @if (!member()) {
              <button class="pill pill--go" type="button" [disabled]="busy()" (click)="join()">
                <lf-icon name="plus" [size]="16" [weight]="2.6" /> {{ busy() ? 'Joining…' : 'Join this community' }}
              </button>
            } @else {
              <button class="pill pill--go" type="button" (click)="postHere()">
                <lf-icon name="plus" [size]="16" [weight]="2.6" /> Post
              </button>
              @if (!owner()) {
                <button class="pill" type="button" (click)="leave()">Leave</button>
              }
              <span class="joined"><lf-icon name="check" [size]="13" [weight]="3" /> Member</span>
            }
          </div>
          <p class="no-approval" role="note">
            {{ member()
              ? 'Members post here straight away - no approval queue.'
              : 'Joining is instant, and you can post as soon as you have joined.' }}
          </p>
          @if (notice()) { <p class="soft-notice" role="status"><lf-icon name="info" [size]="14" /> {{ notice() }}</p> }
        </header>

        <!-- ── tab row, stuck under the app bar the way LinkedIn's is ── -->
        <nav class="tabs" role="tablist" aria-label="Spotlight sections">
          @for (tab of tabs(); track tab.id) {
            <button role="tab" type="button" class="tab" [class.on]="section() === tab.id"
                    [attr.aria-selected]="section() === tab.id" (click)="section.set(tab.id)">
              {{ tab.label }}@if (tab.count !== null) { <span class="tab-count">{{ tab.count }}</span> }
            </button>
          }
        </nav>

        @if (section() === 'posts') {
          @if (member()) {
            <!-- LinkedIn's group composer row: your face, one button, two shortcuts. -->
            <div class="start">
              <lf-avatar [src]="myAvatar()" [name]="myName()" [size]="40" />
              <button type="button" class="start__box" (click)="postHere()">Start a post in {{ sp()!.surname }}</button>
              <div class="start__acts">
                <button type="button" (click)="postWithPhoto()"><lf-icon name="image" [size]="17" /> Photo</button>
                <button type="button" (click)="postHere()"><lf-icon name="edit" [size]="17" /> Write</button>
              </div>
            </div>
          }

          <ion-searchbar class="inside" placeholder="Search inside the {{ sp()!.surname }} spotlight" [debounce]="200"
                         (ionInput)="q.set($any($event.detail).value ?? '')"></ion-searchbar>

          <div class="filters">
            <div class="pills">
              <button class="pill-mini" [class.on]="show() === 'all'" (click)="show.set('all')">All · {{ all().length }}</button>
              <button class="pill-mini" [class.on]="show() === 'active'" (click)="show.set('active')">Still missing</button>
              <button class="pill-mini" [class.on]="show() === 'found'" (click)="show.set('found')">Found</button>
            </div>
            <button class="sort" type="button" (click)="cycleSort()" [attr.aria-label]="'Sort by ' + sortLabel()">
              <lf-icon name="grid" [size]="15" /> Sort: {{ sortLabel() }} <lf-icon name="chevronDown" [size]="13" />
            </button>
          </div>
          <p class="scope">Everything filed here, plus every post about someone with the surname {{ sp()!.surname }}.</p>

          @if (!posts().length) {
            <lf-empty icon="users" [title]="q() ? 'Nothing matches that search' : 'Nothing posted to this spotlight yet'"
                      [message]="member()
                        ? 'Be the first to bring a case, a sighting or an update to the community.'
                        : 'Members post cases and updates here. Join, and you can post too.'"
                      [actionLabel]="member() ? 'Post here' : 'Join and post'"
                      (action)="member() ? postHere() : join()" />
          }
          @for (p of posts(); track p.id) {
            <lf-post-card [post]="p" [author]="data.authorOf(p.authorId) ?? null" chatState="off"
                          (vote)="vote(p, $event)" (comment)="open(p)" />
          }
        } @else if (section() === 'members') {
          <div class="members">
            <div class="members__top">
              <h2>{{ sp()!.memberIds.length }} {{ sp()!.memberIds.length === 1 ? 'member' : 'members' }}</h2>
              <input class="members__search" type="search" placeholder="Search members" [value]="memberQuery()"
                     (input)="memberQuery.set($any($event.target).value)" aria-label="Search members" />
            </div>
            @if (!memberList().length) {
              <p class="members__empty">Nobody by that name is in this community yet.</p>
            }
            @for (row of memberList(); track row.id) {
              <div class="member">
                <lf-avatar [src]="row.avatar" [name]="row.name" [size]="52" />
                <div class="member-copy">
                  <strong>{{ row.name }}</strong>
                  <span>{{ row.headline }}</span>
                  <span class="member-meta">{{ row.meta }}</span>
                </div>
                @if (row.id !== viewerId()) {
                  <button class="pill pill--sm" type="button" [class.on]="row.following" (click)="follow(row.id)">
                    {{ row.following ? 'Following' : '+ Follow' }}
                  </button>
                }
              </div>
            }
          </div>
        } @else {
          <section class="about">
            <h2>About</h2>
            <p class="about__text">{{ sp()!.about || sp()!.tagline }}</p>
            <h3>How this page works</h3>
            <ul class="rules">
              <li><lf-icon name="users" [size]="15" /> Anyone with the surname, and anyone looking for them, can join and post.</li>
              <li><lf-icon name="globe" [size]="15" /> Everything posted here is public unless the writer chooses another audience.</li>
              <li><lf-icon name="shield" [size]="15" /> No money is ever asked for here. Report anyone who asks - the ⋯ menu on their post.</li>
              <li><lf-icon name="check" [size]="15" /> A case closes when the family marks it found. Anyone can post a sighting.</li>
            </ul>
            <h3>Admins</h3>
            <div class="admins">
              @for (a of admins(); track a.id) {
                <a class="admin" [routerLink]="'/user/' + a.id">
                  <lf-avatar [src]="a.avatar" [name]="a.name" [size]="40" />
                  <span>{{ a.name }}</span>
                </a>
              }
            </div>
            <p class="created">Started {{ dayMonth(sp()!.createdAt) }}{{ sp()!.province ? ' · ' + provinceName(sp()!.province ?? undefined) : '' }}</p>
            @if (owner()) {
              <button class="pill" type="button" (click)="edit()">Edit this page</button>
            }
          </section>
        }
      }
    </ion-content>
  `,
  styles: [`
    /* ── header ── */
    .cover { background: var(--lf-card); box-shadow: var(--lf-shadow); padding-bottom: 12px; }
    .banner { width: 100%; height: 156px; object-fit: cover; display: block; }
    .ident { display: flex; gap: 12px; align-items: flex-end; margin-top: -34px; padding: 0 var(--lf-gap); }
    .mark { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 4px solid var(--lf-card);
      background: var(--lf-card-2); flex: none; box-sizing: border-box; }
    .ident-copy { flex: 1; min-width: 0; padding-bottom: 2px; }
    .ident-copy h1 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 22px; line-height: 1.25; flex-wrap: wrap; }
    .tag { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 3px 7px;
      border-radius: 4px; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .verified { display: flex; align-items: center; gap: 5px; margin: 4px 0 0; color: var(--lf-ubuntu); font-size: 12px; font-weight: 600; }
    .tagline { margin: 4px 0 0; font-size: 14px; color: var(--ion-text-color); line-height: 1.4; }
    .counts { margin: 5px 0 0; font-size: 13px; color: var(--lf-muted); display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .counts strong { color: var(--lf-link); font-weight: 600; }
    .dot { color: var(--lf-muted); }
    .acts { display: flex; align-items: center; gap: 8px; padding: 12px var(--lf-gap) 0; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 18px; border-radius: 999px;
      border: 1px solid var(--lf-line); background: none; color: var(--ion-text-color); font: inherit; font-size: 15px;
      font-weight: 600; cursor: pointer; }
    .pill--sm { min-height: 32px; padding: 0 12px; font-size: 13.5px; }
    .pill--go { border-color: var(--lf-link); background: var(--lf-link); color: #fff; }
    .pill.on { border-color: var(--lf-line); background: none; color: var(--lf-muted); }
    .joined { display: inline-flex; align-items: center; gap: 5px; color: var(--lf-ubuntu); font-size: 13px; font-weight: 600; }
    .no-approval { margin: 8px var(--lf-gap) 0; font-size: 12.5px; color: var(--lf-muted); }
    .soft-notice { display: flex; gap: 6px; align-items: flex-start; margin: 8px var(--lf-gap) 0; padding: 8px 10px;
      border-radius: 8px; background: var(--lf-card-2); color: var(--lf-muted); font-size: 12.5px; line-height: 1.4; }
    .nav-act { width: 40px; height: 40px; border: 0; background: none; color: var(--ion-text-color); border-radius: 50%;
      display: grid; place-items: center; cursor: pointer; }
    .nav-act:hover { background: var(--lf-hover); }

    /* ── tabs ── */
    .tabs { position: sticky; top: 0; z-index: 4; display: flex; gap: 4px; background: var(--lf-card);
      border-top: 1px solid var(--lf-line-soft); box-shadow: var(--lf-shadow); padding: 0 var(--lf-gap); }
    .tab { position: relative; flex: 1; border: 0; background: none; color: var(--lf-muted); font: inherit; font-size: 14.5px;
      font-weight: 600; padding: 13px 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
    .tab.on { color: var(--lf-link); }
    .tab.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--lf-link); }
    .tab-count { font-size: 12.5px; color: inherit; }

    /* ── composer row ── */
    .start { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 10px var(--lf-gap) 0; padding: 10px 12px;
      background: var(--lf-card); border-radius: var(--lf-radius); box-shadow: var(--lf-shadow); }
    .start__box { flex: 1; min-width: 150px; text-align: left; border: 1px solid var(--lf-line); border-radius: 999px;
      background: none; color: var(--lf-muted); font: inherit; font-size: 15px; padding: 9px 14px; cursor: pointer; }
    .start__box:hover { background: var(--lf-hover); }
    .start__acts { display: flex; gap: 6px; width: 100%; }
    .start__acts button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0;
      background: none; color: var(--lf-muted); font: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 4px; cursor: pointer;
      border-radius: 6px; }
    .start__acts button:hover { background: var(--lf-hover); color: var(--ion-text-color); }

    ion-searchbar.inside { padding: 8px var(--lf-gap) 0 !important; --border-radius: 999px; background: transparent; }
    .filters { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px var(--lf-gap) 0; }
    .pills { display: flex; gap: 6px; overflow-x: auto; }
    .pill-mini { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; cursor: pointer; font: inherit;
      font-size: 14px; font-weight: 600; background: var(--lf-card-2); color: var(--ion-text-color); }
    .pill-mini.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .sort { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; color: var(--lf-muted);
      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; flex: none; }
    .scope { margin: 6px var(--lf-gap) 8px; font-size: 12px; color: var(--lf-muted); }

    /* ── members ── */
    .members { background: var(--lf-card); margin: 8px 0; padding: 4px 0 8px; box-shadow: var(--lf-shadow); }
    @media (min-width: 700px) { .members, .about, .start { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; } }
    .members__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px var(--lf-gap); }
    .members__top h2 { margin: 0; font-size: 16px; }
    .members__search { flex: 1; max-width: 220px; min-height: 36px; border: 1px solid var(--lf-line); border-radius: 8px;
      background: var(--lf-card); color: var(--ion-text-color); font: inherit; font-size: 14px; padding: 0 10px; }
    .member { display: flex; align-items: center; gap: 10px; padding: 10px var(--lf-gap); border-top: 1px solid var(--lf-line-soft); }
    .member-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .member-copy strong { font-size: 15px; font-weight: 600; }
    .member-copy span { font-size: 13px; color: var(--lf-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .member-meta { font-size: 12px !important; }
    .members__empty { margin: 6px var(--lf-gap); color: var(--lf-muted); font-size: 13.5px; }

    /* ── about ── */
    .about { background: var(--lf-card); margin: 8px 0; padding: 14px var(--lf-gap) 18px; box-shadow: var(--lf-shadow); }
    .about h2 { margin: 0 0 6px; font-size: 17px; }
    .about h3 { margin: 16px 0 6px; font-size: 15px; }
    .about__text { margin: 0; font-size: 14px; line-height: 1.5; }
    .rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .rules li { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; line-height: 1.45; color: var(--lf-muted); }
    .rules lf-icon { flex: none; color: var(--lf-link); margin-top: 2px; }
    .admins { display: flex; flex-direction: column; gap: 8px; }
    .admin { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; font-size: 14px; font-weight: 600; }
    .created { margin: 16px 0 10px; font-size: 12.5px; color: var(--lf-muted); }
  `]
})
export class SpotlightDetailComponent implements OnInit {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private platform = inject(PlatformService);
  private media = inject(MediaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  protected readonly compact = compact;
  protected readonly provinceName = provinceName;
  protected readonly timeAgo = timeAgo;

  sp = signal<Spotlight | null>(null);
  q = signal('');
  memberQuery = signal('');
  busy = signal(false);
  notice = signal('');
  /** posts filed here + posts about anyone with this surname */
  readonly all = signal<Post[]>([]);
  readonly show = signal<'all' | 'active' | 'found'>('all');
  readonly section = signal<'posts' | 'members' | 'about'>('posts');
  readonly sort = signal<'recent' | 'top'>('recent');
  /** Members of the community, read from the store the first time the tab opens. */
  readonly members = signal<UserProfile[]>([]);

  readonly tabs = computed(() => [
    { id: 'posts' as const, label: 'Posts', count: this.all().length },
    { id: 'members' as const, label: 'Members', count: this.sp()?.memberIds.length ?? 0 },
    { id: 'about' as const, label: 'About', count: null as number | null }
  ]);

  readonly viewerId = computed(() => this.auth.viewerId);
  readonly member = computed(() => {
    const me = this.auth.viewerId;
    return !!me && !!this.sp() && this.sp()!.memberIds.includes(me);
  });
  readonly owner = computed(() => {
    const me = this.auth.user();
    const sp = this.sp();
    return !!me && !!sp && (sp.ownerId === me.id || me.isAdmin === true);
  });

  readonly posts = computed(() => {
    const needle = this.q().trim().toLowerCase();
    let list = this.all();
    if (this.show() === 'active') list = list.filter((p) => p.status !== 'found');
    if (this.show() === 'found') list = list.filter((p) => p.status === 'found');
    if (needle) {
      list = list.filter(
        (p) => p.title.toLowerCase().includes(needle) || p.body.toLowerCase().includes(needle) ||
          (p.subject?.name.toLowerCase().includes(needle) ?? false)
      );
    }
    return this.sort() === 'top'
      ? [...list].sort((a, b) => (b.upvotes * 3 + b.commentCount * 5) - (a.upvotes * 3 + a.commentCount * 5))
      : [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  });

  readonly memberList = computed(() => {
    const sp = this.sp();
    if (!sp) return [];
    const known = new Map(this.members().map((u) => [u.id, u]));
    const needle = this.memberQuery().trim().toLowerCase();
    const rows = sp.memberIds.map((id) => {
      const u = known.get(id) ?? this.data.authorOf(id) ?? null;
      return {
        id,
        name: u?.displayName ?? 'LulaFind member',
        headline: u ? (u.bio || (u.surname ? `${u.surname} family` : 'LulaFind member')) : 'Member of this community',
        avatar: u ? this.data.avatarFor(u) : '',
        meta: u
          ? [u.town, u.province ? provinceName(u.province) : ''].filter(Boolean).join(' · ') || `Joined ${timeAgo(sp.createdAt)}`
          : `Joined ${timeAgo(sp.createdAt)}`,
        following: this.data.followingIds().includes(id),
        admin: sp.adminIds.includes(id)
      };
    });
    const filtered = needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.headline.toLowerCase().includes(needle))
      : rows;
    return [...filtered].sort((a, b) => Number(b.admin) - Number(a.admin) || a.name.localeCompare(b.name));
  });

  readonly admins = computed(() => this.memberList().filter((m) => m.admin).slice(0, 4));

  protected myAvatar(): string { return this.data.avatarFor(this.auth.user()); }
  protected myName(): string { return this.auth.user()?.displayName ?? 'You'; }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    const all = this.data.spotlights();
    this.sp.set(all.find((s) => s.id === id) ?? null);
    if (!this.sp()) {
      await this.data.loadStatic();
      this.sp.set(this.data.spotlights().find((s) => s.id === id) ?? null);
    }
    await this.reloadPosts();
    if (this.route.snapshot.queryParamMap.get('tab') === 'members') this.section.set('members');
    await this.loadMembers();
  }

  async reloadPosts(): Promise<void> {
    const sp = this.sp();
    if (sp) this.all.set(await this.data.postsForSpotlight(sp));
  }

  private async loadMembers(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    this.members.set(await this.data.people(sp.memberIds).catch(() => [] as UserProfile[]));
  }

  coverOf(): string {
    return this.sp() ? this.data.spotlightCover(this.sp()!) : '';
  }

  dayMonth(at: number): string {
    return new Date(at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  sortLabel(): string {
    return this.sort() === 'top' ? 'Top' : 'Recent';
  }

  cycleSort(): void {
    this.sort.set(this.sort() === 'recent' ? 'top' : 'recent');
  }

  /**
   * Instant - no admin approval, and a refusal from the server never reaches the
   * person as an error: `joinSpotlight` lands the membership on this device if it
   * has to, and `notice()` explains it in one line.
   */
  async join(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/spotlight/' + sp.id } });
      return;
    }
    this.busy.set(true);
    try {
      const joined = await this.data.joinSpotlight(sp.id);
      await this.data.loadStatic();
      this.sp.set(this.data.spotlights().find((s) => s.id === sp.id) ?? null);
      await this.loadMembers();
      const pending = this.data.spotlightSync() === 'device';
      this.notice.set(pending
        ? 'You are in on this device; the member list on the server is still catching up. Posting here works either way.'
        : '');
      const t = await this.toast.create({
        message: joined
          ? `You joined the ${sp.surname} community. You can post here now.`
          : `You are already a member of ${sp.surname}.`,
        duration: 2400,
        position: 'bottom'
      });
      await t.present();
    } catch (e: any) {
      const t = await this.toast.create({ message: e?.message ?? 'Could not join', duration: 2600, position: 'bottom' });
      await t.present();
    } finally {
      this.busy.set(false);
    }
  }

  menu(): void {
    const sp = this.sp();
    if (!sp) return;
    void (async () => {
      const buttons: { text: string; role?: string; handler?: () => void }[] = [
        { text: 'Copy link to this page', handler: () => void this.platform.copy(this.platform.link(`/spotlight/${sp.id}`)) },
        { text: 'Share this spotlight', handler: () => void this.share() }
      ];
      if (this.owner()) {
        buttons.push({ text: 'Edit page', handler: () => void this.edit() });
        buttons.push({ text: 'Delete page', role: 'destructive', handler: () => void this.remove() });
      }
      buttons.push({ text: 'Cancel', role: 'cancel' });
      const a = await this.alert.create({ header: `${sp.surname} Spotlight`, buttons: buttons as never });
      await a.present();
    })();
  }

  async edit(): Promise<void> {
    const sp = this.sp();
    if (!sp || !this.owner()) return;
    const a = await this.alert.create({
      header: 'Edit spotlight',
      message: 'The surname stays as it was when you created this community.',
      inputs: [
        { name: 'tagline', type: 'text', value: sp.tagline, placeholder: 'Short line' },
        { name: 'about', type: 'textarea', value: sp.about, placeholder: 'About this community' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Save', role: 'confirm' }
      ]
    });
    await a.present();
    const result = await a.onDidDismiss();
    if (result.role !== 'confirm') return;
    try {
      const next = await this.data.updateSpotlight(sp.id, {
        tagline: String(result.data?.values?.tagline ?? ''),
        about: String(result.data?.values?.about ?? '')
      });
      this.sp.set(next);
      const t = await this.toast.create({ message: 'Spotlight saved', duration: 1600, position: 'bottom' });
      await t.present();
    } catch (e: unknown) {
      const t = await this.toast.create({ message: e instanceof Error ? e.message : 'Could not save', duration: 2600, position: 'bottom' });
      await t.present();
    }
  }

  async remove(): Promise<void> {
    const sp = this.sp();
    if (!sp || !this.owner()) return;
    const a = await this.alert.create({
      header: 'Delete this spotlight?',
      message: 'This removes the community. Posts already published stay on the feed.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive' }
      ]
    });
    await a.present();
    const result = await a.onDidDismiss();
    if (result.role !== 'destructive') return;
    try {
      await this.data.deleteSpotlight(sp.id);
      await this.router.navigate(['/spotlight']);
    } catch (e: unknown) {
      const t = await this.toast.create({ message: e instanceof Error ? e.message : 'Could not delete', duration: 2600, position: 'bottom' });
      await t.present();
    }
  }

  async leave(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    const a = await this.alert.create({
      header: `Leave the ${sp.surname} community?`,
      message: 'You keep the posts you made here. You can join again at any time.',
      buttons: [
        { text: 'Stay', role: 'cancel' },
        { text: 'Leave', role: 'destructive', handler: () => void this.doLeave() }
      ]
    });
    await a.present();
  }

  private async doLeave(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    try {
      await this.data.leaveSpotlight(sp.id);
      await this.data.loadStatic();
      this.sp.set(this.data.spotlights().find((s) => s.id === sp.id) ?? null);
      const t = await this.toast.create({ message: `You left the ${sp.surname} community`, duration: 2000, position: 'bottom' });
      await t.present();
    } catch (e: any) {
      const t = await this.toast.create({ message: e?.message ?? 'Could not leave', duration: 2600, position: 'bottom' });
      await t.present();
    }
  }

  /** The composer, already set to this community. */
  async postHere(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: `/spotlight/${sp.id}` } });
      return;
    }
    if (!this.member()) {
      await this.join();
      return;
    }
    await this.router.navigate(['/create', 'missing'], { queryParams: { spotlight: sp.id } });
  }

  /** "Photo" in the community composer row: pick it here, carry it into the post. */
  async postWithPhoto(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: `/spotlight/${sp.id}` } });
      return;
    }
    if (!this.member()) { await this.join(); return; }
    const item = await this.media.pickImage({ source: 'gallery' });
    if (!item) {
      if (this.media.lastError()) await this.say(this.media.lastError()!);
      return;
    }
    const src = await this.media.compress(item.src, 1200);
    await this.router.navigate(['/create', 'missing'], {
      queryParams: { spotlight: sp.id },
      state: { photoAttachment: { ...item, src } }
    });
  }

  async follow(id: string): Promise<void> {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: this.router.url } });
      return;
    }
    try {
      await this.data.toggleFollow(id);
      this.members.update((list) => [...list]);
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not change that follow');
    }
  }

  async share(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    await this.platform.share(`${sp.surname} Spotlight`, `${sp.tagline} - join the ${sp.surname} community on LulaFind`, this.platform.link(`/spotlight/${sp.id}`));
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2400, position: 'bottom' });
    await t.present();
  }

  vote(p: Post, v: ReactionKind): void {
    void this.data.vote(p.id, v).then(() => this.reloadPosts()).catch(async (e) => {
      await this.say(e?.message ?? 'Could not react');
    });
  }

  open(p: Post): void {
    void this.router.navigate(['/post', p.id], { fragment: 'comments' });
  }
}
