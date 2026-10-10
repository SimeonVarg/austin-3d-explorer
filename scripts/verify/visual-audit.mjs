/**
 * visual-audit.mjs — walk every screen, panel, menu and state a visitor can reach, at three widths,
 * photograph each one, and record the numbers a reviewer needs to call something inconsistent.
 *
 *   VERIFY_URL=http://127.0.0.1:8099 VERIFY_OUT=out VERIFY_GL=hardware node visual-audit.mjs <group> [--vp phone,tablet,desktop]
 *
 * Groups (so the AWS box can run four at once, one browser each):
 *   boot      the loading screen stage by stage, the intro flight, slow network, failed data, no WebGL, context loss
 *   chrome    the buttons, the graphics menu, the feedback box, Explore, the time slider, keyboard focus, modes dialog
 *   walk      ?walk=1 (the walk sheet, schedule importer, deleting a schedule) and ?livehere=1 (apartment compare)
 *   modes     ?clip, ?timelapse, ?autopilot, ?sliderdemo, ?tour, ?lite, ?debug, labels, the terms page, a 404
 *
 * It is read-only against the app: no account, no form is sent anywhere. The importer is fed the SYNTHETIC
 * calendar files in scripts/verify/schedule-fixtures (nobody's real classes).
 *
 * Output (in VERIFY_OUT): <id>-<vp>.jpg per picture, metrics.json (per picture: every visible control's size,
 * font, radius, contrast; overlaps among fixed panels; clipped text; focus ring), timeline-<vp>.json for the
 * loader, and log.txt. The word that names the software drawing mode is kept out of this file on purpose: the AWS
 * runner fails any run whose output contains it.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launch } from './chrome.mjs';

const GROUP = process.argv[2];
const vi = process.argv.indexOf('--vp');
const onlyI = process.argv.indexOf('--only');
if (onlyI > 0) process.env.VA_ONLY = process.argv[onlyI + 1];
const oi = process.argv.indexOf('--out');
const OUT = path.resolve(oi > 0 ? process.argv[oi + 1] : (process.env.VERIFY_OUT || 'va-out'));
fs.mkdirSync(OUT, { recursive: true });

// ── taste/measurement parameters (one place) ──────────────────────────────────────────────────────────────
const VPS = {
  phone:   { name: 'phone',   viewport: { width: 390,  height: 844  }, deviceScaleFactor: 2, isMobile: true,  hasTouch: true  },
  tablet:  { name: 'tablet',  viewport: { width: 820,  height: 1180 }, deviceScaleFactor: 1, isMobile: true,  hasTouch: true  },
  desktop: { name: 'desktop', viewport: { width: 1440, height: 900  }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const WANT = (vi > 0 ? process.argv[vi + 1] : 'phone,tablet,desktop').split(',').map(s => VPS[s]).filter(Boolean);
const HOUR = { day: 0.12, golden: 0.47, night: 0.9 };       // ?p= values the poses file uses for the same three looks
const JPG = 72;
const LOAD_TIMEOUT = 150000;                                  // a cold city on the rented GPU
const STEP_TIMEOUT = 90000;

const logLines = [];
const log = (...a) => { const s = a.join(' '); logLines.push(s); console.log(s); try { fs.appendFileSync(path.join(OUT, 'log.txt'), s + '\n'); } catch (e) {} };
const metrics = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await launch(chromium, { gl: process.env.VA_GL || process.env.VERIFY_GL || 'hardware', maxMs: 3300000 });

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────
async function newPage(vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
    reducedMotion: opts.reducedMotion || 'no-preference', colorScheme: opts.colorScheme || 'light',
    acceptDownloads: false,
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('console', m => { if (m.type() === 'error') page.__errors.push(m.text().slice(0, 240)); });
  page.on('pageerror', e => page.__errors.push('PAGEERROR ' + String(e.message).slice(0, 240)));
  if (opts.init) await page.addInitScript(opts.init);
  if (opts.setup) await opts.setup(ctx, page);
  return { ctx, page };
}

async function go(page, url) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
}

async function veilGone(page, ms = LOAD_TIMEOUT) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => {
      const v = document.getElementById('veil');
      return !v || v.classList.contains('lift') || getComputedStyle(v).opacity === '0' || getComputedStyle(v).display === 'none';
    }, null, { timeout: ms });
  } catch (e) { log('  note: veil did not lift in', ms, 'ms'); return false; }
  log('  veil gone after', Date.now() - t0, 'ms');
  return true;
}

/** The city is ready when the veil lifted and the map has idled once; then stop the graphics auto-detect. */
async function ready(page, settleMs = 4000) {
  const ok = await veilGone(page);
  await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
  await page.waitForTimeout(settleMs);
  return ok;
}

