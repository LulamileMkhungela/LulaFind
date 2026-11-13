import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';




import { IonSearchbar } from '@ionic/angular/ion-searchbar';
import { IonSkeletonText } from '@ionic/angular/ion-skeleton-text';
import { ToastController } from '@ionic/angular/toast-controller';
import { AlertController } from '@ionic/angular/alert-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { PostCardComponent } from '../../shared/components/post-card.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { PlatformService } from '../../core/services/platform.service';
import { Post, ReactionKind, Spotlight, UserProfile, provinceName } from '../../core/models/types';
import { compact } from '../../core/utils/format';
import { cover } from '../../core/data/seed';

@Component({
  selector: 'lf-spotlight-detail',
  standalone: true,
  imports: [IonContent, IonSearchbar, IonSkeletonText, IconComponent, EmptyComponent, PostCardComponent, AvatarComponent, RouterLink, TopNavComponent],
  template: `
    <lf-top-nav [title]="sp()?.surname ?? 'Spotlight'" backTo="/spotlight" />

    <ion-content class="lf-page">
      @if (!sp()) {
        <div class="lf-card"><ion-skeleton-text style="height:180px"></ion-skeleton-text></div>
      } @else {
        <div class="hero">
          <img class="banner" [src]="coverOf()" [alt]="sp()!.surname" />
          <div class="ident">
            <h1 class="lf-h1">{{ sp()!.surname }} <span class="lf-chip">Spotlight</span></h1>
            @if (sp()!.verified) { <span class="lf-chip lf-chip--success"><lf-icon name="check" [size]="12" /> verified family page</span> }
            <p class="tag">{{ sp()!.tagline }}</p>
            <div class="stats">
              <div><strong>{{ compact(sp()!.followers) }}</strong><span>members</span></div>
              <div><strong>{{ all().length }}</strong><span>posts</span></div>
              <div><strong>{{ sp()!.adminIds.length }}</strong><span>admins</span></div>
            </div>
            @if (sp()!.about) { <p class="about">{{ sp()!.about }}</p> }
            <div class="acts">
              @if (!member()) {
                <button class="lf-btn lf-btn--primary lf-btn--sm" (click)="join()">
                  <lf-icon name="plus" [size]="15" /> Join this community
                </button>
                <span class="lf-meta">No approval needed - you can post as soon as you join.</span>
              } @else {
                <span class="lf-chip lf-chip--success"><lf-icon name="check" [size]="12" /> you are a member</span>
                <button class="lf-btn lf-btn--primary lf-btn--sm" aria-label="Post here to this Spotlight" (click)="postHere()">
                  <lf-icon name="plus" [size]="15" /> Post here
                </button>
                @if (!owner()) {
                  <button class="lf-btn lf-btn--ghost lf-btn--sm" (click)="leave()">Leave</button>
                }
              }
              @if (owner()) {
                <button class="lf-btn lf-btn--ghost lf-btn--sm" (click)="edit()">Edit</button>
                <button class="lf-btn lf-btn--danger lf-btn--sm" (click)="remove()">Delete</button>
              }
              <button class="lf-btn lf-btn--ghost lf-btn--sm" (click)="share()">
                <lf-icon name="share" [size]="15" /> Share
              </button>
            </div>
          </div>
        </div>

        <!-- Posting uses the same full composer as every other post. It is
             opened only by the Post to this community action above, so this
             page never shows a second, shortened set of fields. Keep the
             membership gate visible without rendering another composer. -->
        @if (!member()) {
          <div class="locked">
            <lf-icon name="lock" [size]="16" />
            <span>Join the {{ sp()!.surname }} community to post here. Anyone can read what is posted.</span>
            @if (signedIn()) { <button class="lf-btn lf-btn--primary lf-btn--sm" (click)="join()">Join</button> }
            @else { <a class="lf-btn lf-btn--primary lf-btn--sm" routerLink="/auth">Sign in</a> }
          </div>
        }
        <ion-searchbar placeholder="Search this community" [debounce]="200"
                       aria-label="Search posts and people in this community"
                       (ionInput)="onSearch($any($event.detail).value ?? '')"></ion-searchbar>
        <div class="pills">
          <button class="pill" [class.on]="show() === 'all'" (click)="show.set('all')">All · {{ all().length }}</button>
          <button class="pill" [class.on]="show() === 'active'" (click)="show.set('active')">Still missing</button>
          <button class="pill" [class.on]="show() === 'found'" (click)="show.set('found')">Found</button>
        </div>
        <p class="lf-tiny lf-muted scope">Posts filed here and every post about someone with the surname {{ sp()!.surname }}.</p>

        @if (people().length) {
          <h3 class="sect">People <span class="lf-muted lf-tiny">{{ people().length }}</span></h3>
          <div class="people">
            @for (u of people(); track u.id) {
              <a class="person" [routerLink]="'/user/' + u.id">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="40" />
                <div>
                  <strong>{{ u.displayName }}</strong>
                  <span class="lf-tiny lf-muted">&#64;{{ u.handle }}
                    @if (u.surname.toLowerCase() === sp()!.surname.toLowerCase()) { · {{ sp()!.surname }} }</span>
                </div>
              </a>
            }
          </div>
        }

        @if (!posts().length && !people().length) {
          <lf-empty icon="users" [title]="q().trim().length >= 2 ? 'Nothing matches that here' : 'Nothing posted to this spotlight yet'"
                    [message]="member() ? 'Be the first to bring a case, story or update to the community.' : 'Join the community to add the first post.'"
                    [actionLabel]="member() ? 'Post here' : 'Join this community'" (action)="postHere()" />
        }
        @for (p of posts(); track p.id) {
          <lf-post-card [post]="p" [author]="data.authorOf(p.authorId) ?? null" chatState="off"
                        (vote)="vote(p, $event)" (comment)="open(p)" />
        }
      }
    </ion-content>
  `,
  styles: [`
    .banner { width: 100%; height: 150px; object-fit: cover; display: block; }
    .ident { padding: 12px var(--lf-gap) 10px; display: flex; flex-direction: column; gap: 8px; }
    .ident h1 { display: flex; align-items: center; gap: 8px; margin: 0; flex-wrap: wrap; }
    .tag { margin: 0; font-weight: 600; }
    .about { margin: 0; font-size: 13.5px; color: var(--lf-muted); line-height: 1.5; }
    .stats { display: flex; gap: 18px; }
    .stats div { display: flex; flex-direction: column; }
    .stats strong { font-size: 17px; }
    .stats span { font-size: 11.5px; color: var(--lf-muted); }
    .acts { display: flex; gap: 8px; flex-wrap: wrap; }
    .pills { display: flex; gap: 8px; padding: 4px var(--lf-gap) 0; overflow-x: auto; }
    .pill { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; cursor: pointer; font: inherit;
      font-size: 14px; font-weight: 600; background: var(--lf-card-2); color: var(--ion-text-color); }
    .pill.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .scope { margin: 6px var(--lf-gap) 8px; }
    .locked { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 10px var(--lf-gap) 4px;
      padding: 12px; border-radius: var(--lf-radius); background: var(--lf-card-2); font-size: 13.5px; color: var(--lf-muted); }
    .locked span { flex: 1 1 200px; }
    .sect { margin: 12px var(--lf-gap) 6px; font-size: 16px; font-weight: 700; }
    .people { display: flex; flex-direction: column; gap: 8px; padding: 0 var(--lf-gap) 8px; }
    .person { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--lf-radius);
      background: var(--lf-card); box-shadow: var(--lf-shadow); color: inherit; text-decoration: none; }
    .person div { display: flex; flex-direction: column; gap: 1px; }
  `]
})
export class SpotlightDetailComponent implements OnInit {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private platform = inject(PlatformService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  protected readonly compact = compact;
  protected readonly provinceName = provinceName;

  sp = signal<Spotlight | null>(null);
  q = signal('');
  /** posts filed here + posts about anyone with this surname */
  readonly all = signal<Post[]>([]);
  readonly show = signal<'all' | 'active' | 'found'>('all');
  /** Members matching the Spotlight search, rendered separately from posts. */
  readonly people = signal<UserProfile[]>([]);

  private reloadSeq = 0;

  constructor() {
    effect(() => {
      const tick = this.data.syncTick();
      if (tick > 0 && this.sp()) void this.reloadPosts();
    });
  }

  /** One field for the in-spotlight search: posts on the card, people above. */
  async onSearch(value: string): Promise<void> {
    this.q.set(value);
    await this.loadPeople(value);
  }

  private async loadPeople(value: string): Promise<void> {
    const sp = this.sp();
    const needle = value.trim().toLowerCase().replace(/^@/, '');
    if (!sp || needle.length < 2) { this.people.set([]); return; }
    const members = await this.data.people(sp.memberIds).catch(() => [] as UserProfile[]);
    this.people.set(members
      .filter((u) => !u.suspended && `${u.displayName} ${u.surname} ${u.handle}`.toLowerCase().includes(needle))
      .slice(0, 12));
  }

  readonly signedIn = computed(() => this.auth.signedIn());
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
    return list;
  });

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
  }

  async reloadPosts(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    const request = ++this.reloadSeq;
    const posts = await this.data.postsForSpotlight(sp);
    // A resume refresh can overlap the initial load (or a just-created post).
    // Only the newest response may replace the list.
    if (request === this.reloadSeq && this.sp()?.id === sp.id) this.all.set(posts);
  }

  coverOf(): string {
    return cover(`${this.sp()?.surname ?? ''} family`, this.sp()?.coverHue || undefined);
  }

  /** Instant - no admin approval. You can post the moment you join. */
  async join(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/spotlight/' + sp.id } });
      return;
    }
    try {
      const joined = await this.data.joinSpotlight(sp.id);
      await this.data.loadStatic();
      this.sp.set(this.data.spotlights().find((s) => s.id === sp.id) ?? null);
      const t = await this.toast.create({
        message: joined ? `You joined the ${sp.surname} community. You can post here now.` : `You are already a member of ${sp.surname}.`,
        duration: 2400,
        position: 'bottom'
      });
      await t.present();
    } catch (e: any) {
      const t = await this.toast.create({ message: e?.message ?? 'Could not join', duration: 2600, position: 'bottom' });
      await t.present();
    }
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

  /** Members open the composer; everyone else is asked to join first. */
  async postHere(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth']);
      return;
    }
    if (!this.member()) { await this.join(); return; }
    // Use the same full composer as the main Create tab. The query is consumed
    // by CreatePostComponent, which selects Spotlight and this exact community
    // underneath the member name before the form is shown.
    await this.router.navigate(['/create', 'missing'], { queryParams: { spotlight: sp.id } });
  }

  async share(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    await this.platform.share(`${sp.surname} Spotlight`, `${sp.tagline} - join the ${sp.surname} community on LulaFind`, this.platform.link(`/spotlight/${sp.id}`));
  }

  async vote(p: Post, v: ReactionKind): Promise<void> {
    const saving = this.data.vote(p.id, v);
    // This page owns a separate Spotlight result list. Paint the same optimistic
    // post into it immediately, then reconcile with the server response.
    this.all.update((items) => items.map((item) => item.id === p.id ? (this.data.post(p.id) ?? item) : item));
    try {
      await saving;
      await this.reloadPosts();
    } catch (e: any) {
      this.all.update((items) => items.map((item) => item.id === p.id ? (this.data.post(p.id) ?? item) : item));
      await this.toast.create({ message: e?.message ?? 'Could not vote', duration: 2200, position: 'bottom' }).then((t) => t.present());
    }
  }

  open(p: Post): void {
    void this.router.navigate(['/post', p.id]);
  }

  async sharePost(p: Post): Promise<void> {
    await this.platform.share(p.title, `${p.title}\n\nShared from LulaFind`, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id);
  }
}
