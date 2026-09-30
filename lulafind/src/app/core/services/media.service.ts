import { Injectable, inject, signal } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { MediaItem } from '../models/types';
import { uid } from '../utils/format';
import { PlatformService } from './platform.service';

/**
 * Photo / video capture.
 *
 * Native: @capacitor/camera, but only when that plugin is actually present in
 * the build (`Capacitor.isPluginAvailable('Camera')`). An APK that was shipped
 * before `npx cap sync` registered the plugin answers every call with
 * "Camera plugin is not implemented on android" - that is a build problem, not
 * something the person holding the phone can fix, so we do not throw it at
 * them. We open the phone's own photo picker instead and explain once, in
 * `notice`, that the camera module is missing from this build.
 *
 * Web: <input type=file>, which is the browser's own picker/camera sheet.
 */
@Injectable({ providedIn: 'root' })
export class MediaService {
  private platform = inject(PlatformService);
  readonly busy = signal(false);
  /** Last real error from pickImage / pickVideo, or null. */
  readonly lastError = signal<string | null>(null);
  /**
   * Something the person should know that is not their fault and not an error,
   * e.g. "this build has no camera module, we opened your photos instead".
   */
  readonly notice = signal<string | null>(null);

  /** True when the native camera module is really in this build. */
  get cameraAvailable(): boolean {
    if (!this.platform.isNative) return true; // the browser's own file input
    try {
      return Capacitor.isPluginAvailable('Camera');
    } catch {
      return false;
    }
  }

  async pickImage(opts: { source?: 'camera' | 'gallery' | 'prompt'; quality?: number } = {}): Promise<MediaItem | null> {
    this.busy.set(true);
    this.lastError.set(null);
    this.notice.set(null);
    const source = opts.source ?? 'prompt';
    const fromCamera = source === 'camera';
    try {
      if (this.platform.isNative && this.cameraAvailable) {
        // Ask for the camera first: on Android 6+ the plugin needs the grant,
        // and a denial has to read as a denial, not as "not implemented".
        if (fromCamera) {
          const perm = await Camera.checkPermissions().catch(() => null);
          if (perm && perm.camera !== 'granted') {
            const asked = await Camera.requestPermissions({ permissions: ['camera'] }).catch(() => null);
            if (asked && asked.camera !== 'granted') {
              this.notice.set('Camera access is off. Your phone’s photo chooser will open instead.');
              return await this.pickViaInput('image/*', false);
            }
          }
        }
        try {
          const photo = await Camera.getPhoto({
            quality: opts.quality ?? 78,
            allowEditing: false,
            resultType: CameraResultType.DataUrl,
            source: source === 'camera' ? CameraSource.Camera : source === 'gallery' ? CameraSource.Photos : CameraSource.Prompt,
            correctOrientation: true,
            width: 1400
          });
          if (!photo.dataUrl) return null;
          return { id: uid('m'), kind: 'image', src: photo.dataUrl };
        } catch (e: unknown) {
          if (MediaService.cancelled(e)) return null;
          this.notice.set(MediaService.pluginMissing(e)
            ? 'This build has no camera module. Your phone’s own photo chooser will open instead.'
            : 'The camera did not open. Your phone’s photo chooser will open instead.');
          return await this.pickViaInput('image/*', false);
        }
      }
      if (fromCamera && this.platform.isNative && !this.cameraAvailable) {
        this.notice.set('This build has no camera module. Your phone’s own photo chooser will open instead.');
      }
      return await this.pickViaInput('image/*', false);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? '').toLowerCase();
      if (msg.includes('cancel') || msg.includes('no image picked') || msg.includes('user denied')) {
        if (msg.includes('denied')) this.lastError.set('Camera or photo access was turned off. Allow it in your phone settings, then try again.');
        return null;
      }
      this.lastError.set((e as Error)?.message ?? 'Could not pick image');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async pickVideo(): Promise<MediaItem | null> {
    this.busy.set(true);
    this.lastError.set(null);
    this.notice.set(null);
    try {
      return await this.pickViaInput('video/*');
    } catch (e: unknown) {
      if (!String((e as Error)?.message ?? '').toLowerCase().includes('cancel')) {
        this.lastError.set((e as Error)?.message ?? 'Could not pick video');
      }
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private static cancelled(e: unknown): boolean {
    const msg = String((e as Error)?.message ?? e ?? '').toLowerCase();
    return msg.includes('cancel') || msg.includes('no image picked') || msg.includes('user cancelled');
  }

  /** "Camera plugin is not implemented on android" and its cousins. */
  private static pluginMissing(e: unknown): boolean {
    const err = e as { code?: string; message?: string } | null;
    const msg = String(err?.message ?? e ?? '').toLowerCase();
    return err?.code === 'UNIMPLEMENTED' || msg.includes('not implemented') || msg.includes('unimplemented') || msg.includes('not available');
  }

  private pickViaInput(accept = 'image/*', capture = false): Promise<MediaItem | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (capture) input.setAttribute('capture', 'environment');
      input.style.display = 'none';
      let settled = false;
      const finish = (item: MediaItem | null): void => {
        if (settled) return;
        settled = true;
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancel);
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(item);
      };
      const onCancel = (): void => finish(null);
      const onFocus = (): void => {
        // Some Android WebViews return from the system chooser without firing
        // either `cancel` or `change`. Resolve that path instead of leaving the
        // photo button permanently busy.
        window.setTimeout(() => { if (!input.files?.length) finish(null); }, 700);
      };
      const onChange = (): void => {
        const file = input.files?.[0];
        if (!file) { finish(null); return; }
        const reader = new FileReader();
        reader.onload = () => finish({
          id: uid('m'),
          kind: file.type.startsWith('video') ? 'video' : 'image',
          src: String(reader.result)
        });
        reader.onerror = () => finish(null);
        reader.readAsDataURL(file);
      };
      input.addEventListener('change', onChange, { once: true });
      // Browsers that support it fire `cancel` when the chooser is dismissed.
      // Without this, the busy flag stayed on forever after a cancelled pick.
      input.addEventListener('cancel', onCancel, { once: true });
      window.addEventListener('focus', onFocus, { once: true });
      document.body.appendChild(input);
      try { input.click(); } catch { finish(null); }
    });
  }

  /** Downscales a data-uri so localStorage / Firestore documents stay small. */
  async compress(src: string, maxDim = 1200): Promise<string> {
    if (!src.startsWith('data:image')) return src;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }
}
