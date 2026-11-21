import { Component, ViewChild } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { provideRouter, Router } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { ToastController } from '@ionic/angular/toast-controller';

import { AUDIO_MAX_BYTES, PHOTO_MAX_BYTES, VIDEO_MAX_BYTES } from './models/media-rules';
import { LocalDb } from './data/local-db';
import { compact } from './utils/format';
import { LULA_API, MockApi } from './data/api';
import { IDENTITY_REFUSED_COPY, SupabaseApi } from './data/supabase-api';
import { supabaseNotice } from './data/supabase-client';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { feedWithRails } from './utils/feed';
import { ChatService } from './services/chat.service';
import { emptyFilter } from './models/types';
import { strokeFor } from './theme/icon-registry';
import { FilterBarComponent } from '../shared/components/filter-bar.component';
import { PostCardComponent } from '../shared/components/post-card.component';
import { RepostSheetComponent } from '../shared/components/repost-sheet.component';
import { PostActionsService } from './services/post-actions.service';
import { PlatformService } from './services/platform.service';
import { AuthComponent } from '../pages/auth/auth.component';
import { OnboardingComponent } from '../pages/onboarding/onboarding.component';
import { LocationService } from './services/location.service';
import { SpotlightComponent } from '../pages/tabs/spotlight.component';
import { MeComponent } from '../pages/tabs/me.component';
import { ProgressComponent } from '../pages/progress/progress.component';
import { RewardService } from './services/reward.service';
import { RewardToastComponent } from '../shared/components/reward-toast.component';
import { pointsOf } from './models/impact';
import { helpersOf } from './utils/aftercare';
import { VoiceRecorderService } from './services/voice-recorder.service';
import { CreatePostComponent } from '../pages/post/create-post.component';
import { CreateStoryComponent } from '../pages/story/create-story.component';
import { RepostComponent } from '../pages/post/repost.component';
import { StoryViewerComponent } from '../pages/story/story-viewer.component';
import { SettingsService } from './services/settings.service';
import { ProfileComponent } from '../pages/user/profile.component';
import { TermsComponent } from '../pages/terms/terms.component';
import { PostDetailComponent } from '../pages/post/post-detail.component';
import { ChatRoomComponent } from '../pages/chat/chat-room.component';
import { HomeComponent } from '../pages/tabs/home.component';
import { ViewComponent } from '../pages/tabs/view.component';
import { ShortcutsComponent } from '../pages/tabs/shortcuts.component';
import { routes as APP_ROUTES } from '../app.routes';
import { authGuard } from './guards/auth.guard';
import { TabsComponent } from '../pages/tabs/tabs.component';
import { ReactionsSheetComponent } from '../shared/components/reactions-sheet.component';
import { AdminComponent } from '../pages/admin/admin.component';
import { SearchComponent } from '../pages/search/search.component';
import { ConnectionsComponent } from '../pages/connections/connections.component';
import { DiscoverComponent } from '../pages/tabs/discover.component';
import { SpotlightDetailComponent } from '../pages/spotlight/spotlight-detail.component';
import { MediaImageComponent, MediaVideoComponent } from '../shared/components/media-image.component';
import { SendSheetComponent } from '../shared/components/send-sheet.component';
import { EmojiRowComponent } from '../shared/components/emoji-row.component';
import { UserHoverDirective, UserHoverCardComponent } from '../shared/components/user-hover-card.component';
import { UserHoverService } from '../core/services/user-hover.service';
import { NotificationsComponent } from '../pages/notifications/notifications.component';
import { ChatThread } from '../core/models/types';
import { SUPPORT_EMAIL } from './config';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

/**
 * Render tests. These mount the real components with the real services so a
 * broken binding, a missing import or a template that throws shows up here
 * rather than on someone's phone.
 */

let db: LocalDb;

@Component({ standalone: true, template: '' })
class RouteStubComponent {}

const ROUTES = [
  { path: 'auth', component: RouteStubComponent },
  { path: 'onboarding', component: RouteStubComponent },
  { path: 'home', component: RouteStubComponent },
  { path: 'spotlight', component: RouteStubComponent },
  { path: 'me', component: RouteStubComponent },
  { path: 'settings', component: RouteStubComponent },
  { path: 'tips', component: RouteStubComponent },
  { path: 'search', component: RouteStubComponent },
  { path: 'notifications', component: RouteStubComponent },
  { path: 'user/:id', component: RouteStubComponent },
  { path: 'post/:id', component: RouteStubComponent },
  { path: 'post/:id/edit', component: RouteStubComponent },
  { path: 'spotlight/:id', component: RouteStubComponent },
  { path: 'create/:type', component: RouteStubComponent },
  { path: 'create-story', component: RouteStubComponent },
  { path: 'story/:id', component: RouteStubComponent },
  { path: 'safety', component: RouteStubComponent },
  { path: 'escalate/:postId', component: RouteStubComponent },
  { path: 'location-check/:postId', component: RouteStubComponent },
  { path: 'chat/:threadId', component: RouteStubComponent },
  { path: 'admin', component: RouteStubComponent },
  { path: 'terms', component: RouteStubComponent }
];

function bed(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('lulafind.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* node */ }
  db = new LocalDb(true);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(ROUTES),
      provideIonicAngular(),
      { provide: LULA_API, useValue: new MockApi(db) }
    ]
  });
}

