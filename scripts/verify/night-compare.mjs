#!/usr/bin/env node
/**
 * night-compare.mjs — the night renderer's comparison harness.
 *
 * Shoots every pose in `night-routes.json` at every requested lighting regime
 * (blue hour, twilight, full night by default), for one build or for TWO builds
 * or flag sets side by side, and writes:
 *
 *   <out>/frames/<side>-<route>-<pose>-<regime>.jpg   the kept (second) screenshot
 *   <out>/sheet-<route>-<pose>.jpg     rows = regimes; columns = A | B | reference
 *   <out>/overview-<side>-<n>.jpg      rows = poses; columns = regimes (one side)
 *   <out>/regions-<route>-<pose>.jpg   with --show-regions: the named regions drawn
 *   <out>/report.json                  every setting, camera check and measurement
 *
 * ── Running it ────────────────────────────────────────────────────────────
 *
 * Serve the checkout on your own port, then run it THROUGH the machine's GPU
 * slot wrapper. Parallel hardware-GL Chromes have blue-screened the Acer, so on
 * that machine every browser-launching command is wrapped:
 *
 *   python scripts/serve.py 8661            # from the repo root
 *   node <lanes>/gpu-run.mjs --label night-compare -- \
 *     node scripts/verify/night-compare.mjs --out <scratch>/run1
 *
 * (`gpu-run.mjs` lives in the session's lanes scratch folder, not in the repo:
 * it holds one of three machine-wide browser slots and passes the exit code
 * through. On a machine without it, run the command bare, one at a time.)
 *
 *   --out <dir>            required. Frames, sheets and report go here (use a scratch
 *                          folder: a full run is ~50 MB of JPEG).
 *   --a '<query>'          side A: appended to the page URL (default '' = the build as
 *                          shipped). '&flag=1', '?flag=1' and 'flag=1' all work.
 *   --b '<query>'          side B. Omit it for a one-sided run.
 *   --a-site / --b-site    serve two different BUILDS (e.g. main on :8661 and a
 *                          branch worktree on :8662). Default VERIFY_URL, then SITE.
 *   --a-label / --b-label  column titles (default: the query, or "as shipped").
 *   --only r1,r2/pose      route ids, or route/pose ids, to shoot.
 *   --regimes blue,night   override every route's regimes (names in night-routes.json:
 *                          day golden blue twilight early night).
 *   --routes <file>        default scripts/verify/night-routes.json.
 *   --local <file|none>    an overlay of extra or replacement routes that must NOT be
 *                          committed (matched poses for the owner's photos, with their
 *                          refs). Default: <repo>/../austin-reference-images/_night/
 *                          night-routes.local.json when it exists. Loaded loudly.
 *   --refs off             no reference column (use this for sheets you will commit:
 *                          third-party and owner photographs are never committed).
 *   --viewport WxH         override the routes file's 1440x900. R10 (the phone pass) is
 *                          `--viewport 393x852 --a 'lite=1'`. Regions are FRACTIONS, so
 *                          they survive the resize — but a rectangle read off a landscape
 *                          frame does not land on the same thing in a portrait one:
 *                          re-read them with --show-regions before quoting a ratio.
 *   --tile <px>            sheet tile width (default 560).
 *   --same <pct>           ASSERT: in every frame, fewer than <pct>% of pixels differ
 *                          between A and B by more than 16 luma. For "this change does
 *                          not move day/golden" (plan A9). Exit 1 when it does not hold.
 *   --break [what]         sabotage side B in the page only, and die if the sabotage does
 *                          not hold at the first repaint and again at the end of the
 *                          shoot. With --same it must go red: that is the watched failure.
 *                            apartments  (the default, and what a bare --break means)
 *                                        slopes.remove(slopesApartments.group) — the
 *                                        authored West Campus city, and nothing else.
 *                            slopes      every child of slopes.root removed AND
 *                                        slopes.add() stubbed out so nothing can be
 *                                        re-added mid-shoot: apartments, roofs, arches,
 *                                        art, the Capitol dome, the stadium, the campus
 *                                        landscape. Use it at a pose the apartments are
 *                                        not in: a sabotage that is a NO-OP at a pose is
 *                                        a pose --same has not been shown able to fail at.
 *                          Do not sabotage with `group.visible = false` — js/slopes.js
 *                          render() rewrites that flag on every child of root every frame
 *                          (js/slopes.js:1030-1036), and the version of this flag that did
 *                          so was green every time.
 *   --merge <dir>          (with --from) fold ANOTHER run's frames into this one's report:
 *                          its frames are copied in if they are not already there, every
 *                          imported shot is tagged `mergedFrom`, its side block is carried
 *                          over with the regimes it covers, and the whole thing is recorded
 *                          under `merged[]`. A shot already present at the same (side,
 *                          pose, regime) is REPLACED and counted. This exists because the
 *                          merge was once done by hand, in an editor: the result was a
 *                          64-shot report whose top-level when/args/harnessGit described
 *                          only 48 of them and whose `sides` array had lost the other
 *                          run's build, reload count and warnings entirely, while the
 *                          docs quoted numbers out of it under the wrong build. A merge
 *                          the tool performs cannot lose that; a merge an editor performs
 *                          always can.
 *   --from <dir>           re-measure an earlier run's frames with the CURRENT regions
 *                          and rewrite its report and sheets. No app is loaded. The
 *                          shoot's settings keep the top-level names (when/args/gl/
 *                          viewport/harnessGit describe the FRAMES); this pass's own
 *                          settings — including --refs, which decides whether the sheets
 *                          it rewrites carry photographs — go under `remeasure`.
 *   --show-regions         write regions-<route>-<pose>.jpg: side A's frame with the pose's
 *                          regions drawn on a labelled 5% grid, so the next rectangle is READ
 *                          OFF the frame. Poses with no regions get one too.
 *   --gl hardware|swiftshader   default hardware (screenshots; see chrome.mjs).
 *   --selftest             the MEASURING half, watched failing. No server, no --out, no app:
 *                          it paints synthetic frames whose every answer is known from the
 *                          SPEC, pushes them through the REAL pageMeasure/pageDiff, asserts
 *                          each number exactly — and then sabotages those two functions, one
 *                          criterion at a time, and requires the assertions to go RED. Exit 0
 *                          only if the clean pass is perfect AND every sabotage was caught.
 *   --selftest-break <n>   run one sabotage and print every assertion, so a human can watch
 *                          it fail: luma warm minluma relk region diff (see selfTest below).
 *   --help                 print this block and exit 0.
 *
 * ── What each shot does ───────────────────────────────────────────────────
 *
 * Page: index.html?intro=0&drift=0&clip=1<query>, 1440x900 at DPR 1. The graphics
 * auto-detect probe is cancelled at once; the harness then waits for the real veil
 * to lift AND for window.slopesApartments.readyToReveal() with a built group — the
 * authored buildings, not the legacy fallback. If the app has switched the authored
 * buildings off for the visit (js/app.js, INTRO.authoredCeilingMs, which fires under
 * machine load), the page is RELOADED — which is js/app.js's own documented remedy —
 * up to WAIT.authoredReloads times, and only then poked back on in place; the report
 * records which happened. If they still cannot be had, the run exits 2: frames of the
 * fallback city are not frames of our city, and the usual cause is a busy machine.
 *
 * Regimes are applied once each (applyTimeOfDay(map, p, true)); every pose is then
 * shot under that regime: jumpTo, auto-exposure meter reset, wait for tiles + idle
 * + the authored buildings' sources, re-pose, settle 3 s, screenshot, 1 s,
 * screenshot again and KEEP THE SECOND. If the two disagree (more than SETTLE.maxPct
 * of pixels by more than SETTLE.luma), it waits and shoots again, up to
 * SETTLE.retries times, and records how settled the kept frame was.
 *
 * The camera is checked against what was asked (pitch, and eye altitude from
 * window.__fly.eye() for eye/target poses). A pose the camera did not reach is
 * "uninterpretable" and makes the run exit 2 (the frame is still written).
 *
 * So is a pose whose basemap tiles or authored sources had NOT all arrived
 * (`tilesOk: false`), and so is an A/B run whose two sides did not reach the same
 * state. Both were recorded per shot from the first version of this file and then
 * DROPPED: `tilesOk` never reached `verdict`, the summary or the exit code, so a run
 * whose basemap never finished loading came back complete, green and quotable. That
 * is the worst shape a defect can take here, because a missing layer makes every
 * metric look BETTER — cleaner sky, smaller diff, greener --same. Measured on this
 * laptop on 2026-09-20: a `--break` run on a loaded machine came back `FAIL --same`
 * with `verdict.uninterpretable: []` and every frame `camera ok, settled`, while the
 * UNSABOTAGED side A was the broken one (unretinted tree canopies, no lit window
 * grid, the Capitol dome missing) and the only trace anywhere in the report was
 * `tilesOk: false` on all five A shots against `tilesOk: true` on all five B shots.
 * The sabotage had nothing to do with why it went red. Now:
 *   - any shot with tilesOk false is `uninterpretable` -> exit 2;
 *   - A and B disagreeing on tilesOk at the same (pose, regime) is
 *     `verdict.loadAsymmetry` -> exit 2;
 *   - A and B reaching `ready` by different routes (a different number of reloads,
 *     or one side taking the APARTMENTS.on poke and the other not) is the same —
 *     BUT ONLY WHEN THE TWO SIDES ARE TWO BUILDS. The reload path discriminates
 *     between builds; in a run where both sides are served the same build.sha1
 *     from the same site there is no second build for it to be evidence about,
 *     and side B, shot second on a machine side A has just hammered, reloads more
 *     often for that reason alone. Both canonical watched failures in
 *     scripts/verify/README.md came back exit 2 on a loaded laptop from A 0
 *     reloads against B 2, identical build.sha1, identical triangle counts and
 *     tilesOk true on every shot. So: two builds -> `verdict.loadAsymmetry`, exit
 *     2; one build -> `verdict.loadAsymmetryWarning`, logged, no exit change.
 *     Of the ten runs kept in docs/night/harness-runs/, the one this was written
 *     for is a genuine two-build run: build-ab-c656249-vs-main-daygolden, A 2
 *     reloads + the poke against B 0 reloads, readyMs 379,315 against 93,576.
 *   - both sides served the same site and query and NOT the same build.sha1 is
 *     `verdict.loadAsymmetry` too -> exit 2. That is a rebuild landing in the
 *     served checkout between side A and side B, and it has happened: it was
 *     caught by hand, off the build printed on the overview sheet, and nothing in
 *     the verdict would have said a word.
 *
 * Each shot also records which SLOPES GROUPS were submitted at that camera
 * (shot.slopes: the `visible` groups from slopes.stats() and the triangles the last
 * frame drew for them). Read it as "the renderer had this geometry switched on
 * here", NOT as "this geometry fills the frame" — at the two Capitol poses all
 * eight groups are on and 3.56 M triangles are drawn, and removing every one of
 * them moves 0.2–0.3% of pixels. That is why verdict.breakCoverage reports the
 * measured A/B percentage per pose beside the group list: SHARE OF THE FRAME is
 * what decides whether --same can go red, and only the sabotage measures it.
 *
 * AND SHARE OF THE FRAME IS STILL NOT THE SAME QUESTION AS "did the instrument
 * notice". `pctOver` counts PIXELS; A1-A5 are written in region medians, ratios
 * and the bright-window share. At the two Capitol poses the sabotage removed
 * 3,560,273 triangles, took the dome visibly out of the frame, moved 0.172% and
 * 0.308% of the pixels — and every region code, every ratio and the window share
 * came back BIT-IDENTICAL, because the wall, ground and sky rectangles were on
 * MapLibre's own extrusions and road. Five runs went past that. So
 * verdict.breakCoverage now carries, per pose, `movedMeasured` and
 * `unmovedMeasured` — which numbers moved and which did not — and:
 *   - pixels moved past tolerance and NOT ONE measured number moved is
 *     `measuredNothingAt` -> exit 2. The rectangles are not on what was removed.
 *   - a region declared `regionSubjects: authored` in night-routes.json that does
 *     not move under `--break slopes` (which empties the WHOLE authored scene) is
 *     `authoredRegionsNotOnSubject` -> exit 2.
 *   - a region with NO declared subject that did not move is listed under
 *     `undeclaredAndUnmoved`: either it is basemap or sky, or it is the next
 *     instance of this defect. Declare it once a sabotage has told you which.
 * A ratio with a `basemap` region on either side of the division prints with a
 * `b` in the summary and the tiles: a true reading of the frame, and not a
 * reading of anything we author.
 *
 * THERE ARE NO REPS. One kept frame per (pose, regime, side), and report.json
 * holds exactly that: SETTLE.retries re-shoots a frame that is still MOVING, it
 * does not average anything. Every number out of one run is a single reading.
 * Where scripts/verify/README.md's law asks for the minimum of interleaved reps,
 * run the whole thing N times into N --out folders and take the minimum across
 * them; do not quote a spread this tool did not produce. The A/B diff inside ONE
 * run is the exception the tool is built for: both sides are shot in the same
 * browser minutes apart, which is what makes --same a tighter test than comparing
 * two separate runs.
 *
 * ── What it measures ──────────────────────────────────────────────────────
 *
 * From the kept JPEG, in the page (never as a 1.3 M-entry array over CDP), with
 * 256-bin histograms:
 *   luma  Rec.709 weights on the graded sRGB values, 0-255 (the unit of every
 *         table in docs/night-implementation-plan.md §1.4);
 *   Y     linear relative luminance (sRGB decoded), 0-1: the unit for RATIOS.
 * For the whole frame and each named region: mean and p10/p50/p90 (luma also p1,
 * p99); hot = % of pixels over luma 120 and over 200.
 * Ratios: wall/sky, ground/sky, water/sky, wall/ground, from median Y. A region
 * named anything else (dome, tower) is measured and reported but not divided.
 * Windows (MEASURE below): in the `wall` region, a pixel is a BRIGHT WINDOW when
 * its Y is at least relK x the region's median Y, its luma is at least minLuma,
 * and R >= B (warm or neutral: the night-luma.mjs split, so pale masonry
 * reflecting a blue sky is not a window). Reported as a % of the region, with the
 * mean sRGB of those pixels. `abs` is the cruder "% over luma 120 with R >= B"
 * the plan's §1.2 quotes.
 * These are pixel classes, not truth: at blue hour a sunlit warm wall can pass the
 * absolute test, and a lit wall region with no windows in it measures nothing.
 * A pose with NO wall region falls back to the whole frame, and then the number is
 * not a window count at all -- at blue hour it is mostly sky and lit pavement. That
 * sets windows.fallback and stars the number in the table. Give the pose a wall.
 * A ratio whose DENOMINATOR median is under MEASURE.minDenomCode (sRGB code 6 of
 * 255) is marked `~`, and a band is reported beside it: the ratio recomputed with
 * that denominator one 8-bit code darker and one lighter. At p = 1 the `sky`
 * median is code 3 or 4 in fourteen of the sixteen poses, so wall/sky there is a
 * quotient of two near-black codes and moves 25-50% on one code. That is why
 * `wall/sky 4.98` came back bit-identical from three different renders at two
 * different viewport sizes: the medians landed on the same code. Do not read a
 * deep-night ratio as a measurement of the scene; A3 cannot be settled at this
 * precision, and the fix is a different question, not a longer run.
 * A region under MEASURE.minRegionFrac of the frame (1%) is measured and divided as
 * usual and then FLAGGED: `frac` and `small` on the region, `smallRegions` and
 * `ratiosSmall` on the shot, and `#` on the number in the table and on the sheet. A
 * median over four thousand pixels of a gradient sky is a number, not a measurement
 * of the sky, and every ratio built on it inherits that.
 * A/B: mean |delta luma|, % of pixels over 16 and over 48, per frame.
 *
 * ── Exit codes (scripts/verify/README.md) ─────────────────────────────────
 *   0  every shot taken and interpretable (and --same held, when given)
 *   1  --same failed: A and B differ beyond tolerance in at least one frame
 *   2  cannot run or cannot interpret: bad arguments, the page never became ready,
 *      the authored buildings are missing, a pose not reached, a blank frame,
 *      tiles not all loaded at a pose, or the two sides loaded differently
 *   124 the chrome.mjs watchdog
 *
 * report.json records the exit code it earned, as `report.exit`. It did not, and
 * the only other record of it was a log.txt that nobody committed — so a kept
 * report saying "PASS, exit 0" in a table said it on the table's authority, not
 * the artifact's.
 */
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ── Parameters (every threshold in one place) ───────────────────────────────
const FOV = 58, MAX_PITCH = 88;              // the app's camera (js/controls.js)
const WAIT = {
  styleMs: 180000,       // map + style
  veilMs: 300000,        // the veil lifting
  authoredMs: 600000,    // authored buildings ready (after a re-enable, a full build)
  authoredReloads: 2,    // reloads allowed when the app abandons them (js/app.js's own remedy)
  regimeIdleMs: 30000,   // after applyTimeOfDay
  tilesMs: 45000,        // per pose: tiles + authored sources
  idleMs: 20000,         // per pose: then one 'idle'
  settleMs: 3000,        // per pose: then this long before the first screenshot
  secondShotMs: 1000,    // the second screenshot, which is the one kept
};
const SETTLE = { luma: 24, maxPct: 0.25, retries: 2, waitMs: 3000 };
const CAMERA = { pitchTol: 0.6, altTolAbs: 1.5, altTolRel: 0.05, zoomTol: 0.02 };
const MEASURE = { relK: 4, minLuma: 40, absLuma: 120, hotLuma: 120, veryHotLuma: 200, blankStd: 1.0,
  // A region smaller than this share of the frame is measured, reported and then
  // FLAGGED (`small: true`, `#` in the table). A median over a few thousand pixels
  // of a gradient sky is a number, not a measurement of the sky, and every ratio
  // built on it inherits that. 1% of 1440x900 is 12,960 px.
  minRegionFrac: 0.01,
  // A ratio is only as good as its DENOMINATOR. At p = 1 the `sky` median is
  // sRGB code 3 or 4 out of 255 in fourteen of the sixteen poses, so wall/sky is
  // a quotient of two near-black 8-bit codes and one code either way moves it by
  // 25-50%. Below this code the ratio is marked `~` and a band is reported
  // instead of a number. It is a measurement limit, not a scene property:
  // A3 (wall/sky >= 15 at deep night) cannot be settled at this precision.
  minDenomCode: 6 };
