import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { LookoutService } from './services/lookout.service';
import { LOOKOUT_WINDOW_MS, Lookout, UserProfile, defaultPrivacy } from './models/types';
import {
  clearedBySelf, answerBlocker, applyAnswer, hasAnswered, isDue, lastSeenOf, newLookout, waitingOn, withAnswer, withAsked
} from './utils/lookout';
import { lookoutCasePost } from './utils/lookout-case';
import { HOUR } from './utils/format';

/**
 * "Be on the lookout", end to end.
 *
 * These tests run the real rules through the real data layer with real
 * accounts: a person starts a lookout, their followers are asked after 24
 * hours, one "no" flags them - but only if their own settings allow the app to
 * post about them - and the person can say "I'm here" and have the post deleted.
 */

let db: LocalDb;
const svc = <T>(t: any): T => TestBed.inject(t) as T;

function bed(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('lulafind.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* node */ }
  db = new LocalDb(true);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: LULA_API, useValue: new MockApi(db) }]
  });
}

function signInAs(userId: string): void {
  const auth = svc<AuthService>(AuthService);
  const u = db.user(userId);
  if (!u) throw new Error('no such seeded user: ' + userId);
  (auth as unknown as { user: { set(v: unknown): void } }).user.set(u);
}

/** Two real accounts, one following the other. */
async function twoPeople(): Promise<{ subject: UserProfile; follower: UserProfile }> {
  const auth = svc<AuthService>(AuthService);
  const subject = await auth.signUp({
    displayName: 'Nandi Mokoena', email: 'nandi.lookout@example.co.za', password: 'password123',
    surname: 'Mokoena', province: 'GP', town: 'Soweto', over18: true, acceptedTerms: true, otpVerified: true
  });
  const follower = await auth.signUp({
    displayName: 'Sipho Khumalo', email: 'sipho.lookout@example.co.za', password: 'password123',
    surname: 'Khumalo', province: 'GP', town: 'Soweto', over18: true, acceptedTerms: true, otpVerified: true
  });
  db.upsertFollow({
    id: `f_${follower.id}_${subject.id}`, followerId: follower.id, followingId: subject.id,
    status: 'accepted', at: Date.now()
  });
  const data = svc<DataService>(DataService);
  await data.loadStatic();
  return { subject, follower };
}

/** The lookout has reached its 24 hours. */
function age(lookout: Lookout, hours = 25): Lookout {
  const startedAt = Date.now() - hours * HOUR;
  const aged: Lookout = { ...lookout, startedAt, checkAt: startedAt + LOOKOUT_WINDOW_MS };
  db.saveLookout(aged);
  return aged;
}

describe('lookout rules (pure)', () => {
  beforeEach(bed);

  it('asks the followers exactly when the 24 hours are up', () => {
    const l = newLookout('u_a', { area: 'Taxi rank' }, 1_000_000);
    expect(l.checkAt - l.startedAt).toBe(LOOKOUT_WINDOW_MS);
    expect(LOOKOUT_WINDOW_MS / HOUR).toBe(24);
    expect(isDue(l, l.checkAt - 1)).toBe(false);
    expect(isDue(l, l.checkAt)).toBe(true);
    expect(isDue({ ...l, status: 'checking' }, l.checkAt + 1000)).toBe(false);
  });

  it('closes only when every asked follower has said yes', () => {
    const asked = withAsked(newLookout('u_a', { area: 'Taxi rank' }), ['u_b', 'u_c', 'u_d']);
    const first = withAnswer(asked, 'u_b', true);
    expect(first.status).toBe('checking');
    const second = withAnswer(first, 'u_c', true);
    expect(second.status).toBe('checking');
    expect(waitingOn(second)).toEqual(['u_d']);
    const third = withAnswer(second, 'u_d', true);
    expect(third.status).toBe('cleared');
    expect(third.closedReason).toBe('all_ok');
  });

  it('one "no" flags the person even when everyone else said yes', () => {
    let l = withAsked(newLookout('u_a', { area: 'Taxi rank' }), ['u_b', 'u_c', 'u_d']);
    l = withAnswer(l, 'u_b', true);
    l = withAnswer(l, 'u_c', true);
    l = withAnswer(l, 'u_d', false);
    expect(l.status).toBe('escalated');
    expect(applyAnswer(l, 'u_e', true).escalate).toBe(false);
    expect(l.answers.filter((a) => !a.ok).length).toBe(1);
  });

  it('records one answer per follower and never changes it', () => {
    const l = withAnswer(withAsked(newLookout('u_a', { area: 'X' }), ['u_b']), 'u_b', false);
    const again = withAnswer(l, 'u_b', true);
    expect(again.answers.length).toBe(1);
    expect(again.answers[0].ok).toBe(false);
    expect(hasAnswered(again, 'u_b')).toBe(true);
  });

  it('freezes the follower list when the question goes out', () => {
    const l = withAsked(newLookout('u_a', { area: 'X' }), ['u_b', 'u_c']);
    expect(l.status).toBe('checking');
    expect(l.askedIds).toEqual(['u_b', 'u_c']);
    const withNobody = withAsked(newLookout('u_a', { area: 'X' }), []);
    expect(withNobody.status).toBe('active');
    expect(withNobody.askedIds).toEqual([]);
  });

  it('lets the person end it themselves', () => {
    const closed = clearedBySelf(withAsked(newLookout('u_a', { area: 'X' }), ['u_b']), 5_000);
    expect(closed.status).toBe('cleared');
    expect(closed.closedReason).toBe('im_here');
    expect(closed.closedAt).toBe(5_000);
  });
});

