/**
 * Ad-hoc screenshot tool: renders named LulaFind surfaces so the UI can be
 * looked at rather than inferred from source. Writes PNGs to /tmp/shots/.
 *
 *   LD_LIBRARY_PATH=/tmp/alibs/lib node tools/lf-shot.mjs [surface ...]
 */
import { mkdirSync } from 'node:fs';
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = process.env.LF_BASE ?? 'http://localhost:4200';
const OUT = '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const wanted = process.argv.slice(2);
const want = (n) => wanted.length === 0 || wanted.includes(n);

const browser = await puppeteer.launch({
  executablePath: process.env.LF_CHROME ?? '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));

await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('lulafind.auth.session', JSON.stringify('u_demo')); } catch { /* ignore */ }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, ms = 1400) {
  await sleep(ms);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name, '| url:', page.url().replace(BASE, ''));
}

async function goto(path) {
  await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'demo=1', { waitUntil: 'networkidle2' });
  await sleep(900);

  // The seeded demo account ships with onboarded:false, so ?demo=1 always lands
  // on the onboarding screen. Clear that once per run so the real screens render.
  if (await page.evaluate(() => location.pathname === '/onboarding')) {
    const patched = await page.evaluate(() => {
      const raw = localStorage.getItem('lulafind.db.snapshot');
      if (!raw) return 0;
      try {
        const db = JSON.parse(raw);
        let n = 0;
        for (const u of db.users ?? []) if (u && u.id === 'u_demo') { u.onboarded = true; n++; }
        localStorage.setItem('lulafind.db.snapshot', JSON.stringify(db));
        return n;
      } catch { return 0; }
    });
    console.log('  onboarding cleared, patched users:', patched);
    await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'demo=1', { waitUntil: 'networkidle2' });
    await sleep(1300);
  }
}

/** Click the first visible element whose trimmed text contains `text`. */
async function clickText(text, tag = 'button, a, [role="tab"]') {
  const ok = await page.evaluate((t, g) => {
    const nodes = [...document.querySelectorAll(g)];
    const hit = nodes.find((n) => n.textContent.trim() === t && n.offsetParent !== null)
      ?? nodes.find((n) => n.textContent.trim().includes(t) && n.offsetParent !== null);
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return true;
  }, text, tag);
  if (!ok) console.log('  ! could not click:', text);
  return ok;
}

// ── bottom navigation ───────────────────────────────────────────────────────
if (want('nav')) {
  await goto('/home');
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('ion-tab-bar ion-label, ion-tab-bar button .bar-btn ion-label, ion-tab-bar .bar-btn ion-label')]
      .map((n) => n.textContent.trim()).filter(Boolean));
  console.log('bottom tabs:', JSON.stringify(tabs));
  const topnav = await page.evaluate(() =>
    [...document.querySelectorAll('ion-header a[aria-label], ion-header button[aria-label]')]
      .map((n) => n.getAttribute('aria-label')));
  console.log('top nav actions:', JSON.stringify(topnav));
  await shot('10-feed-with-nav');
}

// ── the feed card ───────────────────────────────────────────────────────────
if (want('feed')) {
  await goto('/home');
  const card = await page.evaluate(() => {
    const c = document.querySelector('lf-post-card');
    if (!c) return 'NO CARD';
    return {
      hasSeeMore: c.innerHTML.includes('see more'),
      hasReadMore: c.innerHTML.includes('Read more'),
      hasChipDanger: !!c.querySelector('.fb-chip--danger'),
      followRight: !!c.querySelector('.fb-follow-link') &&
        getComputedStyle(c.querySelector('.fb-follow-link')).marginLeft !== '0px'
    };
  });
  console.log('feed card:', JSON.stringify(card));
  await shot('11-feed');
}

// ── Discover ────────────────────────────────────────────────────────────────
if (want('discover')) {
  await goto('/discover');
  const statuses = await page.evaluate(() => {
    const t = document.body.textContent.replace(/\s+/g, ' ');
    return {
      url: location.pathname,
      hasQuestion: t.includes('How are you right now'),
      safe: t.includes("I'm Safe"), help: t.includes('I Need Help'), watch: t.includes('Watch Me'),
      tabs: [...document.querySelectorAll('.seg .pill')].map((n) => n.textContent.trim())
    };
  });
  console.log('discover statuses:', JSON.stringify(statuses));
  await shot('12-discover-statuses');

  for (const [name, label] of [['13-discover-following', 'Following'], ['14-discover-requests', 'Requests']]) {
    await clickText(label, '.seg .pill');
    await shot(name, 900);
  }
}

console.log('\nconsole errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
