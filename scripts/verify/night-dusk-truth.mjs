/**
 * night-dusk-truth.mjs — steady-state ground truth for one time-of-day value.
 *
 * Usage: node night-dusk-truth.mjs <p> <outname>
 *
 * Fresh page -> applyTimeOfDay(p, force) -> 20 s of settling with repeated
 * repaints -> screenshot + atlas byte sample. Exists because the 4 s settle in
 * shot.mjs turned out to be a RACE for facade-pattern propagation: the same
 * pose screenshotted dark in one run and day-tan in another depending on which
 * atlas generation the tiles were still holding.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';
import path from 'node:path';

const P = parseFloat(process.argv[2] ?? '0.66');
const NAME = process.argv[3] || `truth-${P}`;

const browser = await launch(chromium);
console.log('atlas md00 wall pixel:', JSON.stringify(diag.atlasMd00Wall));
const file = path.resolve('shots', `${NAME}.png`);
await page.screenshot({ path: file });
console.log('WROTE', file);
await browser.__done();
