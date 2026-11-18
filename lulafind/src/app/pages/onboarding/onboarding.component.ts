import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonProgressBar } from '@ionic/angular/ion-progress-bar';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonToggle } from '@ionic/angular/ion-toggle';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { LocationService } from '../../core/services/location.service';
import { SettingsService } from '../../core/services/settings.service';
import { ProvinceCode, provinceName } from '../../core/models/types';

const STEPS = [
  { key: 'hello', title: 'Welcome to LulaFind', icon: 'sparkle' },
  { key: 'privacy', title: 'Your privacy', icon: 'lock' },
  { key: 'consent', title: 'How consent works here', icon: 'shield' },
  { key: 'done', title: 'You are ready', icon: 'check' }
] as const;

/** Snapchat-style onboarding: one question per screen, progress bar, skippable. */
@Component({
  selector: 'lf-onboarding',
  standalone: true,
  imports: [IonContent, IonProgressBar, IonItem, IonLabel, IonToggle, IconComponent, AvatarComponent],
  template: `
    <ion-content class="lf-page" [attr.inert]="locationPrompt() ? '' : null">
      <ion-progress-bar [value]="progress()"></ion-progress-bar>

      <div class="wrap lf-fade-in">
        <header>
          <span class="step">{{ step() + 1 }} / {{ steps.length }}</span>
          <h1 class="lf-h1">{{ steps[step()].title }}</h1>
        </header>

        @if (step() === 0) {
          <div class="hero">
            <div class="bigmark">L</div>
            <p>
              LulaFind is a search network, not a comment section. Every case is a real person and every
              upvote means "I have an idea that might bring them home".
            </p>
            @if (detected()) {
              <p class="lf-banner lf-banner--success">Your area: {{ provinceName(province ?? undefined) }}@if (town) { · {{ town }} } — you can change it in Profile.</p>
            }
            <div class="rows">
              <div class="r"><lf-icon name="search" [size]="18" /><span>Post a missing person with a full case file</span></div>
              <div class="r"><lf-icon name="home" [size]="18" /><span>Home Sweet Home for people who left and may not want to return</span></div>
              <div class="r"><lf-icon name="users" [size]="18" /><span>Spotlight pages that group every post by surname</span></div>
              <div class="r"><lf-icon name="phone" [size]="18" /><span>Call SAPS, Missing Children SA and Pink Ladies yourself. LulaFind does not send the case</span></div>
            </div>
          </div>
        }

        @if (step() === 1) {
          <div class="center">
            <p class="lf-muted">You control how visible you are. Everything here can be changed later.</p>
            <ion-item>
              <ion-label><strong>Let LulaFind match me to cases</strong><br />
                <span class="lf-muted lf-small">If a Home Sweet Home post matches your name we will ask if it is you - never expose you automatically.</span></ion-label>
              <ion-toggle [checked]="findable" (ionChange)="findable = $any($event.detail).checked"></ion-toggle>
            </ion-item>
            <ion-item>
              <ion-label><strong>Safety beacon</strong><br />
                <span class="lf-muted lf-small">Send "I am safe" check-ins with your location to people you choose.</span></ion-label>
              <ion-toggle [checked]="beacon" (ionChange)="beacon = $any($event.detail).checked"></ion-toggle>
            </ion-item>
            <div class="lf-banner">
              <lf-icon name="eye" [size]="18" />
              <div>When you post, you can always post <strong>anonymously</strong> and choose your audience:
              everyone, followers only, or a single Spotlight surname.</div>
            </div>
          </div>
        }

        @if (step() === 2) {
          <div class="center">
            <p class="lf-muted">Two rules LulaFind never breaks:</p>
            <div class="rules">
              <div class="rule">
                <lf-icon name="megaphone" [size]="20" />
                <div>
                  <strong>Escalation needs your yes</strong>
                  <span>We only forward your case to SAPS, an NGO or a newsroom after you tap agree - and the grant expires.</span>
                </div>
              </div>
              <div class="rule">
                <lf-icon name="lock" [size]="20" />
                <div>
                  <strong>Nobody's location is read without their own consent</strong>
                  <span>If a subject is registered on LulaFind, we ask them. A "no" is final and we never even hint at where they are.</span>
                </div>
              </div>
              <div class="rule">
                <lf-icon name="shield" [size]="20" />
                <div>
                  <strong>Private chat has a gate</strong>
                  <span>You can message when either person follows the other and both allow messages.</span>
                </div>
              </div>
            </div>
          </div>
        }

        @if (step() === 3) {
          <div class="center done">
            <lf-avatar [src]="avatar()" [name]="name()" [size]="96" [ring]="true" />
            <h2 class="lf-h2">{{ name() }}</h2>
            <p class="lf-muted">{{ province ? provinceName(province) : 'South Africa' }} · &#64;{{ auth.user()?.handle }}</p>
            <p class="tip">
              First thing to do: read <strong>what to do in the first 72 hours</strong>. Then browse cases in your feed.
            </p>
          </div>
        }
      </div>

      <footer class="bar">
        @if (step() > 0) {
          <button class="lf-btn lf-btn--ghost" (click)="back()"><lf-icon name="arrowLeft" [size]="16" /> Back</button>
        }
        @if (step() < steps.length - 1) {
          <button class="lf-btn lf-btn--ghost" (click)="finish()">Skip</button>
          <button class="lf-btn lf-btn--primary" (click)="next()">Next <lf-icon name="chevronRight" [size]="16" /></button>
        } @else {
          <button class="lf-btn lf-btn--primary lf-btn--block" (click)="finish()">Enter LulaFind</button>
        }
      </footer>
    </ion-content>
    @if (locationPrompt()) {
      <div class="location-backdrop">
        <section class="location-dialog" role="dialog" aria-modal="true" aria-labelledby="location-title" aria-describedby="location-description">
          <lf-icon name="pin" [size]="28" />
          <h2 id="location-title">See posts near you first</h2>
          <p id="location-description">Allow a one-time location check to prioritise posts from your town and province. Your device will ask for permission.</p>
          <p>We send your coordinates to OpenStreetMap's Nominatim service to find your area. Your town and province are saved to your profile; the precise GPS point is not saved for the feed. You can change your area in Profile.</p>
          <p class="lf-small">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.</p>
          @if (locationError()) { <p class="err" role="alert">{{ locationError() }}</p> }
          <button class="lf-btn lf-btn--primary lf-btn--block" type="button" autofocus [disabled]="locating()" (click)="useGps()">{{ locating() ? 'Finding your area…' : 'Allow current location' }}</button>
          <button class="lf-btn lf-btn--ghost lf-btn--block" type="button" [disabled]="locating()" (click)="skipGps()">Not now</button>
        </section>
      </div>
    }
  `,
  styles: [`
    .location-backdrop { position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .location-dialog { width: 100%; max-width: 420px; max-height: calc(100dvh - 32px); overflow-y: auto; box-sizing: border-box; padding: 22px; border-radius: 16px; background: var(--lf-card); color: var(--ion-text-color); box-shadow: var(--lf-shadow); }
    .location-dialog h2 { font-size: 21px; margin: 10px 0; }
    .location-dialog p { line-height: 1.45; font-size: 14px; }
    .location-dialog button { margin-top: 10px; }
    .wrap { padding: 20px 22px 120px; max-width: 560px; margin: 0 auto; }
    header { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    .step { font-size: 12px; color: var(--lf-muted); font-weight: 700; letter-spacing: .5px; }
    .hero p { font-size: 15px; line-height: 1.55; margin: 14px 0; }
    .bigmark { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 34px; font-weight: 700; color: #fff;
      background: var(--lf-primary-fill); }
    .rows { display: flex; flex-direction: column; gap: 10px; }
    .r { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 8px;
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); font-size: 14px; line-height: 1.4; }
    .r lf-icon { color: var(--lf-beacon); flex-shrink: 0; }
    .center { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
    .center > lf-avatar { margin: 6px auto 0; }
    .perms { display: flex; flex-direction: column; gap: 8px; }
    .err { color: var(--lf-signal-text); font-size: 12.5px; font-weight: 700; margin: 8px 2px 0; }
    .plist { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
    .prow { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 11px; border: 1px solid transparent;
      background: transparent; color: inherit; font-size: 14.5px; font-weight: 600; text-align: left; cursor: pointer; }
    .prow.on { border-color: var(--lf-beacon); background: color-mix(in srgb, var(--lf-beacon) 12%, transparent); }
    .rules { display: flex; flex-direction: column; gap: 10px; }
    .rule { display: flex; gap: 12px; padding: 13px; border-radius: var(--lf-radius); border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); }
    .rule lf-icon { color: var(--lf-ubuntu); flex-shrink: 0; margin-top: 2px; }
    .rule div { display: flex; flex-direction: column; gap: 4px; }
    .rule span { font-size: 12.5px; color: var(--lf-muted); line-height: 1.45; }
    .done { align-items: center; text-align: center; padding-top: 20px; }
    .tick { width: 84px; height: 84px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--lf-ubuntu) 22%, transparent); color: var(--lf-ubuntu); }
    .tip { font-size: 14px; line-height: 1.5; }
    .bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 10px; padding: 12px 18px;
      padding-bottom: max(12px, var(--lf-safe-bottom, 0px)); background: var(--lf-toolbar);
      border-top: 1px solid var(--lf-line); max-width: 560px; margin: 0 auto; }
    .bar .lf-btn--primary { flex: 1; }
  `]
})
export class OnboardingComponent {
  protected auth = inject(AuthService);
  private data = inject(DataService);
  private location = inject(LocationService);
  private settings = inject(SettingsService);
  private router = inject(Router);

