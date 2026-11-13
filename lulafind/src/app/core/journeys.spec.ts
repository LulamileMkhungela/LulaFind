import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { writeFileSync, mkdirSync } from 'node:fs';

import { LocalDb } from './data/local-db';
import { LULA_API, MockApi } from './data/api';
import { AuthService } from './services/auth.service';
import { DataService } from './services/data.service';
import { ModerationService } from './services/moderation.service';
import { UserProfile } from './models/types';
import { AdminComponent } from '../pages/admin/admin.component';
import { NotificationsComponent } from '../pages/notifications/notifications.component';
import { PostDetailComponent } from '../pages/post/post-detail.component';
import { FoundComponent } from '../pages/found/found.component';

/**
 * Journeys. These drive the real screens - real data layer, real services, real
 * templates - and write what actually rendered to docs/VERIFICATION.md.
 *
 * They exist because a green unit test on a service is not proof that a person
 * can do the thing: the review queue bug (a moderation list built out of the
 * feed, which hides the very posts it was looking for) passed every service
 * test and failed this file.
 */

@Component({ standalone: true, template: '' })
class RouteStubComponent {}

const ROUTES = [
  { path: 'auth', component: RouteStubComponent },
  { path: 'home', component: RouteStubComponent },
  { path: 'post/:id', component: RouteStubComponent },
  { path: 'admin', component: RouteStubComponent },
  { path: 'notifications', component: RouteStubComponent },
  { path: 'found', component: RouteStubComponent },
  { path: 'settings', component: RouteStubComponent }
];

let db: LocalDb;
let routeId = '';
const evidence: string[] = [];

function note(title: string, body: string): void {
  evidence.push(`\n### ${title}\n\n\`\`\`text\n${body.trim()}\n\`\`\`\n`);
}

/** Everything a screen shows, as a person would read it. */
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

/** Click the real button whose text matches, the way a thumb would. */
async function clickButton(f: ComponentFixture<unknown>, text: string): Promise<boolean> {
  const buttons = Array.from((f.nativeElement as HTMLElement).querySelectorAll('button, a'));
  const hit = buttons.find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text));
  if (!hit) return false;
  (hit as HTMLElement).click();
  await settle(f);
  return true;
}

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
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => routeId } } } }
    ]
  });
}

/** The case input the create screen would send. */
const caseInput = (over: Record<string, unknown> = {}) => ({
  type: 'missing' as const,
  title: 'Help find Thandi Mokoena in Soweto',
  body: 'She was last seen walking to the taxi rank after work on Tuesday evening.',
  media: [] as any[], province: 'GP' as const, town: 'Soweto',
  lastSeenAt: Date.now(), lastSeenWhere: 'Orlando West', geo: { lat: -26.2375, lng: 27.9255 },
  contactLabel: 'Call', contactValue: '0710000000', contactVisibleTo: 'everyone' as const,
  caseNumber: null, reward: null,
  subject: { name: 'Thandi Mokoena', age: 14, gender: 'female' as const, height: '', build: '', skinTone: '', hair: '', eyes: '', clothing: 'blue school skirt', distinguishing: '', medical: '', vehicle: '', languages: '', surname: 'Mokoena', relationship: 'mother' },
  audience: 'public' as const, spotlightId: null, chatEnabled: true, allowComments: true,
  anonymous: false, askWanted: false, khumbu: null, guardianConsent: true, ...over
});

describe('Journey: a child case goes through moderation before anyone is alerted', () => {
  beforeEach(bed);

  it('walks the whole thing on the real screens', async () => {
    const data = TestBed.inject(DataService) as DataService;
    const mod = TestBed.inject(ModerationService) as ModerationService;
    await TestBed.inject(AuthService).signInDemo();

    // 1. The mother posts. It is held, not published.
    const child = await data.createPost(caseInput());
    expect(child.status).toBe('under_review');
    note('1. The case the mother just posted', `status: ${child.status}\nalerts sent: (none yet - see below)`);

    // 2. A member in the same province opens Notifications: nothing.
    signInAs('u_lerato');
    const notesBefore = TestBed.createComponent(NotificationsComponent);
    await settle(notesBefore);
    const before = textOf(notesBefore);
    expect(before).toContain('No alerts yet');
    note('2. What another Gauteng member sees in Notifications now', before);

    // 3. The moderator opens the admin screen and clicks Review.
    signInAs('u_mod');
    await mod.loadPending();
    const admin = TestBed.createComponent(AdminComponent);
    await settle(admin);
    const clickedReview = await clickButton(admin, 'Review');
    expect(clickedReview).toBe(true);
    const reviewScreen = textOf(admin);
    expect(reviewScreen).toContain('Thandi Mokoena');
    expect(reviewScreen).toContain('Publish and alert');
    note('3. The moderator\u2019s Review tab', reviewScreen);

    // 4. They publish it - the real button, the real handler.
    const published = await clickButton(admin, 'Publish and alert');
    expect(published).toBe(true);
    await settle(admin);
    note('4. Straight after pressing Publish and alert', textOf(admin));

    expect((await data.loadPost(child.id))?.status).toBe('active');
    expect(mod.pendingCases().map((p) => p.id)).not.toContain(child.id);

    // 5. The same member now has the alert, with the distance from her own fix.
    localStorage.setItem('lulafind.lastLocation', JSON.stringify({ point: { lat: -26.2041, lng: 28.0473 }, at: Date.now() }));
    signInAs('u_lerato');
    await data.loadUserScoped();
    const notesAfter = TestBed.createComponent(NotificationsComponent);
    await settle(notesAfter);
    const after = textOf(notesAfter);
    expect(after).toContain('A child is missing nearby');
    expect(after).toContain('km');
    note('5. The same member\u2019s Notifications after publishing', after);

    // 6. The author is never alerted about her own case.
    signInAs('u_demo');
    await data.loadUserScoped();
    const authorNotes = textOf(TestBed.createComponent(NotificationsComponent));
    expect(authorNotes).not.toContain('A child is missing nearby');
    note('6. The mother\u2019s own Notifications (never her own case)', authorNotes);
  });
});

