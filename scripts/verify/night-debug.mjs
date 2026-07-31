/**
 * night-debug.mjs — one-off: what does the facade atlas actually contain at
 * p=0.66, and does updateFacades run? Reads the registered style image bytes
 * before and after the call — no rendering in the loop, no tile-rebuild lag.
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
console.log(JSON.stringify(r, null, 1));
await browser.__done();
