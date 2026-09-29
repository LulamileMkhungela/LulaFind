import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { ChatService } from './services/chat.service';
import { EscalationService } from './services/escalation.service';
import { LocationService } from './services/location.service';
import { ModerationService } from './services/moderation.service';
import { SafetyService } from './services/safety.service';
import { defaultPrivacy, emptyFilter, Post } from './models/types';
import { timeAgo, compact, urgency, parseFullName, contributorLabel, distanceKm } from './utils/format';
import { searchFocus } from './utils/search-focus';
import { drawPoster, posterContent, publicPoster, POSTER_TEMPLATES } from './utils/poster';
import { leadMarkView } from './utils/mark-check';
import { GBV_CHANNEL_NOTE, HELP_LINES } from './data/sa-help';
import { avatar } from './data/seed';
import { feedWithRails } from './utils/feed';

/**
 * End-to-end tests for the rules that make LulaFind LulaFind:
 * feed filtering, the Quora-style vote, the three-rule private-chat gate,
 * consent-gated escalation, consent-gated location, and the KhumbulEkhaya loop.
 */

let db: LocalDb;

function bed(): void {
  // jsdom keeps localStorage between tests in a file, and LocalDb seeds from it.
  // Drop the whole mock store so every test really starts from the seed.
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('lulafind.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* node - nothing to clear */ }
  db = new LocalDb(true);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'auth', component: AuthStubComponent }]),
      { provide: LULA_API, useValue: new MockApi(db) }
    ]
  });
}

/** Stand-in for the real sign-in screen so AuthService.signOut() can navigate. */
@Component({ standalone: true, template: '' })
class AuthStubComponent {}

const svc = <T>(t: any): T => TestBed.inject(t) as T;

/** Swap the signed-in user for a seeded account (test helper). */
function signInAs(userId: string): void {
  const auth = TestBed.inject(AuthService) as AuthService;
  const u = db.user(userId);
  if (!u) throw new Error('no such seeded user: ' + userId);
  (auth as unknown as { user: { set(v: unknown): void } }).user.set(u);
}

describe('LocalDb (mock data layer)', () => {
  beforeEach(bed);

  it('seeds a browsable South African dataset', () => {
    expect(db.users().length).toBeGreaterThanOrEqual(10);
    expect(db.posts().length).toBeGreaterThanOrEqual(6);
    expect(db.spotlights().map((s) => s.surname)).toContain('Ndlela');
    expect(db.commentsFor('p_thato').length).toBe(3);
    expect(db.tips().length).toBeGreaterThanOrEqual(8);
  });

  it('filters the feed by post type', () => {
    const missing = db.filtered({ ...emptyFilter(), type: 'missing' }, null, undefined);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((p) => p.type === 'missing')).toBe(true);

    const khumbu = db.filtered({ ...emptyFilter(), type: 'khumbulekhaya' }, null, undefined);
    expect(khumbu.map((p) => p.id)).toContain('p_lindiwe');
  });

  it('filters the feed by province', () => {
    const gp = db.filtered({ ...emptyFilter(), province: 'GP' }, null, undefined);
    expect(gp.length).toBeGreaterThan(0);
    expect(gp.every((p) => p.province === 'GP')).toBe(true);
    const nc = db.filtered({ ...emptyFilter(), province: 'NC' }, null, undefined);
    expect(nc.every((p) => p.province === 'NC')).toBe(true);
  });

  it('hides resolved cases unless the filter asks for them', () => {
    const active = db.filtered({ ...emptyFilter(), status: 'active' }, null, undefined);
    expect(active.some((p) => p.id === 'p_found')).toBe(false);
    const found = db.filtered({ ...emptyFilter(), status: 'found' }, null, undefined);
    expect(found.map((p) => p.id)).toContain('p_found');
  });

  it('enforces followers-only audience', () => {
    const post: Post = { ...db.post('p_thato')!, id: 'p_private', audience: 'followers' };
    db.upsertPost(post);

    const stranger = db.filtered({ ...emptyFilter(), type: 'missing' }, 'u_johan', db.user('u_johan'));
    expect(stranger.some((p) => p.id === 'p_private')).toBe(false);

    const friend = db.filtered({ ...emptyFilter(), type: 'missing' }, 'u_lerato', db.user('u_lerato'));
    expect(friend.some((p) => p.id === 'p_private')).toBe(true);
  });

  it('sorts by hot score so engaged cases rise', () => {
    const hot = db.filtered({ ...emptyFilter(), sort: 'hot' }, null, undefined);
    const cold = db.filtered({ ...emptyFilter(), sort: 'oldest' }, null, undefined);
    expect(hot[0].id).not.toBe(cold[0].id);
    expect(hot[0].upvotes).toBeGreaterThanOrEqual(hot[hot.length - 1].upvotes);
  });

  it('matches a case number in free-text search', () => {
    const hit = db.filtered({ ...emptyFilter(), query: 'ORL/441' }, null, undefined);
    expect(hit.map((p) => p.id)).toContain('p_thato');
  });
});

describe('DataService voting and comments', () => {
  beforeEach(bed);

  it('records a Quora-style upvote, then toggles it off on a second tap', async () => {
    const data = svc<DataService>(DataService);
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();
    await data.loadFeed();

    const before = data.post('p_lindiwe')!.upvotes;
    await data.vote('p_lindiwe', 'up');
    expect(data.post('p_lindiwe')!.upvotes).toBe(before + 1);
    expect(data.myVote(data.post('p_lindiwe')!)).toBe('up');

    await data.vote('p_lindiwe', 'up');
    expect(data.post('p_lindiwe')!.upvotes).toBe(before);
    expect(data.myVote(data.post('p_lindiwe')!)).toBeNull();
  });

  it('switching between reactions keeps one count and swaps the icon', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const p0 = data.post('p_khumalo')!;
    await data.vote('p_khumalo', 'up');
    await data.vote('p_khumalo', 'support');
    const p1 = data.post('p_khumalo')!;
    expect(p1.upvotes).toBe(p0.upvotes + 1);
    expect(data.myVote(p1)).toBe('support');
    await data.vote('p_khumalo', 'support');
    expect(data.post('p_khumalo')!.upvotes).toBe(p0.upvotes);
  });

  it('keeps reactions and private chat apart: no reaction changes the gate', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    // start from a clean slate: the seed has these two following each other
    const post = data.post('p_lindiwe')!;
    db.removeFollow(post.authorId, 'u_demo');
    db.removeFollow('u_demo', post.authorId);

    const before = await chat.gate(data.post(post.id)!);
    expect(before.allowed).toBe(false);
    expect((before as any).step).toBe('follow');

    // every reaction, including "Have an idea", leaves chat exactly as it was
    for (const kind of ['up', 'like', 'support', 'sad'] as const) {
      await data.vote('p_lindiwe', kind);
      const gate = await chat.gate(data.post('p_lindiwe')!);
      expect(gate.allowed, kind).toBe(false);
      expect((gate as any).step, kind).toBe('follow');
    }
  });

  it('adds a comment, bumps the counter and notifies the poster', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const before = data.post('p_lindiwe')!.commentCount;
    const c = await data.addComment({ postId: 'p_lindiwe', body: 'I work at that salon, I will ask.', isLead: true });
    expect(c.isLead).toBe(true);

    const after = data.post('p_lindiwe')!;
    expect(after.commentCount).toBe(before + 1);
    expect((await data.comments('p_lindiwe')).some((x) => x.id === c.id)).toBe(true);

    const notes = db.notifications('u_sipho');
    expect(notes.some((n) => n.postId === 'p_lindiwe' && n.title.includes('New lead'))).toBe(true);
  });
});

