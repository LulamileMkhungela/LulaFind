/**
 * What does a phone actually download, and when does the first pixel appear?
 *
 * Measures a served build in a real Chromium: cold every time (cache bypassed by
 * a fresh request context per run), reporting FCP / LCP / TTFB / DOMContentLoaded
 * / load, the request count and the real transfer bytes.
 *
 *   npx ng build --configuration production --output-path /tmp/www-prod
 *   node tools/serve-www.mjs 4400 /tmp/www-prod/browser
 *   LD_LIBRARY_PATH=/tmp/alibs/lib node tools/measure-load.mjs http://localhost:4400
 *
 * Honest limits: localhost, so TTFB is not a network. The byte count is the
 * number that matters on mobile data; the milliseconds show the app's own work.
 */
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = (process.argv[2] ?? 'http://localhost:4400').replace(/\/$/, '');
const PATH = process.argv[3] ?? '/home?demo=1&data=local';
const RUNS = Number(process.argv[4] ?? 4);

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

const observe = () => {
  window.__paint = { fcp: -1, lcp: -1 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__paint.fcp = Math.round(e.startTime); })
      .observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { const e = l.getEntries().slice(-1)[0]; if (e) window.__paint.lcp = Math.round(e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* leave -1 */ }
};

const read = (page) => page.evaluate(() => new Promise((res) => setTimeout(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  const kb = (list) => Math.round(list.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024);
  res({
    fcp: window.__paint?.fcp ?? -1,
    lcp: window.__paint?.lcp ?? -1,
    ttfb: Math.round(nav.responseStart),
    dcl: Math.round(nav.domContentLoadedEventEnd),
    load: Math.round(nav.loadEventEnd),
    requests: resources.length,
    kb: kb(resources),
    jsKb: kb(resources.filter((r) => r.name.endsWith('.js'))),
    cssKb: kb(resources.filter((r) => r.name.endsWith('.css')))
  });
}, 900)));

console.log(`${BASE}${PATH}  (${RUNS} cold loads, then one warm reload)`);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(observe);

for (let i = 0; i < RUNS; i++) {
  /* A new context per run = empty cache = a genuinely cold load. */
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(observe);
  await p.goto(BASE + PATH, { waitUntil: 'load' });
  const m = await read(p);
  console.log(`  cold ${i + 1}: fcp ${m.fcp}ms  lcp ${m.lcp}ms  ttfb ${m.ttfb}ms  dcl ${m.dcl}ms  load ${m.load}ms  ${m.requests} req  ${m.kb} kB (js ${m.jsKb}, css ${m.cssKb})`);
  await ctx.close();
}

await page.goto(BASE + PATH, { waitUntil: 'load' });
const warm = await read(page);
console.log(`  warm reload (same tab): fcp ${warm.fcp}ms  lcp ${warm.lcp}ms  ${warm.requests} req  ${warm.kb} kB`);

await browser.close();