const DIFF = { luma: 16, lumaBig: 48 };
const JPEG_Q = 90, SHEET_Q = 0.82;

// ── Arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  if (v === undefined || (v.startsWith('--') && v.length > 2)) return '';   // --a with an empty value
  return v;
}
const has = name => argv.includes('--' + name);
function die(msg) { console.error('night-compare: ' + msg); process.exit(2); }

// --help prints this file's own header block. It has to come before every other
// argument check, or `--help` dies on "--out is required" (it did).
if (has('help') || argv.includes('-h')) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('/**'), src.indexOf('*/') + 2);
  console.log(block.replace(/^\/\*\*?/, '').replace(/\s*\*\/$/, '').replace(/^ ?\* ?/gm, ''));
  process.exit(0);
}

// --selftest needs no server, no --out and no app, so it comes before every other
// argument check too. See selfTest() for what it asserts and how it is sabotaged.
if (has('selftest') || has('selftest-break')) process.exit(await selfTest(arg('selftest-break', '') || null));

const OUT = arg('out', null);
if (!OUT) die('--out <dir> is required (see the header of this file)');
const FROM = arg('from', null);
const MERGE = arg('merge', null);
if (MERGE && !FROM) die('--merge folds another run into THIS run\'s report: pass --from <this run> too');
const ROUTES_FILE = path.resolve(arg('routes', path.join(HERE, 'night-routes.json')));
const LOCAL_ARG = arg('local', null);
const ONLY = arg('only', null) ? arg('only').split(',').map(s => s.trim()).filter(Boolean) : null;
const REGIMES_ARG = arg('regimes', null) ? arg('regimes').split(',').map(s => s.trim()).filter(Boolean) : null;
const REFS_ON = arg('refs', 'on') !== 'off';
const TILE_W = Math.max(200, Math.min(1440, +arg('tile', 560) || 560));
const SAME = has('same') ? Number(arg('same')) : null;
if (SAME != null && !(SAME >= 0)) die('--same needs a percentage, e.g. --same 1');
// --break takes an optional mode. A bare `--break`, or `--break` followed by the
// next flag, means `apartments` — what the flag has always meant.
const BREAK_MODES = ['apartments', 'slopes'];
const BREAK = has('break') ? (arg('break', '') || 'apartments') : null;
if (BREAK && !BREAK_MODES.includes(BREAK)) die(`--break takes ${BREAK_MODES.join(' or ')} (got "${BREAK}")`);
const SHOW_REGIONS = has('show-regions');
const GL = arg('gl', 'hardware');
const DEFAULT_SITE = (process.env.VERIFY_URL || process.env.SITE || BASE).replace(/\/+$/, '');
const normQ = q => { q = (q || '').trim(); if (!q) return ''; if (q[0] === '?' || q[0] === '&') q = q.slice(1); return '&' + q; };
const SIDES = [{ key: 'A', site: (arg('a-site', '') || DEFAULT_SITE).replace(/\/+$/, ''), query: normQ(arg('a', '')), label: arg('a-label', '') }];
if (has('b') || has('b-site')) SIDES.push({ key: 'B', site: (arg('b-site', '') || DEFAULT_SITE).replace(/\/+$/, ''), query: normQ(arg('b', '')), label: arg('b-label', '') });
for (const s of SIDES) {
  if (!s.label) s.label = (s.site !== DEFAULT_SITE ? s.site.replace(/^https?:\/\//, '') + ' ' : '') + (s.query || 'as shipped');
  if (BREAK && s.key === 'B') s.label += ` [--break ${BREAK}]`;
}
if (BREAK && SIDES.length < 2) die('--break sabotages side B; pass --b too');
if (SAME != null && SIDES.length < 2 && !FROM) die('--same compares A with B; pass --b too');

// ── Routes ──────────────────────────────────────────────────────────────────
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { die(`cannot read ${f}: ${e.message}`); } }
const CFG = readJSON(ROUTES_FILE);
let localFile = null;
if (LOCAL_ARG === 'none') localFile = null;
else if (LOCAL_ARG) localFile = path.resolve(LOCAL_ARG);
else {
  const d = path.resolve(REPO, '..', 'austin-reference-images', '_night', 'night-routes.local.json');
  if (fs.existsSync(d)) localFile = d;
}
if (LOCAL_ARG && LOCAL_ARG !== 'none' && !fs.existsSync(localFile)) die(`--local ${localFile} does not exist`);
if (localFile) {
  const L = readJSON(localFile);
  console.log(`night-compare: LOCAL OVERLAY LOADED: ${localFile} (${(L.routes || []).length} routes; its poses and refs must never be committed)`);
  for (const r of L.routes || []) {
    r.local = true;
    const i = CFG.routes.findIndex(x => x.id === r.id);
    if (i >= 0) CFG.routes[i] = r; else CFG.routes.push(r);
  }
  Object.assign(CFG.regimes, L.regimes || {});
}
const REF_ROOT = path.resolve(REPO, process.env.NIGHT_REF_ROOT || CFG.refRoot || '../austin-reference-images');
// --viewport WxH overrides the routes file. This is what R10 (the phone pass) needs:
//   --viewport 393x852 --a 'lite=1'
// The regions are FRACTIONS of the frame, so they survive the change of size — but a
// rectangle read off a 1440x900 landscape frame will not land on the same thing in a
// 393x852 portrait one. Re-read them with --show-regions before quoting any ratio
// from a viewport the rectangles were not drawn on.
let [VW, VH] = CFG.viewport || [1440, 900];
const VP_ARG = arg('viewport', null);
if (VP_ARG) {
  const m = /^(\d{2,5})\s*[x×,]\s*(\d{2,5})$/.exec(VP_ARG.trim());
  if (!m) die(`--viewport wants WxH, e.g. --viewport 393x852 (got "${VP_ARG}")`);
  VW = +m[1]; VH = +m[2];
}
const VP_OVERRIDDEN = !!VP_ARG;

// A region's declared subject, from night-routes.json `regionSubjects`:
//   authored  the slopes scene draws it. `--break slopes` MUST move its numbers.
//   basemap   MapLibre's own fill-extrusion or road, lit and graded by our style.
//             `--break` cannot move it, and no number taken from it is our geometry.
//   sky       the sky dome. Not geometry; `--break` cannot move it either.
// Undeclared means nobody has run a sabotage over it yet — reported, never assumed.
const SUBJECT_KINDS = ['authored', 'basemap', 'sky'];
function validRect(r) { return Array.isArray(r) && r.length === 4 && r.every(v => typeof v === 'number' && v >= 0 && v <= 1) && r[2] > r[0] && r[3] > r[1]; }
function rectsOf(spec) { return validRect(spec) ? [spec] : (Array.isArray(spec) && spec.every(validRect) ? spec : null); }

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
/** eye/target ([lng, lat, alt] each) -> a MapLibre pose the app's camera can hold. */
function derive(eye, target) {
  const mlon = 111320 * Math.cos(rad(eye[1])), mlat = 110540;
  const dx = (target[0] - eye[0]) * mlon, dy = (target[1] - eye[1]) * mlat;
  const eyeAlt = Math.max(1.6, eye[2]);
  const horiz = Math.hypot(dx, dy);
  const bearing = (deg(Math.atan2(dx, dy)) + 360) % 360;
  let pitch = deg(Math.atan2(horiz, eyeAlt - target[2]));
  if (!isFinite(pitch) || pitch < 0 || pitch > MAX_PITCH) pitch = MAX_PITCH;
  pitch = Math.max(5, pitch);
  const gd = eyeAlt * Math.tan(rad(pitch));
  const lng = eye[0] + Math.sin(rad(bearing)) * gd / mlon, lat = eye[1] + Math.cos(rad(bearing)) * gd / mlat;
  const range = eyeAlt / Math.cos(rad(pitch));
  const c2c = 0.5 * VH / Math.tan(rad(FOV / 2));
  const zoom = Math.log2(40075016.686 * Math.cos(rad(lat)) / (512 * (range / c2c)));
  return { center: [lng, lat], zoom, pitch, bearing, eyeAlt };
}

const POSES = [];
for (const r of CFG.routes || []) {
  if (!r.id || !Array.isArray(r.poses) || !r.poses.length) die(`route ${r.id || '?'} has no poses`);
  for (const p of r.poses) {
    const key = `${r.id}/${p.id}`;
    if (ONLY && !ONLY.includes(r.id) && !ONLY.includes(key)) continue;
    let cam;
    if (p.eye && p.target) {
      if (!(p.eye.length === 3 && p.target.length === 3)) die(`${key}: eye and target are [lng, lat, alt]`);
      cam = derive(p.eye, p.target);
    } else if (p.center && p.zoom != null) {
      cam = { center: p.center, zoom: p.zoom, pitch: p.pitch ?? 0, bearing: p.bearing ?? 0, eyeAlt: null };
    } else die(`${key}: a pose needs eye+target or center+zoom`);
    const regions = {};
    for (const [name, spec] of Object.entries(p.regions || {})) {
      const rs = rectsOf(spec);
      if (!rs) die(`${key}: region ${name} is not [x0,y0,x1,y1] (fractions) or a list of them`);
      regions[name] = rs;
    }
    // WHOSE geometry the rectangle is on. Undeclared is a real third value and not a
    // synonym for `authored`: at the two Capitol poses four rectangles measured
    // MapLibre's own extrusions and pavement for a week, and nothing could say so,
    // because nothing had ever been asked to. See --break's movedMeasured.
    const subjects = Object.assign({}, r.regionSubjects || {}, p.regionSubjects || {});
    for (const [name, v] of Object.entries(subjects)) {
      if (!SUBJECT_KINDS.includes(v)) die(`${key}: regionSubjects.${name} is "${v}"; it takes ${SUBJECT_KINDS.join(', ')}`);
      if (!regions[name]) die(`${key}: regionSubjects names "${name}", which is not one of this pose's regions (${Object.keys(regions).join(', ') || 'none'})`);
    }
    const regimes = REGIMES_ARG || p.regimes || r.regimes || CFG.defaultRegimes;
    for (const g of regimes) if (!CFG.regimes[g]) die(`${key}: unknown regime ${g}`);
    POSES.push({ route: r.id, pose: p.id, key, title: r.title, local: !!r.local, cam, eye: p.eye || null, target: p.target || null,
      regions, subjects, regimes, refs: Object.assign({}, r.refs || {}, p.refs || {}) });
  }
}
if (!POSES.length) die('no poses selected' + (ONLY ? ` by --only ${ONLY.join(',')}` : ''));
if (ONLY) for (const key of ONLY) {
  if (!POSES.some(p => p.key === key || p.route === key))
    die(`--only selected an unknown route or pose: ${key}`);
}
const REGIME_ORDER = Object.keys(CFG.regimes);
const REGIMES_USED = REGIME_ORDER.filter(g => POSES.some(p => p.regimes.includes(g)));

const slug = s => String(s).replace(/[^\w.-]+/g, '_');
const FRAMES = path.join(OUT, 'frames');
fs.mkdirSync(FRAMES, { recursive: true });
const frameName = (side, P, g) => `${side}-${slug(P.route)}-${slug(P.pose)}-${g}.jpg`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function gitInfo() {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: REPO }).toString().trim().length > 0;
    return { head, dirty };
  } catch (e) { return null; }
}
/** A fingerprint of the BUILD a site serves: index.html plus every local script it loads. */
async function buildPrint(site) {
  try {
    const h = crypto.createHash('sha1');
    const idx = await (await fetch(site + '/index.html')).text();
    h.update(idx);
    const srcs = [...idx.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
    for (const s of srcs) h.update(await (await fetch(site + '/' + s.replace(/^\//, ''))).text());
    return { sha1: h.digest('hex').slice(0, 12), scripts: srcs.length };
  } catch (e) { return { error: e.message }; }
}

// ── In-page helpers (the measuring page; no app loaded in it) ───────────────
/** Decode a JPEG and measure it. Runs in the helper page. */
function pageMeasure({ b64, regions, M, mime }) {
  return (async () => {
    const img = new Image(); img.src = 'data:' + (mime || 'image/jpeg') + ';base64,' + b64; await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    const enc = y => Math.max(0, Math.min(255, Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055))));
    const dec = b => lin[b];
    // one pass over a set of rects -> stats
    function stats(rects) {
      const hl = new Uint32Array(256), hy = new Uint32Array(256);
      let n = 0, sl = 0, sy = 0, sl2 = 0, r = 0, g = 0, bb = 0, hot = 0, vhot = 0;
      for (const [x0, y0, x1, y1] of rects) {
        const X0 = Math.floor(x0 * W), X1 = Math.min(W, Math.ceil(x1 * W)), Y0 = Math.floor(y0 * H), Y1 = Math.min(H, Math.ceil(y1 * H));
        for (let y = Y0; y < Y1; y++) for (let xx = X0; xx < X1; xx++) {
          const i = (y * W + xx) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
          const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          const Y = 0.2126 * lin[R] + 0.7152 * lin[G] + 0.0722 * lin[B];
          hl[Math.min(255, L | 0)]++; hy[enc(Y)]++;
          n++; sl += L; sl2 += L * L; sy += Y; r += R; g += G; bb += B;
          if (L > M.hotLuma) hot++; if (L > M.veryHotLuma) vhot++;
        }
      }
      const q = (h, f) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= f * n) return v; } return 255; };
      const r4 = v => +v.toPrecision(4);
      return {
        n,
        luma: { mean: +(sl / n).toFixed(1), std: +Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2)).toFixed(2), p1: q(hl, .01), p10: q(hl, .1), p50: q(hl, .5), p90: q(hl, .9), p99: q(hl, .99) },
        Y: { mean: r4(sy / n), p10: r4(dec(q(hy, .1))), p50: r4(dec(q(hy, .5))), p90: r4(dec(q(hy, .9))) },
        rgb: [Math.round(r / n), Math.round(g / n), Math.round(bb / n)],
        hot120: +(100 * hot / n).toFixed(3), hot200: +(100 * vhot / n).toFixed(3),
      };
    }
    const frame = stats([[0, 0, 1, 1]]);
    const out = { frame, regions: {} };
    // A region is FLAGGED when it covers less than M.minRegionFrac of the frame. It is
    // still measured and still divided — but a `sky` of 4,000 px in a tree-lined street
    // canyon is a slot of sky, and every ratio over it is a ratio over that slot.
    // And a region's median is also recorded as the 8-BIT sRGB CODE it came from
    // (`code`). At full night that code is 3 or 4 out of 255 in fourteen of the
    // sixteen poses, and a ratio between two codes that low has no precision left:
    // see the `dark` flag below.
    const toCode = L => { const v = L <= 0.0031308 ? L * 12.92 : 1.055 * Math.pow(L, 1 / 2.4) - 0.055; return +(v * 255).toFixed(1); };
    for (const [name, rects] of Object.entries(regions)) {
      const s = stats(rects);
      s.frac = +(s.n / (W * H)).toFixed(4);
      if (s.frac < M.minRegionFrac) s.small = true;
      s.code = toCode(s.Y.p50);
      if (s.code < M.minDenomCode) s.dark = true;
      out.regions[name] = s;
    }
    out.smallRegions = Object.entries(out.regions).filter(([, s]) => s.small).map(([k]) => k);
    // bright windows in the wall region (or the frame)
    const wr = regions.wall || [[0, 0, 1, 1]];
    const med = (regions.wall ? out.regions.wall : frame).Y.p50;
    const thr = Math.max(M.relK * med, 1e-6);
    let n = 0, win = 0, abs = 0, wr_ = 0, wg = 0, wb = 0;
    for (const [x0, y0, x1, y1] of wr) {
      const X0 = Math.floor(x0 * W), X1 = Math.min(W, Math.ceil(x1 * W)), Y0 = Math.floor(y0 * H), Y1 = Math.min(H, Math.ceil(y1 * H));
      for (let y = Y0; y < Y1; y++) for (let xx = X0; xx < X1; xx++) {
        const i = (y * W + xx) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Y = 0.2126 * lin[R] + 0.7152 * lin[G] + 0.0722 * lin[B];
        n++;
        if (R >= B && L >= M.minLuma && Y >= thr) { win++; wr_ += R; wg += G; wb += B; }
        if (R >= B && L > M.absLuma) abs++;
      }
    }
    // With no `wall` region the test runs over the whole frame, where at blue hour
    // bright sky and pavement pass it. That number is NOT a window count; it is
    // flagged so no table can quote it as one.
    out.windows = { region: regions.wall ? 'wall' : 'frame', fallback: !regions.wall, medianY: med, relK: M.relK,
      pct: +(100 * win / n).toFixed(3), absPct: +(100 * abs / n).toFixed(3),
      rgb: win ? [Math.round(wr_ / win), Math.round(wg / win), Math.round(wb / win)] : null };
    const Y50 = k => out.regions[k] ? out.regions[k].Y.p50 : null;
    const ratio = (a, b) => (Y50(a) != null && Y50(b) != null && Y50(b) > 0) ? +(Y50(a) / Y50(b)).toPrecision(3) : undefined;
    // A ratio whose DENOMINATOR median is only a few 8-bit codes above black is
    // quantisation-limited: one code either way moves it by tens of percent. The
    // band is recorded (denominator code ±1) so no table can print 0.801 as if it
    // were three significant figures. `lady-bird-lake/aerial-west-120m` at p 1
    // reads 10.7 and its band is 8.0–16.0, which straddles A3's ≥ 15 target.
    const fromCode = c => { const v = Math.max(c, 1) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    out.ratios = {}; out.ratiosSmall = []; out.ratiosDark = []; out.ratioBands = {};
    for (const [a, b] of [['wall', 'sky'], ['ground', 'sky'], ['water', 'sky'], ['wall', 'ground']]) {
      const v = ratio(a, b); if (v === undefined) continue;
      const k = a + '/' + b;
      out.ratios[k] = v;
      if (out.regions[a].small || out.regions[b].small) out.ratiosSmall.push(k);
      if (out.regions[b].dark) {
        out.ratiosDark.push(k);
        const num = out.regions[a].Y.p50, c = Math.round(out.regions[b].code);
        out.ratioBands[k] = [+(num / fromCode(c + 1)).toPrecision(3), +(num / fromCode(c - 1)).toPrecision(3)];
      }
    }
    return out;
  })();
}

