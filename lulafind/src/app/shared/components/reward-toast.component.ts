import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from './icon.component';
import { RewardService } from '../../core/services/reward.service';

/**
 * The app's one reward toast, mounted once at the root.
 *
 * It sits above the tab bar, out of the way of the button that was just pressed,
 * and it can be tapped to open the impact screen - the point of the moment is to
 * lead somewhere, not to be admired. It is `aria-live="polite"` so a screen
 * reader hears it as an aside rather than an alarm, and it fades on its own.
 */
@Component({
  selector: 'lf-reward-toast',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (moment(); as m) {
      <div class="toast" role="status" aria-live="polite" [class.toast--calm]="calm()"
           [attr.data-kind]="m.levelUp ? 'level' : m.badge ? 'badge' : 'points'">
        <button class="toast__body" type="button" (click)="open(m)">
          <span class="toast__mark">
            @if (m.levelUp) {
              <lf-icon name="trophy" [size]="20" />
            } @else if (m.badge) {
              <lf-icon [name]="m.badge.icon" [size]="20" />
            } @else {
              <lf-icon name="sparkle" [size]="20" />
            }
          </span>
          <span class="toast__text">
            @if (m.levelUp) {
              <strong>You are now a {{ m.levelUp.name }}</strong>
              <span>{{ m.levelUp.meaning }}</span>
            } @else if (m.badge) {
              <strong>Badge earned: {{ m.badge.name }}</strong>
              <span>{{ m.badge.how }}</span>
            } @else {
              <strong>+{{ m.points }} points</strong>
              <span>{{ m.reason }}</span>
            }
          </span>
        </button>
        <button class="toast__x" type="button" aria-label="Dismiss" (click)="dismiss()">
          <lf-icon name="x" [size]="15" />
        </button>
      </div>
    }
  `,
  styles: [`
    /*
     * Top, not bottom. Every page in the app already confirms its own action
     * with a message at the bottom ("You joined the Ndlela community"), and two
     * notices stacked at the bottom read as a shouting match. A milestone
     * arrives quietly at the top, below the header, and leaves on its own.
     */
    :host { position: fixed; left: 0; right: 0; top: calc(env(safe-area-inset-top, 0px) + 64px);
      z-index: 900; display: flex; justify-content: center; pointer-events: none; padding: 0 12px; }
    .toast { pointer-events: auto; display: flex; align-items: center; gap: 2px;
      width: 100%; max-width: 460px; padding: 8px 6px 8px 10px; border-radius: 999px;
      background: var(--lf-card); border: 1px solid var(--lf-line);
      box-shadow: 0 8px 24px rgb(0 0 0 / .18);
      animation: drop .26s cubic-bezier(.2,.8,.2,1) both; }
    .toast--calm { animation: none; }
    .toast__body { flex: 1; display: flex; align-items: center; gap: 9px; min-width: 0;
      background: none; border: 0; padding: 0; text-align: left; font-family: inherit;
      color: var(--ion-text-color); cursor: pointer; }
    .toast__mark { flex: 0 0 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
      background: color-mix(in srgb, var(--lf-primary) 14%, transparent); color: var(--lf-primary); }
    .toast[data-kind="level"] .toast__mark { background: color-mix(in srgb, var(--lf-signal) 18%, transparent); color: var(--lf-signal); }
    .toast[data-kind="badge"] .toast__mark { background: color-mix(in srgb, var(--lf-ubuntu) 18%, transparent); color: var(--lf-ubuntu); }
    .toast__text { display: flex; flex-direction: column; gap: 0; min-width: 0; }
    .toast__text strong { font-size: 13.5px; font-weight: 700; line-height: 1.2;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast__text span { font-size: 12px; line-height: 1.2; color: var(--lf-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast__x { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; border: 0;
      background: none; color: var(--lf-muted); display: grid; place-items: center; cursor: pointer; }
    .toast__x:hover { background: var(--lf-hover); }
    @keyframes drop {
      from { transform: translateY(-10px) scale(.98); opacity: 0; }
      to   { transform: none; opacity: 1; }
    }
  `]
})
export class RewardToastComponent {
  /** Pulled out so the template can read it without a pipe. */
  readonly calm = signal(false);
  private rewards = inject(RewardService);
  private router = inject(Router);
  readonly moment = computed(() => this.rewards.moment());

  constructor() {
    this.calm.set(this.rewards.calm);
  }

  dismiss(): void {
    this.rewards.dismiss();
  }

  open(m: { levelUp?: unknown; badge?: unknown }): void {
    this.rewards.dismiss();
    void this.router.navigate(['/progress'], {
      queryParams: m.badge ? { badge: (m.badge as { id: string }).id } : {}
    });
  }
}
