/**
 * audit-reveal.mjs — the first minute after the veil lifts, on an ordinary
 * first visit (fresh profile, intro ON, auto-detect NOT cancelled).
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-reveal.mjs <outDir> [--seconds 70] [--lite]
 *
 * Polls every 250 ms: the graphics preset and auto-detect state, and the
 * authored-apartments layer (is the mesh group present, how many buildings
 * and triangles, are the legacy prisms filtered out). Every change of the
 * mesh group is photographed. Answers one question: after the city is shown,
 * does anything swap the authored buildings back to their legacy boxes?
 *
 * Also logs every [graphics] / [slopes-apartments] console line with its time.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-reveal.mjs <outDir> [--seconds N] [--lite]'); process.exit(2); }
const si = process.argv.indexOf('--seconds');
const SECONDS = si > 0 ? +process.argv[si + 1] : 70;
const LITE = process.argv.includes('--lite');
const TAG = LITE ? 'lite-' : '';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const ctx = await browser.newContext(LITE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await applySwaps(ctx);
const page = await ctx.newPage();
const T0 = Date.now();
const t = () => +((Date.now() - T0) / 1000).toFixed(2);
const logs = [];
page.on('console', m => { const s = m.text(); if (/\[(graphics|slopes-apartments|slopes|intro|mobile)\]/.test(s)) logs.push({ t: t(), text: s.slice(0, 220) }); });
page.on('pageerror', e => logs.push({ t: t(), text: 'PAGEERROR ' + e.message }));

await page.goto(BASE + '/?drift=0' + (LITE ? '&lite=1' : ''), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__map, null, { timeout: 120000 });
const series = [];
let veil = null, lastGroup = null, shots = 0, until = null;
while (true) {
  const s = await page.evaluate(() => {
    const A = window.slopesApartments, G = window.GFX;
    return {
      veil: !!document.getElementById('veil'),
      preset: G && G.preset, autoDetected: G && G.autoDetected,
      group: !!(A && A.group), done: A ? A.count.done : null, buildings: A ? A.count.buildings : null,
      triangles: A ? A.count.triangles : null, filtered: A ? !!A.filtered : null,
      prismFilter: (() => { try { return JSON.stringify(window.__map.getFilter('buildings-3d') || null).length; } catch (e) { return null; } })(),
    };
  }).catch(() => null);
  if (s) {
    s.t = t();
    if (veil == null && !s.veil) { veil = s.t; until = Date.now() + SECONDS * 1000; }
    const prev = series[series.length - 1];
    if (!prev || prev.preset !== s.preset || prev.group !== s.group || prev.done !== s.done || prev.veil !== s.veil || prev.autoDetected !== s.autoDetected || prev.filtered !== s.filtered) {
      series.push(s);
      console.log(JSON.stringify(s));
      if (veil != null && shots < 8 && lastGroup !== null && s.group !== lastGroup) {
        await page.screenshot({ path: path.join(OUT, `${TAG}reveal-${String(s.t).replace('.', '_')}-group-${s.group ? 'on' : 'off'}.jpg`), type: 'jpeg', quality: 80 });
        shots++;
      }
    }
    lastGroup = s.group;
  }
  if (until && Date.now() > until) break;
  if (Date.now() - T0 > 600000) break;
  await page.waitForTimeout(250);
}
const out = { base: BASE, lite: LITE, veilGone: veil, series, logs };
fs.writeFileSync(path.join(OUT, `${TAG}reveal.json`), JSON.stringify(out, null, 1));
for (const l of logs) console.log(`  ${l.t}s ${l.text}`);
await browser.__done();
