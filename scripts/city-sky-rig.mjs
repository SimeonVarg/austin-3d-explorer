// Writes the app's light (js/city-sky.js, with the app's own sun track from js/sky.js) into scripts/blender_light_rig.py as numbers,
// for a few named hours. Run it after any change to the app's light:   node scripts/city-sky-rig.mjs        (--check: exit 1 when stale)
// scripts/verify/gltf-layer.mjs runs the check, so the Blender rig cannot drift from the app.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOURS = { noon: 0.315, morning: 0.05, afternoon: 0.40, golden: 0.49, night: 0.90 };   // the app's clock (0..1)
export const VERSION = '2026-10-12';

export function rigText() {
  const skyJs = fs.readFileSync(path.join(ROOT, 'js/sky.js'), 'utf8');
  const keys = name => (new Function('return ' + skyJs.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'))[1]))();
  const SUN = keys('SUN_KEYS'), MOON = keys('MOON_KEYS');
  const track = (K, p) => { p = Math.max(0, Math.min(1, p)); if (p <= K[0].p) return { az: K[0].az, elev: K[0].elev };
    for (let i = 1; i < K.length; i++) if (p <= K[i].p) { const a = K[i - 1], b = K[i], t = (p - a.p) / (b.p - a.p); return { az: a.az + (b.az - a.az) * t, elev: a.elev + (b.elev - a.elev) * t }; }
    return { az: K[K.length - 1].az, elev: K[K.length - 1].elev }; };
  const w = { location: { search: '' } }; w.window = w; w.skyBodies = p => ({ sun: track(SUN, p), moon: track(MOON, p) });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-sky.js'), 'utf8'), vm.createContext({ window: w, document: { querySelector: () => null, getElementById: () => null }, URLSearchParams, Float32Array, Uint8Array, console }));
  const C = w.CitySky, T = C.tune, r = (v, n = 5) => +v.toFixed(n), R = { version: VERSION };
  for (const [name, p] of Object.entries(HOURS)) {
    const a = C.at(p), s = w.skyBodies(p).sun;
    R[name] = { p, sunAzEl: [r(s.az, 2), r(s.elev, 2)], sunDir: a.sunDir.map(v => r(v)), sunStrength: a.sunStrength.map(v => r(v)),
      pts: a.pts.map(([z, c]) => [r(z), c.map(v => r(v))]), gain: a.gain.map(v => r(v)), ground: a.ground.map(v => r(v)), groundColour: T.ground.slice(),
      groundEdge: T.groundEdge, treeShift: r(0.5 * T.tree.amp + T.tree.lift), light: a.light.map(c => c.map(v => r(v))) };
  }
  return 'RIG = ' + JSON.stringify(R).replace(/"(\w+)":/g, "'$1':").replace(/"/g, "'") + '\n';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(ROOT, 'scripts/blender_light_rig.py'), src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/(# RIG-BEGIN[^\n]*\n)[\s\S]*?(# RIG-END)/, (_, a, b) => a + rigText() + b);
  if (process.argv.includes('--check')) { if (out !== src) { console.error('scripts/blender_light_rig.py is stale: run node scripts/city-sky-rig.mjs'); process.exit(1); } console.log('the Blender rig matches js/city-sky.js'); }
  else { fs.writeFileSync(file, out); console.log('wrote the rig numbers for', Object.keys(HOURS).join(', ')); }
}
