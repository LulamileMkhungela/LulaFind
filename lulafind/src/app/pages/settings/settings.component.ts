import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';





import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonToggle } from '@ionic/angular/ion-toggle';
import { IonSelect } from '@ionic/angular/ion-select';
import { IonSelectOption } from '@ionic/angular/ion-select-option';
import { IonRange } from '@ionic/angular/ion-range';
import { AlertController } from '@ionic/angular/alert-controller';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { TopNavComponent } from '../../shared/components/top-nav.component';
import { BACKGROUNDS, BackgroundKey, SettingsService } from '../../core/services/settings.service';
import { AuthService } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { AlertPrefs, Audience, defaultPrivacy } from '../../core/models/types';
import { ModerationService } from '../../core/services/moderation.service';
import { PlatformService } from '../../core/services/platform.service';
import { PermissionsService, PermKind } from '../../core/services/permissions.service';
import { PushService } from '../../core/services/push.service';
import { PROVINCES } from '../../core/models/types';
import { environment } from '../../../environments/environment';
import { SUPPORT_EMAIL, SUPPORT_NAME } from '../../core/config';

@Component({
  selector: 'lf-settings',
  standalone: true,
  imports: [IonContent, IonItem, IonLabel, IonToggle, IonSelect, IonSelectOption, IonRange, RouterLink, IconComponent, TopNavComponent],
  template: `
    <lf-top-nav title="Settings" backTo="/me" />

    <ion-content class="lf-page">
      <section class="card">
        <h3 class="lf-h2">Appearance</h3>
        <ion-item>
          <ion-label position="stacked">Theme</ion-label>
          <ion-select [value]="s().theme" (ionChange)="set({ theme: $any($event.detail).value })">
            <ion-select-option value="dark">Dark (default)</ion-select-option>
            <ion-select-option value="light">Light</ion-select-option>
            <ion-select-option value="system">Match my phone</ion-select-option>
          </ion-select>
        </ion-item>
        <div class="bg-picker" role="radiogroup" aria-label="Background colour">
          <div class="bg-picker__head">
            <strong>Background</strong>
            <span class="lf-muted lf-small">{{ s().theme === 'light' ? 'Shown in Dark theme' : 'Pick the colour behind the app' }}</span>
          </div>
          <div class="bg-picker__row">
            @for (b of backgrounds; track b.key) {
              <button type="button" class="bg-dot" role="radio" [attr.aria-checked]="s().background === b.key"
                      [attr.aria-label]="b.label" [class.on]="s().background === b.key"
                      [style.background]="b.bg" [style.--ring]="b.line" (click)="pickBackground(b.key)">
                <span class="bg-dot__card" [style.background]="b.card"></span>
              </button>
            }
          </div>
          <span class="lf-small lf-muted">{{ backgroundLabel() }}</span>
        </div>
        <ion-item>
          <ion-label>Reduce motion</ion-label>
          <ion-toggle [checked]="s().reduceMotion" (ionChange)="set({ reduceMotion: $any($event.detail).checked })"></ion-toggle>
        </ion-item>
        <p class="lf-small lf-muted story-manual">Stories wait for your tap, so you can read or reply without being rushed.</p>
        <ion-item>
          <ion-label>Data saver (less background loading)</ion-label>
          <ion-toggle [checked]="s().dataSaving" (ionChange)="set({ dataSaving: $any($event.detail).checked })"></ion-toggle>
        </ion-item>
      </section>

      <section class="card">
        <h3 class="lf-h2">Alerts</h3>
        <ion-item>
          <ion-label><strong>Push notifications</strong></ion-label>
          <ion-toggle [checked]="s().pushEnabled" (ionChange)="onPush($any($event.detail).checked)"></ion-toggle>
        </ion-item>
        <ion-item>
          <ion-label><strong>Missing children only</strong><br />
            <span class="lf-muted lf-small">Silence everything except urgent child cases</span></ion-label>
          <ion-toggle [checked]="s().pushMissingOnly" (ionChange)="set({ pushMissingOnly: $any($event.detail).checked })"></ion-toggle>
        </ion-item>
        <ion-item>
          <ion-label position="stacked">Alert province</ion-label>
          <ion-select [value]="s().pushProvince" (ionChange)="set({ pushProvince: $any($event.detail).value })">
            <ion-select-option value="all">All provinces</ion-select-option>
            @for (p of provinces; track p.code) { <ion-select-option [value]="p.code">{{ p.name }}</ion-select-option> }
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-label position="stacked">Alert radius · {{ s().pushRadiusKm }} km<br />
            <span class="lf-muted lf-small">How far from your last location you still want case alerts</span></ion-label>
          <ion-range [min]="5" [max]="200" [step]="5" [value]="s().pushRadiusKm"
                     (ionInput)="set({ pushRadiusKm: $any($event.detail).value })"></ion-range>
        </ion-item>
      </section>

      <section class="card">
        <h3 class="lf-h2">Privacy & data</h3>
        <a class="row" routerLink="/safety"><lf-icon name="shield" [size]="18" /><span>Safety & consent centre</span><lf-icon name="chevronRight" [size]="16" /></a>
        <a class="row" routerLink="/terms"><lf-icon name="book" [size]="18" /><span>Terms, privacy and community rules</span><lf-icon name="chevronRight" [size]="16" /></a>
        @if (auth.user()?.isAdmin) {
          <a class="row" routerLink="/admin"><lf-icon name="shield" [size]="18" /><span>Admin - reports and moderation</span><lf-icon name="chevronRight" [size]="16" /></a>
        }
        <a class="row" routerLink="/faqs"><lf-icon name="info" [size]="18" /><span>FAQs</span><lf-icon name="chevronRight" [size]="16" /></a>
        <p class="lf-small lf-muted" style="margin-top:10px">Who sees your profile is set in <strong>Me → Edit profile</strong>.</p>
        <!-- The safety-post choice. Off until the person turns it on, and the
             audience is theirs to pick - exactly what the lookout rules read. -->
        <ion-item>
          <ion-label><strong>Let LulaFind post a case about me</strong><br />
            <span class="lf-muted lf-small">Only after a follower says something is wrong on a lookout</span></ion-label>
          <ion-toggle [checked]="allowAlerts()" (ionChange)="setAllowAlerts($any($event.detail).checked)"></ion-toggle>
        </ion-item>
        @if (allowAlerts()) {
          <ion-item>
            <ion-label><strong>Who may see that post</strong></ion-label>
            <ion-select [value]="alertAudience()" (ionChange)="setAlertAudience($any($event.detail).value)"
                        interface="popover" aria-label="Who may see the case LulaFind posts">
              <ion-select-option value="public">Everyone</ion-select-option>
              <ion-select-option value="followers">Followers</ion-select-option>
              <ion-select-option value="surname">My spotlight</ion-select-option>
            </ion-select>
          </ion-item>
        }
        <!--
          Last seen is shown to everyone; this is the one control over it, and it
          is what the profile and the lookout screen read before showing a town.
        -->
        <ion-item>
          <ion-label><strong>Show my town and last seen</strong><br />
            <span class="lf-muted lf-small">Everyone can see the town on your cases and when you were last around</span></ion-label>
          <ion-toggle [checked]="showLastSeen()" (ionChange)="setShowLastSeen($any($event.detail).checked)"></ion-toggle>
        </ion-item>
        <ion-item>
          <ion-label><strong>Let LulaFind match me to cases</strong><br />
            <span class="lf-muted lf-small">If a Home Sweet Home post matches your name we will ask you first</span></ion-label>
          <ion-toggle [checked]="findable()" (ionChange)="setFindable($any($event.detail).checked)"></ion-toggle>
        </ion-item>
        <ion-item>
          <ion-label><strong>Haptic feedback</strong></ion-label>
          <ion-toggle [checked]="s().haptics" (ionChange)="set({ haptics: $any($event.detail).checked })"></ion-toggle>
        </ion-item>
      </section>

      <section class="card">
        <h3 class="lf-h2">Phone permissions</h3>
        <p class="lf-small lf-muted">Off until you tap Enable. Nothing is read in the background.</p>
        @for (row of perms.rows(); track row.kind) {
          <div class="perm">
            <div>
              <strong>{{ row.label }}</strong>
              <p class="lf-small lf-muted">{{ row.why }}</p>
              <p class="lf-small">{{ row.statusLabel }}</p>
            </div>
            <button class="lf-btn lf-btn--ghost lf-btn--sm" [disabled]="row.status === 'granted' || perms.busy()" (click)="enablePerm(row.kind)">
              {{ row.status === 'granted' ? 'On' : 'Enable' }}
            </button>
          </div>
        }
        @if (perms.note()) { <p class="lf-small">{{ perms.note() }}</p> }
        <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="openPermSettings()">
          <lf-icon name="settings" [size]="16" /> Open phone settings
        </button>
      </section>

      <section class="card">
        <h3 class="lf-h2">Your data</h3>
        <p class="lf-small lf-muted">Your data lives in your account, not in this app's code.</p>
        <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="clearPhone()">
          <lf-icon name="refresh" [size]="16" /> Clear cases on this phone
        </button>
      </section>

      <section class="card">
        <h3 class="lf-h2">About</h3>
        <p class="lf-small lf-muted">
          LulaFind {{ version }} · {{ platformLabel() }} · Angular + Ionic + Capacitor.<br />
          LulaFind is a community tool. It does not replace the South African Police Service.
          In an emergency call <strong>10111</strong>.
        </p>
        <p class="lf-small lf-muted">
          Support: <a href="mailto:{{ support }}">support&#64;{{ support }}</a> · {{ supportName }}.
          LulaFind is for people 18 and older.
        </p>
        <div class="lf-row" style="gap:8px;flex-wrap:wrap">
          <button class="lf-btn lf-btn--ghost lf-btn--sm" routerLink="/terms">Terms and privacy</button>
          <button class="lf-btn lf-btn--ghost lf-btn--sm" (click)="contactSupport()">Email support</button>
        </div>
      </section>

      @if (auth.signedIn()) {
        <div class="lf-pad danger-zone">
          <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="changeEmail()">
            <lf-icon name="mail" [size]="16" /> Change email
          </button>
          <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="changePassword()">
            <lf-icon name="lock" [size]="16" /> Change password
          </button>
          <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="signOut()">
            <lf-icon name="logout" [size]="16" /> Sign out
          </button>
          <button class="lf-btn lf-btn--danger lf-btn--block" (click)="deleteAccount()">
            <lf-icon name="trash" [size]="16" /> Delete my account and data
          </button>
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .card { margin: 8px var(--lf-gap); padding: 12px 16px; border-radius: var(--lf-radius);
      border: 0; box-shadow: var(--lf-shadow); background: var(--lf-card); }
    .card h3 { margin: 0 0 8px; font-size: 17px; font-weight: 700; }
    .bg-picker { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }
    .bg-picker__head { display: flex; flex-direction: column; }
    .bg-picker__row { display: flex; gap: 12px; flex-wrap: wrap; }
    .bg-dot { position: relative; width: 44px; height: 44px; border-radius: 50%; padding: 0; cursor: pointer;
      border: 2px solid var(--ring, var(--lf-line)); display: grid; place-items: center; }
    .bg-dot__card { width: 22px; height: 22px; border-radius: 50%; }
    .bg-dot.on { border-color: var(--lf-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lf-primary) 35%, transparent); }
    @media (min-width: 768px) { .card { max-width: var(--lf-maxw); margin-left: auto; margin-right: auto; } }
    .card p { line-height: 1.55; margin: 6px 0 10px; }
    code { background: var(--lf-card-2); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
    .row { display: flex; align-items: center; gap: 10px; padding: 12px 4px; color: inherit; text-decoration: none;
      border-top: 1px solid var(--lf-line-soft); font-size: 15px; font-weight: 500; }
    .row span { flex: 1; }
    .danger-zone { display: flex; flex-direction: column; gap: 10px; padding-bottom: 34px; }
    .perm { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 12px 0; border-top: 1px solid var(--lf-line-soft); }
    .perm p { margin: 4px 0 0; }
    .perm button { flex-shrink: 0; margin-top: 2px; }
  `]
})
export class SettingsComponent {
  protected readonly support = SUPPORT_EMAIL;
  protected readonly supportName = SUPPORT_NAME;
  protected settings = inject(SettingsService);
  protected auth = inject(AuthService);
  private data = inject(DataService);
  private mod = inject(ModerationService);
  private platform = inject(PlatformService);
  protected perms = inject(PermissionsService);
  private push = inject(PushService);
  private alert = inject(AlertController);
  private toast = inject(ToastController);

