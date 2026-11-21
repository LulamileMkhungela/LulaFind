import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { REACTIONS, ReactionKind } from '../../core/models/types';
import { IconComponent } from './icon.component';

/**
 * One reaction as a small coloured disc with a white glyph, the way LinkedIn
 * draws Like / Support / etc. `up` is "Have an idea" (the light bulb).
 */
@Component({
  selector: 'lf-reaction-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="disc" [style.width.px]="size()" [style.height.px]="size()" [style.background]="color()" [class.ring]="ring()">
      <lf-icon [name]="glyph()" [size]="size() * 0.58" weight="regular" [filled]="filled()" />
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .disc { display: inline-grid; place-items: center; border-radius: 50%; color: #fff; }
    .disc.ring { box-shadow: 0 0 0 2px var(--lf-card); }
  `]
})
export class ReactionIconComponent {
  readonly kind = input.required<ReactionKind>();
  readonly size = input(20);
  readonly ring = input(false);

  readonly color = computed(() => REACTIONS.find((r) => r.key === this.kind())?.color ?? '#378fe9');
  readonly glyph = computed(() => {
    switch (this.kind()) {
      case 'like': return 'thumbup';
      case 'support': return 'heart';
      case 'sad': return 'sad';
      default: return 'bulb';
    }
  });
  /** Thumb and heart read better solid; the face and bulb are line drawings. */
  readonly filled = computed(() => this.kind() === 'like' || this.kind() === 'support');
}
