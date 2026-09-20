/**
 * audit-camera.mjs — does a scripted `jumpTo` actually put the camera where the
 * test asked, and does the LOD rule read the altitude it really reached?
 *
 *   VERIFY_URL=http://127.0.0.1:8671 node audit-camera.mjs <outDir>
 *
 * Why this exists. scripts/verify/lod-check.mjs sweeps zoom 16 -> 14.4 and
 * reads the altitude back; on 2026-09-19 that sweep returned the SAME altitude
 * for every zoom (116 m locally, 67 m on production) and the run failed two
 * checks about altitude bands that the app may well satisfy. Either the map
 * refuses the zoom, or the altitude the rule reads is not the camera's.
 * js/lod.js's altitude() prefers window.__fly.eye().alt and falls back to
 * transform.cameraToCenterDistance / transform.pixelsPerMeter, so this records
 * BOTH for every pose, next to what was asked for, with no interpretation.
 *
 * Output: <outDir>/camera.json and one line per pose.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
import { applySwaps } from './audit-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: audit-camera.mjs <outDir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await applySwaps(page);
await page.goto(BASE + '/?intro=0&drift=0&clip=1&apartments=0&slopes=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded() && !document.getElementById('veil'), null, { timeout: 300000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForTimeout(3000);

const consts = await page.evaluate(() => (window.__fly && window.__fly.consts ? window.__fly.consts() : null));
console.log('[camera] controls consts: ' + JSON.stringify(consts && {
  ALT_MIN: consts.ALT_MIN, ALT_MAX: consts.ALT_MAX, ZOOM_MIN: consts.ZOOM_MIN, ZOOM_MAX: consts.ZOOM_MAX,
  PITCH_MIN: consts.PITCH_MIN, PITCH_MAX: consts.PITCH_MAX, pitchFloor: consts.pitchFloor, altFloorMin: consts.altFloorMin,
}));

const rows = [];
// lod-check.mjs's own sweep, plus the altitudes audit-motion's climb asks for.
const ZOOMS = [17.6, 17, 16.4, 16, 15.6, 15.2, 15, 14.8, 14.4, 14.0, 13.5];
for (const z of ZOOMS) {
  const r = await page.evaluate(async (z) => {
    const m = window.__map;
    m.jumpTo({ center: [-97.7434, 30.2857], zoom: z, pitch: 70, bearing: 200 });
    await new Promise(r => setTimeout(r, 600));
    const t = m.transform;
    const eye = window.__fly ? window.__fly.eye() : null;
    return { askZoom: z, gotZoom: +m.getZoom().toFixed(3), gotPitch: +m.getPitch().toFixed(1),
             transformAlt: +(t.cameraToCenterDistance / t.pixelsPerMeter).toFixed(1),
             flyAlt: eye ? +eye.alt.toFixed(1) : null, flyPitch: eye ? +eye.pitch.toFixed(1) : null,
             driving: eye ? !!eye.driving : null, c2c: +t.cameraToCenterDistance.toFixed(1) };
  }, z);
  rows.push(r);
  console.log(`[camera] ask z${r.askZoom} -> zoom ${r.gotZoom} pitch ${r.gotPitch}  transformAlt ${r.transformAlt} m  __fly.alt ${r.flyAlt} m`);
}

// The same thing the other way round: ask for an EYE altitude the way
// audit-motion.mjs and LANES/match.mjs do, and see what is reached.
const ALTS = [40, 80, 160, 320, 640, 880];
const climb = [];
for (const alt of ALTS) {
  const r = await page.evaluate(async (alt) => {
    const m = window.__map, rad = d => d * Math.PI / 180, pitch = 62, bearing = 150;
    const lng = -97.7455, lat = 30.2905;
    const D = alt / Math.cos(rad(pitch)), lead = D * Math.sin(rad(pitch));
    const clat = lat + lead * Math.cos(rad(bearing)) / 110540, clng = lng + lead * Math.sin(rad(bearing)) / (111320 * Math.cos(rad(lat)));
    const zoom = Math.log2(40075016.686 * Math.cos(rad(clat)) / (512 * (D / m.transform.cameraToCenterDistance)));
    m.jumpTo({ center: [clng, clat], zoom, pitch, bearing });
    await new Promise(r => setTimeout(r, 600));
    const t = m.transform, eye = window.__fly ? window.__fly.eye() : null;
    return { askAlt: alt, askZoom: +zoom.toFixed(3), gotZoom: +m.getZoom().toFixed(3), gotPitch: +m.getPitch().toFixed(1),
             transformAlt: +(t.cameraToCenterDistance / t.pixelsPerMeter).toFixed(1), flyAlt: eye ? +eye.alt.toFixed(1) : null };
  }, alt);
  climb.push(r);
  console.log(`[camera] ask ${r.askAlt} m (z${r.askZoom}) -> zoom ${r.gotZoom} pitch ${r.gotPitch}  transformAlt ${r.transformAlt} m  __fly.alt ${r.flyAlt} m`);
}

fs.writeFileSync(path.join(OUT, 'camera.json'), JSON.stringify({ consts, zoomSweep: rows, altitudeSweep: climb }, null, 1));
await browser.__done();
