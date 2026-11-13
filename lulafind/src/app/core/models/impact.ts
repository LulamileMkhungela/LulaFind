/* ------------------------------------------------------------------ *
 * LulaFind - impact, levels and badges
 *
 * The one rule this file protects: **nothing here is a leaderboard of
 * victims.** A family is never ranked, never scored for a case going
 * missing, and never pushed to post more so they can "level up".
 *
 * What is counted is only what a person chose to give the network:
 * a lead that helped, a search area they walked, a poster they put up,
 * a community they hold together. Sighting data that could locate a
 * child is never part of a public total.
 * ------------------------------------------------------------------ */

import type { Post, UserProfile } from './types';

/** The bucket a `UserProfile.impact` object holds. One bag, six keys. */
export interface ImpactTally {
  signals: number;
  searches: number;
  posters: number;
  communities: number;
  care: number;
}

export const emptyImpact = (): ImpactTally => ({ signals: 0, searches: 0, posters: 0, communities: 0, care: 0 });

/**
 * Everyone who opens LulaFind starts as a Neighbour.
 * The names are chosen so no rank ever sounds like a prize for someone
 * else's worst day. "Helper" is the point of the app; "Guardian" is not
 * a claim of authority.
 */
export interface ImpactLevel {
  level: number;
  name: string;
  min: number;
  /** One line, shown under the badge - what this level means. */
  meaning: string;
}

export const LEVELS: ImpactLevel[] = [
  { level: 1, name: 'Neighbour', min: 0, meaning: 'You are here. That already matters.' },
  { level: 2, name: 'Helper', min: 25, meaning: 'You have given the network something it could use.' },
  { level: 3, name: 'Spotter', min: 80, meaning: 'People have acted on what you noticed.' },
  { level: 4, name: 'Guide', min: 200, meaning: 'You have walked a search, not only watched one.' },
  { level: 5, name: 'Anchor', min: 450, meaning: 'A community keeps its footing because of you.' },
  { level: 6, name: 'Beacon', min: 900, meaning: 'The first person people think of when someone is missing.' }
];

/** Total impact points. Credits are worth more than taps, deliberately. */
export function impactPoints(t: ImpactTally | null | undefined): number {
  if (!t) return 0;
  const n = (v: number | undefined): number => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return n(t.signals) * 5 + n(t.searches) * 15 + n(t.posters) * 10 + n(t.communities) * 20 + n(t.care) * 25;
}

export function levelFor(points: number): ImpactLevel {
  const p = Math.max(0, Math.floor(points || 0));
  let found = LEVELS[0];
  for (const l of LEVELS) if (p >= l.min) found = l;
  return found;
}

/** The next level, or null at the top. */
export function nextLevel(points: number): ImpactLevel | null {
  const current = levelFor(points);
  return LEVELS.find((l) => l.min > current.min) ?? null;
}

export interface Progress {
  level: ImpactLevel;
  next: ImpactLevel | null;
  points: number;
  /** points earned inside the current level */
  into: number;
  /** size of the current level's band */
  span: number;
  /** 0–100, rounded. 100 at the top level. */
  percent: number;
  /** how many more points to the next level, 0 at the top */
  toNext: number;
}

export function progressFor(points: number): Progress {
  const p = Math.max(0, Math.floor(points || 0));
  const level = levelFor(p);
  const next = nextLevel(p);
  if (!next) return { level, next: null, points: p, into: level.min, span: 0, percent: 100, toNext: 0 };
  const into = p - level.min;
  const span = Math.max(1, next.min - level.min);
  return { level, next, points: p, into, span, percent: Math.round((into / span) * 100), toNext: Math.max(0, next.min - p) };
}

/* ------------------------------ badges ------------------------------ */

export type BadgeTone = 'signal' | 'ubuntu' | 'marigold' | 'beacon' | 'ink';

export interface BadgeSpec {
  id: string;
  name: string;
  /** what a person did, in their words */
  how: string;
  /** the rule that earns it, evaluated against the tally + contributor credits */
  test: (t: ImpactTally, extra: BadgeContext) => boolean;
  tone: BadgeTone;
  icon: string;
}

export interface BadgeContext {
  /** `contributorCredits` - times someone was named as the person who found them */
  found: number;
  /** signed up within the last 14 days */
  newHere?: boolean;
  /** has ever posted anything */
  hasPosted?: boolean;
}

