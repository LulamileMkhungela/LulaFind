import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { DEFAULT_REACTION_LABEL, REACTIONS, ReactionKind, VoteValue, isReaction } from '../../core/models/types';
import { IconComponent } from './icon.component';
import { ReactionIconComponent } from './reaction-icon.component';

/**
 * The reaction control, behaving exactly like LinkedIn's action button:
 *
 *  - The main icon is an outlined thumbs-up and the label reads "Like" until
 *    you react.
 *  - Tap: opens the reaction choices; selecting the same reaction removes it.
 *  - Hold (or hover with a mouse): the tray opens with Like, Support, Sad and
 *    Have an idea, the way LinkedIn opens its reaction flyout. Slide onto one
 *    and lift your finger, or tap one, to pick it.
 *  - The button then reads the reaction you chose in that reaction's colour.
 *
 * It only reports the choice through `react`; the page decides what to save.
 */
@Component({
  selector: 'lf-reaction-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ReactionIconComponent],
  template: `
    @if (open()) {
      <div class="scrim" (pointerdown)="close($event)"></div>
      <div class="tray" role="menu" aria-label="Choose a reaction">
        @for (r of reactions; track r.key) {
          <button type="button" class="opt" role="menuitem" [attr.data-key]="r.key"
                  [class.hot]="hot() === r.key" [class.mine]="mine() === r.key"
                  [attr.aria-label]="r.label"
                  (pointerenter)="hot.set(r.key)" (pointerleave)="hot.set(null)"
                  (click)="choose(r.key, $event)">
            <span class="tip">{{ r.label }}</span>
            <lf-reaction-icon [kind]="r.key" [size]="hot() === r.key ? 42 : 34" />
          </button>
        }
      </div>
    }

    <button type="button" class="btn" [class.on]="!!current()" [style.--tone]="tone()"
            [attr.aria-pressed]="!!current()" [attr.aria-haspopup]="'menu'"
            [attr.aria-label]="ariaLabel()"
            (pointerdown)="down($event)" (pointercancel)="cancel()"
            (pointerleave)="leave($event)" (contextmenu)="$event.preventDefault()"
            (keydown.enter)="tap($event)" (keydown.space)="tap($event)" (click)="click($event)">
      @if (current(); as c) {
        <lf-reaction-icon [kind]="c" [size]="22" />
      } @else {
        <lf-icon name="thumbup" [size]="21" />
      }
      <!-- The word is the target, not a screen-reader extra: "Like" says what
           the control does before it is pressed. -->
      <span class="label">{{ label() }}</span>
    </button>
  `,
  styles: [`
    /* This button takes the slack in the action row; the short labels beside
       it take only what they need. */
    :host { position: relative; display: block; flex: 1 1 auto; min-width: 0; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .btn {
      width: 100%; height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      border: 0; border-radius: 4px; background: transparent; color: var(--lf-muted);
      font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
      min-width: 0; padding: 0 2px;
      -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: manipulation;
    }
    .btn:hover, .btn:active { background: var(--lf-hover); }
    .btn .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The icon keeps its size when the label steps down: a 10px word next to a
       shrunken glyph reads as a broken row. */
    .btn lf-icon, .btn lf-reaction-icon { flex: none; }
    /* On phones the label steps down so the words stay whole next to
       Comment / Repost / Send. */
    @media (max-width: 430px) { .btn { font-size: 13px; gap: 4px; } }
    @media (max-width: 360px) { .btn { font-size: 11.5px; gap: 3px; } }
    @media (max-width: 340px) {
      /* The very small phones: the label steps down rather than losing a word. */
      .btn { font-size: 10.5px; gap: 3px; padding: 0; }
    }
    .btn.on { color: var(--tone); }
    .scrim { position: fixed; inset: 0; z-index: 40; }
    .tray {
      position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 41;
      display: flex; align-items: flex-end; gap: 6px; padding: 8px 10px;
      border-radius: 32px; background: var(--lf-card); border: 1px solid var(--lf-line);
      box-shadow: var(--lf-shadow-lg); animation: pop .16s ease-out; transform-origin: bottom left;
    }
    @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.9); } to { opacity: 1; transform: none; } }
    .opt { position: relative; display: grid; place-items: end center; width: 44px; height: 44px; padding: 0; border: 0;
      background: transparent; cursor: pointer; touch-action: none; transition: transform .12s; }
    .opt.hot { transform: translateY(-6px); }
    .opt.mine lf-reaction-icon { filter: drop-shadow(0 0 0 transparent); outline: 2px solid var(--lf-primary); outline-offset: 2px; border-radius: 50%; }
    .tip { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); padding: 3px 8px; border-radius: 12px;
      background: #000c; color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .1s; }
    .opt.hot .tip { opacity: 1; }
    @media (prefers-reduced-motion: reduce) { .tray { animation: none; } .opt { transition: none; } }
  `]
})
export class ReactionButtonComponent {
  private host = inject(ElementRef<HTMLElement>);

