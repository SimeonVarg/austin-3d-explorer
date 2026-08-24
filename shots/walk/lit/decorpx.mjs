/**
 * decorpx.mjs — how much light is in the disc that no surveyed lamp explains,
 * measured at a bar that is CALIBRATED rather than guessed.
 *
 * WHY THIS IS A SEPARATE SCRIPT. `pinpose.mjs` carries a `discWarmDecor`
 * counter, and looking at its frames killed it: it reported 5,279 "decoration"
 * pixels at a pin whose frame is a black tree-lined path with no light in it at
 * all (`r6-pin-02-plan.png`). The test was `R >= 60 && R > G > B && R-B >= 25`,
 * and at night this city's own GROUND is a warm dark brown that passes it. A
 * warm-tinted surface is not light. The number was measuring the palette.
 *
 * So the bar is set by CALIBRATION, not by taste, and it is set on this lane's
 * own already-measured populations:
 *
 *   FLOOR   the brightest pixel found in the disc at a site where `pinpose`'s
 *           props-lit mask scored zero lamp pixels AND the frame is visibly
 *           dark. Anything at or below this is surface, not light.
 *   PROOF   a site where the mask scored thousands of lamp pixels must come
 *           back well ABOVE the bar, or the bar is excluding real light too.
 *
 * A pixel counts as LIGHT here if it is warm (R > G > B, R-B >= `WARM_SPREAD`)
 * and bright (R >= `BRIGHT_MIN`), and it counts as DECORATION if it is light and
 * the props-lit diff did not account for it — which `pinpose.json` already
 * records per site as `discGreen`.
 *
 * THE DISC IS RECOVERED FROM THE FRAME, not recomputed. Every plan frame
 * `pinpose.mjs` saves has the disc drawn on it as a closed magenta curve
 * (#ff2fd6) — so the region is a flood fill from the crosshair out to that
 * curve, which is exactly the region the pixel numbers were taken over, rather
 * than a second guess at the projection. Eye frames carry no curve and are not
 * measured here, for the reason §43 gives.
 *
 * No map, no server: it decodes PNGs in a blank page's canvas.
 *
 * Usage: node shots/walk/lit/decorpx.mjs [framesDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const DIR = process.argv[2] || process.env.VERIFY_FRAMES || OUT;
const BRIGHT_MIN = 110;   // calibrated below and asserted against both populations
const WARM_SPREAD = 45;
// THE APP'S OWN HUD IS WARM AND BRIGHT AND IT IS INSIDE THE DISC. The joystick
// ring, the BOOST button, the time-of-day knob and the amber hint bar all pass
// any "warm and bright" test, and the first run of this script scored ~3,000 px
// of "unexplained light" at a pin whose frame is visibly black — that was the
// controls, counted as streetlight. Excluded by rectangle, in the 960x600 frame
// `pinpose.mjs` writes, and the exclusion is CHECKED: the black-frame control
// below must come back at or near zero or the rectangles are wrong.
const HUD = [
  [0, 400, 180, 600],     // joystick, bottom left
  [820, 420, 960, 545],   // BOOST, bottom right
  [875, 140, 960, 460],   // the time-of-day slider
  [840, 0, 960, 70],      // the two round buttons, top right
  [0, 540, 960, 600],     // the hint bar and the attribution line
];
// A frame this lane has LOOKED at and agreed is black: r6-pin-02-plan.png, a
// tree-lined path with no light in it. It is the control, not an example.
const BLACK_CONTROL = 'r6-pin-02-plan.png';

const J = JSON.parse(fs.readFileSync(`${OUT}/pinpose.json`, 'utf8'));
const plan = J.rows.filter(r => r.pose === 'plan');
console.log(`${plan.length} plan frames from ${DIR}`);

const browser = await launch(chromium, { maxMs: 600000 });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto('about:blank');

const rows = [];
for (const r of plan) {
  const f = path.join(DIR, r.frame);
  if (!fs.existsSync(f)) { console.log(`  missing ${r.frame}`); continue; }
  const hud = HUD;
  const b64 = fs.readFileSync(f).toString('base64');
  const m = await page.evaluate(async ([data, brightMin, warmSpread, hud]) => {
    const im = await new Promise(res => { const q = new Image(); q.onload = () => res(q); q.src = 'data:image/png;base64,' + data; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const W = im.width, H = im.height;
    const d = g.getImageData(0, 0, W, H).data;
    // the magenta curve pinpose drew, and the crosshair at its centre
    const isEdge = (i) => d[i] > 220 && d[i + 1] < 90 && d[i + 2] > 170;
    const seen = new Uint8Array(W * H);
    // SEED OFF THE CROSSHAIR. The first cut started the fill at the exact frame
    // centre — which is where `pinpose.mjs` draws its magenta crosshair, so the
    // seed pixel was an edge pixel, the stack emptied on the first pop, and
    // every disc came back 0 px with every count 0. A clean, total, silent
    // zero: the flood fill was never inside anything. So the seed spirals out
    // until it finds a pixel that is not part of the drawn overlay.
    let seed = -1;
    for (let r = 12; r < 90 && seed < 0; r += 6) {
      for (const [dx, dy] of [[r, r], [-r, r], [r, -r], [-r, -r], [r, 0], [0, r], [-r, 0], [0, -r]]) {
        const x = Math.round(W / 2) + dx, y = Math.round(H / 2) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (isEdge((y * W + x) * 4)) continue;
        seed = y * W + x; break;
      }
    }
    if (seed < 0) return { discPx: 0, light: 0, warmAny: 0, maxWarmR: 0, escaped: false, noSeed: true };
    const stack = [seed];
    let discPx = 0, light = 0, maxLum = 0, warmBright = 0, hudPx = 0;
    // A flood fill that escapes means the curve is not closed in this frame —
    // reported rather than silently returning the whole screen.
    let escaped = false;
    while (stack.length) {
      const p = stack.pop();
      if (p < 0 || p >= W * H || seen[p]) continue;
      const i = p * 4;
      if (isEdge(i)) { seen[p] = 1; continue; }
      seen[p] = 1;
      const x = p % W, y = (p - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) escaped = true;
      discPx++;
      const inHud = hud.some(h => x >= h[0] && y >= h[1] && x < h[2] && y < h[3]);
      if (inHud) { hudPx++; }
      else {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        if (R > G && G > B && R - B >= warmSpread) {
          warmBright++;
          if (R >= brightMin) light++;
          if (R > maxLum) maxLum = R;
        }
      }
      if (x > 0) stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W);
      if (y < H - 1) stack.push(p + W);
    }
    return { discPx, hudPx, light, warmAny: warmBright, maxWarmR: maxLum, escaped };
  }, [b64, BRIGHT_MIN, WARM_SPREAD, hud]);
  rows.push({ kind: r.kind, i: r.i, from: r.from, to: r.to, d: r.d, note: r.note,
    frame: r.frame, lampPx: r.discGreen, ...m,
    decorPx: r.discGreen >= 200 ? Math.max(0, m.light - r.discGreen) : m.light });
}
await browser.close();

// ── calibration, printed so the bar can be argued with ────────────────────
const dark = rows.filter(r => r.lampPx === 0);
const lit = rows.filter(r => r.lampPx >= 1000);
console.log('\n# calibration');
console.log(`  brightest WARM red in a disc the mask scored as having NO lamp: ${Math.max(0, ...dark.map(r => r.maxWarmR))}`);
console.log(`  brightest WARM red in a disc with a real lamp pool in it:       ${Math.max(0, ...lit.map(r => r.maxWarmR))}`);
console.log(`  bar in use: R >= ${BRIGHT_MIN} and R-B >= ${WARM_SPREAD}`);
// The plan disc at z19.8 is LARGER than the 960x600 frame, so the drawn curve
// leaves the picture and the fill reaches the edge at every site. That is the
// disc being clipped, not the fill leaking: the region measured is "the part of
// the disc that is on screen", which is the same region every pixel number in
// this document has ever been taken over.
console.log(`  frames where the disc runs off the picture (expected at z19.8): ${rows.filter(r => r.escaped).length} / ${rows.length}`);
const ctl = rows.find(r => r.frame === BLACK_CONTROL) || null;
console.log(`  THE BLACK-FRAME CONTROL, ${BLACK_CONTROL}: ${ctl ? ctl.light : '?'} px of light` +
  `   ${ctl && ctl.light < 200 ? '(a frame this lane looked at and called black reads as black)' : '*THE HUD RECTANGLES ARE WRONG*'}`);
const proof = lit.filter(r => r.light >= 200).length;
console.log(`  sites with a real lamp pool that still pass the bar:            ${proof} / ${lit.length}` +
  `   ${proof === lit.length ? '(the bar is not excluding real light)' : '*THE BAR IS TOO HIGH*'}`);

console.log('\n# light in the disc that no surveyed lamp explains');
for (const k of ['pin', 'lit', 'cool']) {
  const a = rows.filter(r => r.kind === k);
  const withDecor = a.filter(r => r.decorPx >= 1000);
  const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  console.log(`  ${k.padEnd(5)}  sites with >=1000 px of it: ${String(withDecor.length + ' / ' + a.length).padEnd(10)}` +
    `median ${String(med(a.map(r => r.decorPx))).padEnd(8)}max ${Math.max(0, ...a.map(r => r.decorPx))}`);
}
console.log('\n# the violet column, site by site');
for (const r of rows.filter(x => x.kind === 'pin')) {
  console.log(`  pin ${String(r.i).padStart(2)}  ${r.from}->${r.to}  nearest mapped lamp ${String(r.d).padStart(6)} m` +
    `   surveyed lamp ${String(r.lampPx).padStart(6)} px   unexplained light ${String(r.decorPx).padStart(6)} px` +
    `   ${(r.note || '(no words)').slice(0, 44)}`);
}
const all = rows.filter(r => r.decorPx >= 1000).length;
console.log(`\n${all} of ${rows.length} sampled discs carry >= 1000 px of warm light with no surveyed lamp under it.`);
fs.writeFileSync(`${OUT}/decorpx.json`, JSON.stringify({ brightMin: BRIGHT_MIN, warmSpread: WARM_SPREAD, dir: DIR, rows }, null, 1));
console.log(`wrote ${OUT}/decorpx.json`);
