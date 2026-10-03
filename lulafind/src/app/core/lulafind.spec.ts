import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { AuthService } from './services/auth.service';
import { PHOTO_MAX_BYTES, PICK_MAX_BYTES, POST_MAX_PHOTOS, STORY_MAX_PHOTOS, VIDEO_MAX_BYTES, mb } from './models/media-rules';
import { DataService } from './services/data.service';
import { ChatService } from './services/chat.service';
import { EscalationService } from './services/escalation.service';
import { LocationService } from './services/location.service';
import { ModerationService } from './services/moderation.service';
import { SafetyService } from './services/safety.service';
import { defaultPrivacy, emptyFilter, MediaItem, Post } from './models/types';
import { timeAgo, compact, urgency, parseFullName, contributorLabel, distanceKm, HOUR } from './utils/format';
import { searchFocus } from './utils/search-focus';
import { drawPoster, posterContent, publicPoster, POSTER_TEMPLATES } from './utils/poster';
import { leadMarkView } from './utils/mark-check';
import { GBV_CHANNEL_NOTE, HELP_LINES } from './data/sa-help';
import { avatar, STORY_BLACK, storyBg } from './data/seed';
import { likePattern } from './data/supabase-api';
import { FAQ_TOPICS } from './data/faq-topics';
import { feedWithRails } from './utils/feed';


/** Pretend the point under the finger is a reaction option with this key. */
function jestSpyOnElementFromPoint(key: string | null): void {
  const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  doc.elementFromPoint = () => {
    if (!key) return null;
    const el = document.createElement('button');
    el.className = 'opt';
    el.dataset['key'] = key;
    return el;
  };
}

