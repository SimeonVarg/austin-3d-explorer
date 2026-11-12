/**
 * v2-far-scan.mjs - does every FAR COPY look like its FULL MODEL? (v2/tiles.js FAR, v2/tiles/coats.json)
 *
 *   VERIFY_GL=hardware VERIFY_URL=http://127.0.0.1:8099 node scripts/verify/v2-far-scan.mjs <out dir> [azimuth deg = 200] [only ids, comma]
 *
 * Why: the far copies went live on 2026-11-11 (#671) after a test that averaged over whole frames. A day later a look at the
 * owner's screen size found one building drawn as a dark blotched block, black shards on the Moody Center's roof and the stadium's
 * green field gone pale: each a far copy that did not look like its full model. A whole-frame average hides one building.
 *
 * What it does, per tile whose far copy is in use (one that is switched off in coats.json is not loaded): the camera stands 1.2 x the far
 * copy's line away (where the app shows the far copy), both copies are loaded, and the tile is drawn three times in one page:
 * full model, far copy, hidden. Over the tile's own pixels (those that change when it is hidden):
 *   err     mean |far - full| of 255 (two single frames: about 5 to 7 is the full model's own fine detail against a filtered copy)
 *   bright  the signed brightness change
 *   over30  the share of pixels that differ by more than 30 of 255
 *   patch   the worst PATCH: the largest change of the MEAN colour (any of red, green, blue) of a 12 x 12 pixel block. The three
 *           numbers above are means over a whole tile, and a tile can hold 20 buildings: one wall of one tower drawn blue where
 *           the full model is grey passed all three (found by eye on 2026-11-12). A block mean does not see edges that sit a
 *           pixel apart or fine detail that the copy filters; it sees a wall of the wrong colour.
 * A far copy passes with err <= 9.0, over30 < 8 %, |bright| <= 5 and patch <= 45 (the limits of 2026-11-12; those that fail are
 * "off" in coats.json with their numbers under "scan"). Run it from two sides (azimuth 200 and 20) and take the worse.
 * To scan a far copy that is off (after a new bake), take its "off" line out first. It fails (exit 1) when a far copy in use does not pass. Pictures of every tile (full | far) go to <out dir>.
 *
 * Instrument: the owner's screen first: VW=2560 VH=1300 DPR=1 (the defaults). A real GPU (it would take very long without one).
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { launch, BASE } from './chrome.mjs';
const [out, azS = '200', only = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const VW = +(process.env.VW || 2560), VH = +(process.env.VH || 1300), DPR = +(process.env.DPR || 1);
const browser = await launch(chromium, { gl: 'hardware', maxMs: 3000000 });
const page = await (await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR })).newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${BASE.replace(/\/$/, '')}/v2/?intro=0&fade=0&adapt=0&steady=0&farforce=full`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__v2 && window.__v2.ready, null, { timeout: 180000 });
await page.addStyleTag({ content: 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
const ids = await page.evaluate(() => [...window.__v2.tileStreamer().tiles.values()].filter((s) => s.coat).map((s) => s.def.id));
const rows = [];
for (const id of ids.filter((i) => !only || only.split(',').includes(i))) {
  const cam = await page.evaluate(([id, az]) => { const v = window.__v2, t = v.tileStreamer(), s = t.tiles.get(id), [x0, z0, x1, z1] = s.def.bounds;
    t.plan(); const line = s.line || 800, d = Math.max(line * 1.2, 500), pol = 62 * Math.PI / 180, a = az * Math.PI / 180;
    v.skipIntro(); v.controls.target.set((x0 + x1) / 2, 25, (z0 + z1) / 2);
    v.camera.position.set(v.controls.target.x + d * Math.sin(pol) * Math.sin(a), 25 + d * Math.cos(pol), v.controls.target.z + d * Math.sin(pol) * Math.cos(a));
    v.camera.lookAt(v.controls.target); v.camera.updateMatrixWorld(); v.redraw(); return { line: Math.round(line), d: Math.round(d), b: s.def.buildings }; }, [id, +azS]);
  let calm = 0; const t0 = Date.now();
  while (calm < 3 && Date.now() - t0 < 120000) { const s = await page.evaluate((id) => { window.__v2.redraw(); const t = window.__v2.tileStreamer(), q = t.tiles.get(id), u = window.__v2.tiles(); return !!(q.full && q.far) && u.loading === 0 && !u.fading; }, id); calm = s ? calm + 1 : 0; await page.waitForTimeout(calm ? 300 : 200); }
  if (calm < 3) { console.log(id, 'did not load both copies'); continue; }
  await page.waitForTimeout(600);
  const r = await page.evaluate((id) => { const v = window.__v2, R = v.renderer, gl = R.getContext(), t = v.tileStreamer(), s = t.tiles.get(id), W = R.domElement.width, H = R.domElement.height;
    const hook = t.show; t.show = () => {};                       // (the tile manager must not flip the copies back between the draws)
    const shot = (full, far) => { s.full.visible = full; s.far.visible = far; R.setRenderTarget(null); R.render(v.scene, v.camera); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const A = shot(true, false), B = shot(false, true), N = shot(false, false);
    let n = 0, e = 0, sg = 0, big = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) { const la = 0.299 * A[p] + 0.587 * A[p + 1] + 0.114 * A[p + 2], lb = 0.299 * B[p] + 0.587 * B[p + 1] + 0.114 * B[p + 2];
      if (Math.abs(A[p] - N[p]) + Math.abs(A[p + 1] - N[p + 1]) + Math.abs(A[p + 2] - N[p + 2]) < 6) continue;
      n++; e += Math.abs(la - lb); sg += lb - la; if (Math.abs(la - lb) > 30) big++; const x = i % W, y = H - 1 - ((i / W) | 0); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    // the worst patch: a P x P block whose mean colour moved (summed-area tables of far - full over the tile's box)
    const P = 12, bw = x1 - x0 + 1, bh = y1 - y0 + 1; let patch = 0;
    if (n && bw >= P && bh >= P) { const T = [0, 1, 2].map(() => new Float64Array((bw + 1) * (bh + 1)));
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const p = ((H - 1 - (y0 + y)) * W + x0 + x) * 4, q = (y + 1) * (bw + 1) + x + 1;
        for (let c = 0; c < 3; c++) T[c][q] = B[p + c] - A[p + c] + T[c][q - 1] + T[c][q - bw - 1] - T[c][q - bw - 2]; }
      for (let y = 0; y + P <= bh; y++) for (let x = 0; x + P <= bw; x++) { const a = y * (bw + 1) + x, b = a + P * (bw + 1);
        for (let c = 0; c < 3; c++) { const m = Math.abs(T[c][b + P] - T[c][b] - T[c][a + P] + T[c][a]); if (m > patch) patch = m; } }
      patch /= P * P; }
    s.full.visible = true; s.far.visible = false; window.__keep = { A, B, W, H }; t.show = hook;
    return { n, err: n ? e / n : 0, signed: n ? sg / n : 0, big: n ? big / n : 0, patch, box: [x0, y0, x1, y1] }; }, id);
  rows.push({ id, ...cam, ...r });
  // the two pictures of this tile's box, side by side (kept only for the worst, below)
  const url = await page.evaluate((box) => { const { A, B, W, H } = window.__keep, [x0, y0, x1, y1] = box, w = Math.min(700, x1 - x0 + 1), h = Math.min(500, y1 - y0 + 1); if (w < 4 || h < 4) return null;
    const cv = document.createElement('canvas'); cv.width = w * 2 + 8; cv.height = h; const cx = cv.getContext('2d'), put = (S, ox) => { const im = cx.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sp = ((H - 1 - (y0 + y)) * W + x0 + x) * 4, dp = (y * w + x) * 4; im.data[dp] = S[sp]; im.data[dp + 1] = S[sp + 1]; im.data[dp + 2] = S[sp + 2]; im.data[dp + 3] = 255; } cx.putImageData(im, ox, 0); };
    put(A, 0); put(B, w + 8); return cv.toDataURL('image/png'); }, r.box);
  if (url) fs.writeFileSync(`${out}/${id}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${id.padEnd(8)} err ${r.err.toFixed(1).padStart(5)}  brightness ${r.signed >= 0 ? '+' : ''}${r.signed.toFixed(1).padStart(5)}  pixels over 30 off: ${(100 * r.big).toFixed(0).padStart(3)} %  worst patch ${r.patch.toFixed(0).padStart(3)}  (${r.n} px, line ${cam.line} m)  ${cam.b.join(', ').slice(0, 70)}`);
}
await browser.close();
rows.sort((a, b) => b.err - a.err);
fs.writeFileSync(`${out}/scan.json`, JSON.stringify(rows));
const LIM = { ERR: 9.0, OVER30: 0.08, BRIGHT: 5, PATCH: 45 };
const off = await (async () => { try { return JSON.parse(fs.readFileSync(new URL('../../v2/tiles/coats.json', import.meta.url), 'utf8')); } catch (e) { return {}; } })();
const failing = rows.filter((r) => !(off[r.id] && off[r.id].off) && (r.err > LIM.ERR || r.big >= LIM.OVER30 || Math.abs(r.signed) > LIM.BRIGHT || r.patch > LIM.PATCH));
console.log('\nWORST FIRST:'); for (const r of rows.slice(0, 15)) console.log(`${r.id.padEnd(8)} err ${r.err.toFixed(1)}  brightness ${r.signed.toFixed(1)}  over 30: ${(100 * r.big).toFixed(0)} %  patch ${r.patch.toFixed(0)}  ${r.b.join(', ').slice(0, 80)}`);
const e = rows.map((r) => r.err).sort((a, b) => a - b); console.log(`tiles ${rows.length}; error median ${e[e.length >> 1].toFixed(1)}, 90 % under ${e[Math.floor(e.length * 0.9)].toFixed(1)}, worst ${e[e.length - 1].toFixed(1)}`);
console.log(failing.length ? `*FAIL ${failing.length} far cop${failing.length > 1 ? 'ies' : 'y'} in use do not look like their full models: ${failing.map((r) => r.id).join(', ')}` : 'PASS every far copy in use looks like its full model (limits: err ' + LIM.ERR + ', over30 ' + LIM.OVER30 * 100 + ' %, bright ' + LIM.BRIGHT + ', patch ' + LIM.PATCH + ')');
process.exit(failing.length ? 1 : 0);
