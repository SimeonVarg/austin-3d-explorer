/**
 * banding.mjs — measure two things nobody has checked:
 *   1. 8-bit banding in the sky gradient (sample a vertical column, look for
 *      long runs of identical values and count the step sizes)
 *   2. the real cost of the sky overlay redraw while flying
 * Uses _harness.html because it forces preserveDrawingBuffer, which is the only
 * way to read our own pixels back.
 */
import { chromium } from 'playwright-core';
import { chromePath, launch } from './chrome.mjs';
const EXE = chromePath();
const browser = await launch(chromium);
console.log(JSON.stringify(out, null, 1));
await browser.__done();
