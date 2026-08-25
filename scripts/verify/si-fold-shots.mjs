/**
 * si-fold-shots.mjs — the two pictures SI4 is argued from.
 *
 * Both are the REAL page at the exact 390x844 Simeon judges from, not a mockup
 * of one, because the whole defect was a measurement (494 px of content in a
 * 337 px box) that nobody had looked at.
 *
 *   1. shots/si/fold/sheet-phone-fixed.jpg
 *      A real import, through the real screen, then back to the sheet — so the
 *      privacy sentence, the Delete control and the OpenStreetMap credit are
 *      all in a state where they exist, and all three are on screen. Every
 *      rectangle it claims is on screen is measured and printed, and the run
 *      exits non-zero if any of the three is not.
 *
 *   2. shots/si/doors/two-doors-vs-one.jpg
 *      THE TASTE QUESTION, SIDE BY SIDE, AND NOTHING ELSE. Panel A is the sheet
 *      as it ships today, with the two rows two lanes appended independently.
 *      Panel B is the same live page with one row hidden and the other
 *      relabelled IN THE BROWSER — a mock, never a code change, so nothing in
 *      this script decides anything. `MERGED_*` below is the mock's wording and
 *      it is a placeholder for whatever Simeon picks, not a proposal.
 *
 * Screenshot twice, keep the second — scripts/verify/README.md's rule.
 *
 * Usage:
 *   python scripts/serve.py 8976
 *   node scripts/verify/si-fold-shots.mjs 8976
 *
 * Exit: 0 all three controls measured on screen, 1 any of them not, 2 bad args.
 */
import { chromium } from 'playwright-core';
import { launch, BASE as DEFAULT_BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const argPort = argv.find(a => /^\d+$/.test(a));
const BASE = process.env.VERIFY_URL || (argPort ? `http://127.0.0.1:${argPort}` : DEFAULT_BASE);
const FIX = path.join(__dirname, 'schedule-fixtures', 'integration-tuesday.ics');
const PHONE = { width: 390, height: 844 };

// The mock wording in panel B. A placeholder for the taste call, not a vote.
const MERGED_LABEL = 'My class schedule';
const MERGED_SUB = 'Import it, then see today\'s walks — read on this phone, never uploaded';

if (!fs.existsSync(FIX)) { console.error('missing fixture ' + FIX); process.exit(2); }
const FOLD_DIR = path.join(ROOT, 'shots', 'si', 'fold');
const DOOR_DIR = path.join(ROOT, 'shots', 'si', 'doors');
fs.mkdirSync(FOLD_DIR, { recursive: true });
fs.mkdirSync(DOOR_DIR, { recursive: true });

let fail = 0;
const ok = (c, name, detail) => {
  if (!c) fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
const note = (s) => console.log('        ' + s);

async function settle(p) {
  await p.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 180000 });
  await p.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await p.waitForFunction(() => {
    const v = document.getElementById('veil');
    return !v || getComputedStyle(v).opacity === '0' || v.classList.contains('lift');
  }, null, { timeout: 180000 }).catch(() => note('note: veil never reported lifted'));
}
/** Screenshot twice, keep the second. Returns the buffer as well as writing it. */
async function shotTwice(p, file, clip) {
  const o = clip ? { type: 'jpeg', quality: 82, clip } : { type: 'jpeg', quality: 82 };
  await p.screenshot(o);
  const buf = await p.screenshot(Object.assign({ path: file }, o));
  note('shot ' + path.relative(ROOT, file));
  return buf;
}

const browser = await launch(chromium, { maxMs: 900000 });
const ctx = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

console.log('\n' + '='.repeat(78));
console.log('  si-fold-shots — ' + BASE + '   viewport ' + PHONE.width + 'x' + PHONE.height);
console.log('='.repeat(78));

await page.goto(`${BASE}/index.html?walk=1&drift=0`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(page);
await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });
await page.waitForTimeout(1500);

// ── PICTURE 2 FIRST, because it wants the sheet in its untouched state ──────
console.log('\n── the doors, side by side ' + '─'.repeat(48));
const doorsNow = await page.evaluate(() =>
  [...document.getElementById('wf-sheet').children]
    .filter(c => /import/i.test(c.innerText || ''))
    .map(c => (c.id || c.className) + ': "' + c.innerText.split('\n')[0] + '"'));
