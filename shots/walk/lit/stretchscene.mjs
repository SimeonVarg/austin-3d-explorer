/**
 * stretchscene.mjs — the two populations a third strip colour would separate,
 * looked at rather than reasoned about.
 *
 * WHAT THIS DECIDES. docs/walk-lit.md §28 left one question open and called it
 * the biggest thing round 4 leaves behind: a COOL segment of the card's strip
 * 28 m from a mapped lamp is drawn exactly like a cool segment 300 m from one,
 * and round 4's boundary.mjs found a lamp somewhere in the night frame at 9 of
 * 18 sites in the 25-60 m band. If the two populations look different when you
 * go and stand in them, the strip is flattening a real difference and a third
 * colour has something to say. If they look the same, the third colour is
 * decoration — and this lane has already measured one of those out of the
 * product rather than argue it in (`litCanopyMult`, §21).
 *
 * THE SAMPLE IS NOT CHOSEN BY EYE. `stretchmiss.mjs` walks 60 seeded real
 * routes, classifies every 8 m step of every cool run by its nearest-warm-lamp
 * distance against the SHIPPED data/walk_lamps.json, and writes the two pools:
 *
 *   NEAR — cool, and 27-50 m from a mapped lamp (just outside the radius)
 *   FAR  — cool, and more than 120 m from any mapped lamp (the control)
 *
 * Sites are deduplicated by coordinate AND spread across distinct routes, for
 * the reason §27 records: the first cut of strip-scene.mjs measured the same
 * stretch of pavement twice and called it two independent readings.
 *
 * THE INSTRUMENT is round 3's, unchanged and deliberately so: plan view, site
 * dead centre, night asserted not assumed, the route card hidden (§27.3 — an
 * occluded instrument that happens to agree with you is the worst kind),
 * `props-lit` and `props-lit-core` masked flat and DIFFED against the unmasked
 * frame so night tree canopy cannot be counted as lamplight, and the 25 m disc
 * measured through the map's own project() and drawn on every saved frame.
 *
 * TWO WINDOWS, and the difference between them is the whole point. The disc is
 * what the card's claim is ABOUT. The frame is what a person standing there can
 * SEE. A cool segment should be empty in the disc — that is the claim, and it
 * had better hold in both pools. Whether it is empty in the FRAME is the
 * question.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/stretchscene.mjs [perPool]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92, ZOOM = 19.8, W = 960, H = 600;
const PER_BUCKET = Number(process.argv[2] || 6);
const LAMP_GREEN_MIN = 200;   // the same bar round 3 and round 4 used
const DEDUPE_M = 40;          // two sites closer than this are one site

const MISS = JSON.parse(fs.readFileSync(`${OUT}/stretchmiss.json`, 'utf8'));
const MPD_LAT = 111320, MPD_LON = 111320 * Math.cos(30.285 * Math.PI / 180);
const apart = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);

/**
 * Spread over distinct routes first, then top up, and never twice in one place.
 *
 * BOTH GUARDS ARE THERE BECAUSE A PUBLISHED NUMBER NEEDED THEM. Round 4's
 * boundary.mjs (§28) reported "a lamp is visible at 9 of 18 band sites" off a
 * sample that put six sites on one route and two of them 24 m apart — the same
 * stretch of pavement, read twice, counted twice. §27 caught exactly this in
 * strip-scene.mjs and the fix never made it back to boundary.mjs.
 */
