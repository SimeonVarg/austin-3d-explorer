/**
 * phonecard.mjs — the lighting block at the width it will actually be judged at.
 *
 * Round 4 rebuilt this block around a picture and measured the result at
 * 1280 x 900 (`cardshot.mjs`, docs/walk-lit.md §25-§26). Nobody has ever looked
 * at it on a phone. That is the wrong way round: this app gets watched as a
 * screen recording off a handset, and "visible in the DOM" has been mistaken
 * for "visible on camera" in this repo before.
 *
 * A strip is exactly the kind of element that survives a measurement and fails a
 * phone. It is a schematic whose smallest run is floored at `litStripMinFrac`
 * of the WIDTH — so the floor is a fraction, the width is not, and a run that is
 * 4 px on a laptop is 1 px on a handset. The reported-dark ticks are worse:
 * `litStripTickW` is an absolute 2 px, so as the strip narrows the ticks stay
 * the same size and eat a growing share of the picture until a route with a
 * dozen pins is a bar of ticks.
 *
 * So this measures, at three widths, on routes chosen for the three shapes the
 * block can take (lamps / none / none-but-reported):
 *   - the strip's own width and height as laid out
 *   - the narrowest rendered run, in px
 *   - the share of the strip covered by ticks
 *   - whether any line in the block wraps to more rows than at desktop width
 *   - the block's height as a share of the card
 * and saves a photograph of the block at each width, because the number is not
 * the deliverable — the picture is.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/phonecard.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92;
// 390 is an iPhone 14 in CSS px, 360 an average Android, 1280 the width round 4
// measured at and the only one anybody has looked at.
const WIDTHS = [[360, 780, 'android'], [390, 844, 'iphone'], [1280, 900, 'desktop']];
const ROUTES = [['ANB', 'ETC', 'lamps'], ['GDC', 'The Castilian', 'none-reported'], ['CMB', 'TMM', 'nearmiss']];

const browser = await launch(chromium, { gl: 'hardware', maxMs: 900000 });
const out = [];
const errs = [];

for (const [w, h, wname] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errs.push(wname + ': ' + e.message));
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

  for (const [a, b, kind] of ROUTES) {
    const ok = await page.evaluate(async ([f, t]) => {
      const r = await window.wayfindRoute(f, t, { expand: true });
      return !!(r && r.ok);
    }, [a, b]);
    if (!ok) { console.log(`  ${wname}: ${a}->${b} did not route`); continue; }
    // The lamp index is fetched lazily and the block is not in the card until it
    // lands, so the FIRST route measured after a page load can legitimately show
    // no lighting block. Wait for the heading rather than for a guess at how
    // long that takes — the first cut used a flat 700 ms and silently dropped
    // one row of the table.
    await page.waitForFunction(() => {
      const c = document.getElementById('wf-card');
      return !!c && Array.from(c.children).some(k => /^Street lighting/.test((k.textContent || '').trim()));
    }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const card = document.getElementById('wf-card');
      if (!card) return null;
      const kids = Array.from(card.children);
      const i0 = kids.findIndex(k => /^Street lighting/.test((k.textContent || '').trim()));
      if (i0 < 0) return null;
      // the block runs from the heading to the next heading or the chip row
      let i1 = kids.length;
      for (let i = i0 + 1; i < kids.length; i++) {
        if (kids[i].classList.contains('wf-chips') && /Coffee|Food|Store/.test(kids[i].textContent || '')) { i1 = i; break; }
      }
      const block = kids.slice(i0, i1);
      const rects = block.map(k => k.getBoundingClientRect());
      const top = Math.min(...rects.map(r => r.top)), bot = Math.max(...rects.map(r => r.bottom));
      // ROWS, not boxes. A line is a distinct rect TOP — §27.2: counting
      // getClientRects() directly made the strip's flex segments register as
      // fifteen lines of text and a picture look like more reading.
      const tops = new Set();
      let words = 0;
      for (const k of block) {
        for (const r of k.getClientRects()) if (r.height > 0) tops.add(Math.round(r.top));
        words += ((k.innerText || '').trim().match(/\S+/g) || []).length;
      }
      // the strip itself
      const track = block.map(k => k.querySelector('[role="img"]')).find(Boolean);
      let strip = null;
      if (track) {
        const tr = track.getBoundingClientRect();
        const segs = Array.from(track.children).filter(c => c.style.position !== 'absolute');
        const ticks = Array.from(track.children).filter(c => c.style.position === 'absolute');
        const ws = segs.map(s => s.getBoundingClientRect().width);
        strip = {
          w: +tr.width.toFixed(1), h: +tr.height.toFixed(1),
          segs: segs.length, ticks: ticks.length,
          minSegPx: ws.length ? +Math.min(...ws).toFixed(2) : 0,
          tickCoverPct: tr.width > 0 ? +(100 * ticks.length * (ticks[0] ? ticks[0].getBoundingClientRect().width : 0) / tr.width).toFixed(1) : 0,
          aria: track.getAttribute('aria-label'),
        };
      }
      const cardR = card.getBoundingClientRect();
      // THE ELEMENT'S BOX IS NOT WHERE THE TEXT IS. The first cut of this
      // clipped its screenshot to `card.getBoundingClientRect()` and got a
      // 153 px column with every sentence sliced off down the right-hand edge —
      // which reads as a catastrophic layout bug and is not one: the card's own
      // box is narrow and its children overflow it. Measuring the widest CHILD
      // rect is what "how wide is this block on a phone" actually means.
      let cw = cardR.width, cl = cardR.left;
      for (const k of block) for (const r of k.getClientRects()) {
        if (r.width <= 0) continue;
        cl = Math.min(cl, r.left);
        cw = Math.max(cw, r.right - cl);
      }
      const scroller = (() => {
        let e = card;
        while (e && e !== document.body) {
          const s = getComputedStyle(e);
          if (/auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2) {
            return { id: e.id || e.className, scrollH: e.scrollHeight, clientH: e.clientHeight };
          }
          e = e.parentElement;
        }
        return null;
      })();
      return {
        blockH: Math.round(bot - top), cardH: Math.round(cardR.height),
        contentW: Math.round(cw), overflowsBox: cw > cardR.width + 1, scroller,
        share: +(100 * (bot - top) / Math.max(1, cardR.height)).toFixed(0),
        lines: tops.size, words, strip,
        clipped: cardR.bottom > window.innerHeight || bot > window.innerHeight,
        headline: (block[2] ? block[2].innerText : '').trim(),
        cardW: Math.round(cardR.width),
        box: { x: Math.round(cl) - 2, y: Math.round(top) - 4, w: Math.round(cw) + 4, h: Math.round(bot - top) + 8 },
      };
    });
    if (!m) { console.log(`  ${wname}: no lighting block on ${a}->${b}`); continue; }

    const tag = `${OUT}/r5-phone-${wname}-${kind}.png`;
    const clip = {
      x: Math.max(0, m.box.x), y: Math.max(0, m.box.y),
      width: Math.min(m.box.w, w - Math.max(0, m.box.x)),
      height: Math.min(m.box.h, h - Math.max(0, m.box.y)),
    };
    if (clip.width > 4 && clip.height > 4) await page.screenshot({ path: tag, clip });

    // ── AND THE ONE ASSERTION THAT IS ABOUT THE CAMERA, NOT THE DOM ────────
    // `getBoundingClientRect().width = 1.22` is a layout fact. Whether that run
    // is a mark a person can see in a screen recording is a pixel fact, and in
    // this repo the two have been confused before. So: photograph the track
    // itself, read its middle row back, and count how many distinct amber runs
    // actually survive rasterisation at this width. A schematic that draws 15
    // runs and photographs as 9 is overstating nothing and understating where.
    let px = null;
    const track = await page.$('#wf-card [role="img"]');
    if (track) {
      const shot = await track.screenshot();
      px = await page.evaluate(async ([b64, amber]) => {
        const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const row = g.getImageData(0, Math.floor(im.height / 2), im.width, 1).data;
        const hex = amber.replace('#', '');
        const AR = parseInt(hex.slice(0, 2), 16), AG = parseInt(hex.slice(2, 4), 16), AB = parseInt(hex.slice(4, 6), 16);
        // "amber" is a direction in colour space, not an exact value: the strip
        // sits on dark glass and a 1 px column is antialiased against its cool
        // neighbours, so an exact-hex test would count zero at exactly the runs
        // this is trying to see. Halfway between the two constants, by red-blue
        // difference, is the boundary that means what the eye means.
        const isAmber = (i) => (row[i] - row[i + 2]) > (AR - AB) / 2;
        let runs = 0, on = false, widest = 0, cur = 0, amberPx = 0;
        for (let x = 0; x < im.width; x++) {
          const a = isAmber(x * 4);
          if (a) { amberPx++; cur++; if (!on) { runs++; on = true; } }
          else { widest = Math.max(widest, cur); cur = 0; on = false; }
        }
        widest = Math.max(widest, cur);
        return { devW: im.width, devH: im.height, amberRuns: runs, amberPx, widestAmberPx: widest,
          amberSharePct: +(100 * amberPx / im.width).toFixed(2) };
      }, [shot.toString('base64'), '#ffc27a']);
      fs.writeFileSync(`${OUT}/r5-phone-${wname}-${kind}-strip.png`, shot);
    }
    m.px = px;
    // ...and the whole screen, because a block that is fine in isolation and
    // pushed off the bottom of a handset is not fine, and only the frame shows
    // that. Kept for the phone widths only; desktop already has round 4's.
    if (w < 768) await page.screenshot({ path: `${OUT}/r5-phone-${wname}-${kind}-full.png` });
    out.push({ width: w, wname, route: `${a}->${b}`, kind, ...m });
    console.log(`  ${wname.padEnd(8)} ${kind.padEnd(14)} card ${String(m.cardW).padStart(4)}/${String(m.contentW).padStart(4)} px · block ${String(m.blockH).padStart(3)} px (${String(m.share).padStart(2)}% of card) · ` +
      `${String(m.lines).padStart(2)} lines · ${String(m.words).padStart(3)} words · strip ${m.strip ? m.strip.w + 'x' + m.strip.h : '-'} px, ` +
      `${m.strip ? m.strip.segs : '-'} runs, narrowest ${m.strip ? m.strip.minSegPx : '-'} px, ` +
      `${m.strip ? m.strip.ticks : 0} ticks covering ${m.strip ? m.strip.tickCoverPct : 0}%`);
    if (m.px) {
      const litRuns = m.strip ? Math.ceil(m.strip.segs / 2) : 0;   // runs alternate lit/unlit
      console.log(`           ${' '.repeat(14)}PHOTOGRAPHED: ${m.px.devW} device px wide · amber survives as ` +
        `${m.px.amberRuns} separate marks (DOM has up to ${litRuns} amber runs) · ` +
        `thinnest visible amber ${m.px.widestAmberPx ? '' : 'NONE'} · amber covers ${m.px.amberSharePct}% of the bar`);
    }
  }
  await page.close();
}

console.log('\n# what a narrower screen does to the picture');
for (const kind of ['lamps', 'none-reported', 'nearmiss']) {
  const g = out.filter(r => r.kind === kind);
  const d = g.find(r => r.wname === 'desktop'), p = g.find(r => r.wname === 'iphone');
  if (!d || !p) continue;
  console.log(`  ${kind}: lines ${d.lines} -> ${p.lines}, narrowest run ${d.strip ? d.strip.minSegPx : '-'} -> ${p.strip ? p.strip.minSegPx : '-'} px, ` +
    `ticks cover ${d.strip ? d.strip.tickCoverPct : 0}% -> ${p.strip ? p.strip.tickCoverPct : 0}%`);
}
fs.writeFileSync(`${OUT}/phonecard.json`, JSON.stringify({ widths: WIDTHS, rows: out, errs }, null, 1));
console.log(`\nwrote ${OUT}/phonecard.json`);
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