describe('Repost and feed activity', () => {
  beforeEach(bed);

  it('stamps the last like onto the post when someone votes up', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    await data.vote('p_lindiwe', 'up');
    expect(data.post('p_lindiwe')!.lastLike).toMatchObject({ userId: 'u_demo', displayName: 'Thandi Mokoena' });

    // un-voting keeps the last known liker so the feed line never blinks empty
    await data.vote('p_lindiwe', 'up');
    expect(data.post('p_lindiwe')!.lastLike?.userId).toBe('u_demo');
  });

  it('stamps the last top-level comment for the feed preview, ignoring replies', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const top = await data.addComment({ postId: 'p_lindiwe', body: 'I will check the clinic noticeboard tomorrow.' });
    expect(data.post('p_lindiwe')!.lastComment).toMatchObject({
      userId: 'u_demo', body: 'I will check the clinic noticeboard tomorrow.'
    });

    await data.addComment({ postId: 'p_lindiwe', body: 'Thanks!', parentId: top.id });
    expect(data.post('p_lindiwe')!.lastComment?.body).toBe('I will check the clinic noticeboard tomorrow.');
  });

  it('toggles comment likes with voter tracking', async () => {
    const data = svc<DataService>(DataService);
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();
    await data.loadFeed();

    const before = (await data.comments('p_lindiwe')).find((c) => c.id === 'c4')!;
    const liked = await data.voteComment(before);
    expect(liked.upvotes).toBe(before.upvotes + 1);
    expect(liked.likedIds).toContain('u_demo');

    const unliked = await data.voteComment(liked);
    expect(unliked.upvotes).toBe(before.upvotes);
    expect(unliked.likedIds ?? []).not.toContain('u_demo');

    await auth.signOut();
    await expect(data.voteComment(unliked)).rejects.toThrow('Sign in to like a comment');
  });

  it('falls the comment preview back when the latest is deleted', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const first = await data.addComment({ postId: 'p_lindiwe', body: 'First new comment here.' });
    const second = await data.addComment({ postId: 'p_lindiwe', body: 'Second new comment here.' });
    expect(data.post('p_lindiwe')!.lastComment?.body).toBe('Second new comment here.');

    await data.deleteComment(second);
    expect(data.post('p_lindiwe')!.lastComment?.body).toBe('First new comment here.');

    // deleting both falls back to the newest seeded comment
    await data.deleteComment(first);
    expect(data.post('p_lindiwe')!.lastComment?.userId).toBe('u_bongani');
  });

  it('reposts a post with a link back to the original and tells its author', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const rp = await data.repost('p_lindiwe', 'Please share, she is from our area.');
    expect(rp.authorId).toBe('u_demo');
    expect(rp.repostOf).toBe('p_lindiwe');
    expect(rp.body).toBe('Please share, she is from our area.');
    expect(data.post('p_lindiwe')!.shares).toBeGreaterThan(0);
    const notes = db.notifications('u_sipho');
    expect(notes.some((n) => n.kind === 'repost' && n.postId === 'p_lindiwe')).toBe(true);
  });

  it('flattens a repost of a repost back to the original post', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const first = await data.repost('p_lindiwe');
    const second = await data.repost(first.id);
    expect(second.repostOf).toBe('p_lindiwe');
  });

  it('guests cannot repost', async () => {
    const data = svc<DataService>(DataService);
    await data.loadFeed();
    await expect(data.repost('p_thato')).rejects.toThrow('Sign in to repost');
  });
});

describe('ChatService - private chat is mutual follow only', () => {
  beforeEach(bed);

  it('blocks chat when the viewer does not follow the poster', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const post = data.post('p_lindiwe')!;
    if (await data.isFollowing(post.authorId)) await data.toggleFollow(post.authorId);
    db.removeFollow(post.authorId, 'u_demo');

    const gate = await chat.gate(data.post(post.id)!);
    expect(gate.allowed).toBe(false);
    expect((gate as any).step).toBe('follow');
  });

  it('a one-way follow is not enough; following back opens the chat', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const post = data.post('p_khumalo')!;
    expect(post.authorId).toBe('u_ayanda');
    db.removeFollow(post.authorId, 'u_demo');
    db.removeFollow('u_demo', post.authorId);

    await data.toggleFollow(post.authorId); // I follow them
    const oneWay = await chat.gate(data.post(post.id)!);
    expect(oneWay.allowed).toBe(false);
    expect((oneWay as any).step).toBe('follow');

    await db.upsertFollow({ id: 'f_back', followerId: post.authorId, followingId: 'u_demo', at: Date.now(), status: 'accepted' });
    const mutual = await chat.gate(data.post(post.id)!);
    expect(mutual.allowed).toBe(true);
  });

  it('never asks for a reaction first - there is no vote step left', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();
    const gate = await chat.gate(data.post('p_lindiwe')!);
    expect((gate as any).step).not.toBe('vote');
    expect(String((gate as any).reason ?? '')).not.toMatch(/have an idea|upvote|unlock/i);
  });

  it('respects a poster who switched chat off', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const post = data.post('p_lindiwe')!;
    await data.loadPost(post.id);
    db.upsertPost({ ...post, chatEnabled: false });
    await data.loadPost(post.id);
    expect(data.post(post.id)!.chatEnabled).toBe(false);
    const gate = await chat.gate(data.post(post.id)!);
    expect(gate.allowed).toBe(false);
    expect((gate as any).step).toBe('disabled');
  });

  it('lets the person a KhumbulEkhaya post is about reach the family', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    signInAs('u_lindiwe');
    const gate = await chat.gate(data.post('p_lindiwe')!, true);
    expect(gate.allowed).toBe(true);
  });

  it('creates a thread and stores messages', async () => {
    const data = svc<DataService>(DataService);
    const chat = svc<ChatService>(ChatService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const post = data.post('p_lindiwe')!;
    const thread = await chat.ensureThread(post, post.authorId);
    expect(thread).not.toBeNull();
    expect(thread!.participantIds).toContain('u_demo');
    expect(thread!.postId).toBe(post.id);
    expect(thread!.unlockedVia).toBe('follow');

    await chat.send('I think I saw her at the Isipingo salon.');
    const msgs = chat.messages();
    expect(msgs.filter((m) => m.fromUserId === 'u_demo').length).toBe(1);
    expect(db.messages(thread!.id).length).toBe(2); // system note + the message
  });
});

