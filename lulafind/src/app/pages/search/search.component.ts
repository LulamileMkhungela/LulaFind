import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';




import { IonSearchbar } from '@ionic/angular/ion-searchbar';
import { ReactionKind } from '../../core/models/types';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { PostCardComponent } from '../../shared/components/post-card.component';
import { DataService } from '../../core/services/data.service';
import { UserProfile, Post, PROVINCES, Spotlight, provinceName } from '../../core/models/types';
import { cover } from '../../core/data/seed';

@Component({
  selector: 'lf-search',
  standalone: true,
  imports: [IonContent, IonSearchbar, RouterLink, IconComponent, AvatarComponent, EmptyComponent, PostCardComponent, TopNavComponent],
  template: `
    <lf-top-nav title="Search" backTo="/home" />

    <ion-content class="lf-page">
      <!-- The search field and its quick chips scroll with the results instead
           of being pinned under a translucent bar, where they were clipped by
           the status bar on notched phones. -->
      <div class="search-top">
        <ion-searchbar placeholder="Name, surname, case number, town…" [debounce]="220" showCancelButton="never"
                       (ionInput)="onQuery($any($event.detail).value ?? $any($event.target).value ?? '')"></ion-searchbar>
        <div class="lf-scroller quick">
          @for (c of quick; track c) { <button class="chip" (click)="apply(c)">{{ c }}</button> }
        </div>
      </div>
      @if (!query()) {
        <div class="lf-pad">
          <!-- What you looked for last, so a family does not retype a name every night. -->
          @if (recent().length) {
            <div class="recent">
              <div class="recent__head">
                <h3 class="lf-h2">Recent searches</h3>
                <button type="button" class="recent__clear" (click)="clearRecent()">Clear</button>
              </div>
              <div class="lf-scroller">
                @for (r of recent(); track r) {
                  <button class="chip" type="button" (click)="apply(r)">
                    <lf-icon name="clock" [size]="13" /> {{ r }}
                  </button>
                }
              </div>
            </div>
          }

          <!-- The three ways people actually arrive: a name, a case number, a place. -->
          <div class="ways" aria-label="Ways to search">
            <div class="way">
              <lf-icon name="user" [size]="17" />
              <div><strong>A name</strong><span>Surname or first name</span></div>
            </div>
            <div class="way">
              <lf-icon name="book" [size]="17" />
              <div><strong>A case number</strong><span>ORL/441/09/2026</span></div>
            </div>
            <div class="way">
              <lf-icon name="pin" [size]="17" />
              <div><strong>A place</strong><span>Orlando West, Soweto</span></div>
            </div>
          </div>

          <h3 class="lf-h2" style="margin:16px 0 8px">Start with a surname</h3>
          <div class="lf-scroller">
            @for (sp of data.spotlights(); track sp.id) {
              <a class="sp" [routerLink]="'/spotlight/' + sp.id">
                <lf-icon name="users" [size]="18" />
                <div><strong>{{ sp.surname }}</strong><span>{{ sp.postIds.length }} posts</span></div>
              </a>
            }
          </div>

          <h3 class="lf-h2" style="margin:18px 0 8px">Jump to a province</h3>
          <div class="provs">
            @for (p of provinces; track p.code) {
              <button class="prov" (click)="byProvince(p.code)">{{ p.name }}</button>
            }
          </div>

          <h3 class="lf-h2" style="margin:18px 0 8px">People</h3>
          <div class="people">
            @for (u of people(); track u.id) {
              <a class="person" [routerLink]="'/user/' + u.id">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="40" />
                <div class="lf-grow">
                  <strong>{{ u.displayName }}</strong>
                  <span class="lf-meta">&#64;{{ u.handle }}</span>
                </div>
              </a>
            }
          </div>
        </div>
      } @else if (searching() && !posts().length && !users().length && !spotlights().length) {
        <p class="search-state" role="status">Searching…</p>
      } @else if (!posts().length && !users().length && !spotlights().length) {
        <div class="nomatch">
          <lf-empty icon="search" title="Nothing matches “{{ query() }}”"
                    message="Check the spelling, or try one word instead of two." />
          <div class="nomatch__quick">
            <button type="button" class="chip" (click)="apply(query().split(/\s+/)[0] ?? query())">Try “{{ firstWord() }}”</button>
            <button type="button" class="chip" (click)="clearQuery()">Clear the search</button>
          </div>
          <a class="nomatch__help" routerLink="/help">
            <lf-icon name="phone" [size]="16" /> Looking for someone now? The helplines are on this page
          </a>
        </div>
      } @else {
        @if (spotlights().length) {
          <div class="lf-pad">
            <h3 class="lf-h2" style="margin:16px 0 8px">Communities</h3>
            <div class="spots">
              @for (sp of spotlights(); track sp.id) {
                <a class="spot" [routerLink]="'/spotlight/' + sp.id">
                  <img [src]="coverOf(sp)" [alt]="sp.surname" loading="lazy" />
                  <div class="lf-grow">
                    <strong>{{ sp.surname }}</strong>
                    <span class="lf-meta">{{ sp.postIds.length }} posts · {{ sp.followers }} members
                      @if (sp.province) { · {{ provinceName(sp.province) }} }</span>
                  </div>
                  <lf-icon name="chevronRight" [size]="18" />
                </a>
              }
            </div>
          </div>
        }
        @if (users().length) {
          <div class="lf-pad">
            <h3 class="lf-h2" style="margin:16px 0 8px">People</h3>
            @for (u of users(); track u.id) {
              <a class="person" [routerLink]="'/user/' + u.id">
                <lf-avatar [src]="data.avatarFor(u)" [name]="u.displayName" [size]="44" />
                <div class="lf-grow">
                  <strong>{{ u.displayName }}</strong>
                  <span class="lf-meta">&#64;{{ u.handle }}@if (u.privacy && u.privacy.showLocation === true && u.town) { · {{ u.town }} }</span>
                </div>
              </a>
            }
          </div>
        }
        @if (posts().length) {
          <div class="lf-pad">
            <h3 class="lf-h2" style="margin:16px 0 8px">Posts <span class="lf-muted lf-tiny">{{ posts().length }}</span></h3>
          </div>
        }
        @for (p of posts(); track p.id) {
          <lf-post-card [post]="p" [author]="data.authorOf(p.authorId) ?? null" chatState="off"
                        (vote)="vote(p, $event)" (comment)="open(p)" />
        }
        @if (!posts().length) {
          <p class="search-state">No cases match “{{ query() }}”. The people above do.</p>
        }
      }
    </ion-content>
  `,
  styles: [`
    .quick { padding: 6px var(--lf-gap); gap: 6px; }
    .chip { height: 32px; padding: 0 12px; border-radius: 999px; border: 0; background: var(--lf-card-2);
      color: var(--ion-text-color); font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .sp { display: flex; align-items: center; gap: 10px; min-width: 168px; padding: 12px 14px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); color: inherit; text-decoration: none; }
    .sp div { display: flex; flex-direction: column; }
    .sp span { font-size: 11.5px; color: var(--lf-muted); }
    .provs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .prov { padding: 12px 8px; border-radius: var(--lf-radius); border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card);
      color: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
    .spots { display: flex; flex-direction: column; gap: 8px; }
    .spot { display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: var(--lf-radius);
      background: var(--lf-card); box-shadow: var(--lf-shadow); color: inherit; text-decoration: none; }
    .spot img { width: 46px; height: 46px; border-radius: 9px; object-fit: cover; flex: none; }
    .spot div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .search-state { margin: 18px var(--lf-gap); font-size: 14px; color: var(--lf-muted); text-align: center; }
    .people { display: flex; flex-direction: column; gap: 8px; }
    .person { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); color: inherit; text-decoration: none; }
    .person div { display: flex; flex-direction: column; gap: 2px; }
    .recent { margin-top: 4px; }
    .recent__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .recent__head h3 { margin: 12px 0 6px; }
    .recent__clear { border: 0; background: transparent; color: var(--lf-muted); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .chip { display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 12px; border: 0; border-radius: 999px;
      background: var(--lf-card-2); color: var(--ion-text-color); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .chip:hover { background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .ways { display: grid; gap: 7px; margin-top: 14px; }
    .way { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: var(--lf-radius);
      background: var(--lf-card); box-shadow: var(--lf-shadow); color: var(--lf-muted); }
    .way div { display: flex; flex-direction: column; gap: 1px; }
    .way strong { font-size: 13.5px; color: var(--ion-text-color); }
    .way span { font-size: 12px; }
    .nomatch { display: flex; flex-direction: column; gap: 4px; }
    .nomatch__quick { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; padding: 0 var(--lf-gap) 4px; }
    .nomatch__help { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 10px var(--lf-gap) 18px;
      padding: 11px 12px; border-radius: var(--lf-radius); background: color-mix(in srgb, var(--lf-signal) 8%, var(--lf-card));
      color: var(--lf-signal-text); text-decoration: none; font-size: 13px; font-weight: 700; }
  `]
})
export class SearchComponent {
  protected data = inject(DataService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  /** Put the query in the address bar too, so a search can be shared or reloaded. */
  private readonly syncUrl = effect(() => {
    const q = this.query();
    void this.router.navigate([], { queryParams: q ? { q } : {}, replaceUrl: true });
  });
  /** Keep an open result page current when the app resumes or the data layer
   * completes its background sync. The sequence guard in onQuery prevents a
   * slower refresh from replacing newer typed results. */
  private readonly refreshSearch = effect(() => {
    const tick = this.data.syncTick();
    const q = this.query().trim();
    if (tick > 0 && q.length >= 2) void this.onQuery(q);
  });

  protected readonly provinces = PROVINCES;
  protected readonly provinceName = provinceName;
  query = signal('');
  /**
   * Recent searches, newest first, kept on this phone.
   * The one thing a family does repeatedly is type the same name, so making
   * them type it every night is a small cruelty the app can simply remove.
   */
  readonly recent = signal<string[]>(SearchComponent.readRecent());

  private static readRecent(): string[] {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lulafind.recentSearches') : null;
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
    } catch {
      return [];
    }
  }

