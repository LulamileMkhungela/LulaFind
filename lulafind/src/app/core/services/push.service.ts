import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { PlatformService } from './platform.service';

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
 * The token is kept in Preferences under `lulafind.push.token` so a backend
 * can read it per account later; registration errors surface as a signal the
 * Settings screen can show instead of vanishing into the console.
 *
 * In a browser (or a build without the plugin) every call is a no-op — the
 * web app has no FCM, and an APK packaged without `cap sync` must not crash
 * here; the PermissionsService already reports that case honestly.
 */
const TOKEN_KEY = 'lulafind.push.token';

@Injectable({ providedIn: 'root' })
export class PushService {
  private platform = inject(PlatformService);

  /** FCM token for this device, when one was issued. */
  readonly token = signal<string | null>(null);
  /** Something went wrong registering - shown once in Settings, not as a crash. */
  readonly registrationError = signal<string | null>(null);
  /** True once this device holds a valid FCM registration. */
  readonly registered = signal(false);

  private listenersBound = false;

  /** Called once at app start (native only). Registers when already allowed. */
  async init(): Promise<void> {
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

  /** Sign-in/sign-out moments may want to drop the local token. */
  async clearToken(): Promise<void> {
    this.token.set(null);
    this.registered.set(false);
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key: TOKEN_KEY });
    } catch { /* storage unavailable - the in-memory copy is gone, which is what matters */ }
  }

  private async bind(plugin: typeof import('@capacitor/push-notifications').PushNotifications): Promise<void> {
    if (this.listenersBound) return;
    this.listenersBound = true;
    plugin.addListener('registration', (t) => {
      this.token.set(t.value);
      this.registered.set(true);
      this.registrationError.set(null);
      void Preferences.set({ key: TOKEN_KEY, value: t.value }).catch(() => undefined);
    });
    plugin.addListener('registrationError', (e) => {
      this.registered.set(false);
      this.registrationError.set(e?.error ?? 'The phone could not register this device for notifications.');
    });
  }
}