export const BADGES: BadgeSpec[] = [
  { id: 'first-step', name: 'First step', how: 'Join LulaFind and help someone look.', tone: 'beacon', icon: 'compass', test: (t, c) => !!(c.hasPosted || impactPoints(t) > 0) },
  { id: 'spotter', name: 'Spotter', how: 'Share 3 leads that the family could use.', tone: 'signal', icon: 'search', test: (t) => t.signals >= 3 },
  { id: 'ground', name: 'On the ground', how: 'Claim and finish a search area.', tone: 'ubuntu', icon: 'map', test: (t) => t.searches >= 1 },
  { id: 'walked', name: 'Walked the route', how: 'Finish 5 search areas.', tone: 'ubuntu', icon: 'target', test: (t) => t.searches >= 5 },
  { id: 'posterman', name: 'Poster in hand', how: 'Put a case poster out where people pass.', tone: 'marigold', icon: 'megaphone', test: (t) => t.posters >= 1 },
  { id: 'lamplight', name: 'Lamplight', how: 'Put out 5 posters for different cases.', tone: 'marigold', icon: 'bulb', test: (t) => t.posters >= 5 },
  { id: 'kinship', name: 'Kinship', how: 'Join a Spotlight and hold it together.', tone: 'beacon', icon: 'users', test: (t) => t.communities >= 1 },
  { id: 'candle', name: 'Candle', how: 'Answer 3 safety checks on people you follow.', tone: 'ink', icon: 'shield', test: (t) => t.care >= 3 },
  { id: 'found-one', name: 'Brought home', how: 'Be named as the person who found someone.', tone: 'ubuntu', icon: 'award', test: (_t, c) => c.found >= 1 },
  { id: 'found-five', name: 'Five home', how: 'Be named as the person who found five people.', tone: 'ubuntu', icon: 'sparkle', test: (_t, c) => c.found >= 5 }
];

/**
 * The badge worth announcing for a tally.
 *
 * "First step" is true the moment anyone does anything, so it would be the
 * announcement for every first award of every kind - telling someone who just
 * put up a poster that they joined LulaFind. When the award is itself a badge,
 * that badge is the news; the welcome is the silent default.
 */
export function announceBadge(fresh: BadgeSpec[]): BadgeSpec | undefined {
  if (!fresh.length) return undefined;
  return fresh.find((b) => b.id !== 'first-step') ?? fresh[0];
}

export function earnedBadges(t: ImpactTally | null | undefined, extra: BadgeContext): BadgeSpec[] {
  const tally = t ?? emptyImpact();
  return BADGES.filter((b) => {
    try {
      return b.test(tally, extra);
    } catch {
      return false;
    }
  });
}

export function badgeById(id: string): BadgeSpec | undefined {
  return BADGES.find((b) => b.id === id);
}

/**
 * Why an action gives the points it does. Kept as one table so the app can
 * say "a finished search area is worth 15" instead of hiding the maths.
 */
export const IMPACT_RULES: { key: keyof ImpactTally; label: string; points: number }[] = [
  { key: 'signals', label: 'A lead the family could use', points: 5 },
  { key: 'posters', label: 'A poster out in public', points: 10 },
  { key: 'searches', label: 'A search area you claimed and finished', points: 15 },
  { key: 'communities', label: 'A Spotlight community joined', points: 20 },
  { key: 'care', label: 'A safety check you answered', points: 25 }
];

/* --------------------------- next best step --------------------------- */

export type NextStepKey =
  | 'verify-location'
  | 'first-follow'
  | 'first-story'
  | 'join-spotlight'
  | 'first-case'
  | 'check-in'
  | 'open-search'
  | 'claim-area'
  | 'poster'
  | 'answer-lookout'
  | 'stay-safe'
  | 'explore';

export interface NextStep {
  key: NextStepKey;
  title: string;
  /** one line, no more */
  body: string;
  icon: string;
  action: string;
  route: string;
  points: number;
}

export interface NextStepInput {
  signedIn: boolean;
  hasProvince: boolean;
  following: number;
  stories: number;
  mySpotlights: number;
  myCases: number;
  hasCheckIn: boolean;
  /** an open search party on one of my cases with a free area */
  openSearchFreeArea: number;
  /** a live search area I personally claimed but have not finished */
  myClaimedAreas: number;
  /** a case I own that has a poster image but has never been shared */
  postersAvailable: number;
  /** a safety check waiting on me */
  lookoutsToAnswer: number;
}

/**
 * One thing to do next, chosen by what a *new* person is missing rather
 * than by what the app would like to sell. Ordering is intentional:
 * a location makes every later step better, and a first look at a real
 * case beats any tutorial.
 */
