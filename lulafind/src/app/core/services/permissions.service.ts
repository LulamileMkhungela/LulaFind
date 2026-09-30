import { Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PlatformService } from './platform.service';

/**
 * The permission kinds the app may request.
 * - notifications : push / local notifications
 * - camera        : take photos for posts and profile
 * - photos        : pick images from the gallery
 * - location      : one-time precise location for sighting geo-tags
 */
export type PermKind = 'notifications' | 'camera' | 'photos' | 'location';

export type PermStatus = 'unknown' | 'denied' | 'granted' | 'prompt' | 'unavailable';

export interface PermRow {
  kind: PermKind;
  label: string;
  why: string;
  status: PermStatus;
  statusLabel: string;
}

const PERM_META: Record<PermKind, { label: string; why: string; plugin: string }> = {
  notifications: {
    label: 'Notifications',
    why: 'Get alerts when someone comments on your post or a new case appears near you.',
    plugin: 'PushNotifications'
  },
  camera: {
    label: 'Camera',
    why: 'Take photos directly when posting a missing person or sighting.',
    plugin: 'Camera'
  },
  photos: {
    label: 'Photos / Gallery',
    why: 'Upload photos from your gallery to posts and your profile.',
    plugin: 'Camera'
  },
  location: {
    label: 'Location',
    why: 'Attach an accurate map pin to sightings. Never used in the background.',
    plugin: 'Geolocation'
  }
};

function statusLabel(s: PermStatus): string {
  switch (s) {
    case 'granted': return 'On';
    case 'denied':  return 'Denied — open phone settings to allow';
    case 'prompt':  return 'Not yet asked';
    case 'unavailable': return 'Not in this build';
    default:        return 'Unknown';
  }
}

