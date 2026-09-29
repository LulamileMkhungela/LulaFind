import { Post } from '../models/types';

/** One row of the feed: a post, or a rail slotted in between posts. */
export type FeedSlot = {
  key: string;
  kind: 'post' | 'stories' | 'people';
  post?: Post;
};

/**
 * Interleaves the feed with the two carousels, and nowhere else:
 *
 *   post 8   -> Stories
 *   post 16  -> People you may know
 *   post 24  -> Stories
 *   ...
 *
 * Nothing is placed above the first post and nothing is placed after the last
 * one, so "it appears after every 8th post" always reads true - a feed of four
 * posts simply has no rail in it yet.
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
