/**
 * edgesweep.mjs — pick the two values round 7 changed by measuring them, not
 * by looking at them and feeling good.
 *
 * `readable.mjs` says WHAT fails. This says what to set it to. Two knobs, and
 * each one is swept across candidates on the real card, at both widths, with
 * the ratio read off the rendered pixels each time — the same sampler
 * `readable.mjs` uses, so the numbers are directly comparable with its table.
 *
 *   litStripEdgeCol      the bar's frame, and the same frame on the key
 *                        swatch. Needs 3:1 against the card (WCAG 1.4.11).
 *   litStripCapsOpacity  START / DOOR under the bar, at litStripCapsPx.
 *                        Needs 4.5:1 — it is 9.5 px text.
 *
 * WHY THE CANDIDATES ARE WHAT THEY ARE. The edge colours are `litStripDarkCol`
 * lifted along its own ramp, so whatever wins reads as the bar's edge rather
 * than as a new colour introduced to pass a test. The lowest candidate that
 * clears with real margin wins, NOT the highest: a bright frame around a quiet
 * bar would pass this and lose the picture, which is why the frames are written
 * out and looked at as well as scored.
 *
 * THE CONTROL THAT MATTERS. The reason for an edge instead of a lighter fill is
 * that the fill's job is to separate from AMBER, not from the card. That claim
 * is measured here too, at every candidate: cool-against-lit must not move,
 * because the fill does not move.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/edgesweep.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const FRAMES = process.env.VERIFY_FRAMES || OUT;
fs.mkdirSync(FRAMES, { recursive: true });
const NIGHT = 0.92;
const AA_MARK = 3.0, AA_BODY = 4.5;

// litStripDarkCol #46536f, lifted along its own ramp toward litTextDim #9fb0cc.
const EDGES = ['#46536f', '#5a6688', '#6b779a', '#7b88a6', '#8b98b6', '#9fb0cc'];
const CAPS = [0.45, 0.52, 0.58, 0.62, 0.68, 0.75];
// The all-cool bar is the shape this is about; the mixed bar is the control for
// the amber separation.
const ROUTES = [['GDC', 'The Castilian', 'all-cool bar'], ['ANB', 'ETC', 'mixed bar']];
const WIDTHS = [[390, 844, 'iphone'], [1280, 900, 'desktop']];

const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const rows = [];
const errs = [];

for (const [W, H, dev] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errs.push(dev + ': ' + e.message));
  await page.goto(BASE + '/_harness.html?intro=0&drift=0&walk=1', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
  await page.evaluate(() => { if (window.cancelGraphicsAutoDetect) window.cancelGraphicsAutoDetect(); });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 120000 });
  await page.evaluate((p) => {
    const el = document.getElementById('tod-slider');
    if (el) { el.value = String(p); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    if (typeof window.applyTimeOfDay === 'function') window.applyTimeOfDay(window.__map, p, true);
  }, NIGHT);
  await page.waitForTimeout(1200);

  for (const [from, to, shape] of ROUTES) {
    for (let ci = 0; ci < Math.max(EDGES.length, CAPS.length); ci++) {
      const edgeCol = EDGES[Math.min(ci, EDGES.length - 1)];
      const capsOp = CAPS[Math.min(ci, CAPS.length - 1)];
      await page.evaluate(([e, c]) => { window.WAYFIND.litStripEdgeCol = e; window.WAYFIND.litStripCapsOpacity = c; }, [edgeCol, capsOp]);
      // Re-route so the card is rebuilt from the new constants. Twice on the
      // first pass of a session: the lamp index is fetched on the first route
      // and the first card of a run carries no strip at all.
      await page.evaluate(async ([f, t]) => { await window.wayfindRoute(f, t, { expand: true }); }, [from, to]);
      await page.waitForTimeout(500);
      await page.evaluate(async ([f, t]) => { await window.wayfindRoute(f, t, { expand: true }); }, [from, to]);
      await page.waitForTimeout(700);

      const geo = await page.evaluate(() => {
        const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
        if (!card) return null;
        const kids = Array.from(card.children);
        const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
        if (hi < 0) return null;
        const wrap = kids.slice(hi).find(k => k.querySelector && k.querySelector('[role="img"]'));
        if (!wrap) return null;
        const track = wrap.querySelector('[role="img"]');
        const caps = Array.from(wrap.children).find(c => c !== track);
        const sw = kids.slice(hi).map(k => k.querySelector && k.querySelector('span[aria-hidden="true"]')).find(Boolean);
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
        const W = window.WAYFIND;
        const norm = (c) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? [+m[1], +m[2], +m[3]] : null; };
        const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
        const near = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 9;
        const segs = Array.from(track.children).filter(c => getComputedStyle(c).position !== 'absolute');
        const litSeg = segs.find(s2 => near(norm(getComputedStyle(s2).backgroundColor), hex(W.litStripLitCol)));
        const darkSeg = segs.find(s2 => near(norm(getComputedStyle(s2).backgroundColor), hex(W.litStripDarkCol)));
        return {
          track: rect(track), blockTop: kids[hi].getBoundingClientRect().top,
          caps: caps && caps.children[0] ? rect(caps.children[0]) : null,
          swatch: sw ? rect(sw) : null,
          litSeg: litSeg ? rect(litSeg) : null, darkSeg: darkSeg ? rect(darkSeg) : null,
          trackH: track.getBoundingClientRect().height, edgePx: W.litStripEdgePx,
        };
      });
      if (!geo) { errs.push(`${dev} ${from}: no strip`); continue; }

      const b64 = (await page.screenshot()).toString('base64');
      const px = await page.evaluate(async ([b64, geo, dpr]) => {
        const im = await new Promise(r => { const q = new Image(); q.onload = () => r(q); q.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const at = (x, y) => { const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data; return [d[0], d[1], d[2]]; };
        const modeIn = (r) => {
          const d = g.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr), Math.max(1, Math.round(r.w * dpr)), Math.max(1, Math.round(r.h * dpr))).data;
          const hist = new Map();
          for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
          let mk = 0, mn = -1; for (const [k, n] of hist) if (n > mn) { mn = n; mk = k; }
          return [(mk >> 16) & 255, (mk >> 8) & 255, mk & 255];
        };
        const extremeIn = (r, bg) => {
          const d = g.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr), Math.max(1, Math.round(r.w * dpr)), Math.max(1, Math.round(r.h * dpr))).data;
          const L = (a) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
          const bl = L(bg); const hist = new Map();
          for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
          let best = -1, ink = bg;
          for (const [k, n] of hist) { if (n < 2) continue; const p = [(k >> 16) & 255, (k >> 8) & 255, k & 255]; const dl = Math.abs(L(p) - bl); if (dl > best) { best = dl; ink = p; } }
          return ink;
        };
        const t = geo.track;
        // THE FRAME, SAMPLED AS A BAND AND NOT AS A POINT. The first cut read
        // one pixel at `t.y + 0.5` and returned the same 2.51 for every
        // candidate in the sweep — a flat column is what a sampler that has
        // missed its subject looks like, and it had landed on the fill. A
        // 1 CSS px border is 2 device rows at DPR 2 and `getBoundingClientRect`
        // returns fractional tops, so a rounded single coordinate lands on
        // either side of it at random. Take the MODE of the whole top edge over
        // the middle 60 % of the width, which skips the rounded corners.
        const edge = modeIn({ x: t.x + t.w * 0.2, y: t.y, w: t.w * 0.6, h: Math.max(0.5, geo.edgePx) });
        // The glass just above the bar (its own 7 px margin).
        const glass = at(t.x + t.w / 2, t.y - 4);
        const capsBg = geo.caps ? modeIn(geo.caps) : null;
        const capsInk = geo.caps ? extremeIn(geo.caps, capsBg) : null;
        const swFill = geo.swatch ? at(geo.swatch.x + geo.swatch.w / 2, geo.swatch.y + geo.swatch.h / 2) : null;
        // THE SWATCH'S FRAME IS SAMPLED AS A RING, NOT A BAND. A 9 px square's
        // top band is 2 device rows and its rect top is fractional, so the band
        // reader that works on a 1050 px bar returned the CARD for the square —
        // 1.01:1, the ratio of a thing against itself, at every candidate. A
        // ring two device pixels thick inside the rect cannot miss.
        const ringMode = (r, thick) => {
          const x0 = Math.round(r.x * dpr), y0 = Math.round(r.y * dpr);
          const w = Math.max(1, Math.round(r.w * dpr)), h = Math.max(1, Math.round(r.h * dpr));
          const t = Math.max(1, Math.round(thick * dpr));
          const d = g.getImageData(x0, y0, w, h).data;
          const hist = new Map();
          for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
            if (xx >= t && xx < w - t && yy >= t && yy < h - t) continue;   // the core
            const i = (yy * w + xx) * 4;
            const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
            hist.set(k, (hist.get(k) || 0) + 1);
          }
          let mk = 0, mn = -1; for (const [k, n] of hist) if (n > mn) { mn = n; mk = k; }
          return [(mk >> 16) & 255, (mk >> 8) & 255, mk & 255];
        };
        const swEdge = geo.swatch ? ringMode(geo.swatch, geo.edgePx) : null;
        const swAround = geo.swatch ? at(geo.swatch.x - 3, geo.swatch.y + geo.swatch.h / 2) : null;
        const litFill = geo.litSeg ? at(geo.litSeg.x + geo.litSeg.w / 2, geo.litSeg.y + geo.litSeg.h / 2) : null;
        const darkFill = geo.darkSeg ? at(geo.darkSeg.x + geo.darkSeg.w / 2, geo.darkSeg.y + geo.darkSeg.h / 2) : null;
        return { edge, glass, capsBg, capsInk, swFill, swEdge, swAround, litFill, darkFill };
      }, [b64, geo, 2]);

      rows.push({
        dev, W, from, to, shape, edgeCol, capsOp, trackH: geo.trackH,
        edgeVsGlass: +ratio(px.edge, px.glass).toFixed(2),
        swEdgeVsAround: px.swEdge && px.swAround ? +ratio(px.swEdge, px.swAround).toFixed(2) : null,
        swFill: px.swFill, darkFill: px.darkFill, litFill: px.litFill,
        coolVsLit: px.litFill && px.darkFill ? +ratio(px.litFill, px.darkFill).toFixed(2) : null,
        capsVsGlass: px.capsInk ? +ratio(px.capsInk, px.capsBg).toFixed(2) : null,
      });

      // One frame per candidate, so the winner is looked at and not only scored.
      const box = { x: Math.max(0, geo.track.x - 8), y: Math.max(0, geo.blockTop - 6), width: Math.min(geo.track.w + 16, 1400), height: (geo.caps ? geo.caps.y + geo.caps.h : geo.track.y + geo.track.h) - geo.blockTop + 14 };
      await page.screenshot({ clip: box, path: `${FRAMES}/sweep-${dev}-${from}-${edgeCol.slice(1)}-caps${String(capsOp).replace('.', '')}.png` });
    }
  }
  await page.close();
}

console.log('\nEDGE / CAPS SWEEP   (marks need ' + AA_MARK + ':1, 9.5 px caps need ' + AA_BODY + ':1)\n');
for (const [W, , dev] of WIDTHS) {
  console.log(`  ${dev} ${W}px`);
  console.log('    edgeCol   caps   bar-edge  swatch-edge   CAPS   | control: cool-vs-lit   bar height');
  for (const r of rows.filter(x => x.dev === dev && x.shape === 'all-cool bar')) {
    const mixed = rows.find(x => x.dev === dev && x.shape === 'mixed bar' && x.edgeCol === r.edgeCol);
    const ok = (v, n) => (v == null ? ' n/a ' : (v >= n ? ' ' : '!') + String(v).padStart(5));
    console.log(`    ${r.edgeCol}  ${String(r.capsOp).padEnd(5)} ${ok(r.edgeVsGlass, AA_MARK)}   ${ok(r.swEdgeVsAround, AA_MARK)}      ${ok(r.capsVsGlass, AA_BODY)}  |        ${mixed && mixed.coolVsLit != null ? mixed.coolVsLit : '  -  '}          ${r.trackH}px`);
  }
  console.log('');
}
fs.writeFileSync(`${OUT}/edgesweep.json`, JSON.stringify({ night: NIGHT, edges: EDGES, caps: CAPS, rows, errs }, null, 1));
if (errs.length) console.log('errors:\n  ' + errs.join('\n  '));
await browser.close();