/** |delta luma| between two JPEGs of the same size. Runs in the helper page. */
function pageDiff({ a, b, D, mime }) {
  return (async () => {
    const load = async s => { const im = new Image(); im.src = 'data:' + (mime || 'image/jpeg') + ';base64,' + s; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
    const A = await load(a), B = await load(b);
    if (A.width !== B.width || A.height !== B.height) return { error: 'size mismatch' };
    const da = A.data, db = B.data; let n = 0, s = 0, over = 0, big = 0;
    for (let i = 0; i < da.length; i += 4) {
      const la = 0.2126 * da[i] + 0.7152 * da[i + 1] + 0.0722 * da[i + 2];
      const lb = 0.2126 * db[i] + 0.7152 * db[i + 1] + 0.0722 * db[i + 2];
      const t = Math.abs(la - lb); n++; s += t; if (t > D.luma) over++; if (t > D.lumaBig) big++;
    }
    return { meanAbs: +(s / n).toFixed(3), pctOver: +(100 * over / n).toFixed(3), pctBig: +(100 * big / n).toFixed(3) };
  })();
}

/** Compose a labelled grid of tiles into one JPEG. Runs in the helper page. */
function pageSheet({ title, colHeads, rows, tileW, tileH, q, rowHeadW }) {
  return (async () => {
    const HEAD = 30, COLH = 22, PAD = 4;
    const W = rowHeadW + colHeads.length * (tileW + PAD) + PAD;
    const H = HEAD + COLH + rows.length * (tileH + PAD) + PAD;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#16181c'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#e8e6e1'; x.textBaseline = 'middle';
    // The title carries the route's one-line purpose, and on a one-column sheet
    // it is wider than the sheet. Step the size down until it fits, then let the
    // canvas condense the remainder rather than clipping it off the right edge:
    // a sheet is read as a picture, and a half-sentence caption reads as a bug.
    let ts = 16;
    for (; ts > 11; ts--) { x.font = `600 ${ts}px system-ui, Segoe UI, sans-serif`; if (x.measureText(title).width <= W - 16) break; }
    x.font = `600 ${ts}px system-ui, Segoe UI, sans-serif`;
    x.fillText(title, 8, HEAD / 2 + 1, W - 16);
    x.font = '600 13px system-ui, Segoe UI, sans-serif';
    colHeads.forEach((h, i) => { x.fillStyle = '#c9c4ba'; x.fillText(h, rowHeadW + PAD + i * (tileW + PAD) + 2, HEAD + COLH / 2); });
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r], y0 = HEAD + COLH + r * (tileH + PAD);
      if (rowHeadW) {
        x.save(); x.fillStyle = '#c9c4ba'; x.font = '600 12px system-ui, Segoe UI, sans-serif';
        const lines = String(row.head || '').split('\n');
        lines.forEach((ln, k) => x.fillText(ln, 6, y0 + 14 + k * 15));
        x.restore();
      }
      for (let i = 0; i < row.tiles.length; i++) {
        const t = row.tiles[i], x0 = rowHeadW + PAD + i * (tileW + PAD);
        x.fillStyle = '#0b0c0e'; x.fillRect(x0, y0, tileW, tileH);
        if (t && t.src) {
          try {
            const blob = await (await fetch(t.src)).blob();
            const bmp = await createImageBitmap(blob);
            const s = Math.min(tileW / bmp.width, tileH / bmp.height);
            const w = bmp.width * s, h = bmp.height * s;
            x.imageSmoothingQuality = 'high';
            x.drawImage(bmp, x0 + (tileW - w) / 2, y0 + (tileH - h) / 2, w, h);
            bmp.close && bmp.close();
          } catch (e) { t.lines = ['(could not decode)', ...(t.lines || [])]; }
          if (t.grid) {
            // A labelled 5% grid, so a rectangle for `regions` is READ OFF the
            // frame rather than guessed. Every tenth line is labelled.
            x.font = '600 11px system-ui, sans-serif';
            for (let k = 1; k < 20; k++) {
              const f = k / 20, major = k % 2 === 0;
              x.strokeStyle = major ? 'rgba(255,226,120,0.80)' : 'rgba(255,255,255,0.24)';
              x.lineWidth = 1;
              x.beginPath(); x.moveTo(x0 + f * tileW, y0); x.lineTo(x0 + f * tileW, y0 + tileH); x.stroke();
              x.beginPath(); x.moveTo(x0, y0 + f * tileH); x.lineTo(x0 + tileW, y0 + f * tileH); x.stroke();
              if (major) {
                x.fillStyle = '#ffe278';
                x.fillText(f.toFixed(1), x0 + f * tileW + 2, y0 + 10);
                x.fillText(f.toFixed(1), x0 + 3, y0 + f * tileH - 4);
              }
            }
          }
          if (t.rects) {
            for (const [name, rects, col] of t.rects) {
              x.strokeStyle = col; x.lineWidth = 2; x.fillStyle = col; x.font = '600 12px system-ui, sans-serif';
              for (const [a, b, cc, d] of rects) { x.strokeRect(x0 + a * tileW, y0 + b * tileH, (cc - a) * tileW, (d - b) * tileH); x.fillText(name, x0 + a * tileW + 4, y0 + b * tileH + 10); }
            }
          }
        }
        const lines = (t && t.lines) || [];
        if (lines.length) {
          x.font = '12px system-ui, Segoe UI, sans-serif';
          const lh = 15, bw = Math.min(tileW - 8, Math.max(...lines.map(l => x.measureText(l).width)) + 10);
          x.fillStyle = 'rgba(0,0,0,0.62)'; x.fillRect(x0 + 4, y0 + tileH - 6 - lines.length * lh, bw, lines.length * lh + 2);
          x.fillStyle = '#f2efe8';
          lines.forEach((l, k) => x.fillText(l, x0 + 9, y0 + tileH - 6 - (lines.length - k - 0.5) * lh));
        }
      }
    }
    return c.toDataURL('image/jpeg', q).split(',')[1];
  })();
}

// ── --selftest: the MEASURING half, watched failing ─────────────────────────
// `--break` watches --same (pageDiff) go red. NOTHING watched pageMeasure — and
// pageMeasure is the unit every acceptance row in docs/night-implementation-plan.md
// §1.4 is written in: the region medians, the four ratios, the quantisation band and
// the bright-window share. The repo's model for this is `coplanar.mjs --selftest`.
//
// The frames here are SYNTHETIC and piecewise-uniform, so every expected number is
// arithmetic over a colour and a pixel count, checkable by hand: a region of 5,000
// pixels with a 1,000-pixel warm strip in it is 20.000% bright window, and nothing
// about that depends on a second copy of the measuring pipeline. They are painted in
// the page with fillRect on integer rectangles and encoded LOSSLESSLY as PNG, then
// pushed through the REAL pageMeasure and pageDiff, unmodified, exactly as a shoot
// does. One case is re-encoded as JPEG q90 to prove the decode path the shoot
// actually uses.
//
// Then each criterion the measurement rests on is sabotaged IN THE SOURCE TEXT of
// those two functions, one at a time, and the assertions must go RED. A sabotage
// whose target string is not found is a hard failure, never a skip: the first
// version of --break was a sabotage that silently did nothing and stayed green for
// weeks, and that is the mistake this file exists to not make twice.
/** Paint a synthetic frame in the page and hand back lossless PNG (or JPEG) base64. */
function pagePaint({ W, H, rects, mime, q }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  for (const [x0, y0, x1, y1, col] of rects) { x.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; x.fillRect(x0, y0, x1 - x0, y1 - y0); }
  return c.toDataURL(mime || 'image/png', q).split(',')[1];
}

