import { Component, computed, inject } from '@angular/core';
import { Router } from "@angular/router";
import { IonContent } from '@ionic/angular/ion-content';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { SettingsService } from '../../core/services/settings.service';
import { Notification } from '../../core/models/types';
import { distanceKm, timeAgo } from '../../core/utils/format';

@Component({
  selector: 'lf-notifications',
  standalone: true,
  imports: [IonContent, TopNavComponent, IconComponent, EmptyComponent],
  template: `
    <lf-top-nav title="Notifications" backTo="/home" />

    <ion-content class="lf-page lf-plain">
      <div class="page-title">
        <h1>Notifications</h1>
        <button class="lf-round-btn" (click)="readAll()" aria-label="Mark all as read"><lf-icon name="check" [size]="20" [weight]="2.4" /></button>
      </div>
      @if (!items().length) {
        <lf-empty icon="bell" title="No alerts yet"
                  message="You will get pinged when someone votes, comments, follows, or when a case you posted is escalated." />
      }
      @if (items().length) {
      <div class="list">
        @for (n of items(); track n.id) {
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
      background: var(--lf-primary); color: #fff; flex-shrink: 0; }
    .ic[data-kind="danger"], .ic[data-kind="missing"] { background: var(--lf-signal); }
    .ic[data-kind="escalation"], .ic[data-kind="vote"] { background: var(--lf-ubuntu); }
    .ic[data-kind="outcome"], .ic[data-kind="claim"] { background: var(--lf-marigold); }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--lf-primary); flex-shrink: 0; }
  `]
})
export class NotificationsComponent {
  protected data = inject(DataService);
  private router = inject(Router);
  private settings = inject(SettingsService);

  protected readonly timeAgo = timeAgo;
  readonly items = computed(() => this.data.notifications());

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
      vote: 'thumbup', comment: 'comment', follow: 'users', chat: 'chat', system: 'info',
      escalation: 'megaphone', location_consent: 'target', claim: 'user', outcome: 'award', spotlight: 'users', danger: 'alert',
      repost: 'refresh', missing: 'search'
    } as Record<string, string>)[kind] ?? 'bell';
  }

  async go(n: Notification): Promise<void> {
    await this.data.markNotificationsRead();
    if (n.route) await this.router.navigateByUrl(n.route);
  }

  async readAll(): Promise<void> {
    await this.data.markNotificationsRead();
  }
}
