import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';
import { BadgeSpec, ImpactLevel } from '../models/impact';

/**
 * The one moment after a good deed where the app says something back.
 *
 * This exists because points on a screen no one opens are not feedback. When a
 * search area is finished, a poster goes up or a lead is left, the person is
 * usually mid-task and *not* on the progress screen - so the thanks arrives
 * where they are, once, and leaves on its own.
 *
 * Rules the app keeps:
 * - One moment at a time. A level-up and two badges do not stack into a wall.
 * - It never blocks. It cannot be dismissed only by finding a close button, and
 *   it never covers the thing the person was about to tap.
 * - Nothing about a missing person is in it. The copy is about the giver.
 * - Reduced motion honours the OS setting.
 */
export interface RewardMoment {
  id: number;
  /** "+5 points" */
  points: number;
  /** what the points were for, in the app's own words */
  reason: string;
  /** the tally this moment moved: used for the small caption */
  totalBefore: number;
  totalAfter: number;
  levelUp?: ImpactLevel;
  badge?: BadgeSpec;
}

@Injectable({ providedIn: 'root' })
export class RewardService {
  private auth = inject(AuthService);
  private settings = inject(SettingsService);

  private seq = 0;
  private queue: RewardMoment[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly current = signal<RewardMoment | null>(null);
  readonly moment = computed(() => this.current());

  /** True while something is on screen, so a page can hide a duplicate line. */
  readonly showing = computed(() => this.current() !== null);

  /**
   * Show a moment, or queue it behind the one on screen.
   *
   * Two things shorten the queue rather than add to it: a moment that only
   * repeats points (a second search area) is merged into the visible one, and
   * nothing is queued at all while the person has turned motion down - in that
   * case the notification bell is the record instead.
   */
  show(input: Omit<RewardMoment, 'id'>): void {
    const moment: RewardMoment = { ...input, id: ++this.seq };
    if (this.current()) {
      const visible = this.current()!;
      if (!moment.levelUp && !moment.badge && !visible.levelUp && !visible.badge) {
        // Same kind of thanks: add to the one on screen instead of interrupting.
        this.current.set({
          ...visible,
          points: visible.points + moment.points,
          totalAfter: moment.totalAfter,
          reason: moment.reason
        });
        this.schedule(1400);
        return;
      }
      this.queue.push(moment);
      return;
    }
    this.current.set(moment);
    this.schedule(moment.levelUp || moment.badge ? 4200 : 3000);
  }

  dismiss(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.current.set(null);
    const next = this.queue.shift();
    if (next) {
      this.current.set(next);
      this.schedule(next.levelUp || next.badge ? 4200 : 3000);
    }
  }

  /** Copy for the points line: "+10 points · Every wall it reaches is one more pair of eyes." */
  caption(m: RewardMoment): string {
    return m.reason;
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), ms);
  }

  /** Whether the OS asks for less movement. Used for the entrance animation. */
  get calm(): boolean {
    try {
      if (this.settings.settings().reduceMotion) return true;
      return typeof window !== 'undefined'
        && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /** Only ever describe impact to the person it belongs to. */
  get mine(): boolean {
    return !!this.auth.user();
  }
}