describe('Components render', () => {
  beforeEach(bed);

  it('asks after signup before accessing location and keeps the chosen province when declined', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo();
    const location = TestBed.inject(LocationService);
    const detect = vi.spyOn(location, 'detectLocalArea');
    const f = TestBed.createComponent(OnboardingComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain('OpenStreetMap');
    expect(detect).not.toHaveBeenCalled();
    const selected = f.componentInstance.province;
    f.componentInstance.skipGps();
    f.detectChanges();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(f.componentInstance.province).toBe(selected);
    expect(detect).not.toHaveBeenCalled();
  });

  it('uses a detected area in the saved onboarding profile and retains a manual fallback', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo();
    const location = TestBed.inject(LocationService);
    const detect = vi.spyOn(location, 'detectLocalArea').mockResolvedValue({ province: 'WC', town: 'Cape Town' });
    vi.spyOn(TestBed.inject(DataService), 'refresh').mockResolvedValue();
    const f = TestBed.createComponent(OnboardingComponent);
    f.detectChanges();
    await f.componentInstance.useGps();
    f.detectChanges();
    expect(detect).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.locationPrompt()).toBe(false);
    expect(f.componentInstance.province).toBe('WC');
    expect(f.componentInstance.town).toBe('Cape Town');
    await f.componentInstance.finish();
    expect(auth.user()?.province).toBe('WC');
    expect(auth.user()?.town).toBe('Cape Town');
  });

  it('prioritises local posts only in For you and responds to profile changes', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo();
    const data = TestBed.inject(DataService);
    const original = db.posts().slice(0, 3);
    const posts = [
      { ...original[0], province: 'WC' as const, town: 'Cape Town' },
      { ...original[1], province: 'GP' as const, town: 'Pretoria' },
      { ...original[2], province: 'GP' as const, town: 'Johannesburg' }
    ];
    vi.spyOn(data, 'startAutoSync').mockImplementation(() => {});
    const f = TestBed.createComponent(HomeComponent);
    await auth.updateProfile({ province: 'GP', town: 'Johannesburg' });
    data.feed.set(posts);
    expect(f.componentInstance.displayedFeed().map(p => p.id)).toEqual([posts[2].id, posts[1].id, posts[0].id]);
    await auth.updateProfile({ province: 'WC', town: 'Cape Town' });
    data.feed.set(posts);
    expect(f.componentInstance.displayedFeed()[0].id).toBe(posts[0].id);
    data.setFilter({ scope: 'network' });
    expect(f.componentInstance.displayedFeed().map(p => p.id)).toEqual(posts.map(p => p.id));
    f.destroy();
  });

  it('creates an account without a province, then directs the new member to the location popup', async () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(TestBed.inject(DataService), 'refresh').mockResolvedValue();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const f = TestBed.createComponent(AuthComponent);
    f.componentInstance.startSignup();
    f.componentInstance.signupStep.set(5);
    f.componentInstance.f.displayName = 'New Person';
    f.componentInstance.f.email = 'new.member@example.co.za';
    f.componentInstance.f.password = 'password123';
    f.componentInstance.over18 = true;
    f.componentInstance.terms = true;
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('Select your province');
    expect((f.nativeElement as HTMLElement).querySelector('select')).toBeNull();
    await f.componentInstance.signup();
    expect(auth.user()?.province).toBeNull();
    expect(auth.needsOnboarding()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/onboarding');
    const onboarding = TestBed.createComponent(OnboardingComponent);
    onboarding.detectChanges();
    expect((onboarding.nativeElement as HTMLElement).querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('lets a new member decline location and finish without inventing a province', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signUp({ displayName: 'New Person', email: 'no-location@example.co.za', password: 'password123',
      surname: '', province: null, town: '', over18: true, acceptedTerms: true, otpVerified: true });
    const data = TestBed.inject(DataService);
    vi.spyOn(data, 'refresh').mockResolvedValue();
    const f = TestBed.createComponent(OnboardingComponent);
    f.detectChanges();
    f.componentInstance.skipGps();
    f.componentInstance.next();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('Your province');
    await f.componentInstance.finish();
    expect(auth.user()?.province).toBeNull();
    expect(auth.needsOnboarding()).toBe(false);
    const profile = TestBed.createComponent(MeComponent);
    expect(profile.componentInstance.form.province).toBeNull();
  });

  it('shows the five bottom tabs in the requested order', async () => {
    const f = TestBed.createComponent(TabsComponent);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect([...el.querySelectorAll('ion-tab-button')].map((tab) => tab.textContent?.trim()))
      .toEqual(['Home', 'View', 'Spotlight', 'Notifications', 'Shortcuts']);
    expect(el.querySelector('[tab="chats"]')).toBeNull();
    expect(el.querySelector('.create')).toBeNull();
  });

  it('renders the feed filter bar with a province dropdown', async () => {
    const f = TestBed.createComponent(FilterBarComponent);
    f.componentInstance.filter = emptyFilter();
    f.componentInstance.missingCount = 3;
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('All provinces');
    expect(html).toContain('Gauteng');
    expect(html).toContain('Northern Cape');
    expect(html).toContain('Missing people');
  });

  it('renders a post card with a Follow button', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = { ...(await data.loadPost('p_thato'))! };
    post.body = 'A useful community update with the route, time, and enough context for neighbours to read, share, and decide whether they can help today.';
    post.media = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'm' + n, kind: 'image' as const, src: 'data:image/svg+xml,' }));
    const f = TestBed.createComponent(PostCardComponent);
    f.componentInstance.post = post;
    f.componentInstance.author = (await data.profile('u_demo'))!;
    f.componentInstance.chatState = 'locked-follow';
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Follow');
    // Card anatomy: the name with the granted badge, one quiet line of where
    // and when, three-line clamp with a muted ellipsis, then the stats line.
    // The default reaction is the one LinkedIn's button is - Like - and it
    // reads as its own name, never a yes/no vote. "Have an idea" lives in the
    // tray, not on the button.
    expect(html).toContain('Like');
    expect(html).not.toContain('No idea');
    // Two header lines only: the person's bio belongs on their profile, not
    // stacked as a third line under their name on every card.
    expect(html).not.toContain('fb-headline');
    expect(html).not.toContain('Community organiser');
    // The seeded demo account is verified, so the granted badge renders with a
    // name a screen reader can read.
    expect(html).toContain('fb-verified');
    expect(html).toContain('aria-label="Verified member"');
    expect(html).toContain('fb-clamp');
    expect(html).toContain('see more');
    expect(html).toContain('fb-stats-bar');
    // The kind tags the post itself; the line under the name is where and when.
    // It leads with the town, because "Umlazi, Durban, KwaZulu-Natal" cost more
    // width than a card with a Follow button has - the place name was being cut
    // and the globe pushed away from the words it describes.
    expect(html).toContain('fb-kind');
    expect(html).toContain('Missing person');
    expect(html).toContain('fb-sub-meta__place');
    expect(html).toContain('Orlando West, Soweto');
    expect(html).toContain('fb-sub-meta__when');
    expect(html).not.toContain('fb-chips');
    // The card carries the X-shaped action row: react, comment and repost on
    // the left with their counts, the reaction stack and Send grouped right.
    // Each action keeps a real accessible name even where the glyph is all
    // that is drawn.
    expect(html).toContain('x-bar');
    for (const label of ['Comment', 'Repost', 'Send']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('Choose a reaction');
    expect(html).not.toContain('fb-actions-row');
    expect(html).toContain('fb-head-actions');
    expect(html).toContain('fb-more-btn');
    // the seeded latest activity shows above the post, LinkedIn-style
    expect(html).toContain('Lerato Mahlangu');
    expect(html).toContain('commented on this');
  });

  it('shows what a person sees on a LinkedIn card: reactions, comments, reposts, and the four actions', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    // Real reactions from real people: the stack must reflect what they chose.
    const post = { ...(await data.loadPost('p_thato'))! };
    post.voterIds = { u_a: 'like', u_b: 'like', u_c: 'support' };
    post.upvotes = 3;
    post.commentCount = 2;
    post.shares = 1;

    const f = TestBed.createComponent(PostCardComponent);
    f.componentInstance.post = post;
    f.componentInstance.author = (await data.profile(post.authorId))!;
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();

    const el = f.nativeElement as HTMLElement;

    // The reaction stack shows the kinds people actually gave: two Likes, then Support.
    expect(el.querySelectorAll('.x-avatars lf-reaction-icon').length).toBe(2);
    // X's row rides the count on its own action: reactions, comments, reposts.
    const counts = [...el.querySelectorAll('.x-act__count')].map((c) => (c.textContent ?? '').trim());
    expect(counts).toEqual(['2', '1']);
    // The reaction's own count rides its button, exactly where X puts it.
    expect(el.querySelector('lf-reaction-button .count')?.textContent?.trim()).toBe('3');
    // The four ways to act are all reachable, each with its own name.
    const names = [...el.querySelectorAll('.x-bar [aria-label], .x-bar lf-reaction-button .btn')]
      .map((b) => b.getAttribute('aria-label') ?? '');
    expect(names.join(' ')).toContain('Comment');
    expect(names.join(' ')).toContain('Repost');
    expect(names.join(' ')).toContain('Send');
    expect(names.join(' ')).toContain('Choose a reaction');
    // The summary survives for anything that reads the numbers as one line.
    expect(el.querySelector('.fb-stats-bar')?.textContent).toContain('2 comments');
    expect(el.querySelector('.fb-stats-bar')?.textContent).toContain('1 repost');
  });

  it('leaves the long text boxes uncapped and gives every one of them the phone keyboard features', async () => {
    // Two standing rules, checked where a person would notice them breaking:
    // captured content has no upper limit, and every text box must allow
    // autocorrect, word suggestions, the keyboard's own emoji key and paste.
    const longForm = async (component: unknown, selector: string, label: string, setup?: (f: ComponentFixture<unknown>) => void): Promise<void> => {
      const f = TestBed.createComponent(component as never);
      if (setup) setup(f);
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      const box = (f.nativeElement as HTMLElement).querySelector(selector) as HTMLTextAreaElement | null;
      expect(box, `${label}: ${selector} not found`).toBeTruthy();
      expect(box!.getAttribute('maxlength'), `${label} must have no upper limit`).toBeNull();
      expect(box!.getAttribute('inputmode'), label).toBe('text');
      expect(box!.getAttribute('autocorrect'), label).toBe('on');
      expect(box!.getAttribute('autocomplete'), label).toBe('on');
      expect(box!.getAttribute('spellcheck'), label).toBe('true');
      // Paste is a browser default and was never blocked; the attribute that
      // switches autocorrect off is what would look like "paste is broken".
      expect(box!.getAttribute('autocorrect')).not.toBe('off');
    };

    // The composer shows the body box once a category is chosen, as it does for
    // anyone actually writing a post.
    await longForm(CreatePostComponent, 'textarea[data-field="body"]', 'the case description',
      (f) => (f.componentInstance as CreatePostComponent).setType('missing'));
    await longForm(CreateStoryComponent, 'textarea.caption', 'the story caption');
    await longForm(RepostComponent, 'textarea.thoughts', 'repost thoughts');
  });

  it('keeps the SQL handed to the database free of transaction control that would undo it', async () => {
    // A SQL script run as one piece is one transaction, so a `rollback;` at the
    // end of it silently undoes everything above - the file looks like it ran,
    // and the database is left exactly as it was. An earlier version of the
    // Spotlight file did that: its self-test ended in a rollback, which rolled
    // back the two functions and the policy with it.
    const { readFileSync } = await import('node:fs');
    const read = (name: string): string => readFileSync(`${process.cwd()}/supabase/${name}`, 'utf8');

    const main = read('spotlight-public-read.sql');
    expect(main, 'spotlight-public-read.sql must not contain begin/rollback/commit')
      .not.toMatch(/^\s*(begin|rollback|commit)\s*;/im);
    expect(main, 'and it must install the widening policy').toContain('lula spotlight posts are public reading');
    // Comments explain which helpers are missing, so only the statements are
    // checked - a mention in prose is not a call.
    const statements = main.replace(/^\s*--.*$/gm, '');
    expect(statements, 'and it must not call a helper this database does not have')
      .not.toMatch(/lula_is_self|public\.lula_spotlight_member/);

    // The self-test is a separate file precisely because it rolls back.
    const selfTest = read('spotlight-selftest.sql');
    expect(selfTest).toMatch(/^\s*begin\s*;/im);
    expect(selfTest).toMatch(/^\s*rollback\s*;/im);
  });

  it('never caps attachments with a number written into a file: the rule lives in one place', async () => {
    // The 3-photo cap was written as a literal 4 in four separate files, and in
    // the composer the guard said 4 while the error message next to it said 3 -
    // so a person could add a fourth photo and be told off about "its 3 photos".
    // Every cap now reads POST_MAX_PHOTOS / STORY_MAX_PHOTOS from
    // models/media-rules.ts, and this walks the source to keep it that way.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const candidates: string[] = [`${process.cwd()}/src/app`, `${process.cwd()}/lulafind/src/app`];
    // The runner may serve this file from memory, in which case import.meta.url
    // is not a file: URL and only the working directory can be trusted.
    try { candidates.unshift(fileURLToPath(new URL('..', import.meta.url))); } catch { /* use cwd */ }
    const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };
    const root = candidates.find(isDir);
    expect(root, 'the app source folder must be reachable from the test').toBeTruthy();

    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = `${dir}/${name}`;
      if (isDir(full)) return walk(full);
      return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
    });

    // A cap looks like `something.media.length >= 4`. `x.length >= 2` on a search
    // needle or a list of cleared cases is not a media cap and is left alone.
    const literalCap = /(?:\bmedia\b|\bphotos?\b|\bimages?\b|\battachments?\b|commentMedia\(\)|existingMedia)(?:\([^)]*\))?(?:\.\w+)*\.length\s*>=\s*\d/;
    const offenders: string[] = [];
    for (const file of walk(root!)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (literalCap.test(line)) offenders.push(`${file.split('/').slice(-2).join('/')}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, 'use POST_MAX_PHOTOS / STORY_MAX_PHOTOS instead of a literal cap').toEqual([]);
  });

  it('lets a person see who reacted, with each reaction counted, from the card', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = { ...(await data.loadPost('p_thato'))! };
    // Three real members, two Likes and one Support - the sheet must say so.
    post.voterIds = { u_lerato: 'like', u_kabelo: 'like', u_sipho: 'support' };
    post.upvotes = 3;

    const f = TestBed.createComponent(PostCardComponent);
    f.componentInstance.post = post;
    f.componentInstance.author = (await data.profile(post.authorId))!;
    f.detectChanges();
    await f.whenStable();

    const el = f.nativeElement as HTMLElement;
    // The reaction stack opens the sheet: the faces are the "who", so tapping
    // them is the natural way in.
    const opener = el.querySelector('.x-avatars') as HTMLElement;
    expect(opener).toBeTruthy();
    opener.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();

    const text = (f.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Reactions');
    expect(text).toContain('All 3');
    expect(text).toContain('Lerato Mahlangu');
    expect(text).toContain('Kabelo');
    // The per-reaction tabs carry their own counts: two Likes, one Support.
    const tabs = [...(f.nativeElement as HTMLElement).querySelectorAll('.tabs [role="tab"]')]
      .map((t) => (t.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(tabs).toContain('All 3');
    expect(tabs.filter((t) => t.endsWith('2')).length).toBe(1);
    expect(tabs.filter((t) => t.endsWith('1')).length).toBe(1);
  });

  it('shows the most-relevant comment on the card, as LinkedIn does, and nothing when there is none', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.loadFeed();
    const post = { ...(await data.loadPost('p_thato'))! };
    const author = (await data.profile(post.authorId))!;
    const api = TestBed.inject(LULA_API);

    // The seeded post already carries real comments, so this is the real thing.
    // Stand one comment above every other by likes, the way LinkedIn picks the
    // one it shows, and check that the card shows that one.
    const written = await data.addComment({ postId: post.id, body: 'A neighbour saw him at the clinic on Monday.' });
    await api.saveComment({ ...written, upvotes: 9999, likedIds: ['u_a', 'u_b'] });

    const withComments = TestBed.createComponent(PostCardComponent);
    withComments.componentInstance.post = post;
    withComments.componentInstance.author = author;
    withComments.detectChanges();
    await withComments.whenStable();
    withComments.detectChanges();

    const el = withComments.nativeElement as HTMLElement;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(el.querySelector('.fb-comment')).toBeTruthy();
    expect(text).toContain('A neighbour saw him at the clinic on Monday.');
    // Compacted the way LinkedIn writes big numbers ("10k"), not "9999".
    expect(text).toContain(`${compact(9999)} likes`);

    // With nothing written yet there is no preview - no empty frame, no title.
    const empty = TestBed.createComponent(PostCardComponent);
    empty.componentInstance.post = { ...post, id: 'p_no_comments', commentCount: 0, voterIds: {}, upvotes: 0, shares: 0 };
    empty.componentInstance.author = author;
    empty.detectChanges();
    await empty.whenStable();
    empty.detectChanges();
    expect((empty.nativeElement as HTMLElement).querySelector('.fb-comment')).toBeNull();
  });

  it('shows a selected generated poster in the feed card', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = { ...(await data.loadPost('p_thato'))! };
    post.poster = {
      templateId: 'signal', createdAt: Date.now(),
      media: { id: 'poster-image', kind: 'image', src: 'https://example.test/poster.png' }
    };
    const f = TestBed.createComponent(PostCardComponent);
    f.componentInstance.post = post;
    f.componentInstance.author = (await data.profile(post.authorId))!;
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('fb-media--poster');
    expect(html).toContain('https://example.test/poster.png');
  });

  it('renders a reshared post the way LinkedIn does: reposter line, then the original in a frame', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const original = (await data.loadPost('p_thato'))!;
    const f = TestBed.createComponent(PostCardComponent);
    f.componentInstance.post = {
      ...original,
      id: 'p_repost_mine',
      authorId: original.authorId,
      body: 'Please keep sharing this.',
      repostOf: original.id,
      media: []
    };
    f.componentInstance.author = (await data.profile(original.authorId))!;
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('reposted this');
    expect(html).toContain('fb-embed');
    expect(html).not.toContain('fb-actions-row');
  });

  /** Lets the component's own async work land, without waiting on app-wide timers. */
  async function settle(f: ComponentFixture<unknown>): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 0));
      f.detectChanges();
    }
  }

  it('renders the post page as a post: header, action bar, comments - and no case-details clutter', async () => {
    // Its own module, because this page needs a post id from the route.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES),
        provideIonicAngular(),
        { provide: LULA_API, useValue: new MockApi(new LocalDb(true)) },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p_thato' }), fragment: null } }
        }
      ]
    });
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const f = TestBed.createComponent(PostDetailComponent);
    await settle(f);
    const html: string = (f.nativeElement as HTMLElement).innerHTML;

    expect(html).toContain('Help find Thato Mokoena');
    expect(html).toContain('Comment');
    expect(html).toContain('Repost');
    expect(html).toContain('Send');
    expect(html).toContain('Most relevant');
    // LinkedIn's comment keeps the time in the action row with Like and Reply,
    // not in the header, and the comment itself is not drawn as a chat bubble.
    expect(html).toContain('ctime2');
    expect(html).not.toContain('ccard__time');
    expect(html).toContain('Reply');
    // the things that were taken off this page must stay off it
    expect(html).not.toContain('Case details');
    expect(html).not.toContain('Make a poster');
  });

  it('changes and persists the post status through the Mark as found confirmation', async () => {
    TestBed.overrideProvider(ToastController, { useValue: { create: async () => ({ present: async () => undefined }) } });
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadFeed();
    const f = TestBed.createComponent(PostDetailComponent);
    f.componentInstance.p.set(data.post('p_thato')!);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const open = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Mark as found');
    expect(open).toBeTruthy();
    open!.click();
    f.detectChanges();
    expect(el.querySelector('.sheetwrap')).toBeTruthy();
    const input = el.querySelector('.sheetwrap input') as HTMLInputElement;
    input.value = 'Safe at home';
    input.dispatchEvent(new Event('input'));
    const confirm = [...el.querySelectorAll<HTMLButtonElement>('.sheetwrap button')].find((b) => b.textContent?.includes('Close without naming'))!;
    confirm.click();
    await settle(f);
    expect(f.componentInstance.p()?.status).toBe('found');
    expect(db.post('p_thato')?.status).toBe('found');
    expect(db.post('p_thato')?.outcome.whereaboutsFound).toBe('Safe at home');
    expect(el.querySelector('.sheetwrap')).toBeNull();
    expect(el.textContent).toContain('Found');
  });

  it('lists the people behind a reaction count when the Reactions sheet opens', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = data.post('p_thato')!;
    expect(post.upvotes).toBeGreaterThan(0);
    const voters = Object.keys(post.voterIds);
    expect(voters.length, 'seeded posts must have faces behind the number').toBeGreaterThan(0);

    const f = TestBed.createComponent(ReactionsSheetComponent);
    f.componentRef.setInput('post', post);
    f.componentRef.setInput('open', false);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('Reactions');

    // Opening is the event that loads the list. The loader is an effect(), so
    // the inputs have to be signals for this to fire at all - with plain
    // @Input() fields the sheet opened with tab counts and an empty list.
    f.componentRef.setInput('open', true);
    await settle(f);

    const el = f.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.row');
    expect(el.textContent).toContain('Reactions');
    expect(el.textContent).not.toContain('No reactions yet.');
    expect(rows.length).toBe(voters.length);
    // Each row is a real person with the reaction they gave, plus a Follow button.
    for (const id of voters) expect(el.textContent).toContain(data.authorOf(id)?.displayName ?? '');
    expect(el.textContent).toContain('Follow');
    // The card's bigger number is reconciled, never quietly contradicted.
    if (post.upvotes > voters.length) expect(el.textContent).toContain('reacted from outside this network');
  });

  it('spreads the four post actions across the width, LinkedIn-style', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = data.feed().find((p) => !p.repostOf)!;
    await TestBed.inject(AuthService).signInDemo();
    const f = TestBed.createComponent(PostDetailComponent);
    f.componentInstance.p.set(post);
    await settle(f);
    const el = f.nativeElement as HTMLElement;

    const bar = el.querySelector('.actions');
    expect(bar, 'the action bar is rendered').toBeTruthy();
    const labels = [...bar!.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean);
    // React is the reaction button; the other three are plain buttons.
    expect(labels.join(' ')).toContain('Comment');
    expect(labels.join(' ')).toContain('Repost');
    expect(labels.join(' ')).toContain('Send');
    expect(el.querySelector('lf-reaction-button'), 'React sits in the bar too').toBeTruthy();
  });

  it('keeps the post detail screen free of the community-tool footer and comments filler', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = data.feed().find((p) => !p.repostOf)!;
    const f = TestBed.createComponent(PostDetailComponent);
    f.componentInstance.p.set(post);
    await settle(f);
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('community tool');
    expect(text).not.toContain('No comments yet');
  });

  it('offers read more only when the text is actually cut off', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const short = { ...data.feed().find((p) => !p.repostOf)!, body: 'Short update about the search.' };
    const f = TestBed.createComponent(PostCardComponent);
    f.componentRef.setInput('post', short);
    await settle(f);
    expect(f.nativeElement.querySelector('.fb-readmore'), 'no read-more on text that fits').toBe(null);

    // jsdom has no layout, so give the paragraph the measurements a browser
    // would produce for text that is cut off, then re-render: the component
    // measures the element after every render.
    const text = f.nativeElement.querySelector('.fb-post-text') as HTMLElement;
    Object.defineProperty(text, 'clientHeight', { value: 60, configurable: true });
    Object.defineProperty(text, 'scrollHeight', { value: 300, configurable: true });
    f.detectChanges();
    expect(f.nativeElement.querySelector('.fb-readmore')?.textContent).toContain('see more');
    f.componentInstance.toggleExpand(new Event('click'));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.fb-readmore')?.textContent).toContain('see less');
  });

  it('still saves a case update on a database without lula_patch_post', async () => {
    // The live database was never given the function, and "Still searching"
    // answered with "could not find function public.lula_patch_post". The app
    // must not be blocked on a migration: it falls back to a read-and-write.
    const api = new SupabaseApi();
    const writes: string[] = [];
    (api as unknown as { client: unknown }).client = {
      rpc: async () => ({ error: { message: 'Could not find the function public.lula_patch_post(post_id, patch) in the schema cache', code: 'PGRST202' } })
    };
    (api as unknown as { post: unknown }).post = async (id: string) => ({ id, authorId: 'u_1', body: 'b' });
    (api as unknown as { savePost: unknown }).savePost = async (p: { id: string }) => { writes.push(p.id); return true; };

    const out = await api.patchPost('p_1', { outcomeNudgeAt: 5 });
    expect(writes, 'the change was written the ordinary way').toEqual(['p_1']);
    expect(out?.id).toBe('p_1');
  });

  it('never writes private replies or viewer IDs into an audience-visible Supabase story', async () => {
    const api = new SupabaseApi();
    let written: unknown;
    (api as unknown as { upsert: unknown }).upsert = async (_collection: string, payload: unknown) => { written = payload; };
    const original = db.story(db.stories('u_demo')[0].id)!;
    const reply = { id: 'private-r', storyId: original.id, authorId: 'u_johan', body: 'private', at: Date.now() };
    await api.saveStory({ ...original, replies: [reply], viewers: ['u_johan'] });
    expect(written).toMatchObject({ id: original.id, replies: [], viewers: [] });
  });

  it('explains a refused photo upload on the screen, not in a console', async () => {
    // The old message told the person to run a console command - impossible on a
    // phone, where the installed app has no console at all. The app now asks the
    // database for the verdict and shows it.
    const api = new SupabaseApi();
    const verdict = 'FAIL - the photos storage policies are missing. This script creates them.';
    (api as unknown as { client: unknown }).client = {
      storage: { from: () => ({ upload: async () => ({ error: { message: 'new row violates row-level security policy' } }) }) },
      rpc: async () => ({ data: { verdict, dbUid: null }, error: null })
    };
    (api as unknown as { currentUid: unknown }).currentUid = async () => 'u_1';
    (api as unknown as { storageReport: unknown }).storageReport = async () => ({ ok: false, message: verdict, details: {} });

    await expect(api.uploadMedia('u_1', { id: 'm_1', kind: 'image', src: 'data:image/png;base64,AAAA' } as never))
      .rejects.toThrow(new RegExp(verdict.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('says which script to run when the database has no photo policies at all', async () => {
    const api = new SupabaseApi();
    (api as unknown as { client: unknown }).client = {
      storage: { from: () => ({ upload: async () => ({ error: { message: 'new row violates row-level security policy' } }) }) },
      rpc: async () => ({ data: null, error: { message: 'Could not find the function public.lula_debug_storage(app_uid) in the schema cache' } })
    };
    (api as unknown as { currentUid: unknown }).currentUid = async () => 'u_1';

    await expect(api.uploadMedia('u_1', { id: 'm_1', kind: 'image', src: 'data:image/png;base64,AAAA' } as never))
      .rejects.toThrow(/fix-photo-uploads\.sql/);
  });

  it('tells the person the same thing in the error and the banner when the database cannot see them', async () => {
    // The banner used to say "sign out and sign in" while the error said "you do
    // not need to sign out first" - two halves of the screen contradicting each
    // other, and neither the fix. Now it is one sentence in both places.
    const api = new SupabaseApi();
    const refused = { message: 'new row violates row-level security policy for table "records"', code: '42501' };
    (api as unknown as { client: unknown }).client = {
      from: () => ({ insert: async () => ({ error: refused }), update: () => ({ eq: () => ({ eq: async () => ({ error: refused }) }) }) })
    };
    (api as unknown as { authBridge: unknown }).authBridge = null;
    supabaseNotice.set('');

    let thrown = '';
    try {
      await api.saveComment({
        id: 'c_x', postId: 'p_thato', parentId: null, authorId: 'u_demo', body: 'A comment that the database refuses.',
        createdAt: Date.now(), upvotes: 0, isLead: false
      } as never);
    } catch (e) {
      thrown = (e as Error).message;
    }

    expect(thrown).toBe(IDENTITY_REFUSED_COPY);
    expect(supabaseNotice()).toBe(IDENTITY_REFUSED_COPY);
    // And the words that used to contradict each other are gone for good.
    expect(thrown).not.toMatch(/sign out/i);
    expect(thrown).not.toMatch(/nothing was saved/i);
  });

  it('refuses a photo over 2 MB and a video over 3 MB, and accepts both at the limit', async () => {
    // The size rule, end to end. A real blob is fetched from the data-uri, so
    // the byte counts here are bytes, not a mocked number.
    const api = new SupabaseApi();
    const uploaded: { path: string }[] = [];
    (api as unknown as { client: unknown }).client = {
      storage: { from: () => ({
        upload: async (path: string) => { uploaded.push({ path }); return { error: null }; }
      }) },
      rpc: async () => ({ data: { verdict: 'PASS - uploads should work.' }, error: null })
    };
    (api as unknown as { signedStorageUrl: unknown }).signedStorageUrl = async () => 'signed://photos/ok';

    const fake = (kind: 'image' | 'video', bytes: number): string =>
      `data:${kind === 'video' ? 'video/mp4' : 'image/jpeg'};base64,` + Buffer.alloc(bytes).toString('base64');

    await expect(api.uploadMedia('u_1', { id: 'p_big', kind: 'image', src: fake('image', PHOTO_MAX_BYTES + 1) } as never))
      .rejects.toThrow(/smaller than 2 MB/i);
    await expect(api.uploadMedia('u_1', { id: 'v_big', kind: 'video', src: fake('video', VIDEO_MAX_BYTES + 1) } as never))
      .rejects.toThrow(/smaller than 3 MB/i);

    // Exactly at the limits: accepted, which is what "must not exceed" means.
    await api.uploadMedia('u_1', { id: 'p_ok', kind: 'image', src: fake('image', PHOTO_MAX_BYTES) } as never);
    await api.uploadMedia('u_1', { id: 'v_ok', kind: 'video', src: fake('video', VIDEO_MAX_BYTES) } as never);
    expect(uploaded.map((u) => u.path)).toEqual(['u_1/p_ok.jpg', 'u_1/v_ok.mp4']);
  });

  it('shows a voice note with its own words, and never a "Read it instead" that has nothing behind it', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const base = (await data.loadPost('p_thato'))!;

    // A note the speech engine transcribed: the words sit under the player.
    const spoken = {
      ...base,
      body: 'A body of text that is not the voice note.',
      media: [{ id: 'a1', kind: 'audio' as const, src: 'data:audio/webm;base64,AA', durationSec: 12,
                transcript: 'She was wearing a grey cardigan with a broken zip.' }]
    };
    const withWords = TestBed.createComponent(PostCardComponent);
    withWords.componentInstance.post = spoken;
    withWords.componentInstance.author = (await data.profile('u_demo'))!;
    withWords.detectChanges();
    const html = (withWords.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Read it instead');
    expect(html).toContain('grey cardigan');
    // The post body is not passed off as the transcript: the words appear once,
    // in the note's own "Read it instead", not a second time under the player.
    const spokenHtml = new DOMParser().parseFromString(html, 'text/html');
    const transcriptBlocks = [...spokenHtml.querySelectorAll('.note__text p')].map((p) => p.textContent?.trim());
    expect(transcriptBlocks).toEqual(['She was wearing a grey cardigan with a broken zip.']);

    // A note nobody transcribed: a player, and no promise of text.
    const silent = { ...base, media: [{ id: 'a2', kind: 'audio' as const, src: 'data:audio/webm;base64,AA', durationSec: 5 }] };
    const noWords = TestBed.createComponent(PostCardComponent);
    noWords.componentInstance.post = silent;
    noWords.componentInstance.author = (await data.profile('u_demo'))!;
    noWords.detectChanges();
    const bare = (noWords.nativeElement as HTMLElement).innerHTML;
    expect(bare).toContain('Voice note');
    expect(bare).not.toContain('Read it instead');
  });

  it('stores a voice note as audio, under a name a phone can play, and refuses an oversized one', async () => {
    // A note is already the bytes we want. Sending it through the photo encoder
    // turned it into a JPEG blob and stored it as `u_1/a_1.jpg`, so a published
    // voice note came back as a broken player - on the very post that was meant
    // to carry a family's own words.
    const api = new SupabaseApi();
    const uploaded: { path: string; type: string; bytes: number }[] = [];
    (api as unknown as { client: unknown }).client = {
      storage: { from: () => ({
        upload: async (path: string, blob: Blob) => {
          uploaded.push({ path, type: blob.type, bytes: blob.size });
          return { error: null };
        }
      }) },
      rpc: async () => ({ data: { verdict: 'PASS - uploads should work.' }, error: null })
    };
    (api as unknown as { signedStorageUrl: unknown }).signedStorageUrl = async () => 'signed://photos/note';

    const note = 'data:audio/webm;codecs=opus;base64,' + Buffer.alloc(1024).toString('base64');
    const stored = await api.uploadMedia('u_1', { id: 'a_1', kind: 'audio', src: note, durationSec: 4 } as never);
    expect(uploaded).toEqual([{ path: 'u_1/a_1.webm', type: 'audio/webm', bytes: 1024 }]);
    // The length survives the round trip: the player shows it before playing.
    expect(stored.durationSec).toBe(4);

    // iOS records AAC in an MP4 container, and that gets a .m4a name.
    const ios = 'data:audio/mp4;base64,' + Buffer.alloc(64).toString('base64');
    await api.uploadMedia('u_1', { id: 'a_2', kind: 'audio', src: ios } as never);
    expect(uploaded[1]!.path).toBe('u_1/a_2.m4a');

    // Over the two-minute size rule: refused with a sentence about the note,
    // before a single byte reaches Storage.
    const long = 'data:audio/webm;base64,' + Buffer.alloc(AUDIO_MAX_BYTES + 1).toString('base64');
    await expect(api.uploadMedia('u_1', { id: 'a_3', kind: 'audio', src: long } as never))
      .rejects.toThrow(/too long to upload/i);
    expect(uploaded).toHaveLength(2);
  });

  it('writes a notification owned by the actor, never by the recipient', async () => {
    // The recipient can never own the row: the insert policy compares owner_id
    // with the caller. Falling back to them produced a write the database could
    // only refuse - and every caller awaited it right after saving something.
    const api = new SupabaseApi();
    const written: { collection: string; owner: string | null }[] = [];
    (api as unknown as { putRecord: unknown }).putRecord = async (row: { collection: string; owner_id: string | null }) => {
      written.push({ collection: row.collection, owner: row.owner_id });
      return { error: null };
    };
    const note = {
      id: 'n_1', userId: 'u_recipient', kind: 'missing' as const,
      title: 'A new missing case nearby', body: 'Open the case for the poster.',
      at: Date.now(), read: false, route: '/post/p_1', postId: 'p_1'
    };

    (api as unknown as { authBridge: unknown }).authBridge = { uid: async () => 'u_actor' };
    await api.pushNotification(note);
    expect(written.length, 'the notification was written').toBe(1);
    expect(written[0].owner, 'owned by the actor').toBe('u_actor');

    // No signed-in identity: write nothing rather than a row nobody may own.
    (api as unknown as { authBridge: unknown }).authBridge = { uid: async () => null };
    await api.pushNotification(note);
    expect(written.length, 'nothing written without an actor').toBe(1);
  });

  it('keeps a post that was saved even when the alert fan-out fails', async () => {
    // This is the bug people hit: the post is stored, then the notification
    // fan-out that follows it is refused by the database, and the whole action
    // reports "Nothing was saved. Try again" - while the post is right there in
    // the feed. A failed alert must not rewrite history about the post.
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo();
    const api = TestBed.inject(LULA_API);
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const me = auth.user()!;
    const realPush = api.pushNotification.bind(api);
    api.pushNotification = async () => { throw new Error('new row violates row-level security policy'); };

    try {
      const post = await data.createPost({
        type: 'missing', title: 'Thandi Mokoena last seen in Soweto',
        body: 'She was last seen near the taxi rank in Soweto wearing a blue school uniform.',
        media: [], province: 'GP', town: 'Soweto',
        lastSeenAt: Date.now(), lastSeenWhere: 'Soweto taxi rank', geo: null,
        contactLabel: 'Family contact', contactValue: '082 555 0101',
        contactVisibleTo: 'verified', caseNumber: null, reward: null, guardianConsent: false,
        subject: null, vehicleDetails: null, audience: 'public', spotlightId: null,
        chatEnabled: true, allowComments: true, anonymous: false, askWanted: false,
        khumbu: null, danger: null
      });
      // It came back rather than throwing, it is stored, and it is in the feed.
      expect(post.id).toBeTruthy();
      expect(await api.post(post.id)).toBeTruthy();
      expect(data.feed().some((p) => p.id === post.id), 'the saved post is in the feed').toBe(true);
      expect(post.authorId).toBe(me.id);
    } finally {
      api.pushNotification = realPush;
    }
  });

  it('Send opens a picker: your people in the app, or other apps on the phone', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const actions = TestBed.inject(PostActionsService);
    await auth.signInDemo();
    await data.loadFeed();
    await data.loadUserScoped();

    // A follower and a connection to choose between: the demo account starts
    // with neither, so make one of each - someone who follows me, and someone
    // we follow each other.
    const me = auth.viewerId!;
    const api = TestBed.inject(LULA_API);
    const others = (await api.users()).filter((u) => u.id !== me);
    const follower = others[0];
    const connection = others[1] ?? others[0];
    const following = others[2];
    expect(following).toBeTruthy();
    await api.follow(me, following.id);
    await api.follow(follower.id, me);
    await api.follow(me, connection.id);
    await api.follow(connection.id, me);
    await data.loadUserScoped();

    const post = data.feed().find((p) => !p.repostOf && p.authorId !== me) ?? data.feed()[0];
    await actions.send(post);
    expect(actions.sendTarget()?.id, 'the sheet opened on that post').toBe(post.id);
    for (let i = 0; i < 60 && actions.sendLoading(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(actions.sendPeople().length, 'people can be sent to').toBeGreaterThan(0);
    expect(actions.sendPeople().some((p) => p.connection), 'a connection is marked as such').toBe(true);

    expect(actions.sendPeople().find((p) => p.profile.id === follower.id)?.connection).toBe(true);
    expect(actions.sendPeople().find((p) => p.profile.id === following.id)?.connection).toBe(true);

    // Anyone shown can receive a notification; chat also respects messaging settings.
    for (const person of actions.sendPeople()) {
      expect(person.profile.id, 'never yourself').not.toBe(me);
    }

    // The sheet itself: the people list, and the way out to other apps.
    const f = TestBed.createComponent(SendSheetComponent);
    f.detectChanges();
    await f.whenStable();
    const sheet = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(sheet).toContain('Send');
    const search = f.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search?.placeholder, 'there is a search box for people').toBe('Search people');
    expect(sheet).toContain('Share to other apps');
    expect(sheet).toContain('WhatsApp');

    const recipient = actions.sendPeople()[0];
    {
      expect(sheet, 'the people you can send to are listed').toContain(recipient.profile.displayName);
      const delivered: { userId: string; title: string; postId: string | null }[] = [];
      api.pushNotification = async (n) => { delivered.push({ userId: n.userId, title: n.title, postId: n.postId }); };
      await actions.sendToUser(recipient);
      expect(delivered.length, 'the post reached them as a notification').toBe(1);
      expect(delivered[0].userId).toBe(recipient.profile.id);
      expect(delivered[0].title).toContain(auth.user()!.displayName);
      expect(delivered[0].postId).toBe(post.id);
      expect(actions.sendTarget(), 'the sheet closed itself').toBe(null);
    }

    // The other half of LinkedIn's Send: the phone's own share sheet.
    let shared: { title: string; url?: string } | null = null;
    const platform = TestBed.inject(PlatformService);
    platform.share = async (title: string, _text: string, url?: string) => { shared = { title, url }; return 'native'; };
    await actions.send(post);
    await actions.shareExternally();
    expect(shared, 'Share to other apps asked the phone to share').toBeTruthy();
    expect(shared!.url).toContain(`/post/${post.id}`);
  });

  it('searches the Send picker by name', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const actions = TestBed.inject(PostActionsService);
    await auth.signInDemo();
    await data.loadFeed();
    await data.loadUserScoped();
    await actions.send(data.feed()[0]);
    const all = actions.sendPeople();
    if (!all.length) return;
    const first = all[0].profile.displayName;
    expect(actions.matches(first.slice(0, 4)).some((p) => p.profile.displayName === first)).toBe(true);
    expect(actions.matches('zzzz-no-such-person').length).toBe(0);
  });

  it('offers the whole LinkedIn repost sheet: Repost, with your thoughts, and Undo', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const actions = TestBed.inject(PostActionsService);
    await auth.signInDemo();
    await data.loadFeed();
    const post = data.feed().find((p) => !p.repostOf && p.authorId !== auth.viewerId)!;

    await actions.openRepost(post);
    const f = TestBed.createComponent(RepostSheetComponent);
    TestBed.flushEffects?.();
    f.detectChanges();
    await f.whenStable();
    let text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(actions.repostTarget()?.id).toBe(post.id);
    expect(text).toContain('Repost');
    expect(text).toContain('Repost with your thoughts');
    expect(text).toContain('Instantly bring this post to others');

    // Reposting puts it on your feed, and the sheet then offers to undo it.
    await actions.repostNow();
    expect(data.feed().some((p) => p.repostOf === post.id), 'the repost is in the feed').toBe(true);
    await actions.openRepost(post);
    f.detectChanges();
    await f.whenStable();
    text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Undo repost');
  });

  it('offers React, Comment, Repost and Send on every feed card', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const post = data.feed().find((p) => !p.repostOf)!;
    const f = TestBed.createComponent(PostCardComponent);
    f.componentRef.setInput('post', post);
    await settle(f);
    const el = f.nativeElement as HTMLElement;

    // The bar exists in the markup, not only in the component's handlers. The
    // reaction still calls itself Like (in its accessible name and its tray),
    // and the other three carry their own names.
    const names = [...el.querySelectorAll('.x-bar button')].map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.join(' '), 'the default reaction is still called Like').toContain('Like');
    expect(names.join(' ')).toContain('Comment');
    expect(names.join(' ')).toContain('Repost');
    expect(names.join(' ')).toContain('Send');

    // A keyboard tap on React emits the reaction the app records, and Comment
    // opens the post's comments - the two things a feed post must be able to
    // do. (Pointer taps are covered by the reaction-button's own suite; a
    // synthetic .click() on the host is deliberately meaningless.)
    const votes: string[] = [];
    const comments: number[] = [];
    f.componentInstance.vote.subscribe((v) => votes.push(v));
    f.componentInstance.comment.subscribe(() => comments.push(1));
    const reactBtn = el.querySelector('.x-bar lf-reaction-button .btn') as HTMLButtonElement;
    reactBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    expect(el.querySelectorAll('.tray .opt').length).toBe(4);
    (el.querySelector('.tray .opt[data-key="like"]') as HTMLButtonElement).click();
    (el.querySelector('.x-bar button[aria-label="Comment"]') as HTMLButtonElement).click();
    expect(votes).toEqual(['like']);
    expect(comments.length).toBe(1);
  });

  it('does not insert a story rail before the feed reaches post eight', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const feed = data.feed();

    // The threshold is a pure rule, so test it directly. This used to lean on
    // the guest feed being cut to four posts, which is why removing guest
    // browsing made it fail - the rule never changed.
    expect(feedWithRails(feed.slice(0, 7)).some((s) => s.kind === 'stories')).toBe(false);
    expect(feedWithRails(feed.slice(0, 8)).some((s) => s.kind === 'stories')).toBe(true);

    const f = TestBed.createComponent(HomeComponent);
    await settle(f);
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('lf-post-card');
    // Story cards no longer interrupt For you. They are rendered only in the
    // explicit Home → Network context.
    expect(html).not.toContain('network-stories');
  });

  it('shows the story rail in View independently of feed length, not in Network', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadStatic();
    data.setFilter({ scope: 'network' });
    const home = TestBed.createComponent(HomeComponent);
    await settle(home);
    const homeEl = home.nativeElement as HTMLElement;
    expect(homeEl.querySelector('.network-context')).toBeTruthy();
    expect(homeEl.querySelector('lf-story-rail')).toBeNull();
    expect(homeEl.querySelector('lf-post-card')).toBeNull();
    for (const label of ['Following', 'Followers', 'Follow requests']) expect(homeEl.textContent).toContain(label);
    const view = TestBed.createComponent(ViewComponent);
    await settle(view);
    const el = view.nativeElement as HTMLElement;
    expect(el.querySelector('lf-story-rail')).toBeTruthy();
    for (const label of ['Following', 'Followers', 'Public', 'Statuses']) expect(el.textContent).toContain(label);
    const publicButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Public')!;
    publicButton.click();
    await settle(view);
    expect(view.componentInstance.scope()).toBe('public');
    expect(el.textContent).toContain('Public status browsing is not available');
  });

  it('sends a visitor who is not signed in to the login screen, not to Home', async () => {
    const auth = TestBed.inject(AuthService);
    expect(auth.signedIn()).toBe(false);
    // The whole app shell is guarded: Home, Spotlight, Chats, Discover and the
    // menu live under it, so none of them can paint for a visitor without an
    // account. Only the auth screen itself stays open.
    const shell = APP_ROUTES.find((r) => r.path === '')!;
    expect(shell.canActivate, 'the app shell must require an account').toContain(authGuard);
    expect(APP_ROUTES.find((r) => r.path === 'auth')!.canActivate ?? []).toEqual([]);

    const decision = await TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/home' } as never));
    // A UrlTree, not a boolean: the router sends them to the login screen and
    // remembers where they were going.
    expect(String(decision)).toContain('/auth');
    expect(String(decision)).toContain('next');
  });

  it('waits for the session check before deciding, so a reload never throws a member out', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo(); // a real stored session, as after signing in yesterday
    // Enter a guarded route during a cold start, before the check has landed:
    // signedIn() is false at this instant even though the member is signed in.
    expect(auth.ready()).toBe(false);
    const decision = await TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/home' } as never));
    expect(auth.ready(), 'the guard waited for the real answer').toBe(true);
    expect(decision, 'a signed-in member goes straight in').toBe(true);
  });

  it('renders the LulaFind welcome and login screens', async () => {
    const f = TestBed.createComponent(AuthComponent);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const html: string = el.innerHTML;

    expect(html).toContain('Continue with Google');
    expect(html).toContain('Create new account');
    expect(html).toContain('Log In with email');
    // Guest browsing was removed: everyone signs in or signs up.
    expect(html).not.toContain('Browse as guest');

    // switch to signin mode
    f.componentInstance.mode.set('signin');
    f.detectChanges();
    await f.whenStable();
    const loginHtml: string = (f.nativeElement as HTMLElement).innerHTML;

    expect(loginHtml).toContain('Email address');
    expect(loginHtml).toContain('Password');
    expect(loginHtml).toContain('Log in');
    expect(loginHtml).toContain('Forgot your password?');
  });

  it('offers Create Account on the login screen instead of the save-login-info tick', async () => {
    const f = TestBed.createComponent(AuthComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.mode.set('signin');
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;

    expect(el.innerHTML).not.toContain('Save Login Info');
    expect(el.querySelector('input[type="checkbox"]'), 'no tick box on the login form').toBe(null);
    expect(el.textContent).toContain("Don't have an account?");
    const link = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create Account');
    expect(link, 'Create Account must be a real button').toBeTruthy();
    link!.click();
    f.detectChanges();
    await f.whenStable();
    // It takes you to the sign-up flow, not to a dead end.
    expect(f.componentInstance.mode()).toBe('signup');
  });

  it('still keeps the login on the device after signing in', async () => {
    // The row that said "Save Login Info on your device" is gone, but the
    // session is still remembered by the sign-in itself - it must not be lost.
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo();
    expect(localStorage.getItem('lulafind.auth.signedIn'), 'sign-in marker written').toBeTruthy();
    const stored = JSON.parse(localStorage.getItem('lulafind.auth.session') ?? 'null');
    expect(stored, 'session kept on the device').toBeTruthy();
  });

  it('shows the five-step LulaFind signup flow', async () => {
    const f = TestBed.createComponent(AuthComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.startSignup();
    f.detectChanges();
    await f.whenStable();

    expect(f.componentInstance.signupStep()).toBe(1);
    const form1: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(form1).toContain("What's your name?");
    expect(form1).toContain('Agree and continue');

    // Fill name and go to Step 2
    f.componentInstance.f.displayName = 'John Doe';
    f.componentInstance.nextStep();
    f.detectChanges();
    await f.whenStable();

    expect(f.componentInstance.signupStep()).toBe(2);
    expect(f.componentInstance.usernamePreview()).toBe('doe');
  });

  it('renders the Spotlight tab as one searchable list with A-Z letters', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    // The View / Create toggle is gone: the list is the page, and the filter
    // sits beside the search field.
    expect(html).not.toContain('>View<');
    expect(html).toContain('All provinces');
    expect(html).toContain('Ndlela');
    // picking a letter narrows the list
    f.componentInstance.letter.set('N');
    f.detectChanges();
    expect(f.componentInstance.list().map((s) => s.surname)).toEqual(['Ndlela']);
    f.componentInstance.letter.set('B');
    f.detectChanges();
    expect(f.componentInstance.list().map((s) => s.surname)).toEqual(['Botha']);
  });

  it('filters the Spotlight list by province, including every province', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    await f.whenStable();
    const all = f.componentInstance.list().length;
    const provinces = [...new Set(data.spotlights().map((s) => s.province))];
    const one = provinces.find((p) => p)!;
    f.componentInstance.province.set(one);
    f.detectChanges();
    const narrowed = f.componentInstance.list();
    expect(narrowed.length).toBeLessThan(all);
    expect(narrowed.every((s) => s.province === one)).toBe(true);
    f.componentInstance.province.set('all');
    f.detectChanges();
    expect(f.componentInstance.list().length).toBe(all);
  });

  it('searches posts from the Spotlight tab and says where each was filed', async () => {
    const data = TestBed.inject(DataService);
    await data.refresh();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onQuery('Ndlela');
    await f.whenStable();
    const filed = data.spotlights().find((s) => s.surname === 'Ndlela');
    expect(filed).toBeTruthy();
    // every post result filed to a Spotlight can name it
    for (const p of f.componentInstance.posts()) {
      if (p.spotlightId) expect(f.componentInstance.spotlightOf(p)?.id).toBe(p.spotlightId);
    }
    f.componentInstance.onQuery('');
    expect(f.componentInstance.posts()).toEqual([]);
  });

  it('cancels out of the create Spotlight form without creating anything', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.openCreate('Mkhungela');
    f.detectChanges();
    expect(f.componentInstance.mode()).toBe('create');
    expect((f.nativeElement as HTMLElement).innerHTML).toContain('Cancel');
    f.componentInstance.cancelCreate();
    f.detectChanges();
    expect(f.componentInstance.mode()).toBe('view');
    expect(f.componentInstance.form.surname).toBe('');
  });

  it('flags a duplicate surname in the same province while you type', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    f.componentInstance.form.surname = 'Ndlela';
    f.componentInstance.form.province = 'KZN';
    f.detectChanges();
    expect(f.componentInstance.duplicate()).toBeTruthy();
    expect(f.componentInstance.surnameError()).toBe('');
    f.componentInstance.form.province = 'GP';
    f.detectChanges();
    expect(f.componentInstance.duplicate()).toBeNull();
    f.componentInstance.form.surname = 'X';
    f.detectChanges();
    expect(f.componentInstance.surnameError()).toBeTruthy();
  });

  it('renders the composer and offers options', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('What are you posting?');
    expect(html).toContain('Missing person');
    expect(f.componentInstance.mySpotlights().map((s: any) => s.surname)).toEqual(['Mokoena']);

    f.componentInstance.setType('missing');
    f.detectChanges();
    const composer = f.nativeElement as HTMLElement;
    const composerHtml = composer.innerHTML;
    const contentInputs = composer.querySelectorAll('textarea');
    expect(composerHtml).toContain('Fill in what you know');
    // The promise that makes the form possible: nothing here is final.
    expect(composerHtml).toContain('add it later from the post itself');
    expect(composerHtml).toContain('Generate');
    expect(composerHtml).not.toContain('Short heading');
    expect(composerHtml).not.toContain('Story');
    expect(contentInputs).toHaveLength(1);
    expect((contentInputs[0] as HTMLTextAreaElement).value).toContain('Full name:');
    expect((contentInputs[0] as HTMLTextAreaElement).value).toContain('What happened:');
    /*
     * The prompts ask only what a case cannot exist without. Clothing, the SAPS
     * case number and contact details used to be asked here *and* again in the
     * optional panel - the same question twice, which read as a form that does
     * not trust you. They live in the panel alone now.
     */
    const prompts = (contentInputs[0] as HTMLTextAreaElement).value;
    for (const deferred of ['Clothing', 'SAPS case number', 'Contact details']) {
      expect(prompts, deferred).not.toContain(deferred);
    }

    f.componentInstance.patch({ body: 'Full name:\nAma Ndlovu\nAge:\n14\nGender:\nFemale\nLocation (town/suburb, province):\nSoweto, Gauteng\nWhen last seen:\n2026-09-30T10:20\nWhat happened:\nAma was last seen walking home from school after her afternoon class.\nClothing / identifying details:\nBlue school uniform' });
    expect(f.componentInstance.templateValues()).toMatchObject({
      name: 'Ama Ndlovu', age: 14, gender: 'female', town: 'Soweto', province: 'GP', clothing: 'Blue school uniform'
    });
    expect(f.componentInstance.childCase()).toBe(true);

    await f.componentInstance.openGenerator();
    f.detectChanges();
    await f.whenStable();
    const previewHtml = (f.nativeElement as HTMLElement).innerHTML;
    expect(previewHtml).toContain('Choose a design');
    expect(previewHtml).toContain('<canvas');
    expect(previewHtml).toContain('No photo attached');
    expect(previewHtml).toContain('Editorial');
    await f.componentInstance.chooseTemplate('editorial');
    f.componentInstance.useGeneratedDesign();
    f.detectChanges();
    expect(f.componentInstance.posterTemplate()).toBe('editorial');
  });

  it('previews a generated poster with or without its attached photo', async () => {
    await TestBed.inject(AuthService).signInDemo();
    await TestBed.inject(DataService).loadStatic();
    const OriginalImage = globalThis.Image;
    class ReadyImage {
      width = 400;
      height = 600;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    globalThis.Image = ReadyImage as unknown as typeof Image;
    try {
      const f = TestBed.createComponent(CreatePostComponent);
      f.detectChanges();
      await f.whenStable();
      f.componentInstance.setType('missing');
      const photo = { id: 'poster-preview-photo', kind: 'image' as const, src: 'data:image/png;base64,AA==' };
      f.componentInstance.f.update((form) => ({ ...form, media: [photo] }));
      await f.componentInstance.openGenerator();
      f.detectChanges();
      let html = (f.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('With photo');
      expect(html).toContain('Text only');
      expect(html).toContain('Preview includes your first attached photo.');

      await f.componentInstance.setPreviewPhoto(false);
      f.detectChanges();
      html = (f.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('Preview without the photo; the published design includes your attached photo.');
    } finally {
      globalThis.Image = OriginalImage;
    }
  });

  it('attaches a photo selected from the bottom navigation to the composer', async () => {
    await TestBed.inject(AuthService).signInDemo();
    await TestBed.inject(DataService).loadStatic();
    const photo = { id: 'nav-photo', kind: 'image' as const, src: 'data:image/png;base64,AA==' };
    window.history.replaceState({ ...window.history.state, photoAttachment: photo, mediaNotice: 'Picker fallback used.' }, document.title, window.location.href);

    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();

    expect(f.componentInstance.f().media).toContainEqual(photo);
    expect(f.componentInstance.notice()).toBe('Picker fallback used.');
    expect(window.history.state.photoAttachment).toBeUndefined();
  });

  it('publishes the filled prompt as plain text when Generate was not chosen', async () => {
    TestBed.overrideProvider(ToastController, { useValue: { create: async () => ({ present: async () => undefined }) } });
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.setType('missing');
    f.componentInstance.patch({
      body: 'Full name:\nAma Ndlovu\nAge:\n14\nGender:\nFemale\nLocation (town/suburb, province):\nSoweto, Gauteng\nWhen last seen:\n2026-09-30T10:20\nWhat happened:\nAma was last seen leaving school shortly after lessons ended. She did not arrive at home, and her family checked the usual route, shops and taxi stop. Please contact the family if you personally see her.\nClothing / identifying details:\nBlue school uniform',
      guardianConsent: true
    });
    await f.componentInstance.submit();
    const post = data.myAuthored().find((item) => item.subject?.name === 'Ama Ndlovu');
    expect(post).toBeTruthy();
    expect(post).toMatchObject({ type: 'missing', status: 'under_review', town: 'Soweto', province: 'GP' });
    expect(post?.subject).toMatchObject({ name: 'Ama Ndlovu', age: 14, gender: 'female', clothing: 'Blue school uniform' });
    expect(post?.body).toContain('Ama was last seen leaving school');
    expect(post?.body).not.toContain('Full name:');
    expect(post?.poster).toBeUndefined();

    const card = TestBed.createComponent(PostCardComponent);
    card.componentInstance.post = post!;
    card.componentInstance.author = data.authorOf(post!.authorId) ?? null;
    card.detectChanges();
    expect((card.nativeElement as HTMLElement).innerHTML).toContain('see more');
  });

  it('keeps account links and the saved-cases entry on Profile', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadFeed();
    await data.loadStatic();

    const f = TestBed.createComponent(MeComponent);
    f.detectChanges();
    await f.whenStable();

    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Posts');
    expect(el.querySelector('a[routerlink="/saved"]')).toBeTruthy();
    expect(el.querySelector('.quick')).toBeNull();
    expect(el.textContent).toContain('followers');
    expect(el.textContent).toContain('following');
    expect(el.textContent).toContain('Your impact');
    expect(el.querySelector('a[routerlink="/settings"]')).toBeTruthy();
    expect(el.querySelector('a[routerlink="/progress"]')).toBeTruthy();

  });

  it('keeps profile and account actions out of Shortcuts without removing useful tools', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const f = TestBed.createComponent(ShortcutsComponent);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const hrefs = Array.from(el.querySelectorAll('main a')).map((a) => a.getAttribute('href'));
    for (const path of ['/me', '/connections', '/progress', '/settings', '/create-story', '/saved']) {
      expect(hrefs).not.toContain(path);
    }
    for (const path of ['/safety', '/tips', '/found', '/faqs', '/help']) {
      expect(hrefs).toContain(path);
    }
    expect(el.querySelector('main')?.textContent).not.toContain('Sign out');
  });

  it('shows the member their impact, the next step and the honest list of what counts', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadFeed();
    await data.loadStatic();

    // A member who has given nothing still gets a level, a reason and one step.
    const f = TestBed.createComponent(ProgressComponent);
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('Neighbour');
    expect(text).toContain('What counts');
    expect(text).toContain('Never counted');
    expect(text).toContain('Badges');
    // Several badges are locked for a fresh account, and each still says how.
    const locked = Array.from(el.querySelectorAll('.badge')).filter((b) => !b.classList.contains('on'));
    expect(locked.length).toBeGreaterThan(0);
    for (const b of locked) expect((b.textContent ?? '').trim().length).toBeGreaterThan(12);

    // A member with real work sees the badges and a level that moved.
    const me = auth.user()!;
    await TestBed.inject(LULA_API).saveUser({
      ...me,
      impact: { signals: 4, searches: 3, posters: 1, communities: 1, care: 1 },
      contributorCredits: 1
    });
    auth.syncUser({ ...me, impact: { signals: 4, searches: 3, posters: 1, communities: 1, care: 1 }, contributorCredits: 1 });
    const rich = TestBed.createComponent(ProgressComponent);
    await settle(rich);
    const richText = rich.nativeElement.textContent ?? '';
    // 4 leads (20) + 3 areas (45) + 1 poster (10) + 1 community (20) + 1 check (25) + 1 find (50) = 170
    expect(richText).toContain('170 points');
    expect(richText).toContain('Level 3');
    expect(richText).toContain('30 to Guide');
    const earned = Array.from((rich.nativeElement as HTMLElement).querySelectorAll('.badge.on'));
    expect(earned.length).toBeGreaterThanOrEqual(4);
  });

  it('thanks a person where they are when their work is counted, and opens their impact', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const rewards = TestBed.inject(RewardService);
    await auth.signInDemo();
    await data.loadStatic();

    // Start from nothing: a member who has never been counted. The seeded members
    // already carry a tally, and a badge you already hold is not news.
    auth.syncUser({ ...auth.user()!, impact: { signals: 0, searches: 0, posters: 0, communities: 0, care: 0 }, contributorCredits: 0 });
    TestBed.inject(LULA_API);
    // An award is visible: the toast is not a hidden side effect of a profile write.
    // The first poster is also a badge, and a badge outranks the points it came with.
    await data.awardOnce('test:poster:p_harness', 'posters', 'Every wall it reaches is one more pair of eyes.');
    const f = TestBed.createComponent(RewardToastComponent);
    f.detectChanges();
    let html = (f.nativeElement as HTMLElement).innerHTML;
    // "First step" comes with the very first thing anyone does, so the badge that
    // travels with a poster is the poster one - not a welcome that repeats itself.
    expect(html).toContain('Badge earned: Poster in hand');
    expect(html).toContain('Put a case poster out where people pass.');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(rewards.moment()?.totalAfter).toBe(10);

    // The same act never pays twice.
    expect(await data.awardOnce('test:poster:p_harness', 'posters', 'again')).toBe(false);
    expect(pointsOf(auth.user()!)).toBe(10);

    // An ordinary lead with no new badge just says what it was worth.
    rewards.dismiss();
    await data.awardOnce('test:lead:c_harness', 'signals', 'That lead is on the case now.');
    f.detectChanges();
    f.detectChanges();
    html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('+5 points');
    expect(html).toContain('That lead is on the case now.');

    // Crossing a level is announced once, in the person's own terms.
    rewards.dismiss();
    await data.awardOnce('test:care:l_harness', 'care', 'You answered a safety check.');
    f.detectChanges();
    html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('You are now a Helper');
    expect(html).toContain('You have given the network something it could use.');

    // Tapping it goes to the impact screen - the toast is a door, not a trophy.
    const nav = TestBed.inject(Router);
    const go = vi.spyOn(nav, 'navigate').mockResolvedValue(true);
    f.componentInstance.open({ badge: { id: 'posterman' } });
    expect(go).toHaveBeenCalledWith(['/progress'], expect.anything());
    expect(rewards.moment()).toBeNull();
    go.mockRestore();
  });

  it('takes a newly published case straight to its poster, because that is what reaches people', async () => {
    TestBed.overrideProvider(ToastController, { useValue: { create: async () => ({ present: async () => undefined }) } });
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadStatic();
    const nav = TestBed.inject(Router);
    const go = vi.spyOn(nav, 'navigate').mockResolvedValue(true);

    // A missing-person case carries a printable poster, so publishing ends there.
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.setType('missing');
    f.componentInstance.patch({
      body: 'Full name:\nSipho Dlamini\nAge:\n9\nGender:\nMale\nLocation (town/suburb, province):\nSoweto, Gauteng\nWhen last seen:\n2026-10-02T16:00\nWhat happened:\nSipho walked home from the shop on the corner and did not arrive. His family have searched the usual places and spoken to neighbours, and they are asking anyone who passes the park to look.\nClothing / identifying details:\nRed T-shirt, blue shorts',
      guardianConsent: true
    });
    await f.componentInstance.submit();
    const casePost = data.myAuthored().find((item) => item.subject?.name === 'Sipho Dlamini');
    expect(casePost).toBeTruthy();
    expect(go).toHaveBeenLastCalledWith(['/post', casePost!.id, 'poster'], { queryParams: { new: '1' } });

    // A status update has no poster, so it goes home rather than to a dead end.
    go.mockClear();
    const g = TestBed.createComponent(CreatePostComponent);
    g.detectChanges();
    await g.whenStable();
    g.componentInstance.setType('sighting');
    g.componentInstance.patch({ body: 'A boy in a red T-shirt and blue shorts was seen near the park gates at 07:00.' });
    // A sighting needs no poster; the photo the person attached is enough to publish.
    g.componentInstance.f.update((v) => ({ ...v, media: [{ id: 'sighting-photo', kind: 'image' as const, src: 'data:image/png;base64,AA==' }] }));
    await g.componentInstance.submit();
    expect(g.componentInstance.error()).toBe('');
    expect(go).toHaveBeenCalledWith(['/home']);
    go.mockRestore();
  });

  it('lets a family thank the people who helped, once, and only the ones who did', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadStatic();
    const seed = db.posts().find((p) => p.id === 'p_thato')!;
    // The seeded case has two people marked as looking and a lead in its comments.
    expect(seed.lookingIds?.length ?? 0).toBeGreaterThan(0);
    const helpers = helpersOf(seed, db.comments().filter((c) => c.postId === seed.id));
    expect(helpers.length).toBeGreaterThan(0);

    // A case that is still open cannot be thanked: there is nothing to say yet.
    await expect(data.thankHelpers(seed.id, '')).rejects.toThrow(/Close the case first/);

    const closed = await data.markFound(seed.id, { whereabouts: 'Home in Orlando West' });
    expect(closed?.outcome.found).toBe(true);

    const result = await data.thankHelpers(seed.id, 'Thank you for giving up your Saturday.');
    expect(result.sent).toBe(helpers.length);

    // Each helper gets one message, in the family's words, that says what they did.
    for (const helper of helpers) {
      const inbox = await TestBed.inject(LULA_API).notifications(helper.userId);
      const note = inbox.find((n) => n.kind === 'outcome' && n.postId === seed.id && n.title.startsWith('A thankyou'));
      expect(note, helper.userId).toBeTruthy();
      expect(note!.body).toContain('Thank you for giving up your Saturday.');
      expect(note!.body).toContain('you ');
      expect(note!.route).toBe(`/post/${seed.id}`);
    }

    // The poster is not thanked for their own case.
    const posterInbox = await TestBed.inject(LULA_API).notifications(seed.authorId);
    expect(posterInbox.some((n) => n.title.startsWith('A thankyou'))).toBe(false);

    // It is recorded on the case, and never sent twice.
    const after = data.post(seed.id)!;
    expect(after.outcome.thankedCount).toBe(helpers.length);
    expect(after.outcome.thankedAt).toBeGreaterThan(0);
    await expect(data.thankHelpers(seed.id, 'again')).rejects.toThrow(/already thanked/);
  });

  it('refuses a thankyou from anyone but the family who posted the case', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const seed = db.posts().find((p) => p.id === 'p_thato')!;
    await data.markFound(seed.id, { whereabouts: 'Home' });
    // Signed in as someone else entirely - an admin, even, because the note is
    // signed by whoever sends it and a family's words are only theirs.
    await auth.signInDemo();
    const admin = db.user('u_demo')!;
    (auth as unknown as { user: { set(v: unknown): void } }).user
      .set({ ...admin, id: 'u_mod', displayName: 'Moderator', isAdmin: true, onboarded: true });
    await expect(data.thankHelpers(seed.id, 'thanks')).rejects.toThrow(/Only the person who posted/);
  });

  it('publishes a case from the few prompts, and the optional details land where they belong', async () => {
    TestBed.overrideProvider(ToastController, { useValue: { create: async () => ({ present: async () => undefined }) } });
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.setType('missing');

    // Only the prompts are filled - this is the whole "what you know" path.
    f.componentInstance.patch({
      body: 'Full name:\nLindiwe Sithole\nAge:\n16\nGender:\nFemale\nLocation (town/suburb, province):\nSoweto, Gauteng\nWhen last seen:\n2026-10-01T07:30\nWhat happened:\nLindiwe left for school and did not arrive. Her family have checked the clinic, the taxi rank and her friends\u2019 homes.',
      guardianConsent: true
    });
    const missing = f.componentInstance.missing().map((m) => m.key);
    expect(missing).toEqual([]);
    expect(f.componentInstance.childCase()).toBe(true);

    // Details that were deferred are still reachable, and are stored on the subject.
    (f.componentInstance as unknown as { moreOpen: { set(v: boolean): void } }).moreOpen.set(true);
    f.componentInstance.patchSubject({ clothing: 'Grey school tracksuit' });
    f.detectChanges();
    // The deferred fields are in the panel, labelled as skippable.
    const panelHtml = (f.nativeElement as HTMLElement).innerHTML;
    expect(panelHtml).toContain('Add person and case details');
    expect(panelHtml).toContain('Clothing or identifying details');

    await f.componentInstance.submit();
    const post = data.myAuthored().find((item) => item.subject?.name === 'Lindiwe Sithole');
    expect(post).toBeTruthy();
    expect(post!.subject?.clothing).toBe('Grey school tracksuit');
    // The public words stay the story, not a form dump.
    expect(post!.body).toContain('Lindiwe left for school');
    expect(post!.body).not.toContain('Full name:');
  });

  it('records a voice note by holding, slides left to cancel and up to lock', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const recorder = TestBed.inject(VoiceRecorderService);
    await auth.signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.setType('missing');

    // A fake recorder shaped like the real one: the promise stays pending while
    // recording, and resolves only when the person stops or cancels.
    let live = false;
    let cancelled = 0;
    let stopped = 0;
    let settle: ((n: unknown) => void) | null = null;
    const note = { id: 'a1', kind: 'audio' as const, src: 'data:audio/webm;base64,AA', durationSec: 4 };
    vi.spyOn(recorder, 'record').mockImplementation(() => {
      live = true;
      recorder.recording.set(true);
      return new Promise((resolve) => { settle = resolve; }) as never;
    });
    vi.spyOn(recorder, 'stop').mockImplementation(() => {
      live = false;
      stopped += 1;
      recorder.recording.set(false);
      settle?.(note);
      settle = null;
    });
    vi.spyOn(recorder, 'cancel').mockImplementation(() => {
      live = false;
      cancelled += 1;
      recorder.recording.set(false);
      recorder.locked.set(false);
      settle?.(null);
      settle = null;
    });
    Object.defineProperty(recorder, 'available', { get: () => true });

    const down = (x: number, y: number): PointerEvent => ({ clientX: x, clientY: y, pointerId: 1, preventDefault() {} } as unknown as PointerEvent);

    // Hold: recording starts on touch-down, not on release, so no first word is lost.
    f.componentInstance.voiceDown(down(200, 500));
    await new Promise((r) => setTimeout(r, 0));
    expect(live).toBe(true);
    // Nothing is attached while the finger is still down.
    expect(f.componentInstance.hasVoiceNote()).toBe(false);

    // Slide left past the threshold, then release: thrown away, nothing attached.
    f.componentInstance.voiceDown(down(200, 500));
    await new Promise((r) => setTimeout(r, 0));
    f.componentInstance.voiceMove(down(100, 500));
    f.componentInstance.voiceUp(down(100, 500));
    expect(cancelled).toBe(1);
    expect(f.componentInstance.hasVoiceNote()).toBe(false);

    // Release without sliding: the note is kept and the mic closes.
    f.componentInstance.voiceDown(down(200, 500));
    await new Promise((r) => setTimeout(r, 0));
    f.componentInstance.voiceUp(down(200, 500));
    await new Promise((r) => setTimeout(r, 0));
    expect(stopped).toBe(1);
    // Released without sliding: the note lands on the post.
    expect(f.componentInstance.hasVoiceNote()).toBe(true);

    // Slide up past the threshold: locked, so letting go keeps recording.
    f.componentInstance.voiceDown(down(200, 500));
    await new Promise((r) => setTimeout(r, 0));
    f.componentInstance.voiceMove(down(200, 420));
    expect(recorder.locked()).toBe(true);
    f.componentInstance.voiceUp(down(200, 420));
    expect(live).toBe(true);
    expect(stopped).toBe(1);
    // The bar offers stop and cancel once locked.
    f.detectChanges();
    const html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('recbar--locked');
    expect(html).toContain('Locked');
    f.componentInstance.stopVoiceNote();
    expect(stopped).toBe(2);
  });

  it('handles media in the composer', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    f.componentInstance.type.set('missing');
    f.componentInstance.f.update((v) => ({ ...v, media: [{ id: 'v', kind: 'video', src: 'data:video/mp4,' } as never] }));
    f.detectChanges();
    expect(f.componentInstance.f().media.some((m) => m.kind === 'video')).toBe(true);
  });

  it('renders the story composer with a visibility choice', async () => {
    const data = TestBed.inject(DataService);
    await TestBed.inject(AuthService).signInDemo();
    await data.loadStatic();
    const f = TestBed.createComponent(CreateStoryComponent);
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    // WhatsApp-style canvas: type on the story itself, with a privacy selector.
    expect(html).toContain('Type a status');
    expect(html).toContain('Background');
    expect(html).toContain('Everyone');
    expect(html).toContain('Share');

    // open the privacy panel and check the three audiences are offered
    f.componentInstance.toggle('privacy');
    f.detectChanges();
    const withPrivacy: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(withPrivacy).toContain('Who can see this story?');
    expect(withPrivacy).toContain('My Spotlight');
    expect(withPrivacy).toContain('My followers');
    expect(withPrivacy).toContain('People who follow you can view');
    const fEl = f.nativeElement as HTMLElement;
    const followerOption = [...fEl.querySelectorAll<HTMLButtonElement>('.panel .line')].find((b) => b.textContent?.includes('My followers'))!;
    followerOption.click();
    f.detectChanges();
    expect(f.componentInstance.audience()).toBe('followers');
    expect(f.componentInstance.panel()).toBe('none');
    f.componentInstance.toggle('privacy');
    f.detectChanges();
    const spotlightOption = [...fEl.querySelectorAll<HTMLButtonElement>('.panel .line')].find((b) => b.textContent?.includes('My Spotlight'))!;
    spotlightOption.click();
    f.detectChanges();
    expect(f.componentInstance.panel()).toBe('none');
    expect(f.componentInstance.audience()).toBe('surname');
    expect(fEl.querySelector('.community-picker')).toBeTruthy();
    f.componentInstance.media.set([{ id: 'test-image', kind: 'image', src: 'data:image/png;base64,AA==' }]);
    f.detectChanges();
    const photo = fEl.querySelector('.canvas .shot')!;
    const caption = fEl.querySelector('.canvas .caption')!;
    expect(photo.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps stories manual even for saved autoplay settings, and a hold will not skip one', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    TestBed.inject(SettingsService).update({ autoplayMedia: true });
    const f = TestBed.createComponent(StoryViewerComponent);
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.id.set('s1');
    f.detectChanges();
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).innerHTML).toContain('Tap to continue');
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();

    vi.useFakeTimers();
    try {
      f.componentInstance.pressStart();
      vi.advanceTimersByTime(500);
      f.componentInstance.pressEnd();
      f.componentInstance.advance();
      expect(f.componentInstance.id()).toBe('s1');
      f.componentInstance.advance();
      expect(f.componentInstance.id()).not.toBe('s1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders private messages as a dated, grouped conversation thread', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const chat = TestBed.inject(ChatService);
    const me = TestBed.inject(AuthService).viewerId!;
    const today = Date.now();
    const yesterdayDate = new Date(today);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    chat.messages.set([
      { id: 'm1', threadId: 'thread-test', fromUserId: 'u_friend', body: 'I saw the notice and wanted to check in.', at: yesterdayDate.getTime(), read: true, kind: 'text' },
      { id: 'm2', threadId: 'thread-test', fromUserId: 'u_friend', body: 'Are you still looking near the station?', at: yesterdayDate.getTime() + 30_000, read: true, kind: 'text' },
      { id: 'm3', threadId: 'thread-test', fromUserId: me, body: 'Yes, thank you for reaching out.', at: today, read: false, kind: 'text' }
    ]);
    const f = TestBed.createComponent(ChatRoomComponent);
    f.detectChanges();
    await f.whenStable();
    const html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Conversation');
    expect(html).toContain('Yesterday');
    expect(html).toContain('Today');
    expect(f.componentInstance.showMessageHeader(1)).toBe(false);
    expect(f.componentInstance.showMessageHeader(2)).toBe(true);
    expect(f.componentInstance.dayBoundary(1)).toBeNull();
  });

  it('updates the private-chat inbox timestamp and peer unread count on send', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const auth = TestBed.inject(AuthService);
    const api = TestBed.inject(LULA_API);
    const chat = TestBed.inject(ChatService);
    const me = auth.viewerId!;
    const thread = {
      id: 'thread-inbox-update',
      participantIds: [me, 'u_lerato'],
      postId: null,
      createdAt: 1,
      lastMessageAt: 1,
      unread: { [me]: 0, u_lerato: 0 },
      unlockedVia: 'follow' as const
    };
    await db.upsertFollow({ id: 'f_demo_lerato', followerId: me, followingId: 'u_lerato', at: Date.now(), status: 'accepted' });
    await api.saveThread(thread);
    await chat.openThread(thread.id);
    await chat.send('I am still looking. Thank you for checking in.');

    const updated = await api.thread(thread.id);
    expect(updated?.lastMessageAt).toBeGreaterThan(1);
    expect(updated?.unread.u_lerato).toBe(1);
    expect(updated?.unread[me]).toBe(0);
    expect(chat.messages().at(-1)?.body).toContain('still looking');
  });

  it('renders a profile and hides what the owner hid', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const data = TestBed.inject(DataService);
    data.followingIds.set(['u_kabelo']);
    await data.loadFeed();
    await data.loadStatic();
    const owner = (await data.profile('u_kabelo'))!;
    owner.privacy = { ...owner.privacy, showStats: false, showSpotlights: false };
    await TestBed.inject(LULA_API).saveUser(owner);

    const f = TestBed.createComponent(ProfileComponent);
    f.componentInstance.u.set(owner);
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Kabelo Nkosi');
    // the seeded check-in names the colour, not only a green ring
    expect(html).toContain('Green ring');
    expect(html).toContain('Safe');
    // stats and communities are hidden from a visitor
    expect(html).not.toContain('impact points');
    expect(f.componentInstance.showStats()).toBe(false);
  });

  it('renders the terms page with the arrest warning and support contact', async () => {
    const f = TestBed.createComponent(TermsComponent);
    f.detectChanges();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('18 or older');
    expect(html).toContain('can lead to arrest');
    expect(html).toContain(SUPPORT_EMAIL);
    expect(html).toContain('08600 10111');
  });
});

describe('Admin screen', () => {
  beforeEach(bed);

  /** Mount as the demo admin and wait for the user list to land. */
  async function admin(): Promise<ComponentFixture<AdminComponent>> {
    await TestBed.inject(AuthService).signInDemo();
    const f = TestBed.createComponent(AdminComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.tab.set('people');
    f.detectChanges();
    await f.whenStable();
    return f;
  }

  /** Fire the same CustomEvent the real ion-searchbar emits. */
  function type(f: ComponentFixture<AdminComponent>, value: string): void {
    const bar = (f.nativeElement as HTMLElement).querySelector('ion-searchbar');
    expect(bar).toBeTruthy();
    bar!.dispatchEvent(new CustomEvent('ionInput', { detail: { value, event: null } }));
    f.detectChanges();
  }

  it('lists people and can remove one', async () => {
    const f = await admin();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(f.componentInstance.people().length).toBeGreaterThan(5);
    expect(html).toContain('Remove');
    expect(html).toContain('Suspend');
    // another admin has no Remove button of their own
    expect(html).toContain('admin');
    // A badge is granted from here: the control exists, and the verified
    // accounts in the list carry the same mark the feed draws.
    expect(html).toContain('Verify member');
    expect(html).toContain('Withdraw badge');
    expect(html).toContain('aria-label="Verified member"');
  });

  it('filters people when you type in the search bar', async () => {
    const f = await admin();
    const all = f.componentInstance.people().length;
    type(f, 'ndlela');
    const names = f.componentInstance.people().map((u) => u.displayName);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThan(all);
    expect(names.every((n) => n.toLowerCase().includes('ndlela'))).toBe(true);
    expect((f.nativeElement as HTMLElement).innerHTML).toContain('Ndlela');
  });

  it('searches by username and by email too', async () => {
    const f = await admin();
    const target = f.componentInstance.people().find((u) => !u.isAdmin)!;
    type(f, target.handle);
    expect(f.componentInstance.people().map((u) => u.id)).toContain(target.id);
    type(f, target.email.split('@')[0]);
    expect(f.componentInstance.people().map((u) => u.id)).toContain(target.id);
    type(f, 'zzzznobody');
    expect(f.componentInstance.people()).toEqual([]);
  });

  it('shows the reports tab with the queue empty by default', async () => {
    const f = await admin();
    f.componentInstance.tab.set('reports');
    f.detectChanges();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('No open reports');
    expect(html).toContain('Anything members report lands here.');
  });
});

describe('Search boxes actually search', () => {
  beforeEach(bed);

  /** Fire the CustomEvent the real ion-searchbar emits, through the real listener. */
  function type(f: ComponentFixture<unknown>, value: string): void {
    const bar = (f.nativeElement as HTMLElement).querySelector('ion-searchbar');
    expect(bar).toBeTruthy();
    bar!.dispatchEvent(new CustomEvent('ionInput', { detail: { value, event: null } }));
    f.detectChanges();
  }

  it('narrows the Spotlight tab when you type', async () => {
    const data = TestBed.inject(DataService);
    await data.refresh();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    await f.whenStable();
    const all = f.componentInstance.list().length;
    expect(all).toBeGreaterThanOrEqual(4);
    type(f, 'ndlela');
    expect(f.componentInstance.list().map((s) => s.surname)).toEqual(['Ndlela']);
    type(f, 'khu');
    expect(f.componentInstance.list().map((s) => s.surname)).toEqual(['Khumalo']);
    type(f, '');
    expect(f.componentInstance.list().length).toBe(all);
  });

  it('shows a Spotlight to a guest, with posting locked behind joining', async () => {
    const data = TestBed.inject(DataService);
    await data.refresh();
    const sp = data.spotlights().find((s) => s.surname === 'Ndlela')!;
    const f = TestBed.createComponent(SpotlightDetailComponent);
    f.componentInstance.sp.set(sp);
    await f.componentInstance.reloadPosts();
    f.detectChanges();
    await f.whenStable();
    const html = (f.nativeElement as HTMLElement).innerHTML;
    // reading is open, posting is not
    expect(html).toContain('Join the Ndlela community to post here');
    expect(html).toContain('Anyone can read what is posted.');
    expect([...((f.nativeElement as HTMLElement).querySelectorAll('button'))].filter((b) => /Join this community/.test(b.textContent ?? '')).length).toBe(1);
    expect((f.nativeElement as HTMLElement).querySelector('.locked button')).toBeNull();
    expect(f.componentInstance.posts().length).toBeGreaterThan(0);
  });

  it('opens the shared composer with the Spotlight selected and searches people inside it', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const data = TestBed.inject(DataService);
    await data.refresh();
    const sp = data.spotlights().find((s) => s.memberIds.includes('u_demo'))!;
    const f = TestBed.createComponent(SpotlightDetailComponent);
    f.componentInstance.sp.set(sp);
    await f.componentInstance.reloadPosts();
    f.detectChanges();
    await f.whenStable();
    const html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Post here');
    // The Spotlight page has no second, shortened composer. The shared Create
    // composer opens only after this action and receives the community id.
    expect((f.nativeElement as HTMLElement).querySelector('.quick')).toBeFalsy();
    await f.componentInstance.postHere();
    expect(TestBed.inject(Router).url).toContain('/create/missing?spotlight=' + sp.id);
    // searching inside the community finds the people in it
    const memberId = sp.memberIds.find((id) => id !== 'u_demo')!;
    const member = await data.people([memberId]);
    const needle = member[0].displayName.split(' ')[0];
    await f.componentInstance.onSearch(needle);
    expect(f.componentInstance.people().map((u) => u.id)).toContain(memberId);
    await f.componentInstance.onSearch('');
    expect(f.componentInstance.people()).toEqual([]);
  });

  it('narrows the posts inside a Spotlight when you type', async () => {
    const data = TestBed.inject(DataService);
    await data.refresh();
    // pick the Spotlight that actually has more than one post in the seed data
    const counts = data.spotlights().map((sp) => ({ sp, n: data.feed().filter((p) => p.spotlightId === sp.id).length }));
    const best = counts.sort((a, b) => b.n - a.n)[0];
    expect(best.n).toBeGreaterThan(1);
    const f = TestBed.createComponent(SpotlightDetailComponent);
    f.componentInstance.sp.set(best.sp);
    await f.componentInstance.reloadPosts();
    f.detectChanges();
    await f.whenStable();
    const all = f.componentInstance.posts().length;
    // filed posts plus any post about someone with that surname
    expect(all).toBeGreaterThanOrEqual(best.n);
    const surname = best.sp.surname.toLowerCase();
    expect(f.componentInstance.posts().every((p) => p.spotlightId === best.sp.id
      || (p.subject?.surname ?? '').toLowerCase() === surname
      || (p.subject?.name ?? '').toLowerCase().split(/\s+/).includes(surname))).toBe(true);
    type(f, f.componentInstance.posts()[1].title.slice(0, 6));
    expect(f.componentInstance.posts().length).toBeLessThan(all);
    type(f, 'zzzznothingmatches');
    expect(f.componentInstance.posts()).toEqual([]);
  });

  it('narrows the admin post queue when you type', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const f = TestBed.createComponent(AdminComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.tab.set('posts');
    f.detectChanges();
    await f.whenStable();
    const all = f.componentInstance.posts().length;
    type(f, 'zzzznothingmatches');
    expect(f.componentInstance.posts()).toEqual([]);
    type(f, '');
    expect(f.componentInstance.posts().length).toBe(all);
  });

  it('searches the whole store from the search page as you type', async () => {
    const data = TestBed.inject(DataService);
    await data.refresh();
    const f = TestBed.createComponent(SearchComponent);
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.posts()).toEqual([]);
    type(f, 'ORL/441');
    await f.whenStable();
    expect(f.componentInstance.posts().map((p) => p.id)).toContain('p_thato');
    // one character is not a search: nothing is asked of the database
    type(f, 'O');
    expect(f.componentInstance.posts()).toEqual([]);
  });

  it('finds people by name and by handle, not only post authors', async () => {
    const data = TestBed.inject(DataService);
    await data.refresh();
    const f = TestBed.createComponent(SearchComponent);
    f.detectChanges();
    await f.whenStable();
    type(f, 'ndlela');
    await f.whenStable();
    expect(f.componentInstance.users().map((u) => u.id)).toContain('u_sipho');
    type(f, '@lerato.m');
    await f.whenStable();
    expect(f.componentInstance.users().map((u) => u.id)).toContain('u_lerato');
    type(f, 'zzzznobody');
    await f.whenStable();
    expect(f.componentInstance.users()).toEqual([]);
  });

  it('narrows the Friends page to the name you type', async () => {
    await TestBed.inject(AuthService).signInDemo();
    const data = TestBed.inject(DataService);
    await data.refresh();
    const f = TestBed.createComponent(ConnectionsComponent);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.tab.set('following');
    f.detectChanges();
    await f.whenStable();
    const rows = f.componentInstance.rows();
    expect(rows.length).toBeGreaterThan(0);
    const one = rows.find((r) => !!r.u)!;
    type(f, (one.u!.displayName.split(' ')[0]));
    expect(f.componentInstance.matchingRows().map((r) => r.id)).toContain(one.id);
    type(f, 'zzzznothingmatches');
    expect(f.componentInstance.matchingRows()).toEqual([]);
    type(f, '');
    expect(f.componentInstance.matchingRows().length).toBe(rows.length);
  });
});

describe('Connection status rings', () => {
  beforeEach(bed);

  it('shows either accepted direction in Network and Friends, but not a pending request', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    // Pieter follows the demo account; Kabelo is followed by it. A request
    // from Lindiwe does not by itself make their status visible.
    const pieter = db.user('u_pieter')!;
    const kabelo = db.user('u_kabelo')!;
    const lindiwe = db.user('u_lindiwe')!;
    db.removeFollow('u_kabelo', 'u_demo');
    db.upsertUser({ ...lindiwe, checkIn: pieter.checkIn });
    db.upsertFollow({ id: 'pending-status', followerId: lindiwe.id, followingId: 'u_demo', at: Date.now(), status: 'pending' });
    await data.loadUserScoped();
    const network = TestBed.createComponent(DiscoverComponent);
    network.componentInstance.open.set({ following: true, followers: true, requests: true, statuses: true });
    network.detectChanges();
    await network.whenStable();
    network.detectChanges();
    const statusIn = (section: string, name: string): string | null | undefined => {
      const rows = [...(network.nativeElement as HTMLElement).querySelectorAll(`#sect-${section} .who`)];
      return rows.find((row) => row.textContent?.includes(name))?.querySelector('.avatar-shell')?.getAttribute('data-status');
    };
    expect(statusIn('followers', pieter.displayName)).toBe('unfamiliar');
    expect(statusIn('following', kabelo.displayName)).toBe('safe');
    expect(statusIn('requests', lindiwe.displayName)).toBeNull();
    expect(statusIn('statuses', pieter.displayName)).toBe('unfamiliar');
    expect(network.componentInstance.rowsFor('following').some((r) => r.id === pieter.id)).toBe(false);

    const friends = TestBed.createComponent(ConnectionsComponent);
    friends.componentInstance.tab.set('followers');
    friends.detectChanges();
    await friends.whenStable();
    friends.detectChanges();
    const findFriend = (name: string): Element | undefined => [...(friends.nativeElement as HTMLElement).querySelectorAll('.who')]
      .find((row) => row.textContent?.includes(name));
    expect(findFriend(pieter.displayName)?.querySelector('.avatar-shell')?.getAttribute('data-status')).toBe('unfamiliar');
    friends.componentInstance.tab.set('following');
    friends.detectChanges();
    expect(findFriend(kabelo.displayName)?.querySelector('.avatar-shell')?.getAttribute('data-status')).toBe('safe');

    // Re-read existing connections too, so a changed status replaces the cached one.
    db.upsertUser({ ...pieter, checkIn: { ...pieter.checkIn!, status: 'safe' } });
    await data.loadUserScoped();
    network.detectChanges();
    expect(statusIn('followers', pieter.displayName)).toBe('safe');
    db.removeFollow('u_pieter', 'u_demo');
    await data.loadUserScoped();
    network.detectChanges();
    expect(data.statusOf(data.authorOf('u_pieter'))).toBeNull();
    expect(network.componentInstance.statusPeople().some((r) => r.id === pieter.id)).toBe(false);
  });
});

