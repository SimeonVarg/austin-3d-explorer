/**
 * strip-scene.mjs — read the strip the way a person reads it, go there, look.
 *
 * `strip-truth.mjs` proves the strip's amber SHARE matches the count. That is
 * the ratio, and the ratio is the easy half. The strip's real claim is about
 * POSITION — "the dark part is the first third of your walk" — and position is
 * exactly what `litStripMinFrac` distorts, because every floored run pushes
 * everything after it sideways.
 *
 * So this test does what a user does: pick a point on the bar, take its
 * left-to-right fraction as a fraction of the walk, and go stand there. Then
 * ask the scene whether the colour under that finger was telling the truth.
 *
 *   amber under the finger  -> a warm street lamp must be in frame
 *   cool  under the finger  -> no warm street lamp may be in frame
 *
 * The pose is plan view with the site dead centre, for the reason round 3's
 * audit had to learn twice (docs/walk-lit.md §17a): at a walking pitch the
 * frame sees hundreds of metres up the street and answers a question about
 * somewhere else. The 25 m disc is measured through the map's own project() at
 * the site and drawn on every saved frame, so the picture shows the window its
 * own number came from.
 *
 * Layer masking follows §17c/d: `props-lit` carries warm lamps AND blue
 * emergency phones, and a warm lamp is present when its POOL is — green, not
 * cyan, because a blue phone's glow over green canopy reads cyan.
 *
 * Usage: VERIFY_URL=http://127.0.0.1:8714 node shots/walk/lit/strip-scene.mjs
 */
import fs from 'node:fs';
import { chromium } from '../../../scripts/verify/node_modules/playwright-core/index.mjs';
import { BASE, launch } from '../../../scripts/verify/chrome.mjs';

const OUT = 'shots/walk/lit';
const NIGHT = 0.92;
const ZOOM = 19.8;          // same as round 3's matrix, so the pixel numbers compare
const LAMP_GREEN_MIN = 200; // §18: real lamps put down >=691 green px in the disc,
                            // every unmapped site put down exactly 0. Far below
                            // the gap on purpose — a threshold in the middle of
                            // an empty gap is not a threshold anybody tuned.
// Endpoints deliberately spread across campus. The first cut used ANB->ETC and
// TSC->ETC, and both routes' widest amber run is the SAME stretch of the tail
// into ETC — so two "independent" amber sites were one point measured twice.
// A site list is deduplicated by coordinate at the end for exactly that reason.
const ROUTES = [
  ['ANB', 'ETC'],
  ['GDC', 'The Castilian'],
  ['JES', 'PCL'],
  ['MAI', 'DFA'],
  ['NHB', 'SJG'],
  ['WEL', 'LBJ'],
  ['PAI', 'BRB'],
  ['GAR', 'UNB'],
];

const fails = [];
const ok = (c, what, got) => {
  console.log(`  ${c ? 'pass' : '*FAIL'}  ${what}${got === undefined ? '' : '  ->  ' + JSON.stringify(got)}`);
  if (!c) fails.push(what);
};

const browser = await launch(chromium, { gl: 'hardware' });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
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
await page.waitForTimeout(1500);
// The nightness the marks ride on is asserted, not assumed — round 3 §17.
const p = await page.evaluate(() => (window.WAYFIND && window.__todP) || Number(document.getElementById('tod-slider')?.value || 0));
console.log(`time-of-day p = ${p}`);

