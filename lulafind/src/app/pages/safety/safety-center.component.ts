import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';





import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonToggle } from '@ionic/angular/ion-toggle';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { LocationService } from '../../core/services/location.service';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { LookoutService } from '../../core/services/lookout.service';
import { Audience, PrivacyPrefs, provinceName, defaultPrivacy } from '../../core/models/types';
import { fullDate, timeAgo } from '../../core/utils/format';

@Component({
  selector: 'lf-safety-center',
  standalone: true,
  imports: [IonContent, IonItem, IonLabel, IonToggle, RouterLink, IconComponent, TopNavComponent],
  template: `
    <lf-top-nav title="Safety & consent centre" backTo="/me" />

    <ion-content class="lf-page">
      <div class="lf-banner">
        <lf-icon name="shield" [size]="20" />
        <div>
          LulaFind never reads anyone's location without that person's own consent, and never sends a case
          to the police or an NGO. <a routerLink="/help">Get help</a> has the real numbers.
        </div>
      </div>

      <!-- my location -->
      <section class="card">
        <div class="lf-row" style="gap:8px">
          <lf-icon name="target" [size]="20" />
          <h2 class="lf-h2" style="margin:0">My location</h2>
        </div>
        <p class="lf-small lf-muted">Permission: <strong>{{ location.permission() }}</strong>
          @if (location.current()) { · last read {{ fullDate(location.current()!.at) }} }</p>

        <div class="stat">
          @if (location.current()) {
            <div><span>Latitude</span><strong>{{ location.current()!.lat.toFixed(5) }}</strong></div>
            <div><span>Longitude</span><strong>{{ location.current()!.lng.toFixed(5) }}</strong></div>
            <div><span>Province</span><strong>{{ provinceName(location.province()) }}</strong></div>
            <div><span>Town</span><strong>{{ location.town() || 'unknown' }}</strong></div>
          } @else {
            <p class="lf-small lf-muted">No location has been read yet.</p>
          }
        </div>

        <div class="btns">
          <button class="lf-btn lf-btn--ghost lf-btn--sm" (click)="refresh()">
            <lf-icon name="refresh" [size]="15" /> Read my location
          </button>
          <button class="lf-btn lf-btn--ghost lf-btn--sm" (click)="revoke()">
            <lf-icon name="trash" [size]="15" /> Forget my location
          </button>
        </div>
      </section>

      <!-- beacon -->
      <section class="card">
        <div class="lf-row" style="gap:8px">
          <lf-icon name="heart" [size]="20" />
          <h2 class="lf-h2" style="margin:0">Safety beacon</h2>
        </div>
        <p class="lf-small lf-muted">Send "I am safe" check-ins with your location to people you choose. Off by default.</p>
        <ion-item>
          <ion-label><strong>Beacon enabled</strong><br />
            @if (location.lastBeacon()) {
              <span class="lf-muted lf-small">Last check-in {{ fullDate(location.lastBeacon()!.at) }}</span>
            }
          </ion-label>
          <ion-toggle [checked]="location.beaconEnabled()" (ionChange)="toggleBeacon($any($event.detail).checked)"></ion-toggle>
        </ion-item>
        <button class="lf-btn lf-btn--primary lf-btn--block" (click)="checkIn()" [disabled]="!auth.signedIn()">
          <lf-icon name="send" [size]="16" /> Send an "I am safe" check-in now
        </button>
      </section>

      <!-- be on the lookout -->
      <section class="card">
        <div class="lf-row" style="gap:8px">
          <lf-icon name="shield" [size]="20" />
          <h2 class="lf-h2" style="margin:0">Be on the lookout</h2>
        </div>

        @if (mine()) {
          <div class="mine" [class.bad]="mine()!.status === 'escalated'">
            <strong>{{ mineHeadline() }}</strong>
            <span class="lf-small lf-muted">{{ mineSub() }}</span>
          </div>
          @if (mine()!.escalatedPostId) {
            <a class="lf-btn lf-btn--ghost lf-btn--block" [routerLink]="'/post/' + mine()!.escalatedPostId">
              <lf-icon name="flag" [size]="16" /> Open the case about me
            </a>
          }
          <button class="lf-btn lf-btn--primary lf-btn--block" [disabled]="lookouts.busy()" (click)="imHere()">
            <lf-icon name="hand" [size]="16" /> I'm here - close it
          </button>
          <button class="lf-btn lf-btn--ghost lf-btn--block" [disabled]="lookouts.busy()" (click)="cancelLookout()">
            Cancel the lookout without checking out
          </button>
        } @else {
          <p class="lf-small lf-muted">
            Tell your followers you may not feel safe where you are going. They see the area, and 24 hours
            later we ask them to check on you.
          </p>
          <label class="field">
            <span>Where are you going, or which area worries you?</span>
            <input class="inp" [value]="area()" (input)="area.set($any($event.target).value)"
                   placeholder="e.g. walking to the Polokwane taxi rank" />
          </label>
          <label class="field">
            <span>Anything your followers should know? (optional)</span>
            <input class="inp" [value]="note()" (input)="note.set($any($event.target).value)"
                   placeholder="e.g. I finish at 19:00" />
          </label>
          <label class="row-check">
            <input type="checkbox" [checked]="shareLocation()" (change)="shareLocation.set($any($event.target).checked)" />
            <span>Attach where I am now, so my followers see it</span>
          </label>
          <button class="lf-btn lf-btn--primary lf-btn--block" [disabled]="lookouts.busy() || !area().trim()" (click)="start()">
            <lf-icon name="shield" [size]="16" /> {{ lookouts.busy() ? 'Starting…' : 'Start the lookout' }}
          </button>
          @if (lookouts.error()) { <p class="err">{{ lookouts.error() }}</p> }
        }
      </section>

      <!-- publishing a case about me -->
      <section class="card">
        <div class="lf-row" style="gap:8px">
          <lf-icon name="flag" [size]="20" />
          <h2 class="lf-h2" style="margin:0">If I go missing</h2>
        </div>
        <p class="lf-small lf-muted">
          A lookout only becomes a case if a follower says something is wrong. This decides whether LulaFind may
          post that case, and who sees it.
        </p>
        <ion-item>
          <ion-label><strong>Let LulaFind post a case about me</strong><br />
            <span class="lf-small lf-muted">Off by default. Without it, a "no" answer never becomes a post.</span>
          </ion-label>
          <ion-toggle [checked]="allowAlerts()" (ionChange)="setAllowAlerts($any($event.detail).checked)"></ion-toggle>
        </ion-item>

        @if (allowAlerts()) {
          <label class="field">
            <span>Who may see that post</span>
            <select class="inp" [value]="audience()" (change)="setAudience($any($event.target).value)">
              <option value="public">Everyone on LulaFind</option>
              <option value="followers">Only my followers</option>
              <option value="surname">Only my spotlight community</option>
            </select>
          </label>
          @if (audience() === 'surname') {
            <label class="field">
              <span>Which spotlight</span>
              <select class="inp" [value]="spotlightId()" (change)="setSpotlight($any($event.target).value)">
                <option value="">Choose a spotlight</option>
                @for (s of mySpotlights(); track s.id) {
                  <option [value]="s.id">{{ s.surname }}</option>
                }
              </select>
            </label>
          }
        }
      </section>

      <!-- findability -->
      <section class="card">
        <div class="lf-row" style="gap:8px">
          <lf-icon name="eye" [size]="20" />
          <h2 class="lf-h2" style="margin:0">Being found</h2>
        </div>
        <p class="lf-small lf-muted">We can ask <em>you</em> if a case is about you. Your account is never handed to the family.</p>
        <ion-item>
          <ion-label><strong>Allow name matching</strong></ion-label>
          <ion-toggle [checked]="findable()" (ionChange)="setFindable($any($event.detail).checked)"></ion-toggle>
        </ion-item>
      </section>

      <!-- consent log -->
      <section class="card">
        <div class="lf-row" style="gap:8px">
          <lf-icon name="lock" [size]="20" />
          <h2 class="lf-h2" style="margin:0">Consent log on my cases</h2>
        </div>
        @if (!myConsents().length) {
          <p class="lf-small lf-muted">You have not granted any escalation or location consent yet.</p>
        }
        @for (c of myConsents(); track c.key) {
          <div class="consent" [class.off]="!c.granted">
            <lf-icon [name]="c.granted ? 'check' : 'x'" [size]="16" />
            <div class="lf-grow">
              <strong>{{ c.label }}</strong>
              <span class="lf-small lf-muted">{{ c.post }} · {{ fullDate(c.at) }}</span>
              @if (c.expiresAt) { <span class="lf-small lf-muted">expires {{ fullDate(c.expiresAt) }}</span> }
            </div>
          </div>
        }
      </section>

      <div class="lf-pad">
        <button class="lf-btn lf-btn--ghost lf-btn--block" routerLink="/settings">
          <lf-icon name="settings" [size]="16" /> Privacy & data settings
        </button>
      </div>
    </ion-content>
  `,
  styles: [`
    .card { margin: 12px var(--lf-gap); padding: 15px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); display: flex; flex-direction: column; gap: 10px; }
    .stat { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .stat div { padding: 10px 12px; border-radius: 11px; background: var(--lf-card-2); display: flex; flex-direction: column; gap: 2px; }
    .stat span { font-size: 11px; color: var(--lf-muted); text-transform: uppercase; letter-spacing: .5px; }
    .stat strong { font-size: 14px; }
    .btns { display: flex; gap: 8px; flex-wrap: wrap; }
    .consent { display: flex; gap: 10px; align-items: center; padding: 11px 12px; border-radius: 11px;
      background: var(--lf-card-2); color: var(--lf-ubuntu); }
    .consent.off { color: var(--lf-signal-text); }
    .mine { display: flex; flex-direction: column; gap: 2px; padding: 11px 12px; border-radius: 11px;
      background: color-mix(in srgb, var(--lf-ubuntu) 14%, transparent); }
    .mine.bad { background: color-mix(in srgb, var(--lf-signal) 16%, transparent); }
    .field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--lf-muted); }
    .inp { min-height: 42px; padding: 9px 11px; border-radius: 11px; border: 1px solid var(--lf-line);
      background: var(--lf-card-2); color: inherit; font-size: 14px; }
    .row-check { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 13px; color: var(--lf-muted); }
    .row-check input { width: 24px; height: 24px; accent-color: var(--lf-beacon); }
    .err { color: var(--lf-signal-text); font-size: 12.5px; margin: 0; }
    .consent div { display: flex; flex-direction: column; gap: 2px; }
  `]
})
export class SafetyCenterComponent {
  protected location = inject(LocationService);
  protected lookouts = inject(LookoutService);
  protected auth = inject(AuthService);
  protected data = inject(DataService);
  private toast = inject(ToastController);

