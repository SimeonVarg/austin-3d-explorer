/**
 * img-import-extract.mjs — the image-bench extractor for the SHIPPED IMPORT.
 *
 *   node image-bench.mjs ./img-import-extract.mjs --name integrated
 *
 * WHAT IT SCORES, AND WHY IT IS NOT THE SAME THING `schedimg-extract.mjs`
 * SCORES. That file calls `js/schedimg.js`'s `extract()` and scores the reader.
 * This one hands a picture to `window.wayfindImportImage` on the real page and
 * then scores **what ends up on the device** — `window.wayfindSchedule.events`
 * after the student has pressed "Use these" — which is the number that decides
 * whether they walk to the right building.
 *
 * Everything between the two is the piece being measured: the confirm screen,
 * `impPlace`'s router lookups, the de-duplication, the store, and the
 * republication. Any of them can lose a class the reader got right, and the
 * only way to find out is to score the far end.
 *
 * ── THE STUDENT THIS SIMULATES, STATED PLAINLY ──────────────────────────────
 * SCHEDULE_ANSWER=skip (the default) presses **"Skip the rest"** and then
 * **"Use these"**: a student who answers nothing at all. That is the FLOOR, and
 * it is the honest default because it is the only behaviour a harness can
 * produce without a model of what the student knows. A student who answers the
 * questions can only do better — every question exists because the app is not
 * sure, and the buttons contained the right answer on 37 of 37 of the wrong
 * classes it asked about (`docs/img-confidence.md`).
 *
 * It does NOT reach past the UI. Every step is a real click on a real control,
 * because a harness with a private back door measures a feature that does not
 * ship.
 *
 * THE IMAGE NEVER LEAVES THIS MACHINE. The JPEG is fetched by the page from
 * 127.0.0.1 and turned into a `File` there; the OCR runs in a WebAssembly
 * worker inside that tab.
 *
 * Everything it starts, it kills — the browser through chrome.mjs's watchdog,
 * the server on exit, SIGINT and SIGTERM.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** How the simulated student behaves. `skip` answers nothing (the floor). */
const ANSWER = process.env.SCHEDULE_ANSWER || 'skip';
/** How long one picture may take, end to end, before it is called a failure.
 *  Measured on this machine: a clean table is ~12 s, an angled photo ~40 s. */
const PER_IMAGE_MS = Number(process.env.IMGIMPORT_TIMEOUT_MS || 300000);

let started = null;

async function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; } catch (e) {}
    if (Date.now() - t0 > ms) throw new Error('server never answered on ' + url);
    await new Promise(r => setTimeout(r, 150));
  }
}

export async function session(opts = {}) {
  if (started) return started;
  started = (async () => {
    let base = process.env.SCHEDIMG_BASE || null;
    let server = null;
    if (!base) {
      const port = await freePort();
      // NEVER `python -m http.server`: it ignores `Range:` and every PMTiles
      // layer on the real page silently vanishes.
      server = spawn(process.env.PYTHON || 'python',
        [path.join(ROOT, 'scripts', 'serve.py'), String(port)],
        { cwd: ROOT, stdio: 'ignore' });
      base = 'http://127.0.0.1:' + port;
      await waitFor(base + '/index.html');
    }
    const browser = await launch(chromium, {
      maxMs: Number(process.env.VERIFY_MAX_MS || 3600000),
    });
    // THE PHONE, because that is the frame Simeon judges from and because a
    // panel that does not fit is a defect this suite has shipped before.
    const ctx = await browser.newContext({
      viewport: { width: opts.width || 390, height: opts.height || 844 },
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 400)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });

    await page.goto(base + '/index.html?walk=1&drift=0',
      { waitUntil: 'domcontentloaded', timeout: 180000 });
    // A correctness measure, and measured to cost nothing.
    await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
    await page.waitForSelector('#wf-imp-entry', { timeout: 180000 });

    const kill = () => {
      try { browser.__done && browser.__done(); } catch (e) {}
      try { if (server && !server.killed) server.kill(); } catch (e) {}
    };
    process.once('exit', kill);
    process.once('SIGINT', () => { kill(); process.exit(130); });
    process.once('SIGTERM', () => { kill(); process.exit(143); });
    return { base, page, browser, server, errors, kill };
  })();
  return started;
}

export async function closeSession() {
  if (idle) { clearTimeout(idle); idle = null; }
  if (!started) return;
  const s = await started;
  started = null;
  s.kill();
}

/** `image-bench.mjs` has no way to say it is done, so the session closes itself
 *  once nothing has asked it for a picture in a while. Not unref'd: an unref'd
 *  timer in a process whose only other handles are the ones it is meant to
 *  close would never fire. Same reasoning as `schedimg-extract.mjs`. */
const IDLE_MS = Number(process.env.SCHEDIMG_IDLE_MS || 90000);
let idle = null;
const armIdle = () => {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => { idle = null; closeSession(); }, IDLE_MS);
};

/** Click the first button inside `sel` whose text matches `re`. */
async function clickIn(page, sel, re) {
  return page.evaluate(([s, src]) => {
    const rx = new RegExp(src, 'i');
    const b = [...document.querySelectorAll(s + ' button')]
      .find(x => rx.test((x.textContent || '').trim()));
    if (!b) return false;
    b.click();
    return true;
  }, [sel, re.source]);
}

