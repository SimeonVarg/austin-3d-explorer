/**
 * sceneproof.mjs — the card and the place it is describing, in ONE frame.
 *
 * WHAT THIS ADDS TO SIX ROUNDS OF AUDITS. Every matrix in docs/walk-lit.md
 * samples SITES: take a coordinate the app classified, fly there, count lamp
 * pixels, tabulate. That answers "is the classification true" and it is the
 * right question — but every frame it produces is either a picture of the city
 * with no card in it, or a picture of the card with no city in it. The claim a
 * person actually judges is the CORRESPONDENCE: this stretch of the bar is
 * amber, and here is what standing on that stretch looks like.
 *
 * So this puts both in the same photograph, at the app's own walking height,
 * looking down the walk, at night, with the card open beside it. Two stretches
 * of ONE route — the widest mapped run and the widest unmapped run — so the two
 * frames differ by the thing the bar says they differ by and by nothing else:
 * same route, same card, same night, same eye, minutes apart.
 *
 * AND THE CONTROL, BECAUSE A FRAME WITH LIGHT IN IT IS NOT EVIDENCE THAT THE
 * LIGHT IS A SURVEYED LAMP. This city paints road glow with no pole under it
 * (§22, §46) and its ground is a warm dark brown after dark (§49d), so "it
 * looks lit" is exactly the mistake the house rule exists to prevent. Every
 * frame is taken twice, with `props-lit` / `props-lit-core` shown and hidden,
 * and the masked difference is what gets counted. If hiding the lamps does not
 * change the picture, the light in it was never the lamps.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/sceneproof.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const FRAMES = process.env.VERIFY_FRAMES || OUT;
fs.mkdirSync(FRAMES, { recursive: true });
const NIGHT = 0.92;
const EYE = { pitch: 84, altM: 1.70, zoom0: 19.2 };   // js/app.js's walking height, under its pitch ceiling
const LAMP_LAYERS = ['props-lit', 'props-lit-core'];
// A pixel counts as lamplight if hiding the lamps takes this much brightness
// out of it. Same bar rounds 3-6 used, so the numbers are comparable.
const DIFF_MIN = 26;
const REPS = Number(process.env.SCENE_REPS || 3);   // README: never one reading

const ROUTES = [
  ['ANB', 'ETC', 'mixed bar — one amber stretch and one cool stretch of the same walk'],
  ['GDC', 'The Castilian', 'the walk home — the bar is cool end to end'],
];

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1800000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
await page.evaluate((p) => {
  const el = document.getElementById('tod-slider');
  if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
}, NIGHT);
await page.waitForTimeout(1500);
await page.waitForFunction(() => {
  const m = window.__map;
  return !!(m && m.getLayer('props-lit') && m.getLayer('props-lit-core'));
}, null, { timeout: 120000 });

async function poseEye(ll, bearing) {
  return page.evaluate(([ll, pitch, wantAlt, z0, brg]) => {
    const m = window.__map;
    const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(ll[1] * Math.PI / 180);
    const camLL = () => { const t = m.transform; const c = t.getCameraLngLat ? t.getCameraLngLat() : null; return c ? [c.lng, c.lat] : null; };
    const camAlt = () => { const t = m.transform; return t.getCameraAltitude ? t.getCameraAltitude() : NaN; };
    let z = z0, centre = [ll[0], ll[1]];
    for (let k = 0; k < 5; k++) {
      m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
      const alt = camAlt();
      if (isFinite(alt) && alt > 0) z = z + Math.log2(alt / wantAlt);
      m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
      const c = camLL();
      if (!c) break;
      centre = [centre[0] + (ll[0] - c[0]), centre[1] + (ll[1] - c[1])];
    }
    m.jumpTo({ center: centre, zoom: z, pitch, bearing: brg });
    const c = camLL(), alt = camAlt();
    return {
      eyeErrM: c ? +Math.hypot((c[0] - ll[0]) * MPD_LON, (c[1] - ll[1]) * MPD_LAT).toFixed(2) : null,
      altM: +alt.toFixed(2), zoom: +z.toFixed(3),
    };
  }, [ll, EYE.pitch, EYE.altM, EYE.zoom0, bearing]);
}

const rows = [];
for (const [from, to, why] of ROUTES) {
  let ok = false;
  for (let t = 0; t < 4 && !ok; t++) {
    await page.evaluate(async ([f, t2]) => { await window.wayfindRoute(f, t2, { expand: true }); }, [from, to]);
    ok = await page.waitForFunction(() => {
      const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
      if (!card) return false;
      const kids = Array.from(card.children);
      const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
      return hi >= 0 && kids.slice(hi).some(k => k.querySelector && k.querySelector('[role="img"]'));
    }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  }
  if (!ok) { errs.push(`${from}->${to}: no strip`); continue; }

  const lit = await page.evaluate(async () => await window.wayfindLit());
  if (!lit.ok) { errs.push(`${from}->${to}: lit not ok`); continue; }

  // The widest run of each kind, and the midpoint of it — the place the bar is
  // most confidently making its claim, not an edge case at a boundary.
  const pick = (want) => {
    const cands = lit.runsAt.filter(r => !!r.lit === want && r.line && r.line.length >= 3);
    if (!cands.length) return null;
    const r = cands.sort((a, b) => b.m - a.m)[0];
    const i = Math.floor(r.line.length / 2);
    const a = r.line[Math.max(0, i - 1)], b = r.line[Math.min(r.line.length - 1, i + 1)];
    const brg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
    return { ll: r.line[i], m: r.m, bearing: brg };
  };
  const spots = [['mapped', pick(true)], ['unmapped', pick(false)]].filter(x => x[1]);

  for (const [kind, spot] of spots) {
    const pose = await poseEye(spot.ll, spot.bearing);
    await page.waitForTimeout(1800);
    // THE FIRST CAPTURE OF A POSE IS NOT THE ANSWER. scripts/verify/README.md:
    // screenshot twice, trust the second; take the minimum of interleaved reps,
    // never one reading. This lane learned why the hard way on this very run —
    // the middle of the 698 m unmapped run on the walk home scored ~3,200 px of
    // "lamplight" twice, and the mask showed it as one hard-edged diagonal
    // streak in a corner rather than a pool. A third capture of the identical
    // pose scored ONE pixel, 244 m away (shots/walk/lit/streakwhere.json). The
    // streak is a repaint artefact of toggling a layer's visibility, and a
    // single reading of it was on its way into this document as a defect.
    const reps = [];
    for (let rep = 0; rep < REPS; rep++) {
      await page.screenshot();                       // discard: trust the second
      await page.waitForTimeout(600);
      const wl = await page.screenshot();
      // THE CONTROL: hide the surveyed lamps, nothing else, and re-shoot.
      await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'none'); }, LAMP_LAYERS);
      await page.waitForTimeout(1400);
      await page.screenshot();                       // discard, same reason
      await page.waitForTimeout(400);
      const nl = await page.screenshot();
      await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'visible'); }, LAMP_LAYERS);
      await page.waitForTimeout(1200);
      reps.push([wl, nl]);
    }

    const diffs = [];
    for (const [wl, nl] of reps) diffs.push(await diffPair(wl, nl));
    // The MINIMUM, per the README. A repaint artefact adds pixels; it never
    // removes them, so the smallest of the reps is the one least contaminated.
    let bi = 0; for (let i = 1; i < diffs.length; i++) if (diffs[i].px < diffs[bi].px) bi = i;
    const diff = diffs[bi];
    const withLamps = reps[bi][0], noLamps = reps[bi][1];
    console.log(`      reps: ${diffs.map(d => d.px).join(', ')} px  -> taking the minimum`);

    async function diffPair(a0, b0) { return page.evaluate(async ([a, b, DIFF_MIN]) => {
      const load = (s) => new Promise(r => { const q = new Image(); q.onload = () => r(q); q.src = 'data:image/png;base64,' + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c1 = document.createElement('canvas'); c1.width = ia.width; c1.height = ia.height;
      const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height;
      c1.getContext('2d').drawImage(ia, 0, 0); c2.getContext('2d').drawImage(ib, 0, 0);
      const da = c1.getContext('2d').getImageData(0, 0, ia.width, ia.height).data;
      const db = c2.getContext('2d').getImageData(0, 0, ib.width, ib.height).data;
      // ...and the MASK, because a count does not say WHERE. §46's whole point
      // was that the eye is a poor judge of how much of a frame a glow covers;
      // the corollary is that a number is a poor judge of where it is, and a
      // pixel count on its own cannot tell a pool on the path from a wash on a
      // wall two hundred metres away.
      const cm = document.createElement('canvas'); cm.width = ia.width; cm.height = ia.height;
      const gm = cm.getContext('2d'); const out = gm.createImageData(ia.width, ia.height);
      let n = 0, peak = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(da[i] - db[i], da[i + 1] - db[i + 1], da[i + 2] - db[i + 2]);
        if (d >= DIFF_MIN) { n++; out.data[i] = 255; out.data[i + 1] = 40; out.data[i + 2] = 210; out.data[i + 3] = 255; }
        else { out.data[i] = da[i] >> 2; out.data[i + 1] = da[i + 1] >> 2; out.data[i + 2] = da[i + 2] >> 2; out.data[i + 3] = 255; }
        if (d > peak) peak = d;
      }
      gm.putImageData(out, 0, 0);
      return { px: n, peak, of: (ia.width * ia.height), mask: cm.toDataURL('image/png') };
    }, [a0.toString('base64'), b0.toString('base64'), DIFF_MIN]); }

    const tag = `r7-scene-${from}-${kind}`;
    fs.writeFileSync(`${FRAMES}/${tag}.png`, withLamps);
    fs.writeFileSync(`${FRAMES}/${tag}-nolamps.png`, noLamps);
    fs.writeFileSync(`${FRAMES}/${tag}-mask.png`, Buffer.from(diff.mask.split(',')[1], 'base64'));
    rows.push({ from, to, why, kind, ll: spot.ll, runM: spot.m, bearing: +spot.bearing.toFixed(1), ...pose, lampPx: diff.px, peak: diff.peak, frame: tag });
    console.log(`  ${from}->${to}  ${kind.padEnd(9)} run ${String(Math.round(spot.m)).padStart(4)} m  eye off by ${pose.eyeErrM} m at ${pose.altM} m  ->  lamplight in frame: ${String(diff.px).padStart(6)} px (peak +${diff.peak})`);
  }
}

console.log('');
for (const [from] of ROUTES) {
  const a = rows.find(r => r.from === from && r.kind === 'mapped');
  const b = rows.find(r => r.from === from && r.kind === 'unmapped');
  if (a && b) console.log(`  ${from}: the bar says amber here and cool there — the scene says ${a.lampPx} px against ${b.lampPx} px`);
  else if (b) console.log(`  ${from}: the bar is cool end to end — the scene says ${b.lampPx} px of surveyed lamplight`);
}
fs.writeFileSync(`${OUT}/sceneproof.json`, JSON.stringify({ night: NIGHT, eye: EYE, diffMin: DIFF_MIN, rows, errs }, null, 1));
if (errs.length) console.log('\nerrors:\n  ' + errs.join('\n  '));
await browser.close();
