import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { IconComponent } from './icon.component';
import { PostActionsService } from '../../core/services/post-actions.service';

/**
 * LinkedIn's repost sheet: a bottom sheet with exactly two choices.
 *   Repost                      Instantly bring this post to others' feeds
 *   Repost with your thoughts   Create a new post with this one attached
 * Mounted once in the app shell and driven by `PostActionsService`.
 */
@Component({
  selector: 'lf-repost-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (actions.repostTarget(); as p) {
      <div class="scrim" (click)="actions.closeRepost()"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Repost options">
        <span class="grab" aria-hidden="true"></span>
        <button type="button" class="row" [disabled]="actions.busy()" (click)="actions.repostNow()">
          <span class="ic"><lf-icon name="repost" [size]="24" /></span>
          <span class="tx"><strong>Repost</strong><small>Instantly bring this post to others\u2019 feeds</small></span>
        </button>
        <button type="button" class="row" [disabled]="actions.busy()" (click)="actions.repostWithThoughts()">
          <span class="ic"><lf-icon name="edit" [size]="24" /></span>
          <span class="tx"><strong>Repost with your thoughts</strong><small>Create a new post with this one attached</small></span>
        </button>
        @if (actions.repostUndo()) {
          <button type="button" class="row undo" [disabled]="actions.busy()" (click)="actions.undoRepost()">
            <span class="ic"><lf-icon name="trash" [size]="24" /></span>
            <span class="tx"><strong>Undo repost</strong><small>You reposted this earlier</small></span>
          </button>
        }
      </div>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; z-index: 20000; background: var(--lf-scrim); animation: fade .18s ease-out; }
    .sheet {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 20001; margin: 0 auto; max-width: 560px;
      padding: 8px 0 calc(14px + var(--lf-safe-bottom)); border-radius: 14px 14px 0 0;
      background: var(--lf-card); box-shadow: var(--lf-shadow-lg); animation: up .22s ease-out;
    }
    .grab { display: block; width: 40px; height: 4px; margin: 2px auto 8px; border-radius: 2px; background: var(--lf-line); }
    .row { width: 100%; display: flex; align-items: center; gap: 16px; padding: 12px 20px; border: 0; background: transparent;
      color: var(--ion-text-color); text-align: left; font: inherit; cursor: pointer; }
    .row:hover, .row:active { background: var(--lf-hover); }
    .row:disabled { opacity: .55; }
    .ic { display: grid; place-items: center; width: 24px; color: var(--ion-text-color); }
    .tx { display: flex; flex-direction: column; gap: 2px; }
    .tx strong { font-size: 16px; font-weight: 600; }
    .tx small { font-size: 14px; color: var(--lf-muted); }
    .row.undo .ic, .row.undo strong { color: var(--lf-signal); }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes up { from { transform: translateY(100%); } to { transform: none; } }
    @media (prefers-reduced-motion: reduce) { .scrim, .sheet { animation: none; } }
  `]
})
export class RepostSheetComponent {
  protected actions = inject(PostActionsService);

  @HostListener('document:keydown.escape')
  onEsc(): void { this.actions.closeRepost(); }
}
