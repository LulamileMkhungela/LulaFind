import { Component, EventEmitter, Output, input } from '@angular/core';

/**
 * The row of faces a composer carries. LinkedIn puts one under the status box and
 * under a comment box; ours does the same for a message and a comment, from one
 * component, so the two can never drift apart.
 *
 * Real phone emoji only - no image pack to ship, nothing to download, and they
 * render in whatever style the device already uses. Which also means they are
 * already on the keyboard: this row is a shortcut, not the only way in.
 */
export const QUICK_EMOJIS = ['👍', '🙏', '❤️', '😢', '😮', '🎉', '✅', '❌', '🚨', '🚔', '🐕', '🏠', '📍', '📞', '🕐', '⭐'];

@Component({
  selector: 'lf-emoji-row',
  standalone: true,
  template: `
    <div class="lf-emoji-row" role="group" [attr.aria-label]="label()">
      @for (e of list(); track e) {
        <button type="button" (click)="pick(e)">{{ e }}</button>
      }
    </div>
  `,
  styles: [`
    .lf-emoji-row { display: flex; flex-wrap: wrap; gap: 2px; }
    .lf-emoji-row button { display: flex; align-items: center; justify-content: center; min-width: 34px; height: 30px;
      padding: 0 4px; border: none; border-radius: 8px; background: none; font: inherit; font-size: 19px; line-height: 1;
      cursor: pointer; }
    .lf-emoji-row button:hover { background: var(--lf-surface-hover); }
    .lf-emoji-row button:focus-visible { outline: 2px solid var(--lf-primary-fill); outline-offset: 1px; }
    .lf-emoji-row button:active { transform: scale(1.25); }
  `]
})
export class EmojiRowComponent {
  /** Faces on offer; the composer can pass a shorter list. */
  readonly list = input(QUICK_EMOJIS);
  readonly label = input('Reactions - they go into the text');
  @Output() picked = new EventEmitter<string>();

  protected pick(e: string): void {
    this.picked.emit(e);
  }
}