function pick(pool, n) {
  const out = [], seenRoute = new Set();
  for (const pass of [0, 1]) {
    for (const s of pool) {
      if (out.length >= n) break;
      const key = s.from + '>' + s.to;
      if (pass === 0 && seenRoute.has(key)) continue;
      if (out.some(o => apart(o.ll, s.ll) < DEDUPE_M)) continue;
      seenRoute.add(key);
      out.push(s);
    }
  }
  return out;
}
// The band is sampled BY DISTANCE BUCKET, not as one pool, because the question
// underneath §28 is not "is a lamp ever visible from a cool stretch" — round 4
// answered that yes — but "how far does that reach", and a pool averaged over
// 25-50 m cannot answer it. A rate that collapses between 30 m and 40 m and a
// rate that is flat across the band imply two completely different products.
const NEAR = [];
MISS.buckets.forEach((b, i) => {
  const got = pick(MISS.bandSites.filter(s => s.bucket === i), PER_BUCKET);
  got.forEach(s => NEAR.push(s));
  console.log(`  band ${b[0]}-${b[1]} m: ${got.length} sites of ${MISS.bandSites.filter(s => s.bucket === i).length} available`);
});
const FAR = pick(MISS.farSites, PER_BUCKET * 2);
// The column that tests the claim rather than the doubt: stretches the card
// draws AMBER. Without it this is a list of the places we already suspected.
const LIT = pick(MISS.litSites || [], PER_BUCKET * 2);
console.log(`sites: ${NEAR.length} NEAR (just outside ${MISS.radiusM} m) · ${FAR.length} FAR (>${MISS.farM} m) · ${LIT.length} LIT (the amber column)`);

const browser = await launch(chromium, { gl: 'hardware', maxMs: 1500000 });
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
// ASSERTED, not assumed: a night measurement taken by day is a different
// measurement with the same filename.
const night = await page.evaluate(() => {
  const el = document.getElementById('tod-slider');
  return { slider: el ? Number(el.value) : null, nightness: window.NIGHT && window.NIGHT.value };
});
console.log('night:', JSON.stringify(night));
// WAIT FOR THE LAYER THE WHOLE TEST IS ABOUT. The first cut of this did not,
// and its first two sites came back "no warm lamp on screen" with zero
// `props-lit` features in the query — a clean, plausible, false negative on the
// AMBER column, which is the column where a false negative means the card is
// claiming a lamp that is not there. `props-lit` is added when the props source
// initialises, some seconds after the veil goes; before that the mask loop skips
// it (`if (!m.getLayer(id)) continue`), both frames are identical, and the diff
// is honestly zero. A camera pointed at a layer that does not exist yet is the
// same defect as §27.3's camera pointed through the card: the instrument is not
// looking at the subject, and it agrees with you anyway.
await page.waitForFunction(() => {
  const m = window.__map;
  return !!(m && m.getLayer('props-lit') && m.getLayer('props-lit-core'));
}, null, { timeout: 120000 });
console.log('props-lit present:', await page.evaluate(() => !!window.__map.getLayer('props-lit')));
await page.evaluate(() => { const r = document.getElementById('wf-root'); if (r) r.style.display = 'none'; });

