/**
 * gpu-hint.mjs — does the "graphics acceleration is off" notice show to the
 * people it is for, and ONLY to them? (js/gpu-hint.js)
 *
 * Drives the real index.html. Six cases, two browsers, one at a time:
 *
 *   hardware GL, webdriver hidden, no flag   -> no notice (reason 'hardware')
 *   SwiftShader, webdriver as-is, no flag    -> no notice, and NO GL query at
 *                                               all (reason 'webdriver') — this
 *                                               is every other script in here
 *   SwiftShader, webdriver hidden, ?gpuhint=0 -> no notice (reason 'off')
 *   SwiftShader, webdriver hidden, no flag   -> notice (reason 'software'), the
 *                                               real visitor path; then dismiss,
 *                                               reload, and it must stay gone;
 *                                               then ?gpuhint=1 brings it back
 *   SwiftShader, ?gpuhint=1, 1440x900        -> notice, inside the frame, clear
 *                                               of the title pill and buttons
 *   SwiftShader, ?gpuhint=1, 390x844 phone   -> the same, no sideways scroll
 *
 * "webdriver hidden" means an init script makes navigator.webdriver read false,
 * so the renderer check itself runs — otherwise every case here would pass on
 * the webdriver stand-down alone and prove nothing about detection.
 *
 *   --out <dir>   write the desktop and phone frames there (second of two
 *                 screenshots, per README). Keep it OUTSIDE the repo.
 *   --break       report a hardware renderer to the page (getParameter patched
 *                 in the page only). The visitor-path case must then go red.
 *
 * Exit 0 pass, 1 fail, 2 bad arguments.
 * Usage: VERIFY_URL=http://127.0.0.1:8824 node gpu-hint.mjs --out <dir>
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = oi >= 0 ? argv[oi + 1] : null;
if (oi >= 0 && !OUT) { console.error('--out needs a directory'); process.exit(2); }
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const BREAK = argv.includes('--break');

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
// Software rendering at ~4 fps: a screenshot waits for a frame, and so does
// the veil. Generous on purpose; a real hang still ends at the watchdog.
const SHOT_MS = 180000;
const VEIL_MS = 150000;

let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const HIDE_WEBDRIVER = () => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
};
// --break: any renderer query answers with a real GPU's string.
const FAKE_HARDWARE = () => {
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const real = C.prototype.getParameter;
    C.prototype.getParameter = function (p) {
      if (p === 0x9246 || p === 0x1F01) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Ti Direct3D11)';
      return real.call(this, p);
    };
  }
};

async function open(browser, ctxOpts, query, { hideWebdriver = true } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  if (hideWebdriver) await ctx.addInitScript(HIDE_WEBDRIVER);
  if (BREAK) await ctx.addInitScript(FAKE_HARDWARE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/index.html' + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  return { ctx, page, errors };
}

async function settle(page) {
  await page.waitForFunction(() => window.__gpuHint && window.__gpuHint.checked, null, { timeout: 90000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
}

const state = (page) => page.evaluate(() => {
  const el = document.getElementById('gpu-hint');
  const r = el && el.getBoundingClientRect();
  return Object.assign({}, window.__gpuHint, {
    present: !!el,
    visible: !!(r && r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'),
    box: r && { x: r.x, y: r.y, w: r.width, h: r.height },
    webdriver: navigator.webdriver,
  });
});

const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function frame(page, name, vw) {
  // Wait out the load veil so the city is behind the notice, then the README's
  // rule: screenshot twice, trust the second.
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: VEIL_MS, polling: 500 })
    .catch(() => console.log('  (veil still up at the deadline — frame shows the load screen)'));
  await page.waitForTimeout(3000);
  await page.screenshot({ type: 'jpeg', quality: 80, timeout: SHOT_MS });
  await page.waitForTimeout(1500);
  if (OUT) {
    const file = path.join(OUT, name + '.jpg');
    await page.screenshot({ path: file, type: 'jpeg', quality: 80, timeout: SHOT_MS });
    console.log('  frame ' + file);
  }
  const lay = await page.evaluate(() => {
    const box = (id) => {
      const e = document.getElementById(id);
      if (!e || getComputedStyle(e).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    return { hint: box('gpu-hint'), hud: box('hud'), gfx: box('gfx-button'), fb: box('fb-button'),
      scrollW: document.documentElement.scrollWidth };
  });
  const h = lay.hint;
  check(!!h && h.x >= 0 && h.x + h.w <= vw, `${name}: notice inside the frame horizontally (${h ? Math.round(h.x) + '..' + Math.round(h.x + h.w) : 'none'} of ${vw})`);
  check(lay.scrollW <= vw, `${name}: no sideways scroll (scrollWidth ${lay.scrollW})`);
  for (const k of ['hud', 'gfx', 'fb']) check(!overlaps(h, lay[k]), `${name}: clear of #${k === 'hud' ? 'hud' : k + '-button'}`);
}

try {
  // ── Hardware GL ────────────────────────────────────────────────────
  {
    console.log('hardware GL, webdriver hidden, no flag');
    const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
    const { page, errors } = await open(browser, DESKTOP, '');
    const s = await state(page);
    console.log('  renderer: ' + s.renderer);
    // Under --break the renderer is faked to a GPU anyway, so this case is
    // green either way; the case that must flip is the SwiftShader one.
    check(!s.present && s.reason === 'hardware', `no notice (reason '${s.reason}')`);
    check(!/swiftshader|basic render/i.test(s.renderer) && s.renderer !== '', 'a real GPU renderer was read');
    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    browser.__done();
  }

  // ── SwiftShader ────────────────────────────────────────────────────
  const browser = await launch(chromium, { maxMs: 900000 });
  {
    console.log('SwiftShader, webdriver as the harness has it, no flag');
    const { ctx, page, errors } = await open(browser, DESKTOP, '', { hideWebdriver: false });
    const s = await state(page);
    check(s.webdriver === true, 'navigator.webdriver is true in a harness browser');
    check(!s.present && s.reason === 'webdriver', `no notice (reason '${s.reason}')`);
    check(s.renderer === '', 'the GL context was never queried');
    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }
  {
    console.log('SwiftShader, webdriver hidden, ?gpuhint=0');
    const { ctx, page } = await open(browser, DESKTOP, '?gpuhint=0');
    const s = await state(page);
    check(!s.present && s.reason === 'off', `no notice (reason '${s.reason}')`);
    await ctx.close();
  }
  {
    console.log('SwiftShader, webdriver hidden, no flag — the visitor path');
    const { ctx, page, errors } = await open(browser, DESKTOP, '');
    let s = await state(page);
    console.log('  renderer: ' + s.renderer + ' | browser row: ' + s.browser);
    check(s.visible && s.reason === 'software', `notice shows (reason '${s.reason}')`);
    if (s.visible) {
      await page.click('#gpu-hint button[data-act=close]');
      s = await state(page);
      check(!s.present, 'dismiss removes it');
      const stored = await page.evaluate(() => { try { return localStorage.getItem('austin3d.gpuhint.dismissed.v1'); } catch (e) { return null; } });
      check(!!stored, 'dismissal written to localStorage');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await settle(page);
      s = await state(page);
      check(!s.present && s.reason === 'dismissed', `stays gone after reload (reason '${s.reason}')`);
      await page.goto(BASE + '/index.html?gpuhint=1', { waitUntil: 'domcontentloaded' });
      await settle(page);
      s = await state(page);
      check(s.visible && s.reason === 'forced', `?gpuhint=1 brings it back after a dismissal (reason '${s.reason}')`);
    }
    check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
    await ctx.close();
  }
  if (!BREAK) {
    for (const [name, opts] of [['after-desktop', DESKTOP], ['after-phone', PHONE]]) {
      console.log(`SwiftShader, ?gpuhint=1, ${opts.viewport.width}x${opts.viewport.height}`);
      // Webdriver left TRUE: the flag alone has to be enough.
      const { ctx, page, errors } = await open(browser, opts, '?gpuhint=1', { hideWebdriver: false });
      const s = await state(page);
      check(s.visible && s.reason === 'forced', `notice shows (reason '${s.reason}', browser row '${s.browser}')`);
      await frame(page, name, opts.viewport.width);
      check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
      await ctx.close();
    }
  }
  browser.__done();
} catch (e) {
  console.error(e);
  process.exit(1);
}

console.log(failed ? `\n${failed} FAILED${BREAK ? ' (expected under --break)' : ''}` : '\nALL PASS');
process.exit(failed ? 1 : 0);
