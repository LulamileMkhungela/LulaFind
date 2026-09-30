import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { IonContent } from '@ionic/angular/ion-content';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { PlatformService } from '../../core/services/platform.service';
import { MediaItem, Post } from '../../core/models/types';
import { uid } from '../../core/utils/format';
import {
  POSTER_TEMPLATES, PosterContent, PosterTemplateId, drawPoster, isPosterType, loadPosterImage, posterContent, publicPoster
} from '../../core/utils/poster';
import { SAPS_MISSING_LIST } from '../../core/data/sa-help';

/**
 * Pick a poster design, preview it, and save or share it as a picture.
 * Opened right after a missing / left-home / lost-pet post is published.
 */
@Component({
  selector: 'lf-poster',
  standalone: true,
  imports: [IonContent, IconComponent, TopNavComponent],
  template: `
    <lf-top-nav title="Poster" [backTo]="'/post/' + id" />
    <ion-content class="lf-page">
      @if (p(); as post) {
        @if (justPosted()) {
          <div class="done"><lf-icon name="check" [size]="18" />
            <span><strong>Your post is live.</strong> Pick a poster to share on WhatsApp, Facebook and community groups.</span>
          </div>
        }

        <div class="stage">
          <canvas #cv class="cv" role="img" [attr.aria-label]="'Poster preview for ' + post.title"></canvas>
          @if (busy()) { <div class="stage__busy">Designing…</div> }
        </div>

        <div class="picker" role="listbox" aria-label="Poster designs">
          @for (t of templates; track t.id) {
            <button type="button" class="tpl" role="option" [attr.aria-selected]="tpl() === t.id" [class.on]="tpl() === t.id" [disabled]="busy()" (click)="choose(t.id)">
              <span class="tpl__sw" [style.background]="'linear-gradient(135deg,' + t.swatch[0] + ' 0%,' + t.swatch[2] + ' 55%,' + t.swatch[1] + ' 100%)'"></span>
              <strong>{{ t.name }}</strong>
              <small>{{ t.tagline }}</small>
            </button>
          }
        </div>

        @if (!hasPersonPhoto()) {
          <p class="note photo-required" role="status">Add a clear photo of the person to this post before sharing a poster. The poster preview is not shareable without their photo.</p>
        } @else if (!photoReady()) {
          <p class="note photo-required" role="status">Preparing the person’s photo. If it does not appear, edit the post and try a different image. The poster cannot be shared until the photo is included.</p>
        }
        @if (isMine() && flyer().withheld) {
          <p class="note">Kept off every poster: {{ flyer().withheld }}. Ask a caller to name that mark before you trust them.</p>
        }

        <div class="actions">
          @if (isMine()) {
            <button class="lf-btn lf-btn--primary lf-btn--block" type="button" (click)="useSelectedInFeed()"
                    [disabled]="busy() || savingPost() || !photoReady() || !previewReady()">
              <lf-icon name="image" [size]="16" />
              {{ savingPost() ? 'Saving to feed…' : posterOnFeed() ? 'Update poster in feed' : 'Add poster to feed' }}
            </button>
            @if (posterOnFeed()) {
              <p class="feed-saved" role="status">Current feed design: {{ savedTemplateName() }}. Save this selection to update it.</p>
            }
          }
          <button class="lf-btn lf-btn--block" type="button" (click)="share()" [disabled]="busy() || !photoReady() || !previewReady()"><lf-icon name="share" [size]="16" /> Share poster</button>
          <button class="lf-btn lf-btn--block" type="button" (click)="download()" [disabled]="busy() || !photoReady() || !previewReady()"><lf-icon name="download" [size]="16" /> Save picture</button>
          <a class="lf-btn lf-btn--block" [href]="sapsList" target="_blank" rel="noopener">Official SAPS missing list</a>
          <button class="skip" type="button" (click)="done()">{{ justPosted() ? 'Skip for now' : 'Back to post' }}</button>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .done { display: flex; gap: 10px; align-items: flex-start; margin: 12px var(--lf-gap) 0; padding: 12px 14px; border-radius: 12px;
      background: color-mix(in srgb, var(--lf-ubuntu) 16%, transparent); color: var(--ion-text-color); font-size: 14px; line-height: 1.4; }
    .done lf-icon { color: var(--lf-ubuntu); margin-top: 2px; }
    .stage { position: relative; margin: 14px auto 0; width: min(88%, 420px); border-radius: 14px; overflow: hidden; box-shadow: 0 14px 40px rgba(0,0,0,.45); aspect-ratio: 1080 / 1350; background: #111; }
    .cv { display: block; width: 100%; height: 100%; }
    .stage__busy { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.45); color: #fff; font-weight: 700; }
    .picker { display: flex; gap: 10px; overflow-x: auto; padding: 16px var(--lf-gap) 8px; scroll-snap-type: x proximity; scrollbar-width: none; }
    .picker::-webkit-scrollbar { display: none; }
    .tpl { flex: 0 0 132px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; padding: 8px; text-align: left;
      border: 2px solid var(--lf-line); border-radius: 14px; background: var(--lf-card); color: var(--ion-text-color); cursor: pointer; }
    .tpl.on { border-color: var(--lf-primary); background: var(--lf-primary-soft); }
    .tpl__sw { width: 100%; height: 64px; border-radius: 8px; margin-bottom: 4px; }
    .tpl strong { font-size: 14px; } .tpl small { font-size: 11.5px; color: var(--lf-muted); line-height: 1.25; }
    .note { margin: 4px var(--lf-gap) 0; font-size: 13px; color: var(--lf-muted); }
    .photo-required { color: var(--lf-signal-text); font-weight: 600; }
    .feed-saved { margin: 0; color: var(--lf-ubuntu); font-size: 13px; font-weight: 600; text-align: center; }
    .actions .lf-btn:disabled { opacity: .5; cursor: default; }
    .actions { display: flex; flex-direction: column; gap: 8px; padding: 12px var(--lf-gap) 32px; max-width: 520px; margin: 0 auto; }
    a.lf-btn { text-decoration: none; }
    .skip { border: 0; background: none; color: var(--lf-muted); font: inherit; font-weight: 600; padding: 10px; cursor: pointer; }
  `]
})
export class PosterComponent implements OnInit, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private data = inject(DataService);
  private auth = inject(AuthService);
  private platform = inject(PlatformService);
  private toast = inject(ToastController);

  @ViewChild('cv') cv?: ElementRef<HTMLCanvasElement>;

  protected readonly sapsList = SAPS_MISSING_LIST;
  protected readonly templates = POSTER_TEMPLATES;
  id = '';
  p = signal<Post | null>(null);
  tpl = signal<PosterTemplateId>('signal');
  busy = signal(false);
  justPosted = signal(false);
  private image: HTMLImageElement | null = null;
  private content: PosterContent | null = null;
  private ready = false;
  readonly photoReady = signal(false);
  readonly previewReady = signal(false);
  readonly savingPost = signal(false);

  readonly flyer = computed(() => publicPoster(this.p()!));
  readonly hasPersonPhoto = computed(() => !!this.p()?.media.some((item) => item.kind === 'image'));
  readonly isMine = computed(() => this.p()?.authorId === this.auth.viewerId);
  readonly posterOnFeed = computed(() => !!this.p()?.poster?.media?.src);

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.justPosted.set(this.route.snapshot.queryParamMap.get('new') === '1');
    const cached = this.data.post(this.id);
    if (cached) {
      if (!isPosterType(cached.type)) { await this.leaveUnsupported(); return; }
      this.p.set(cached);
      this.restoreTemplate(cached);
    }
    const fresh = await this.data.loadPost(this.id);
    if (fresh) {
      if (!isPosterType(fresh.type)) { await this.leaveUnsupported(); return; }
      this.p.set(fresh);
      this.restoreTemplate(fresh);
    }
    await this.prepare();
  }

  ngAfterViewInit(): void {
    this.ready = true;
    void this.render();
  }

  private async leaveUnsupported(): Promise<void> {
    await this.say('Poster templates are available for missing-person, pet, and left-home posts.');
    await this.router.navigate(['/post', this.id]);
  }

  private restoreTemplate(post: Post): void {
    const id = post.poster?.templateId as PosterTemplateId | undefined;
    if (id && this.templates.some((template) => template.id === id)) this.tpl.set(id);
  }

  savedTemplateName(): string {
    const id = this.p()?.poster?.templateId;
    return this.templates.find((template) => template.id === id)?.name ?? 'poster';
  }

  private async prepare(): Promise<void> {
    const post = this.p();
    if (!post) return;
    const src = post.media.find((m) => m.kind === 'image')?.src ?? null;
    this.photoReady.set(false);
    this.previewReady.set(false);
    this.image = await loadPosterImage(src);
    this.photoReady.set(!!this.image);
    this.content = posterContent(post, this.platform.link(`/post/${post.id}`), src);
    // the canvas exists only once the post has rendered
    setTimeout(() => void this.render(), 0);
  }

  async choose(id: PosterTemplateId): Promise<void> {
    if (this.busy()) return;
    this.tpl.set(id);
    await this.render();
  }

  private async render(): Promise<void> {
    const el = this.cv?.nativeElement;
    if (!el || !this.content || !this.ready) return;
    this.busy.set(true);
    try {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready.catch(() => undefined);
      }
      drawPoster(el, this.tpl(), this.content, this.image);
      this.previewReady.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  /** PNG blob of the poster; a generated poster is never exported without the person's photo. */
  private async blob(): Promise<Blob | null> {
    const el = this.cv?.nativeElement;
    if (!el || !this.image || !this.photoReady() || !this.previewReady()) return null;
    return new Promise<Blob | null>((resolve) => {
      try { el.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
    });
  }

  private fileName(): string {
    const name = (this.p()?.subject?.name || this.p()?.title || 'poster').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `lulafind-${name || 'poster'}-${this.tpl()}.png`;
  }

  async download(): Promise<void> {
    if (!this.photoReady()) return void this.say('Add a clear photo of the person to the post before saving a poster.');
    const b = await this.blob();
    if (!b) return void this.say('Could not make the poster with the photo. Try another design or photo.');
    if (Capacitor.isNativePlatform()) {
      const uri = await this.saveNative(b);
      if (uri) return void this.say('Saved. Open Share to send it.');
    }
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = this.fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    await this.say('Poster saved to your downloads');
  }

  async share(): Promise<void> {
    const post = this.p();
    if (!post) return;
    if (!this.photoReady()) return void this.say('Add a clear photo of the person to the post before sharing a poster.');
    const b = await this.blob();
    if (!b) return void this.say('Could not make the poster with the photo. Try another design or photo.');
    const text = publicPoster(post).shareText;
    const link = this.platform.link(`/post/${post.id}`);
    if (b && Capacitor.isNativePlatform()) {
      const uri = await this.saveNative(b);
      if (uri) {
        try {
          const { Share } = await import('@capacitor/share');
          await Share.share({ title: post.title, text: `${text}\n${link}`, files: [uri], dialogTitle: 'Share poster' });
          return;
        } catch { /* closed or unavailable: fall through */ }
      }
    }
    if (b && typeof navigator !== 'undefined' && 'canShare' in navigator) {
      const file = new File([b], this.fileName(), { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: post.title, text: `${text}\n${link}` }); return; } catch { return; }
      }
    }
    await this.platform.share(post.title, text, link);
    if (b) await this.say('Link shared. Use Save picture to send the poster image too.');
  }

  /** Writes the PNG to the app cache and returns a file:// URI the share sheet accepts. */
  private async saveNative(b: Blob): Promise<string | null> {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(b);
      });
      const res = await Filesystem.writeFile({ path: this.fileName(), data, directory: Directory.Cache });
      return res.uri;
    } catch {
      return null;
    }
  }

  async useSelectedInFeed(): Promise<void> {
    const post = this.p();
    if (!post || !this.isMine() || this.savingPost()) return;
    if (!this.photoReady()) {
      await this.say('Add a clear photo of the person to the post before adding a poster to the feed.');
      return;
    }
    this.savingPost.set(true);
    try {
      const image = await this.blob();
      if (!image) throw new Error('Could not make the selected poster with the photo. Try another design.');
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the poster image'));
        reader.readAsDataURL(image);
      });
      const poster: NonNullable<Post['poster']> = {
        templateId: this.tpl(),
        createdAt: Date.now(),
        media: { id: uid('poster'), kind: 'image', src } as MediaItem
      };
      const updated = await this.data.updatePost(post.id, { poster });
      if (!updated) throw new Error('The post could not be updated. Try again.');
      this.p.set(updated);
      await this.say('Poster added to the feed. The original post text remains readable with Read more.');
    } catch (e: unknown) {
      await this.say(e instanceof Error ? e.message : 'Could not add the poster to the feed');
    } finally {
      this.savingPost.set(false);
    }
  }

  done(): void {
    void this.router.navigate(this.justPosted() ? ['/home'] : ['/post', this.id]);
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, position: 'bottom' });
    await t.present();
  }
}
