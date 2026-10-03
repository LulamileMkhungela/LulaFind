/**
 * The size and count rules for anything a person attaches.
 *
 * These are the whole rule, in one place, because the rule is enforced at four
 * separate points - the picker, the composer, the uploader and the storage
 * bucket - and a limit that lives in four places drifts.
 *
 *   photo: 2 MB each
 *   video: 3 MB each
 *   a case (post): up to 3 photos, or one video
 *   a story: one photo
 *
 * A photo can be re-encoded in the browser, so its picker accepts a generous
 * original and `MediaService.compress` guarantees the upload size. A video
 * cannot be re-encoded in a browser, so its picker refuses an over-size file at
 * the moment it is chosen, with a message naming the limit - better than a
 * stall on a large file followed by a refusal.
 */

/** Largest photo that may be uploaded. The composer compresses down to this. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Largest video that may be uploaded. Never re-encoded, so it is capped as-is. */
export const VIDEO_MAX_BYTES = 3 * 1024 * 1024;

/** A case can show three photos. */
export const POST_MAX_PHOTOS = 3;

/** A story is a single photo. */
export const STORY_MAX_PHOTOS = 1;

/**
 * What the *picker* accepts for a photo. A modern phone camera writes 5-12 MB
 * files that compress to a few hundred KB, so refusing them at the picker would
 * reject almost every real photo. Only the absurd is refused here; the 2 MB
 * rule is applied to the compressed result.
 */
export const PICK_MAX_BYTES = 25 * 1024 * 1024;

/** Bytes in a whole number of MB, for messages a person reads. */
export function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
