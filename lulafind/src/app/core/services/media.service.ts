import { Injectable, inject, signal } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { PHOTO_MAX_BYTES, PICK_MAX_BYTES, VIDEO_MAX_BYTES } from '../models/media-rules';
import { MediaItem } from '../models/types';
import { uid } from '../utils/format';
import { jpegUnder, MAX_STORED_BYTES } from '../utils/media-encode';
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
/**
 * The numbers live in models/media-rules.ts; this service is where they are
 * applied. A photo is downscaled and re-encoded before it is uploaded, so the
 * picker accepts a generous original; a video cannot be re-encoded in a
 * browser, so it is refused at the picker when it is too big, with a message
 * the person can act on rather than a stall on a huge file.
 */
const IMAGE_PICK_MAX_BYTES = PICK_MAX_BYTES;
const VIDEO_PICK_MAX_BYTES = VIDEO_MAX_BYTES;

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
              return await this.pickViaInput('image/*', false, IMAGE_PICK_MAX_BYTES);
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
          return await this.pickViaInput('image/*', false, IMAGE_PICK_MAX_BYTES);
        }
      }
      if (fromCamera && this.platform.isNative && !this.cameraAvailable) {
        this.notice.set('This build has no camera module. Your phone’s own photo chooser will open instead.');
      }
      return await this.pickViaInput('image/*', false, IMAGE_PICK_MAX_BYTES);
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
      return await this.pickViaInput('video/*', false, VIDEO_PICK_MAX_BYTES);
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

  private pickViaInput(accept = 'image/*', capture = false, maxBytes = 0): Promise<MediaItem | null> {
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
        // Refuse a file that is too big before reading it into memory: a 200 MB
        // video would otherwise be turned into a data URL and stall the phone
        // long before the upload had a chance to reject it.
        if (maxBytes && file.size > maxBytes) {
          const size = Math.max(1, Math.round(file.size / (1024 * 1024)));
          const cap = Math.round(maxBytes / (1024 * 1024));
          this.lastError.set(`That file is about ${size} MB. Choose one smaller than ${cap} MB.`);
          finish(null);
          return;
        }
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

  /**
   * Downscales a data-uri and keeps re-encoding until it fits `maxBytes`, by
   * stepping dimensions as well as quality.
   *
   * The old version tried once - 1200px at quality 0.82 - and returned whatever
   * that happened to weigh. Almost always that was far under the limit, but a
   * dense or already-compressed photo could land over it and the person was then
   * told to "choose a photo smaller than 2 MB" from a phone that cannot resize
   * anything. Now the composer guarantees the size, so that message is only ever
   * about a file the picker refused, never about a photo that was accepted.
   */
  async compress(src: string, maxDim = 1200, maxBytes = PHOTO_MAX_BYTES): Promise<string> {
    if (!src.startsWith('data:image')) return src;
    // One encoder does this here, for the poster generator and for the storage edge
    // as well: `jpegUnder` steps the dimensions along with the quality, which a
    // single quality walk cannot do for a very large sensor photo, and three copies
    // of a size loop are three chances to disagree. A picture that cannot be made to
    // fit the product rule is still shrunk to what the bucket holds, so the upload
    // gets its chance; only one this browser cannot decode comes back as it was.
    const fits = await jpegUnder(src, maxBytes, maxDim);
    if (fits) return fits;
    return (await jpegUnder(src, MAX_STORED_BYTES, maxDim)) ?? src;
  }

  /**
   * Exports a canvas within the photo limit, as JPEG.
   *
   * A generated poster is 1080x1350; as a PNG - which is what it used to be -
   * one with a photo in it routinely weighs more than the 2 MB rule, so the
   * poster was refused by the very limit it had to obey. Stepping the quality
   * down keeps every design inside the rule instead of failing at upload.
   */
  async exportCanvas(canvas: HTMLCanvasElement, maxBytes = PHOTO_MAX_BYTES): Promise<Blob | null> {
    let smallest: Blob | null = null;
    for (const quality of [0.92, 0.85, 0.75, 0.62, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => {
        try { canvas.toBlob((b) => resolve(b), 'image/jpeg', quality); } catch { resolve(null); }
      });
      if (!blob) return smallest;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= maxBytes) return blob;
    }
    return smallest;
  }

  /** Bytes inside a data-uri - what the file will weigh once decoded. */
  private static dataUrlBytes(dataUrl: string): number {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return 0;
    return Math.floor((dataUrl.length - comma - 1) * 3 / 4);
  }
}