  protected readonly provinces = PROVINCES;
  protected readonly version = environment.appVersion;

  protected readonly backgrounds = BACKGROUNDS;
  readonly s = computed(() => this.settings.settings());
  readonly backgroundLabel = computed(() => BACKGROUNDS.find((b) => b.key === this.s().background)?.label ?? 'Black');

  /** Picking a colour is a request for a dark app, so it switches Light off. */
  pickBackground(background: BackgroundKey): void {
    this.settings.update({ background, theme: this.s().theme === 'light' ? 'dark' : this.s().theme });
  }
  readonly findable = computed(() => this.auth.user()?.findableProfile ?? false);
  readonly allowAlerts = computed(() => this.auth.user()?.privacy?.allowSafetyAlertPosts === true);
  readonly alertAudience = computed(() => this.auth.user()?.privacy?.safetyAlertAudience ?? 'followers');
  /** On by default: last seen is visible to everyone unless the person says otherwise. */
  readonly showLastSeen = computed(() => this.auth.user()?.privacy?.showLastSeen !== false);

  /**
   * The same setting the Safety centre writes. It lives in both places on
   * purpose: this is where someone looks for a setting, and the Safety centre is
   * where they are when they start a lookout.
   */
  async setAllowAlerts(on: boolean): Promise<void> {
    const me = this.auth.user();
    if (!me) return;
    const saved = await this.auth.updateProfile({
      privacy: { ...defaultPrivacy(), ...(me.privacy ?? {}), allowSafetyAlertPosts: on }
    });
    this.data.touchAuthor(saved);
    await this.say(on
      ? 'LulaFind may post a case about you - only after a follower says something is wrong.'
      : 'LulaFind will never post a case about you.');
  }

