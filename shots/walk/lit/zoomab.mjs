/**
 * zoomab.mjs — the change is one pixel wide, so look at it one pixel wide.
 *
 * The before/after block frames from `readable.mjs` are nearly indistinguishable
 * at 1x, which is a fair objection to the whole fix and has to be answered by
 * looking rather than by quoting the ratio again. This magnifies the left end
 * of the bar and the key swatch 6x with nearest-neighbour sampling — no
 * smoothing, so a 1 px border stays a hard 6 px band and is not invented by the
 * resampler — and stacks before over after in one labelled image.
 *
 * (VISUAL_REFERENCE_PLAYBOOK §6: disambiguate "where does this go" with ONE
 * labelled render before believing anything about it.)
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/zoomab.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const FRAMES = process.env.VERIFY_FRAMES || OUT;
const NIGHT = 0.92;
const MAG = 6;
const ROUTE = ['GDC', 'The Castilian'];

const browser = await launch(chromium, { gl: 'hardware', maxMs: 600000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((p) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
}, NIGHT);
await page.waitForTimeout(1200);

const shots = {};
for (const state of ['before', 'after']) {
  await page.evaluate((s) => {
    window.WAYFIND.litStripEdgeOn = (s === 'after');
    window.WAYFIND.litStripCapsOpacity = (s === 'after') ? 0.58 : 0.45;
  }, state);
  let ok = false;
  for (let t = 0; t < 4 && !ok; t++) {
    await page.evaluate(async ([f, t2]) => { await window.wayfindRoute(f, t2, { expand: true }); }, ROUTE);
    ok = await page.waitForFunction(() => {
      const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
      if (!card) return false;
      const kids = Array.from(card.children);
      const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
      return hi >= 0 && kids.slice(hi).some(k => k.querySelector && k.querySelector('[role="img"]'));
    }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  }
  await page.waitForTimeout(500);
  // The left end of the bar, its caps row, and the key swatch under it.
  const box = await page.evaluate(() => {
    const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
    const kids = Array.from(card.children);
    const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
    const wrap = kids.slice(hi).find(k => k.querySelector && k.querySelector('[role="img"]'));
    const track = wrap.querySelector('[role="img"]');
    const sw = kids.slice(hi).map(k => k.querySelector && k.querySelector('span[aria-hidden="true"]')).find(Boolean);
    const t = track.getBoundingClientRect();
    const s = sw ? sw.getBoundingClientRect() : t;
    return { x: t.left - 2, y: t.top - 4, width: 150, height: (s.bottom + 4) - (t.top - 4) };
  });
  shots[state] = (await page.screenshot({ clip: box })).toString('base64');
}

const out = await page.evaluate(async ([a, b, MAG]) => {
  const load = (s) => new Promise(r => { const q = new Image(); q.onload = () => r(q); q.src = 'data:image/png;base64,' + s; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const W = Math.max(ia.width, ib.width) * MAG, H = (ia.height + ib.height) * MAG + 60 * MAG / 3;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;      // a 1 px border must not be invented by the resampler
  g.fillStyle = '#0d0a12'; g.fillRect(0, 0, W, H);
  g.drawImage(ia, 0, 0, ia.width, ia.height, 0, 30, ia.width * MAG, ia.height * MAG);
  g.drawImage(ib, 0, 0, ib.width, ib.height, 0, ia.height * MAG + 60, ib.width * MAG, ib.height * MAG);
  g.fillStyle = '#e8e0f0'; g.font = '20px system-ui, sans-serif';
  g.fillText('BEFORE — no edge, caps at 0.45', 6, 22);
  g.fillText('AFTER — litStripEdgeCol #6b779a at 1 px, caps at 0.58', 6, ia.height * MAG + 52);
  return c.toDataURL('image/png');
}, [shots.before, shots.after, MAG]);

fs.writeFileSync(`${FRAMES}/r7-edge-ab-zoom.png`, Buffer.from(out.split(',')[1], 'base64'));
console.log(`wrote ${FRAMES}/r7-edge-ab-zoom.png  (${MAG}x, nearest-neighbour)`);
await browser.close();
