import { Lookout, LookoutAnswer, LookoutStatus, LOOKOUT_WINDOW_MS, UserProfile } from '../models/types';

/**
 * The rules of a "be on the lookout", in one place.
 *
 * The same decision runs on a phone with no signal (LocalDb), in a Firestore
 * transaction and in Postgres - so the rules live here as plain functions over
 * plain data, and every backend calls them. If they are ever wrong, they are
 * wrong in one place, and this file is what the tests drive.
 */

export interface LookoutStep {
  /** what the lookout should say after this answer */
  status: LookoutStatus;
  /** the answer, recorded either way */
  answer: LookoutAnswer;
  /** the app must publish a possible-missing-person case */
  escalate: boolean;
  /** the app must report the person safe to the followers */
  clear: boolean;
  closedReason: Lookout['closedReason'];
}

/**
 * What one follower's answer does to the lookout.
 *
 * "No" is never averaged away: one person saying something is wrong is enough,
 * and it takes every asked follower answering to close the lookout as fine -
 * the same rule a search party uses before it stands down.
 */
export function applyAnswer(lookout: Lookout, byUserId: string, ok: boolean, now = Date.now()): LookoutStep {
  const answer: LookoutAnswer = { byUserId, ok, at: now };

  if (!ok) {
    return { status: 'escalated', answer, escalate: true, clear: false, closedReason: 'escalated' };
  }

  // Everyone who was asked must have answered, and all of them said yes.
  const answered = new Set(lookout.answers.filter((a) => a.ok).map((a) => a.byUserId));
  answered.add(byUserId);
  const everyone = lookout.askedIds.length > 0 && lookout.askedIds.every((id) => answered.has(id));

  return everyone
    ? { status: 'cleared', answer, escalate: false, clear: true, closedReason: 'all_ok' }
    : { status: 'checking', answer, escalate: false, clear: false, closedReason: '' };
}

/** The same rules, applied to a lookout and returned as the next lookout. */
export function withAnswer(lookout: Lookout, byUserId: string, ok: boolean, now = Date.now()): Lookout {
  // The first answer stands: a change of heart must not un-flag someone.
  if (hasAnswered(lookout, byUserId)) return lookout;
  const step = applyAnswer(lookout, byUserId, ok, now);
  const answers = [...lookout.answers.filter((a) => a.byUserId !== byUserId), step.answer];
  return {
    ...lookout,
    answers,
    status: step.status,
    closedAt: step.status === 'cleared' || step.status === 'escalated' ? now : lookout.closedAt,
    closedReason: step.closedReason
  };
}

/** Is it time to ask the followers? Once only - `askedAt` records the ask. */
export function isDue(lookout: Lookout, now = Date.now()): boolean {
  return lookout.status === 'active' && !lookout.askedAt && now >= lookout.checkAt;
}

/**
 * Why this person may not answer the safety check, or null when they may.
 *
 * The check is not a poll anyone can vote in: the question goes out to the
 * followers who were following the person when the 24 hours ran out, and their
 * answer is what flags or clears them. This runs on the phone and on the
 * server, so a stale copy of the app cannot let a stranger flag someone.
 */
export function answerBlocker(lookout: Lookout, userId: string | null, _now = Date.now()): string | null {
  if (!userId) return 'Sign in to answer';
  if (lookout.userId === userId) return 'Only the people following you can answer this';
  if (hasAnswered(lookout, userId)) return null; // already answered: no second answer, and no error
  if (lookout.status === 'cleared') return 'That lookout is already closed';
  if (lookout.status === 'escalated') return 'That lookout has already been flagged';
  if (!isDue(lookout) && lookout.askedIds.length === 0) {
    return 'The 24 hours are not up yet, so nobody has been asked';
  }
  if (lookout.askedIds.length && !lookout.askedIds.includes(userId)) {
    return 'You were not asked about this lookout';
  }
  if (!lookout.shareLocation && lookout.status === 'active') {
    return 'The 24 hours are not up yet, so nobody has been asked';
  }
  return null;
}