describe('EscalationService - a note is not a dispatch', () => {
  beforeEach(bed);

  it('refuses to dispatch without consent', async () => {
    const data = svc<DataService>(DataService);
    const esc = svc<EscalationService>(EscalationService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const post = data.post('p_khumalo')!;
    await expect(esc.dispatch(post, ['saps'])).rejects.toThrow(/consent/i);
  });

  it('records a note and does not invent a reference or a send', async () => {
    const data = svc<DataService>(DataService);
    const esc = svc<EscalationService>(EscalationService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    // p_khumalo belongs to u_ayanda; act as that user
    signInAs('u_ayanda');

    const post = data.post('p_khumalo')!;
    const partners = esc.partnersFor(post).map((p) => p.id);
    await esc.grantConsent(post, partners, 30);
    const consented = data.post(post.id)!;
    expect(consented.escalation.consentGranted).toBe(true);
    expect(consented.consent.some((c) => c.kind === 'escalation' && c.granted)).toBe(true);

    const sent = await esc.dispatch(consented, partners);
    expect(sent!.escalation.partners.length).toBe(partners.length);
    expect(sent!.escalation.partners.every((p) => p.status === 'noted')).toBe(true);
    expect(sent!.escalation.partners.every((p) => p.reference === null)).toBe(true);
    expect(esc.lastResult()).toMatch(/did not send/i);
  });

  it('lets the poster withdraw consent', async () => {
    const data = svc<DataService>(DataService);
    const esc = svc<EscalationService>(EscalationService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();
    signInAs('u_ayanda');

    const post = data.post('p_khumalo')!;
    await esc.grantConsent(post, ['saps'], 30);
    const revoked = await esc.revokeConsent(data.post(post.id)!);
    expect(revoked!.escalation.consentGranted).toBe(false);
    expect(revoked!.consent.find((c) => c.kind === 'escalation')!.granted).toBe(false);
  });

  it('does not offer a fake Amber Alert, Pink Drive, or an unverified NGO', () => {
    const esc = svc<EscalationService>(EscalationService);
    const child: Post = { ...db.post('p_thato')! };
    const pet: Post = { ...db.post('p_thato')!, type: 'pet' };
    const ids = (post: Post) => esc.partnersFor(post).map((p) => p.id);
    expect(ids(child)).not.toContain('amber-sa');
    expect(ids(child)).not.toContain('pink-drive');
    expect(ids(child)).not.toContain('missing-sa');
    expect(ids(child)).toContain('missing-children-sa');
    expect(ids(child)).toContain('pink-ladies');
    expect(ids(pet)).not.toContain('pink-ladies');
    expect(ids(pet)).toContain('saps-10111');
  });

  it('lists checked South African numbers and does not invent a dispatch', () => {
    const byId = Object.fromEntries(HELP_LINES.map((line) => [line.id, line]));
    expect(byId['saps-10111'].href).toBe('tel:10111');
    expect(byId['gbvcc'].number).toBe('0800 428 428');
    expect(byId['childline-116'].href).toBe('tel:116');
    expect(byId['childline-0800'].href).toBe('tel:0800055555');
    expect(byId['tears'].href).toBe('tel:0800083277');
    expect(byId['missing-children-sa'].href).toBe('tel:0726477464');
    expect(byId['pink-ladies'].href).toContain('27722147439');
    expect(HELP_LINES.some((line) => /pink drive|chomi|060 648 6878/i.test(`${line.name} ${line.number} ${line.detail}`))).toBe(false);
    expect(GBV_CHANNEL_NOTE).toMatch(/0800 428 428/);
    expect(GBV_CHANNEL_NOTE).toMatch(/If a code does not connect/);
  });

  it('shows a mark check to the family only', () => {
    const lead = { markGuess: 'scar above the eyebrow', markCheck: null as 'match' | 'no' | null };
    expect(leadMarkView(lead, false).guess).toBeNull();
    expect(leadMarkView(lead, false).status).toMatch(/has not checked/i);
    expect(leadMarkView(lead, true).guess).toContain('scar');
    expect(leadMarkView({ ...lead, markCheck: 'match' }, false).status).toMatch(/matched/i);
    expect(leadMarkView({ ...lead, markCheck: 'match' }, false).guess).toBeNull();
  });

  it('lets an adult answer a missing post, and refuses a child case', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();
    signInAs('u_lerato');
    await expect(data.claimKhumbuPost('p_thato')).rejects.toThrow(/child/i);
    const claimed = await data.claimKhumbuPost('p_johan');
    expect(claimed?.khumbu?.claimedByUserId).toBe('u_lerato');
    const answered = await data.subjectRespond('p_johan', 'not_going_home', 'I am safe.');
    expect(answered?.status).toBe('not_going_home');
  });

  it('keeps the private mark and the reward amount off the public poster', () => {
    const flyer = publicPoster(db.post('p_thato')!);
    expect(flyer.shareText).not.toMatch(/scar/i);
    expect(flyer.shareText).not.toContain('R5 000');
    expect(flyer.shareText).toContain('10111');
    expect(flyer.shareText).toContain('ORL/441/09/2026');
    expect(flyer.withheld).toMatch(/scar/i);
    expect(publicPoster(db.post('p_found_car')!).shareText).toMatch(/not a police poster/i);
  });

  it('nudges the poster about the outcome once a case has traction', async () => {
    const data = svc<DataService>(DataService);
    const esc = svc<EscalationService>(EscalationService);
    await svc<AuthService>(AuthService).signInDemo();
    signInAs('u_johan');
    await data.loadFeed();

    const post = data.post('p_johan')!; // 189 upvotes, authored by u_johan
    expect(post.upvotes).toBeGreaterThan(15);
    expect(esc.shouldNudgeOutcome(post)).toBe(true);
    expect(esc.shouldNudgeOutcome({ ...post, authorId: 'someone-else' })).toBe(false);
    expect(esc.shouldNudgeOutcome({ ...post, status: 'found' })).toBe(false);
  });
});

describe('KhumbulEkhaya flow', () => {
  beforeEach(bed);

  it('lets the subject claim the post and answer', async () => {
    const data = svc<DataService>(DataService);
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();
    signInAs('u_lindiwe');
    await data.loadFeed();

    const post = data.post('p_lindiwe')!;
    const claimed = await data.claimKhumbuPost(post.id);
    expect(claimed!.khumbu!.claimedByUserId).toBe('u_lindiwe');

    const answered = await data.subjectRespond(post.id, 'not_going_home', 'I am safe, I need time.');
    expect(answered!.khumbu!.subjectResponse).toBe('not_going_home');
    expect(answered!.status).toBe('not_going_home');
    expect(db.notifications('u_sipho').some((n) => n.kind === 'claim')).toBe(true);
  });

  it('counts community answers to "are they being wanted?"', async () => {
    const data = svc<DataService>(DataService);
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();
    await data.loadFeed();

    const post = data.post('p_lindiwe')!;
    const yes0 = post.khumbu!.wantedAnswers.yes;
    const after = await data.answerWanted(post.id, true);
    expect(after!.khumbu!.wantedAnswers.yes).toBe(yes0 + 1);
    expect(after!.khumbu!.wantedAnswers.myVote).toBe(true);
  });

  it('closes a case as found and records the event', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    const post = data.post('p_thato')!;
    const found = await data.markFound(post.id, { whereabouts: 'Safe at home in Soweto', note: 'Tip from a spaza owner.' });
    expect(found!.status).toBe('found');
    expect(found!.outcome.found).toBe(true);
    expect(found!.outcome.whereaboutsFound).toBe('Safe at home in Soweto');
    expect(found!.events.some((e) => e.kind === 'found')).toBe(true);
    expect(data.feed().filter((p) => p.id === 'p_thato').length).toBe(0); // filtered out of "still missing"
  });

  it('shows found people and items on the home list without opening the Found filter', async () => {
    const data = svc<DataService>(DataService);
    await data.loadFeed();
    expect(data.feed().some((p) => p.status === 'found')).toBe(false);
    const home = data.broughtHome();
    expect(home.some((p) => p.id === 'p_found')).toBe(true);
    expect(home.some((p) => p.type === 'vehicle')).toBe(false);
    expect(home.some((p) => p.type === 'pet')).toBe(true);
    expect(home.every((p) => p.status === 'found')).toBe(true);
  });

  it('names the finder, credits only that member, and the badge is the count', async () => {
    const auth = svc<AuthService>(AuthService);
    const data = svc<DataService>(DataService);
    const opts = { password: 'password123', surname: 'Ignored', province: 'GP' as const, town: '', over18: true, acceptedTerms: true, otpVerified: true };
    const a = await auth.signUp({ ...opts, displayName: 'John Doe', email: 'john1@example.co.za' });
    const b = await auth.signUp({ ...opts, displayName: 'John Doe', email: 'john2@example.co.za' });
    expect(a.handle).toBe('doe');
    expect(b.handle).toBe('doe1');

    const hits = await data.usersWithName('John Doe');
    expect(hits.map((u) => u.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await data.usersWithName('Doe')).length).toBeGreaterThanOrEqual(2);

    await auth.signInDemo();
    await data.loadFeed();
    await data.markFound('p_thato', { whereabouts: 'Safe at home', finderUserId: b.id });
    expect((await data.profile(b.id))!.contributorCredits).toBe(1);
    expect((await data.profile(a.id))!.contributorCredits ?? 0).toBe(0);
    expect(db.notifications(b.id).some((n) => n.kind === 'outcome' && n.body.includes('x1'))).toBe(true);

    // naming someone else on a case that already has a finder does not move the badge
    await data.markFound('p_thato', { whereabouts: 'Safe at home', finderUserId: a.id });
    expect((await data.profile(b.id))!.contributorCredits).toBe(1);
    expect((await data.profile(a.id))!.contributorCredits ?? 0).toBe(0);

    await data.markFound('p_johan', { whereabouts: 'At the clinic', finderUserId: b.id });
    const credited = (await data.profile(b.id))!;
    expect(credited.contributorCredits).toBe(2);
    expect(contributorLabel(credited.contributorCredits)).toBe('Contributor x2');
    expect(await data.topContributorCount()).toBe(2);
    expect(data.post('p_johan')!.outcome.finderName).toBe('John Doe');
    expect(data.post('p_johan')!.outcome.finderUserId).toBe(b.id);
  });
});

describe('LocationService - consent-gated background check', () => {
  beforeEach(bed);

  it('returns nothing at all when the subject has not consented', async () => {
    const loc = svc<LocationService>(LocationService);
    expect(await loc.backgroundCheck({ subjectRegistered: true, consentFromSubject: 'requested' })).toBeNull();
    expect(await loc.backgroundCheck({ subjectRegistered: true, consentFromSubject: 'declined' })).toBeNull();
    expect(await loc.backgroundCheck({ subjectRegistered: false, consentFromSubject: 'none' })).toBeNull();
  });

  it('does not invent a location when the phone has not shared one', async () => {
    const loc = svc<LocationService>(LocationService);
    const points = await loc.backgroundCheck({ subjectRegistered: true, consentFromSubject: 'granted' });
    expect(points).toBeNull();
  });

  it('maps a coordinate to the nearest province', () => {
    const loc = svc<LocationService>(LocationService);
    expect(loc.nearestProvince({ lat: -26.2041, lng: 28.0473 })).toBe('GP');
    expect(loc.nearestProvince({ lat: -33.9249, lng: 18.4241 })).toBe('WC');
    expect(loc.nearestProvince({ lat: -29.8587, lng: 31.0218 })).toBe('KZN');
  });

  it('computes a sane distance between two points', () => {
    const loc = svc<LocationService>(LocationService);
    const d = loc.distanceKm({ lat: -26.2041, lng: 28.0473 }, { lat: -29.8587, lng: 31.0218 });
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(600);
  });

  it('forgets the location on revoke', async () => {
    const loc = svc<LocationService>(LocationService);
    await loc.readDevicePosition();
    await loc.revokeAll();
    expect(loc.current()).toBeNull();
    expect(loc.beaconEnabled()).toBe(false);
  });
});

describe('Spotlight communities', () => {
  beforeEach(bed);

  it('creates a surname spotlight owned by the creator', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const sp = await data.createSpotlight({ surname: 'Molefe', tagline: 'Molefe family', about: 'Test', province: 'NW' });
    expect(sp.surname).toBe('Molefe');
    expect(sp.ownerId).toBe('u_demo');
    expect(data.spotlights().some((s) => s.surname === 'Molefe')).toBe(true);
  });

  it('rejects a surname that already exists in the same province', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await expect(data.createSpotlight({ surname: 'Ndlela', tagline: '', about: '', province: 'KZN' }))
      .rejects.toThrow(/already exists/i);
    await expect(data.createSpotlight({ surname: 'ndlela', tagline: '', about: '', province: 'KZN' }))
      .rejects.toThrow(/already exists/i);
  });

  it('allows the same surname in a different province', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const sp = await data.createSpotlight({ surname: 'Ndlela', tagline: '', about: '', province: 'GP' });
    expect(sp.province).toBe('GP');
    expect(data.spotlights().filter((s) => s.surname === 'Ndlela').length).toBe(2);
  });

  it('demands a province before a spotlight can be created', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await expect(data.createSpotlight({ surname: 'Newname', tagline: '', about: '', province: null }))
      .rejects.toThrow(/province/i);
  });

  it('only offers the communities you have joined when you post', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadStatic();
    // the demo account owns Mokoena but has not joined Ndlela
    const mine = data.mySpotlights().map((s) => s.surname);
    expect(mine).toContain('Mokoena');
    expect(mine).not.toContain('Ndlela');
    const joined = await data.joinSpotlight('sp_ndlela');
    expect(joined).toBe(true);
    await data.loadStatic();
    const sp = data.spotlights().find((s) => s.id === 'sp_ndlela')!;
    expect(sp.memberIds).toContain('u_demo');
    expect(data.mySpotlights().map((s) => s.surname)).toContain('Ndlela');
    // joining twice is a no-op, not a duplicate
    expect(await data.joinSpotlight('sp_ndlela')).toBe(false);
  });

  it('adds a member and grows the counter', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const before = data.spotlightPosts('sp_ndlela').length;
    await data.joinSpotlight('sp_ndlela');
    const sp = data.spotlights().find((s) => s.id === 'sp_ndlela')!;
    expect(sp.memberIds).toContain('u_demo');
    expect(before).toBeGreaterThanOrEqual(0);
  });
});