  protected readonly provinceName = provinceName;
  protected readonly fullDate = fullDate;

  readonly findable = computed(() => this.auth.user()?.findableProfile ?? false);

  /* be on the lookout */
  readonly mine = computed(() => this.lookouts.mine());
  readonly area = signal('');
  readonly note = signal('');
  readonly shareLocation = signal(true);

  readonly mineHeadline = computed(() => {
    const l = this.mine();
    if (!l) return '';
    if (l.status === 'escalated') return 'You are flagged as a possible missing person';
    if (l.status === 'checking') return 'Your followers are being asked if you are okay';
    return `Be on the lookout: ${l.area}`;
  });

  readonly mineSub = computed(() => {
    const l = this.mine();
    if (!l) return '';
    if (l.status === 'checking') return `${l.answers.length} of ${l.askedIds.length} followers answered`;
    const hrs = Math.max(0, Math.round((l.checkAt - Date.now()) / 3600000));
    return `Started ${timeAgo(l.startedAt)} · followers asked in ${hrs} h`;
  });

  /* publishing a case about me */
  readonly allowAlerts = computed(() => this.auth.user()?.privacy?.allowSafetyAlertPosts === true);
  readonly audience = computed(() => this.auth.user()?.privacy?.safetyAlertAudience ?? 'followers');
  readonly spotlightId = computed(() => this.auth.user()?.privacy?.safetyAlertSpotlightId ?? '');
  readonly mySpotlights = computed(() => {
    const me = this.auth.viewerId;
    if (!me) return [];
    return this.data.spotlights().filter((s) => s.memberIds.includes(me));
  });

