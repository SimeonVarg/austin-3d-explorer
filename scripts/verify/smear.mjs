/**
 * smear.mjs — diagnose the 2-second dark band that smears across the downtown
 * towers just after the title card lifts on the plain URL.
 *
 * Evidence it exists: shots/gaps/opening/lift-a-p00-0ms.jpg (present),
 * lift-a-p03-1196ms.jpg (worst), lift-a-p06-3083ms.jpg (gone).
 *
 * THE POINT OF THIS SCRIPT IS ATTRIBUTION, NOT PHOTOGRAPHY. "It was the camera,
 * not the city" has been the wrong answer six times, so every arm here changes
 * exactly one thing and photographs the same offset from the SAME event — the
 * moment `#veil` gets its `.lift` class — never from navigation, because the
 * load time varies 10-57 s and an offset from `goto` is not an offset from the
 * lift.
 *
 * Arms (`--arm`):
 *   base      nothing touched
 *   nofx      #fx-canvas hidden from before first paint (bloom / god rays / flare)
 *   noveil    #veil removed the instant it lifts (tests the blend-isolation theory)
 *   nosky     #sky hidden
 *   novig     #vignette + #fx-grain + #fx-dof hidden
 *   probeoff  window.cancelGraphicsAutoDetect() as early as it exists
 *
 * Usage:
 *   VERIFY_URL=https://flyover-utx.vercel.app node smear.mjs --arm base --rep 1
 */
import { chromium } from 'playwright-core';
import { BASE, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const ARM = arg('arm', 'base');
const REP = arg('rep', '1');
const URLQ = arg('q', '');
const OUTDIR = path.resolve(arg('out', 'shots/smear'));
const HEADLESS = argv.includes('--headless');
const WARM = argv.includes('--warm');

// Offsets from the moment `.lift` lands on #veil. The reference frames are
// 0 ms / 1196 ms (bad) and 3083 ms (clean), so the window is bracketed either
// side of both.
const OFFSETS = [0, 350, 700, 1100, 1500, 1900, 2400, 3100, 3900];

fs.mkdirSync(OUTDIR, { recursive: true });

const browser = await launch(chromium, { headless: HEADLESS });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 965 }, deviceScaleFactor: 1,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

// Arm setup has to land BEFORE the first paint, so it goes in an init script.
const initFor = {
  nofx: `#fx-canvas{display:none !important}`,
  nosky: `#sky{display:none !important}`,
  novig: `#vignette,#fx-grain,#fx-dof{display:none !important}`,
};
if (initFor[ARM]) {
  await page.addInitScript(css => {
    const s = document.createElement('style'); s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }, initFor[ARM]);
}
if (ARM === 'noveil') {
  await page.addInitScript(() => {
    // Watch for the class rather than polling: the lift and the removal must be
    // in the same task or the theory is not the one being tested.
    const go = () => {
      const v = document.getElementById('veil');
      if (!v) return;
      new MutationObserver(() => {
        if (v.classList.contains('lift')) {
          window.__veilKilledAt = window.__liftAt = performance.now(); v.remove();
        }
      }).observe(v, { attributes: true, attributeFilter: ['class'] });
    };
    if (document.getElementById('veil')) go();
    else document.addEventListener('DOMContentLoaded', go, { once: true });
  });
}
if (ARM === 'probeoff') {
  await page.addInitScript(() => {
    const t = setInterval(() => {
      if (typeof window.cancelGraphicsAutoDetect === 'function') {
        window.cancelGraphicsAutoDetect(); window.__probeKilled = true; clearInterval(t);
      }
    }, 50);
  });
}

