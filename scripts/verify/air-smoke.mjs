/**
 * air-smoke.mjs — the Air Race page, booted for real (needs a GPU, so it is quarantined from CI).
 *   - air.html boots with no console error and no page error
 *   - the race layer is in the map's style and the course loaded (23 rings)
 *   - the autopilot, stepped two simulated seconds by hand, passes gate 0
 *   - the frame is not just the city: the craft's own colour (gold) is on screen, so the layer drew
 *   - a ghost link in the fragment (#g=...) is read: the page says it is racing a ghost
 * Run by hand on a cloud lane:  acer-run.sh check air-smoke.mjs --gl hardware    or    scripts/colab/run.py --check air-smoke.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OUT = process.env.VERIFY_OUT || path.join(process.cwd(), 'air-smoke-out');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0; const ok = (c, m, d) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || d === undefined ? '' : '  [' + d + ']')); if (!c) failed++; };

const browser = await launch(chromium, { maxMs: 8 * 60 * 1000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
try {
  const house = JSON.parse(fs.readFileSync(path.join(process.cwd(), '../../data/air/house.json'), 'utf8'));
  await page.goto(`${BASE}/air.html?manual=1&auto=1&countdown=0&p=0.12#g=${house.ghost}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.airReady === '1', null, { timeout: 240000 });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 240000 }).catch(() => {});
  await page.evaluate(() => new Promise(res => { const m = window.__air.map; const t = setTimeout(res, 20000); const c = () => (m.loaded() && m.areTilesLoaded()) ? (clearTimeout(t), res()) : m.once('idle', c); c(); }));
  ok(await page.evaluate(() => !!window.__air.map.getLayer('air-race')), 'the race layer is in the style');
  ok(await page.evaluate(() => window.__air.gates.length) === 23, 'the course loaded: 23 rings');
  for (let i = 0; i < 120; i++) await page.evaluate(() => window.__air.advance(1 / 60));      // two simulated seconds
  const st = await page.evaluate(() => window.__air.state());
  ok(st.next >= 1 && st.misses === 0, 'the autopilot passed gate 0 within 2 s', JSON.stringify({ next: st.next, misses: st.misses, t: st.t }));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = await page.screenshot({ path: path.join(OUT, 'smoke.png') });
  ok(await page.evaluate(() => document.getElementById('air-root').textContent.includes('Ghost') || window.__air.refLabel === 'Ghost'), 'a ghost link in the fragment is read (racing a ghost)');
  // the craft's colour on screen: decode the screenshot itself (the map canvas has no drawing buffer to read back)
  const gold = await page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const g = document.createElement('canvas'); g.width = img.width; g.height = img.height; const x = g.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) < 28 && Math.abs(d[i + 1] - 211) < 28 && Math.abs(d[i + 2] - 107) < 40) n++; return n; }, png.toString('base64'));
  ok(gold > 150, 'the craft (gold) is drawn: its colour is on the screen', gold + ' px');
  ok(errors.length === 0, 'no console or page errors', errors.slice(0, 3).join(' | '));
} finally { await browser.__done(); }
console.log(failed ? 'air-smoke: FAILED' : 'air-smoke: ok'); process.exit(failed ? 1 : 0);
