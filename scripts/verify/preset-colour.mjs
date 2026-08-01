/**
 * preset-colour.mjs — a graphics preset may change EFFECTS and QUALITY. It may
 * not change what colour the city is.
 *
 * Simeon: "Higher graphics presets change the color character and I want
 * natural saturation on every preset - presets should change effects and
 * quality, never color."
 *
 * It used to, and by a lot: saturation ran 1.00 / 1.10 / 1.18 / 1.20 across
 * performance / balanced / cinematic / ultra, contrast 1.00 / 1.06 / 1.12 /
 * 1.14, exposure 1.00 / 1.03 / 1.05 / 1.05. Those multiply the hour's authored
 * grade in applyGrade(), so the preset was a colour knob wearing a quality
 * label.
 *
 * WHAT IS ASSERTED, and why it is measured twice.
 *
 *   Pass 1 "grade only" forces every lens effect to zero on all four presets,
 *   so the ONLY thing that can still differ is the grade. This is the real
 *   assertion: mean saturation, hue and luma must match across presets within
 *   noise.
 *
 *   Pass 2 "as shipped" leaves the effects at their preset values. Bloom, god
 *   rays and grain genuinely change pixels — that is what they are for — so
 *   this pass REPORTS rather than asserts. A reader who sees a difference here
 *   should know it is bloom, not the grade.
 *
 * Both passes also compare against the OLD preset grade, re-applied by hand, so
 * the number in the report is a before/after and not just an "after".
 *
 * Usage: node preset-colour.mjs
 */
import { chromium } from 'playwright-core';
import { BASE as SERVER, launch } from './chrome.mjs';
import fs from 'node:fs';
import path from 'node:path';

const W = 1280, H = 800;
const POSE = { center: [-97.7420, 30.2790], zoom: 15.2, pitch: 74, bearing: 178 };
const HOURS = [['day', 0.18], ['golden', 0.50], ['night', 0.86]];
const PRESETS = ['performance', 'balanced', 'cinematic', 'ultra'];

// What the presets carried before this change, for the before/after column.
const OLD = {
  performance: { exposure: 1.0,  contrast: 1.0,  saturation: 1.0,  filmic: 0,    vignette: 0.6  },
  balanced:    { exposure: 1.03, contrast: 1.06, saturation: 1.1,  filmic: 0.65, vignette: 1.0  },
  cinematic:   { exposure: 1.05, contrast: 1.12, saturation: 1.18, filmic: 0.8,  vignette: 1.25 },
  ultra:       { exposure: 1.05, contrast: 1.14, saturation: 1.2,  filmic: 0.8,  vignette: 1.25 },
};

const outDir = path.resolve('shots/preset-colour');
fs.mkdirSync(outDir, { recursive: true });

const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(`${SERVER}/_harness.html?intro=0&drift=0`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 120000 });
// It fires 11 s in and rewrites every setting; left running it lands mid-test
// and reads as the preset lever being broken.
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource('austin-buildings') && m.getSource('austin-outer');
}, null, { timeout: 120000 });
await page.waitForTimeout(6000);

await page.evaluate(pose => window.__map.jumpTo(pose), POSE);
await page.waitForFunction(() => window.__map.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120000 });
await page.waitForTimeout(4000);

/** Mean saturation / hue / luma of the frame, reduced IN THE PAGE. */
async function sample(tag) {
  // Data-driven paint and the facade atlas do not land in the frame of the
  // call. Settle, repaint, shoot twice, trust the second.
  await page.evaluate(() => window.__map.triggerRepaint());
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(outDir, '_t.png') });
  await page.waitForTimeout(500);
  const file = path.join(outDir, tag + '.png');
  await page.screenshot({ path: file });
  return file;
}

async function setPreset(name, old, killEffects) {
  await page.evaluate(([name, old, killEffects]) => {
    window.__usePreset(name);
    const G = window.GFX;
    if (old) Object.assign(G, old);
    if (killEffects) {
      Object.assign(G, { bloom: 0, godRays: 0, flare: 0, dof: 0, grain: 0, ao: false });
      // ALSO pin what the frame CONTAINS. The first cut of this test did not,
      // and it failed on a fixed grade — because `fov` is 58 at
      // performance/balanced and 62 at cinematic/ultra, and `treeDensity` runs
      // 0.52 / 0.675 / 1 / 1. A wider lens and thousands more green canopies
      // change the mean hue and saturation of the frame no matter what the
      // grade does: the day hue split 47.8 / 48.1 / 52.5 / 52.3, exactly on the
      // fov boundary. That is CONTENT differing, which is what a quality preset
      // is allowed to do. This pass isolates the grade, so it holds content
      // fixed and the "as shipped" pass reports the rest.
      Object.assign(G, { fov: 58, treeDensity: 0.52, outerDensity: 0.45 });
    }
    window.__aeReset && window.__aeReset();
    window.applyGraphics && window.applyGraphics();
  }, [name, old, killEffects]);
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const host = document.getElementById('map');
    const G = window.GFX;
    return {
      filter: getComputedStyle(host).filter,
      sat: G.saturation, con: G.contrast, exp: G.exposure, filmic: G.filmic,
      vig: G.vignette, preset: G.preset, aeGain: window.__ae ? window.__ae().gain : null,
    };
  });
}

const manifest = [];
for (const [hourName, p] of HOURS) {
  await page.evaluate(pp => window.applyTimeOfDay(window.__map, pp, true), p);
  await page.waitForTimeout(2500);

  for (const mode of ['gradeonly', 'asshipped']) {
    for (const era of ['old', 'new']) {
      for (const preset of PRESETS) {
        const cfg = await setPreset(preset, era === 'old' ? OLD[preset] : null, mode === 'gradeonly');
        const tag = `${hourName}-${mode}-${era}-${preset}`;
        const file = await sample(tag);
        manifest.push({ hour: hourName, mode, era, preset, file, ...cfg });
      }
    }
  }
}

fs.existsSync(path.join(outDir, '_t.png')) && fs.unlinkSync(path.join(outDir, '_t.png'));
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
console.log('frames + manifest in', outDir);
console.log('now run: python scripts/verify/preset_colour_report.py');
browser.__done();
