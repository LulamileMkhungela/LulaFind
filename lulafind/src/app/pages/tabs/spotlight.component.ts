import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonSearchbar } from '@ionic/angular/ion-searchbar';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { PlatformService } from '../../core/services/platform.service';
import { PROVINCES, ProvinceCode, Spotlight, provinceName } from '../../core/models/types';
import { compact } from '../../core/utils/format';
import { cover } from '../../core/data/seed';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Spotlight: one community page per surname, laid out like LinkedIn's Groups tab.
 *
 *   Find a group / Create a group, top right of the header
 *   "Communities you've joined" as rows you can open or post into
 *   "Suggested for you" below, with the Join pill on the row itself
 *   the surname alphabet as the filter, because this is a phone book of families
 *
 * Joining is instant and a tap on Join always lands: `DataService.joinSpotlight`
 * keeps the membership on the device when the server will not take it, so nobody
 * is ever shown a database refusal for asking to join their own surname.
 */
@Component({
  selector: 'lf-spotlight',
  standalone: true,
  imports: [IonContent, TopNavComponent, IonSearchbar, RouterLink, IconComponent, EmptyComponent],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page">
      <header class="head">
        <h1 class="page-title">Spotlight</h1>
        <p class="lede">A page for every surname. Anyone searching for a Mokoena, a Ndlela or a Dlamini finds
          the cases, the sightings and the updates in one place.</p>
        <div class="head-acts">
          <button class="pill pill--go" type="button" (click)="openCreate()">
            <lf-icon name="plus" [size]="16" [weight]="2.6" /> Create a spotlight
          </button>
          <button class="pill" type="button" (click)="focusSearch()">
            <lf-icon name="search" [size]="16" /> Find a surname
          </button>
        </div>
      </header>

      <div class="find">
        <ion-searchbar #bar placeholder="Search a surname, e.g. Ndlela" [debounce]="150" [value]="query()"
                       (ionInput)="query.set($any($event.detail).value ?? '')" animated="true"></ion-searchbar>
        <div class="letters" role="group" aria-label="Filter by first letter">
          <button class="letter-pill" [class.on]="letter() === 'all'" (click)="letter.set('all')">All</button>
          @for (l of alphabet; track l) {
            <button class="letter-pill" [class.on]="letter() === l" (click)="letter.set(letter() === l ? 'all' : l)">{{ l }}</button>
          }
        </div>
      </div>

      @if (!query() && letter() === 'all' && mySurname()) {
        @if (surnameSpot(); as sp) {
          <a class="yours" [routerLink]="'/spotlight/' + sp.id">
            <img [src]="coverOf(sp)" [alt]="" />
            <div>
              <span class="lf-tiny lf-muted">Your surname</span>
              <strong>{{ sp.surname }}</strong>
              <span class="lf-tiny lf-muted">{{ sp.postIds.length }} posts · {{ sp.followers }} members</span>
            </div>
            <lf-icon name="chevronRight" [size]="20" />
          </a>
        } @else {
          <button class="yours yours--new" (click)="openCreate()">
            <span class="disc"><lf-icon name="plus" [size]="22" [weight]="2.4" /></span>
            <div>
              <span class="lf-tiny lf-muted">No spotlight for your surname yet</span>
              <strong>Start the {{ mySurname() }} spotlight</strong>
            </div>
          </button>
        }
      }

      @if (mine().length) {
        <h3 class="section">Communities you've joined <span class="lf-muted lf-tiny">{{ mine().length }}</span></h3>
        <div class="rows lf-safe-bottom">
          @for (s of mine(); track s.id) {
            <div class="row">
              <a class="row-cover" [routerLink]="'/spotlight/' + s.id"><img [src]="coverOf(s)" [alt]="s.surname" loading="lazy" /></a>
              <div class="row-copy">
                <a [routerLink]="'/spotlight/' + s.id"><strong>{{ s.surname }}</strong></a>
                <span>{{ compact(s.followers) }} {{ s.followers === 1 ? 'member' : 'members' }} · {{ s.postIds.length }} posts</span>
                <span class="row-line">{{ s.tagline }}</span>
              </div>
              <div class="row-acts">
                <button class="pill pill--sm" type="button" (click)="postTo(s)">
                  <lf-icon name="plus" [size]="14" [weight]="2.6" /> Post
                </button>
                <a class="pill pill--sm ghost" [routerLink]="'/spotlight/' + s.id">Open</a>
              </div>
            </div>
          }
        </div>
      }

      <h3 class="section">
        {{ query() ? 'Results' : letter() === 'all' ? (mine().length ? 'Other spotlights' : 'All spotlights') : 'Surnames starting with ' + letter() }}
        <span class="lf-muted lf-tiny">{{ suggestions().length }}</span>
      </h3>
      @if (!suggestions().length) {
        <lf-empty icon="users" [title]="query() ? 'No ' + query().trim() + ' spotlight yet' : 'No spotlight for that letter yet'"
                  message="Create it and it becomes the home for every post with that surname."
                  actionLabel="Create a spotlight" (action)="openCreate(query())" />
      }
      <div class="rows lf-safe-bottom">
        @for (s of suggestions(); track s.id) {
          <div class="row">
            <a class="row-cover" [routerLink]="'/spotlight/' + s.id"><img [src]="coverOf(s)" [alt]="s.surname" loading="lazy" /></a>
            <div class="row-copy">
              <a [routerLink]="'/spotlight/' + s.id">
                <strong>{{ s.surname }}</strong>
                @if (s.verified) { <span class="vf"><lf-icon name="check" [size]="11" /> verified</span> }
              </a>
              <span>{{ compact(s.followers) }} {{ s.followers === 1 ? 'member' : 'members' }} · {{ s.postIds.length }} posts</span>
              <span class="row-line">{{ s.tagline }}</span>
              @if (s.province) { <span class="row-line"><lf-icon name="pin" [size]="11" /> {{ provinceName(s.province) }}</span> }
            </div>
            <div class="row-acts">
              @if (joined(s)) {
                <span class="pill pill--sm on"><lf-icon name="check" [size]="13" [weight]="3" /> Joined</span>
              } @else {
                <button class="pill pill--sm pill--go" type="button" [disabled]="busyId() === s.id" (click)="join(s)">
                  {{ busyId() === s.id ? 'Joining…' : 'Join' }}
                </button>
              }
              <button class="kebab" type="button" (click)="share(s)" aria-label="Share this spotlight"><lf-icon name="share" [size]="16" /></button>
            </div>
          </div>
        }
      </div>

      @if (mode() === 'create') {
        <div class="backdrop" (click)="closeCreate()" role="presentation">
          <section class="sheet" role="dialog" aria-modal="true" aria-label="Create a spotlight"
                   (click)="$event.stopPropagation()">
            <header class="sheet__top">
              <h2>Create a surname spotlight</h2>
              <button class="x" type="button" (click)="closeCreate()" aria-label="Close"><lf-icon name="x" [size]="20" /></button>
            </header>

            <div class="sheet__preview">
              <img [src]="previewCover()" alt="" />
              <div class="preview-copy">
                <strong>{{ form.surname.trim() || 'Surname' }}</strong>
                <span>{{ form.tagline.trim() || 'The ' + (form.surname.trim() || 'surname') + ' community on LulaFind' }}</span>
                <span>1 member · 0 posts</span>
              </div>
            </div>

            <p class="intro">
              Everyone who opens the page sees every post about that surname. You are the first admin, and anyone can
              join and post straight away.
            </p>

            <label class="fld" [class.bad]="touched.surname && !!surnameError()">
              <span>Surname <b aria-hidden="true">*</b></span>
              <input type="text" maxlength="40" placeholder="e.g. Ndlela" [value]="form.surname"
                     (input)="form.surname = $any($event.target).value" (blur)="touched.surname = true" />
            </label>
            @if (touched.surname && surnameError()) { <p class="field-err">{{ surnameError() }}</p> }
            @if (duplicate(); as d) {
              <a class="field-err dup" [routerLink]="'/spotlight/' + d.id" (click)="closeCreate()">
                <lf-icon name="alert" [size]="13" /> "{{ d.surname }}" already exists in {{ provinceName(d.province ?? undefined) }}. Open it and join that one.
              </a>
            }

            <label class="fld" [class.bad]="touched.province && !form.province">
              <span>Province <b aria-hidden="true">*</b></span>
              <select [value]="form.province ?? ''" (change)="setProvince($any($event.target).value)">
                <option value="">Choose a province</option>
                @for (p of provinces; track p.code) { <option [value]="p.code">{{ p.name }}</option> }
              </select>
            </label>
            @if (touched.province && !form.province) { <p class="field-err">Choose the province this community belongs to</p> }

            <label class="fld"><span>Tagline (optional)</span>
              <input type="text" maxlength="80" placeholder="One surname. One search." [value]="form.tagline"
                     (input)="form.tagline = $any($event.target).value" />
            </label>
            <label class="fld"><span>About (optional)</span>
              <textarea rows="3" maxlength="400" placeholder="Who looks after this page, and what belongs on it"
                        [value]="form.about" (input)="form.about = $any($event.target).value"></textarea>
            </label>

            @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }

            <footer class="sheet__foot">
              <button class="pill" type="button" (click)="closeCreate()">Cancel</button>
              <button class="pill pill--go" type="button" [disabled]="!!duplicate() || busy()" (click)="submit()">
                {{ busy() ? 'Creating…' : 'Create spotlight' }}
              </button>
            </footer>
          </section>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .head { background: var(--lf-card); padding: 14px var(--lf-gap) 12px; box-shadow: var(--lf-shadow); }
    .page-title { margin: 0; font-size: 21px; }
    .lede { margin: 6px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--lf-muted); max-width: 60ch; }
    .head-acts { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 15px; border-radius: 999px;
      border: 1px solid var(--lf-line); background: none; color: var(--ion-text-color); font: inherit; font-size: 14.5px;
      font-weight: 600; cursor: pointer; text-decoration: none; }
    .pill--sm { min-height: 32px; padding: 0 11px; font-size: 13.5px; }
    .pill--go { border-color: var(--lf-link); background: var(--lf-link); color: #fff; }
    .pill.ghost { color: var(--lf-link); border-color: var(--lf-link); background: none; }
    .pill.on { color: var(--lf-ubuntu); border-color: transparent; background: color-mix(in srgb, var(--lf-ubuntu) 12%, transparent); }

    .find { background: var(--lf-card); padding: 8px 0 10px; margin: 8px 0; box-shadow: var(--lf-shadow); }
    .find ion-searchbar { padding: 0 var(--lf-gap) !important; --border-radius: 999px; height: 40px; background: transparent; }
    .letters { display: flex; gap: 5px; overflow-x: auto; padding: 8px var(--lf-gap) 0; scrollbar-width: none; }
    .letters::-webkit-scrollbar { display: none; }
    .letter-pill { flex: none; min-width: 34px; height: 30px; padding: 0 10px; border: 0; border-radius: 999px; cursor: pointer;
      background: var(--lf-card-2); color: var(--ion-text-color); font: inherit; font-size: 13.5px; font-weight: 600; }
    .letter-pill.on { background: var(--lf-primary-soft); color: var(--lf-link); }

    .yours { display: flex; align-items: center; gap: 12px; width: calc(100% - 2 * var(--lf-gap)); box-sizing: border-box;
      margin: 0 var(--lf-gap) 8px; padding: 10px 12px; border: 0; border-radius: var(--lf-radius); background: var(--lf-card);
      box-shadow: var(--lf-shadow); color: inherit; text-decoration: none; font: inherit; text-align: left; cursor: pointer; }
    .yours img { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; flex: none; }
    .yours > div { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .yours strong { font-size: 16px; font-weight: 700; }
    .yours .disc { width: 56px; height: 56px; border-radius: 10px; display: grid; place-items: center; flex: none;
      background: var(--lf-primary-soft); color: var(--lf-link); }

    .section { margin: 0; padding: 14px var(--lf-gap) 6px; font-size: 16.5px; font-weight: 700; display: flex; gap: 8px;
      align-items: baseline; }
    .rows { display: flex; flex-direction: column; gap: 6px; padding: 0 var(--lf-gap) 12px; }
    @media (min-width: 768px) { .rows, .section, .head, .find, .yours { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; box-sizing: border-box; } }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: var(--lf-radius); background: var(--lf-card);
      box-shadow: var(--lf-shadow); }
    .row-cover { flex: none; }
    .row-cover img { width: 60px; height: 60px; border-radius: 8px; object-fit: cover; display: block; }
    .row-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .row-copy a { color: inherit; text-decoration: none; font-size: 15.5px; display: flex; align-items: center; gap: 6px; }
    .row-copy a strong { font-weight: 600; }
    .row-copy a:hover strong { text-decoration: underline; }
    .row-copy > span { font-size: 12.5px; color: var(--lf-muted); }
    .row-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
    .vf { display: inline-flex; align-items: center; gap: 3px; color: var(--lf-ubuntu); font-size: 11px; font-weight: 700; }
    .row-acts { display: flex; flex-direction: column; align-items: stretch; gap: 6px; flex: none; }
    @media (max-width: 480px) { .row-acts { flex-direction: row; width: 100%; } .row { flex-wrap: wrap; } }
    .kebab { width: 32px; height: 32px; border: 0; border-radius: 50%; background: none; color: var(--lf-muted); cursor: pointer;
      display: grid; place-items: center; align-self: center; }
    .kebab:hover { background: var(--lf-hover); }

    /* create sheet */
    .backdrop { position: fixed; inset: 0; z-index: 1300; background: var(--lf-scrim); display: flex; align-items: flex-end;
      justify-content: center; }
    @media (min-width: 700px) { .backdrop { align-items: center; padding: 24px; } }
    .sheet { width: 100%; max-width: 552px; max-height: 92vh; overflow: auto; background: var(--lf-card); color: var(--ion-text-color);
      border-radius: 14px 14px 0 0; padding: 4px 16px 16px; box-sizing: border-box; }
    @media (min-width: 700px) { .sheet { border-radius: 12px; } }
    .sheet__top { display: flex; align-items: center; justify-content: space-between; padding: 12px 0 6px; }
    .sheet__top h2 { margin: 0; font-size: 17px; font-weight: 600; }
    .x { width: 34px; height: 34px; border: 0; background: none; color: var(--lf-muted); border-radius: 50%; cursor: pointer;
      display: grid; place-items: center; }
    .x:hover { background: var(--lf-hover); }
    .sheet__preview { border-radius: 10px; overflow: hidden; border: 1px solid var(--lf-line-soft); }
    .sheet__preview img { width: 100%; height: 84px; object-fit: cover; display: block; }
    .preview-copy { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
    .preview-copy strong { font-size: 15px; }
    .preview-copy span { font-size: 12.5px; color: var(--lf-muted); }
    .intro { margin: 12px 0 4px; font-size: 13px; color: var(--lf-muted); line-height: 1.45; }
    .fld { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; font-size: 13px; color: var(--lf-muted); }
    .fld span b { color: var(--lf-signal-text); }
    .fld input, .fld select, .fld textarea { border: 1px solid var(--lf-line); border-radius: 8px; background: var(--lf-card);
      color: var(--ion-text-color); font: inherit; font-size: 15px; padding: 10px 12px; min-height: 42px; box-sizing: border-box; }
    .fld textarea { resize: vertical; }
    .fld.bad input, .fld.bad select { border-color: var(--lf-signal); }
    .field-err { color: var(--lf-signal-text); font-size: 12.5px; font-weight: 600; margin: 5px 0 0; display: flex;
      align-items: center; gap: 5px; text-decoration: none; }
    .err { display: flex; align-items: center; gap: 8px; color: var(--lf-signal-text); font-size: 13px; margin: 12px 0 0; }
    .sheet__foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  `]
})
export class SpotlightComponent {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);
  private platform = inject(PlatformService);

  query = signal('');
  mode = signal<'view' | 'create'>('view');
  busy = signal(false);
  busyId = signal<string | null>(null);
  error = signal('');
  letter = signal<'all' | string>('all');
  touched = { surname: false, province: false };

  form = { surname: '', tagline: '', about: '', province: null as ProvinceCode | null };
  protected readonly provinces = PROVINCES;
  protected readonly compact = compact;
  protected readonly provinceName = provinceName;
  protected readonly alphabet = ALPHABET;

  readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    const l = this.letter();
    return this.data
      .spotlights()
      .filter((s) => (l === 'all' ? true : s.surname.trim().charAt(0).toUpperCase() === l))
      .filter((s) => !q || s.surname.toLowerCase().includes(q) || s.tagline.toLowerCase().includes(q))
      .sort((a, b) => a.surname.localeCompare(b.surname));
  });

  readonly mine = computed(() => {
    const me = this.auth.viewerId;
    return me ? this.data.spotlights().filter((s) => s.memberIds.includes(me)) : [];
  });

  /** LinkedIn's "Suggested for you": everything you are not already in. */
  readonly suggestions = computed(() => {
    const joined = new Set(this.mine().map((s) => s.id));
    const me = this.auth.user();
    return this.list()
      .filter((s) => !joined.has(s.id))
      .sort((a, b) => {
        const sameProvince = (s: Spotlight) => (me?.province && s.province === me.province ? 1 : 0);
        const sameSurname = (s: Spotlight) => (me?.surname && s.surname.toLowerCase() === me.surname.toLowerCase() ? 2 : 0);
        const gap = (sameProvince(b) + sameSurname(b)) - (sameProvince(a) + sameSurname(a));
        return gap || b.followers - a.followers || a.surname.localeCompare(b.surname);
      });
  });

  /**
   * Does this surname already have a community in the chosen province?
   * Read on every change-detection pass - the form is a plain object, so a
   * memoised computed would go stale as the person types.
   */
  duplicate(): Spotlight | null {
    const surname = this.form.surname.trim().toLowerCase();
    if (surname.length < 2 || !this.form.province) return null;
    return this.data
      .spotlights()
      .find((s) => s.surname.toLowerCase() === surname && s.province === this.form.province) ?? null;
  }

  /** The viewer's own surname, if we know it. */
  readonly mySurname = computed(() => (this.auth.user()?.surname ?? '').trim());

  /** The spotlight for the viewer's surname - their province first, then any. */
  readonly surnameSpot = computed(() => {
    const surname = this.mySurname();
    return surname ? this.data.spotlightForSurname(surname, this.auth.user()?.province ?? null) ?? null : null;
  });

  joined(s: Spotlight): boolean {
    const me = this.auth.viewerId;
    return !!me && s.memberIds.includes(me);
  }

  surnameError(): string {
    const surname = this.form.surname.trim();
    if (!surname) return 'Enter a surname';
    if (surname.length < 2) return 'A surname needs at least 2 letters';
    if (!/^[a-zA-Z'\-\s]+$/.test(surname)) return 'A surname can only contain letters';
    return '';
  }

  coverOf(s: Spotlight): string {
    return cover(`${s.surname} family`, s.coverHue || undefined);
  }

  previewCover(): string {
    return cover(`${this.form.surname.trim() || 'New'} family`, undefined);
  }

  focusSearch(): void {
    const bar = document.querySelector('ion-searchbar');
    (bar as HTMLIonSearchbarElement | null)?.setFocus?.();
  }

  openCreate(prefill = ''): void {
    if (!this.auth.signedIn()) {
      void this.router.navigate(['/auth'], { queryParams: { next: '/spotlight' } });
      return;
    }
    this.error.set('');
    this.touched = { surname: false, province: false };
    this.form = { surname: prefill.trim() || this.auth.user()?.surname || '', tagline: '', about: '', province: null };
    // never pre-select the province - the person must choose it
    this.mode.set('create');
  }

  closeCreate(): void { this.mode.set('view'); }

  /** Join from the list. Never a refusal: see `DataService.joinSpotlight`. */
  async join(s: Spotlight): Promise<void> {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/spotlight' } });
      return;
    }
    this.busyId.set(s.id);
    try {
      const joined = await this.data.joinSpotlight(s.id);
      const t = await this.toast.create({
        message: joined ? `You joined the ${s.surname} community.` : `You are already a member of ${s.surname}.`,
        duration: 2200, position: 'bottom'
      });
      await t.present();
    } catch (e: any) {
      const t = await this.toast.create({ message: e?.message ?? 'Could not join', duration: 2400, position: 'bottom' });
      await t.present();
    } finally {
      this.busyId.set(null);
    }
  }

  async postTo(s: Spotlight): Promise<void> {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/auth'], { queryParams: { next: '/spotlight/' + s.id } });
      return;
    }
    await this.router.navigate(['/create', 'missing'], { queryParams: { spotlight: s.id } });
  }

  /** LinkedIn puts the share icon on the group row itself; ours copies the link. */
  async share(s: Spotlight): Promise<void> {
    const link = this.platform.link(`/spotlight/${s.id}`);
    const mode = await this.platform.share(`${s.surname} Spotlight`, `${s.tagline} - join the ${s.surname} community on LulaFind`, link);
    const t = await this.toast.create({
      message: mode === 'clipboard' ? 'Link copied. Paste it wherever the family will see it.' : 'Share sheet opened',
      duration: 1800, position: 'bottom'
    });
    await t.present();
  }

  setProvince(value: string): void {
    this.form.province = (value || null) as ProvinceCode | null;
  }

  async submit(): Promise<void> {
    this.error.set('');
    this.touched = { surname: true, province: true };
    if (this.surnameError()) { this.error.set(this.surnameError()); return; }
    if (!this.form.province) { this.error.set('Choose the province this community belongs to.'); return; }
    if (this.duplicate()) {
      this.error.set(
        `A "${this.form.surname.trim()}" spotlight already exists in ` +
        `${this.form.province ? provinceName(this.form.province) : 'that province'}. Join that one instead.`
      );
      return;
    }
    this.busy.set(true);
    try {
      const sp = await this.data.createSpotlight({ ...this.form, surname: this.form.surname.trim() });
      this.mode.set('view');
      const t = await this.toast.create({ message: `${sp.surname} spotlight created. You are the first member.`, duration: 2400, position: 'bottom' });
      await t.present();
      await this.router.navigate(['/spotlight', sp.id]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not create the spotlight');
    } finally {
      this.busy.set(false);
    }
  }
}