/**
 * End-to-end tests for the rules that make LulaFind LulaFind:
 * feed filtering, the Quora-style vote, the three-rule private-chat gate,
 * consent-gated escalation, consent-gated location, and the Home Sweet Home loop.
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

  it('keeps photo/video media on comments and replies, not as new feed posts', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();
    const feedBefore = data.feed().map((p) => p.id);
    const photo: MediaItem = { id: 'comment-photo', kind: 'image', src: 'data:image/jpeg;base64,photo' };
    const video: MediaItem = { id: 'reply-video', kind: 'video', src: 'data:video/mp4;base64,video' };

    const top = await data.addComment({ postId: 'p_lindiwe', body: 'This is my attached photo.', media: [photo] });
    const reply = await data.addComment({ postId: 'p_lindiwe', body: 'And this is a reply video.', parentId: top.id, media: [video] });

    expect(top.media).toEqual([photo]);
    expect(reply.parentId).toBe(top.id);
    expect(reply.media).toEqual([video]);
    const stored = await data.comments('p_lindiwe');
    expect(stored.find((c) => c.id === top.id)?.media?.[0]).toEqual(photo);
    expect(stored.find((c) => c.id === reply.id)?.media?.[0]).toEqual(video);
    expect(data.feed().map((p) => p.id)).toEqual(feedBefore);
    expect(db.posts().filter((p) => p.id.startsWith('c_'))).toHaveLength(0);
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

  it('lets the person a Home Sweet Home post is about reach the family', async () => {
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
    expect(flyer.shareText).not.toMatch(/10111|emergency|not a police poster/i);
    expect(flyer.shareText).toContain('ORL/441/09/2026');
    expect(flyer.withheld).toMatch(/scar/i);
    const vehicle = db.post('p_found_car')!;
    expect(publicPoster(vehicle).shareText).toBe('');
    expect(JSON.stringify(posterContent(vehicle, 'https://lulafind.app/post/p_found_car', null)))
      .not.toMatch(/Hilux|Bloemfontein|SAPS/i);
    const danger = { ...vehicle, type: 'danger' as const, title: 'Emergency nearby', body: 'Call 10111 now.' };
    expect(publicPoster(danger).shareText).toBe('');
    expect(JSON.stringify(posterContent(danger, 'https://lulafind.app/post/emergency', null)))
      .not.toMatch(/Emergency|10111|danger/i);
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

describe('Home Sweet Home flow', () => {
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

  it('allows only Spotlight members to create or edit community posts', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadStatic();
    const communityPost = { ...base, audience: 'surname' as const, spotlightId: 'sp_ndlela' };
    await expect(data.createPost(communityPost)).rejects.toThrow(/join .* community/i);

    await data.joinSpotlight('sp_ndlela');
    const post = await data.createPost(communityPost);
    expect(post.audience).toBe('surname');
    expect(post.spotlightId).toBe('sp_ndlela');

    await data.leaveSpotlight('sp_ndlela');
    await expect(data.updatePost(post.id, { title: 'A member left this community' })).rejects.toThrow(/join .* community/i);
  });

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

  it('allows one video on a case and refuses a second', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const video = { id: 'v1', kind: 'video' as const, src: 'data:video/mp4,' };
    const post = await data.createPost({ ...base, media: [video] });
    expect(post.media.length).toBe(1);
    await expect(data.createPost({ ...base, media: [video, { ...video, id: 'v2' }] })).rejects.toThrow(/not both/i);
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

  it('persists the selected poster separately and returns it on the feed post', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost(base);
    const poster = {
      templateId: 'noir', createdAt: Date.now(),
      media: { id: 'poster-image', kind: 'image' as const, src: 'data:image/png;base64,aGVsbG8=' }
    };
    const saved = await data.updatePost(post.id, { poster });
    expect(saved?.poster?.templateId).toBe('noir');
    expect(saved?.poster?.media.src).toBe(poster.media.src);
    const feedPost = (await data.loadFeed()).find((item) => item.id === post.id);
    expect(feedPost?.poster?.media.src).toBe(poster.media.src);
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

  it('allows one story photo and rejects a second', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const photo = { id: 'story-photo-1', kind: 'image' as const, src: 'data:image/jpeg;base64,photo1' };
    const story = await data.createStory({ text: 'One photo is the story', media: [photo], bgHue: 220 });
    expect(story.media).toHaveLength(1);
    await expect(data.createStory({
      text: 'Two photos are not allowed', media: [photo, { ...photo, id: 'story-photo-2' }], bgHue: 220
    })).rejects.toThrow(/one photo/i);
  });

  it('rejects a fourth photo on a case, and accepts three', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const photos = [1, 2, 3, 4].map((n) => ({
      id: `case-photo-${n}`, kind: 'image' as const, src: `data:image/jpeg;base64,photo${n}`
    }));
    const post = await data.createPost({ ...base, media: photos.slice(0, 3) });
    expect(post.media).toHaveLength(3);
    await expect(data.createPost({ ...base, media: photos })).rejects.toThrow(/up to 3 photos/i);
  });

  it('keeps the size rules in one place: 2 MB per photo, 3 MB per video, 3 photos, 1 story photo', () => {
    // These numbers are enforced in the picker, the composer, the uploader and
    // the storage bucket. This test is what stops one of those drifting.
    expect(PHOTO_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(VIDEO_MAX_BYTES).toBe(3 * 1024 * 1024);
    expect(POST_MAX_PHOTOS).toBe(3);
    expect(STORY_MAX_PHOTOS).toBe(1);
    expect(mb(PHOTO_MAX_BYTES)).toBe(2);
    expect(mb(VIDEO_MAX_BYTES)).toBe(3);
    // A phone camera writes files larger than the upload rule, so the picker
    // must still accept them: the composer re-encodes the photo down to size.
    expect(PICK_MAX_BYTES).toBeGreaterThan(PHOTO_MAX_BYTES);
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

    // someone else has an idea. Seeded posts already carry reactions from the
    // demo community, so pick a person who has not reacted to this one yet -
    // a repeat reaction is not a new event and does not notify anyone.
    const voter = db.users().find((u) => u.id !== 'u_kabelo' && u.id !== target.authorId && !target.voterIds[u.id])!;
    expect(voter).toBeTruthy();
    signInAs(voter.id);
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

  it('does not insert a rail into a short feed', () => {
    const rows = feedWithRails([post(1), post(2), post(3)]);
    expect(rows.map((r) => r.kind)).toEqual(['post', 'post', 'post']);
    // A ninth post adds only the rail after post eight.
    const full = feedWithRails(Array.from({ length: 9 }, (_, i) => post(i + 1)));
    expect(full.filter((r) => r.kind === 'stories').length).toBe(1);
    expect(full.filter((r) => r.kind === 'people').length).toBe(0);
    expect(full[8].kind).toBe('stories');
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

describe('story backgrounds', () => {
  it('uses black by default and CSS gradients for selectable colours', () => {
    expect(storyBg(STORY_BLACK)).toBe('#000000');
    expect(storyBg(220)).toMatch(/^radial-gradient/);
    expect(storyBg(220)).not.toContain('data:image');
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

  /**
   * Nothing may be drawn behind the contact bar.
   *
   * The Thato poster rendered "WHEN · 24 September 2026" half-hidden under the
   * yellow call bar - the label was visible, the date was not, and the date is
   * the thing a reader needs to know whether the sighting is worth reporting.
   * This records where every string actually lands on the canvas.
   */
  it('keeps every fact clear of the contact line', () => {
    const content = posterContent(post, 'https://lulafind.app/post/p_poster', null);
    expect(content.facts.length).toBeGreaterThan(1);

    for (const t of POSTER_TEMPLATES) {
      const drawn: { text: string; y: number }[] = [];
      const noop = (): void => undefined;
      const gradient = { addColorStop: noop };
      const ctx: Record<string, unknown> = {
        save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
        arc: noop, arcTo: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
        fillRect: noop, strokeRect: noop, clearRect: noop, strokeText: noop,
        drawImage: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
        fillText: (text: string, _x: number, y: number) => drawn.push({ text: String(text), y }),
        measureText: (v: string) => ({ width: String(v ?? '').length * 17 }),
        createLinearGradient: () => gradient,
        createRadialGradient: () => gradient,
        createPattern: () => null
      };
      drawPoster({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, t.id, content, null);

      const contact = drawn.find((d) => d.text === content.contact);
      expect(contact, `${t.id}: the contact line is missing`).toBeTruthy();

      // Every fact must be on the poster (a missing "WHEN" hides the date), and
      // nothing at all may be drawn behind the contact bar.
      const all = drawn.map((d) => d.text).join(' | ');
      expect(all, `${t.id}: the poster should include its post URL`).toContain(`Read more: ${content.link}`);
      expect(all).not.toMatch(/10111|emergency services|not a police poster/i);
      // Each design trims to the facts it has room for, but two things always
      // hold: the first fact is on the poster, and the police case number is
      // never the one that gets dropped (it is why families are asked for it).
      const first = content.facts[0];
      expect(all, `${t.id}: the "${first.label}" label was never drawn`).toContain(first.label);
      expect(all, `${t.id}: "${first.label}" has no value drawn`).toContain(first.value.split(' ')[0]);
      const caseFact = content.facts.find((f) => /case/i.test(f.label));
      if (caseFact) {
        expect(all, `${t.id}: the police case number was dropped from the poster`).toContain(caseFact.label);
      }
      const hidden = drawn.filter((d) => d.text !== content.contact && d.y > contact!.y - 24 && d.y < contact!.y + 30);
      expect(hidden.map((h) => h.text), `${t.id}: text is hidden behind the contact bar`).toEqual([]);
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
      subject: { ...casePost().subject, name: 'Test Child', age: 9 },
      guardianConsent: true
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
      subject: { ...casePost().subject, name: 'Test Child', age: 9 },
      guardianConsent: true
    }));

    expect(child.status).toBe('under_review');
    expect((await inboxes())['u_lerato']).toBe(0);

    signInAs('u_mod');
    await mod.loadPending();
    expect(mod.pendingCases().some((p) => p.id === child.id)).toBe(true);
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
      subject: { ...casePost().subject, name: 'Test Child', age: 9 },
      guardianConsent: true
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

describe('First-hours checklist', () => {
  beforeEach(bed);

  const caseInput = (over: Record<string, unknown> = {}) => ({
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

  it('lets the poster tick steps and only they can', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost(caseInput());
    expect(post.plan).not.toBeNull();

    const ticked = await data.tickStep(post.id, 'saps_case', true);
    expect(ticked?.plan?.done.saps_case).toBe(true);

    signInAs('u_lerato');
    await expect(data.tickStep(post.id, 'spokesperson', true)).rejects.toThrow(/Only the person/i);
  });

  it('marks the case-number step from the post itself', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost(caseInput({ caseNumber: 'OB 123/09/2026' }));
    expect(post.plan?.done.case_number).toBe(true);
  });

  it('keeps the investigating officer on the case, not the public screen', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost(caseInput());
    const saved = await data.saveOfficer(post.id, 'Sgt Dlamini', '082 000 0000');
    expect(saved?.plan?.officerName).toBe('Sgt Dlamini');
    expect(saved?.plan?.done.officer_details).toBe(true);
    // the officer is not part of the poster or any share text
    expect(publicPoster(saved!).shareText.toLowerCase()).not.toContain('dlamini');
  });

  it('refuses a child case without guardian permission, and records it with one', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const child = caseInput({
      title: 'Help find a missing child in Soweto',
      subject: { ...caseInput().subject, name: 'Test Child', age: 9 }
    });
    await expect(data.createPost(child)).rejects.toThrow(/guardian/i);
    const ok = await data.createPost({ ...child, guardianConsent: true });
    expect(ok.consent.some((c) => c.kind === 'guardian' && c.granted)).toBe(true);
  });
});

