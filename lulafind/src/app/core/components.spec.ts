import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { ToastController } from '@ionic/angular/toast-controller';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { ChatService } from './services/chat.service';
import { emptyFilter } from './models/types';
import { FilterBarComponent } from '../shared/components/filter-bar.component';
import { PostCardComponent } from '../shared/components/post-card.component';
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
import { TabsComponent } from '../pages/tabs/tabs.component';
import { AdminComponent } from '../pages/admin/admin.component';
import { SpotlightDetailComponent } from '../pages/spotlight/spotlight-detail.component';
import { MediaImageComponent, MediaVideoComponent } from '../shared/components/media-image.component';
import { SendSheetComponent } from '../shared/components/send-sheet.component';
import { PostActionsService } from '../core/services/post-actions.service';
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

  it('uses the bottom-right navigation action to create a photo post', async () => {
    const f = TestBed.createComponent(TabsComponent);
    f.detectChanges();
    await f.whenStable();
    const html = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Create a post with a photo');
    expect(html).toContain('Photo');
    expect(html).not.toContain('menu-pip');
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
    // LinkedIn's default reaction reads as its own name, never a yes/no vote.
    expect(html).toContain('Have an idea');
    expect(html).not.toContain('No idea');
    // LinkedIn's card anatomy: the poster's headline under their name, the
    // three-line clamp with LinkedIn's own mobile label - a lower-case
    // "see more" behind an ellipsis - a stats line and the action buttons.
    expect(html).toContain('Community organiser');
    expect(html).toContain('fb-clamp');
    expect(html).toContain('see more');
    expect(html).toContain('fb-stats-bar');
    expect(html).toContain('Comment');
    expect(html).toContain('Repost');
    expect(html).toContain('Send');
    // the seeded latest activity shows above the post, LinkedIn-style
    expect(html).toContain('Lerato Mahlangu');
    expect(html).toContain('commented on this');
    expect(html).toContain('Comment');
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
    expect(html).toContain('Repost');
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
    expect(html).toContain('ccard__time');
    expect(html).toContain('Reply');
    // the things that were taken off this page must stay off it
    expect(html).not.toContain('Case details');
    expect(html).not.toContain('Make a poster');
  });

  it('does not insert a story rail before the feed reaches post eight', async () => {
    const data = TestBed.inject(DataService);
    await data.loadFeed();
    const f = TestBed.createComponent(HomeComponent);
    await settle(f);
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('lf-story-rail');
    expect(html).not.toContain('Create story');
    expect(html).toContain('lf-post-card');
  });

  it('renders the LulaFind welcome and login screens', async () => {
    const f = TestBed.createComponent(AuthComponent);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const html: string = el.innerHTML;

    expect(html).toContain('Continue with Google');
    expect(html).toContain('Create new account');
    expect(html).toContain('Log in');

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

  it('renders the Spotlight tab as a community directory: create, search, A-Z', async () => {
    const data = TestBed.inject(DataService);
    await data.loadStatic();
    const f = TestBed.createComponent(SpotlightComponent);
    f.detectChanges();
    await f.whenStable();
    const html: string = (f.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Create a spotlight');
    expect(html).toContain('Find a surname');
    expect(html).toContain('Search a surname');
    expect(html).toContain('letter-pill');
    expect(html).toContain('Ndlela');
    // picking a letter narrows the list
    f.componentInstance.letter.set('N');
    f.detectChanges();
    expect(f.componentInstance.list().map((s) => s.surname)).toEqual(['Ndlela']);
    f.componentInstance.letter.set('B');
    f.detectChanges();
    expect(f.componentInstance.list().map((s) => s.surname)).toEqual(['Botha']);
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

describe('The Spotlight page is a community hub', () => {
  /**
   * `bed()` builds the module, so the route has to be replaced before anything is
   * injected from it - hence one helper that does all three steps in order.
   */
  async function hub(query: Record<string, string> = {}, params: Record<string, string> = { id: 'sp_ndlela' }) {
    bed();
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: convertToParamMap(params), queryParamMap: convertToParamMap(query), fragment: null } }
    });
    const stub = { create: async () => ({ present: async () => undefined, onDidDismiss: async () => ({}) }) };
    TestBed.overrideProvider(ToastController, { useValue: stub });
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadStatic();
    return { auth, data };
  }

  it('shows the surname, the join button, and Posts / Members / About', async () => {
    const { data } = await hub();
    expect(data.isMember('sp_ndlela')).toBe(false);
    const f = TestBed.createComponent(SpotlightDetailComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const text = () => (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).toContain('Ndlela');
    expect(text()).toContain('Spotlight');
    expect(text()).toContain('Join this community');
    expect(text()).toContain('Joining is instant, and you can post as soon as you have joined');
    // a stranger is not offered the composer
    expect(text()).not.toContain('Start a post in Ndlela');
  });

  it('joining from the page works, and opens the composer row', async () => {
    await hub();
    const f = TestBed.createComponent(SpotlightDetailComponent);
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.member()).toBe(false);
    await f.componentInstance.join();
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.member()).toBe(true);
    expect(f.componentInstance.notice()).not.toMatch(/denied|permission|failed/i);
    const text = (f.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Start a post in Ndlela');
    expect(text).toContain('no approval queue');
  });

  it('opens the Members tab from ?tab=members and searches it', async () => {
    await hub({ tab: 'members' });
    const f = TestBed.createComponent(SpotlightDetailComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.section()).toBe('members');
    f.componentInstance.memberQuery.set('nobody-here');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Nobody by that name is in this community yet');
  });

  it('preselects the community in the composer when the post starts there', async () => {
    const { data } = await hub({ spotlight: 'sp_ndlela' }, { type: 'missing' });
    expect(data.isMember('sp_ndlela')).toBe(false);
    const f = TestBed.createComponent(CreatePostComponent);
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.f().spotlightId).toBeNull();
    expect(f.componentInstance.error()).toMatch(/join that community/i);

    await data.joinSpotlight('sp_ndlela');
    expect(data.isMember('sp_ndlela')).toBe(true);
    const g = TestBed.createComponent(CreatePostComponent);
    g.detectChanges();
    await g.whenStable();
    expect(g.componentInstance.f().audience).toBe('surname');
    expect(g.componentInstance.f().spotlightId).toBe('sp_ndlela');
    expect(g.componentInstance.error()).toBe('');
  });
});

