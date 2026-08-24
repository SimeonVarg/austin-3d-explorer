/**
 * barcoords.mjs — the bar has two layers. Are they drawn in the same
 * coordinate system?
 *
 * WHAT THIS IS TESTING, AND WHY IT WAS NEVER TESTED. Six rounds have asked
 * whether the bar's COLOURS are true: does an amber run have a lamp on it
 * (§18, §33, §44), does a violet tick stand where nobody mapped a lamp (§42).
 * Every one of those questions is about a mark's colour. Nobody has asked the
 * question underneath all of them — **is the mark in the right PLACE** — and
 * the answer is arithmetic, not opinion, so it can be measured without a
 * camera.
 *
 * `litStrip` draws the runs as flex children with a floor:
 *
 *     fracs = runs.map(r => max(litStripMinFrac, r.m / totalM))
 *     sum   = Σ fracs                       // > 1 as soon as ANY run is floored
 *     flex  = fracs[i] / sum                // every run squeezed by 1/sum
 *
 * ...and then draws the ticks at `left: 100 * at / totalM`, the TRUE fraction,
 * un-squeezed. The runs live in a renormalised space and the ticks live in the
 * metric one. On any route where a single run is short enough to hit the floor
 * the two disagree, the disagreement accumulates left to right, and a tick can
 * end up drawn on a run it does not lie on — the picture saying somebody
 * reported darkness on a stretch this feature is calling lit.
 *
 * WHICH SPACE IS RIGHT. The runs', not the ticks'. The floor exists because a
 * run dropped for being small is "a lamp the picture denies and the count
 * claims" (litStrip's own comment), and it has already made the bar's x-axis
 * non-metric. Given that, the only meaning the bar can carry is structural:
 * this stretch is lit, that one is not, and the report happened INSIDE that
 * one. A tick that leaves its own run breaks the only claim the picture makes.
 *
 * MEASURED OFF THE RENDERED DOM, NOT THE FORMULA. `getBoundingClientRect` on
 * every segment and every tick, so flex's own sub-pixel rounding is inside the
 * number rather than assumed away. The formula is computed too and printed
 * beside it; if they ever disagree the DOM wins and this comment is wrong.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/barcoords.mjs [N]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const WANT = Number(process.argv[2] || 90);
const TAG = process.env.BARCOORDS_TAG || 'before';
// Both widths, because §37's finding was that the block had only ever been
// measured on a laptop and this app is judged off a phone recording. The
// squeeze is a fraction, so it costs FEWER pixels on a narrow bar — which is
// the opposite of the usual "it is worse on a phone" and worth having on the
// record either way.
const WIDTHS = [[390, 844, 'iphone'], [1280, 900, 'desktop']];

const CODES = Object.keys(JSON.parse(fs.readFileSync('data/walk_graph.json', 'utf8')).code);
let seed = 4471;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const browser = await launch(chromium, { maxMs: 900000 });
const all = [];
const errs = [];

for (const [W, H, dev] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => errs.push(dev + ': ' + e.message));
  await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });

  seed = 4471;
  const rows = [];
  const tried = new Set();
  for (let attempt = 0; attempt < WANT * 10 && rows.length < WANT; attempt++) {
    const a = CODES[Math.floor(rnd() * CODES.length)], b = CODES[Math.floor(rnd() * CODES.length)];
    if (a === b || tried.has(a + '>' + b)) continue;
    tried.add(a + '>' + b);
    const r = await page.evaluate(async ([f, t]) => {
      const res = await window.wayfindRoute(f, t, { expand: true });
      if (!res || !res.ok) return null;
      const lit = await window.wayfindLit();
      if (!lit.ok) return null;
      // Re-route once: the lamp index is fetched on the first route of the
      // session, so the FIRST card in a run is drawn without a strip at all.
      await window.wayfindRoute(f, t, { expand: true });
      const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
      if (!card) return null;
      const track = card.querySelector('[role="img"]');
      if (!track) return null;
      const tb = track.getBoundingClientRect();
      const segs = [], ticks = [];
      for (const kid of Array.from(track.children)) {
        const k = kid.getBoundingClientRect();
        const bg = getComputedStyle(kid).backgroundColor;
        if (getComputedStyle(kid).position === 'absolute') ticks.push({ cx: k.left + k.width / 2 - tb.left, w: k.width, bg });
        else segs.push({ x: k.left - tb.left, w: k.width, bg });
      }
      return {
        totalM: lit.totalM, barW: tb.width,
        runs: lit.runsAt.map(x => ({ lit: x.lit, m: x.m })),
        reportedAtM: lit.reportedAtM || [], inDarkArea: lit.inDarkArea,
        segs, ticks,
        minFrac: window.WAYFIND.litStripMinFrac,
      };
    }, [a, b]);
    if (r && r.segs.length) rows.push({ from: a, to: b, dev, ...r });
  }

  // ── the arithmetic, per route ──────────────────────────────────────────
  for (const r of rows) {
    const total = r.runs.reduce((s, x) => s + x.m, 0) || r.totalM;
    const fracs = r.runs.map(x => Math.max(r.minFrac, x.m / total));
    r.sum = fracs.reduce((s, x) => s + x, 0);
    r.floored = r.runs.filter((x, i) => x.m / total < r.minFrac).length;
    // True (metric) and drawn (renormalised) left edges of every run, as a
    // fraction of the bar.
    let tm = 0, td = 0;
    r.edges = r.runs.map((x, i) => {
      const e = { trueL: tm / total, trueR: (tm + x.m) / total, drawnL: td / r.sum, drawnR: (td + fracs[i]) / r.sum, lit: x.lit };
      tm += x.m; td += fracs[i];
      return e;
    });
    // Every tick: where the DOM put it, where its own run is, and whether it
    // left that run.
    r.tickRows = [];
    const at = r.reportedAtM.slice().sort((p, q) => p - q);
    const domTicks = r.ticks.slice().sort((p, q) => p.cx - q.cx);
    for (let i = 0; i < at.length && i < domTicks.length; i++) {
      const f = Math.min(1, Math.max(0, at[i] / total));
      // The run this report actually lies on.
      let idx = r.edges.findIndex(e => f >= e.trueL && f <= e.trueR);
      if (idx < 0) idx = f <= 0 ? 0 : r.edges.length - 1;
      const e = r.edges[idx];
      const within = e.trueR > e.trueL ? (f - e.trueL) / (e.trueR - e.trueL) : 0.5;
      const wantF = e.drawnL + within * (e.drawnR - e.drawnL);   // where it belongs
      const gotPx = domTicks[i].cx;
      const wantPx = wantF * r.barW;
      // ...and which run the drawn tick actually landed in.
      const gotF = gotPx / r.barW;
      let landed = r.edges.findIndex(e2 => gotF >= e2.drawnL && gotF <= e2.drawnR);
      if (landed < 0) landed = gotF <= 0 ? 0 : r.edges.length - 1;
      r.tickRows.push({
        atM: at[i], run: idx, runLit: !!e.lit, landedLit: !!r.edges[landed].lit,
        gotPx: +gotPx.toFixed(2), wantPx: +wantPx.toFixed(2), errPx: +(gotPx - wantPx).toFixed(2),
        wrongRun: landed !== idx, wrongColour: !!e.lit !== !!r.edges[landed].lit,
      });
    }
    all.push(r);
  }
  await page.close();
}

// ── the report ────────────────────────────────────────────────────────────
const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`\nBAR COORDINATES — ${TAG}\n`);
for (const [W, , dev] of WIDTHS) {
  const rows = all.filter(r => r.dev === dev);
  const withTicks = rows.filter(r => r.tickRows.length);
  const errsPx = withTicks.flatMap(r => r.tickRows.map(t => Math.abs(t.errPx)));
  const wrongRun = withTicks.flatMap(r => r.tickRows).filter(t => t.wrongRun);
  const wrongCol = withTicks.flatMap(r => r.tickRows).filter(t => t.wrongColour);
  const squeezed = rows.filter(r => r.sum > 1.0005);
  console.log(`  ${dev} ${W}px — ${rows.length} routes, ${withTicks.length} carrying ticks (${withTicks.reduce((s, r) => s + r.tickRows.length, 0)} ticks)`);
  console.log(`    routes where a run hits the floor (sum > 1):  ${squeezed.length} / ${rows.length}` +
    (squeezed.length ? `   worst sum ${Math.max(...squeezed.map(r => r.sum)).toFixed(4)}` : ''));
  console.log(`    tick displacement, px:  median ${med(errsPx).toFixed(2)}   worst ${(errsPx.length ? Math.max(...errsPx) : 0).toFixed(2)}`);
  console.log(`    ticks drawn in the WRONG RUN:                 ${wrongRun.length}`);
  console.log(`    ticks drawn on the wrong COLOUR of run:       ${wrongCol.length}`);
  const worst = withTicks.flatMap(r => r.tickRows.map(t => ({ ...t, from: r.from, to: r.to }))).sort((a, b) => Math.abs(b.errPx) - Math.abs(a.errPx))[0];
  if (worst) console.log(`    worst single tick: ${worst.from}->${worst.to} at ${worst.atM} m — drawn ${worst.gotPx}px, belongs ${worst.wantPx}px` +
    (worst.wrongColour ? '   *** ON THE WRONG COLOUR ***' : worst.wrongRun ? '   ** in the wrong run **' : ''));
  console.log('');
}
fs.writeFileSync(`${OUT}/barcoords-${TAG}.json`, JSON.stringify({ tag: TAG, want: WANT, errs, routes: all }, null, 1));
if (errs.length) console.log(`page errors: ${errs.length}`);
await browser.close();
