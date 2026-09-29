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
import { Post } from '../../core/models/types';
import {
  POSTER_TEMPLATES, PosterContent, PosterTemplateId, drawPoster, loadPosterImage, posterContent, publicPoster
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
            <button type="button" class="tpl" role="option" [attr.aria-selected]="tpl() === t.id" [class.on]="tpl() === t.id" (click)="choose(t.id)">
              <span class="tpl__sw" [style.background]="'linear-gradient(135deg,' + t.swatch[0] + ' 0%,' + t.swatch[2] + ' 55%,' + t.swatch[1] + ' 100%)'"></span>
              <strong>{{ t.name }}</strong>
              <small>{{ t.tagline }}</small>
            </button>
          }
        </div>

        @if (isMine() && flyer().withheld) {
          <p class="note">Kept off every poster: {{ flyer().withheld }}. Ask a caller to name that mark before you trust them.</p>
        }

        <div class="actions">
          <button class="lf-btn lf-btn--primary lf-btn--block" type="button" (click)="share()"><lf-icon name="share" [size]="16" /> Share poster</button>
          <button class="lf-btn lf-btn--block" type="button" (click)="download()"><lf-icon name="download" [size]="16" /> Save picture</button>
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
  private photoFailed = false;

  readonly flyer = computed(() => publicPoster(this.p()!));
  readonly isMine = computed(() => this.p()?.authorId === this.auth.viewerId);

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.justPosted.set(this.route.snapshot.queryParamMap.get('new') === '1');
    const cached = this.data.post(this.id);
    if (cached) this.p.set(cached);
    const fresh = await this.data.loadPost(this.id);
    if (fresh) this.p.set(fresh);
    await this.prepare();
  }

  ngAfterViewInit(): void {
    this.ready = true;
    void this.render();
  }

  private async prepare(): Promise<void> {
    const post = this.p();
    if (!post) return;
    const src = post.media.find((m) => m.kind === 'image')?.src ?? null;
    this.image = await loadPosterImage(src);
    this.content = posterContent(post, this.platform.link(`/post/${post.id}`), src);
    // the canvas exists only once the post has rendered
    setTimeout(() => void this.render(), 0);
  }

  async choose(id: PosterTemplateId): Promise<void> {
    this.tpl.set(id);
    await this.render();
  }

  private async render(withPhoto = true): Promise<void> {
    const el = this.cv?.nativeElement;
    if (!el || !this.content || !this.ready) return;
    this.busy.set(true);
    try {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready.catch(() => undefined);
      }
      drawPoster(el, this.tpl(), this.content, withPhoto ? this.image : null);
    } finally {
      this.busy.set(false);
    }
  }

  /** PNG blob of the poster. If a remote photo taints the canvas, redraw without it. */
  private async blob(): Promise<Blob | null> {
    const el = this.cv?.nativeElement;
    if (!el) return null;
    const toBlob = () => new Promise<Blob | null>((resolve) => {
      try { el.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
    });
    let b = await toBlob();
    if (!b && this.image) {
      this.photoFailed = true;
      await this.render(false);
      b = await toBlob();
    }
    return b;
  }

  private fileName(): string {
    const name = (this.p()?.subject?.name || this.p()?.title || 'poster').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `lulafind-${name || 'poster'}-${this.tpl()}.png`;
  }

  async download(): Promise<void> {
    const b = await this.blob();
    if (!b) return void this.say('Could not make the picture. Try another design.');
    if (Capacitor.isNativePlatform()) {
      const uri = await this.saveNative(b);
      if (uri) return void this.say('Saved. Open Share to send it.');
    }
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = this.fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    await this.say(this.photoFailed ? 'Saved without the photo (it could not be read).' : 'Poster saved to your downloads');
  }

  async share(): Promise<void> {
    const post = this.p();
    if (!post) return;
    const b = await this.blob();
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

  done(): void {
    void this.router.navigate(this.justPosted() ? ['/home'] : ['/post', this.id]);
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, position: 'bottom' });
    await t.present();
  }
}
