import { Comment, Post } from '../models/types';

/**
 * Who helped with this case, and how.
 *
 * When a case closes, the family is left holding a search that has to be
 * dismantled - posters to take down, a SAPS 92 to complete, and hours of other
 * people's time to acknowledge. This module feeds that last part, and it is
 * deliberately strict about who counts: a person who said "so sad" is not a
 * contributor, and a case that closes with nobody on it must say so rather than
 * inventing a list.
 */

export type HelpKind = 'looking' | 'area' | 'lead' | 'found';

export interface Helper {
  userId: string;
  /** every way this person helped - one entry per role, in priority order */
  via: HelpKind[];
}

/** Plain language for how someone helped, used in the thank-you note and the list. */
export const HELP_LABEL: Record<HelpKind, string> = {
  looking: 'was out looking',
  area: 'walked a search area',
  lead: 'gave the family a lead',
  found: 'found them'
};

/** One line summarising a helper, e.g. "walked a search area and gave the family a lead". */
export function helpSummary(via: HelpKind[]): string {
  const labels = via.map((k) => HELP_LABEL[k]);
  if (labels.length <= 1) return labels[0] ?? 'helped';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Everyone who gave this case something the family could act on.
 *
 * The finder comes first (if the family named one), then people who walked an
 * area, then leads, then people who marked themselves as looking. The poster
 * themselves is never in the list, and neither is a removed account.
 */
export function helpersOf(post: Post | null | undefined, comments: Comment[] = []): Helper[] {
  if (!post) return [];
  const order: HelpKind[] = ['found', 'area', 'lead', 'looking'];
  const map = new Map<string, Set<HelpKind>>();
  const add = (userId: string | null | undefined, kind: HelpKind): void => {
    if (!userId || userId === post.authorId) return;
    const set = map.get(userId) ?? new Set<HelpKind>();
    set.add(kind);
    map.set(userId, set);
  };

  add(post.outcome?.finderUserId, 'found');
  for (const zone of post.searchParty?.zones ?? []) {
    if (zone.done) add(zone.takenBy, 'area');
  }
  for (const c of comments) {
    if (c.isLead && c.authorId !== post.authorId) add(c.authorId, 'lead');
  }
  for (const id of post.lookingIds ?? []) add(id, 'looking');

  const rank = (k: HelpKind): number => order.indexOf(k);
  return [...map.entries()]
    .map(([userId, set]) => ({ userId, via: [...set].sort((a, b) => rank(a) - rank(b)) }))
    .sort((a, b) => rank(a.via[0]) - rank(b.via[0]) || a.userId.localeCompare(b.userId));
}

/**
 * What a family still owns once the search is over.
 *
 * These are the things that go wrong quietly: a poster still on a taxi-rank wall
 * six months later, or a case still on the police circulation list because
 * nobody completed the SAPS 92. Each one is a checklist item, not a paragraph.
 */
export interface AftercareStep {
  id: 'officer' | 'posters' | 'thanks';
  title: string;
  detail: string;
  /** false when there is nothing to do for this step */
  needed: boolean;
}

export function aftercareSteps(post: Post | null | undefined, helpers: number): AftercareStep[] {
  const caseNumber = post?.caseNumber?.trim();
  const hasPoster = !!post?.poster?.media?.src;
  return [
    {
      id: 'officer',
      title: 'Tell the investigating officer',
      detail: caseNumber
        ? `Complete a SAPS 92 with the officer on ${caseNumber}. That is what takes the case off the police circulation list.`
        : 'Complete a SAPS 92 with the officer handling the case. That is what takes it off the police circulation list.',
      needed: true
    },
    {
      id: 'posters',
      title: 'Take the posters down',
      detail: 'Every poster still up is a stranger at your door. Collect them where you put them up.',
      needed: hasPoster
    },
    {
      id: 'thanks',
      title: helpers > 0 ? `Thank the ${helpers} ${helpers === 1 ? 'person' : 'people'} who helped` : 'Nobody was on this search',
      detail: helpers > 0
        ? 'They get one message from you. It is the reason they will help the next family.'
        : 'You did this on your own, or the record does not show who helped. Either way, nothing is owed.',
      needed: helpers > 0
    }
  ];
}
