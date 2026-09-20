/**
 * mobile-timeline.mjs — where does a phone's load time go?
 *
 * On a loaded machine the phone profile hit app.js's 90 s authored-model
 * ceiling (INTRO.authoredCeilingMs), and the visit was shown the old prisms
 * (docs/mobile-real-buildings.md, lead 3). This logs, once a second from
 * navigation to reveal, what the reveal gate is waiting on: the model data,
 * the time-sliced build, the legacy filters, the tiles.
 *
 *   VERIFY_URL=http://127.0.0.1:8601 node mobile-timeline.mjs [query] [reps]
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';

const QUERY = process.argv[2] || '?drift=0';
const REPS = +(process.argv[3] || 1);
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const browser = await launch(chromium, { gl: 'hardware', maxMs: 1800000 });
for (let rep = 0; rep < REPS; rep++) {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(BASE + '/' + QUERY, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let last = '';
  const marks = {};
  for (;;) {
    const s = await page.evaluate(() => {
      const A = window.slopesApartments, c = A ? A.count : null;
      let gate = null;
      try { gate = window.__intro && window.__intro.gate ? window.__intro.gate().missing.join('+') : null; } catch (e) {}
      let ready = null; try { ready = A ? A.readyToReveal() : null; } catch (e) { ready = 'err'; }
      let hid = null; try { hid = A ? A.hidden.missing.length + '/' + A.hidden.rigsMissing.length : null; } catch (e) {}
      return {
        data: !!(A && A.data), done: c && c.done, buildings: c && c.buildings, ms: c && c.ms, group: !!(A && A.group),
        ready, hid, gate, reason: window.__intro && window.__intro.reason, fb: window.__intro && window.__intro.modelFallback,
        frames: window.slopes && window.slopes.frames,
      };
    }).catch(() => null);
    const t = ((Date.now() - t0) / 1000).toFixed(0);
    if (s) {
      if (s.data && !marks.data) marks.data = t;
      if (s.group && !marks.group) marks.group = t;
      if (s.ready === true && !marks.ready) marks.ready = t;
      const line = `n=${s.buildings} group=${s.group} ready=${s.ready} hid=${s.hid} gate=${s.gate} fb=${s.fb || ''}`;
      if (line !== last) { console.log(`${t.padStart(4)} s  ${line}`); last = line; }
      if (s.reason) { marks.reveal = t; marks.reason = s.reason; marks.buildMs = s.ms; break; }
    }
    if (Date.now() - t0 > 200000) { marks.timeout = true; break; }
    await page.waitForTimeout(1000);
  }
  console.log(`rep ${rep + 1}:`, JSON.stringify(marks));
  await ctx.close();
}
browser.__done();