export function nextStep(input: NextStepInput): NextStep {
  if (!input.signedIn) {
    return {
      key: 'explore', title: 'Look around first', icon: 'compass', action: 'Open the feed',
      body: 'Every public case is readable without an account.', route: '/home', points: 0
    };
  }
  if (input.lookoutsToAnswer > 0) {
    return {
      key: 'answer-lookout', title: 'Someone you follow needs an answer', icon: 'shield', action: 'Answer now',
      body: 'A 24-hour safety check is waiting on you.', route: '/discover', points: 25
    };
  }
  if (input.myClaimedAreas > 0) {
    return {
      key: 'claim-area', title: 'Finish the area you claimed', icon: 'map', action: 'Open the search board',
      body: 'A claimed area tells the family that street is covered.', route: '/home', points: 15
    };
  }
  if (input.openSearchFreeArea > 0) {
    return {
      key: 'open-search', title: 'A search party needs one more pair of eyes', icon: 'target', action: 'See the areas',
      body: 'An area near an active case has nobody on it yet.', route: '/home', points: 15
    };
  }
  if (!input.hasProvince) {
    return {
      key: 'verify-location', title: 'Say which province you are in', icon: 'pin', action: 'Choose a province',
      body: 'Cases near you sort to the top, and alerts know where to go.', route: '/me', points: 0
    };
  }
  if (input.following === 0) {
    return {
      key: 'first-follow', title: 'Follow one person or one case', icon: 'users', action: 'Find someone',
      body: 'Following a case is what makes its updates reach you.', route: '/search', points: 0
    };
  }
  if (input.mySpotlights === 0) {
    return {
      key: 'join-spotlight', title: 'Join your surname Spotlight', icon: 'users', action: 'Open Spotlights',
      body: 'A surname community already knows the streets around you.', route: '/spotlight', points: 20
    };
  }
  if (input.myCases === 0) {
    return {
      key: 'first-case', title: 'Post your first case or sighting', icon: 'plus', action: 'Create a post',
      body: 'A sighting is as useful as a case: it is how one gets found.', route: '/new', points: 0
    };
  }
  if (input.postersAvailable > 0) {
    return {
      key: 'poster', title: 'Put a poster out in public', icon: 'megaphone', action: 'Make the poster',
      body: 'A taxi rank or clinic wall still reaches people who are not online.', route: '/home', points: 10
    };
  }
  if (!input.hasCheckIn) {
    return {
      key: 'check-in', title: 'Check in once', icon: 'shield', action: 'Check in',
      body: 'Your followers then know where to start looking if you go quiet.', route: '/me', points: 0
    };
  }
  if (input.stories === 0) {
    return {
      key: 'first-story', title: 'Add a 24-hour story', icon: 'image', action: 'Add a story',
      body: 'Stories reach followers without a case being opened.', route: '/create-story', points: 0
    };
  }
  return {
    key: 'stay-safe', title: 'Help someone else find their next step', icon: 'sparkle', action: 'Open the Spotlight',
    body: 'Check who near you has an unanswered case.', route: '/spotlight', points: 0
  };
}

/* --------------------------- read helpers --------------------------- */

/** The tally on a profile, safe for old records that have none. */
export function impactOf(u: Partial<UserProfile> | null | undefined): ImpactTally {
  const raw = (u as { impact?: Partial<ImpactTally> } | null | undefined)?.impact;
  if (!raw) return emptyImpact();
  return {
    signals: Math.max(0, Math.floor(Number(raw.signals) || 0)),
    searches: Math.max(0, Math.floor(Number(raw.searches) || 0)),
    posters: Math.max(0, Math.floor(Number(raw.posters) || 0)),
    communities: Math.max(0, Math.floor(Number(raw.communities) || 0)),
    care: Math.max(0, Math.floor(Number(raw.care) || 0))
  };
}

/** Impact points for a profile: the tally plus the credits a family gave. */
export function pointsOf(u: Partial<UserProfile> | null | undefined): number {
  const credits = Math.max(0, Math.floor((u?.contributorCredits ?? 0) as number));
  // A named find is worth 50 - the highest single act there is, and it is the
  // family's own judgement, not the app's.
  return impactPoints(impactOf(u)) + credits * 50;
}

/**
 * True when a case deserves the "momentum" treatment on a card: the family
 * opened a search board, or people are showing up to look. Both are real
 * activity, not a paid boost.
 */
export function hasMomentum(p: Pick<Post, 'searchParty' | 'lookingIds'> | null | undefined): boolean {
  if (!p) return false;
  if (p.searchParty?.open) return true;
  return (p.lookingIds?.length ?? 0) > 0;
}