let posed = null;
async function look(site, kind, i) {
  // ROUTE THE PAIR THE SITE CAME FROM, FIRST. The first cut of this flew to
  // coordinates with no route on the map at all — so `wayfind-lit-pad` and
  // `wayfind-lit-dark` were not in the style, `getLayer` returned nothing, and
  // two rows of the matrix came back as a tidy column of zeros that meant "the
  // layer does not exist", not "the mark is not drawn". A zero from an absent
  // instrument reads exactly like a zero from a real measurement, which is the
  // same family of mistake as §27.3's occluded camera. The lamp pixels were
  // unaffected — `props-lit` does not depend on a route — but half the table
  // was measuring nothing.
  const key = site.from + '>' + site.to;
  if (key !== posed) {
    await page.evaluate(async ([f, t]) => {
      await window.wayfindRoute(f, t, {});
      const r = document.getElementById('wf-root');
      if (r) r.style.display = 'none';
    }, [site.from, site.to]);
    posed = key;
    await page.waitForTimeout(400);
  }
  await page.evaluate(([ll, z]) => { window.__map.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 }); }, [site.ll, ZOOM]);
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise((r) => {
    const t = setTimeout(r, 3000);
    window.__map.once('idle', () => { clearTimeout(t); r(); });
  }));
  const disc = await page.evaluate(([ll, rad]) => {
    const m = window.__map, c = m.project(ll);
    const dLon = rad / (111320 * Math.cos(ll[1] * Math.PI / 180));
    return { cx: c.x, cy: c.y, r: Math.abs(m.project([ll[0] + dLon, ll[1]]).x - c.x) };
  }, [site.ll, MISS.radiusM]);
  const feats = await page.evaluate(([cx, cy, r]) => {
    const m = window.__map;
    const box = [[cx - r, cy - r], [cx + r, cy + r]];
    const lit = m.getLayer('props-lit') ? m.queryRenderedFeatures(box, { layers: ['props-lit'] }) : [];
    let warm = 0, blue = 0;
    for (const f of lit) { if ((f.properties || {}).c === 'blue') blue++; else warm++; }
    const has = (id) => { try { return m.getLayer(id) ? m.queryRenderedFeatures(box, { layers: [id] }).length : -1; } catch (e) { return -1; } };
    // Recorded per site, not assumed once: a layer can be missing for one site
    // and present for the next, and a -1 in the table must never be read as a 0.
    const present = ['props-lit', 'props-lit-core', 'wayfind-lit-pad', 'wayfind-lit-dark']
      .filter(id => !m.getLayer(id));
    return { warm, blue, dark: has('wayfind-lit-dark'), pad: has('wayfind-lit-pad'), missing: present };
  }, [disc.cx, disc.cy, disc.r]);

  const base = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
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
  await page.waitForTimeout(700);
  const mask = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  await page.evaluate(() => {
    const m = window.__map;
    for (const id of Object.keys(m.__save || {})) {
      m.setPaintProperty(id, 'circle-color', m.__save[id].color);
      m.setPaintProperty(id, 'circle-opacity', m.__save[id].op);
    }
    m.__save = {};
  });

  const px = await page.evaluate(async ([b64a, b64b, cx, cy, r, w, h]) => {
    const load = (b) => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b; });
    const [A, B] = await Promise.all([load(b64a), load(b64b)]);
    const dat = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, im.width, im.height).data; };
    const a = dat(A), b = dat(B), Wp = A.width, Hp = A.height;
    const sx = Wp / w, sy = Hp / h;
    const PX = cx * sx, PY = cy * sy, PR = r * sx;
    let discGreen = 0, frameGreen = 0, discCore = 0, frameCore = 0, frameBlue = 0;
    for (let y = 0; y < Hp; y++) for (let x = 0; x < Wp; x++) {
      const i = (y * Wp + x) * 4;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      const R = b[i], G = b[i + 1], Bl = b[i + 2], mx = Math.max(R, G, Bl);
      if (mx < 12) continue;
      const hiR = R > mx * .55, hiG = G > mx * .55, hiB = Bl > mx * .55;
      const dx = x - PX, dy = y - PY, inDisc = dx * dx + dy * dy <= PR * PR;
      if (hiG && hiB && !hiR) { frameCore++; if (inDisc) discCore++; }
      else if (hiG && !hiB && !hiR) { frameGreen++; if (inDisc) discGreen++; }
      else if (hiB && !hiG && !hiR) { frameBlue++; }
    }
    return { discGreen, frameGreen, discCore, frameCore, frameBlue, discPx: Math.round(PR) };
  }, [base.toString('base64'), mask.toString('base64'), disc.cx, disc.cy, disc.r, W, H]);

  const tag = `${OUT}/r5-${kind}-${String(i).padStart(2, '0')}-${Math.round(site.d)}m`;
  const b64 = await page.evaluate(async ([b, cx, cy, r, w]) => {
    const im = await new Promise(res => { const q = new Image(); q.onload = () => res(q); q.src = 'data:image/png;base64,' + b; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const sx = im.width / w;
    g.strokeStyle = '#ff2fd6'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx * sx, cy * sx, r * sx, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx * sx - 7, cy * sx); g.lineTo(cx * sx + 7, cy * sx);
    g.moveTo(cx * sx, cy * sx - 7); g.lineTo(cx * sx, cy * sx + 7); g.stroke();
    return c.toDataURL('image/png').split(',')[1];
  }, [base.toString('base64'), disc.cx, disc.cy, disc.r, W]);
  fs.writeFileSync(tag + '-disc.png', Buffer.from(b64, 'base64'));

  const row = { kind, i, ...site, ...feats, ...px,
    lampInDisc: px.discGreen >= LAMP_GREEN_MIN, lampInFrame: px.frameGreen >= LAMP_GREEN_MIN };
  console.log(`  ${kind} ${String(i).padStart(2)}  ${site.from}->${site.to}  nearest mapped lamp ${site.d} m` +
    `   pool px: disc ${px.discGreen}, frame ${px.frameGreen}   ` +
    `${row.lampInFrame ? 'LAMP VISIBLE' : 'nothing'}${row.lampInDisc ? ' (AND IN THE DISC)' : ''}` +
    (feats.missing.length ? `   *NOT SCORED: no ${feats.missing.join(', ')}` : ''));
  return row;
}

