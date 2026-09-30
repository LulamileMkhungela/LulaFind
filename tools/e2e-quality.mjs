/**
 * Quality audit: is the app responsive, aligned, quiet to read, quick to load
 * and quick to answer a tap?
 *
 * It drives the real app in a real browser with real content (an account is
 * created through the real sign-up screen, and a case + a story are posted
 * through the real composer so every screen has something on it) and measures,
 * per screen and per width:
 *
 *   responsive : does the page scroll sideways, does anything hang off the edge,
 *                is any text clipped, do any two controls collide?
 *   aligned    : how many different left edges do the main blocks use
 *                (one or two is a layout, five is an accident)
 *   reading    : words above the fold, and the longest app paragraph
 *   tappable   : controls below 44px (comfortable) and below 24px (WCAG 2.5.8)
 *   readable   : text contrast against its real background (WCAG AA)
 *   quick      : cold-load paint, per-route navigation, and tap -> change time
 *
 * Run with the dev server up:
 *   bash tools/get-browser.sh
 *   LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-quality.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = process.env.LF_BASE ?? 'http://localhost:4200';
const NO_DEMO = '?demo=0&data=local';
const OUT = new URL('../docs/e2e-quality/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.LF_CHROME ?? '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--disable-gpu']
});
const page = await browser.newPage();
/* Paint entries must be observed from the start of the document, not read
   afterwards - otherwise FCP/LCP come back as -1. */
await page.evaluateOnNewDocument(() => {
  window.__paint = { fcp: -1, lcp: -1 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__paint.fcp = Math.round(e.startTime); })
      .observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { const e = l.getEntries().slice(-1)[0]; if (e) window.__paint.lcp = Math.round(e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* older engine: leave -1 */ }
});

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const rows = [];

async function goto(path, wait = 1400) {
  await page.goto(BASE + path + NO_DEMO, { waitUntil: 'networkidle2' });
  await sleep(wait);
}

const text = async () => (await page.evaluate(() => document.body.innerText || '')).replace(/\n{2,}/g, '\n').trim();

async function waitForText(pattern, ms = 6000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pattern.test(await text())) return true;
    await sleep(180);
  }
  return false;
}

async function tap(label, { selector = 'button, a, [role="button"], ion-toggle, .tab-btn', exact = false, optional = false } = {}) {
  const ok = await page.evaluate((t, sel, exact) => {
    const all = Array.from(document.querySelectorAll(sel)).filter((e) => {
      const b = e.getBoundingClientRect();
      const lab = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.textContent || '')).replace(/\s+/g, ' ').trim();
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && (exact ? lab === t : lab.includes(t));
    });
    const el = all[0];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, label, selector, exact);
  if (!ok && !optional) problems.push(`no control "${label}" on ${page.url().replace(BASE, '')}`);
  await sleep(700);
  return ok;
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
  await sleep(220);
  return ok;
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

/* ------------------------------------------------------------------ *
 * The measurement itself. Everything below runs inside the page, on
 * the rendered screen, and returns numbers - not opinions.
 * ------------------------------------------------------------------ */
