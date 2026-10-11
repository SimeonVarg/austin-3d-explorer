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

// Roof material shares this already-loaded shader module. It adds no request,
// image texture, table allocation or vertex attribute. Taste: SLOPES_ROOFS.tiles.
(() => {
  'use strict';
  const uniforms={};let signature='';
  const set=(k,v)=>{if(uniforms[k])uniforms[k].value=v;else uniforms[k]={value:v};};
  const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
  function sync(U) {
    const t=window.SLOPES_ROOFS?.tiles;
    if(!t)return;
    set('u_rtOn',t.on?1:0);
    const ratio=t.perScreenPixel?Math.max(1,window.__map?.getPixelRatio?.()||1):1;
    const key=JSON.stringify(t)+ratio;
    if(key!==signature){
      signature=key;
      const V=window.THREE.Vector4,weights=t.weights,total=weights.reduce((s,x)=>s+x,0),tones=t.tones.map(rgb),mean=[0,1,2].map(c=>tones.reduce((s,x,i)=>s+x[c]*weights[i]/total,0));
      let cdf=0;
      set('u_rtTones',tones.map((a,i)=>new V(...a.map((x,c)=>x/mean[c]),cdf+=weights[i]/total)));
      set('u_rtCell',new V(t.pitchM,t.courseM,t.strength,t.seed));
      set('u_rtFootprint',new V(...t.axisFilter,...t.clayFilter));
      set('u_rtFilter',new V(...t.filter,Math.cos(t.slopeDeg[1]*Math.PI/180),Math.cos(t.slopeDeg[0]*Math.PI/180)));
      set('u_rtShape',new V(t.valleyWidth,t.valley,t.barrel,t.lipCurve));
      set('u_rtLip',new V(t.lipWidth,t.lip,t.lipLight,t.weather));
      set('u_rtPale',new V(...t.paleRun,t.paleGrouped,weights.at(-1)/total));
      set('u_rtWeather',new V(t.weatherShare,...t.weatherScale,ratio));
      set('u_rtHour',new V(...t.hourContrast,t.meanFrom==='photo'?1:0));
      set('u_rtPhoto',t.photoMean.map(h=>new window.THREE.Vector3(...rgb(h))));
      set('u_rtEdges',new V(t.caps?1:0,t.capWidthM,t.capContrast,t.eave?1:0));
      set('u_rtEave',new V(t.eaveWidthM,t.gutter,0,0));
    }
    Object.assign(U,uniforms);
  }
  const glsl=`
    uniform float u_rtOn;
    uniform vec4 u_rtFootprint;
    uniform vec4 u_rtTones[5];
    uniform vec4 u_rtCell,u_rtFilter,u_rtShape,u_rtLip,u_rtPale,u_rtWeather,u_rtHour,u_rtEdges,u_rtEave;
    uniform vec3 u_rtPhoto[3];
    float rtWeatherNoise(vec2 p) {
      vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(wpHash(i,u_rtCell.w+5.),wpHash(i+vec2(1,0),u_rtCell.w+5.),f.x),
        mix(wpHash(i+vec2(0,1),u_rtCell.w+5.),wpHash(i+vec2(1,1),u_rtCell.w+5.),f.x),f.y)*2.-1.;
    }
    vec3 rtTone(vec2 cell) {
      // A column chooses short groups. Some decisions stay independent, so
      // cream includes singles as well as runs. Its marginal share is fixed.
      float run=floor(mix(u_rtPale.x,u_rtPale.y+1.,wpHash(vec2(cell.x,0.),u_rtCell.w)));
      float group=floor((cell.y+floor(wpHash(vec2(cell.x,1.),u_rtCell.w)*run))/run);
      bool grouped=wpHash(vec2(cell.x,group),u_rtCell.w+1.)<u_rtPale.z;
      float pale=wpHash(grouped?vec2(cell.x,group):cell,u_rtCell.w+2.);
      float choice=wpHash(cell,u_rtCell.w+3.)*(1.-u_rtPale.w);
      int index=0;
      for(int i=0;i<4;i++){if(choice>u_rtTones[i].w)index=i+1;}
      if(pale<u_rtPale.w)index=4;
      vec3 tone=vec3(1);
      for(int i=0;i<5;i++){if(i==index)tone=u_rtTones[i].rgb;}
      return tone;
    }
    float rtStrip(float x,float width,float footprint) {
      float phase=fract(x),lo=phase-footprint*.5,hi=phase+footprint*.5;
      return clamp((floor(hi)*width+min(fract(hi),width)
        -floor(lo)*width-min(fract(lo),width))/footprint,0.,1.);
    }
    vec3 rtFactor(vec3 p,vec3 n,vec4 surface,vec3 day,vec3 dark) {
      float h=length(n.xy);
      vec2 across=vec2(-n.y,n.x)/h;
      vec3 down=vec3(n.xy*n.z/h,-h);
      vec2 uv=vec2(dot(p.xy,across),dot(p,down))/u_rtCell.xy;
      vec2 fw=fwidth(uv);
      // Fades use cells per SCREEN pixel: a tile must be large enough to see,
      // not only to sample. Edge smoothing below keeps device pixels.
      vec2 fv=fw*u_rtWeather.w;
      vec2 resolvedAxes=1.-smoothstep(vec2(u_rtFilter.x),vec2(u_rtFilter.y),fv);
      float resolved=1.-smoothstep(u_rtFootprint.z,u_rtFootprint.w,fv.x*fv.y);
      resolved*=1.-smoothstep(u_rtFootprint.x,u_rtFootprint.y,max(fv.x,fv.y));
      vec3 mean=vec3(1);
      if(u_rtHour.w>.5) {
        vec3 target=u_materialP<=.5?mix(u_rtPhoto[0],u_rtPhoto[1],u_materialP*2.):mix(u_rtPhoto[1],u_rtPhoto[2],(u_materialP-.5)*2.);
        vec3 source=mix(day,dark,max(0.,u_materialP*2.-1.));
        mean=target/max(source,vec3(.0001));
      }
      if(max(resolved,max(resolvedAxes.x,resolvedAxes.y))<=0.)return mean;
      float u=fract(uv.x),aa=max(fw.x,.00001);
      float sinc=sin(3.14159265359*aa)/(3.14159265359*aa);
      float cover=.5-.5*cos(u*6.28318530718)*sinc;
      float warp=u_rtShape.w*resolvedAxes.x;
      uv.y+=warp*cover;
      // Filter the scalloped course position too. A neighbour derivative of
      // its sinusoid can vanish at one period per pixel. The chain rule plus
      // the discarded displacement amplitude gives a conservative footprint,
      // without a derivative after the non-uniform early return above.
      float ay=max(fw.y+abs(warp*3.14159265359*sin(u*6.28318530718)*sinc)*fw.x
        +abs(warp)*(1.-abs(sinc)),.00001);
      vec2 coverage=vec2(aa,ay),clayPixels=coverage*u_rtWeather.w;
      resolved=1.-smoothstep(u_rtFootprint.z,u_rtFootprint.w,clayPixels.x*clayPixels.y);
      // Include device pixels even when the screen-pixel factor is below one.
      // The four-cell integral is only valid below one cell along each axis.
      resolved*=1.-smoothstep(u_rtFootprint.x,min(u_rtFootprint.y,1.),
        max(max(clayPixels.x,clayPixels.y),max(coverage.x,coverage.y)));
      vec2 cell=floor(uv);
      vec3 tone=vec3(0);
      // Integrate the piecewise-constant clay field over the pixel footprint.
      // The colour resolves only below one cell per axis. Such a box
      // intersects at most four cells; start at its lower corner, not at
      // the centre cell. No image, mip allocation or extra geometry.
      vec2 footprint=min(coverage,vec2(1.));
      vec2 first=floor(uv-footprint*.5);
      for(int y=0;y<2;y++)for(int x=0;x<2;x++){
        vec2 q=first+vec2(float(x),float(y));
        vec2 overlap=max(vec2(0),min(uv+footprint*.5,q+1.)-max(uv-footprint*.5,q));
        float weight=overlap.x*overlap.y/(footprint.x*footprint.y);
        if(weight>0.)tone+=rtTone(q)*weight;
      }
      // Integrate periodic relief instead of smoothing the nearest edge.
      // This conserves the narrow lip/valley coverage at grazing angles.
      float valley=rtStrip(uv.x+u_rtShape.x*.5,u_rtShape.x,aa);
      float lip=rtStrip(uv.y,u_rtLip.x,ay);
      float highlight=rtStrip(-uv.y,u_rtLip.x,ay);
      // Each relief term has zero area mean. Distant pixels return exactly 1.
      float relief=1.+u_rtShape.z*(cover-.5)-u_rtShape.y*(valley-u_rtShape.x)
        -u_rtLip.y*(lip-u_rtLip.x)+u_rtLip.z*(highlight-u_rtLip.x);
      if(wpHash(cell,u_rtCell.w+4.)<u_rtWeather.x) {
        float stain=rtWeatherNoise(uv*u_rtWeather.yz);
        relief+=stain*u_rtLip.w;
      }
      float contrast=u_materialP<=.5?mix(u_rtHour.x,u_rtHour.y,u_materialP*2.):mix(u_rtHour.y,u_rtHour.z,(u_materialP-.5)*2.);
      // Course foreshortening must not erase a still-resolved column field.
      // Integrated clay uses tile area; relief uses its own axis.
      // All terms converge to the same mean.
      float columnRelief=u_rtShape.z*(cover-.5)-u_rtShape.y*(valley-u_rtShape.x);
      float courseRelief=-u_rtLip.y*(lip-u_rtLip.x)+u_rtLip.z*(highlight-u_rtLip.x);
      float weatherResolved=1.-smoothstep(.2,1.,max(coverage.x*u_rtWeather.y,coverage.y*u_rtWeather.z));
      float weatherRelief=(relief-1.-columnRelief-courseRelief)*weatherResolved;
      vec3 detail=((tone-1.)*resolved+vec3(columnRelief)*resolvedAxes.x
        +vec3(courseRelief)*resolvedAxes.y+vec3(weatherRelief)*min(resolvedAxes.x,resolvedAxes.y))*contrast;
      if(u_rtEdges.x>.5) {
        float crest=1.-smoothstep(0.,u_rtEdges.y,(surface.z-p.z)/h);
        detail=mix(detail,vec3(u_rtEdges.z*cos(uv.x*6.28318530718)),crest);
      }
      if(u_rtEdges.w>.5) {
        float eave=1.-smoothstep(0.,u_rtEave.x,(p.z-surface.y)/h);
        detail-=eave*u_rtEave.y*(1.-cover);
      }
      return mean*(1.+detail*u_rtCell.z);
    }
  `;
  const apply=`
      if(surface.x> -2.5 && surface.x< -1.5 && u_rtOn>.5) {
        vec3 n=normalize(v_normal);
        if(n.z>u_rtFilter.z && n.z<u_rtFilter.w) {
          vec3 factor=rtFactor(v_pos,n,surface,albedo,night);
          baseColor.rgb*=factor;albedo*=factor;night*=factor;
        }
      }
  `;
  window.RoofTiles={glsl,apply,sync};
})();
