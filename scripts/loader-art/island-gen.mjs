#!/usr/bin/env node
// Loading-screen hero, refined: the UT Tower as the one tall thing, the Main
// Building low round its foot, the South Mall stepping down to Littlefield
// Fountain, a gold walking route up the mall to the Main Building door, and two
// small floating islets (West Campus apartments, downtown). True isometric (30
// degrees), flat three-tone faces, light from the upper left. The main island
// also has a stepped rock underside (ice), and an other side (B): the island
// turned over, West Campus apartments on its mirrored pads (aptB) and the same
// kind of rock under them (iceB).
//
// Two backends from the same primitives: every box, roof, stair and face
// detail is written as SVG (the still drawing) AND recorded as real 3D geometry
// (heroArt(..., 'model')), which js/loader.js rolls and reshapes in a worker.
//
//   node scripts/loader-art/island-gen.mjs <out.html>   a preview of the scene
//   node scripts/loader-art/export.mjs                   the layers for js/loader.js
//   node scripts/loader-art/export.mjs model             the 3D model (ART_MODEL)
//
// heroArt(T, G) is dependency-free so it can be pasted into js/loader.js as
// cityArt(). Every colour and timing is a token in TOKENS; each becomes a CSS
// custom property at the top of the SVG, so either place is a one-line edit.
// Every shape is placed by ONE projection helper, P(i, j, z):
//   i = metres east, j = metres south, z = display metres up (real x exaggeration)
//   sx = X0 + (i - j) * cw,  sy = Y0 + (i + j) * ch - z * u,  cw = u cos30, ch = u sin30
// Faces carry their details in face-local metres through an SVG matrix, so an
// arch or a clock drawn as a plain circle lands on its face at the right skew.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKENS = {
  // sky
  moon: '#f6ecdc', moonAlpha: 0.07, star: '#f6ecdc', starAlpha: 0.6,
  halo: '#bf5700', haloAlpha: 0.35,
  // limestone: Tower shaft and Main Building walls (top / lit / shade)
  limeTop: '#e4be84', limeLit: '#b99367', limeShade: '#66584a',
  roofFlat: '#7a6a55', // the Main Building's flat middle roof and the valleys between roof segments
  // crown stone (cornice) and the crown lit orange "on a win"
  crownTop: '#f1d6a6', crownLit: '#d6ae77', crownShade: '#807157',
  winTop: '#e07a2a', winLit: '#bf5700', winShade: '#8a3f00',
  // verdigris copper cap
  copperTop: '#8fa596', copperLit: '#6f8477', copperShade: '#4a5a52',
  // terracotta tile, plus a ridge-cap line and the eave shadow on the walls below
  tileLit: '#b2613c', tileMid: '#9c4a2f', tileShade: '#5a2f25', tileRidge: '#cf8057', eaveAlpha: 0.4,
  // hall walls (the loved block trio)
  hallTop: '#bc8c5d', hallLit: '#745744', hallShade: '#393e49',
  // far-off downtown, kept dark so it never competes with the Tower
  farTop: '#3c4a4e', farLit: '#2b3a40', farShade: '#1d2a31',
  // openings, glass, bronze, clock, bells
  opening: '#393e49', openingDeep: '#262b33', glow: '#efb66b', door: '#3f6f73',
  glassLit: '#343944', glassShade: '#23272e', bronzeLit: '#8a7448', bronzeShade: '#56492f',
  clock: '#fff0c7', bezel: '#d8b247', hands: '#3a352f', bell: '#231b16', mast: '#b5bfc0',
  // island, platforms, lawn, paving, water
  islandTop: '#202c31', islandEdge: '#2b3a40', islandSide: '#16222a',
  lawnTop: '#3f5a4b', lawnLit: '#2f4439', lawnShade: '#22322a',
  paveTop: '#57635f', riser: '#46524f', riserShade: '#2f3a3c',
  water: '#7fa9b0', glint: '#f6ecdc',
  // accents: the walking route (gold dots), the figure
  accent: '#f6b85e', figure: '#f6ecdc', pack: '#bf5700', shadow: '#0b141b',
  // motion (transform/opacity only; all off under prefers-reduced-motion)
  haloBreath: '3.6s', glintBlink: '2.8s', starTwinkle: '5.5s', routeWalk: '3.6s',
  // the flip side: the iceberg's rock (lit face / shade face / the lit lip of each ledge)
  rockLit: '#34474f', rockShade: '#1f2e36', rockBand: '#4a6068',
  // the apartments: light concrete, brick, flat roofs, balcony slab edges
  aptLit: '#b3a58c', aptShade: '#4a4d58', aptRoof: '#6f6b66', aptBand: '#2c2f38',
  brickLit: '#9a5640', brickShade: '#4d2e2a',
};

// ---- island float (taste knobs). Each island rises `lift` art units over `rise`, then sinks back
// over the same time; the delays put them out of step. Transform only, on whole layers, so the
// browser's compositor runs it and it stays smooth while the city loads on the main thread.
export const FLOAT = {
  main: { lift: 6, rise: 3.4, delay: 0 },       // the big island: heaviest, slowest (as FLOAT in js/loader.js)
  west: { lift: 4, rise: 2.5, delay: -1.1 },    // West Campus islet
  city: { lift: 7, rise: 2.9, delay: -2.2 },    // downtown islet
};

// ---- geometry knobs (one-line edits)
export const GEO = {
  u: 1.2,           // screen units per ground metre
  X0: 398, Y0: 214, // screen position of the Tower's ground centre
  hx: 1.0,          // height exaggeration for everything but the Tower
  tx: 1.72,         // Tower SHAFT height exaggeration: it must be the one tall thing
  crown: 1.3,       // vertical scale of the crown (66.3-94 m): near-true proportions, so the belfry is a colonnade, not a fluted box
  wingSegs: 1,      // Main Building wing roofs: 1 long hip, or 2 shorter hips with a valley
  haloRx: 78, haloRy: 56, // halo round the crown, kept inside the art box
  zigInset: 5, zigDrop: 7, slab: 18, zigSteps: 2, // island underside: step inset and drop, main slab depth (metres), step count
  mainZig: false,   // the main island's old two-step underside; the iceberg replaces it
  // the iceberg: one entry per level, top to bottom. A number = every pad inset by that many
  // metres; a list = footprints [i0, i1, j0, j1]. drops = each level's height, alpha = its fade.
  ice: { z0: -18, lip: 0.9,
    levels: [4, 9, [[-70, -56, 20, 44], [-58, 34, -22, 76], [54, 64, 18, 30]], [[-67, -59, 24, 38], [-46, 26, -12, 66], [56, 62, 20, 27]], [[-36, 18, -2, 56]], [[-26, 10, 8, 48]], [[-18, 4, 16, 42]], [[-11, -1, 23, 36]]],
    drops: [6, 8, 10, 11, 12, 13, 14, 16], alpha: [1, 1, .95, .88, .8, .7, .58, .46] },
  // the apartment side: heights in metres, and where the trees stand (i, j on the mall level)
  apt: { tall: 62, mid: 20, east: 30, wing: 12, row: 11, office: 6, small: 13, west: 18,
    tree: 3.4, trees: [[-36, 66], [-22, 72], [6, 64], [20, 72], [33, 63], [58, 64], [72, 38]] },
  // the other side: the island turns over along the line i = flip.i, round the slab's middle
  // (z = flip.z), so B's pads are A's mirrored east-west. Each B box is RE-PLACED on its mirrored
  // footprint, not reflected, so its south and east faces keep their windows.
  flip: { i: -4, z: -9 },
  dot: 2.2, dotGap: 3.2,  // walking route: dot diameter (screen units) and spacing on the flat (metres)
  moon: [128, 70, 38],    // cx, cy, r
  west: [-150, 26, -6],   // West Campus islet: i, j, top z
  city: [39, -116, -14],    // downtown islet: i, j, top z
};

