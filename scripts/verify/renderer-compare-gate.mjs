// The custom-renderer study's picture gate must be able to FAIL. No browser, no GPU: about two seconds.
//
// WHY. experiments/renderer/compare.mjs (the "automated comparison test" of docs/custom-renderer-study-2026-10-09.md) had no exit
// code, no threshold and a cache keyed by pose name alone, so "all three planted breaks caught" rested on a person reading numbers.
// Its pure parts (lib/images.mjs: the metrics; lib/verdict.mjs: numbers -> PASS/FAIL; lib/appkey.mjs: the cache key) are held here
// with small synthetic pictures that stand in for the real renders:
//   * a clean prototype passes (including a little rendering noise, like the Mac's 0.15%);
//   * the three planted breaks FAIL: light (sun on the wrong side), quant (silhouette moved), facet (a small patch of roofs shaded
//     wrong, built to sit near the study's 1.6% of building pixels, below the SSIM and silhouette limits, so only the pixel-count limit can catch it);
//   * the app compared with itself reads exactly 0 and passes;
//   * a view with no buildings FAILS loudly (it used to be dropped from the mean); a missing picture FAILS; night views are exempt
//     but must still show buildings;
//   * the app-picture key changes with the commit, an uncommitted edit, the flags, the viewport and the cameras.
// What this does NOT prove: that real renders land at these numbers (that needs the GPU run), only that the gate reads them correctly.
//
//   node scripts/verify/renderer-compare-gate.mjs            exit 0 = all of the above
//   node scripts/verify/renderer-compare-gate.mjs --break    loosens every limit to "anything goes": the planted breaks then PASS, so this must exit 1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lib = f => import(pathToFileURL(path.join(REPO, 'experiments/renderer/lib', f)).href);
const { compareImages, LOOK } = await lib('images.mjs');
const { LIMITS, EXEMPT_VIEWS, verdict } = await lib('verdict.mjs');
const { appKey } = await lib('appkey.mjs');
const BREAK = process.argv.includes('--break');

let failed = 0;
const say = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };

// ── synthetic pictures: 640x400, magenta background, nine buildings drawn as a lit left wall, a darker right wall and a roof ──────────
const W = 640, H = 400;
const BG = LOOK.bg;
function building(i) { const col = i % 3, row = (i / 3) | 0; return { x: 40 + col * 200, y: 40 + row * 120, w: 120, h: 80 }; }
function render({ light = false, shift = 0, roofPatch = false, noise = false } = {}) {
  const rgb = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) rgb.set(BG, i * 3);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; rgb.set(c, (y * W + x) * 3); };
  for (let b = 0; b < 9; b++) {
    const r = building(b), x0 = r.x + shift, y0 = r.y;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const roof = y < 24, left = x < r.w / 2;
      // smooth shading so the structural metric has texture to compare, not flat blocks
      const g = 0.85 + 0.15 * Math.sin((x + y * 0.7 + b * 13) / 9);
      let c;
      if (roof) c = [170, 165, 150];
      else { const lit = light ? !left : left; c = lit ? [200, 120, 70] : [90, 55, 40]; }
      let px = c.map(v => Math.max(0, Math.min(255, Math.round(v * g))));
      if (roofPatch && roof && b < 3 && x >= 20 && x < 40) px = [px[0] + 28, px[1] + 28, px[2] + 28];   // "a few roof faces", ~1.6% of all building pixels
      if (noise && ((x * 7 + y * 13 + b * 5) % 700 === 0)) px = [px[0] + 20, px[1], px[2]];            // sparse rendering noise: a few hundredths of a percent
      put(x0 + x, y0 + y, px);
    }
  }
  return { width: W, height: H, rgb };
}
const app = render();
const row = (name, proto, base = app) => ({ name, ...compareImages(base, proto) });

const clean = row('spawn-day', render({ noise: true }));
const light = row('spawn-day', render({ light: true }));
const quant = row('spawn-day', render({ shift: 5 }));
const facet = row('spawn-day', render({ roofPatch: true }));
const same = row('spawn-day', render());
console.log('clean ', JSON.stringify({ over: clean.pctOverOnBuildings, ssim: clean.ssim, iou: clean.silhouetteIoU, abs: clean.meanAbsDiffOnBuildings }));
console.log('light ', JSON.stringify({ over: light.pctOverOnBuildings, ssim: light.ssim, iou: light.silhouetteIoU, abs: light.meanAbsDiffOnBuildings }));
console.log('quant ', JSON.stringify({ over: quant.pctOverOnBuildings, ssim: quant.ssim, iou: quant.silhouetteIoU, abs: quant.meanAbsDiffOnBuildings }));
console.log('facet ', JSON.stringify({ over: facet.pctOverOnBuildings, ssim: facet.ssim, iou: facet.silhouetteIoU, abs: facet.meanAbsDiffOnBuildings }));