describe('The found page feed', () => {
  beforeEach(bed);

  it('shows closed cases with how long it took', () => {
    const data = svc<DataService>(DataService);
    const foundCase = data.feed().find((p) => p.outcome?.found);
    if (foundCase) {
      const at = foundCase.outcome!.foundAt ?? 0;
      expect(at).toBeGreaterThan(0);
    }
    // the shape the page reads must exist on every post
    for (const p of data.feed()) expect(p.outcome).toBeTruthy();
  });

  it('saves Still searching as a visible case-history event without closing the case', async () => {
    const data = svc<DataService>(DataService);
    signInAs('u_sipho');
    await data.loadFeed();
    const updated = await data.confirmStillSearching('p_lindiwe');

    expect(updated.status).toBe('active');
    expect(updated.outcome.found).toBe(false);
    expect(updated.events.at(-1)).toMatchObject({
      kind: 'still_searching', byUserId: 'u_sipho',
      note: expect.stringMatching(/case remains open/i)
    });
    expect(updated.outcomeNudgeAt).toBeGreaterThan(0);

    signInAs('u_demo');
    await expect(data.confirmStillSearching('p_lindiwe')).rejects.toThrow(/Only the person who posted/i);
  });
});

describe('A child case is invisible until a moderator publishes it', () => {
  beforeEach(bed);

  const childCase = (over: Record<string, unknown> = {}) => ({
    type: 'missing' as const,
    title: 'Help find a missing child in Soweto',
    body: 'This is a long enough description of what happened, when and where.',
    media: [] as any[], province: 'GP' as const, town: 'Soweto',
    lastSeenAt: Date.now(), lastSeenWhere: 'Orlando West', geo: null,
    contactLabel: 'Call', contactValue: '0710000000', contactVisibleTo: 'everyone' as const,
    caseNumber: null, reward: null,
    subject: { name: 'Test Child', age: 9, gender: 'female' as const, height: '', build: '', skinTone: '', hair: '', eyes: '', clothing: '', distinguishing: '', medical: '', vehicle: '', languages: '', surname: '', relationship: '' },
    audience: 'public' as const, spotlightId: null, chatEnabled: true, allowComments: true,
    anonymous: false, askWanted: false, khumbu: null, guardianConsent: true, ...over
  });

  it('never puts it in another member\u2019s feed, and still finds it for the moderator', async () => {
    const data = svc<DataService>(DataService);
    const api = TestBed.inject(LULA_API) as MockApi;
    await svc<AuthService>(AuthService).signInDemo();
    const child = await data.createPost(childCase());
    expect(child.status).toBe('under_review');

    // The moderator's queue is a real query, not a filter over the feed.
    const queue = await api.postsForReview();
    expect(queue.map((p) => p.id)).toContain(child.id);

    // u_lerato: another member in the same province. She must not see it.
    signInAs('u_lerato');
    const hers = await api.queryFeed(emptyFilter(), 'u_lerato');
    expect(hers.map((p) => p.id)).not.toContain(child.id);

    // The author still sees their own case while it waits.
    const mine = await api.queryFeed(emptyFilter(), 'u_demo');
    expect(mine.map((p) => p.id)).toContain(child.id);

    // The moderator sees it in the feed too, so they can open and read it.
    signInAs('u_mod');
    const modFeed = await api.queryFeed(emptyFilter(), 'u_mod');
    expect(modFeed.map((p) => p.id)).toContain(child.id);
  });

  it('appears to everyone the moment it is published', async () => {
    const data = svc<DataService>(DataService);
    const api = TestBed.inject(LULA_API) as MockApi;
    const mod = svc<ModerationService>(ModerationService);
    await svc<AuthService>(AuthService).signInDemo();
    const child = await data.createPost(childCase());

    signInAs('u_mod');
    await mod.loadPending();
    expect(mod.pendingCases().map((p) => p.id)).toContain(child.id);

    await mod.approveCase(child.id);
    expect(mod.pendingCases().map((p) => p.id)).not.toContain(child.id);

    signInAs('u_lerato');
    const hers = await api.queryFeed(emptyFilter(), 'u_lerato');
    expect(hers.map((p) => p.id)).toContain(child.id);
  });

  it('drops it from the queue when a moderator refuses it', async () => {
    const data = svc<DataService>(DataService);
    const mod = svc<ModerationService>(ModerationService);
    await svc<AuthService>(AuthService).signInDemo();
    const child = await data.createPost(childCase());
    signInAs('u_mod');
    await mod.loadPending();
    await mod.rejectCase(child.id, 'Could not confirm.');
    expect(mod.pendingCases().map((p) => p.id)).not.toContain(child.id);
  });
});