/** Everything a reviewer wants to know about what is on screen right now. Runs inside the page. */
function domAudit() {
  const W = innerWidth, H = innerHeight;
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = el => { let e = el; let acc = null; while (e && e.nodeType === 1) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.05) { if (c.a >= 0.97) return acc ? mix(acc, c) : c; acc = acc ? mix(acc, c) : c; } e = e.parentElement; } return acc || { r: 0, g: 0, b: 0, a: 1, unknown: true }; };
  const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const vis = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const rect = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const name = el => el.id ? '#' + el.id : (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
  const out = { vw: W, vh: H, scrollW: document.documentElement.scrollWidth, controls: [], text: [], fixed: [], clipped: [], offscreen: [], overlaps: [] };
  const sel = 'button,a[href],input,select,textarea,[role=button],[role=tab],summary,[tabindex]';
  document.querySelectorAll(sel).forEach(el => {
    if (!vis(el)) return; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (el.closest('.maplibregl-canvas-container') && !el.closest('.maplibregl-control-container')) return;
    out.controls.push({ n: name(el), t: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 40), r: rect(el),
      font: cs.fontFamily.split(',')[0].replace(/["']/g, ''), fs: cs.fontSize, fw: cs.fontWeight, radius: cs.borderTopLeftRadius,
      color: cs.color, bg: cs.backgroundColor, z: cs.zIndex, pos: cs.position, cursor: cs.cursor, tapSmall: (r.width < 40 || r.height < 40), outline: cs.outlineStyle + ' ' + cs.outlineWidth });
  });
  // text nodes: size + contrast
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set(); let n;
  while ((n = walker.nextNode())) {
    const s = n.nodeValue.trim(); if (s.length < 2) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName) || !vis(el)) continue;
    if (el.closest('#map') && !el.closest('.maplibregl-control-container')) continue;
    const cs = getComputedStyle(el); const fg = parse(cs.color); const bg = bgOf(el); if (!fg) continue;
    const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    out.text.push({ n: name(el), s: s.slice(0, 50), fs: parseFloat(cs.fontSize), fw: cs.fontWeight, font: cs.fontFamily.split(',')[0].replace(/["']/g, ''), cr: +cr.toFixed(2), unk: !!bg.unknown, op: +(parseFloat(cs.opacity)).toFixed(2), r: rect(el) });
    const rr = el.getBoundingClientRect();
    if (rr.right > W + 1 || rr.left < -1) out.offscreen.push({ n: name(el), s: s.slice(0, 40), r: rect(el) });
    if ((el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) && /hidden|clip/.test(cs.overflow + cs.overflowX + cs.overflowY) && el.clientWidth > 0)
      out.clipped.push({ n: name(el), s: s.slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
  }
  // fixed/absolute panels in the chrome, for overlap
  const panels = [];
  document.querySelectorAll('body > *, body > * > *').forEach(el => {
    if (el.id === 'map' || el.tagName === 'SCRIPT' || !vis(el)) return; const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return; const r = el.getBoundingClientRect();
    if (r.width > W * 0.98 && r.height > H * 0.9) return;       // full-screen layers (veil, sky, vignette) are not panels
    panels.push({ n: name(el), r: rect(el), z: cs.zIndex, el });
  });
  panels.forEach(p => out.fixed.push({ n: p.n, r: p.r, z: p.z }));
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const a = panels[i], b = panels[j]; if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const x = Math.min(a.r[0] + a.r[2], b.r[0] + b.r[2]) - Math.max(a.r[0], b.r[0]);
    const y = Math.min(a.r[1] + a.r[3], b.r[1] + b.r[3]) - Math.max(a.r[1], b.r[1]);
    if (x > 4 && y > 4) out.overlaps.push([a.n, b.n, x, y]);
  }
  const ae = document.activeElement; if (ae && ae !== document.body) { const cs = getComputedStyle(ae); out.focus = { n: name(ae), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 80) }; }
  return out;
}

let shotCount = 0;
async function shot(page, vp, id, note = '', opts = {}) {
  const file = `${id}-${vp.name}.jpg`;
  try {
    await page.waitForTimeout(opts.wait ?? 450);
    await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: JPG, timeout: 60000, fullPage: !!opts.fullPage });
    // Screenshot twice, trust the second (CLAUDE.md rule 10): a first frame can be mid-transition.
    if (!opts.once) await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: JPG, timeout: 60000, fullPage: !!opts.fullPage });
    let m = null; if (!opts.noMetrics) m = await page.evaluate(domAudit).catch(e => ({ error: String(e) }));
    metrics.push({ id, vp: vp.name, note, file, m });
    shotCount++; log('  shot', file, note);
  } catch (e) { log('  SHOT FAILED', file, String(e.message).slice(0, 120)); }
}

