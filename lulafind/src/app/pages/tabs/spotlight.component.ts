import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonInput } from '@ionic/angular/ion-input';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonSelect } from '@ionic/angular/ion-select';
import { IonSelectOption } from '@ionic/angular/ion-select-option';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonSearchbar } from '@ionic/angular/ion-searchbar';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { PROVINCES, ProvinceCode, Spotlight, provinceName } from '../../core/models/types';
import { cover } from '../../core/data/seed';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Spotlight: one community page per surname.
 *
 * Filter by any letter of the alphabet, or see them all. Joining is instant -
 * no admin approval - and once you have joined you can post to it.
 */
@Component({
  selector: 'lf-spotlight',
  standalone: true,
  imports: [
    IonContent, TopNavComponent, IonInput, IonTextarea, IonSelect,
    IonSelectOption, IonItem, IonLabel, IonSearchbar, RouterLink, IconComponent, EmptyComponent
  ],
  template: `
    <lf-top-nav />

    <ion-content class="lf-page">
      <h1 class="page-title">Spotlight</h1>
      <!-- Two jobs only: find a surname, or start one. -->
      <div class="seg" role="tablist" aria-label="Spotlight">
        <button role="tab" class="seg__btn" [class.on]="mode() === 'view'" [attr.aria-selected]="mode() === 'view'"
                (click)="mode.set('view')">
          <lf-icon name="search" [size]="18" [weight]="2.2" /> View
        </button>
        <button role="tab" class="seg__btn" [class.on]="mode() === 'create'" [attr.aria-selected]="mode() === 'create'"
                (click)="openCreate()">
          <lf-icon name="plus" [size]="18" [weight]="2.4" /> Create
        </button>
      </div>

      @if (mode() === 'view') {
        <div class="find">
          <ion-searchbar placeholder="Search a surname, e.g. Ndlela" [debounce]="150" [value]="query()"
                         (ionInput)="query.set($any($event.detail).value ?? '')" animated="true"></ion-searchbar>
          <div class="letters" role="group" aria-label="Filter by first letter">
            <button class="pill" [class.on]="letter() === 'all'" (click)="letter.set('all')">All</button>
            @for (l of alphabet; track l) {
              <button class="pill" [class.on]="letter() === l" (click)="letter.set(letter() === l ? 'all' : l)">{{ l }}</button>
            }
          </div>
        </div>

        @if (!query() && letter() === 'all' && mySurname()) {
          @if (surnameSpot(); as sp) {
            <a class="mine-card" [routerLink]="'/spotlight/' + sp.id">
              <img [src]="coverOf(sp.surname, sp.coverHue)" alt="" />
              <div>
                <span class="lf-tiny lf-muted">Your surname</span>
                <strong>{{ sp.surname }}</strong>
                <span class="lf-tiny lf-muted">{{ sp.postIds.length }} posts · {{ sp.followers }} members</span>
              </div>
              <lf-icon name="chevronRight" [size]="20" />
            </a>
          } @else {
            <button class="mine-card mine-card--new" (click)="openCreate()">
              <span class="disc"><lf-icon name="plus" [size]="22" [weight]="2.4" /></span>
              <div>
                <span class="lf-tiny lf-muted">No spotlight for your surname yet</span>
                <strong>Start the {{ mySurname() }} spotlight</strong>
              </div>
            </button>
          }
        }

        @if (mine().length && !query() && letter() === 'all') {
          <h3 class="section">Spotlights you joined</h3>
          <div class="grid">
            @for (s of mine(); track s.id) {
              <a class="tile" [routerLink]="'/spotlight/' + s.id">
                <img [src]="coverOf(s.surname, s.coverHue)" [alt]="s.surname" loading="lazy" />
                <div class="meta">
                  <strong>{{ s.surname }}</strong>
                  <span>{{ s.postIds.length }} posts · {{ s.followers }} members</span>
                </div>
              </a>
            }
          </div>
        }

        <h3 class="section">
          {{ query() ? 'Results' : letter() === 'all' ? 'All spotlights' : 'Surnames starting with ' + letter() }}
          <span class="lf-muted lf-tiny">{{ list().length }}</span>
        </h3>
        @if (!list().length) {
          <lf-empty icon="users" [title]="query() ? 'No ' + query().trim() + ' spotlight yet' : 'No spotlight for that letter yet'"
                    message="Create it and it becomes the home for every post with that surname."
                    actionLabel="Create a spotlight" (action)="openCreate(query())" />
        }
        <div class="grid lf-safe-bottom">
          @for (s of list(); track s.id) {
            <a class="tile" [routerLink]="'/spotlight/' + s.id">
              <img [src]="coverOf(s.surname, s.coverHue)" [alt]="s.surname" loading="lazy" />
              <div class="meta">
                <strong>{{ s.surname }}</strong>
                <span>{{ s.postIds.length }} posts · {{ s.followers }} members</span>
                @if (s.province) { <span>{{ provinceName(s.province) }}</span> }
              </div>
              @if (joined(s)) { <span class="lf-chip lf-tiny">Joined</span> }
              @else if (s.verified) { <span class="lf-chip lf-tiny">Verified</span> }
            </a>
          }
        </div>
      } @else {
        <section class="form lf-safe-bottom">
          <p class="lf-muted lf-small intro">
            A spotlight is a page for one surname in one province. Everyone who opens it sees every post about
            people with that surname. You become the first admin and anyone can join straight away.
          </p>

          <ion-item [class.bad]="touched.surname && !!surnameError()">
            <ion-label position="stacked">Surname</ion-label>
            <ion-input placeholder="e.g. Ndlela" [value]="form.surname"
                       (ionInput)="form.surname = $any($event.target).value" (ionBlur)="touched.surname = true"></ion-input>
          </ion-item>
          @if (touched.surname && surnameError()) { <p class="field-err">{{ surnameError() }}</p> }
          @if (duplicate(); as d) {
            <a class="field-err dup" [routerLink]="'/spotlight/' + d.id">
              <lf-icon name="alert" [size]="13" /> "{{ d.surname }}" already exists in {{ provinceName(d.province!) }}. Tap to open it and join.
            </a>
          }

          <ion-item [class.bad]="touched.province && !form.province">
            <ion-label position="stacked">Province</ion-label>
            <ion-select placeholder="Choose a province" [value]="form.province"
                        (ionChange)="form.province = $any($event.detail).value">
              @for (p of provinces; track p.code) { <ion-select-option [value]="p.code">{{ p.name }}</ion-select-option> }
            </ion-select>
          </ion-item>
          @if (touched.province && !form.province) { <p class="field-err">Choose the province this community belongs to</p> }

          <ion-item>
            <ion-label position="stacked">Tagline (optional)</ion-label>
            <ion-input placeholder="One surname. One search." [value]="form.tagline"
                       (ionInput)="form.tagline = $any($event.target).value"></ion-input>
          </ion-item>
          <ion-item>
            <ion-label position="stacked">About (optional)</ion-label>
            <ion-textarea rows="3" placeholder="Who looks after this page" [value]="form.about"
                          (ionInput)="form.about = $any($event.target).value"></ion-textarea>
          </ion-item>

          @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }

          <button class="lf-btn lf-btn--primary lf-btn--block create" [disabled]="!!duplicate() || busy()" (click)="submit()">
            {{ busy() ? 'Creating…' : 'Create spotlight' }}
          </button>
        </section>
      }
    </ion-content>
  `,
  styles: [`
    .seg { display: flex; gap: 8px; padding: 4px var(--lf-gap) 10px; }
    .seg__btn { flex: 1; height: 38px; border: 0; border-radius: 999px; cursor: pointer; font: inherit; font-size: 15px;
      font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      background: var(--lf-card-2); color: var(--ion-text-color); transition: background .15s, color .15s; }
    .seg__btn.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .find { background: var(--lf-card); padding: 8px 0 10px; margin-bottom: 8px; box-shadow: var(--lf-shadow); }
    .find ion-searchbar { padding: 0 var(--lf-gap) !important; --border-radius: 999px; height: 40px; }
    .letters { display: flex; gap: 6px; overflow-x: auto; padding: 8px var(--lf-gap) 0; scrollbar-width: none; }
    .letters::-webkit-scrollbar { display: none; }
    .pill { flex: none; min-width: 36px; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; cursor: pointer;
      background: var(--lf-card-2); color: var(--ion-text-color); font: inherit; font-size: 14px; font-weight: 600; }
    .pill.on { background: var(--lf-primary-soft); color: var(--lf-link); }
    .mine-card { display: flex; align-items: center; gap: 12px; width: calc(100% - 2 * var(--lf-gap)); box-sizing: border-box;
      margin: 0 var(--lf-gap) 4px; padding: 10px 12px; border: 0; border-radius: var(--lf-radius); background: var(--lf-card);
      box-shadow: var(--lf-shadow); color: inherit; text-decoration: none; font: inherit; text-align: left; cursor: pointer; }
    .mine-card img { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; flex: none; }
    .mine-card > div { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .mine-card strong { font-size: 16px; font-weight: 700; }
    .mine-card .disc { width: 56px; height: 56px; border-radius: 10px; display: grid; place-items: center; flex: none;
      background: var(--lf-primary-soft); color: var(--lf-link); }
    .section { margin: 0; padding: 16px var(--lf-gap) 8px; font-size: 17px; font-weight: 700; display: flex; gap: 8px;
      align-items: baseline; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 0 var(--lf-gap) 16px; }
    @media (min-width: 620px) { .grid { grid-template-columns: repeat(3, 1fr); } }
    @media (min-width: 768px) { .grid, .section, .mine-card, .form { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; box-sizing: border-box; } }
    .tile { position: relative; border-radius: var(--lf-radius); overflow: hidden; border: 0; box-shadow: var(--lf-shadow);
      background: var(--lf-card); text-decoration: none; color: inherit; display: block; }
    .tile img { width: 100%; height: 96px; object-fit: cover; display: block; }
    .tile .meta { padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 2px; }
    .tile .meta strong { font-size: 15px; font-weight: 600; }
    .tile .meta span { font-size: 13px; color: var(--lf-muted); }
    .tile .lf-chip { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,.55); color: #fff; border: 0; }
    .form { background: var(--lf-card); padding: 16px var(--lf-gap) 24px; box-shadow: var(--lf-shadow); }
    .intro { margin: 0 0 14px; line-height: 1.45; }
    ion-item { margin-bottom: 8px; }
    ion-item.bad { --border-color: var(--lf-signal); box-shadow: inset 0 0 0 1.5px var(--lf-signal); }
    .field-err { color: var(--lf-signal-text); font-size: 12px; font-weight: 600; margin: -4px 0 8px 4px;
      display: flex; align-items: center; gap: 5px; text-decoration: none; }
    .err { display: flex; align-items: center; gap: 8px; color: var(--lf-signal); font-size: 13px; margin: 4px 0 0; }
    .create { margin-top: 16px; }
  `]
})
export class SpotlightComponent {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  query = signal('');
  mode = signal<'view' | 'create'>('view');
  busy = signal(false);
  error = signal('');
  letter = signal<'all' | string>('all');
  touched = { surname: false, province: false };

  form = { surname: '', tagline: '', about: '', province: null as ProvinceCode | null };
  protected readonly provinces = PROVINCES;
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

  coverOf(surname: string, hue: number): string {
    return cover(`${surname} family`, hue || undefined);
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
      const sp = await this.data.createSpotlight(this.form as any);
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
