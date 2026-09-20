/**
 * audit-lodcaps.mjs — does the "Detail distance" LOD ever take a building's
 * ROOF away?
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-lodcaps.mjs <outDir> [--query "&slopes=0"] [--at id=lng,lat ...] [layers...]
 *
 * A layer NAMED on the command line is tested even when it is no longer in a
 * tier — that is the AFTER picture of a layer this audit took out of the
 * tiers (the roof must now survive the slider's minimum). `--at` pins the
 * target so BEFORE and AFTER frame the same roof.
 *
 * js/lod.js drops whole fill-extrusion passes by camera altitude. Its header
 * records the bug that happens when one of those passes is a CAP: the walls
 * under it are drawn with `fill-extrusion-pattern`, which MapLibre paints on
 * the TOP face too, so a hidden cap turns the roof into the window grid off
 * its own walls ("when i go up on low detail mode the roofs of houses become
 * windows"). `buildings-roof`, `parts-roof` and `outer-tower-roof` were taken
 * out of the tiers for exactly that. This checks every OTHER tiered layer that
 * is a flat-colour extrusion sitting on a source that also draws pattern walls.
 *
 * Method, per layer: find its biggest feature, put the eye 170 m up looking
 * at it at 40 deg pitch, shoot with the slider at "unlimited" (A) and at its
 * minimum, 150 m (B: fine hidden above 73 m, mid above 162 m). Same camera,
 * same hour; the only difference is the LOD. Then hide JUST that layer at
 * "unlimited" (C) — if C matches B on the roof, the roof change IS the cap.
 * Writes <outDir>/lodcaps-<layer>.png (A | B | diff crops) and lodcaps.json.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';
import { decodePNG } from './lib/png.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-lodcaps.mjs <outDir> [layer ...]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const qi = process.argv.indexOf('--query');
const EXTRA = qi > 0 ? process.argv[qi + 1] : '';
const AT = {};
process.argv.forEach((a, i, all) => { if (all[i - 1] === '--at') { const [id, ll] = a.split('='); const [lng, lat] = ll.split(',').map(Number); AT[id] = { lng, lat }; } });
const ONLY = process.argv.slice(3).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--query' && all[i - 1] !== '--at');
const TAG = EXTRA ? EXTRA.replace(/[^a-z0-9]+/gi, '') + '-' : '';

const browser = await launch(chromium, { gl: 'hardware', maxMs: 3000000 });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await applySwaps(page);
await page.goto(BASE + '/?intro=0&drift=0&clip=1' + EXTRA, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 400000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => window.slopesApartments && window.slopesApartments.readyToReveal(), null, { timeout: 400000 }).catch(() => console.log('apartments not ready; continuing'));

// Candidates: every tiered fill-extrusion layer with a flat colour whose
// source also carries a pattern-walled fill-extrusion layer.
const cands = await page.evaluate((named) => {
  const m = window.__map, L = m.getStyle().layers;
  const tiers = window.LOD_TIERS;
  const tierOf = id => tiers.fine.includes(id) ? 'fine' : tiers.mid.includes(id) ? 'mid' : null;
  const out = [];
  for (const l of L) {
    const t = tierOf(l.id);
    if ((!t && !named.includes(l.id)) || l.type !== 'fill-extrusion') continue;
    if (m.getPaintProperty(l.id, 'fill-extrusion-pattern') != null) continue;
    const walls = L.filter(o => o.type === 'fill-extrusion' && o.source === l.source && o.id !== l.id && m.getPaintProperty(o.id, 'fill-extrusion-pattern') != null).map(o => o.id);
    if (walls.length) out.push({ id: l.id, tier: t, source: l.source, walls });
  }
  return out;
}, ONLY);
console.log('candidates:', JSON.stringify(cands));

const rad = d => d * Math.PI / 180;
const results = [];
async function shoot(name) {
  // `idle` rarely fires (the sky repaints every frame); wait for the tiles
  // instead, bounded, then give the facade atlas a moment.
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const f = path.join(OUT, '_' + name + '.png');
  await page.screenshot({ path: f, type: 'png' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: f, type: 'png' });
  return f;
}
function diffCrop(fa, fb, box) {
  const A = decodePNG(fa), B = decodePNG(fb);
  let n = 0, s = 0, tot = 0;
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
    const i = (y * A.width + x) * A.bpp, j = (y * B.width + x) * B.bpp;
    const d = Math.max(Math.abs(A.data[i] - B.data[j]), Math.abs(A.data[i + 1] - B.data[j + 1]), Math.abs(A.data[i + 2] - B.data[j + 2]));
    s += d; tot++; if (d > 12) n++;
  }
  return { changedShare: +(n / tot).toFixed(4), meanAbs: +(s / tot).toFixed(2) };
}

for (const c of cands) {
  if (ONLY.length && !ONLY.includes(c.id)) continue;
  // Load the campus so the source's tiles exist, then find the biggest feature
  // that passes the layer's live filter.
  await page.evaluate(() => window.__map.jumpTo({ center: [-97.7395, 30.2860], zoom: 15.2, pitch: 0, bearing: 0 }));
  await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const target = AT[c.id] ? { ...AT[c.id], pinned: true, props: {} } : await page.evaluate((c) => {
    const m = window.__map;
    const feats = m.querySourceFeatures(c.source, { filter: m.getFilter(c.id) || undefined });
    let best = null, bestA = 0;
    const cosl = Math.cos(30.285 * Math.PI / 180);
    for (const f of feats) {
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p[0]) : [];
      for (const r of rings) {
        let a = 0, cx = 0, cy = 0;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) { a += (r[j][0] * cosl) * r[i][1] - (r[i][0] * cosl) * r[j][1]; }
        a = Math.abs(a / 2) * 111320 * 110540;
        for (const p of r) { cx += p[0] / r.length; cy += p[1] / r.length; }
        if (a > bestA) { bestA = a; best = { lng: cx, lat: cy, area: Math.round(a), props: Object.fromEntries(Object.entries(f.properties).filter(([k, v]) => typeof v !== 'object').slice(0, 8)) }; }
      }
    }
    return best;
  }, c);
  if (!target) { results.push({ ...c, skipped: 'no visible feature' }); console.log(`${c.id}: no feature found`); continue; }
  const alt = 170, pitch = 40, bearing = 0;
  const lead = alt * Math.tan(rad(pitch));
  const eye = [target.lng, target.lat - lead / 110540];
  await page.evaluate(({ eye, alt, pitch, bearing }) => {
    const m = window.__map, rad = d => d * Math.PI / 180;
    const D = alt / Math.cos(rad(pitch)), lead = D * Math.sin(rad(pitch));
    const clat = eye[1] + lead * Math.cos(rad(bearing)) / 110540, clng = eye[0] + lead * Math.sin(rad(bearing)) / (111320 * Math.cos(rad(eye[1])));
    const zoom = Math.log2(40075016.686 * Math.cos(rad(clat)) / (512 * (D / m.transform.cameraToCenterDistance)));
    m.jumpTo({ center: [clng, clat], zoom, pitch, bearing });
    window.applyTimeOfDay(m, 0.36, true);
  }, { eye, alt, pitch, bearing });
  const setD = d => page.evaluate(d => { window.GFX.renderDistance = d; window.applyGraphics(); }, d);
  await setD(1500);
  const fa = await shoot(c.id + '-A');
  await setD(150);
  const st = await page.evaluate(id => ({ hidden: window.LOD_isHidden(id), alt: window.__fly.eye().alt }), c.id);
  const fb = await shoot(c.id + '-B');
  await setD(1500);
  await page.evaluate(id => window.__map.setLayoutProperty(id, 'visibility', 'none'), c.id);
  const fc = await shoot(c.id + '-C');
  await page.evaluate(id => window.__map.setLayoutProperty(id, 'visibility', 'visible'), c.id);
  const box = [400, 230, 700, 530];
  const ab = diffCrop(fa, fb, box), ac = diffCrop(fa, fc, box), bc = diffCrop(fb, fc, box);
  const r = { ...c, target, eyeAlt: +st.alt.toFixed(1), hiddenAtMin: st.hidden, AvsB: ab, AvsCapOff: ac, BvsCapOff: bc };
  results.push(r);
  console.log(`${c.id} (${c.tier}) @ ${target.lng.toFixed(5)},${target.lat.toFixed(5)} ${JSON.stringify(target.props).slice(0, 100)}: A/B ${JSON.stringify(ab)}  A/cap-off ${JSON.stringify(ac)}`);
  // sheet: A | B | cap-off, the centre crop at 2x
  const toUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const jpg = await page.evaluate(async ({ urls, box, labels }) => {
    const load = u => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const ims = await Promise.all(urls.map(load));
    const w = box[2] - box[0], h = box[3] - box[1], S = 2, pad = 6;
    const c = document.createElement('canvas'); c.width = (w * S + pad) * ims.length + pad; c.height = h * S + 30;
    const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
    ims.forEach((im, k) => { g.drawImage(im, box[0], box[1], w, h, pad + k * (w * S + pad), 26, w * S, h * S); g.fillStyle = '#fff'; g.font = '15px sans-serif'; g.fillText(labels[k], pad + k * (w * S + pad) + 4, 18); });
    return c.toDataURL('image/jpeg', 0.85);
  }, { urls: [fa, fb, fc].map(toUrl), box, labels: ['Detail distance: unlimited', 'Detail distance: 150 m (min)', `unlimited, only ${c.id} hidden`] });
  fs.writeFileSync(path.join(OUT, `${TAG}lodcaps-${c.id}.jpg`), Buffer.from(jpg.split(',')[1], 'base64'));
  for (const f of [fa, fb, fc]) try { fs.unlinkSync(f); } catch (e) {}
  fs.writeFileSync(path.join(OUT, TAG + 'lodcaps.json'), JSON.stringify(results, null, 1));   // incremental
}
fs.writeFileSync(path.join(OUT, TAG + 'lodcaps.json'), JSON.stringify(results, null, 1));
await browser.__done();
