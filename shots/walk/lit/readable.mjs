/**
 * readable.mjs — can a person physically resolve the words in this block?
 *
 * WHAT THIS IS TESTING, AND WHY IT IS THE GAP THIS DOCUMENT NAMED ITSELF.
 * §51's first bullet: *"whether that is enough for somebody seeing the card for
 * the first time is a question about a person, and in six rounds nobody has
 * watched one use this. Still the largest untested claim in the block."* Six
 * rounds have measured the block's HEIGHT (§26), its WORD COUNT (§27), its
 * survival on a 390 px handset (§37) and whether its key matches the bar's
 * colour (§47). Not one of them measured the one property that decides whether
 * a sentence gets read at all before any of that matters: **is there enough
 * contrast between the ink and the glass to see it.**
 *
 * That question has an objective floor. WCAG 2.1 AA: 4.5:1 for body text,
 * 3:1 for large text (>= 24 px, or >= 18.66 px bold), 3:1 for a non-text mark
 * that carries meaning (1.4.11 — which is exactly what round 6's key swatch
 * is). It is not a matter of taste and it does not need a person in the room.
 *
 * MEASURED OFF THE RENDERED PIXELS, NOT THE CONSTANTS — for the reason §40b
 * is in this document. Every line in this block is a stack of multiplied
 * opacities over a blurred backdrop-filter over whatever the city happens to
 * be painting behind the card at that moment; `getComputedStyle().color` knows
 * none of that. So: screenshot, decode, and inside each element's own rect take
 *
 *   INK  — the pixel furthest in luminance from the local background, which is
 *          a fully-covered glyph stem and therefore the composited text colour;
 *   GLASS— the modal pixel of the rect, which is the card behind those glyphs.
 *
 * Both come off the same frame at the same moment, so blending applies equally.
 * `getComputedStyle` is recorded beside each number, not used for any of them:
 * where the two disagree the pixel wins, and the disagreement is the finding.
 *
 * THE ONE THING THIS CANNOT SAY. Contrast is the floor, not the ceiling. A
 * sentence can clear 7:1 and still go unread because it is the fifth grey line
 * in a row. This measures whether reading is POSSIBLE, and §51's bullet stays
 * open for whether it happens.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8814 node shots/walk/lit/readable.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const FRAMES = process.env.VERIFY_FRAMES || OUT;
fs.mkdirSync(FRAMES, { recursive: true });
const TAG = process.env.READABLE_TAG || 'before';
const NIGHT = 0.92;
const AA_BODY = 4.5;      // WCAG 2.1 AA, text under the large-text threshold
const AA_LARGE = 3.0;     // >= 24 px, or >= 18.66 px bold
const AA_MARK = 3.0;      // 1.4.11 non-text contrast — the key swatch is one

// The same three route shapes rounds 4, 5 and 6 used, so the tables compare.
const ROUTES = [
  ['ANB', 'ETC', 'campus crossing — amber marks and no ticks'],
  ['GDC', 'The Castilian', 'the walk home — an all-cool bar with ticks'],
  ['PMA', 'WEL', 'a short hop'],
];
const WIDTHS = [[390, 844, 'iphone'], [1280, 900, 'desktop']];

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

  // READABLE_TAG=before re-renders the pre-round-7 card ON THIS BUILD by
  // flipping the two constants back, rather than by checking out the old file.
  // Same discipline as swatch.mjs's A/B (§47): one build, one session, one
  // sampler, so the two tables differ by the change and by nothing else.
  if (TAG === 'before') {
    await page.evaluate(() => { window.WAYFIND.litStripEdgeOn = false; window.WAYFIND.litStripCapsOpacity = 0.45; });
  }

  for (const [from, to, shape] of ROUTES) {
    // Twice: the lamp index is fetched on the first route of a session, so the
    // first card of a run is drawn with no strip in it at all.
    // ...and then WAIT FOR THE STRIP rather than sleeping a guessed number of
    // milliseconds. A fixed 900 ms lost one of the six route/width cells on the
    // first complete run — the phone's mixed-bar route, which is the only cell
    // carrying the amber-vs-cool comparison, so the table came back short of
    // exactly the row it most needed and said "0 below AA" anyway.
    let ok = false;
    for (let tryN = 0; tryN < 4 && !ok; tryN++) {
      await page.evaluate(async ([f, t]) => { await window.wayfindRoute(f, t, { expand: true }); }, [from, to]);
      ok = await page.waitForFunction(() => {
        const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
        if (!card) return false;
        const kids = Array.from(card.children);
        const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
        return hi >= 0 && kids.slice(hi).some(k => k.querySelector && k.querySelector('[role="img"]'));
      }, null, { timeout: 8000 }).then(() => true).catch(() => false);
    }
    if (!ok) { errs.push(`${dev} ${from}->${to}: no strip after 4 tries`); continue; }
    await page.waitForTimeout(400);

    // The lighting block's own elements, in reading order, with the geometry
    // and the computed style beside each — the style is the cross-check, never
    // the answer.
    const items = await page.evaluate(() => {
      const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
      if (!card) return null;
      const kids = Array.from(card.children);
      const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
      if (hi < 0) return null;
      // ...to the end of the block: the sourcing fold is the last thing litCard
      // appends, and the card's own action chips come after it.
      let end = kids.length;
      for (let i = hi + 1; i < kids.length; i++) {
        if (kids[i].classList.contains('wf-chips') && i > hi + 2) { end = i; break; }
        if (kids[i].classList.contains('wf-acts')) { end = i; break; }
      }
      const out = [];
      const push = (el, kind, label) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const cs = getComputedStyle(el);
        // The stack of opacities between this element and the card.
        let op = 1, p = el;
        while (p && p !== document.body) { op *= parseFloat(getComputedStyle(p).opacity || '1'); p = p.parentElement; }
        out.push({
          kind, label: label || (el.textContent || '').trim().slice(0, 58),
          x: r.left, y: r.top, w: r.width, h: r.height,
          css: cs.color, fontPx: parseFloat(cs.fontSize), weight: cs.fontWeight, opacity: +op.toFixed(3),
        });
      };
      for (let i = hi; i < end; i++) {
        const k = kids[i];
        const track = k.querySelector && k.querySelector('[role="img"]');
        if (track) {
          // The bar is not text. Its two run colours and its ticks are marks,
          // measured against the card, not against each other.
          // Name the runs by WHICH constant they carry rather than by their
          // order, so the table reads the same on a route whose first run
          // happens to be a lit one.
          const W = window.WAYFIND;
          const norm = (c) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? [+m[1], +m[2], +m[3]] : null; };
          const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
          const near = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 9;
          const segs = Array.from(track.children).filter(c => getComputedStyle(c).position !== 'absolute');
          const ticks = Array.from(track.children).filter(c => getComputedStyle(c).position === 'absolute');
          const darkSeg = segs.find(s => near(norm(getComputedStyle(s).backgroundColor), hex(W.litStripDarkCol)));
          const litSeg = segs.find(s => near(norm(getComputedStyle(s).backgroundColor), hex(W.litStripLitCol)));
          // THE BAR AS AN OBJECT — "can you see it on the card at all". This is
          // the comparison WCAG 1.4.11 is asking for, and the one the run-
          // against-card figure below is NOT: a run is not adjacent to the
          // card, the bar's own boundary is between them. Scoring a run
          // against the card was this instrument's second wrong question, and
          // it kept reporting FAIL after the object it was really about had
          // been fixed.
          push(track, 'mark', 'THE BAR against the card');
          if (darkSeg) push(darkSeg, 'note', 'bar: unmapped run vs the card (context, not a 1.4.11 test)');
          if (litSeg) push(litSeg, 'mark', 'bar: mapped run (litStripLitCol)');
          if (ticks.length) push(ticks[0], 'mark', 'bar: reported tick (litStripTickCol)');
          // THE CAPS ROW, WHICH THIS INSTRUMENT'S FIRST CUT SILENTLY SKIPPED.
          // `k.querySelector('div:not([role])')` finds a RUN — the runs are
          // divs inside the track and querySelector is depth-first — so the
          // bar's own label was never measured and its absence looked like a
          // clean table. Walk the wrapper's own children instead.
          const caps = Array.from(k.children).find(c => c !== track);
          if (caps) for (const s of Array.from(caps.children)) push(s, 'text', 'cap: ' + (s.textContent || '').trim());
          continue;
        }
        // A line with an inline key swatch: measure the swatch as a mark and
        // the words beside it as text, separately.
        const sw = k.querySelector && k.querySelector('span[aria-hidden="true"]');
        if (sw) push(sw, 'mark', 'key swatch: ' + (k.textContent || '').trim().slice(0, 34));
        push(k, 'text');
      }
      return out;
    });
    if (!items) { errs.push(`${dev} ${from}->${to}: no lighting block`); continue; }

    const shot = await page.screenshot();
    const b64 = shot.toString('base64');
    // Decode in the page and sample each rect: ink = the pixel furthest in
    // luminance from the modal pixel; glass = the modal pixel.
    const sampled = await page.evaluate(async ([b64, items, dpr]) => {
      const im = await new Promise(r => { const q = new Image(); q.onload = () => r(q); q.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const lum = (r, gg, b) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
      };
      return items.map(it => {
        const x0 = Math.max(0, Math.round(it.x * dpr)), y0 = Math.max(0, Math.round(it.y * dpr));
        const w = Math.max(1, Math.round(it.w * dpr)), h = Math.max(1, Math.round(it.h * dpr));
        const d = g.getImageData(x0, y0, Math.min(w, c.width - x0), Math.min(h, c.height - y0)).data;
        const hist = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
          hist.set(k, (hist.get(k) || 0) + 1);
        }
        let modeK = 0, modeN = -1;
        for (const [k, n] of hist) if (n > modeN) { modeN = n; modeK = k; }
        const bg = [(modeK >> 16) & 255, (modeK >> 8) & 255, modeK & 255];
        const bgL = lum(bg[0], bg[1], bg[2]);
        // A solid mark has ONE colour: its mode IS the mark, and the thing to
        // measure it against is the card just outside it. A text line's mode is
        // the glass and the thing to measure is the furthest glyph pixel.
        let ink = bg, best = -1;
        for (const [k, n] of hist) {
          if (n < 2) continue;                       // a lone antialiased pixel is not ink
          const r = (k >> 16) & 255, gg = (k >> 8) & 255, b = k & 255;
          const dl = Math.abs(lum(r, gg, b) - bgL);
          if (dl > best) { best = dl; ink = [r, gg, b]; }
        }
        let mark = null;
        if (it.kind === 'mark' || it.kind === 'note') {
          // A solid mark's own mode IS the mark. What it has to be visible
          // AGAINST is the card immediately above and below it — not to its
          // left, which for a bar spanning the full card width is the sheet's
          // edge or the map beyond it. Above/below is card glass for the bar
          // (its 7 px / 4 px margins) and the line's own background for an
          // inline swatch, which is the right reference for both.
          const band = Math.max(2, Math.round(3 * dpr));
          const hist2 = new Map();
          for (const yy of [y0 - band - 1, y0 - band, y0 + h + band, y0 + h + band + 1]) {
            if (yy < 0 || yy >= c.height) continue;
            const row = g.getImageData(x0, yy, Math.min(w, c.width - x0), 1).data;
            for (let i = 0; i < row.length; i += 4) {
              const k = (row[i] << 16) | (row[i + 1] << 8) | row[i + 2];
              hist2.set(k, (hist2.get(k) || 0) + 1);
            }
          }
          let aK = 0, aN = -1;
          for (const [k, n] of hist2) if (n > aN) { aN = n; aK = k; }
          // ...and the mark's own OUTER RING, because WCAG 1.4.11 asks whether
          // the object is identifiable, not whether its fill is. A mark with a
          // frame is carried by the frame. Both numbers are kept and the table
          // prints which one carries it: scoring only the better of the two
          // would let an instrument agree with a fix by construction, and the
          // fill's number is the honest record that the fill still does not
          // carry it and was never asked to.
          const ringT = Math.max(1, Math.round(1 * dpr));
          const hist3 = new Map();
          const rw = Math.min(w, c.width - x0), rh = Math.min(h, c.height - y0);
          for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
            if (xx >= ringT && xx < rw - ringT && yy >= ringT && yy < rh - ringT) continue;
            const i = (yy * rw + xx) * 4;
            const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
            hist3.set(k, (hist3.get(k) || 0) + 1);
          }
          let eK = 0, eN = -1;
          for (const [k, n] of hist3) if (n > eN) { eN = n; eK = k; }
          mark = {
            fill: bg, around: [(aK >> 16) & 255, (aK >> 8) & 255, aK & 255], aroundN: aN,
            ring: [(eK >> 16) & 255, (eK >> 8) & 255, eK & 255],
          };
        }
        return { ink, bg, mark };
      });
    }, [b64, items, 2]);

    for (let i = 0; i < items.length; i++) {
      const it = items[i], s = sampled[i];
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const isMark = it.kind === 'mark' || it.kind === 'note';
      const bg = isMark ? s.mark.around : s.bg;
      const rFill = isMark ? ratio(s.mark.fill, bg) : ratio(s.ink, bg);
      const rRing = isMark && s.mark.ring ? ratio(s.mark.ring, bg) : null;
      const r = isMark ? Math.max(rFill, rRing == null ? 0 : rRing) : rFill;
      const bold = parseInt(it.weight, 10) >= 600;
      const need = isMark ? AA_MARK : (it.fontPx >= 24 || (bold && it.fontPx >= 18.66) ? AA_LARGE : AA_BODY);
      rows.push({
        dev, W, from, to, shape, kind: it.kind, label: it.label,
        fontPx: it.fontPx, weight: it.weight, opacity: it.opacity, css: it.css,
        fg: isMark ? s.mark.fill : s.ink, bg,
        ratioFill: +rFill.toFixed(2), ratioRing: rRing == null ? null : +rRing.toFixed(2),
        carriedBy: !isMark ? 'ink' : (rRing != null && rRing > rFill + 0.05 ? 'edge' : 'fill'),
        ratio: +r.toFixed(2), need, pass: it.kind === 'note' ? null : r >= need,
      });
    }

    // ...and the OTHER well-posed question: can you tell the two run kinds
    // apart. That is a fill-against-fill comparison and it is the one the fill
    // colours exist to win — which is the whole argument for fixing the bar
    // with an edge rather than by lightening `litStripDarkCol`. If this number
    // ever drops under 3:1 the edge was the wrong fix.
    {
      const mineHere = rows.filter(r => r.dev === dev && r.from === from && r.to === to);
      const d = mineHere.find(r => /unmapped run vs the card/.test(r.label));
      const l = mineHere.find(r => /mapped run \(litStripLitCol\)/.test(r.label));
      if (d && l) {
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const l1 = lum(d.fg), l2 = lum(l.fg);
        const rr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        rows.push({
          dev, W, from, to, shape, kind: 'mark', label: 'THE INFORMATION: unmapped run vs mapped run',
          fontPx: 0, weight: '400', opacity: 1, css: '', fg: d.fg, bg: l.fg,
          ratioFill: +rr.toFixed(2), ratioRing: null, carriedBy: 'fill',
          ratio: +rr.toFixed(2), need: AA_MARK, pass: rr >= AA_MARK,
        });
      }
    }

    // The block, photographed, so the numbers have a picture beside them.
    const box = await page.evaluate(() => {
      const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
      const kids = Array.from(card.children);
      const hi = kids.findIndex(k => /street lighting/i.test(k.textContent || ''));
      if (hi < 0) return null;
      let end = kids.length;
      for (let i = hi + 1; i < kids.length; i++) if (kids[i].classList.contains('wf-acts')) { end = i; break; }
      const a = kids[hi].getBoundingClientRect(), b = kids[Math.max(hi, end - 1)].getBoundingClientRect();
      return { x: Math.max(0, a.left - 8), y: Math.max(0, a.top - 6), width: Math.min(a.width + 16, 1400), height: Math.max(20, b.bottom - a.top + 12) };
    });
    if (box) {
      await page.screenshot({ clip: box, path: `${FRAMES}/r7-read-${TAG}-${dev}-${from}-${String(to).replace(/\W+/g, '')}.png` });
    }
  }
  await page.close();
}

// ── the report ────────────────────────────────────────────────────────────
console.log(`\nREADABILITY — ${TAG}   (WCAG 2.1 AA: ${AA_BODY}:1 body, ${AA_LARGE}:1 large, ${AA_MARK}:1 marks)\n`);
for (const [W, , dev] of WIDTHS) {
  const mine = rows.filter(r => r.dev === dev);
  // One row per distinct label, taking the WORST route it appeared on — the
  // worst case is the one a person meets.
  const byLabel = new Map();
  for (const r of mine) {
    const k = r.label.replace(/\d+/g, '#').slice(0, 40);
    const cur = byLabel.get(k);
    if (!cur || r.ratio < cur.ratio) byLabel.set(k, r);
  }
  const list = [...byLabel.values()].sort((a, b) => a.ratio - b.ratio);
  console.log(`  ${dev} ${W}px`);
  for (const r of list) {
    const via = r.kind === 'mark' ? `  [fill ${String(r.ratioFill).padStart(5)} · edge ${String(r.ratioRing == null ? '  -  ' : r.ratioRing).padStart(5)} → ${r.carriedBy}]` : '';
    const verdict = r.pass === null ? '··  ' : (r.pass ? 'ok  ' : 'FAIL');
    console.log(`    ${verdict} ${String(r.ratio).padStart(6)}:1  need ${r.pass === null ? '-' : r.need}  ${String(r.fontPx).padStart(5)}px ${r.kind === 'text' ? 'w' + r.weight : 'mark'}  ${r.label}${via}`);
  }
  const judged = list.filter(r => r.pass !== null);
  const bad = judged.filter(r => !r.pass);
  console.log(`    ---- ${bad.length} of ${judged.length} below AA   (· rows are context, not a test)\n`);
}
fs.writeFileSync(`${OUT}/readable-${TAG}.json`, JSON.stringify({ tag: TAG, night: NIGHT, aa: { AA_BODY, AA_LARGE, AA_MARK }, rows, errs }, null, 1));
if (errs.length) console.log('page errors / skips:\n  ' + errs.join('\n  '));
await browser.close();
