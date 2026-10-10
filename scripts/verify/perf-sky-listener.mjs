/**
 * perf-sky-listener.mjs — what does one map.addImage cost with the sky/fog placement listener as it was
 * (`?skyplace=every`) and as it is now (default)? And do the ten cameras still look the same? Not a check: no verdict,
 * listed under laptop_only. (written 2026-10-10)
 *
 *   node perf-sky-listener.mjs --steps cost,pics [--reps 3] [--out DIR]
 *
 * cost: per rep and per arm (old, new) x CPU throttle (1x, 4x: Chrome DevTools Emulation.setCPUThrottlingRate on the
 *   page main thread only), a FRESH Chrome with an empty cache, the page loaded with ?drift=0, graphics auto-detect
 *   cancelled, waited until the opening flight has ended (reveal + 12 s), then 20 addImage calls of an 8x8 image in a row
 *   timed together, and the same 20 timed with the style's `data` events held back for contrast. Arms alternate A B, B A.
 *   Reports min / median / max ms per addImage.
 * pics: the ten cameras of ci/poses.json, old listener once, new twice (its own noise), ci/pictures.mjs --compare.
 * The machine's own load and graphics are whatever they are: quote them with the numbers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a 4x-throttled load takes longer than chrome.mjs's default 300 s watchdog
process.env.VERIFY_MAX_MS = process.env.VERIFY_MAX_MS && +process.env.VERIFY_MAX_MS > 3600000 ? process.env.VERIFY_MAX_MS : '3600000';
const { chromium } = await import('playwright-core');
const { launch } = await import('./chrome.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const STEPS = arg('--steps', 'cost,pics').split(',');
const REPS = +arg('--reps', 3);
const OUT = arg('--out', process.env.VERIFY_OUT || '/tmp/perf-sky-listener');
const URLB = process.env.VERIFY_URL || 'http://127.0.0.1:8442';
fs.mkdirSync(OUT, { recursive: true });
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f2 = n => (Math.round(n * 100) / 100).toString();

if (STEPS.includes('cost')) {
  const arms = [['old listener (?skyplace=every)', '&skyplace=every'], ['new listener', '']];
  const plan = [];
  for (let r = 1; r <= REPS; r++) for (const th of (r % 2 ? [1, 4] : [4, 1])) for (const a of (r % 2 ? arms : [...arms].reverse())) plan.push({ r, th, a });
  const res = {};
  for (const { r, th, a } of plan) {
    const browser = await launch(chromium);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await page.addInitScript(() => { const iv = setInterval(() => { if (window.cancelGraphicsAutoDetect) { try { window.cancelGraphicsAutoDetect(); } catch (e) {} clearInterval(iv); } }, 10); setTimeout(() => clearInterval(iv), 30000); });
      if (th > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: th });
      await page.goto(URLB + '/index.html?drift=0' + a[1], { waitUntil: 'load', timeout: 300000 });
      await page.waitForFunction(() => window.__intro && window.__intro.reason, null, { timeout: 420000, polling: 500 });
      await page.waitForTimeout(12000 * (th > 1 ? 2 : 1));
      const m = await page.evaluate(async () => {
        const map = window.__map, N = 20;
        const run = (tag) => { const t = performance.now(); for (let i = 0; i < N; i++) map.addImage(tag + i, { width: 8, height: 8, data: new Uint8Array(256) }); return (performance.now() - t) / N; };
        const warm = run('__w'); for (let i = 0; i < N; i++) map.removeImage('__w' + i);
        await new Promise(r => setTimeout(r, 300));
        const ms = run('__p'); for (let i = 0; i < N; i++) map.removeImage('__p' + i);
        return { ms, order: map.getLayersOrder ? map.getLayersOrder().length : null };
      });
      (res[`${th}|${a[0]}`] = res[`${th}|${a[0]}`] || []).push(m.ms);
      console.log(`  rep ${r} ${th}x ${a[0]}: ${f2(m.ms)} ms per addImage (${m.order} layers)`);
    } catch (e) { console.log(`  rep ${r} ${th}x ${a[0]} FAILED: ${e.message}`); } finally { await browser.close(); }
  }
  console.log(`\n## cost of one map.addImage (8x8, 20 in a row, settled page), ms; min / median / max, ${REPS} reps`);
  for (const k of Object.keys(res).sort()) { const v = res[k]; console.log(`${k.replace('|', 'x  ')}`.padEnd(46) + `${f2(Math.min(...v))} / ${f2(med(v))} / ${f2(Math.max(...v))}   [${v.map(f2).join(', ')}]`); }
}

if (STEPS.includes('pics')) {
  const poses = path.join(HERE, 'ci/poses.json');
  const dir = path.join(OUT, 'pics');
  const base = 'namelabels=0';
  for (const [side, extra] of [['before', '&skyplace=every'], ['after', ''], ['again', '']]) {
    fs.mkdirSync(path.join(dir, side), { recursive: true });
    console.log(`\n===== pics ${side} =====`);
    spawnSync('node', [path.join(HERE, 'shot.mjs'), side, poses], { stdio: 'inherit', cwd: path.join(dir, side), env: { ...process.env, SHOT_Q: base + extra } });
  }
  spawnSync('node', [path.join(HERE, 'ci/pictures.mjs'), '--compare', '--out', dir, '--label', 'old listener'], { stdio: 'inherit', cwd: HERE });
}
process.exit(0);