describe('Follow requests', () => {
  beforeEach(bed);

  it('goes straight through when approval is off, and becomes a request when it is on', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.refresh();

    const target = data.feed().find((p) => p.authorId !== 'u_demo' && !data.followingIds().includes(p.authorId))?.authorId ?? 'u_zanele';

    // default: no approval needed
    const followed = await data.toggleFollow(target);
    expect(followed).toBe(true);
    expect(await data.isFollowing(target)).toBe(true);
    await data.toggleFollow(target); // unfollow again

    // the target turns approval on
    const profile = (await data.profile(target))!;
    const api = TestBed.inject(LULA_API);
    await api.saveUser({ ...profile, privacy: { ...profile.privacy, requireFollowApproval: true } });

    const outcome = await data.toggleFollow(target);
    expect(outcome).toBe(false);                 // not following yet
    expect(await data.isFollowing(target)).toBe(false);

    // and the request lands in the target's queue
    const reqs = await api.followRequests(target);
    expect(reqs.map((r) => r.followerId)).toContain('u_demo');
    expect(reqs.every((r) => r.status === 'pending')).toBe(true);

    // accepting it makes the follow real
    await api.respondFollowRequest('u_demo', target, true);
    expect(await data.isFollowing(target)).toBe(true);
    expect((await api.followRequests(target)).length).toBe(0);
  });

  it('declining removes the request and leaves nobody following', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const api = TestBed.inject(LULA_API);
    await auth.signInDemo();
    await data.refresh();

    const target = data.feed().find((p) => p.authorId !== 'u_demo' && !data.followingIds().includes(p.authorId))?.authorId ?? 'u_zanele';
    const profile = (await data.profile(target))!;
    await api.saveUser({ ...profile, privacy: { ...profile.privacy, requireFollowApproval: true } });

    await data.toggleFollow(target);
    expect((await api.followRequests(target)).length).toBe(1);

    await api.respondFollowRequest('u_demo', target, false);
    expect((await api.followRequests(target)).length).toBe(0);
    expect(await data.isFollowing(target)).toBe(false);
  });

  it('responds through DataService and clears the queue', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    const api = TestBed.inject(LULA_API);

    // demo user requires approval, a new account asks to follow them
    const demo = (await api.user('u_demo'))!;
    await api.saveUser({ ...demo, privacy: { ...demo.privacy, requireFollowApproval: true } });
    await auth.signUp({
      displayName: 'Asker Person', email: 'asker@example.co.za', password: 'password123',
      surname: 'Person', province: 'GP', town: '', over18: true, acceptedTerms: true, otpVerified: true
    });
    await data.toggleFollow('u_demo');

    // now sign in as the demo admin and answer it
    await auth.signOut();
    await auth.signInDemo();
    await data.loadFollowRequests();
    expect(data.followRequests().length).toBe(1);

    await data.respondToFollowRequest(data.followRequests()[0].followerId, true);
    expect(data.followRequests().length).toBe(0);
    expect(await api.isFollowing((await api.user('u_demo'))!.id, 'u_demo')).toBe(false);
  });
});