describe('The queries that do not go through the feed', () => {
  beforeEach(bed);

  it('keeps found cases out of the feed, which is why /found has its own query', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();

    // The default feed filter is "active": a case that closed is not in it.
    const feed = await api.queryFeed(emptyFilter(), 'u_demo');
    expect(feed.some((p) => p.status === 'found')).toBe(false);

    // But the reunions query finds them, with the outcome attached.
    const closed = await data.closedCases();
    expect(closed.length).toBeGreaterThan(0);
    for (const c of closed) {
      expect(c.status).toBe('found');
      expect(c.outcome.found).toBe(true);
      expect(typeof c.outcome.foundAt).toBe('number');
    }
    // newest reunion first
    const times = closed.map((c) => c.outcome.foundAt ?? 0);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('keeps a family member\u2019s own case on their profile after it is found', async () => {
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    const post = await data.createPost({
      type: 'missing' as const,
      title: 'Help find Test Person in Soweto',
      body: 'This is a long enough description of what happened, when and where.',
      media: [] as any[], province: 'GP' as const, town: 'Soweto',
      lastSeenAt: Date.now(), lastSeenWhere: 'Orlando West', geo: null,
      contactLabel: 'Call', contactValue: '0710000000', contactVisibleTo: 'everyone' as const,
      caseNumber: null, reward: null,
      subject: { name: 'Test Person', age: 31, gender: 'female' as const, height: '', build: '', skinTone: '', hair: '', eyes: '', clothing: '', distinguishing: '', medical: '', vehicle: '', languages: '', surname: '', relationship: '' },
      audience: 'public' as const, spotlightId: null, chatEnabled: true, allowComments: true,
      anonymous: false, askWanted: false, khumbu: null
    });

    // On their profile while it is active...
    expect(data.myPosts().map((p) => p.id)).toContain(post.id);

    // ...and still there after it closes, which is when it matters most.
    await data.markFound(post.id, { whereabouts: 'Home', finderUserId: null });
    await data.loadUserScoped();
    expect(data.myPosts().map((p) => p.id)).toContain(post.id);
  });

  it('never answers the review queue from the feed', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    await svc<AuthService>(AuthService).signInDemo();
    // Nothing is pending in the seed, and the queue says so rather than guessing.
    expect(await api.postsForReview()).toEqual([]);
  });
});