for (const d of doorsNow) note('today -> ' + d);
const shotA = await shotTwice(page, path.join(FOLD_DIR, '_panel-a.jpg'));

// THE MOCK. In the page, never in the file. One row hidden, the other given the
// merged wording, so the picture shows what a single door would look like at
// this exact size — and the next reload has none of it.
await page.evaluate(([lab, sub]) => {
  const day = document.getElementById('wf-day-btn');
  if (day) day.style.display = 'none';
  const l = document.querySelector('#wf-imp-entry .wf-imp-entry-lab');
  const s = document.querySelector('#wf-imp-entry .wf-imp-entry-sub');
  if (l) l.textContent = lab;
  if (s) s.textContent = sub;
}, [MERGED_LABEL, MERGED_SUB]);
await page.waitForTimeout(500);
const shotB = await shotTwice(page, path.join(FOLD_DIR, '_panel-b.jpg'));

// The composite is itself a page, screenshotted, so this script needs no image
// library and the labels are real type rather than pixels drawn by hand.
const compose = await ctx.newPage();
const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#14110c;color:#f4e7d0;
    font:400 15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{padding:26px 30px 30px}
  h1{font:700 20px/1.3 inherit;margin:0 0 4px}
  .lede{color:#c3b49a;margin:0 0 22px;max-width:860px}
  .cols{display:flex;gap:30px;align-items:flex-start}
  .col{width:390px}
  .cap{font:700 13px/1.4 inherit;letter-spacing:.06em;text-transform:uppercase;
    color:#f5a623;margin:0 0 3px}
  .sub{color:#c3b49a;font-size:13.5px;margin:0 0 10px;min-height:38px}
  img{display:block;width:390px;border-radius:14px;border:1px solid rgba(245,166,35,.28)}
</style><div class=wrap>
  <h1>One door or two?</h1>
  <p class=lede>Two lanes each added their own way in to the same panel, neither able to see the other's.
     Left is what ships today. Right is the same screen with one row instead of two — a mock, nothing is changed yet.</p>
  <div class=cols>
    <div class=col><p class=cap>A &middot; today</p>
      <p class=sub>Two rows. &ldquo;Import my class schedule&rdquo; opens your day; &ldquo;Import your class schedule&rdquo; opens the importer.</p>
      <img src="data:image/jpeg;base64,${shotA.toString('base64')}"></div>
    <div class=col><p class=cap>B &middot; one door</p>
      <p class=sub>One row doing both jobs. The panel gets 66&nbsp;px shorter and the wording below is a placeholder.</p>
      <img src="data:image/jpeg;base64,${shotB.toString('base64')}"></div>
  </div>
</div>`;
await compose.setViewportSize({ width: 900, height: 1080 });
await compose.setContent(html, { waitUntil: 'load' });
await compose.waitForTimeout(400);
await shotTwice(compose, path.join(DOOR_DIR, 'two-doors-vs-one.jpg'));
await compose.close();
try { fs.unlinkSync(path.join(FOLD_DIR, '_panel-a.jpg')); } catch (e) {}
try { fs.unlinkSync(path.join(FOLD_DIR, '_panel-b.jpg')); } catch (e) {}

// ── PICTURE 1: the fold, with all three of the things it used to eat ────────
console.log('\n── the fold, after a real import ' + '─'.repeat(42));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(page);
await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });
await page.waitForTimeout(1200);
await page.click('#wf-imp-entry');
await page.waitForTimeout(700);
await page.click('#wf-imp-tabs button[data-src="ut"]');
await page.waitForTimeout(400);
await page.setInputFiles('#wf-imp-file', FIX);
await page.waitForTimeout(4000);
await page.click('.wf-imp-go');
await page.waitForTimeout(2500);
// THEN RELOAD, and that is the state worth photographing rather than the one
// straight after the import. Coming back to the app the next day is when a
// student wants the Delete control, it is the state that proves the store
// republished, and it is the honest sheet: the import leaves both ends filled,
// which pops the search suggestion list open and puts a half-drawn row in the
// frame that has nothing to do with the fold.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
await settle(page);
await page.waitForSelector('#wf-priv', { timeout: 180000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const s = document.getElementById('wf-sheet');
  if (s && s.classList.contains('hidden')) document.getElementById('wf-button').click();
});
await page.waitForTimeout(1000);

const measure = () => page.evaluate(() => {
  const sheet = document.getElementById('wf-sheet');
  const sr = sheet.getBoundingClientRect();
  const priv = document.getElementById('wf-priv');
  const del = document.getElementById('wf-priv-del');
  const foot = sheet.querySelector('.wf-foot');
  // The credit is the last line of the footer — the one carrying OpenStreetMap.
  const credit = foot ? [...foot.querySelectorAll('div')]
    .find(d => /OpenStreetMap/i.test(d.textContent || '')) : null;
  const line = priv ? [...priv.querySelectorAll('*')]
    .find(d => /never uploaded|on this device/i.test(d.textContent || '')) : null;
  const box = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
      shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 1,
      text: (e.innerText || '').replace(/\n+/g, ' / ').slice(0, 120) };
  };
  return {
    stored: window.WAYFIND.store.has(),
    sheet: { top: Math.round(sr.top), bottom: Math.round(sr.bottom), h: Math.round(sr.height),
      scrollH: sheet.scrollHeight, scrollTop: Math.round(sheet.scrollTop),
      overflowY: getComputedStyle(sheet).overflowY },
    win: innerHeight,
    privacy: box(line), del: box(del), credit: box(credit),
  };
});

// ── AT REST, and then AFTER A SWIPE, and the difference is the honest part ──
// A student who has imported and come back has 548 px of sheet content, and
// between #wf-button's column above and the drive controls below there are 523
// px of phone. It does not fit and no ceiling makes it fit — 100vh minus both
// clearances is 538. So the claim is REACHABLE, not "all on one frame at rest",
// and both states are measured so nobody has to take the word for it.
const atRest = await measure();
const rest = atRest;
note('sheet y' + rest.sheet.top + '-' + rest.sheet.bottom + '  ' + rest.sheet.h
  + ' px tall, content ' + rest.sheet.scrollH + ' px, overflow-y: ' + rest.sheet.overflowY
  + '  (window ' + rest.win + ', at rest: scrollTop=' + rest.sheet.scrollTop + ')');
ok(rest.stored === true, 'a real import through the real screen is saved, so Delete has work to do');
const NAMED = [['the privacy line', 'privacy'], ['Delete', 'del'], ['the OSM credit', 'credit']];
const onScreen = (m, b) => !!(b && b.shown && b.top >= m.sheet.top - 1
  && b.bottom <= m.sheet.bottom + 1 && b.bottom <= m.win + 1);
for (const [k, key] of NAMED) {
  const b = rest[key];
  note('at rest, ' + k + ': ' + (b ? 'y' + b.top + '-' + b.bottom
    + (onScreen(rest, b) ? '  ON SCREEN' : '  ' + (b.bottom - rest.sheet.bottom) + ' px below the sheet\'s edge')
    + '  "' + b.text + '"' : 'NOT FOUND'));
}
// Now swipe the sheet to its end — a real scroll on the real element, not an
// element.scrollIntoView() that could move an ancestor instead.
await page.evaluate(() => {
  const s = document.getElementById('wf-sheet');
  s.scrollTop = s.scrollHeight;
});
await page.waitForTimeout(600);
const scrolled = await measure();
note('after one swipe: scrollTop=' + scrolled.sheet.scrollTop + ' of '
  + (scrolled.sheet.scrollH - scrolled.sheet.h + 2) + ' px available');
for (const [k, key] of NAMED) {
  const b = scrolled[key];
  note(k + ': ' + (b ? 'y' + b.top + '-' + b.bottom + '  "' + b.text + '"' : 'NOT FOUND'));
  ok(onScreen(scrolled, b), k + ' is reachable on a 390x844 phone', b ? '' : '<- element not found');
}
ok(errs.length === 0, 'no console or page errors', errs.join(' | '));
await shotTwice(page, path.join(FOLD_DIR, 'sheet-phone-fixed.jpg'));

console.log('\n' + '='.repeat(78));
console.log('  ' + (fail ? fail + ' failed' : 'all measured on screen'));
console.log('='.repeat(78) + '\n');
browser.__done();
process.exit(fail ? 1 : 0);
