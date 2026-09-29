import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonButtons } from '@ionic/angular/ion-buttons';
import { ActionSheetController } from '@ionic/angular/action-sheet-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { PostCardComponent } from '../../shared/components/post-card.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { MediaService } from '../../core/services/media.service';
import { Audience, MediaItem, Post, PostType } from '../../core/models/types';
import { POSTER_TEMPLATES, PosterCategory, ParsedPoster, parsePosterText } from '../../core/utils/poster-parse';

const CATEGORIES: { key: PostType; label: string; icon: string }[] = [
  { key: 'missing', label: 'Missing person', icon: 'search' },
  { key: 'khumbulekhaya', label: 'Left home', icon: 'home' },
  { key: 'vehicle', label: 'Stolen vehicle', icon: 'car' },
  { key: 'pet', label: 'Lost pet', icon: 'paw' },
  { key: 'sighting', label: 'Sighting', icon: 'pin' },
  { key: 'danger', label: 'Danger nearby', icon: 'alert' }
];

/** The location line's label per category, used by the validation messages. */
const LOCATION_LABEL: Record<PosterCategory, string> = {
  missing: 'Last seen', khumbulekhaya: 'Left home', vehicle: 'Taken from',
  pet: 'Last seen', sighting: 'Where', danger: 'Where'
};

const LOCATION_EXAMPLE = 'Soweto, Gauteng';

/** Everything Generate pulls out of the textbox, ready to post. */
interface BuiltPost {
  title: string;
  province: NonNullable<ParsedPoster['province']>;
  town: string;
  lastSeenWhere: string;
  contactValue: string;
  caseNumber: string | null;
  subject: Post['subject'];
  vehicleDetails: Post['vehicleDetails'];
  danger: Post['danger'];
  khumbu: Post['khumbu'];
}

/**
 * The poster composer: pick a category, fill in the example in the one
 * textbox, attach a photo, then Generate. Generate reads the labels back out
 * of the text, the app picks the poster background from the category, and the
 * preview is the real feed card - exactly what the post will look like once
 * it is shared. No province dropdowns, no optional sections: the town and
 * province live in the text (e.g. "Last seen: Soweto, Gauteng").
 *
 * The post body stays the full raw text, so search and the detail page see
 * everything typed. The parsed fields only add structure. Fields the text
 * cannot express (privacy switches, dates, votes, claims) keep their defaults
 * on a new post and are preserved untouched when editing.
 */