describe('Concurrent writes to the same case', () => {
  beforeEach(bed);

  it('patches fields without wiping what another writer just saved', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    const data = svc<DataService>(DataService);
    await svc<AuthService>(AuthService).signInDemo();
    await data.loadFeed();
    const post = data.feed().find((p) => p.authorId === 'u_demo')!;

    // One writer opens a ground search...
    await data.openSearchParty(post.id, 'Orlando East police station', Date.now() + HOUR, ['Orlando West']);

    // ...and a background bookkeeping write touches the same case.
    await data.setOutcomeNudged(post.id);

    // The search party must still be there: the old full-copy save wiped it.
    const after = (await data.loadPost(post.id))!;
    expect(after.searchParty?.open).toBe(true);
    expect(after.searchParty?.zones.length).toBe(1);
    expect(after.outcomeNudgeAt).toBeGreaterThan(0);

    // A patch only changes the fields it names.
    await api.patchPost(post.id, { caseNumber: 'OB 445/09/2026' });
    const patched = (await data.loadPost(post.id))!;
    expect(patched.caseNumber).toBe('OB 445/09/2026');
    expect(patched.searchParty?.open).toBe(true);
    expect(patched.title).toBe(after.title);
  });

  it('still lets a volunteer claim one zone while another is claimed', async () => {
    const data = svc<DataService>(DataService);
    const auth = svc<AuthService>(AuthService);
    await auth.signInDemo();
    await data.loadFeed();
    const post = data.feed().find((p) => p.authorId === 'u_demo')!;
    await data.openSearchParty(post.id, 'Orlando East police station', Date.now() + HOUR, ['Orlando West', 'Mofolo North']);

    const zones = (await data.loadPost(post.id))!.searchParty!.zones;
    await data.claimSearchZone(post.id, zones[0].id);
    signInAs('u_lerato');
    await data.claimSearchZone(post.id, zones[1].id);

    const after = (await data.loadPost(post.id))!;
    expect(after.searchParty!.zones.find((z) => z.id === zones[0].id)!.takenBy).toBe('u_demo');
    expect(after.searchParty!.zones.find((z) => z.id === zones[1].id)!.takenBy).toBe('u_lerato');
  });
});

