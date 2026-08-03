/**
 * tower-facade-state.mjs — what pattern are the 114 downtown towers ACTUALLY
 * wearing, on each of the two data paths?
 *
 * downtown-tone.mjs measured the tower walls rendering warm brown (#7d776e)
 * when data/outer_tower_palette.json says blue-grey (#8ca0b1 and lighter). Only
 * two things can do that: the `fb`->id join never happened and every tower fell
 * through to 'mh00' (the campus tan), or it happened and the atlas is painting
 * the wrong thing. This asks the page instead of guessing.
 *
 * Reports, per path: whether registerOuterTowerBuckets returned ids, the actual
 * fill-extrusion-pattern expression on `outer-tower`, the palette entries those
 * ids point at, and a queryRenderedFeatures sample of what `fb`/`wp` the
 * features in frame actually carry.
 *
 *   VERIFY_URL=http://127.0.0.1:8161 node scripts/verify/tower-facade-state.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOD = parseFloat(opt('--tod', '0.30'));
const POSE = { center: [-97.7420, 30.2760], zoom: 15.2, pitch: 74, bearing: 200 };

const browser = await launch(chromium, { gl: 'hardware' });

for (const extra of ['', '&tiles=0']) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/outer|facade|tower/i.test(t)) logs.push(t); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));

  await page.goto(BASE + '/_harness.html?intro=0&drift=0' + extra,
                  { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.evaluate(v => {
    if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, v, true);
  }, TOD);
  await page.evaluate(q => window.__map.jumpTo(q), POSE);
  await page.evaluate(() => new Promise(r => {
    const m = window.__map;
    if (m.loaded() && m.areTilesLoaded()) return r();
    m.once('idle', r); setTimeout(r, 30000);
  }));
  await page.waitForTimeout(2500);

  const st = await page.evaluate(() => {
    const m = window.__map;
    const pat = m.getLayer('outer-tower')
      ? m.getPaintProperty('outer-tower', 'fill-extrusion-pattern') : null;
    const pal = (window.facadePalette && window.facadePalette()) || [];
    // Every pattern id the expression can produce, in order of appearance.
    const ids = [];
    (function walk(x) {
      if (Array.isArray(x)) return x.forEach(walk);
      if (typeof x === 'string' && /^[a-z]{2}\d{2}/.test(x) && !ids.includes(x)) ids.push(x);
    })(pat);
    const feats = m.queryRenderedFeatures({ layers: ['outer-tower'] });
    const seen = {};
    for (const f of feats) {
      const k = `fb=${f.properties.fb} wp=${f.properties.wp} wd=${f.properties.wd}`;
      seen[k] = (seen[k] || 0) + 1;
    }
    return {
      patternExpr: JSON.stringify(pat),
      patternIds: ids,
      paletteLen: pal.length,
      // What the ids the expression names actually resolve to in the palette.
      idColours: ids.map(id => {
        const idx = parseInt(id.slice(2, 4), 10);
        const e = pal[idx];
        return { id, idx, wd: e ? e.wd : '(no such palette entry)' };
      }),
      renderedTowers: feats.length,
      sample: Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  });

  console.log(`\n=== path: ${extra === '' ? 'TILES (what the site serves)' : 'GeoJSON (&tiles=0)'} ===`);
  console.log('palette entries:', st.paletteLen, '| towers rendered in frame:', st.renderedTowers);
  console.log('pattern expr  :', st.patternExpr.slice(0, 300));
  console.log('pattern ids   :', st.patternIds.join(', ') || '(none)');
  for (const c of st.idColours) console.log(`   ${c.id} -> palette[${c.idx}] wd ${c.wd}`);
  console.log('features in frame (fb / wp / baked wd):');
  for (const [k, n] of st.sample) console.log(`   x${String(n).padStart(3)}  ${k}`);
  const outerLogs = logs.filter(l => l.startsWith('[outer]'));
  if (outerLogs.length) console.log('console:', outerLogs.join(' | '));
  await page.close();
}
await browser.close();
