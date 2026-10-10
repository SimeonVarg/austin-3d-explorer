/**
 * lib/layout.mjs - the cell tiler's WALL RULE for the skins Facet takes, re-written from the rules (not copied), in the generator's own units.
 *   accepts()   which capabilities a recipe skin on a band needs, and which of them are in `caps`: the reasons Facet refuses a piece
 *   windowsOf() the windows (rectangles and their frame/head/accent/spandrel/mullion) js/slopes-apartments.js windowsFromBays cuts on a piece
 *   toneAt()    the tone name the cell tiler paints at a point (s, z) of a piece: windows, then frame/spandrel/head/accent regions, then floor lines,
 *               strips, the field. This is the POINT ORACLE: node/verify-pieces.mjs compares it with the cells the real generator emitted.
 *   regimes()   a floor list as at most MAXREG runs of evenly spaced floors (what a shader can hold)
 * A piece = { len, z0, z1, floors (the band's floor lines), floorBelow, allFloors } = the generator's `ctx`.
 */
export const CAPS = ['floors', 'frame', 'offsets', 'head', 'accent', 'spandrel', 'cols', 'mullion', 'checker'];
export const MAXREG = 3;

const WINDOW_NEVER = ['arch', 'flip'];                       // not expressible: round heads, the weave that swaps hands
const SKIN_NEVER = ['louvre', 'pier', 'fields', 'bands', 'windowSkip', 'facets', 'fins'];
export function accepts(sk, band, piece, caps = new Set(CAPS)) {
  const need = new Set(), never = [];
  if (!sk) return { ok: false, never: ['no skin'], need };
  if (sk.kind !== 'bays' && sk.kind !== 'flat') never.push('kind ' + sk.kind);
  for (const k of SKIN_NEVER) if (sk[k]) never.push(k);
  if (band && (band.openings && band.openings.length)) never.push('band openings');
  if (band && band.balconies && band.balconies.some(b => b.inset > 0)) never.push('inset balcony');
  if (band && band.inset > 0 && typeof band.inset !== 'number') never.push('inset spec');
  const w = sk.window;
  if (w) {
    for (const k of WINDOW_NEVER) if (w[k]) never.push('window ' + k);
    if (w.minDetail) never.push('minDetail');
    if (w.frame && w.frame.w > 0) need.add('frame');
    if (w.offsets) need.add('offsets');
    if (w.head) need.add('head');
    if (w.accent) need.add('accent');
    if (w.spandrel) need.add('spandrel');
    if (w.cols) need.add('cols');
    if (w.mullion) need.add('mullion');
    if (sk.windowRule === 'checker') need.add('checker');
    if (w.frame && w.frame.minDetail) never.push('frame minDetail');
  }
  if (piece && w) {
    const fl = windowRowFloors(sk, piece);
    if (!regimes(fl)) need.add('floors');
  }
  if (piece && sk.floorLine && sk.kind === 'bays') { if (!regimes(piece.floors)) need.add('floors'); }
  const missing = [...need].filter(c => !caps.has(c));
  return { ok: never.length === 0 && missing.length === 0, never, need, missing };
}

/** the floors that carry a window row (the generator drops a row whose top is above the band, keeps the floor just below the band) */
export function windowRowFloors(sk, piece) {
  const w = sk.window; if (!w) return [];
  const floors = piece.floorBelow != null ? [piece.floorBelow].concat(piece.floors) : piece.floors;
  const sill = w.sill != null ? w.sill : 0.8, h = w.h || 2.0;
  return floors.filter(fz => fz + sill + h <= piece.z1 + 1e-6);
}
/** floor list -> runs of evenly spaced floors, or null when more than MAXREG are needed */
export function regimes(list) {
  const out = [];
  for (let i = 0; i < list.length;) {
    if (i === list.length - 1) { out.push({ first: list[i], pitch: 1, count: 1 }); break; }
    const p = list[i + 1] - list[i]; let j = i + 1;
    while (j + 1 < list.length && Math.abs(list[j + 1] - list[j] - p) < 1e-4) j++;
    out.push({ first: list[i], pitch: p, count: j - i + 1 }); i = j + 1;
    if (out.length > MAXREG) return null;
  }
  return out.length <= MAXREG ? out : null;
}