describe('Email and Google sign-in', () => {
  beforeEach(bed);

  const payload = (over: any = {}) => ({
    displayName: 'Nomvula Zondi', email: 'nomvula@example.co.za', password: 'password123',
    surname: 'Zondi', province: 'KZP' as any, town: 'Durban',
    over18: true, acceptedTerms: true, otpVerified: true, ...over
  });

  it('OTP: right code passes, wrong code fails, and a used code cannot be replayed', async () => {
    const auth = TestBed.inject(AuthService);
    const { sentTo, demoCode } = await auth.requestOtp('Nomvula@Example.co.za ');

    // normalised and trimmed
    expect(sentTo).toBe('nomvula@example.co.za');
    expect(demoCode).toMatch(/^\d{6}$/);

    expect(auth.verifyOtp(sentTo, '000000')).toBe(false);      // wrong code
    expect(auth.verifyOtp(sentTo, demoCode)).toBe(true);       // right code
    expect(auth.verifyOtp('other@example.co.za', demoCode)).toBe(false); // not this address
    expect(auth.otpSecondsLeft(sentTo)).toBeGreaterThan(0);

    // signing up burns the code, so it cannot be replayed afterwards
    await auth.signUp(payload({ email: sentTo }));
    expect(auth.verifyOtp(sentTo, demoCode)).toBe(false);

    // a fresh request issues a different code
    const again = await auth.requestOtp('fresh.address@example.co.za');
    expect(again.demoCode).toMatch(/^\d{6}$/);
  });

  it('signs up with email, then signs back in with that email and password', async () => {
    const auth = TestBed.inject(AuthService);

    const created = await auth.signUp(payload());
    expect(created.email).toBe('nomvula@example.co.za');
    // full name stays the name; the second name is the locked username
    expect(created.displayName).toBe('Nomvula Zondi');
    expect(created.surname).toBe('Zondi');
    expect(created.handle).toBe('zondi');
    expect(created.bio).toBe('');

    await auth.signOut();
    expect(auth.viewerId).toBe(null);

    const back = await auth.signIn('Nomvula@Example.co.za', 'password123');
    expect(back.id).toBe(created.id);
    expect(auth.viewerId).toBe(created.id);
  });

  it('rejects a wrong password, an unknown email, and a duplicate sign-up', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signUp(payload());

    await expect(auth.signIn('nomvula@example.co.za', 'wrong-password')).rejects.toThrow(/Incorrect password/i);
    await expect(auth.signIn('nobody@example.co.za', 'password123')).rejects.toThrow(/No LulaFind account/i);
    await expect(auth.signUp(payload())).rejects.toThrow(/already exists/i);
    // a different address, so the duplicate-email check cannot shadow the OTP one
    await expect(auth.signUp(payload({ email: 'unverified@example.co.za', otpVerified: false })))
      .rejects.toThrow(/code we emailed you/i);
    await expect(auth.signUp(payload({ email: 'short@example.co.za', password: 'short' })))
      .rejects.toThrow(/at least 8 characters/i);
    await expect(auth.signUp(payload({ email: 'under18@example.co.za', over18: false })))
      .rejects.toThrow(/18 or older/i);
    await expect(auth.signUp(payload({ email: 'terms@example.co.za', acceptedTerms: false })))
      .rejects.toThrow(/Accept the terms/i);
  });

  it('completes the offline password-recovery and new-password form journey', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signUp(payload());
    await auth.signOut();
    expect(await auth.sendPasswordReset('nomvula@example.co.za')).toBe('preview');

    const fixture = TestBed.createComponent(AuthComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.mode()).toBe('newpass');

    fixture.componentInstance.f.newPassword = 'new-password-123';
    fixture.componentInstance.f.confirmPassword = 'does-not-match';
    await fixture.componentInstance.saveNewPassword();
    expect(fixture.componentInstance.error()).toContain('do not match');

    fixture.componentInstance.f.confirmPassword = 'new-password-123';
    await fixture.componentInstance.saveNewPassword();
    expect(auth.passwordRecovery()).toBe(false);
    expect(auth.viewerId).not.toBe(null);

    await auth.signOut();
    const signedIn = await auth.signIn('nomvula@example.co.za', 'new-password-123');
    expect(signedIn.email).toBe('nomvula@example.co.za');
  });

  it('uses the Supabase Google redirect and restores the account from its OAuth callback', async () => {
    let callback: ((event: string, session: any) => void) | undefined;
    let oauthOptions: any;
    const authClient = {
      onAuthStateChange: (fn: (event: string, session: any) => void) => {
        callback = fn;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async (options: any) => {
        oauthOptions = options;
        return { data: { provider: 'google', url: 'https://accounts.google.com/' }, error: null };
      }
    };
    const api = TestBed.inject(LULA_API) as MockApi & { client?: { auth: typeof authClient } };
    api.client = { auth: authClient };
    const auth = TestBed.inject(AuthService);
    auth.attachApi(api);

    await expect(auth.signInWithProvider('google')).rejects.toThrow('OAUTH_REDIRECT');
    expect(oauthOptions.provider).toBe('google');
    expect(oauthOptions.options.redirectTo).toBe(`${window.location.origin}/auth`);

    const demo = (await api.user('u_demo'))!;
    callback?.('SIGNED_IN', { user: { id: demo.id, email: demo.email, user_metadata: {} } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(auth.user()?.id).toBe('u_demo');

    // Google already knows the name and the address, so the app uses them
    // instead of asking the person to type what Google has.
    callback?.('SIGNED_IN', {
      user: {
        id: '00000000-0000-4000-8000-000000000199',
        email: 'oauth.new@example.com',
        user_metadata: { full_name: 'New OAuth Member' },
        app_metadata: { provider: 'google' }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(auth.pendingProvider()).toBe(null);
    expect(auth.user()).toMatchObject({
      email: 'oauth.new@example.com', displayName: 'New OAuth Member', surname: 'OAuth'
    });
    // and the profile is really in the data layer, not just on screen
    expect((await api.user('00000000-0000-4000-8000-000000000199'))?.email).toBe('oauth.new@example.com');

    // Email confirmation can return after signup without a chosen province.
    callback?.('SIGNED_IN', { user: { id: 'confirmed-no-province', email: 'confirmed@example.com',
      user_metadata: { lulafindSignupComplete: true, acceptedTerms: true, over18: true, displayName: 'Confirmed Member' } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(auth.user()).toMatchObject({ id: 'confirmed-no-province', province: null, onboarded: false });
    expect(auth.needsOnboarding()).toBe(true);

    // A Google account with no usable name still asks - for the name only, and
    // without pretending a half-built account is signed in.
    callback?.('SIGNED_IN', {
      user: {
        id: '00000000-0000-4000-8000-000000000200',
        email: '',
        user_metadata: {},
        app_metadata: { provider: 'google' }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(auth.user()).toBe(null);
    expect(auth.pendingProvider()).toMatchObject({ provider: 'google' });
  });

  it('Google: a brand new email is handed to the sign-up form, not auto-created', async () => {
    const auth = TestBed.inject(AuthService);

    await expect(auth.signInWithProvider('google')).rejects.toThrow('NEW_ACCOUNT');

    const pending = auth.pendingProvider();
    expect(pending?.provider).toBe('google');
    expect(pending?.email).toBe('google.user@gmail.com');
    expect(auth.viewerId).toBe(null);   // no half-empty account was made

    // finishing the form completes the sign-in - no password, no OTP needed
    const u = await auth.finishProviderSignUp(payload({
      displayName: 'Google User', email: 'google.user@gmail.com', provider: 'google', otpVerified: false
    }));
    expect(u.email).toBe('google.user@gmail.com');
    expect(auth.viewerId).toBe(u.id);
  });

  it('Google: a known email goes straight in without the form', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signUp(payload());
    await auth.signOut();

    // make the seeded demo email match so the provider finds a real account
    const api = TestBed.inject(LULA_API);
    const demo = (await api.user('u_demo'))!;
    await api.saveUser({ ...demo, email: 'google.user@gmail.com' });

    const u = await auth.signInWithProvider('google');
    expect(u.email).toBe('google.user@gmail.com');
    expect(auth.viewerId).toBe('u_demo');
    expect(auth.pendingProvider()).toBe(null);
  });
});

describe('Stored media renders from a signed link', () => {
  beforeEach(bed);

  /** Only `resolveMedia` matters here, so the API is a one-method fake. */
  function apiWith(resolve: (src: string) => Promise<string>): void {
    TestBed.overrideProvider(LULA_API, { useValue: { resolveMedia: resolve } });
  }

  it('signs a storage:// marker before it reaches the <img>', async () => {
    apiWith(async (src) => src.replace('storage://photos/', 'https://signed.test/'));
    const f = TestBed.createComponent(MediaImageComponent);
    f.componentRef.setInput('src', 'storage://photos/u_demo/a.jpg');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('https://signed.test/u_demo/a.jpg');
  });

  it('passes a data: or https link straight through, unsigned', async () => {
    let resolved = 0;
    apiWith(async () => {
      resolved++;
      return 'https://signed.test/nope';
    });
    const f = TestBed.createComponent(MediaImageComponent);
    f.componentRef.setInput('src', 'data:image/jpeg;base64,AAA');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAA');
    expect(resolved).toBe(0);
  });

  it('offers a retry instead of a broken image when the link is refused', async () => {
    let calls = 0;
    apiWith(async () => (++calls === 1 ? '' : 'https://signed.test/back.jpg'));
    const f = TestBed.createComponent(MediaImageComponent);
    f.componentRef.setInput('src', 'storage://photos/u_demo/a.jpg');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Photo not available here yet');
    expect(el.querySelector('img')).toBeNull();
    el.querySelector<HTMLButtonElement>('button.stub--failed')?.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('https://signed.test/back.jpg');
    expect(calls).toBe(2);
  });

  it('re-signs a clip the same way, and says so when it cannot', async () => {
    apiWith(async () => '');
    const f = TestBed.createComponent(MediaVideoComponent);
    f.componentRef.setInput('src', 'storage://photos/u_demo/clip.mp4');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Video not available here yet');
    expect(el.querySelector('video')).toBeNull();

    f.componentRef.setInput('src', 'https://cdn.test/clip.mp4');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('video')?.getAttribute('src')).toBe('https://cdn.test/clip.mp4');
  });
});


/**
 * LinkedIn's message row. A thread is not only the words: you react to one
 * message, fix your own mistake, take one back, see whether it was read, and
 * search the whole thing. All of it lives on the row itself, and none of it
 * touches the other person's messages.
 */
describe('What you can do to a message', () => {
  /** A room with three messages: one of them mine, unread by the other side. */
  async function room() {
    const database = new LocalDb(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES),
        provideIonicAngular(),
        { provide: LULA_API, useValue: new MockApi(database) },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ threadId: 'thread-acts' }), fragment: null } }
        }
      ]
    });
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo();
    const me = auth.viewerId!;
    const api = TestBed.inject(LULA_API);
    const t0 = Date.now();
    const thread: ChatThread = {
      id: 'thread-acts', participantIds: [me, 'u_kabelo'], postId: null,
      createdAt: t0 - 10_000, lastMessageAt: t0, unread: { [me]: 0, u_kabelo: 0 }, unlockedVia: 'follow'
    };
    await api.saveThread(thread);
    await api.saveMessage({ id: 'a1', threadId: thread.id, fromUserId: 'u_kabelo', body: 'I saw your post about the station', at: t0 - 90_000, read: true, kind: 'text' });
    await api.saveMessage({ id: 'a2', threadId: thread.id, fromUserId: me, body: 'Thank you. Can you describe the car?', at: t0 - 60_000, read: false, kind: 'text' });
    await api.saveMessage({ id: 'a3', threadId: thread.id, fromUserId: 'u_kabelo', body: 'A silver hatchback, no plate', at: t0 - 5_000, read: false, kind: 'text' });
    const chat = TestBed.inject(ChatService);
    await chat.openThread(thread.id);
    const f = TestBed.createComponent(ChatRoomComponent);
    // Not whenStable(): the room asks ion-content for its scroll element, and in
    // jsdom that promise never lands. A few macrotask turns render the thread.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 0));
      f.detectChanges();
    }
    return { f, chat, me, database, api };
  }

  const flush = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));

  async function redraw(f: ComponentFixture<ChatRoomComponent>): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      f.detectChanges();
    }
  }

  it('puts a reaction on one message and takes it back', async () => {
    const { f, chat, me, database } = await room();
    const hers = chat.messages().find((m) => m.fromUserId === 'u_kabelo')!;
    // The row is there for every message, quiet until you reach for it: four faces
    // each, and the words-only actions on the one message that is ours.
    const el0 = f.nativeElement as HTMLElement;
    expect(el0.querySelectorAll('.acts .act[aria-pressed]').length).toBe(12);
    expect([...el0.querySelectorAll('.act.txt')].filter((b) => b.textContent?.includes('Edit')).length).toBe(1);
    expect([...el0.querySelectorAll('.act.txt')].filter((b) => b.textContent?.includes('Unsend')).length).toBe(1);
    expect(await chat.reactMessage(hers.id, 'like')).toBe(true);
    expect(database.messages('thread-acts').find((m) => m.id === hers.id)!.reactions?.[me]).toBe('like');
    await redraw(f);
    const pill = (f.nativeElement as HTMLElement).querySelector('.face');
    expect(pill?.textContent).toContain('1');
    // The same face again is LinkedIn's "remove", not a second one.
    expect(await chat.reactMessage(hers.id, 'like')).toBe(true);
    expect(database.messages('thread-acts').find((m) => m.id === hers.id)!.reactions).toEqual({});
    // A system note is not a message anyone can react to.
    expect(await chat.reactMessage('no-such-message', 'like')).toBe(false);
    f.destroy();
  });

  it('lets you fix your own message and marks it Edited', async () => {
    const { f, chat, me, database } = await room();
    const mine = chat.messages().find((m) => m.fromUserId === me)!;
    const hers = chat.messages().find((m) => m.fromUserId === 'u_kabelo')!;
    expect(f.componentInstance.canManage(mine)).toBe(true);
    expect(f.componentInstance.canManage(hers)).toBe(false);
    f.componentInstance.startEdit(mine);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Editing your message');
    f.componentInstance.editText.set('Thank you. Can you describe the car and who was with it?');
    await f.componentInstance.saveEdit();
    const stored = database.messages('thread-acts').find((m) => m.id === mine.id)!;
    expect(stored.body).toContain('who was with it');
    expect(stored.editedAt).toBeGreaterThan(0);
    await redraw(f);
    expect((f.nativeElement as HTMLElement).textContent).toContain('Edited');
    // The message is still one message, not the old one plus a new one.
    expect(chat.messages().filter((m) => m.id === mine.id).length).toBe(1);
    // Her words are not ours to rewrite, even called straight on the service.
    expect(await chat.editMessage(hers.id, 'words she never typed')).toBe(false);
    f.destroy();
  });

  it('unsends a message and says so in the gap it leaves', async () => {
    const { f, chat, me } = await room();
    const mine = chat.messages().find((m) => m.fromUserId === me)!;
    await f.componentInstance.unsend(mine);
    const after = chat.messages().find((m) => m.id === mine.id)!;
    expect(after.unsent).toBe(true);
    expect(after.body).toBe('');
    // The row stays - a message that vanishes without a trace reads as a bug.
    expect(chat.messages().length).toBe(3);
    await redraw(f);
    const html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('You unsent a message');
    expect(html).not.toContain('Can you describe the car');
    expect(await chat.unsendMessage(chat.messages().find((m) => m.fromUserId === 'u_kabelo')!.id)).toBe(false);
    f.destroy();
  });

  it('marks the last thing you sent Delivered, then Seen', async () => {
    const { f, chat, me, database } = await room();
    let html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Delivered');
    expect(html).not.toContain('Seen');
    const mine = chat.messages().filter((m) => m.fromUserId === me).at(-1)!;
    // She opened the thread: the flag on the message is all the read state there is.
    await TestBed.inject(LULA_API).saveMessage({ ...mine, read: true });
    await chat.refreshOpenThread();
    await redraw(f);
    html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Seen');
    expect(html).not.toContain('Delivered');
    expect(chat.peerSeen()).toBe(true);
    // Unsend it and the status line goes with it, so the count of ticks is one.
    await f.componentInstance.unsend(mine);
    await redraw(f);
    expect((f.nativeElement as HTMLElement).querySelectorAll('.status').length).toBe(0);
    expect(database.messages('thread-acts').length).toBe(3);
    f.destroy();
  });

  it('shows typing dots for the other side, and ignores a stale marker', async () => {
    const { f, chat, me, api } = await room();
    const thread = (await api.thread('thread-acts'))!;
    f.componentInstance.onType('One moment, I am looking');
    await flush();
    expect(((await api.thread('thread-acts'))!.typing ?? {})[me]).toBeGreaterThan(0);
    chat.stopTyping();
    await flush();
    expect(((await api.thread('thread-acts'))!.typing ?? {})[me]).toBeUndefined();
    // The typing marker must not move the thread in the inbox.
    expect((await api.thread('thread-acts'))!.lastMessageAt).toBe(thread.lastMessageAt);
    await api.saveThread({ ...thread, typing: { u_kabelo: Date.now() } });
    await chat.load();
    await redraw(f);
    expect((f.nativeElement as HTMLElement).textContent).toContain('is typing');
    // A marker from a minute ago is a crashed app, not a person typing.
    await api.saveThread({ ...(await api.thread('thread-acts'))!, typing: { u_kabelo: Date.now() - 60_000 } });
    await chat.load();
    await redraw(f);
    expect((f.nativeElement as HTMLElement).textContent).not.toContain('is typing');
    f.destroy();
  });

  it('searches inside the conversation and keeps the day line honest', async () => {
    const { f } = await room();
    f.componentInstance.toggleSearch();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.find input')).toBeTruthy();
    f.componentInstance.setQuery('hatchback');
    await redraw(f);
    expect(f.componentInstance.shown().length).toBe(1);
    const html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('A silver hatchback, no plate');
    expect(html).not.toContain('I saw your post about the station');
    // One message on screen means one divider, not one per day of the thread.
    expect(f.nativeElement.querySelectorAll('.day-divider').length).toBe(1);
    f.componentInstance.setQuery('nothing like this');
    await redraw(f);
    expect((f.nativeElement as HTMLElement).textContent).toContain('Nothing in this conversation says');
    f.componentInstance.closeSearch();
    f.detectChanges();
    expect(f.componentInstance.shown().length).toBe(3);
    f.destroy();
  });
});