const rows = [];
for (let i = 0; i < LIT.length; i++) rows.push(await look(LIT[i], 'lit', i));
for (let i = 0; i < NEAR.length; i++) rows.push(await look(NEAR[i], 'near', i));
for (let i = 0; i < FAR.length; i++) rows.push(await look(FAR[i], 'far', i));

// A site whose layers were not all in the style is dropped, loudly, rather than
// scored as a zero. Silence here is what produced round 5's first false alarm.
const unscored = rows.filter(r => r.missing && r.missing.length);
if (unscored.length) console.log(`\n*${unscored.length} site(s) dropped: a layer was missing when the camera looked`);
const scored = rows.filter(r => !r.missing || !r.missing.length);
const near = scored.filter(r => r.kind === 'near'), far = scored.filter(r => r.kind === 'far');
const lit = scored.filter(r => r.kind === 'lit');
const share = (a, f) => `${a.filter(f).length} / ${a.length}`;
console.log('\n# THE MATRIX — what the card said, against what is standing there');
console.log(`                                        LIT (amber)          NEAR (${MISS.radiusM}-${MISS.nearM} m)      FAR (>${MISS.farM} m)`);
console.log(`  a warm lamp inside the 25 m disc        ${share(lit, r => r.lampInDisc).padEnd(20)} ${share(near, r => r.lampInDisc).padEnd(20)} ${share(far, r => r.lampInDisc)}`);
console.log(`  a warm lamp anywhere in the frame       ${share(lit, r => r.lampInFrame).padEnd(20)} ${share(near, r => r.lampInFrame).padEnd(20)} ${share(far, r => r.lampInFrame)}`);
console.log(`  this lane's receipt ring at its foot    ${share(lit, r => r.pad > 0).padEnd(20)} ${share(near, r => r.pad > 0).padEnd(20)} ${share(far, r => r.pad > 0)}`);
console.log(`  the map's unmapped overlay drawn        ${share(lit, r => r.dark > 0).padEnd(20)} ${share(near, r => r.dark > 0).padEnd(20)} ${share(far, r => r.dark > 0)}`);
const med = (a, k) => { const s = a.map(r => r[k]).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log(`  median frame pool pixels               ${String(med(near, 'frameGreen')).padEnd(20)} ${med(far, 'frameGreen')}`);
console.log(`  median disc pool pixels                ${String(med(near, 'discGreen')).padEnd(20)} ${med(far, 'discGreen')}`);
console.log(`  queryRenderedFeatures warm in disc      ${String(near.reduce((s, r) => s + r.warm, 0)).padEnd(20)} ${far.reduce((s, r) => s + r.warm, 0)}`);
console.log('\n# and how far the surprise actually reaches');
MISS.buckets.forEach((b, i) => {
  const g = near.filter(r => r.bucket === i);
  if (!g.length) return;
  console.log(`  ${String(b[0]).padStart(2)}-${b[1]} m from a mapped lamp:  a lamp is on screen at ` +
    `${g.filter(r => r.lampInFrame).length} / ${g.length}   (median frame pool px ${med(g, 'frameGreen')})`);
});

fs.writeFileSync(`${OUT}/stretchscene.json`, JSON.stringify({
  night, zoom: ZOOM, greenMin: LAMP_GREEN_MIN, radiusM: MISS.radiusM, nearM: MISS.nearM, farM: MISS.farM, rows, errs,
}, null, 1));
console.log(`\nwrote ${OUT}/stretchscene.json`);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
