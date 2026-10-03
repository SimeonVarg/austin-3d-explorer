/* Compact wall material (contract: docs/wall-patterns.md). A building file
 * names a pattern under materials.<key>.pattern; js/slopes-apartments.js
 * registers it per building and js/slopes.js draws it in the shader, so a
 * brick wall is one flat face with a running bond, not a triangle per brick.
 * Pattern rows share one small data texture; building geometry stays batched.
 * Loads BEFORE js/slopes.js (index.html and _harness.html).
 * No captured images, building identifiers or camera data belong in this file.
 */
(() => {
  'use strict';
  const WIDTH = 32, LIMIT = 64, FIRST = 100;
  // Cells per pixel: keep resolvable colour, blend to the area mean beyond it.
  const DEFAULT_FILTER = [.35,1.25];
  const data = new Float32Array(WIDTH * LIMIT * 4), keys = new Map();
  let texture;
  function tex() {
    if (!texture) {
      const T = window.THREE;
      texture = new T.DataTexture(data, WIDTH, LIMIT, T.RGBAFormat, T.FloatType);
      texture.minFilter = texture.magFilter = T.NearestFilter;
      texture.generateMipmaps = false; texture.needsUpdate = true;
    }
    return texture;
  }
  const rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
  function register(palette, spec, frame) {
    for (const [key, material] of Object.entries(spec.materials || {})) {
      const p = material?.pattern;
      if (!p) continue;
      if (p.version !== 1 || !palette[key] || !Array.isArray(p.tones) || !p.tones.length || p.tones.length > 6)
        throw Error('Invalid wall pattern palette: ' + key);
      const module = material.scale, gap = p.joint?.width;
      const phase = p.phase || [0,0], axis = p.axis || [1,0];
      const filter = p.filter || DEFAULT_FILTER;
      if (!Array.isArray(module) || module.length !== 2 || module.some(v => !Number.isFinite(v) || v <= 0) ||
          !Number.isFinite(gap) || gap < 0 || gap >= Math.min(...module) || !palette[p.joint.tone] ||
          !Number.isFinite(p.seed) || phase.length !== 2 || axis.length !== 2 ||
          [...phase,...axis].some(v => !Number.isFinite(v)) || Math.hypot(...axis) === 0 ||
          filter.length!==2 || filter.some(v=>!Number.isFinite(v)) || filter[0]<0 || filter[1]<=filter[0])
        throw Error('Invalid wall pattern dimensions: ' + key);
      const tones = p.tones.map(([tone, weight]) => {
        if (!palette[tone] || !Number.isFinite(weight) || weight <= 0) throw Error('Invalid wall pattern weight: ' + key);
        return {colours:palette[tone].map(rgb),weight};
      });
      const origin = frame.at(0,0,0), [ux,uy] = frame.U, [vx,vy] = frame.V;
      const det = ux*vy-uy*vx;
      const inv = [(axis[0]*vy-axis[1]*uy)/det,(-axis[0]*vx+axis[1]*ux)/det];
      const identity = JSON.stringify([p,module,origin,inv,tones,palette[p.joint.tone]]);
      let row = keys.get(identity);
      if (row === undefined) {
        row = keys.size;
        if (row >= LIMIT) throw Error('Wall pattern table exhausted');
        keys.set(identity,row);
        const put = (col, values) => data.set(values,(row*WIDTH+col)*4);
        put(0,[origin[0],origin[1],p.seed,tones.length]);
        put(1,[inv[0],inv[1],phase[0],phase[1]]);
        put(2,[module[0],module[1],gap,gap]);
        put(6,[...filter,0,0]);
        const total = tones.reduce((a,t) => a+t.weight,0), means = Array.from({length:3},()=>[0,0,0]);
        let cdf=0; const thresholds=Array(8).fill(1);
        tones.forEach((t,i) => {
          cdf+=t.weight/total;
          thresholds[i]=cdf;
          for(let j=0;j<3;j++) {
            put(8+i*3+j,[...t.colours[j],cdf]);
            for(let c=0;c<3;c++) means[j][c]+=t.colours[j][c]*t.weight/total;
          }
        });
        put(7,thresholds.slice(0,4));put(29,thresholds.slice(4,8));
        const mortar=palette[p.joint.tone].map(rgb);
        for(let j=0;j<3;j++) {put(3+j,[...mortar[j],0]);put(26+j,[...means[j],0]);}
        texture && (texture.needsUpdate=true);
      }
      palette[key].surface=[FIRST+row,module[0],module[1],1];
    }
  }
  const glsl = `
    uniform sampler2D u_wallPatterns;
    #ifndef FACADE_FILTER
    uniform float u_materialP;
    uniform vec3 u_lightpos;
    uniform vec3 u_lightcolor;
    uniform float u_lightintensity;
    uniform float u_opacity;
    #endif
    vec4 wpRead(float row,float col) {return texture2D(u_wallPatterns,vec2((col+.5)/32.,(row+.5)/64.));}
    float wpHash(vec2 cell,float seed) {
      // Keep integer cell coordinates in the hash; avoid sin precision stripes.
      vec3 p=fract((vec3(cell.xyx)+seed)*vec3(.1031,.1030,.0973));
      p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
    }
    void wpColour(float row,vec3 pos,out vec3 day,out vec3 gold,out vec3 dark) {
      vec4 O=wpRead(row,0.),A=wpRead(row,1.),M=wpRead(row,2.);
      vec2 uv=vec2(dot(pos.xy-O.xy,A.xy)-A.z,pos.z-A.w);
      vec2 cell=uv/M.xy;
      cell.x+=mod(floor(cell.y),2.)*.5;
      vec2 edge=(.5-abs(fract(cell)-.5))*M.xy;
      vec2 aa=max(fwidth(uv),vec2(.00001));
      vec2 inside=smoothstep(M.zw*.5-aa*.5,M.zw*.5+aa*.5,edge);
      float coverage=inside.x*inside.y;
      float meanCoverage=(1.-M.z/M.x)*(1.-M.w/M.y);
      vec2 footprint=fwidth(uv)/M.xy;
      vec2 filterRange=wpRead(row,6.).xy;
      float resolved=1.-smoothstep(filterRange.x,filterRange.y,max(footprint.x,footprint.y));
      vec3 mortarDay=wpRead(row,3.).rgb,mortarGold=wpRead(row,4.).rgb,mortarDark=wpRead(row,5.).rgb;
      if(resolved<1.) {
        day=mix(mortarDay,wpRead(row,26.).rgb,meanCoverage);
        gold=mix(mortarGold,wpRead(row,27.).rgb,meanCoverage);
        dark=mix(mortarDark,wpRead(row,28.).rgb,meanCoverage);
      }
      if(resolved>0.) {
        // One threshold vector lookup replaces a divergent per-tone texture loop.
        float h=wpHash(floor(cell),O.z);
        float index=dot(vec4(greaterThan(vec4(h),wpRead(row,7.))),vec4(1.))+
          dot(vec2(greaterThan(vec2(h),wpRead(row,29.).xy)),vec2(1.));
        float col=8.+index*3.;
        vec3 selectedDay=mix(mortarDay,wpRead(row,col).rgb,coverage);
        vec3 selectedGold=mix(mortarGold,wpRead(row,col+1.).rgb,coverage);
        vec3 selectedDark=mix(mortarDark,wpRead(row,col+2.).rgb,coverage);
        if(resolved>=1.) {day=selectedDay;gold=selectedGold;dark=selectedDark;}
        else {day=mix(day,selectedDay,resolved);gold=mix(gold,selectedGold,resolved);dark=mix(dark,selectedDark,resolved);}
      }
    }
  `;
  const apply = `
      // Interpolation can yield 99.99999 for three vertices carrying 100.
      // Classify around the integer centre, never at its exact lower bound.
      if(surface.x>99.5 && surface.x<163.5) {
        vec3 day,gold,dark;wpColour(floor(surface.x+.5)-100.,v_pos,day,gold,dark);
        albedo=day;night=dark;
        vec3 color=u_materialP<=.5?mix(day,gold,u_materialP*2.):mix(gold,dark,(u_materialP-.5)*2.);
        float value=dot(color,vec3(.2126,.7152,.0722));
        float directional=mix(1.-u_lightintensity,max(1.-value+u_lightintensity,1.),clamp(dot(normalize(v_normal),u_lightpos),0.,1.));
        baseColor=vec4(clamp((color+vec3(.03))*directional*u_lightcolor,mix(vec3(0),vec3(.3),vec3(1)-u_lightcolor),vec3(1)),1)*u_opacity;
        surface=vec4(0);
      }
  `;
  window.WallPatterns={register,glsl,apply,attach(mat){mat.uniforms.u_wallPatterns={value:tex()};},get size(){return keys.size;}};
})();
