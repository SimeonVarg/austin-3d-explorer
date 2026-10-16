// Writes the app's light (js/city-sky.js, with the app's own sun track from js/sky.js) into scripts/blender_light_rig.py as numbers,
// for a few named hours. Run it after any change to the app's light:   node scripts/city-sky-rig.mjs        (--check: exit 1 when stale)
// Two lights since 2026-10-15: RIG is light A (the app with ?skyrig=a, the light before that day) and RIG_B is light B (the app's
// default since then; the owner's choice). A builder picks B with FLYOVER_RIG=B. `--into FILE` writes the same blocks into another
// copy of the rig (the shared Blender rig outside the repo), touching only what lies between the markers.
// scripts/verify/gltf-layer.mjs runs the check, so the Blender rig cannot drift from the app.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOURS = { noon: 0.315, morning: 0.05, afternoon: 0.40, golden: 0.49, night: 0.90 };   // the app's clock (0..1)
export const VERSION = '2026-10-12';
export const VERSION_B = '2026-10-15-B';
export const LIGHTS = { A: { search: '?skyrig=a', version: VERSION, name: 'RIG' }, B: { search: '?skyrig=b', version: VERSION_B, name: 'RIG_B' } };

export function rigText(light = 'A') {
  const L = LIGHTS[light];
  const skyJs = fs.readFileSync(path.join(ROOT, 'js/sky.js'), 'utf8');
  const keys = name => (new Function('return ' + skyJs.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'))[1]))();
  const SUN = keys('SUN_KEYS'), MOON = keys('MOON_KEYS');
  const track = (K, p) => { p = Math.max(0, Math.min(1, p)); if (p <= K[0].p) return { az: K[0].az, elev: K[0].elev };
    for (let i = 1; i < K.length; i++) if (p <= K[i].p) { const a = K[i - 1], b = K[i], t = (p - a.p) / (b.p - a.p); return { az: a.az + (b.az - a.az) * t, elev: a.elev + (b.elev - a.elev) * t }; }
    return { az: K[K.length - 1].az, elev: K[K.length - 1].elev }; };
  const w = { location: { search: L.search } }; w.window = w; w.skyBodies = p => ({ sun: track(SUN, p), moon: track(MOON, p) });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-sky.js'), 'utf8'), vm.createContext({ window: w, document: { querySelector: () => null, getElementById: () => null }, URLSearchParams, Float32Array, Uint8Array, console }));
  const C = w.CitySky, T = C.tune, r = (v, n = 5) => +v.toFixed(n), R = { version: L.version };
  if (T.mirrorSky !== 1) R.mirrorSky = T.mirrorSky;
  for (const [name, p] of Object.entries(HOURS)) {
    const a = C.at(p), s = w.skyBodies(p).sun;
    R[name] = { p, sunAzEl: [r(s.az, 2), r(s.elev, 2)], sunDir: a.sunDir.map(v => r(v)), sunStrength: a.sunStrength.map(v => r(v)),
      pts: a.pts.map(([z, c]) => [r(z), c.map(v => r(v))]), gain: a.gain.map(v => r(v)), ground: a.ground.map(v => r(v)), groundColour: T.ground.slice(),
      groundEdge: T.groundEdge, treeShift: r(0.5 * T.tree.amp + T.tree.lift), light: a.light.map(c => c.map(v => r(v))) };
  }
  return L.name + ' = ' + JSON.stringify(R).replace(/"(\w+)":/g, "'$1':").replace(/"/g, "'") + '\n';
}
/** the file's text with both blocks filled (# RIG-BEGIN .. # RIG-END and # RIG-B-BEGIN .. # RIG-B-END; the B block is added after the A block when missing) */
export function fill(src) {
  let out = src.replace(/(# RIG-BEGIN[^\n]*\n)[\s\S]*?(# RIG-END\n)/, (_, a, b) => a + rigText('A') + b);
  if (!/# RIG-B-BEGIN/.test(out)) out = out.replace(/(# RIG-END\n)/, '$1# RIG-B-BEGIN (generated: node scripts/city-sky-rig.mjs)\n# RIG-B-END\n');
  return out.replace(/(# RIG-B-BEGIN[^\n]*\n)[\s\S]*?(# RIG-B-END)/, (_, a, b) => a + rigText('B') + b);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--into'), file = i > 0 ? path.resolve(process.argv[i + 1]) : path.join(ROOT, 'scripts/blender_light_rig.py'), src = fs.readFileSync(file, 'utf8');
  const out = fill(src);
  if (process.argv.includes('--check')) { if (out !== src) { console.error(file + ' is stale: run node scripts/city-sky-rig.mjs'); process.exit(1); } console.log('the Blender rig matches js/city-sky.js (lights A and B)'); }
  else { const tmp = file + '.tmp-rig'; fs.writeFileSync(tmp, out); fs.renameSync(tmp, file); console.log('wrote lights A and B for', Object.keys(HOURS).join(', '), 'into', file); }
}
