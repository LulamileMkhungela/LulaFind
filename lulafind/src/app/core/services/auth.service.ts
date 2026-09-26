import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LULA_API, LulaApi } from '../data/api';
import { UserProfile, defaultPrivacy, provinceName } from '../models/types';
import { KvStore } from '../data/local-db';
import { avatar, hueOf } from '../data/seed';
import { nextHandle, parseFullName, slugSurname, uid } from '../utils/format';
import { PlatformService } from './platform.service';

export type AuthProvider = 'google' | 'apple';

export interface SignUpPayload {
  displayName: string;
  email: string;
  password: string;
  surname: string;
  province: UserProfile['province'] | null;
  town: string;
  /** optional third-party provider - null for email + password */
  provider?: AuthProvider | null;
  avatarUrl?: string;
  /** the person confirmed they are 18 or older */
  over18?: boolean;
  /** the person accepted the terms and the false-information warning */
  acceptedTerms?: boolean;
  /** email sign-up only: the OTP sent to the address was entered correctly */
  otpVerified?: boolean;
}

interface StoredAccount {
  email: string;
  /** mock-mode credential hash. In firebase mode this is unused. */
  secret: string;
  userId: string;
}

/**
 * Auth + session.
 *
 * Mode 1 (default, environment.dataMode='mock'): local accounts kept in
 * localStorage so the whole product is testable without any backend.
 * Mode 2 (environment.dataMode='firebase'): Firebase Auth email/password plus
 * Google and Apple sign-in. The call sites are identical either way.
 *
 * Deliberately NO phone-number sign-up, per product decision.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private platform = inject(PlatformService);
  private router = inject(Router);
  private injectedApi = inject(LULA_API);
  private store = new KvStore('lulafind.auth');

  readonly user = signal<UserProfile | null>(null);
  readonly ready = signal(false);
  readonly signedIn = computed(() => !!this.user());
  readonly needsOnboarding = computed(() => !!this.user() && !this.user()!.onboarded);
  readonly userAvatar = computed(() => {
    const u = this.user();
    return u ? avatar(u.displayName, u.avatarHue) : avatar('Guest');
  });

  /**
   * The API is injected directly so AuthService works even when nothing else in
   * the app has been constructed yet (e.g. the sign-in screen in isolation).
   * DataService keeps this hook so it can trigger a session restore on boot.
   */
  private get api(): LulaApi {
    return this.injectedApi;
  }

  private restored = false;

  attachApi(_api?: LulaApi): void {
    if (this.restored) return;
    this.restored = true;
    void this.restore();
  }

  private accounts(): StoredAccount[] {
    return this.store.get<StoredAccount[]>('accounts', []);
  }

  private hash(s: string): string {
    // NOT a security boundary - mock mode only. Firebase Auth handles real credentials.
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  private async restore(): Promise<void> {
    const userId = this.store.get<string | null>('session', null);
    if (userId) {
      const u = await this.api.user(userId);
      if (u) this.user.set(u);
      else this.store.remove('session');
    }
    this.ready.set(true);
  }

  /** Public browsing is allowed; this is the profile shown when signed out. */
  get viewerId(): string | null {
    return this.user()?.id ?? null;
  }

  /* --------------------------- email OTP --------------------------- */

  /** email -> { code, expiresAt } for the code currently on screen. */
  private otps(): Record<string, { code: string; expiresAt: number }> {
    return this.store.get<Record<string, { code: string; expiresAt: number }>>('otps', {});
  }

  private saveOtps(m: Record<string, { code: string; expiresAt: number }>): void {
    this.store.set('otps', m);
  }

  /**
   * Send a six-digit code to the address.
   *
   * In demo mode there is no mail server, so the code is returned and shown on
   * screen. With Firebase this becomes an email link or a Firebase custom-claim
   * OTP and the returned value is ignored.
   */
  async requestOtp(email: string): Promise<{ sentTo: string; demoCode: string }> {
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) throw new Error('Enter a valid email address first');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const all = this.otps();
    all[em] = { code, expiresAt: Date.now() + 10 * 60 * 1000 };
    this.saveOtps(all);
    return { sentTo: em, demoCode: code };
  }

  /** True when a valid, unexpired code has been entered for this address. */
  verifyOtp(email: string, code: string): boolean {
    const em = email.trim().toLowerCase();
    const rec = this.otps()[em];
    if (!rec) return false;
    if (rec.expiresAt < Date.now()) return false;
    return rec.code === String(code).trim();
  }

  /** Seconds left on the current code, or 0. */
  otpSecondsLeft(email: string): number {
    const rec = this.otps()[email.trim().toLowerCase()];
    if (!rec) return 0;
    return Math.max(0, Math.round((rec.expiresAt - Date.now()) / 1000));
  }

  /** A code that has been used once cannot be replayed. */
  private consumeOtp(email: string): void {
    const all = this.otps();
    delete all[email.trim().toLowerCase()];
    this.saveOtps(all);
  }

  async signUp(p: SignUpPayload): Promise<UserProfile> {
    const email = p.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid email address');

    // Check the duplicate first - telling someone their email is already
    // registered matters more than any other field-level nit.
    const existing = await this.api.users();
    if (existing.some((u) => u.email.toLowerCase() === email)) {
      throw new Error('An account already exists with that email. Try signing in.');
    }

    // The second name is the surname, and that surname is the username.
    // A surname typed in a separate field is ignored — the full name is the source.
    const parsed = parseFullName(p.displayName);
    if (!parsed) throw new Error('Enter your first name and surname');
    if (!p.provider && p.password.length < 8) throw new Error('Password must be at least 8 characters');
    if (!p.provider && p.otpVerified !== true) throw new Error('Enter the code we emailed you');
    if (!p.over18) throw new Error('You must be 18 or older to use LulaFind');
    if (!p.acceptedTerms) throw new Error('Accept the terms before you continue');

    const handle = nextHandle(parsed.username, existing.map((u) => u.handle));
    const id = uid('u');
    const profile: UserProfile = {
      id,
      email,
      displayName: parsed.full,
      handle,
      avatarHue: hueOf(parsed.full),
      bio: '',
      province: p.province,
      town: p.town.trim(),
      surname: parsed.surname,
      createdAt: Date.now(),
      verified: false,
      anonymous: false,
      findableProfile: true,
      safetyBeacon: false,
      lastBeaconAt: null,
      followers: 0,
      following: 0,
      karma: 0,
      contributorCredits: 0,
      onboarded: false,
      blockedUserIds: [],
      spotlightIds: [],
      isAdmin: false,
      suspended: false,
      privacy: defaultPrivacy(),
      checkIn: null
    };
    await this.api.saveUser(profile);

    if (!p.provider) {
      this.consumeOtp(email);
      const accs = this.accounts();
      accs.push({ email, secret: this.hash(p.password), userId: id });
      this.store.set('accounts', accs);
    }
    this.store.set('session', id);
    this.user.set(profile);
    return profile;
  }

  async signIn(email: string, password: string): Promise<UserProfile> {
    const em = email.trim().toLowerCase();
    if (!em) throw new Error('Enter your email');
    if (!password) throw new Error('Enter your password');
    const acc = this.accounts().find((a) => a.email === em);
    if (!acc) throw new Error('No LulaFind account with that email');
    if (acc.secret !== this.hash(password)) throw new Error('Incorrect password');
    const u = await this.api.user(acc.userId);
    if (!u) throw new Error('Account data is missing - contact support');
    this.store.set('session', acc.userId);
    this.user.set(u);
    return u;
  }

  /**
   * Google and Apple sign-in. Both providers go through exactly the same path:
   * existing email -> straight in; new email -> the sign-up form with the name,
   * email and avatar already filled in, so the person still confirms they are
   * 18+, accepts the terms and picks a province.
   *
   * Mock mode resolves the provider locally so the flow is testable without a
   * Google or Apple developer account. In Firebase mode replace `resolveProvider`
   * with signInWithPopup(auth, new GoogleAuthProvider()) / OAuthProvider('apple.com')
   * and return the same shape - nothing else in the app changes.
   */
  async signInWithProvider(provider: AuthProvider): Promise<UserProfile> {
    const info = await this.resolveProvider(provider);
    const existing = await this.api.users();
    const found = existing.find((u) => u.email.toLowerCase() === info.email.toLowerCase());
    if (found) {
      this.store.set('session', found.id);
      this.user.set(found);
      return found;
    }
    // Hand the details to the form instead of creating a half-empty account.
    this.pendingProvider.set({ provider, ...info });
    throw new Error('NEW_ACCOUNT');
  }

  /** Set while the sign-up form is waiting for a Google / Apple account to finish. */
  readonly pendingProvider = signal<{ provider: AuthProvider; displayName: string; email: string; surname: string } | null>(null);

  clearPendingProvider(): void {
    this.pendingProvider.set(null);
  }

  private async resolveProvider(provider: AuthProvider): Promise<{ displayName: string; email: string; surname: string }> {
    // Mock mode stand-ins. Swap for the real OAuth call in Firebase mode.
    return provider === 'google'
      ? { displayName: 'Google User', email: 'google.user@gmail.com', surname: '' }
      : { displayName: 'Apple User', email: 'apple.user@icloud.com', surname: '' };
  }

  /** Finish a provider sign-up once the form is filled in. */
  async finishProviderSignUp(p: SignUpPayload): Promise<UserProfile> {
    this.clearPendingProvider();
    return this.signUp(p);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const em = email.trim().toLowerCase();
    if (!this.accounts().some((a) => a.email === em)) throw new Error('No LulaFind account with that email');
    // Mock mode: nothing to send. Firebase mode: sendPasswordResetEmail(auth, em).
  }

  /** Demo account lets reviewers (and Play Store testers) in instantly. */
  async signInDemo(): Promise<UserProfile> {
    const u = await this.api.user('u_demo');
    if (!u) throw new Error('Demo data missing - reset app data from Settings');
    this.store.set('session', u.id);
    this.user.set(u);
    return u;
  }

  async signOut(): Promise<void> {
    this.store.remove('session');
    this.user.set(null);
    await this.router.navigate(['/auth']);
  }

  /** Keep the signed-in copy in step when another flow saves this person. */
  syncUser(u: UserProfile): void {
    if (this.user()?.id === u.id) this.user.set(u);
  }

  /**
   * Rebuild surname and username from the full name. The username field itself
   * is never typed. An unchanged second name keeps the current username, so
   * saving a town or a bio does not rename anyone.
   */
  async renameFromFullName(fullName: string): Promise<UserProfile> {
    if (!this.user()) throw new Error('Not signed in');
    const parsed = parseFullName(fullName);
    if (!parsed) throw new Error('Enter your first name and surname');
    const current = this.user()!;
    const taken = (await this.api.users()).map((u) => u.handle);
    const sameSurname = slugSurname(current.surname) === parsed.username;
    const handle = sameSurname ? current.handle : nextHandle(parsed.username, taken);
    return this.updateProfile({
      displayName: parsed.full,
      surname: parsed.surname,
      handle,
      avatarHue: hueOf(parsed.full)
    });
  }

  /**
   * What the locked username row shows while the person types.
   * Same rules as sign-up, so the preview is the username they will get.
   */
  previewHandle(fullName: string, taken: string[], keepHandle = '', keepSurname = ''): string {
    const parsed = parseFullName(fullName);
    if (!parsed) return '';
    if (keepHandle && slugSurname(keepSurname) === parsed.username) return keepHandle;
    return nextHandle(parsed.username, taken, keepHandle);
  }

  async updateProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
    if (!this.user()) throw new Error('Not signed in');
    const next: UserProfile = { ...this.user()!, ...patch };
    await this.api.saveUser(next);
    this.user.set(next);
    return next;
  }

  async completeOnboarding(patch: Partial<UserProfile>): Promise<UserProfile> {
    return this.updateProfile({ ...patch, onboarded: true });
  }

  /** Hard delete - required by Play Store & App Store account-deletion rules. */
  async deleteAccount(): Promise<void> {
    if (!this.user()) return;
    const id = this.user()!.id;
    await this.api.deleteUser(id);
    this.store.set('accounts', this.accounts().filter((a) => a.userId !== id));
    this.store.remove('session');
    this.user.set(null);
    await this.router.navigate(['/auth']);
  }

  /** "Findable" toggle: whether LulaFind may contact you if you match a case. */
  async setFindable(value: boolean): Promise<void> {
    await this.updateProfile({ findableProfile: value });
  }

  /**
   * Username from a surname slug. Kept for callers that already have the slug.
   * Sign-up uses the second name of the full name, not a handle the person types.
   */
  async uniqueHandle(surnameOrSlug: string, taken: string[]): Promise<string> {
    const base = slugSurname(surnameOrSlug) || 'lulafinder';
    return nextHandle(base.length < 2 ? 'lulafinder' : base, taken);
  }

  /** Convenience for template strings. */
  locationLabel(u?: UserProfile | null): string {
    if (!u?.province) return 'South Africa';
    return [u.town, provinceName(u.province)].filter(Boolean).join(' · ');
  }

  get avatarOf(): (name: string) => string {
    return (name: string) => avatar(name);
  }

  get native(): boolean {
    return this.platform.isNative;
  }
}
