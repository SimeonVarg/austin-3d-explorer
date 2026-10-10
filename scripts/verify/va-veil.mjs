// va-veil.mjs: the very first screen of a visit (the brown veil from index.html) and the loading card that replaces it.
// js/loader.js is held back 4 s so the first screen can be photographed; nothing else is changed. (visual audit A06)
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { BASE, launch } from './chrome.mjs';
const OUT = path.resolve(process.env.VERIFY_OUT || 'va-out'); fs.mkdirSync(OUT, { recursive: true });
const browser = await launch(chromium, { gl: process.env.VERIFY_GL || 'hardware', maxMs: 300000 });
for (const [n, w, h, d, m] of [['phone', 390, 844, 2, true], ['desktop', 1440, 900, 1, false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: d, isMobile: m, hasTouch: m });
  await ctx.route('**/js/loader.js', async r => { await new Promise(res => setTimeout(res, 5000)); r.continue(); });
  const page = await ctx.newPage();
  page.goto(BASE + '/?intro=0&drift=0&finder=0', { waitUntil: 'commit' }).catch(() => {});
  await page.waitForSelector('#veil', { timeout: 30000 });
  await page.screenshot({ path: path.join(OUT, `veil-1-first-screen-${n}.jpg`), type: 'jpeg', quality: 85 });
  await page.waitForSelector('#load-city', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `veil-2-loading-card-${n}.jpg`), type: 'jpeg', quality: 85 });
  await ctx.close();
}
await browser.close(); process.exit(0);
