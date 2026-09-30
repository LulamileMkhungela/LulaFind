/**
 * Drives "be on the lookout" in a real browser, with real accounts.
 *
 * No demo data: `?demo=0&data=local` is forced, every account in this run is created
 * through the real sign-up screen, and every write goes through the app's own
 * services into the app's own store on the device (`?data=local`, a development
 * switch - the hosted project is not reachable from this container, which is
 * stated in docs/E2E-LOOKOUT.md). What it proves, in order:
 *
 *   1. a new person signs up, allows LulaFind to post a case about them, and
 *      starts a lookout with their location attached;
 *   2. a second new person signs up, follows them, and can see their last seen -
 *      which is the rule the user asked for: last seen is visible to everyone;
 *   3. 24 hours later the follower is asked "are they okay?" on the home screen;
 *   4. the follower says no, and the app publishes a possible-missing-person
 *      case of its own;
 *   5. the person says "I'm here" and the post is gone;
 *   6. with the setting off, the same "no" produces no post at all.
 *
 * The 24 hours are simulated by moving the lookout's own timestamps back in the
 * app's store - the same field the app reads - because a browser test cannot
 * wait a day. Everything else is the real code path.
 *
 * Run with the dev server up:
 *   bash tools/get-browser.sh
 *   LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-lookout.mjs
 */
import { mkdirSync } from 'node:fs';
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = process.env.LF_BASE ?? 'http://localhost:4200';
/* Real accounts, real screens, the app's own store - and no sample data. */
const NO_DEMO = '?demo=0&data=local';
const OUT = new URL('../docs/e2e-lookout/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.LF_CHROME ?? '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/* The person is on the move in Soweto, and they have allowed the app to use it. */
const geolocation = { latitude: -26.2678, longitude: 27.8585 };
await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
await page.setGeolocation(geolocation);

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 240)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];
const problems = [];
const dead = [];

const text = async () => (await page.evaluate(() => document.body.innerText || '')).replace(/\n{2,}/g, '\n').trim();

async function shot(name, note = '') {
  await page.screenshot({ path: `${OUT}${name}.png` });
  const t = await text();
  shots.push({ name, note, text: t });
  console.log(`  📸 ${name}${note ? ' - ' + note : ''}`);
}

async function waitForText(pattern, ms = 6000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pattern.test(await text())) return true;
    await sleep(200);
  }
  return false;
}

async function waitForUrl(pattern, ms = 6000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pattern.test(page.url())) return true;
    await sleep(150);
  }
  return false;
}

async function goto(path, wait = 1600) {
  await page.goto(BASE + path + NO_DEMO, { waitUntil: 'networkidle2' });
  await sleep(wait);
}

/** Click the first visible control whose text or aria-label matches. */
async function tap(label, { selector = 'button, a, [role="button"], ion-toggle, .tab-btn', index = 0, exact = false } = {}) {
  const before = await text();
  const beforeUrl = page.url();
  const clicked = await page.evaluate((t, sel, idx, exact) => {
    const all = Array.from(document.querySelectorAll(sel)).filter((e) => {
      const b = e.getBoundingClientRect();
      const lab = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.textContent || '')).replace(/\s+/g, ' ').trim();
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && (exact ? lab === t : lab.includes(t));
    });
    const el = all[idx];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, label, selector, index, exact);
  if (!clicked) { problems.push(`no control "${label}" on ${page.url().replace(BASE, '')}`); return false; }
  await sleep(700);
  if (before === (await text()) && page.url() === beforeUrl) {
    dead.push(`"${label}" on ${page.url().replace(BASE, '')} changed nothing`);
  }
  return true;
}

async function fill(selector, value) {
  const ok = await page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
  if (!ok) problems.push(`no field ${selector} on ${page.url().replace(BASE, '')}`);
  await sleep(250);
  return ok;
}

