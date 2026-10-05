import { Lookout, Post, UserProfile, provinceName } from '../models/types';

/**
 * The case LulaFind publishes when a safety check fails.
 *
 * Two things make this different from a case a family writes:
 *
 *  1. It is built from what we already know about the person - their last
 *     check-in, where they said they were going, the area they named. That is
 *     the last thing anyone knows, so it is the last-seen line on the case.
 *  2. The person it is about can end it. They tap "I'm here" and the post is
 *     deleted, so nobody is left flagged after they turn up safe.
 *
 * It is built here, once, so the phone database, Firestore and the Postgres
 * function all publish the same shape.
 */
export function lookoutCasePost(lookout: Lookout, owner: UserProfile, existing: Post[] = []): Post {
  const now = Date.now();
  /* The id is stable, so a retry can never publish two cases for one lookout. */
  void existing;
  const name = owner.displayName || 'Member';
  const where = lookout.location && owner.town
    ? `${owner.town}, ${provinceName(owner.province ?? undefined)}`
    : owner.town || 'Unknown';

  return {
    id: `p_lookout_${lookout.id}`,
    type: 'missing',
    status: 'active',
    danger: null,
    authorId: owner.id,
    anonymous: false,
    askWanted: false,
    title: `Have you seen ${name}? They may be missing`,
    body:
      `LulaFind asked ${lookout.askedIds.length || 'the'} followers to check on ${name} ` +
      `${LOOKOUT_ASKED_AGO} and someone said something is wrong.\n\n` +
      (lookout.note ? `${owner.displayName} wrote: "${lookout.note}"\n\n` : '') +
      `If you see ${name}, do not approach. Call 10111.`,
    media: [],
    province: owner.province ?? 'GP',
    town: owner.town ?? '',
    lastSeenAt: lookout.location ? lookout.locationAt ?? now : lookout.startedAt,
    lastSeenWhere: lookout.area || where,
    geo: lookout.location,
    contactLabel: 'Message on LulaFind',
    contactValue: '',
    contactVisibleTo: 'everyone',
    caseNumber: null,
    plan: null,
    reward: null,
    createdAt: now,
    updatedAt: now,
    audience: owner.privacy?.safetyAlertAudience ?? 'followers',
    spotlightId: owner.privacy?.safetyAlertAudience === 'surname' ? owner.privacy.safetyAlertSpotlightId ?? null : null,
    chatEnabled: false,
    allowComments: true,
    allowShare: true,
    upvotes: 0,
    commentCount: 0,
    shares: 0,
    views: 0,
    savedBy: 0,
    voterIds: {},
    escalation: { requested: false, consentGranted: false, consentAt: null, partners: [] },
    consent: [],
    sightingVerified: null,
    searchParty: null,
    lookingIds: [],
    locationCheck: {
      subjectRegisteredInApp: true,
      requestedBy: null,
      requestedAt: null,
      consentFromSubject: 'granted',
      consentAt: now,
      points: lookout.location ? [lookout.location] : [],
      deviceReachable: true,
      lastKnownAt: lookout.locationAt,
      note: 'The person this is about is a member and allowed the app to publish this.'
    },
    khumbu: null,
    outcome: { found: false, foundAt: null, whereaboutsFound: '', closedBy: null, note: '', finderUserId: null, finderName: '' },
    events: [],
    flags: [],
    outcomeNudgeAt: null,
    subject: {
      name,
      age: null,
      gender: 'unknown',
      height: '',
      build: '',
      skinTone: '',
      hair: '',
      eyes: '',
      clothing: '',
      distinguishing: '',
      medical: '',
      vehicle: '',
      languages: '',
      surname: owner.surname,
      relationship: 'LulaFind flagged this'
    },
    appPosted: true,
    lookoutId: lookout.id
  };
}

/** Copy used in the post body - the app cannot say "24 hours ago" in a stored string. */
const LOOKOUT_ASKED_AGO = 'after 24 hours without an all-clear';
