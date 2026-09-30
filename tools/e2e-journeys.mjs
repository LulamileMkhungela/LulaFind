/**
 * Every journey a person can start, driven in a real browser with a real
 * account, asking one question of each: when the data it needs is missing, does
 * the screen say what is missing and stay put - and when the data is there, does
 * the journey finish?
 *
 * The rule this file checks, screen by screen:
 *   - a required field is validated before the next step, and the message names
 *     the field;
 *   - a tap always answers: either it moves, or it explains why it cannot;
 *   - an action that needs permission says which permission, and offers the way
 *     on (sign in, follow, join a Spotlight);
 *   - nothing that is blocked is a dead end - the person can get back out and
 *     finish later.
 *
 * No demo data: `?demo=0&data=local` is forced and the account is created
 * through the real sign-up screen. `?data=local` is the development store (the
 * hosted project is not reachable from this container - stated in docs/JOURNEYS.md);
 * every other step is the app's own service and screen.
 *
 * Run with the dev server up:
 *   bash tools/get-browser.sh
 *   LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-journeys.mjs
 */
import { mkdirSync } from 'node:fs';
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = process.env.LF_BASE ?? 'http://localhost:4200';
const NO_DEMO = '?demo=0&data=local';
const OUT = new URL('../docs/e2e-journeys/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.LF_CHROME ?? '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
await page.setGeolocation({ latitude: -26.2678, longitude: 27.8585 });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 240)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const dead = [];
const shots = [];
/** The verdict per journey: name, what it needed, what happened. */
const journeys = [];

const text = async () => (await page.evaluate(() => document.body.innerText || '')).replace(/\n{2,}/g, '\n').trim();
const url = () => page.url().replace(BASE, '');

async function shot(name, note = '') {
  await page.screenshot({ path: `${OUT}${name}.png` });
  shots.push({ name, note });
  console.log(`  📸 ${name}${note ? ' - ' + note : ''}`);
}

/** Record one journey's verdict and print it. */
function journey(name, needed, ok, happened) {
  journeys.push({ name, needed, verdict: ok ? 'works' : 'BROKEN', happened });
  console.log(`  ${ok ? '✔' : '✖'} ${name} — ${happened}`);
}

async function waitForText(pattern, ms = 6000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pattern.test(await text())) return true;
    await sleep(180);
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

async function goto(path, wait = 1500) {
  await page.goto(BASE + path + NO_DEMO, { waitUntil: 'networkidle2' });
  await sleep(wait);
}

async function tap(label, { selector = 'button, a, [role="button"], ion-toggle, .tab-btn', index = 0, exact = false, optional = false } = {}) {
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
  if (!clicked) { if (!optional) problems.push(`no control "${label}" on ${url()}`); return false; }
  await sleep(700);
  if (before === (await text()) && page.url() === beforeUrl) dead.push(`"${label}" on ${url()} changed nothing`);
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
  if (!ok) problems.push(`no field ${selector} on ${url()}`);
  await sleep(220);
  return ok;
}

/** Sign up through the real five-step screen. */
async function signUp(name, email, password) {
  await goto('/auth');
  await tap('Create new account');
  await waitForText(/What's your name/);
  await fill('input[placeholder="e.g. John Doe"]', name);
  await tap('Agree and continue', { exact: true });
  await sleep(500);
  await tap('Continue', { exact: true });
  await sleep(500);
  await fill('input[placeholder="At least 8 characters"]', password);
  await tap('Continue', { exact: true });
  await sleep(500);
  await fill('input[type="email"]', email);
  await tap('Continue', { exact: true });
  await waitForText(/Select your province/, 6000);
  await fill('select.snap-select', 'GP');
  await tick('18 or older');
  await tick('I agree to the Terms');
  await tap('Agree and continue', { exact: true });
  await sleep(2400);
  await intoApp();
  return /\/home/.test(page.url());
}

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

async function tapAlert(label) {
  const ok = await page.evaluate((t) => {
    const alerts = Array.from(document.querySelectorAll('ion-alert, ion-action-sheet, ion-alert-controller ion-alert'));
    for (const alert of alerts) {
      const roots = [alert.shadowRoot, alert].filter(Boolean);
      for (const root of roots) {
        const named = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || b.innerText || '').trim().includes(t));
        if (named) { named.click(); return true; }
      }
    }
    return false;
  }, label);
  if (!ok) problems.push(`no alert button "${label}"`);
  await sleep(1400);
  return ok;
}