/** Tick a checkbox on the sign-up screen (they are plain inputs, not toggles). */
async function tick(label) {
  const ok = await page.evaluate((t) => {
    const row = Array.from(document.querySelectorAll('label.snap-check')).find((l) => (l.innerText || '').includes(t));
    const box = row?.querySelector('input[type="checkbox"]');
    if (!box || box.checked) return !!box;
    box.click();
    return true;
  }, label);
  if (!ok) problems.push(`no checkbox "${label}"`);
  await sleep(200);
  return ok;
}

/** Sign up through the real five-step screen. */
async function signUp(name, email, password) {
  await goto('/auth');
  await tap('Create new account');
  await waitForText(/What's your name/);
  await fill('input[placeholder="e.g. John Doe"]', name);
  await tap('Agree and continue');
  await sleep(400);
  await tap('Continue');                       // username, generated from the name
  await sleep(400);
  await fill('input[placeholder="At least 8 characters"]', password);
  await tap('Continue');
  await sleep(400);
  await fill('input[type="email"]', email);
  await tap('Continue');
  await waitForText(/Select your province/);
  await fill('select.snap-select', 'GP');
  await tick('18 or older');
  await tick('I agree to the Terms');
  await tap('Agree and continue');
  await sleep(2000);
  if (!/\/(home|onboarding)/.test(page.url())) return false;
  await intoApp();
  return /\/home/.test(page.url());
}

/** A new account lands on onboarding; finish it the way a person can (Skip). */
async function intoApp() {
  for (let i = 0; i < 8 && /onboarding/.test(page.url()); i++) {
    const moved = await tap('Skip') || await tap('Enter LulaFind');
    if (!moved) break;
    await sleep(700);
  }
  if (/onboarding/.test(page.url())) problems.push('could not leave the onboarding screen');
  return page.url();
}

/**
 * Press a button inside an Ionic alert.
 *
 * Ionic renders alert buttons inside the component's shadow root, so an
 * ordinary querySelector never sees them - this reaches in and clicks the real
 * button, which is what a thumb does.
 */
async function tapAlert(label) {
  const ok = await page.evaluate((t) => {
    const alerts = Array.from(document.querySelectorAll('ion-alert, ion-action-sheet, ion-alert-controller ion-alert'));
    for (const alert of alerts) {
      const roots = [alert.shadowRoot, alert].filter(Boolean);
      for (const root of roots) {
        const buttons = Array.from(root.querySelectorAll('button'));
        const named = buttons.find((b) => (b.textContent || b.innerText || '').trim().includes(t));
        if (named) { named.click(); return true; }
      }
    }
    return false;
  }, label);
  if (!ok) problems.push(`no alert button "${label}"`);
  await sleep(1400);
  return ok;
}

async function signOut() {
  await goto('/me');
  await tap('Sign out');
  await sleep(600);
  await tapAlert('Sign out');
  await sleep(1200);
  if (!/\/auth/.test(page.url())) {
    /* Nothing else should be holding the session - say so instead of pretending. */
    problems.push(`sign out did not return to the sign-in screen (at ${page.url().replace(BASE, '')})`);
  }
}

/** Age the open lookout past its 24 hours, in the app's own store. */
async function ageLookout() {
  return page.evaluate(() => {
    const key = 'lulafind.db.snapshot';
    const db = JSON.parse(localStorage.getItem(key) || 'null');
    if (!db?.lookouts?.length) return null;
    const HOUR = 3600000;
    const l = db.lookouts.find((x) => x.status === 'active') ?? db.lookouts[0];
    l.startedAt = Date.now() - 25 * HOUR;
    l.checkAt = l.startedAt + 24 * HOUR;
    l.status = 'active';
    l.askedAt = null;
    l.askedIds = [];
    l.answers = [];
    localStorage.setItem(key, JSON.stringify(db));
    return l.id;
  });
}

const state = () => page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('lulafind.db.snapshot') || 'null');
  return {
    lookouts: (db?.lookouts ?? []).map((l) => ({ id: l.id, status: l.status, asked: l.askedIds.length, askedAt: l.askedAt, answers: l.answers.length, post: l.escalatedPostId, area: l.area, location: !!l.location })),
    posts: (db?.posts ?? []).filter((p) => p.lookoutId).map((p) => ({ id: p.id, audience: p.audience, appPosted: p.appPosted, title: p.title })),
    users: (db?.users ?? []).map((u) => ({ id: u.id, name: u.displayName, alerts: u.privacy?.allowSafetyAlertPosts, audience: u.privacy?.safetyAlertAudience, showLastSeen: u.privacy?.showLastSeen, checkIn: u.checkIn?.status ?? null })),
    follows: (db?.follows ?? []).map((f) => ({ from: f.followerId, to: f.followingId, status: f.status }))
  };
});