  readonly myConsents = computed(() => {
    const me = this.auth.viewerId;
    const out: { key: string; label: string; post: string; granted: boolean; at: number; expiresAt: number | null }[] = [];
    for (const p of this.data.feed().filter((x) => x.authorId === me)) {
      for (const c of p.consent) {
        out.push({ key: p.id + c.kind, label: c.label, post: p.title.slice(0, 34), granted: c.granted, at: c.at, expiresAt: c.expiresAt });
      }
    }
    return out;
  });

  async refresh(): Promise<void> {
    if (this.location.permission() !== 'granted') {
      const ok = await this.location.askWithExplanation();
      if (!ok) {
        await this.say('Location permission was declined. You can enable it in your phone settings.');
        return;
      }
    }
    const p = await this.location.readDevicePosition();
    await this.say(p ? 'Location read and stored on this device only.' : 'Could not read your location.');
  }

  async revoke(): Promise<void> {
    await this.location.revokeAll();
    await this.say('Location forgotten.');
  }

  async toggleBeacon(on: boolean): Promise<void> {
    if (on) await this.location.enableBeacon([]);
    else await this.location.disableBeacon();
  }

  async checkIn(): Promise<void> {
    const rec = await this.location.checkIn([]);
    await this.say(rec ? 'Check-in recorded. Your people will see "safe".' : 'Location permission needed for a check-in.');
  }

