import { Post } from '../models/types';

/** One row of the feed: a post, or a rail slotted in between posts. */
export type FeedSlot = {
  key: string;
  kind: 'post' | 'stories' | 'people';
  post?: Post;
};

/** How the rails are laid out when a feed is too short to reach the 8th post. */
export interface RailOptions {
  /**
   * Put the story rail at the end of a feed with fewer than `every` posts.
   * A short feed has no 8th post to hang a rail on, and without this there
   * would be no story rail anywhere - so the rail goes after the last post.
   */
  shortRail?: boolean;
}

/**
 * Interleaves the feed with the two carousels:
 *
 *   post 8   -> Stories
 *   post 16  -> People you may know
 *   post 24  -> Stories
 *   ...
 *
 * Nothing is placed above the first post. With `shortRail`, a feed of one to
 * seven posts gets the story rail once, at the end, so the story card is always
 * reachable; a feed that reaches the 8th post uses the normal slots instead and
 * never gets a second story rail.
 */
export function feedWithRails(posts: Post[], every = 8, opts: RailOptions = {}): FeedSlot[] {
  const out: FeedSlot[] = [];
  let spaced = false;
  posts.forEach((p, i) => {
    out.push({ key: p.id, kind: 'post', post: p });
    const n = i + 1;
    if (every > 0 && n % every === 0) {
      spaced = true;
      const slot = n / every;
      out.push({ key: `slot-${slot}`, kind: slot % 2 === 1 ? 'stories' : 'people' });
    }
  });

  if (opts.shortRail && every > 0 && !spaced && posts.length > 0) {
    out.push({ key: 'slot-short', kind: 'stories' });
  }
  return out;
}