describe('One icon set, at every size', () => {
  /**
   * Two ways the set drifted before, both visible on a phone:
   *
   *  - a face glyph sat inside the card's comment button, looking like an emoji
   *    picker that the app deliberately does not have;
   *  - stroke widths were written as raw numbers next to each size, so a 13px
   *    tick and a 24px tab glyph ended up at different visual weights - two sets
   *    on one screen.
   */
  it('scales the stroke to the glyph, so small icons do not look twice as heavy', () => {
    const small = strokeFor(13, 'regular');
    const large = strokeFor(24, 'regular');
    expect(small).toBeLessThan(large);
    // A 13px glyph may carry a little more relative weight than a 24px one -
    // enough to read - but not the 1.6x that made it look like a second set.
    expect(small / 13).toBeLessThan((large / 24) * 1.45);
    // The three weights stay ordered at any size.
    expect(strokeFor(20, 'thin')).toBeLessThan(strokeFor(20, 'regular'));
    expect(strokeFor(20, 'regular')).toBeLessThan(strokeFor(20, 'bold'));
    // A raw number still wins, for the rare one-off.
    expect(strokeFor(18, 2.4)).toBe(2.4);
  });

  it('keeps the comment bar free of a picker it does not have', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PostCardComponent],
      providers: [provideRouter(ROUTES), provideIonicAngular(), { provide: LULA_API, useValue: new MockApi(new LocalDb(true)) }]
    });
    const f = TestBed.createComponent(PostCardComponent);
    const db = new LocalDb(true);
    const post = db.post('p_thato');
    if (!post) throw new Error('fixture p_thato is missing');
    f.componentInstance.post = post;
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const bar = el.querySelector('.fb-comment-cta');
    expect(bar).toBeTruthy();
    // No face at the end of a field that only opens the post.
    expect(el.querySelector('.fb-comment-cta__ic')).toBeFalsy();
    expect(el.querySelector('lf-icon[name="smile"]')).toBeFalsy();
  });
});