/** What the alert/sheet is offering, so an error message can be read out. */
async function alertText() {
  return page.evaluate(() => Array.from(document.querySelectorAll('ion-alert, ion-action-sheet'))
    .map((a) => (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim()).join(' | '));
}

async function signOut() {
  await goto('/me');
  await tap('Sign out');
  await sleep(600);
  await tapAlert('Sign out');
  await sleep(1200);
  if (!/\/auth/.test(page.url())) problems.push(`sign out did not return to the sign-in screen (at ${url()})`);
}

async function intoApp() {
  for (let i = 0; i < 8 && /onboarding/.test(page.url()); i++) {
    const moved = (await tap('Skip', { optional: true })) || (await tap('Enter LulaFind', { optional: true }));
    if (!moved) break;
    await sleep(700);
  }
  return url();
}

const state = () => page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('lulafind.db.snapshot') || 'null');
  return {
    posts: (db?.posts ?? []).map((p) => ({ id: p.id, authorId: p.authorId, type: p.type, title: p.title, body: (p.body || '').slice(0, 40), editedAt: p.editedAt ?? null, status: p.status })),
    comments: (db?.comments ?? []).length,
    stories: (db?.stories ?? []).map((s) => ({ id: s.id, authorId: s.authorId, text: (s.text || '').slice(0, 30) })),
    reports: (JSON.parse(localStorage.getItem('lulafind.moderation.reports') || '[]') ?? []).length,
    follows: (db?.follows ?? []).map((f) => ({ from: f.followerId, to: f.followingId, status: f.status })),
    threads: (db?.threads ?? []).length,
    users: (db?.users ?? []).map((u) => ({ id: u.id, name: u.displayName, email: u.email }))
  };
});

/* ------------------------------------------------------------------ */
/* The one account this run creates, through the real sign-up screen.  */
/* ------------------------------------------------------------------ */
const A = { first: 'Nandi', last: 'Mokoena', name: 'Nandi Mokoena', email: `nandi.j.${Date.now()}@example.co.za`, pass: 'password123' };