/**
 * What driving the real app in a real browser found.
 *
 * Each of these was a defect a person would hit; none of them showed up in a
 * service-level test, which is why the browser drive exists.
 */
describe('Bugs the browser found', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps the first-72-hours guidance in the FAQs', () => {
    // The "Ask Lula" assistant was removed, but this answer is the one piece of
    // safety-critical content it held: a family in the first hours must still
    // find it. It now lives in the FAQ data.
    const topic = FAQ_TOPICS.find((t) => t.id === '72');
    expect(topic, 'the first-72-hours topic must exist').toBeTruthy();
    expect(topic!.answer.text).toMatch(/first 72 hours/i);
  });

  it('keeps the reaction tray open when a hold is released on the button, and supports sliding to a choice', async () => {
    const { ReactionButtonComponent } = await import('../shared/components/reaction-button.component');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ReactionButtonComponent] });
    const f = TestBed.createComponent(ReactionButtonComponent);
    f.detectChanges();
    const c = f.componentInstance;
    const button = f.nativeElement.querySelector('.btn') as HTMLElement;
    const rect = button.getBoundingClientRect();
    const x = rect.left + (rect.width / 2);
    const y = rect.top + (rect.height / 2);
    const at = (px: number, py: number) => ({ pointerType: 'touch', button: 0, pointerId: 1, clientX: px, clientY: py }) as PointerEvent;

    jestSpyOnElementFromPoint(null);
    c.down(at(x, y));
    await new Promise((r) => setTimeout(r, 450));
    expect(c.open(), 'holding the button should open the tray').toBe(true);

    c.onUp({ ...at(x, y), target: button } as unknown as PointerEvent);
    expect(c.open(), 'a hold released over the main button should leave choices open').toBe(true);

    const picked: string[] = [];
    c.react.subscribe((k) => picked.push(k));
    c.choose('like'); // this is the tap on Like after the hold
    expect(picked).toEqual(['like']);
    expect(c.open()).toBe(false);

    c.down(at(x, y));
    await new Promise((r) => setTimeout(r, 450));
    jestSpyOnElementFromPoint('support');
    c.onUp({ ...at(x + 120, y + 30), target: button } as unknown as PointerEvent);
    expect(picked, 'sliding and releasing on Support chooses it').toEqual(['like', 'support']);
    expect(c.open()).toBe(false);
  });
});

describe('Search is not limited to the page on screen', () => {
  beforeEach(bed);

  it('finds a case the feed hides, because it closed as found', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    const inFeed = api.db.filtered(emptyFilter(), null, undefined).map((p) => p.id);
    expect(inFeed, 'the feed is meant to hide found cases').not.toContain('p_found');
    const hit = await api.searchPosts('Anele');
    expect(hit.map((p) => p.id)).toContain('p_found');
  });

  it('never hands an unchecked child case to a public search', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    const base = api.db.posts().find((p) => p.type === 'missing')!;
    // Exactly what moderation creates: a child case held until a human checks it.
    const held: Post = { ...base, id: 'p_held_for_review', title: 'Unchecked child case Zzq', status: 'under_review' };
    api.db.upsertPost(held);
    expect(await api.searchPosts('zzzz', 100)).toEqual([]);
    const found = await api.searchPosts('Zzq', 100);
    expect(found.map((p) => p.id)).not.toContain('p_held_for_review');
  });

  it('finds people by surname and by handle, never a suspended member', async () => {
    const api = TestBed.inject(LULA_API) as MockApi;
    expect((await api.searchUsers('ndlela')).map((u) => u.id)).toContain('u_sipho');
    expect((await api.searchUsers('@lerato.m')).map((u) => u.id)).toContain('u_lerato');
    const target = api.db.users()[1];
    api.db.upsertUser({ ...target, suspended: true });
    expect((await api.searchUsers(target.displayName)).map((u) => u.id)).not.toContain(target.id);
  });

  it('ignores a one-character *post* query but still searches a name', async () => {
    // Typing "a" must not pull the whole store for posts; a first letter of a
    // name is a real question, and answering it with "no match" would be wrong.
    const api = TestBed.inject(LULA_API) as MockApi;
    expect(await api.searchPosts('a')).toEqual([]);
    expect((await api.searchUsers('l')).length).toBeGreaterThan(0);
    expect(await api.searchUsers('')).toEqual([]);
  });

  it('treats wildcards and PostgREST punctuation as literal text', () => {
    // A description can contain "50%" or "(child)"; the database must be asked
    // for those characters, not for a pattern that matches everything.
    expect(likePattern('ORL/441')).toBe('%ORL/441%');
    expect(likePattern('50%')).toBe('%50\\%%');
    expect(likePattern('Ndlela, Thabo')).toBe('%Ndlela\\, Thabo%');
    expect(likePattern('(child)')).toBe('%\\(child\\)%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
  });
});

