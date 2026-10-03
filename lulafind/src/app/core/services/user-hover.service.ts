import { Injectable, signal } from '@angular/core';

/**
 * One profile hovercard for the whole app, the way LinkedIn does it.
 *
 * Every name in a card, a comment thread or a chat header could own its own
 * popover, and that is what makes such a thing ugly: a feed of twenty posts
 * means twenty cards in the DOM, twenty focus traps, and a popover clipped by
 * whatever `overflow: hidden` the nearest frame happens to have. So the names
 * only *ask* for the card, and the shell renders the one card - positioned from
 * the rectangle the trigger reported, flipped up when there is no room below.
 *
 * It shows on pointer hover and on keyboard focus, never on tap: on a phone a tap
 * on a name means "open this profile", which is what the link already does.
 */
@Injectable({ providedIn: 'root' })
export class UserHoverService {
  /** The profile being previewed. */
  readonly userId = signal<string | null>(null);
  /** Where to put the card: the trigger's box, in viewport coordinates. */
  readonly box = signal<{ top: number; left: number; width: number; bottom: number } | null>(null);

  private leaveTimer?: ReturnType<typeof setTimeout>;

  show(userId: string, el: HTMLElement): void {
    clearTimeout(this.leaveTimer);
    const r = el.getBoundingClientRect();
    this.box.set({ top: r.top, left: r.left, width: r.width, bottom: r.bottom });
    this.userId.set(userId);
  }

  /**
   * The gap that lets a pointer travel from a name into the card without the card
   * vanishing half-way. Entering the card calls `show()` again and cancels it.
   */
  hideSoon(): void {
    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => {
      this.userId.set(null);
      this.box.set(null);
    }, 180);
  }

  close(): void {
    clearTimeout(this.leaveTimer);
    this.userId.set(null);
    this.box.set(null);
  }
}