// Everything selfTest needs lives INSIDE it: it is dispatched from the argument
// block, before the module's later consts exist, so a module-scope helper here
// would be a temporal-dead-zone crash rather than a self-test.
async function selfTest(only) {
  const SELF_LIN = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const SELF_ENC = y => Math.max(0, Math.min(255, Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055))));
  const selfL = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const selfY = c => 0.2126 * SELF_LIN[c[0]] + 0.7152 * SELF_LIN[c[1]] + 0.0722 * SELF_LIN[c[2]];
  const r4 = v => +v.toPrecision(4);
  // ── The frame. Every strip isolates ONE of the three window criteria, so a
  // sabotage of any one of them moves `windows.pct` by a known amount.
  //   grey 24      base        R>=B yes, luma 24 < 40, Y < 4x median  -> excluded twice
  //   255,220,160  WINDOW      warm, luma 223.109, Y 0.7499           -> the 1,000 px
  //   grey 50      luma 50     fails ONLY Y >= 4 x the region median
  //   90,100,130   pale masonry reflecting a blue sky: fails ONLY R >= B
  //   180,0,0      luma 38.268 fails ONLY luma >= 40, and its Y is 0.0971
  const G = v => [v, v, v];
  const WIN = [255, 220, 160], MASONRY = [90, 100, 130], DARKRED = [180, 0, 0];
  const FR = { W: 200, H: 100, rects: [
    [0, 0, 200, 100, G(4)],            // sky, the whole frame, painted over below
    [0, 50, 100, 100, G(24)],          // wall base                       2,600 px in `wall`
    [100, 50, 200, 100, G(150)],       // ground                          5,000 px
    [12, 50, 32, 100, WIN],            // the windows                     1,000 px = 20.000%
    [32, 50, 40, 100, G(50)],            //                                 400 px
    [40, 50, 50, 100, MASONRY],          //                                 500 px
    [50, 50, 60, 100, DARKRED],          //                                 500 px
  ] };
  const REGIONS = { sky: [[0, 0, 1, 0.5]], wall: [[0, 0.5, 0.5, 1]], ground: [[0.5, 0.5, 1, 1]], dome: [[0, 0, 0.05, 0.05]] };
  const FLAT = { W: 40, H: 40, rects: [[0, 0, 40, 40, G(3)]] };
  const DA = { W: 200, H: 100, rects: [[0, 0, 200, 100, G(100)]] };
  const DB = { W: 200, H: 100, rects: [[0, 0, 200, 100, G(100)], [0, 0, 200, 10, G(120)], [0, 10, 200, 15, G(200)]] };

  // The reference answers: counted off the SPEC, grouped by colour, never decoded.
  const paint = spec => { const b = new Array(spec.W * spec.H); for (const [x0, y0, x1, y1, col] of spec.rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) b[y * spec.W + x] = col; return b; };
  const count = (buf, W, H, rects) => { const m = new Map(); let n = 0; for (const [a, b, c, d] of rects) { const X0 = Math.floor(a * W), X1 = Math.min(W, Math.ceil(c * W)), Y0 = Math.floor(b * H), Y1 = Math.min(H, Math.ceil(d * H)); for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const k = buf[y * W + x].join(','); m.set(k, (m.get(k) || 0) + 1); n++; } } return { m, n }; };
  const pct = ({ m, n }, f, bucket) => { const rows = [...m].map(([k, c]) => [bucket(k.split(',').map(Number)), c]).sort((a, b) => a[0] - b[0]); let acc = 0; for (const [v, c] of rows) { acc += c; if (acc >= f * n) return v; } return rows[rows.length - 1][0]; };
  const bL = c => Math.min(255, selfL(c) | 0), bY = c => SELF_ENC(selfY(c));
  const buf = paint(FR);
  const cFrame = count(buf, FR.W, FR.H, [[0, 0, 1, 1]]);
  const cWall = count(buf, FR.W, FR.H, REGIONS.wall);
  const mean = ({ m, n }) => { let s = 0; for (const [k, c] of m) s += c * selfL(k.split(',').map(Number)); return +(s / n).toFixed(1); };
  const hot = ({ m, n }, t) => { let s = 0; for (const [k, c] of m) if (selfL(k.split(',').map(Number)) > t) s += c; return +(100 * s / n).toFixed(3); };
  const Y50 = c => r4(SELF_LIN[pct(c, 0.5, bY)]);
  const wantY = { sky: r4(SELF_LIN[4]), wall: r4(SELF_LIN[24]), ground: r4(SELF_LIN[150]) };
  const fromCode = c => { const v = Math.max(c, 1) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const p3 = v => +v.toPrecision(3);

  // ── The assertions. A literal is a number a reader can re-derive on paper; the
  // rest are counted off the spec above.
  const checks = (m, d) => [
    ['frame luma mean', m.frame.luma.mean, mean(cFrame)],
    ['frame luma p1/p10/p50/p90/p99', [m.frame.luma.p1, m.frame.luma.p10, m.frame.luma.p50, m.frame.luma.p90, m.frame.luma.p99], [4, 4, 4, 150, 223]],
    ['frame luma std is not zero (not a blank frame)', m.frame.luma.std > MEASURE.blankStd, true],
    ['frame hot120 % (the 1,000 window px + the 5,000 px of grey 150)', m.frame.hot120, 30],
    ['frame hot200 % (the window px alone)', m.frame.hot200, 5],
    ['region pixel counts sky/wall/ground/dome', [m.regions.sky.n, m.regions.wall.n, m.regions.ground.n, m.regions.dome.n], [10000, 5000, 5000, 50]],
    ['region fractions sky/wall/dome', [m.regions.sky.frac, m.regions.wall.frac, m.regions.dome.frac], [0.5, 0.25, 0.0025]],
    ['dome is the only region under 1% of the frame', m.smallRegions, ['dome']],
    ['region median linear Y sky/wall/ground', [m.regions.sky.Y.p50, m.regions.wall.Y.p50, m.regions.ground.Y.p50], [wantY.sky, wantY.wall, wantY.ground]],
    ['region medians as 8-bit sRGB codes', [m.regions.sky.code, m.regions.wall.code, m.regions.ground.code], [4, 24, 150]],
    ['only the sky is under the minDenomCode floor', [!!m.regions.sky.dark, !!m.regions.wall.dark, !!m.regions.ground.dark], [true, false, false]],
    // 0.009134 / 0.001214 = 7.5239, 0.305 / 0.001214 = 251.24, 0.009134 / 0.305 =
    // 0.029948 — the medians are the r4-rounded linear Y of sRGB 24, 4 and 150, and
    // the ratio is then printed to three significant figures. (These literals were
    // wrong by one in the last place when this test was first written, and the test
    // caught it; the values above were re-derived in Decimal arithmetic outside the
    // harness before they were trusted.)
    ['ratios wall/sky, ground/sky, wall/ground', [m.ratios['wall/sky'], m.ratios['ground/sky'], m.ratios['wall/ground']], [7.52, 251, 0.0299]],
    ['no water region, so no water/sky', m.ratios['water/sky'] === undefined, true],
    ['the two ratios over the dark sky are flagged', m.ratiosDark, ['wall/sky', 'ground/sky']],
    ['wall/sky band at sky code 4 +/- 1', m.ratioBands['wall/sky'], [p3(wantY.wall / fromCode(5)), p3(wantY.wall / fromCode(3))]],
    ['bright windows: exactly the 1,000 warm px of 5,000', m.windows.pct, 20],
    ['...and the crude absolute count agrees here', m.windows.absPct, 20],
    ['...measured in the wall region, not the whole frame', [m.windows.region, m.windows.fallback], ['wall', false]],
    ['...and their mean colour is the strip itself', m.windows.rgb, WIN],
    ['A/B: 10% of px 20 luma apart + 5% 100 apart = 15.000% over 16', d.pctOver, 15],
    ['A/B: only the 5% is over 48', d.pctBig, 5],
    ['A/B: mean |delta luma| = (0.10 x 20) + (0.05 x 100)', d.meanAbs, 7],
  ];

  // Sabotages: a textual patch on the REAL source of the two measuring functions.
  const SAB = {
    luma: ['pageMeasure: Rec.709 luma weights replaced by a flat mean', pageMeasure, [['0.2126 * R + 0.7152 * G + 0.0722 * B', '(R + G + B) / 3', 2]]],
    warm: ['pageMeasure: the R >= B warm test dropped from the window rule', pageMeasure, [['if (R >= B && L >= M.minLuma && Y >= thr)', 'if (L >= M.minLuma && Y >= thr)', 1]]],
    minluma: ['pageMeasure: the luma >= minLuma floor dropped from the window rule', pageMeasure, [['if (R >= B && L >= M.minLuma && Y >= thr)', 'if (R >= B && Y >= thr)', 1]]],
    relk: ['pageMeasure: the Y >= relK x median test dropped from the window rule', pageMeasure, [['if (R >= B && L >= M.minLuma && Y >= thr)', 'if (R >= B && L >= M.minLuma)', 1]]],
    region: ['pageMeasure: every region measured over the whole frame instead of its rectangle', pageMeasure, [['const s = stats(rects);', 'const s = stats([[0, 0, 1, 1]]);', 1]]],
    band: ['pageMeasure: the +/- 1 code quantisation band collapsed onto the code itself', pageMeasure, [['fromCode(c + 1)', 'fromCode(c)', 1], ['fromCode(c - 1)', 'fromCode(c)', 1]]],
    diff: ['pageDiff: the 16-luma difference threshold doubled', pageDiff, [['if (t > D.luma) over++;', 'if (t > D.luma * 2) over++;', 1]]],
  };
  const patch = name => {
    const [why, fn, reps] = SAB[name];
    let src = fn.toString();
    for (const [from, to, n] of reps) {
      const hits = src.split(from).length - 1;
      if (hits !== n) throw new Error(`--selftest sabotage "${name}" cannot be applied: it expects ${n} occurrence(s) of\n    ${from}\nand the source has ${hits}. The code moved; fix the sabotage, do NOT skip it.`);
      src = src.split(from).join(to);
    }
    return { why, fn: new Function('return (' + src + ')')() };
  };

  const browser = await launch(chromium, { gl: 'swiftshader', maxMs: 6 * 60000 });
  let failed = 0;
  try {
    const p = await browser.newPage({ viewport: { width: 64, height: 64 } });
    const png = async spec => p.evaluate(pagePaint, { ...spec, mime: 'image/png' });
    const b64 = { fr: await png(FR), flat: await png(FLAT), da: await png(DA), db: await png(DB) };
    const jpg = await p.evaluate(pagePaint, { ...FR, mime: 'image/jpeg', q: 0.9 });

    const run = async (measureFn, diffFn) => ({
      m: await p.evaluate(measureFn, { b64: b64.fr, regions: REGIONS, M: MEASURE, mime: 'image/png' }),
      d: await p.evaluate(diffFn, { a: b64.da, b: b64.db, D: DIFF, mime: 'image/png' }),
    });
    const report = (title, rows) => {
      let bad = 0;
      console.log('\n' + title);
      for (const [name, got, want] of rows) {
        const ok = JSON.stringify(got) === JSON.stringify(want);
        if (!ok) bad++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}\n${ok ? '' : `          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}\n`}`.replace(/\n$/, ''));
      }
      return bad;
    };

    // 1. the clean pass: every number exact.
    const clean = await run(pageMeasure, pageDiff);
    const cleanBad = report('--- selftest: the real pageMeasure/pageDiff on frames whose answers are known from the spec', checks(clean.m, clean.d));
    if (cleanBad) { failed += cleanBad; console.log(`\n  ${cleanBad} assertion(s) FAILED on the UNSABOTAGED code. The instrument is wrong, or the expectations are. Stop here.`); }

    // 2. the JPEG decode path the shoot actually uses, at the tolerance JPEG costs.
    // The shoot's own frames are JPEG q90, and JPEG is not the arithmetic under test:
    // 4:2:0 chroma subsampling bleeds colour across the 8x8 blocks at every strip
    // edge, which is worth about a point on a 20-px-wide strip and a code on a flat
    // region. So these are TOLERANCES, and the tolerance is the measured cost plus
    // headroom, printed beside the number so it can never quietly become the answer.
    const mj = await p.evaluate(pageMeasure, { b64: jpg, regions: REGIONS, M: MEASURE, mime: 'image/jpeg' });
    const near = (name, got, want, tol) => [`${name} (got ${got}, want ${want} +/- ${tol})`, Math.abs(got - want) <= tol, true];
    const jr = [
      near('JPEG q90: frame mean luma', mj.frame.luma.mean, clean.m.frame.luma.mean, 0.5),
      near('JPEG q90: the sky median, as an 8-bit code', mj.regions.sky.code, 4, 1),
      near('JPEG q90: the ground median, as an 8-bit code', mj.regions.ground.code, 150, 1),
      near('JPEG q90: the wall median, as an 8-bit code', mj.regions.wall.code, 24, 1.5),
      // MEASURED, and the one number here worth remembering: 23.46 against a true
      // 20.000. A 200-luma step across one pixel is the worst case JPEG has, and
      // ringing round the bright strip makes warm bright pixels out of the grey
      // beside it. A bright-window share read off a q90 frame at a hard facade edge
      // carries a percent-level error of its own, on top of everything the scene does.
      near('JPEG q90: the bright-window share of the wall', mj.windows.pct, 20, 4),
      ['JPEG q90: still measured in the wall region', mj.windows.region, 'wall'],
    ];
    failed += report('--- selftest: the same frame through the JPEG path a shoot uses (chroma subsampling, so tolerances)', jr);

    // 3. the watched failures. Every one of these MUST go red.
    const names = only ? [only] : Object.keys(SAB);
    for (const name of names) {
      if (!SAB[name]) { console.error(`--selftest-break: unknown sabotage "${name}". Known: ${Object.keys(SAB).join(' ')}`); return 2; }
      const { why, fn } = patch(name);
      const got = name === 'diff' ? await run(pageMeasure, fn) : await run(fn, pageDiff);
      const rows = checks(got.m, got.d);
      const red = rows.filter(([, g, w]) => JSON.stringify(g) !== JSON.stringify(w));
      if (only) report(`--- selftest-break ${name}: ${why}`, rows);
      if (red.length) console.log(`\n  ok    --selftest-break ${name} (${why})\n        caught by ${red.length} assertion(s): ${red.map(r => r[0]).join('; ')}`);
      else { failed++; console.log(`\n  FAIL  --selftest-break ${name} (${why})\n        EVERY assertion still passed. This criterion is not watched by anything.`); }
    }
    console.log(`\nselftest: ${failed ? failed + ' FAILED' : 'all passed'} (${checks(clean.m, clean.d).length} assertions, ${jr.length} JPEG-path assertions, ${names.length} watched failure(s))\n`);
  } catch (e) {
    console.error('night-compare --selftest: ' + (e && e.stack || e));
    failed++;
  } finally { await browser.__done(); }
  return failed ? 2 : 0;
}

// ── Shooting (one side = one page load) ─────────────────────────────────────
async function shootSide(browser, side, shots, log) {
  const info = { key: side.key, site: side.site, query: side.query, label: side.label, pageErrors: [], warnings: [] };
  info.build = await buildPrint(side.site);
  const url = `${side.site}/index.html?intro=0&drift=0&clip=1${side.query}`;
  info.url = url;
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { if (info.pageErrors.length < 30) info.pageErrors.push(e.message.slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && info.pageErrors.length < 30) info.pageErrors.push('console: ' + m.text().slice(0, 300)); });
  const t0 = Date.now();
  // ── Getting to a page that is really OUR city ─────────────────────────────
  // Under machine load the app gives up on the authored buildings at 90 s
  // (js/app.js, INTRO.authoredCeilingMs) and keeps the legacy scene "for this
  // visit". js/app.js says of that state, in its own comment: "a reload retries
  // it". Poking `APARTMENTS.on = true` and re-running applySlopesApartments in
  // the abandoned page does NOT reliably retry it: on 2026-09-20, with three
  // GPU slots busy, that path produced 30 `Cannot read properties of null
  // (reading 'getLayer')` page errors and a group that never became ready
  // inside a ten-minute wait, and the run died before its first frame. So the
  // first remedy is the one the app documents — reload — and the poke is only
  // the fallback after that. Both are recorded.
  const loadOnce = async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: WAIT.styleMs });
    await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
    const veil = await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: WAIT.veilMs }).then(() => 'lifted').catch(() => 'STILL UP');
    // readyToReveal() is ALSO true when there is no group (a fetch failure keeps
    // the fallback usable), so the group is checked separately.
    const pre = await page.evaluate(() => ({ on: window.APARTMENTS && window.APARTMENTS.on, group: !!(window.slopesApartments && window.slopesApartments.group), intro: window.__intro ? { reason: window.__intro.reason, waitedMs: window.__intro.waitedMs, modelFallback: window.__intro.modelFallback || null, missingAtLift: window.__intro.missingAtLift } : null }));
    return { veil, pre };
  };
  let att;
  try { att = await loadOnce(); }
  catch (e) { await page.close(); return { info, fatal: `side ${side.key}: the app never loaded (${e.message.split('\n')[0]})` }; }
  info.veil = att.veil; info.veilMs = Date.now() - t0; info.intro = att.pre.intro;
  info.authoredReloads = 0;
  for (let i = 0; i < WAIT.authoredReloads && att.pre.on === false; i++) {
    info.authoredReloads++;
    info.warnings.push(`the app had switched the authored buildings off for this visit (INTRO.authoredCeilingMs under load); reloading (attempt ${i + 1} of ${WAIT.authoredReloads})`);
    log(`[${side.key}] authored handoff timed out; reloading (${i + 1}/${WAIT.authoredReloads})`);
    try { att = await loadOnce(); } catch (e) { break; }
    info.veil = att.veil; info.intro = att.pre.intro;
  }
  if (att.pre.on === false) {
    info.authoredReenabled = true;
    info.warnings.push('still off after reloading; switched back on in the page as a last resort (this path is unreliable — see the comment in this file)');
    await page.evaluate(() => { window.APARTMENTS.on = true; window.applySlopesApartments && window.applySlopesApartments(window.__map); });
  }
  const ok = await page.waitForFunction(() => !!(window.slopesApartments && window.slopesApartments.group) && window.slopesApartments.readyToReveal(), null, { timeout: WAIT.authoredMs }).then(() => true).catch(() => false);
  info.readyMs = Date.now() - t0;
  // `count.buildings` is NOT a count of what is standing in this frame. It is
  // incremented per building inside the time-sliced build (js/slopes-apartments.js
  // :2224) and zeroed by resetCount() at the top of build() — but the `!want &&
  // _building` branch of applySlopesApartments releases the `_building` guard
  // while the old build is STILL RUNNING ("the in-flight build discards itself on
  // landing"), so the APARTMENTS.on poke can start a second build that counts on
  // top of the first. Measured 2026-09-20 on one build at one port: 196 (clean,
  // 0 reloads), 298, 323 and 363, while `triangles` stayed bit-identical at
  // 2,600,942 and the catalog is 196 buildings (45 individual + 151 across five
  // collections). So: `triangles` is the stable invariant and the thing to quote;
  // `namesUnique` is the honest building count; `buildings` is kept raw because a
  // value above `catalog` is the tell that two builds overlapped.
  info.apartments = await page.evaluate(() => {
    const A = window.slopesApartments; if (!A) return null; const c = A.count;
    return { group: !!A.group, buildings: c.buildings, namesUnique: new Set(c.names || []).size,
      catalog: A.data && A.data.buildings ? A.data.buildings.length : null,
      done: c.done, triangles: c.triangles, slopesOn: window.SLOPES && window.SLOPES.on };
  });
  if (info.apartments && info.apartments.catalog && info.apartments.buildings > info.apartments.catalog)
    info.warnings.push(`count.buildings ${info.apartments.buildings} exceeds the ${info.apartments.catalog}-building catalog: two builds overlapped and the counter accumulated. ${info.apartments.namesUnique} distinct buildings, ${info.apartments.triangles} triangles — quote the triangles, not the count.`);
  if (!ok) { await page.close(); return { info, fatal: `side ${side.key}: the authored buildings never became ready (group ${info.apartments && info.apartments.group}) after ${info.authoredReloads} reload(s); frames would show the fallback city. This is the machine being busy: check the GPU slots and run it again on a quieter machine.` }; }
  info.gfx = await page.evaluate(() => { const G = window.GFX || {}; return { preset: G.preset, bloom: G.bloom, godRays: G.godRays, autoExposure: G.autoExposure, renderScale: G.renderScale, filmic: G.filmic, exposure: G.exposure, stars: G.stars }; });
  // ── --break: the sabotage, and the proof that it held ─────────────────────
  // The FIRST version of this set `group.visible = false`, and it did nothing.
  // js/slopes.js render() rewrites `g.visible` for EVERY child of root on every
  // single frame from minzoom and the LOD tier (js/slopes.js:1030-1036 — the loop
  // that exists precisely so lod.js never writes `visibility` on this layer), so
  // the flag was back to true before the first screenshot. Measured 2026-09-20:
  // `--break --same 1` came back PASS with A and B differing on 0.005% of pixels
  // and the two frames visually identical. An assertion whose only sabotage is
  // silently undone has never been shown able to go red.
  // So the sabotage takes the group OUT of the scene, which that loop cannot undo
  // (it only iterates the children that are there), and nothing re-adds it: the
  // module still holds `_group`, so applySlopesApartments will not rebuild. The
  // legacy prisms stay filtered out, so side B is a genuine hole where the
  // authored city was — which is exactly the regression --same exists to catch.
  // `--break slopes` goes further: it empties slopes.root AND stubs slopes.add(),
  // because the groups are built lazily — campus-landscape on zoom, roofs and the
  // dome as their data lands — so a clear on its own gets quietly undone the first
  // time the camera reaches a pose whose data had not loaded yet. With add() stubbed
  // the scene cannot refill, and the end-of-shoot check proves it did not.
  const breakCheck = async where => page.evaluate(() => {
    const A = window.slopesApartments, root = window.slopes && window.slopes.root;
    const inScene = !!(root && A && A.group && root.children.indexOf(A.group) >= 0);
    const drawn = (window.slopes.stats().groups || []).filter(g => g.visible).map(g => g.name);
    return { inScene, groupVisible: !!(A && A.group && A.group.visible), drawnGroups: drawn,
      rootChildren: root ? root.children.map(c => c.name || '(unnamed)') : null,
      addStubbed: !!(window.slopes && window.slopes.__breakStub) };
  }).then(r => ({ where, ...r }));
  if (BREAK && side.key === 'B') {
    info.breakBefore = await breakCheck('before');
    await page.evaluate(mode => {
      const S = window.slopes;
      if (mode === 'slopes') {
        for (const child of S.root.children.slice()) S.remove(child);
        S.add = () => {}; S.__breakStub = true;          // nothing may re-enter the scene
      } else {
        S.remove(window.slopesApartments.group);
      }
      window.__map.triggerRepaint();
    }, BREAK);
    await sleep(1500);
    await page.evaluate(() => window.__map.triggerRepaint());
    await sleep(1500);
    info.breakAfter = await breakCheck('after');
    info.breakMode = BREAK;
    info.broken = BREAK === 'slopes'
      ? 'every group removed from the slopes scene and slopes.add() stubbed (apartments, roofs, arches, art, dome, stadium, campus landscape)'
      : 'authored apartments removed from the slopes scene (slopes.remove(group))';
    info.warnings.push(`--break ${BREAK}: ` + info.broken);
    const stillThere = BREAK === 'slopes'
      ? (info.breakAfter.rootChildren && info.breakAfter.rootChildren.length) || info.breakAfter.drawnGroups.length
      : info.breakAfter.inScene || info.breakAfter.drawnGroups.includes('slopes-apartments');
    if (stillThere) {
      await page.close();
      return { info, fatal: `side B: --break ${BREAK} did not hold. After the removal and two repaints the scene still holds [${(info.breakAfter.rootChildren || []).join(', ')}] and draws [${info.breakAfter.drawnGroups.join(', ')}]. A sabotage that does not sabotage makes --same green for the wrong reason; fix the sabotage before trusting any --same result.` };
    }
    if (BREAK === 'apartments' && !info.breakBefore.inScene)
      info.warnings.push('--break: the group was ALREADY not in the slopes scene before the sabotage — side B was never showing the authored city, so this run does not exercise --same either.');
    if (!info.breakBefore.drawnGroups.length)
      info.warnings.push('--break: NOTHING was drawn from the slopes scene before the sabotage, so at the page-load camera there was nothing to take away. Per-pose coverage is in each shot\'s `slopes` block; read it before quoting this run as evidence that --same can fail.');
    log(`[B] --break ${BREAK}: ${info.broken}; drawn groups before [${info.breakBefore.drawnGroups.join(', ')}] -> after [${info.breakAfter.drawnGroups.join(', ')}]`);
  }
  await sleep(3000);
  log(`[${side.key}] ready in ${(info.readyMs / 1000).toFixed(1)} s (veil ${info.veil} at ${(info.veilMs / 1000).toFixed(1)} s, intro ${info.intro && info.intro.reason}${info.authoredReloads ? ', ' + info.authoredReloads + ' reload(s)' : ''}); ${info.apartments.triangles} authored triangles (${info.apartments.namesUnique} distinct buildings of ${info.apartments.catalog}; raw counter ${info.apartments.buildings}); preset ${info.gfx.preset}; build ${info.build.sha1 || info.build.error}`);

  const helper = await browser.newPage({ viewport: { width: 64, height: 64 } });
  for (const g of REGIMES_USED) {
    const R = CFG.regimes[g];
    const todo = POSES.filter(P => P.regimes.includes(g));
    if (!todo.length) continue;
    const rg = await page.evaluate(async ({ p, idleMs }) => {
      const m = window.__map;
      const sl = document.getElementById('tod-slider'); if (sl) sl.value = String(p);
      const t = performance.now();
      window.applyTimeOfDay(m, p, true);
      const applyMs = performance.now() - t;
      await new Promise(r => { const k = setTimeout(r, idleMs); m.once('idle', () => { clearTimeout(k); r(); }); m.triggerRepaint(); });
      const B = window.skyBodies ? window.skyBodies(p) : null;
      return { applyMs: Math.round(applyMs), sunElev: B ? +B.sun.elev.toFixed(2) : null, night: B ? +B.night.toFixed(3) : null, lamps: B ? +B.lamps.toFixed(3) : null, stars: B ? +B.stars.toFixed(3) : null, currentP: window.__todCurrentP };
    }, { p: R.p, idleMs: WAIT.regimeIdleMs });
    if (R.sunElev != null && rg.sunElev != null && Math.abs(rg.sunElev - R.sunElev) > 0.5)
      info.warnings.push(`regime ${g}: p ${R.p} gives sun ${rg.sunElev} deg in this build, routes file says ${R.sunElev}`);
    log(`[${side.key}] regime ${g} p=${R.p} sun ${rg.sunElev} deg (retint ${rg.applyMs} ms)`);
    for (const P of todo) {
      const st = await page.evaluate(async ({ cam, W }) => {
        const m = window.__map;
        const pose = { center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing };
        const t = performance.now();
        m.jumpTo(pose);
        if (window.__aeReset) window.__aeReset();
        const A = window.slopesApartments;
        while (performance.now() - t < W.tilesMs) {
          if (m.loaded() && m.areTilesLoaded() && (!A || A.readyToReveal())) break;
          await new Promise(r => setTimeout(r, 250));
        }
        const tilesOk = m.areTilesLoaded() && (!A || A.readyToReveal());
        await new Promise(r => { const k = setTimeout(r, W.idleMs); m.once('idle', () => { clearTimeout(k); r(); }); m.triggerRepaint(); });
        m.jumpTo(pose);
        await new Promise(r => setTimeout(r, W.settleMs));
        const e = window.__fly && window.__fly.eye ? window.__fly.eye() : null;
        // Which authored geometry is actually on screen at THIS camera. A pose with
        // no groups drawn is a pose --break cannot move, however red it goes elsewhere.
        let sl = null;
        try {
          const s = window.slopes && window.slopes.stats ? window.slopes.stats() : null;
          const gs = ((s && s.groups) || []).filter(g => g.visible);
          sl = { groups: gs.map(g => g.name), triangles: gs.reduce((a, g) => a + (g.triangles || 0), 0) };
        } catch (err) { sl = { error: String(err && err.message || err) }; }
        return { waitMs: Math.round(performance.now() - t), tilesOk, slopes: sl,
          got: { pitch: +m.getPitch().toFixed(2), bearing: +m.getBearing().toFixed(2), zoom: +m.getZoom().toFixed(3), eyeAlt: e ? +e.alt.toFixed(2) : null },
          ae: window.__ae ? window.__ae() : null, grade: document.getElementById('map') ? document.getElementById('map').style.filter : null };
      }, { cam: P.cam, W: WAIT });
      // Camera check.
      const want = { pitch: +P.cam.pitch.toFixed(2), zoom: +P.cam.zoom.toFixed(3), eyeAlt: P.cam.eyeAlt != null ? +P.cam.eyeAlt.toFixed(2) : null };
      const off = [];
      if (Math.abs(st.got.pitch - want.pitch) > CAMERA.pitchTol) off.push(`pitch ${st.got.pitch} vs ${want.pitch}`);
      if (want.eyeAlt != null && st.got.eyeAlt != null && Math.abs(st.got.eyeAlt - want.eyeAlt) > Math.max(CAMERA.altTolAbs, want.eyeAlt * CAMERA.altTolRel)) off.push(`eye ${st.got.eyeAlt} m vs ${want.eyeAlt} m`);
      if (want.eyeAlt == null && Math.abs(st.got.zoom - want.zoom) > CAMERA.zoomTol) off.push(`zoom ${st.got.zoom} vs ${want.zoom}`);
      // Screenshot twice, keep the second; re-shoot while the frame is still moving.
      const file = path.join(FRAMES, frameName(side.key, P, g));
      let prev = await page.screenshot({ type: 'jpeg', quality: JPEG_Q });
      await sleep(WAIT.secondShotMs);
      let cur = await page.screenshot({ type: 'jpeg', quality: JPEG_Q });
      let settle = await helper.evaluate(pageDiff, { a: prev.toString('base64'), b: cur.toString('base64'), D: { luma: SETTLE.luma, lumaBig: 64 } });
      let tries = 0;
      while (settle.pctOver > SETTLE.maxPct && tries < SETTLE.retries) {
        tries++;
        await sleep(SETTLE.waitMs);
        prev = cur; cur = await page.screenshot({ type: 'jpeg', quality: JPEG_Q });
        settle = await helper.evaluate(pageDiff, { a: prev.toString('base64'), b: cur.toString('base64'), D: { luma: SETTLE.luma, lumaBig: 64 } });
      }
      fs.writeFileSync(file, cur);
      const shot = { side: side.key, route: P.route, pose: P.pose, regime: g, p: R.p, sunElev: rg.sunElev, file: path.relative(OUT, file).split(path.sep).join('/'),
        camera: { want, got: st.got, ok: !off.length, off }, tilesOk: st.tilesOk, waitMs: st.waitMs, ae: st.ae, grade: st.grade, slopes: st.slopes,
        settle: { pctOver: settle.pctOver, retries: tries, settled: settle.pctOver <= SETTLE.maxPct } };
      shots.push(shot);
      log(`[${side.key}] ${g.padEnd(8)} ${P.key.padEnd(44)} ${off.length ? 'CAMERA OFF (' + off.join('; ') + ')' : 'camera ok'}${st.tilesOk ? '' : ', tiles NOT all loaded'}${shot.settle.settled ? '' : `, UNSETTLED ${settle.pctOver}%`} (${(st.waitMs / 1000).toFixed(1)} s)`);
    }
  }
  await helper.close();
  // The sabotage is only evidence if it held for every frame, not just for the
  // first repaint after it was applied.
  if (BREAK && side.key === 'B') {
    info.breakEnd = await breakCheck('end');
    const back = BREAK === 'slopes'
      ? (info.breakEnd.rootChildren && info.breakEnd.rootChildren.length) || info.breakEnd.drawnGroups.length || !info.breakEnd.addStubbed
      : info.breakEnd.inScene || info.breakEnd.drawnGroups.includes('slopes-apartments');
    if (back) {
      await page.close();
      return { info, fatal: `side B: --break ${BREAK} was undone during the shoot (at the end the scene holds [${(info.breakEnd.rootChildren || []).join(', ')}] and draws [${info.breakEnd.drawnGroups.join(', ')}]${BREAK === 'slopes' && !info.breakEnd.addStubbed ? ', and slopes.add is no longer stubbed' : ''}). The frames are not a sabotaged side and --same cannot be read from them.` };
    }
  }
  await page.close();
  return { info };
}

