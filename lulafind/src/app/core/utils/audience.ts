import { Post } from '../models/types';

/**
 * Who may read a case, as one rule.
 *
 * The database decides this for the live backend (see
 * supabase/spotlight-public-read.sql) and the app decides it again while
 * filtering a feed that has already been fetched. Those two must agree, or the
 * same case is visible in one place and missing in the other - which is exactly
 * what happened to Spotlight posts: the SQL handed them over to everyone, and
 * the app then threw them away because the viewer had not joined the community.
 *
 *   public      anyone at all, signed in or not
 *   followers   people the author has accepted as followers
 *   surname     anyone - a Spotlight page is public reading, and joining is
 *               only what allows *posting* to it
 *
 * The author always reads their own case.
 */
export interface ViewerAccess {
  /** Who is looking, or null for a signed-out visitor. */
  viewerId: string | null;
  /** Authors whose followers-only cases this viewer may read. */
  following: ReadonlySet<string>;
}

export function canReadPostAudience(post: Post, access: ViewerAccess): boolean {
  if (post.authorId === access.viewerId) return true;
  switch (post.audience) {
    case 'public':
      return true;
    case 'followers':
      return access.following.has(post.authorId);
    case 'surname':
      // Public reading. A row with no Spotlight id is broken rather than
      // private, and it is left to the caller to decide what to do with it.
      return true;
    default:
      // An audience this build does not know about: refuse rather than guess.
      return false;
  }
}