const limits = BREAK ? { maxPctOverOnBuildings: 1e9, minSsim: -1e9, minSilhouetteIoU: -1e9, maxMeanAbsDiff: 1e9, minBuildingPct: LIMITS.minBuildingPct } : LIMITS;
const V = (rows, ex = EXEMPT_VIEWS) => verdict(rows, limits, ex);

say(same.pctOverOnBuildings === 0 && same.silhouetteIoU === 1 && same.meanAbsDiffOnBuildings === 0 && same.ssim === 1, 'the app against the app reads exactly 0 over tolerance, IoU 1, SSIM 1');
say(V([same, { ...same, name: 'tower-day' }]).ok, 'the app against the app passes');
const vc = V([clean]);
say(vc.ok, `a clean prototype with a little rendering noise (${clean.pctOverOnBuildings}% over) passes`);
for (const [name, r, why] of [['light', light, 'the pixel limit and SSIM'], ['quant', quant, 'the pixel limit, SSIM and the silhouette'], ['facet', facet, 'the pixel limit only']]) {
  const v = V([r]);
  say(!v.ok, `the "${name}" break FAILS (${v.failures.length} limit${v.failures.length === 1 ? '' : 's'} tripped: ${v.failures.map(f => f.split(': ')[1].split(' (')[0]).join('; ') || 'none'}; expected ${why})`);
}
say(facet.silhouetteIoU === 1 && facet.ssim >= LIMITS.minSsim && facet.pctOverOnBuildings > LIMITS.maxPctOverOnBuildings && facet.pctOverOnBuildings < 4, `the facet break is the subtle kind: IoU ${facet.silhouetteIoU}, SSIM ${facet.ssim}, but ${facet.pctOverOnBuildings}% over (the study's facet break read 1.6)`);

// loud failures
const emptyImg = { width: W, height: H, rgb: (() => { const a = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) a.set(BG, i * 3); return a; })() };
const empty = { name: 'downtown-day', ...compareImages(emptyImg, emptyImg) };
const ve = V([clean, empty]);
say(!ve.ok && ve.failures.some(f => /EMPTY VIEW/.test(f) && f.startsWith('downtown-day')), 'a view with no buildings FAILS loudly, even next to a passing one (it used to be skipped in the mean)');
say(!V([clean, { name: 'capitol-day', error: 'missing picture' }]).ok, 'a missing picture FAILS');
say(!V([]).ok, 'no views at all FAILS');
const night = { name: 'spawn-night', ...compareImages(app, render({ light: true, shift: 5 })) };
say(V([clean, night]).ok && V([clean, night]).exempt.includes('spawn-night'), 'a night view is exempt from the limits (the night lamps are not ported) ...');
say(!V([clean, { name: 'tower-night', ...compareImages(emptyImg, emptyImg) }]).ok, '... but must still show buildings');
say(!V([night]).ok, 'if ONLY exempt views were scored, that FAILS (nothing was checked)');

// the app-picture key
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appkey-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); fs.mkdirSync(path.join(dir, 'js')); fs.writeFileSync(path.join(dir, 'js/a.js'), 'one'); g('add', '-A'); g('commit', '-q', '-m', 'one');
  const poses = [{ name: 'a', center: [0, 0], zoom: 17, pitch: 60, bearing: 0, p: 0.3 }];
  const base = { repo: dir, query: 'q=1', viewport: { width: 1440, height: 900 }, software: true, poses };
  const k0 = appKey(base).key;
  const diff = (label, k) => say(k !== k0, `the app-picture key changes with ${label}`);
  say(appKey(base).key === k0 && appKey(base).dirty === false, 'the key is stable for the same app');
  diff('the flags', appKey({ ...base, query: 'q=2' }).key);
  diff('the viewport', appKey({ ...base, viewport: { width: 1280, height: 800 } }).key);
  diff('software vs hardware GL', appKey({ ...base, software: false }).key);
  diff('a camera', appKey({ ...base, poses: [{ ...poses[0], zoom: 18 }] }).key);
  fs.writeFileSync(path.join(dir, 'js/a.js'), 'edited');
  const kd = appKey(base); say(kd.key !== k0 && kd.dirty === true, 'the key changes with an UNCOMMITTED edit under js/, and says so (dirty)');
  g('commit', '-q', '-am', 'two'); say(appKey(base).key !== k0 && appKey(base).key !== kd.key, 'and with a new commit');
  fs.writeFileSync(path.join(dir, 'js/new.js'), 'x'); const ku = appKey(base).key; fs.writeFileSync(path.join(dir, 'js/new.js'), 'y');
  say(appKey(base).key !== ku, 'an untracked file under js/ counts, and so does editing it');
  let threw = false; try { appKey({ ...base, repo: os.tmpdir() }); } catch (e) { threw = /git commit/.test(String(e.message)); }
  say(threw, 'a checkout whose commit cannot be read refuses to key instead of guessing');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\nFAIL: ${failed} check(s) failed${BREAK ? ' (--break: this is the expected result)' : ''}` : '\nPASS: the comparison gate passes a clean prototype, fails the planted breaks and the empty view, and keys the app pictures');
process.exit(failed ? 1 : 0);
