/**
 * cardshot.mjs — photograph the lighting block of the card, and MEASURE it.
 *
 * Rounds 1-3 of this lane verified the lighting CLAIM against the scene, over
 * and over, and never once looked at the block of the card the claim is printed
 * in. Simeon's brief for this whole feature ends "The UI should be outstanding
 * for the walk feature", and the only honest way to find out whether it is, is
 * to take the picture and count the lines.
 *
 * Prints, per route: the lighting block's pixel height, its share of the whole
 * open card, the number of rendered text lines in it, and its word count. Then
 * crops the block to its own PNG so a person can look at it.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/cardshot.mjs [tag]
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const TAG = process.argv[2] || 'before';
const OUT = 'shots/walk/lit';
const NIGHT = 0.92;

// Three routes chosen to span what the block can be asked to say, NOT chosen
// for how they photograph: the campus walk the earlier rounds used, the walk
// home into West Campus where the reported-dark source has standing and the
// block is at its longest, and a short hop where it should be at its shortest.
const ROUTES = [
  ['ANB', 'ETC', 'campus crossing, 24 lamps'],
  ['GDC', 'The Castilian', 'the walk home into West Campus'],
  ['PMA', 'WEL', 'a short hop'],
  // AFTER-ONLY, not part of the before/after table: one of the three routes
  // in sixty that carry round 4's near-miss clause. It is here so the clause
  // has a photograph, not so it has a comparison.
  ['CMB', 'TMM', 'the near-miss clause (round 4 only)'],
];

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

const rows = [];
for (const [from, to, why] of ROUTES) {
  await page.evaluate(async ([f, t]) => { await window.wayfindRoute(f, t, { expand: true }); }, [from, to]);
  // The lamp index is fetched on the first route and the card is re-rendered
  // when it lands. Read before that and the lighting block is legitimately not
  // there yet — this waits for the shipped block rather than for a timeout.
  await page.waitForFunction(() => {
    const c = document.getElementById('wf-card');
    return c && /Street lighting/.test(c.textContent || '');
  }, null, { timeout: 60000 });
  const r = await page.evaluate(async ([f, t]) => {
    const res = { ok: true };
    // The lighting block starts at the "Street lighting" heading and runs to
    // the end of the card. Measure it by walking the card's own children so
    // the number is the shipped DOM, not a guess from the source.
    const card = document.getElementById('wf-card') || document.querySelector('.wf-card');
    const kids = Array.from(card.children);
    let i = kids.findIndex(k => /^Street lighting/.test(k.textContent || ''));
    if (i < 0) return { ok: false, why: 'no lighting heading' };
    // ...but the card's own action chips and footer come AFTER it, so stop at
    // the first of those rather than at the last child.
    let j = kids.length;
    for (let k = i + 1; k < kids.length; k++) {
      if (/wf-acts|wf-foot/.test(kids[k].className || '')) { j = k; break; }
    }
    const block = kids.slice(i, j);
    const cb = card.getBoundingClientRect();
    const top = block[0].getBoundingClientRect().top;
    const bot = block[block.length - 1].getBoundingClientRect().bottom;
    // Rendered LINES, not elements: a sentence that wraps to three lines costs
    // the reader three lines. Range.getClientRects gives the real count.
    //
    // AND ONLY WHAT IS ON SCREEN. The first cut of this counted a collapsed
    // drawer's contents at `|| 1` line and all of its words, so the round-4
    // measurement came back with MORE words than the round-3 one it had just
    // deleted eight lines from. An element with zero client rects is not being
    // read by anybody; it is counted as zero, and `hidden` records how much
    // text is behind the tap so the saving cannot be claimed as a deletion.
    // AND A LINE IS A ROW, NOT A BOX. The second cut counted `getClientRects()`
    // directly and the strip's fifteen flex segments came back as fifteen
    // "lines" of text — so adding a picture appeared to make the block longer
    // to read. Distinct rect TOPS is the count that means what the word means:
    // two spans at either end of one flex row are one line, and a sentence that
    // wraps three times is three. Elements with no text contribute none; their
    // height is already in `blockH`, which is the metric that cannot be gamed.
    let lines = 0, words = 0, hidden = 0;
    const shown = [];
    for (const b of block) {
      const rg = document.createRange(); rg.selectNodeContents(b);
      const rects = Array.from(rg.getClientRects());
      const w = (b.textContent || '').trim().split(/\s+/).filter(Boolean).length;
      if (!rects.length) { hidden += w; continue; }
      if (w) {
        const tops = new Set(rects.map(x => Math.round(x.top / 2)));
        lines += tops.size;
      }
      words += w; shown.push(b);
    }
    return {
      ok: true,
      blockH: Math.round(bot - top), cardH: Math.round(cb.height),
      cardTop: Math.round(cb.top), cardLeft: Math.round(cb.left),
      cardW: Math.round(cb.width),
      blockTop: Math.round(top), elems: shown.length, lines, words, hidden,
      text: shown.map(b => (b.textContent || '').trim()).filter(Boolean),
    };
  }, [from, to]);
  if (!r.ok) { console.log(`  ${from}->${to}: FAILED ${r.why || ''}`); continue; }
  const pad = 8;
  const clip = {
    x: Math.max(0, r.cardLeft - pad), y: Math.max(0, r.blockTop - pad),
    width: Math.min(1280 - r.cardLeft + pad, r.cardW + pad * 2),
    height: Math.min(900 - r.blockTop + pad, r.blockH + pad * 2),
  };
  const name = `${OUT}/card-${TAG}-${from}-${String(to).replace(/\W+/g, '')}.png`;
  await page.screenshot({ path: name, clip });
  // and the whole card, so the block can be judged against what it sits in
  await page.screenshot({
    path: `${OUT}/cardfull-${TAG}-${from}-${String(to).replace(/\W+/g, '')}.png`,
    clip: { x: Math.max(0, r.cardLeft - pad), y: Math.max(0, r.cardTop - pad), width: clip.width, height: Math.min(900 - r.cardTop + pad, r.cardH + pad * 2) },
  });
  rows.push({ from, to, why, ...r, shot: name });
  console.log(`${from} -> ${to}  (${why})`);
  console.log(`  lighting block: ${r.blockH}px of a ${r.cardH}px card  = ${Math.round(100 * r.blockH / r.cardH)}%` +
    `   ${r.elems} visible elements, ${r.lines} rendered lines, ${r.words} words on screen` +
    (r.hidden ? `, ${r.hidden} behind the tap` : ''));
  for (const t of r.text) console.log('    | ' + t.replace(/\s+/g, ' ').slice(0, 96));
  console.log('');
}

fs.writeFileSync(`${OUT}/card-${TAG}.json`, JSON.stringify({ tag: TAG, night: NIGHT, rows, errs }, null, 1));
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
