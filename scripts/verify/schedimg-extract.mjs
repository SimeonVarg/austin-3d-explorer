/**
 * schedimg-extract.mjs — the image-bench extractor for `js/schedimg.js`.
 *
 *   node image-bench.mjs ./schedimg-extract.mjs --name ours --json ours.json
 *
 * IT RUNS THE REAL MODULE IN A REAL BROWSER, ON THE REAL PAGE. Not a Node port
 * of it, not a reimplementation: this starts `scripts/serve.py`, opens the
 * actual site in headless Chrome, dynamically imports `js/schedimg.js` exactly
 * the way the import screen will, and hands it the JPEG as a data URL. What the
 * bench scores is therefore what a student's browser would do, which is the
 * only version of the number that means anything.
 *
 * THE IMAGE NEVER LEAVES THIS MACHINE. The data URL goes from this process into
 * a page on 127.0.0.1 and the OCR runs in a WebAssembly worker inside it.
 *
 * Everything it starts, it kills: the browser via chrome.mjs's watchdog, the
 * server on process exit, SIGINT and SIGTERM.
 */
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const PAGE_APP = 'index.html?walk=1';
export const PAGE_BLANK = 'scripts/verify/schedimg-blank.html';

let started = null;

async function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

async function waitFor(url, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return true;
    } catch (e) { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error('server never answered on ' + url);
    await new Promise(r => setTimeout(r, 150));
  }
}

/**
 * Bring up server + browser + page once, and keep them for the whole run.
 * `which` is the page the module is imported into: the real site by default.
 */
export async function session(opts = {}) {
  if (started) return started;
  started = (async () => {
    const which = opts.page || process.env.SCHEDIMG_PAGE || PAGE_APP;
    let base = process.env.SCHEDIMG_BASE || null;
    let server = null;
    if (!base) {
      const port = await freePort();
      // NEVER python -m http.server here: it ignores Range: and every PMTiles
      // layer on the real page silently vanishes.
      server = spawn(process.env.PYTHON || 'python',
        [path.join(ROOT, 'scripts', 'serve.py'), String(port)],
        { cwd: ROOT, stdio: 'ignore' });
      base = 'http://127.0.0.1:' + port;
      await waitFor(base + '/index.html');
    }
    const browser = await launch(chromium, {
      maxMs: Number(process.env.VERIFY_MAX_MS || 1800000),
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const netLog = [];
    await ctx.route('**/*', async (route) => {
      try { netLog.push(route.request().url()); } catch (e) {}
      try { await route.continue(); } catch (e) {}
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 400)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });

    await page.goto(base + '/' + which, { waitUntil: 'domcontentloaded', timeout: 120000 });
    // A correctness measure, and measured to cost nothing. Present only on the
    // real page; harmless to attempt on the blank one.
    await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });

    const loadMark = netLog.length;

    const kill = () => {
      try { browser.__done && browser.__done(); } catch (e) {}
      try { if (server && !server.killed) server.kill(); } catch (e) {}
    };
    process.once('exit', kill);
    process.once('SIGINT', () => { kill(); process.exit(130); });
    process.once('SIGTERM', () => { kill(); process.exit(143); });

    return { base, page, browser, server, errors, netLog, loadMark, which, kill };
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

/**
 * Load the module into the page — the same dynamic import the UI will do.
 *
 * SCHEDIMG_TUNE is a JSON object merged into the module's own TUNE block. It
 * exists so a threshold can be A/B'd against the corpus without editing the
 * file, which is the only honest way to choose one: measured, on all fifteen,
 * both ways.
 */
export async function importModule(page, base) {
  const tune = process.env.SCHEDIMG_TUNE || null;
  return page.evaluate(async ([b, t]) => {
    const m = await import(b + '/js/schedimg.js');
    window.__schedimg = m;
    if (t) {
      const patch = JSON.parse(t);
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(m.TUNE[k], v);
        else m.TUNE[k] = v;
      }
    }
    return { ok: typeof m.extract === 'function', tune: t || null };
  }, [base, tune]);
}

const dataUrl = (p) =>
  'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');

/**
 * AN IDLE TIMER, BECAUSE image-bench.mjs HAS NO WAY TO TELL US IT IS DONE.
 *
 * The bench's contract is one function. It calls it fifteen times, prints, and
 * returns — and then Node cannot exit, because an open browser connection and a
 * spawned server are live handles. The first version of this file left a full
 * Chrome and a `serve.py` running after every bench run; two of them were on the
 * machine at once before this was noticed, and CLAUDE.md's own note about 38
 * orphaned Chromes taking Simeon's laptop down is what that turns into.
 *
 * So the session closes itself once nothing has asked it for an image in a
 * while. The timer is cleared while an extraction is in flight — under load one
 * image has taken 134 s on this machine — and it is deliberately NOT unref'd,
 * because an unref'd timer in a process whose only other handles are the ones
 * it is meant to close would never fire.
 */
const IDLE_MS = Number(process.env.SCHEDIMG_IDLE_MS || 90000);
let idle = null;
const armIdle = () => {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => { idle = null; closeSession(); }, IDLE_MS);
};

/** The bench contract: (imagePath, meta) -> predictions[]. */
export default async function extract(imagePath, meta) {
  if (idle) { clearTimeout(idle); idle = null; }
  const s = await session();
  if (!s.imported) { await importModule(s.page, s.base); s.imported = true; }
  const url = dataUrl(imagePath);
  const res = await s.page.evaluate(async (u) => {
    const out = await window.__schedimg.extract(u);
    return {
      classes: out.classes, unsure: out.unsure, layout: out.layout,
      source: out.source, inverted: out.inverted, rows: out.rows,
      words: out.words.length, page: out.page, stages: out.stages,
      engine: out.engine,
    };
  }, url);
  extract.last = { file: meta && meta.file, ...res };
  (extract.log = extract.log || []).push(extract.last);
  armIdle();
  return res.classes.map(c => ({
    building: c.building, room: c.room, day: c.day,
    start: c.start, end: c.end,
    course: c.course, needsConfirm: c.needsConfirm,
  }));
}
