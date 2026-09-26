import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular/ion-content';
import { IonInput } from '@ionic/angular/ion-input';
import { IonItem } from '@ionic/angular/ion-item';
import { IonLabel } from '@ionic/angular/ion-label';
import { IonProgressBar } from '@ionic/angular/ion-progress-bar';
import { ToastController } from '@ionic/angular/toast-controller';
import { IconComponent } from '../../shared/components/icon.component';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { AuthService, AuthProvider } from '../../core/services/auth.service';
import { DataService } from '../../core/services/data.service';
import { ProvinceCode } from '../../core/models/types';
import { SHOW_DEMO_OTP, SUPPORT_EMAIL, SUPPORT_NAME } from '../../core/config';
import { liveSupabaseEnabled, supabaseNotice } from '../../core/data/supabase-client';
import { firebaseMailEnabled } from '../../core/data/firebase-mail';
import { parseFullName } from '../../core/utils/format';

type Mode = 'welcome' | 'signup' | 'signin' | 'forgot' | 'newpass';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Sign up / sign in.
 *
 * Email first, confirmed with a code emailed by Supabase. Google is the only other sign-in. Apple is not used.
 * person still fills in the short form, so we always have a province, a
 * confirmed 18+ and accepted terms. There is no phone-number sign-up.
 */
