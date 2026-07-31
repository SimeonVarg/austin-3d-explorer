/**
 * night-roadprobe.mjs — one-off: what does querySourceFeatures return for the
 * basemap transportation layer at spawn? Source name, classes, counts, and the
 * bbox of the buildings data (the streetlight fence).
 */
import { chromium } from 'playwright-core';
import { chromePath, GL_ARGS, BASE, launch } from './chrome.mjs';

const browser = await launch(chromium);
console.log(JSON.stringify(r, null, 1));
await browser.__done();
