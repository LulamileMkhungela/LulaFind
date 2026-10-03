import { Component, computed, inject, signal } from '@angular/core';
import { Router } from "@angular/router";
import { IonContent } from '@ionic/angular/ion-content';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { SettingsService } from '../../core/services/settings.service';
import { Notification } from '../../core/models/types';
import { distanceKm, timeAgo } from '../../core/utils/format';

type NotifFilter = 'all' | 'unread' | 'mentions' | 'posts';

/**
 * Everything about a case, in the app's own words: a comment, a reaction, a
 * repost, a share, an outcome, a moderation decision. A follow or a chat reply is
 * not this, which is why the filter needs its own list.
 */
const POST_KINDS = new Set<Notification['kind']>([
  'vote', 'comment', 'repost', 'share', 'outcome', 'claim', 'missing', 'danger', 'lookout',
  'story_reply', 'escalation', 'moderation', 'spotlight'
]);

@Component({
  selector: 'lf-notifications',
  standalone: true,
  imports: [IonContent, TopNavComponent, IconComponent, EmptyComponent],
  template: `
    <lf-top-nav title="Notifications" backTo="/home" />

    <ion-content class="lf-page lf-plain">
      <!-- The title lives in the top bar; repeating it here printed "Notifications" twice. -->
      <div class="page-title" [hidden]="!unreadCount()">
        @if (unreadCount()) {
          <button class="lf-btn lf-btn--sm" type="button" (click)="readAll()">
            <lf-icon name="check" [size]="16" [weight]="2.4" /> Mark all as read
          </button>
        }
      </div>

      <!-- LinkedIn puts the filter above the list, with the counts in it, so "3
           you have not seen" is the first thing you can act on. -->
      <div class="filters" role="group" aria-label="Which notifications to show">
        @for (g of groups; track g.key) {
          <button type="button" class="chip" [class.on]="filter() === g.key" (click)="filter.set(g.key)"
                  [attr.aria-pressed]="filter() === g.key">
            {{ g.label }}@if (countOf(g.key); as n) { <span class="n">{{ n }}</span> }
          </button>
        }
      </div>

      @if (!shown().length) {
        <lf-empty icon="bell" title="{{ emptyTitle() }}" [message]="emptyMessage()" />
      }
      @if (shown().length) {
      <div class="list">
        @for (n of shown(); track n.id; let i = $index) {
          @if (dayFor(i); as day) { <div class="day"><span>{{ day }}</span></div> }
          <button class="row" [class.unread]="!n.read" (click)="go(n)">
            <span class="ic" [attr.data-kind]="n.kind"><lf-icon [name]="iconFor(n.kind)" [size]="24" /></span>
            <div class="lf-grow">
              <strong>{{ n.title }}</strong>
              <p>{{ n.body }}</p>
              <span class="lf-tiny lf-muted">{{ timeAgo(n.at) }}@if (away(n); as km) { · {{ km }} }</span>
            </div>
            @if (!n.read) { <span class="dot"></span> }
          </button>
        }
      </div>
      }
    </ion-content>
  `,
  styles: [`
    /* Facebook notifications: full-width rows, unread rows tinted blue. */
    .list { display: flex; flex-direction: column; background: var(--lf-card); padding: 4px 0 26px; }
    @media (min-width: 768px) { .list { max-width: var(--lf-maxw); margin: 0 auto; } }
    .row { display: flex; gap: 12px; align-items: center; padding: 10px 16px; border: 0;
      background: transparent; color: inherit; text-align: left; cursor: pointer; font-family: inherit; }
    .row:hover, .row:active { filter: brightness(.97); }
    .row.unread { background: var(--lf-primary-soft); }
    .row strong { font-size: 15px; font-weight: 600; }
    .row p { margin: 2px 0; font-size: 15px; color: var(--ion-text-color); line-height: 1.3; }
    .row .lf-tiny { font-size: 13px; }
    .row.unread .lf-tiny { color: var(--lf-primary-soft-text); font-weight: 600; }
    .ic { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: var(--lf-primary-fill); color: #fff; flex-shrink: 0; }
    .ic[data-kind="danger"], .ic[data-kind="missing"] { background: var(--lf-signal); }
    .ic[data-kind="escalation"], .ic[data-kind="vote"] { background: var(--lf-ubuntu); }
    .ic[data-kind="outcome"], .ic[data-kind="claim"] { background: var(--lf-marigold); }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--lf-primary); flex-shrink: 0; }
    .filters { display: flex; gap: 8px; overflow-x: auto; padding: 4px 16px 10px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 7px 14px; border-radius: 999px;
      border: 1px solid var(--lf-line); background: var(--lf-card); color: var(--lf-muted); font: inherit; font-size: 13.5px;
      font-weight: 600; cursor: pointer; }
    .chip.on { background: var(--lf-primary-soft); border-color: var(--lf-primary); color: var(--lf-primary-soft-text); }
    .chip .n { font-size: 12px; padding: 0 5px; border-radius: 999px; background: var(--lf-hover); }
    .chip.on .n { background: var(--lf-card); }
    /* A day line, not a card: the rows under it belong together. */
    .day { display: flex; align-items: center; gap: 10px; margin: 12px 16px 2px; color: var(--lf-muted);
      font-size: 12px; font-weight: 600; }
    .day::after { content: ''; height: 1px; flex: 1; background: var(--lf-line-soft); }
    .ic[data-kind="mention"] { background: var(--lf-link); }
  `]
})
export class NotificationsComponent {
  protected data = inject(DataService);
  private router = inject(Router);
  private settings = inject(SettingsService);