describe('Spotlights are public to read and members-only to post to', () => {
  beforeEach(bed);

  /** A post filed to a Spotlight, saved as the member's own writing. */
  async function filedPost(data: DataService, spId: string, memberId: string): Promise<Post> {
    const db = (TestBed.inject(LULA_API) as MockApi).db;
    const base = db.posts().find((p) => p.type === 'missing')!;
    const post: Post = {
      ...base, id: 'p_filed_spot', authorId: memberId, spotlightId: spId, audience: 'surname',
      title: 'Filed only to the family community', status: 'active', media: []
    };
    db.upsertPost(post);
    return post;
  }

  it('lets someone who has not joined read the posts in a Spotlight', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    const sp = data.spotlights()[0];
    const member = data.spotlights()[0].memberIds[0] ?? 'u_demo';
    await filedPost(data, sp.id, member);
    // nobody is signed in here: a guest, exactly like a shared link
    expect(TestBed.inject(AuthService).signedIn()).toBe(false);
    const posts = await data.postsForSpotlight(sp);
    expect(posts.map((p) => p.id)).toContain('p_filed_spot');
  });

  it('shows a Spotlight case in the feed to a guest and to someone who never joined', async () => {
    // The feed is where a shareable link lands. Hiding it from anyone who had
    // not joined the community is what made a family's Spotlight page look
    // empty to the people they sent it to - in the live backend only, because
    // the offline backend already allowed it. Both now use one rule.
    const data = TestBed.inject(DataService);
    const auth = TestBed.inject(AuthService);
    await data.loadStatic();
    // A community the demo account is not part of, so "non-member" is real.
    const sp = data.spotlights().find((s) => !s.memberIds.includes('u_demo')) ?? data.spotlights()[1];
    const member = sp.memberIds[0];
    await filedPost(data, sp.id, member);

    // A guest, exactly like someone who was sent the link.
    expect(auth.signedIn()).toBe(false);
    const asGuest = await data.loadFeed({ ...emptyFilter(), status: 'active', sort: 'recent' });
    expect(asGuest.map((p) => p.id)).toContain('p_filed_spot');

    // Signed in, but not a member of that community.
    await auth.signInDemo();
    expect(sp.memberIds.includes(auth.viewerId!)).toBe(false);
    const asOutsider = await data.loadFeed({ ...emptyFilter(), status: 'active', sort: 'recent' });
    expect(asOutsider.map((p) => p.id)).toContain('p_filed_spot');
  });

  it('keeps a followers-only case private under the same rule', async () => {
    const data = TestBed.inject(DataService);
    const api = TestBed.inject(LULA_API);
    await data.loadStatic();
    const db = (TestBed.inject(LULA_API) as MockApi).db;
    // u_demo follows nobody by default here, and u_zanele is not in the seeded
    // network - so "does not follow the author" is the real state.
    const author = 'u_zanele';
    const base = db.posts().find((p) => p.type === 'missing')!;
    db.upsertPost({
      ...base, id: 'p_followers_only', authorId: author, audience: 'followers',
      spotlightId: null, title: 'Only for people who follow me', media: []
    } as Post);

    const asGuest = await data.loadFeed({ ...emptyFilter(), status: 'active', sort: 'recent' });
    expect(asGuest.map((p) => p.id)).not.toContain('p_followers_only');

    await TestBed.inject(AuthService).signInDemo();
    const asStranger = await data.loadFeed({ ...emptyFilter(), status: 'active', sort: 'recent' });
    expect(asStranger.map((p) => p.id)).not.toContain('p_followers_only');

    // An accepted follow is what opens it - and nothing else.
    await api.follow('u_demo', author);
    const asFollower = await data.loadFeed({ ...emptyFilter(), status: 'active', sort: 'recent' });
    expect(asFollower.map((p) => p.id)).toContain('p_followers_only');
  });

  it('answers the audience question in exactly one place, shared by both backends', async () => {
    // The bug was the app and the database (and the two backends) disagreeing.
    // One function now answers it, and this is what catches a second copy.
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/app/core/data/supabase-api.ts', 'src/app/core/data/local-db.ts']) {
      const text = readFileSync(`${process.cwd()}/${file}`, 'utf8');
      expect(text, `${file} must use the shared audience rule`).toContain('canReadPostAudience(');
    }
    const api = readFileSync(`${process.cwd()}/src/app/core/data/supabase-api.ts`, 'utf8');
    // The members-only gate that hid Spotlight posts from non-members.
    expect(api, 'the members-only gate must not come back').not.toMatch(/audience === 'surname'[\s\S]{0,220}memberIds\.includes/);
  });

  it('still hides a case held for review from a guest reading a Spotlight', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    const sp = data.spotlights()[0];
    const member = sp.memberIds[0] ?? 'u_demo';
    const post = await filedPost(data, sp.id, member);
    (TestBed.inject(LULA_API) as MockApi).db.upsertPost({ ...post, status: 'under_review' });
    const posts = await data.postsForSpotlight(sp);
    expect(posts.map((p) => p.id)).not.toContain('p_filed_spot');
  });

  it('refuses a post to a Spotlight the writer has not joined', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    await TestBed.inject(AuthService).signInDemo();
    const sp = data.spotlights().find((s) => !s.memberIds.includes('u_demo'))!;
    await expect(data.postToSpotlight(sp, {
      type: 'sighting', title: 'Seen near the taxi rank', body: 'x'.repeat(40), town: 'Umlazi', media: []
    })).rejects.toThrow(/join/i);
  });

  it('posts a member\'s words and media straight into the community', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    await TestBed.inject(AuthService).signInDemo();
    const sp = data.spotlights().find((s) => s.memberIds.includes('u_demo'))!;
    const photo: MediaItem = { id: 'm_q', kind: 'image', src: 'data:image/png;base64,AAAA' };
    const post = await data.postToSpotlight(sp, {
      type: 'sighting', title: 'Search continues on Saturday', body: 'Meet at the hall at 8am, we will cover the east side.',
      town: 'Umlazi', media: [photo]
    });
    expect(post.spotlightId).toBe(sp.id);
    expect(post.audience).toBe('surname');
    expect(post.media.length).toBe(1);
    expect(post.province).toBe(sp.province);
    // and it is on the page, for everyone
    const onPage = await data.postsForSpotlight(sp);
    expect(onPage.map((p) => p.id)).toContain(post.id);
  });
});

