import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonInput } from '@ionic/angular/ion-input';
import { IonTextarea } from '@ionic/angular/ion-textarea';




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
import { MediaItem, POST_TYPE_META, Post, PostType, ReactionKind, Spotlight, UserProfile, provinceName } from '../../core/models/types';
import { MediaService } from '../../core/services/media.service';
import { compact } from '../../core/utils/format';
import { cover } from '../../core/data/seed';

@Component({
  selector: 'lf-spotlight-detail',
  standalone: true,
  imports: [IonContent, IonInput, IonTextarea, IonSearchbar, IonSkeletonText, IconComponent, EmptyComponent, PostCardComponent, AvatarComponent, RouterLink, TopNavComponent],
  template: `
    <lf-top-nav backTo="/spotlight" />

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
                <button class="lf-btn lf-btn--primary lf-btn--sm" (click)="postHere()">
                  <lf-icon name="plus" [size]="15" /> Post to {{ sp()!.surname }}
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

        <!-- Posting is the members' privilege; reading never is. -->
        @if (member()) {
          <section class="quick" aria-label="Share with this community">
            <div class="quick__who">
              <lf-avatar [src]="data.avatarFor(me())" [name]="me()?.displayName ?? ''" [size]="36" />
              <span class="lf-small lf-muted">Post to the {{ sp()!.surname }} community</span>
            </div>
            <input class="quick__headline" type="text" maxlength="120" placeholder="Headline (at least 8 characters)"
                   [value]="draft().title" (input)="setDraft('title', $any($event.target).value)"
                   aria-label="Headline" />
            <textarea class="quick__text" rows="3" maxlength="5000" placeholder="What is happening? Add a photo or video if you have one."
                      inputmode="text" autocorrect="on" autocomplete="on" autocapitalize="sentences" spellcheck="true"
                      [value]="draft().body" (input)="setDraft('body', $any($event.target).value)"
                      aria-label="Post text"></textarea>
            <div class="quick__where">
              <ion-input label="Town or suburb" labelPlacement="stacked" placeholder="e.g. Umlazi"
                         [value]="draft().town" (ionInput)="setDraft('town', $any($event.detail).value ?? '')"></ion-input>
            </div>

            @if (draft().media.length) {
              <div class="quick__media" aria-label="Attached media">
                @for (item of draft().media; track item.id) {
                  <div class="tile">
                    @if (item.kind === 'video') { <video [src]="item.src" controls preload="metadata"></video> }
                    @else { <img [src]="item.src" alt="Attachment" /> }
                    <button type="button" class="tile__x" (click)="removeMedia(item.id)" aria-label="Remove attachment">
                      <lf-icon name="x" [size]="13" />
                    </button>
                  </div>
                }
              </div>
            }

            <div class="quick__types" role="group" aria-label="What kind of post is this">
              @for (t of quickTypes; track t) {
                <button type="button" class="chip" [class.on]="draft().type === t" (click)="setDraft('type', t)">
                  {{ typeLabel(t) }}
                </button>
              }
            </div>

            <div class="quick__actions">
              <button type="button" class="attach" [disabled]="mediaBusy() || hasVideo() || draft().media.length >= 4"
                      (click)="attachImage()"><lf-icon name="image" [size]="17" /> Photo</button>
              <button type="button" class="attach" [disabled]="mediaBusy() || hasVideo() || draft().media.length > 0"
                      (click)="attachVideo()"><lf-icon name="video" [size]="17" /> Video</button>
              <button type="button" class="lf-btn lf-btn--primary lf-btn--sm post" [disabled]="posting() || mediaBusy()"
                      (click)="postToSpotlight()">{{ posting() ? 'Posting…' : 'Post' }}</button>
            </div>
            @if (notice()) { <p class="quick__note" role="status">{{ notice() }}</p> }
            @if (composerError()) { <p class="quick__err" role="alert"><lf-icon name="alert" [size]="14" /> {{ composerError() }}</p> }
          </section>
        } @else {
          <div class="locked">
            <lf-icon name="lock" [size]="16" />
            <span>Join the {{ sp()!.surname }} community to post here. Anyone can read what is posted.</span>
            @if (signedIn()) { <button class="lf-btn lf-btn--primary lf-btn--sm" (click)="join()">Join</button> }
            @else { <a class="lf-btn lf-btn--primary lf-btn--sm" routerLink="/auth">Sign in</a> }
          </div>
        }

        <ion-searchbar placeholder="Search posts and people in {{ sp()!.surname }}" [debounce]="200"
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
    .ident { padding: 14px var(--lf-gap) 10px; display: flex; flex-direction: column; gap: 8px; margin-top: -18px; }
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
    .quick { display: flex; flex-direction: column; gap: 8px; margin: 10px var(--lf-gap) 4px; padding: 12px;
      border-radius: var(--lf-radius); background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .quick__who { display: flex; align-items: center; gap: 8px; }
    .quick__headline, .quick__text { width: 100%; box-sizing: border-box; border: 1px solid var(--lf-line);
      border-radius: 8px; padding: 9px 10px; font: inherit; background: var(--lf-card-2); color: var(--ion-text-color); }
    .quick__headline { font-weight: 600; }
    .quick__text { resize: vertical; min-height: 76px; }
    .quick__where ion-input { --background: var(--lf-card-2); --border-radius: 8px; --padding-start: 10px; }
    .quick__media { display: flex; flex-wrap: wrap; gap: 7px; }
    .quick__media .tile { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; background: var(--lf-card-2); }
    .quick__media img, .quick__media video { width: 100%; height: 100%; object-fit: cover; }
    .tile__x { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 22px; height: 22px;
      border: 0; border-radius: 50%; background: rgba(0,0,0,.68); color: #fff; cursor: pointer; }
    .quick__types { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
    .quick__types::-webkit-scrollbar { display: none; }
    .chip { flex: none; height: 30px; padding: 0 11px; border: 0; border-radius: 999px; cursor: pointer; font: inherit;
      font-size: 13px; font-weight: 600; background: var(--lf-card-2); color: var(--ion-text-color); }
    .chip.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .quick__actions { display: flex; align-items: center; gap: 8px; }
    .attach { display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 11px; border: 0;
      border-radius: 999px; background: var(--lf-card-2); color: var(--ion-text-color); font: inherit; font-size: 13.5px;
      font-weight: 600; cursor: pointer; }
    .attach:disabled { opacity: .5; cursor: default; }
    .post { margin-left: auto; }
    .quick__note { margin: 0; font-size: 12.5px; color: var(--lf-muted); }
    .quick__err { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--lf-signal); }
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

  /* ─── the short way to post here ──────────────────────────────────────── */

  private media = inject(MediaService);
  readonly quickTypes: PostType[] = ['sighting', 'missing', 'khumbulekhaya', 'pet'];
  readonly draft = signal<{ type: PostType; title: string; body: string; town: string; media: MediaItem[] }>({
    type: 'sighting', title: '', body: '', town: '', media: []
  });
  readonly posting = signal(false);
  readonly mediaBusy = computed(() => this.media.busy());
  readonly notice = signal('');
  readonly composerError = signal('');
  /** Members matching the search, so you can find a person inside a community. */
  readonly people = signal<UserProfile[]>([]);

  readonly me = computed(() => this.auth.user());
  readonly signedIn = computed(() => this.auth.signedIn());

  setDraft<K extends 'type' | 'title' | 'body' | 'town'>(key: K, value: string): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.composerError.set('');
  }

  typeLabel(t: PostType): string {
    return POST_TYPE_META[t].label;
  }

  hasVideo(): boolean {
    return this.draft().media.some((m) => m.kind === 'video');
  }

  async attachImage(): Promise<void> {
    const item = await this.media.pickImage({ quality: 76 });
    if (this.media.notice()) this.notice.set(this.media.notice()!);
    if (!item) {
      if (this.media.lastError()) this.composerError.set(this.media.lastError()!);
      return;
    }
    const src = await this.media.compress(item.src, 1200);
    this.draft.update((d) => ({ ...d, media: [...d.media, { ...item, src }] }));
  }

  async attachVideo(): Promise<void> {
    const item = await this.media.pickVideo();
    if (this.media.notice()) this.notice.set(this.media.notice()!);
    if (!item) {
      if (this.media.lastError()) this.composerError.set(this.media.lastError()!);
      return;
    }
    this.draft.update((d) => ({ ...d, media: [item] }));
  }

  removeMedia(id: string): void {
    this.draft.update((d) => ({ ...d, media: d.media.filter((m) => m.id !== id) }));
  }

  /**
   * Publish the short post into this community.
   *
   * The draft goes to the same `createPost` the full composer uses, so every
   * rule holds - membership first of all. The message from the service is shown
   * as-is, because it says exactly what is missing.
   */
  async postToSpotlight(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    const d = this.draft();
    this.composerError.set('');
    if (!d.title.trim() && !d.body.trim() && !d.media.length) {
      this.composerError.set('Write something, or attach a photo or video.');
      return;
    }
    this.posting.set(true);
    try {
      // A headline was not typed: take the first line, so nothing is invented.
      const firstLine = d.body.trim().split(/\n/)[0]?.trim() ?? '';
      const title = d.title.trim() || firstLine.slice(0, 120);
      await this.data.postToSpotlight(sp, { type: d.type, title, body: d.body, town: d.town, media: d.media });
      this.draft.set({ type: d.type, title: '', body: '', town: d.town, media: [] });
      await this.reloadPosts();
      await this.data.loadStatic();
      const t = await this.toast.create({ message: `Posted to the ${sp.surname} community`, duration: 2000, position: 'bottom' });
      await t.present();
    } catch (e: any) {
      this.composerError.set(e?.message ?? 'Could not post to this community');
    } finally {
      this.posting.set(false);
    }
  }

  /** One field for the in-spotlight search: posts on the card, people above. */
  onSearch(value: string): void {
    this.q.set(value);
    void this.loadPeople(value);
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
    if (sp) this.all.set(await this.data.postsForSpotlight(sp));
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
    this.data.setFilter({ spotlightId: sp.id });
    await this.router.navigate(['/create', 'missing']);
  }

  async share(): Promise<void> {
    const sp = this.sp();
    if (!sp) return;
    await this.platform.share(`${sp.surname} Spotlight`, `${sp.tagline} - join the ${sp.surname} community on LulaFind`, this.platform.link(`/spotlight/${sp.id}`));
  }

  vote(p: Post, v: ReactionKind): void {
    void this.data.vote(p.id, v).then(() => this.reloadPosts()).catch(async (e) => {
      await this.toast.create({ message: e?.message ?? 'Could not vote', duration: 2200, position: 'bottom' }).then((t) => t.present());
    });
  }

  open(p: Post): void {
    void this.router.navigate(['/post', p.id]);
  }

  async sharePost(p: Post): Promise<void> {
    await this.platform.share(p.title, `${p.title}\n\nShared from LulaFind`, this.platform.link(`/post/${p.id}`));
    await this.data.recordShare(p.id);
  }
}
