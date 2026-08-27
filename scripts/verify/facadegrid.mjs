/**
 * facadegrid.mjs — does the wall the app ACTUALLY PAINTS carry the window grid
 * the photograph says the building has?
 *
 * WHY THIS EXISTS AND WHY IT IS PIXELS. `js/facades.js` used to choose one of
 * seven grids by height class, so every 4-to-7 storey campus hall got the
 * identical `mh` 8-rows-by-5-columns tile. `data/facade_grids.json` now carries
 * a per-building measurement for sixteen of them. A config table asserting
 * against a config table proves nothing — the house playbook's step 2 is to
 * build the render -> pixel-sample -> assert harness FIRST, so this reads the
 * RGBA bytes of the atlas image MapLibre is actually sampling and counts the
 * windows in it.
 *
 * ── THE ONE THING THAT MAKES THIS NON-OBVIOUS ──────────────────────────
 *
 * `rows` in the tile IS NOT the building's storey count, and a checker that
 * compared the two would be wrong in exactly the way the thing it checks is
 * supposed to fix. The pattern is SCREEN-locked (js/facades.js's header spends
 * four hundred words on this): one 64 px repeat covers a fixed number of METRES
 * of wall, `TIER_CSS * 67551 / 2^REF_ZOOM`, about 33 m. So a tile with 8 rows
 * puts a window row every 4.1 m, and how many of them land on a wall depends on
 * the WALL:
 *
 *     rows on this building  =  tile rows  x  height_m / REPEAT_M
 *
 * That right-hand side is the number comparable to a photograph, and it is what
 * this script asserts. Battle Hall's measured tile has THREE rows, and three
 * rows over its 21.5 m wall is 2.0 — which is how many storeys Battle Hall has.
 *
 * ── SAMPLING OUR OWN OUTPUT, NOT SOMETHING THAT LOOKS LIKE IT ──────────
 *
 * A whole session in this repo was once spent "fixing" the basemap's grey
 * buildings while our own layer had silently failed to load. Three guards here,
 * and all three are assertions, not comments:
 *   1. the id sampled is read off the FEATURE (`wp`, as stamped by
 *      quantiseFacades) — not constructed by this script;
 *   2. a measured building's id must start with `k`, the namespace
 *      registerMeasuredGrids hands out, so a registry that silently failed to
 *      load fails here instead of quietly scoring the templates;
 *   3. the measured tile's bytes must DIFFER from its own template family's
 *      tile at the same colour bucket. Identical bytes mean nothing was
 *      applied, however green the counts look.
 *
 * ── WATCHED FAILING ───────────────────────────────────────────────────
 *
 *   node facadegrid.mjs --break
 *
 * hands registerMeasuredGrids an empty document inside the page (no file on
 * disk changes), which puts all sixteen back on their templates. It must come
 * back red. Four guards in this repo have shipped unable to fail; this one was
 * watched.
 *
 * Usage:
 *   node facadegrid.mjs            # 5 assertions x 16 buildings
 *   node facadegrid.mjs --report   # print the table, never fail
 *   node facadegrid.mjs --break    # sabotage in-page; must fail
 *
 * Exit: 0 pass, 1 an assertion failed, 2 could not run.
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const REPORT = process.argv.includes('--report');
const BREAK = process.argv.includes('--break');

// How far the rendered row/column count may sit from the photographed count.
//
// DERIVED, not chosen. The tile's row count is an INTEGER and the rendered
// count is `rows * height / REPEAT_M`, so the finest the tile can be steered is
// one row, and the best any integer choice can do is HALF a row — which on the
// wall is `0.5 * height / REPEAT_M`. On Battle Hall's 21.5 m that is 0.33 of a
// storey; on the Tower's 94 m it is 1.43, and holding a 27-storey shaft to
// ±0.5 would be demanding a precision the representation does not have. The
// floor keeps a very short building from being held to a hundredth of a storey.
const rowTol = heightM => Math.max(0.5, 0.5 * heightM / 32.98);
const COL_TOL = 0.6;
// Opening aspect, measured in the tile's own pixels against the aspect measured
// off the photograph. Wide, and deliberately: a 3x5 opening is an aspect of
// 1.67 whatever you wanted, because the tile has no sub-pixel. The claim being
// checked is "portrait, roughly this portrait", not a second decimal place.
const ASPECT_TOL = 0.45;   // relative
// How much of the peak DFT bin's magnitude a SUBHARMONIC has to carry before it
// is preferred over it (see bestCount). Calibrated, not guessed: the counter is
// self-checked against the five published template grids on every run, and this
// is a value that reproduces all five.
const ACCEPT = 0.75;

let fails = 0;
const ok = (cond, label, detail) => {
  if (cond) { if (!REPORT) console.log(`  ok   ${label}`); return true; }
  fails++;
  console.log(`  FAIL ${label}${detail ? '  — ' + detail : ''}`);
  return false;
};

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  page.on('console', m => { if (/^\[facades\]/.test(m.text())) console.log('  page:', m.text()); });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 120000 });
  // Correctness measure, not a speed one: the auto-detect probe swaps the
  // graphics preset mid-flight and would repaint the atlas underneath us.
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded()
    && typeof window.facadeMeasured !== 'undefined', null, { timeout: 120000 });

  if (BREAK) {
    // Sabotage IN THE PAGE only. Put every measured building back on its
    // template, re-stamp, and re-register the images, exactly as a lane that
    // deleted data/facade_grids.json would get.
    await page.evaluate(async () => {
      window.registerMeasuredGrids({ buildings: [] });
      const src = window.__map.getSource('austin-buildings');
      const d = await src.getData();
      window.quantiseFacades(d.features);
      src.setData(d);
      await new Promise(r => window.__map.once('idle', r));
    });
    console.log('  --break: measured registry emptied in-page; every assertion below must go red\n');
  }

  const R = await page.evaluate(async ({ ACCEPT }) => {
    const map = window.__map;
    const doc = await fetch('data/facade_grids.json').then(r => r.json());
    const REPEAT_M = window.facadeRepeatM();
    // `getData()`, not `_data`: MapLibre v5's GeoJSONSource keeps the raw
    // option object in `_data`, not the parsed collection, and reading the
    // private field silently yields something with no `features` at all.
    const feats = (await map.getSource('austin-buildings').getData()).features;
    const byId = new Map();
    for (const f of feats) if (f.properties && f.properties.id) byId.set(f.properties.id, f.properties);

    /**
     * Count opening rows and columns in one registered atlas image.
     *
     * ── WHY THIS IS A PERIOD DETECTOR AND NOT A RUN COUNTER ─────────────
     *
     * The first cut of this function thresholded midway between the tile's own
     * wall level and its own glass level and counted dark RUNS. It under-read
     * five of the sixteen -- Sutton at 3 rows when the tile plainly has 8 --
     * and `facadetile.mjs`'s labelled sheet is what settled which side was
     * wrong: the TILE was right and the COUNTER was wrong, for two reasons
     * that are both structural rather than tunable.
     *   1. drawTile paints a HEAD SHADOW one pixel above every opening at
     *      mix(wall, black, 0.30) and a SILL below it. Midway between wall and
     *      glass lands almost exactly on the head shadow, so consecutive rows
     *      fuse into one run.
     *   2. The near tier carries `soften: 0.75`, a real box blur, precisely so
     *      the pattern does not alias under minification. A 3 px opening in a
     *      6 px cell has no clean edge left to find.
     * Both of those attack EDGES. Neither of them moves the PERIOD, which is
     * what rows and columns actually are: the grid is exactly periodic at
     * TILE/rows and TILE/cols by construction. So take the mean profile along
     * each axis and find the lag that maximises circular autocorrelation.
     *
     * SELF-CHECKED, not trusted: the caller runs this over the five TEMPLATE
     * families, whose rows and cols are written in js/facades.js, and stops if
     * it cannot reproduce them. A counter that cannot count a known grid is
     * not evidence about an unknown one.
     */
    function countGrid(img) {
      const { width: W, height: H, data } = img.data;
      const L = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        L[i] = 0.30 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
      }
      // Mean profile along each axis. Mean, not percentile: autocorrelation
      // wants the signal, and a percentile throws away the amplitude that
      // carries it.
      const prof = (n, m, at) => {
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < m; j++) s += at(i, j); a[i] = s / m; }
        const mean = a.reduce((x, y) => x + y, 0) / n;
        for (let i = 0; i < n; i++) a[i] -= mean;
        return a;
      };
      /** The count that best explains this profile: the fundamental, by DFT.
       *
       *  TWO WRONG ANSWERS CAME BEFORE THIS ONE, both caught by the
       *  self-check below rather than by reasoning, and both worth writing
       *  down because they are the two classic ways to mis-detect a period.
       *
       *  1. AUTOCORRELATION ARGMAX. A signal with period p correlates just as
       *     strongly at 2p, 3p and every other multiple, so "the lag with the
       *     highest correlation" is free to answer 32 for a tile whose period
       *     is 6.4. It returned TWO ROWS for tiles that plainly have ten.
       *  2. "TAKE THE SHORTEST PERIOD THAT STILL SCORES WELL." Correct in
       *     principle and unusable in practice: a threshold loose enough to
       *     admit tg's 1.4 px spandrel also admits noise at lag 4, so tr came
       *     back as SIXTEEN rows and tg as two. There is no single threshold
       *     that fits both ends.
       *
       *  The DFT does not have the problem at all. A comb of period n/k has
       *  energy ONLY at k and its harmonics, and for any duty cycle a square
       *  comb's fundamental is its largest term, so the peak bin IS the count.
       *  The near tier's blur only helps — it attenuates the harmonics and
       *  leaves the fundamental. A 64-point DFT over 15 bins is 960 terms per
       *  axis; the loop is not worth optimising.
       *
       *  The subharmonic guard is still there for the one case the DFT can get
       *  wrong: a facade whose openings alternate slightly (a wide bay next to
       *  a narrow one) puts real energy at k/2. If a half or a third of the
       *  peak bin carries a comparable share, the SMALLER count is the honest
       *  reading of the wall. */
      const bestCount = (a, maxCount) => {
        const n = a.length;
        const mag = new Map();
        for (let k = 2; k <= maxCount; k++) {
          if (n / k < 3) continue;              // below the 3 px cell floor
          let re = 0, im = 0;
          for (let i = 0; i < n; i++) {
            const th = -2 * Math.PI * k * i / n;
            re += a[i] * Math.cos(th); im += a[i] * Math.sin(th);
          }
          mag.set(k, Math.hypot(re, im) / n);
        }
        if (!mag.size) return 1;
        let peak = 0, peakMag = -1;
        for (const [k, m] of mag) if (m > peakMag) { peakMag = m; peak = k; }
        for (const d of [2, 3]) {
          const sub = peak / d;
          if (Number.isInteger(sub) && mag.has(sub) && mag.get(sub) >= peakMag * ACCEPT) return sub;
        }
        return peak;
      };
      /** Bin magnitudes 1..maxK, so a caller can ask about a specific count. */
      const spectrum = (a, maxK) => {
        const n = a.length, out = {};
        for (let k = 1; k <= maxK; k++) {
          let re = 0, im = 0;
          for (let i = 0; i < n; i++) {
            const th = -2 * Math.PI * k * i / n;
            re += a[i] * Math.cos(th); im += a[i] * Math.sin(th);
          }
          out[k] = Math.hypot(re, im) / n;
        }
        return out;
      };
      const colProf = prof(W, H, (x, y) => L[y * W + x]);
      const rowProf = prof(H, W, (y, x) => L[y * W + x]);
      const cols = bestCount(colProf, 16);
      const rows = bestCount(rowProf, 16);

      // Opening size, measured INSIDE one cell at a threshold close to glass so
      // the head shadow and the sill are excluded by construction rather than
      // by luck: 30% of the way from the tile's glass level up to its wall
      // level, both read off this image.
      const sorted = Float32Array.from(L).sort();
      const pct = q => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
      const wallL = pct(0.90), glassL = pct(0.02);
      const thr = glassL + 0.30 * (wallL - glassL);
      const span = (n, m, at) => {
        // Longest run below the threshold anywhere on the axis, taken through
        // the darkest line of the other axis so a blurred edge does not shrink
        // it. One opening, not a total.
        let bestLine = 0, bestDark = Infinity;
        for (let j = 0; j < m; j++) {
          let s = 0; for (let i = 0; i < n; i++) s += at(i, j);
          if (s < bestDark) { bestDark = s; bestLine = j; }
        }
        let run = 0, cur = 0;
        for (let i = 0; i < n * 2; i++) {
          if (at(i % n, bestLine) < thr) { cur++; run = Math.max(run, cur); } else cur = 0;
        }
        return Math.min(run, n);
      };
      return {
        cols, rows,
        w: span(W, H, (x, y) => L[y * W + x]),
        h: span(H, W, (y, x) => L[y * W + x]),
        wallL: +wallL.toFixed(1), glassL: +glassL.toFixed(1),
        // Handed back so the self-check can ask a question the counter cannot
        // answer for itself: is the period even IN this tile? See legibility().
        rowSpec: spectrum(rowProf, 16), colSpec: spectrum(colProf, 16),
      };
    }

    const bytesOf = img => {
      const d = img.data.data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0;
      return s;
    };

    // ── SELF-CHECK, and the surprise it turned up ───────────────────────
    //
    // The five template families' rows and cols are written in js/facades.js's
    // GRIDS table, and every campus building not in facade_grids.json wears
    // one. So: find a registered image for each family, count it, compare.
    // A counter that cannot reproduce a published grid is not evidence about a
    // measured one either — this repo has shipped four guards that could not
    // fail, and a fifth would be worse than none.
    //
    // BUT THE CHECK HAS TO ASK A SECOND QUESTION FIRST, because two of the
    // five failed it and the counter was not at fault. `tr` (9x5, residential
    // towers) and `tg` (10x7, curtain wall) draw NO WINDOW ROWS AT ALL in the
    // near tier — magnified they are pure vertical striping, and the DFT
    // agrees: on the buckets in this scene, tr's bin 9 carries 0.021 against a
    // 0.272 peak elsewhere and tg's bin 10 carries 0.052 against 0.879. Their
    // openings are 4-5 px tall in a 6.4-7.1 px cell, so the 1-3 px of wall left
    // between rows is swallowed by the head shadow above and the sill below,
    // and then by the near tier's 0.75 px soften. The rows are in the config
    // and not in the pixels.
    //
    // That is a finding about the TILE, not about this script, so:
    //   * LEGIBILITY is measured first — the share of the profile's peak
    //     magnitude that sits in the family's own nominal bin;
    //   * a family whose tile carries its period is a HARD assertion;
    //   * a family whose tile does not is REPORTED, with its number, and the
    //     counter is not convicted for failing to find something absent;
    //   * and the run still refuses to score if fewer than three families are
    //     testable, so this cannot quietly decay into no self-check at all.
    const LEGIBLE = 0.35;
    const selfChecks = [];
    const registered = [];
    for (const f of feats) {
      const wp = f.properties && f.properties.wp;
      if (wp && registered.indexOf(wp) === -1) registered.push(wp);
    }
    for (const fam of ['lo', 'mr', 'mh', 'tr', 'tg']) {
      const id = registered.find(w => w.slice(0, 2) === fam);
      if (!id) { selfChecks.push({ fam, skipped: 'no building in the scene wears this family' }); continue; }
      const img = map.getImage(id);
      if (!img) { selfChecks.push({ fam, skipped: 'family in use but no atlas image' }); continue; }
      const g = countGrid(img);
      const want = window.facadeGridFor(fam);
      const share = spec => {
        const peak = Math.max(...Object.values(spec));
        return peak > 0 ? (spec[want.rows] || 0) / peak : 0;
      };
      const rowLeg = (() => { const p = Math.max(...Object.values(g.rowSpec)); return p > 0 ? (g.rowSpec[want.rows] || 0) / p : 0; })();
      const colLeg = (() => { const p = Math.max(...Object.values(g.colSpec)); return p > 0 ? (g.colSpec[want.cols] || 0) / p : 0; })();
      const legible = rowLeg >= LEGIBLE && colLeg >= LEGIBLE;
      selfChecks.push({
        fam, id, want: want.rows + 'x' + want.cols, got: g.rows + 'x' + g.cols,
        rowLeg: +rowLeg.toFixed(3), colLeg: +colLeg.toFixed(3), legible,
        ok: g.rows === want.rows && g.cols === want.cols,
      });
    }

    const rows = [];
    for (const m of doc.buildings) {
      const props = byId.get(m.id);
      if (!props) { rows.push({ ref: m.ref, missing: 'no feature with this id in the running snapshot' }); continue; }
      const wp = props.wp;                       // read off the FEATURE, not built here
      const img = map.getImage && map.getImage(wp);
      if (!img) { rows.push({ ref: m.ref, wp, missing: 'no atlas image registered for this wp' }); continue; }
      const g = countGrid(img);
      // The same colour bucket on the TEMPLATE family this measurement was
      // taken against — the "am I looking at my own output" control.
      const twin = m.base + wp.slice(-2);
      const timg = map.getImage && map.getImage(twin);
      rows.push({
        ref: m.ref, name: m.name, wp, base: m.base, twin,
        heightM: props.final_height,
        storeys: m.storeys, aspect: m.aspect,
        bays: m.bays, bayWallM: m.bay_wall_m,
        px: g,
        differsFromTemplate: timg ? bytesOf(img) !== bytesOf(timg) : null,
        renderRows: g.rows * props.final_height / REPEAT_M,
        renderCols: m.bay_wall_m ? g.cols * m.bay_wall_m / REPEAT_M : null,
      });
    }
    return { REPEAT_M, rows, selfChecks, clamp: window.facadeGridClamp(),
             measuredCount: window.facadeMeasuredCount() };
  }, { ACCEPT });

  console.log('\n  SELF-CHECK — the pixel counter against the five published template grids');
  let selfBad = 0, testable = 0;
  const illegible = [];
  for (const c of R.selfChecks) {
    if (c.skipped) { console.log(`    ${c.fam}  skipped: ${c.skipped}`); continue; }
    if (!c.legible) {
      illegible.push(c);
      console.log(`    ${c.fam}  ${c.id}  source says ${c.want} — THE TILE DOES NOT CARRY IT: `
        + `row bin ${(c.rowLeg * 100).toFixed(0)}% of peak, col bin ${(c.colLeg * 100).toFixed(0)}% `
        + `(counter read ${c.got}; not scored)`);
      continue;
    }
    testable++;
    if (!c.ok) selfBad++;
    console.log(`    ${c.fam}  ${c.id}  source says ${c.want}, pixels say ${c.got}  ${c.ok ? 'ok' : 'MISMATCH'}`);
  }
  if (illegible.length) {
    console.log(`\n    ^ ${illegible.map(c => c.fam).join(' and ')}: a REAL DEFECT in the existing city, not a`);
    console.log('      counter failure — those tiles are vertical striping with no floor rhythm at');
    console.log('      all in the near tier. Out of scope for the campus grids; written up in');
    console.log('      docs/facade-grids.md so it is not rediscovered.');
  }
  if (testable < 3) {
    console.log(`\n  only ${testable} template grid(s) were testable. This self-check has decayed`);
    console.log('  to the point of proving nothing. Refusing to score.');
    process.exit(2);
  }
  if (selfBad) {
    console.log(`\n  ${selfBad} legible template grid(s) this counter cannot reproduce, so it is not`);
    console.log('  evidence about the measured grids either. Refusing to score.');
    process.exit(2);
  }

  console.log(`\n  one pattern repeat = ${R.REPEAT_M.toFixed(2)} m of wall (TIER_CSS 32 at REF_ZOOM 16)`);
  console.log(`  registry holds ${R.measuredCount} measured buildings\n`);
  console.log('  ref  building                     wp    tile   opening  rendered on the wall   photo   ');
  console.log('  ' + '-'.repeat(104));
  for (const r of R.rows) {
    if (r.missing) { console.log(`  ${r.ref.padEnd(4)} ${'—'.padEnd(28)} ${r.missing}`); continue; }
    const rc = r.renderCols == null ? '' : ` ${r.renderCols.toFixed(1)}c`;
    const pc = r.bays == null ? '' : ` ${r.bays}c`;
    console.log(`  ${r.ref.padEnd(4)} ${String(r.name).slice(0, 28).padEnd(28)} ${r.wp.padEnd(5)} `
      + `${(r.px.rows + 'x' + r.px.cols).padEnd(6)} ${(r.px.w + 'x' + r.px.h).padEnd(8)} `
      + `${(r.renderRows.toFixed(1) + 'r' + rc).padEnd(22)} ${(r.storeys + 'r' + pc)}`);
  }

  const heightLimited = [];
  console.log('\n  ASSERTIONS');
  for (const r of R.rows) {
    const tag = r.ref.padEnd(4);
    if (r.missing) { ok(false, `${tag} has a registered pattern image`, r.missing); continue; }
    ok(/^k/.test(r.wp), `${tag} wears a measured family, not a template`, `wp=${r.wp}`);
    ok(r.differsFromTemplate !== false, `${tag} tile bytes differ from its template's`, 'identical bytes — nothing was applied');
    const tol = rowTol(r.heightM);
    if (Math.abs(r.renderRows - r.storeys) > tol && r.px.rows >= R.clamp.maxRows) {
      // HEIGHT-LIMITED, not grid-wrong, and the distinction is the whole point
      // of separating the measurement from the conversion. The tile is already
      // at the aliasing ceiling (`maxRows`) and STILL cannot show this many
      // storeys, because the wall it is painted on is too short. That is the
      // height bake's defect showing through, and asserting it as a facade
      // failure would put a permanent red on the wrong subsystem — which this
      // directory's README is explicit about: a guard that is always red is a
      // guard nobody reads. So the assertion becomes the one that IS this
      // file's to make: that the building genuinely asks for more rows than the
      // tile can carry. If it does not, it is a grid error after all and this
      // goes red.
      const asks = r.storeys * R.REPEAT_M / r.heightM;
      const needsM = r.heightM * r.storeys / r.renderRows;
      heightLimited.push({ ...r, asks, needsM });
      ok(asks > R.clamp.maxRows,
        `${tag} is height-limited, not grid-wrong`,
        `asks for ${asks.toFixed(1)} rows against a ceiling of ${R.clamp.maxRows} — it is UNDER the ceiling, so this is a grid error`);
    } else {
      ok(Math.abs(r.renderRows - r.storeys) <= tol,
        `${tag} draws ${r.storeys} window rows on its wall`,
        `draws ${r.renderRows.toFixed(2)}, photograph says ${r.storeys} (tolerance ${tol.toFixed(2)})`);
    }
    if (r.bays != null) {
      ok(Math.abs(r.renderCols - r.bays) <= COL_TOL,
        `${tag} draws ${r.bays} bays across its wall`,
        `draws ${r.renderCols.toFixed(2)}, photograph says ${r.bays}`);
    }
    const seen = r.px.w > 0 ? r.px.h / r.px.w : 0;
    ok(Math.abs(seen - r.aspect) / r.aspect <= ASPECT_TOL,
      `${tag} openings are ${r.aspect}:1 tall`,
      `tile draws ${seen.toFixed(2)}:1 (${r.px.w}x${r.px.h} px)`);
  }

  if (heightLimited.length) {
    console.log('\n  HEIGHT-LIMITED — the tile is at its aliasing ceiling and the wall is STILL too');
    console.log('  short. These belong to the height bake, not to the facade grid. The last column');
    console.log('  is the extrusion height that would let the measured storey count land.');
    for (const r of heightLimited) {
      console.log(`    ${r.ref.padEnd(4)} ${String(r.name).slice(0, 26).padEnd(26)} `
        + `${r.storeys} storeys on ${r.heightM} m — asks ${r.asks.toFixed(1)} rows, ceiling ${R.clamp.maxRows}`
        + `   needs ~${r.needsM.toFixed(1)} m`);
    }
  }

  if (REPORT) { console.log('\n  --report: not failing on assertions'); }
  else if (BREAK) {
    console.log(`\n  --break produced ${fails} failures.`);
    if (fails === 0) { console.log('  THE GUARD CANNOT FAIL. That is the bug.'); process.exit(1); }
    process.exit(0);
  } else {
    console.log(`\n  ${fails} failing assertions`);
    process.exit(fails ? 1 : 0);
  }
} finally {
  browser.__done();
}