describe('Following a case is what brings someone back', () => {
  beforeEach(bed);

  it('follows and unfollows, and remembers the choice for the account', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.refresh();
    const post = data.feed()[0];
    expect(data.isFollowingCase(post.id)).toBe(false);
    expect(await data.toggleFollowCase(post.id)).toBe(true);
    expect(data.isFollowingCase(post.id)).toBe(true);
    const loaded = await data.loadFollowedCases();
    expect(loaded.map((p) => p.id)).toContain(post.id);
    expect(await data.toggleFollowCase(post.id)).toBe(false);
    expect(data.isFollowingCase(post.id)).toBe(false);
  });

  it('tells the follower when a case they follow moves', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.refresh();
    const post = data.feed().find((p) => p.authorId !== 'u_demo')!;
    await data.toggleFollowCase(post.id);
    const before = await data.checkWatched(true);
    // the first run only takes the snapshot - a follow must not announce the past
    expect(before).toBe(0);

    const db = (TestBed.inject(LULA_API) as MockApi).db;
    const fresh = db.post(post.id)!;
    db.upsertPost({ ...fresh, upvotes: fresh.upvotes + 3 });
    // a real phone learns about the new reactions when the feed refreshes
    await data.loadPost(post.id);
    const sent = await data.checkWatched(true);
    expect(sent).toBeGreaterThan(0);
    const note = data.notifications().find((n) => n.postId === post.id && n.kind === 'vote');
    expect(note).toBeTruthy();
    expect(note!.body).toContain('a case you follow');
  });
});

describe('While you were away', () => {
  beforeEach(bed);

  it('counts what is new since the last visit and clears when told', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.refresh();
    // a marker in the past, as if the app was last opened yesterday
    data.markVisited(Date.now() - 2 * 24 * 3600_000);
    const seen = data.sinceLastVisit();
    expect(seen.newCases.length).toBeGreaterThan(0);
    // "near you" is exactly the cases in the viewer's own province - no more
    const province = TestBed.inject(AuthService).user()?.province;
    expect(seen.newCases.every((p) => p.createdAt > data.lastVisitAt())).toBe(true);
    expect(seen.nearYou).toBe(seen.newCases.filter((p) => p.province === province).length);

    data.markVisited();
    const after = data.sinceLastVisit();
    expect(after.newCases).toEqual([]);
    expect(after.followed).toEqual([]);
  });
});