describe('The two rows a composer shares', () => {
  beforeEach(bed);

  it('hands the face it was given to whoever asked', async () => {
    const f = TestBed.createComponent(EmojiRowComponent);
    const seen: string[] = [];
    f.componentInstance.picked.subscribe((e: string) => seen.push(e));
    f.detectChanges();
    await f.whenStable();
    const buttons = (f.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons.length).toBe(16);
    buttons[0].click();
    buttons[2].click();
    expect(seen).toEqual(['👍', '❤️']);
  });

  it('opens one profile card from a name, and closes it on Escape', async () => {
    @Component({
      standalone: true,
      imports: [UserHoverDirective, UserHoverCardComponent],
      template: `<a #name lfUserHover="u_kabelo">Kabelo Nkosi</a><lf-user-hover-host />`
    })
    class HostComponent {
      @ViewChild('name', { static: true }) name!: { nativeElement: HTMLElement };
    }
    const data = TestBed.inject(DataService);
    const kabelo = await data.profile('u_kabelo');
    if (kabelo) data.touchAuthor(kabelo);
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('.card')).toBeFalsy();
    (f.nativeElement as HTMLElement).querySelector('[lfUserHover]')!.dispatchEvent(new MouseEvent('mouseenter'));
    f.detectChanges();
    await f.whenStable();
    const card = (f.nativeElement as HTMLElement).querySelector('.card');
    expect(card?.textContent).toContain('Kabelo Nkosi');
    expect(card?.textContent).toContain('@kabelo');
    expect(card?.querySelector('.acts')?.textContent).toContain('Follow');
    // Nobody gets a button to follow themselves.
    expect(TestBed.inject(UserHoverService).userId()).toBe('u_kabelo');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(TestBed.inject(UserHoverService).userId()).toBeNull();
    f.destroy();
  });
});

