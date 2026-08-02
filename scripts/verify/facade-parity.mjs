/**
 * facade-parity.mjs — does the Python port elect the same fourteen tones the
 * browser does, and give every building the same bucket?
 *
 * WHAT IS BEING PROVED. `scripts/bake_facades.py` is a transcription of
 * `window.quantiseFacades`. A transcription checked by re-reading it proves
 * nothing: the same misunderstanding writes both sides. So this runs the REAL
 * browser functions on the REAL data and dumps what they decided.
 *
 * IT RUNS THE WHOLE ASSEMBLY, not just the election, because the election is
 * over whatever the assembly produced:
 *
 *   mergeCapitolScene()  patches 12 buildings from capitol_overrides.json,
 *                        appends 604 from capitol.geojson, and registers
 *                        FACADE_PROTECTED
 *   applyUnion24()       rewrites one building's height AND its wd/wg/wn
 *   quantiseFacades()    elects fourteen tones over all of that
 *
 * Getting the assembly wrong and the algorithm right still gives the wrong
 * answer, and it would be an easy thing to miss — which is exactly why this
 * calls the real ones rather than reproducing them here.
 *
 * ON ITS OWN COPY, like outer-facade-parity.mjs. Fetching the documents again
 * keeps the check independent of what the live scene happens to be doing, and
 * `quantiseFacades` recomputes from `wd` every time, so running it twice on
 * separate data is safe.
 *
 * ONE KNOWN DUPLICATE, and it is harmless. `mergeCapitolScene` appends to the
 * global `window.FACADE_PROTECTED`, which the page's own load already filled,
 * so calling it again doubles that list. `quantiseFacades` dedupes protected
 * entries by their coarse key (`if (protectedKeys.has(key)) continue`), so the
 * second copy is dropped. Noted rather than worked around, because working
 * around it would mean not calling the real function.
 *
 * THE JOIN KEY IS `id`, which every snapshot building carries. Features without
 * one — the Capitol Complex is authored, not Overture — are compared by their
 * position in the assembled array instead, and the two sides build that array
 * the same way by construction.
 *
 * Writes scripts/verify/out/facade-browser.json.
 * Compare with:  python scripts/verify/facade_parity.py
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8123 node scripts/verify/facade-parity.mjs
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join('scripts', 'verify', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', e => console.log('  [pageerror] ' + e.message));

await page.goto(BASE + '/index.html?intro=0&drift=0', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => {
  for (const fn of ['quantiseFacades', 'mergeCapitolScene', 'applyUnion24']) {
    if (typeof window[fn] !== 'function') return { error: fn + ' is not defined' };
  }
  const manifest = await fetch('data/manifest.json').then(r => r.json()).catch(() => null);
  const date = (manifest && (manifest.latest || manifest.date)) ||
    (manifest && Array.isArray(manifest.snapshots) && manifest.snapshots[manifest.snapshots.length - 1]);
  if (!date) return { error: 'could not resolve the snapshot date from manifest.json' };

  const buildings = await fetch(`data/snapshots/${date}/buildings.detailed.geojson`).then(r => r.json());
  const parts = await fetch(`data/snapshots/${date}/parts.detailed.geojson`).then(r => r.json());

  await window.mergeCapitolScene(buildings, parts);
  window.applyUnion24(buildings.features);
  const stats = window.quantiseFacades(buildings.features);

  return {
    date,
    stats,
    total: buildings.features.length,
    // Palette is read back off the module rather than returned by the call —
    // quantiseFacades returns only counts.
    palette: (window.__facadePalette && window.__facadePalette()) || null,
    rows: buildings.features.map((f, i) => {
      const p = f.properties || {};
      return { i, id: p.id != null ? String(p.id) : null, wd: p.wd || null,
               wp: p.wp || null, wf: p.wf || null };
    }),
  };
});

if (result.error) {
  console.log('*FAIL — ' + result.error);
  process.exitCode = 1;
} else {
  const stamped = result.rows.filter(r => r.wp).length;
  const buckets = new Set(result.rows.filter(r => r.wp).map(r => r.wp.slice(2)));
  console.log(`snapshot ${result.date}`);
  console.log(`assembled ${result.total} buildings, browser stamped ${stamped}`);
  console.log(`quantiseFacades reported ${JSON.stringify(result.stats)}`);
  console.log(`distinct bucket ordinals in use: ${buckets.size}`);
  const file = path.join(OUT_DIR, 'facade-browser.json');
  fs.writeFileSync(file, JSON.stringify(result));
  console.log('\nwrote ' + file + '  (' + (fs.statSync(file).size / 1024).toFixed(0) + ' KB)');
  console.log('now run:  python scripts/verify/facade_parity.py');
  if (stamped === 0) {
    console.log('*FAIL — the browser stamped nothing');
    process.exitCode = 1;
  }
}

await browser.__done();
