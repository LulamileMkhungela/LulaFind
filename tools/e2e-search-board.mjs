/** Browser UI verification with synthetic demo data, not a live backend test.
 * Start npm start in lulafind/, run bash tools/get-browser.sh, then
 * LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-search-board.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from '/tmp/br/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const base = process.env.LF_BASE ?? 'http://localhost:4200';
const out = process.env.LF_SEARCH_EVIDENCE ?? '/home/user/lulafind-search-evidence';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.LF_CHROME ?? '/tmp/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  if (!localStorage.getItem('lulafind.auth.session')) localStorage.setItem('lulafind.auth.session', JSON.stringify('u_demo'));
});
const steps = [];
async function click(text) {
  await page.waitForFunction(text => [...document.querySelectorAll('lf-search-board button')].some(b => b.textContent.trim() === text && !b.disabled), {}, text);
  await page.evaluate(text => [...document.querySelectorAll('lf-search-board button')].find(b => b.textContent.trim() === text).click(), text);
}
async function has(text) {
  await page.waitForFunction(text => document.querySelector('lf-search-board')?.textContent.includes(text), {}, text);
}
async function openBoard() {
  if (page.url().includes('/onboarding')) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skip').click());
    await page.waitForFunction(() => !location.pathname.includes('/onboarding'));
    await page.goto(`${base}/post/p_thato?demo=1`, { waitUntil: 'networkidle0' });
  }
  await page.waitForSelector('lf-search-board summary');
  await page.$eval('lf-search-board summary', el => el.click());
}
async function step(name, fn) { await fn(); steps.push(name); console.log(`PASS ${name}`); }
try {
  await page.goto(`${base}/post/p_thato?demo=1`, { waitUntil: 'networkidle0', timeout: 90000 });
  await openBoard();
  await step('Owner creates two named public areas through the form', async () => {
    await page.type('lf-search-board input[name=meeting]', 'Public library entrance');
    await page.type('lf-search-board textarea[name=zones]', 'North park\nTaxi rank');
    await click('Open search board');
    await has('0 of 2 areas completed'); await has('North park');
    assert.equal(await page.$$eval('lf-search-board .zones li', els => els.length), 2);
  });
  await step('Refresh preserves board across page reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' }); await openBoard(); await has('Taxi rank');
  });
  await step('Another signed-in member claims an area', async () => {
    await page.evaluate(() => localStorage.setItem('lulafind.auth.session', JSON.stringify('u_lerato')));
    await page.reload({ waitUntil: 'networkidle0' }); await openBoard();
    await click('Claim area'); await has('Your area');
    assert.equal(await page.$$eval('lf-search-board .toolbar button', buttons => buttons.some(b => b.textContent.includes('Pause'))), false);
  });
  await step('Volunteer submits completion note and sees progress', async () => {
    await page.type('lf-search-board textarea', 'Public area checked; no confirmed sighting.');
    await click('Mark completed'); await has('1 of 2 areas completed'); await has('Public area checked');
    await click('Completed');
    assert.equal(await page.$$eval('lf-search-board .zones li', els => els.length), 1);
  });
  await step('Completed area can be reopened and released explicitly', async () => {
    await click('Reopen my area'); await click('My areas'); await has('Your area');
    await click('Release area'); await has('No areas match this filter.');
    await click('Available'); await has('North park');
  });
  await step('Coordinator pauses search and volunteers lose action controls', async () => {
    await page.evaluate(() => localStorage.setItem('lulafind.auth.session', JSON.stringify('u_demo')));
    await page.reload({ waitUntil: 'networkidle0' }); await openBoard(); await click('Pause search'); await has('Search paused');
    await page.evaluate(() => localStorage.setItem('lulafind.auth.session', JSON.stringify('u_lerato')));
    await page.reload({ waitUntil: 'networkidle0' }); await openBoard(); await has('Search paused');
    assert.equal(await page.$$eval('lf-search-board .actions button', els => els.length), 0);
  });
  await step('Search board fits 320px and 390px viewports', async () => {
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 844 });
      assert.equal(await page.$eval('lf-search-board', el => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await page.$eval('lf-search-board', el => el.scrollIntoView());
    await page.screenshot({ path: `${out}/search-board-390.png` });
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/results.json`, JSON.stringify({ mode: 'synthetic demo / local persistence', passed: steps, pageErrors: errors }, null, 2));
  console.log(`${steps.length} browser journeys passed; evidence: ${out}`);
} catch (error) {
  console.error('URL:', page.url(), '\nBODY:', await page.$eval('body', el => el.innerText), '\nERRORS:', errors);
  throw error;
} finally { await browser.close(); }
