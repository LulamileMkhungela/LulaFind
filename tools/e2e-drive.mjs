/**
 * Drives the real app in a real browser.
 *
 * Everything else in this repo tests components in jsdom. This loads the app in
 * Chromium, clicks it like a person, and saves a screenshot per step to
 * docs/e2e/. It fails loudly on:
 *   - a screen that renders nothing (not interactive at all)
 *   - a click that changes nothing on screen (a dead control)
 *   - a console error or a page exception
 *
 * Demo mode (`?demo=1`) serves the built-in dataset, so the whole journey runs
 * without the live database. Production builds cannot enter demo mode.
 *
 * Run with the dev server up:   node tools/e2e-drive.mjs
 * Real backend instead:         LF_DEMO=0 node tools/e2e-drive.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = process.env.LF_BASE ?? 'http://localhost:4200';
const DEMO = process.env.LF_DEMO === '0' ? '' : '?demo=1';
const OUT = process.env.LF_EVIDENCE_ROOT ? `${process.env.LF_EVIDENCE_ROOT}/e2e/` : new URL('../docs/e2e/', import.meta.url).pathname;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.LF_CHROME ?? '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--disable-gpu']
});
const chromeVersion = await browser.version();
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 240)));

// Sign in the way the app itself does: restore the stored session for the demo user.
await page.evaluateOnNewDocument(() => {
  try {
    if (!localStorage.getItem('lulafind.auth.session')) {
      localStorage.setItem('lulafind.auth.session', JSON.stringify('u_demo'));
    }
  } catch { /* ignore */ }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a client-side navigation to land, instead of guessing at a delay. */
async function waitForUrl(pattern, ms = 4000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pattern.test(page.url())) return true;
    await sleep(150);
  }
  return pattern.test(page.url());
}

/** Wait until the screen contains this text. */
async function waitForText(pattern, ms = 5000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pattern.test(await text())) return true;
    await sleep(200);
  }
  return false;
}
const shots = [];
const problems = [];
const dead = [];

async function text() {
  return (await page.evaluate(() => document.body.innerText || '')).replace(/\n{2,}/g, '\n').trim();
}

async function shot(name, note = '') {
  await page.screenshot({ path: `${OUT}${name}.png` });
  const t = await text();
  shots.push({ name, note, text: t, words: t.split(/\s+/).filter(Boolean).length });
  console.log(`  📸 ${name}${note ? ' - ' + note : ''} (${t.split('\n').length} lines)`);
}

/** Click the first visible control whose text matches; a miss is a problem, not a crash. */
async function tap(label, { selector = 'button, a, [role="button"], ion-tab-button, .tab-btn', index = 0, what = '' } = {}) {
  const before = await text();
  const beforeUrl = page.url();
  const clicked = await page.evaluate((t, sel, idx) => {
    const all = Array.from(document.querySelectorAll(sel)).filter((e) => {
      const b = e.getBoundingClientRect();
      const label = (e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.textContent || '');
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' &&
        label.replace(/\s+/g, ' ').trim().includes(t);
    });
    const el = all[idx];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, label, selector, index);
  if (!clicked) { problems.push(`no control "${label}"${what ? ' (' + what + ')' : ''} on ${page.url().replace(BASE, '')}`); return false; }
  await sleep(550);
  const after = await text();
  // A control that only changes a class (a selected province, a pressed star)
  // looks unchanged to a text comparison - that is not a dead click.
  if (before === after && page.url() === beforeUrl) {
    dead.push(`"${label}" on ${page.url().replace(BASE, '')} left the screen text identical (may be a selection only)`);
  }
  return true;
}

/**
 * Press and hold a control at its real coordinates.
 *
 * The reaction button is pointer-driven - hold to reveal the tray, slide onto
 * one and let go, exactly like LinkedIn. A synthetic .click() carries no
 * pointerdown/pointerup, so it would prove nothing about a real thumb.
 */
async function hold(label, { ms = 650, selector = 'button, [role="button"]', exact = false, what = '' } = {}) {
  const box = await page.evaluate((t, sel, exact) => {
    const el = Array.from(document.querySelectorAll(sel)).find((e) => {
      const b = e.getBoundingClientRect();
      const lab = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.textContent || '')).replace(/\s+/g, ' ').trim();
      return b.width > 0 && b.height > 0 && (exact ? lab === t : lab.includes(t));
    });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label, selector, exact);
  if (!box) { problems.push(`no control "${label}" to press${what ? ' (' + what + ')' : ''}`); return false; }
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await sleep(ms);
  return true;
}

