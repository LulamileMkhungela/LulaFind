import { Component, Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { provideIonicAngular } from '@ionic/angular';
import { writeFileSync, mkdirSync } from 'node:fs';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { UserProfile } from './models/types';

import { HomeComponent } from '../pages/tabs/home.component';
import { SpotlightComponent } from '../pages/tabs/spotlight.component';
import { ChatsComponent } from '../pages/tabs/chats.component';
import { MeComponent } from '../pages/tabs/me.component';
import { ProgressComponent } from '../pages/progress/progress.component';
import { NotificationsComponent } from '../pages/notifications/notifications.component';
import { AdminComponent } from '../pages/admin/admin.component';
import { FoundComponent } from '../pages/found/found.component';
import { FaqsComponent } from '../pages/help/faqs.component';
import { HelpComponent } from '../pages/help/help.component';
import { TipsComponent } from '../pages/tips/tips.component';
import { SearchComponent } from '../pages/search/search.component';
import { SavedComponent } from '../pages/saved/saved.component';
import { ConnectionsComponent } from '../pages/connections/connections.component';
import { SettingsComponent } from '../pages/settings/settings.component';
import { PostDetailComponent } from '../pages/post/post-detail.component';
import { CreatePostComponent } from '../pages/post/create-post.component';
import { PosterComponent } from '../pages/post/poster.component';
import { SafetyCenterComponent } from '../pages/safety/safety-center.component';
import { ProfileComponent } from '../pages/user/profile.component';
import { AuthComponent } from '../pages/auth/auth.component';
import { TermsComponent } from '../pages/terms/terms.component';

/**
 * How much a screen asks a person to read.
 *
 * The rule this file enforces: every screen is straight to the point, and the
 * FAQ page carries the long answers. A paragraph only belongs on a normal screen
 * if it is one sentence - anything longer belongs in the FAQ, in a sheet, or in
 * the empty state of the screen it is about.
 *
 * It renders the real screens with the real data layer and writes
 * docs/SCREEN-AUDIT.md, so the numbers are what actually rendered, not what the
 * template was meant to say.
 */

@Component({ standalone: true, template: '' })
class RouteStubComponent {}

const ROUTES = [
  { path: 'auth', component: RouteStubComponent },
  { path: 'home', component: RouteStubComponent },
  { path: 'post/:id', component: RouteStubComponent },
  { path: 'user/:id', component: RouteStubComponent },
  { path: 'admin', component: RouteStubComponent },
  { path: 'notifications', component: RouteStubComponent },
  { path: 'found', component: RouteStubComponent },
  { path: 'settings', component: RouteStubComponent },
  { path: 'faqs', component: RouteStubComponent },
  { path: 'help', component: RouteStubComponent }
];

interface ScreenSpec {
  name: string;
  component: Type<unknown>;
  /** Which param the screen reads from the route, if any. */
  routeId?: string;
  /** What that param names, so the test can prove the seed it needs exists. */
  routeParam?: 'post' | 'user';
  /** Who is looking at it. */
  as?: string;
}

let db: LocalDb;
let routeId = '';

function signInAs(userId: string): void {
  const auth = TestBed.inject(AuthService) as AuthService;
  const u = db.user(userId);
  if (!u) throw new Error('no such seeded user: ' + userId);
  (auth as unknown as { user: { set(v: UserProfile | undefined): void } }).user.set(u);
}

function bed(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('lulafind.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* node */ }
  db = new LocalDb(true);
  routeId = '';
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(ROUTES),
      provideIonicAngular(),
      { provide: LULA_API, useValue: new MockApi(db) },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: { get: () => routeId },
            queryParamMap: { get: () => null },
            data: {}
          },
          // Screens that follow ?q= (Search) subscribe to the live query map, so
          // the stub has to answer with one rather than only its snapshot.
          queryParamMap: of(convertToParamMap({}))
        }
      }
    ]
  });
}

