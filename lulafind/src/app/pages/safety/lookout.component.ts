import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { LookoutService } from '../../core/services/lookout.service';
import { Lookout, LOOKOUT_HOURS, UserProfile, provinceName } from '../../core/models/types';
import { lastSeenOf, waitingOn } from '../../core/utils/lookout';
import { fullDate, timeAgo } from '../../core/utils/format';

/**
 * The safety check page.
 *
 * One lookout, one question: is this person okay? The answer buttons only
 * appear for the followers who were asked. Everyone else sees the same page
 * without the buttons - and if the person themselves opens it, "I'm here" is
 * the only button, because saying so ends it and deletes whatever the app
 * published about them.
 */
@Component({
  selector: 'lf-lookout',
  standalone: true,
  imports: [IonContent, RouterLink, IconComponent, TopNavComponent, AvatarComponent],
  template: `
    <lf-top-nav title="Safety check" backTo="/home" />

    <ion-content class="lf-page">
      @if (!lookout()) {
        <div class="lf-card pad">
          <strong>This lookout is closed</strong>
          <p class="lf-small lf-muted">Nothing to answer here any more.</p>
        </div>
      } @else {
        <!-- who, and what they said -->
        <section class="who" [class.bad]="lookout()!.status === 'escalated'">
          <lf-avatar [src]="owner()?.avatarUrl || ''" [name]="name()" [size]="56" />
          <div class="lf-grow">
            <strong class="h">{{ name() }}</strong>
            <span class="lf-small lf-muted">Be on the lookout: {{ lookout()!.area }}</span>
          </div>
          <span class="state" [class]="lookout()!.status">{{ stateLabel() }}</span>
        </section>

        @if (lookout()!.note) {
          <p class="quote">"{{ lookout()!.note }}"</p>
        }

        <!-- what happens next, or what has happened -->
        <section class="card">
          <div class="row">
            <lf-icon name="clock" [size]="18" />
            <div class="lf-grow">
              <strong>{{ windowLabel() }}</strong>
              <span class="lf-small lf-muted">Started {{ timeAgo(lookout()!.startedAt) }} by {{ name() }}.</span>
            </div>
          </div>

          @if (lookout()!.status === 'checking') {
            <div class="row">
              <lf-icon name="users" [size]="18" />
              <div class="lf-grow">
                <strong>{{ answeredCount() }} of {{ lookout()!.askedIds.length }} followers answered</strong>
                <span class="lf-small lf-muted">Everyone who was asked must confirm they are okay.</span>
              </div>
            </div>
          }

          @if (lookout()!.status === 'escalated') {
            <div class="row warn">
              <lf-icon name="alert" [size]="18" />
              <div class="lf-grow">
                <strong>A follower said something is wrong</strong>
                @if (lookout()!.escalatedPostId) {
                  <span class="lf-small">LulaFind flagged {{ name() }} as a possible missing person.</span>
                } @else {
                  <span class="lf-small">{{ noCaseReason() }}</span>
                }
              </div>
            </div>
          }

          @if (lookout()!.status === 'cleared') {
            <div class="row ok">
              <lf-icon name="check" [size]="18" />
              <div class="lf-grow">
                <strong>{{ clearedLabel() }}</strong>
                <span class="lf-small">{{ timeAgo(lookout()!.closedAt ?? Date.now()) }}</span>
              </div>
            </div>
          }
        </section>

        <!-- last seen, for everyone -->
        @if (lastSeen()) {
          <section class="card">
            <div class="row">
              <lf-icon name="target" [size]="18" />
              <div class="lf-grow">
                <strong>Last seen {{ timeAgo(lastSeen()!.at) }}</strong>
                <span class="lf-small lf-muted">
                  {{ lastSeen()!.place || 'Place not shared' }} · last check-in said "{{ statusWord(lastSeen()!.status) }}"
                </span>
              </div>
            </div>
            @if (lookout()!.location) {
              <p class="lf-small lf-muted">
                Location on the lookout: {{ lookout()!.location!.lat.toFixed(3) }}, {{ lookout()!.location!.lng.toFixed(3) }}
                @if (lookout()!.shareLocation) { · shared with their followers }
              </p>
            }
          </section>
        }

        <!-- answering: only the followers who were asked -->
        @if (iWasAsked() && !iAnswered() && lookout()!.userId !== me()?.id) {
          <section class="card ask">
            <strong>Are they okay?</strong>
            <p class="lf-small lf-muted">
              If you have seen or heard from {{ name() }} in the last {{ hours }} hours, say yes.
              If not, say no and we will flag them.
            </p>
            <div class="btns">
              <button class="lf-btn lf-btn--primary lf-btn--block" [disabled]="saving()" (click)="answer(true)">
                <lf-icon name="check" [size]="16" /> Yes, they are okay
              </button>
              <button class="lf-btn lf-btn--block danger" [disabled]="saving()" (click)="answer(false)">
                <lf-icon name="alert" [size]="16" /> No, something is wrong
              </button>
            </div>
          </section>
        }

        @if (lookout()!.userId === me()?.id) {
          <section class="card">
            <strong>This is about you</strong>
            <p class="lf-small lf-muted">
              Say you are here and the lookout closes - anything LulaFind posted about you is deleted.
            </p>
            <button class="lf-btn lf-btn--primary lf-btn--block" [disabled]="saving()" (click)="imHere()">
              <lf-icon name="hand" [size]="16" /> I'm here
            </button>
          </section>
        }

        @if (lookout()!.escalatedPostId) {
          <div class="lf-pad">
            <a class="lf-btn lf-btn--ghost lf-btn--block" [routerLink]="'/post/' + lookout()!.escalatedPostId">
              <lf-icon name="flag" [size]="16" /> Open the case
            </a>
          </div>
        }
      }
    </ion-content>
  `,
  styles: [`
    .lf-page { padding-bottom: 24px; }
    .pad { margin: 12px var(--lf-gap); padding: 16px; }
    .who { display: flex; align-items: center; gap: 12px; margin: 12px var(--lf-gap); padding: 14px;
      border-radius: var(--lf-radius); background: var(--lf-card); box-shadow: var(--lf-shadow); }
    .who.bad { box-shadow: 0 0 0 2px var(--lf-signal) inset; }
    .who .h { display: block; font-size: 16px; }
    .state { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; padding: 4px 8px; border-radius: 999px;
      background: var(--lf-card-2); color: var(--lf-muted); }
    .state.checking { color: var(--lf-warn, #b26a00); }
    .state.escalated { background: var(--lf-signal); color: #fff; }
    .state.cleared { color: var(--lf-ubuntu); }
    .quote { margin: 0 var(--lf-gap) 4px; font-size: 14px; font-style: italic; color: var(--lf-muted); }
    .card { margin: 12px var(--lf-gap); padding: 14px; border-radius: var(--lf-radius); background: var(--lf-card);
      box-shadow: var(--lf-shadow); display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; gap: 10px; align-items: flex-start; }
    .row .lf-grow { display: flex; flex-direction: column; gap: 2px; }
    .row.warn { color: var(--lf-signal); }
    .row.ok { color: var(--lf-ubuntu); }
    .btns { display: flex; flex-direction: column; gap: 8px; }
    .danger { background: var(--lf-signal); color: #fff; }
  `]
})
export class LookoutComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastController);
  private auth = inject(AuthService);
  private data = inject(DataService);
  protected lookouts = inject(LookoutService);

  protected readonly hours = LOOKOUT_HOURS;
  protected readonly timeAgo = timeAgo;
  protected readonly fullDate = fullDate;
  protected readonly Date = Date;

  readonly saving = signal(false);
  readonly id = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly lookout = computed<Lookout | null>(() => this.data.lookouts().find((l) => l.id === this.id()) ?? null);
  readonly me = computed<UserProfile | null>(() => this.auth.user());
  readonly owner = computed<UserProfile | null>(() => {
    const l = this.lookout();
    return l ? this.data.authorOf(l.userId) ?? null : null;
  });
  readonly name = computed(() => this.owner()?.displayName ?? 'This member');

  readonly iWasAsked = computed(() => {
    const me = this.me();
    const l = this.lookout();
    return !!me && !!l && l.askedIds.includes(me.id);
  });

  readonly iAnswered = computed(() => {
    const me = this.me();
    const l = this.lookout();
    return !!me && !!l && l.answers.some((a) => a.byUserId === me.id);
  });

  readonly answeredCount = computed(() => this.lookout()?.answers.length ?? 0);

  readonly lastSeen = computed(() => {
    const owner = this.owner();
    const l = this.lookout();
    if (!owner) return null;
    return lastSeenOf(owner, l, { canSeePlace: owner.privacy?.showLastSeen !== false });
  });

  readonly stateLabel = computed(() => {
    switch (this.lookout()?.status) {
      case 'active': return 'watching';
      case 'checking': return 'checking';
      case 'escalated': return 'flagged';
      case 'cleared': return 'closed';
      default: return '';
    }
  });

  readonly windowLabel = computed(() => {
    const l = this.lookout();
    if (!l) return '';
    if (l.status === 'active') {
      const mins = Math.max(0, Math.round((l.checkAt - Date.now()) / 60000));
      const h = Math.floor(mins / 60);
      return `Followers are asked in ${h > 0 ? `${h} h ` : ''}${mins % 60} min`;
    }
    if (l.status === 'checking') return 'The 24 hours are up - followers are being asked now';
    if (l.status === 'escalated') return 'Flagged as a possible missing person';
    return 'Closed';
  });

  readonly clearedLabel = computed(() => {
    switch (this.lookout()?.closedReason) {
      case 'im_here': return `${this.name()} said "I'm here"`;
      case 'all_ok': return 'Every follower confirmed they are okay';
      case 'owner_cancelled': return `${this.name()} ended the lookout`;
      default: return 'Closed';
    }
  });

  /**
   * Why there is no case. This is the user's own choice, said out loud on the
   * page where the failure happened - never a silent escalation, and never a
   * case published without permission.
   */
  readonly noCaseReason = computed(() => {
    const owner = this.owner();
    if (!owner) return 'No case was published.';
    if (owner.privacy?.allowSafetyAlertPosts !== true) {
      return `${this.name()} has not allowed LulaFind to publish a case about them, so no case was posted.`;
    }
    return 'The case could not be published. Try again.';
  });

  /** Everyone who was asked and has not answered. */
  readonly waiting = computed(() => (this.lookout() ? waitingOn(this.lookout()!) : []));

  protected statusWord(status: string): string {
    return status === 'need_help' ? 'I need help' : status === 'unfamiliar' ? 'unfamiliar place' : 'safe';
  }

  protected placeOf(u: UserProfile | null): string {
    if (!u?.town) return 'place not shared';
    return `${u.town}, ${provinceName(u.province ?? undefined)}`;
  }

  async answer(ok: boolean): Promise<void> {
    const l = this.lookout();
    if (!l) return;
    this.saving.set(true);
    try {
      await this.lookouts.answer(l.id, ok);
      await this.say(ok ? 'Thank you. Your answer is recorded.' : 'Thank you. LulaFind has been told.');
      const after = this.lookout();
      /* When a case was published, open it - that is the next thing to do. */
      if (!ok && after?.escalatedPostId) await this.router.navigate(['/post', after.escalatedPostId]);
    } catch (e) {
      await this.say(e instanceof Error ? e.message : 'Could not send your answer');
    } finally {
      this.saving.set(false);
    }
  }

  async imHere(): Promise<void> {
    const l = this.lookout();
    if (!l) return;
    this.saving.set(true);
    try {
      const before = !!l.escalatedPostId;
      await this.lookouts.imHere(l.id);
      await this.say(before ? 'You are marked safe. The post about you was deleted.' : 'You are marked safe. The lookout is closed.');
      await this.router.navigate(['/me']);
    } catch (e) {
      await this.say(e instanceof Error ? e.message : 'Could not close the lookout');
    } finally {
      this.saving.set(false);
    }
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 3000, position: 'bottom' });
    await t.present();
  }
}