describe('last seen, for everyone', () => {
  beforeEach(bed);

  it('shows the time to anybody, and the place only when the person allows it', () => {
    const u: UserProfile = {
      ...db.user('u_pieter')!,
      privacy: { ...defaultPrivacy(), showLastSeen: false }
    };
    const hidden = lastSeenOf(u, null, { canSeePlace: u.privacy.showLastSeen });
    expect(hidden).not.toBeNull();
    expect(hidden!.at).toBe(u.checkIn!.at);
    expect(hidden!.place).toBe('');
    expect(hidden!.placeHidden).toBe(true);

    const shown = lastSeenOf({ ...u, privacy: { ...defaultPrivacy(), showLastSeen: true } }, null, { canSeePlace: true });
    expect(shown!.place).toBe('Bellville, Cape Town');
    expect(shown!.status).toBe('unfamiliar');
  });

  it('uses the lookout start as the last seen when there is no check-in', () => {
    const u = { ...db.user('u_naledi')!, checkIn: null, lastBeaconAt: null } as UserProfile;
    const l = newLookout(u.id, { area: 'Nelspruit' }, 4_242);
    const seen = lastSeenOf(u, l, { canSeePlace: true });
    expect(seen!.at).toBe(4_242);
    expect(seen!.lookout?.area).toBe('Nelspruit');
  });
});

describe('the case the app publishes', () => {
  beforeEach(bed);

  it('is built from the person and the area they named', () => {
    const owner: UserProfile = { ...db.user('u_pieter')!, displayName: 'Pieter van Wyk' };
    const l = withAsked(newLookout(owner.id, { area: 'Bellville station', note: 'Walking home' }, 9_000), ['u_a', 'u_b']);
    const post = lookoutCasePost(l, owner, []);
    expect(post.id).toBe(`p_lookout_${l.id}`);
    expect(post.appPosted).toBe(true);
    expect(post.lookoutId).toBe(l.id);
    expect(post.authorId).toBe(owner.id);
    expect(post.title).toContain('Pieter van Wyk');
    expect(post.lastSeenWhere).toBe('Bellville station');
    expect(post.body).toContain('Walking home');
    expect(post.audience).toBe(owner.privacy.safetyAlertAudience);
  });

  it('goes to the audience the person chose', () => {
    const base = db.user('u_pieter')!;
    const l = newLookout(base.id, { area: 'X' });
    const asPublic = lookoutCasePost(l, { ...base, privacy: { ...defaultPrivacy(), allowSafetyAlertPosts: true, safetyAlertAudience: 'public' } }, []);
    expect(asPublic.audience).toBe('public');
    expect(asPublic.spotlightId).toBeNull();

    const asSpotlight = lookoutCasePost(l, {
      ...base,
      privacy: { ...defaultPrivacy(), allowSafetyAlertPosts: true, safetyAlertAudience: 'surname', safetyAlertSpotlightId: 'sp_ndlela' }
    }, []);
    expect(asSpotlight.audience).toBe('surname');
    expect(asSpotlight.spotlightId).toBe('sp_ndlela');
  });
});