// ── Measuring, diffing and sheets (also the whole of --from) ────────────────
function refFor(P, g) {
  const rel = P.refs && P.refs[g];
  if (!rel) return null;
  const f = path.isAbsolute(rel) ? rel : path.join(REF_ROOT, rel);
  return fs.existsSync(f) ? f : { missing: f };
}
const dataURL = f => `data:${/\.png$/i.test(f) ? 'image/png' : 'image/jpeg'};base64,` + fs.readFileSync(f).toString('base64');
const fmt = v => v == null ? '-' : (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

async function analyse(helper, report) {
  const byKey = new Map();
  for (const s of report.shots) {
    const P = POSES.find(q => q.route === s.route && q.pose === s.pose);
    const regions = P ? P.regions : {};
    const buf = fs.readFileSync(path.join(OUT, s.file));
    // The bytes on disk, so a claim about them has an artifact. "24 of the 32 are
    // byte-identical JPEGs" was written about the A9 noise floor and no field in any
    // report could support it: it was true (re-measured 2026-09-20: 24 of 32 pairs
    // share a SHA-1, and 26 of 32 have meanAbs 0 — the two are different counts) but
    // it rested on a shell command in a lost scratch folder.
    s.frame = { bytes: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) };
    s.metrics = await helper.evaluate(pageMeasure, { b64: buf.toString('base64'), regions, M: MEASURE });
    // Carry the declared subject of each region into the metrics, and mark every
    // ratio that has a `basemap` region on either side of the division. Those are
    // readings of MapLibre's own extrusion or road under our lighting — real
    // numbers about the frame, and NOT numbers about the city we build.
    const subj = (P && P.subjects) || {};
    if (Object.keys(subj).length) s.metrics.regionSubjects = subj;
    s.metrics.ratiosBasemap = Object.keys(s.metrics.ratios || {}).filter(k => k.split('/').some(n => subj[n] === 'basemap'));
    s.blank = s.metrics.frame.luma.std < MEASURE.blankStd;
    byKey.set(`${s.side}|${s.route}/${s.pose}|${s.regime}`, s);
  }
  // A/B
  for (const s of report.shots) {
    if (s.side !== 'B') continue;
    const a = byKey.get(`A|${s.route}/${s.pose}|${s.regime}`);
    if (!a) continue;
    s.diffA = await helper.evaluate(pageDiff, { a: fs.readFileSync(path.join(OUT, a.file)).toString('base64'), b: fs.readFileSync(path.join(OUT, s.file)).toString('base64'), D: DIFF });
  }
  return byKey;
}