  protected readonly timeAgo = timeAgo;
  readonly items = computed(() => this.data.notifications());

  /**
   * LinkedIn's two filters, plus the two that matter on a missing-person app: the
   * times someone named you, and everything about the cases you are watching.
   */
  readonly filter = signal<NotifFilter>('all');
  readonly groups: { key: NotifFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'mentions', label: 'Mentions' },
    { key: 'posts', label: 'Posts' }
  ];

  /** The badge the bell already carries, asked again here so the filter can count. */
  readonly unreadCount = computed(() => this.data.unreadNotifications());
  readonly mentionCount = computed(() => this.items().filter((n) => n.kind === 'mention').length);

  readonly shown = computed(() => {
    const list = this.items();
    switch (this.filter()) {
      case 'unread': return list.filter((n) => !n.read);
      case 'mentions': return list.filter((n) => n.kind === 'mention');
      case 'posts': return list.filter((n) => POST_KINDS.has(n.kind));
      default: return list;
    }
  });

  /**
   * How far a case alert is from where this phone last was, when both points are
   * known - so the alert radius in Settings is something the member can see.
   * Returns '' when there is nothing honest to show.
   */
  away(n: Notification): string {
    if (n.kind !== 'missing' || !n.postId) return '';
    const post = this.data.post(n.postId);
    const here = this.data.devicePoint();
    const there = post?.geo ?? null;
    if (!here || !there) return '';
    const km = distanceKm(here, there);
    const within = km <= this.settings.settings().pushRadiusKm;
    return within ? `${km} km from you` : `${km} km away, outside your alert radius`;
  }

  iconFor(kind: Notification['kind']): string {
    return ({
      vote: 'thumbup', comment: 'comment', follow: 'users', chat: 'chat', system: 'info', mention: 'comment',
      escalation: 'megaphone', location_consent: 'target', claim: 'user', outcome: 'award', spotlight: 'users', danger: 'alert',
      repost: 'refresh', missing: 'search', share: 'send', lookout: 'eye', checkin: 'clock', moderation: 'shield',
      story_reply: 'chat'
    } as Record<string, string>)[kind] ?? 'bell';
  }

  /** What the row's own group is, for the day line above it. */
  /** Public because the grouping is the rule, and the test has to check it. */
  dayLabel(at: number): string {
    const day = new Date(at);
    const today = new Date();
    const same = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(day, today)) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (same(day, yesterday)) return 'Yesterday';
    return today.getTime() - day.getTime() < 6 * 86_400_000 ? 'This week' : 'Earlier';
  }

  dayFor(index: number): string | null {
    const list = this.shown();
    const current = list[index];
    if (!current) return null;
    const previous = list[index - 1];
    if (previous && this.dayLabel(previous.at) === this.dayLabel(current.at)) return null;
    return this.dayLabel(current.at);
  }

  countOf(key: NotifFilter): number {
    if (key === 'unread') return this.unreadCount();
    if (key === 'mentions') return this.mentionCount();
    return 0;
  }

  emptyTitle(): string {
    return ({ unread: 'Nothing waiting', mentions: 'No mentions', posts: 'Nothing on your posts yet' } as Record<string, string>)[this.filter()]
      ?? 'No alerts yet';
  }

  emptyMessage(): string {
    switch (this.filter()) {
      case 'unread': return 'You have read everything here. New alerts will show up on this screen as they arrive.';
      case 'mentions': return 'Someone names you with @ in a comment and it lands here, with a link to the thread.';
      case 'posts': return 'Comments, ideas and reposts on the cases you posted or are following appear here.';
      default: return 'Case alerts for your area land here, along with comments, follows and chat replies.';
    }
  }

  /**
   * Opening one alert marks the whole list read, not just that row. Deliberate:
   * `markNotificationsRead` is the one write that has a policy on it, and a per-row
   * version would need a new RPC to be honest about it - so the badge goes empty on
   * the way in, and nothing is left half-read behind you.
   */
  async go(n: Notification): Promise<void> {
    await this.data.markNotificationsRead();
    if (n.route) await this.router.navigateByUrl(n.route);
  }

  async readAll(): Promise<void> {
    await this.data.markNotificationsRead();
  }
}
