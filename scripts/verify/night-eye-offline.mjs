// No browser, no GPU: the parts of "the night as the eye sees it" that are plain logic.
// Freeze switches and the seeded random, the uniforms each switch writes, the window palettes by building type, and
// that the shader hooks are wired in (the shaders themselves compile in night-eye.mjs and in CI's page load).
import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../../js/city-night.js', import.meta.url), 'utf8');
function load(search, extra = {}) {
  const window = { skyBodies: p => ({ lamps: Math.max(0, Math.min(1, (p - .54) / .08)), sun: { elev: -20 } }), ...extra };
  new Function('window', 'location', 'URLSearchParams', 'performance', src)(window, { search }, URLSearchParams, { now: () => 123456 });
  return window.CityNight;
}
const U = () => ({ u_cityEye: { value: { set(...a) { this.a = a; } } }, u_cityEye2: { value: { set(...a) { this.a = a; } } } });
let n = 0; const ok = (name, cond, more = '') => { assert.ok(cond, name + ' ' + more); console.log(' PASS ', name); n++; };

// 1. the freeze switches
const live = load(''), f0 = load('?nightfreeze=1'), f0b = load('?nightfreeze=1'), f7 = load('?nightseed=7'), off = load('?nightfreeze=0');
ok('no switch: the clock is the real one', !live.frozen && live.now() === 123456);
ok('?nightfreeze=0 is not a freeze', !off.frozen);
ok('?nightfreeze=1 freezes the clock at a fixed instant', f0.frozen && f0.now() === 0 && f0.now() === f0.now());
ok('?nightseed=7 freezes it at another instant', f7.frozen && f7.now() !== 0 && f7.seed === 7);
const seq = c => Array.from({ length: 6 }, () => c.rand());
ok('frozen random numbers repeat exactly between two loads', JSON.stringify(seq(f0)) === JSON.stringify(seq(f0b)));
ok('a different seed gives a different sequence', JSON.stringify(seq(load('?nightseed=7'))) !== JSON.stringify(seq(load('?nightfreeze=1'))));
f0.hold(2500); ok('hold() steps the clock by hand', f0.now() === 2500); f0.hold(null); ok('hold(null) lets go', f0.now() === 0);

// 2. the uniforms each switch writes
const u = (search, p) => { const c = load(search), x = U(); c.uniforms(x, p, null); return { a: x.u_cityEye.value.a, b: x.u_cityEye2.value.a, c }; };
let r = u('', 1);
ok('night, defaults: shimmer amplitude on, lamp amplitude on, both parts enabled (bits 3)', r.a[1] > 0 && r.b[0] > 0 && r.b[3] === 3);
ok('late in the night the late-night dropout is full', r.a[3] === 1 && u('', .5).a[3] === 0);
ok('by day nothing is enabled', u('', .2).b[3] === 0 && u('', .2).a[1] === 0);
ok('?twinkle=0 zeroes the shimmer but not the slow change (bits 2)', u('?twinkle=0', 1).a[1] === 0 && u('?twinkle=0', 1).b[0] === 0 && u('?twinkle=0', 1).b[3] === 2);
ok('?twinkle=2 doubles it', Math.abs(u('?twinkle=2', 1).a[1] - 2 * u('', 1).a[1]) < 1e-9);
ok('?nightdrift=0 removes the late-night dropout and the slow change (bits 1)', u('?nightdrift=0', 1).a[3] === 0 && u('?nightdrift=0', 1).b[3] === 1);
ok('?nighteye=0 turns every part off', (r = u('?nighteye=0', 1), r.a[1] === 0 && r.b[3] === 0 && r.c.eye.glare === 0 && !r.c.eye.colour));

// 3. palettes by building type
const tonesFor = (search, category, count = 4000) => {
  const c = load(search); c.register({ id: 'b1', category }); const seen = new Map();
  for (let i = 0; i < count; i++) { const t = c.room('b1|north|0|x', i % 40, Math.floor(i / 40), i % 3).nightTone; seen.set(t, (seen.get(t) || 0) + 1); }
  return seen;
};
const lum = h => { const v = h.match(/[a-f0-9]{2}/gi).map(x => parseInt(x, 16)); return v; };
const cool = h => { const [r, , b] = lum(h); return b - r; };
const share = (m, pred) => { let a = 0, t = 0; for (const [k, v] of m) { t += v; if (pred(k)) a += v; } return a / t; };
const home = tonesFor('', 'residential'), office = tonesFor('', 'office'), old = tonesFor('?nightcolour=0', 'residential');
ok('offices are cooler than homes (mean blue-minus-red)', share(office, h => cool(h) > 0) > share(home, h => cool(h) > 0) + .2, `${share(office, h => cool(h) > 0).toFixed(2)} vs ${share(home, h => cool(h) > 0).toFixed(2)}`);
ok('homes carry a few TV-blue rooms (2 to 8 percent)', (s => s > .02 && s < .08)(share(home, h => cool(h) > 25)), share(home, h => cool(h) > 25).toFixed(3));
ok('?nightcolour=0 restores the old palette (no TV-blue rooms)', share(old, h => cool(h) > 25) === 0);
ok('occupancy (which windows are lit) is untouched by the palette switch', (() => { const a = load(''), b = load('?nightcolour=0'); a.register({ id: 'z' }); b.register({ id: 'z' }); for (let i = 0; i < 500; i++) if (a.room('z|n|0|x', i % 20, i % 7, i % 3).lit !== b.room('z|n|0|x', i % 20, i % 7, i % 3).lit) return false; return true; })());