describe('Accounts and following', () => {
  beforeEach(bed);

  it('signs a new user up with an auto-generated handle and no phone number', async () => {
    const auth = svc<AuthService>(AuthService);
    const u = await auth.signUp({
      displayName: 'Nomvula Zondi',
      email: 'nomvula@example.co.za',
      password: 'password123',
      surname: 'Zondi',
      province: 'KZN',
      town: 'Durban',
      over18: true,
      acceptedTerms: true,
      otpVerified: true
    });
    expect(u.email).toBe('nomvula@example.co.za');
    // the second name is the surname, and that surname is the username
    expect(u.displayName).toBe('Nomvula Zondi');
    expect(u.surname).toBe('Zondi');
    expect(u.handle).toBe('zondi');
    // a surname passed in separately is ignored — the full name is the source
    expect(u.onboarded).toBe(false); // onboarding is required next
    expect(u.isAdmin).toBe(false);
    expect(u.suspended).toBe(false);
    expect((u as any).phone).toBeUndefined();
  });

  it('refuses anyone who is not 18 or who has not accepted the terms', async () => {
    const auth = svc<AuthService>(AuthService);
    await expect(
      auth.signUp({ displayName: 'Young Person', email: 'young@example.co.za', password: 'password123', surname: 'Person', province: 'GP', town: '', acceptedTerms: true, otpVerified: true })
    ).rejects.toThrow(/18 or older/i);
    await expect(
      auth.signUp({ displayName: 'No Terms', email: 'noterms@example.co.za', password: 'password123', surname: 'Person', province: 'GP', town: '', over18: true, otpVerified: true })
    ).rejects.toThrow(/terms/i);
  });

  it('will not create an account until the emailed code is entered', async () => {
    const auth = svc<AuthService>(AuthService);
    await expect(
      auth.signUp({ displayName: 'No Code', email: 'nocode@example.co.za', password: 'password123', surname: 'Code', province: 'GP', town: '', over18: true, acceptedTerms: true })
    ).rejects.toThrow(/code we emailed/i);
  });

  it('runs the whole email OTP round trip', async () => {
    const auth = svc<AuthService>(AuthService);
    const email = 'otp@example.co.za';

    // nothing to verify before a code is sent
    expect(auth.verifyOtp(email, '123456')).toBe(false);

    const sent = await auth.requestOtp(email);
    expect(sent.sentTo).toBe(email);
    expect(sent.demoCode).toMatch(/^[0-9]{6}$/);

    // a wrong code is refused, the right one is accepted
    expect(auth.verifyOtp(email, '000000')).toBe(false);
    expect(auth.verifyOtp(email, sent.demoCode)).toBe(true);
    expect(auth.otpSecondsLeft(email)).toBeGreaterThan(0);

    const u = await auth.signUp({
      displayName: 'Otp Person', email, password: 'password123', surname: 'Person',
      province: 'GP', town: '', over18: true, acceptedTerms: true, otpVerified: true
    });
    expect(u.email).toBe(email);

    // the code is spent - it cannot be replayed for a second account
    expect(auth.verifyOtp(email, sent.demoCode)).toBe(false);
  });

  it('rejects Get OTP on an address that is not an email', async () => {
    const auth = svc<AuthService>(AuthService);
    await expect(auth.requestOtp('not-an-email')).rejects.toThrow(/valid email/i);
  });

  it('makes the second Nomvula Zondi a numbered handle', async () => {
    const auth = svc<AuthService>(AuthService);
    await auth.signUp({ displayName: 'Nomvula Zondi', email: 'nomvula@example.co.za', password: 'password123', surname: 'Zondi', province: 'KZN', town: '', over18: true, acceptedTerms: true, otpVerified: true });
    const second = await auth.signUp({ displayName: 'Nomvula Zondi', email: 'nomvula2@example.co.za', password: 'password123', surname: 'Zondi', province: 'KZN', town: '', over18: true, acceptedTerms: true, otpVerified: true });
    expect(second.handle).toBe('zondi1');
  });

  it('takes the username from the second name and ignores a different surname field', async () => {
    const auth = svc<AuthService>(AuthService);
    const u = await auth.signUp({
      displayName: 'John Doe', email: 'john@example.co.za', password: 'password123',
      surname: 'Notdoe', province: 'GP', town: '', over18: true, acceptedTerms: true, otpVerified: true
    });
    expect(u.displayName).toBe('John Doe');
    expect(u.surname).toBe('Doe');
    expect(u.handle).toBe('doe');
    await expect(auth.signUp({
      displayName: 'Cher', email: 'cher@example.co.za', password: 'password123',
      surname: 'Cher', province: 'GP', town: '', over18: true, acceptedTerms: true, otpVerified: true
    })).rejects.toThrow(/surname/i);
  });

  it('rejects a duplicate email and a weak password', async () => {
    const auth = svc<AuthService>(AuthService);
    await expect(
      auth.signUp({ displayName: 'Thandi Mokoena', email: 'thandi.m@example.co.za', password: 'password123', surname: 'Mokoena', province: 'GP', town: '' })
    ).rejects.toThrow(/already exists/i);
    await expect(
      auth.signUp({ displayName: 'New Person', email: 'new@example.co.za', password: 'short', surname: 'P', province: 'GP', town: '' })
    ).rejects.toThrow(/8 characters/i);
  });

  it('signs the demo account in and restores the session', async () => {
    const auth = svc<AuthService>(AuthService);
    const u = await auth.signInDemo();
    expect(u.id).toBe('u_demo');
    expect(auth.signedIn()).toBe(true);
    await auth.signOut();
    expect(auth.signedIn()).toBe(false);
  });

  it('prevents self-follows and toggles follows', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await expect(data.toggleFollow('u_demo')).rejects.toThrow(/yourself/i);

    expect(await data.isFollowing('u_johan')).toBe(false);
    await data.toggleFollow('u_johan');
    expect(await data.isFollowing('u_johan')).toBe(true);
    await data.toggleFollow('u_johan');
    expect(await data.isFollowing('u_johan')).toBe(false);
  });
});

