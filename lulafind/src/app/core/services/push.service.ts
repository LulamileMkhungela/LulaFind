import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { PlatformService } from './platform.service';
import { LULA_API } from '../data/api';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * PushService — the client half of push notifications, end to end.
 *
 * Android 13+ only shows the POST_NOTIFICATIONS prompt when the app actually
 * asks, and the OS dialog is only half of the story: without
 * `PushNotifications.register()` the device never gets an FCM token, so no
 * server could reach it even with the permission granted. This service owns
 * that half:
 *
 *   1. `init()`     — on app start, silently registers when the permission is
 *                     already granted (token refresh included).
 *   2. `register()` — called right after Settings obtains the permission, so
 *                     "Allow" leads directly to a registered device.
 *
 * The token used to stop there, in Preferences on the phone, which no server
 * can read. It is now also filed against the account in public.push_tokens
 * (supabase/push-tokens.sql), which is what makes the device reachable. The
 * local copy is kept because it is needed to delete the row again on sign-out.
 *
 * Sign-out calls `clearToken()`, which deletes only this device's row - a
 * person signing out on their phone must not silence their tablet.
 *
 * In a browser (or a build without the plugin) every call is a no-op — the
 * web app has no FCM, and an APK packaged without `cap sync` must not crash
 * here; the PermissionsService already reports that case honestly.
 */
const TOKEN_KEY = 'lulafind.push.token';

/** Stamped on every token row so the send side can drop ancient installs. */
const APP_VERSION = environment.appVersion;

@Injectable({ providedIn: 'root' })
export class PushService {
  private platform = inject(PlatformService);
  private api = inject(LULA_API);
  private auth = inject(AuthService);
  private router = inject(Router);

  /**
   * Mirror of what Preferences holds, so the sign-in effect below can read the
   * token without an await. Preferences is async; a signal read inside an
   * effect has to be synchronous.
   */
  private stored: string | null = null;

  /** FCM token for this device, when one was issued. */
  readonly token = signal<string | null>(null);
  /** Something went wrong registering - shown once in Settings, not as a crash. */
  readonly registrationError = signal<string | null>(null);
  /** True once this device holds a valid FCM registration. */
  readonly registered = signal(false);
  /** Title of the last push that arrived while the app was in the foreground. */
  readonly lastReceived = signal<string | null>(null);

  private listenersBound = false;

  constructor() {
    // Sign-in is the moment a token finally has an account to belong to.
    //
    // Cold start usually registers the device before the session is restored,
    // so fileToken() runs with no identity and the write is refused. Watching
    // signedIn() rather than adding a call to each of the four sign-in paths
    // (email, Google, demo, restored session) means none of them can forget,
    // and none of them has to know push exists.
    effect(() => {
      if (!this.auth.signedIn()) return;
      const token = untracked(() => this.stored ?? this.token());
      if (token) untracked(() => void this.fileToken(token));
    });
  }

