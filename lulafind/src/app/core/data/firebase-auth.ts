import { Capacitor } from '@capacitor/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth, GoogleAuthProvider, User, browserLocalPersistence, confirmPasswordReset, createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail, getAuth, indexedDBLocalPersistence, initializeAuth, onIdTokenChanged,
  sendEmailVerification, sendPasswordResetEmail, signInWithCredential, signInWithEmailAndPassword, signInWithPopup,
  signOut, updatePassword, updateProfile, verifyPasswordResetCode
} from 'firebase/auth';
import { environment } from '../../../environments/environment';

/**
 * Firebase Auth for accounts, Supabase for everything else.
 *
 * Firebase signs people in (email + password, Google) and sends the account
 * emails (verify address, reset password) on the free Spark plan. Supabase
 * trusts the Firebase ID token through its Third-Party Auth integration, so
 * every database call carries that token and row security reads the Firebase
 * UID (see supabase/schema.sql -> lula_uid()).
 *
 * The class speaks the small slice of the supabase-js `auth` API that
 * AuthService already used (getSession, signUp, signInWithPassword, ...), and
 * returns users shaped like Supabase users, so the sign-in screens did not
 * need to change.
 */

type AuthUserShape = {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
};

type Listener = (event: string, session: { user: AuthUserShape } | null) => void;

/** Sign-up details kept on this device until the address is verified. */
const PENDING_KEY = 'lulafind.auth.pendingSignup';

export function firebaseAuthConfigured(): boolean {
  const f = (environment as any).firebase ?? {};
  return !!(f.apiKey && f.authDomain && f.projectId);
}

export class FirebaseAuthBridge {
  /** Google on the web is a popup, not a redirect - the caller gets the user back. */
  readonly redirects = false;

  private app: FirebaseApp;
  readonly auth: Auth;
  private listeners = new Set<Listener>();
  private claims: Record<string, unknown> = {};

