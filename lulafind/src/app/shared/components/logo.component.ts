import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * The LulaFind mark.
 *
 * A magnifier with a location pin inside the lens: the app finds where a
 * missing person was last seen. Drawn in the LulaFind blue (#2196F3) so the
 * mark and the product colour are the same thing.
 *
 * One inline SVG so it renders identically on web, in the Android webview and in
 * the iOS WKWebView, with no network request and no icon font. The same artwork
 * lives in `src/assets/logo-mark.svg` and is what `scripts/generate-icons.mjs`
 * turns into the Android / iOS launcher icons, so the in-app mark and the icon
 * on the home screen can never drift apart.
 */
@Component({
  selector: 'lf-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      [attr.aria-label]="label"
      [attr.role]="label ? 'img' : 'presentation'"
      viewBox="0 0 512 512"
      focusable="false">
      <title>{{ label }}</title>
      <defs>
        <linearGradient [attr.id]="tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#64b5f6" />
          <stop offset=".5" stop-color="#2196f3" />
          <stop offset="1" stop-color="#1976d2" />
        </linearGradient>
        <linearGradient [attr.id]="lens" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".30" />
          <stop offset="1" stop-color="#ffffff" stop-opacity=".08" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" ry="116" [attr.fill]="'url(#' + tile + ')'" />
      <path d="M116 0h280c-38 62-96 104-174 126-70 20-140 22-198 10C34 96 62 34 116 0z" fill="#ffffff" opacity=".08" />
      <circle cx="206" cy="200" r="112" [attr.fill]="'url(#' + lens + ')'" />
      <circle cx="206" cy="200" r="112" fill="none" stroke="#ffffff" stroke-width="30" />
      <path d="M288 282 398 392" fill="none" stroke="#ffffff" stroke-width="34" stroke-linecap="round" />
      <path
        transform="translate(206 186) scale(8) translate(-12 -9)"
        fill="#ffffff"
        d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
      <circle cx="206" cy="186" r="21" [attr.fill]="'url(#' + tile + ')'" />
    </svg>
  `,
  styles: [`:host { display: inline-flex; line-height: 0; flex-shrink: 0; } svg { display: block; }`]
})
export class LogoComponent {
  @Input() size = 32;
  /** Accessible name. Empty (the default) keeps the mark decorative. */
  @Input() label = 'LulaFind';
  /** Gradient ids must be unique per instance or the second copy wins. */
  private readonly tile = `lf-tile-${LogoComponent.next++}`;
  private readonly lens = `lf-lens-${LogoComponent.next}`;
  private static next = 0;
}