/**
 * @mentions. The whole point of the @ is that someone who is not looking gets
 * told - so the test follows the words all the way to their notification.
 */
describe('Mentions in a comment', () => {
  beforeEach(bed);

  async function page() {
    const database = new LocalDb(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES),
        provideIonicAngular(),
        { provide: LULA_API, useValue: new MockApi(database) },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p_thato' }), fragment: null } }
        }
      ]
    });
    await TestBed.inject(AuthService).signInDemo();
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    await data.loadStatic();
    const kabelo = await data.profile('u_kabelo');
    if (kabelo) data.touchAuthor(kabelo);
    // A commenter, so the mention list has somebody in it besides the author.
    await TestBed.inject(LULA_API).saveComment({
      id: 'c_mention_seed', postId: 'p_thato', parentId: null, authorId: 'u_kabelo',
      body: 'He walks past the spaza on the corner most afternoons.', createdAt: Date.now() - 60_000,
      upvotes: 0, likedIds: [], isLead: false
    });
    await data.loadFeed();
    const f = TestBed.createComponent(PostDetailComponent);
    // The page loads its comments through a chain of awaits, so give it turns
    // rather than one detectChanges - a thread with no rows proves nothing.
    for (let i = 0; i < 8; i++) {
      f.detectChanges();
      await new Promise((r) => setTimeout(r, 0));
    }
    return { f, database, data };
  }

  it('offers the people in this thread and inserts the one you pick', async () => {
    const { f } = await page();
    const box = (f.nativeElement as HTMLElement).querySelector('textarea')!;
    box.value = 'Kabelo saw him ';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.who-list')).toBeFalsy();
    box.value = 'Anyone seen @';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    const list = (f.nativeElement as HTMLElement).querySelector('.who-list')!;
    expect(list.textContent).toContain('Kabelo Nkosi');
    const option = [...list.querySelectorAll('button')].find((b) => b.textContent?.includes('Kabelo'))!;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    f.detectChanges();
    expect(box.value).toContain('@Kabelo Nkosi ');
    expect(f.componentInstance.mentionedIds(box.value)).toEqual(['u_kabelo']);
  });

  it('names the person in the words, links them, and tells them', async () => {
    const { f, database } = await page();
    const box = (f.nativeElement as HTMLElement).querySelector('textarea')!;
    box.value = 'Please answer here @Kabelo Nkosi';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    await f.componentInstance.submitComment();
    const saved = database.commentsFor('p_thato').find((c) => c.body.includes('@Kabelo'))!;
    expect(saved.mentions).toEqual(['u_kabelo']);
    const note = database.notifications('u_kabelo').find((n) => n.kind === 'mention');
    expect(note?.body).toContain('@Kabelo Nkosi');
    expect(note?.postId).toBe('p_thato');
    f.detectChanges();
    await f.whenStable();
    const link = [...(f.nativeElement as HTMLElement).querySelectorAll('.ccard__text .mention')];
    expect(link.some((a) => a.textContent?.includes('Kabelo'))).toBe(true);
  });

  it('does not turn an email address into a mention', async () => {
    const { f } = await page();
    expect(f.componentInstance.mentionedIds('write to support@lulafind.org please')).toEqual([]);
    expect(f.componentInstance.mentionedIds('@Kabelo, and @nobody-here')).toEqual(['u_kabelo']);
  });

  it('leaves emoji entry to the phone keyboard, without an in-app picker', async () => {
    const { f } = await page();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.em-toggle')).toBeFalsy();
    expect(el.querySelector('lf-emoji-row')).toBeFalsy();
    const box = el.querySelector('textarea')! as HTMLTextAreaElement;
    expect(box.getAttribute('inputmode')).toBe('text');
    box.value = 'Thank you 🙏';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    await f.whenStable();
    expect(box.value).toContain('🙏');
  });

  it('offers a follow beside a commenter, and says Following when you already do', async () => {
    const { f, database } = await page();
    const chips = () => [...(f.nativeElement as HTMLElement).querySelectorAll('.cfollow')].map((b) => b.textContent?.trim());
    // The seed has u_demo following u_kabelo, who commented here, so the chip on
    // that row reads "Following" - and the row of my own comment has no chip at all.
    expect(f.componentInstance.isFollowing('u_kabelo')).toBe(true);
    expect(chips()).toContain('Following');
    expect(chips()).not.toContain('undefined');
    await f.componentInstance.followPerson('u_kabelo');
    expect(database.follows().some((edge) => edge.followerId === 'u_demo' && edge.followingId === 'u_kabelo')).toBe(false);
    expect(f.componentInstance.isFollowing('u_kabelo')).toBe(false);
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      f.detectChanges();
    }
    expect(chips()).toContain('+ Follow');
  });

  it('filters notifications and groups the list by day', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    await TestBed.inject(AuthService).signInDemo();
    // Calendar-anchored, so the assertions hold whatever hour the suite runs at.
    const noon = (daysBack: number): number => {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    };
    const at = Date.now();
    db.pushNotification({ id: 'n_x_older', userId: 'u_demo', kind: 'missing', title: 'New case within your alert radius', body: 'A boy was last seen at the taxi rank.', at: noon(8), read: true, route: '/post/p_thato', postId: 'p_thato' });
    db.pushNotification({ id: 'n_x_yest', userId: 'u_demo', kind: 'follow', title: 'Ayanda K. started following you', body: '', at: noon(1), read: false, route: '/user/u_ayanda', postId: null });
    db.pushNotification({ id: 'n_x_share', userId: 'u_demo', kind: 'share', title: 'Kabelo N. sent you a post', body: 'This one is near you.', at: at - 60_000, read: true, route: '/post/p_thato', postId: 'p_thato' });
    db.pushNotification({ id: 'n_x_mention', userId: 'u_demo', kind: 'mention', title: 'Lerato Dlamini mentioned you in a comment', body: '@you - the clinic opens at seven', at, read: false, route: '/post/p_thato', postId: 'p_thato' });
    await data.loadUserScoped();

    const f = TestBed.createComponent(NotificationsComponent);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const text = (): string => el.textContent ?? '';
    const days = (): string[] => [...el.querySelectorAll('.day')].map((d) => (d.textContent ?? '').trim());

    // The day lines are the three the app knows, each once - grouped, not stamped
    // on every row like a receipt.
    expect(days(), text()).toEqual([...new Set(data.notifications().map((n) => f.componentInstance.dayLabel(n.at)))]);
    expect(days()).toContain('Today');
    expect(days()).toContain('Yesterday');
    expect(days()).toContain('Earlier');
    expect(days()[0], 'the newest day heads the list').toBe('Today');

    // Mentions is its own filter: being named is not the same as being replied to.
    expect(text()).toContain('Mark all as read');
    f.componentInstance.filter.set('mentions');
    f.detectChanges();
    await f.whenStable();
    expect(text()).toContain('mentioned you in a comment');
    expect(text()).not.toContain('sent you a post');
    expect(days().length).toBe(1);

    // Posts is what people did on the cases you follow - comments, reactions,
    // reposts, shares - and not a follow or a chat reply.
    f.componentInstance.filter.set('posts');
    f.detectChanges();
    await f.whenStable();
    expect(text()).toContain('sent you a post');
    expect(text()).not.toContain('started following you');
    expect(text()).not.toContain('mentioned you in a comment');

    // Marking all read takes the button away with it, and the tint.
    f.componentInstance.filter.set('all');
    await f.componentInstance.readAll();
    f.detectChanges();
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain('Mark all as read');
    expect(data.notifications().every((n) => n.read)).toBe(true);
    expect(el.querySelectorAll('.row.unread').length).toBe(0);
  });
});

/**
 * The wiring, not just the unit: these navigate with the app's real route table,
 * so they fail if the guard is ever dropped from the shell again.
 */
describe('Route protection', () => {
  const realBed = (): void => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('lulafind.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* node */ }
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(APP_ROUTES),
        provideIonicAngular(),
        { provide: LULA_API, useValue: new MockApi(new LocalDb(true)) }
      ]
    });
  };

  beforeEach(realBed);

  it('a guest who opens Home lands on the login screen instead', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/home');
    // Sign in and you are returned to where you were going.
    expect(router.url).toContain('/auth');
    expect(router.url).toContain('next=%2Fhome');
  });

  it('a guest who opens the app at the root also lands on login', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    expect(router.url).toContain('/auth');
  });

  it('a signed-in member reloading straight onto Home stays there', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.signInDemo(); // stored session, checked before the route resolves
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/home');
    expect(auth.signedIn()).toBe(true);
    expect(router.url).toBe('/home');
  });
});
