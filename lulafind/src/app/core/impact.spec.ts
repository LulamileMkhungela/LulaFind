import { describe, expect, it } from 'vitest';
import {
  BADGES, IMPACT_RULES, LEVELS, emptyImpact, earnedBadges, impactOf, impactPoints, levelFor, nextLevel,
  nextStep, pointsOf, progressFor
} from './models/impact';
import { UserProfile } from './models/types';

/**
 * The rules that keep gamification honest.
 *
 * Two kinds of test live here: the arithmetic a person can check on the
 * /progress screen (so the app never advertises a number it does not pay), and
 * the *boundaries* - what must never become a score.
 */
describe('Impact: levels, badges and the next step', () => {
  it('pays exactly what the progress screen promises', () => {
    // The screen renders IMPACT_RULES; the arithmetic must agree with it.
    const byKey = Object.fromEntries(IMPACT_RULES.map((r) => [r.key, r.points]));
    expect(impactPoints({ signals: 1, searches: 0, posters: 0, communities: 0, care: 0 })).toBe(byKey.signals);
    expect(impactPoints({ signals: 0, searches: 1, posters: 0, communities: 0, care: 0 })).toBe(byKey.searches);
    expect(impactPoints({ signals: 0, searches: 0, posters: 1, communities: 0, care: 0 })).toBe(byKey.posters);
    expect(impactPoints({ signals: 0, searches: 0, posters: 0, communities: 1, care: 0 })).toBe(byKey.communities);
    expect(impactPoints({ signals: 0, searches: 0, posters: 0, communities: 0, care: 1 })).toBe(byKey.care);
    expect(impactPoints({ signals: 2, searches: 1, posters: 3, communities: 1, care: 2 }))
      .toBe(byKey.signals * 2 + byKey.searches + byKey.posters * 3 + byKey.communities + byKey.care * 2);
  });

  it('treats junk as zero instead of NaN', () => {
    expect(impactPoints(emptyImpact())).toBe(0);
    expect(impactPoints(null)).toBe(0);
    const junk = { signals: -5, searches: NaN, posters: Infinity, communities: 1.9, care: undefined as unknown as number };
    expect(impactPoints(junk)).toBe(20); // only screens*1.9 rounds to 1 community
    expect(Number.isFinite(impactPoints(junk))).toBe(true);
    expect(impactOf(undefined)).toEqual(emptyImpact());
    expect(impactOf({ impact: { signals: 2 } } as Partial<UserProfile>))
      .toEqual({ signals: 2, searches: 0, posters: 0, communities: 0, care: 0 });
  });

  it('a named find is worth more than any single act, and is credited once per find', () => {
    const base = { ...emptyImpact(), signals: 9 }; // 45 points of giving
    expect(pointsOf({ contributorCredits: 1, impact: base })).toBeGreaterThan(impactPoints(base));
    expect(pointsOf({ contributorCredits: 2, impact: base }) - pointsOf({ contributorCredits: 1, impact: base })).toBe(50);
    // A family's thanks is the family's own judgement: no tally can fake it.
    expect(pointsOf({ contributorCredits: 0, impact: emptyImpact() })).toBe(0);
  });

  it('levels never go backwards and always land on a defined band', () => {
    let previous = -1;
    for (let p = 0; p <= 1200; p += 7) {
      const level = levelFor(p);
      expect(level.level).toBeGreaterThanOrEqual(1);
      expect(level.level).toBeLessThanOrEqual(LEVELS.length);
      expect(p).toBeGreaterThanOrEqual(level.min);
      expect(level.level).toBeGreaterThanOrEqual(previous);
      previous = level.level;
      const progress = progressFor(p);
      expect(progress.percent).toBeGreaterThanOrEqual(0);
      expect(progress.percent).toBeLessThanOrEqual(100);
    }
    expect(levelFor(0).name).toBe('Neighbour');
    expect(levelFor(LEVELS[LEVELS.length - 1].min).name).toBe(LEVELS[LEVELS.length - 1].name);
    expect(nextLevel(LEVELS[LEVELS.length - 1].min)).toBeNull();
  });

  it('reports the gap to the next level as the exact points still needed', () => {
    const one = progressFor(LEVELS[1].min - 1);
    expect(one.next?.name).toBe(LEVELS[1].name);
    expect(one.toNext).toBe(1);
    const at = progressFor(LEVELS[1].min);
    expect(at.level.name).toBe(LEVELS[1].name);
    expect(at.into).toBe(0);
    const top = progressFor(99999);
    expect(top.next).toBeNull();
    expect(top.percent).toBe(100);
    expect(top.toNext).toBe(0);
  });

  it('earns badges only from the things a person gave', () => {
    const none = earnedBadges(emptyImpact(), { found: 0 });
    expect(none).toEqual([]);
    const walker = earnedBadges({ signals: 0, searches: 5, posters: 0, communities: 0, care: 0 }, { found: 0 });
    expect(walker.map((b) => b.id)).toEqual(expect.arrayContaining(['ground', 'walked']));
    const spotter = earnedBadges({ ...emptyImpact(), signals: 3 }, { found: 0 });
    expect(spotter.map((b) => b.id)).toContain('spotter');
    const finder = earnedBadges(emptyImpact(), { found: 1 });
    expect(finder.map((b) => b.id)).toContain('found-one');
    // Every badge has a plain-language "how", because a locked badge must teach.
    for (const b of BADGES) {
      expect(b.how.length, b.id).toBeGreaterThan(8);
      expect(b.icon.length, b.id).toBeGreaterThan(2);
    }
  });

  it('offers a first step that is honest about a signed-out visitor', () => {
    const guest = nextStep({
      signedIn: false, hasProvince: false, following: 0, stories: 0, mySpotlights: 0, myCases: 0,
      hasCheckIn: false, openSearchFreeArea: 0, myClaimedAreas: 0, postersAvailable: 0, lookoutsToAnswer: 0
    });
    expect(guest.key).toBe('explore');
    expect(guest.points).toBe(0);
  });

  it('puts a person who is needed first, ahead of any tutorial', () => {
    const needed = nextStep({
      signedIn: true, hasProvince: false, following: 0, stories: 0, mySpotlights: 0, myCases: 0,
      hasCheckIn: false, openSearchFreeArea: 0, myClaimedAreas: 0, postersAvailable: 0, lookoutsToAnswer: 1
    });
    expect(needed.key).toBe('answer-lookout');
    // Finishing an area you already claimed beats claiming another one.
    const claimed = nextStep({
      signedIn: true, hasProvince: true, following: 3, stories: 1, mySpotlights: 1, myCases: 2,
      hasCheckIn: true, openSearchFreeArea: 4, myClaimedAreas: 1, postersAvailable: 0, lookoutsToAnswer: 0
    });
    expect(claimed.key).toBe('claim-area');
  });

  it('walks a new member up the same ladder the app shows, and points at a real route each time', () => {
    const base = {
      signedIn: true, hasProvince: false, following: 0, stories: 0, mySpotlights: 0, myCases: 0,
      hasCheckIn: false, openSearchFreeArea: 0, myClaimedAreas: 0, postersAvailable: 0, lookoutsToAnswer: 0
    };
    const seen: string[] = [];
    const craft: typeof base = { ...base };
    for (let i = 0; i < 10; i++) {
      const step = nextStep(craft);
      expect(step.route.startsWith('/'), step.key).toBe(true);
      expect(step.action.length, step.key).toBeGreaterThan(2);
      if (seen.includes(step.key)) break;
      seen.push(step.key);
      if (step.key === 'verify-location') craft.hasProvince = true;
      if (step.key === 'first-follow') craft.following = 2;
      if (step.key === 'join-spotlight') craft.mySpotlights = 1;
      if (step.key === 'first-case') craft.myCases = 1;
      if (step.key === 'poster') craft.postersAvailable = 0;
      if (step.key === 'check-in') craft.hasCheckIn = true;
      if (step.key === 'first-story') craft.stories = 1;
    }
    expect(seen).toEqual([
      'verify-location', 'first-follow', 'join-spotlight', 'first-case', 'check-in', 'first-story', 'stay-safe'
    ]);
  });

  it('never lets a family be the subject of a badge', () => {
    // Guards against a future "post 5 cases" style badge arriving unnoticed.
    const names = BADGES.map((b) => `${b.name} ${b.how}`.toLowerCase()).join(' ');
    for (const banned of ['post more', 'cases posted', 'most cases', 'streak', 'share a case', 'report more']) {
      expect(names, banned).not.toContain(banned);
    }
  });
});