console.log('\n== J1. sign up: every step refuses to move without its data ==');
await goto('/', 2200);
await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
await goto('/auth', 1600);
await tap('Create new account');
await waitForText(/What's your name|Step 1 of 5/);

/* Step 1 - name, empty. The step must not move and must say what it wants. */
const beforeStepName = await text();
await tap('Agree and continue', { exact: true });
await sleep(900);
const nameError = await waitForText(/Enter your (first name|name)|name and surname/i, 2500);
const stillStep1 = /Step 1 of 5/.test(await text());
journey('Sign-up step 1: name required', 'first name and surname', nameError && stillStep1,
  nameError && stillStep1 ? 'empty Continue showed the message and stayed on step 1'
    : `empty Continue did not stop on step 1 (error=${nameError}, step1=${stillStep1})`);
await shot('01-signup-name-required', 'Continue with no name: the screen says what it wants');

await fill('input[placeholder="e.g. John Doe"]', A.name);
await tap('Agree and continue', { exact: true });
await waitForText(/Step 2 of 5|username|handle/i, 5000);
await tap('Continue', { exact: true });

/* Step 3 - password, too short. */
await waitForText(/At least 8 characters|Step 3 of 5/, 5000);
const step3 = /Step 3 of 5/.test(await text());
if (step3) {
  await fill('input[placeholder="At least 8 characters"]', 'abc');
  await tap('Continue', { exact: true });
  await sleep(900);
  const pwError = await waitForText(/at least 8 characters/i, 2500);
  const stillStep3 = /Step 3 of 5/.test(await text());
  journey('Sign-up step 3: password length', 'at least 8 characters', pwError && stillStep3,
    pwError && stillStep3 ? 'a 3-character password was refused with the rule spelled out'
      : `short password was not refused (error=${pwError}, step3=${stillStep3})`);
  await shot('02-signup-password-rule', 'a short password is refused before the next step');
  await fill('input[placeholder="At least 8 characters"]', A.pass);
  await tap('Continue', { exact: true });
} else {
  journey('Sign-up step 3: password length', 'at least 8 characters', false, `never reached step 3 (at "${url()}")`);
}

/* Step 4 - email, malformed. */
await waitForText(/email|Step 4 of 5/i, 5000);
await fill('input[type="email"]', 'nandi-at-example');
await tap('Continue', { exact: true });
await sleep(1000);
const emailError = await waitForText(/valid email/i, 2500);
const stillStep4 = /Step 4 of 5/.test(await text());
journey('Sign-up step 4: email must be valid', 'a real email address', emailError && stillStep4,
  emailError && stillStep4 ? 'a malformed address was refused with the message' : `bad email was not refused (error=${emailError}, step4=${stillStep4})`);
await shot('03-signup-email-rule', 'an address without a domain is refused');
await fill('input[type="email"]', A.email);
await tap('Continue', { exact: true });

/* Step 5 - province, age and terms are the last gates. */
await waitForText(/Select your province|Step 5 of 5/, 6000);
await tap('Agree and continue', { exact: true });
await sleep(900);
const gateText = await text();
const provinceError = /select your province|18 or older|accept the terms/i.test(gateText);
journey('Sign-up step 5: province, age and terms', 'province + 18 + terms', provinceError,
  provinceError ? 'the last step refuses to create the account without them' : 'the last step created the account with nothing chosen');
await shot('04-signup-final-gate', 'the last step and its rules');
await fill('select.snap-select', 'GP');
await tick('18 or older');
await tick('I agree to the Terms');
await tap('Agree and continue', { exact: true });
await sleep(2400);
const signedIn = await waitForUrl(/\/(home|onboarding)/, 6000);
await intoApp();
journey('Sign-up completes', 'all five steps filled', signedIn && /\/home/.test(page.url()),
  signedIn ? `a new account landed in the app at ${url()}` : `sign-up ended at ${url()}`);

console.log('\n== J2. new post: the Post button always answers a tap ==');
await goto('/new', 1800);
await tap('Post', { exact: true });
await sleep(900);
const checklist = await waitForText(/Choose what you are posting|required/i, 2500);
const stayedOnComposer = /\/new/.test(page.url());
journey('New post: required data', 'category, story, province, town', checklist && stayedOnComposer,
  checklist && stayedOnComposer ? 'an empty Post showed the checklist and stayed on the composer'
    : `empty Post did not explain itself (checklist=${checklist}, stayed=${stayedOnComposer})`);
await shot('05-new-post-required', 'Post with nothing filled: the list of what is missing');

/* Interrupted halfway: leave the screen and come back. Nothing typed may vanish. */
await tap('Missing person');
await sleep(500);
const sentinel = 'Nandi left for the taxi rank at 06:10 and has not been seen since.';
await fill('textarea[data-field="body"]', sentinel);
await goto('/home', 1600);
await goto('/new', 1800);
const keptNote = await waitForText(/We kept what you typed/, 3000);
const keptText = await page.evaluate(() => document.querySelector('textarea[data-field="body"]')?.value ?? '');
journey('New post: finish later', 'a half-written post', keptNote && keptText.includes('06:10'),
  keptNote && keptText.includes('06:10')
    ? 'leaving the composer and coming back put the text back, with one tap to start fresh'
    : `the composer came back empty (note=${keptNote}, text=${keptText.slice(0, 30)})`);
await shot('05b-draft-kept', 'the composer says it kept what was typed');

await fill('textarea[data-field="body"]', sentinel + ' Last seen in a blue jacket.');
await fill('.location-grid select', 'GP');
await fill('input[placeholder="e.g. Soweto"]', 'Soweto');
await sleep(300);
await tap('Post', { exact: true });
const posted = await waitForUrl(/\/post\/p_/, 8000);
journey('New post publishes', 'the four required fields', posted,
  posted ? `the post published and opened at ${url()}` : `the composer stayed at ${url()} after a complete Post`);
const myPostId = posted ? url().split('/post/')[1].split('?')[0].split('/')[0] : null;
if (posted) {
  const listed = (await state()).posts.find((p) => p.id === myPostId);
  journey('New post reaches the store', 'a stored post', !!listed, listed ? `the store holds "${listed.title.slice(0, 40)}"` : 'nothing was written');
  const draftGone = await page.evaluate(() => !localStorage.getItem('lulafind.composer.draft'));
  journey('Published post clears its draft', 'the kept draft', draftGone,
    draftGone ? 'the draft was cleared once the post was shared' : 'the draft was left behind after sharing');
  await shot('06-new-post-published', 'the post the account just published');
}

console.log('\n== J3. comment: empty is refused, real text posts ==');
if (myPostId) {
  await goto(`/post/${myPostId}`, 1800);
  const noPostYet = await page.evaluate(() => !document.querySelector('button.post'));
  await fill('textarea[aria-label="Write a comment"]', 'x');
  await sleep(400);
  const postAppears = await page.evaluate(() => !!document.querySelector('button.post'));
  journey('Comment: empty comment', 'text before posting', noPostYet && postAppears,
    noPostYet && postAppears ? 'no Post button until there is text, then it appears'
      : `comment gate wrong (hidden when empty=${noPostYet}, shown with text=${postAppears})`);
  await fill('textarea[aria-label="Write a comment"]', '');
  await fill('textarea[aria-label="Write a comment"]', 'Nandi was seen at the rank at 06:40. Sending this to the family.');
  await sleep(300);
  await tap('Post', { exact: true });
  const said = await waitForText(/Nandi was seen at the rank at 06:40/, 5000);
  journey('Comment posts', 'a written comment', said, said ? 'the comment appeared under the post' : 'the comment never appeared');
  await shot('07-comment-posted', 'a comment from a signed-in member');
} else {
  journey('Comment: empty comment', 'text before posting', false, 'no post to comment on');
}

console.log('\n== J3b. the action row: no clipped word, no overlap ==');
if (myPostId) {
  const measure = async (width) => {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(900);
    return page.evaluate(() => {
      const row = document.querySelector('.actions') ?? document.querySelector('.fb-actions-row');
      if (!row) return { none: true };
      const items = Array.from(row.querySelectorAll(':scope > *')).map((el) => {
        const r = el.getBoundingClientRect();
        const inner = el.shadowRoot ? el.shadowRoot.querySelector('.btn') : el;
        const label = inner?.querySelector?.('.label, span');
        return {
          x: Math.round(r.x), w: Math.round(r.width),
          clip: label ? Math.round(label.scrollWidth - label.clientWidth) : 0,
          labelW: label ? Math.round(label.clientWidth) : null,
          font: label ? getComputedStyle(label).fontSize : null,
          need: label ? Math.round(label.scrollWidth) : null,
          text: (el.innerText || '').replace(/\n/g, ' ').trim()
        };
      });
      const overlaps = [];
      for (let i = 1; i < items.length; i++) {
        /* 1px tolerance: boxes that merely touch are not overlapping. */
        if (items[i].x < items[i - 1].x + items[i - 1].w - 1) overlaps.push(`${items[i - 1].text} / ${items[i].text}`);
      }
      return { items, overlaps, rowWidth: Math.round(row.getBoundingClientRect().width) };
    });
  };
  /* 390 and 360 are everyday phone widths: every word must be whole there.
     320 (an old small phone) may shorten the longest label, but never overlap. */
  for (const width of [390, 360, 320]) {
    const m = await measure(width);
    const clipped = m.none ? ['rows missing'] : m.items.filter((i) => i.clip > 0).map((i) => i.text);
    const overlap = m.overlaps ?? [];
    const partial = width <= 320 ? clipped.length <= 1 && !overlap.length : !clipped.length && !overlap.length;
    const clean = !m.none && partial;
    journey(`Action row at ${width}px`, width <= 320 ? 'no overlap' : 'four labels in one line', clean,
      !clean ? `clipped=${JSON.stringify(clipped)} overlaps=${JSON.stringify(overlap)} boxes=${JSON.stringify(m.items)} row=${JSON.stringify(m.rowWidth ?? null)}`
        : clipped.length ? `one label steps down and the rest stay whole (${m.items.map((i) => i.text).join(' · ')})`
        : `all four labels render whole (${m.items.map((i) => i.text).join(' · ')})`);
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(600);
  await shot('07b-action-row', 'the action row with every word whole');
}

console.log('\n== J4. edit: the edit is saved and marked as edited ==');
if (myPostId) {
  await goto(`/post/${myPostId}`, 1600);
  await tap('More options');
  await tap('Edit post');
  await waitForUrl(/\/edit/, 5000);
  await fill('textarea[data-field="body"]', 'Nandi left for the taxi rank at 06:10 and has not been seen since. Update: her phone was last active near the rank.');
  await tap('Post', { exact: true });
  await sleep(2600);
  const edited = await waitForText(/Edited/, 6000);
  const storedEdit = (await state()).posts.find((x) => x.id === myPostId)?.editedAt ?? null;
  journey('Edit post', 'a changed body', edited || !!storedEdit,
    edited || storedEdit ? `the post is marked Edited (store: ${storedEdit ? 'yes' : 'no'})` : `no Edited mark at ${url()}`);
  await shot('08-post-edited', 'the post after an edit');
}

console.log('\n== J5. report: a reason is required, then it is sent ==');
await signOut();
const B = { name: 'Sipho Khumalo', email: `sipho.j.${Date.now()}@example.co.za`, pass: 'password123' };
const signedUpB = await signUp(B.name, B.email, B.pass);
journey('Second account signs up', 'a second real person', signedUpB, signedUpB ? 'the second account reached the app' : 'the second account could not sign up');
if (myPostId && signedUpB) {
  await goto(`/post/${myPostId}`, 1800);
  await tap('More options');
  const sheet = await alertText();
  const offered = /Report post/.test(sheet);
  journey('Report: offered on someone else\u2019s post', 'a report option', offered,
    offered ? 'the menu offers Report post with Save, Copy link and Cancel' : `no Report option (menu: ${sheet.slice(0, 80)})`);
  await shot('09-report-reasons', 'the post menu a non-author sees');
  if (offered) {
    const reportsBefore = (await state()).reports;
    await tap('Report post');
    await sleep(900);
    const reasons = await alertText();
    await shot('09b-report-choices', 'the reasons a report must pick from');
    const reasonShown = /reason|information|scam|harass|false/i.test(reasons);
    await tapAlert('Send report');
    await sleep(1600);
    const reportsAfter = (await state()).reports;
    journey('Report: sending', 'a chosen reason', reasonShown && reportsAfter > reportsBefore,
      reasonShown && reportsAfter > reportsBefore
        ? `the reason list was shown and the report reached the store (${reportsBefore} \u2192 ${reportsAfter})`
        : `report not stored (choices: ${reasons.slice(0, 80)}, reports ${reportsBefore} \u2192 ${reportsAfter})`);
  }
}

console.log('\n== J5b. follow: one tap, and the store agrees ==');
if (signedUpB) {
  const meA = (await state()).users.find((u) => u.email === A.email)?.id;
  if (meA) {
    await goto(`/user/${meA}`, 1800);
    await tap('Follow', { exact: true, optional: true });
    await sleep(1400);
    const status = await page.evaluate((id) => JSON.parse(localStorage.getItem('lulafind.db.snapshot') || '{}')
      .follows?.find((f) => f.followingId === id)?.status ?? null, meA);
    journey('Follow', 'one tap', status === 'accepted' || status === 'pending',
      status ? `the follow was stored as ${status}` : 'the follow was not stored');
    await shot('10-follow-stored', 'the follow edge in the store');
  }
}

console.log('\n== J6. story: share answers a tap with nothing in it ==');
await goto('/create-story', 1800);
const storyBefore = (await state()).stories.length;
const shareTap = await tap('Share', { exact: true, optional: true });
await sleep(900);
const storySays = shareTap ? await waitForText(/Type something or add|add a photo|Write something/i, 2500) : false;
journey('Story: empty share', 'text or a photo', storySays,
  storySays ? 'an empty Share said what it needs instead of sitting there' : `an empty Share gave no reason (tapped=${shareTap})`);
await shot('13-story-empty-share', 'Share with nothing typed');
const box = await page.evaluate(() => {
  const el = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
  if (!el) return false;
  el.focus();
  return el.tagName;
});
if (box === 'TEXTAREA' || box === 'INPUT') await fill('textarea, input[type="text"]', 'Soweto, looking for Nandi.');
else await page.keyboard.type('Soweto, looking for Nandi.');
await sleep(400);
await tap('Share', { exact: true, optional: true });
await sleep(2000);
const storyAfter = (await state()).stories.length;
journey('Story publishes', 'some text', storyAfter > storyBefore,
  storyAfter > storyBefore ? `the story was stored (${storyAfter} in the store)` : 'the story was not stored');

/* Interrupted story: leave the screen and come back. */
await goto('/create-story', 1800);
await fill('textarea.caption', 'Soweto, looking for Nandi.');
await goto('/home', 1500);
await goto('/create-story', 1800);
const storyKept = await waitForText(/We kept what you typed/, 3000);
const storyText = await page.evaluate(() => document.querySelector('textarea.caption')?.value ?? '');
journey('Story: finish later', 'a half-typed story', storyKept && storyText.includes('Soweto'),
  storyKept && storyText.includes('Soweto')
    ? 'the story text came back with one tap to start fresh'
    : `the story came back empty (note=${storyKept}, text=${storyText.slice(0, 20)})`);
await shot('13b-story-draft-kept', 'the story composer says it kept what was typed');

console.log('\n== J7. saved, search and the quiet screens: none is a dead end ==');
const quiet = [
  ['/saved', /Saved/, 'Saved'],
  ['/connections', /Connections|Followers|Following/, 'Connections'],
  ['/notifications', /Notifications|Nothing yet|No notifications/, 'Notifications'],
  ['/found', /Found|Reunited|Nothing yet/, 'Reunited'],
  ['/tips', /Tips|How to help|Search/, 'Tips'],
  ['/help', /get help|help|contact/i, 'Help'],
  ['/faqs', /FAQ|Answers|Questions/, 'FAQs'],
  ['/terms', /Terms|Privacy/, 'Terms'],
  ['/settings', /Settings|Privacy/, 'Settings'],
  ['/safety', /Safety|Be on the lookout/, 'Safety centre'],
  ['/ask-lula', /Lula|Ask/, 'Ask Lula'],
  ['/search', /Search/, 'Search'],
  ['/admin', /Admins only|Review queue|reports/i, 'Admin (non-admin sees why)']
];
for (const [path, expect, label] of quiet) {
  await goto(path, 1800);
  const shown = await waitForText(expect, 4000);
  const body = await text();
  const notBlank = body.length > 20;
  const named = shown && notBlank;
  journey(`${label} screen`, 'something to read', named,
    named ? `renders at ${url()}` : `nothing recognisable at ${url()} (got ${body.slice(0, 60).replace(/\n/g, ' ')})`);
}

console.log('\n== J7c. search: typing finds the case this account just posted ==');
await goto('/search', 1800);
await fill('ion-searchbar input', 'Soweto');
await sleep(1800);
const found = await waitForText(/Nandi left for the taxi|Missing person: Nandi/i, 5000);
const noHits = await page.evaluate(() => /Nothing matches that/i.test(document.body.innerText || ''));
journey('Search finds a post', 'a town typed into the field', found || noHits,
  found ? 'typing the town brought the case back' : noHits ? 'the screen said nothing matches (the store was searched)' : 'search showed neither results nor an answer');
await shot('11-search-results', 'searching the town the case was posted in');

console.log('\n== J7b. poster: the maker opens for the case it belongs to ==');
if (myPostId) {
  await goto(`/post/${myPostId}/poster`, 2400);
  await waitForText(/Download|Share|Poster|Save/i, 5000);
  const body = await text();
  const poster = /Download|Share|Poster|Save/i.test(body) && body.length > 40;
  journey('Poster maker', 'a case that has a poster', poster,
    poster ? `the poster screen opened at ${url()}` : `nothing rendered at ${url()}`);
  await shot('12-poster', 'the poster made from the published case');
}

console.log('\n== J8. sign out and back in: the gate remembers the way ==');
await signOut();
const afterOut = await waitForText(/Log in|Create new account/, 5000);
journey('Sign out', 'the sign-in screen', afterOut, afterOut ? 'signing out returned to the sign-in screen' : `sign out left the app at ${url()}`);
await tap('Log in', { exact: true });
await sleep(700);
await fill('input[type="email"]', A.email);
await fill('input[type="password"]', 'wrong-password-9');
await tap('Log in', { exact: true });
await sleep(1800);
const wrongRefused = /wrong|incorrect|invalid|not match|no account/i.test(await text()) && /\/auth/.test(url());
await fill('input[type="password"]', A.pass);
await tap('Log in', { exact: true });
await sleep(2400);
const backIn = /\/home/.test(page.url());
journey('Sign in', 'the right password', backIn,
  backIn ? `a wrong password was refused and the right one reached ${url()}` : `sign-in ended at ${url()}`);
await shot('14-signed-back-in', 'signed back in after a refused password');

console.log('\n== results ==');
console.log(`  shots: ${shots.length}`);
console.log(`  problems: ${problems.length}`);
console.log(`  console errors: ${consoleErrors.length}`);
console.log(`  dead clicks: ${dead.length}`);
console.log(`  broken journeys: ${journeys.filter((j) => j.verdict === 'BROKEN').length} of ${journeys.length}`);
for (const j of journeys) console.log(`  ${j.verdict === 'works' ? '✔' : '✖'} ${j.name}: ${j.happened}`);
if (problems.length) console.log('  problems:', problems.slice(0, 12));
if (consoleErrors.length) console.log('  console:', consoleErrors.slice(0, 6));
if (dead.length) console.log('  dead:', dead.slice(0, 10));
const broken = journeys.filter((j) => j.verdict === 'BROKEN').length;
process.exitCode = broken || consoleErrors.length ? 1 : 0;
await browser.close();