const A = { name: 'Nandi Mokoena', email: `nandi.e2e.${Date.now()}@example.co.za`, pass: 'password123' };
const B = { name: 'Sipho Khumalo', email: `sipho.e2e.${Date.now()}@example.co.za`, pass: 'password123' };

console.log('\n== 1. a brand-new person signs up (no demo data) ==');
await goto('/', 2400);
await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
await goto('/auth', 1800);
const signedUpA = await signUp(A.name, A.email, A.pass);
console.log('  signed up A:', signedUpA, page.url().replace(BASE, ''));
await shot('01-signup-new-user', 'the account the rest of this run uses');

console.log('\n== 2. allow the app to publish a case about me, and start a lookout ==');
await goto('/settings');
await waitForText(/Let LulaFind post a case about me/);
await shot('02-settings-off', 'the setting starts off: LulaFind may not post a case');
const settingsToggle = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('ion-item')).find((i) => (i.innerText || '').includes('Let LulaFind post a case about me'));
  const t = row?.querySelector('ion-toggle');
  if (!t) return false;
  t.click();
  return true;
});
if (!settingsToggle) problems.push('no "Let LulaFind post a case about me" toggle in Settings');
await sleep(1000);
/* Keep the control itself in the evidence, not just the toast. */
await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('ion-item')).find((i) => (i.innerText || '').includes('Let LulaFind post a case about me'));
  row?.scrollIntoView({ block: 'center' });
});
await sleep(600);
await shot('03-allow-alerts-on', 'the person turns it on themselves, in Settings');
if ((await state()).users.find((u) => u.name === A.name)?.alerts !== true) {
  problems.push('the setting did not reach the account');
}

/* The other half of the privacy story: the last-seen control, exercised here
   instead of being assumed. It has to reach the account and change the town. */
const lastSeenToggle = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('ion-item')).find((i) => (i.innerText || '').includes('Show my town and last seen'));
  const t = row?.querySelector('ion-toggle');
  if (!t) return false;
  t.scrollIntoView({ block: 'center' });
  t.click();
  return true;
});
if (!lastSeenToggle) problems.push('no "Show my town and last seen" toggle in Settings');
await sleep(1200);
await shot('03b-last-seen-off', 'the person hides their town themselves');
const hidden = (await state()).users.find((u) => u.name === A.name)?.showLastSeen;
if (hidden !== false) problems.push(`hiding the town did not reach the account (saw ${hidden})`);
/* Put it back: the run needs the area visible for the last-seen steps that follow. */
await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('ion-item')).find((i) => (i.innerText || '').includes('Show my town and last seen'));
  row?.querySelector('ion-toggle')?.click();
});
await sleep(1000);
const back = (await state()).users.find((u) => u.name === A.name)?.showLastSeen;
if (back !== true) problems.push(`turning the town back on did not reach the account (saw ${back})`);

await goto('/safety');
await waitForText(/Be on the lookout/);
await shot('04-safety-centre', 'the same choice, where a lookout is started');
await fill('select.inp', 'public');
await sleep(1000);
await shot('05-audience-everyone', 'and who may see the post: everyone');