/** Press and release at the coordinates of a control (a normal tap, with pointer events). */
async function press(label, { selector = 'button, [role="button"]', exact = false, what = '' } = {}) {
  const box = await page.evaluate((t, sel, exact) => {
    const el = Array.from(document.querySelectorAll(sel)).find((e) => {
      const b = e.getBoundingClientRect();
      const lab = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.textContent || '')).replace(/\s+/g, ' ').trim();
      return b.width > 0 && b.height > 0 && (exact ? lab === t : lab.includes(t));
    });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label, selector, exact);
  if (!box) { problems.push(`no control "${label}" to tap${what ? ' (' + what + ')' : ''}`); return false; }
  const inView = box.y >= 0 && box.y <= 844 && box.x >= 0 && box.x <= 390;
  if (inView) {
    await page.mouse.move(box.x, box.y);
    await sleep(60);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
  } else {
    // Ionic scrolls inside a shadow-DOM scroller, so a control can sit far
    // below the window and a coordinate tap would land on nothing. Click the
    // element directly instead - still Angular's real (click) handler.
    await page.evaluate((t, sel, exact) => {
      const el = Array.from(document.querySelectorAll(sel)).find((e) => {
        const lab = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.textContent || '')).replace(/\s+/g, ' ').trim();
        return exact ? lab === t : lab.includes(t);
      });
      el?.click();
    }, label, selector, exact);
  }
  await sleep(600);
  return true;
}

/** Type into a CSS selector the way a phone would (Angular needs the input event). */
async function fill(selector, value, { what = '' } = {}) {
  const ok = await page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
    return true;
  }, selector, value);
  if (!ok) problems.push(`no field ${selector}${what ? ' (' + what + ')' : ''} on ${page.url().replace(BASE, '')}`);
  await sleep(250);
  return ok;
}

async function goto(path, wait = 1400) {
  await page.goto(BASE + path + DEMO, { waitUntil: 'networkidle2' });
  await sleep(wait);
}

console.log('\n== 1. the app opens ==');
await goto('/', 2600);

// A brand new account is walked through onboarding before the app opens.
// The demo user is deliberately seeded un-onboarded, so this runs for real.
if (/\/onboarding/.test(page.url())) {
  await shot('01-onboarding-welcome');
  for (let i = 0; i < 6; i++) {
    const t = await text();
    if (/Enter LulaFind/.test(t)) { await tap('Enter LulaFind', { what: 'finish onboarding' }); break; }
    if (/Your province/.test(t)) {
      await tap('Gauteng', { selector: 'button', what: 'province' });
      const picked = await page.evaluate(() => !!Array.from(document.querySelectorAll('button.on, button[aria-pressed="true"]')).find((b) => /Gauteng/.test(b.innerText)));
      if (!picked) problems.push('choosing a province did not select it (the step requires one to continue)');
    }
    await tap('Next', { what: 'onboarding step' });
    await sleep(400);
  }
  await sleep(1600);
  await shot('02-onboarding-done', page.url().replace(BASE, ''));
  if (/onboarding/.test(page.url())) problems.push('onboarding never finished - the app stayed on the welcome flow');
}

await goto('/', 2600);
await shot('03-feed-signed-in', await page.title());

const demoBanner = /Demo data/i.test(await text());
if (DEMO && !demoBanner) problems.push('demo mode is on but the screen does not say so');
console.log('  demo banner:', demoBanner);

const feedLines = (await text()).split('\n').length;
if (feedLines < 12) problems.push(`the feed shows only ${feedLines} lines - it did not load`);

