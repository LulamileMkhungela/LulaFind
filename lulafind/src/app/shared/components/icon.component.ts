import { Component, Input } from '@angular/core';
import { IconWeight, iconPath, strokeFor } from '../../core/theme/icon-registry';

@Component({
  selector: 'lf-icon',
  standalone: true,
  template: `
    <svg [attr.viewBox]="'0 0 24 24'" [attr.width]="size" [attr.height]="size"
         [attr.fill]="filled ? 'currentColor' : 'none'" [attr.stroke]="filled ? 'none' : 'currentColor'" [attr.stroke-width]="stroke"
         stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" aria-hidden="true" focusable="false">
      <path [attr.d]="path" />
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; justify-content: center; line-height: 0; flex-shrink: 0; }
    svg { display: block; }
  `]
})
export class IconComponent {
  @Input() name = 'info';
  @Input() size: number | string = 20;
  /**
   * 'thin', 'regular' (default) or 'bold' - the set's three weights, scaled to
   * the size so a 13px tick and a 24px tab glyph carry the same visual weight.
   * A number still works for the rare one-off.
   */
  @Input() weight: number | string | IconWeight = 'regular';
  /** Facebook fills the icon of the selected tab. */
  @Input() filled = false;

  get path(): string {
    return iconPath(this.name) ?? iconPath('info') ?? '';
  }

  get stroke(): number {
    return strokeFor(Number(this.size) || 20, this.weight);
  }
}