  /** Your current reaction on the post, or null. */
  readonly value = input<VoteValue>(null);
  readonly react = output<ReactionKind>();

  protected readonly reactions = REACTIONS;
  readonly open = signal(false);
  readonly hot = signal<ReactionKind | null>(null);

  readonly current = computed<ReactionKind | null>(() => (isReaction(this.value()) ? (this.value() as ReactionKind) : null));
  readonly mine = this.current;
  /** Nothing chosen reads "Like" - the default reaction is the action's own name. */
  readonly label = computed(() => {
    const c = this.current();
    if (!c) return DEFAULT_REACTION_LABEL;
    return REACTIONS.find((r) => r.key === c)!.label;
  });
  readonly tone = computed(() => REACTIONS.find((r) => r.key === this.current())?.color ?? 'var(--lf-muted)');
  readonly ariaLabel = computed(() => this.current()
    ? `Your reaction: ${REACTIONS.find((r) => r.key === this.current())!.label}. Choose a reaction or select it again to remove.`
    : 'Choose a reaction: Like, Support, Sad or Have an idea.');

  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = false;
  private pointerId: number | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  down(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    this.held = false;
    this.pointerId = ev.pointerId;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.held = true;
      this.hot.set(null);
      this.open.set(true);
      try { navigator.vibrate?.(8); } catch { /* not supported */ }
    }, 380);
  }

  /**
   * The release is watched on the host, not on the button.
   *
   * Holding the button opens the tray, and choosing means sliding onto a
   * reaction and letting go - the finger (or the mouse, which has no implicit
   * capture) comes up over the *option*, not over the button. Listening on the
   * button missed that release entirely: nothing was chosen and the tray stayed
   * open with its scrim swallowing the next tap on the page.
   */
  @HostListener('pointerup', ['$event'])
  onUp(ev: PointerEvent): void {
    this.clearTimer();
    const key = this.optionAt(ev.clientX, ev.clientY);
    if (this.held) {
      this.held = false;
      this.pointerId = null;
      if (key) { this.choose(key); return; }
      // Releasing on the main action leaves the tray open for a second tap.
      // Releasing elsewhere dismisses it without stealing the next page tap.
      if (this.isButtonAt(ev.clientX, ev.clientY)) return;
      this.open.set(false);
      return;
    }
    // A quick lift that started and ended on the button is a plain tap.
    if (this.isButtonAt(ev.clientX, ev.clientY)) this.tap();
  }

  private isButtonAt(x: number, y: number): boolean {
    const button = this.host.nativeElement.querySelector('.btn');
    if (!button) return false;
    const r = button.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /** Which reaction, if any, sits under this point. */
  private optionAt(x: number, y: number): ReactionKind | undefined {
    // Not every webview has elementFromPoint, and a throw here used to abort the
    // release and leave the tray stuck open with its scrim over the page.
    if (typeof document.elementFromPoint !== 'function') return undefined;
    const el = document.elementFromPoint(x, y)?.closest?.('.opt') as HTMLElement | null;
    return el?.dataset['key'] as ReactionKind | undefined;
  }

  /** Kept for the keyboard path (Enter/Space on the button). */
  up(ev: PointerEvent): void {
    this.onUp(ev);
  }

  cancel(): void { this.clearTimer(); }

  /**
   * While the tray is open and a finger is down, highlight the reaction under
   * it. Watched on the host too, so sliding from the button onto an option
   * highlights it instead of going dark the moment the finger leaves the button.
   */
  @HostListener('pointermove', ['$event'])
  move(ev: PointerEvent): void {
    if (!this.held || !this.open()) return;
    this.hot.set(this.optionAt(ev.clientX, ev.clientY) ?? null);
  }

  /** A mouse hovering over the button opens the tray after a moment. */
  @HostListener('pointerenter', ['$event'])
  onEnter(ev: PointerEvent): void {
    if (ev.pointerType !== 'mouse') return;
    this.hoverTimer = setTimeout(() => { this.hot.set(null); this.open.set(true); }, 550);
  }

  @HostListener('pointerleave', ['$event'])
  onLeaveHost(ev: PointerEvent): void {
    if (ev.pointerType !== 'mouse') return;
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
    setTimeout(() => { if (!this.host.nativeElement.matches(':hover')) this.open.set(false); }, 250);
  }

  leave(ev: PointerEvent): void {
    // A finger sliding off the button after a long press keeps the press alive.
    if (!this.held) this.clearTimer();
    void ev;
  }

  /** Assistive technologies can activate a button with a click and no pointer events. */
  click(ev: MouseEvent): void {
    ev.preventDefault();
    if (ev.detail === 0) this.tap();
  }

  tap(ev?: Event): void {
    ev?.preventDefault();
    this.hot.set(null);
    this.open.set(!this.open());
  }

  choose(key: ReactionKind, ev?: Event): void {
    ev?.stopPropagation();
    this.open.set(false);
    this.react.emit(key);
  }

  close(ev: Event): void {
    ev.stopPropagation();
    this.open.set(false);
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