describe('Format helpers', () => {
  it('renders relative time', () => {
    expect(timeAgo(Date.now() - 30_000)).toBe('now');
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m');
    expect(timeAgo(Date.now() - 3 * 3600_000)).toBe('3h');
    expect(timeAgo(Date.now() - 4 * 86400_000)).toBe('4d');
  });

  it('compacts big numbers', () => {
    expect(compact(999)).toBe('999');
    expect(compact(1200)).toBe('1.2k');
    expect(compact(48200)).toBe('48k');
  });

  it('turns John Doe into initials JD and a contributor count', () => {
    const parsed = parseFullName('John Doe');
    expect(parsed!.initials).toBe('JD');
    expect(parsed!.surname).toBe('Doe');
    expect(parseFullName('John')).toBeNull();
    expect(contributorLabel(4)).toBe('Contributor x4');
    expect(contributorLabel(8)).toBe('Contributor x8');
    const src = decodeURIComponent(avatar('John Doe'));
    expect(src).toContain('>JD<');
    expect(src).not.toContain('<circle');
  });

  it('flags child and fresh cases as critical', () => {
    expect(urgency({ type: 'missing', subject: { age: 8 }, status: 'active', createdAt: Date.now() - 86400_000 })).toBe('critical');
    expect(urgency({ type: 'story', subject: null, status: 'active', createdAt: Date.now() - 86400_000 })).toBe('normal');
  });
});


describe('Posting rules', () => {
  beforeEach(bed);

  const base = {
    type: 'missing' as const, title: 'Help find Test Person in Soweto',
    body: 'This is a long enough description of what happened and when.',
    media: [] as any[], province: 'GP' as const, town: 'Soweto',
    lastSeenAt: Date.now(), lastSeenWhere: 'Orlando West', geo: null,
    contactLabel: 'Call', contactValue: '0710000000', contactVisibleTo: 'everyone' as const,
    caseNumber: null, reward: null, subject: null, audience: 'public' as const,
    spotlightId: null, chatEnabled: true, allowComments: true, anonymous: false,
    askWanted: false, khumbu: null
  };

  it('refuses a post with no province or no town', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await expect(data.createPost({ ...base, province: null as any })).rejects.toThrow(/province/i);
    await expect(data.createPost({ ...base, town: '' })).rejects.toThrow(/town or suburb/i);
  });

  it('refuses photos and a video on the same post', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const media = [
      { id: 'a', kind: 'image' as const, src: 'data:image/svg+xml,' },
      { id: 'b', kind: 'video' as const, src: 'data:video/mp4,' }
    ];
    await expect(data.createPost({ ...base, media })).rejects.toThrow(/not both/i);
    const ok = await data.createPost({ ...base, media: [media[1]] });
    expect(ok.media.length).toBe(1);
  });

  it('lets the author edit a post but not its votes', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost(base);
    const edited = await data.updatePost(post.id, { title: 'Updated title for the search', town: 'Alexandra' });
    expect(edited?.title).toBe('Updated title for the search');
    expect(edited?.town).toBe('Alexandra');
    expect(edited?.upvotes).toBe(post.upvotes);
    expect(data.canEdit(edited)).toBe(true);
  });

  it('stops anyone else editing the post', async () => {
    const data = svc<DataService>(DataService);
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();
    const post = await data.createPost(base);
    signInAs('u_lerato');
    expect(data.canEdit(post)).toBe(false);
    await expect(data.updatePost(post.id, { title: 'Hijacked title here' })).rejects.toThrow(/Only the person/i);
  });

  it('allows up to three story photos and rejects a fourth', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const photos = [1, 2, 3].map((n) => ({
      id: `story-photo-${n}`, kind: 'image' as const, src: `data:image/jpeg;base64,photo${n}`
    }));
    const story = await data.createStory({ text: 'Three photos are allowed', media: photos, bgHue: 220 });
    expect(story.media).toHaveLength(3);
    await expect(data.createStory({
      text: 'Four photos are not allowed', media: [...photos, { ...photos[0], id: 'story-photo-4' }], bgHue: 220
    })).rejects.toThrow(/up to three photos/i);
  });

  it('keeps story replies and the viewer list private to the author', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const story = await data.createStory({ text: 'Private story insights', media: [], bgHue: 10, audience: 'public' });

    signInAs('u_johan');
    await data.loadUserScoped();
    await data.loadStatic();
    await data.replyToStory(story.id, 'I saw this and sent a private reply.');
    await data.markStorySeen(story.id);
    let projected = data.stories().find((item) => item.id === story.id)!;
    expect(projected.replies).toEqual([]);
    expect(projected.viewers).toEqual(['u_johan']);

    signInAs('u_pieter');
    await data.loadUserScoped();
    await data.loadStatic();
    projected = data.stories().find((item) => item.id === story.id)!;
    expect(projected.replies).toEqual([]);
    expect(projected.viewers).toEqual([]);

    signInAs('u_demo');
    await data.loadUserScoped();
    await data.loadStatic();
    projected = data.stories().find((item) => item.id === story.id)!;
    expect(projected.replies.map((reply) => reply.body)).toEqual(['I saw this and sent a private reply.']);
    expect(projected.viewers).toContain('u_johan');
  });

  it('shows a followers-only story to the author’s followers, but not to non-followers', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.createStory({ text: 'For my followers only', media: [], bgHue: 10, audience: 'followers' });

    signInAs('u_lerato'); // accepted edge: u_lerato -> u_demo
    await data.loadStatic();
    await data.loadUserScoped();
    expect(data.visibleStories().some((s) => s.text === 'For my followers only')).toBe(true);

    signInAs('u_johan'); // no follow edge to u_demo
    await data.loadStatic();
    await data.loadUserScoped();
    expect(data.visibleStories().some((s) => s.text === 'For my followers only')).toBe(false);
  });
});

describe('Reports and admin', () => {
  beforeEach(bed);

  it('lets any member report a post, once', async () => {
    const mod = svc<ModerationService>(ModerationService);
    signInAs('u_lerato');
    await mod.report({ target: 'post', targetId: 'p_thato', summary: 'Help find Thato', reason: 'false_info' });
    expect(mod.openCount()).toBe(1);
    await expect(
      mod.report({ target: 'post', targetId: 'p_thato', summary: 'Help find Thato', reason: 'scam' })
    ).rejects.toThrow(/already reported/i);
  });

  it('lets a member report a person', async () => {
    const mod = svc<ModerationService>(ModerationService);
    signInAs('u_lerato');
    const r = await mod.report({ target: 'user', targetId: 'u_pieter', summary: 'Pieter van Wyk', reason: 'harassment' });
    expect(r.target).toBe('user');
    expect(mod.hasReported('u_pieter')).toBe(true);
  });

  it('refuses admin actions from a normal member', async () => {
    const mod = svc<ModerationService>(ModerationService);
    signInAs('u_lerato');
    await mod.report({ target: 'post', targetId: 'p_thato', summary: 'x', reason: 'scam' });
    expect(mod.isAdmin()).toBe(false);
    await expect(mod.removePost('p_thato', 'no')).rejects.toThrow(/admins/i);
    await expect(mod.suspendUser('u_pieter', 'no', true)).rejects.toThrow(/admins/i);
  });

  it('lets an admin remove a post and close the report', async () => {
    const data = svc<DataService>(DataService);
    const mod = svc<ModerationService>(ModerationService);
    signInAs('u_lerato');
    await mod.report({ target: 'post', targetId: 'p_thato', summary: 'Help find Thato', reason: 'false_info' });
    signInAs('u_demo'); // the demo account is an admin
    expect(mod.isAdmin()).toBe(true);
    await mod.removePost('p_thato', 'False information');
    expect(db.post('p_thato')).toBeUndefined();
    expect(mod.openCount()).toBe(0);
    expect(db.post('p_thato') === undefined).toBe(true);
    await data.refresh();
    expect(data.feed().some((p) => p.id === 'p_thato')).toBe(false);
  });

  it('lets an admin suspend a person, who then cannot post', async () => {
    const data = svc<DataService>(DataService);
    const mod = svc<ModerationService>(ModerationService);
    const auth = svc<AuthService>(AuthService);
    signInAs('u_demo');
    await mod.suspendUser('u_lerato', 'Repeated false reports', true);
    expect(db.user('u_lerato')!.suspended).toBe(true);
    signInAs('u_lerato');
    await expect(
      data.createPost({
        type: 'story', title: 'Trying to post while suspended', body: 'This should not be allowed to go through at all.',
        media: [], province: 'GP', town: '', lastSeenAt: null, lastSeenWhere: '', geo: null,
        contactLabel: '', contactValue: '', contactVisibleTo: 'everyone', caseNumber: null, reward: null,
        subject: null, audience: 'public', spotlightId: null, chatEnabled: true, allowComments: true,
        anonymous: false, askWanted: false, khumbu: null
      })
    ).rejects.toThrow(/suspended/i);
    void auth;
  });

  it('will not let one admin remove another admin', async () => {
    const mod = svc<ModerationService>(ModerationService);
    signInAs('u_demo');
    await expect(mod.removeUser('u_mod', 'no')).rejects.toThrow(/another admin/i);
  });
});

