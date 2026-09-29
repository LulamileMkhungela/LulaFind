import { Component, Input, computed } from '@angular/core';
import { POST_TYPE_META, Post } from '../../core/models/types';
import { posterClose, posterKicker, publicPoster } from '../../core/utils/poster';
import { IconComponent } from './icon.component';

/**
 * The generated poster: kicker, title, photo and extracted detail lines on a
 * background the app picks from the category - yellow alert paper for a
 * missing person, red for danger, and so on. One component renders it in the
 * feed card, in the composer's Generate preview, and on the shareable poster
 * page, so the preview is exactly what the feed shows.
 */
@Component({
  selector: 'lf-poster-visual',
  standalone: true,
  imports: [IconComponent],
  template: `
    <figure class="lf-poster" [attr.data-tone]="tone()">
      <figcaption class="kicker">
        <lf-icon [name]="icon()" [size]="14" [weight]="2.6" /> {{ kicker() }}
      </figcaption>
      <h3>{{ post.title }}</h3>
      @if (showPhoto && photo()) { <img [src]="photo()" [alt]="post.title" loading="lazy" /> }
      @for (line of lines(); track line) { <p>{{ line }}</p> }
      <p class="close">{{ close() }}</p>
    </figure>
  `,
  styles: [`
    .lf-poster { margin: 6px 0 0; padding: 13px 14px; border-radius: 10px; border: 2px solid; }
    .kicker { display: flex; align-items: center; gap: 5px; margin: 0 0 5px; font-size: 12px; font-weight: 800; letter-spacing: .8px; }
    h3 { margin: 0 0 8px; font-size: 19px; line-height: 1.2; }
    img { width: 100%; max-height: 300px; object-fit: cover; border-radius: 6px; margin-bottom: 9px; display: block; }
    p { margin: 0 0 6px; font-size: 14.5px; font-weight: 600; line-height: 1.35; }
    p:last-child { margin-bottom: 0; }
    .close { margin-top: 9px; font-size: 12.5px; font-weight: 500; opacity: .85; }

    .lf-poster[data-tone='missing'] { background: #fff4b8; border-color: #1a1200; color: #1a1200; }
    .lf-poster[data-tone='missing'] .kicker { color: #9a1b1b; }
    .lf-poster[data-tone='khumbulekhaya'] { background: #ffedd6; border-color: #3a2403; color: #3a2403; }
    .lf-poster[data-tone='khumbulekhaya'] .kicker { color: #b35400; }
    .lf-poster[data-tone='vehicle'] { background: #ffe3e3; border-color: #330303; color: #330303; }
    .lf-poster[data-tone='vehicle'] .kicker { color: #9a1b1b; }
    .lf-poster[data-tone='pet'] { background: #dcf3e2; border-color: #0a2c12; color: #0a2c12; }
    .lf-poster[data-tone='pet'] .kicker { color: #146c2e; }
    .lf-poster[data-tone='sighting'] { background: #dcebff; border-color: #0a1f4d; color: #0a1f4d; }
    .lf-poster[data-tone='sighting'] .kicker { color: #1d4ed8; }
    .lf-poster[data-tone='danger'] { background: linear-gradient(160deg, #a11212, #7f1d1d); border-color: #450a0a; color: #fff; }
    .lf-poster[data-tone='danger'] .kicker { color: #ffd9d9; }
    .lf-poster[data-tone='other'] { background: var(--lf-card-2); border-color: var(--lf-line); color: var(--ion-text-color); }
    .lf-poster[data-tone='other'] .kicker { color: var(--lf-muted); }
  `]
})
export class PosterVisualComponent {
  @Input({ required: true }) post!: Post;
  /** False when the parent shows the photo separately (video, gallery). */
  @Input() showPhoto = true;

  readonly tone = computed(() =>
    ['missing', 'khumbulekhaya', 'vehicle', 'pet', 'sighting', 'danger'].includes(this.post?.type)
      ? this.post.type
      : 'other'
  );
  readonly icon = computed(() => POST_TYPE_META[this.post?.type ?? 'story'].icon);
  readonly kicker = computed(() => posterKicker(this.post?.type ?? 'story'));
  readonly close = computed(() => posterClose(this.post?.type ?? 'story'));
  readonly lines = computed(() => (this.post ? publicPoster(this.post).lines : []));
  readonly photo = computed(() =>
    this.post?.media.find((m) => m.kind === 'image')?.src ?? null
  );
}