export function heroArt(T = TOKENS, G = GEO, F = FLOAT, PARTS = false) {
  const COS = Math.cos(Math.PI / 6);
  const U = G.u, CW = U * COS, CH = U / 2, X0 = G.X0, Y0 = G.Y0;
  const t10 = v => Math.round(v * 10); // integer tenths: exact deltas, no float noise
  const f10 = t => { const a = Math.abs(t), s = a % 10 ? (a < 10 ? '.' + a : (a / 10 | 0) + '.' + a % 10) : String(a / 10); return t < 0 ? '-' + s : s; };
  const n = v => f10(t10(v));
  const n2 = v => { const r = Math.round(v * 100) / 100; return String(r).replace(/^(-?)0\./, '$1.'); };
  // numbers need no separator before '-', nor before '.' when the previous number already has one
  const sep = (p, x) => x[0] === '-' || (x[0] === '.' && p.includes('.')) ? '' : ' ';
  const join = a => a.reduce((s, x, k) => s + (k ? sep(a[k - 1], x) : '') + x, '');
  // every point placed through P also grows the current layer's bounds, so each moving layer
  // can be cut to its own island instead of the whole (mostly empty) art box
  const bounds = {}; let cur = 'sky';
  const grow = (x, y) => { const b = bounds[cur] = bounds[cur] || [1e9, 1e9, -1e9, -1e9]; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); };
  // every projected point keeps its 3D position in .w, so the 3D backend can read any polygon back
  const P = (i, j, z) => { const q = [X0 + (i - j) * CW, Y0 + (i + j) * CH - z * U]; q.w = [i, j, z]; grow(q[0], q[1]); return q; };
  // ---- the 3D backend. While a layer of state A (ice, main) or B (iceB, aptB) is being drawn,
  // every primitive is also noted as geometry, in paint order:
  //   b box (all six faces; its details per face as the same SVG, in the face's own metres)
  //   p polygon (roof planes, the copper cap, eave shadows)   l stroked line (roof ridges)
  //   s sprite: an SVG shape that stays facing the viewer, pinned to a 3D point (mast, figure, trees)
  //   d route dot   c drum (the fountain basin)   e flat ellipse on the ground (water, shadows)
  // par is the box a piece rides on: the last box drawn, or 'on' = the box it stands on.
  const M3 = { A: [], B: [] }, REC = { ice: 'A', main: 'A', iceB: 'B', aptB: 'B' };
  let rec = null, quiet = 0, part = '', lastBox = -1, MIR = null;
  const note = r => {
    if (!rec || quiet) return r;
    if (r.t === 'b') { r.part = part; lastBox = rec.length; } else if (r.par == null) r.par = lastBox;
    rec.push(r); return r;
  };
  // a face with no class in the drawing still exists in 3D: take its colour from the box's family
  const FAM = [['lt', 'll', 'ls'], ['rf', 'll', 'ls'], ['ct', 'cl', 'cs'], ['ot', 'ol', 'os'], ['kt', 'kl', 'ks'], ['ht', 'hl', 'hs'], ['ft', 'fl', 'fs'],
    ['it', 'ie', 'is'], ['pt', 'ie', 'is'], ['gt', 'gl', 'gs'], ['st', 'sr', 'ss'], ['rib', 'ril', 'ris'], ['ar', 'al', 'as'], ['ar', 'bl', 'bs'], ['ar', 'gl2', 'gs2']];
  const fam = cls => {
    if (cls.every(Boolean)) return cls.slice();
    const f = FAM.find(f => cls.some((c, k) => c && f[k] === c)), any = cls.find(Boolean);
    return cls.map((c, k) => c || (f ? f[k] : any));
  };
  const ridge = (...lines) => lines.forEach(l => l && note({ t: 'l', c: 'rg', w: 0.6, p: l.map(q => q.w) }));
  // compact path: absolute move, then relative lines between the ROUNDED points
  const d = pts => {
    const q = pts.map(p => [t10(p[0]), t10(p[1])]);
    let s = 'M' + join([f10(q[0][0]), f10(q[0][1])]), cmd = '', last = '';
    for (let k = 1; k < q.length; k++) {
      const dx = q[k][0] - q[k - 1][0], dy = q[k][1] - q[k - 1][1];
      const [c, args] = dx === 0 ? ['v', [f10(dy)]] : dy === 0 ? ['h', [f10(dx)]] : ['l', [f10(dx), f10(dy)]];
      s += (c === cmd ? sep(last, args[0]) : c) + join(args); cmd = c; last = args[args.length - 1];
    }
    return s + 'z';
  };
  const poly = (c, pts) => { if (pts.every(q => q.w)) note({ t: 'p', c, p: pts.map(q => q.w) }); return `<path class="${c}" d="${d(pts)}"/>`; };
  // paint layers, back to front: each becomes its own <svg>, so it can move on the compositor
  let out = [];
  const layers = { sky: out };
  const layer = k => { out = layers[k] = layers[k] || []; cur = k; rec = REC[k] ? M3[REC[k]] : null; };
  const PLAIN = /^<path class="(\w+)" d="([^"]+)"\/>$/;
  const add = s => { // consecutive plain paths of one class merge into one element
    const m = PLAIN.exec(s), lm = out.length && PLAIN.exec(out[out.length - 1]);
    if (m && lm && m[1] === lm[1]) out[out.length - 1] = `<path class="${m[1]}" d="${lm[2]}${m[2]}"/>`;
    else out.push(s);
  };
  // face-local frames: x metres along the face (left to right on screen), y display metres up
  const frame = (a, b, c, dd, [e, f]) => `matrix(${join([n2(a), n2(b), n2(c), n2(dd), n(e), n(f)])})`;
  // a face's details in its frame: a lone element takes the transform itself, saving the group
  const onFace = (tf, s) => /^<[a-z]+ [^<]*\/>$/.test(s) ? s.replace(/\/>$/, ` transform="${tf}"/>`) : `<g transform="${tf}">${s}</g>`;
  const mL = (i0, j1) => frame(CW, CH, 0, -U, P(i0, j1, 0));
  const mR = (i1, j1) => frame(CW, -CH, 0, -U, P(i1, j1, 0));
  const mT = (i0, j0, z) => frame(CW, CH, -CW, CH, P(i0, j0, z));
  const R = (c, x, y, w, h) => `<rect class="${c}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`;
  const rects = (c, list) => `<path class="${c}" d="${list.map(([x, y, w, h]) => `M${join([n(x), n(y)])}h${n(w)}v${n(h)}h${n(-w)}z`).join('')}"/>`;
  // round-headed opening in face-local coords (y up): x, sill y0, width w, total height h
  const archD = (x, y0, w, h) => { const r = w / 2, s = h - r; return `M${join([n(x), n(y0)])}v${n(s)}a${join([n(r), n(r)])} 0 0 0 ${join([n(w), '0'])}v${n(-s)}z`; };
  const arches = (c, list) => `<path class="${c}" d="${list.map(a => archD(...a)).join('')}"/>`;
  // `count` equal openings centred in [x0, x1]
  const row = (x0, x1, count, w, y0, h) => Array.from({ length: count }, (_, k) => [x0 + (x1 - x0) / count * (k + 0.5) - w / 2, y0, w, h]);
  // ...or as ONE dashed stroke per row: the same shapes in a fraction of the bytes
  const dashP = (c, dash, gap, h, segs, vert) => `<path class="${c}" stroke-width="${n(h)}" stroke-dasharray="${n(dash)} ${n(gap)}" d="${segs.map(([x, y, len]) => vert ? `M${join([n(x), n(y)])}v${n(len)}` : `M${join([n(x), n(y + h / 2)])}h${n(len)}`).join('')}"/>`;
  const grid = (x0, x1, count, w, ys, h, every = 0, dark = 'so', lit = 'sg') => {
    const p = (x1 - x0) / count, s = x0 + (p - w) / 2;
    let o = dark ? dashP(dark, w, p - w, h, ys.map(y => [s, y, p * (count - 1) + w])) : '';
    if (every) {
      const segs = [];
      ys.forEach((y, r) => { const k0 = (r * 2 + 1) % every; if (k0 < count) segs.push([s + k0 * p, y, p * every * Math.floor((count - 1 - k0) / every) + w]); });
      if (segs.length) o += dashP(lit, w, p * every - w, h, segs);
    }
    return o;
  };

  /** Box with visible top, left (south, j=j1) and right (east, i=i1) faces. In 3D it has all six;
   *  c3 overrides the 3D colours [top, south, east] where the drawing leaves a face out. */
  function box(b, cls, det = {}, c3) {
    const { i0, i1, j0, j1, z0, z1 } = b;
    const [ct, cl, cr] = cls;
    const r = note({ t: 'b', b: [i0, i1, j0, j1, z0, z1], c: c3 || fam(cls), d: [], h: ['T', 'L', 'R'].filter((f, k) => !cls[k]).join('') });
    quiet++;
    if (ct) add(poly(ct, [P(i0, j0, z1), P(i1, j0, z1), P(i1, j1, z1), P(i0, j1, z1)]));
    if (ct && det.top) { const s = det.top(i1 - i0, j1 - j0); add(onFace(mT(i0, j0, z1), s)); r.d.push(['T', s]); }
    if (cl) add(poly(cl, [P(i0, j1, z1), P(i1, j1, z1), P(i1, j1, z0), P(i0, j1, z0)]));
    if (cl && det.left) { const s = det.left(i1 - i0, z0, z1); add(onFace(mL(i0, j1), s)); r.d.push(['L', s]); }
    if (cr) add(poly(cr, [P(i1, j1, z1), P(i1, j0, z1), P(i1, j0, z0), P(i1, j1, z0)]));
    if (cr && det.right) { const s = det.right(j1 - j0, z0, z1).replace(/"(so|wo)"/g, (m, c) => c === 'so' ? '"sd"' : '"ao"'); add(onFace(mR(i1, j1), s)); r.d.push(['R', s]); }
    quiet--;
  }
  const B = (i0, i1, j0, j1, z0, z1) => ({ i0, i1, j0, j1, z0, z1 });
  // a box at a drawn position: on the other side (MIR set) its footprint moves to the mirrored place
  const Bx = (i0, i1, j0, j1, z0, z1) => MIR == null ? B(i0, i1, j0, j1, z0, z1) : B(2 * MIR - i1, 2 * MIR - i0, j0, j1, z0, z1);
  /** Hip roof: an eave shadow on the walls below, a fascia band for thickness, four planes, a ridge-cap line.
   *  The ridge runs along the longer side. `o` is the overhang; pass a bigger i0 to stop it at a neighbour. */
  function hip(i0, i1, j0, j1, ze, o = 1.2, pitch = 31, shade = 3) {
    const I0 = i0 - o, I1 = i1 + o, J0 = j0 - o, J1 = j1 + o;
    const alongI = (I1 - I0) >= (J1 - J0);
    const h = (alongI ? J1 - J0 : I1 - I0) / 2;
    const zr = ze + h * Math.tan(pitch * Math.PI / 180) * G.hx, f = 0.9 * G.hx, s0 = ze - f, s1 = s0 - 1.6 * G.hx;
    if (shade & 1) add(poly('esh', [P(i0, j1, s0), P(i1, j1, s0), P(i1, j1, s1), P(i0, j1, s1)])); // south wall
    if (shade & 2) add(poly('esh', [P(i1, j1, s0), P(i1, j0, s0), P(i1, j0, s1), P(i1, j1, s1)])); // east wall
    add(poly('rm', [P(I0, J1, ze), P(I1, J1, ze), P(I1, J1, s0), P(I0, J1, s0)]));
    add(poly('rs', [P(I1, J1, ze), P(I1, J0, ze), P(I1, J0, s0), P(I1, J1, s0)]));
    let a, b;
    if (alongI) {
      const jm = (J0 + J1) / 2; a = P(I0 + h, jm, zr); b = P(I1 - h, jm, zr);
      add(poly('rm', [P(I0, J0, ze), P(I1, J0, ze), b, a]));          // north plane
      add(poly('rl', [P(I0, J0, ze), a, P(I0, J1, ze)]));             // west hip
      add(poly('rl', [P(I0, J1, ze), a, b, P(I1, J1, ze)]));          // south plane
      add(poly('rs', [P(I1, J0, ze), P(I1, J1, ze), b]));             // east hip
    } else {
      const im = (I0 + I1) / 2; a = P(im, J0 + h, zr); b = P(im, J1 - h, zr);
      add(poly('rm', [P(I0, J0, ze), P(I1, J0, ze), a]));             // north hip
      add(poly('rl', [P(I0, J0, ze), a, b, P(I0, J1, ze)]));          // west plane
      add(poly('rs', [P(I1, J0, ze), P(I1, J1, ze), b, a]));          // east plane
      add(poly('rl', [P(I0, J1, ze), b, P(I1, J1, ze)]));             // south hip
    }
    // ridge cap and the two front hip lines: the roof reads as tiles over a frame, not a flat sheet
    const pt = q => join([n(q[0]), n(q[1])]), fl = P(I0, J1, ze), fr = P(I1, J1, ze);
    add(`<path class="rg" d="M${pt(fl)}L${pt(alongI ? a : b)}${alongI ? `L${pt(b)}` : ''}L${pt(fr)}${alongI ? '' : `M${pt(b)}L${pt(a)}`}"/>`);
    ridge(alongI ? [fl, a, b, fr] : [fl, b, fr], alongI ? null : [b, a]);
  }
  const H = z => z * G.hx; // building heights: real metres -> display
  /** A flight descending toward +j: treads, the visible part of each riser, one stepped side.
   *  In 3D each step is a box down to the foot. */
  function stair(i0, i1, j0, dj, steps, zTop, zFoot) {
    if (MIR != null) [i0, i1] = [2 * MIR - i1, 2 * MIR - i0];
    const dz = (zTop - zFoot) / steps, z = k => zTop - dz * k, side = [P(i1, j0, zFoot)];
    for (let k = 0; k < steps; k++) note({ t: 'b', b: [i0, i1, j0 + k * dj, j0 + (k + 1) * dj, zFoot, z(k)], c: ['st', 'sr', 'ss'], d: [] });
    quiet++;
    for (let k = 0; k < steps; k++) add(poly('st', [P(i0, j0 + k * dj, z(k)), P(i1, j0 + k * dj, z(k)), P(i1, j0 + (k + 1) * dj, z(k)), P(i0, j0 + (k + 1) * dj, z(k))]));
    for (let k = 0; k < steps; k++) add(poly('sr', [P(i0, j0 + (k + 1) * dj, z(k)), P(i1, j0 + (k + 1) * dj, z(k)), P(i1, j0 + (k + 1) * dj, z(k + 1)), P(i0, j0 + (k + 1) * dj, z(k + 1))]));
    for (let k = 0; k < steps; k++) side.push(P(i1, j0 + k * dj, z(k)), P(i1, j0 + (k + 1) * dj, z(k)));
    side.push(P(i1, j0 + steps * dj, zFoot));
    add(poly('ss', side));
    quiet--;
  }
  /** A narrow flight hugging a terrace wall, descending toward +i (risers face right). */
  function stairI(i0, di, j0, j1, steps, zTop, zFoot) {
    if (MIR != null) i0 = 2 * MIR - i0 - steps * di;
    const dz = (zTop - zFoot) / steps, z = k => zTop - dz * k, side = [P(i0, j1, zFoot)];
    for (let k = 0; k < steps; k++) note({ t: 'b', b: [i0 + k * di, i0 + (k + 1) * di, j0, j1, zFoot, z(k)], c: ['st', 'sr', 'ss'], d: [] });
    quiet++;
    for (let k = 0; k < steps; k++) add(poly('st', [P(i0 + k * di, j0, z(k)), P(i0 + (k + 1) * di, j0, z(k)), P(i0 + (k + 1) * di, j1, z(k)), P(i0 + k * di, j1, z(k))]));
    for (let k = 0; k < steps; k++) { const x = i0 + (k + 1) * di; add(poly('ss', [P(x, j1, z(k)), P(x, j0, z(k)), P(x, j0, z(k + 1)), P(x, j1, z(k + 1))])); }
    for (let k = 0; k < steps; k++) side.push(P(i0 + k * di, j1, z(k)), P(i0 + (k + 1) * di, j1, z(k)));
    side.push(P(i0 + steps * di, j1, zFoot));
    add(poly('sr', side));
    quiet--;
  }
  const hall = (b, det, o = 1.4) => { box(b, ['ht', 'hl', 'hs'], det); hip(b.i0, b.i1, b.j0, b.j1, b.z1, o); };
  /** Upside-down ziggurat under a list of pads, faded by level. */
  function undersides(list) {
    for (let k = G.zigSteps; k >= 1; k--) {
      add(`<g class="u${k}">`);
      const steps = [];
      for (const b of list) {
        // the drop must beat the inset, or in true isometric each step hides inside the slab above it
        const small = b.z1 - b.z0 < 14, q = (small ? G.zigInset * 0.7 : G.zigInset) * k, dz = small ? G.zigDrop * 0.75 : G.zigDrop;
        if (b.i1 - b.i0 - 2 * q > 2 && b.j1 - b.j0 - 2 * q > 2) steps.push(B(b.i0 + q, b.i1 - q, b.j0 + q, b.j1 - q, b.z0 - dz * k, b.z0 - dz * (k - 1)));
      }
      for (const b of steps) box(b, [null, 'ie', null]); // same tone per level: one path for all left faces,
      for (const b of steps) box(b, [null, null, 'is']); // one for all right faces
      add('</g>');
    }
  }
  // the Tower's height mapping: shaft exaggerated, crown near true proportion
  const hi = 11.28, hj = 10.42; // Tower half plan, metres
  const TZ = z => z <= 66.3 ? z * G.tx : 66.3 * G.tx + (z - 66.3) * G.crown;

  // ================= sky: moon, stars, the halo behind the crown
  const [hx0, hy0] = P(0, 0, TZ(80)), ha = T.haloAlpha;
  const haloDefs = `<defs><radialGradient id="mvh-halo"><stop offset="0" stop-color="${T.halo}" stop-opacity="${ha}"/><stop offset=".45" stop-color="${T.halo}" stop-opacity="${n2(ha * .42)}"/><stop offset="1" stop-color="${T.halo}" stop-opacity="0"/></radialGradient></defs>`;
  add(`<circle class="moon" cx="${G.moon[0]}" cy="${G.moon[1]}" r="${G.moon[2]}"/>`);
  add(`<g class="stars"><circle cx="232" cy="30" r="1.2"/><circle cx="560" cy="44" r="1.1"/><circle cx="626" cy="150" r=".9"/><circle cx="84" cy="196" r=".8"/></g>`);
  layer('halo'); add(haloDefs);
  { const ry = Math.min(G.haloRy, hy0 - 2); grow(hx0 - G.haloRx, hy0 - ry); grow(hx0 + G.haloRx, hy0 + ry); }
  add(`<ellipse class="halo" cx="${n(hx0)}" cy="${n(hy0)}" rx="${G.haloRx}" ry="${n(Math.min(G.haloRy, hy0 - 2))}" fill="url(#mvh-halo)"/>`);

  // ================= islands: undersides first, as one upside-down ziggurat per pad
  const ZB = -G.slab, MALL = -9, PLAZA = -13;
  const [wi, wj, wz] = G.west, [ci, cj, cz] = G.city;
  const pads = {
    west: B(wi, wi + 24, wj, wj + 20, wz - 10, wz),     // West Campus: an apartment block and a live oak
    city: B(ci, ci + 26, cj, cj + 22, cz - 10, cz),     // downtown, far off and low
    battle: B(-82, -44, 8, 58, ZB, MALL),     // West Mall lawn: Battle Hall
    podium: B(-44, 44, -32, 44, ZB, 0),       // the Main Building's podium
    mall: B(-72, 30, 44, 80, ZB, MALL),       // Main Mall, Parlin on its west side
    batts: B(30, 60, 40, 66, ZB, MALL),       // Batts Hall
    garrison: B(44, 74, 8, 40, ZB, MALL),     // east lawn: Garrison Hall
    plaza: B(-17, 17, 84, 102, ZB, PLAZA),    // fountain plaza, one flight lower
  };

  layer('city'); undersides([pads.city]);
  // ---- islet: downtown, far off. Slim dark towers, a few lit windows, one stepped crown with a spire
  {
    box(pads.city, ['it', 'ie', 'is']);
    const lit = (w, z0, z1) => { const ys = []; for (let y = z0 + 3, r = 0; y + 1.3 <= z1 - 2; y += 3.4, r++) if (r % 2 === 0) ys.push(y); return grid(1, w - 1, Math.max(2, Math.round(w / 2.6)), 0.8, ys, 1.3, 3, null); };
    const tw = (i0, i1, j0, j1, h, w) => box(B(ci + i0, ci + i1, cj + j0, cj + j1, cz, cz + h), ['ft', 'fl', 'fs'], w ? { left: lit } : {});
    tw(2, 9, 2, 8, 22, 1);
    tw(14, 21, 1, 7, 19);
    // the spire tower: shaft, two setbacks, a needle
    const si = ci + 10, sj = cj + 9, sz = cz + 32;
    box(B(si - 4, si + 4, sj - 4, sj + 4, cz, sz), ['ft', 'fl', 'fs'], { left: lit, right: lit });
    box(B(si - 3, si + 3, sj - 3, sj + 3, sz, sz + 3.5), ['ft', 'fl', 'fs']);
    box(B(si - 1.8, si + 1.8, sj - 1.8, sj + 1.8, sz + 3.5, sz + 7), ['ft', 'fl', 'fs']);
    const [mx, my] = P(si, sj, sz + 7);
    add(R('mast', mx - 0.35, my - 10, 0.7, 10)); grow(mx, my - 10);
    tw(3, 11, 13, 20, 13);
    tw(16, 24, 11, 19, 16, 1);
  }
  layer('west'); undersides([pads.west]);
  // ---- islet: West Campus. A mid-rise apartment block with lit windows, its door facing campus
  {
    box(pads.west, ['it', 'ie', 'is']);
    box(B(wi + 1, wi + 23, wj + 1, wj + 19, wz, wz + 0.6), ['gt', 'gl', 'gs']);
    const win = (w, z0) => grid(1.2, w - 1.2, Math.round(w / 2.4), 1.2, [0, 1, 2, 3, 4].map(r => z0 + 3 + r * 3.1), 1.7, 3);
    const a0 = wi + 3, a1 = wi + 15, b0 = wj + 3, b1 = wj + 13, top = wz + 19;
    box(B(a0, a1, b0, b1, wz + 0.6, top), ['ht', 'hl', 'hs'], {
      left: win,
      right: (w, z0) => win(w, z0) + R('door', w / 2 - 1.1, z0, 2.2, 2.8), // the door faces campus
    });
    // a rooftop stair house and water tank: a flat-roofed apartment, not a villa
    box(B(a0 + 2, a0 + 6, b0 + 2, b0 + 5, top, top + 3), ['ht', 'hl', 'hs']);
    box(B(a1 - 4, a1 - 1.5, b1 - 4, b1 - 1.5, top, top + 2), ['ht', 'hl', 'hs']);
  }

  // ================= main island. Its rock first: in the stack the rock's layer is behind it.
  // ---- the iceberg: stepped rock under the pads, tapering to a tip, fading into the night.
  // Level 1 follows every pad; the deeper levels close in on one tip under the mall. In 3D each
  // ledge is one box with its lit lip as a band on its two front faces, faded as a group per level.
  const drawIce = pp => {
    const I = G.ice, all = [pp.battle, pp.podium, pp.mall, pp.batts, pp.garrison, pp.plaza], keys = ['battle', 'podium', 'mall', 'batts', 'garrison', 'plaza'];
    const mf = f => MIR == null ? f : [2 * MIR - f[1], 2 * MIR - f[0], f[2], f[3]];
    const lv = [];
    let z = I.z0;
    I.levels.forEach((L, k) => {
      const z1 = z, z0 = z - I.drops[k];
      // every footprint keeps a name for the model: the pad it hangs under, or its place in a merged level
      const feet = typeof L === 'number'
        ? all.map((b, n) => Object.assign([b.i0 + L, b.i1 - L, b.j0 + L, b.j1 - L], { tag: keys[n] })).filter(([a, b, c, d]) => b - a > 2 && d - c > 2)
        : L.map((f, n) => Object.assign(mf(f), { tag: L.length === 1 ? 'central' : ['battle', 'central', 'garrison'][n] }));
      lv.push({ z0, z1, feet, a: I.alpha[k] });
      z = z0;
    });
    // deepest first: each level is hidden behind the wider level above it
    for (let k = lv.length - 1; k >= 0; k--) {
      const { z0, z1, feet, a } = lv[k], lip = w => R('rib', 0, z1 - I.lip, w, I.lip);
      for (const f of feet) { const [i0, i1, j0, j1] = f; part = `ice:${k + 1}:${f.tag}`; note({ t: 'b', b: [i0, i1, j0, j1, z0, z1], c: ['rib', 'ril', 'ris'], d: [['L', lip(i1 - i0)], ['R', lip(j1 - j0)]], g: k + 1, a, h: 'T' }); }
      quiet++;
      add(`<g opacity="${a}">`);
      for (const [i0, i1, j0, j1] of feet) box(B(i0, i1, j0, j1, z0, z1), [null, 'ril', null]);
      for (const [i0, i1, j0, j1] of feet) box(B(i0, i1, j0, j1, z0, z1), [null, null, 'ris']);
      // a lit lip along the top of every ledge: the rock reads as layers, not a smooth cone
      for (const [i0, i1, j0, j1] of feet) box(B(i0, i1, j0, j1, z1 - I.lip, z1), [null, 'rib', 'rib']);
      add('</g>');
      quiet--;
    }
  };
  layer('ice'); drawIce(pads);

  layer('main'); if (G.mainZig !== false) undersides([pads.battle, pads.podium, pads.mall, pads.batts, pads.garrison, pads.plaza]);
  const lawn = m => (w, h) => R('gt', m, m, w - 2 * m, h - 2 * m);
  part = 'pad:battle'; box(pads.battle, ['pt', 'ie', 'is'], { top: lawn(3) });
  part = 'pad:podium'; box(pads.podium, ['pt', 'ie', 'is']);
  part = 'pad:garrison'; box(pads.garrison, ['pt', 'ie', 'is'], { top: lawn(3) });

  // ---- Battle Hall (Cass Gilbert): seven round-arched upper bays on the east front, facing the mall
  part = 'battle';
  hall(B(-76, -54, 18, 44, MALL, MALL + H(17.5)), {
    left: (w, z0) => arches('wo', row(2, w - 2, 4, 2.2, z0 + H(9), H(6.5))) + grid(2, w - 2, 4, 1.8, [z0 + H(2.5)], H(3.6)),
    right: (w, z0) => arches('wg', row(2, w - 2, 7, 2.2, z0 + H(8.6), H(7.4))) + grid(2, w - 2, 7, 1.6, [z0 + H(2.2)], H(3.8)) +
      R('door', w / 2 - 1.3, z0, 2.6, H(4.8)),
  }, 1.6);

  // ---- Main Building: west wing, middle, TOWER, east wing, south block, south pavilion + portico
  const EAVE = H(24.4), MID = H(20.2), EAVEP = H(26.2);
  const wingWin = w => grid(2, w - 2, Math.round(w / 4.4), 1.6, [H(2.4), H(9), H(14.5), H(19.6)], H(2.8), 3);
  // each wing's roof is two short hip segments with a flat valley between, not one long wedge
  const wing = (i0, i1, win) => { // the south block hides each wing's south wall: no eave shadow there
    box(B(i0, i1, -26, 18, 0, EAVE), ['rf', 'll', 'ls'], { right: win });
    if (G.wingSegs > 1) { hip(i0, i1, -26, -6, EAVE, 1, 31, 2); hip(i0, i1, -2, 18, EAVE, 1, 31, 2); } else hip(i0, i1, -26, 18, EAVE, 1.2, 31, 2);
  };
  part = 'mb:wingW'; wing(-38, -18, w => grid(2, w - 2, Math.round(w / 4.4), 1.6, [H(20.6)], H(2.4))); // only its top storey clears the middle block
  part = 'mb:mid'; box(B(-18, 18, -22, 18, 0, MID), ['rf', 'll', 'ls']);

  // ---------------- THE TOWER
  {
    const stage = (name, s, za, zb, cls, det, c3) => { part = 'tower:' + name; box(B(-hi * s, hi * s, -hj * s, hj * s, TZ(za), TZ(zb)), cls, det, c3); };
    // shaft: three recessed channels per face, dark glass alternating with gilt-bronze spandrels
    const chan = (glass, bronze) => w => {
      const cw = 2.5, pitch = 5.0, top = TZ(64.6), bot = TZ(3.5), fl = 3.46 * G.tx;
      const xs = [-1, 0, 1].map(k => w / 2 + k * pitch - cw / 2);
      const lamps = [];
      xs.forEach((x, k) => { for (let f = 0, y = bot + fl * 0.04; y < top - fl; y += fl, f++) if ((f * 7 + k * 3 + 2) % 13 === 0) lamps.push([x + 0.35, y + fl * 0.08, cw - 0.7, fl * 0.5]); });
      return rects(glass, xs.map(x => [x, bot, cw, top - bot])) +
        dashP(bronze, fl * 0.36, fl * 0.64, cw, xs.map(x => [x + cw / 2, bot + fl * 0.62, top - bot - fl * 0.62]), true) +
        rects('wg', lamps);
    };
    stage('shaft', 1, 0, 66.3, ['lt', 'll', 'ls'], { left: chan('gl2', 'sbz'), right: chan('gs2', 'sbs') });
    // bracketed cornice, projecting slightly: a row of dark bracket notches under its lip
    const brackets = (w, z0) => grid(0.6, w - 0.6, 11, 0.55, [z0], 1.1, 0, 'scn');
    stage('cornice', 1.026, 66.3, 70.1, ['ct', 'cl', 'cs'], { left: brackets, right: brackets });
    // clock stage, lit orange: a clock on every face
    const clock = w => {
      const cx = w / 2, cy = TZ(74.4);
      return `<circle class="bez" cx="${n(cx)}" cy="${n(cy)}" r="4.1"/><circle class="dial" cx="${n(cx)}" cy="${n(cy)}" r="2.9"/>` +
        rects('hand', [[cx - 0.22, cy, 0.44, 2.2], [cx, cy - 0.22, 1.6, 0.44]]);
    };
    stage('clock', 0.86, 70.1, 78.2, ['ot', 'ol', 'os'], { left: clock, right: clock });
    // the observation deck on the clock stage: back balustrade, belfry, front balustrade
    const s86 = 0.86, dz0 = TZ(78.2), dz1 = TZ(78.2) + TZ(79.7) - TZ(78.2);
    const A = hi * s86, Bj = hj * s86;
    part = 'tower:deck'; box(B(-A, A - 0.5, -Bj, -Bj + 0.5, dz0, dz1), ['ot', null, null], {}, ['ot', 'ot', 'ot']);
    box(B(-A, -A + 0.5, -Bj, Bj, dz0, dz1), ['ot', null, 'os'], {}, ['ot', 'ot', 'os']);
    // belfry: an OPEN colonnade. Per face: 2 square corner piers, then 4 slim Doric columns in
    // pairs (2+2) round a wide central void, the dark bell chamber showing through every gap.
    const colonnade = pier => (w, z0, z1) => {
      const k = w / 11.1, p1 = 1.3 * k, g = 1.0 * k, c = 0.62 * k, g2 = 0.28 * k, gc = w - 2 * p1 - 2 * g - 4 * c - 2 * g2;
      const xs = []; let x = 0;
      for (const [ww, gap] of [[p1, g], [c, g2], [c, gc], [c, g2], [c, g], [p1, 0]]) { xs.push([x, z0, ww, z1 - z0]); x += ww + gap; }
      // a solid sill under the openings, so the columns stand on something
      return rects(pier, xs) + R(pier, 0, z0, w, 0.9);
    };
    stage('belfry', 0.49, 79.2, 89.4, [null, 'bell', 'bell'], { left: colonnade('ol'), right: colonnade('os') });
    const bal = (w, z0, z1) => grid(0.8, w - 0.8, 12, 0.45, [z0 + 0.25], z1 - z0 - 0.7);
    part = 'tower:deck'; box(B(-A, A, Bj - 0.5, Bj, dz0, dz1), ['ot', 'ol', null], { left: bal }, ['ot', 'ol', 'ot']);
    box(B(A - 0.5, A, -Bj, Bj, dz0, dz1), ['ot', null, 'os'], { right: bal }, ['ot', 'ot', 'os']);
    // entablature with gilt garland cartouches, then the temple-like stepped cap
    const cart = (w, z0, z1) => grid(0.6, w - 0.6, 4, 0.7, [z0 + (z1 - z0) * 0.3], (z1 - z0) * 0.4, 0, 'sgd');
    stage('ent', 0.52, 89.4, 90.7, ['ot', 'ol', 'os'], { left: cart, right: cart });
    stage('step1', 0.45, 90.7, 92.4, ['ot', 'ol', 'os']);
    stage('step2', 0.36, 92.4, 94.0, [null, 'ol', 'os']);
    // verdigris copper roof: a low pyramid on the top step, and the steel mast
    const a = hi * 0.36 + 0.3, b = hj * 0.36 + 0.3, z = TZ(94.0), top = P(0, 0, TZ(96.2));
    add(poly('kt', [P(-a, -b, z), P(a, -b, z), top]));
    add(poly('kt', [P(-a, -b, z), top, P(-a, b, z)]));
    add(poly('kl', [P(-a, b, z), top, P(a, b, z)]));
    add(poly('ks', [P(a, -b, z), P(a, b, z), top]));
    const mast = R('mast', top[0] - 0.45, top[1] - 9, 0.9, 9);
    add(mast); note({ t: 's', a: top.w, s: mast }); grow(top[0], top[1] - 9);
  }

  // east wing, in front of the Tower's lower right
  part = 'mb:wingE';
  wing(18, 38, wingWin);

  // south block: arcade storey, piano nobile, entablature + balustrade, attic
  const trim = w => rects('trim', [[0, H(17.2), w, H(0.8)], [0, H(20.0), w, H(0.5)]]);
  // four bays on each side of the pavilion (the front's 13 bays at a 5.85 m pitch, minus the middle 5)
  const southFace = east => (w, z0) => {
    const a1 = [], a2 = [], a3 = [];
    for (let k = 0; k < 4; k++) {
      const cx = east ? w - 2.9 - 5.85 * k : 2.9 + 5.85 * k;
      a1.push([cx - 1.1, z0 + H(1.6), 2.2, H(4)]);
      a2.push([cx - 1.1, z0 + H(8.6), 2.2, H(7.4)]);
      a3.push([cx - 0.9, z0 + H(20.4), 1.8, H(2.2)]);
    }
    return arches('wo', a1) + arches('wg', a2) + rects('wo', a3) + trim(w);
  };
  part = 'mb:southW'; box(B(-38, -12, 18, 40, 0, EAVE), ['rf', 'll', null], { left: southFace(0) }); // west half; the pavilion hides its east end
  // South block roof: ONE long hip whose middle is taken by the pavilion's cross-hip, so the front
  // reads as a single building with a central portico, but no roof plane runs the whole length.
  const TP = Math.tan(31 * Math.PI / 180) * G.hx, fz = 0.9 * G.hx, sEave = EAVE - fz;
  const SI0 = -39.2, SI1 = 39.2, SJ0 = 16.8, SJ1 = 41.2, sh = (SJ1 - SJ0) / 2, sjm = SJ0 + sh, szr = EAVE + sh * TP;
  const PI1 = 13.2, vj = SJ1 - (EAVEP - EAVE) / TP, vi = PI1 - (szr - EAVEP) / TP; // east valley: pavilion eave -> south ridge
  const shadow = (i0, i1, j1) => add(poly('esh', [P(i0, j1, sEave), P(i1, j1, sEave), P(i1, j1, sEave - 1.6), P(i0, j1, sEave - 1.6)]));
  const pt = q => join([n(q[0]), n(q[1])]);
  // west half (drawn before the pavilion, which hides whatever of it lies inside the pavilion)
  shadow(-38, -12, 40);
  add(poly('rm', [P(SI0, SJ1, EAVE), P(0, SJ1, EAVE), P(0, SJ1, sEave), P(SI0, SJ1, sEave)]));
  add(poly('rm', [P(SI0, SJ0, EAVE), P(0, SJ0, EAVE), P(0, sjm, szr), P(SI0 + sh, sjm, szr)]));
  add(poly('rl', [P(SI0, SJ0, EAVE), P(SI0 + sh, sjm, szr), P(SI0, SJ1, EAVE)]));
  add(poly('rl', [P(SI0, SJ1, EAVE), P(SI0 + sh, sjm, szr), P(0, sjm, szr), P(0, SJ1, EAVE)]));
  add(`<path class="rg" d="M${pt(P(SI0, SJ1, EAVE))}L${pt(P(SI0 + sh, sjm, szr))}L${pt(P(-vi, sjm, szr))}"/>`);
  ridge([P(SI0, SJ1, EAVE), P(SI0 + sh, sjm, szr), P(-vi, sjm, szr)]);
  // south pavilion: the portico's three stacked rows of 7 (open arches, tall windows on a rail,
  // attic windows) under its own short hip roof, ridge running north-south
  part = 'mb:pav'; box(B(-12, 12, 14, 43, 0, EAVEP), ['rf', 'll', 'ls'], {
    left: (w, z0) => {
      const ar = row(0.8, w - 0.8, 7, 2.4, z0, H(6.2));
      return arches('ao', ar) + arches('ag', ar.map(([x, y, ww, hh]) => [x + 0.45, y, ww - 0.9, hh - 0.7])) +
        grid(0.8, w - 0.8, 7, 1.7, [z0 + H(8.4)], H(7.6), 0, 'sg') + R('rail', 0.6, H(8.4), w - 1.2, H(0.45)) +
        grid(0.8, w - 0.8, 7, 1.4, [z0 + H(20.9)], H(2.6)) + trim(w) + grid(0.6, w - 0.6, 14, 0.4, [H(18.1)], H(1.5));
    },
  });
  hip(-12, 12, 14, 43, EAVEP);
  // east half (drawn after the pavilion, so it hides the pavilion's east wall behind it); its roof
  // stops at the valley where it meets the pavilion roof
  part = 'mb:southE'; box(B(12, 38, 18, 40, 0, EAVE), ['rf', 'll', 'ls'], { left: southFace(1) });
  shadow(12, 38, 40);
  add(poly('esh', [P(38, 40, sEave), P(38, 18, sEave), P(38, 18, sEave - 1.6), P(38, 40, sEave - 1.6)]));
  add(poly('rm', [P(PI1, SJ1, EAVE), P(SI1, SJ1, EAVE), P(SI1, SJ1, sEave), P(PI1, SJ1, sEave)]));
  add(poly('rs', [P(SI1, SJ1, EAVE), P(SI1, SJ0, EAVE), P(SI1, SJ0, sEave), P(SI1, SJ1, sEave)]));
  add(poly('rm', [P(PI1, SJ0, EAVE), P(SI1, SJ0, EAVE), P(SI1 - sh, sjm, szr), P(vi, sjm, szr), P(PI1, 2 * sjm - vj, EAVEP)]));
  add(poly('rl', [P(PI1, SJ1, EAVE), P(SI1, SJ1, EAVE), P(SI1 - sh, sjm, szr), P(vi, sjm, szr), P(PI1, vj, EAVEP)]));
  add(poly('rs', [P(SI1, SJ0, EAVE), P(SI1, SJ1, EAVE), P(SI1 - sh, sjm, szr)]));
  add(`<path class="rg" d="M${pt(P(vi, sjm, szr))}L${pt(P(SI1 - sh, sjm, szr))}L${pt(P(SI1, SJ1, EAVE))}"/>`);
  ridge([P(vi, sjm, szr), P(SI1 - sh, sjm, szr), P(SI1, SJ1, EAVE)]);

  // ---- the two terraces' balustrades and the monumental stair between them
  const podiumBal = (w, z0, z1) => grid(0.8, w - 0.8, Math.round(w / 1.7), 0.5, [z1 - 1.7], 1.2);
  part = 'bal'; box(B(-44, -12, 43.3, 44, 0, 1.6), ['pt', 'll', null], { left: podiumBal }, ['pt', 'll', 'pt']);
  part = 'pad:mall'; box(pads.mall, ['pt', 'ie', 'is'], {
    top: (w, h) => R('gt', 31, 16, 25, h - 20) + R('gt', w - 28, 16, 25, h - 20) + R('gt', 2, 2, 26, h - 4),
  });
  part = 'stairI'; stairI(-40, 3, 44, 47.5, 7, 0, MALL); // Monument Valley hint: a flight that wraps the west terrace wall
  part = 'stair'; stair(-12, 12, 44, 2, 7, 0, MALL);
  part = 'bal'; box(B(12, 44, 43.3, 44, 0, 1.6), ['pt', 'll', null], { left: podiumBal }, ['pt', 'll', 'pt']);

  // ---- Parlin Hall: the first of the Six Pack, its narrow end to the mall
  part = 'parlin';
  hall(B(-70, -48, 58, 72, MALL, MALL + H(19.8)), {
    left: (w, z0) => grid(1.5, w - 1.5, 6, 1.5, [z0 + H(2.2), z0 + H(8.2), z0 + H(14)], H(3.4), 4),
    right: (w, z0) => arches('wg', row(1.5, w - 1.5, 3, 2.2, z0 + H(2), H(5))) + grid(1.5, w - 1.5, 3, 1.5, [z0 + H(9), z0 + H(14)], H(3.4)),
  });

  // ---- Batts Hall across the mall: three tall windows on an iron Juliet rail
  part = 'pad:batts'; box(pads.batts, ['pt', 'ie', 'is'], { top: lawn(3) });
  part = 'batts';
  hall(B(38, 56, 48, 60, MALL, MALL + H(20.5)), {
    left: (w, z0) => grid(1.5, w - 1.5, 5, 1.5, [z0 + H(2.2), z0 + H(8.4), z0 + H(14.2)], H(3.6), 3),
    right: (w, z0) => grid(1.5, w - 1.5, 3, 1.8, [z0 + H(7.5)], H(6.8), 0, 'sg') + R('rail', 1, z0 + H(7.5), w - 2, H(0.4)) + grid(1.5, w - 1.5, 3, 1.5, [z0 + H(2.2), z0 + H(15.6)], H(3)),
  });

  // ---- Garrison Hall: low, three round arches, red-tile hip roof
  part = 'garrison';
  hall(B(50, 70, 14, 34, MALL, MALL + H(12.9)), {
    left: (w, z0) => arches('wg', row(3, w - 3, 3, 3.0, z0 + H(1), H(7.4))) + grid(1, w - 1, 6, 1.4, [z0 + H(10)], H(1.6)),
    right: (w, z0) => grid(1.5, w - 1.5, 5, 1.5, [z0 + H(2), z0 + H(7.2)], H(3.4), 3),
  });

  // ---- four steps down to the fountain plaza, then the plaza
  part = 'stairP'; stair(-17, 17, 80, 1, 4, MALL, PLAZA);
  part = 'pad:plaza'; box(pads.plaza, ['pt', 'ie', 'is']);

  // ---- the walking route: gold dots from the fountain, up the steps, along the mall, up the
  // grand stair to the Main Building door. Three interleaved sets, so a slow shimmer walks it.
  const FIG = 61.5; // where the figure stands on the route
  // it starts at the West Campus apartment door and heads for the islet's edge, toward campus
  const route = [[wi + 17.2, wj + 8, wz + 0.6], [wi + 20, wj + 8, wz + 0.6], [wi + 22.8, wj + 8, wz + 0.6], [0, 85.4, PLAZA], [0, 83.5, MALL - 3], [0, 81.5, MALL - 1]];
  for (let j = 78.4; j > FIG + 2.2; j -= G.dotGap) route.push([0, j, MALL]);
  route.push([0, 58.6, MALL]);
  for (let k = 6; k >= 0; k--) route.push([0, 45 + 2 * k, -9 * k / 7]);
  const sets = [[], [], []], wsets = [[], [], []], ON_WEST = 3; // the first three dots stand on the West Campus islet
  route.forEach(([i, j, z], k) => {
    layer(k < ON_WEST ? 'west' : 'main'); const [x, y] = P(i, j, z); (k < ON_WEST ? wsets : sets)[k % 3].push(`M${join([n(x), n(y - G.dot * 0.35)])}h0`);
    if (k >= ON_WEST) note({ t: 'd', a: [i, j, z], k: k % 3, par: 'on' });
  });
  layer('main');
  const routeG = ss => `<g class="route" stroke-width="${G.dot}">${ss.map((s, k) => `<path class="w${k}" d="${s.join('')}"/>`).join('')}</g>`;
  add(routeG(sets));
  layer('west'); add(routeG(wsets)); layer('main');

  // Littlefield Fountain: a limestone basin, water, a bronze group, one glint
  part = 'fountain';
  {
    const [cx, cy] = P(0, 93, PLAZA), r = 6.4, rx = r * Math.SQRT2 * CW, ry = r * Math.SQRT2 * CH, hgt = H(2.2) * U, by = cy - hgt;
    add(`<path class="ll" d="M${join([n(cx - rx), n(by)])}V${n(cy)}A${join([n(rx), n(ry)])} 0 0 0 ${join([n(cx + rx), n(cy)])}V${n(by)}z"/>`);
    add(`<ellipse class="lt" cx="${n(cx)}" cy="${n(by)}" rx="${n(rx)}" ry="${n(ry)}"/>`);
    add(`<ellipse class="water" cx="${n(cx)}" cy="${n(by)}" rx="${n(rx - 2)}" ry="${n(ry - 1.2)}"/>`);
    const bronze = `<path class="bronze" d="M${join([n(cx - 4.4), n(by + 0.6)])}l1 -2h6.8l1 2zM${join([n(cx - 0.8), n(by - 1.4)])}v-4.6l-2.3 -2.1 2.6 1 .5 -1.2 .5 1.2 2.6 -1 -2.3 2.1v4.6z"/>`;
    const glint = `<path class="glint" d="M${join([n(cx + 4.4), n(by - 2.4)])}l.7 1.8 1.8 .7 -1.8 .7 -.7 1.8 -.7 -1.8 -1.8 -.7 1.8 -.7z"/>`;
    add(bronze); add(glint);
    // in 3D: a drum with a limestone top, the water a flat ellipse on it, the bronze and glint sprites
    const top = [0, 93, PLAZA + H(2.2)];
    note({ t: 'c', c: ['ll', 'lt'], a: [0, 93, PLAZA], r, h: H(2.2), par: 'on' });
    note({ t: 'e', c: 'water', a: top, ra: n2((rx - 2) / (Math.SQRT2 * CW)), rb: n2((ry - 1.2) / (Math.SQRT2 * CH)), par: 'on' });
    note({ t: 's', a: top, s: bronze, par: 'on' });
    note({ t: 's', a: top, s: glint, par: 'on' });
  }


  // ---- the figure: on the route at the foot of the grand stair, looking up at the Tower, backpack on
  part = 'figure';
  {
    const [x, y] = P(0, FIG, MALL);
    const body = `<path class="fig" d="M${join([n(x - 1.8), n(y)])}v-6.6a1.8 1.8 0 0 1 3.6 0V${n(y)}z"/><circle class="fig" cx="${n(x + 0.6)}" cy="${n(y - 9.5)}" r="1.8"/>`;
    const pack = `<rect class="pack" x="${n(x - 2.5)}" y="${n(y - 7.5)}" width="3.1" height="4.2" rx=".9"/>`;
    add(`<ellipse class="shade" cx="${n(x + 0.9)}" cy="${n(y)}" rx="3.4" ry="1.2"/>`);
    add(body);
    add(pack);
    // its shadow is a flat ellipse on the mall, 0.9 units right of its feet
    note({ t: 'e', c: 'shade', a: [0.45 / CW, FIG - 0.45 / CW, MALL], ra: n2(3.4 / (Math.SQRT2 * CW)), rb: n2(1.2 / (Math.SQRT2 * CH)), par: 'on' });
    note({ t: 's', a: [0, FIG, MALL], s: body + pack, par: 'on' });
  }

  // ================= THE OTHER SIDE (B): the island turned over, West Campus apartments on its
  // mirrored pads and the same kind of rock under them. Drawn as SVG for reference (iceB, aptB)
  // and recorded for 3D. Generic on purpose: no one real building.
  const drawApt = pp => {
    const A = G.apt;
    const lawn2 = m => (w, h) => R('gt', m, m, w - 2 * m, h - 2 * m);
    // windows: rows every storey, a lit one every few (the pattern shifts row to row)
    const flats = (every = 3, pitch = 3.1, win = 1.6, wh = 1.9) => (w, z0, z1) => {
      const ys = []; for (let y = z0 + 2.2; y + wh < z1 - 1.2; y += pitch) ys.push(y);
      return grid(1.2, w - 1.2, Math.max(2, Math.round(w / 3)), win, ys, wh, every);
    };
    // balcony bands: one dark slab edge per storey, over the windows
    const bands = pitch => (w, z0, z1) => { const r = []; for (let y = z0 + pitch; y < z1 - 1.5; y += pitch) r.push([0, y, w, 0.5]); return rects('ab', r); };
    const withBands = (f, pitch) => (w, z0, z1) => f(w, z0, z1) + bands(pitch)(w, z0, z1);
    const flatRoof = (b, c = ['ar', null, null]) => { const k = part; part = k + '-roof'; box(B(b.i0, b.i1, b.j0, b.j1, b.z1, b.z1 + 1.1), [c[0], 'al', 'as']); part = k; };
    // the platform: the same pads as the campus side
    part = 'pad:battle'; box(pp.battle, ['pt', 'ie', 'is'], { top: lawn2(3) });
    part = 'pad:podium'; box(pp.podium, ['pt', 'ie', 'is']);
    part = 'pad:garrison'; box(pp.garrison, ['pt', 'ie', 'is'], { top: lawn2(3) });
    // brick mid-rise on the west lawn
    part = 'apt:west';
    { const b = Bx(-78, -52, 14, 50, MALL, MALL + H(A.west)); box(b, [null, 'bl', 'bs'], { left: flats(3), right: flats(4) }); flatRoof(b, ['ar']); part = 'apt:west-top'; box(Bx(-72, -66, 22, 28, b.z1 + 1.1, b.z1 + 4), ['al', 'al', 'as']); }
    // the tower: the one tall one on this side, balconies on both faces, a lit crown
    part = 'apt:tall';
    {
      const b = Bx(-22, 4, -26, -2, 0, H(A.tall));
      box(b, [null, 'al', 'as'], { left: withBands(flats(3), 3.1), right: withBands(flats(4), 3.1) });
      flatRoof(b);
      // setback crown: a glowing band, then a mechanical box and a water tank
      const c = Bx(-18, 0, -22, -6, b.z1 + 1.1, b.z1 + 5);
      part = 'apt:tall-crown'; box(c, ['ar', 'al', 'as'], { left: w => R('wg', 0.6, c.z0 + 1.2, w - 1.2, 1.3), right: w => R('ag', 0.6, c.z0 + 1.2, w - 1.2, 1.3) });
      part = 'apt:tall-mech'; box(Bx(-14, -6, -18, -12, c.z1, c.z1 + 3), ['ar', 'al', 'as']);
    }
    // the courtyard block in front of it: brick, six storeys
    part = 'apt:court';
    { const b = Bx(-40, -6, 6, 40, 0, H(A.mid)); box(b, [null, 'bl', 'bs'], { left: flats(3), right: flats(3) }); flatRoof(b); }
    // the east block: taller, light, with balconies
    part = 'apt:east';
    { const b = Bx(12, 40, -24, 16, 0, H(A.east)); box(b, [null, 'al', 'as'], { left: withBands(flats(4), 3.1), right: withBands(flats(3), 3.1) }); flatRoof(b); }
    // its low wing: shops under, a pool deck on top
    part = 'apt:wing';
    {
      const b = Bx(4, 40, 18, 40, 0, H(A.wing));
      box(b, [null, 'al', 'as'], { left: w => grid(1, w - 1, 9, 2.6, [b.z0 + 0.6], 2.4, 2, 'sd', 'sg') + flats(3)(w, b.z0 + 3.4, b.z1), right: flats(4) });
      part = 'apt:wing-deck'; box(B(b.i0, b.i1, b.j0, b.j1, b.z1, b.z1 + 0.8), ['pt', 'al', 'as'], { top: (w, h) => R('water', 6, 4, w - 16, h - 9) + R('glint', w - 8, 5, 2.4, 2.4) });
    }
    const podiumBal = (w, z0, z1) => grid(0.8, w - 0.8, Math.round(w / 1.7), 0.5, [z1 - 1.7], 1.2);
    part = 'bal'; box(Bx(-44, -12, 43.3, 44, 0, 1.6), ['pt', 'll', null], { left: podiumBal }, ['pt', 'll', 'pt']);
    part = 'pad:mall'; box(pp.mall, ['pt', 'ie', 'is'], {
      top: (w, h) => R('gt', 31, 16, 25, h - 20) + R('gt', w - 28, 16, 25, h - 20) + R('gt', 2, 2, 26, h - 4),
    });
    part = 'stairI'; stairI(-40, 3, 44, 47.5, 7, 0, MALL);
    part = 'stair'; stair(-12, 12, 44, 2, 7, 0, MALL);
    // townhouses on the mall's west side
    part = 'apt:row';
    { const b = Bx(-68, -48, 58, 74, MALL, MALL + H(A.row)); box(b, [null, 'bl', 'bs'], { left: flats(2, 3.3, 1.8, 2.2), right: (w, z0, z1) => flats(2, 3.3, 1.8, 2.2)(w, z0, z1) + R('door', w / 2 - 1.1, z0, 2.2, 2.8) }); flatRoof(b); }
    // leasing office and trees where Batts Hall stood
    part = 'pad:batts'; box(pp.batts, ['pt', 'ie', 'is'], { top: lawn2(3) });
    part = 'apt:office';
    { const b = Bx(38, 56, 48, 60, MALL, MALL + H(A.office)); box(b, [null, 'gl2', 'gs2'], { left: (w, z0) => grid(1, w - 1, 6, 2, [z0 + 0.8], 4.4, 2, null, 'sg') }); flatRoof(b); }
    // a small block where Garrison Hall stood
    part = 'apt:small';
    { const b = Bx(50, 70, 14, 34, MALL, MALL + H(A.small)); box(b, [null, 'bl', 'bs'], { left: flats(3), right: flats(2) }); flatRoof(b); }
    // round-crowned trees, placed on the lawns: trunk, then a crown of two tones
    const tree = (i, j, z, r = G.apt.tree) => {
      if (MIR != null) i = 2 * MIR - i;
      const [x, y] = P(i, j, z), h = 3.2 * U;
      const s = `<rect class="hs" x="${n(x - 0.35)}" y="${n(y - h)}" width=".7" height="${n(h)}"/>` +
        `<circle class="gl" cx="${n(x)}" cy="${n(y - h - r * 0.7)}" r="${n(r * U)}"/><circle class="gt" cx="${n(x - r * 0.3)}" cy="${n(y - h - r * 0.95)}" r="${n(r * U * 0.62)}"/>`;
      add(s); note({ t: 's', a: [i, j, z], s, par: 'on' });
      grow(x - r * U, y - h - r * 2);
    };
    part = 'tree';
    for (const [i, j] of A.trees) tree(i, j, MALL);
    // steps down, then the pool where the fountain was
    part = 'stairP'; stair(-17, 17, 80, 1, 4, MALL, PLAZA);
    part = 'pad:plaza'; box(pp.plaza, ['pt', 'ie', 'is'], { top: (w, h) => R('water', 4, 3, w - 8, h - 6) + R('glint', w - 9, 5, 2.2, 2.2) });
  };
  MIR = G.flip.i; lastBox = -1;
  const padsB = Object.fromEntries(Object.entries(pads).map(([k, b]) => [k, Bx(b.i0, b.i1, b.j0, b.j1, b.z0, b.z1)]));
  layer('iceB'); drawIce(padsB);
  layer('aptB'); drawApt(padsB);
  MIR = null; layer('main');
  // the pieces that stand on something: find the box under them
  for (const L of [M3.A, M3.B]) L.forEach(r => {
    if (r.par !== 'on') return;
    const [i, j, z] = r.a; let best = -1, bz = -1e9;
    L.forEach((b, k) => { if (b.t !== 'b') return; const [i0, i1, j0, j1, , z1] = b.b; if (i >= i0 - 1e-6 && i <= i1 + 1e-6 && j >= j0 - 1e-6 && j <= j1 + 1e-6 && z1 <= z + 0.05 && z1 > bz) { bz = z1; best = k; } });
    r.par = best;
  });

  // ================= stylesheet: every colour and timing is a named variable
  // ---- each moving layer's box in art units [x, y, w, h], with a margin for strokes
  const cut = ([x0, y0, x1, y1], m = 3) => [Math.floor(x0 - m), Math.floor(y0 - m), Math.ceil(x1 + m) - Math.floor(x0 - m), Math.ceil(y1 + m) - Math.floor(y0 - m)];
  // the West Campus islet turns (see the turning script), so its layer covers the whole sweep:
  // every corner swung round the islet's centre, from the underside's tip to the rooftop
  {
    cur = 'west'; // before any P() below, or the islet's centre grows the main island's box
    const b = pads.west, ci = (b.i0 + b.i1) / 2, cj = (b.j0 + b.j1) / 2, r = Math.hypot(b.i1 - ci, b.j1 - cj) * Math.SQRT2;
    const [cx] = P(ci, cj, 0), yTop = P(ci, cj, wz + 22)[1], yBot = P(ci, cj, b.z0 - 2 * G.zigDrop * 0.75)[1];
    grow(cx - r * CW, yTop - r * CH); grow(cx + r * CW, yBot + r * CH);
  }
  const BOX = { halo: cut(bounds.halo), city: cut(bounds.city), west: cut(bounds.west), main: cut(bounds.main), ice: cut(bounds.ice) };
  const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  const vars = Object.entries(T).map(([k, v]) => `--${kebab(k)}:${v}`).join(';');
  const fill = {
    'roof-flat': 'rf', 'lime-top': 'lt', 'lime-lit': 'll', 'lime-shade': 'ls', 'crown-top': 'ct trim', 'crown-lit': 'cl', 'crown-shade': 'cs',
    'win-top': 'ot', 'win-lit': 'ol', 'win-shade': 'os', 'copper-top': 'kt', 'copper-lit': 'kl', 'copper-shade': 'ks',
    'tile-lit': 'rl', 'tile-mid': 'rm', 'tile-shade': 'rs', 'hall-top': 'ht', 'hall-lit': 'hl', 'hall-shade': 'hs',
    'far-top': 'ft', 'far-lit': 'fl', 'far-shade': 'fs',
    opening: 'wo', 'opening-deep': 'ao', glow: 'wg ag', door: 'door', 'glass-lit': 'gl2', 'glass-shade': 'gs2',
    bezel: 'bez', clock: 'dial', hands: 'hand rail bronze', bell: 'bell', mast: 'mast',
    'island-top': 'it', 'island-edge': 'ie', 'island-side': 'is', 'pave-top': 'pt st', riser: 'sr', 'riser-shade': 'ss',
    'lawn-top': 'gt', 'lawn-lit': 'gl', 'lawn-shade': 'gs', water: 'water', glint: 'glint', figure: 'fig', pack: 'pack', shadow: 'shade esh',
    'rock-lit': 'ril', 'rock-shade': 'ris', 'rock-band': 'rib', 'apt-lit': 'al', 'apt-shade': 'as', 'apt-roof': 'ar', 'apt-band': 'ab', 'brick-lit': 'bl', 'brick-shade': 'bs',
  };
  const stroke = { opening: 'so', 'opening-deep': 'sd', glow: 'sg', 'bronze-lit': 'sbz', 'bronze-shade': 'sbs', 'crown-shade': 'scn', bezel: 'sgd', 'tile-ridge': 'rg', accent: 'route' };
  const sel = s => s.split(' ').map(c => `.mvh .${c}`).join(',');
  const css = `.mvh{${vars}}` +
    Object.entries(fill).map(([v, c]) => `${sel(c)}{fill:var(--${v})}`).join('') +
    Object.entries(stroke).map(([v, c]) => `${sel(c)}{stroke:var(--${v})}`).join('') +
    `.mvh [stroke-dasharray],.mvh .rg,.mvh .route{fill:none}.mvh .rg{stroke-width:.6;stroke-linejoin:round}.mvh .route{stroke-linecap:round}` +
    `.mvh .moon{fill:var(--moon);opacity:var(--moon-alpha)}.mvh .stars{fill:var(--star);opacity:var(--star-alpha)}.mvh .shade{opacity:.55}.mvh .esh{opacity:var(--eave-alpha)}` +
    `.mvh .u1{opacity:.7}.mvh .u2{opacity:.32}.mvh .u3{opacity:.14}` +
    `.mvh .glint{animation:mvh-blink var(--glint-blink) ease-in-out infinite}` +
    `.mvh .stars circle:nth-child(2n){animation:mvh-blink var(--star-twinkle) ease-in-out infinite}` +
    `.mvh .route path{animation:mvh-walk var(--route-walk) ease-in-out infinite}.mvh .route .w1{animation-delay:calc(var(--route-walk)/-1.5)}.mvh .route .w2{animation-delay:calc(var(--route-walk)/-3)}` +
    `@keyframes mvh-breathe{50%{opacity:.72}}@keyframes mvh-blink{50%{opacity:.25}}@keyframes mvh-walk{50%{opacity:.45}}` +
    // the layer stack: every layer is the full art box, stacked in paint order
    `.mvh-stack{position:relative;aspect-ratio:680/340;margin-top:4px}.mvh-stack>div{position:absolute;inset:0}` +
    `.mvh-stack svg.mvh{position:absolute;inset:0;width:100%;height:100%;margin:0;display:block}` +
    `.mvh-turn{position:absolute;inset:0;width:100%;height:100%;visibility:hidden}.mvh-west.turning>svg{visibility:hidden}.mvh-west.turning>.mvh-turn{visibility:visible}` +
    // each moving layer floats by its own island's settings; the halo rides with the main island
    Object.entries(BOX).map(([k, [, , , h]]) => { const f = F[k === 'halo' || k === 'ice' ? 'main' : k];
      return `@keyframes mvh-bob-${k}{to{transform:translateY(${(-f.lift / h * 100).toFixed(2)}%)}}` +
        `.mvh-${k}{animation:mvh-bob-${k} ${f.rise}s ease-in-out ${f.delay}s infinite alternate${k === 'halo' ? ',mvh-breathe var(--halo-breath) ease-in-out infinite' : ''}}`; }).join('') +
    `@media (prefers-reduced-motion:reduce){.mvh-stack,.mvh-stack *{animation:none!important}}`;
  // for js/loader.js: the raw layers and their boxes; the loader builds the stack and its CSS itself
  if (PARTS === 'model') return { A: M3.A, B: M3.B, ref: { iceB: layers.iceB.join(''), aptB: layers.aptB.join('') } };
  if (PARTS) return { layers: Object.fromEntries(Object.entries(layers).filter(([k]) => !REC[k] || REC[k] === 'A').map(([k, v]) => [k, v.join('')])), BOX };
  const pct = v => +v.toFixed(3) + '%';
  const at = ([x, y, w, h]) => ` style="left:${pct(x / 6.8)};top:${pct(y / 3.4)};width:${pct(w / 6.8)};height:${pct(h / 3.4)}"`;
  const svg = (k, body, extra = '', box) => `<svg xmlns="http://www.w3.org/2000/svg" class="mvh mvh-${k}" viewBox="${box && k !== 'westart' ? box.join(' ') : box ? box.join(' ') : '0 0 680 340'}"${box && k !== 'westart' ? at(box) : ''} aria-hidden="true">${extra}${body.join('')}</svg>`;
  const aria = 'The UT Tower lit orange over the Main Building and the South Mall, a gold path from the fountain to its door, with West Campus apartments and downtown floating nearby';
  return `<div class="mvh-stack" role="img" aria-label="${aria}">${svg('sky', layers.sky, `<style>${css}</style>`)}${svg('halo', layers.halo, '', BOX.halo)}${svg('city', layers.city, '', BOX.city)}` +
    `<div class="mvh-west"${at(BOX.west)}>${svg('westart', layers.west, '', BOX.west)}</div>${svg('main', layers.main, '', BOX.main)}</div>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = process.argv[2];
  if (!dest) { console.error('usage: node island-gen.mjs <out.html>'); process.exit(1); }
  const svg = heroArt();
  fs.writeFileSync(dest, svg);
  console.log(dest, svg.length, 'bytes');
}
