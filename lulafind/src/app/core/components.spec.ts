import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter, Router } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { ToastController } from '@ionic/angular/toast-controller';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { SupabaseApi } from './data/supabase-api';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { feedWithRails } from './utils/feed';
import { ChatService } from './services/chat.service';
import { emptyFilter } from './models/types';
import { FilterBarComponent } from '../shared/components/filter-bar.component';
import { PostCardComponent } from '../shared/components/post-card.component';
import { RepostSheetComponent } from '../shared/components/repost-sheet.component';
import { SendSheetComponent } from '../shared/components/send-sheet.component';
import { PostActionsService } from './services/post-actions.service';
import { PlatformService } from './services/platform.service';
import { AuthComponent } from '../pages/auth/auth.component';
import { SpotlightComponent } from '../pages/tabs/spotlight.component';
import { MeComponent } from '../pages/tabs/me.component';
import { CreatePostComponent } from '../pages/post/create-post.component';
import { CreateStoryComponent } from '../pages/story/create-story.component';
import { StoryViewerComponent } from '../pages/story/story-viewer.component';
import { SettingsService } from './services/settings.service';
import { ProfileComponent } from '../pages/user/profile.component';
import { TermsComponent } from '../pages/terms/terms.component';
import { PostDetailComponent } from '../pages/post/post-detail.component';
import { ChatRoomComponent } from '../pages/chat/chat-room.component';
import { HomeComponent } from '../pages/tabs/home.component';
import { routes as APP_ROUTES } from '../app.routes';
import { authGuard } from './guards/auth.guard';
import { TabsComponent } from '../pages/tabs/tabs.component';
import { ReactionsSheetComponent } from '../shared/components/reactions-sheet.component';
import { AdminComponent } from '../pages/admin/admin.component';
import { SearchComponent } from '../pages/search/search.component';
import { ConnectionsComponent } from '../pages/connections/connections.component';
import { SpotlightDetailComponent } from '../pages/spotlight/spotlight-detail.component';
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

  it('shows the five bottom tabs: Home, Spotlight, Create, Discover, Menu', async () => {
    const f = TestBed.createComponent(TabsComponent);
    f.detectChanges();
    await f.whenStable();
    const html = (f.nativeElement as HTMLElement).innerHTML;
    for (const label of ['Home', 'Spotlight', 'Create', 'Discover', 'Menu']) {
      expect(html, label).toContain(label);
    }
    // Chats moved to the top navigation, and the Photo tab is gone.
    expect(html).not.toContain('tab="chats"');
    expect(html).not.toContain('Create a post with a photo');
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
    // Card anatomy: headline under the name, three-line clamp with a muted
    // ellipsis, then the meta lines and the stats line.
    expect(html).toContain('Community organiser');
    expect(html).toContain('fb-clamp');
    expect(html).toContain('see more');
    expect(html).toContain('fb-stats-bar');
    // Line 1 is where it is, then what kind of post it is; line 2 is when, then
    // the audience icon. The old standalone chip under the avatar is gone.
    expect(html).toContain('fb-kind');
    expect(html).toContain('Missing person');
    expect(html).toContain('Gauteng');
    expect(html).not.toContain('fb-chips');
    // The card carries no Like / Comment / Repost / Send row: those four live on
    // the post page. Follow and … share one right-hand column.
    expect(html).not.toContain('fb-actions-row');
    expect(html).not.toContain('fb-action-btn');
    expect(html).toContain('fb-head-actions');
    expect(html).toContain('fb-more-btn');
    // the seeded latest activity shows above the post, LinkedIn-style
    expect(html).toContain('Lerato Mahlangu');
    expect(html).toContain('commented on this');
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

    // Anyone shown can receive it; those you follow each other also get a chat.
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

    // The bar exists in the markup, not only in the component's handlers.
    const labels = [...el.querySelectorAll('.fb-actions .fb-act')].map((b) => b.textContent?.trim());
    expect(labels, 'LinkedIn calls the first action Like').toContain('Like');
    expect(labels).toContain('Comment');
    expect(labels).toContain('Repost');
    expect(labels).toContain('Send');

    // Tapping React emits the reaction the app records, and Comment opens the
    // post's comments - the two things a feed post must be able to do.
    const votes: string[] = [];
    const comments: number[] = [];
    f.componentInstance.vote.subscribe((v) => votes.push(v));
    f.componentInstance.comment.subscribe(() => comments.push(1));
    (el.querySelector('.fb-actions .fb-act') as HTMLButtonElement).click();
    ([...el.querySelectorAll('.fb-actions .fb-act')][1] as HTMLButtonElement).click();
    expect(votes.length).toBe(1);
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
    if (feed.length >= 8) expect(html).toContain('lf-story-rail');
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
    expect(composerHtml).toContain('Fill in the prompts');
    expect(composerHtml).toContain('Generate');
    expect(composerHtml).not.toContain('Short heading');
    expect(composerHtml).not.toContain('Story');
    expect(contentInputs).toHaveLength(1);
    expect((contentInputs[0] as HTMLTextAreaElement).value).toContain('Full name:');
    expect((contentInputs[0] as HTMLTextAreaElement).value).toContain('What happened:');

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

  it('organizes the Menu into shortcuts, posts, and saved sections', async () => {
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadFeed();
    await data.loadStatic();

    const f = TestBed.createComponent(MeComponent);
    f.detectChanges();
    await f.whenStable();

    const el = f.nativeElement as HTMLElement;
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(['All shortcuts', 'Posts', 'Saved']);

    f.componentInstance.menuTab.set('saved');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).innerHTML).toContain('Saved posts');
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
      participantIds: [me, 'u_friend'],
      postId: null,
      createdAt: 1,
      lastMessageAt: 1,
      unread: { [me]: 0, u_friend: 0 },
      unlockedVia: 'follow' as const
    };
    await api.saveThread(thread);
    await chat.openThread(thread.id);
    await chat.send('I am still looking. Thank you for checking in.');

    const updated = await api.thread(thread.id);
    expect(updated?.lastMessageAt).toBeGreaterThan(1);
    expect(updated?.unread.u_friend).toBe(1);
    expect(updated?.unread[me]).toBe(0);
    expect(chat.messages().at(-1)?.body).toContain('still looking');
  });

  it('renders a profile and hides what the owner hid', async () => {
    const data = TestBed.inject(DataService);
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
    expect(html).not.toContain('help points');
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
    expect(f.componentInstance.posts().length).toBeGreaterThan(0);
  });

  it('gives a member the short composer and searches people inside the Spotlight', async () => {
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
    expect(html).toContain('Post to the ' + sp.surname + ' community');
    expect(html).toContain('Photo');
    expect(html).toContain('Video');
    // searching inside the community finds the people in it
    const memberId = sp.memberIds.find((id) => id !== 'u_demo')!;
    const member = await data.people([memberId]);
    const needle = member[0].displayName.split(' ')[0];
    f.componentInstance.onSearch(needle);
    await f.whenStable();
    expect(f.componentInstance.people().map((u) => u.id)).toContain(memberId);
    f.componentInstance.onSearch('');
    await f.whenStable();
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
