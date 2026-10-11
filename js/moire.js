/* THE MOIRE FIX (docs/moire-fix.md). Loaded by js/city-lighting.js only where the fix is on; js/slopes.js and js/slopes-apartments.js call it
 * through tables (the recorder), patch (the shader), parts (textures) and frame (uniforms). Without this file they draw main's picture. */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search), CityLighting = window.CityLighting;
  // Every threshold is a field (MoireFix.params, live); units in docs/moire-fix.md.
  const P = {
    px: [1.0, 2.5], pxV: [1.0, 2.5],   // feature size in pixels, across / up: the face's mean under [0], the cell itself over [1]
    normalShare: 0.9,                  // no new wall face past this share of the normal table
    rowRes: 0.25,                      // metres per row of the window-row count
    edge: q.get('moireedge') !== '0',  // window-edge smoothing
    edgeRes: 0.1, edgePx: [1.0, 2.0],  // metres per strip texel; pixel in texels: none under [0], full over [1]
    nightEdge: 1,                      // 0..1: turns the wall side of a window edge down at night (the MEAN glass is not that pane's tone)
    withSmoothEdges: q.get('moiresmooth') === '1',   // false: stands down on a multisampled context
    through: 1,
    mode: 1,                           // MoireFix.set: 0 off, 1 on, 2 flat (the meter's floor)
    FACE_TEXELS: 10,
  };
  const DEFAULTS = JSON.parse(JSON.stringify(P));
  let samples = -1;

  function glsl(core, reflect) {
    return `
    #if defined(MOIRE_FACES) && !defined(FACADE_FILTER)
    #define MOIRE_ACTIVE 1
    varying float v_faceRaw;
    #define v_face floor(v_faceRaw+0.5)
    uniform highp sampler2D u_moireFaces;
    uniform vec4 u_moire;
    uniform vec4 u_moireB;
    uniform vec4 u_moireC;
    uniform vec4 u_moireD;
    uniform highp sampler2D u_moireFine;
    vec3 moireFar(vec4 baseColor,vec3 albedo,vec3 night,vec4 surface) {
${core}      if(kind>.5&&u_surfaceRange.x>.5&&glazing>.5&&u_sunlight.x<.5) {
        vec3 n=normalize(v_normal),view=normalize(u_eye-v_pos);
        float strength=surface.w;
${reflect}      }
      return col;
    }
    vec4 moireFace(float k) { float i=v_face*float(MOIRE_FACE_TEXELS)+k,y=floor(i/float(MOIRE_TEXW)); return texelFetch(u_moireFaces,ivec2(int(i-y*float(MOIRE_TEXW)),int(y)),0); }
    vec4 moireLit(vec3 day,vec3 gold,vec3 dark,vec3 n) {
      vec3 color=(u_materialP<=0.5)?mix(day,gold,u_materialP*2.0):mix(gold,dark,(u_materialP-0.5)*2.0);
      float colorvalue=color.r*0.2126+color.g*0.7152+color.b*0.0722;
      color+=vec3(0.03);
      float directional=clamp(dot(n,u_lightpos),0.0,1.0);
      directional=mix(1.0-u_lightintensity,max(1.0-colorvalue+u_lightintensity,1.0),directional);
      vec3 lit=clamp(color*directional*u_lightcolor,mix(vec3(0.0),vec3(0.3),vec3(1.0)-u_lightcolor),vec3(1.0));
      return vec4(lit,1.0)*u_opacity;
    }
    float moireFine(float i) { float y=floor(i/float(MOIRE_TEXW)); return texelFetch(u_moireFine,ivec2(int(i-y*float(MOIRE_TEXW)),int(y)),0).r; }
    float moireSum(float base,float u) { float k=floor(u),a=moireFine(base+k); return a+(moireFine(base+k+1.0)-a)*(u-k); }
    float moireShare(float base,float n,float c,float span) {
      float u0=clamp(c-span,0.0,n-0.0001),u1=clamp(c+span,0.0,n-0.0001);
      return (moireSum(base,u1)-moireSum(base,u0))/(2.0*span);
    }
    vec3 moireBlend(vec3 own,float ownGlass) {
      vec3 n=normalize(v_normal);
      vec2 along=normalize(vec2(-n.y,n.x)+vec2(1e-9,0.0));
      float axis=dot(v_pos.xy,along);
      float fh=length(vec2(dFdx(axis),dFdy(axis))),fv=length(vec2(dFdx(v_pos.z),dFdy(v_pos.z)));
      if(u_moire.x<0.5||v_face<0.5)return own;
      vec4 r2=moireFace(2.0),r3=moireFace(3.0);
      if(r2.a<=0.0)return own;
      float wh=1.0-smoothstep(u_moire.y,u_moire.z,r2.a/max(fh,1e-6));
      float wv=1.0-smoothstep(u_moireB.x,u_moireB.y,r3.a/max(fv,1e-6));
      if(u_moire.x>1.5){wh=1.0;wv=1.0;}
      float W=1.0-(1.0-wh)*(1.0-wv);
      float cover=ownGlass,edge=0.0;
      vec4 r8=moireFace(8.0);
      if(u_moireC.x>0.5&&W<1.0&&r8.z>0.5) {
        vec4 r9=moireFace(9.0);
        float pz=fv*r9.x,ps=fh*abs(r9.y);                      
        edge=smoothstep(u_moireC.y,u_moireC.z,max(pz,ps));
        if(edge>0.0) {
          vec3 toEye=normalize(u_eye-v_pos);
          vec2 through=u_moireD.x*ownGlass*moireFace(5.0).a*vec2(dot(toEye.xy,along),toEye.z)/max(abs(dot(toEye,n)),0.05);
          float uz=(v_pos.z+through.y-moireFace(4.0).a)*r9.x,us=(axis+through.x-r9.z)*r9.y;
          cover=clamp(moireShare(r8.y,r8.z,uz,max(0.5*pz,0.5))*moireShare(r8.y+r8.z+1.0,r8.w,us,max(0.5*ps,0.5)),0.0,1.0);
          if(ownGlass<0.5&&cover>0.0) {
            float claimed=moireShare(r8.y,r8.z,uz,1.5)*moireShare(r8.y+r8.z+1.0,r8.w,us,1.5);
            cover*=(1.0-smoothstep(0.7,0.95,claimed))*r9.w;
          }
        }
      }
      float needO=(W>0.0||(edge>0.0&&ownGlass>0.5&&cover<1.0))?1.0:0.0;
      float needG=(W>0.0||(edge>0.0&&ownGlass<0.5&&cover>0.0))?1.0:0.0;
      if(needO+needG<=0.0)return own;
      cityReuse=cityVisibility;
      vec4 r0=moireFace(0.0),r1=moireFace(1.0),r4=moireFace(4.0),r5=moireFace(5.0),r6=moireFace(6.0);
      float g=r0.a,L=r1.a;
      float lit=(u_cityNight.x<=0.0&&u_materialP<=0.5)?0.0:clamp(L/max(g,1e-4),0.0,1.0);
      vec4 glass=vec4(4.0,0.0,0.0,r6.a);
      vec3 O=vec3(0.0),G=vec3(0.0);
      if(needO>0.5)O=moireFar(moireLit(r0.rgb,r1.rgb,r2.rgb,n),r0.rgb,r2.rgb,moireFace(7.0));
      if(needG>0.5) {
        if(lit<1.0)G+=(1.0-lit)*moireFar(moireLit(r3.rgb,r4.rgb,r5.rgb,n),r3.rgb,r5.rgb,glass);
        if(lit>0.0)G+=lit*moireFar(moireLit(r3.rgb,r4.rgb,r6.rgb,n),r3.rgb,r6.rgb,glass);
      }
      vec3 col=own;
      if(edge>0.0)col=mix(own,ownGlass>0.5?mix(O,own,cover):mix(own,G,cover*(1.0-u_moireD.y*u_cityNight.x)),edge);
      if(W>0.0)col=mix(col,mix(O,G,g),W);
      return col;
    }
    #endif
  `;
  }
  /** FRAG with the chunk before main() and one call before gl_FragColor; the class shades reuse FRAG's own text */
  function patch(frag) {
    // searched from main() down: the city-lighting text above it has similar lines
    const m = frag.lastIndexOf('void main() {'), a = frag.indexOf('vec3 col=baseColor.rgb;', m), b = frag.indexOf('if(kind>.5 && u_surfaceRange.x>.5) {', a),
      r = frag.indexOf('float fresnel=pow(1.0-abs(dot(n,view)),3.0);', b), e = frag.indexOf('*daylight);', r) + 11, g = frag.indexOf('gl_FragColor=', e);
    const core = '      ' + frag.slice(a, b).trimEnd() + '\n';
    if (m < 0 || a < m || b < a || r < b || e < r || g < e || !core.includes('cityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)')) {
      console.warn('[moire] cannot find the cell shader\'s text in js/slopes.js; the fix is off'); CityLighting.moire.on = false; return frag;
    }
    return frag.slice(0, m) + glsl(core, '          ' + frag.slice(r, e) + '\n') + frag.slice(m, g) + '#ifdef MOIRE_ACTIVE\n      col=moireBlend(col,glazing);\n      #endif\n      ' + frag.slice(g);
  }
  /** the recorder on a VertexTables T: faceOpen(z0, z1, len, origin, along, outward) -> id, faceCell per rectangle, faceClose */
  function tables(T, hexToRgb01, maxNormals) {
    const FT = P.FACE_TEXELS * 4, bytes = new Map();
    T.nFaces = 1; T.faces = null; T.fine = null; T.nFine = 0;   // face 0 = none; `fine` = the edge strips' running sums
    const b3 = hex => { let c = bytes.get(hex); if (!c) bytes.set(hex, c = hexToRgb01(hex).map(v => Math.round(v * 255))); return c; };
    let F = null;
    T.faceOpen = (z0, z1, len, origin, along, outward) => {
      if (T.nNormals > P.normalShare * maxNormals || T.nFaces >= 65535 || !(z1 > z0)) return 0;
      let E = null;
      if (P.edge && len > 0 && origin && along && outward) {
        // the strips run along the wall's own direction, signed as FRAG's axis comes out (a frame's `outward` is not exactly square to it)
        const tl = Math.hypot(along[0], along[1]) || 1, sg = (along[0] * -outward[1] + along[1] * outward[0]) < 0 ? -1 : 1;
        const nz = Math.max(1, Math.ceil((z1 - z0) / P.edgeRes - 1e-6)), ns = Math.max(1, Math.ceil(len * tl / P.edgeRes - 1e-6));
        if (nz + ns < 60000) E = { nz, ns, len, s0: (origin[0] * along[0] + origin[1] * along[1]) * sg / tl, dot: sg * tl, rz: new Uint8Array(nz * 8), cs: new Uint8Array(ns * 8), area: 0 };
      }
      const n = Math.max(1, Math.ceil((z1 - z0) / P.rowRes - 1e-6));
      F = { id: T.nFaces++, z0, z1, zw: origin && Number.isFinite(origin[2]) ? origin[2] : z0, n, E, S: [0, 1, 2].map(() => new Float64Array(11)),   // sums per class: opaque, unlit, lit glass
        tones: [], fa: 0, sw: 0, sh: 0, rvd: 0, rG: new Float64Array(n), rW: new Float64Array(n) };
      return F.id;
    };
    // one rectangle; fw x fh = its window, rv its recess; takeBack = a part laid over a pane takes its area back
    T.faceCell = (sa, sb, za, zb, col, lit, fw, fh, rv, takeBack) => {
      if (!F || !(zb > za) || !(sb > sa)) return;
      const glass = !!col.surface && (col.surface[0] === 4 || col.surface[0] === 6), w = takeBack ? sa - sb : sb - sa, area = w * (zb - za), E = F.E;
      const s = F.S[glass ? (lit ? 2 : 1) : 0], tone = [0, 1, 2].map(k => b3(col[k]));
      s[0] += area; for (let k = 0; k < 9; k++) s[1 + k] += area * tone[k / 3 | 0][k % 3];
      if (E && glass && !takeBack) {
        const r = (v, z0, z1, n) => [Math.round((v - z0) / (z1 - z0) * n * 8), n * 8];
        const [zu, zn] = r(za, F.z0, F.z1, E.nz), [zv] = r(zb, F.z0, F.z1, E.nz), [su, sn] = r(sa, 0, E.len, E.ns), [sv] = r(sb, 0, E.len, E.ns);
        if (zv > zu && sv > su) { E.rz.fill(1, Math.max(0, zu), Math.min(zn, zv)); E.cs.fill(1, Math.max(0, su), Math.min(sn, sv)); E.area += (zv - zu) * (sv - su); }
      }
      if (glass) {
        const sf = col.surface; s[10] += area * (sf[0] === 6 ? 1 : Math.min(1, Math.max(0, sf[3])));
        if (w > 0 && fw > 0 && fh > 0) { F.fa += area; F.sw += area * fw; F.sh += area * fh; F.rvd += area * rv; }
      } else {
        if (col.surface && col.surface[0] >= 100) F.pattern = true;
        if (w > 0) {  // the wall tone is the largest; the others' cells give a panel wall's feature size
          let t = F.tones.find(t => t.col === col);
          if (!t) { if (F.tones.length < 12) F.tones.push(t = { col, area: 0, sw: 0, sh: 0 }); else t = F.tones[11]; }
          t.area += area; t.sw += area * (fw || w); t.sh += area * (fh || (zb - za));
        }
      }
      const u0 = (za - F.z0) * F.n / (F.z1 - F.z0), u1 = (zb - F.z0) * F.n / (F.z1 - F.z0);
      for (let k = Math.max(0, Math.floor(u0)), ke = Math.min(F.n, Math.ceil(u1)); k < ke; k++) { const ov = (Math.min(u1, k + 1) - Math.max(u0, k)) * w; F.rW[k] += ov; if (glass) F.rG[k] += ov; }
    };
    T.faceClose = () => {
      const f = F, [A, U, L] = f ? f.S : []; F = null;
      if (!f) return;
      const gA = U[0] + L[0], tot = A[0] + gA, R = f.id * FT;
      if (!T.faces || R + FT > T.faces.length) { const a = new Float32Array(Math.max(FT * 256, (T.faces ? T.faces.length : 0) * 2, R + FT)); if (T.faces) a.set(T.faces); T.faces = a; }
      if (!(tot > 1e-9) || f.pattern) return;  // empty or a pattern material (it filters itself): the record stays zero
      const wall = f.tones.reduce((m, t) => !m || t.area > m.area ? t : m, null);
      let fwH = 0, fwV = 0;
      if (gA > 1e-9 && f.fa > 1e-9) {
        // the "feature": 4ab / (a + b) for window a and pier b (docs/moire-fix.md)
        const ww = f.sw / f.fa, wh = f.sh / f.fa;
        let rows = 0, share = 0; for (let k = 0; k < f.n; k++) if (f.rG[k] > 1e-9 && f.rW[k] > 1e-9) { rows++; share += f.rG[k] / f.rW[k]; }
        const fH = rows ? share / rows : 1, fV = rows / f.n, gapH = fH < 0.999 ? ww * (1 - fH) / Math.max(fH, 1e-3) : ww, gapV = fV < 0.999 ? wh * (1 - fV) / Math.max(fV, 1e-3) : wh;
        fwH = 4 * ww * gapH / (ww + gapH); fwV = 4 * wh * gapV / (wh + gapV);
      } else if (f.tones.length > 1) {                
        let a = 0, sw = 0, sh = 0; for (const t of f.tones) if (t !== wall) { a += t.area; sw += t.sw; sh += t.sh; }
        if (a > 1e-9) { fwH = 2 * sw / a; fwV = 2 * sh / a; }
      }
      if (!(fwH > 0) || !(fwV > 0)) return;
      const sf = (wall && wall.col.surface) || [0, 0, 0, 0], W = T.faces;
      const put = (t, k, ss, a) => { const area = ss.reduce((m, s) => m + s[0], 0); for (let c = 0; c < 3; c++) W[R + t * 4 + c] = area > 1e-9 ? ss.reduce((m, s) => m + s[k + c], 0) / area / 255 : 0; W[R + t * 4 + 3] = a; };
      const set = (t, a, b, c, d) => { W[R + t * 4] = a; W[R + t * 4 + 1] = b; W[R + t * 4 + 2] = c; W[R + t * 4 + 3] = d; };
      // texels: 0-2 opaque day, golden, night | 3-6 glass day, golden, unlit night, lit night; alpha: glass share, lit share, feature across, feature up, face foot, mean recess, reflection
      put(0, 1, [A], gA / tot); put(1, 4, [A], L[0] / tot); put(2, 7, [A], Math.max(0.05, fwH)); put(3, 1, [U, L], Math.max(0.05, fwV));
      put(4, 4, [U, L], f.zw); put(5, 7, [U], gA > 1e-9 ? f.rvd / gA : 0); put(6, 7, [L], gA > 1e-9 ? (U[10] + L[10]) / gA : 0); set(7, sf[0], sf[1], sf[2], sf[3]);
      const E = f.E;
      if (E && gA > 1e-9 && E.area > 0) {
        // R(z), C(s): where a pane stands up / along the wall; the glass of an aligned grid is R(z) C(s). Running sums: two reads give a footprint's mean
        const base = T.nFine, need = base + E.nz + E.ns + 2;
        if (!T.fine || need > T.fine.length) { const a = new Float32Array(Math.max(1 << 16, (T.fine ? T.fine.length : 0) * 2, need)); if (T.fine) a.set(T.fine); T.fine = a; }
        const run = (marks, n, at) => { let acc = 0; T.fine[at] = 0; for (let k = 0, m = 0; k < n; k++) { for (let j = 0; j < 8; j++) acc += marks[m++] / 8; T.fine[at + k + 1] = acc; } return acc; };
        const sz = run(E.rz, E.nz, base), ss = run(E.cs, E.ns, base + E.nz + 1);
        T.nFine = need;
        set(8, 0, base, E.nz, E.ns);
        set(9, E.nz / (f.z1 - f.z0), E.ns / (E.len * E.dot), E.s0, Math.min(1, E.area / 64 / Math.max(1e-9, sz * ss)));
      }
    };
    T.faceBytes = () => (T.faces ? T.nFaces * FT * 4 : 0) + T.nFine * 4;
  }

  /** textures, uniforms and defines of one packed table set; `tex` makes a float DataTexture */
  function parts(tables, out, T, tex, W) {
    const tx = tables.tex;
    if (!tx.faces) {
      const fr = Math.max(1, Math.ceil(Math.max(1, tables.nFine) / W)), fd = new Float32Array(fr * W);
      if (tables.fine) fd.set(tables.fine.subarray(0, tables.nFine));
      const fine = new T.DataTexture(fd, W, fr, T.RedFormat, T.FloatType); fine.minFilter = fine.magFilter = T.NearestFilter; fine.generateMipmaps = false; fine.needsUpdate = true;
      Object.assign(tx, { faces: tex(tables.faces, tables.nFaces * P.FACE_TEXELS, W), fine });
    }
    Object.assign(out.uniforms, { u_packFaces: { value: tables.tex.normals }, u_moireFaces: { value: tx.faces }, u_moireFine: { value: tx.fine } });
    Object.assign(out.defines, { MOIRE_FACES: 1, MOIRE_TEXW: W, MOIRE_FACE_TEXELS: P.FACE_TEXELS });
  }
  const uniforms = T => ({ u_moire: { value: new T.Vector4() }, u_moireB: { value: new T.Vector4() }, u_moireC: { value: new T.Vector4() }, u_moireD: { value: new T.Vector4() } });
  /** each frame's uniforms; off on a multisampled context (four real samples place an edge better) unless moiresmooth=1 */
  function frame(U, gl) {
    if (samples < 0 && gl) { try { samples = gl.getParameter(gl.SAMPLES) | 0; } catch (e) { samples = 0; } }
    U.u_moire.value.set(P.mode === 1 && samples > 0 && !P.withSmoothEdges ? 0 : P.mode, P.px[0], P.px[1], 0);
    U.u_moireB.value.set(P.pxV[0], P.pxV[1], 0, 0);
    U.u_moireC.value.set(P.edge && P.mode === 1 ? 1 : 0, P.edgePx[0], P.edgePx[1], 0);
    U.u_moireD.value.set(P.through, P.nightEdge, 0, 0);
  }
  window.MoireFix = {
    params: P, tables, patch, parts, uniforms, frame,
    set(mode) {
      const m = typeof mode === 'number' ? mode : { off: 0, on: 1, flat: 2 }[mode];
      if (!(m >= 0 && m <= 2)) throw new Error('MoireFix.set: off, on or flat');
      P.mode = m; CityLighting.moire.mode = m;
      if (window.__map) window.__map.triggerRepaint();
      return m;
    },
    reset() { for (const k of ['px', 'pxV', 'edgePx']) P[k] = DEFAULTS[k].slice(); for (const k of ['edge', 'through', 'nightEdge']) P[k] = DEFAULTS[k]; },
  };
})();