export function windowsOf(sk, piece, hashFn = null) {
  const w = sk.window, out = []; if (!w) return out;
  const len = piece.len, floors = piece.floorBelow != null ? [piece.floorBelow].concat(piece.floors) : piece.floors;
  let centres;
  if (w.cols) centres = w.cols.map(f => f * len);
  else { const bay = sk.bay || 3.0, n = Math.max(1, Math.round(len / bay)), mod = len / n; centres = []; for (let i = 0; i < n; i++) centres.push((i + 0.5) * mod); }
  const parts = Array.isArray(w.offsets) && w.offsets.length ? w.offsets : [[0, w.w || 1.5]];
  const frame = w.frame && w.frame.w > 0 ? w.frame : null;
  const spandrel = w.spandrel && w.spandrel.h > 0 ? w.spandrel : null;
  for (let fi = 0; fi < floors.length; fi++) {
    const fz = floors[fi], zb = fz + (w.sill != null ? w.sill : 0.8), zt = zb + (w.h || 2.0);
    if (zt > piece.z1 + 1e-6) continue;
    const storey = piece.allFloors ? piece.allFloors.indexOf(fz) : fi;
    for (let ci = 0; ci < centres.length; ci++) {
      if (sk.windowRule === 'checker' && ((ci + storey) & 1)) continue;
      for (let pi = 0; pi < parts.length; pi++) {
        const cx = centres[ci] + parts[pi][0], ww = parts[pi][1], s0 = cx - ww / 2, s1 = cx + ww / 2;
        if (s0 < 0.05 || s1 > len - 0.05) continue;
        const sp = parts[pi].length > 2 ? (parts[pi][2] && parts[pi][2].h > 0 ? parts[pi][2] : null) : spandrel;
        let accent = null;
        if (w.accent && w.accent.w > 0 && Array.isArray(w.accent.tones) && w.accent.tones.length) {
          const T = w.accent.tones, k = Math.floor((hashFn ? hashFn('accent', ci, storey) : 0) * T.length) % T.length;
          accent = Object.assign({}, w.accent, { tone: T[k] });
        }
        out.push({ s0, s1, z0: zb, z1: zt, frame, spandrel: sp, head: w.head || null, accent, mullion: w.mullion || null, tone: null });
      }
    }
  }
  return out;
}

/** the regions beside windows, in the generator's priority order (frames, spandrels, heads, accents), clipped to the piece like tileFace does */
export function regionsOf(windows, piece, tones) {
  const len = piece.len, z0 = piece.z0, z1 = piece.z1;
  const framed = windows.filter(w => w.frame).map(w => { const fw = w.frame.w, fh = w.frame.h != null ? w.frame.h : w.frame.w; return { s0: Math.max(0, w.s0 - fw), s1: Math.min(len, w.s1 + fw), z0: Math.max(z0, w.z0 - fh), z1: Math.min(z1, w.z1 + fh), tone: w.frame.tone }; });
  const spandrels = windows.filter(w => w.spandrel && w.z0 > z0 + 1e-6).map(w => { const fh = w.frame ? (w.frame.h != null ? w.frame.h : w.frame.w) : 0, zt = w.z0 - fh; return { s0: w.s0, s1: w.s1, z0: Math.max(z0, zt - w.spandrel.h), z1: zt, tone: w.spandrel.tone }; }).filter(r => r.z1 - r.z0 > 1e-4);
  const heads = windows.filter(w => w.head && w.head.h > 0 && w.z1 < z1 - 1e-6).map(w => { const fh = w.frame ? (w.frame.h != null ? w.frame.h : w.frame.w) : 0, zb = w.z1 + fh; return { s0: w.s0, s1: w.s1, z0: zb, z1: Math.min(z1, zb + w.head.h), tone: w.head.tone }; }).filter(r => r.z1 - r.z0 > 1e-4);
  const accents = windows.filter(w => w.accent && w.accent.w > 0).map(w => { const a = w.accent, left = (a.side || 'left') === 'left', sa = left ? w.s0 - (a.gap || 0) - a.w : w.s1 + (a.gap || 0), zt = w.z1 + (w.head && w.head.h > 0 ? w.head.h : 0) + (a.dz1 || 0); return { s0: Math.max(0, sa), s1: Math.min(len, sa + a.w), z0: Math.max(z0, w.z0 + (a.dz0 || 0)), z1: Math.min(z1, zt), tone: a.tone }; }).filter(r => r.s1 - r.s0 > 1e-4 && r.z1 - r.z0 > 1e-4);
  return framed.concat(spandrels, heads, accents);
}

/** the tone name painted at (s, z) of a piece: the point oracle of the cell tiler for a bays/flat skin */
export function toneAt(sk, piece, windows, regions, s, z) {
  for (const w of windows) if (s > w.s0 && s < w.s1 && z > w.z0 && z < w.z1) {
    if (w.mullion) { const m = w.mullion, mw = m.w || 0.08; for (const f of m.cols || [0.5]) { const x = w.s0 + f * (w.s1 - w.s0); if (Math.abs(s - x) < mw / 2) return m.tone || 'trim'; } for (const f of m.rows || []) { const zz = w.z0 + f * (w.z1 - w.z0); if (Math.abs(z - zz) < mw / 2) return m.tone || 'trim'; } }
    return sk.glass || 'glass';
  }
  for (const r of regions) if (s > r.s0 && s < r.s1 && z > r.z0 && z < r.z1) return r.tone;
  if (sk.kind === 'bays') {
    if (sk.floorLine) for (const f of piece.floors) if (z > f && z < f + sk.floorLine.h) return sk.floorLine.tone;
    if (sk.strip) {
      const n = Math.max(1, Math.round(piece.len / (sk.bay || 3.4))), mod = piece.len / n, sw = sk.strip.w || 0.6, every = sk.strip.every || 1;
      const at = sk.strip.at === 'centres' ? [...Array(n)].map((_, i) => (i + 0.5) * mod) : [...Array(n + 1)].map((_, i) => i * mod);
      for (let i = 0; i < at.length; i++) { if (i % every) continue; const s0 = Math.max(0, at[i] - sw / 2), s1 = Math.min(piece.len, at[i] + sw / 2); if (s1 > s0 && s > s0 && s < s1) return sk.strip.tone; }
    }
  }
  return sk.field || 'wall';
}