await fill('input.inp[placeholder^="e.g. walking"]', 'Walking to the Soweto taxi rank');
await fill('input.inp[placeholder^="e.g. I finish"]', 'Should be home by 20:00');
await sleep(300);
await shot('06-lookout-form-filled', 'where they are going, and what their followers should know');
await tap('Start the lookout');
await waitForText(/Lookout started|Your followers have been told/, 5000);
await sleep(1200);
await shot('07-lookout-started', 'the person sees their own open lookout');
const afterStart = await state();
console.log('  open lookouts:', JSON.stringify(afterStart.lookouts));
const audience = afterStart.users.find((u) => u.name === A.name)?.audience;
if (audience !== 'public') problems.push(`the audience choice did not save (saw ${audience})`);

console.log('\n== 3. a second new person follows, and can see the last seen ==');
await signOut();
const signedUpB = await signUp(B.name, B.email, B.pass);
console.log('  signed up B:', signedUpB);
const subject = (await state()).users.find((u) => u.name === A.name);
if (!subject) problems.push('the first account is not in the store');
await goto(`/user/${subject?.id}`);
await waitForText(/Last seen|followers/);
await shot('08-other-profile-last-seen', 'another person can see when they last checked in');
/* Exact text on purpose: the lookout card says "Followers are asked in 24 h",
   and a loose match on "Follow" clicked that card instead of the button. */
await tap('Follow', { exact: true, selector: 'button' });
await sleep(1600);
const followed = await state();
console.log('  follows:', JSON.stringify(followed.follows));
if (!followed.follows.some((f) => f.to === subject?.id && f.status === 'accepted')) {
  problems.push('the follow never landed - nobody would be asked about this person');
}
await goto(`/user/${subject?.id}`);
await shot('09-followed', 'following the person who is out there');