@Component({
  selector: 'lf-create-post',
  standalone: true,
  imports: [IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IconComponent, AvatarComponent, PostCardComponent],
  template: `
    <ion-header class="fb-create-header" [translucent]="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="icon-button" type="button" (click)="close()" aria-label="Close composer">
            <lf-icon name="x" [size]="20" />
          </button>
        </ion-buttons>
        <ion-title>{{ editing() ? 'Edit post' : 'Create post' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="lf-page">
      <main class="composer lf-fade-in">
        <div class="author-row">
          <lf-avatar [src]="userAvatar()" [name]="userName()" [size]="40" />
          <div class="author-meta">
            <strong>{{ userName() }}</strong>
            <label class="audience-picker" aria-label="Who can see this post">
              <lf-icon [name]="audienceIcon()" [size]="13" />
              <select [value]="audience()" (change)="setAudience($any($event.target).value)">
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="surname">Spotlight</option>
              </select>
              <lf-icon name="chevronDown" [size]="12" />
            </label>
          </div>
        </div>

        @if (audience() === 'surname') {
          @if (mySpotlights().length) {
            <label class="spotlight-picker">
              <span>Share with</span>
              <select [value]="spotlightId() ?? ''" (change)="spotlightId.set($any($event.target).value || null)">
                <option value="">Choose a Spotlight</option>
                @for (sp of mySpotlights(); track sp.id) { <option [value]="sp.id">{{ sp.surname }}</option> }
              </select>
            </label>
          } @else {
            <p class="inline-note">Join a Spotlight first to share with one surname community.</p>
          }
        }

        <section class="category-block" aria-labelledby="category-title">
          <div class="section-heading">
            <strong id="category-title">What are you posting?</strong>
            <span>Choose one</span>
          </div>
          <div class="category-grid">
            @for (category of categories; track category.key) {
              <button type="button" class="category" [class.selected]="type() === category.key"
                      [disabled]="editing()" (click)="setType(category.key)">
                <lf-icon [name]="category.icon" [size]="17" />
                <span>{{ category.label }}</span>
                @if (type() === category.key) { <lf-icon class="selected-check" name="check" [size]="14" /> }
              </button>
            }
          </div>
          @if (editing()) { <p class="inline-note">A post's category cannot be changed after it is shared.</p> }
        </section>

        @if (!type()) {
          <div class="start-hint">
            <span class="hint-icon"><lf-icon name="edit" [size]="18" /></span>
            <p>Choose a category to start your post.</p>
          </div>
        } @else if (step() === 'write') {
          <section class="write-step" aria-label="Describe what happened">
            <div class="section-heading">
              <strong>Fill in the details</strong>
              <span>{{ categoryLabel() }}</span>
            </div>
            <p class="example-hint">Replace the example with the real details - Generate turns it into a poster.</p>
            <textarea class="example-input" rows="10" maxlength="5000" data-field="body"
                      [value]="body()" (input)="onBody($any($event.target).value)"></textarea>
            @if (media().length) {
              <div class="media-preview" aria-label="Attached media">
                @for (item of media(); track item.id) {
                  <div class="media-tile">
                    @if (item.kind === 'video') {
                      <video [src]="item.src" controls preload="metadata"></video>
                    } @else {
                      <img [src]="item.src" alt="Post attachment" />
                    }
                    <button type="button" class="remove-media" (click)="removeMedia(item.id)" aria-label="Remove attachment">
                      <lf-icon name="x" [size]="14" />
                    </button>
                  </div>
                }
              </div>
            }
            <div class="attach-row">
              <button type="button" class="attach-button" (click)="attach()"
                      [disabled]="busy() || hasVideo() || media().length >= 4">
                <lf-icon name="image" [size]="18" /> <span>Attach</span>
              </button>
              <span class="attachment-hint">Up to 4 photos or 1 video</span>
              <button type="button" class="reset-link" (click)="fillExample()">Reset example</button>
            </div>
            <button class="gen-btn" type="button" [disabled]="busy()" [class.ready]="canGenerate()" (click)="generate()">
              <lf-icon name="sparkle" [size]="18" /> Generate poster
            </button>
          </section>
        } @else {
          <section class="preview-step lf-fade-in" aria-label="Poster preview">
            <div class="preview-head">
              <strong>Your poster</strong>
              <span>Exactly how it will look in the feed.</span>
            </div>
            @if (draft(); as preview) {
              <lf-post-card [post]="preview" [author]="me()" [preview]="true" />
            }
            <div class="preview-actions">
              <button class="lf-btn" type="button" (click)="backToEdit()">Edit details</button>
              <button class="gen-btn" type="button" [disabled]="busy()" (click)="submit()">
                {{ busy() ? (editing() ? 'Saving…' : 'Posting…') : (editing() ? 'Save changes' : 'Post now') }}
              </button>
            </div>
          </section>
        }

        @if (error()) { <p class="error-message" role="alert"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
        <p class="footnote">Share only information you are allowed to post. In an emergency, call 10111.</p>
      </main>
    </ion-content>
  `,
  styles: [`
    :host { --fb-blue: var(--lf-primary); --fb-text: var(--ion-text-color); --fb-muted: var(--lf-muted); --fb-line: var(--lf-line); --fb-soft: var(--lf-input); }
    .fb-create-header { background: var(--lf-card); border-bottom: 1px solid var(--fb-line); }
    .icon-button { width: 36px; height: 36px; border: 0; border-radius: 50%; display: grid; place-items: center; background: var(--fb-soft); color: var(--fb-text); cursor: pointer; transition: background .16s ease, transform .16s ease; }
    .icon-button:active { transform: scale(.94); }
    .composer { width: min(100%, 600px); margin: 0 auto; padding: 14px 14px calc(26px + var(--lf-safe-bottom)); color: var(--fb-text); }
    .author-row { display: flex; align-items: center; gap: 10px; padding: 0 0 12px; }
    .author-meta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .author-meta > strong { font-size: 14px; }
    .audience-picker { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 5px; background: var(--fb-soft); color: var(--fb-text); font-size: 13px; font-weight: 600; }
    .audience-picker select, .spotlight-picker select { border: 0; outline: 0; background: transparent; color: inherit; font: inherit; appearance: none; cursor: pointer; }
    .spotlight-picker { display: flex; gap: 8px; align-items: center; min-height: 36px; padding: 0 10px; margin: 0 0 12px 50px; border: 1px solid var(--fb-line); border-radius: 7px; color: var(--fb-muted); font-size: 14px; }
    .spotlight-picker select { flex: 1; color: var(--fb-text); }
    .inline-note { margin: 0 0 12px 50px; color: var(--fb-muted); font-size: 14px; line-height: 1.4; }
    .category-block { padding: 12px 0 10px; border-top: 1px solid var(--lf-line-soft); border-bottom: 1px solid var(--lf-line-soft); }
    .section-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 0 9px; color: var(--fb-text); font-size: 15px; }
    .section-heading span { color: var(--fb-muted); font-size: 13px; font-weight: 500; }
    .category-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
    .category { position: relative; display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 7px 10px; border: 1px solid var(--fb-line); border-radius: 8px; background: var(--lf-card); color: var(--fb-text); text-align: left; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .16s ease, border-color .16s ease, transform .16s ease; }
    .category lf-icon { color: var(--fb-blue); }
    .category.selected { border-color: var(--lf-primary); background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .category:active { transform: scale(.98); }
    .category:disabled { cursor: default; opacity: .85; }
    .selected-check { margin-left: auto; color: var(--fb-blue) !important; }
    .start-hint { display: flex; align-items: center; gap: 10px; margin: 14px 0 4px; padding: 12px; border-radius: 8px; background: var(--lf-card); border: 1px solid var(--fb-line); color: var(--fb-muted); }
    .start-hint p { margin: 0; font-size: 15px; }
    .hint-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; background: var(--lf-primary-soft); color: var(--lf-primary-soft-text); }
    .write-step { display: flex; flex-direction: column; gap: 10px; padding-top: 13px; }
    .write-step .section-heading { margin-bottom: 0; }
    .example-hint { margin: 0; color: var(--fb-muted); font-size: 13.5px; line-height: 1.4; }
    .example-input { width: 100%; box-sizing: border-box; min-height: 190px; padding: 12px; border: 1px solid var(--fb-line); border-radius: 8px; background: var(--lf-card); color: var(--fb-text); font: inherit; font-size: 15px; line-height: 1.55; outline: none; resize: vertical; transition: border-color .16s ease, box-shadow .16s ease; }
    .example-input:focus { border-color: var(--lf-primary); box-shadow: 0 0 0 2px rgba(var(--lf-primary-rgb), .18); }
    .media-preview { display: flex; flex-wrap: wrap; gap: 7px; }
    .media-tile { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; background: var(--fb-soft); }
    .media-tile img, .media-tile video { width: 100%; height: 100%; object-fit: cover; }
    .remove-media { position: absolute; right: 4px; top: 4px; display: grid; place-items: center; width: 23px; height: 23px; border: 0; border-radius: 50%; background: rgba(0,0,0,.68); color: #fff; cursor: pointer; }
    .attach-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--lf-line-soft); border-bottom: 1px solid var(--lf-line-soft); }
    .attach-button { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent; color: var(--fb-muted); font-size: 14px; font-weight: 600; cursor: pointer; }
    .attach-button lf-icon { color: #45bd62; }
    .attach-button:disabled { opacity: .4; cursor: default; }
    .attachment-hint { color: var(--fb-muted); font-size: 12px; }
    .reset-link { margin-left: auto; border: 0; background: none; padding: 6px 2px; color: var(--lf-link); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .gen-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--fb-blue); color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; transition: filter .15s ease, transform .15s ease; }
    .gen-btn:disabled { opacity: .45; cursor: default; }
    .gen-btn.ready { box-shadow: 0 0 0 2px color-mix(in srgb, var(--lf-primary) 22%, transparent); }
    .gen-btn:active:not(:disabled) { transform: scale(.98); }
    .preview-step { display: flex; flex-direction: column; gap: 12px; padding-top: 13px; }
    .preview-head { display: flex; flex-direction: column; gap: 2px; }
    .preview-head strong { font-size: 16px; }
    .preview-head span { color: var(--fb-muted); font-size: 13px; }
    .preview-step lf-post-card { display: block; margin: 0 -14px; }
    .preview-actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 8px; }
    .preview-actions .lf-btn { min-height: 46px; font-size: 15px; }
    .error-message { display: flex; align-items: center; gap: 6px; padding: 9px 10px; margin: 12px 0 0; border-radius: 6px; background: color-mix(in srgb, var(--lf-signal) 12%, transparent); color: var(--lf-signal); font-size: 14px; }
    .footnote { margin: 14px 0 0; color: var(--fb-muted); font-size: 12px; line-height: 1.4; }
    @media (max-width: 370px) { .composer { padding-inline: 10px; } .preview-step lf-post-card { margin: 0 -10px; } .category-grid { gap: 5px; } .category { padding-inline: 7px; font-size: 13px; } }
  `]
})
export class CreatePostComponent implements OnInit {
  protected data = inject(DataService);
  private auth = inject(AuthService);
  private mediaSvc = inject(MediaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private sheetCtl = inject(ActionSheetController);

  protected readonly categories = CATEGORIES;

  type = signal<PostType | null>(null);
  editing = signal(false);
  busy = signal(false);
  error = signal('');
  step = signal<'write' | 'preview'>('write');
  postId: string | null = null;

  /** The one textbox, the attachments, and who sees the post. */
  readonly body = signal('');
  readonly media = signal<MediaItem[]>([]);
  readonly audience = signal<Audience>('public');
  readonly spotlightId = signal<string | null>(null);

  /** The post being edited, if any - fields the text cannot express survive from here. */
  readonly existing = signal<Post | null>(null);
  /** What Generate pulled out of the text, and the feed-card preview built from it. */
  readonly built = signal<BuiltPost | null>(null);
  readonly draft = signal<Post | null>(null);

  readonly me = computed(() => this.auth.user());
  readonly userAvatar = computed(() => this.data.avatarFor(this.auth.user()));
  readonly userName = computed(() => this.auth.user()?.displayName ?? 'You');
  readonly mySpotlights = computed(() => this.data.mySpotlights());
  readonly canGenerate = computed(() => {
    if (!this.type() || this.body().trim().length < 30) return false;
    return this.audience() !== 'surname' || !!this.spotlightId();
  });

  async ngOnInit(): Promise<void> {
    await this.data.loadStatic();
    const routeType = this.route.snapshot.paramMap.get('type');
    if (routeType && CATEGORIES.some((category) => category.key === routeType)) this.setType(routeType as PostType);

    const editId = this.route.snapshot.paramMap.get('id');
    if (editId) {
      const post = await this.data.loadPost(editId);
      if (!post || !this.data.canEdit(post)) {
        this.error.set('You can only edit a post you shared.');
        return;
      }
      this.postId = post.id;
      this.existing.set(post);
      this.editing.set(true);
      this.type.set(post.type);
      this.body.set(post.body?.trim() ? post.body : this.templateFor(post.type));
      this.media.set([...post.media]);
      this.audience.set(post.audience);
      this.spotlightId.set(post.spotlightId);
    }
  }

  setType(type: PostType): void {
    if (this.editing()) return;
    this.type.set(type);
    this.step.set('write');
    this.built.set(null);
    this.draft.set(null);
    if (!this.body().trim()) this.body.set(this.templateFor(type));
    this.error.set('');
  }

  /** The category's example, back in the box. */
  fillExample(): void {
    const type = this.type();
    if (!type) return;
    this.body.set(this.templateFor(type));
    this.step.set('write');
    this.error.set('');
  }

  onBody(value: string): void {
    this.body.set(value);
    if (this.error()) this.error.set('');
  }

  setAudience(value: string): void {
    const audience = value as Audience;
    this.audience.set(audience);
    this.spotlightId.set(audience === 'surname' ? (this.spotlightId() ?? this.mySpotlights()[0]?.id ?? null) : null);
  }

  audienceIcon(): string {
    const audience = this.audience();
    return audience === 'public' ? 'globe' : audience === 'followers' ? 'users' : 'award';
  }

  categoryLabel(): string {
    return this.categories.find((category) => category.key === this.type())?.label ?? 'Post';
  }

  hasVideo(): boolean { return this.media().some((item) => item.kind === 'video'); }

  async attach(): Promise<void> {
    if (this.media().length >= 4 || this.hasVideo()) return;
    const sheet = await this.sheetCtl.create({
      header: 'Attach',
      buttons: [
        { text: 'Photo', icon: 'image' as const, handler: () => { void this.addPhoto(); } },
        { text: 'Video', icon: 'videocam' as const, handler: () => { void this.addVideo(); } },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  async addPhoto(): Promise<void> {
    if (this.media().length >= 4 || this.hasVideo()) return;
    const item = await this.mediaSvc.pickImage({ quality: 76 });
    if (!item) {
      if (this.mediaSvc.lastError()) this.error.set(this.mediaSvc.lastError()!);
      return;
    }
    const src = await this.mediaSvc.compress(item.src, 1200);
    this.media.update((current) => [...current, { ...item, src }]);
  }

  async addVideo(): Promise<void> {
    if (this.media().length) return;
    const item = await this.mediaSvc.pickVideo();
    if (!item) {
      if (this.mediaSvc.lastError()) this.error.set(this.mediaSvc.lastError()!);
      return;
    }
    this.media.set([item]);
  }

  removeMedia(id: string): void {
    this.media.update((current) => current.filter((item) => item.id !== id));
  }

  /**
   * Reads the textbox and builds the poster. Throws the exact message the
   * person needs when something is missing - never a silent dead end.
   */
  private build(): BuiltPost {
    const type = this.type();
    const raw = this.body().trim();
    if (!type) throw new Error('Choose what you are posting first.');
    if (raw.length < 30) {
      throw new Error('Tell the full story in the box - at least 30 characters, so people can actually help.');
    }
    if (this.audience() === 'surname' && !this.spotlightId()) {
      throw new Error('Choose which Spotlight community should see this.');
    }
    // The composer never offers the legacy 'story' type; the cast only says
    // the parser treats it like any other category.
    const parsed = parsePosterText(type as PosterCategory, raw);
    const where = (LOCATION_LABEL as Record<string, string>)[type] ?? 'Last seen';
    if (!parsed.province) {
      throw new Error(`Which province did this happen in? Add it to the ${where} line, e.g. "${LOCATION_EXAMPLE}".`);
    }
    if (!parsed.town) {
      throw new Error(`Add the town or suburb to the ${where} line, e.g. "${LOCATION_EXAMPLE}".`);
    }

    const prev = this.existing();
    const prevSubject = prev?.subject;
    const personType = type === 'missing' || type === 'khumbulekhaya' || type === 'pet';
    const subject: Post['subject'] = personType || (type === 'sighting' && parsed.subjectName) ? {
      name: parsed.subjectName,
      age: parsed.subjectAge,
      gender: prevSubject?.gender ?? 'unknown',
      height: prevSubject?.height ?? '',
      build: prevSubject?.build ?? '',
      skinTone: prevSubject?.skinTone ?? '',
      hair: prevSubject?.hair ?? '',
      eyes: prevSubject?.eyes ?? '',
      clothing: prevSubject?.clothing ?? '',
      distinguishing: prevSubject?.distinguishing ?? '',
      medical: prevSubject?.medical ?? '',
      vehicle: prevSubject?.vehicle ?? '',
      languages: prevSubject?.languages ?? '',
      surname: parsed.subjectName.trim().split(/\s+/).at(-1) ?? '',
      relationship: prevSubject?.relationship ?? ''
    } : null;
    const prevVehicle = prev?.vehicleDetails;
    const vehicleDetails: Post['vehicleDetails'] = type === 'vehicle' ? {
      makeModel: parsed.vehicleMakeModel,
      registration: parsed.vehicleRegistration,
      colour: parsed.vehicleColour,
      bodyType: prevVehicle?.bodyType ?? ''
    } : null;
    const prevDanger = prev?.danger;
    const danger: Post['danger'] = type === 'danger' ? {
      kind: parsed.dangerKind,
      stillIds: prevDanger?.stillIds ?? [],
      clearIds: prevDanger?.clearIds ?? [],
      clearedAt: prevDanger?.clearedAt ?? null
    } : null;
    const prevKhumbu = prev?.khumbu;
    const khumbu: Post['khumbu'] = type === 'khumbulekhaya' ? {
      daysOut: prevKhumbu?.daysOut ?? null,
      leftHomeAt: prevKhumbu?.leftHomeAt ?? null,
      reasonGuess: parsed.message,
      claimedByUserId: prevKhumbu?.claimedByUserId ?? null,
      claimedAt: prevKhumbu?.claimedAt ?? null,
      subjectResponse: prevKhumbu?.subjectResponse ?? 'none',
      subjectNote: prevKhumbu?.subjectNote ?? '',
      wantedAnswers: prevKhumbu?.wantedAnswers ?? { yes: 0, no: 0, myVote: null }
    } : null;

    return {
      title: this.makeTitle(type, parsed),
      province: parsed.province,
      town: parsed.town,
      lastSeenWhere: parsed.lastSeenWhere || parsed.town,
      contactValue: parsed.contact,
      caseNumber: parsed.caseNumber || null,
      subject,
      vehicleDetails,
      danger,
      khumbu
    };
  }

  private makeTitle(type: PostType, parsed: ParsedPoster): string {
    const label = this.categoryLabel();
    if (type === 'vehicle' && parsed.vehicleMakeModel) return `Stolen vehicle: ${parsed.vehicleMakeModel}`;
    if (parsed.subjectName) return `${label}: ${parsed.subjectName}`;
    const opening = type === 'danger' && parsed.alertRaw ? parsed.alertRaw : (parsed.narrative[0] ?? '');
    const title = `${label}: ${opening.slice(0, 64).trim() || 'Community update'}`;
    return title.trim().length >= 8 ? title : `${label}: community update`;
  }

  /** Generate: parse the text, then show the real feed card as the preview. */
  generate(): void {
    this.error.set('');
    const me = this.auth.user();
    if (!me) {
      void this.router.navigate(['/auth'], { queryParams: { next: '/new' } });
      return;
    }
    try {
      const built = this.build();
      this.built.set(built);
      this.draft.set(this.draftPost(me.id, built));
      this.step.set('preview');
      this.scrollToTop();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not read these details');
      this.scrollToError();
    }
  }

  backToEdit(): void {
    this.step.set('write');
  }

  async submit(): Promise<void> {
    const built = this.built();
    const type = this.type();
    this.error.set('');
    if (!built || !type) {
      this.step.set('write');
      return;
    }
    const prev = this.existing();
    this.busy.set(true);
    try {
      if (this.editing() && this.postId) {
        await this.data.updatePost(this.postId, {
          title: built.title,
          body: this.body().trim(),
          media: this.media(),
          province: built.province,
          town: built.town,
          lastSeenAt: prev?.lastSeenAt ?? null,
          lastSeenWhere: built.lastSeenWhere,
          caseNumber: built.caseNumber,
          subject: built.subject,
          vehicleDetails: built.vehicleDetails,
          audience: this.audience(),
          spotlightId: this.spotlightId(),
          chatEnabled: prev?.chatEnabled ?? true,
          allowComments: prev?.allowComments ?? true,
          anonymous: prev?.anonymous ?? false,
          askWanted: prev?.askWanted ?? type === 'khumbulekhaya',
          contactLabel: prev?.contactLabel ?? 'Family contact',
          contactValue: built.contactValue,
          contactVisibleTo: prev?.contactVisibleTo ?? 'verified',
          khumbu: built.khumbu,
          danger: built.danger
        });
      } else {
        await this.data.createPost({
          type,
          title: built.title,
          body: this.body().trim(),
          media: this.media(),
          province: built.province,
          town: built.town,
          lastSeenAt: null,
          lastSeenWhere: built.lastSeenWhere,
          geo: null,
          contactLabel: 'Family contact',
          contactValue: built.contactValue,
          contactVisibleTo: 'verified',
          caseNumber: built.caseNumber,
          reward: null,
          subject: built.subject,
          vehicleDetails: built.vehicleDetails,
          audience: this.audience(),
          spotlightId: this.spotlightId(),
          chatEnabled: true,
          allowComments: true,
          anonymous: false,
          askWanted: type === 'khumbulekhaya',
          khumbu: built.khumbu,
          danger: built.danger
        });
      }
      await this.router.navigate(['/home']);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not share this post');
      this.scrollToError();
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The preview post. It mirrors what `DataService.createPost` would save -
   * same defaults, same under-review rule for a missing child - so the card
   * on this screen is pixel for pixel the card the feed will show. It is
   * never saved; posting builds the real one.
   */
  private draftPost(authorId: string, built: BuiltPost): Post {
    const type = this.type()!;
    const now = Date.now();
    const prev = this.existing();
    return {
      id: 'preview',
      type,
      status: type === 'missing' && (built.subject?.age ?? 99) < 18 ? 'under_review' : 'active',
      authorId,
      anonymous: prev?.anonymous ?? false,
      askWanted: prev?.askWanted ?? type === 'khumbulekhaya',
      title: built.title,
      body: this.body().trim(),
      media: this.media(),
      province: built.province,
      town: built.town,
      lastSeenAt: prev?.lastSeenAt ?? null,
      lastSeenWhere: built.lastSeenWhere,
      geo: prev?.geo ?? null,
      contactLabel: prev?.contactLabel ?? 'Family contact',
      contactValue: built.contactValue,
      contactVisibleTo: prev?.contactVisibleTo ?? 'verified',
      caseNumber: built.caseNumber,
      reward: prev?.reward ?? null,
      createdAt: now,
      updatedAt: now,
      subject: built.subject,
      vehicleDetails: built.vehicleDetails ?? null,
      audience: this.audience(),
      spotlightId: this.spotlightId(),
      chatEnabled: prev?.chatEnabled ?? true,
      allowComments: prev?.allowComments ?? true,
      allowShare: true,
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
      shares: 0,
      views: 0,
      savedBy: 0,
      voterIds: {},
      escalation: { requested: false, consentGranted: false, consentAt: null, partners: [] },
      consent: [],
      sightingVerified: null,
      searchParty: null,
      locationCheck: {
        subjectRegisteredInApp: false,
        requestedBy: null,
        requestedAt: null,
        consentFromSubject: 'none',
        consentAt: null,
        points: [],
        deviceReachable: false,
        lastKnownAt: null,
        note: ''
      },
      khumbu: built.khumbu,
      danger: built.danger,
      outcome: { found: false, foundAt: null, whereaboutsFound: '', closedBy: null, note: '' },
      events: [{ at: now, kind: 'claimed', byUserId: authorId, note: type === 'danger' ? 'Danger alert posted' : 'Posted by family/close contact' }],
      flags: [],
      outcomeNudgeAt: null
    };
  }

  private templateFor(type: PostType): string {
    return (POSTER_TEMPLATES as Record<string, string>)[type] ?? POSTER_TEMPLATES.missing;
  }

  private scrollToError(): void {
    if (typeof document === 'undefined') return;
    const target = document.querySelector('[data-field="body"]')
      ?? document.querySelector('.composer');
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  private scrollToTop(): void {
    if (typeof document === 'undefined') return;
    document.querySelector('.preview-step')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  close(): void { void this.router.navigate(['/home']); }
}