const MEASURE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}`;

  /* An element may sit outside the viewport on purpose if a parent scrolls
     sideways (the chip rails, the tabs). Those are not layout bugs. */
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && p.scrollWidth > p.clientWidth + 2) return true;
    }
    return false;
  };

  const all = Array.from(document.querySelectorAll('body *')).filter(shown);

  const overflow = all
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1.5 && r.left >= -1.5) return false;
      return !inScroller(el);
    })
    .slice(0, 6)
    .map((el) => ({ el: label(el), right: Math.round(el.getBoundingClientRect().right), vw }));

  const clipped = all
    .filter((el) => {
      const s = getComputedStyle(el);
      const truncates = s.textOverflow === 'ellipsis' || (s.overflow === 'hidden' && s.whiteSpace === 'nowrap');
      return truncates && el.scrollWidth > el.clientWidth + 1 && (el.textContent || '').trim().length > 2;
    })
    .slice(0, 8)
    .map((el) => ({ el: label(el), text: (el.textContent || '').trim().slice(0, 40), needs: el.scrollWidth, has: el.clientWidth }));

  const tapSel = 'button, a[href], [role="button"], ion-toggle, input[type="checkbox"], select';
  const targets = Array.from(document.querySelectorAll(tapSel)).filter(shown);
  const targetBoxes = targets.map((el) => {
    /* An input inside a label is tapped through the label, so the label's box
       is the real target. */
    let host = el;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
      const lab = el.closest('label');
      if (lab) host = lab;
    }
    let r = host.getBoundingClientRect();
    if (host !== el) r = { ...r, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    else r = el.getBoundingClientRect();
    return { el: label(el), text: ((el.getAttribute('aria-label') || el.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right) };
  });
  const inlineLink = (el) => {
    if (el.tagName !== 'A') return false;
    const p = el.closest('p, li, span');
    return !!p && (p.textContent || '').trim().length > (el.textContent || '').trim().length + 8;
  };
  const inSentence = new Set(Array.from(document.querySelectorAll('a[href]')).filter(inlineLink));
  const tiny = targetBoxes.filter((t, i) => (t.w < 24 || t.h < 24) && !inSentence.has(targets[i]));
  const small = targetBoxes.filter((t) => !(t.w < 24 || t.h < 24) && (t.w < 44 || t.h < 44));

  /* Two controls overlapping is a real bug: the tap goes to the wrong one. */
  /* App chrome (the tab bar, the header) floats over the page on purpose: content
     scrolling under it is how phones work. Ionic's own bar is absolutely placed
     inside the tab shell, so the tag is the reliable signal. */
  const inFixedBar = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      const tag = p.tagName.toLowerCase();
      if (tag === 'ion-tab-bar' || tag === 'ion-header' || tag === 'ion-toolbar' || tag === 'ion-footer') return true;
    }
    return false;
  };
  const fixedFlags = targets.map(inFixedBar);
  const collisions = [];
  for (let i = 0; i < targetBoxes.length; i++) {
    for (let j = i + 1; j < targetBoxes.length; j++) {
      const a = targetBoxes[i];
      const b = targetBoxes[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      /* Touching is not overlapping: only a real intersection means the wrong
         control could take the tap. */
      if (overlapX <= 1 || overlapY <= 1) continue;
      /* Content scrolling under a fixed bar is how phones work, not a bug. */
      if (fixedFlags[i] !== fixedFlags[j]) continue;
      collisions.push(`${a.text || a.el} / ${b.text || b.el}`);
    }
  }

  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const ratio = (a, b) => {
    const L1 = lum(a);
    const L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  const bgOf = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0.85) return c;
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  };

  const readers = Array.from(document.querySelectorAll('body *')).filter((el) => {
    if (!shown(el)) return false;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1);
    if (!own) return false;
    const s = getComputedStyle(el);
    return parseFloat(s.fontSize) >= 9;
  });
  const lowContrast = [];
  for (const el of readers) {
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const solid = fg.a < 1 ? over(fg, bg) : fg;
    const size = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(solid, bg);
    if (got < need - 0.02) {
      lowContrast.push({ el: label(el), text: (el.textContent || '').trim().slice(0, 30), size, got: Math.round(got * 100) / 100, need });
    }
  }

  /* Words a person actually has to read above the fold. */
  let words = 0;
  for (const el of readers) {
    const r = el.getBoundingClientRect();
    if (r.top < vh * 0.92 && r.bottom > 0) words += (el.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /* Left edges of the main blocks: a layout uses one or two, not five. */
  const blocks = Array.from(document.querySelectorAll('ion-content section, ion-content .lf-card, ion-content .fb-card, ion-content > div > *'))
    .filter((el) => shown(el) && el.getBoundingClientRect().width > vw * 0.5 && el.getBoundingClientRect().height > 40)
    .map((el) => Math.round(el.getBoundingClientRect().left));
  const edges = [...new Set(blocks)].filter((n) => n < vw * 0.5);

  return {
    vw,
    pageScrollsSideways: document.documentElement.scrollWidth > vw + 1,
    scrollWidth: document.documentElement.scrollWidth,
    overflow,
    clipped,
    tinyTargets: tiny.slice(0, 6),
    tinyCount: tiny.length,
    smallCount: small.length,
    collisions: [...new Set(collisions)].slice(0, 5),
    lowContrast: lowContrast.slice(0, 8),
    lowContrastCount: lowContrast.length,
    wordsAboveFold: words,
    leftEdges: edges
  };
};

const WIDTHS = [320, 360, 390, 414, 768, 1024];
const SCREENS = [
  ['/home', /search|missing/i],
  ['/spotlight', /spotlight|surname|missing/i],
  ['/chats', /chat|message|no chats/i],
  ['/me', /nandi|profile|menu/i],
  ['/settings', /settings|privacy/i],
  ['/safety', /safety|lookout/i],
  ['/new', /create post|what are you posting/i],
  ['/faqs', /faq|answers/i],
  ['/help', /help/i],
  ['/saved', /saved/i],
  ['/connections', /connection|follower/i],
  ['/notifications', /notification/i],
  ['/found', /found|reunit/i],
  ['/search', /search/i],
  ['/tips', /tips/i],  /* the screen had no title: the header showed the search bar */
  ['/ask-lula', /lula|ask/i]
];

/* ------------------------------------------------------------------ *
 * 1. A real account, with real content on it.
 * ------------------------------------------------------------------ */
const A = { name: 'Nandi Mokoena', email: `nandi.q.${Date.now()}@example.co.za`, pass: 'password123' };

console.log('\n== setting up: a real account with a real case ==');
await goto('/', 2000);
await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
await goto('/auth', 1500);
await tap('Create new account');
await waitForText(/What's your name/);
await fill('input[placeholder="e.g. John Doe"]', A.name);
await tap('Agree and continue', { exact: true });
await tap('Continue', { exact: true });
await fill('input[placeholder="At least 8 characters"]', A.pass);
await tap('Continue', { exact: true });
await fill('input[type="email"]', A.email);
await tap('Continue', { exact: true });
await waitForText(/Select your province/, 6000);
await fill('select.snap-select', 'GP');
await tick('18 or older');
await tick('I agree to the Terms');
await tap('Agree and continue', { exact: true });
await sleep(2200);
for (let i = 0; i < 6 && /onboarding/.test(page.url()); i++) {
  if (!(await tap('Skip', { optional: true }))) await tap('Enter LulaFind', { optional: true });
  await sleep(700);
}
console.log('  signed up:', page.url().replace(BASE, ''));

const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('lulafind.db.snapshot') || '{}').users?.[0]?.id ?? null);
await goto('/new', 1600);
await tap('Missing person');
await fill('textarea[data-field="body"]', 'Nandi left for the taxi rank at 06:10 on Tuesday morning and has not been seen since. She was wearing a blue jacket and black takkies. Her phone went off near the rank at 06:40.');
await fill('.location-grid select', 'GP');
await fill('input[placeholder="e.g. Soweto"]', 'Soweto');
await sleep(300);
await tap('Post', { exact: true });
await sleep(2600);
const postPath = page.url().replace(BASE, '').replace(/\?.*/, '');
console.log('  published:', postPath);

await goto('/create-story', 1500);
await fill('textarea.caption', 'Soweto, looking for Nandi. Please share.');
await sleep(300);
await tap('Share', { exact: true });
await sleep(2000);
console.log('  story posted');

/* ------------------------------------------------------------------ *
 * 2. The sweep.
 * ------------------------------------------------------------------ */
const screens = [...SCREENS, [postPath, /missing|nandi/i], [`/user/${userId}`, /nandi|last seen/i]];
for (const width of WIDTHS) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: width < 700, hasTouch: width < 700 });
  for (const [path, expect] of screens) {
    await goto(path, 1100);
    const rendered = await waitForText(expect, 4000);
    const m = await page.evaluate(MEASURE);
    const row = { width, path, rendered, ...m };
    rows.push(row);
    const bad = [];
    if (!rendered) bad.push('nothing rendered');
    if (m.pageScrollsSideways) bad.push(`page scrolls sideways (${m.scrollWidth} > ${m.vw})`);
    if (m.overflow.length) bad.push(`off the edge: ${m.overflow.map((o) => o.el).join(', ')}`);
    if (m.clipped.length) bad.push(`clipped text: ${m.clipped.map((c) => c.text).join(' | ')}`);
    if (m.tinyCount) bad.push(`${m.tinyCount} tiny target(s): ${m.tinyTargets.map((t) => `${t.text}(${t.w}x${t.h})`).join(', ')}`);
    if (m.collisions.length) bad.push(`overlapping controls: ${m.collisions.join(', ')}`);
    if (m.lowContrastCount > 2) bad.push(`${m.lowContrastCount} low-contrast text runs`);
    if (m.leftEdges.length > 3) bad.push(`left edges: ${m.leftEdges.join('/')}`);
    /* On a phone, the first screen must not be a wall of text. On a desktop more
       content fits by design, so the same number is recorded but not a problem. */
    if (width <= 414 && row.wordsAboveFold > 220) bad.push(`${row.wordsAboveFold} words above the fold`);
    if (bad.length) {
      console.log(`  ${width}px ${path}: ${bad.join(' ; ')}`);
      problems.push({ width, path, bad });
    }
  }
  console.log(`  — ${width}px swept`);
}

/* ------------------------------------------------------------------ *
 * 3. Quick: cold load, route change, and tap -> change.
 * ------------------------------------------------------------------ */
console.log('\n== speed ==');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const coldTimings = [];
for (let i = 0; i < 3; i++) {
  await page.goto(BASE + '/home' + NO_DEMO, { waitUntil: 'load' });
  const t = await page.evaluate(() => new Promise((res) => {
    const nav = performance.getEntriesByType('navigation')[0];
    setTimeout(() => {
      const resources = performance.getEntriesByType('resource');
      res({
        fcp: window.__paint?.fcp ?? -1,
        lcp: window.__paint?.lcp ?? -1,
        dcl: Math.round(nav?.domContentLoadedEventEnd ?? -1),
        load: Math.round(nav?.loadEventEnd ?? -1),
        requests: resources.length,
        transferredKb: Math.round(resources.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024)
      });
    }, 700);
  }));
  coldTimings.push(t);
  await sleep(300);
}
const cold = coldTimings[coldTimings.length - 1];
console.log(`  cold load (dev server, local store): fcp ${cold.fcp}ms, lcp ${cold.lcp}ms, dcl ${cold.dcl}ms, load ${cold.load}ms, ${cold.requests} requests, ${cold.transferredKb} kB`);

/* Route change: tap a bottom tab, wait for the new screen's text. */
const routeTimes = [];
for (const [label, expect] of [['Spotlight', /spotlight/i], ['Chats', /chat/i], ['Me', /nandi/i], ['Home', /search/i]]) {
  const ms = await page.evaluate(async ({ label, expect }) => {
    const tabs = Array.from(document.querySelectorAll('.tab-btn, ion-tab-button, a[href]'));
    const el = tabs.find((t) => (t.innerText || t.getAttribute('aria-label') || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!el) return -1;
    const re = new RegExp(expect.source, expect.flags);
    const t0 = performance.now();
    const done = new Promise((res) => {
      const mo = new MutationObserver(() => { if (re.test(document.body.innerText)) { mo.disconnect(); res(performance.now() - t0); } });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
      setTimeout(() => { mo.disconnect(); res(-2); }, 4000);
    });
    el.click();
    return done;
  }, { label, expect: { source: expect.source, flags: expect.flags } });
  if (ms >= 0) routeTimes.push({ label, ms: Math.round(ms) });
  await sleep(500);
}
console.log('  route change:', routeTimes.map((r) => `${r.label} ${r.ms}ms`).join(', '));

/* Tap -> visible change, on five real interactions. */
const taps = [];
async function measureTap(name, selector, expect) {
  await goto('/home', 1600);
  const ms = await page.evaluate(async ({ selector, expect }) => {
    const el = document.querySelector(selector);
    if (!el) return -1;
    const re = new RegExp(expect.source, expect.flags);
    const t0 = performance.now();
    const done = new Promise((res) => {
      const mo = new MutationObserver(() => { if (re.test(document.body.innerText)) { mo.disconnect(); res(performance.now() - t0); } });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
      setTimeout(() => { mo.disconnect(); res(-2); }, 4000);
    });
    el.click();
    return done;
  }, { selector, expect: { source: expect.source, flags: expect.flags } });
  if (ms >= 0) taps.push({ name, ms: Math.round(ms) });
  return ms;
}

await measureTap('react on a post', 'lf-reaction-button .btn', /Have an idea/i);
await measureTap('open comments', '.fb-action-btn', /Add a comment|Comment/i);
await goto('/settings', 1600);
await measureTap('flip a setting', 'ion-toggle', /visible|hidden|may post|never post/i);
if (taps.length) console.log('  tap -> change:', taps.map((t) => `${t.name} ${t.ms}ms`).join(', '));

/* Long tasks and layout shift over a normal scroll-through. */
await goto('/home', 1800);
await page.evaluate(() => {
  window.__long = [];
  window.__cls = 0;
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ entryTypes: ['layout-shift'] });
  } catch { /* older engine */ }
});
await page.evaluate(async () => {
  for (let y = 0; y < 3000; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
  window.scrollTo(0, 0);
});
await sleep(400);
const runtime = await page.evaluate(() => ({ longTasks: window.__long ?? [], cls: Math.round((window.__cls ?? 0) * 1000) / 1000 }));
console.log(`  scrolling: ${runtime.longTasks.length} long task(s) ${runtime.longTasks.slice(0, 5)}, layout shift ${runtime.cls}`);

/* Screenshots for the record. */
for (const width of [320, 390, 768]) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700 });
  for (const [path, name] of [['/home', 'home'], ['/settings', 'settings'], ['/safety', 'safety'], [postPath, 'post']]) {
    await goto(path, 1400);
    await page.screenshot({ path: `${OUT}${name}-${width}.png` });
  }
}

/* ------------------------------------------------------------------ *
 * 4. Verdict.
 * ------------------------------------------------------------------ */
const worstWidth = (key, cmp = (a, b) => a < b) => Object.entries(
  rows.reduce((acc, r) => {
    const v = r[key];
    acc[r.width] = cmp(v ?? 0, acc[r.width] ?? (cmp === ((a, b) => a < b) ? Infinity : -Infinity)) ? v : acc[r.width];
    return acc;
  }, {})
).map(([w, v]) => `${w}:${v}`).join(' ');

const byWidth = {};
for (const r of rows) {
  byWidth[r.width] ??= { overflow: 0, clipped: 0, tiny: 0, collisions: 0, contrast: 0, sideways: 0, align: 0, words: [] };
  const b = byWidth[r.width];
  b.overflow += r.overflow.length;
  b.clipped += r.clipped.length;
  b.tiny += r.tinyCount;
  b.collisions += r.collisions.length;
  b.contrast += r.lowContrastCount;
  b.sideways += r.pageScrollsSideways ? 1 : 0;
  b.align += r.leftEdges.length > 2 ? 1 : 0;
  b.words.push(r.wordsAboveFold);
}

console.log('\n== results ==');
console.log(`  screens measured: ${rows.length} (${screens.length} screens x ${WIDTHS.length} widths)`);
console.log(`  console errors: ${consoleErrors.length}`);
for (const [w, b] of Object.entries(byWidth)) {
  console.log(`  ${w}px: sideways ${b.sideways}, off-edge ${b.overflow}, clipped ${b.clipped}, tiny targets ${b.tiny}, collisions ${b.collisions}, low contrast ${b.contrast}, uneven edges ${b.align}, words above fold max ${Math.max(...b.words)}`);
}
console.log(`  cold load: fcp ${cold.fcp}ms / lcp ${cold.lcp}ms / load ${cold.load}ms / ${cold.transferredKb} kB`);
console.log(`  route change: ${routeTimes.map((r) => `${r.label} ${r.ms}ms`).join(', ')}`);
console.log(`  tap -> change: ${taps.map((t) => `${t.name} ${t.ms}ms`).join(', ')}`);
console.log(`  long tasks while scrolling: ${runtime.longTasks.length}, layout shift: ${runtime.cls}`);
console.log(`  problems: ${problems.length}`);
if (consoleErrors.length) console.log('  console:', consoleErrors.slice(0, 5));

writeFileSync(`${OUT}report.json`, JSON.stringify({ byWidth, cold, routeTimes, taps, runtime, rows, problems }, null, 1));
await browser.close();
process.exitCode = problems.length || consoleErrors.length ? 1 : 0;