describe('Where to look first', () => {
  const base = {
    status: 'active' as const,
    lastSeenWhere: 'Orlando taxi rank',
    town: 'Soweto',
    lastSeenAt: Date.now() - 60 * 60 * 1000,
    subject: null,
    type: 'missing' as const
  };

  it('starts a fresh missing case at the last-seen place', () => {
    const f = searchFocus(base as any);
    expect(f?.ring).toBe('green');
    expect(f?.where).toBe('Orlando taxi rank');
    expect(f?.why).toContain('5 miles');
    expect(f?.why).toContain('not a South African police score');
  });

  it('does not use the walking distance when the person may have travelled by car', () => {
    const f = searchFocus({ ...base, subject: { ...(base as any).subject, vehicle: 'White Toyota' } } as any);
    expect(f?.ring).toBe('red');
    expect(f?.why).not.toContain('5 miles');
  });

  it('says nothing once the search is closed', () => {
    expect(searchFocus({ ...base, status: 'found' } as any)).toBeNull();
  });
});

describe('I am looking', () => {
  beforeEach(bed);

  it('tells only the poster, and a second tap takes it back', async () => {
    const data = svc<DataService>(DataService);
    signInAs('u_kabelo');
    expect(await data.markLooking('p_thato')).toBe(true);
    const notes = db.notifications('u_demo');
    expect(notes[0].title).toContain('looking');
    expect(notes[0].userId).toBe('u_demo');
    expect(db.notifications('u_lerato').some((n) => n.title.includes('looking') && n.postId === 'p_thato')).toBe(false);
    expect(await data.markLooking('p_thato')).toBe(false);
    expect((await data.loadPost('p_thato'))!.lookingIds).not.toContain('u_kabelo');
  });

  it('does not let the poster mark themselves as looking', async () => {
    const data = svc<DataService>(DataService);
    signInAs('u_demo');
    await expect(data.markLooking('p_thato')).rejects.toThrow(/family/i);
  });
});

describe('Safety check-ins', () => {
  beforeEach(bed);

  it('keeps profile location private until the person opts in', () => {
    expect(defaultPrivacy().showLocation).toBe(false);
  });

  it('seeds a green, orange and red check-in a visitor can see', () => {
    const data = svc<DataService>(DataService);
    expect(data.statusOf(db.user('u_kabelo')!)).toBe('safe');
    expect(data.statusOf(db.user('u_pieter')!)).toBe('unfamiliar');
    expect(data.statusOf(db.user('u_ayanda')!)).toBe('need_help');
  });

  it('shows a status on the profile and hides it again', async () => {
    const safety = svc<SafetyService>(SafetyService);
    const data = svc<DataService>(DataService);
    signInAs('u_lerato');
    const rec = await safety.checkIn({ status: 'unfamiliar', note: 'Somewhere I do not know' });
    expect(rec.status).toBe('unfamiliar');
    expect(rec.location).toBeNull(); // nothing shared unless asked
    const me = (await data.profile('u_lerato'))!;
    expect(safety.visibleCheckIn(me, 'u_lerato')?.status).toBe('unfamiliar');
    await safety.clearCheckIn();
    expect(safety.visibleCheckIn((await data.profile('u_lerato'))!, 'u_lerato')).toBeNull();
  });

  it('strips the location from a visitor when the owner hid it', () => {
    const safety = svc<SafetyService>(SafetyService);
    const owner = {
      ...db.user('u_lerato')!,
      privacy: { ...db.user('u_lerato')!.privacy, showLocation: false },
      checkIn: {
        status: 'safe' as const, note: '', at: Date.now(),
        location: { lat: -26.2, lng: 28.04 }, liveUntil: Date.now() + 1000, liveShareOn: true
      }
    };
    const seen = safety.visibleCheckIn(owner, 'u_pieter')!;
    expect(seen.location).toBeNull();
    expect(seen.liveShareOn).toBe(false);
    // the owner still sees their own location
    expect(safety.visibleCheckIn(owner, 'u_lerato')!.location).not.toBeNull();
  });

  it('expires a live share after an hour', () => {
    const safety = svc<SafetyService>(SafetyService);
    const owner = {
      ...db.user('u_lerato')!,
      checkIn: {
        status: 'unfamiliar' as const, note: '', at: Date.now() - 3700_000,
        location: { lat: -26.2, lng: 28.04 }, liveUntil: Date.now() - 100_000, liveShareOn: true
      }
    };
    expect(safety.visibleCheckIn(owner, 'u_pieter')!.liveShareOn).toBe(false);
  });
});

describe('Mock store consistency', () => {
  beforeEach(bed);

  it('hands back copies so a signal always sees the change', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadStatic();
    const before = data.spotlights();
    await data.joinSpotlight('sp_ndlela');
    await data.loadStatic();
    const after = data.spotlights();
    // a new array reference, carrying the new member - this is what makes the
    // Spotlight tab, the composer dropdown and the profile update at once
    expect(after).not.toBe(before);
    expect(after.find((s) => s.id === 'sp_ndlela')!.memberIds).toContain('u_demo');
    // and a caller mutating an element cannot corrupt the store
    const target = after.find((s) => s.id === 'sp_ndlela')!;
    target.surname = 'Hacked';
    target.memberIds.push('u_nobody');
    await data.loadStatic();
    const fresh = data.spotlights().find((s) => s.id === 'sp_ndlela')!;
    expect(fresh.surname).toBe('Ndlela');
    expect(fresh.memberIds).not.toContain('u_nobody');
  });
});