@Component({
  selector: 'lf-auth',
  standalone: true,
  imports: [IonContent, IonInput, IonItem, IonLabel, IonProgressBar, IconComponent, AvatarComponent],
  template: `
    <ion-content class="lf-page auth">
      <ion-progress-bar [value]="progress()" class="prog"></ion-progress-bar>
      @if (dbNotice()) {
        <p class="fine" style="margin:12px 16px 0;color:#9a3412">{{ dbNotice() }}</p>
      }

      @if (mode() === 'welcome') {
        <section class="lf-fade-in welcome">
          <div class="logo">
            <span class="mark">Lula</span><span class="mark mark--2">Find</span>
          </div>
          <p class="tag">The community search network.<br />Bring them home.</p>

          <div class="pills">
            <span class="lf-chip"><lf-icon name="search" [size]="13" /> Missing people</span>
            <span class="lf-chip lf-chip--warn"><lf-icon name="home" [size]="13" /> KhumbulEkhaya</span>
            <span class="lf-chip lf-chip--success"><lf-icon name="users" [size]="13" /> Spotlight surnames</span>
          </div>

          <div class="cta">
            <button class="lf-btn lf-btn--primary lf-btn--block big" (click)="startSignup()">
              <lf-icon name="plus" [size]="18" /> Sign up
            </button>
            <button class="lf-btn lf-btn--ghost lf-btn--block" (click)="mode.set('signin')">
              I already have an account · Sign in
            </button>

            <div class="or"><span>or continue with</span></div>
            <div class="providers">
              <button class="prov" (click)="provider('google')">
                <lf-icon name="globe" [size]="18" /> Google
              </button>
            </div>
          </div>

          <p class="fine">
            No phone number needed. We never sell your data, and you can delete your account in Settings at any time.
          </p>
          <p class="fine">
            Need help? <a href="mailto:{{ support }}">Email us</a>
          </p>
        </section>
      }

      @if (mode() === 'signup') {
        <section class="lf-fade-in form">
          <button class="back" (click)="mode.set('welcome')"><lf-icon name="arrowLeft" [size]="20" /></button>
          <h1 class="lf-h1">Create your account</h1>
          <p class="sub">
            @if (pendingName()) {
              Signed in with {{ pendingName() }}. Just a few details and you are in.
            } @else {
              Enter your email and a password of at least 8 characters, then tap Email me. The email comes from noreply@lulafinds-app.firebaseapp.com. Open the link. You do not type a code. Google does not use this.
            }
          </p>

          <!-- 1. email, with Get OTP on the same line -->
          <ion-item class="otp-row" [class.bad]="touched.email && !emailOk()">
            <ion-label position="stacked">Email</ion-label>
            <ion-input type="email" inputmode="email" autocomplete="email"
                       placeholder="you@example.co.za" [value]="f.email" [disabled]="!!pendingName() || otpSent()"
                       (ionInput)="onEmail($any($event.target).value)" (ionBlur)="touched.email = true"></ion-input>
            @if (!pendingName() && !otpSent()) {
              <button class="otp-btn" [disabled]="!emailOk() || otpBusy()" (click)="sendOtp()">
                {{ otpBusy() ? 'Sending…' : 'Email me' }}
              </button>
            }
            @if (otpSent()) {
              <button class="otp-btn resend" [disabled]="otpBusy()" (click)="sendOtp()">Resend</button>
            }
          </ion-item>
          @if (touched.email && !emailOk()) { <p class="field-err">That email does not look right</p> }
          @if (otpSent() && !pendingName()) {
            <p class="field-ok">
              <lf-icon name="check" [size]="13" />
              @if (showDemoOtp && !liveEmail) {
                This phone cannot email a code yet. Use this code. It was not emailed.
                @if (demoCode()) { <strong>{{ demoCode() }}</strong> }
              } @else {
                LulaFinds emailed {{ otpTarget() }} from noreply@lulafinds-app.firebaseapp.com. Open the link on that page, then come back and tap the button below.
              }
            </p>
          }

          <!-- 2. OTP. Google does not use this. A normal email does. -->
          @if (!pendingName() && !emailConfirmed() && !firebaseMail) {
          <ion-item [class.bad]="touched.otp && !otpOk()" [class.disabled]="!otpSent()">
            <ion-label position="stacked">{{ showDemoOtp && !liveEmail ? 'Code on this phone' : 'Code from the Firebase email' }}</ion-label>
            <ion-input type="text" inputmode="text" maxlength="200" placeholder="Paste the code from the link"
                       [value]="f.otp" [disabled]="!otpSent() || otpVerified()"
                       (ionInput)="onOtp($any($event.target).value)" (ionBlur)="touched.otp = true"></ion-input>
            @if (otpVerified()) { <lf-icon name="check" [size]="18" class="tick" /> }
          </ion-item>
          @if (firebaseMail && otpSent() && !otpVerified()) {
            <button class="lf-btn lf-btn--ghost lf-btn--block" type="button" (click)="openedEmail()">I opened the Firebase email</button>
          }
          @if (touched.otp && otpSent() && !otpOk() && !otpVerified()) {
            <p class="field-err">That code is not right. Check your email and try again.</p>
          }
          }

          <!-- 3. password, only for a normal email, and only after the code checks out. Google has no password here. -->
          @if (!pendingName()) {
          <ion-item [class.bad]="touched.password && f.password.length < 8" [class.disabled]="!canSetPassword()">
            <ion-label position="stacked">Password</ion-label>
            <ion-input [type]="showPass() ? 'text' : 'password'" autocomplete="new-password"
                       placeholder="At least 8 characters" [value]="f.password"
                       [disabled]="!canSetPassword()"
                       (ionInput)="f.password = $any($event.target).value" (ionBlur)="touched.password = true"></ion-input>
            @if (canSetPassword()) {
              <button class="eye" (click)="showPass.set(!showPass())" aria-label="Show password">
                <lf-icon [name]="showPass() ? 'eyeOff' : 'eye'" [size]="17" />
              </button>
            }
          </ion-item>
          @if (touched.password && canSetPassword() && f.password.length < 8) {
            <p class="field-err">Use at least 8 characters</p>
          }
          }

          <!-- 4. full name. The second name is the surname and the username. -->
          <ion-item [class.bad]="touched.name && !nameOk()">
            <ion-label position="stacked">Your full name</ion-label>
            <ion-input placeholder="e.g. John Doe" autocomplete="name" [value]="f.displayName"
                       (ionInput)="onFullName($any($event.target).value)" (ionBlur)="touched.name = true"></ion-input>
          </ion-item>
          @if (touched.name && !nameOk()) {
            <p class="field-err">Enter your first name and surname. Your second name becomes your username.</p>
          }
          @if (nameParts()) {
            <div class="ident-lock">
              <lf-avatar src="" [name]="f.displayName" [size]="42" />
              <div>
                <span class="k">Username</span>
                <strong>&#64;{{ usernamePreview() }}</strong>
              </div>
              <lf-icon name="lock" [size]="16" />
            </div>
            <p class="field-ok">Your second name is your username. It cannot be edited. Your picture is {{ nameParts()!.initials }}.</p>
          }

          <p class="lf-small lf-muted" style="margin:2px 2px 0">
            You will choose your province and town on the next screen - nothing is picked for you.
          </p>

          <div class="agree">
            <label class="check" [class.bad]="touched.over18 && !over18">
              <input type="checkbox" [checked]="over18" (change)="over18 = $any($event.target).checked" />
              <span>I am <strong>18 or older</strong>.</span>
            </label>
            <label class="check" [class.bad]="touched.terms && !terms">
              <input type="checkbox" [checked]="terms" (change)="terms = $any($event.target).checked" />
              <span>
                I agree to the <button class="linklike" type="button" (click)="openTerms()">Terms and Conditions</button>
                and the <button class="linklike" type="button" (click)="openPrivacy()">Privacy Policy</button>.
                I understand that sharing false information about a missing person is a crime in South Africa
                and can lead to arrest.
              </span>
            </label>
          </div>

          <button class="lf-btn lf-btn--primary lf-btn--block big" [disabled]="busy()" (click)="signup()">
            {{ busy() ? 'Creating…' : 'Create account' }}
          </button>

          <div class="or"><span>or continue with</span></div>
          <div class="providers">
            <button class="prov" (click)="provider('google')"><lf-icon name="globe" [size]="18" /> Google</button>
          </div>

          <p class="switch">
            Already have an account?
            <button class="linklike" type="button" (click)="mode.set('signin')">Sign in here</button>
          </p>
          @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
        </section>
      }

      @if (mode() === 'signin') {
        <section class="lf-fade-in form">
          <div class="logo sm">
            <span class="mark">Lula</span><span class="mark mark--2">Find</span>
          </div>

          <ion-item [class.bad]="touched.email && !emailOk()">
            <ion-label position="stacked">Email</ion-label>
            <ion-input type="email" inputmode="email" autocomplete="email" placeholder="you@example.co.za"
                       [value]="f.email" (ionInput)="f.email = $any($event.target).value"
                       (ionBlur)="touched.email = true"></ion-input>
          </ion-item>
          @if (touched.email && !emailOk()) { <p class="field-err">That email does not look right</p> }

          <ion-item [class.bad]="touched.password && !f.password">
            <ion-label position="stacked">Password</ion-label>
            <ion-input [type]="showPass() ? 'text' : 'password'" autocomplete="current-password"
                       [value]="f.password" (ionInput)="f.password = $any($event.target).value"
                       (ionBlur)="touched.password = true"></ion-input>
            <button class="eye" (click)="showPass.set(!showPass())" aria-label="Show password">
              <lf-icon [name]="showPass() ? 'eyeOff' : 'eye'" [size]="17" />
            </button>
          </ion-item>
          @if (touched.password && !f.password) { <p class="field-err">Enter your password</p> }

          <button class="lf-btn lf-btn--primary lf-btn--block big" [disabled]="busy()" (click)="signin()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>

          <button class="textbtn" type="button" (click)="mode.set('forgot')">Forgot password?</button>

          <div class="or"><span>or continue with</span></div>
          <div class="providers">
            <button class="prov" (click)="provider('google')"><lf-icon name="globe" [size]="18" /> Google</button>
          </div>

          <p class="switch">
            Don't have an account?
            <button class="linklike" type="button" (click)="startSignup()">Create one here</button>
          </p>

          @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
        </section>
      }

      @if (mode() === 'forgot') {
        <section class="lf-fade-in form">
          <button class="back" (click)="mode.set('signin')"><lf-icon name="arrowLeft" [size]="20" /></button>
          <h1 class="lf-h1">Reset your password</h1>
          <p class="sub">LulaFinds emails a reset link from noreply@lulafinds-app.firebaseapp.com. Open it and set the new password on that page, then sign in here. We never ask for a password by phone or SMS.</p>
          <ion-item [class.bad]="touched.email && !emailOk()">
            <ion-label position="stacked">Email</ion-label>
            <ion-input type="email" [value]="f.email" (ionInput)="f.email = $any($event.target).value"></ion-input>
          </ion-item>
          <button class="lf-btn lf-btn--primary lf-btn--block" (click)="forgot()">Send reset link</button>
          @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
          @if (notice()) { <p class="ok"><lf-icon name="check" [size]="15" /> {{ notice() }}</p> }
        </section>
      }

      @if (mode() === 'newpass') {
        <section class="lf-fade-in form">
          <h1 class="lf-h1">Choose a new password</h1>
          <p class="sub">This is only for an email account. Google sign-in does not use a password here.</p>
          <ion-item>
            <ion-label position="stacked">Code from the reset link</ion-label>
            <ion-input type="text" placeholder="Only if the link did not open here" [value]="f.otp"
                       (ionInput)="f.otp = $any($event.target).value"></ion-input>
          </ion-item>
          <ion-item [class.bad]="touched.password && f.password.length < 8">
            <ion-label position="stacked">New password</ion-label>
            <ion-input [type]="showPass() ? 'text' : 'password'" autocomplete="new-password"
                       placeholder="At least 8 characters" [value]="f.password"
                       (ionInput)="f.password = $any($event.target).value" (ionBlur)="touched.password = true"></ion-input>
          </ion-item>
          <button class="lf-btn lf-btn--primary lf-btn--block" [disabled]="busy()" (click)="saveNewPassword()">
            {{ busy() ? 'Saving…' : 'Save password' }}
          </button>
          @if (error()) { <p class="err"><lf-icon name="alert" [size]="15" /> {{ error() }}</p> }
        </section>
      }
    </ion-content>

    @if (legal()) {
      <div class="legal" (click)="legal.set(null)">
        <div class="sheet" (click)="$event.stopPropagation()">
          <div class="lf-row-between">
            <h3 class="lf-h2">{{ legal() }}</h3>
            <button class="lf-icon-btn" (click)="legal.set(null)"><lf-icon name="x" [size]="20" /></button>
          </div>
          <p class="lf-small">
            LulaFind is a community tool for finding missing people in South Africa. It does not replace the
            South African Police Service. In an emergency call <strong>10111</strong>.
          </p>
          <p class="lf-small">
            <strong>Your duty:</strong> everything you post must be true. Posting false information about a missing
            person, opening a fake case, or sharing someone's private details without permission is a criminal
            offence in South Africa (defamation, crimen injuria and defeating the ends of justice) and can lead to
            arrest. LulaFind hands account records to SAPS on a lawful request.
          </p>
          <p class="lf-small">
            <strong>Children:</strong> you may only post about a person under 18 if you are their parent, guardian,
            or a SAPS officer. Those cases are reviewed by a moderator before they go live.
          </p>
          <p class="lf-small">
            <strong>Your data:</strong> your email, name and province are stored so a case can be trusted. Your
            location is only ever read when you tap a button to share it. You can delete your account and
            everything in it from Settings.
          </p>
          <p class="lf-small">
            Support: <a href="mailto:{{ support }}">support&#64;{{ support }}</a> · {{ supportName }}.
          </p>
          <button class="lf-btn lf-btn--primary lf-btn--block" (click)="legal.set(null)">Close</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .prog { --progress-background: var(--lf-beacon); position: sticky; top: 0; z-index: 3; }
    .auth { --padding-bottom: 40px; }
    .welcome { padding: 44px 24px 30px; display: flex; flex-direction: column; gap: 16px; align-items: flex-start;
      max-width: 460px; margin: 0 auto; width: 100%; }
    .logo { font-size: 46px; font-weight: 900; letter-spacing: -1.8px; line-height: 1; }
    .mark { color: var(--lf-beacon); }
    .mark--2 { color: var(--ion-text-color); }
    .tag { margin: 0; font-size: 19px; line-height: 1.4; font-weight: 600; }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; }
    .cta { display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 6px; }
    .big { min-height: 50px; font-size: 15.5px; }
    .or { display: flex; align-items: center; gap: 10px; color: var(--lf-muted); font-size: 12px; margin: 2px 0; }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--lf-line); }
    .providers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .prov { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 12px 6px;
      border-radius: 12px; border: 1px solid var(--lf-line); background: var(--lf-card); color: inherit;
      font-size: 13px; font-weight: 700; cursor: pointer; }
    .prov:active { background: var(--lf-card-2); }
    .fine { font-size: 12px; color: var(--lf-muted); line-height: 1.5; margin: 0; }
    .fine a { color: var(--lf-beacon); }
    .form { padding: 18px 22px 40px; display: flex; flex-direction: column; gap: 10px; max-width: 460px;
      margin: 0 auto; width: 100%; }
    .form h1 { margin: 10px 0 0; }
    .sub { margin: -4px 0 6px; color: var(--lf-muted); font-size: 14px; line-height: 1.45; }
    .back { align-self: flex-start; background: none; border: 0; color: inherit; cursor: pointer; padding: 6px 0; }
    ion-item { --background: var(--lf-card); border-radius: 16px; --border-radius: 16px; --inner-padding-end: 14px; }
    ion-item.bad { --border-color: var(--lf-signal); box-shadow: inset 0 0 0 1.5px var(--lf-signal); }
    .field-err { color: var(--lf-signal); font-size: 12px; font-weight: 600; margin: -4px 0 0 4px; }
    .field-ok { display: flex; align-items: center; gap: 6px; color: var(--lf-ubuntu); font-size: 12px;
      font-weight: 600; margin: -4px 0 0 4px; }
    .ident-lock { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px;
      border: 1px dashed var(--lf-line); background: var(--lf-card-2); }
    .ident-lock .k { display: block; font-size: 11px; color: var(--lf-muted); font-weight: 700; }
    .ident-lock strong { font-size: 15px; }
    .ident-lock lf-icon { margin-left: auto; color: var(--lf-muted); }
    /* the email row holds its own Get OTP button, pushed to the far right */
    .otp-row { --inner-padding-end: 8px; }
    .otp-btn { flex-shrink: 0; align-self: flex-end; margin: 0 0 8px 10px; padding: 8px 14px;
      border-radius: 10px; border: 1.5px solid var(--lf-beacon); background: var(--lf-beacon);
      color: #1a1200; font-size: 13px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .otp-btn:disabled { opacity: .38; cursor: not-allowed; }
    .otp-btn.resend { background: transparent; color: var(--lf-beacon); }
    .tick { color: var(--lf-ubuntu); margin-right: 12px; }
    .eye { background: none; border: 0; color: var(--lf-muted); cursor: pointer; padding: 6px 12px 6px 4px; }
    ion-item.disabled { opacity: .55; }
    .agree { display: flex; flex-direction: column; gap: 10px; padding: 6px 2px 2px; }
    .check { display: flex; gap: 10px; font-size: 12.5px; color: var(--lf-muted); line-height: 1.45; }
    .check.bad { color: var(--lf-signal); }
    .check input { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--lf-beacon); margin-top: 1px; }
    .switch { font-size: 13px; color: var(--lf-muted); text-align: center; margin: 4px 0 0; }
    .logo.sm { font-size: 34px; letter-spacing: -1.6px; margin: 8px 0 10px; }
    .textbtn { background: none; border: 0; color: var(--lf-muted); font-size: 13px; font-weight: 700;
      text-decoration: underline; cursor: pointer; padding: 2px; align-self: flex-start; }
    .linklike { background: none; border: 0; color: var(--lf-beacon); font-weight: 700; font-size: inherit;
      padding: 0; cursor: pointer; text-decoration: underline; }
    .err, .ok { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0 0; }
    .err { color: var(--lf-signal); }
    .ok { color: var(--lf-ubuntu); }
    .legal { position: fixed; inset: 0; z-index: 40; background: rgba(4, 8, 20, .72);
      display: flex; align-items: flex-end; justify-content: center; }
    .legal .sheet { width: 100%; max-width: 520px; max-height: 86vh; overflow-y: auto;
      background: var(--lf-card); border-radius: 18px 18px 0 0; padding: 18px 18px 30px; }
    .legal p { line-height: 1.55; margin: 10px 0; }
    .legal a { color: var(--lf-beacon); }
  `]
})
export class AuthComponent implements OnInit {
  private auth = inject(AuthService);
  private data = inject(DataService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastCtl = inject(ToastController, { optional: true });

  protected readonly support = SUPPORT_EMAIL;
  protected readonly supportName = SUPPORT_NAME;
  /** Flip SHOW_DEMO_OTP to hide the on-screen code. Verification does not use it. */
  protected readonly showDemoOtp = SHOW_DEMO_OTP;
  private readonly taken = signal<string[]>([]);

  mode = signal<Mode>('signin');
  busy = signal(false);
  error = signal('');
  notice = signal('');
  legal = signal<string | null>(null);
  over18 = false;
  terms = false;
  showPass = signal(false);
  /** OTP step state. */
  otpBusy = signal(false);
  otpSent = signal(false);
  otpTarget = signal('');
  demoCode = signal('');
  otpVerified = signal(false);
  private next = '/home';

  touched = { name: false, email: false, password: false, surname: false, province: false, over18: false, terms: false, otp: false };

  f = {
    displayName: '', email: '', password: '', surname: '', otp: '',
    province: null as ProvinceCode | null, town: ''
  };

  readonly progress = computed(() => {
    const m = this.mode();
    if (m === 'welcome') return 0.1;
    if (m === 'signin') return 0.55;
    if (m === 'forgot') return 0.75;
    if (this.otpVerified()) return 0.8;
    if (this.otpSent()) return 0.55;
    return 0.3;
  });

  /** Live Supabase confirms by email link, so the password is not locked behind a code on this phone. */
  protected readonly liveEmail = liveSupabaseEnabled();
  protected readonly firebaseMail = firebaseMailEnabled();
  readonly dbNotice = supabaseNotice;

  /** The password field only unlocks after the emailed code checks out. */
  readonly emailConfirmed = computed(() => this.auth.emailAlreadyConfirmed());
  readonly canSetPassword = computed(() => this.firebaseMail || this.otpVerified() || this.emailConfirmed());

  /**
   * The code as typed matches the one that was sent.
   * A method, not a computed: `f` is a plain object, so a computed would never
   * re-run when the user types and the OTP field would never validate.
   */
  otpOk(): boolean {
    const code = this.f.otp.trim();
    if (this.firebaseMail) return this.otpVerified();
    if (this.liveEmail) return this.otpVerified() && code.length > 8;
    return code.length === 6 && this.auth.verifyOtp(this.otpTarget(), code);
  }

  /**
   * Locked username, rebuilt as the full name is typed.
   * A method, not a computed: `f` is a plain object.
   */
  nameParts() {
    return parseFullName(this.f.displayName);
  }

  nameOk(): boolean {
    return this.nameParts() !== null;
  }

  usernamePreview(): string {
    return this.auth.previewHandle(this.f.displayName, this.taken());
  }

  onFullName(value: string): void {
    this.f.displayName = value;
  }

  /** Name of a Google account waiting to finish signing up. */
  readonly pendingName = computed(() => this.auth.pendingProvider()?.displayName ?? '');

  ngOnInit(): void {
    this.next = (this.route.snapshot.queryParamMap.get('next') as string) || '/home';
    void this.afterRestore();
  }

  private async afterRestore(): Promise<void> {
    for (let i = 0; i < 50 && !this.auth.ready(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (this.auth.signedIn()) {
      await this.afterAuth();
      return;
    }
    if (this.auth.passwordRecovery()) {
      this.mode.set('newpass');
      return;
    }
    const pending = this.auth.pendingProvider();
    if (pending) {
      this.f.email = pending.email;
      this.f.displayName = pending.displayName;
      this.mode.set('signup');
      return;
    }
    if (this.auth.emailAlreadyConfirmed()) {
      this.f.email = this.auth.confirmedEmail() || this.f.email;
      this.otpVerified.set(true);
      this.otpSent.set(true);
      this.mode.set('signup');
    }
  }

  emailOk(): boolean {
    return EMAIL_RE.test(this.f.email.trim());
  }

  startSignup(): void {
    this.error.set('');
    this.otpSent.set(false);
    this.otpVerified.set(false);
    this.demoCode.set('');
    this.f.otp = '';
    this.mode.set('signup');
    void this.loadHandles();
  }

  private async loadHandles(): Promise<void> {
    this.taken.set(await this.data.allHandles());
  }

  openTerms(): void { this.legal.set('Terms and Conditions'); }
  openPrivacy(): void { this.legal.set('Privacy Policy'); }

  private validate(): boolean {
    this.touched = { name: true, email: true, password: true, surname: true, province: true, over18: true, terms: true, otp: true };
    if (!this.emailOk()) { this.error.set('That email does not look right.'); return false; }
    if (!this.pendingName() && !this.emailConfirmed()) {
      if (!this.otpSent()) { this.error.set(this.firebaseMail ? 'Tap Email me, open the link, then tap I opened the Firebase email.' : this.showDemoOtp ? 'Tap Get OTP. The code appears on this phone because email delivery is not connected yet.' : 'Tap Get OTP and enter the code we email you.'); return false; }
      if (!this.otpOk()) { this.error.set(this.firebaseMail ? 'Open the verification link first, then tap I opened the Firebase email.' : this.showDemoOtp ? 'That code is not right.' : 'That code is not right. Check your email and try again.'); return false; }
    }
    if (!this.pendingName() && this.f.password.length < 8) { this.error.set('Password must be at least 8 characters.'); return false; }
    if (!this.nameOk()) { this.error.set('Enter your first name and surname. Your second name becomes your username.'); return false; }
    if (!this.over18) { this.error.set('You must be 18 or older to use LulaFind.'); return false; }
    if (!this.terms) { this.error.set('Please accept the terms and conditions.'); return false; }
    return true;
  }

  /** Typing in the email invalidates a code that was already sent. */
  onEmail(value: string): void {
    this.f.email = value;
    if (this.otpSent() && value.trim().toLowerCase() !== this.otpTarget()) {
      this.otpSent.set(false);
      this.otpVerified.set(false);
      this.f.otp = '';
      this.demoCode.set('');
    }
  }

  async sendOtp(): Promise<void> {
    this.error.set('');
    if (!this.emailOk()) { this.touched.email = true; this.error.set('Enter a valid email address first.'); return; }
    this.otpBusy.set(true);
    try {
      if (this.firebaseMail && this.f.password.length < 8) {
        this.error.set('Set a password of at least 8 characters first. Firebase emails that address after the account exists.');
        return;
      }
      const res = await this.auth.requestOtp(this.f.email, this.f.password);
      this.otpTarget.set(res.sentTo);
      this.demoCode.set(res.demoCode === 'ALREADY_CONFIRMED' ? '' : res.demoCode);
      this.otpSent.set(true);
      this.otpVerified.set(res.demoCode === 'ALREADY_CONFIRMED');
      this.f.otp = '';
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not send the code');
    } finally {
      this.otpBusy.set(false);
    }
  }

  async openedEmail(): Promise<void> {
    this.error.set('');
    this.otpBusy.set(true);
    try {
      const ok = await this.auth.verifyEmailOtp(this.otpTarget() || this.f.email, this.f.otp);
      this.otpVerified.set(ok);
      if (!ok) this.error.set('Firebase has not confirmed that email yet. Open the message, then try again.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'That code is not right.');
    } finally {
      this.otpBusy.set(false);
    }
  }

  onOtp(value: string): void {
    this.f.otp = this.firebaseMail ? value.trim().slice(0, 200) : value.replace(/[^0-9]/g, '').slice(0, 6);
    if (this.firebaseMail ? this.f.otp.length < 8 : this.f.otp.length !== 6) return;
    if (this.liveEmail) {
      this.otpBusy.set(true);
      void this.auth.verifyEmailOtp(this.otpTarget(), this.f.otp).then((ok) => {
        this.otpVerified.set(ok);
        if (ok) void this.celebrate();
        else this.error.set('That code is not right. Check your email and try again.');
      }).catch((e: any) => {
        this.otpVerified.set(false);
        this.error.set(e?.message ?? 'That code is not right.');
      }).finally(() => this.otpBusy.set(false));
      return;
    }
    if (this.auth.verifyOtp(this.otpTarget(), this.f.otp)) {
      this.otpVerified.set(true);
      void this.celebrate();
    }
  }

  private async celebrate(): Promise<void> {
    try {
      const { ToastController } = await import('@ionic/angular/toast-controller');
      const ctl = this.toastCtl;
      if (!ctl) return;
      const t = await ctl.create({ message: 'Email confirmed. Now set your password.', duration: 2200, position: 'bottom' });
      await t.present();
    } catch { /* no toast in this context - the green tick is enough */ }
  }

  async signup(): Promise<void> {
    this.error.set('');
    if (!this.validate()) return;
    this.busy.set(true);
    try {
      const payload = {
        displayName: this.f.displayName,
        email: this.f.email,
        password: this.f.password || 'provider-login',
        surname: '',
        province: this.f.province,
        town: this.f.town,
        provider: this.auth.pendingProvider()?.provider ?? null,
        over18: this.over18,
        acceptedTerms: this.terms,
        otpVerified: this.otpVerified()
      };
      if (this.auth.pendingProvider()) await this.auth.finishProviderSignUp(payload);
      else await this.auth.signUp(payload);
      await this.afterAuth();
    } catch (e: any) {
      const msg = String(e?.message ?? 'Could not create the account');
      if (msg.startsWith('Check your email')) {
        this.notice.set(msg);
        this.mode.set('signin');
        return;
      }
      this.error.set(msg);
    } finally {
      this.busy.set(false);
    }
  }

  async signin(): Promise<void> {
    this.error.set('');
    if (!this.emailOk()) { this.touched.email = true; this.error.set('Enter the email you signed up with.'); return; }
    if (!this.f.password) { this.touched.password = true; this.error.set('Enter your password.'); return; }
    this.busy.set(true);
    try {
      await this.auth.signIn(this.f.email, this.f.password);
      await this.afterAuth();
    } catch (e: any) {
      if (String(e?.message ?? '') === 'FINISH_PROFILE') {
        this.f.email = this.auth.confirmedEmail() || this.f.email;
        this.otpVerified.set(true);
        this.otpSent.set(true);
        this.mode.set('signup');
        this.notice.set('That email is confirmed. Finish your name and password to open the account.');
        return;
      }
      this.error.set(e?.message ?? 'Could not sign in');
    } finally {
      this.busy.set(false);
    }
  }

  async saveNewPassword(): Promise<void> {
    this.error.set('');
    if (this.f.password.length < 8) {
      this.touched.password = true;
      this.error.set('Password must be at least 8 characters.');
      return;
    }
    this.busy.set(true);
    try {
      const profile = await this.auth.completePasswordReset(this.f.password, this.f.otp);
      if (!profile) {
        this.mode.set('signup');
        this.notice.set('Password saved. Finish your name to open the account.');
        return;
      }
      await this.afterAuth();
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not save the new password.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Google is the only provider button. Apple is not offered.
   */
  async provider(p: AuthProvider): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.signInWithProvider(p);
      await this.afterAuth();
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (msg === 'GOOGLE_REDIRECT') return;
      if (msg === 'NEW_ACCOUNT') {
        const pending = this.auth.pendingProvider();
        if (pending) {
          this.f.email = pending.email;
          this.f.displayName = pending.displayName;
        }
        this.mode.set('signup');
        return;
      }
      this.error.set(msg || 'That sign-in did not complete.');
    } finally {
      this.busy.set(false);
    }
  }

  async demo(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.signInDemo();
      await this.data.refresh();
      await this.router.navigate(['/home']);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Demo account unavailable');
    } finally {
      this.busy.set(false);
    }
  }

  async forgot(): Promise<void> {
    this.error.set('');
    this.notice.set('');
    if (!this.emailOk()) { this.error.set('Enter the email on the account.'); return; }
    this.busy.set(true);
    try {
      await this.auth.sendPasswordReset(this.f.email);
      this.notice.set(this.firebaseMail
        ? 'If that email has a LulaFinds account, the reset email is on its way from noreply@lulafinds-app.firebaseapp.com. Open the link and set the new password on that page, then sign in here.'
        : 'Password reset email is not connected yet. I cannot send a link from this phone.');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not send a reset link.');
    } finally {
      this.busy.set(false);
    }
  }

  browse(): void {
    void this.router.navigate(['/home']);
  }

  private async afterAuth(): Promise<void> {
    await this.data.refresh();
    if (this.auth.needsOnboarding()) {
      await this.router.navigate(['/onboarding']);
      return;
    }
    await this.router.navigateByUrl(this.next);
  }
}
