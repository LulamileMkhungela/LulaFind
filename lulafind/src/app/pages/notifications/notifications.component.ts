import { Component, computed, inject } from '@angular/core';
import { Router } from "@angular/router";
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IconComponent } from '../../shared/components/icon.component';
import { EmptyComponent } from '../../shared/components/empty.component';
import { DataService } from '../../core/services/data.service';
import { Notification } from '../../core/models/types';
import { timeAgo } from '../../core/utils/format';

@Component({
  selector: 'lf-notifications',
  standalone: true,
  imports: [IonContent, IonHeader, IconComponent, EmptyComponent],
  template: `
    <ion-header class="fb-head">
      <div class="fb-head__bar">
        <h1 class="fb-head__title">Notifications</h1>
        <div class="fb-head__tools">
          <button class="lf-round-btn" (click)="readAll()" aria-label="Mark all as read"><lf-icon name="check" [size]="20" [weight]="2.4" /></button>
        </div>
      </div>
    </ion-header>

    <ion-content class="lf-page lf-plain">
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
              <span class="lf-tiny lf-muted">{{ timeAgo(n.at) }}</span>
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
    .ic[data-kind="danger"] { background: var(--lf-signal); }
    .ic[data-kind="escalation"], .ic[data-kind="vote"] { background: var(--lf-ubuntu); }
    .ic[data-kind="outcome"], .ic[data-kind="claim"] { background: var(--lf-marigold); }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--lf-primary); flex-shrink: 0; }
  `]
})
export class NotificationsComponent {
  protected data = inject(DataService);
  private router = inject(Router);

  protected readonly timeAgo = timeAgo;
  readonly items = computed(() => this.data.notifications());

  iconFor(kind: Notification['kind']): string {
    return ({
      vote: 'thumbup', comment: 'comment', follow: 'users', chat: 'chat', system: 'info',
      escalation: 'megaphone', location_consent: 'target', claim: 'user', outcome: 'award', spotlight: 'users', danger: 'alert'
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