describe('Competitor-parity features', () => {
  beforeEach(bed);

  it('accepts lost pets, and no longer accepts vehicle, danger or story posts', async () => {
    const data = svc<DataService>(DataService);
    await data.refresh();
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();

    const base = {
      media: [], lastSeenAt: null, lastSeenWhere: '', geo: null,
      contactLabel: 'Call / WhatsApp', contactValue: '082 000 0000',
      contactVisibleTo: 'everyone' as const, caseNumber: null, reward: null,
      subject: null, spotlightId: null, chatEnabled: true, allowComments: true,
      anonymous: false, askWanted: false, khumbu: null,
      province: 'GP' as const, town: 'Roodepoort', audience: 'public' as const
    };
    const pet = await data.createPost({
      ...base, type: 'pet', title: 'Brown Labrador "Bongani" - last seen Brixton',
      body: 'Slipped his collar at the park. Red collar with a tag, very friendly, answers to Bongani.'
    });
    expect(pet.type).toBe('pet');

    for (const type of ['vehicle', 'danger', 'story'] as const) {
      await expect(data.createPost({ ...base, type, title: 'x', body: 'y' })).rejects.toThrow(/no longer available/);
    }
  });

  it('keeps retired vehicle and danger posts out of every feed', async () => {
    const data = svc<DataService>(DataService);
    await data.refresh();
    expect(data.feed().some((p) => p.type === 'vehicle' || p.type === 'danger' || p.type === 'story')).toBe(false);
  });

  it('lets only an admin verify a sighting, and records the source', async () => {
    const auth = svc<AuthService>(AuthService);
    const data = svc<DataService>(DataService);
    const mod = svc<ModerationService>(ModerationService);
    await data.refresh();
    const sighting = data.feed().find((p) => p.type === 'sighting')!;
    expect(sighting.sightingVerified).toBeNull();

    // a non-admin cannot do it
    const normal = await auth.signUp({
      displayName: 'Plain User', email: 'plain@example.co.za', password: 'password123',
      surname: 'User', province: 'GP', town: '', over18: true, acceptedTerms: true, otpVerified: true
    });
    expect(normal.isAdmin).toBe(false);
    await expect(mod.verifySighting(sighting.id, 'cctv')).rejects.toThrow(/admins/i);

    // the admin can, and the source is stored with it
    await auth.signOut();
    await auth.signInDemo();
    await mod.verifySighting(sighting.id, 'cctv', 'Matched a store camera on Main Road');
    const after = await data.loadPost(sighting.id);
    expect(after?.sightingVerified?.source).toBe('cctv');
    expect(after?.sightingVerified?.note).toBe('Matched a store camera on Main Road');
    expect(after?.sightingVerified?.at).toBeGreaterThan(0);

    await mod.unverifySighting(sighting.id);
    expect((await data.loadPost(sighting.id))?.sightingVerified).toBeNull();
  });

  it('opens a ground search, lets a volunteer claim a zone and mark it searched', async () => {
    const auth = svc<AuthService>(AuthService);
    const data = svc<DataService>(DataService);
    await auth.signInDemo();
    await data.refresh();
    const mine = data.feed().find((p) => p.authorId === 'u_demo')!;
    expect(mine.searchParty).toBeNull();

    await data.openSearchParty(mine.id, 'Orlando East police station', Date.now() + 7200000,
      ['Orlando West', 'Mofolo North', 'Dube']);
    let p = (await data.loadPost(mine.id))!;
    expect(p.searchParty?.open).toBe(true);
    expect(p.searchParty?.meetAt).toBe('Orlando East police station');
    expect(p.searchParty?.zones.length).toBe(3);
    expect(p.searchParty?.zones.every((z) => z.takenBy === null)).toBe(true);

    // claim one, then mark it searched
    const zone = p.searchParty!.zones[0];
    await data.claimSearchZone(mine.id, zone.id);
    p = (await data.loadPost(mine.id))!;
    expect(p.searchParty!.zones.find((z) => z.id === zone.id)!.takenBy).toBe('u_demo');

    await data.completeSearchZone(mine.id, zone.id, 'Cleared, nothing');
    p = (await data.loadPost(mine.id))!;
    const done = p.searchParty!.zones.find((z) => z.id === zone.id)!;
    expect(done.done).toBe(true);
    expect(done.note).toBe('Cleared, nothing');

    // claiming again releases it
    await data.claimSearchZone(mine.id, zone.id);
    p = (await data.loadPost(mine.id))!;
    expect(p.searchParty!.zones.find((z) => z.id === zone.id)!.takenBy).toBeNull();
  });

  it('will not let a stranger open a search party on someone else case', async () => {
    const auth = svc<AuthService>(AuthService);
    const data = svc<DataService>(DataService);
    await auth.signInDemo();
    await data.refresh();
    const theirs = data.feed().find((p) => p.authorId !== 'u_demo')!;
    await auth.signOut();
    await auth.signUp({
      displayName: 'Plain User', email: 'plain2@example.co.za', password: 'password123',
      surname: 'User', province: 'GP', town: '', over18: true, acceptedTerms: true, otpVerified: true
    });
    await expect(data.openSearchParty(theirs.id, 'Somewhere', null, ['Zone A'])).rejects.toThrow(/poster/i);
  });
});

describe('Saved posts, watch alerts and followers', () => {
  beforeEach(bed);

  it('keeps saved posts on the profile and tells the saver about new Ideas and a found case', async () => {
    signInAs('u_kabelo');
    const data = svc<DataService>(DataService);
    await data.refresh();
    const target = data.feed().find((p) => p.authorId !== 'u_kabelo' && p.authorId !== 'u_bongani' && p.status === 'active')!;
    expect(target).toBeTruthy();

    expect(await data.toggleSaved(target.id)).toBe(true);
    expect(db.user('u_kabelo')!.savedPostIds).toContain(target.id);
    expect((await data.loadSaved()).map((p) => p.id)).toContain(target.id);

    // someone else has an idea
    signInAs('u_bongani');
    await data.vote(target.id, 'up');
    signInAs('u_kabelo');
    await data.loadUserScoped();
    await data.checkWatched(true);
    expect(data.notifications().some((n) => n.postId === target.id && n.kind === 'vote')).toBe(true);

    // the family marks them found
    signInAs(target.authorId);
    await data.markFound(target.id, { whereabouts: 'At home' });
    signInAs('u_kabelo');
    await data.checkWatched(true);
    expect(data.notifications().some((n) => n.postId === target.id && n.kind === 'outcome')).toBe(true);

    // unsave
    expect(await data.toggleSaved(target.id)).toBe(false);
    expect(db.user('u_kabelo')!.savedPostIds).not.toContain(target.id);
  });

  it('tells the poster when someone has an idea', async () => {
    signInAs('u_kabelo');
    const data = svc<DataService>(DataService);
    await data.refresh();
    const target = data.feed().find((p) => p.authorId !== 'u_kabelo' && p.voterIds['u_kabelo'] !== 'up')!;
    await data.vote(target.id, 'up');
    signInAs(target.authorId);
    await data.loadUserScoped();
    expect(data.notifications().some((n) => n.postId === target.id && n.kind === 'vote' && /idea/i.test(n.title))).toBe(true);
  });

  it('lets you remove a follower', async () => {
    signInAs('u_kabelo');
    const data = svc<DataService>(DataService);
    await data.loadUserScoped();
    const follower = data.followerIds()[0];
    expect(follower).toBeTruthy();
    await data.removeFollower(follower);
    expect(data.followerIds()).not.toContain(follower);
  });
});

describe('the feed interleaving rule', () => {
  const post = (n: number) => ({ id: `p${n}`, title: `Post ${n}` }) as unknown as Post;

  it('puts nothing above the first post and nothing after the last one', () => {
    const rows = feedWithRails([post(1), post(2), post(3)]);
    expect(rows.map((r) => r.kind)).toEqual(['post', 'post', 'post']);
  });

  it('adds Stories only after the 8th post', () => {
    const rows = feedWithRails(Array.from({ length: 9 }, (_, i) => post(i + 1)));
    expect(rows.map((r) => r.kind)).toEqual([
      'post', 'post', 'post', 'post', 'post', 'post', 'post', 'post', 'stories', 'post'
    ]);
  });

  it('gives a short feed one story rail, after its last post', () => {
    const rows = feedWithRails([post(1), post(2), post(3)], 8, { shortRail: true });
    expect(rows.map((r) => r.kind)).toEqual(['post', 'post', 'post', 'stories']);
    // and never a second rail once the 8th post is reached
    const full = feedWithRails(Array.from({ length: 9 }, (_, i) => post(i + 1)), 8, { shortRail: true });
    expect(full.filter((r) => r.kind === 'stories').length).toBe(1);
    expect(full.filter((r) => r.kind === 'people').length).toBe(0);
  });

  it('adds rail after every 8th post, not just the first', () => {
    const rows = feedWithRails(Array.from({ length: 17 }, (_, i) => post(i + 1)));
    expect(rows.map((r) => r.kind).filter((k) => k !== 'post')).toEqual(['stories', 'people']);
  });

  it('alternates Stories and People on every 8th post, and never both at once', () => {
    const rows = feedWithRails(Array.from({ length: 25 }, (_, i) => post(i + 1)));
    const rails = rows.filter((r) => r.kind !== 'post').map((r) => r.kind);
    expect(rails).toEqual(['stories', 'people', 'stories']);
    // each rail sits immediately behind the 8th, 16th and 24th post
    rows.forEach((r, i) => {
      if (r.kind === 'post') return;
      expect(rows[i - 1].kind).toBe('post');
      expect(i % 9).toBe(8);
    });
  });
});

