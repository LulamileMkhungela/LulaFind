import { Component, Directive, Input, OnChanges, inject, signal } from '@angular/core';
import { IconComponent } from './icon.component';
import { LULA_API } from '../../core/data/api';

/**
 * Photos and clips from a private bucket, shown without ever going broken.
 *
 * LulaFind's media are stored objects, not public URLs: a record holds
 * `storage://photos/<path>` and each read swaps that for a signed link that
 * expires in an hour. Two things used to go wrong on a card. A link that had
 * expired rendered as the browser's broken-image icon, and a signature the server
 * refused used to blank the `src` - the photo was stored and safe, and the feed
 * showed nothing.
 *
 * So the marker is kept, resolved here, retried once on an error, and only then
 * replaced by a tile that says what happened and lets the reader try again.
 */
/**
 * Shared by both media components. A `@Directive` with no selector is how Angular
 * passes `@Input()`s down to subclasses - undecorated base classes are invisible
 * to the template compiler.
 */
@Directive({ standalone: true })
export abstract class MediaBaseDirective implements OnChanges {
  protected api = inject(LULA_API);

  @Input() src = '';
  @Input() loading: 'lazy' | 'eager' = 'lazy';

  readonly shown = signal('');
  readonly failed = signal(false);
  readonly loaded = signal(false);
  protected triedAgain = false;

  ngOnChanges(): void {
    this.triedAgain = false;
    this.loaded.set(false);
    void this.resolve();
  }

  protected async resolve(): Promise<void> {
    const src = this.src;
    if (!src) {
      this.failed.set(false);
      this.shown.set('');
      return;
    }
    // A data URI, a blob or an https link needs no signature; only the marker does.
    if (!src.startsWith('storage://')) {
      this.shown.set(src);
      this.failed.set(false);
      return;
    }
    try {
      const resolved = await this.api.resolveMedia(src);
      if (resolved && !resolved.startsWith('storage://')) {
        this.shown.set(resolved);
        this.failed.set(false);
      } else {
        this.shown.set('');
        this.failed.set(true);
      }
    } catch {
      this.shown.set('');
      this.failed.set(true);
    }
  }

  /** One reload per src: an expired link comes back on a fresh signature. */
  onBroken(): void {
    if (this.triedAgain) {
      this.failed.set(true);
      this.shown.set('');
      return;
    }
    this.triedAgain = true;
    if (this.src.startsWith('data:') || this.src.startsWith('blob:')) {
      this.failed.set(true);
      this.shown.set('');
      return;
    }
    void this.resolve();
  }

  retry(): void {
    this.failed.set(false);
    this.triedAgain = false;
    void this.resolve();
  }
}

@Component({
  selector: 'lf-media-img',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (shown(); as url) {
      <img [src]="url" [alt]="alt" [attr.loading]="loading" [class.cover]="fit !== 'contain'" [class.contain]="fit === 'contain'"
           (error)="onBroken()" (load)="loaded.set(true)" [class.fade-in]="!loaded()" />
    } @else if (failed()) {
      <button class="stub stub--failed" type="button" (click)="retry()" aria-label="Try loading this photo again">
        <lf-icon name="image" [size]="22" />
        <span>Photo not available here yet</span>
        <small>Tap to try again</small>
      </button>
    } @else {
      <span class="stub" role="status" aria-label="Loading photo"><lf-icon name="image" [size]="22" /></span>
    }
  `,
  styles: [`
    :host { display: block; width: 100%; }
    img { display: block; width: 100%; height: 100%; object-fit: cover; }
    img.contain { object-fit: contain; }
    img.fade-in { animation: lf-media-fade .22s ease-out; }
    @keyframes lf-media-fade { from { opacity: 0; } to { opacity: 1; } }
    .stub { display: flex; width: 100%; min-height: 120px; align-items: center; justify-content: center; gap: 8px;
      flex-direction: column; border: 0; background: var(--lf-card-2); color: var(--lf-muted); font: inherit;
      font-size: 13px; padding: 18px 12px; box-sizing: border-box; }
    .stub--failed { cursor: pointer; }
    .stub--failed small { color: var(--lf-link); font-weight: 600; }
    @media (prefers-reduced-motion: reduce) { img.fade-in { animation: none; } }
  `]
})
export class MediaImageComponent extends MediaBaseDirective {
  @Input() alt = '';
  @Input() fit: 'cover' | 'contain' = 'cover';
}

/**
 * The clip version of the same promise. A video whose signature the server refused
 * used to render as a black box with a control bar and nothing to play; here it
 * says so, once, and offers a retry.
 */
@Component({
  selector: 'lf-media-video',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (shown(); as url) {
      <video [src]="url" controls [attr.preload]="preload" playsinline [attr.loading]="loading"
             (error)="onBroken()" (loadeddata)="loaded.set(true)" [attr.aria-label]="label"></video>
    } @else if (failed()) {
      <button class="stub stub--failed" type="button" (click)="retry()" aria-label="Try loading this video again">
        <lf-icon name="video" [size]="22" />
        <span>Video not available here yet</span>
        <small>Tap to try again</small>
      </button>
    } @else {
      <span class="stub" role="status" aria-label="Loading video"><lf-icon name="video" [size]="22" /></span>
    }
  `,
  styles: [`
    :host { display: block; width: 100%; }
    video { display: block; width: 100%; background: #000; }
    .stub { display: flex; width: 100%; min-height: 120px; align-items: center; justify-content: center; gap: 8px;
      flex-direction: column; border: 0; background: var(--lf-card-2); color: var(--lf-muted); font: inherit;
      font-size: 13px; padding: 18px 12px; box-sizing: border-box; }
    .stub--failed { cursor: pointer; }
    .stub--failed small { color: var(--lf-link); font-weight: 600; }
  `]
})
export class MediaVideoComponent extends MediaBaseDirective {
  @Input() label = 'Video';
  @Input() preload: 'metadata' | 'auto' | 'none' = 'metadata';
}