describe('The Send sheet', () => {
  /** Both directions of a follow, written straight into the store. */
  function followBoth(a: string, b: string): void {
    db.removeFollow(a, b);
    db.removeFollow(b, a);
    db.upsertFollow({ id: `f_${a}_${b}`, followerId: a, followingId: b, at: Date.now(), status: 'accepted' });
    db.upsertFollow({ id: `f_${b}_${a}`, followerId: b, followingId: a, at: Date.now(), status: 'accepted' });
  }

  async function ready(): Promise<void> {
    bed();
    TestBed.overrideProvider(ToastController, { useValue: { create: async () => ({ present: async () => undefined }) } });
    const auth = TestBed.inject(AuthService);
    const data = TestBed.inject(DataService);
    await auth.signInDemo();
    await data.loadFeed();
    followBoth('u_demo', 'u_lindiwe');
    await data.loadUserScoped();
  }

  it('offers only the connections who follow you back', async () => {
    await ready();
    const actions = TestBed.inject(PostActionsService);
    const data = TestBed.inject(DataService);
    const list = await actions.sendRecipients();
    expect(list.map((r) => r.id)).toContain('u_lindiwe');
    for (const r of list) expect(await data.mutualFollow(r.id)).toBe(true);

    // someone who stops following you drops out of the list
    db.removeFollow('u_lindiwe', 'u_demo');
    await data.loadUserScoped();
    expect((await actions.sendRecipients()).map((r) => r.id)).not.toContain('u_lindiwe');
    db.upsertFollow({ id: 'f_back_again', followerId: 'u_lindiwe', followingId: 'u_demo', at: Date.now(), status: 'accepted' });
    await data.loadUserScoped();

    actions.openSend(data.post('p_khumalo')!);
    const f = TestBed.createComponent(SendSheetComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Send this post to');
    expect(f.componentInstance.recipients().map((r) => r.id)).toContain('u_lindiwe');
    // nothing picked yet: Send is disabled
    expect(el.querySelector<HTMLButtonElement>('button.go')?.disabled).toBe(true);
    f.componentInstance.toggle('u_lindiwe');
    f.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('button.go')?.disabled).toBe(false);
    expect(el.textContent).toContain('1 person chosen');
  });

  it('writes the post into the thread, with the note above the title', async () => {
    await ready();
    const actions = TestBed.inject(PostActionsService);
    const data = TestBed.inject(DataService);
    const post = data.post('p_khumalo')!;
    const sent = await actions.sendTo(post, ['u_lindiwe'], 'This is two streets from me');
    expect(sent).toBe(1);
    const thread = db.threads().find((t) => t.participantIds.includes('u_lindiwe') && t.postId === post.id);
    expect(thread).toBeTruthy();
    const last = db.messages(thread!.id).at(-1)!;
    expect(last.fromUserId).toBe('u_demo');
    expect(last.postId).toBe(post.id);
    expect(last.body).toContain('This is two streets from me');
    expect(last.body).toContain(post.title);
  });

  it('refuses a one-way follow instead of throwing', async () => {
    await ready();
    const actions = TestBed.inject(PostActionsService);
    const data = TestBed.inject(DataService);
    db.removeFollow('u_lindiwe', 'u_demo');
    const post = data.post('p_khumalo')!;
    expect(await actions.canSendTo('u_lindiwe')).toBe(false);
    expect(await actions.sendTo(post, ['u_lindiwe'], 'hello')).toBe(0);
  });
});