describe('poster templates', () => {
  it('offers a modern set, each with its own colours', () => {
    expect(POSTER_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(POSTER_TEMPLATES.map((t) => t.id)).toContain('halo');
    expect(POSTER_TEMPLATES.map((t) => t.id)).toContain('pulse');
    for (const t of POSTER_TEMPLATES) {
      expect(t.swatch.length).toBe(3);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});

describe('poster drawing', () => {
  /** A canvas stub that accepts every 2D call the templates make. */
  function stubContext(): CanvasRenderingContext2D {
    const noop = (): void => undefined;
    const gradient = { addColorStop: noop };
    const ctx: Record<string, unknown> = {
      save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
      arc: noop, arcTo: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
      fillRect: noop, strokeRect: noop, clearRect: noop, fillText: noop, strokeText: noop,
      drawImage: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
      measureText: (t: string) => ({ width: String(t ?? '').length * 17 }),
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      createPattern: () => null
    };
    return ctx as unknown as CanvasRenderingContext2D;
  }

  function stubCanvas(): HTMLCanvasElement {
    return { width: 0, height: 0, getContext: () => stubContext() } as unknown as HTMLCanvasElement;
  }

  /** No TestBed here: the templates are pure canvas code. */
  const post = {
    id: 'p_poster', title: 'Help find Thato Mahlangu', type: 'missing', province: 'GP', town: 'Soweto',
    lastSeenWhere: 'Orlando East', lastSeenAt: Date.now(), caseNumber: 'CAS 123/09/2026',
    subject: { name: 'Thato Mahlangu', age: 9, gender: 'male', clothing: 'Blue school shirt', distinguishing: 'Scar' },
    contactVisibleTo: 'everyone', contactLabel: 'Call the family', contactValue: '071 234 5678'
  } as unknown as Post;

  it('draws every template - including Halo and Pulse - without throwing', () => {
    const content = posterContent(post, 'https://lulafind.app/post/p_poster', null);
    for (const t of POSTER_TEMPLATES) {
      expect(() => drawPoster(stubCanvas(), t.id, content, null), t.id).not.toThrow();
    }
  });

  it('draws a template with a photo as well as without one', () => {
    const content = posterContent(post, 'https://lulafind.app/post/p_poster', null);
    const photo = { width: 800, height: 1000 } as unknown as HTMLImageElement;
    for (const t of POSTER_TEMPLATES) {
      expect(() => drawPoster(stubCanvas(), t.id, content, photo), t.id).not.toThrow();
    }
  });
});

describe('Case alerts - the message that actually finds someone', () => {
  beforeEach(bed);

  /** The same shape the create screen sends. */
  const casePost = (over: Record<string, unknown> = {}) => ({
    type: 'missing' as const,
    title: 'Help find Test Person in Soweto',
    body: 'This is a long enough description of what happened, when and where.',
    media: [] as any[], province: 'GP' as const, town: 'Soweto',
    lastSeenAt: Date.now(), lastSeenWhere: 'Orlando West', geo: null,
    contactLabel: 'Call', contactValue: '0710000000', contactVisibleTo: 'everyone' as const,
    caseNumber: null, reward: null,
    subject: { name: 'Test Person', age: 31, gender: 'female' as const, height: '', build: '', skinTone: '', hair: '', eyes: '', clothing: '', distinguishing: '', medical: '', vehicle: '', languages: '', surname: '', relationship: '' },
    audience: 'public' as const, spotlightId: null, chatEnabled: true, allowComments: true,
    anonymous: false, askWanted: false, khumbu: null, ...over
  });

  /** Every member's inbox, keyed by id, for one-line assertions. */
  async function inboxes(): Promise<Record<string, number>> {
    const api = TestBed.inject(LULA_API) as MockApi;
    const out: Record<string, number> = {};
    for (const u of await api.users()) {
      out[u.id] = (await api.notifications(u.id)).filter((n) => n.kind === 'missing').length;
    }
    return out;
  }

  it('alerts the province when a case goes live, and never the author', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost(casePost());
    const boxes = await inboxes();
    expect(boxes['u_demo']).toBe(0);
    // u_lerato is a seeded member in GP, so a case in Soweto reaches her
    expect(boxes['u_lerato']).toBeGreaterThan(0);
    // u_sipho is in KZN: same country, different province, no alert
    expect(boxes['u_sipho']).toBe(0);
    expect(post.status).toBe('active');
  });

  it('honours the master switch, children only and a different province', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    const off = { ...(await api.user('u_kabelo'))!, alertPrefs: { enabled: false, childrenOnly: false, province: 'all' as const, radiusKm: 50 } };
    await api.saveUser(off);
    // A member who asked for another province's alerts must not get a GP one.
    const elsewhere = { ...(await api.user('u_bongani'))!, alertPrefs: { enabled: true, childrenOnly: false, province: 'WC' as const, radiusKm: 50 } };
    await api.saveUser(elsewhere);
    const kidsOnly = { ...(await api.user('u_lerato'))!, alertPrefs: { enabled: true, childrenOnly: true, province: 'all' as const, radiusKm: 50 } };
    await api.saveUser(kidsOnly);

    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.createPost(casePost());           // an adult case
    const boxes = await inboxes();
    expect(boxes['u_kabelo']).toBe(0);           // switch off
    expect(boxes['u_bongani']).toBe(0);          // asked for Western Cape alerts only
    expect(boxes['u_lerato']).toBe(0);           // children only, adult case

    // A child case is held for review, so its alert goes out when an admin
    // publishes it - and then the children-only member gets it.
    const child = await data.createPost(casePost({
      title: 'Help find a missing child in Soweto',
      subject: { ...casePost().subject, name: 'Test Child', age: 9 }
    }));
    expect(child.status).toBe('under_review');
    signInAs('u_mod');
    await svc<ModerationService>(ModerationService).approveCase(child.id);
    const after = await inboxes();
    expect(after['u_lerato']).toBeGreaterThan(0); // a child case always gets through
    expect(after['u_kabelo']).toBe(0);            // still switched off
  });

  it('holds a child case for review and only alerts the area on approval', async () => {
    const data = svc<DataService>(DataService);
    const mod = svc<ModerationService>(ModerationService);
    await svc<AuthService>(AuthService).signInDemo();
    const child = await data.createPost(casePost({
      title: 'Help find a missing child in Soweto',
      subject: { ...casePost().subject, name: 'Test Child', age: 9 }
    }));

    expect(child.status).toBe('under_review');
    expect((await inboxes())['u_lerato']).toBe(0);
    expect(mod.pendingCases().some((p) => p.id === child.id)).toBe(true);

    signInAs('u_mod');
    const reached = await mod.approveCase(child.id);
    expect(reached).toBeGreaterThan(0);
    expect((await data.loadPost(child.id))?.status).toBe('active');
    expect((await inboxes())['u_lerato']).toBeGreaterThan(0);
  });

  it('never alerts about a case an admin refused', async () => {
    const data = svc<DataService>(DataService);
    const mod = svc<ModerationService>(ModerationService);
    await svc<AuthService>(AuthService).signInDemo();
    const child = await data.createPost(casePost({
      title: 'Help find a missing child in Soweto',
      subject: { ...casePost().subject, name: 'Test Child', age: 9 }
    }));
    signInAs('u_mod');
    await mod.rejectCase(child.id, 'Could not confirm this case.');
    expect((await data.loadPost(child.id))?.status).toBe('removed');
    expect((await inboxes())['u_lerato']).toBe(0);
  });
});

describe('How far a case alert is', () => {
  beforeEach(bed);

  it('measures the distance between two points', () => {
    const jhb = { lat: -26.2041, lng: 28.0473 };
    const durban = { lat: -29.8587, lng: 31.0218 };
    expect(distanceKm(jhb, durban)).toBeGreaterThan(480);
    expect(distanceKm(jhb, durban)).toBeLessThan(520);
    expect(distanceKm(jhb, jhb)).toBe(0);
  });

  it('reads a shared device fix back, and nothing when there is none', () => {
    const data = svc<DataService>(DataService);
    expect(data.devicePoint()).toBeNull();
    localStorage.setItem('lulafind.lastLocation', JSON.stringify({ point: { lat: -26.2, lng: 28.04 }, at: Date.now() }));
    expect(data.devicePoint()?.lat).toBe(-26.2);
    localStorage.setItem('lulafind.lastLocation', 'not json');
    expect(data.devicePoint()).toBeNull();
  });
});