function tileLines(s, sideLabel) {
  if (!s) return ['(not shot)'];
  const m = s.metrics, L = [];
  L.push(`${sideLabel}  ${s.regime} p${s.p} sun ${s.sunElev}°`);
  const r = m.ratios;
  const small = new Set(m.ratiosSmall || []);
  const dark = new Set(m.ratiosDark || []);
  const base = new Set(m.ratiosBasemap || []);
  const rs = Object.entries(r).map(([k, v]) => `${k} ${fmt(v)}${small.has(k) ? '#' : ''}${dark.has(k) ? '~' : ''}${base.has(k) ? 'b' : ''}`).join('  ');
  L.push(`mean ${m.frame.luma.mean}  p99 ${m.frame.luma.p99}  win ${m.windows.pct}%${m.windows.fallback ? '*' : ''}${rs ? '  ' + rs : ''}`);
  if (m.windows.fallback) L.push('* no wall region: whole-frame count, not windows');
  if (dark.size) {
    L.push('~ denominator is sRGB code ' + [...dark].map(k => `${k.split('/')[1]} ${Math.round(m.regions[k.split('/')[1]].code)}`).filter((v, i, a) => a.indexOf(v) === i).join(', ') +
      ': ' + [...dark].map(k => `${k} ${fmt((m.ratioBands[k] || [])[0])}-${fmt((m.ratioBands[k] || [])[1])} at ±1 code`).join('; '));
  }
  if (m.smallRegions && m.smallRegions.length) {
    L.push(`# region under ${(MEASURE.minRegionFrac * 100).toFixed(0)}% of frame: ` +
      m.smallRegions.map(k => `${k} ${(m.regions[k].frac * 100).toFixed(2)}%`).join(', '));
  }
  if (s.diffA) L.push(`vs A: ${s.diffA.pctOver}% px >${DIFF.luma}  mean|d| ${s.diffA.meanAbs}`);
  if (!s.camera.ok) L.push('CAMERA OFF: ' + s.camera.off.join('; '));
  if (s.settle && !s.settle.settled) L.push(`UNSETTLED ${s.settle.pctOver}%`);
  return L;
}

async function sheets(helper, report, byKey) {
  const written = [];
  // Every third-party / owner photograph actually composited into a sheet by
  // THIS pass. None of these sheets may be committed, and the report is the only
  // record of it in the folder, so it is written down and a marker file goes in
  // beside them: a `--from` pass rewrites the sheets without touching the frames,
  // so "the frames were shot with --refs off" says nothing about the sheets.
  const refsUsed = new Set();
  // One column per SIDE, not per side RECORD: a --merge adds the other run's side
  // block (same key) so its build, reloads and warnings are not lost, and that must
  // not turn into a duplicate column. It did, once: a merged baseline drew side A
  // twice, 1132 px wide, and nothing in the sheet said why.
  const sides = [...new Set(report.sides.map(s => s.key))];
  const tileH = Math.round(TILE_W * VH / VW);
  const put = async (name, spec) => { const b64 = await helper.evaluate(pageSheet, spec); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); written.push(name); };
  // A --merge appends the other run's side blocks under the SAME key, so a bare
  // find() can hand back the merged run's label and build instead of this shoot's.
  // Prefer the record this shoot wrote; fall back to whatever is there.
  const sideRec = k => report.sides.find(x => x.key === k && !x.mergedFrom) || report.sides.find(x => x.key === k);
  const sideLabel = k => { const s = sideRec(k); return `${k}: ${s ? s.label : ''}`; };
  // per pose: rows = regimes, cols = sides (+ ref)
  for (const P of POSES) {
    const regs = REGIME_ORDER.filter(g => P.regimes.includes(g) && sides.some(k => byKey.get(`${k}|${P.key}|${g}`)));
    if (!regs.length) continue;
    const withRef = REFS_ON && regs.some(g => refFor(P, g));
    const colHeads = [...sides.map(sideLabel), ...(withRef ? ['reference (local, not committed)'] : [])];
    const rows = regs.map(g => {
      const tiles = sides.map(k => { const s = byKey.get(`${k}|${P.key}|${g}`); return { src: s ? dataURL(path.join(OUT, s.file)) : null, lines: tileLines(s, k) }; });
      if (withRef) {
        const f = refFor(P, g);
        if (f && typeof f === 'string') refsUsed.add(path.relative(REF_ROOT, f).split(path.sep).join('/'));
        tiles.push(f && typeof f === 'string' ? { src: dataURL(f), lines: [path.basename(f).slice(0, 70)] } : { src: null, lines: [f && f.missing ? 'missing: ' + path.basename(f.missing) : 'no reference for ' + g] });
      }
      return { head: '', tiles };
    });
    await put(`sheet-${slug(P.route)}-${slug(P.pose)}.jpg`, { title: `${P.key} — ${P.title || ''}`, colHeads, rows, tileW: TILE_W, tileH, q: SHEET_Q, rowHeadW: 0 });
  }
  // overview per side: rows = poses, cols = regimes
  const OV_ROWS = 8, ovW = Math.min(TILE_W, 400), ovH = Math.round(ovW * VH / VW);
  for (const k of sides) {
    const regs = REGIME_ORDER.filter(g => report.shots.some(s => s.side === k && s.regime === g));
    const poses = POSES.filter(P => report.shots.some(s => s.side === k && s.route === P.route && s.pose === P.pose));
    for (let i = 0, n = 1; i < poses.length; i += OV_ROWS, n++) {
      const rows = poses.slice(i, i + OV_ROWS).map(P => ({ head: P.route + '\n' + P.pose, tiles: regs.map(g => { const s = byKey.get(`${k}|${P.key}|${g}`); return { src: s ? dataURL(path.join(OUT, s.file)) : null, lines: s ? [`${g} p${s.p}  mean ${s.metrics.frame.luma.mean}  win ${s.metrics.windows.pct}%`] : ['(not shot)'] }; }) }));
      await put(`overview-${k}-${n}.jpg`, { title: `${sideLabel(k)} — ${report.when.slice(0, 16).replace('T', ' ')} — build ${((sideRec(k) || {}).build || {}).sha1 || '?'}`, colHeads: regs, rows, tileW: ovW, tileH: ovH, q: SHEET_Q, rowHeadW: 170 });
    }
  }
  if (SHOW_REGIONS) {
    // One render per pose PER REGIME, with a labelled grid and whatever regions the
    // pose has. Poses with no regions get one too: drawing them is the point, and
    // a rectangle has to hold at every regime, not just the one it was drawn on.
    const COL = { sky: '#4aa3ff', wall: '#ff5a4a', ground: '#5cd65c', water: '#3fe0e0' };
    const gw = Math.max(TILE_W, 1000), gh = Math.round(gw * VH / VW);
    for (const P of POSES) {
      const rects = Object.entries(P.regions).map(([n, r]) => [n, r, COL[n] || '#ffd24a']);
      // The geometry is the same at every regime, so one frame is enough to draw on:
      // take the brightest-lit regime available, where the silhouette reads best.
      const g = REGIME_ORDER.find(k => byKey.get(`A|${P.key}|${k}`));
      if (!g) continue;
      const s = byKey.get(`A|${P.key}|${g}`);
      await put(`regions-${slug(P.route)}-${slug(P.pose)}.jpg`,
        { title: `${P.key} — ${g} p${s.p} — 5% grid (x along the top, y down the left)${rects.length ? '' : ' — NO REGIONS YET'}`,
          colHeads: [''], rows: [{ head: '', tiles: [{ src: dataURL(path.join(OUT, s.file)), rects, grid: true, lines: [] }] }],
          tileW: gw, tileH: gh, q: 0.85, rowHeadW: 0 });
    }
  }
  report.referenceSheets = { refs: REFS_ON ? 'on' : 'off', composited: [...refsUsed].sort(),
    mayBeCommitted: refsUsed.size === 0,
    note: refsUsed.size ? 'sheet-*.jpg in this folder carry third-party or owner photographs. DO NOT COMMIT ANY SHEET FROM THIS FOLDER.' : 'no photograph was composited by this pass; the sheets are our renders only.' };
  const marker = path.join(OUT, 'DO-NOT-COMMIT.txt');
  if (refsUsed.size) fs.writeFileSync(marker, `night-compare.mjs composited ${refsUsed.size} reference photograph(s) into the sheets in this folder on ${new Date().toISOString()}:\n\n` + [...refsUsed].sort().map(r => '  ' + r).join('\n') + '\n\nDO NOT COMMIT sheet-*.jpg or overview-*.jpg from this folder. Cite the reference by path instead.\n');
  else if (fs.existsSync(marker)) fs.unlinkSync(marker);
  return written;
}

/**
 * Which MEASURED numbers moved between an A shot and its B, and which did not.
 * The measured numbers are exactly the ones the acceptance table and the sheets
 * quote: every region's median as an 8-bit sRGB code, every ratio, and the
 * bright-window share. Frame-wide means are deliberately NOT in here — at the
 * Capitol the frame mean moved by 0.1 while every region number stood still, and
 * a test that counted that as movement would have gone on passing.
 */