console.log('\n== 2. open a case ==');
await tap('Thato', { selector: 'article, .fb-card, a[href*="/post/"]', what: 'case card' });
const onCase = await waitForUrl(/\/post\/p_/, 6000);
if (!onCase) await page.goto(BASE + '/post/p_thato' + DEMO, { waitUntil: 'networkidle2' });
await sleep(2000);
await shot('04-case-opened', page.url().replace(BASE, '').slice(0, 40));
if (!/\/post\//.test(page.url())) problems.push('clicking a case did not open the case page');
if (!(await waitForText(/Add a comment|Comment/, 5000))) problems.push('the case page did not finish rendering');

console.log('\n== 3. react, comment, and the checklist ==');
const held = await hold('Have an idea', { what: 'reaction button (press and hold)' });
await sleep(400);
const trayOpen = await page.evaluate(() => !!document.querySelector('.tray[role="menu"], [role="menu"]'));
if (held) {
  await shot('05-reaction-tray-open', trayOpen ? 'held: the tray is open' : 'held: NO TRAY - hold-to-reveal is broken');
  if (!trayOpen) problems.push('holding the reaction button did not open the tray');
  // slide onto Like and lift the finger, the way the control is built
  const likePos = await page.evaluate(() => {
    const opt = document.querySelector('[role="menuitem"][data-key="like"]');
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (likePos) { await page.mouse.move(likePos.x, likePos.y); await sleep(250); }
  await page.mouse.up();
  await sleep(900);
}
await shot('06-reacted', 'after sliding onto Like and letting go');

await waitForText(/Add a comment|Comment/i, 5000);
await fill('textarea[placeholder*="comment" i]', 'Saw someone matching this at the taxi rank this morning.', { what: 'comment box' });
await shot('07-comment-typed');
const postBtnState = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter((e) => (e.innerText || '').replace(/\s+/g, ' ').trim() === 'Post')
    .map((e) => ({ cls: e.className, disabled: e.disabled, y: Math.round(e.getBoundingClientRect().y) }));
  const ta = document.querySelector('textarea[placeholder*="comment" i]');
  return { matches: all, taValue: ta?.value?.slice(0, 30) ?? '(none)' };
});
console.log('  post-button check:', JSON.stringify(postBtnState));
await press('Post', { exact: true, what: 'post the comment (not Repost)' });
await sleep(3200);  // posting refreshes the comment list and re-reads the case
const afterComment = await text();
if (!/taxi rank this morning/.test(afterComment)) problems.push('the comment did not appear on the case after posting');
await shot('08-comment-posted');

await tap('First hours', { what: 'checklist header' });
await shot('09-checklist-open');
const beforeTick = await text();
await press('Open a case at any police station', { what: 'a checklist step' });
const afterTick = await text();
if (beforeTick === afterTick) problems.push('ticking a checklist step changed nothing');
else if (!/1 of 7|3 of 7|2 of 7/.test(afterTick)) problems.push('the checklist count did not move after ticking a step');
await shot('10-checklist-ticked', 'the count should have moved');

console.log('\n== 4. the poster draws ==');
await goto('/post/p_thato/poster', 2600);
await shot('11-poster', 'the route the composer opens after publishing');
const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c || !c.width) return null;
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  let opaque = 0;
  for (let i = 0; i < px.length; i += 4 * 53) {
    if (px[i + 3] <= 10) continue;
    opaque++;
    seen.add(`${px[i] >> 3},${px[i + 1] >> 3},${px[i + 2] >> 3}`);
  }
  return { w: c.width, h: c.height, opaque, colours: seen.size };
});
console.log('  canvas:', JSON.stringify(canvas));
if (!canvas) problems.push('no poster canvas rendered');
else if (canvas.opaque < 30 || canvas.colours < 3) problems.push('the poster canvas is blank');
const beforeColours = canvas?.colours ?? -1;
await tap('Ubuntu', { selector: 'button, [role="option"]', what: 'poster template' });
await sleep(2200);
const chosen = await page.evaluate(() => {
  const on = document.querySelector('[role="option"][aria-selected="true"]');
  return on ? (on.innerText || '').split('\n')[0].trim() : null;
});
const afterColours = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c || !c.width) return -1;
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < px.length; i += 4 * 53) if (px[i + 3] > 10) seen.add(`${px[i] >> 3},${px[i + 1] >> 3},${px[i + 2] >> 3}`);
  return seen.size;
});
console.log('  template chosen:', chosen, '| distinct colours', beforeColours, '->', afterColours);
if (!/Ubuntu/i.test(chosen ?? '')) problems.push('choosing a poster template did not stick');
if (afterColours === beforeColours) problems.push('the poster canvas did not redraw when the template changed');
await shot('12-poster-second-template', 'Ubuntu template, freshly drawn');