const results = [];
for (const [from, to] of ROUTES) {
  console.log(`\n# ${from} -> ${to}`);
  // 1. route, and read the finger positions OFF THE LAID-OUT BAR
  const picks = await page.evaluate(async ([f, t]) => {
    const res = await window.wayfindRoute(f, t, { expand: true });
    if (!res.ok) return null;
    const lit = await window.wayfindLit();
    const track = document.querySelector('#wf-card [role="img"]');
    if (!track) return null;
    const tr = track.getBoundingClientRect();
    const segs = Array.from(track.children).filter(c => c.style.position !== 'absolute');
    const hex = (rgb) => {
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rgb);
      return m ? '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('') : rgb;
    };
    const warm = window.WAYFIND.litStripLitCol.toLowerCase();
    const rows = segs.map(s => {
      const b = s.getBoundingClientRect();
      return { amber: hex(getComputedStyle(s).backgroundColor) === warm, x0: b.left - tr.left, w: b.width };
    });
    // the widest of each colour: the most legible place on the bar to put a
    // finger, and therefore the reading a user is most likely to make
    const widest = (want) => rows.filter(r => r.amber === want).sort((a, b) => b.w - a.w)[0] || null;
    const mk = (r) => r && { frac: (r.x0 + r.w / 2) / tr.width, w: Math.round(r.w) };
    return { totalM: lit.totalM, amber: mk(widest(true)), cool: mk(widest(false)), trackW: Math.round(tr.width) };
  }, [from, to]);
  if (!picks) { console.log('  route failed'); continue; }

  for (const kind of ['amber', 'cool']) {
    const pick = picks[kind];
    if (!pick) { console.log(`  no ${kind} segment on this route`); continue; }
    // 2. the fraction a finger on that colour means, as a point on the ground.
    //    Taken off the SAME walked polyline litScan classified, by arc length —
    //    the user's reading, translated with no extra knowledge.
    const site = await page.evaluate(async (frac) => {
      const lit = await window.wayfindLit();
      const runs = lit.runsAt;
      const want = frac * lit.totalM;
      let acc = 0;
      for (const r of runs) {
        if (acc + r.m >= want || r === runs[runs.length - 1]) {
          const into = Math.max(0, Math.min(1, (want - acc) / Math.max(1, r.m)));
          const k = Math.min(r.line.length - 1, Math.floor(into * (r.line.length - 1)));
          return { ll: r.line[k], runLit: !!r.lit, atM: Math.round(want) };
        }
        acc += r.m;
      }
      return null;
    }, pick.frac);
    if (!site) { console.log(`  ${kind}: no site`); continue; }

    // 3. fly there, plan, site dead centre — AND GET THE CARD OUT OF THE WAY.
    //    The first run measured pixels through the open route card, which sits
    //    over the middle of a 960x600 frame and covered most of the 25 m disc.
    //    It still passed, because the amber sites had lamps outside the card's
    //    footprint — but a cool site whose lamp was BEHIND the card would have
    //    read zero green and been recorded as a clean pass. An occluded
    //    instrument that happens to agree with you is the worst kind.
    await page.evaluate(([ll, z]) => {
      const r = document.getElementById('wf-root');
      if (r) { r.dataset.wasDisplay = r.style.display; r.style.display = 'none'; }
      window.__map.jumpTo({ center: ll, zoom: z, pitch: 0, bearing: 0 });
    }, [site.ll, ZOOM]);
    await page.waitForTimeout(900);
    // BOUNDED. `new Promise(r => map.once('idle', r) || setTimeout(r, 3000))`
    // looks like a fallback and is not one: `once` returns the Map, which is
    // truthy, so the setTimeout never runs and a frame that never goes idle
    // hangs the run until the watchdog kills it. Cost one 5-minute run here.
    // Same family as the §13 trap: a MapLibre call returning the Map is the
    // most expensive truthy value in this harness.
    await page.evaluate(() => new Promise((r) => {
      const t = setTimeout(r, 3000);
      window.__map.once('idle', () => { clearTimeout(t); r(); });
    }));

    // the 25 m disc, measured through the map's own projection at this site
    const disc = await page.evaluate(([ll, rad]) => {
      const m = window.__map;
      const c = m.project(ll);
      const dLon = rad / (111320 * Math.cos(ll[1] * Math.PI / 180));
      const e = m.project([ll[0] + dLon, ll[1]]);
      return { cx: c.x, cy: c.y, r: Math.abs(e.x - c.x), dpr: window.devicePixelRatio || 1 };
    }, [site.ll, 25]);

    const feats = await page.evaluate(([cx, cy, r]) => {
      const m = window.__map;
      const box = [[cx - r, cy - r], [cx + r, cy + r]];
      const has = (id) => { try { return m.getLayer(id) ? m.queryRenderedFeatures(box, { layers: [id] }).length : -1; } catch (e) { return -1; } };
      const lit = m.getLayer('props-lit') ? m.queryRenderedFeatures(box, { layers: ['props-lit'] }) : [];
      let warm = 0, blue = 0;
      for (const f of lit) { if ((f.properties || {}).c === 'b') blue++; else warm++; }
      return { propsLit: lit.length, warm, blue, lamp: has('props-lamp'), pad: has('wayfind-lit-pad'), dark: has('wayfind-lit-dark') };
    }, [disc.cx, disc.cy, disc.r]);

    // 4. the pixels. Mask props-lit flat green (warm) / flat blue (phones) and
    //    diff against the unmasked frame, so canopy green cannot be counted as
    //    a lamp — §17b/§17d.
    const base = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 600 } });
    // The mask, copied from round 3's litaudit.mjs rather than re-invented —
    // and the first cut of it re-invented two bugs it had already fixed. The
    // property value is 'blue', not 'b' (a `['==', ..., 'b']` case matches
    // nothing and paints every phone as a lamp), and the pool and the CORE are
    // two layers, so masking only `props-lit` leaves the brightest part of a
    // lamp unmarked. `circle-opacity` is saved and restored too: leaving it at
    // 1 poisons every site after this one.
    await page.evaluate(() => {
      const m = window.__map;
      m.__save = {};
      const paint = {
        'props-lit': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ff00'],
        'props-lit-core': ['match', ['get', 'c'], 'blue', '#0000ff', '#00ffff'],
      };
      for (const id of Object.keys(paint)) {
        if (!m.getLayer(id)) continue;
        m.__save[id] = {
          color: m.getPaintProperty(id, 'circle-color'),
          op: m.getPaintProperty(id, 'circle-opacity'),
        };
        m.setPaintProperty(id, 'circle-color', paint[id]);
        m.setPaintProperty(id, 'circle-opacity', 1);
      }
    });
    await page.waitForTimeout(700);
    const mask = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 600 } });
    await page.evaluate(() => {
      const m = window.__map;
      for (const id of Object.keys(m.__save || {})) {
        m.setPaintProperty(id, 'circle-color', m.__save[id].color);
        m.setPaintProperty(id, 'circle-opacity', m.__save[id].op);
      }
      m.__save = {};
    });

    await page.evaluate(() => {
      const r = document.getElementById('wf-root');
      if (r) r.style.display = r.dataset.wasDisplay || '';
    });

    const tag = `${OUT}/r4-strip-${from}-${kind}`;
    fs.writeFileSync(tag + '.png', base);
    fs.writeFileSync(tag + '-mask.png', mask);
    // The disc the number came from, drawn on the frame it came from, so a
    // person looking at the picture can see the window rather than take it on
    // trust. Round 3 §17a: a claim about a 25 m disc measured on a frame that
    // shows three hundred metres of street is a claim about somewhere else.
    for (const [src, out] of [[base, tag + '-disc.png'], [mask, tag + '-mask-disc.png']]) {
      const b64 = await page.evaluate(async ([b, cx, cy, r]) => {
        const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b; });
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const sx = im.width / 960;
        g.strokeStyle = '#ff2fd6'; g.lineWidth = 2;
        g.beginPath(); g.arc(cx * sx, cy * sx, r * sx, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(cx * sx - 7, cy * sx); g.lineTo(cx * sx + 7, cy * sx);
        g.moveTo(cx * sx, cy * sx - 7); g.lineTo(cx * sx, cy * sx + 7); g.stroke();
        return c.toDataURL('image/png').split(',')[1];
      }, [src.toString('base64'), disc.cx, disc.cy, disc.r]);
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    }

    const px = await page.evaluate(async ([b64a, b64b, cx, cy, r, dpr]) => {
      const load = (b) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b; });
      const [A, B] = await Promise.all([load(b64a), load(b64b)]);
      const cvs = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c.getContext('2d').getImageData(0, 0, im.width, im.height).data; };
      const a = cvs(A), b = cvs(B);
      const W = A.width, H = A.height;
      const sx = W / (960), sy = H / (600);
      const PX = cx * sx, PY = cy * sy, PR = r * sx;
      let green = 0, blue = 0, core = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const dx = x - PX, dy = y - PY;
          if (dx * dx + dy * dy > PR * PR) continue;
          const i = (y * W + x) * 4;
          if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue; // unchanged: not the masked layer
          // THE SHAPE OF THE RATIO, NOT NEARNESS TO A PURE PRIMARY — round 3's
          // rule, and the first cut of this ignored it and used `G > 140`. A
          // blurred circle composited over a near-black night city lands
          // around (5, 30, 8): unmistakably green, nowhere near 140, and
          // counted as nothing. That single threshold reported zero lamp pixels
          // at a site with four mapped lamps standing in it.
          const R = b[i], G = b[i + 1], Bl = b[i + 2];
          const mx = Math.max(R, G, Bl);
          if (mx < 12) continue;
          const hiR = R > mx * 0.55, hiG = G > mx * 0.55, hiB = Bl > mx * 0.55;
          if (hiG && hiB && !hiR) core++;         // the warm lamp's CORE reads cyan
          else if (hiG && !hiB && !hiR) green++;  // its POOL — the presence test
          else if (hiB && !hiG && !hiR) blue++;   // an emergency phone
        }
      }
      return { green, blue, core, discPx: Math.round(PR), w: W, h: H };
    }, [base.toString('base64'), mask.toString('base64'), disc.cx, disc.cy, disc.r, disc.dpr]);

    const lampOnScreen = px.green >= LAMP_GREEN_MIN;
    const row = { from, to, kind, frac: +pick.frac.toFixed(3), segW: pick.w, atM: site.atM,
      ll: site.ll, runLit: site.runLit, ...feats, ...px, lampOnScreen };
    results.push(row);
    console.log(`  ${kind} finger at ${(100 * pick.frac).toFixed(0)}% of the bar = ${site.atM} m along the walk`);
    console.log(`    scan says this run is ${site.runLit ? 'LIT' : 'unmapped'};  queryRenderedFeatures in the 25 m disc:` +
      ` props-lit ${feats.propsLit} (warm ${feats.warm}, phone ${feats.blue}), poles ${feats.lamp}, pads ${feats.pad}, dark-overlay ${feats.dark}`);
    console.log(`    pixels in the disc (${px.discPx} px radius): warm-lamp pool(green) ${px.green}, its core(cyan) ${px.core}, phone(blue) ${px.blue}`);
    if (kind === 'amber') {
      ok(site.runLit, 'the bar is amber where the scan says lit');
      ok(lampOnScreen, 'and a warm street lamp is ON SCREEN there', px.green);
      ok(feats.pad > 0, 'and the receipt ring is drawn at its foot', feats.pad);
    } else {
      ok(!site.runLit, 'the bar is cool where the scan says unmapped');
      ok(!lampOnScreen, 'and NO warm street lamp is on screen there', px.green);
      ok(feats.dark > 0, 'and the map draws its unmapped overlay there', feats.dark);
    }
  }
}

fs.writeFileSync(`${OUT}/r4-strip-scene.json`, JSON.stringify({ zoom: ZOOM, night: NIGHT, greenMin: LAMP_GREEN_MIN, results, errs }, null, 1));
console.log('\nerrors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall pass — the colour under the finger matches what is standing there');
process.exit(fails.length ? 1 : 0);