function measuredDelta(a, b, P) {
  if (!b || !a.metrics || !b.metrics) return { movedMeasured: null, unmovedMeasured: null };
  const subj = n => (P && P.subjects && P.subjects[n]) || null;
  const moved = [], still = [], authoredUnmoved = [], undeclaredUnmoved = [];
  const num = v => (v == null ? 'n/a' : String(v));
  for (const n of Object.keys(a.metrics.regions || {})) {
    const ra = a.metrics.regions[n], rb = (b.metrics.regions || {})[n];
    if (!rb) continue;
    const tag = subj(n) ? ` (${subj(n)})` : ' (subject undeclared)';
    if (Math.round(ra.code) !== Math.round(rb.code)) moved.push(`${n} code ${Math.round(ra.code)} -> ${Math.round(rb.code)}${tag}`);
    else {
      still.push(`${n} code ${Math.round(ra.code)}${tag}`);
      if (subj(n) === 'authored') authoredUnmoved.push(n);
      else if (!subj(n)) undeclaredUnmoved.push(n);
    }
  }
  for (const k of Object.keys(a.metrics.ratios || {})) {
    const va = a.metrics.ratios[k], vb = (b.metrics.ratios || {})[k];
    if (va !== vb) moved.push(`${k} ${num(va)} -> ${num(vb)}`); else still.push(`${k} ${num(va)}`);
  }
  const wa = (a.metrics.windows || {}).pct, wb = (b.metrics.windows || {}).pct;
  if (wa !== wb) moved.push(`windows ${num(wa)}% -> ${num(wb)}%`); else still.push(`windows ${num(wa)}%`);
  return { movedMeasured: moved, unmovedMeasured: still, authoredUnmoved, undeclaredUnmoved };
}