// 4. the shader hooks are wired in
const cl = fs.readFileSync(new URL('../../js/city-lighting.js', import.meta.url), 'utf8'), sl = fs.readFileSync(new URL('../../js/slopes.js', import.meta.url), 'utf8');
ok('MapLibre window shader applies cityEyeGain to the whole lit window', /vec3 eg=cityEyeGain\(v_cityPos,cityBase\);lit=mix\(shaded\*\.1,lit,min\(eg,vec3\(1\.0\)\)\)\*max\(eg,vec3\(1\.0\)\)/.test(cl));
ok('authored-building shader applies it too (both facade paths)', (sl.match(/cityEyeGain\(v_pos,night\)/g) || []).length === 2);
ok('the shared uniforms are declared and allocated for both renderers', /uniform vec4 u_cityEye, u_cityEye2;/.test(cl) && /u_cityEye:\{value:new T\.Vector4\(\)\}/.test(sl));
ok('only the lamp heads get a lamp amplitude', /painter\.id==='night-streetlight-core'/.test(cl));


// 5. office against home: the mean colour of a lit window by family, before and after (generic buildings, facades.js)
{
  const fac = fs.readFileSync(new URL('../../js/facades.js', import.meta.url), 'utf8');
  const tones = eval(fac.match(/const WINDOW_TONES = (\[[\s\S]*?\n  \]);/)[1]);
  const bias = eval('(' + fac.match(/const TONE_WARM_BIAS = (\{[^}]*\});/)[1] + ')');
  const officeTones = eval(fac.match(/const OFFICE_TONES = (\[[\s\S]*?\}\]);/)[1]);
  const pickOffice = u => { let a = 0; for (const t of officeTones) { a += t.w; if (u <= a) return t.rgb; } return officeTones.at(-1).rgb; };
  const cum = []; { let a = 0; for (const t of tones) cum.push(a += t.w); }
  const pick = r => { const x = r * cum[cum.length - 1]; for (let i = 0; i < cum.length; i++) if (x <= cum[i]) return tones[i].rgb; return tones.at(-1).rgb; };
  const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const lab = ([r, g, b]) => { const R = lin(r), G = lin(g), B = lin(b), X = (.4124 * R + .3576 * G + .1805 * B) / .95047, Y = .2126 * R + .7152 * G + .0722 * B, Z = (.0193 * R + .1192 * G + .9505 * B) / 1.08883, f = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
  const meanTone = (fam, officeCool) => {
    const N = 20000; let m = [0, 0, 0];
    for (let i = 0; i < N; i++) { const u = (i + .5) / N; const oc = (fam === 'tw' || fam === 'tg') ? officeCool : 0; const t = u < oc ? pickOffice(u / oc) : pick(u * bias[fam]); m = m.map((v, k) => v + t[k] / N); }
    return m;
  };
  const dE = (a, b) => Math.hypot(...lab(a).map((v, k) => v - lab(b)[k]));
  const mix = fams => fams.map(f => meanTone(f, 0)).reduce((a, b) => a.map((v, k) => v + b[k] / fams.length), [0, 0, 0]);
  const homes = mix(['lo', 'mr', 'tr']);
  const office = (oc) => ['tw', 'tg'].map(f => meanTone(f, oc)).reduce((a, b) => a.map((v, k) => v + b[k] / 2), [0, 0, 0]);
  const before = dE(office(0), homes), after = dE(office(.85), homes);
  console.log(`   mean lit-window colour: homes rgb(${homes.map(Math.round)}), offices before rgb(${office(0).map(Math.round)}) after rgb(${office(.85).map(Math.round)}); difference office-home ${before.toFixed(1)} -> ${after.toFixed(1)} (CIE76 delta E; 2.3 is a just-noticeable step, 10 and over reads as a different colour)`);
  ok('office windows are a clearly different colour from home windows (delta E at least 10)', after >= 10 && after > before + 5, `${before.toFixed(1)} -> ${after.toFixed(1)}`);
}
console.log(`\n${n} checks passed`);