  protected readonly steps = STEPS;
  protected readonly provinceName = provinceName;

  step = signal(0);
  displayName = '';
  bio = '';
  findable = true;
  beacon = false;
  province: ProvinceCode | null = null;
  town = '';
  detected = signal(false);
  locationPrompt = signal(true);
  locating = signal(false);
  locationError = signal('');

  readonly progress = computed(() => (this.step() + 1) / STEPS.length);
  readonly name = computed(() => this.displayName || this.auth.user()?.displayName || 'Friend');
  readonly avatar = computed(() => this.data.avatarFor({ ...(this.auth.user() as any), displayName: this.name() }));

  constructor() {
    const u = this.auth.user();
    this.displayName = u?.displayName ?? '';
    this.bio = u?.bio ?? '';
    this.province = u?.province ?? null;
    this.town = u?.town ?? '';
    this.findable = u?.findableProfile ?? true;
  }

  async useGps(): Promise<void> {
    if (this.locating()) return;
    this.locating.set(true);
    this.locationError.set('');
    try {
      const area = await this.location.detectLocalArea();
      if (!area) {
        this.locationError.set(this.location.error() ?? 'Location is unavailable. You can set your area in Profile.');
        return;
      }
      this.province = area.province;
      this.town = area.town;
      this.detected.set(true);
      this.locationPrompt.set(false);
    } finally {
      this.locating.set(false);
    }
  }

  skipGps(): void {
    this.locationPrompt.set(false);
    this.locationError.set('');
  }

  next(): void {
    this.step.set(Math.min(STEPS.length - 1, this.step() + 1));
  }

  back(): void {
    this.step.set(Math.max(0, this.step() - 1));
  }

  async finish(): Promise<void> {
    // Alerts stay on by default. The choice lives in Settings, not a setup step.
    this.settings.update({ pushEnabled: true, pushMissingOnly: true });
    await this.auth.completeOnboarding({
      bio: this.bio.trim(),
      province: this.province,
      town: this.town,
      findableProfile: this.findable,
      safetyBeacon: this.beacon
    });
    if (this.beacon) await this.location.enableBeacon([]);
    await this.data.refresh();
    await this.router.navigate(['/home']);
  }
}
