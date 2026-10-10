/**
 * facet-walls.js - FACET: window walls drawn by the fragment shader instead of by cells. Loaded ONLY with ?facadeshader=1 (js/slopes-apartments.js
 * injects it; with the flag off nothing here is downloaded or run).
 *
 * WHAT IT DOES. The cell tiler (tileFace in js/slopes-apartments.js) cuts a wall into a quad per cell and four reveal strips per window: 2.1 M of the
 * city's 3.1 M triangles. For the wall pieces whose skin Facet can draw, the tiler is skipped and the piece becomes ONE quad. The window grid is read
 * from three small data textures and evaluated per pixel, box-filtered over the pixel's footprint in closed form (so it cannot moire), with the
 * window's recess done as an exact parallax shift. The pieces Facet cannot draw (storefronts, mod4, pixel, arches, openings, piers, louvres ...) stay
 * geometry. experiments/facet/ is the study: docs/graphics-basics-study-2026-10-10.md section 8.
 *
 * WHERE THE NUMBERS COME FROM. The window list comes from the generator's OWN resolved skin (skin.windows, after the band's openings), so the grid, the
 * floors, the frames, the lit/unlit rooms and the accent tones are exactly what the cells would have been drawn from; this file compresses that list
 * into rows x columns and a per-window table, and REFUSES (the piece stays geometry) when the list is not a grid or when its own point evaluator
 * disagrees with the generator's tone function at sampled points (a self-check that runs for every piece at build time).
 *
 * THE LOOK. The fragment code is spliced into the SAME material source the geometry uses (slopes.material()'s vertex and fragment shader text,
 * patched in memory), so lighting, sun shadows, night lamps, window glass reflections and surface detail run unchanged on a shader wall: the block
 * produces baseColor / albedo / night / surface and everything after it is the app's.
 *
 * Public: window.FACET = { on, collector() -> { take(rec) -> bool, finish(S) -> THREE.Mesh | null, stats } }: one collector per build.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(window.location.search);
  const TUNE = {                      // CLAUDE.md rule 11: every look value is here
    maxRows: 48, maxCols: 64, maxLines: 48,
    farWindows: [0.5, 1.2],           // a pixel footprint this many window periods wide: the exact grid fades to the piece's mean colour (2 px a window to 0.8)
    selfCheckPoints: 24, selfCheckTolerance: 0.02,   // share of sampled points that may disagree with the generator's tone function
    parallax: 1.0, aa: 1.0,
  };
  function newCollector() {
  const stats = { pieces: 0, taken: 0, refused: {}, trianglesSaved: 0, quads: 0, windows: 0, selfCheckRefused: 0, bytes: { fd: 0, wt: 0, ft: 0, geometry: 0 } };
  const REFUSE = r => { stats.refused[r] = (stats.refused[r] || 0) + 1; return false; };

  // ── packing state ────────────────────────────────────────────────────────
  const FDW = 2048;                   // data texture width (texels)
  const fd = [];                      // flat floats, 4 per texel
  const wt = [];                      // window table bytes, 4 per texel
  const toneIdx = new Map(), tones = [];   // key = day|gold|night|surface
  const geo = { pos: [], nrm: [], tan: [], uv: [], piece: [], idx: [] };
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  function toneId(P, name) {
    const t = P[name]; if (!t) return -1;
    const surf = t.surface || [0, 0, 0, 0];
    const key = t[0] + '|' + t[1] + '|' + t[2] + '|' + surf.join(',');
    let i = toneIdx.get(key);
    if (i === undefined) { i = tones.length; toneIdx.set(key, i); tones.push({ d: hex(t[0]), g: hex(t[1]), n: hex(t[2]), s: surf }); }
    return i;
  }
  const rgb8 = h => { const c = hex(h); return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]; };
  const ZR = 1e-4;

  // ── the piece: from the generator's resolved skin to a record ────────────
  function take(rec) {
    stats.pieces++;
    const { W, len, z0, z1, ctx, skin, sk, band, P, cut } = rec;
    if (cut) return REFUSE('cut');
    if (!sk || (sk.kind !== 'bays' && sk.kind !== 'flat')) return REFUSE('kind ' + (sk && sk.kind));
    for (const k of ['louvre', 'pier', 'fields', 'bands', 'windowSkip', 'facets', 'fins']) if (sk[k]) return REFUSE(k);
    if (skin.piers || skin.fins || skin.facets) return REFUSE('blades');
    if (band && band.openings && band.openings.length) return REFUSE('band openings');
    const wins = skin.windows || [];
    for (const w of wins) {
      if (w.arch) return REFUSE('arch');
      if (w.opening) return REFUSE('opening');
      if (w.tone) return REFUSE('window tone');
      if (w.reveal != null && w.reveal !== undefined && w.reveal !== rec.skinReveal) return REFUSE('window reveal');
      if (w.revealTone) return REFUSE('window revealTone');
    }
    // ---- the grid: rows (z0, z1) x columns (s0, s1), a presence/colour table ----
    const rowsMap = new Map(), colsMap = new Map();
    const key4 = x => Math.round(x * 1e4);
    for (const w of wins) { rowsMap.set(key4(w.z0) + '|' + key4(w.z1), [w.z0, w.z1]); colsMap.set(key4(w.s0) + '|' + key4(w.s1), [w.s0, w.s1]); }
    const rows = [...rowsMap.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cols = [...colsMap.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (rows.length > TUNE.maxRows) return REFUSE('rows');
    if (cols.length > TUNE.maxCols) return REFUSE('cols');
    for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][1] - 1e-6) return REFUSE('rows overlap');
    for (let i = 1; i < cols.length; i++) if (cols[i][0] < cols[i - 1][1] - 1e-6) return REFUSE('cols overlap');
    const rowOf = new Map(rows.map((r, i) => [key4(r[0]) + '|' + key4(r[1]), i])), colOf = new Map(cols.map((c, i) => [key4(c[0]) + '|' + key4(c[1]), i]));
    for (const w of wins) {
      const w0c = sk.window || {};
      if (!!w.frame !== !!(w0c.frame && w0c.frame.w > 0) || !!w.head !== !!w0c.head || !!w.mullion !== !!w0c.mullion || !!w.accent !== !!(w0c.accent && w0c.accent.w > 0 && Array.isArray(w0c.accent.tones) && w0c.accent.tones.length)) return REFUSE('window options differ from the skin');
    }
    // ---- tones ----
    const glassName = sk.glass || 'glass', glass = P[glassName] || P.glass;
    if (!glass) return REFUSE('no glass tone');
    const fieldName = sk.field || 'wall';
    const w0 = sk.window || {};
    const frame = w0.frame && w0.frame.w > 0 ? w0.frame : null, head = w0.head && w0.head.h > 0 ? w0.head : null, spandrel = w0.spandrel && w0.spandrel.h > 0 ? w0.spandrel : null;
    const accentSpec = w0.accent && w0.accent.w > 0 && Array.isArray(w0.accent.tones) && w0.accent.tones.length ? w0.accent : null;
    if (w0.offsets && w0.offsets.some(o => o.length > 2)) return REFUSE('per-offset spandrel');
    const mull = w0.mullion || null;
    if (mull && ((mull.cols || [0.5]).length > 4 || (mull.rows || []).length > 4)) return REFUSE('mullion count');
    if (wins.length && ((frame && !P[frame.tone]) || (head && !P[head.tone]) || (spandrel && !P[spandrel.tone]))) return REFUSE('region tone');
    const revealName = sk.frame && P[sk.frame] ? sk.frame : (P.frame ? 'frame' : glassName);
    const tid = n => toneId(P, n);
    const stripSpec = sk.kind === 'bays' && sk.strip ? sk.strip : null, lineSpec = sk.kind === 'bays' && sk.floorLine ? sk.floorLine : null;
    const lines = lineSpec ? ctx.floors.slice() : [];
    if (lines.length > TUNE.maxLines) return REFUSE('floor lines');
    if (!P[fieldName]) return REFUSE('no field tone');
    if ((stripSpec && !P[stripSpec.tone]) || (lineSpec && !P[lineSpec.tone])) return REFUSE('layer tone');
    const accTones = accentSpec ? accentSpec.tones.map(t => P[t] ? tid(t) : -1) : [];
    if (accTones.some(t => t < 0)) return REFUSE('accent tone');
    if (accTones.length > 4) return REFUSE('accent tones');
    // strips as a pulse train (closed form): joints or centres, every n-th
    let strip = [0, 0, 0, 0, 0, 0];  // [on, P, a, b, i1, shift]
    if (stripSpec) {
      const bay = sk.bay || 3.4, n = Math.max(1, Math.round(len / bay)), mod = len / n, sw = stripSpec.w || 0.6, every = stripSpec.every || 1;
      strip = stripSpec.at === 'centres' ? [1, every * mod, 0.5 * mod - sw / 2, 0.5 * mod + sw / 2, Math.ceil(n / every), 0] : [1, every * mod, 0, sw, Math.floor(n / every) + 1, sw / 2];
    }
    // ---- the per-window table: presence, accent index, night colour of the glass ----
    const ncols = cols.length, nrows = rows.length, tableBase = wt.length / 4;
    const cell = new Array(nrows * ncols).fill(null);
    const nightHexOf = rec.windowNight;
    for (const w of wins) {
      const r = rowOf.get(key4(w.z0) + '|' + key4(w.z1)), c = colOf.get(key4(w.s0) + '|' + key4(w.s1));
      if (cell[r * ncols + c]) return REFUSE('two windows in one cell');
      const night = rgb8(nightHexOf(w, glass));
      let acc = 0; if (w.accent && accentSpec) { const k = accentSpec.tones.indexOf(w.accent.tone); acc = k < 0 ? 0 : k + 1; }
      cell[r * ncols + c] = [night[0], night[1], night[2], 1 + acc];
    }
    // ---- the record in fd ----
    const base = fd.length / 4;
    const T = (a, b, c, d) => fd.push(a, b, c, d);
    const reveal = rec.skinReveal || 0;
    const fh = frame ? (frame.h != null ? frame.h : frame.w) : 0;
    // T0..T11 fixed, then lists
    T(len, z0, z1, 0);                                           // 0
    T(nrows, ncols, lines.length, tableBase);                    // 1
    T(tid(fieldName), stripSpec ? tid(stripSpec.tone) : -1, lineSpec ? tid(lineSpec.tone) : -1, tid(glassName));   // 2
    T(tid(revealName), reveal, lineSpec ? lineSpec.h : 0, strip[0]);                                         // 3
    T(strip[1], strip[2], strip[3], strip[4]);                                                          // 4
    T(strip[5], frame ? frame.w : 0, frame ? fh : 0, frame ? tid(frame.tone) : -1);                          // 5
    T(head ? head.h : 0, head ? tid(head.tone) : -1, spandrel ? spandrel.h : 0, spandrel ? tid(spandrel.tone) : -1);   // 6
    T(mull ? (mull.w || 0.08) : 0, mull ? tid(mull.tone && P[mull.tone] ? mull.tone : (P.trim ? 'trim' : 'frame')) : -1, mull ? (mull.cols || [0.5]).length : 0, mull ? (mull.rows || []).length : 0);   // 7
    T(accentSpec ? accentSpec.w : 0, accentSpec ? (accentSpec.gap || 0) : 0, accentSpec ? ((accentSpec.side || 'left') === 'left' ? -1 : 1) : 0, accentSpec ? (accentSpec.dz0 || 0) : 0);   // 8
    T(accentSpec ? (accentSpec.dz1 || 0) : 0, accTones[0] ?? -1, accTones[1] ?? -1, accTones[2] ?? -1);   // 9
    T(accTones[3] ?? -1, 0, 0, 0);                                                // 10
    const mc = mull ? (mull.cols || [0.5]) : [], mr = mull ? (mull.rows || []) : [];
    T(mc[0] ?? 0, mc[1] ?? 0, mc[2] ?? 0, mc[3] ?? 0);                                                    // 11 mullion column fractions
    T(mr[0] ?? 0, mr[1] ?? 0, mr[2] ?? 0, mr[3] ?? 0);                                                    // 12 mullion row fractions
    const meanAt = fd.length; T(0, 0, 0, 0); T(0, 0, 0, 0); T(0, 0, 0, 0);                                  // 13..15 mean day / gold / night (filled below)
    // lists: floor lines (4 per texel), rows (2 pairs per texel), cols (2 pairs per texel)
    const listsAt = fd.length / 4;
    for (let i = 0; i < lines.length; i += 4) T(lines[i] ?? 0, lines[i + 1] ?? 0, lines[i + 2] ?? 0, lines[i + 3] ?? 0);
    const rowsAt = fd.length / 4;
    for (let i = 0; i < nrows; i += 2) T(rows[i][0], rows[i][1], rows[i + 1] ? rows[i + 1][0] : 0, rows[i + 1] ? rows[i + 1][1] : 0);
    const colsAt = fd.length / 4;
    for (let i = 0; i < ncols; i += 2) T(cols[i][0], cols[i][1], cols[i + 1] ? cols[i + 1][0] : 0, cols[i + 1] ? cols[i + 1][1] : 0);
    // the offsets of the lists are relative to the record: put them in T0.w
    const rel = a => a - base;
    // store list offsets in T1... we have no spare slot: T10.y..w carry them
    fd[(base + 10) * 4 + 2] = rel(listsAt); fd[(base + 10) * 4 + 3] = rel(rowsAt);
    fd[(base + 0) * 4 + 3] = rel(colsAt);
    for (const c of cell) { if (c) wt.push(c[0], c[1], c[2], c[3]); else wt.push(0, 0, 0, 0); }
    const pid = base;                     // the piece id IS its record's texel index
    const pk = { id: pid, len, z0, z1, rows, cols, cell, lines, strip, frame, fh, head, spandrel, mull: mull ? { w: mull.w || 0.08, cols: mc, rows: mr } : null, accentSpec, field: fieldName, glassName, revealName, reveal, P, stripSpec, lineSpec, sk, accTones };
    // ---- self-check against the generator's own tone function, away from windows ----
    let bad = 0, tot = 0;
    for (let i = 0; i < TUNE.selfCheckPoints; i++) {
      const s = ((i * 0.6180339887) % 1) * len, z = z0 + ((i * 0.4142135623 + 0.13) % 1) * (z1 - z0);
      if (wins.some(w => s > w.s0 - 0.01 - (frame ? frame.w : 0) - (accentSpec ? accentSpec.w + (accentSpec.gap || 0) : 0) && s < w.s1 + 0.01 + (frame ? frame.w : 0) + (accentSpec ? accentSpec.w + (accentSpec.gap || 0) : 0) && z > w.z0 - 0.01 - fh - (spandrel ? spandrel.h : 0) && z < w.z1 + 0.01 + fh + (head ? head.h : 0))) continue;
      tot++;
      const want = skin.tone(z, s, 0, 0), got = fieldNameAt(pk, s, z);
      if (!want || !got || want[0] !== got[0]) bad++;
    }
    if (tot && bad / tot > TUNE.selfCheckTolerance) { stats.selfCheckRefused++; fd.length = base * 4; wt.length = tableBase * 4; return REFUSE('self-check'); }
    // ---- geometry: one quad ----
    const corner = [[0, z0], [len, z0], [len, z1], [0, z1]];
    const N = W.N, Tn = W.T, v0 = geo.pos.length / 3;
    for (const [s, z] of corner) { const p = W.at(s, 0, z); geo.pos.push(p[0], p[1], p[2]); geo.nrm.push(N[0], N[1], N[2]); geo.tan.push(Tn[0], Tn[1], Tn[2]); geo.uv.push(s, z); geo.piece.push(pid); }
    geo.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    // ---- the mean colours (the far field) ----
    fillMean(pk, meanAt);
    if (collectorSelf.debug) collectorSelf.debug.push({ pk, rec });
    stats.taken++; stats.quads++; stats.trianglesSaved += rec.tris ?? 0; stats.windows += wins.length;
    return true;
  }

  // ── the CPU point evaluator: what the shader paints at (s, z) (used for the self-check, the means and the Node test) ──
  function winAt(pk, s, z) {
    for (let r = 0; r < pk.rows.length; r++) { const R = pk.rows[r]; if (z <= R[0] || z >= R[1]) continue; for (let c = 0; c < pk.cols.length; c++) { const C = pk.cols[c]; if (s > C[0] && s < C[1] && pk.cell[r * pk.cols.length + c]) return { r, c, cell: pk.cell[r * pk.cols.length + c] }; } }
    return null;
  }
  /** [day, golden, night] hex of the tone painted at (s, z), the glass cell's night colour aside: returns { tone: P entry, night: hex|null } */
  function fieldNameAt(pk, s, z) {
    const P = pk.P;
    const w = winAt(pk, s, z);
    if (w) return P[pk.glassName];
    // regions of every window near the point, in the generator's priority: frame, spandrel, head, accent
    const near = (zz, s0, s1, z0, z1) => s > s0 && s < s1 && zz > z0 && zz < z1;
    for (let r = 0; r < pk.rows.length; r++) for (let c = 0; c < pk.cols.length; c++) {
      const cell = pk.cell[r * pk.cols.length + c]; if (!cell) continue; const R = pk.rows[r], C = pk.cols[c];
      if (pk.frame && near(z, Math.max(0, C[0] - pk.frame.w), Math.min(pk.len, C[1] + pk.frame.w), Math.max(pk.z0, R[0] - pk.fh), Math.min(pk.z1, R[1] + pk.fh))) return P[pk.frame.tone];
    }
    for (let r = 0; r < pk.rows.length; r++) for (let c = 0; c < pk.cols.length; c++) {
      const cell = pk.cell[r * pk.cols.length + c]; if (!cell) continue; const R = pk.rows[r], C = pk.cols[c];
      if (pk.spandrel && R[0] > pk.z0 + 1e-6 && near(z, C[0], C[1], Math.max(pk.z0, R[0] - pk.fh - pk.spandrel.h), R[0] - pk.fh)) return P[pk.spandrel.tone];
    }
    for (let r = 0; r < pk.rows.length; r++) for (let c = 0; c < pk.cols.length; c++) {
      const cell = pk.cell[r * pk.cols.length + c]; if (!cell) continue; const R = pk.rows[r], C = pk.cols[c];
      if (pk.head && R[1] < pk.z1 - 1e-6 && near(z, C[0], C[1], R[1] + pk.fh, Math.min(pk.z1, R[1] + pk.fh + pk.head.h))) return P[pk.head.tone];
    }
    if (pk.accentSpec) for (let r = 0; r < pk.rows.length; r++) for (let c = 0; c < pk.cols.length; c++) {
      const cell = pk.cell[r * pk.cols.length + c]; if (!cell) continue; const R = pk.rows[r], C = pk.cols[c], a = pk.accentSpec, left = (a.side || 'left') === 'left';
      const sa = left ? C[0] - (a.gap || 0) - a.w : C[1] + (a.gap || 0), zt = R[1] + (pk.head ? pk.head.h : 0) + (a.dz1 || 0);
      if (near(z, Math.max(0, sa), Math.min(pk.len, sa + a.w), Math.max(pk.z0, R[0] + (a.dz0 || 0)), Math.min(pk.z1, zt))) return P[a.tones[Math.max(0, cell[3] - 2)]] || P[pk.field];
    }
    if (pk.lineSpec) for (const f of pk.lines) if (z > f && z < f + pk.lineSpec.h) return P[pk.lineSpec.tone];
    if (pk.stripSpec) {
      const [, Pp, a, b, i1, shift] = pk.strip, x = s + shift, k = Math.floor(x / Pp);
      if (k >= 0 && k < i1 && x - k * Pp >= a && x - k * Pp < b) return P[pk.stripSpec.tone];
    }
    return P[pk.field];
  }
  function fillMean(pk, at) {
    const N = 24; const D = [0, 0, 0], G = [0, 0, 0], Nn = [0, 0, 0]; let count = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const s = (i + 0.5) / N * pk.len, z = pk.z0 + (j + 0.5) / N * (pk.z1 - pk.z0);
      const t = fieldNameAt(pk, s, z); const w = winAt(pk, s, z);
      const d = hex(t[0]), g = hex(t[1]), n = w ? [w.cell[0] / 255, w.cell[1] / 255, w.cell[2] / 255] : hex(t[2]);
      for (let k = 0; k < 3; k++) { D[k] += d[k]; G[k] += g[k]; Nn[k] += n[k]; } count++;
    }
    const set = (o, v) => { fd[(at / 4 + o) * 4] = v[0] / count; fd[(at / 4 + o) * 4 + 1] = v[1] / count; fd[(at / 4 + o) * 4 + 2] = v[2] / count; };
    set(0, D); set(1, G); set(2, Nn);
  }

  // ── GLSL: spliced into slopes.js's own vertex and fragment source ───────
  const VERT_DECL = `
    #ifdef FACET_WALL
    attribute float fPiece;
    attribute vec3 fTan;
    varying vec2 v_fUV;
    varying float v_fPiece;
    varying vec3 v_fTan;
    #endif
  `;
  const VERT_SET = `
      #ifdef FACET_WALL
      v_fUV = uv; v_fPiece = fPiece; v_fTan = fTan;
      #endif
  `;
  const FRAG_DECL = `
    #ifdef FACET_WALL
    varying vec2 v_fUV;
    varying float v_fPiece;
    varying vec3 v_fTan;
    uniform highp sampler2D u_fd;
    uniform highp sampler2D u_wt;
    uniform highp sampler2D u_ft;
    uniform float u_fAA;
    uniform float u_fParallax;
    uniform float u_materialP;
    uniform vec3 u_lightpos;
    uniform vec3 u_lightcolor;
    uniform float u_lightintensity;
    uniform float u_opacity;
    vec4 FD(int i){ return texelFetch(u_fd, ivec2(i & 2047, i >> 11), 0); }
    vec4 FTn(int tone, int k){ int i = tone * 4 + k; return texelFetch(u_ft, ivec2(i & 2047, i >> 11), 0); }
    float fCum(float x, float P, float a, float b, float i0, float i1) {
      if (i1 <= i0 || x <= 0.0 || b <= a) return 0.0;
      float k = floor(x / P);
      float c = (clamp(k, i0, i1) - i0) * (b - a);
      if (k >= i0 && k < i1) c += clamp(x - k * P - a, 0.0, b - a);
      return c;
    }
    float fCov(float x, float h, float P, float a, float b, float i1) {
      h = max(h, 1e-4);
      return (fCum(x + h, P, a, b, 0.0, i1) - fCum(x - h, P, a, b, 0.0, i1)) / (2.0 * h);
    }
    float fIv(float lo, float hi, float x, float h) { h = max(h, 1e-4); return clamp((min(hi, x + h) - max(lo, x - h)) / (2.0 * h), 0.0, 1.0); }
    // the app's per-vertex lighting for one colour, here per pixel and per tone
    vec3 fLit(vec3 c, vec3 nrm) {
      float cv = dot(c, vec3(.2126, .7152, .0722));
      vec3 col = c + vec3(.03);
      float directional = clamp(dot(normalize(nrm), u_lightpos), 0.0, 1.0);
      directional = mix(1.0 - u_lightintensity, max(1.0 - cv + u_lightintensity, 1.0), directional);
      return clamp(col * directional * u_lightcolor, mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
    }
    vec3 fMixP(vec3 d, vec3 g, vec3 n) { return u_materialP <= .5 ? mix(d, g, u_materialP * 2.0) : mix(g, n, (u_materialP - .5) * 2.0); }
    #endif
  `;
  // the block spliced in after `vec3 albedo=v_albedo, night=v_night;`: it sets baseColor, albedo, night and surface
  const FRAG_APPLY = `
      #ifdef FACET_WALL
      {
        int pi = int(v_fPiece + .5);
        vec4 t0 = FD(pi), t1 = FD(pi + 1), t2 = FD(pi + 2), t3 = FD(pi + 3), t4 = FD(pi + 4), t5 = FD(pi + 5), t6 = FD(pi + 6), t7 = FD(pi + 7), t8 = FD(pi + 8), t9 = FD(pi + 9), t10 = FD(pi + 10), t11 = FD(pi + 11), t12 = FD(pi + 12);
        float len = t0.x, pz0 = t0.y, pz1 = t0.z;
        int nRows = int(t1.x + .5), nCols = int(t1.y + .5), nLines = int(t1.z + .5), tableBase = int(t1.w + .5);
        int colsAt = pi + int(t0.w + .5), linesAt = pi + int(t10.z + .5), rowsAt = pi + int(t10.w + .5);
        vec2 sz = v_fUV;
        vec2 fw = 0.5 * u_fAA * sqrt(dFdx(sz) * dFdx(sz) + dFdy(sz) * dFdy(sz));
        // the pixel's footprint against the window period: far away the exact grid fades to the piece's mean colour
        float per = max(len / max(float(nCols), 1.0), 0.05);
        float winsAcross = max(fw.x * 2.0 / per, fw.y * 2.0 / max((pz1 - pz0) / max(float(nRows), 1.0), 0.05));
        float farK = smoothstep(${TUNE.farWindows[0].toFixed(1)}, ${TUNE.farWindows[1].toFixed(1)}, winsAcross);
        vec3 D, G, Nn; float cg = 0.0;
        int fieldT = int(t2.x + .5);
        D = FTn(fieldT, 0).rgb; G = FTn(fieldT, 1).rgb; Nn = FTn(fieldT, 2).rgb;
        vec4 surfField = FTn(fieldT, 3), surfGlass = FTn(int(t2.w + .5), 3);
        if (farK < 1.0) {
          // strips
          if (t3.w > .5) { int st = int(t2.y + .5); float c = fCov(sz.x + t5.x, fw.x, t4.x, t4.y, t4.z, t4.w); D = mix(D, FTn(st, 0).rgb, c); G = mix(G, FTn(st, 1).rgb, c); Nn = mix(Nn, FTn(st, 2).rgb, c); }
          // floor lines
          if (nLines > 0) {
            float c = 0.0; int lt = int(t2.z + .5);
            for (int i = 0; i < 48; i++) { if (i >= nLines) break; vec4 L = FD(linesAt + i / 4); float zl = i % 4 == 0 ? L.x : (i % 4 == 1 ? L.y : (i % 4 == 2 ? L.z : L.w)); c += fIv(zl, zl + t3.z, sz.y, fw.y); }
            c = clamp(c, 0.0, 1.0);
            D = mix(D, FTn(lt, 0).rgb, c); G = mix(G, FTn(lt, 1).rgb, c); Nn = mix(Nn, FTn(lt, 2).rgb, c);
          }
          // the windows near this pixel: their regions (accent, head, spandrel, frame) and the opening
          float frameW = t5.y, frameH = t5.z, headH = t6.x, spanH = t6.z, accW = t8.x, accGap = t8.y, accSide = t8.z, accDz0 = t8.w, accDz1 = t9.x;
          float reach = max(max(frameW + accW + accGap, 0.0), 0.0) + 0.001, reachZ = max(frameH + headH, frameH + spanH) + abs(accDz1) + abs(accDz0) + 0.001;
          vec3 aD = vec3(0), aG = vec3(0), aN = vec3(0); float cA = 0.0, cH = 0.0, cS = 0.0, cF = 0.0, co = 0.0, cm = 0.0; vec3 glN = vec3(0);
          vec3 view = normalize(v_pos - u_eye);
          vec3 nn = normalize(v_normal);
          float vn = dot(view, nn);
          float depth = u_fParallax * t3.y / max(-vn, 0.02);
          vec2 dsh = vec2(dot(view, normalize(v_fTan)), view.z) * depth;
          bool hasHead = headH > 0.0, hasSpan = spanH > 0.0, hasFrame = frameW > 0.0, hasAcc = accW > 0.0;
          for (int r = 0; r < 48; r++) {
            if (r >= nRows) break;
            vec4 RR = FD(rowsAt + r / 2); vec2 rz = (r % 2 == 0) ? RR.xy : RR.zw;
            if (rz.y + reachZ < sz.y - fw.y || rz.x - reachZ > sz.y + fw.y) { if (rz.x - reachZ > sz.y + fw.y) break; continue; }
            for (int c = 0; c < 64; c++) {
              if (c >= nCols) break;
              vec4 CC = FD(colsAt + c / 2); vec2 cs = (c % 2 == 0) ? CC.xy : CC.zw;
              if (cs.y + reach < sz.x - fw.x || cs.x - reach > sz.x + fw.x) { if (cs.x - reach > sz.x + fw.x) break; continue; }
              vec4 cell = texelFetch(u_wt, ivec2((tableBase + r * nCols + c) & 2047, (tableBase + r * nCols + c) >> 11), 0);
              int ca = int(cell.a * 255.0 + .5);           // 0 absent, 1 present, 2.. present with accent tone ca - 2
              if (ca < 1) continue;
              int accIdx = ca - 2;
              // opening
              float ox = fIv(cs.x, cs.y, sz.x, fw.x), oz = fIv(rz.x, rz.y, sz.y, fw.y);
              float gx = fIv(cs.x + max(0.0, -dsh.x), cs.y - max(0.0, dsh.x), sz.x, fw.x), gz = fIv(rz.x + max(0.0, -dsh.y), rz.y - max(0.0, dsh.y), sz.y, fw.y);
              float o = ox * oz, g = min(gx * gz, o); co += o; cg += g; glN += cell.rgb * g;
              if (hasFrame) cF += fIv(cs.x - frameW, cs.y + frameW, sz.x, fw.x) * fIv(rz.x - frameH, rz.y + frameH, sz.y, fw.y);
              if (hasHead && rz.y < pz1 - 1e-6) cH += ox * fIv(rz.y + frameH, min(pz1, rz.y + frameH + headH), sz.y, fw.y);
              if (hasSpan && rz.x > pz0 + 1e-6) cS += ox * fIv(max(pz0, rz.x - frameH - spanH), rz.x - frameH, sz.y, fw.y);
              if (hasAcc) {
                float sa = accSide < 0.0 ? cs.x - accGap - accW : cs.y + accGap;
                float cac = fIv(max(0.0, sa), min(len, sa + accW), sz.x, fw.x) * fIv(max(pz0, rz.x + accDz0), min(pz1, rz.y + (hasHead ? headH : 0.0) + accDz1), sz.y, fw.y);
                int tn = accIdx < 0 ? int(t2.x + .5) : (accIdx == 0 ? int(t9.y + .5) : (accIdx == 1 ? int(t9.z + .5) : (accIdx == 2 ? int(t9.w + .5) : int(t10.x + .5))));
                aD += FTn(tn, 0).rgb * cac; aG += FTn(tn, 1).rgb * cac; aN += FTn(tn, 2).rgb * cac; cA += cac;
              }
              if (t7.z > 0.0 || t7.w > 0.0) {
                float mw = t7.x; float bx = 0.0, bz = 0.0;
                for (int k = 0; k < 4; k++) { if (float(k) >= t7.z) break; float fx = k == 0 ? t11.x : (k == 1 ? t11.y : (k == 2 ? t11.z : t11.w)); float xx = cs.x + fx * (cs.y - cs.x); bx += fIv(xx - mw * .5, xx + mw * .5, sz.x, fw.x); }
                for (int k = 0; k < 4; k++) { if (float(k) >= t7.w) break; float fz = k == 0 ? t12.x : (k == 1 ? t12.y : (k == 2 ? t12.z : t12.w)); float zz = rz.x + fz * (rz.y - rz.x); bz += fIv(zz - mw * .5, zz + mw * .5, sz.y, fw.y); }
                cm += clamp(bx * oz + bz * ox, 0.0, 1.0);
              }
            }
          }
          cA = clamp(cA, 0.0, 1.0); cH = clamp(cH, 0.0, 1.0); cS = clamp(cS, 0.0, 1.0); cF = clamp(cF, 0.0, 1.0); co = clamp(co, 0.0, 1.0); cg = clamp(cg, 0.0, co); cm = clamp(cm, 0.0, 1.0);
          if (cA > 0.0) { float a = cA; vec3 inv = vec3(1.0 / max(a, 1e-4)); D = mix(D, aD * inv, a); G = mix(G, aG * inv, a); Nn = mix(Nn, aN * inv, a); }
          if (cH > 0.0) { int h = int(t6.y + .5); D = mix(D, FTn(h, 0).rgb, cH); G = mix(G, FTn(h, 1).rgb, cH); Nn = mix(Nn, FTn(h, 2).rgb, cH); }
          if (cS > 0.0) { int h = int(t6.w + .5); D = mix(D, FTn(h, 0).rgb, cS); G = mix(G, FTn(h, 1).rgb, cS); Nn = mix(Nn, FTn(h, 2).rgb, cS); }
          if (cF > 0.0) { int h = int(t5.w + .5); D = mix(D, FTn(h, 0).rgb, cF); G = mix(G, FTn(h, 1).rgb, cF); Nn = mix(Nn, FTn(h, 2).rgb, cF); }
          if (co > 0.0) {
            int rt = int(t3.x + .5), gt = int(t2.w + .5);
            D = D * (1.0 - co) + FTn(rt, 0).rgb * (co - cg) + FTn(gt, 0).rgb * cg;
            G = G * (1.0 - co) + FTn(rt, 1).rgb * (co - cg) + FTn(gt, 1).rgb * cg;
            Nn = Nn * (1.0 - co) + FTn(rt, 2).rgb * (co - cg) + glN;
          }
          if (cm > 0.0) { int mt = int(t7.y + .5); D = mix(D, FTn(mt, 0).rgb, cm); G = mix(G, FTn(mt, 1).rgb, cm); Nn = mix(Nn, FTn(mt, 2).rgb, cm); }
        }
        if (farK > 0.0) {
          vec3 mD = FD(pi + 13).rgb, mG = FD(pi + 14).rgb, mN = FD(pi + 15).rgb;
          D = mix(D, mD, farK); G = mix(G, mG, farK); Nn = mix(Nn, mN, farK); cg = mix(cg, 0.5, farK);
        }
        vec3 color = fMixP(D, G, Nn);
        baseColor = vec4(fLit(color, v_normal), 1.0) * u_opacity;
        albedo = D; night = Nn;
        surface = cg > .5 ? surfGlass : surfField;
      }
      #endif
  `;
  // ── patching the app's own shader text ───────────────────────────────────
  function patch(vert, frag) {
    const a1 = 'v_pos = position; v_normal = normal; v_surface = aSurface;';
    const a2 = 'vec3 albedo=v_albedo, night=v_night;';
    const a3 = 'varying vec4 v_color;';
    if (!vert.includes(a1) || !frag.includes(a2) || !frag.includes(a3)) throw new Error('[facet] js/slopes.js shader text moved: cannot splice');
    const vs = VERT_DECL + vert.replace(a1, a1 + VERT_SET);
    const fs = frag.replace(a3, FRAG_DECL + a3).replace(a2, a2 + FRAG_APPLY);
    return { vs, fs };
  }

  // ── finishing: textures, material, mesh ──────────────────────────────────
  function finish(S) {
    if (!geo.idx.length) return null;
    const T = window.THREE;
    const base = S.material();            // the app's own material: its source and its shared uniforms
    const { vs, fs } = patch(base.vertexShader, base.fragmentShader);
    const nfd = Math.ceil(fd.length / 4), hfd = Math.ceil(nfd / FDW);
    const fdArr = new Float32Array(FDW * hfd * 4); fdArr.set(fd);
    const nwt = Math.ceil(wt.length / 4), hwt = Math.max(1, Math.ceil(nwt / FDW));
    const wtArr = new Uint8Array(FDW * hwt * 4); wtArr.set(wt);
    const hft = Math.max(1, Math.ceil(tones.length * 4 / FDW)), ftArr = new Float32Array(FDW * hft * 4);
    tones.forEach((t, i) => { ftArr.set([...t.d, 0, ...t.g, 0, ...t.n, 0, t.s[0] || 0, t.s[1] || 0, t.s[2] || 0, t.s[3] || 0], i * 16); });
    const tex = (arr, w, h, fmt, type) => { const t = new T.DataTexture(arr, w, h, T.RGBAFormat, type); t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; if (fmt) t.internalFormat = fmt; return t; };
    const tFd = tex(fdArr, FDW, hfd, 'RGBA32F', T.FloatType), tWt = tex(wtArr, FDW, hwt, null, T.UnsignedByteType), tFt = tex(ftArr, FDW, hft, 'RGBA32F', T.FloatType);
    const uniforms = Object.assign({}, base.uniforms, { u_fd: { value: tFd }, u_wt: { value: tWt }, u_ft: { value: tFt }, u_fAA: { value: TUNE.aa }, u_fParallax: { value: TUNE.parallax } });
    const mat = new T.ShaderMaterial({ defines: { FACET_WALL: 1 }, uniforms, vertexShader: vs, fragmentShader: fs, side: T.DoubleSide, depthTest: true, depthWrite: true, transparent: false, blending: T.NoBlending });
    mat.defaultAttributeValues.aGrad = [0, 0]; mat.defaultAttributeValues.cDay = [0, 0, 0]; mat.defaultAttributeValues.cGold = [0, 0, 0]; mat.defaultAttributeValues.cNight = [0, 0, 0];
    mat.defaultAttributeValues.aFacet = [0]; mat.defaultAttributeValues.aSurface = [0, 0, 0, 0];
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(geo.pos), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(geo.nrm), 3));
    g.setAttribute('fTan', new T.BufferAttribute(new Float32Array(geo.tan), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(geo.uv), 2));
    g.setAttribute('fPiece', new T.BufferAttribute(new Float32Array(geo.piece), 1));
    g.setIndex(new T.BufferAttribute(new Uint32Array(geo.idx), 1));
    g.computeBoundingSphere();
    base.dispose();
    const mesh = new T.Mesh(g, mat); mesh.name = 'apartments-facet';
    // NOT userData.disposeFacade: js/slopes.js hides every child that has one from the sun shadow pass (a facade-filter overlay adds no shadow). Facet walls
    // ARE the building's shadow caster, so their textures are freed when the geometry is (every rebuild path disposes the geometry).
    g.addEventListener('dispose', () => { tFd.dispose(); tWt.dispose(); tFt.dispose(); mat.dispose(); }); mesh.frustumCulled = true;
    stats.bytes = { fd: fdArr.byteLength, wt: wtArr.byteLength, ft: ftArr.byteLength, geometry: geo.pos.length * 4 + geo.nrm.length * 4 + geo.tan.length * 4 + geo.uv.length * 4 + geo.piece.length * 4 + geo.idx.length * 4 };
    return mesh;
  }
  const collectorSelf = { take, finish, stats, patch, debug: null, _eval: { fieldNameAt, winAt, hex }, _state: { fd, wt, tones, geo } };
  return collectorSelf;
  }   // newCollector

  window.FACET = { on: true, TUNE, collector: newCollector, ready: true };
  window.__facetReady = true;
})();
