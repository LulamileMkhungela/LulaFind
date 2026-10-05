import { Component, Input, signal } from '@angular/core';
import { CheckInStatus } from '../../core/models/types';
import { IconComponent } from './icon.component';

/**
 * Round avatar with an optional status ring.
 *
 * The ring is how a person's "am I safe?" check-in reads at a glance, anywhere
 * their face appears - profile, feed card, story rail:
 *   safe        -> green
 *   unfamiliar  -> amber
 *   need_help   -> red
 * No status, or a status the viewer is not allowed to see, gets no ring.
 * `ring` still works on its own for the neutral highlight used elsewhere.
 */
@Component({
  selector: 'lf-avatar',
  standalone: true,
  imports: [IconComponent],
  template: `
    <span class="avatar-shell" [style.width.px]="size" [style.height.px]="size">
      @if (!src || failed()) {
        <div class="fallback" [style.background]="bg" [style.fontSize.px]="size * 0.36"
             [class.ring]="ring && !status" role="img" [attr.aria-label]="label"
             [attr.title]="label">{{ text }}</div>
      } @else {
        <img [src]="src" [alt]="label" [class.ring]="ring && !status"
             [attr.title]="label" (error)="failed.set(true)" loading="lazy" decoding="async" />
      }
      @if (status) {
        <span class="status-dot" [attr.data-status]="status" role="img" [attr.aria-label]="statusLabel()"
              [attr.title]="statusLabel()"><lf-icon [name]="statusIcon()" [size]="dotSize()" [weight]="3" /></span>
      }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; }
    .avatar-shell { position: relative; display: inline-block; }
    img, .fallback { width: 100%; height: 100%; border-radius: 50%; }
    img { object-fit: cover; display: block; background: var(--lf-card-2); }
    img.ring, .fallback.ring { box-shadow: 0 0 0 2px var(--lf-card), 0 0 0 4px var(--lf-primary); }
    .fallback { display: flex; align-items: center; justify-content: center;
      font-weight: 700; color: #fff; letter-spacing: -0.4px; }

    /* The compact status dot is a second, icon-plus-colour cue: it reads like
       an online/status indicator without making the whole portrait a badge. */
    .status-dot { position: absolute; right: -2px; bottom: -2px; z-index: 1;
      width: clamp(14px, 34%, 23px); height: clamp(14px, 34%, 23px);
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%; color: #fff; border: 2px solid var(--lf-card);
      box-shadow: 0 1px 3px #0008; }
    .status-dot[data-status="safe"] { background: var(--lf-ubuntu); }
    .status-dot[data-status="unfamiliar"] { background: var(--lf-marigold); color: #201500; }
    .status-dot[data-status="need_help"] { background: var(--lf-signal); }
    .status-dot[data-status="watch_me"] { background: var(--lf-marigold); color: #201500; }
  `]
})
export class AvatarComponent {
  @Input() src = '';
  @Input() name = '';
  @Input() size = 40;
  @Input() ring = false;
  /** A visible check-in status draws a coloured ring instead of the neutral one. */
  @Input() status: CheckInStatus | null = null;
  failed = signal(false);

  get text(): string {
    return this.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'M';
  }

  /** Colour is never the only clue. */
  get label(): string {
    const base = this.name.trim() || 'Profile';
    if (this.status === 'safe') return `${base}, safe check-in`;
    if (this.status === 'unfamiliar') return `${base}, unfamiliar place check-in`;
    if (this.status === 'watch_me') return `${base}, asking people to watch out`;
    if (this.status === 'need_help') return `${base}, asking for help`;
    return base;
  }

  statusIcon(): string {
    return this.status === 'need_help' ? 'alert' : this.status === 'watch_me' ? 'eye' : this.status === 'unfamiliar' ? 'map' : 'check';
  }
  statusLabel(): string {
    return this.status === 'safe' ? 'Checked in safe'
      : this.status === 'unfamiliar' ? 'Checked in at an unfamiliar place'
      : this.status === 'watch_me' ? 'Asked followers to watch out'
      : 'Needs help';
  }
  dotSize(): number {
    return Math.max(10, Math.round(this.size * 0.28));
  }

  get bg(): string {
    let h = 0;
    for (let i = 0; i < this.name.length; i++) h = (h * 31 + this.name.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 58% 42%), hsl(${(h + 40) % 360} 55% 26%))`;
  }
}