  private remember(q: string): void {
    const needle = q.trim();
    if (needle.length < 2) return;
    const next = [needle, ...this.recent().filter((r) => r.toLowerCase() !== needle.toLowerCase())].slice(0, 6);
    this.recent.set(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('lulafind.recentSearches', JSON.stringify(next));
    } catch {
      /* private mode: the list simply does not survive a reload */
    }
  }

  clearRecent(): void {
    this.recent.set([]);
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem('lulafind.recentSearches');
    } catch {
      /* ignore */
    }
  }

  firstWord(): string {
    return (this.query().trim().split(/\s+/)[0] ?? '').slice(0, 24);
  }

  clearQuery(): void {
    void this.onQuery('');
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }
  users = signal<UserProfile[]>([]);
  posts = signal<Post[]>([]);
  spotlights = signal<Spotlight[]>([]);
  /** True while a typed query is on its way to the database. */
  searching = signal(false);

  quick = ['missing in Gauteng', 'SAPS case', 'Home Sweet Home', 'found', 'Orlando', 'Ndlela'];

  /**
   * Guard against out-of-order answers: keystrokes fire overlapping requests,
   * and a slow reply to "Ndl" must never overwrite the results for "Ndlela".
   */
  private seq = 0;

  readonly people = computed(() => this.users().slice(0, 8));

  coverOf(sp: Spotlight): string {
    return cover(`${sp.surname} family`, sp.coverHue || undefined);
  }

  /**
   * The surnames on this device, narrowed by the same words. They need no round
   * trip, so the section appears the moment a letter is typed - the database
   * answers for cases and people a moment later.
   */
  private matchSpotlights(value: string): void {
    const needle = value.trim().toLowerCase();
    if (needle.length < 2) { this.spotlights.set([]); return; }
    this.spotlights.set(this.data.spotlights()
      .filter((s) => s.surname.toLowerCase().includes(needle) || s.tagline.toLowerCase().includes(needle))
      .slice(0, 6));
  }

  constructor() {
    // A search typed in the top bar arrives as /search?q=... and runs here.
    // Listening to the parameter (rather than reading it once) means pressing
    // Enter in the top bar while already on this page still runs the search.
    this.route.queryParamMap.subscribe((params) => {
      const fromUrl = params.get('q') ?? '';
      if (fromUrl !== this.query()) void this.onQuery(fromUrl);
    });
  }

  /**
   * Runs as the person types (the searchbar debounces the keystrokes).
   *
   * Cases come from the database through `data.searchPosts`, so the whole store
   * is searched rather than only the feed page on screen, and people come from
   * `data.searchUsers`. Both run together; the newer keystroke always wins.
   */
  async onQuery(q: string): Promise<void> {
    const needle = q.trim();
    this.query.set(needle);
    this.matchSpotlights(needle);
    if (needle.length < 2) {
      this.posts.set([]);
      this.users.set([]);
      this.searching.set(false);
      return;
    }
    const token = ++this.seq;
    this.searching.set(true);
    const [posts, users] = await Promise.all([
      this.data.searchPosts(needle).catch(() => [] as Post[]),
      this.data.searchUsers(needle).catch(() => [] as UserProfile[])
    ]);
    if (token !== this.seq) return;
    this.posts.set(posts);
    this.users.set(users);
    this.searching.set(false);
    if (posts.length || users.length || this.spotlights().length) this.remember(needle);
  }

  apply(q: string): void {
    void this.onQuery(q);
  }

  byProvince(code: string): void {
    this.data.setFilter({ province: code as any, query: '' });
    void this.router.navigate(['/home']);
  }

  async vote(p: Post, v: ReactionKind): Promise<void> {
    const saving = this.data.vote(p.id, v);
    // Search results are a local signal, so mirror DataService's optimistic
    // cache immediately instead of waiting for the provider round trip.
    this.posts.update((items) => items.map((item) => item.id === p.id ? (this.data.post(p.id) ?? item) : item));
    try { await saving; } catch { /* DataService restored the previous copy. */ }
    this.posts.update((items) => items.map((item) => item.id === p.id ? (this.data.post(p.id) ?? item) : item));
  }

  open(p: Post): void {
    void this.router.navigate(['/post', p.id]);
  }
}