  async start(): Promise<void> {
    try {
      const l = await this.lookouts.start({ area: this.area(), note: this.note(), shareLocation: this.shareLocation() });
      this.area.set('');
      this.note.set('');
      await this.say(`Lookout started around ${l.area}. Your followers have been told.`);
    } catch {
      /* the service already holds the message on screen */
    }
  }

  async imHere(): Promise<void> {
    const closed = await this.lookouts.imHere();
    await this.say(closed ? 'You are marked safe. Anything LulaFind posted about you was deleted.' : 'No lookout to close.');
  }

  async cancelLookout(): Promise<void> {
    await this.lookouts.cancel();
    await this.say('Lookout cancelled.');
  }

  private async savePrivacy(patch: Partial<PrivacyPrefs>, message: string): Promise<void> {
    const me = this.auth.user();
    if (!me) return;
    this.data.touchAuthor(await this.auth.updateProfile({ privacy: { ...defaultPrivacy(), ...(me.privacy ?? {}), ...patch } }));
    await this.say(message);
  }

  async setAllowAlerts(on: boolean): Promise<void> {
    await this.savePrivacy(
      { allowSafetyAlertPosts: on, ...(on ? {} : { safetyAlertAudience: 'followers' as const }) },
      on ? 'LulaFind may post a case about you - only after a follower says something is wrong.' : 'LulaFind will never post a case about you.'
    );
  }

  async setAudience(audience: Audience): Promise<void> {
    await this.savePrivacy(
      { safetyAlertAudience: audience },
      audience === 'public' ? 'The case would be visible to everyone on LulaFind.' :
        audience === 'followers' ? 'The case would be visible to your followers only.' :
          'The case would go to your spotlight community only.'
    );
  }

  async setSpotlight(id: string): Promise<void> {
    await this.savePrivacy({ safetyAlertSpotlightId: id || null }, id ? 'Case goes to that spotlight only.' : 'No spotlight chosen yet.');
  }

  async setFindable(v: boolean): Promise<void> {
    if (!this.auth.signedIn()) return;
    await this.auth.setFindable(v);
    await this.say(v ? 'Name matching enabled.' : 'Name matching disabled.');
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, position: 'bottom' });
    await t.present();
  }
}