  async setShowLastSeen(on: boolean): Promise<void> {
    const me = this.auth.user();
    if (!me) return;
    const saved = await this.auth.updateProfile({
      privacy: { ...defaultPrivacy(), ...(me.privacy ?? {}), showLastSeen: on }
    });
    this.data.touchAuthor(saved);
    await this.say(on
      ? 'Your town and last seen are visible to everyone.'
      : 'Your town is hidden. A lookout still shows the area while it is open, so people can help look.');
  }

  async setAlertAudience(audience: Audience): Promise<void> {
    const me = this.auth.user();
    if (!me) return;
    const saved = await this.auth.updateProfile({
      privacy: { ...defaultPrivacy(), ...(me.privacy ?? {}), safetyAlertAudience: audience }
    });
    this.data.touchAuthor(saved);
    await this.say('Saved. That is who would see the case.');
  }
  readonly platformLabel = computed(() =>
    this.platform.isNative ? (this.platform.kind === 'ios' ? 'iOS' : 'Android') : 'Web preview'
  );

  set(patch: Partial<ReturnType<SettingsService['settings']>>): void {
    this.settings.update(patch as any);
    // Alert choices also live on the profile, so a case posted from any phone
    // can be matched to this member's area.
    if ('pushEnabled' in patch || 'pushMissingOnly' in patch || 'pushProvince' in patch || 'pushRadiusKm' in patch) {
      void this.saveAlertPrefs();
    }
  }