function summarise(report) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(pad('side', 5) + pad('regime', 9) + pad('route/pose', 44) + pad('mean', 7) + pad('p99', 5) + pad('win%', 8) + pad('wall/sky', 10) + pad('grnd/sky', 10) + pad('water/sky', 10) + 'vs A');
  let anyFallback = false, anySmall = false, anyDark = false, anyBase = false;
  for (const s of report.shots) {
    const m = s.metrics, r = m.ratios;
    const small = new Set(m.ratiosSmall || []);
    const dark = new Set(m.ratiosDark || []);
    const base = new Set(m.ratiosBasemap || []);
    const rf = k => fmt(r[k]) + (small.has(k) ? '#' : '') + (dark.has(k) ? '~' : '') + (base.has(k) ? 'b' : '');
    if (m.windows.fallback) anyFallback = true;
    if (m.smallRegions && m.smallRegions.length) anySmall = true;
    if (dark.size) anyDark = true;
    if (base.size) anyBase = true;
    lines.push(pad(s.side, 5) + pad(s.regime, 9) + pad(`${s.route}/${s.pose}`, 44) + pad(m.frame.luma.mean, 7) + pad(m.frame.luma.p99, 5) + pad(m.windows.pct + (m.windows.fallback ? '*' : ''), 9) +
      pad(rf('wall/sky'), 10) + pad(rf('ground/sky'), 10) + pad(rf('water/sky'), 10) + (s.diffA ? `${s.diffA.pctOver}% >${DIFF.luma}` : ''));
  }
  if (anyFallback) lines.push('* the pose has no `wall` region, so win% counts the whole frame (sky and pavement included). Not a window count.');
  if (anyBase) {
    lines.push('b marks a ratio with a region declared `basemap` in night-routes.json on one side of the division: MapLibre\'s own fill-extrusion or road, lit and graded by our style. It is a true reading of the frame and it is NOT a reading of geometry we author, so it cannot answer "how bright is our building".');
    const seen = new Set();
    for (const s of report.shots) {
      const k = `${s.route}/${s.pose}`, sub = s.metrics.regionSubjects;
      if (!sub || seen.has(k)) continue;
      seen.add(k);
      lines.push('    ' + pad(k, 44) + Object.entries(sub).map(([n, v]) => `${n}=${v}`).join(', '));
    }
  }
  if (anySmall) {
    lines.push(`# marks a ratio with a region under ${(MEASURE.minRegionFrac * 100).toFixed(0)}% of the frame on one side. Every small region, ratio or not (dome and tower are named features and are never divided):`);
    const seen = new Set();
    for (const s of report.shots) {
      const k = `${s.route}/${s.pose}`; const m = s.metrics;
      if (!m.smallRegions || !m.smallRegions.length || seen.has(k)) continue;
      seen.add(k);
      lines.push('    ' + pad(k, 44) + m.smallRegions.map(n => `${n} ${m.regions[n].n} px (${(m.regions[n].frac * 100).toFixed(2)}%)`).join(', '));
    }
  }
  if (anyDark) {
    lines.push(`~ marks a ratio whose DENOMINATOR median is under sRGB code ${MEASURE.minDenomCode} of 255. One code either way is the band in brackets, so the printed number is not three significant figures — it is not even one. This is the instrument, not the scene: at p = 1 the sky really is a few codes above black, and a ratio is the wrong way to ask the question there.`);
    for (const s of report.shots) {
      const m = s.metrics;
      if (!m.ratiosDark || !m.ratiosDark.length) continue;
      lines.push('    ' + pad(`${s.regime} ${s.route}/${s.pose}`, 50) + m.ratiosDark.map(k => {
        const b = m.ratioBands[k] || [];
        return `${k} ${fmt(m.ratios[k])} [${fmt(b[0])}-${fmt(b[1])}], ${k.split('/')[1]} code ${Math.round(m.regions[k.split('/')[1]].code)}`;
      }).join('; '));
    }
  }
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(path.join(OUT, 'log.txt'), t + '\n'); };
const nShots = SIDES.length * POSES.reduce((n, P) => n + P.regimes.length, 0);
const maxMs = FROM ? 20 * 60000 : Math.round(25 * 60000 + nShots * 60000);
const browser = await launch(chromium, { gl: GL, maxMs });
let exit = 0;
try {
  let report;
  if (FROM) {
    if (path.resolve(FROM) !== path.resolve(OUT)) die('--from re-measures in place: pass the same folder as --out');
    report = readJSON(path.join(OUT, 'report.json'));
    // PROVENANCE. `--from` used to overwrite `remeasured` and `routesFile` and
    // nothing else, so `args`, `when`, `gl`, `viewport`, `localOverlay` and
    // `harnessGit` still described the ORIGINAL shoot while the report and the
    // SHEETS in the folder were this pass's. That is not a cosmetic slip: a
    // `--from` run with references ON left `args: ... --refs off` sitting beside
    // sheets with fifteen third-party photographs composited into them, and this
    // report is the only in-folder record of whether a sheet may be committed
    // (it may not). So: the shoot's settings stay where they are and keep their
    // names — they are the truth about the FRAMES — and everything this pass
    // decided is written under `remeasure`, including the two that changed
    // meaning (routesFile and localOverlay pick the regions AND the references).
    report.remeasured = new Date().toISOString();
    report.remeasure = { when: report.remeasured, args: argv, harnessGit: gitInfo(), out: OUT, from: FROM,
      routesFile: ROUTES_FILE, localOverlay: localFile, refs: REFS_ON ? 'on' : 'off', tile: TILE_W,
      params: { MEASURE, DIFF },
      note: 'the top-level when/args/gl/viewport/harnessGit describe the SHOOT that made the frames; these describe the pass that measured them and rewrote the sheets.' };
    const oldRefs = report.refs || (() => { const a = report.args || []; const i = a.indexOf('--refs'); return i >= 0 && a[i + 1] === 'off' ? 'off' : 'on'; })();
    report.shoot = report.shoot || { when: report.when, args: report.args, harnessGit: report.harnessGit, gl: report.gl, viewport: report.viewport, routesFile: report.routesFile, localOverlay: report.localOverlay, refs: oldRefs };
    report.routesFile = ROUTES_FILE;
    report.localOverlay = localFile;
    // --merge: fold another run in, with its provenance, before measuring.
    if (MERGE) {
      const src = path.resolve(MERGE);
      const sr = readJSON(path.join(src, 'report.json'));
      const key = s => `${s.side}|${s.route}/${s.pose}|${s.regime}`;
      const here = new Map(report.shots.map(s => [key(s), s]));
      let copied = 0, replaced = 0, added = 0;
      const imported = [];
      for (const s of sr.shots || []) {
        const dst = path.join(OUT, s.file);
        if (!fs.existsSync(dst)) {
          const from = path.join(src, s.file);
          if (!fs.existsSync(from)) { log(`--merge: SKIPPED ${key(s)} — its frame is gone from ${src}`); continue; }
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(from, dst); copied++;
        }
        const tagged = Object.assign({}, s, { mergedFrom: src, mergedWhen: sr.when });
        if (here.has(key(s))) { report.shots[report.shots.indexOf(here.get(key(s)))] = tagged; replaced++; }
        else { report.shots.push(tagged); added++; }
        imported.push(key(s));
      }
      const regimes = [...new Set((sr.shots || []).map(s => s.regime))];
      for (const si of sr.sides || []) report.sides.push(Object.assign({}, si, { mergedFrom: src, mergedRegimes: regimes }));
      report.merged = (report.merged || []).concat([{ dir: src, when: sr.when, harnessGit: sr.harnessGit, args: sr.args,
        gl: sr.gl, viewport: sr.viewport, regimes, shots: imported.length, framesCopied: copied, replaced, added,
        note: 'these shots were made by that run, not by the one the top-level when/args/harnessGit describe; every one of them carries mergedFrom.' }]);
      if (report.mergedFrom) { report.mergedByHand = report.mergedFrom; delete report.mergedFrom;
        log('--merge: this report carried a hand-written `mergedFrom` key the tool never writes; it is kept as `mergedByHand` and the shots have been re-imported properly.'); }
      log(`--merge: ${imported.length} shots from ${src} (${regimes.join(', ')}); ${copied} frame(s) copied, ${replaced} replaced, ${added} added; its side block and settings are under report.merged[].`);
    }
    const keep = new Set(POSES.map(P => P.key));
    report.shots = report.shots.filter(s => keep.has(`${s.route}/${s.pose}`) && fs.existsSync(path.join(OUT, s.file)));
    // A report whose shots are not all accounted for by the run its top-level fields
    // describe is a report a reader will mis-attribute. Say so, in the file.
    const unaccounted = report.shots.filter(s => !s.mergedFrom).length;
    report.provenance = { shootWhen: (report.shoot || report).when, shootGit: (report.shoot || report).harnessGit,
      shotsFromThatShoot: unaccounted, shotsMergedIn: report.shots.length - unaccounted,
      note: report.shots.length - unaccounted ? 'shots with a `mergedFrom` were taken by a DIFFERENT run on a DIFFERENT harness commit; read report.merged[] before quoting any number as this shoot\'s.' : 'every shot in this report came from the shoot the top-level fields describe.' };
    log(`night-compare --from: re-measuring ${report.shots.length} frames in ${OUT}` + (report.provenance.shotsMergedIn ? ` (${report.provenance.shotsMergedIn} of them merged in from another run)` : ''));
  } else {
    report = { tool: 'scripts/verify/night-compare.mjs', when: new Date().toISOString(), harnessGit: gitInfo(), routesFile: ROUTES_FILE, localOverlay: localFile,
      refs: REFS_ON ? 'on' : 'off', tile: TILE_W, out: OUT, broken: BREAK || undefined,
      viewport: [VW, VH], viewportOverridden: VP_OVERRIDDEN, dpr: 1, gl: GL, args: argv, params: { WAIT, SETTLE, CAMERA, MEASURE, DIFF }, regimes: Object.fromEntries(REGIMES_USED.map(g => [g, CFG.regimes[g]])),
      sides: [], shots: [] };
    log(`night-compare: ${POSES.length} poses x regimes [${REGIMES_USED.join(', ')}] x ${SIDES.length} side(s) = ${nShots} shots; ${VW}x${VH}${VP_OVERRIDDEN ? ' (--viewport override; the regions were read off ' + (CFG.viewport || [1440, 900]).join('x') + ')' : ''}; gl ${GL}; out ${OUT}`);
    for (const side of SIDES) {
      const r = await shootSide(browser, side, report.shots, log);
      report.sides.push(r.info);
      if (r.fatal) { log('CANNOT RUN: ' + r.fatal); report.fatal = r.fatal; exit = 2; report.exit = exit; fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1)); break; }
    }
    // Shooting is the expensive half. Write the report before measuring, so that a
    // crash in the measuring half leaves a run that `--from` can pick up instead of
    // an orphaned folder of frames.
    if (!report.fatal) fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  }
  if (!report.fatal) {
    const helper = await browser.newPage({ viewport: { width: 64, height: 64 } });
    const byKey = await analyse(helper, report);
    report.sheets = await sheets(helper, report, byKey);
    await helper.close();
    // Verdicts.
    // A frame is uninterpretable for THREE reasons, not one. The camera miss was the
    // only one that reached this line; `tilesOk` was recorded per shot and then
    // dropped, so a pose whose basemap and authored sources had not arrived was
    // counted as a clean reading — and a missing layer makes every metric look
    // better, which is this repo's own law. See the header.
    const reasonsFor = s => {
      const r = [];
      if (s.blank) r.push('blank frame');
      if (!s.camera.ok) r.push(...s.camera.off);
      if (s.tilesOk === false) r.push(`tiles and/or the authored sources were NOT all loaded at this pose after ${(WAIT.tilesMs / 1000) | 0} s — a missing layer makes every number in this shot look better`);
      return r;
    };
    const bad = report.shots.filter(s => reasonsFor(s).length);
    const unsettled = report.shots.filter(s => s.settle && !s.settle.settled);
    const verdict = { uninterpretable: bad.map(s => `${s.side} ${s.regime} ${s.route}/${s.pose}: ${reasonsFor(s).join('; ')}`), unsettled: unsettled.map(s => `${s.side} ${s.regime} ${s.route}/${s.pose} ${s.settle.pctOver}%`) };
    if (bad.length) exit = 2;
    // An A/B run whose two sides did not reach the same STATE is not one measurement
    // taken twice, whatever the two frames look like and however red or green --same
    // comes back. The discriminator is recorded on both sides already — it just never
    // left the per-side record.
    const asym = [];
    // A --merge appends the other run's side blocks under the same key, so "the
    // shoot's own side A" is the record WITHOUT a mergedFrom. It used to be
    // whichever came first, which after a merge is not necessarily this shoot's.
    const sideRecs = k => report.sides.filter(s => s.key === k && !s.mergedFrom);
    const buildOf = k => { const [s] = sideRecs(k); return s && s.build && s.build.sha1 || null; };
    if (sideRecs('A').length === 1 && sideRecs('B').length === 1) {
      const [sa] = sideRecs('A'), [sb] = sideRecs('B');
      const path = s => `${s.authoredReloads || 0} reload(s)${s.authoredReenabled ? ' then the APARTMENTS.on poke (the path this file calls unreliable)' : ''}`;
      // The reload path discriminates between two BUILDS. In a --break run, and in
      // any run where both sides are served the same build, there is no second build
      // for it to discriminate: side B is simply shot second, on a machine that has
      // been busy for however long side A took, and it reloads more often for that
      // reason alone. Both canonical watched failures in scripts/verify/README.md
      // came back exit 2 on a loaded laptop from A 0 reloads vs B 2, with identical
      // build.sha1, identical triangle counts and tilesOk true on every shot. So the
      // rule is gated on the thing it is actually about.
      const sameBuild = buildOf('A') && buildOf('A') === buildOf('B');
      const sameSite = sa.site === sb.site;
      if (path(sa) !== path(sb)) {
        const msg = `the two sides reached a ready page by DIFFERENT routes: A took ${path(sa)} (ready in ${Math.round((sa.readyMs || 0) / 1000)} s), B took ${path(sb)} (ready in ${Math.round((sb.readyMs || 0) / 1000)} s). A rebuild landing after the one-shot regime retint leaves new meshes day-coloured, so this is a difference between the two SIDES and not between the two builds.`;
        if (sameBuild && sameSite) {
          verdict.loadAsymmetryWarning = [`${msg} DEMOTED TO A WARNING: both sides were served the same build (${buildOf('A')}) from the same site, so there is no second build for the reload path to be evidence about — and side B, shot second on a machine side A has just loaded twice, reloads more often for that reason alone. Read the per-shot tilesOk instead.`];
        } else asym.push(msg);
      }
    }
    // Both sides served the same site and the same query, and the fingerprint of the
    // build they were served is NOT the same: a rebuild landed between side A and
    // side B and the run is comparing two builds while calling them one. This has
    // happened once and was caught by hand, off the overview sheet.
    // The side blocks, not the CLI: a `--from` re-measure of a kept report has to be
    // able to reach this verdict too, and its own argv carries no --b at all.
    if (sideRecs('A').length === 1 && sideRecs('B').length === 1) {
      const [sa] = sideRecs('A'), [sb] = sideRecs('B');
      if (sa.site === sb.site && (sa.query || '') === (sb.query || '')
          && buildOf('A') && buildOf('B') && buildOf('A') !== buildOf('B')) {
        asym.push(`both sides were shot against ${sa.site}${sa.query || ' (as shipped)'} and were served DIFFERENT builds: A ${buildOf('A')}, B ${buildOf('B')}. A rebuild landed in the served checkout between the two sides, so whatever this run measured, it is not the difference the flags describe. build.sha1 is the fingerprint of index.html plus every local script it loads.`);
      }
    }
    for (const a of report.shots.filter(s => s.side === 'A')) {
      const b = report.shots.find(s => s.side === 'B' && s.route === a.route && s.pose === a.pose && s.regime === a.regime);
      if (b && a.tilesOk !== b.tilesOk && (a.tilesOk === false || b.tilesOk === false))
        asym.push(`${a.regime} ${a.route}/${a.pose}: tiles/authored sources loaded on ${a.tilesOk ? 'A' : 'B'} but NOT on ${a.tilesOk ? 'B' : 'A'}. Whatever this pair measures, it is that difference.`);
    }
    if (asym.length) {
      verdict.loadAsymmetry = asym;
      verdict.uninterpretable.push(...asym.map(m => 'LOAD ASYMMETRY: ' + m));
      exit = 2;
    }
    const pairs = report.shots.filter(s => s.diffA);
    if (pairs.length) {
      const d = pairs.map(s => s.diffA.pctOver);
      verdict.abDiff = { frames: pairs.length, pctOverMin: Math.min(...d), pctOverMedian: d.slice().sort((a, b) => a - b)[d.length >> 1], pctOverMax: Math.max(...d) };
      // Two different counts that have been quoted as one. A pair can decode to the
      // same pixels and still encode to different bytes, and it does: in the A9
      // noise floor, 26 of 32 pairs have meanAbs 0 and only 24 share a SHA-1.
      const byteSame = pairs.filter(s => { const a = report.shots.find(x => x.side === 'A' && x.route === s.route && x.pose === s.pose && x.regime === s.regime); return a && a.frame && s.frame && a.frame.sha1 === s.frame.sha1; });
      verdict.abDiff.byteIdenticalPairs = pairs.every(s => s.frame) ? byteSame.length : null;
      verdict.abDiff.meanAbsZeroPairs = pairs.filter(s => s.diffA.meanAbs === 0).length;
    }
    if (SAME != null) {
      const over = pairs.filter(s => s.diffA.pctOver >= SAME);
      verdict.same = { tolPct: SAME, failing: over.map(s => `${s.regime} ${s.route}/${s.pose} ${s.diffA.pctOver}%`) };
      if (!pairs.length) { verdict.same.error = 'no A/B pairs to compare'; exit = Math.max(exit, 2); }
      else if (over.length && exit === 0) exit = 1;
      // Exit codes are scalar and 2 ("cannot interpret") outranks 1 ("--same
      // failed"), so a run that does both reports only the 2. Say so in the
      // report and in the log rather than letting the regression hide behind it.
      else if (over.length && exit === 2) {
        verdict.same.maskedByExitCode = 'exit 2 (cannot interpret) outranks exit 1, so this --same FAILURE is not in the exit code — read verdict.same.failing';
      }
    }
    // Which poses the sabotage could even reach. A pose with no slopes groups drawn
    // on side A is a pose where --break is a measured no-op: --same has not been
    // shown able to go red there, whatever it did elsewhere in the same run.
    if (report.broken) {
      const bySide = k => report.shots.filter(s => s.side === k);
      // `--break` took no mode before 2026-09-20, so an older report carries
      // `broken: true`. Say which sabotage that was rather than printing `true`.
      const mode = report.broken === true ? 'apartments (this run predates --break taking a mode)' : report.broken;
      verdict.breakCoverage = { mode, poses: bySide('A').map(a => {
        const b = report.shots.find(s => s.side === 'B' && s.route === a.route && s.pose === a.pose && s.regime === a.regime);
        const diff = b && b.diffA ? b.diffA.pctOver : (a.diffA ? a.diffA.pctOver : null);
        // The per-shot `slopes` block is younger than some of these frames. "No
        // groups drawn" and "nobody recorded which groups were drawn" are opposite
        // facts and must not print the same: an empty list here would read as a pose
        // the sabotage could not touch.
        const rec = !!(a.slopes && (a.slopes.groups || a.slopes.error));
        const e = { pose: `${a.route}/${a.pose}`, regime: a.regime,
          slopesRecorded: rec, groupsDrawnA: rec ? (a.slopes.groups || []) : null,
          trianglesA: rec ? (a.slopes.triangles ?? null) : null, pctOver: diff,
          reached: diff != null && SAME != null ? diff >= SAME : null };
        // WHICH measured numbers the sabotage moved. `pctOver` counts PIXELS; the
        // acceptance table is written in region medians, ratios and the bright-window
        // share, and those are a different question. At the two Capitol poses the
        // pixel count said the sabotage landed (0.172% and 0.308%, both over
        // tolerance) while every region code, every ratio and the window share came
        // back bit-identical — because the wall, ground and sky rectangles were on
        // MapLibre's extrusions and road, not on ours. Five runs passed over that.
        Object.assign(e, measuredDelta(a, b, POSES.find(P => P.key === e.pose)));
        return e;
      }) };
      if (verdict.breakCoverage.poses.some(p => !p.slopesRecorded))
        verdict.breakCoverage.note = 'some of these frames were shot before night-compare recorded the per-shot `slopes` block, so `groupsDrawnA` is null — NOT an empty list. For those poses `pctOver` is the whole of the evidence: it is the measured share of the frame the sabotage moved, which is the thing that decides coverage anyway.';
      const noop = verdict.breakCoverage.poses.filter(p => p.reached === false);
      if (noop.length) verdict.breakCoverage.noOpAt = noop.map(p => `${p.regime} ${p.pose} ${p.pctOver}% (drawn: ${p.slopesRecorded ? (p.groupsDrawnA.join(', ') || 'nothing') : 'not recorded in this run'})`);
      // The instrument check. A pose where the sabotage moved pixels past tolerance
      // and NOT ONE measured number is a pose whose rectangles are not on the
      // geometry that was removed, whatever the exit code says about --same.
      const blind = verdict.breakCoverage.poses.filter(p => p.reached === true && p.movedMeasured && !p.movedMeasured.length);
      if (blind.length) {
        verdict.breakCoverage.measuredNothingAt = blind.map(p =>
          `${p.regime} ${p.pose}: the sabotage moved ${p.pctOver}% of the PIXELS and NOT ONE measured number — every region median, every ratio and the bright-window share are identical A to B. The rectangles at this pose are not on the geometry --break ${mode} removed. Unmoved: ${p.unmovedMeasured.join('; ')}`);
        verdict.uninterpretable.push(...verdict.breakCoverage.measuredNothingAt.map(m => 'BREAK MEASURED NOTHING: ' + m));
        exit = 2;
      }
      // A region DECLARED `authored` that survives `--break slopes` is either
      // mis-declared or mis-aimed. Only `slopes` empties the whole authored scene,
      // so only `slopes` can make this claim.
      if (mode === 'slopes') {
        const off = [];
        for (const p of verdict.breakCoverage.poses) for (const r of (p.authoredUnmoved || []))
          off.push(`${p.regime} ${p.pose}: region "${r}" is declared subject "authored" in night-routes.json and did not move when the whole slopes scene was removed`);
        if (off.length) {
          verdict.breakCoverage.authoredRegionsNotOnSubject = off;
          verdict.uninterpretable.push(...off.map(m => 'REGION OFF ITS SUBJECT: ' + m));
          exit = 2;
        }
      }
      const undecl = new Set();
      for (const p of verdict.breakCoverage.poses) for (const r of (p.undeclaredUnmoved || [])) undecl.add(`${p.pose}.${r}`);
      if (undecl.size) verdict.breakCoverage.undeclaredAndUnmoved = { regions: [...undecl].sort(),
        note: 'these regions have no `regionSubjects` entry in night-routes.json and did not move under this sabotage. That is either correct (they are on the basemap or the sky) or the defect this block exists to catch. Declare them once you know which.' };
    }
    report.verdict = verdict;
    // The exit code is the verdict. It belongs IN the artifact, not only in a
    // log.txt nobody commits: a kept report that a table calls "exit 0" should say
    // so itself.
    report.exit = exit;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    log('\n' + summarise(report));
    for (const s of report.sides) for (const w of s.warnings || []) log(`WARNING [${s.key}] ${w}`);
    for (const s of report.sides) if (s.pageErrors && s.pageErrors.length) log(`[${s.key}] ${s.pageErrors.length} page errors (first: ${s.pageErrors[0]})`);
    if (verdict.unsettled.length) log(`WARNING ${verdict.unsettled.length} frame(s) still changing after ${SETTLE.retries} re-shoots: ${verdict.unsettled.join(', ')}`);
    if (verdict.abDiff) log(`A/B: % of pixels differing by >${DIFF.luma} luma per frame: min ${verdict.abDiff.pctOverMin}, median ${verdict.abDiff.pctOverMedian}, max ${verdict.abDiff.pctOverMax} (${verdict.abDiff.frames} frames); ${verdict.abDiff.meanAbsZeroPairs} pair(s) with mean|d| 0, ${verdict.abDiff.byteIdenticalPairs == null ? '?' : verdict.abDiff.byteIdenticalPairs} byte-identical`);
    if (bad.length) log(`CANNOT INTERPRET ${bad.length} frame(s): ${bad.map(s => `${s.side} ${s.regime} ${s.route}/${s.pose}: ${reasonsFor(s).join('; ')}`).join(' | ')}`);
    if (verdict.loadAsymmetry) log(`LOAD ASYMMETRY (exit 2 — this is not an A/B measurement): ${verdict.loadAsymmetry.join(' | ')}`);
    if (verdict.loadAsymmetryWarning) log(`WARNING load asymmetry, same build both sides (NOT exit 2): ${verdict.loadAsymmetryWarning.join(' | ')}`);
    if (SAME != null) log(verdict.same.failing.length ? `FAIL --same ${SAME}%: ${verdict.same.failing.length} frame(s) differ: ${verdict.same.failing.join(', ')}` : (pairs.length ? `PASS --same ${SAME}%: every A/B frame within tolerance` : 'CANNOT RUN --same: no pairs'));
    if (verdict.same && verdict.same.maskedByExitCode) log(`NOTE ${verdict.same.maskedByExitCode}`);
    if (verdict.breakCoverage) {
      const reached = verdict.breakCoverage.poses.filter(p => p.reached === true).length;
      log(`--break coverage: the sabotage moved ${reached} of ${verdict.breakCoverage.poses.length} (pose, regime) frames past --same`);
      for (const p of verdict.breakCoverage.poses) {
        if (!p.movedMeasured) continue;
        log(`  ${p.regime} ${p.pose}: pixels ${p.pctOver}% | measured numbers MOVED ${p.movedMeasured.length}/${p.movedMeasured.length + p.unmovedMeasured.length}` +
          (p.movedMeasured.length ? `: ${p.movedMeasured.join('; ')}` : '') +
          (p.unmovedMeasured.length ? `\n      still: ${p.unmovedMeasured.join('; ')}` : ''));
      }
      if (verdict.breakCoverage.noOpAt) log(`  NO-OP (--same cannot be shown able to fail here): ${verdict.breakCoverage.noOpAt.join(' | ')}`);
      if (verdict.breakCoverage.measuredNothingAt) log(`  THE SABOTAGE MOVED NO MEASURED NUMBER AT THIS POSE (exit 2 — the instrument, not the scene): ${verdict.breakCoverage.measuredNothingAt.join(' | ')}`);
      if (verdict.breakCoverage.authoredRegionsNotOnSubject) log(`  REGION OFF ITS SUBJECT (exit 2): ${verdict.breakCoverage.authoredRegionsNotOnSubject.join(' | ')}`);
      if (verdict.breakCoverage.undeclaredAndUnmoved) log(`  undeclared and unmoved (declare regionSubjects or re-aim): ${verdict.breakCoverage.undeclaredAndUnmoved.regions.join(', ')}`);
    }
    log(`sheets: ${report.sheets.length} in ${OUT}; report: ${path.join(OUT, 'report.json')}; exit ${exit}`);
  }
} catch (e) {
  console.error('night-compare: ' + (e && e.stack || e));
  exit = 2;
} finally {
  await browser.__done();
}
process.exit(exit);