/** Has anyone already answered? */
export function hasAnswered(lookout: Lookout, userId: string): boolean {
  return lookout.answers.some((a) => a.byUserId === userId);
}

/** The one still to answer, for a follower looking at the page. */
export function waitingOn(lookout: Lookout): string[] {
  return lookout.askedIds.filter((id) => !lookout.answers.some((a) => a.byUserId === id));
}

/** The person ends it themselves - they are here, and any case goes with it. */
export function clearedBySelf(lookout: Lookout, now = Date.now()): Lookout {
  return { ...lookout, status: 'cleared', closedAt: now, closedReason: 'im_here' };
}

/** The owner cancels it without an answer. */
export function clearedByOwner(lookout: Lookout, now = Date.now()): Lookout {
  return { ...lookout, status: 'cleared', closedAt: now, closedReason: 'owner_cancelled' };
}

/**
 * When the question goes out: exactly 24 hours after it started, and the
 * followers asked are the ones following the person at that moment.
 */
export function withAsked(lookout: Lookout, followerIds: string[], now = Date.now()): Lookout {
  return {
    ...lookout,
    status: followerIds.length ? 'checking' : 'active',
    askedIds: followerIds,
    askedAt: lookup_askedAt(lookout, now),
    checkAt: lookout.startedAt + LOOKOUT_WINDOW_MS,
    ...(followerIds.length ? {} : { closedReason: '' as const })
  };
}

/** One ask per lookout: the timestamp already on it, or now. */
function lookup_askedAt(lookout: Lookout, now: number): number {
  return lookout.askedAt ?? now;
}

/** A fresh lookout, started by the person it is about. */
export function newLookout(
  userId: string,
  input: { area: string; note?: string; shareLocation?: boolean; location?: Lookout['location'] | null },
  now = Date.now()
): Lookout {
  return {
    id: `lo_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    area: input.area.trim().slice(0, 120),
    note: (input.note ?? '').trim().slice(0, 200),
    startedAt: now,
    checkAt: now + LOOKOUT_WINDOW_MS,
    shareLocation: input.shareLocation !== false,
    location: input.location ?? null,
    locationAt: input.location ? now : null,
    status: 'active',
    askedIds: [],
    askedAt: null,
    answers: [],
    escalatedPostId: null,
    closedAt: null,
    closedReason: ''
  };
}

/**
 * Last seen, for everyone.
 *
 * This is the trail the user asked for: if a check-in was ever logged, anyone
 * looking at the person can see when they last checked in - and whether that
 * was a "safe" check-in or a call for help. If a person goes missing, that
 * timestamp is the last thing we know, and it is what the case is built from.
 *
 * The time is always visible. The place follows the person's own choice: with
 * `showLastSeen` on (the default) everyone sees the town; an open lookout shows
 * the area the person themselves named.
 */
export interface LastSeen {
  at: number;
  /** 'safe' | 'unfamiliar' | 'need_help' - what they said when they checked in */
  status: string;
  /** shown to everyone unless the person hid their place */
  place: string;
  /** true when the place was withheld by the person's own setting */
  placeHidden: boolean;
  /** an open lookout names where they were going, and they chose to say it */
  lookout: Lookout | null;
}

export function lastSeenOf(
  user: UserProfile | null | undefined,
  lookout: Lookout | null,
  opts: { canSeePlace: boolean }
): LastSeen | null {
  if (!user) return null;
  const candidates: number[] = [];
  if (user.checkIn) candidates.push(user.checkIn.at);
  if (user.lastBeaconAt) candidates.push(user.lastBeaconAt);
  if (lookout) candidates.push(lookout.startedAt);
  if (!candidates.length) return null;

  const at = Math.max(...candidates);
  /*
   * Where they are known to be: the town on their profile, or - when they have
   * not set one - the area they named themselves on the lookout. Saying "place
   * not shared" while their own lookout names the area would be untrue.
   */
  const place = user.town?.trim() || lookout?.area.trim() || '';
  return {
    at,
    status: user.checkIn?.status ?? 'safe',
    place: opts.canSeePlace ? place : '',
    placeHidden: !opts.canSeePlace || !place,
    lookout: lookout ?? null
  };
}