  private async saveAlertPrefs(): Promise<void> {
    if (!this.auth.signedIn()) return;
    const a = this.s();
    await this.data.saveAlertPrefs({
      enabled: a.pushEnabled,
      childrenOnly: a.pushMissingOnly,
      province: a.pushProvince as AlertPrefs['province'],
      radiusKm: a.pushRadiusKm
    });
  }

  async setFindable(v: boolean): Promise<void> {
    if (!this.auth.signedIn()) return;
    await this.auth.setFindable(v);
  }

  constructor() {
    void this.perms.refresh();
  }

  async onPush(on: boolean): Promise<void> {
    if (!on) {
      this.settings.update({ pushEnabled: false });
      return;
    }
    const ok = await this.perms.enable('notifications');
    this.settings.update({ pushEnabled: ok });
    await this.saveAlertPrefs();
  }

  async enablePerm(kind: PermKind): Promise<void> {
    const ok = await this.perms.enable(kind);
    if (kind === 'notifications') {
      // The OS grant alone reaches nothing: this is what gets the FCM token.
      if (ok) await this.push.requestAndRegister();
      this.settings.update({ pushEnabled: ok });
      await this.saveAlertPrefs();
      if (this.push.registrationError()) this.say('Notifications are on, but this phone could not register for push: ' + this.push.registrationError());
    }
  }

