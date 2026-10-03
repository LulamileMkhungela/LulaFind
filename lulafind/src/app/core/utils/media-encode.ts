/**
 * Turning whatever the phone gave us into bytes the backend will accept.
 *
 * A camera roll is not a web form: the file behind "Photo" can be a 12 MB HEIC
 * from an iPhone, a 6 MB PNG screenshot or a GIF. LulaFind's `photos` bucket
 * accepts JPEG/PNG/WebP/GIF up to 5 MB, so an attachment is re-encoded here -
 * decoded, downscaled and JPEG'd, stepping the size down until it fits - instead
 * of being refused at upload time and shown to the person as an error.
 *
 * Every function here is best-effort by design: a browser that cannot decode the
 * image (HEIC in Chrome) gets `null` back, and the caller turns that into one
 * clear sentence. It never throws.
 */

/** Sizes tried in order, largest first. Quality follows the same walk-down. */
const DIMENSIONS = [1600, 1280, 1080, 900, 720, 560];
const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

/**
 * What Storage will actually take. The `photos` bucket is created with a 5 MB
 * ceiling (supabase/schema.sql), so everything above that is refused by the
 * server without saying why; this is the same number with room for the multipart
 * wrapper, and it is what the picker and the encoder both work to.
 */
export const MAX_STORED_BYTES = 4_800_000;

/** The types LulaFind stores without re-encoding them. */
export const STORED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function isStoredImageType(type: string): boolean {
  return STORED_IMAGE_TYPES.includes(type);
}

/** Bytes of a `data:` URL's payload - what a browser would actually upload. */
export function approxBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const payload = dataUrl.slice(comma + 1);
  return dataUrl.includes(';base64') ? Math.floor(payload.length * 0.75) : payload.length;
}

/** `data:image/heic;base64,...` -> `image/heic`. Empty string when it is not a data URL. */
export function mimeOfDataUrl(src: string): string {
  const match = /^data:([^;,]+)/.exec(src);
  return match?.[1]?.toLowerCase() ?? '';
}

/** True when the picture is already small enough and of a type we store. */
export function canUploadAsIs(src: string, maxBytes: number): boolean {
  if (!src.startsWith('data:')) return true;
  const type = mimeOfDataUrl(src);
  return isStoredImageType(type) && approxBytes(src) <= maxBytes;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img.width > 0 && img.height > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function encode(canvas: HTMLCanvasElement, quality: number): string | null {
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/**
 * Re-encode an image until it is both a JPEG and under `maxBytes`.
 *
 * Returns the data URL, or null when the image cannot be read at all (a browser
 * without HEIC decoding, a corrupt file, a headless test environment).
 */
export async function jpegUnder(src: string, maxBytes: number, maxDim = 1600): Promise<string | null> {
  if (src.startsWith('data:') && !src.startsWith('data:image')) return null;
  const img = await loadImage(src);
  if (!img) return null;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return null;
  for (const dim of DIMENSIONS.filter((d) => d <= maxDim || d === DIMENSIONS[DIMENSIONS.length - 1])) {
    const scale = Math.min(1, dim / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    // A JPEG has no alpha: a transparent PNG shot on a dark page must not turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITIES) {
      const out = encode(canvas, quality);
      if (!out) break;
      if (approxBytes(out) <= maxBytes) return out;
    }
  }
  return null;
}

/** `data:` URL -> Blob, without a fetch round-trip through the network stack. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const type = /:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  try {
    if (header.includes(';base64')) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(payload)], { type });
  } catch {
    return null;
  }
}

/**
 * A blob to hand to Storage: the original when its type and size are allowed,
 * a re-encoded JPEG when they are not, `null` when nothing can be made of it.
 */
export async function storableBlob(src: string, kind: 'image' | 'video', maxBytes: number): Promise<{ blob: Blob; reencoded: boolean } | null> {
  const source = src.startsWith('data:') ? dataUrlToBlob(src) : null;
  if (source) {
    if (kind === 'video' || (isStoredImageType(source.type) && source.size <= maxBytes)) {
      return { blob: source, reencoded: false };
    }
  }
  if (kind === 'video') return source ? { blob: source, reencoded: false } : null;
  const jpeg = await jpegUnder(src, maxBytes);
  const blob = jpeg ? dataUrlToBlob(jpeg) : null;
  return blob ? { blob, reencoded: true } : null;
}
