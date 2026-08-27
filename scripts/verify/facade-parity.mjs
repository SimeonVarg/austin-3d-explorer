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
 * IT DUMPS THE ELECTION'S INPUTS AS WELL AS ITS OUTPUT, and that is not
 * padding. `wd`/`wg`/`wn` are what the election reads and
 * `building_class`/`final_height` are what `familyFor` reads, so with them in
 * the capture the comparator can say WHICH of the two sides is wrong —
 * assembly or algorithm — without a second browser run. A browser run here is
 * ~40 s and a wrong diagnosis costs an hour, so the ~500 KB is cheap. It is
 * also the only way to catch the assembly agreeing on COUNTS while disagreeing
 * on VALUES, which a `12 / 604 / 1` line cannot see.
 *
 * IT LOADS THE PAGE TWICE, and the second load answers a different question.
 * Pass A forces the browser to ELECT (`?bakedfacades=0`) and is what the Python
 * side is compared against — that proves the PORT. Pass B arms the baked
 * palette and is diffed against pass A here — that proves the SWITCH, which is
 * what the site actually runs. Both guards in js/facades.js fall back to
 * electing, and a fallback makes that diff come out perfect, so pass B asserts
 * `facadePaletteSource()` really says `baked` before the diff is believed.
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

// Resolved from THIS FILE, not from the working directory, and that is a fix
// rather than a tidy-up. `path.join('scripts','verify','out')` is relative to
// wherever node was launched, and this directory's README tells you to run its
// scripts FROM `scripts/verify` — so a run started the documented way wrote the
// capture to `scripts/verify/scripts/verify/out/`, silently, while
// `facade_parity.py` kept reading the real path and comparing against whatever
// capture happened to be sitting there. On 2026-08-27 that was a 23-day-old
// file from snapshot 2026-08-04: the harness reported 17 findings, 1,274
// mismatched families and "NOT a bijection", none of which were real, and the
// obvious reading of that output is that the change under test broke the bake.
// The stray nested copy had also been committed. A capture that lands in a
// different place depending on your shell's cwd is not a capture.
const OUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await launch(chromium);

/**
 * One assembled-and-quantised run of the page.
 *
 * `wantBaked` is the ONE load-bearing argument. js/facades.js adopts
 * data/facade_palette.json when it is current, which is the whole point of the
 * port — and it turns the Python comparison circular the moment it is left on:
 * quantiseFacades would read back the file bake_facades.py wrote,
 * facade_parity.py would compare the bake against itself, and the run would
 * print a triumphant 3,057/3,057 while proving nothing at all. So pass A forces
 * the election with `bakedfacades=0` and that is what the Python side is held
 * to; pass B arms the bake and is diffed against pass A here. Each run asserts
 * which path it actually took, because a silent circular pass is a far worse
 * outcome than a failure.
 */
async function capture(wantBaked) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
  const flag = wantBaked ? '' : '&bakedfacades=0';
  await page.goto(BASE + '/index.html?intro=0&drift=0' + flag,
                  { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async (wantBaked) => {
  for (const fn of ['quantiseFacades', 'mergeCapitolScene', 'applyUnion24']) {
    if (typeof window[fn] !== 'function') return { error: fn + ' is not defined' };
  }
  if (window.FACADE_BAKED_ON !== !!wantBaked) {
    return { error: 'FACADE_BAKED_ON is ' + window.FACADE_BAKED_ON
                  + ' but this pass wanted ' + !!wantBaked + ' — the flag did not take.' };
  }
  // Let the module's own fetch land before quantising, so a slow disk cannot
  // make pass B quietly fall back to electing and then be reported as a match.
  if (window.facadeBakedReady) await window.facadeBakedReady();
  const manifest = await fetch('data/manifest.json').then(r => r.json()).catch(() => null);
  const date = (manifest && (manifest.latest || manifest.date)) ||
    (manifest && Array.isArray(manifest.snapshots) && manifest.snapshots[manifest.snapshots.length - 1]);
  if (!date) return { error: 'could not resolve the snapshot date from manifest.json' };

  const buildings = await fetch(`data/snapshots/${date}/buildings.detailed.geojson`).then(r => r.json());
  const parts = await fetch(`data/snapshots/${date}/parts.detailed.geojson`).then(r => r.json());

  const merged = await window.mergeCapitolScene(buildings, parts);
  const u24 = window.applyUnion24(buildings.features);
  const stats = window.quantiseFacades(buildings.features);

  return {
    date,
    stats,
    total: buildings.features.length,
    source: window.facadePaletteSource ? window.facadePaletteSource() : 'unknown',
    // Reported by the real functions, so the Python assembly counts are checked
    // against the browser's own claim rather than against a re-count.
    assembly: { patched: merged && merged.patched, capitol: merged && merged.added,
                union24: u24 ? 1 : 0 },
    protectedLen: Array.isArray(window.FACADE_PROTECTED) ? window.FACADE_PROTECTED.length : 0,
    // Palette is read back off the module rather than returned by the call —
    // quantiseFacades returns only counts. NOTE the accessor is
    // `window.facadePalette`, not `__facadePalette`: the first draft of this
    // file guessed the name and would have silently captured `null`, which the
    // comparator would have read as "the browser has no palette" instead of as
    // "this script asked the wrong question".
    palette: (typeof window.facadePalette === 'function') ? window.facadePalette() : null,
    rows: buildings.features.map((f, i) => {
      const p = f.properties || {};
      return { i, id: p.id != null ? String(p.id) : null,
               wd: p.wd || null, wg: p.wg || null, wn: p.wn || null,
               bc: p.building_class || null, fh: p.final_height == null ? null : p.final_height,
               wp: p.wp || null, wf: p.wf || null };
    }),
  };
  }, wantBaked);
  await page.close();
  return r;
}