  private async say(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2600, position: 'bottom' });
    await t.present();
  }

  async openPermSettings(): Promise<void> {
    const opened = await this.perms.openPhoneSettings();
    if (!opened && this.perms.note()) {
      const t = await this.toast.create({ message: this.perms.note()!, duration: 4200, position: 'bottom' });
      await t.present();
    }
  }

  async clearPhone(): Promise<void> {
    const a = await this.alert.create({
      header: 'Clear cases on this phone?',
      message: 'This removes posts, chats, and accounts stored on this phone. It does not put sample cases back.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear',
          role: 'destructive',
          handler: async () => {
            await this.data.resetDemoData();
            this.mod.reset();
            const t = await this.toast.create({ message: 'Cleared on this phone', duration: 1800, position: 'bottom' });
            await t.present();
          }
        }
      ]
    });
    await a.present();
  }

  async contactSupport(): Promise<void> {
    const ok = await this.platform.copy(SUPPORT_EMAIL);
    const t = await this.toast.create({
      message: ok ? `Support email copied - ${SUPPORT_EMAIL}` : `Email ${SUPPORT_EMAIL}`,
      duration: 2600,
      position: 'bottom'
    });
    await t.present();
  }

  async changeEmail(): Promise<void> {
    const a = await this.alert.create({
      header: 'Change email',
      message: 'Only the new email has to confirm. The old address gets an undo link, but you do not confirm there, and you do not type your current password. Google accounts stay with Google.',
      inputs: [{ name: 'email', type: 'email', placeholder: 'New email' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Send the email', role: 'confirm' }
      ]
    });
    await a.present();
    const result = await a.onDidDismiss();
    if (result.role !== 'confirm') return;
    const email = String(result.data?.values?.email ?? '').trim();
    if (!email.includes('@')) return;
    try {
      await this.auth.changeEmail(email);
      const toast = await this.toast.create({
        message: 'Check the new inbox to confirm. The old inbox only has an undo link.',
        duration: 3200,
        position: 'bottom'
      });
      await toast.present();
    } catch (e: unknown) {
      const toast = await this.toast.create({
        message: e instanceof Error ? e.message : 'Could not send the email-change message.',
        duration: 3200,
        position: 'bottom'
      });
      await toast.present();
    }
  }

  async changePassword(): Promise<void> {
    const email = this.auth.user()?.email;
    if (!email) return;
    try {
      await this.auth.sendPasswordReset(email);
      const toast = await this.toast.create({
        message: 'Reset link sent. Open it and choose a new password. You do not need the current password, and you do not have to have signed in today.',
        duration: 3600,
        position: 'bottom'
      });
      await toast.present();
    } catch (e: unknown) {
      const toast = await this.toast.create({
        message: e instanceof Error ? e.message : 'Could not send the reset email.',
        duration: 2800,
        position: 'bottom'
      });
      await toast.present();
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  async deleteAccount(): Promise<void> {
    const a = await this.alert.create({
      header: 'Delete your account?',
      message:
        'This permanently removes your profile, your posts and your messages from this device\'s data store. ' +
        'This removes the profile row in Supabase. The email login stays until that user is deleted in Supabase Authentication. The publishable key cannot delete the login.',
      inputs: [{ name: 'confirm', type: 'text', placeholder: 'Type DELETE to confirm' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete everything',
          role: 'destructive',
          handler: async (v: any) => {
            if (String(v?.confirm ?? '').toUpperCase() !== 'DELETE') {
              const t = await this.toast.create({ message: 'Type DELETE to confirm', duration: 2000, position: 'bottom' });
              await t.present();
              return false;
            }
            await this.auth.deleteAccount();
            return true;
          }
        }
      ]
    });
    await a.present();
  }
}