function textOf(f: ComponentFixture<unknown>): string {
  const el = f.nativeElement as HTMLElement;
  return (el.innerText || el.textContent || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function settle(f: ComponentFixture<unknown>, rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
  }
}

/**
 * The prose on a screen, as blocks rather than lines.
 *
 * jsdom has no layout and no innerText, so the text of a whole card arrives as
 * one run with nothing between the paragraphs. Instead of guessing at line
 * breaks, walk the DOM and take each element's *own* text - the text it holds
 * directly, not what its children hold. A block of prose is a text node of 18
 * words or more; it is reported once, at its longest, never nested inside
 * itself twice.
 */
function ownText(el: Element): string {
  let out = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += ' ' + (n.nodeValue ?? '');
  });
  return out.replace(/\s+/g, ' ').trim();
}

interface Block {
  text: string;
  words: number;
  fromUser: boolean;
}

function proseBlocks(root: HTMLElement, userWords: string[]): Block[] {
  const candidates: { el: Element; text: string; words: number }[] = [];
  root.querySelectorAll('*').forEach((el) => {
    const text = ownText(el);
    const w = words(text);
    if (w >= 18) candidates.push({ el, text, words: w });
  });
  // Keep the innermost block: if one candidate contains another, the inner one
  // is the paragraph and the outer one is just a wrapper that also holds labels.
  const kept: typeof candidates = [];
  for (const c of candidates.sort((a, b) => b.words - a.words)) {
    if (kept.some((k) => c.el.contains(k.el))) continue;
    kept.push(c);
  }
  const isUser = (text: string): boolean =>
    userWords.some((u) => u.length > 20 && text.includes(u.slice(0, Math.min(60, u.length))));
  return kept
    .map((c) => ({ text: c.text, words: c.words, fromUser: isUser(c.text) }))
    .sort((a, b) => b.words - a.words);
}

/** Everything anyone has written into the app: posts, comments, chats, stories. */
function userWords(_data: DataService): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && words(v) >= 18) out.push(v.replace(/\s+/g, ' ').trim());
  };
  db.posts().forEach((p) => {
    push(p.title);
    push(p.body);
    push(p.subject?.clothing);
    push(p.subject?.distinguishing);
    push(p.subject?.medical);
    push(p.lastSeenWhere);
  });
  db.comments().forEach((c) => push(c.body));
  db.stories().forEach((st) => push(st.text));
  db.users().forEach((u) => push(u.bio));
  db.threads().forEach((t) => {
    db.messages?.(t.id)?.forEach((m: { body: string }) => push(m.body));
  });
  db.tips().forEach((t) => push(t.body));
  return out;
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

const report: string[] = [];
const numbers: string[] = [];
const over: string[] = [];