  constructor() {
    const cfg = (environment as any).firebase;
    this.app = getApps().length ? getApp() : initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      ...(cfg.appId ? { appId: cfg.appId } : {}),
      ...(cfg.messagingSenderId ? { messagingSenderId: cfg.messagingSenderId } : {})
    });
    // In the native shell, IndexedDB is the reliable store; popups are not used there.
    this.auth = Capacitor.isNativePlatform()
      ? initializeAuth(this.app, { persistence: indexedDBLocalPersistence })
      : (() => { const a = getAuth(this.app); void a.setPersistence(browserLocalPersistence); return a; })();

    onIdTokenChanged(this.auth, async (u) => {
      if (u) {
        try { this.claims = (await u.getIdTokenResult()).claims as Record<string, unknown>; } catch { this.claims = {}; }
      } else {
        this.claims = {};
      }
      const event = u ? 'SIGNED_IN' : 'SIGNED_OUT';
      const session = u && u.emailVerified ? { user: this.shape(u) } : null;
      this.listeners.forEach((fn) => fn(session ? event : 'SIGNED_OUT', session));
    });
  }

  /* ----------------------------- tokens ----------------------------- */

  /** The Firebase ID token Supabase verifies. Null when signed out or unverified. */
  async idToken(): Promise<string | null> {
    await this.auth.authStateReady();
    const u = this.auth.currentUser;
    if (!u || !u.emailVerified) return null;
    return u.getIdToken(false);
  }

  /** Firebase UID of the verified, signed-in person. */
  async uid(): Promise<string | null> {
    await this.auth.authStateReady();
    const u = this.auth.currentUser;
    return u && u.emailVerified ? u.uid : null;
  }

  /**
   * Throw away the cached ID token and get a new one.
   *
   * Supabase rejects a stale Firebase token as an unknown caller, which
   * surfaces as a row-level-security error on the write. One forced refresh
   * turns that from a dead end into a retry.
   */
  async forceToken(): Promise<void> {
    await this.auth.authStateReady();
    const u = this.auth.currentUser;
    if (!u) return;
    try { await u.getIdToken(true); } catch { /* the caller's retry reports the real error */ }
  }

  /* ------------------------ supabase-shaped API ------------------------ */

  onAuthStateChange(fn: Listener): { data: { subscription: { unsubscribe: () => void } } } {
    this.listeners.add(fn);
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(fn) } } };
  }

  async getSession(): Promise<{ data: { session: { user: AuthUserShape } | null }; error: null }> {
    await this.auth.authStateReady();
    const u = this.auth.currentUser;
    return { data: { session: u && u.emailVerified ? { user: this.shape(u) } : null }, error: null };
  }

  /**
   * Does an account already exist for this address?
   *
   * Returns `null` when Firebase will not say - "email enumeration protection"
   * hides that from the client, and it must stay that way. The sign-up screen
   * still surfaces Firebase's own `auth/email-already-in-use` the moment the
   * account is created, so a `null` here never means "you may use this email".
   */
  async emailInUse(email: string): Promise<boolean | null> {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return null;
    try {
      const methods = await fetchSignInMethodsForEmail(this.auth, address);
      return methods.length > 0;
    } catch (e) {
      const code = String((e as { code?: string })?.code ?? '');
      // Enumeration protection is on: the answer is deliberately withheld.
      if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return null;
      return null;
    }
  }

  /**
   * Create the account, send Firebase's verification email, then sign out.
   * The profile is written on the first verified sign-in (Supabase only trusts
   * verified addresses), using the details kept here.
   */
  async signUp(input: { email: string; password: string; options?: { emailRedirectTo?: string; data?: Record<string, unknown> } }) {
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, input.email, input.password);
      const name = String(input.options?.data?.['displayName'] ?? '').trim();
      if (name) await updateProfile(cred.user, { displayName: name });
      this.savePending(input.email, input.options?.data ?? {});
      // The account exists from here on. A verification email that fails to
      // send must not report the signup as failed - the person would think they
      // have no account, try again with the same address, and be told it is
      // taken. Send it best-effort and let them request another from /auth.
      await sendEmailVerification(
        cred.user,
        this.continueUrl(input.options?.emailRedirectTo)
      ).catch(() => undefined);
      await signOut(this.auth);
      return { data: { user: this.shape(cred.user), session: null }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: this.friendly(e) };
    }
  }

  async signInWithPassword(input: { email: string; password: string }) {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, input.email, input.password);
      await cred.user.reload();
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user, this.continueUrl()).catch(() => undefined);
        await signOut(this.auth);
        return {
          data: { user: null, session: null },
          error: new Error('Confirm your email first. We have sent a new link to ' + input.email + '.')
        };
      }
      // make sure the token Supabase sees says email_verified = true
      await cred.user.getIdToken(true);
      const user = this.shape(cred.user);
      return { data: { user, session: { user } }, error: null };
    } catch (e) {
      return { data: { user: null, session: null }, error: this.friendly(e) };
    }
  }

  /** Google: native sheet on Android/iOS, popup on the web. */
  async signInWithOAuth(input: { provider: string }) {
    try {
      if (input.provider !== 'google') throw new Error('Only Google sign-in is available.');
      let user: User;
      if (Capacitor.isNativePlatform()) {
        if (!Capacitor.isPluginAvailable('FirebaseAuthentication')) {
          throw new Error(
            'This build of the app is missing the Google sign-in module. ' +
            'Rebuild it with: npm run build && npx cap sync android (the Gradle build now runs this for you), then reinstall.'
          );
        }
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const res = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
        const idToken = res.credential?.idToken;
        if (!idToken) throw new Error('Google did not return an account.');
        user = (await signInWithCredential(this.auth, GoogleAuthProvider.credential(idToken, res.credential?.accessToken))).user;
      } else {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        user = (await signInWithPopup(this.auth, provider)).user;
      }
      await user.getIdToken(true);
      return { data: { user: this.shape(user) }, error: null };
    } catch (e) {
      return { data: { user: null }, error: this.friendly(e) };
    }
  }

  async resetPasswordForEmail(email: string, opts?: { redirectTo?: string }) {
    try {
      await sendPasswordResetEmail(this.auth, email, this.continueUrl(opts?.redirectTo));
      return { error: null };
    } catch (e) {
      const err = this.friendly(e);
      // Never reveal whether an address has an account.
      if (/no account|user-not-found/i.test(err.message)) return { error: null };
      return { error: err };
    }
  }

  /**
   * New password. From a reset email (?mode=resetPassword&oobCode=...) this
   * finishes the reset; when already signed in it changes the password.
   */
  async updateUser(input: { password?: string }) {
    try {
      if (!input.password) return { data: { user: null }, error: null };
      const code = this.resetCode();
      if (code) {
        const email = await verifyPasswordResetCode(this.auth, code);
        await confirmPasswordReset(this.auth, code, input.password);
        this.clearResetCode();
        const cred = await signInWithEmailAndPassword(this.auth, email, input.password);
        return { data: { user: cred.user.emailVerified ? this.shape(cred.user) : null }, error: null };
      }
      const u = this.auth.currentUser;
      if (!u) throw new Error('Open the reset link from your email again.');
      await updatePassword(u, input.password);
      return { data: { user: this.shape(u) }, error: null };
    } catch (e) {
      return { data: { user: null }, error: this.friendly(e) };
    }
  }

  async signOut() {
    try {
      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        await FirebaseAuthentication.signOut().catch(() => undefined);
      }
      await signOut(this.auth);
      return { error: null };
    } catch (e) {
      return { error: this.friendly(e) };
    }
  }

  /** True when the app was opened from a Firebase password-reset email. */
  resetLinkPresent(): boolean {
    return !!this.resetCode();
  }

  /* ------------------------------ helpers ------------------------------ */

  private shape(u: User): AuthUserShape {
    const email = (u.email ?? '').toLowerCase();
    const pending = this.readPending(email);
    const provider = u.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'email';
    const role = String(this.claims['lulafind_role'] ?? '');
    return {
      id: u.uid,
      email: u.email,
      email_confirmed_at: u.emailVerified ? new Date().toISOString() : null,
      user_metadata: {
        ...(pending ?? {}),
        full_name: u.displayName ?? pending?.['displayName'] ?? '',
        name: u.displayName ?? '',
        email: u.email ?? ''
      },
      app_metadata: { provider, ...(role ? { role } : {}) }
    };
  }

  /**
   * The URL Firebase sends the person back to after they act on an account
   * email (verify address, reset password).
   *
   * Firebase refuses the WHOLE request - not just the email - when the continue
   * URL's host is not on the project's Authorised domains list:
   *
   *     auth/unauthorized-continue-uri
   *     Domain not allowlisted by project
   *
   * The host has to be one we can actually know is allowlisted. `localhost` and
   * `127.0.0.1` are there by default, and so is the project's own authDomain
   * (`lulafinds-app.firebaseapp.com`) because Firebase adds it when the project
   * is created. Anything else - the Arena preview host, a custom domain nobody
   * has added yet - is a guess, and a guess here does not degrade gracefully:
   * it takes the signup down with it, after the account has already been
   * created.
   *
   * So an unrecognised host is not sent at all. Omitting the continue URL makes
   * Firebase fall back to its own action page on authDomain, which is always
   * allowed. The person still verifies or resets; they just land on Firebase's
   * page instead of ours.
   */
  private continueUrl(url?: string) {
    // In the app, Firebase's own page confirms the step; the person then returns to LulaFind.
    if (Capacitor.isNativePlatform()) return undefined;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const target = url || `${origin}/auth`;
    if (!/^https?:\/\//.test(target)) return undefined;

    let host: string;
    try {
      host = new URL(target).hostname;
    } catch {
      return undefined;
    }

    const authDomain = (environment.firebase as { authDomain?: string }).authDomain ?? '';
    const allowed =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      (!!authDomain && host === authDomain);

    return allowed ? { url: target, handleCodeInApp: false } : undefined;
  }

  private savePending(email: string, data: Record<string, unknown>): void {
    try {
      const all = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}');
      all[email.trim().toLowerCase()] = { ...data, savedAt: Date.now() };
      localStorage.setItem(PENDING_KEY, JSON.stringify(all));
    } catch { /* private mode - the person fills the details in again after verifying */ }
  }

  private readPending(email: string): Record<string, unknown> | null {
    try {
      const all = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}');
      return all[email] ?? null;
    } catch { return null; }
  }

  private resetCode(): string | null {
    if (typeof window === 'undefined') return null;
    const q = new URLSearchParams(window.location.search);
    return q.get('mode') === 'resetPassword' ? q.get('oobCode') : null;
  }

  private clearResetCode(): void {
    try { history.replaceState(null, '', window.location.pathname + '?mode=signin'); } catch { /* ignore */ }
  }

  private friendly(e: unknown): Error {
    const code = String((e as { code?: string })?.code ?? '');
    const raw = String((e as { message?: string })?.message ?? e ?? '');
    // Capacitor reports a plugin that is missing from the native build as
    // UNIMPLEMENTED / "not implemented". That is a build problem - name the fix.
    if (code === 'UNIMPLEMENTED' || /not implemented|unimplemented/i.test(raw)) {
      return new Error(
        'This build of the app is missing the Google sign-in module. ' +
        'Rebuild it with: npm run build && npx cap sync android (the Gradle build now runs this for you), then reinstall.'
      );
    }
    // The native Google sheet refuses to open when this app's SHA-1 fingerprint
    // is not registered in the Firebase console (GoogleSignIn codes 10 / 12500,
    // surfaced as DEVELOPER_ERROR or an ApiException message).
    if (code === 'DEVELOPER_ERROR' || code === '12500' || code === '10' || /developer error|apiexception/i.test(raw)) {
      return new Error(
        'Google sign-in is not set up for this device yet. In the Firebase console open Project settings → ' +
        'Your apps → the Android app → Add fingerprint (SHA-1), download the new google-services.json into ' +
        'lulafind/android/app/ and rebuild. Try Google sign-in again after reinstalling.'
      );
    }
    const map: Record<string, string> = {
      'auth/email-already-in-use': 'An account already exists with that email. Try logging in.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/weak-password': 'Use a stronger password (at least 8 characters).',
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/wrong-password': 'Incorrect email or password.',
      'auth/user-not-found': 'No account with that email.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
      'auth/network-request-failed': 'No connection. Check your internet and try again.',
      'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
      'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups and try again.',
      'auth/unauthorized-domain': 'This web address is not allowed for sign-in yet. Add it in Firebase → Authentication → Settings → Authorised domains.',
      // Same cause as auth/unauthorized-domain, different code path: Firebase
      // rejects the *continue URL* rather than the page origin. Both mean the
      // host in the address bar is not on the Authorised domains list, and both
      // are fixed the same way - so they must not fall through to the raw
      // "Domain not allowlisted by project", which names no place to go.
      'auth/unauthorized-continue-uri': 'This web address is not allowed for sign-in yet. Add it in Firebase → Authentication → Settings → Authorised domains.',
      'auth/expired-action-code': 'This link has expired. Request a new one.',
      'auth/invalid-action-code': 'This link was already used or is not valid. Request a new one.',
      'auth/requires-recent-login': 'For your safety, log out and log in again, then retry.',
      'auth/operation-not-allowed': 'This sign-in method is switched off in Firebase → Authentication → Sign-in method.'
    };
    const msg = map[code] ?? (e instanceof Error ? e.message.replace(/^Firebase:\s*/, '') : 'Sign-in failed. Try again.');
    return new Error(msg);
  }
}