/**
 * PermissionsService — a real wrapper around the Capacitor permission APIs.
 *
 * Every call asks whether the plugin is actually in the build first, so an APK
 * that was packaged without a plugin says "Not in this build" instead of
 * throwing "plugin is not implemented on android" at the person using it.
 * In a browser, the same rows are filled from the Permissions API (camera /
 * geolocation / notifications) so the page is honest there too.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private platform = inject(PlatformService);

  private statuses = signal<Record<PermKind, PermStatus>>({
    notifications: 'unknown',
    camera:        'unknown',
    photos:        'unknown',
    location:      'unknown'
  });

  readonly busy = signal(false);

  /** Advisory message shown below the permission list (e.g. after a denial). */
  readonly note = signal<string | null>(null);

  /** All permission rows, ready for the template @for loop. */
  readonly rows = computed((): PermRow[] => {
    const s = this.statuses();
    return (Object.keys(PERM_META) as PermKind[]).map((kind) => ({
      kind,
      label: PERM_META[kind].label,
      why:   PERM_META[kind].why,
      status: s[kind],
      statusLabel: statusLabel(s[kind])
    }));
  });

  private pluginMissing(kind: PermKind): boolean {
    return this.platform.isNative && !this.platform.hasPlugin(PERM_META[kind].plugin);
  }

  /** Re-query the current status for every permission. */
  async refresh(): Promise<void> {
    if (!this.platform.isNative) {
      await this.refreshWeb();
      return;
    }
    const next: Partial<Record<PermKind, PermStatus>> = {};
    for (const kind of Object.keys(PERM_META) as PermKind[]) {
      if (this.pluginMissing(kind)) {
        next[kind] = 'unavailable';
        continue;
      }
      try {
        next[kind] = await this.check(kind);
      } catch {
        next[kind] = 'unknown';
      }
    }
    this.statuses.update((s) => ({ ...s, ...next }));
  }

  private async check(kind: PermKind): Promise<PermStatus> {
    switch (kind) {
      case 'camera':
      case 'photos': {
        const { Camera } = await import('@capacitor/camera');
        const r = await Camera.checkPermissions();
        return kind === 'camera' ? normalize(r.camera) : normalize(r.photos ?? r.camera);
      }
      case 'location': {
        const { Geolocation } = await import('@capacitor/geolocation');
        const r = await Geolocation.checkPermissions();
        return normalize(r.location);
      }
      case 'notifications': {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const r = await PushNotifications.checkPermissions();
        return normalize(r.receive);
      }
      default:
        return 'unknown';
    }
  }

  /** Browsers expose geolocation / notifications / camera through navigator.permissions. */
  private async refreshWeb(): Promise<void> {
    const next: Partial<Record<PermKind, PermStatus>> = {};
    const perms = navigator.permissions;
    if (!perms?.query) return;
    const ask = async (name: PermissionName): Promise<PermStatus | null> => {
      try {
        const res = await perms.query({ name });
        return normalize(res.state);
      } catch {
        return null;
      }
    };
    const geo = await ask('geolocation');
    if (geo) next.location = geo;
    const cam = await ask('camera' as PermissionName);
    if (cam) { next.camera = cam; next.photos = cam; }
    const notif = await ask('notifications' as PermissionName);
    if (notif) next.notifications = notif;
    this.statuses.update((s) => ({ ...s, ...next }));
  }

  /**
   * Request a specific permission from the OS.
   * Returns true when the permission is granted after the request.
   */
  async enable(kind: PermKind): Promise<boolean> {
    this.busy.set(true);
    this.note.set(null);
    try {
      if (this.pluginMissing(kind)) {
        this.statuses.update((s) => ({ ...s, [kind]: 'unavailable' as PermStatus }));
        this.note.set(`${PERM_META[kind].label} is not part of this build of the app. Update the app to use it.`);
        return false;
      }

      let status: PermStatus;
      if (!this.platform.isNative) {
        // In the browser the request happens when the feature is used. Use it
        // once here so the browser's own prompt appears, like on a phone.
        status = await this.requestWeb(kind);
      } else {
        switch (kind) {
          case 'camera': {
            const { Camera } = await import('@capacitor/camera');
            status = normalize((await Camera.requestPermissions({ permissions: ['camera'] })).camera);
            break;
          }
          case 'photos': {
            const { Camera } = await import('@capacitor/camera');
            const r = await Camera.requestPermissions({ permissions: ['photos'] });
            status = normalize(r.photos ?? r.camera);
            break;
          }
          case 'location': {
            const { Geolocation } = await import('@capacitor/geolocation');
            status = normalize((await Geolocation.requestPermissions()).location);
            break;
          }
          case 'notifications': {
            const { PushNotifications } = await import('@capacitor/push-notifications');
            status = normalize((await PushNotifications.requestPermissions()).receive);
            break;
          }
          default:
            status = 'unknown';
        }
      }

      this.statuses.update((s) => ({ ...s, [kind]: status }));
      if (status === 'denied') {
        this.note.set(`${PERM_META[kind].label} was refused. Open your phone settings, find LulaFind and switch it on.`);
      } else if (status === 'prompt') {
        this.note.set(`${PERM_META[kind].label} has not been answered yet. Try again and tap Allow.`);
      }
      return status === 'granted';
    } catch (e: unknown) {
      this.statuses.update((s) => ({ ...s, [kind]: 'denied' as PermStatus }));
      this.note.set(e instanceof Error ? e.message : `Could not enable ${PERM_META[kind].label}.`);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async requestWeb(kind: PermKind): Promise<PermStatus> {
    if (kind === 'location') {
      if (!navigator.geolocation) return 'unavailable';
      return await new Promise<PermStatus>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve('granted'),
          (err) => resolve(err.code === err.PERMISSION_DENIED ? 'denied' : 'prompt'),
          { timeout: 8000 }
        );
      });
    }
    if (kind === 'notifications') {
      if (!('Notification' in window)) return 'unavailable';
      const result = await Notification.requestPermission();
      return result === 'default' ? 'prompt' : normalize(result);
    }
    // camera / photos in a browser are asked for when a photo is chosen
    return await this.checkWeb('camera' as PermissionName) ?? 'prompt';
  }

  private async checkWeb(name: PermissionName): Promise<PermStatus | null> {
    try {
      const res = await navigator.permissions.query({ name });
      return normalize(res.state);
    } catch {
      return null;
    }
  }

  /**
   * Open the OS settings screen for this app so the user can manually toggle
   * a permission that was previously denied. There is no Capacitor core plugin
   * for this, so on a phone we explain what to do instead of pretending.
   */
  async openPhoneSettings(): Promise<boolean> {
    if (!this.platform.isNative) return false;
    this.note.set('Open your phone Settings, choose Apps, find LulaFind and turn the permission on.');
    return false;
  }
}

/** Capacitor and the Permissions API use different words for the same states. */
function normalize(state: string | undefined | null): PermStatus {
  switch (state) {
    case 'granted': return 'granted';
    case 'denied': return 'denied';
    case 'prompt':
    case 'prompt-with-rationale': return 'prompt';
    default: return Capacitor.isNativePlatform() ? 'unavailable' : 'unknown';
  }
}