describe('Every screen says one thing without making anyone read a wall', () => {
  beforeEach(bed);

  const screens: ScreenSpec[] = [
    { name: 'Home / feed', component: HomeComponent, as: 'u_demo' },
    { name: 'Spotlight', component: SpotlightComponent, as: 'u_demo' },
    { name: 'Chats (list)', component: ChatsComponent, as: 'u_demo' },
    { name: 'Me', component: MeComponent, as: 'u_demo' },
    { name: 'Your impact', component: ProgressComponent, as: 'u_demo' },
    { name: 'Notifications', component: NotificationsComponent, as: 'u_demo' },
    { name: 'Found (reunions)', component: FoundComponent, as: 'u_demo' },
    { name: 'Review queue', component: AdminComponent, as: 'u_mod' },
    { name: 'Post detail (my case)', component: PostDetailComponent, routeId: 'p_thato', as: 'u_demo' },
    { name: 'New post', component: CreatePostComponent, as: 'u_demo' },
    { name: 'Poster maker', component: PosterComponent, routeId: 'p_thato', as: 'u_demo' },
    { name: 'Profile', component: ProfileComponent, routeId: 'u_lerato', routeParam: 'user', as: 'u_demo' },
    { name: 'Search', component: SearchComponent, as: 'u_demo' },
    { name: 'Saved', component: SavedComponent, as: 'u_demo' },
    { name: 'Connections', component: ConnectionsComponent, as: 'u_demo' },
    { name: 'Settings', component: SettingsComponent, as: 'u_demo' },
    { name: 'Safety centre', component: SafetyCenterComponent, as: 'u_demo' },
    { name: 'Help', component: HelpComponent, as: 'u_demo' },
    { name: 'Tips', component: TipsComponent, as: 'u_demo' },
    { name: 'Terms', component: TermsComponent, as: 'u_demo' },
    { name: 'Sign in', component: AuthComponent, as: 'u_demo' },
    { name: 'FAQs (the long answers live here)', component: FaqsComponent, as: 'u_demo' }
  ];

  it('renders each screen and measures what a person has to read', async () => {
    const data = TestBed.inject(DataService) as DataService;
    await data.loadFeed();
    const userStrings = userWords(data);

    for (const screen of screens) {
      bed();
      await TestBed.inject(AuthService).signInDemo();
      signInAs(screen.as ?? 'u_demo');
      routeId = screen.routeId ?? '';
      if (screen.routeId && screen.routeParam === 'user') {
        expect(db.user(screen.routeId), `seed missing for ${screen.name}`).toBeTruthy();
      } else if (screen.routeId) {
        expect(await data.loadPost(screen.routeId), `seed missing for ${screen.name}`).toBeTruthy();
      }
      let fixture: ComponentFixture<unknown>;
      try {
        fixture = TestBed.createComponent(screen.component);
        await settle(fixture);
      } catch (err) {
        throw new Error(`${screen.name} did not render: ${String(err)}`);
      }
      const text = textOf(fixture);
      const blocks = proseBlocks(fixture.nativeElement as HTMLElement, userStrings);
      const appBlocks = blocks.filter((b) => !b.fromUser);
      const longest = appBlocks[0];
      const userLongest = blocks.find((b) => b.fromUser);
      const total = words(text);

      numbers.push(
        `| ${screen.name} | ${total} words | ${appBlocks.length} | ` +
          `${longest ? longest.words + 'w' : 'none'} | ${userLongest ? userLongest.words + 'w' : 'none'} |`
      );
      report.push(
        `\n### ${screen.name}\n\n` +
          `\`\`\`text\n${text}\n\`\`\`\n` +
          (appBlocks.length
            ? appBlocks
                .slice(0, 4)
                .map((b) => `- ${b.words} words of app copy: "${b.text}"`)
                .join('\n') + '\n'
            : 'No app paragraphs - labels and values only.\n') +
          (userLongest ? `\n(The longest text on the screen is ${userLongest.words} words of *user* content, not app copy.)\n` : '')
      );

      // A screen may only carry one-sentence prose of its own. Longer belongs in
      // the FAQ, a sheet, or the help page. What someone else wrote is their own.
      expect(total, `${screen.name} is showing very little - is the screen working?`).toBeGreaterThan(3);
      appBlocks
        .filter((b) => b.words > 30)
        .forEach((b) => over.push(`${screen.name}: ${b.words} words - "${b.text}"`));
    }

    mkdirSync('../docs', { recursive: true });
    writeFileSync(
      '../docs/SCREEN-AUDIT.md',
      [
        '# What each screen asks you to read',
        '',
        'Generated by `core/screen-audit.spec.ts`, which renders the real screens with the real',
        'data layer and counts the text that actually appeared.',
        '',
        'The rule: a screen is straight to the point, and the FAQ carries the long answers.',
        'No screen may show a block of its *own* copy longer than 30 words. Text written by users',
        '(a long post, a comment) is counted separately and is not the app talking.',
        '',
        '## Numbers',
        '',
        '| Screen | Text | App paragraphs | Longest app copy | Longest user text |',
        '| --- | --- | --- | --- | --- |',
        ...numbers,
        '',
        ...report
      ].join('\n')
    );

    expect(over, `\nScreens carrying too much of their own prose:\n${over.join('\n')}\n`).toEqual([]);
  });
});
