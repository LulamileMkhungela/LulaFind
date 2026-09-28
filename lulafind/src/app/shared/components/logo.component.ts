import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * The LulaFind mark.
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
          <stop offset="0" stop-color="#3d97ff" />
          <stop offset=".55" stop-color="#1877f2" />
          <stop offset="1" stop-color="#0a4fc4" />
        </linearGradient>
        <linearGradient [attr.id]="lens" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".28" />
          <stop offset="1" stop-color="#ffffff" stop-opacity=".10" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" ry="116" [attr.fill]="'url(#' + tile + ')'" />
      <path d="M116 0h280c-38 62-96 104-174 126-70 20-140 22-198 10C34 96 62 34 116 0z" fill="#ffffff" opacity=".10" />
      <circle cx="212" cy="206" r="104" [attr.fill]="'url(#' + lens + ')'" />
      <circle cx="212" cy="206" r="104" fill="none" stroke="#ffffff" stroke-width="30" />
      <path
        transform="translate(212 212) scale(.82)"
        fill="#ffffff"
        d="M0 62C-54 28-70 2-70-22c0-22 17-36 38-36 16 0 26 10 32 22 6-12 16-22 32-22 21 0 38 14 38 36 0 24-16 50-70 84z" />
      <path d="M289 283 398 392" fill="none" stroke="#ffffff" stroke-width="34" stroke-linecap="round" />
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