console.log('\n== 4. twenty-four hours later: the follower is asked ==');
const aged = await ageLookout();
console.log('  aged lookout:', aged);
await goto('/home', 2600);
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await sleep(1500);
await goto('/home', 2600);
const prompted = await waitForText(/Is Nandi Mokoena okay\?/, 8000);
if (!prompted) {
  problems.push('home screen never asked "Is Nandi Mokoena okay?" - it said: ' +
    (await text()).split('\n').find((l) => /okay/i.test(l)) ?? 'nothing about being okay');
}
await shot('10-home-are-they-okay', 'the question is on the home screen, above the feed');
await tap('Is Nandi Mokoena okay?', { selector: 'a, button' });
await waitForUrl(/\/lookout\//, 6000);
await shot('11-lookout-page-ask', 'the safety check, with the two answers');
const asked = await state();
console.log('  asked followers:', JSON.stringify(asked.lookouts));
console.log('  follows:', JSON.stringify(asked.follows));
console.log('  users:', JSON.stringify(asked.users));

console.log('\n== 5. one "no" flags them, and the app publishes the case ==');
await tap('No, something is wrong');
await sleep(2500);
const flagged = await state();
console.log('  after the no:', JSON.stringify(flagged.lookouts));
console.log('  app-published posts:', JSON.stringify(flagged.posts));
if (!flagged.lookouts.some((l) => l.status === 'escalated')) problems.push('the lookout did not escalate');
if (!flagged.posts.length) problems.push('no case was published after a "no"');
await shot('12-case-published', 'the case LulaFind published, open for the follower');

console.log('\n== 6. the person sees the post and says "I\'m here" ==');
const postId = (await state()).lookouts.find((l) => l.post)?.post;
await signOut();
await goto('/auth', 1500);
/* The auth landing page opens first: get to the email + password step, then submit. */
await tap('Log in', { exact: true });
await sleep(900);
await fill('input[type="email"]', A.email);
await fill('input[type="password"]', A.pass);
await tap('Log in', { exact: true });
await sleep(2600);
console.log('  after sign-in: url', page.url().replace(BASE, ''), '|', (await text()).split('\n').slice(0, 3).join(' / '));
if (!/home/.test(page.url())) problems.push('could not sign back in as the first account');

/* Straight to the case the app published about them. */
console.log('  opening the case:', postId);
await goto(`/post/${postId}`);
console.log('  url after opening the case:', page.url().replace(BASE, ''));
const aboutYou = await waitForText(/This case is about you/, 6000);
await shot('13-subject-sees-case', 'the app-published case, seen by the person it is about');
if (!aboutYou) problems.push('the app-published case did not tell the person it is about them');
await tap("I'm here", { selector: 'button' });
await sleep(2400);
await shot('14-im-here', 'they said they are here');
const closed = await state();
console.log('  after "I\'m here":', JSON.stringify(closed.lookouts));
console.log('  posts left:', JSON.stringify(closed.posts));
if (closed.posts.length) problems.push('the app-published post survived "I\'m here"');
const gone = await page.evaluate((id) => !JSON.parse(localStorage.getItem('lulafind.db.snapshot') || '{}').posts.some((p) => p.id === id), postId);
if (!postId) problems.push('no app-published case to open - nothing was published');
else if (!gone) problems.push('the post is still in the store');
await goto(`/post/${postId}`);
const missing = await waitForText(/not here|was not found|could not|No post|removed|deleted/i, 5000);
await shot('15-post-gone', 'the deleted case is gone: ' + (missing ? 'the app says so' : 'CHECK the screen'));
if (!missing) problems.push(`the deleted post ${postId} still renders`);

/* And the safety centre agrees it is over. */
await goto('/safety');
const over = await waitForText(/Be on the lookout/, 5000);
if (!over) problems.push('the safety centre does not come back after the lookout closes');
if (/You are flagged/.test(await text())) problems.push('the safety centre still says they are flagged');

console.log('\n== 7. with the setting off, the same "no" posts nothing ==');
const postsBefore = (await state()).posts.map((p) => p.id);
await goto('/safety');
await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll('ion-item')).find((i) => (i.innerText || '').includes('Let LulaFind post a case about me'));
  row?.querySelector('ion-toggle')?.click();
});
await sleep(1200);
await fill('input.inp[placeholder^="e.g. walking"]', 'Walking back from the rank');
await tap('Start the lookout');
await sleep(1800);
await ageLookout();
await signOut();
await goto('/auth', 1500);
await tap('Log in', { exact: true });
await sleep(900);
await fill('input[type="email"]', B.email);
await fill('input[type="password"]', B.pass);
await tap('Log in', { exact: true });
await sleep(2600);
if (!/home/.test(page.url())) problems.push('could not sign back in as the second account');
await goto('/home', 2600);
await goto('/home', 2400);
const askedAgain = await waitForText(/Is Nandi Mokoena okay\?/, 6000);
if (!askedAgain) problems.push('the second lookout never asked the follower');
await tap('Is Nandi Mokoena okay?', { selector: 'a, button' });
await waitForUrl(/\/lookout\//, 6000);
await tap('No, something is wrong');
await sleep(2500);
await shot('16-no-permission-no-post', 'a "no" with the setting off: flagged, but nothing posted');
const gated = await state();
console.log('  lookouts:', JSON.stringify(gated.lookouts));
console.log('  posts:', JSON.stringify(gated.posts));
const newPosts = gated.posts.filter((p) => !postsBefore.includes(p.id));
if (newPosts.length) problems.push('a case was published although the person had not allowed it: ' + JSON.stringify(newPosts));
const pageText = await text();
if (!/not allowed LulaFind to publish|no case was posted/i.test(pageText)) {
  problems.push('the page did not say why no case was posted');
}

console.log('\n== results ==');
console.log(`  steps: ${shots.length}`);
console.log(`  console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 10).forEach((e) => console.log('    ! ' + e));
console.log(`  dead clicks: ${dead.length}`);
dead.forEach((d) => console.log('    - ' + d));
console.log(`  problems: ${problems.length}`);
problems.forEach((p) => console.log('    ✗ ' + p));

await browser.close();
process.exit(problems.length ? 1 : 0);
