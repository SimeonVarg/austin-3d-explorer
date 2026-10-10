/* THE MOIRE FIX (docs/moire-fix.md). Loaded by js/city-lighting.js, only where the fix is on (?moirefix=1, or the default for the tiers
 * without Smooth edges); js/slopes.js and js/slopes-apartments.js call it through the hooks named here. Without this file they draw main's picture.
 *   tables(T, hex)   the recorder on a VertexTables: faceOpen / faceCell / faceClose per wall face (the apartment tiler reports its cells)
 *   patch(frag)      js/slopes.js's fragment shader with the fix added;  parts(...) its textures, uniforms and defines;  frame(U, gl) its uniforms each frame */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search), CityLighting = window.CityLighting;
  // Every threshold is a field here (MoireFix.params, live). Units are in docs/moire-fix.md.
  const P = {
    px: [1.0, 2.5], pxV: [1.0, 2.5],   // pixels across / up a wall face's feature: the cell is its row's (face's) mean under [0], itself over [1]
    normalShare: 0.9,                  // no new wall face once this share of the normal table is used
    rowRes: 0.25,                      // metres of wall height per texel of a face's row strip
    edge: q.get('moireedge') !== '0',  // window-edge smoothing from the two pane strips
    edgeRes: 0.1, edgePx: [1.0, 2.0],  // metres per strip texel; pixel size in strip texels: none under [0], full over [1]
    nightEdge: 0,                      // 0..1: how far the wall side of a window's edge is turned down at night (the face's MEAN glass is not that pane's tone)
    withSmoothEdges: q.get('moiresmooth') === '1',   // false = the authored buildings' part stands down on a multisampled context
    through: 1, rows: 1, footprint: 1, parallax: 1, goldSlope: 0.84,
    mode: 1,                           // runtime (MoireFix.set): 0 off, 1 on, 2 flat (every cell its face's mean: the meter's floor)
    FACE_TEXELS: 12, ROW_W: 2048,
  };
  const DEFAULTS = JSON.parse(JSON.stringify(P));
  let samples = -1;

  function glsl(core, reflect) {
    const call = 'cityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)';
    const far = core.replace(call, 'cityShadeLit(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse,cityVisibility)');
    return `
    #if defined(MOIRE_FACES) && !defined(FACADE_FILTER)
    #define MOIRE_ACTIVE 1
    varying float v_faceRaw;
    #define v_face floor(v_faceRaw+0.5)
    uniform highp sampler2D u_moireFaces;
    uniform sampler2D u_moireRowA;
    uniform sampler2D u_moireRowB;
    uniform vec4 u_moire;
    uniform vec4 u_moireB;
    uniform vec4 u_moireC;
    uniform vec4 u_moireD;
    uniform highp sampler2D u_moireFine;
    vec3 moireFar(vec4 baseColor,vec3 albedo,vec3 night,vec4 surface) {
${far}      if(kind>.5&&u_surfaceRange.x>.5&&glazing>.5&&u_sunlight.x<.5) {
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
      float fh=length(vec2(dFdx(axis),dFdy(axis)))*u_moireC.w,fv=length(vec2(dFdx(v_pos.z),dFdy(v_pos.z)))*u_moireC.w;
      if(u_moire.x<0.5||v_face<0.5)return own;
      vec4 r2=moireFace(2.0),r3=moireFace(3.0);
      if(r2.a<=0.0)return own;
      float wh=1.0-smoothstep(u_moire.y,u_moire.z,r2.a/max(fh,1e-6));
      float wv=1.0-smoothstep(u_moireB.x,u_moireB.y,r3.a/max(fv,1e-6));
      if(u_moire.x>1.5){wh=1.0;wv=1.0;}
      float W=1.0-(1.0-wh)*(1.0-wv);
      float cover=ownGlass,edge=0.0;
      vec4 r9=moireFace(9.0);
      if(u_moireC.x>0.5&&W<1.0&&r9.z>0.5) {
        vec4 r10=moireFace(10.0);
        float pz=fv*r10.x,ps=fh*abs(r10.y);                         // the pixel in strip texels, up and along
        edge=smoothstep(u_moireC.y,u_moireC.z,max(pz,ps));
        if(edge>0.0) {
          vec3 toEye=normalize(u_eye-v_pos);
          vec2 through=u_moireD.x*ownGlass*moireFace(11.0).y*vec2(dot(toEye.xy,along),toEye.z)/max(abs(dot(toEye,n)),0.05);
          float uz=(v_pos.z+through.y-moireFace(8.0).z)*r10.x,us=(axis+through.x-r10.z)*r10.y;
          cover=clamp(moireShare(r9.y,r9.z,uz,max(0.5*pz,0.5))*moireShare(r9.y+r9.z+1.0,r9.w,us,max(0.5*ps,0.5)),0.0,1.0);
          if(ownGlass<0.5&&cover>0.0) {
            float claimed=moireShare(r9.y,r9.z,uz,1.5)*moireShare(r9.y+r9.z+1.0,r9.w,us,1.5);
            cover*=(1.0-smoothstep(0.7,0.95,claimed))*moireFace(11.0).x;
          }
        }
      }
      float needO=(W>0.0||(edge>0.0&&ownGlass>0.5&&cover<1.0))?1.0:0.0;
      float needG=(W>0.0||(edge>0.0&&ownGlass<0.5&&cover>0.0))?1.0:0.0;
      if(needO+needG<=0.0)return own;
      vec4 r0=moireFace(0.0),r1=moireFace(1.0),r4=moireFace(4.0),r5=moireFace(5.0),r6=moireFace(6.0);
      float g=r0.a,L=r1.a;
      vec3 oDay=r0.rgb,oNight=r2.rgb;
      if(W>0.0&&wv<1.0&&u_moireD.z>0.5) {
        vec4 r8=moireFace(8.0);
        float u=(v_pos.z-r8.z)*r8.w,reach=fv*r8.w;
        float rows=float(textureSize(u_moireRowA,0).y);
        vec4 a=vec4(0.0),b=vec4(0.0);
        for(int i=0;i<4;i++) {
          float x=clamp(u+reach*(float(i)-1.5)*0.25,0.5,r9.x-0.5);
          vec2 at=vec2((r8.x+x)/MOIRE_ROW_W,(r8.y+0.5)/rows);
          a+=textureLod(u_moireRowA,at,0.0);b+=textureLod(u_moireRowB,at,0.0);
        }
        a*=0.25;b*=0.25;
        vec3 pd=mix(a.rgb,oDay*(1.0-g),wv),pn=mix(b.rgb,oNight*(1.0-g),wv);
        L=mix(b.a,L,wv);g=mix(a.a,g,wv);
        if(g<0.999){oDay=pd/(1.0-g);oNight=pn/(1.0-g);}
      }
      vec3 oGold=clamp(r1.rgb+(oDay-r0.rgb)*u_moireB.z,0.0,1.0);
      float lit=(u_cityNight.x<=0.0&&u_materialP<=0.5)?0.0:clamp(L/max(g,1e-4),0.0,1.0);   // the lit share of the glass; by day a lit pane is a pane
      vec4 glass=vec4(4.0,0.0,0.0,r6.a);
      vec3 O=vec3(0.0),G=vec3(0.0);
      if(needO>0.5)O=moireFar(moireLit(oDay,oGold,oNight,n),oDay,oNight,moireFace(7.0));
      if(needG>0.5) {
        if(lit<1.0)G+=(1.0-lit)*moireFar(moireLit(r3.rgb,r4.rgb,r5.rgb,n),r3.rgb,r5.rgb,glass);
        if(lit>0.0)G+=lit*moireFar(moireLit(r3.rgb,r4.rgb,r6.rgb,n),r3.rgb,r6.rgb,glass);
      }
      vec3 col=own;
      if(edge>0.0)col=mix(own,ownGlass>0.5?mix(O,own,cover):mix(own,G,cover*(1.0-u_moireD.y*u_cityNight.x)),edge);
      if(W>0.0) {
        vec3 view=normalize(u_eye-v_pos);
        float hide=clamp(u_moire.w*(abs(dot(view.xy,along))*r4.a+abs(view.z)*r5.a)/max(abs(dot(view,n)),0.05),0.0,0.9);
        float gs=g*(1.0-hide);
        col=mix(col,mix(O,G,gs/max(1.0-g*hide,1e-4)),W);
      }
      return col;
    }
    #endif
  `;
  }
  /** js/slopes.js's fragment shader with this chunk added before main() and one call before gl_FragColor; the class shades reuse FRAG's own text */
  function patch(frag) {
    // the anchors are searched from main() down: the city-lighting text spliced in above it has similar lines of its own
    const m = frag.lastIndexOf('void main() {'), a = frag.indexOf('vec3 col=baseColor.rgb;', m), b = frag.indexOf('if(kind>.5 && u_surfaceRange.x>.5) {', a),
      r = frag.indexOf('float fresnel=pow(1.0-abs(dot(n,view)),3.0);', b), e = frag.indexOf('*daylight);', r) + 11, g = frag.indexOf('gl_FragColor=', e);
    const core = '      ' + frag.slice(a, b).trimEnd() + '\n';
    if (m < 0 || a < m || b < a || r < b || e < r || g < e || !core.includes('cityShade(col/max(baseColor.a,.0001),albedo,v_pos,v_normal,glassResponse)')) {
      console.warn('[moire] cannot find the cell shader\'s text in js/slopes.js; the fix is off'); CityLighting.moire.on = false; return frag;
    }
    return frag.slice(0, m) + glsl(core, '          ' + frag.slice(r, e) + '\n') + frag.slice(m, g) + '#ifdef MOIRE_ACTIVE\n      col=moireBlend(col,glazing);\n      #endif\n      ' + frag.slice(g);
  }
  function tables(T, hexToRgb01, maxNormals) {
    const FT = P.FACE_TEXELS * 4, RW = P.ROW_W;
    T.nFaces = 1; T.faces = null; T.rowA = null; T.rowB = null; T.rowX = 0; T.rowY = 0;   // face 0 = "no face"; arrays made on the first face
    T.fine = null; T.nFine = 0;                                                            // the edge strips' running sums, one float each
    const bytes = new Map();
    const b3 = hex => { let c = bytes.get(hex); if (!c) { const f = hexToRgb01(hex); c = [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)]; bytes.set(hex, c); } return c; };
    let F = null;
    T.faceOpen = (z0, z1, len, origin, along, outward) => {
      if (T.nNormals > P.normalShare * maxNormals || !(z1 > z0)) return 0;   // the normal table is nearly full: no more faces, rather than an overflow
      const n = Math.max(1, Math.ceil((z1 - z0) / P.rowRes - 1e-6));
      if (n > RW || T.nFaces >= 65535) return 0;
      if (T.rowX + n > RW) { T.rowX = 0; T.rowY++; }
      let E = null;
      if (P.edge && len > 0 && origin && along && outward) {
        const tl = Math.hypot(along[0], along[1]) || 1, sg = (along[0] * -outward[1] + along[1] * outward[0]) < 0 ? -1 : 1, ax = sg * along[0] / tl, ay = sg * along[1] / tl;
        const dot = sg * tl;                                                                               // metres of FRAG's axis per unit of s (signed)
        const nz = Math.max(1, Math.ceil((z1 - z0) / P.edgeRes - 1e-6)), ns = Math.max(1, Math.ceil(len * Math.abs(dot) / P.edgeRes - 1e-6));
        if (nz + ns < 60000) E = { nz, ns, len, s0: origin[0] * ax + origin[1] * ay, dot, rz: new Uint8Array(nz * 8), cs: new Uint8Array(ns * 8), area: 0 };   // eight marks a texel
      }
      F = { id: T.nFaces++, z0, z1, zw: origin && Number.isFinite(origin[2]) ? origin[2] : z0, n, inv: n / (z1 - z0), x: T.rowX, y: T.rowY, E,
        o: new Float64Array(10), g: new Float64Array(16), tones: [], fa: 0, sw: 0, sh: 0, rvv: 0, rvd: 0,   // sums, see faceCell
        rO: new Float64Array(n * 3), rN: new Float64Array(n * 3), rG: new Float64Array(n), rL: new Float64Array(n), rW: new Float64Array(n) };
      T.rowX += n;
      return F.id;
    };
    T.faceCell = (sa, sb, za, zb, col, glass, lit, fw, fh, rv, takeBack) => {
      if (!F || !(zb > za) || !(sb > sa)) return;
      const w = takeBack ? sa - sb : sb - sa;
      const area = w * (zb - za), d = b3(col[0]), gd = b3(col[1]), nt = b3(col[2]), o = F.o, g = F.g;
      const E = F.E;
      if (E && glass && !takeBack) {
        const z0u = Math.round((za - F.z0) / (F.z1 - F.z0) * E.nz * 8), z1u = Math.round((zb - F.z0) / (F.z1 - F.z0) * E.nz * 8), s0u = Math.round(sa / E.len * E.ns * 8), s1u = Math.round(sb / E.len * E.ns * 8);
        if (z1u > z0u && s1u > s0u) { E.rz.fill(1, Math.max(0, z0u), Math.min(E.nz * 8, z1u)); E.cs.fill(1, Math.max(0, s0u), Math.min(E.ns * 8, s1u)); E.area += (z1u - z0u) * (s1u - s0u); }
      }
      if (glass) {
        g[0] += area; g[1] += area * d[0]; g[2] += area * d[1]; g[3] += area * d[2]; g[4] += area * gd[0]; g[5] += area * gd[1]; g[6] += area * gd[2];
        const k = lit ? 10 : 7; g[k] += area * nt[0]; g[k + 1] += area * nt[1]; g[k + 2] += area * nt[2];
        if (lit) g[13] += area;
        const sf = col.surface;
        g[14] += area * (sf ? (sf[0] === 6 ? 1 : Math.min(1, Math.max(0, sf[3]))) : 0);
        if (w > 0 && fw > 0 && fh > 0) { F.fa += area; F.sw += area * fw; F.sh += area * fh; if (rv > 0) { g[15] += area * rv / fw; F.rvv += area * rv / fh; F.rvd += area * rv; } }
      } else {
        o[0] += area; o[1] += area * d[0]; o[2] += area * d[1]; o[3] += area * d[2]; o[4] += area * gd[0]; o[5] += area * gd[1]; o[6] += area * gd[2];
        o[7] += area * nt[0]; o[8] += area * nt[1]; o[9] += area * nt[2];
        if (col.surface && col.surface[0] >= 100) F.pattern = true;
        if (w > 0) {
          let t = null; const ts = F.tones;
          for (let i = 0; i < ts.length; i++) if (ts[i].col === col) { t = ts[i]; break; }
          if (!t) { if (ts.length < 12) ts.push(t = { col, area: 0, sw: 0, sh: 0 }); else t = ts[11]; }
          t.area += area; t.sw += area * (fw || w); t.sh += area * (fh || (zb - za));
        }
      }
      const u0 = (za - F.z0) * F.inv, u1 = (zb - F.z0) * F.inv;
      for (let k = Math.max(0, Math.floor(u0)), ke = Math.min(F.n, Math.ceil(u1)); k < ke; k++) {
        const ov = (Math.min(u1, k + 1) - Math.max(u0, k)) * w;
        if (ov === 0) continue;
        F.rW[k] += ov;
        if (glass) { F.rG[k] += ov; if (lit) F.rL[k] += ov; }
        else { F.rO[k * 3] += ov * d[0]; F.rO[k * 3 + 1] += ov * d[1]; F.rO[k * 3 + 2] += ov * d[2]; F.rN[k * 3] += ov * nt[0]; F.rN[k * 3 + 1] += ov * nt[1]; F.rN[k * 3 + 2] += ov * nt[2]; }
      }
    };
    T.faceClose = () => {
      const f = F; F = null;
      if (!f) return;
      const o = f.o, g = f.g, oA = o[0], gA = g[0], tot = oA + gA, R = f.id * FT;
      if (!T.faces || R + FT > T.faces.length) { const a = new Float32Array(Math.max(FT * 256, (T.faces ? T.faces.length : 0) * 2, R + FT)); if (T.faces) a.set(T.faces); T.faces = a; }
      const need = (f.y + 1) * RW * 4;
      if (!T.rowA || need > T.rowA.length) { const len = Math.max(RW * 4 * 8, (T.rowA ? T.rowA.length : 0) * 2, need); const a = new Uint8Array(len), b = new Uint8Array(len); if (T.rowA) { a.set(T.rowA); b.set(T.rowB); } T.rowA = a; T.rowB = b; }
      const W = T.faces;
      if (!(tot > 1e-9) || f.pattern) return;
      const lA = g[13], uA = gA - lA, i255 = 1 / 255;
      const mean = (sum, k, area) => area > 1e-9 ? sum[k] / area * i255 : 0;
      const oD = [mean(o, 1, oA), mean(o, 2, oA), mean(o, 3, oA)], oG = [mean(o, 4, oA), mean(o, 5, oA), mean(o, 6, oA)];
      const oN = [mean(o, 7, oA), mean(o, 8, oA), mean(o, 9, oA)];
      let fwH = 0, fwV = 0;
      let wall = null; for (const t of f.tones) if (!wall || t.area > wall.area) wall = t;
      if (gA > 1e-9 && f.fa > 1e-9) {
        const ww = f.sw / f.fa, wh = f.sh / f.fa;
        let rows = 0, share = 0; for (let k = 0; k < f.n; k++) if (f.rG[k] > 1e-9 && f.rW[k] > 1e-9) { rows++; share += f.rG[k] / f.rW[k]; }
        const fH = rows ? share / rows : 1, fV = rows / f.n;
        const gapH = fH < 0.999 ? ww * (1 - fH) / Math.max(fH, 1e-3) : ww, gapV = fV < 0.999 ? wh * (1 - fV) / Math.max(fV, 1e-3) : wh;
        fwH = 4 * ww * gapH / (ww + gapH); fwV = 4 * wh * gapV / (wh + gapV);
      } else if (f.tones.length > 1) {
        let a = 0, sw = 0, sh = 0; for (const t of f.tones) if (t !== wall) { a += t.area; sw += t.sw; sh += t.sh; }
        if (a > 1e-9) { fwH = 2 * sw / a; fwV = 2 * sh / a; }
      }
      if (!(fwH > 0) || !(fwV > 0)) return;             // one tone: nothing to average
      const sf = (wall && wall.col.surface) || [0, 0, 0, 0];
      const put = (t, r, gch, b, a) => { const i = R + t * 4; W[i] = r; W[i + 1] = gch; W[i + 2] = b; W[i + 3] = a; };
      put(0, oD[0], oD[1], oD[2], gA / tot);
      put(1, oG[0], oG[1], oG[2], lA / tot);
      put(2, oN[0], oN[1], oN[2], Math.max(0.05, fwH));
      put(3, mean(g, 1, gA), mean(g, 2, gA), mean(g, 3, gA), Math.max(0.05, fwV));
      put(4, mean(g, 4, gA), mean(g, 5, gA), mean(g, 6, gA), gA > 1e-9 ? g[15] / gA : 0);
      put(5, mean(g, 7, uA), mean(g, 8, uA), mean(g, 9, uA), gA > 1e-9 ? f.rvv / gA : 0);
      put(6, mean(g, 10, lA), mean(g, 11, lA), mean(g, 12, lA), gA > 1e-9 ? g[14] / gA : 0);
      put(7, sf[0], sf[1], sf[2], sf[3]);
      put(8, f.x, f.y, f.zw, f.inv);
      put(9, f.n, 0, 0, 0);
      const E = f.E;
      if (E && gA > 1e-9 && E.area > 0) {
        const H = f.z1 - f.z0, base = T.nFine, need = base + E.nz + E.ns + 2;
        if (!T.fine || need > T.fine.length) { const a = new Float32Array(Math.max(1 << 16, (T.fine ? T.fine.length : 0) * 2, need)); if (T.fine) a.set(T.fine); T.fine = a; }
        const run = (marks, n, at) => { let acc = 0; T.fine[at] = 0; for (let k = 0, m = 0; k < n; k++) { let c = 0; for (let j = 0; j < 8; j++) c += marks[m++]; acc += c / 8; T.fine[at + k + 1] = acc; } return acc; };
        const sz = run(E.rz, E.nz, base), ss = run(E.cs, E.ns, base + E.nz + 1);
        T.nFine = need;
        put(9, f.n, base, E.nz, E.ns);
        put(10, E.nz / H, E.ns / (E.len * E.dot), E.s0, 0);
        put(11, Math.min(1, E.area / 64 / Math.max(1e-9, sz * ss)), f.rvd / gA, 0, 0);
        T.nAligned = (T.nAligned || 0) + 1;
      }
      const A = T.rowA, B = T.rowB, base = (f.y * RW + f.x) * 4, by = v => Math.max(0, Math.min(255, Math.round(v)));
      for (let k = 0; k < f.n; k++) {
        const w = f.rW[k], i = base + k * 4;
        if (w > 1e-9) {
          A[i] = by(f.rO[k * 3] / w); A[i + 1] = by(f.rO[k * 3 + 1] / w); A[i + 2] = by(f.rO[k * 3 + 2] / w); A[i + 3] = by(255 * f.rG[k] / w);
          B[i] = by(f.rN[k * 3] / w); B[i + 1] = by(f.rN[k * 3 + 1] / w); B[i + 2] = by(f.rN[k * 3 + 2] / w); B[i + 3] = by(255 * f.rL[k] / w);
        } else {
          const q = oA / tot * 255;
          A[i] = by(oD[0] * q); A[i + 1] = by(oD[1] * q); A[i + 2] = by(oD[2] * q); A[i + 3] = by(255 * gA / tot);
          B[i] = by(oN[0] * q); B[i + 1] = by(oN[1] * q); B[i + 2] = by(oN[2] * q); B[i + 3] = by(255 * lA / tot);
        }
      }
    };
    T.faceBytes = () => (T.faces ? T.nFaces * FT * 4 : 0) + (T.rowA ? (T.rowY + 1) * RW * 8 : 0) + T.nFine * 4;
  }

  /** the textures, uniforms and defines of the faces of one packed table set; `tex` makes a float DataTexture of W texels a row */
  function parts(tables, out, T, tex, W) {
    const tx = tables.tex, rows = tables.rowY + 1, RW = P.ROW_W;
    if (!tx.faces) {
      const strip = d => { const t = new T.DataTexture(d.subarray(0, rows * RW * 4), RW, rows, T.RGBAFormat, T.UnsignedByteType); t.minFilter = t.magFilter = T.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
      const fr = Math.max(1, Math.ceil(Math.max(1, tables.nFine) / W)), fd = new Float32Array(fr * W);
      if (tables.fine) fd.set(tables.fine.subarray(0, tables.nFine));
      const fine = new T.DataTexture(fd, W, fr, T.RedFormat, T.FloatType); fine.minFilter = fine.magFilter = T.NearestFilter; fine.generateMipmaps = false; fine.needsUpdate = true;
      Object.assign(tx, { faces: tex(tables.faces, tables.nFaces * P.FACE_TEXELS, W), rowA: strip(tables.rowA), rowB: strip(tables.rowB), fine });
    }
    Object.assign(out.uniforms, { u_packFaces: { value: tables.tex.normals }, u_moireFaces: { value: tx.faces }, u_moireRowA: { value: tx.rowA }, u_moireRowB: { value: tx.rowB }, u_moireFine: { value: tx.fine } });
    Object.assign(out.defines, { MOIRE_FACES: 1, MOIRE_TEXW: W, MOIRE_FACE_TEXELS: P.FACE_TEXELS, MOIRE_ROW_W: P.ROW_W.toFixed(1) });
  }
  const uniforms = T => ({ u_moire: { value: new T.Vector4() }, u_moireB: { value: new T.Vector4() }, u_moireC: { value: new T.Vector4() }, u_moireD: { value: new T.Vector4() } });
  /** each frame: mode 0 on a multisampled context (four real samples place a window's edge better than the strips do) unless moiresmooth=1 */
  function frame(U, gl) {
    if (samples < 0 && gl) { try { samples = gl.getParameter(gl.SAMPLES) | 0; } catch (e) { samples = 0; } }
    U.u_moire.value.set(P.mode === 1 && samples > 0 && !P.withSmoothEdges ? 0 : P.mode, P.px[0], P.px[1], P.parallax);
    U.u_moireB.value.set(P.pxV[0], P.pxV[1], P.goldSlope, 0);
    U.u_moireC.value.set(P.edge && P.mode === 1 ? 1 : 0, P.edgePx[0], P.edgePx[1], P.footprint);
    U.u_moireD.value.set(P.through, P.nightEdge, P.rows, 0);
  }
  window.MoireFix = {
    params: P, tables, patch, parts, uniforms, frame,
    /** the meter flips arms inside one page: 'off' draws main's picture through this program, 'flat' the floor */
    set(mode) {
      const m = typeof mode === 'number' ? mode : { off: 0, on: 1, flat: 2 }[mode];
      if (!(m >= 0 && m <= 2)) throw new Error('MoireFix.set: off, on or flat');
      P.mode = m; CityLighting.moire.mode = m;
      if (window.__map) window.__map.triggerRepaint();
      return m;
    },
    reset() { for (const k of ['px', 'pxV', 'edgePx']) P[k] = DEFAULTS[k].slice(); for (const k of ['parallax', 'edge', 'goldSlope', 'footprint', 'through', 'nightEdge', 'rows']) P[k] = DEFAULTS[k]; },
    info() {
      let faces = 0, bytes = 0, sets = 0; const seen = new Set(), g = window.slopesApartments && window.slopesApartments.group;
      if (g) g.traverse(o => { const pk = o.isMesh && o.geometry && o.geometry.userData.pack; if (pk && !seen.has(pk)) { seen.add(pk); sets++; faces += pk.nFaces - 1; bytes += pk.faceBytes ? pk.faceBytes() : 0; } });
      return { mode: P.mode, px: P.px, pxV: P.pxV, parallax: P.parallax, faces, tableBytes: bytes, tables: sets, walls: { ...CityLighting.moire } };
    },
  };
})();