describe('be on the lookout, end to end', () => {
  beforeEach(bed);

  it('tells the followers when someone starts one', async () => {
    const { subject, follower } = await twoPeople();
    signInAs(subject.id);
    const lookouts = svc<LookoutService>(LookoutService);
    const l = await lookouts.start({ area: 'Walking to the Soweto taxi rank', note: 'Should be home by 20:00' });

    expect(l.status).toBe('active');
    expect(l.area).toContain('Soweto');
    const notes = db.notifications(follower.id).filter((n) => n.kind === 'lookout');
    expect(notes.length).toBe(1);
    expect(notes[0].title).toContain('Nandi Mokoena');
    expect(notes[0].route).toBe(`/lookout/${l.id}`);
  });

  it('asks the followers after 24 hours and closes when they all say yes', async () => {
    const { subject, follower } = await twoPeople();
    signInAs(subject.id);
    const lookouts = svc<LookoutService>(LookoutService);
    const started = await lookouts.start({ area: 'Soweto' });
    age(started);
    await svc<DataService>(DataService).loadLookouts();

    /* Loading the lookouts is what runs the 24-hour check. */
    let current = db.lookouts().find((x) => x.id === started.id)!;
    expect(current.status).toBe('checking');
    expect(current.askedIds).toEqual([follower.id]);
    expect(db.notifications(follower.id).some((n) => n.title.startsWith('Is Nandi'))).toBe(true);

    /* And it asks exactly once: a second sync must not ask again. */
    const askedAgain = await lookouts.runDue();
    expect(askedAgain).toBe(0);
    /* One "is she okay?" question, plus the one that announced the lookout. */
    expect(db.notifications(follower.id).filter((n) => n.title.startsWith('Is ')).length).toBe(1);

    signInAs(follower.id);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.answer(started.id, true);
    current = db.lookouts().find((x) => x.id === started.id)!;
    expect(current.status).toBe('cleared');
    expect(current.closedReason).toBe('all_ok');
    /* No case was published, because everybody said they were fine. */
    expect(db.posts().some((p) => p.lookoutId === started.id)).toBe(false);
    expect(current.escalatedPostId).toBeNull();
  });

  it('one "no" flags them, and the app publishes the case itself', async () => {
    const { subject, follower } = await twoPeople();
    db.upsertUser({ ...db.user(subject.id)!, privacy: { ...defaultPrivacy(), allowSafetyAlertPosts: true } });
    signInAs(subject.id);
    const lookouts = svc<LookoutService>(LookoutService);
    const started = await lookouts.start({ area: 'Soweto, near the station' });
    age(started);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.runDue();

    signInAs(follower.id);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.answer(started.id, false);

    const current = db.lookouts().find((x) => x.id === started.id)!;
    expect(current.status).toBe('escalated');
    expect(current.escalatedPostId).toBe(`p_lookout_${started.id}`);
    const post = db.posts().find((p) => p.id === current.escalatedPostId)!;
    expect(post.appPosted).toBe(true);
    expect(post.authorId).toBe(subject.id);
    expect(post.audience).toBe('followers'); // the stored default, not the invalid value above
    expect(post.lastSeenWhere).toContain('Soweto');
  });

  it('never posts a case when the person has not allowed it', async () => {
    const { subject, follower } = await twoPeople();
    expect(db.user(subject.id)!.privacy.allowSafetyAlertPosts).toBe(false);
    signInAs(subject.id);
    const lookouts = svc<LookoutService>(LookoutService);
    const started = await lookouts.start({ area: 'Soweto' });
    age(started);
    await lookouts.runDue();

    signInAs(follower.id);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.answer(started.id, false);

    const current = db.lookouts().find((x) => x.id === started.id)!;
    expect(current.status).toBe('escalated');
    expect(current.escalatedPostId).toBeNull();
    expect(db.posts().some((p) => p.lookoutId === started.id)).toBe(false);
    /* The person is told, and told why there is no case. */
    const told = db.notifications(subject.id).filter((n) => n.kind === 'lookout');
    expect(told.some((n) => n.body.includes('have not allowed'))).toBe(true);
  });

  it('"I\'m here" closes it and deletes the post the app made', async () => {
    const { subject, follower } = await twoPeople();
    db.upsertUser({ ...db.user(subject.id)!, privacy: { ...defaultPrivacy(), allowSafetyAlertPosts: true, safetyAlertAudience: 'public' } });
    signInAs(subject.id);
    const lookouts = svc<LookoutService>(LookoutService);
    const started = await lookouts.start({ area: 'Soweto' });
    age(started);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.runDue();
    signInAs(follower.id);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.answer(started.id, false);
    const postId = db.lookouts().find((x) => x.id === started.id)!.escalatedPostId!;
    expect(db.posts().some((p) => p.id === postId)).toBe(true);

    signInAs(subject.id);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.imHere(started.id);

    const current = db.lookouts().find((x) => x.id === started.id)!;
    expect(current.status).toBe('cleared');
    expect(current.closedReason).toBe('im_here');
    expect(db.posts().some((p) => p.id === postId)).toBe(false);
    /* The check-in the profile shows goes back to safe. */
    expect(db.user(subject.id)!.checkIn!.status).toBe('safe');
  });

  it('refuses an answer from someone who was not asked, and from the person themselves', async () => {
    const { subject, follower } = await twoPeople();
    signInAs(subject.id);
    const lookouts = svc<LookoutService>(LookoutService);
    const started = await lookouts.start({ area: 'Soweto' });
    age(started);
    await svc<DataService>(DataService).loadLookouts();
    await lookouts.runDue();

    /* The person cannot answer their own safety check. */
    await expect(lookouts.answer(started.id, true)).rejects.toThrow();

    /* A stranger cannot answer it either. */
    const stranger = await svc<AuthService>(AuthService).signUp({
      displayName: 'Zanele Dube', email: 'zanele.stranger@example.co.za', password: 'password123',
      surname: 'Dube', province: 'GP', town: 'Soweto', over18: true, acceptedTerms: true, otpVerified: true
    });
    signInAs(stranger.id);
    await svc<DataService>(DataService).loadLookouts();
    await expect(lookouts.answer(started.id, false)).rejects.toThrow();

    /* And the person they follow still has an open lookout. */
    expect(db.lookouts().find((x) => x.id === started.id)!.status).toBe('checking');
    expect(db.lookouts().find((x) => x.id === started.id)!.answers.length).toBe(0);
    expect(follower.id).not.toBe(stranger.id);
  });
});