async function step(name, fn) {
  // VA_ONLY=static,notice runs only the steps whose name contains one of these words (to debug one step cheaply).
  if (process.env.VA_ONLY && !process.env.VA_ONLY.split(',').some(w => name.includes(w))) return;
  const t0 = Date.now();
  log('> ' + name);
  try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('step timeout')), STEP_TIMEOUT * 3))]); }
  catch (e) { log('  STEP ERROR', name, String(e.message).slice(0, 200)); }
  log('  (' + Math.round((Date.now() - t0) / 1000) + ' s)');
}

const hasEl = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }, sel).catch(() => false);
async function click(page, sel, label) {
  try { await page.click(sel, { timeout: 6000 }); return true; } catch (e) {
    log('  pointer click refused', sel, String(e.message).split('\n').filter(l => /intercepts|not visible|outside|detached|stable|enabled/.test(l)).slice(0, 2).join(' | ').slice(0, 260));
    try { await page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); }, sel); log('  (click by script, not by pointer)', sel, label || ''); return !!(await page.$(sel)); } catch (e2) { log('  cannot click', sel); return false; }
  }
}
const setHour = (page, p) => page.evaluate(v => { const s = document.getElementById('tod-slider'); if (!s) return false; s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return true; }, p);

// ═══ GROUP: boot ═════════════════════════════════════════════════════════════════════════════════════════
async function boot() {
  for (const vp of WANT) {
    // 1. the default first visit, sampled over time, intro flight on
    await step(`boot default ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp);
      const t0 = Date.now(); const timeline = [];
      const sample = async (tag) => {
        const s = await page.evaluate(() => {
          const v = document.getElementById('veil'); const g = id => { const e = document.getElementById(id); return e ? (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null; };
          return { veil: !!v, cls: v ? v.className : null, pct: g('load-percent'), stages: g('load-stages'), est: g('load-estimate'), city: g('load-city'), hud: g('hud'), pill: g('mode-launcher'), body: document.body.className, html: document.documentElement.className };
        }).catch(() => null);
        timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(1), tag, s });
      };
      page.goto(BASE + '/?drift=1', { waitUntil: 'commit' }).catch(() => {});
      for (const at of [0.2, 0.8, 1.6, 2.6, 4, 6, 9, 13, 18, 25]) {
        const wait = at * 1000 - (Date.now() - t0); if (wait > 0) await sleep(wait);
        await sample('t' + at); await shot(page, vp, `boot-t${String(at).replace('.', '_')}`, `${at}s after navigation`);
        const lifted = await page.evaluate(() => !document.getElementById('veil') || document.getElementById('veil').classList.contains('lift')).catch(() => false);
        if (lifted) break;
      }
      await veilGone(page); await sample('veil-gone');
      for (const after of [1, 4, 8, 14, 22]) {
        await sleep(after === 1 ? 1000 : (after - [1, 4, 8, 14, 22][[1, 4, 8, 14, 22].indexOf(after) - 1]) * 1000);
        await sample('after+' + after); await shot(page, vp, `boot-after${after}`, `${after}s after the veil lifted (intro flight)`);
      }
      await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect()).catch(() => {});
      fs.writeFileSync(path.join(OUT, `timeline-${vp.name}.json`), JSON.stringify({ errors: page.__errors.slice(0, 40), timeline }, null, 1));
      await ctx.close();
    });

    // 2. the slow connection: how long until the "slow" copy, what the veil says
    await step(`boot slow-network ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp, { setup: async (c, p) => {
        const cdp = await c.newCDPSession(p);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 180, downloadThroughput: 1.2 * 1024 * 1024 / 8, uploadThroughput: 0.5 * 1024 * 1024 / 8 });
      } });
      const t0 = Date.now();
      page.goto(BASE + '/?intro=0&drift=0', { waitUntil: 'commit' }).catch(() => {});
      for (const at of [6, 20, 45, 60]) { const w = at * 1000 - (Date.now() - t0); if (w > 0) await sleep(w); await shot(page, vp, `slow-t${at}`, `slow network (1.2 Mbps, 180 ms), ${at}s`); }
      await ctx.close();
    });

    // 3. the data files fail
    await step(`boot data-blocked ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp, { setup: async (c) => { await c.route(/\/data\/.*\.(geojson|json|pmtiles|bin)(\?.*)?$/, r => r.abort('failed')); } });
      page.goto(BASE + '/?intro=0&drift=0', { waitUntil: 'commit' }).catch(() => {});
      for (const at of [8, 30, 60]) { await sleep(at === 8 ? 8000 : at === 30 ? 22000 : 30000); await shot(page, vp, `fail-data-t${at}`, `every file under /data/ refused, ${at}s`); }
      await ctx.close();
    });

    // 4. no WebGL at all
    await step(`boot no-webgl ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp, { init: () => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/i.test(t)) return null; return orig.call(this, t, ...a); };
      } });
      page.goto(BASE + '/?intro=0&drift=0', { waitUntil: 'commit' }).catch(() => {});
      for (const at of [6, 25]) { await sleep(at === 6 ? 6000 : 19000); await shot(page, vp, `fail-nowebgl-t${at}`, `WebGL refused, ${at}s`); }
      await ctx.close();
    });

    // 5. notices that sit on top of the city
    await step(`boot notices ${vp.name}`, async () => {
      for (const [id, q] of [['gpuhint', '/?gpuhint=1&intro=0&drift=0'], ['litesafe', '/?lite=safe&intro=0&drift=0']]) {
        const { ctx, page } = await newPage(vp);
        await go(page, q); await ready(page, 3000);
        await shot(page, vp, `notice-${id}`, q); await ctx.close();
      }
    });

    // 6. context lost
    await step(`boot context-lost ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp);
      await go(page, '/?intro=0&drift=0'); await ready(page, 2000);
      await page.evaluate(() => { const c = document.querySelector('canvas.maplibregl-canvas'); const gl = c && (c.getContext('webgl2') || c.getContext('webgl')); const e = gl && gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); }).catch(() => {});
      await sleep(4000); await shot(page, vp, 'fail-contextlost', 'WebGL context lost after load');
      await ctx.close();
    });
  }
}

// ═══ GROUP: chrome ═══════════════════════════════════════════════════════════════════════════════════════
async function chromeGroup() {
  for (const vp of WANT) {
    const { ctx, page } = await newPage(vp);
    await go(page, `/?intro=0&drift=0&p=${HOUR.day}`); await ready(page, 5000);
    const looks = [['day', HOUR.day], ['golden', HOUR.golden], ['night', HOUR.night]];
    for (const [look, p] of looks) {
      await step(`chrome ${look} ${vp.name}`, async () => {
        if (look !== 'day') { await setHour(page, p); await page.waitForTimeout(3500); }
        await shot(page, vp, `ui-${look}-main`, 'default view, chrome only');
        // graphics menu
        if (await click(page, '#gfx-button')) {
          await page.waitForTimeout(600); await shot(page, vp, `ui-${look}-gfx-top`, 'graphics menu open');
          const sc = await page.evaluate(() => { const b = document.getElementById('gfx-body'); return b ? { sh: b.scrollHeight, ch: b.clientHeight } : null; });
          if (sc && sc.sh > sc.ch + 20) {
            for (let k = 1; k * sc.ch * 0.85 < sc.sh && k < 6; k++) { await page.evaluate(y => { const b = document.getElementById('gfx-body'); if (b) b.scrollTop = y; }, k * sc.ch * 0.85); await shot(page, vp, `ui-${look}-gfx-s${k}`, 'graphics menu scrolled'); }
            await page.evaluate(() => { const b = document.getElementById('gfx-body'); if (b) b.scrollTop = 1e6; }); await shot(page, vp, `ui-${look}-gfx-end`, 'graphics menu, bottom');
          }
          if (look === 'day') {
            // every preset button, as a visitor presses them
            const presets = await page.$$eval('#gfx-presets button', bs => bs.map(b => b.textContent.trim()));
            log('  presets:', JSON.stringify(presets));
            await page.evaluate(() => { const b = document.getElementById('gfx-body'); if (b) b.scrollTop = 0; });
            for (let i = 0; i < presets.length; i++) { await page.evaluate(i => document.querySelectorAll('#gfx-presets button')[i].click(), i); await page.waitForTimeout(1200); await shot(page, vp, `ui-day-gfx-preset${i}`, 'preset ' + presets[i]); }
            await page.evaluate(() => { const r = document.getElementById('gfx-reset'); if (r) r.click(); }); await page.waitForTimeout(800);
          }
          await click(page, '#gfx-close'); await page.waitForTimeout(500);
        }
        // feedback box
        if (await click(page, '#fb-button')) {
          await page.waitForTimeout(600); await shot(page, vp, `ui-${look}-feedback`, 'recommendations box open');
          if (look === 'day') { await page.fill('#fb-text', 'The slider is hard to find on my phone.').catch(() => {}); await page.fill('#fb-name', 'A visitor').catch(() => {}); await shot(page, vp, 'ui-day-feedback-filled', 'recommendations box with text'); }
          await click(page, '#fb-close'); await page.waitForTimeout(400);
        }
        // Explore
        if (await click(page, '#explore-toggle')) {
          await page.waitForTimeout(500); await shot(page, vp, `ui-${look}-explore`, 'Explore panel');
          if (look === 'day') {
            const first = await page.$('#explore-places button'); if (first) { await first.click().catch(() => {}); await page.waitForTimeout(3500); await shot(page, vp, 'ui-day-explore-visit', 'after visiting the first place'); }
            await click(page, '#explore-toggle'); await page.waitForTimeout(300);
          } else await click(page, '#explore-toggle');
        }
        // the clock
        if (look === 'day') {
          await click(page, '#tod-play'); await page.waitForTimeout(2500); await shot(page, vp, 'ui-day-tod-playing', 'time-of-day cycle playing'); await click(page, '#tod-play');
        }
      });
    }
    // keyboard focus, in tab order, at day
    await step(`chrome focus ${vp.name}`, async () => {
      await setHour(page, HOUR.day); await page.waitForTimeout(1500);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const seen = [];
      for (let k = 0; k < 12; k++) {
        await page.keyboard.press('Tab'); await page.waitForTimeout(250);
        const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { n: e.id ? '#' + e.id : e.tagName + '.' + String(e.className).slice(0, 30), t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 60), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; });
        seen.push(f); if (k % 3 === 0 || (f && /tod-play|gfx|fb-button|explore/.test(f.n))) await shot(page, vp, `focus-${String(k).padStart(2, '0')}`, JSON.stringify(f), { noMetrics: true, once: true });
      }
      fs.writeFileSync(path.join(OUT, `focus-${vp.name}.json`), JSON.stringify(seen, null, 1));
    });
    // keys: G graphics, P photo, T tour, Shift+D debug
    await step(`chrome keys ${vp.name}`, async () => {
      await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.mouse.click(vp.viewport.width / 2, vp.viewport.height / 2).catch(() => {});
      await page.keyboard.press('KeyG'); await page.waitForTimeout(800); await shot(page, vp, 'key-g', 'G pressed'); await page.keyboard.press('KeyG'); await page.waitForTimeout(500);
      await page.keyboard.press('Shift+KeyD'); await page.waitForTimeout(600); await shot(page, vp, 'key-shiftd', 'Shift+D pressed (debug panel)'); await page.keyboard.press('Shift+KeyD');
      await page.keyboard.press('KeyP'); await page.waitForTimeout(1200); await shot(page, vp, 'key-p', 'P pressed (photo mode)'); await page.keyboard.press('KeyP'); await page.waitForTimeout(800);
      await page.keyboard.press('KeyT'); await page.waitForTimeout(6000); await shot(page, vp, 'key-t', 'T pressed (tour, 6 s in)'); await page.keyboard.press('Escape'); await page.mouse.click(vp.viewport.width / 2, vp.viewport.height / 2).catch(() => {}); await page.waitForTimeout(800);
      await page.keyboard.press('KeyR'); await page.waitForTimeout(1500); await shot(page, vp, 'key-r', 'R pressed (reset)');
    });
    // mode launcher
    await step(`chrome modes ${vp.name}`, async () => {
      if (await hasEl(page, '#mode-launcher')) {
        await shot(page, vp, 'modes-pill', 'the Switch modes pill');
        if (await click(page, '#mode-launcher')) {
          await page.waitForTimeout(700); await shot(page, vp, 'modes-dialog', 'the mode dialog');
          const sc = await page.evaluate(() => { const d = document.getElementById('mode-dialog'); return d ? { sh: d.scrollHeight, ch: d.clientHeight } : null; });
          if (sc && sc.sh > sc.ch + 20) { await page.evaluate(() => { const d = document.getElementById('mode-dialog'); d.scrollTop = 1e6; }); await shot(page, vp, 'modes-dialog-end', 'mode dialog scrolled'); }
          await page.keyboard.press('Escape'); await page.waitForTimeout(500); await shot(page, vp, 'modes-dialog-esc', 'after Escape');
        }
      } else log('  no #mode-launcher visible');
    });
    // attribution + terms link
    await step(`chrome attribution ${vp.name}`, async () => {
      await page.evaluate(() => { const d = document.querySelector('.maplibregl-ctrl-attrib'); if (d) { d.classList.add('maplibregl-compact-show'); d.setAttribute('open', ''); } });
      await page.waitForTimeout(400); await shot(page, vp, 'attrib-open', 'map attribution opened');
    });
    fs.writeFileSync(path.join(OUT, `errors-${vp.name}.json`), JSON.stringify(page.__errors.slice(0, 60), null, 1));
    await ctx.close();
  }
}

// ═══ GROUP: walk ═════════════════════════════════════════════════════════════════════════════════════════
const FIX = d => path.resolve('schedule-fixtures', d);
async function walkGroup() {
  for (const vp of WANT) {
    const { ctx, page } = await newPage(vp);
    await go(page, '/?walk=1&intro=0&drift=0'); await ready(page, 4000);
    await step(`walk sheet ${vp.name}`, async () => {
      await shot(page, vp, 'walk-closed', '?walk=1, the walk button');
      if (await click(page, '#wf-button')) {
        await page.waitForTimeout(700); await shot(page, vp, 'walk-open', 'walk sheet just opened');
        const inp = await page.$('#wf-sheet input[type=text], #wf-sheet input:not([type])');
        if (inp) {
          await inp.fill('zzzz'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); await shot(page, vp, 'walk-notfound', 'a building that does not exist');
          await inp.fill('WEL'); await page.waitForTimeout(900); await shot(page, vp, 'walk-typing', 'typing WEL');
          await page.keyboard.press('Enter'); await page.waitForTimeout(4500); await shot(page, vp, 'walk-route', 'route to WEL');
          await page.evaluate(() => { const s = document.getElementById('wf-sheet'); if (s) s.scrollTop = 1e6; }); await shot(page, vp, 'walk-route-bottom', 'route sheet scrolled to bottom');
        } else log('  no walk text input found');
        await page.keyboard.press('Slash'); await page.waitForTimeout(500);
      }
    });
    await step(`walk importer ${vp.name}`, async () => {
      if (await hasEl(page, '#wf-day-btn')) { await click(page, '#wf-day-btn'); await page.waitForTimeout(700); await shot(page, vp, 'walk-day', 'the day panel'); }
      if (!(await hasEl(page, '#wf-imp-entry'))) { await page.evaluate(() => { const s = document.getElementById('wf-sheet'); if (s) s.scrollTop = 1e6; }); }
      if (await click(page, '#wf-imp-entry')) {
        await page.waitForTimeout(800); await shot(page, vp, 'imp-open', 'schedule importer, first screen');
        const tabs = await page.$$eval('#wf-imp-tabs button', bs => bs.map(b => b.getAttribute('data-src') || b.textContent.trim()));
        log('  importer tabs:', JSON.stringify(tabs));
        for (const t of tabs) {
          await page.evaluate(t => { const b = [...document.querySelectorAll('#wf-imp-tabs button')].find(x => (x.getAttribute('data-src') || x.textContent.trim()) === t); if (b) b.click(); }, t);
          await page.waitForTimeout(500); await shot(page, vp, `imp-tab-${String(t).replace(/\W+/g, '').slice(0, 14)}`, 'importer tab ' + t);
        }
        for (const [id, f] of [['google', 'google-clean.ics'], ['messy', 'messy.ics'], ['notcal', 'not-a-calendar.ics']]) {
          await page.setInputFiles('#wf-imp-file', FIX(f)).catch(e => log('  setInputFiles failed', f)); await page.waitForTimeout(4500); await shot(page, vp, `imp-file-${id}`, 'importer after ' + f);
          await page.evaluate(() => { const b = document.getElementById('wf-imp-body'); if (b) b.scrollTop = 1e6; }); await shot(page, vp, `imp-file-${id}-bottom`, 'importer ' + f + ' scrolled');
        }
        await click(page, '#wf-imp-close'); await page.waitForTimeout(600); await shot(page, vp, 'imp-closed', 'after the importer closed');
      } else log('  no importer entry button');
    });
    await step(`walk privacy ${vp.name}`, async () => {
      if (await hasEl(page, '#wf-priv-del')) { await click(page, '#wf-priv-del'); await page.waitForTimeout(500); await shot(page, vp, 'walk-priv-confirm', 'delete my schedule: the confirm'); }
      else log('  no #wf-priv-del');
    });
    await step(`walk deep link ${vp.name}`, async () => {
      await go(page, '/?walk=1&from=WEL&to=GDC&intro=0&drift=0'); await ready(page, 5000); await shot(page, vp, 'walk-deeplink', '?walk=1&from=WEL&to=GDC');
    });
    await step(`livehere ${vp.name}`, async () => {
      await go(page, '/?livehere=1&intro=0&drift=0'); await ready(page, 6000);
      await shot(page, vp, 'lh-open', '?livehere=1 compare apartments panel');
      await page.evaluate(() => { const e = document.getElementById('lh-example'); if (e) e.click(); }); await page.waitForTimeout(1500); await shot(page, vp, 'lh-example', 'try example week');
      await page.evaluate(() => { const e = document.getElementById('lh-compare'); if (e) e.click(); }); await page.waitForTimeout(7000); await shot(page, vp, 'lh-compared', 'compare my walks');
      await page.evaluate(() => { const p = document.getElementById('live-here'); const s = p && (p.querySelector('[class*=scroll]') || p); if (s) s.scrollTop = 1e6; }); await shot(page, vp, 'lh-bottom', 'compare panel scrolled');
      await click(page, '#lh-hide'); await page.waitForTimeout(700); await shot(page, vp, 'lh-hidden', 'panel hidden: the toggle');
      await click(page, '#lh-import'); await page.waitForTimeout(800); await shot(page, vp, 'lh-import', 'import from compare panel');
    });
    fs.writeFileSync(path.join(OUT, `errors-${vp.name}.json`), JSON.stringify(page.__errors.slice(0, 60), null, 1));
    await ctx.close();
  }
}

// ═══ GROUP: modes ════════════════════════════════════════════════════════════════════════════════════════
async function modesGroup() {
  for (const vp of WANT) {
    // pages that are not the city
    await step(`static pages ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp);
      await go(page, '/terms.html'); await page.waitForTimeout(800);
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, k = 0; y < H && k < 6; y += vp.viewport.height * 0.9, k++) { await page.evaluate(y => scrollTo(0, y), y); await shot(page, vp, `terms-${k}`, 'terms page scroll ' + y, { once: true, noMetrics: k > 0 }); }
      await page.evaluate(() => scrollTo(0, 1e6)); await shot(page, vp, 'terms-end', 'terms page end');
      await go(page, '/does-not-exist'); await page.waitForTimeout(800); await shot(page, vp, 'err-404', 'a page that is not there', { noMetrics: true });
      await go(page, '/404.html'); await page.waitForTimeout(600); await shot(page, vp, 'err-404-page', 'the branded 404.html page', { noMetrics: true });
      await ctx.close();
    });
    const routes = [
      ['clip', '/?clip=1&intro=0&drift=0', 3000], ['clip-drive', '/?clip=1&drive=1&intro=0&drift=0', 3000],
      ['timelapse', '/?timelapse=1', 5000], ['autopilot', '/?autopilot=1', 6000], ['sliderdemo', '/?sliderdemo=1', 5000],
      ['tour', '/?tour=1', 5000], ['lite', '/?lite=1&intro=0&drift=0', 3000], ['lite0', '/?lite=0&intro=0&drift=0', 3000], ['debug', '/?debug=1&intro=0&drift=0', 3000],
      ['finder', '/?finder=1&intro=0&drift=0', 3000],
      ['labels', '/?labels=1&intro=0&drift=0', 5000], ['namelabels', '/?namelabels=1&intro=0&drift=0', 5000], ['entlabels', '/?entlabels=1&intro=0&drift=0', 5000],
      ['placelabels', '/?placelabels=1&intro=0&drift=0', 5000],
    ];
    for (const [id, url, settle] of routes) {
      await step(`route ${id} ${vp.name}`, async () => {
        const { ctx, page } = await newPage(vp);
        await go(page, url); await ready(page, settle);
        await shot(page, vp, 'route-' + id, url);
        await ctx.close();
      });
    }
    // every graphics preset by URL, at the Tower
    for (const preset of ['performance', 'balanced', 'cinematic', 'ultra']) {
      await step(`preset ${preset} ${vp.name}`, async () => {
        const { ctx, page } = await newPage(vp);
        await go(page, `/?preset=${preset}&intro=0&drift=0`); await ready(page, 4000);
        await shot(page, vp, 'preset-' + preset, '?preset=' + preset, { noMetrics: true });
        await ctx.close();
      });
    }
    // reduced motion: the intro flight must not run
    await step(`reduced motion ${vp.name}`, async () => {
      const { ctx, page } = await newPage(vp, { reducedMotion: 'reduce' });
      await go(page, '/'); await veilGone(page); await page.waitForTimeout(3000); await shot(page, vp, 'reduced-motion-3s', 'prefers-reduced-motion, 3s after lift');
      await ctx.close();
    });
  }
}

const GROUPS = { boot, chrome: chromeGroup, walk: walkGroup, modes: modesGroup,
  // every group in turn, one browser at a time (the owner's laptop lane allows one hardware browser)
  all: async () => { for (const g of [walkGroup, modesGroup, boot]) { try { await g(); } catch (e) { log('GROUP ERROR', e && e.message); } } } };
if (!GROUPS[GROUP]) { console.error('usage: visual-audit.mjs <boot|chrome|walk|modes> [--vp phone,tablet,desktop]'); process.exit(2); }
log(`== visual-audit ${GROUP} @ ${BASE} ${new Date().toISOString()}`);
try { await GROUPS[GROUP](); } catch (e) { log('GROUP ERROR', e && e.stack ? e.stack : e); }
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics));
log(`== done: ${shotCount} pictures`);
await browser.close();
process.exit(0);
