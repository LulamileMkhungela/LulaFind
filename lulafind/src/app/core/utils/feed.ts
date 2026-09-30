import { Post } from '../models/types';

/** One row of the feed: a post, or a rail slotted in between posts. */
export type FeedSlot = {
  key: string;
  kind: 'post' | 'stories' | 'people';
  post?: Post;
};

/**
 * Interleaves the feed with the two carousels:
 *
 *   post 8   -> Stories
 *   post 16  -> People you may know
 *   post 24  -> Stories
 *   ...
 *
 * Nothing is placed above the first post, and feeds with fewer than `every`
 * posts have no rail. A short feed is not a reason to insert Stories or People
 * near the top; the account profile provides a separate way to create a Story.
 */
export function feedWithRails(posts: Post[], every = 8): FeedSlot[] {
  const out: FeedSlot[] = [];
  posts.forEach((p, i) => {
    out.push({ key: p.id, kind: 'post', post: p });
    const n = i + 1;
    if (every > 0 && n % every === 0) {
      const slot = n / every;
      out.push({ key: `slot-${slot}`, kind: slot % 2 === 1 ? 'stories' : 'people' });
    }
  });
  return out;
}