describe('Journey: focused case details and a meaningful Still searching update', () => {
  beforeEach(bed);

  it('keeps the status actions visible without checklist clutter and saves the open-case update', async () => {
    const data = TestBed.inject(DataService) as DataService;
    await TestBed.inject(AuthService).signInDemo();
    const post = await data.createPost(caseInput());

    routeId = post.id;
    const page = TestBed.createComponent(PostDetailComponent);
    await settle(page);
    const first = textOf(page);
    expect(first).toContain('Mark as found');
    expect(first).toContain('Still searching');
    // The first-hours checklist used to be deliberately absent from the case
    // page, and the audit in docs/IMPLEMENTATION-STATUS called that a release
    // blocker: the family could not reach the one screen built for them. It is
    // now on the page, collapsed, carrying its own SAPS guidance - so the rule
    // below is the corrected one: the checklist is reachable, its detail stays
    // inside it, and the status actions are still on screen beside it.
    expect(first).toContain('First hours');
    expect(first).not.toContain('No waiting period');
    expect(first).toContain('Mark as found');
    note('7. The focused case page with the status actions', first.split('Comments')[0]);

    await clickButton(page, 'Still searching');
    await settle(page);
    const updated = await data.loadPost(post.id);
    expect(updated?.status).toBe(post.status);
    expect(updated?.outcome.found).toBe(false);
    expect(updated?.events.at(-1)?.kind).toBe('still_searching');
    expect(textOf(page)).toContain('This case remains open');
    note('8. After the poster confirms they are still searching', textOf(page).split('Comments')[0]);
  });

  it('shows the closure step once a case is found', async () => {
    const data = TestBed.inject(DataService) as DataService;
    await TestBed.inject(AuthService).signInDemo();
    const post = await data.createPost(caseInput({ subject: { ...caseInput().subject, age: 31 } }));
    await data.markFound(post.id, { whereabouts: 'Home in Soweto', finderUserId: 'u_lerato' });

    routeId = post.id;
    const page = TestBed.createComponent(PostDetailComponent);
    await settle(page);
    const shown = textOf(page);
    expect(shown).toContain('SAPS 92');
    note('11. A closed case, as the family sees it', shown.split('Comments')[0]);

    const closed = data.feed().filter((p) => p.outcome.found);
    note('12a. Closed cases the *feed* holds - the reason the page cannot be built from the feed', closed.map((p) => `${p.id} · ${p.title} · foundAt=${p.outcome.foundAt} · finder=${p.outcome.finderName} · credits=${data.authorOf(p.outcome.finderUserId ?? '')?.contributorCredits}`).join('\n') || '(none)');

    const found = TestBed.createComponent(FoundComponent);
    await settle(found);
    const foundText = textOf(found);
    note('12. The public /found page', foundText);
    expect(foundText).toContain('They came home');
    expect(foundText).toContain('found after');
  });
});

/**
 * Write what rendered. Called at the end of each journey so the file exists even
 * when a later assertion fails - the point is to see the real screen.
 */
function flushEvidence(): void {
  try {
    mkdirSync('../docs', { recursive: true });
    writeFileSync(
      '../docs/VERIFICATION.md',
      `# What the screens actually render\n\nGenerated by \`core/journeys.spec.ts\` - real components, real services, real data layer, driven by clicking the real buttons.\n` +
        evidence.join('') +
        '\n'
    );
  } catch { /* evidence is a convenience, never a test failure */ }
}
afterEach(flushEvidence);