  /** Called once at app start (native only). Registers when already allowed. */
  async init(): Promise<void> {
    await this.adoptStoredToken();
    if (!this.platform.isNative || !this.platform.hasPlugin('PushNotifications')) return;
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const status = await PushNotifications.checkPermissions();
      if (status.receive !== 'granted') return;
      await this.bind(PushNotifications);
      PushNotifications.register();
    } catch {
      /* no plugin half in this build - Settings reports permission state honestly */
    }
  }

  /**
   * Ask for the OS permission and register for pushes when it is granted.
   * Returns true only when the device ends up permitted AND registered.
   */
  async requestAndRegister(): Promise<boolean> {
    this.registrationError.set(null);
    if (!this.platform.isNative || !this.platform.hasPlugin('PushNotifications')) return false;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    try {
      const status = await PushNotifications.requestPermissions();
      if (status.receive !== 'granted') return false;
      await this.bind(PushNotifications);
      PushNotifications.register();
      return true;
    } catch (e: unknown) {
      this.registrationError.set(e instanceof Error ? e.message : 'Could not register for notifications.');
      return false;
    }
  }

  /**
   * Sign-out. Drops this device's row in public.push_tokens as well as the
   * local copy, so the account stops receiving pushes on this phone.
   *
   * The server row is what matters: leaving it behind means a signed-out device
   * keeps getting notifications for an account it can no longer see, and the
   * row outlives the app being uninstalled. Deleting it is best-effort - if the
   * call fails (offline, signed out already) the local copy still goes, and a
   * stale row expires on its own once FCM reports the token dead.
   */
  async clearToken(): Promise<void> {
    const gone = this.token() ?? this.stored;
    this.stored = null;
    this.token.set(null);
    this.registered.set(false);
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key: TOKEN_KEY });
    } catch { /* storage unavailable - the in-memory copy is gone, which is what matters */ }
    if (gone) {
      try {
        await this.api.forgetPushToken(gone);
      } catch { /* offline or already signed out - the row will age out */ }
    }
  }

  private async bind(plugin: typeof import('@capacitor/push-notifications').PushNotifications): Promise<void> {
    if (this.listenersBound) return;
    this.listenersBound = true;
    plugin.addListener('registration', (t) => {
      this.token.set(t.value);
      this.registered.set(true);
      this.registrationError.set(null);
      this.stored = t.value;
      void Preferences.set({ key: TOKEN_KEY, value: t.value }).catch(() => undefined);
      // The whole point: without this the token only ever exists on the phone.
      void this.fileToken(t.value);
    });
    plugin.addListener('registrationError', (e) => {
      this.registered.set(false);
      this.registrationError.set(e?.error ?? 'The phone could not register this device for notifications.');
    });

    // Tapping the tray notification. Until this existed the send side was
    // carefully attaching a `route` to every message and nothing ever read it:
    // a push about a new comment on a post opened the app on whatever screen it
    // happened to be on, so the whole feature was decorative.
    //
    // Capacitor delivers this both when the app is cold-started from the tray
    // and when it is already running in the background, so one listener covers
    // both. `actionId` is 'tap' for a normal press; any other action is ignored
    // rather than mis-navigated.
    plugin.addListener('pushNotificationActionPerformed', (e) => {
      // Capacitor reports the action as `actionId` ('tap' for a plain press)
      // and the payload as `notification.data`. A reply action is a future
      // addition; anything that is not a tap is ignored rather than
      // mis-navigated.
      if (e?.actionId && e.actionId !== 'tap') return;
      this.openFromNotification(e?.notification?.data);
    });

    // Arrived while the app was in the foreground. The OS draws no tray entry
    // in that case, so this is the only place the message is seen at all.
    plugin.addListener('pushNotificationReceived', (n) => {
      this.lastReceived.set(n?.title ?? n?.data?.title ?? null);
    });
  }

  /**
   * Navigate to wherever a tapped notification points.
   *
   * The route comes from the send side (supabase/functions/send-push), which
   * forwards the `route` the app wrote onto the notification row - a post, a
   * profile, a story, the notifications screen. It arrives over the network, so
   * it is validated before it reaches the router: only a rooted path, and never
   * a protocol-relative URL that could be steered at an external origin.
   */
  private openFromNotification(data: unknown): void {
    const route = (data as { route?: unknown } | undefined)?.route;
    if (typeof route !== 'string') return;
    if (!route.startsWith('/') || route.startsWith('//')) return;
    // Signed-out taps land on /auth via the route guards, which is correct:
    // the person is asked to sign in and then arrives on the right screen.
    void this.router.navigateByUrl(route).catch(() => undefined);
  }

  /**
   * Pick up the token a previous run left in Preferences.
   *
   * FCM hands back the same token while it is still valid, so a returning
   * device already has one. Reading it here means the sign-in effect has
   * something to file even when registration has not fired again this launch.
   */
  private async adoptStoredToken(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: TOKEN_KEY });
      this.stored = value ?? null;
      if (value) this.token.set(value);
    } catch { /* no storage - registration will supply one */ }
  }

  /**
   * File a fresh FCM token against the signed-in account.
   *
   * Called on registration and on token refresh, both of which mean FCM has
   * issued a new token the server has never seen. Best-effort on purpose: a
   * failure here must not stop the app starting or make the notification
   * permission look broken, so it surfaces as the same registrationError signal
   * Settings already shows rather than an unhandled rejection.
   *
   * Not signed in yet is the common case at cold start - the token is still
   * kept locally, and sign-in re-files it below.
   */
  private async fileToken(value: string): Promise<void> {
    try {
      await this.api.savePushToken(value, this.platform.kind, APP_VERSION);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not register this device.';
      // "Sign in first" is expected at launch, not something to alarm anyone about.
      if (!/sign in/i.test(message)) this.registrationError.set(message);
    }
  }
}