let fail = 0;
const say = m => { console.log(m); if (m.startsWith('*FAIL')) fail = 1; };

// ── PASS A — the browser elects, and the Python side is held to this ────────
const A = await capture(false);
if (A.error) {
  say('*FAIL — pass A: ' + A.error);
} else {
  const stamped = A.rows.filter(r => r.wp).length;
  const buckets = new Set(A.rows.filter(r => r.wp).map(r => r.wp.slice(2)));
  console.log(`snapshot ${A.date}`);
  console.log(`assembled ${A.total} buildings, browser stamped ${stamped}`);
  console.log(`quantiseFacades reported ${JSON.stringify(A.stats)}`);
  console.log(`assembly ${JSON.stringify(A.assembly)}`);
  console.log(`palette source: ${A.source}`);
  console.log(`FACADE_PROTECTED carries ${A.protectedLen} entries (the page's own load + this one)`);
  console.log(`palette entries captured: ${A.palette ? A.palette.length : 'NONE'}`);
  console.log(`distinct bucket ordinals in use: ${buckets.size}`);
  const file = path.join(OUT_DIR, 'facade-browser.json');
  fs.writeFileSync(file, JSON.stringify(A));
  console.log('\nwrote ' + file + '  (' + (fs.statSync(file).size / 1024).toFixed(0) + ' KB)');
  if (stamped === 0) say('*FAIL — the browser stamped nothing');
  if (!A.palette || !A.palette.length) {
    say('*FAIL — no palette captured; window.facadePalette is missing or empty');
  }

  // ── PASS B — the baked palette armed, diffed against pass A ──────────────
  //
  // The Python comparison proves the PORT. This proves the SWITCH, which is a
  // different claim and the one the site actually runs: that a page which takes
  // its fourteen buckets from data/facade_palette.json paints exactly the city
  // a page that elects them does. It has to be a second page load rather than a
  // second call on this one, because the adoption is decided at script-parse
  // time from the URL.
  console.log('\n── pass B: the baked palette, armed ──');
  const B = await capture(true);
  if (B.error) {
    say('*FAIL — pass B: ' + B.error);
  } else {
    console.log(`palette source: ${B.source}`);
    console.log(`quantiseFacades reported ${JSON.stringify(B.stats)}`);
    if (!/^baked /.test(B.source)) {
      // The whole point. Both guards fall back to electing, and a fallback
      // produces an identical diff — so without this check pass B passes
      // loudest exactly when the baked palette was never used.
      say('*FAIL — pass B did not adopt the bake (' + B.source
          + '); the diff below would be the elected path against itself');
    }
    if (B.total !== A.total) {
      say(`*FAIL — feature count moved between passes: ${A.total} vs ${B.total}`);
    } else {
      let wpBad = 0, wfBad = 0, first = null;
      for (let i = 0; i < A.rows.length; i++) {
        if (A.rows[i].wp !== B.rows[i].wp) { wpBad++; first = first || [i, A.rows[i].wp, B.rows[i].wp]; }
        if (A.rows[i].wf !== B.rows[i].wf) wfBad++;
      }
      let palBad = 0;
      const ap = A.palette || [], bp = B.palette || [];
      if (ap.length !== bp.length) palBad++;
      for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
        for (const k of ['wd', 'wg', 'wn']) if (ap[i][k] !== bp[i][k]) palBad++;
      }
      console.log(`wp identical      ${A.rows.length - wpBad} / ${A.rows.length}`);
      console.log(`wf identical      ${A.rows.length - wfBad} / ${A.rows.length}`);
      console.log(`palette entries   ${palBad ? palBad + ' DIFFER' : 'all ' + ap.length + ' identical'}`);
      if (wpBad || wfBad || palBad) {
        say(`*FAIL — elected and baked disagree (first: #${first && first[0]} `
            + `${first && first[1]} vs ${first && first[2]})`);
      }
    }
  }
}

console.log('');
if (fail) {
  process.exitCode = 1;
} else {
  console.log('PASS — the baked palette paints the same city the election does.');
  console.log('now run:  python scripts/verify/facade_parity.py');
}

await browser.__done();
