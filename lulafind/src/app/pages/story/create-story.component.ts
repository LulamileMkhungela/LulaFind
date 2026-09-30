import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { MediaService } from '../../core/services/media.service';
import { Audience, MediaItem } from '../../core/models/types';
import { STORY_BLACK, storyBg } from '../../core/data/seed';

/**
 * The story composer, built the way a WhatsApp status is built:
 *
 *  - the whole screen IS the story (black to start), not a form with a preview
 *    panel beside it;
 *  - you tap the middle and type straight onto the canvas - white words on the
 *    background, no input box;
 *  - a row of tools sits at the bottom: Text, Photo, Colour, and a preview of
 *    what you have attached;
 *  - privacy is one chip above the tools ("Everyone", "My Spotlight",
 *    "My followers") which opens the same choices as a sheet, and Spotlight
 *    only offers communities you have actually joined;
 *  - Share is the only action that leaves the screen.
 */
@Component({
  selector: 'lf-create-story',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="stage" [style.background]="bg()">
      @if (currentMedia(); as m) {
        <img class="shot" [src]="m.src" alt="Story photo" />
      }
      <div class="scrim"></div>

      <!-- top bar -->
      <header class="bar">
        <button class="round" type="button" (click)="cancel()" aria-label="Close story composer">
          <lf-icon name="x" [size]="22" />
        </button>
        <span class="grow"></span>
        <!--
          Share always answers a tap: a disabled button leaves a person guessing,
          so an unfinished story explains itself instead (same rule as New post).
        -->
        <button class="send" type="button" (click)="publish()" [disabled]="busy()" [class.ready]="canPublish()">
          @if (busy()) { Sharing… } @else { <lf-icon name="send" [size]="17" [filled]="true" /> Share }
        </button>
      </header>

      <!-- the canvas: tap and type, WhatsApp style -->
      <div class="canvas" (click)="focusText()">
        <textarea #caption class="caption" rows="1" maxlength="600"
                  [style.color]="inkColour()"
                  [style.font-size.px]="captionSize()"
                  placeholder="Type a status"
                  [value]="text()"
                  (input)="onType($event)"
                  (focus)="typing.set(true)"
                  (blur)="typing.set(false)"></textarea>
        <p class="hint" [class.gone]="text().length > 0">Tap to type</p>
      </div>

      <!-- privacy + tools -->
      <footer class="tools" [style.padding-bottom]="'calc(12px + var(--lf-safe-bottom) + var(--keyboard-offset))'">
        @if (panel() === 'privacy') {
          <div class="panel">
            <p class="panel__title">Who can see this story?</p>
            @for (option of audiences; track option.key) {
              <button class="line" type="button" [class.on]="audience() === option.key" (click)="pick(option.key)">
                <span class="line__ic"><lf-icon [name]="option.icon" [size]="17" /></span>
                <span class="line__tx"><strong>{{ option.label }}</strong><small>{{ audienceHelp(option.key) }}</small></span>
                @if (audience() === option.key) { <lf-icon name="check" [size]="18" /> }
              </button>
            }
            @if (audience() === 'surname') {
              @if (mySpotlights().length) {
                <div class="panel__row">
                  <span>Community</span>
                  <select [value]="spotlightId() ?? ''" (change)="spotlightId.set($any($event.target).value || null)">
                    <option value="">Choose a Spotlight</option>
                    @for (spotlight of mySpotlights(); track spotlight.id) { <option [value]="spotlight.id">{{ spotlight.surname }}</option> }
                  </select>
                </div>
              } @else {
                <p class="panel__note">You have not joined a Spotlight yet, so this story will not be shared. Join one first.</p>
                <button class="linkbtn" type="button" (click)="openSpotlights()">Find a Spotlight</button>
              }
            }
            <p class="panel__note">Replies are private. Only you can read them.</p>
          </div>
        }

        @if (panel() === 'text') {
          <div class="panel">
            <p class="panel__title">Text colour</p>
            <div class="row">
              @for (c of inks; track c) {
                <button class="ink" type="button" [class.on]="ink() === c" [style.background]="c"
                        [style.color]="c" (click)="ink.set(c)" [attr.aria-label]="'Text colour ' + c">
                  <span [style.color]="c === '#ffffff' ? '#111' : '#fff'">A</span>
                </button>
              }
            </div>
            <p class="panel__title">Text size</p>
            <div class="row">
              @for (s of sizes; track s) {
                <button class="size" type="button" [class.on]="size() === s" (click)="size.set(s)">
                  <span [style.font-size.px]="8 + s * 2">A</span>
                </button>
              }
            </div>
          </div>
        }

        @if (panel() === 'colour') {
          <div class="panel">
            <p class="panel__title">Background</p>
            <div class="row">
              @for (swatch of swatches; track swatch) {
                <button class="chip" type="button" [class.on]="hue() === swatch" [style.background]="storyBg(swatch)"
                        [attr.aria-label]="swatch < 0 ? 'Black background' : 'Background ' + swatch"
                        (click)="hue.set(swatch)"></button>
              }
            </div>
          </div>
        }

        <div class="toolbar">
          <button class="tool" type="button" [class.on]="panel() === 'colour'" (click)="toggle('colour')">
            <span class="tool__ic swatch" [style.background]="bg()"></span>
            <span>Background</span>
          </button>
          <button class="tool" type="button" [class.on]="panel() === 'text'" (click)="toggle('text')">
            <span class="tool__ic"><lf-icon name="edit" [size]="20" /></span>
            <span>Text</span>
          </button>
          <button class="tool" type="button" (click)="addPhoto()" [disabled]="media().length >= 3 || busy()">
            <span class="tool__ic"><lf-icon name="image" [size]="20" /></span>
            <span>{{ media().length ? media().length + ' of 3' : 'Photo' }}</span>
          </button>
          <button class="tool" type="button" [class.on]="panel() === 'privacy'" (click)="toggle('privacy')">
            <span class="tool__ic"><lf-icon [name]="audienceIcon()" [size]="20" /></span>
            <span>{{ audienceShort() }}</span>
          </button>
        </div>

        @if (media().length) {
          <div class="thumbs">
            @for (item of media(); track item.id; let i = $index) {
              <div class="thumb" [class.on]="previewIndex() === i">
                <button type="button" (click)="previewIndex.set(i)" [attr.aria-label]="'Show photo ' + (i + 1)"><img [src]="item.src" alt="" /></button>
                <button class="thumb__x" type="button" (click)="removePhoto(item.id)" [attr.aria-label]="'Remove photo ' + (i + 1)">
                  <lf-icon name="x" [size]="12" />
                </button>
              </div>
            }
          </div>
        }

        @if (notice()) { <p class="notice"><lf-icon name="info" [size]="14" /> {{ notice() }}</p> }
        @if (draftKept()) {
          <p class="notice" role="status">
            <lf-icon name="info" [size]="14" /> We kept what you typed.
            <button type="button" class="draft-x" (click)="discardDraft()">Start fresh</button>
          </p>
        }
        @if (error()) { <p class="error" role="alert"><lf-icon name="alert" [size]="14" /> {{ error() }}</p> }
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .stage {
      position: fixed; inset: 0; z-index: 300;
      display: flex; flex-direction: column;
      background-size: cover; background-position: center;
      color: #fff; overflow: hidden;
      padding-top: env(safe-area-inset-top);
    }
    .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    .scrim { position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(180deg, rgba(0,0,0,.42), transparent 22%, transparent 55%, rgba(0,0,0,.55)); }

    .bar { position: relative; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
    .round { width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 50%;
      background: rgba(0,0,0,.28); color: #fff; cursor: pointer; }
    .grow { flex: 1; }
    .send { display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 16px; border: 0; border-radius: 20px;
      background: var(--lf-primary); color: #fff; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
    .send:disabled { opacity: .45; }
    .send.ready { background: var(--lf-blue); color: #fff; }

    /* the canvas IS the story: words typed straight onto it, centred like WhatsApp */
    .canvas { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 24px 22px; min-height: 0; }
    .caption {
      width: 100%; max-width: 620px; box-sizing: border-box;
      border: 0; outline: 0; background: transparent; resize: none; overflow: hidden;
      text-align: center; font: 700 28px/1.3 var(--ion-font-family); text-shadow: 0 2px 16px rgba(0,0,0,.5);
      caret-color: #fff; field-sizing: content; min-height: 44px; max-height: 60vh;
    }
    .caption::placeholder { color: rgba(255,255,255,.6); font-weight: 600; }
    .hint { margin: 6px 0 0; font-size: 12.5px; color: rgba(255,255,255,.65); transition: opacity .2s; }
    .hint.gone { opacity: 0; }

    .tools { position: relative; z-index: 2; padding: 10px 12px calc(12px + var(--lf-safe-bottom));
      background: linear-gradient(transparent, rgba(0,0,0,.55)); display: flex; flex-direction: column; gap: 10px; }
    .toolbar { display: flex; align-items: stretch; gap: 6px; }
    .tool { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 7px 4px; border: 0; border-radius: 12px; background: transparent; color: rgba(255,255,255,.86);
      font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
    .tool.on { background: rgba(255,255,255,.16); color: #fff; }
    .tool:disabled { opacity: .5; }
    .tool__ic { display: grid; place-items: center; width: 26px; height: 26px; }
    .tool__ic.swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid rgba(255,255,255,.75);
      background-size: cover; }

    .panel { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 16px;
      background: rgba(20,20,22,.92); backdrop-filter: blur(8px); }
    .panel__title { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,.7); }
    .panel__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
    .panel__row select { min-height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.25);
      background: rgba(255,255,255,.08); color: #fff; font: inherit; font-size: 13px; }
    .panel__note { margin: 0; font-size: 12px; line-height: 1.4; color: rgba(255,255,255,.7); }
    .line { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 8px; border: 1px solid transparent;
      border-radius: 10px; background: transparent; color: #fff; text-align: left; font: inherit; cursor: pointer; }
    .line.on { background: rgba(255,255,255,.14); }
    .line__ic { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.12); }
    .line__tx { flex: 1; display: flex; flex-direction: column; gap: 1px; }
    .line__tx strong { font-size: 14px; }
    .line__tx small { font-size: 11.5px; color: rgba(255,255,255,.65); }
    .linkbtn { align-self: flex-start; border: 0; padding: 0; background: none; color: #8ec7ff; font: inherit; font-size: 13px; font-weight: 700; }

    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { width: 34px; height: 34px; padding: 0; border: 2px solid rgba(255,255,255,.35); border-radius: 50%; cursor: pointer; }
    .chip.on { border-color: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,.28); }
    .ink { width: 34px; height: 34px; display: grid; place-items: center; border: 2px solid rgba(255,255,255,.35);
      border-radius: 50%; font-weight: 800; font-size: 14px; cursor: pointer; background: #fff; }
    .ink.on { border-color: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,.28); }
    .size { width: 40px; height: 34px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.3);
      border-radius: 8px; background: transparent; color: #fff; cursor: pointer; }
    .size.on { background: rgba(255,255,255,.16); }

    .thumbs { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0; }
    .thumb { position: relative; width: 46px; height: 46px; flex: 0 0 46px; border: 2px solid transparent; border-radius: 10px; }
    .thumb.on { border-color: #fff; }
    .thumb button:first-child { width: 100%; height: 100%; padding: 0; border: 0; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,.3); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .thumb__x { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; display: grid; place-items: center;
      border: 1px solid #fff; border-radius: 50%; background: rgba(28,30,33,.9); color: #fff; }

    .notice, .error { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12.5px; line-height: 1.35; }
    .notice { color: rgba(255,255,255,.78); }
    .draft-x { border: 0; background: transparent; color: #fff; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
    .error { color: #ffb4ad; }
    @media (min-width: 720px) {
      .caption { font-size: 34px; }
      .tools { max-width: 720px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    }
  `]
})
export class CreateStoryComponent {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private mediaSvc = inject(MediaService);
  private router = inject(Router);

  @ViewChild('caption') caption?: ElementRef<HTMLTextAreaElement>;

  constructor() { this.restoreDraft(); }

  readonly text = signal('');
  readonly hue = signal(STORY_BLACK);
  readonly ink = signal('#ffffff');
  readonly size = signal(14);
  readonly media = signal<MediaItem[]>([]);
  readonly previewIndex = signal(0);
  readonly audience = signal<Audience>('public');
  readonly spotlightId = signal<string | null>(null);
  readonly panel = signal<'none' | 'privacy' | 'text' | 'colour'>('none');
  readonly typing = signal(false);
  busy = signal(false);
  error = signal('');
  /** Not an error: e.g. this build has no camera module, your photos were opened. */
  notice = signal('');

  protected readonly audiences: { key: Audience; icon: string; label: string }[] = [
    { key: 'public', icon: 'globe', label: 'Everyone' },
    { key: 'surname', icon: 'award', label: 'My Spotlight' },
    { key: 'followers', icon: 'users', label: 'My followers' }
  ];
  /** Text colours, WhatsApp-style: white first, then high-contrast choices. */
  protected readonly inks = ['#ffffff', '#000000', '#ffd400', '#ff5a5a', '#7ef0ff', '#c7a3ff'];
  protected readonly sizes = [12, 14, 17, 21];
  /** Black is the default; the rest are the story hues. */
  protected readonly swatches = [STORY_BLACK, 221, 28, 340, 48, 120, 168, 265, 0];
  protected readonly storyBg = storyBg;

  protected readonly me = computed(() => this.auth.user());
  readonly mySpotlights = computed(() => this.data.mySpotlights());
  readonly currentMedia = computed(() => this.media()[this.previewIndex()] ?? null);

  bg(): string { return storyBg(this.hue()); }
  inkColour(): string { return this.ink(); }
  captionSize(): number { return this.size(); }

  audienceIcon(): string { return this.audiences.find((o) => o.key === this.audience())?.icon ?? 'globe'; }
  audienceShort(): string {
    switch (this.audience()) {
      case 'followers': return 'Followers';
      case 'surname': return 'Spotlight';
      default: return 'Everyone';
    }
  }

  audienceHelp(value: Audience): string {
    if (value === 'public') return 'Anyone on LulaFind can view';
    if (value === 'followers') return 'People who follow you can view';
    return 'Members of one Spotlight community';
  }

  toggle(panel: 'privacy' | 'text' | 'colour'): void {
    this.panel.set(this.panel() === panel ? 'none' : panel);
    this.error.set('');
  }

  onType(ev: Event): void {
    const el = ev.target as HTMLTextAreaElement;
    this.text.set(el.value);
    this.persistDraft();
  }

  /* ------------------------------------------------------------------ *
   * Finish later - the same rule as the post composer. A story is short,
   * so only the words (and the colours picked so far) are kept; photos are
   * device files and cannot come back.
   * ------------------------------------------------------------------ */

  private draftClosed = false;
  readonly draftKept = signal(false);
  private static readonly DRAFT_KEY = 'lulafind.story.draft';

  private persistDraft(): void {
    if (this.draftClosed) return;
    try {
      if (!this.text().trim()) { localStorage.removeItem(CreateStoryComponent.DRAFT_KEY); return; }
      localStorage.setItem(CreateStoryComponent.DRAFT_KEY, JSON.stringify({
        text: this.text(), hue: this.hue(), ink: this.ink(), size: this.size(), at: Date.now()
      }));
    } catch { /* storage blocked - nothing is kept, and nothing pretends to be */ }
  }

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(CreateStoryComponent.DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { text?: string; hue?: number; ink?: string; size?: number };
      if (!d.text?.trim()) { localStorage.removeItem(CreateStoryComponent.DRAFT_KEY); return; }
      this.text.set(d.text);
      if (typeof d.hue === 'number') this.hue.set(d.hue);
      if (d.ink) this.ink.set(d.ink);
      if (d.size) this.size.set(d.size);
      this.draftKept.set(true);
    } catch {
      try { localStorage.removeItem(CreateStoryComponent.DRAFT_KEY); } catch { /* ignore */ }
    }
  }

  /** Throw the kept story away and start blank. */
  discardDraft(): void {
    try { localStorage.removeItem(CreateStoryComponent.DRAFT_KEY); } catch { /* ignore */ }
    this.draftKept.set(false);
    this.text.set('');
    this.hue.set(STORY_BLACK);
    this.ink.set('#ffffff');
    this.size.set(14);
    this.error.set('');
  }

  focusText(): void {
    this.caption?.nativeElement.focus();
  }

  canPublish(): boolean {
    const hasContent = !!this.text().trim() || this.media().length > 0;
    return hasContent && (this.audience() !== 'surname' || this.mySpotlights().some((sp) => sp.id === this.spotlightId()));
  }

  pick(audience: Audience): void {
    this.audience.set(audience);
    this.error.set('');
    if (audience === 'surname' && !this.spotlightId()) this.spotlightId.set(this.mySpotlights()[0]?.id ?? null);
    if (audience !== 'surname') this.spotlightId.set(null);
  }

  async addPhoto(): Promise<void> {
    if (this.media().length >= 3) return;
    this.error.set('');
    const item = await this.mediaSvc.pickImage({ source: 'gallery', quality: 72 });
    if (this.mediaSvc.notice()) this.notice.set(this.mediaSvc.notice()!);
    if (!item) {
      if (this.mediaSvc.lastError()) this.error.set(this.mediaSvc.lastError()!);
      return;
    }
    const src = await this.mediaSvc.compress(item.src, 1200);
    this.media.set([...this.media(), { ...item, src }]);
    this.previewIndex.set(this.media().length - 1);
  }

  removePhoto(id: string): void {
    const next = this.media().filter((item) => item.id !== id);
    this.media.set(next);
    this.previewIndex.set(Math.max(0, Math.min(this.previewIndex(), next.length - 1)));
  }

  async publish(): Promise<void> {
    if (this.busy()) return;
    if (!this.text().trim() && !this.media().length) {
      this.error.set('Type something or add a photo first.');
      return;
    }
    if (this.audience() === 'surname' && !this.mySpotlights().some((sp) => sp.id === this.spotlightId())) {
      this.error.set('Choose which Spotlight community can see this story.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const story = await this.data.createStory({
        text: this.text(),
        media: this.media(),
        bgHue: this.hue(),
        audience: this.audience(),
        spotlightId: this.audience() === 'surname' ? this.spotlightId() : null
      });
      this.draftClosed = true;
      try { localStorage.removeItem(CreateStoryComponent.DRAFT_KEY); } catch { /* ignore */ }
      await this.router.navigate(['/story', story.id]);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'Could not post the story');
    } finally {
      this.busy.set(false);
    }
  }

  openSpotlights(): void { void this.router.navigate(['/spotlight']); }
  cancel(): void { void this.router.navigate(['/home']); }
}