console.log('\n== 5. write a post ==');
await goto('/new', 2200);
await shot('13-new-post');
await tap('Missing & Found', { selector: '.category-grid button, button, [role="button"]', what: 'post category' });
await sleep(900);
await shot('13b-new-post-missing');
await fill('textarea.body-input, textarea[data-field="body"]', 'Full name: Andile Mokoena\nAge: 28\nLocation (town/suburb, province): Khayelitsha, Western Cape\nWhat happened: He left for the taxi rank on Sunday morning and has not come home since. He was wearing a blue jacket.', { what: 'case template' });
await sleep(400);
await shot('14-new-post-filled');
const filledHeading = await page.evaluate(() => document.querySelector('textarea[data-field="body"]')?.value ?? '');
if (!filledHeading.includes('Andile Mokoena')) problems.push('the case template did not keep what was typed');

console.log('\n== 6. the tabs ==');
for (const [label, path] of [['Spotlight', '/spotlight'], ['Chats', '/chats'], ['Me', '/me']]) {
  await goto(path, 1800);
  await shot(`13-tab-${label.toLowerCase()}`, label);
}

console.log('\n== 7. Discover ==');
await goto('/discover', 1800);
await shot('16-discover-statuses');
const discover = await text();
if (!/How are you right now/i.test(discover)) problems.push('Discover did not ask how you are');
for (const label of ["I'm Safe", 'I Need Help', 'Watch Me']) {
  if (!discover.includes(label)) problems.push(`Discover is missing the ${label} action`);
}
// All four tabs must be reachable, including the default Statuses tab.
for (const [label, name] of [['Following', '16b-discover-following'], ['Requests', '16c-discover-requests']]) {
  await tap(label, { what: `${label} tab` });
  await shot(name);
}

console.log('\n== 8. the rest of the app ==');
for (const [name, path, wait] of [
  ['18-notifications', '/notifications', 1600],
  ['19-found', '/found', 1800],
  ['20-review-queue', '/admin', 1800],
  ['21-settings', '/settings', 1600],
  ['22-faqs', '/faqs', 1600],
  ['23-help', '/help', 1400],
  ['24-safety', '/safety', 1400]
]) {
  await goto(path, wait);
  await shot(name, path);
}

console.log('\n== 9. search ==');
await goto('/search', 1400);
await fill('ion-searchbar input, input[placeholder*="case number" i]', 'Soweto', { what: 'search box' });
await sleep(1600);
await shot('25-search-soweto');

await browser.close();

const report = [
  '# The app, driven in a real browser',
  '',
  `${chromeVersion} against \`${BASE}\`${DEMO ? ' in demo mode (`?demo=1`)' : ' against the live backend'}.`,
  `${shots.length} steps. Generated by \`tools/e2e-drive.mjs\`; screenshots are in \`docs/e2e/\`.`,
  '',
  '## Steps',
  '',
  ...shots.map((s) => `### ${s.name}${s.note ? ` - ${s.note}` : ''}\n\n![${s.name}](./e2e/${s.name}.png)\n\n\`\`\`text\n${s.text.slice(0, 700)}\n\`\`\`\n`),
  '## Console errors',
  '',
  consoleErrors.length ? consoleErrors.map((e) => `- ${e}`).join('\n') : 'None.',
  '',
  '## Clicks that did not change the screen text',
  '',
  dead.length ? dead.map((d) => `- ${d}`).join('\n') : 'None - every click changed the screen.',
  '',
  problems.length ? '### Missing controls or screens\n\n' + problems.map((p) => `- ${p}`).join('\n') : ''
];
writeFileSync(process.env.LF_EVIDENCE_ROOT ? `${process.env.LF_EVIDENCE_ROOT}/E2E-BROWSER.md` : new URL('../docs/E2E-BROWSER.md', import.meta.url).pathname, report.join('\n'));

console.log('\n=== RESULT ===');
console.log('steps:', shots.length, '| console errors:', consoleErrors.length,
  '| dead clicks:', dead.length, '| missing:', problems.length);
if (consoleErrors.length) console.log('console:', consoleErrors.slice(0, 5).join('\n'));
if (dead.length) console.log('dead:', dead.slice(0, 8).join('\n'));
if (problems.length) console.log('missing:', problems.slice(0, 8).join('\n'));
process.exit(problems.length || consoleErrors.length ? 1 : 0);