const state = () => page.evaluate(() => {
  const m = window.__map;
  const g = window.GFX || {};
  const cs = id => { const e = document.getElementById(id); return e ? getComputedStyle(e) : null; };
  const fx = document.getElementById('fx-canvas');
  const veil = document.getElementById('veil');
  const vcs = veil ? getComputedStyle(veil) : null;
  return {
    t: Math.round(performance.now()),
    veil: !!veil,
    veilOpacity: vcs ? vcs.opacity : null,
    veilLift: veil ? veil.classList.contains('lift') : null,
    fxDisplay: fx ? getComputedStyle(fx).display : null,
    fxBlend: fx ? getComputedStyle(fx).mixBlendMode : null,
    fxBlank: fx ? fx.dataset.blank : null,
    fxW: fx ? fx.width : null,
    dofDisplay: cs('fx-dof') ? cs('fx-dof').display : null,
    dofOpacity: cs('fx-dof') ? cs('fx-dof').opacity : null,
    gfx: { preset: g.preset, bloom: g.bloom, godRays: g.godRays, flare: g.flare,
           dof: g.dof, grain: g.grain, renderScale: g.renderScale, msaa: g.msaa },
    zoom: m ? +m.getZoom().toFixed(3) : null,
    pitch: m ? +m.getPitch().toFixed(1) : null,
    bearing: m ? +m.getBearing().toFixed(1) : null,
    center: m ? [ +m.getCenter().lng.toFixed(5), +m.getCenter().lat.toFixed(5) ] : null,
    loaded: m ? m.loaded() : null,
    tilesLoaded: m ? m.areTilesLoaded() : null,
    easing: m ? m.isEasing() : null,
    // The facade atlas: whatever it chooses to expose about its own readiness.
    bakedReady: (() => { try { return window.facadeBakedReady ? window.facadeBakedReady() : null; } catch (e) { return null; } })(),
    paletteSrc: (() => { try { return window.facadePaletteSource ? window.facadePaletteSource() : null; } catch (e) { return null; } })(),
    atlasRel: (() => { try { const r = window.__atlasRelease; return r ? { live: r.live && r.live.size, held: r.held && r.held.size, ticks: r.ticks, released: r.released } : null; } catch (e) { return null; } })(),
    todP: window.__todCurrentP,
  };
});

async function run(tag) {
  const t0 = Date.now();
  await page.goto(BASE + '/' + URLQ, { timeout: 180000 });
  // Wait for the lift, in the page, so the offset is measured from the event.
  const lift = await page.waitForFunction(() => {
    const v = document.getElementById('veil');
    if (v && v.classList.contains('lift')) return performance.now();
    // noveil arm removes it, so the recorded stamp is the fallback.
    if (!v && window.__veilKilledAt) return window.__veilKilledAt;
    return null;
  }, null, { timeout: 180000, polling: 30 });
  const liftPerf = await lift.jsonValue();
  const navToLift = Date.now() - t0;
  const rows = [];
  for (const off of OFFSETS) {
    await page.waitForFunction(
      o => performance.now() >= window.__liftAt + o,
      off, { timeout: 60000, polling: 16 }
    ).catch(() => {});
    const s = await state();
    const file = path.join(OUTDIR, `${tag}-${String(off).padStart(4, '0')}ms.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 88, timeout: 60000 });
    rows.push({ off, file: path.basename(file), ...s });
    console.log(`  ${String(off).padStart(4)} ms  veil=${s.veil} op=${s.veilOpacity} fx=${s.fxDisplay}/${s.fxBlend}/blank=${s.fxBlank} preset=${s.gfx.preset} rays=${s.gfx.godRays} z=${s.zoom} tiles=${s.tilesLoaded}`);
  }
  return { tag, navToLift, liftPerf, rows };
}

// __liftAt has to exist in the page for the offset waits above.
await page.addInitScript(() => {
  const set = () => {
    const v = document.getElementById('veil');
    if (!v) return;
    new MutationObserver(() => {
      if (v.classList.contains('lift') && window.__liftAt == null) window.__liftAt = performance.now();
    }).observe(v, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.getElementById('veil')) set();
  else document.addEventListener('DOMContentLoaded', set, { once: true });
});

const out = [];
console.log(`ARM=${ARM} REP=${REP} URL=${BASE}/${URLQ} headless=${HEADLESS}`);
out.push(await run(`${ARM}-r${REP}`));
if (WARM) { console.log('warm reload:'); out.push(await run(`${ARM}-r${REP}-warm`)); }

fs.writeFileSync(path.join(OUTDIR, `${ARM}-r${REP}.json`),
  JSON.stringify({ arm: ARM, url: BASE + '/' + URLQ, headless: HEADLESS, errors, runs: out }, null, 2));
console.log('errors:', errors.length ? errors : 'none');
console.log('WROTE', path.join(OUTDIR, `${ARM}-r${REP}.json`));
await browser.__done();
