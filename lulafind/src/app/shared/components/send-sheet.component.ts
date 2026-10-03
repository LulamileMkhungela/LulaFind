import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { PostActionsService } from '../../core/services/post-actions.service';
import { DataService } from '../../core/services/data.service';

/**
 * LinkedIn's Send sheet.
 *
 *   Send
 *   ┌──────────────────────────────┐
 *   │ Search people                │
 *   ├──────────────────────────────┤
 *   │ (avatar) Thabo Mokoena       │  ← tap sends it to them, in the app
 *   │          Community organiser │
 *   │ (avatar) Nomsa Dlamini       │
 *   ├──────────────────────────────┤
 *   │ ⤴  Share to other apps       │  ← the phone's own share sheet:
 *   └──────────────────────────────┘     WhatsApp, SMS, email
 *
 * Mounted once in the app shell and driven by `PostActionsService`, like the
 * repost sheet.
 */
@Component({
  selector: 'lf-send-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    @if (actions.sendTarget(); as post) {
      <div class="scrim" (click)="actions.closeSend()"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Send this post">
        <header class="head">
          <h2>Send</h2>
          <button type="button" class="x" (click)="actions.closeSend()" aria-label="Close">
            <lf-icon name="x" [size]="20" />
          </button>
        </header>

        <p class="what">{{ post.title }}</p>

        <label class="search">
          <lf-icon name="search" [size]="18" />
          <input type="search" inputmode="search" enterkeyhint="search" autocomplete="off"
                 placeholder="Search people" [value]="actions.sendQuery()"
                 (input)="actions.sendQuery.set($any($event.target).value)"
                 aria-label="Search people to send this post to" />
        </label>

        <div class="people">
          @if (actions.sendLoading()) {
            <p class="hint">Loading your people…</p>
          } @else if (!actions.matches(actions.sendQuery()).length) {
            <p class="hint">
              @if (actions.sendQuery().trim()) {
                Nobody by that name can be sent a post yet.
              } @else {
                Nobody to send to yet. Follow someone - when someone follows you back you can
                also send a post straight into your chat with them.
              }
            </p>
          } @else {
            @for (person of actions.matches(actions.sendQuery()); track person.profile.id) {
              <button type="button" class="row" [disabled]="actions.sendBusy()" (click)="actions.sendToUser(person)">
                <lf-avatar [src]="avatarFor(person.profile)" [name]="person.profile.displayName" [size]="40" />
                <span class="who">
                  <strong>{{ person.profile.displayName }}</strong>
                  <small>
                    @if (person.connection) { Connected - also goes to your chat }
                    @else { Follows you }
                  </small>
                </span>
                <lf-icon name="send" [size]="18" />
              </button>
            }
          }
        </div>

        <button type="button" class="share" (click)="actions.shareExternally()">
          <span class="ic"><lf-icon name="share" [size]="22" /></span>
          <span class="tx"><strong>Share to other apps</strong><small>WhatsApp, SMS, email and the rest of your phone</small></span>
        </button>
      </div>
    }
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; z-index: 20000; background: var(--lf-scrim); animation: fade .18s ease-out; }
    .sheet {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 20001; margin: 0 auto; max-width: 560px;
      max-height: 82vh; display: flex; flex-direction: column;
      padding: 12px 0 calc(14px + var(--lf-safe-bottom)); border-radius: 14px 14px 0 0;
      background: var(--lf-card); box-shadow: var(--lf-shadow-lg); animation: up .22s ease-out;
    }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 0 16px 8px; }
    .head h2 { margin: 0; font-size: 18px; font-weight: 700; }
    .x { border: 0; background: transparent; color: var(--lf-muted); padding: 6px; cursor: pointer; border-radius: 50%; }
    .x:hover { background: var(--lf-hover); }
    .what { margin: 0 16px 10px; font-size: 13px; color: var(--lf-muted);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

    .search { display: flex; align-items: center; gap: 8px; margin: 0 16px 8px; padding: 0 12px;
      height: 42px; border-radius: 999px; background: var(--lf-input); color: var(--lf-muted); }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
      color: var(--ion-text-color); font: inherit; font-size: 15px; }

    .people { overflow-y: auto; flex: 1; min-height: 0; }
    .hint { margin: 6px 16px 14px; font-size: 13.5px; line-height: 1.45; color: var(--lf-muted); }
    .row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 16px; border: 0;
      background: transparent; color: var(--ion-text-color); text-align: left; font: inherit; cursor: pointer; }
    .row:hover, .row:active { background: var(--lf-hover); }
    .row:disabled { opacity: .55; }
    .row > lf-icon { color: var(--lf-muted); }
    .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .who strong { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who small { font-size: 12.5px; color: var(--lf-muted); }

    /* The phone's own share sheet, kept visually apart from the people list. */
    .share { width: 100%; display: flex; align-items: center; gap: 14px; margin-top: 6px; padding: 12px 16px;
      border: 0; border-top: 1px solid var(--lf-line-soft); background: transparent;
      color: var(--ion-text-color); text-align: left; font: inherit; cursor: pointer; }
    .share:hover, .share:active { background: var(--lf-hover); }
    .share .ic { display: grid; place-items: center; width: 24px; }
    .share .tx { display: flex; flex-direction: column; gap: 2px; }
    .share .tx strong { font-size: 16px; font-weight: 600; }
    .share .tx small { font-size: 13.5px; color: var(--lf-muted); }

    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes up { from { transform: translateY(100%); } to { transform: none; } }
    @media (prefers-reduced-motion: reduce) { .scrim, .sheet { animation: none; } }
  `]
})
export class SendSheetComponent {
  protected actions = inject(PostActionsService);
  private data = inject(DataService);

  avatarFor(profile: { avatarUrl?: string | null; displayName: string; avatarHue?: number }): string {
    return this.data.avatarFor(profile as never);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.actions.closeSend(); }
}
