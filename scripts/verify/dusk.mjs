/**
 * duskcheck.mjs — the dusk handover must be CONTINUOUS.
 * Sweeps p in fine steps and measures the frame-to-frame change in the
 * premultiplied (alpha x colour) contribution of both horizon glows.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
const EXE = chromePath();
const browser = await launch(chromium);
console.log('worst frame-to-frame glow change:', JSON.stringify(r.worst));
console.log('first p where BOTH glows exceed 0.10 (true overlap):', r.overlap);
console.log('');
console.log('   p      aSun    aMoon   sunAz  moonAz');
for (const s of r.samples) if (s) console.log(`${s.p.toFixed(4)}  ${s.aSun.toFixed(4)}  ${s.aMoon.toFixed(4)}  ${s.sunAz.toFixed(1)}  ${s.moonAz.toFixed(1)}`);
await browser.__done();