/** The bench contract: (imagePath, meta) -> predictions[]. */
export default async function extract(imagePath, meta) {
  if (idle) { clearTimeout(idle); idle = null; }
  const s = await session();
  const page = s.page;
  const file = path.basename(imagePath);
  const t0 = Date.now();

  // A CLEAN DEVICE PER PICTURE. The store is one key and a second import would
  // otherwise be scored on top of the first one's classes.
  await page.evaluate(() => {
    try { WAYFIND.store.clear(); } catch (e) {}
    try { window.wayfindImportClose(); } catch (e) {}
  });

  await page.evaluate(async (img) => {
    const r = await fetch('/scripts/verify/schedule-images/' + img);
    if (!r.ok) throw new Error('corpus image ' + img + ' -> ' + r.status);
    const b = await r.blob();
    // A `File` and not a data URL: this is exactly the object a `<input
    // type=file>` hands the page, which is the thing being measured.
    window.wayfindImportImage(new File([b], img, { type: 'image/jpeg' }));
  }, file);

  // ── the student ───────────────────────────────────────────────────────────
  // Wait for the check screen, then behave. If it never appears the import
  // failed before it — which is a real outcome and is scored as zero, not as a
  // crash.
  let sawConfirm = false;
  try {
    await page.waitForSelector('#wf-cfm', { timeout: PER_IMAGE_MS, state: 'attached' });
    sawConfirm = true;
  } catch (e) { /* no readings at all */ }

  if (sawConfirm) {
    if (ANSWER === 'skip') {
      // Straight to the summary. `Skip the rest` is a control the screen ships.
      for (let i = 0; i < 8; i++) {
        if (!await clickIn(page, '#wf-cfm', /skip the rest/)) break;
        await page.waitForTimeout(120);
      }
    } else if (ANSWER === 'lead') {
      // A STUDENT WHO ANSWERS EVERY QUESTION BY PRESSING THE TOP BUTTON. This
      // is NOT a ceiling and must not be read as one: when the app can NAME a
      // defect in the reading, the top button is the CORRECTION and not the
      // reading, on purpose — so this student is sometimes agreeing to a change
      // and sometimes to the reading, without knowing which. It is here to
      // price ONE thing: how much of the gap between the reader's score and the
      // shipped score is "readings a student never looked at were not saved".
      for (let i = 0; i < 24; i++) {
        const stepped = await page.evaluate(() => {
          const root = document.getElementById('wf-cfm');
          if (!root) return 'gone';
          if (root.querySelector('.cfm-sum, .cfm-retake')) return 'summary';
          // A days question is a multi-select: accept what was read.
          const accept = root.querySelector('.cfm-go.cfm-wide');
          if (accept && !accept.disabled) { accept.click(); return 'days'; }
          const opt = root.querySelector('.cfm-opt');
          if (opt) { opt.click(); return 'option'; }
          return 'none';
        });
        if (stepped === 'summary' || stepped === 'gone' || stepped === 'none') break;
        await page.waitForTimeout(140);
      }
      // Anything the loop could not answer still has to reach the summary.
      for (let i = 0; i < 8; i++) {
        if (!await clickIn(page, '#wf-cfm', /skip the rest/)) break;
        await page.waitForTimeout(120);
      }
    }
    await page.waitForTimeout(250);
    // The summary's own button: `Use these N classes`, or `Close` when nothing
    // survived. Either resolves the promise the import is waiting on.
    await clickIn(page, '#wf-cfm', /^(use |close$)/);
  }

  // The import result screen, and then its own `Use these` — which is the tap
  // that saves. Nothing is written to the device before it.
  let used = false;
  try {
    await page.evaluate(async () => { await window.wayfindImportImageDone; return true; });
    used = await clickIn(page, '#wf-imp-foot', /^use /);
    await page.waitForTimeout(250);
  } catch (e) { /* the result screen said nothing was placed */ }

  const out = await page.evaluate(() => {
    const sch = window.wayfindSchedule;
    const st = (() => { try { return WAYFIND.store.load(); } catch (e) { return null; } })();
    return {
      published: !!sch,
      source: sch ? sch.source : null,
      decoder: sch ? sch.decoder : null,
      saved: sch ? sch.saved : null,
      stored: st && st.classes ? st.classes.length : 0,
      err: (() => { const r = window.wayfindImportResult(); return r ? (r.err || null) : null; })(),
      events: sch && Array.isArray(sch.events) ? sch.events.map(e => ({
        code: e.code, room: e.room, days: e.days,
        startMin: e.startMin, endMin: e.endMin,
        course: e.course, status: e.status, confidence: e.confidence,
      })) : [],
    };
  });

  extract.last = { file, ms: Date.now() - t0, sawConfirm, used, ...out };
  (extract.log = extract.log || []).push(extract.last);
  armIdle();

  // WHAT IS SCORED IS EVERY EVENT ON THE DEVICE, placed or not. A class in a
  // building this app cannot walk to is still the student's class and is still
  // stored with the reason — dropping the rejects here would score the router's
  // coverage instead of the import's reading.
  return out.events.map(e => ({
    building: e.code, room: e.room, days: e.days,
    startMin: e.startMin, endMin: e.endMin,
    course: e.course, needsConfirm: e.confidence != null && e.confidence < 1,
  }));
}
