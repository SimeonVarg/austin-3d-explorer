/**
 * litgap.mjs — a stretch the card draws AMBER with no lamp anywhere in the frame.
 *
 * Round 5's matrix (stretchscene.mjs) put twelve cameras on stretches this
 * feature classifies as covered by a mapped street lamp, and three of them came
 * back with nothing at all: no warm pool in the 25 m disc, nothing anywhere in
 * the night frame, and at two of the three `queryRenderedFeatures` found no
 * `props-lit` feature within 25 m either — while the shipped index says the
 * nearest mapped lamp is SEVEN METRES away.
 *
 * That is the one direction this feature is not allowed to be wrong in. Round 3
 * §20 met a version of it and traced it to a live oak standing on the lamp; a
 * canopy hides the light and leaves the feature, so `queryRenderedFeatures`
 * still finds it. Two of these three have no feature to find, which is a
 * different fault with the same symptom, and answering "which" needs the layers
 * pulled apart one at a time rather than a plausible story.
 *
 * FOUR QUESTIONS, IN THE ORDER THAT NARROWS IT:
 *   1. Does the shipped index really have a lamp here?      (node, walk_lamps.json)
 *   2. Do the TILES the page streams have one?              (querySourceFeatures)
 *   3. Does the style RENDER it?                            (queryRenderedFeatures)
 *   4. Is something standing on top of it?                  (hide one family, look again)
 *
 * 1-but-not-2 is an index that claims lamps the city does not draw. 2-but-not-3
 * is the density filter. 3-but-no-pixels is round 3's live oak. Each has a
 * different fix and they are indistinguishable from the frame alone.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/litgap.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92, ZOOM = 19.8, W = 960, H = 600;
const FAMILIES = { trees: /^trees-/, buildings: /^(buildings|bldg|facade|roofscape|tower)/, ground: /^ground-/ };

const SCENE = JSON.parse(fs.readFileSync(`${OUT}/stretchscene.json`, 'utf8'));
const SUSPECTS = SCENE.rows.filter(r => r.kind === 'lit' && !r.lampInFrame);
if (!SUSPECTS.length) { console.log('no amber site came back empty — nothing to explain'); process.exit(0); }
console.log(`amber sites with no lamp in the frame: ${SUSPECTS.length}`);

// ── 1. the shipped index, in node ─────────────────────────────────────────
const J = JSON.parse(fs.readFileSync('data/walk_lamps.json', 'utf8'));
const q = J.q || 1e-6;
const dec = (o) => {
  const xs = (o && o.x) || [], ys = (o && o.y) || [];
  const X = [], Y = []; let ax = 0, ay = 0;
  for (let i = 0; i < xs.length; i++) { ax += xs[i]; ay += ys[i]; X.push(ax * q); Y.push(ay * q); }
  return { X, Y, n: X.length };
};
const WARM = dec(J.warm), BLUE = dec(J.blue || {});
const CANOPY = J.warm_canopy || [];
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
const near = (P, lon, lat, R) => {
  const out = [];
  for (let i = 0; i < P.n; i++) {
    const d = Math.hypot((P.X[i] - lon) * MPD_LON, (P.Y[i] - lat) * MPD_LAT);
    if (d <= R) out.push({ i, d: +d.toFixed(1), ll: [P.X[i], P.Y[i]] });
  }
  return out.sort((a, b) => a.d - b.d);
};

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1200000 });
const page = await browser.newPage({ viewport: { width: W, height: H } });
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

const fam = await page.evaluate((pats) => {
  const ids = window.__map.getStyle().layers.map(l => l.id);
  const out = {};
  for (const [k, src] of Object.entries(pats)) out[k] = ids.filter(id => new RegExp(src).test(id));
  return out;
}, Object.fromEntries(Object.entries(FAMILIES).map(([k, re]) => [k, re.source])));
console.log('layer families:', Object.entries(fam).map(([k, v]) => `${k} ${v.length}`).join(' · '));

const rows = [];
for (const s of SUSPECTS) {
  const [lon, lat] = s.ll;
  const idxWarm = near(WARM, lon, lat, 60);
  const idxBlue = near(BLUE, lon, lat, 60);

  await page.evaluate(async ([f, t]) => {
    await window.wayfindRoute(f, t, {});
    const r = document.getElementById('wf-root'); if (r) r.style.display = 'none';
  }, [s.from, s.to]);
  await page.evaluate(([ll, z]) => { window.__map.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 }); }, [s.ll, ZOOM]);
  await page.waitForTimeout(900);
  await page.evaluate(() => new Promise((r) => { const t = setTimeout(r, 3000); window.__map.once('idle', () => { clearTimeout(t); r(); }); }));

  // ── 2 and 3, at the same moment, in the same frame ──────────────────────
  const q23 = await page.evaluate(([ll]) => {
    const m = window.__map;
    const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(ll[1] * Math.PI / 180);
    const dist = (g) => Math.hypot((g[0] - ll[0]) * MPD_LON, (g[1] - ll[1]) * MPD_LAT);
    // THE TILE, not the picture. querySourceFeatures ignores layer filters,
    // paint, opacity, zoom gates and anything standing on top — it is what the
    // page actually downloaded. If this is empty the index is claiming a lamp
    // the city does not carry, and no amount of hiding trees will produce one.
    let src = [];
    try {
      src = m.querySourceFeatures('austin-props', {})
        .filter(f => (f.properties || {}).k === 'lit' && f.geometry && f.geometry.type === 'Point')
        .map(f => ({ d: +dist(f.geometry.coordinates).toFixed(1), c: (f.properties || {}).c || 'warm', dq: (f.properties || {}).d }))
        .filter(f => f.d <= 60).sort((a, b) => a.d - b.d);
    } catch (e) { src = [{ err: String(e) }]; }
    const c = m.project(ll);
    const px60 = Math.abs(m.project([ll[0] + 60 / MPD_LON, ll[1]]).x - c.x);
    const box = [[c.x - px60, c.y - px60], [c.x + px60, c.y + px60]];
    const rend = (id) => { try { return m.getLayer(id) ? m.queryRenderedFeatures(box, { layers: [id] }).length : -1; } catch (e) { return -1; } };
    return {
      srcLit: src, rendLit: rend('props-lit'), rendCore: rend('props-lit-core'),
      rendLamp: rend('props-lamp'), pad: rend('wayfind-lit-pad'), dark: rend('wayfind-lit-dark'),
      density: (window.GFX && (window.GFX.propDensity ?? window.GFX.treeDensity)) ?? null,
      litFilter: m.getLayer('props-lit') ? JSON.stringify(m.getFilter('props-lit')) : null,
      litOpacity: m.getLayer('props-lit') ? m.getPaintProperty('props-lit', 'circle-opacity') : null,
    };
  }, [s.ll]);

  // ── 4. one family at a time, pixels only ────────────────────────────────
  const mask = async () => {
    await page.evaluate(() => {
      const m = window.__map; m.__save = {};
      const paint = {
        'props-lit': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'],
        'props-lit-core': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ffff'],
      };
      for (const id of Object.keys(paint)) {
        if (!m.getLayer(id)) continue;
        m.__save[id] = { color: m.getPaintProperty(id, 'circle-color'), op: m.getPaintProperty(id, 'circle-opacity') };
        m.setPaintProperty(id, 'circle-color', paint[id]);
        m.setPaintProperty(id, 'circle-opacity', 1);
      }
    });
    await page.waitForTimeout(600);
  };
  const unmask = () => page.evaluate(() => {
    const m = window.__map;
    for (const id of Object.keys(m.__save || {})) {
      m.setPaintProperty(id, 'circle-color', m.__save[id].color);
      m.setPaintProperty(id, 'circle-opacity', m.__save[id].op);
    }
    m.__save = {};
  });
  const countGreen = async (base, shot) => page.evaluate(async ([a64, b64]) => {
    const load = (b) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b; });
    const [A, B] = await Promise.all([load(a64), load(b64)]);
    const dat = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, im.width, im.height).data; };
    const a = dat(A), b = dat(B); let g = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      const R = b[i], G = b[i + 1], Bl = b[i + 2], mx = Math.max(R, G, Bl);
      if (mx < 12) continue;
      if (G > mx * .55 && !(Bl > mx * .55) && !(R > mx * .55)) g++;
    }
    return g;
  }, [base.toString('base64'), shot.toString('base64')]);

  const probe = {};
  for (const key of ['shipped', ...Object.keys(fam)]) {
    if (key !== 'shipped') {
      await page.evaluate((ids) => { for (const id of ids) { try { window.__map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} } }, fam[key]);
      await page.waitForTimeout(500);
    }
    const base = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
    await mask();
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
    await unmask();
    probe[key] = await countGreen(base, shot);
    if (key === 'shipped') fs.writeFileSync(`${OUT}/r5-gap-${s.from}-${s.to}-shipped.png`, base);
    if (key === 'trees') fs.writeFileSync(`${OUT}/r5-gap-${s.from}-${s.to}-no-trees.png`, base);
    if (key !== 'shipped') {
      await page.evaluate((ids) => { for (const id of ids) { try { window.__map.setLayoutProperty(id, 'visibility', 'visible'); } catch (e) {} } }, fam[key]);
      await page.waitForTimeout(300);
    }
  }

  const verdict = q23.srcLit.length === 0 ? 'THE TILES DO NOT CARRY IT'
    : q23.rendLit <= 0 ? 'the tile has it, the style does not draw it'
      : probe.trees > probe.shipped + 200 ? 'a tree is standing on it (round 3 §20)'
        : 'unexplained';
  rows.push({ ...s, idxWarm: idxWarm.slice(0, 4), idxWarmCanopy: idxWarm.slice(0, 4).map(x => CANOPY[x.i] || 0), idxBlue: idxBlue.slice(0, 2), ...q23, probe, verdict });
  console.log(`\n${s.from}->${s.to}  @ ${lon.toFixed(5)},${lat.toFixed(5)}`);
  console.log(`  1 index     : ${idxWarm.length} warm within 60 m` +
    (idxWarm.length ? `, nearest ${idxWarm[0].d} m (canopy flag ${CANOPY[idxWarm[0].i] || 0})` : '') +
    ` · ${idxBlue.length} blue phones` + (idxBlue.length ? `, nearest ${idxBlue[0].d} m` : ''));
  console.log(`  2 tiles     : ${q23.srcLit.length} props-lit within 60 m` +
    (q23.srcLit.length ? `, nearest ${q23.srcLit[0].d} m (${q23.srcLit[0].c}, d=${q23.srcLit[0].dq})` : ''));
  console.log(`  3 rendered  : props-lit ${q23.rendLit}, core ${q23.rendCore}, poles ${q23.rendLamp}, our pads ${q23.pad}, unmapped overlay ${q23.dark}`);
  console.log(`  4 occluders : ` + Object.entries(probe).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log(`  => ${verdict}`);
}

console.log('\n# verdicts');
const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
for (const [k, v] of Object.entries(tally)) console.log(`  ${v} x ${k}`);
fs.writeFileSync(`${OUT}/litgap.json`, JSON.stringify({ night: NIGHT, zoom: ZOOM, fam, rows, errs }, null, 1));
console.log(`\nwrote ${OUT}/litgap.json`);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
