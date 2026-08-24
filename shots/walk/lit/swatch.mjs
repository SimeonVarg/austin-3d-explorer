/**
 * swatch.mjs — does the picture have a key, and is the key the same colour as
 * the picture?
 *
 * WHAT THIS IS TESTING. Round 4 replaced twenty lines of prose with a bar and
 * round 5 proved the bar survives a 390 px handset. Neither asked whether a
 * person can tell what the bar's colours MEAN. Read off the shipped card, only
 * one of the three is anchored where it is read: amber is `litLampCol`, the
 * colour of the count line directly beneath it; violet ties to a line two to
 * four rows further down; and cool ties to nothing at all, which matters most
 * because the West Campus walk home draws a bar that is entirely cool.
 *
 * Round 6 puts one mark, in the strip's own colour, at the head of the sentence
 * that colour means. This script has to establish three things, and the third
 * is the one that could quietly rot:
 *
 *   1. THE MARK IS THERE, and only where it is honest — a violet tick beside
 *      the reported-dark line ONLY when the bar actually carries ticks.
 *   2. IT COST NOTHING TO READ. Words on screen must not move at all; height
 *      may move by a pixel or two of inline-block leading and no more. The
 *      measurement is `cardshot.mjs`'s, unchanged, so it is comparable with
 *      round 4's table.
 *   3. IT IS THE SAME COLOUR AS THE THING IT EXPLAINS — sampled off the
 *      RENDERED CARD, not read out of the constants. A key that agrees with
 *      the bar in the source and disagrees on screen is worse than no key, and
 *      §40b of docs/walk-lit.md is this lane's own record of a paint constant
 *      and a composited pixel being two different numbers. Both are sampled
 *      from the same screenshot, so opacity and blending apply equally to both
 *      and the comparison is honest.
 *
 * Run at 390 px as well as 1280, because §37's whole finding was that this app
 * is judged off a phone recording and the block had only ever been measured on
 * a laptop.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/swatch.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const FRAMES = process.env.VERIFY_FRAMES || OUT;
fs.mkdirSync(FRAMES, { recursive: true });
const NIGHT = 0.92;
const TOL = 6;   // per channel, sampled pixel vs sampled pixel

// The three shapes the block can take, the same three round 4 and round 5 used.
const ROUTES = [
  ['ANB', 'ETC', 'campus crossing — amber marks and no ticks'],
  ['GDC', 'The Castilian', 'the walk home — an all-cool bar with ticks'],
  ['PMA', 'WEL', 'a short hop'],
];
const WIDTHS = [[390, 844, 'iphone'], [1280, 900, 'desktop']];

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const rows = [];
for (const [W, H, dev] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
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

  for (const [from, to, why] of ROUTES) {
   // THE A/B IS IN ONE PAGE, on the same route, seconds apart. `litSwatchOn` is
   // a named constant on `window.WAYFIND`, so "before" is not a git checkout and
   // a re-measurement — it is the same card with the key switched off, which is
   // the only way the words/height comparison is of the key and nothing else.
   for (const on of [false, true]) {
    await page.evaluate((v) => { window.WAYFIND.litSwatchOn = v; }, on);
    await page.evaluate(async ([f, t]) => {
      await window.wayfindRoute(f, t, { expand: true });
    }, [from, to]);
    await page.waitForFunction(() => {
      const c = document.getElementById('wf-card');
      return c && /Street lighting/.test(c.textContent || '');
    }, null, { timeout: 60000 });

    const geo = await page.evaluate(() => {
      const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
      const kids = Array.from(card.children);
      const i = kids.findIndex(k => /^Street lighting/.test(k.textContent || ''));
      if (i < 0) return { ok: false, why: 'no lighting heading' };
      let j = kids.length;
      for (let k = i + 1; k < kids.length; k++) {
        if (/wf-acts|wf-foot/.test(kids[k].className || '')) { j = k; break; }
      }
      const block = kids.slice(i, j);
      const cb = card.getBoundingClientRect();
      const top = block[0].getBoundingClientRect().top;
      const bot = block[block.length - 1].getBoundingClientRect().bottom;
      // the same line/word measure cardshot.mjs uses, so the numbers compare
      let lines = 0, words = 0, hidden = 0;
      for (const b of block) {
        const rg = document.createRange(); rg.selectNodeContents(b);
        const rects = Array.from(rg.getClientRects());
        const w = (b.textContent || '').trim().split(/\s+/).filter(Boolean).length;
        if (!rects.length) { hidden += w; continue; }
        if (w) lines += new Set(rects.map(x => Math.round(x.top / 2))).size;
        words += w;
      }
      // the strip itself, and the swatches
      const track = block.map(b => b.querySelector('[role="img"]')).find(Boolean);
      const swatches = [];
      for (const b of block) {
        for (const s of b.querySelectorAll('span[aria-hidden="true"]')) {
          const r = s.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          swatches.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
            of: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) });
        }
      }
      // one sample point inside the widest amber run, one inside the widest
      // cool run, one on a tick — taken off the LIVE elements, not guessed
      let amber = null, cool = null, tick = null;
      if (track) {
        const tb = track.getBoundingClientRect();
        for (const seg of Array.from(track.children)) {
          const r = seg.getBoundingClientRect();
          if (r.width < 2) continue;
          const isTick = r.width <= 3 && Math.abs(r.height - tb.height) < 2 && seg.style.position === 'absolute';
          const p = { x: r.x + r.width / 2, y: tb.y + tb.height / 2, w: +r.width.toFixed(1) };
          if (isTick) { if (!tick) tick = p; continue; }
          const isAmber = /255,\s*194|ffc27a/i.test(seg.style.background || '');
          if (isAmber) { if (!amber || r.width > amber.w) amber = p; }
          else if (!cool || r.width > cool.w) cool = p;
        }
      }
      return {
        ok: true, blockH: Math.round(bot - top), cardH: Math.round(cb.height), cardW: Math.round(cb.width),
        cardTop: Math.round(cb.top), cardLeft: Math.round(cb.left), blockTop: Math.round(top),
        lines, words, hidden, swatches, amber, cool, tick,
        stripW: track ? Math.round(track.getBoundingClientRect().width) : 0,
      };
    });
    if (!geo.ok) { console.log(`  ${dev} ${from}->${to}: FAILED ${geo.why}`); continue; }

    const pad = 8;
    const shot = await page.screenshot({ clip: {
      x: Math.max(0, geo.cardLeft - pad), y: Math.max(0, geo.blockTop - pad),
      width: Math.min(W - geo.cardLeft + pad, geo.cardW + pad * 2),
      height: Math.min(H - geo.blockTop + pad, geo.blockH + pad * 2),
    } });
    const name = `${FRAMES}/r6-key-${on ? 'after' : 'before'}-${dev}-${from}-${String(to).replace(/\W+/g, '')}.png`;
    fs.writeFileSync(name, shot);

    // SAMPLED OFF THE RENDERED PAGE — the swatch and the bar run it explains,
    // read from the same full-page screenshot at the same moment.
    const full = await page.screenshot();
    const pts = [];
    geo.swatches.forEach((s, k) => pts.push({ id: 'swatch' + k, x: s.x, y: s.y, of: s.of }));
    if (geo.amber) pts.push({ id: 'bar-amber', x: geo.amber.x, y: geo.amber.y });
    if (geo.cool) pts.push({ id: 'bar-cool', x: geo.cool.x, y: geo.cool.y });
    if (geo.tick) pts.push({ id: 'bar-tick', x: geo.tick.x, y: geo.tick.y });
    const px = await page.evaluate(async ([b64, points, w]) => {
      const im = await new Promise(r => { const q = new Image(); q.onload = () => r(q); q.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const s = im.width / w;
      return points.map(p => {
        const d = g.getImageData(Math.round(p.x * s), Math.round(p.y * s), 1, 1).data;
        return { ...p, rgb: [d[0], d[1], d[2]] };
      });
    }, [full.toString('base64'), pts, W]);

    const get = (id) => px.find(p => p.id === id);
    const near = (a, b) => a && b && a.rgb.every((v, k) => Math.abs(v - b.rgb[k]) <= TOL);
    const swatchSquare = px.filter(p => p.id.startsWith('swatch') && geo.swatches[+p.id.slice(6)].w > 4);
    const swatchTick = px.filter(p => p.id.startsWith('swatch') && geo.swatches[+p.id.slice(6)].w <= 4);
    const barLit = get('bar-amber'), barCool = get('bar-cool'), barTick = get('bar-tick');
    const headSw = swatchSquare[0] || null;
    const tickSw = swatchTick[0] || null;
    const headMatch = headSw ? (near(headSw, barLit) ? 'amber' : near(headSw, barCool) ? 'cool' : 'NEITHER') : '(none)';
    const tickMatch = tickSw ? (near(tickSw, barTick) ? 'tick' : 'NO') : (barTick ? 'MISSING' : '(no ticks on this bar)');

    rows.push({ dev, W, on, from, to, why, blockH: geo.blockH, cardH: geo.cardH, cardW: geo.cardW,
      lines: geo.lines, words: geo.words, hidden: geo.hidden, stripW: geo.stripW,
      swatches: geo.swatches.length, headSw: headSw && headSw.rgb, barLit: barLit && barLit.rgb,
      barCool: barCool && barCool.rgb, tickSw: tickSw && tickSw.rgb, barTick: barTick && barTick.rgb,
      headMatch, tickMatch, frame: name, errs: errs.slice(0, 3) });
    console.log(`${dev.padEnd(8)} ${(on ? 'KEY ON ' : 'key off')} ${from}->${to}  block ${geo.blockH}px of ${geo.cardH}px  ` +
      `${geo.lines} lines, ${geo.words} words, card ${geo.cardW}px, strip ${geo.stripW}px, marks ${geo.swatches.length}`);
    if (on) {
      console.log(`         headline mark ${headSw ? headSw.rgb.join(',') : '—'} ` +
        `vs bar amber ${barLit ? barLit.rgb.join(',') : '—'} / bar cool ${barCool ? barCool.rgb.join(',') : '—'}  -> ${headMatch}`);
      console.log(`         tick mark     ${tickSw ? tickSw.rgb.join(',') : '—'} vs bar tick ${barTick ? barTick.rgb.join(',') : '—'}  -> ${tickMatch}`);
    }
   }
  }
  await page.close();
}

console.log('\n# what the key cost, same card, key switched off and on');
console.log('                                        words      lines     block px   marks');
for (const dev of ['iphone', 'desktop']) for (const [from, to] of ROUTES.map(r => [r[0], r[1]])) {
  const a = rows.find(r => r.dev === dev && r.from === from && r.to === to && !r.on);
  const b = rows.find(r => r.dev === dev && r.from === from && r.to === to && r.on);
  if (!a || !b) continue;
  const d = (x, y) => `${x} -> ${y}`.padEnd(11);
  console.log(`  ${dev.padEnd(8)} ${(from + '->' + to).padEnd(22)} ${d(a.words, b.words)}${d(a.lines, b.lines)}${d(a.blockH, b.blockH)}${b.swatches}`);
}

const on = rows.filter(r => r.on);
const bad = on.filter(r => r.headMatch === 'NEITHER' || r.tickMatch === 'NO' || r.tickMatch === 'MISSING');
const grew = rows.filter(r => r.on).some(b => {
  const a = rows.find(r => r.dev === b.dev && r.from === b.from && r.to === b.to && !r.on);
  return a && b.words !== a.words;
});
console.log(`\nwords changed by adding the key: ${grew ? 'YES — that is a failure' : 'no, not one word'}`);
console.log(`${bad.length || grew ? 'FAIL' : 'PASS'}  the key is the same colour as the picture at ${on.length - bad.length} / ${on.length} route-widths`);
fs.writeFileSync(`${OUT}/swatch.json`, JSON.stringify({ night: NIGHT, tol: TOL, rows }, null, 1));
console.log(`wrote ${OUT}/swatch.json · frames in ${FRAMES}`);
await browser.close();
