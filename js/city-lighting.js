/** Shared lighting for authored meshes and MapLibre city layers.
 * The adapter targets the pinned MapLibre 5.24 extrusion and ground-circle contracts.
 * It does not replace geometry, style filters, picking, LOD or texture atlases.
 * A changed upstream contract fails visibly in diagnostics instead of silently
 * reverting half the city. Both renderers consume the same GLSL and uniforms.
 */
(function () {
  'use strict';
  const stats = {vertexShaders:0, fragmentShaders:0, programs:0, draws:0, poolPrograms:0, poolDraws:0, solidGlassDraws:0, solidLightDraws:0, failures:[], glassImages:0};
  let frame=null, serial=0, fallbackShadow=null;
  // Pattern texels below this alpha are translucent overlays, not glass-coded
  // facade texels (which are 191..255). Anything between the two bands works.
  const OVERLAY_ALPHA=0.70;
  // FAR PATTERN FILTER (moire on distant facades). MapLibre samples the
  // fill-extrusion pattern atlas bilinear with NO mip levels
  // (docs/pattern-sampling.md), so a wall whose texels are smaller than a pixel
  // point-samples its window grid, and MSAA does not help: it multiplies
  // coverage samples, not texture reads. Beyond nearM each pattern read is
  // replaced by the average of up to maxTaps x maxTaps reads spread over the
  // pixel's own footprint on the wall (screen derivatives of the pattern
  // coordinate), faded in by fullM. Where a pixel covers one texel or less it
  // is the single read it always was, and inside nearM nothing changes at all.
  // maxSpacing (texels) keeps each tap within reach of its neighbour's bilinear
  // footprint, so the taps add up to a box. Where a pixel spans more than
  // maxTaps x maxSpacing texels the box stops growing instead of spreading its
  // taps thinner: taps further apart than that are a comb, not a box, and a comb
  // passes some of the window grid's harmonics at full strength. Measured, 2
  // keeps nearly all of the unclamped gain (campus low alias 0.644 unclamped,
  // 0.655 at 2, 0.665 at 1.5, 0.720 with no filter).
  // ?patfilter=0 turns it off, ?patfilter=1 forces it on; CityLighting.patternFilter
  // is live. The phone profile decides from its own budget
  // (js/mobile.js budget.farPatternFilter), never from the card test.
  // cardsOnly: on by default only where js/graphics.js says the browser draws
  // with a graphics card (the Smooth edges test). Timed with each frame's GPU
  // work finished (a synchronous redraw + readPixels, still poses, 10
  // interleaved rounds): on the RTX 3050 Ti the filter is within noise in
  // flight and at most +1.2 ms at the downtown pose (19 ms frames); on the AMD
  // integrated chip +0.7 to +2.5 ms at every pose (30-50 ms frames), so there
  // it stays off. Cheaper settings (maxTaps 2) cost nothing there but made the
  // still-frame bands WORSE than no filter (landing flight moire 0.169 ->
  // 0.175-0.177, pixels in a visible band 0.156% -> 0.182%): a 2-tap comb.
  // Screen size needs no budget: a bigger screen gives each pixel fewer texels,
  // so fewer taps per pixel for more pixels.
  const patternFilterQuery=new URLSearchParams(location.search).get('patfilter');
  const patternFilter={nearM:150,fullM:250,maxTaps:4,maxSpacing:2,cardsOnly:true};
  patternFilter.on=patternFilterQuery==='1'||(patternFilterQuery!=='0'&&(window.LITE_PROFILE?.on
    ? !!window.LITE_PROFILE.budget?.farPatternFilter
    : (!patternFilter.cardsOnly||!!window.GFX_GPU_CARD?.())));
  // Compiled in only where it is on at load. Elsewhere the pattern shader is
  // MapLibre's own, exactly as before, so the integrated chip pays nothing,
  // not even the registers. A live `on` switch works only where it compiled.
  patternFilter.compiled=patternFilter.on;
  // Diffuse sky fill, in linear light. Upward-facing surfaces see more sky.
  // Shared by both building renderers; zeroes reproduce the previous balance.
  const balance={skyFill:0.12,roofFill:0.08};
  // Opt-in material layers keep ordinary solid extrusions on their original
  // path. No color/luma heuristic can turn an unrelated wall into a light.
  const solidSurfaceFor=id=>id==='outer-landmark-glass'?1:id==='outer-landmark-light'?2:id==='heroes-gdc-glass'?3:0;
  const campusMaterials={gdcReflection:.35};
  // Facade-sized geometry establishes the silhouette. Subpixel floor edges and
  // mullions use integrated pixel coverage instead of binary triangle hits.
  // These are the same fitted storey zones as downtown_landmarks.py.
  const landmarkMaterials={reflection:.32,frameWidth:.24,frameShade:.6,
    waterline:{center:[-97.739542,30.261083],colour:[.686,.725,.741],zones:[[9.144,50,12,3.3],[50,177,27,3.6],[187,302,33,3.15]],band:.28},
    sixth:{center:[-97.74669,30.269654],colour:[.396,.447,.478],zones:[[18.7,119,22,3.1],[126,257,37,3.2]],band:.30},
    bearing:18,nightFrame:[.055,.07,.085],balconyShade:.58,balconyRail:.14,balconyRailHeight:1.1};
  const uniforms = `
    uniform vec3 u_eye;
    uniform vec4 u_sunlight;
    uniform float u_glassStrength;
    uniform vec2 u_citySkyFill;
    uniform vec4 u_cityNight;
    uniform float u_citySolidSurface;
    uniform vec4 u_cityLandmarkOrigins;
    uniform vec4 u_cityCrown, u_cityCrownColour;
    uniform vec3 u_sunDirection, u_sunColour, u_shadeColour;
    uniform vec3 u_skyZenith, u_skyHorizon, u_sunsetColour, u_groundColour;
    uniform vec4 u_glassSun, u_reflectionSky;
    uniform vec2 u_sunPresence;
    uniform sampler2D u_sunShadow0, u_sunShadow1;
    uniform mat4 u_sunShadowMatrix0, u_sunShadowMatrix1;
    uniform vec4 u_shadowSettings;
    uniform vec4 u_cityPatternFilter, u_cityPatternFilterB;
    uniform vec4 u_cityEye, u_cityEye2;
    ${Array.from({length:8},(_,i)=>`uniform vec4 u_cityFixture${i}, u_cityFixtureColour${i};`).join('\n')}
  `;
  // The pattern fragment only (see patternFilter). `point` is MapLibre's own
  // read; v is the pattern coordinate in repeats; tl/br the image's corners in
  // atlas UV. Derivatives are taken before any branch that varies per pixel.
  const patternFilterGlsl = `
    vec4 cityPatternTexel(sampler2D img,vec4 point,vec2 v,vec2 tl,vec2 br,vec2 texsize,float dist){
      vec2 dx=dFdx(v),dy=dFdy(v);
      if(u_cityPatternFilter.x<.5)return point;
      float fade=smoothstep(u_cityPatternFilter.y,u_cityPatternFilter.z,dist);
      if(fade<=0.0)return point;
      vec2 texels=(br-tl)*texsize;
      float fx=length(dx*texels),fy=length(dy*texels);
      float nx=clamp(ceil(fx),1.0,u_cityPatternFilter.w),ny=clamp(ceil(fy),1.0,u_cityPatternFilter.w);
      if(nx*ny<=1.0)return point;
      dx*=min(1.0,nx*u_cityPatternFilterB.x/max(fx,1e-4));
      dy*=min(1.0,ny*u_cityPatternFilterB.x/max(fy,1e-4));
      vec4 sum=vec4(0.0);
      for(int i=0;i<${patternFilter.maxTaps};i++){
        if(float(i)>=nx)break;
        for(int j=0;j<${patternFilter.maxTaps};j++){
          if(float(j)>=ny)break;
          vec2 at=v+dx*((float(i)+.5)/nx-.5)+dy*((float(j)+.5)/ny-.5);
          sum+=textureLod(img,mix(tl,br,fract(at)),0.0);
        }
      }
      return mix(point,sum/(nx*ny),fade);
    }`;
  const E=window.CityNight?.eye||{footprintM:[4,14],hz:[2.0,6.0],colourWobble:.45,switchS:[150,900],offBase:.045,lateDropout:.18,officeExtra:1.3,nearM:250,farM:2000};
  const glsl = `
    vec3 linearColour(vec3 c) { return pow(max(c,vec3(0.0)),vec3(2.2)); }
    vec3 displayColour(vec3 c) { return pow(max(c,vec3(0.0)),vec3(1.0/2.2)); }
    // Integral of a periodic unit-height strip; the difference at pixel
    // boundaries preserves area even when several strips fit inside a pixel.
    float stripIntegral(float x,float width){return floor(x)*width+min(fract(x),width);}
    float stripCoverage(float position,float pitch,float width){
      float x=position/pitch,w=width/pitch,dx=max(fwidth(position)/pitch,.0001);
      return clamp((stripIntegral(x+.5*dx,w)-stripIntegral(x-.5*dx,w))/dx,0.0,1.0);
    }
    float landmarkBalcony(vec3 pos,vec3 normal){
      vec2 d=pos.xy-u_cityLandmarkOrigins.zw;
      float c=${Math.cos(landmarkMaterials.bearing*Math.PI/180).toFixed(8)},s=${Math.sin(landmarkMaterials.bearing*Math.PI/180).toFixed(8)};
      vec2 local=vec2(c*d.x-s*d.y,s*d.x+c*d.y);
      return step(126.0,pos.z)*(1.0-step(257.0,pos.z))*step(-20.6,local.x)*(1.0-step(10.4,local.x))*step(32.0,local.y)*step(.5,s*normal.x+c*normal.y);
    }
    vec4 landmarkGrid(vec3 pos,vec3 normal){
      if(abs(normal.z)>.5)return vec4(0.0);
      bool waterline=length(pos.xy-u_cityLandmarkOrigins.xy)<length(pos.xy-u_cityLandmarkOrigins.zw);
      vec4 zone=vec4(0.0);
      if(waterline){
        ${landmarkMaterials.waterline.zones.map(z=>`if(pos.z>=${z[0].toFixed(3)}&&pos.z<${z[1].toFixed(3)})zone=vec4(${z[0].toFixed(3)},${((z[1]-z[0])/z[2]).toFixed(6)},${z[3].toFixed(3)},${landmarkMaterials.waterline.band.toFixed(3)});`).join('\n')}
      }else{
        ${landmarkMaterials.sixth.zones.map(z=>`if(pos.z>=${z[0].toFixed(3)}&&pos.z<${z[1].toFixed(3)})zone=vec4(${z[0].toFixed(3)},${((z[1]-z[0])/z[2]).toFixed(6)},${z[3].toFixed(3)},${landmarkMaterials.sixth.band.toFixed(3)});`).join('\n')}
      }
      if(zone.y<=0.0)return vec4(0.0);
      vec2 d=pos.xy-(waterline?u_cityLandmarkOrigins.xy:u_cityLandmarkOrigins.zw);
      float c=${Math.cos(landmarkMaterials.bearing*Math.PI/180).toFixed(8)},s=${Math.sin(landmarkMaterials.bearing*Math.PI/180).toFixed(8)};
      vec2 local=vec2(c*d.x-s*d.y,s*d.x+c*d.y);
      vec2 n=vec2(c*normal.x-s*normal.y,s*normal.x+c*normal.y);
      float along=abs(n.x)>abs(n.y)?local.y:local.x;
      float horizontal=stripCoverage(pos.z-zone.x,zone.y,zone.w);
      float vertical=stripCoverage(along,zone.z,${landmarkMaterials.frameWidth.toFixed(3)});
      if(landmarkBalcony(pos,normal)>.5){
        horizontal=max(horizontal,stripCoverage(pos.z-zone.x-${landmarkMaterials.balconyRailHeight.toFixed(3)},zone.y,${landmarkMaterials.balconyRail.toFixed(3)}));
        vertical=stripCoverage(local.x+20.6,31.0/9.0,${landmarkMaterials.frameWidth.toFixed(3)});
      }
      float coverage=horizontal+vertical-horizontal*vertical;
      vec3 tint=waterline?vec3(${landmarkMaterials.waterline.colour.join(',')}):vec3(${landmarkMaterials.sixth.colour.join(',')});
      return vec4(mix(tint,vec3(${landmarkMaterials.nightFrame.join(',')}),u_cityNight.x),coverage);
    }
    vec3 fixtureLight(vec3 pos,vec3 normal,vec4 fixture,vec4 colour) {
      if(fixture.w<=0.0)return vec3(0.0);
      vec3 delta=fixture.xyz-pos;float dist=length(delta);
      if(dist>=fixture.w)return vec3(0.0);
      float falloff=1.0-dist/fixture.w;falloff*=falloff;
      // Downlights: stop above the fixture and keep the beam off rear faces.
      float cone=smoothstep(${window.CityNight?.tune.downlightCone[0]??-.05},${window.CityNight?.tune.downlightCone[1]??.25},delta.z/max(dist,.01));
      return colour.rgb*colour.a*falloff*cone*max(0.0,dot(normal,delta/max(dist,.01)));
    }
    vec3 cityLocalLight(vec3 base,vec3 reflectance,vec3 pos,vec3 normal,float glass) {
      if(u_cityNight.x<=0.0||glass>.5)return base;
      vec3 light=vec3(0.0),n=normalize(normal);
      ${Array.from({length:8},(_,i)=>`light+=fixtureLight(pos,n,u_cityFixture${i},u_cityFixtureColour${i});`).join('\n')}
      return displayColour(linearColour(base)+linearColour(reflectance)*light*u_cityNight.x*(1.0-glass));
    }
    // A named architectural crown, bounded to its existing model footprint and
    // height. Both renderers see the same volume; no screen-space glow decal.
    vec3 cityCrown(vec3 base,vec3 pos,vec3 normal) {
      if(u_cityNight.x<=0.0||u_cityCrown.w<=0.0)return base;
      float footprint=1.0-step(u_cityCrown.w,length(pos.xy-u_cityCrown.xy));
      float height=step(u_cityCrown.z,pos.z)*(1.0-step(u_cityCrownColour.w,pos.z));
      if(footprint*height<=0.0)return base;
      return mix(base,max(base,u_cityCrownColour.rgb*(${(window.CityNight?.crown.ambient??.4).toFixed(3)}+${(1-(window.CityNight?.crown.ambient??.4)).toFixed(3)}*max(0.0,dot(normalize(normal),normalize(vec3(${(window.CityNight?.crown.direction??[.3,-.6,.7]).join(',')})))))),footprint*height*u_cityNight.x);
    }
    // A window is a source, not a wall painted yellow under blue moonlight.
    // Only semantically tagged glass / light fixtures enter this path.
    vec3 cityEmission(vec3 base,vec3 source,float mask) {
      if(u_cityNight.x<=0.0||mask<=0.0)return base;
      float lit=smoothstep(u_cityNight.z,u_cityNight.w,dot(source,vec3(.2126,.7152,.0722)));
      return mix(base,max(base,source*u_cityNight.y),u_cityNight.x*mask*lit);
    }

    // THE EYE AT NIGHT (docs/night-eye-2026-10-10.md). A lit window carries its own colour, and that colour is a
    // stable per-window name (the room palette hashes every window), so hashing it names the window without any
    // geometry. Returns the factor on the window's emission: brightness in all three channels, with a red/blue
    // swing riding on the shimmer. Everything is a function of (name, seconds): no memory, no per-frame CPU.
    highp uvec3 cityPcg(highp uvec3 v){v=v*1664525u+1013904223u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;v^=v>>16u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;return v;}
    vec3 cityEyeGain(vec3 pos,vec3 src) {
      int bits=int(u_cityEye2.w+.5);
      if(bits==0||u_cityNight.x<=0.0)return vec3(1.0);
      // src.r < 0 means 'no per-window colour here' (a solid glass tower): the window is named by its place in a 2.8 m x 3.4 m grid instead.
      bool placed=src.r<0.0;
      if(!placed&&dot(src,vec3(.2126,.7152,.0722))<u_cityNight.z)return vec3(1.0);
      // The name drops the low 3 bits of each channel: a filtered edge pixel (a window blended with its wall) then keeps
      // its neighbour's name more often, so a camera move does not re-roll a window's bedtime. A name still cannot tell
      // two windows of one colour apart; the 37 m cell and the position phase do that.
      highp uvec3 q=uvec3(clamp(floor(src*255.0+.5),0.0,255.0))>>3u;
      highp uvec3 h=placed?cityPcg(uvec3(ivec3(floor(pos/vec3(2.8,2.8,3.4)))+ivec3(8192))):cityPcg(uvec3(q.r|(q.g<<5u)|(q.b<<10u),9157u,23501u));
      highp uvec3 h2=cityPcg(h^uvec3(1752346532u));
      vec3 f=vec3(h>>8u)/16777216.0,g=vec3(h2>>8u)/16777216.0;
      highp uvec3 hc=cityPcg(uvec3(ivec3(floor(pos/vec3(37.0,37.0,11.0)))+ivec3(4096)));
      float cell=float(hc.x>>8u)/16777216.0;
      float t=u_cityEye.x,gain=1.0;vec3 tint=vec3(1.0);
      if((bits&1)!=0) {
        float d=distance(u_eye,pos);
        float amp=u_cityEye.y*smoothstep(u_cityEye2.y,u_cityEye2.z,d)*(1.0-smoothstep(${E.footprintM[0].toFixed(2)},${E.footprintM[1].toFixed(2)},d*u_cityEye.z));
        if(amp>0.0) {
          float ph=dot(pos,vec3(.093,.071,.137));
          float w1=mix(${E.hz[0].toFixed(3)},${E.hz[1].toFixed(3)},f.y),w2=mix(${E.hz[0].toFixed(3)},${E.hz[1].toFixed(3)},f.z),w3=mix(${E.hz[0].toFixed(3)},${E.hz[1].toFixed(3)},g.z);
          float n=sin(6.2831853*(w1*t+g.x)+ph)+sin(6.2831853*(w2*t+g.y)+ph*1.7);
          float m=sin(6.2831853*(w3*t+f.x)+ph*.6);
          gain=max(.15,1.0+amp*n);
          tint=vec3(1.0+${E.colourWobble.toFixed(3)}*amp*m,1.0,1.0-${E.colourWobble.toFixed(3)}*amp*m);
        }
      }
      if((bits&2)!=0) {
        // Slow change. Window name and 37 m cell only (no position gradient: a transition must not sweep across one window).
        float period=mix(${E.switchS[0].toFixed(1)},${E.switchS[1].toFixed(1)},f.y);
        float k=fract(t/period+g.z+f.x*7.0+cell*3.0);
        float rest=smoothstep(${(1-E.offBase-.01).toFixed(3)},${(1-E.offBase).toFixed(3)},k)*(1.0-smoothstep(.99,1.0,k));
        float office=smoothstep(-.02,.06,src.b-src.r);
        float dark=u_cityEye.w*${E.lateDropout.toFixed(3)}*(1.0+${E.officeExtra.toFixed(3)}*office);
        float bed=fract(f.x+cell);
        gain*=(1.0-rest)*(1.0-smoothstep(bed,bed+.05,dark));
      }
      return gain*tint;
    }
    vec3 reflectedSky(vec3 r) {
      float height=smoothstep(0.0,u_reflectionSky.x,max(r.z,0.0));
      vec3 sky=mix(u_skyHorizon,u_skyZenith,height);
      vec2 sunH=normalize(u_sunDirection.xy+vec2(.00001));
      vec2 rayH=normalize(r.xy+vec2(.00001));
      float azimuth=pow(max(dot(rayH,sunH),0.0),u_reflectionSky.y);
      float warmth=azimuth*(1.0-height)*u_sunPresence.y*u_reflectionSky.z;
      sky=mix(sky,u_sunsetColour,clamp(warmth,0.0,1.0));
      return mix(u_groundColour,sky,smoothstep(-u_reflectionSky.w,u_reflectionSky.w,r.z));
    }
    float shadowSample(sampler2D shadowMap,vec3 p) {
      float light=0.0;
      for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {
        // Three r159 RGBADepthPacking, also used by the extrusion adapter.
        float depth=unpackRGBAToDepth(texture2D(shadowMap,p.xy+vec2(float(x),float(y))*u_shadowSettings.y));
        light+=step(p.z-u_shadowSettings.z,depth);
      }
      return light/9.0;
    }
    // One shadow-map texel in metres, read off the map's own matrix: an
    // orthographic row's xyz length is 1/radius.
    float shadowTexel(mat4 m){return 2.0*u_shadowSettings.y/length(vec3(m[0][0],m[1][0],m[2][0]));}
    float sunlightVisibility(vec3 pos,vec3 n) {
      if(u_shadowSettings.x<.5)return 1.0;
      // The 3x3 kernel reaches ~1.9 texels from the receiver, and a surface
      // tilted theta from the sun changes depth by tan(theta) per texel, so a
      // fixed 9 cm offset let tilted lit faces shadow themselves: at midday
      // the mean visibility of sun-facing campus pixels was 0.77-0.82, and
      // 0.93-0.95 with this offset (docs/dark-campus-diagnosis.md; a planar
      // model predicts 0.62-0.74 near, ~0.53 far). Offsetting 2 texels * sin(theta)
      // along the normal clears the kernel; a sun-facing wall (theta ~ 0)
      // keeps the small constant offset and its contact shadows.
      float cosSun=clamp(dot(n,u_sunDirection),0.0,1.0),sinSun=sqrt(1.0-cosSun*cosSun);
      vec4 nearClip=u_sunShadowMatrix0*vec4(pos+n*(u_shadowSettings.w+2.0*shadowTexel(u_sunShadowMatrix0)*sinSun),1.0);
      vec3 a=nearClip.xyz/nearClip.w*.5+.5;
      // Nested, camera-following maps. Never select by building name/location.
      float nearEdge=min(min(a.x,1.0-a.x),min(a.y,1.0-a.y));
      if(nearEdge>.07&&a.z>0.0&&a.z<1.0)return shadowSample(u_sunShadow0,a);
      vec4 farClip=u_sunShadowMatrix1*vec4(pos+n*(u_shadowSettings.w+2.0*shadowTexel(u_sunShadowMatrix1)*sinSun),1.0);
      vec3 b=farClip.xyz/farClip.w*.5+.5;
      if(any(lessThan(b,vec3(0.0)))||any(greaterThan(b,vec3(1.0))))return 1.0;
      float farEdge=min(min(b.x,1.0-b.x),min(b.y,1.0-b.y));
      float distant=mix(1.0,shadowSample(u_sunShadow1,b),smoothstep(0.0,.03,farEdge));
      if(nearEdge>.02&&a.z>0.0&&a.z<1.0)return mix(distant,shadowSample(u_sunShadow0,a),smoothstep(.02,.07,nearEdge));
      return distant;
    }
    vec3 cityShade(vec3 original,vec3 albedo,vec3 pos,vec3 normal,float glass) {
      if(u_sunlight.x<.5||u_sunPresence.x<=0.0)return original;
      vec3 n=normalize(normal),view=normalize(u_eye-pos);
      float facing=max(dot(n,u_sunDirection),0.0);
      float visibility=sunlightVisibility(pos,n);
      float skyFill=u_citySkyFill.x+u_citySkyFill.y*max(n.z,0.0);
      vec3 diffuse=linearColour(albedo)*(linearColour(u_shadeColour)*(u_sunlight.y+skyFill)+
        linearColour(u_sunColour)*facing*visibility*u_sunlight.z);
      if(glass>0.0) {
        vec3 reflected=reflect(-view,n);
        float fresnel=pow(1.0-clamp(abs(dot(n,view)),0.0,1.0),5.0);
        float reflectance=clamp(mix(u_sunlight.w,1.0,fresnel)*glass*u_glassStrength,0.0,1.0);
        vec3 environment=linearColour(reflectedSky(reflected));
        float alignment=max(dot(reflected,u_sunDirection),0.0);
        float highlight=pow(alignment,u_glassSun.y)*u_glassSun.x+
                        pow(alignment,u_glassSun.z)*u_glassSun.w;
        environment+=linearColour(u_sunColour)*highlight*visibility*smoothstep(0.0,.08,facing);
        diffuse=mix(diffuse,environment,reflectance);
      }
      return mix(original,displayColour(diffuse),u_sunPresence.x);
    }
  `;

  // Opaque facade atlases reserve alpha 191 for glass. RGB remains straight
  // (MapLibre's raw RGBA image contract). The shader restores opaque alpha;
  // filtering the mask with the colour retains anti-aliased mullion edges.
  function glassRect(ctx,x,y,w,h) {
    ctx.save();ctx.clearRect(x,y,w,h);ctx.globalAlpha=191/255;
    ctx.fillRect(x,y,w,h);ctx.restore();
  }
  function glassColour(colour) {
    const result=colour.slice();
    result.surface=window.APARTMENTS?.materials?.glass||[4,1,1,1];
    return result;
  }
  // The older band atlases publish their drawing dimensions. Read those
  // dimensions for a semantic mask, rather than mistaking dark brick/signs
  // for glass. This keeps the Drag lane's implementation and ownership intact.
  function bandGlassImage(id,image) {
    const family=/^dg-([^-]+)-/.exec(id)?.[1],T=window.DRAG_T;
    const places=id==='pl-glass',size=image?.width;
    if(!image?.data||(!places&&!['shopGlass','pclCoffer','uniWin','uniArcade'].includes(family)))return image;
    if(!places&&!T)return image;
    const mask=new Uint8ClampedArray(size*image.height*4),columns=new Uint8Array(size);
    if(places||family==='shopGlass') {
      columns.fill(1);const pitch=places?window.PLACES_T.MULL:T.SHOP_MULL;
      for(let x=0;x<size;x+=pitch)columns[x]=0;
    } else {
      const bays=family==='pclCoffer'?T.PCL_BAYS:family==='uniWin'?T.UNI_WIN_BAYS:T.UNI_BAYS;
      const width=family==='pclCoffer'?T.PCL_GLASS:family==='uniWin'?T.UNI_WIN_W:T.UNI_VOID;
      for(let b=0;b<bays;b++) {
        const start=Math.round(b*size/bays+(family==='pclCoffer'?0:(size/bays-width)/2));
        for(let x=start+1;x<start+width;x++)columns[(x+size)%size]=1;
      }
    }
    for(let y=0;y<image.height;y++)for(let x=0;x<size;x++)mask[(y*size+x)*4+3]=columns[x]?191:255;
    const soften=places?window.PLACES_SOFTEN:window.DRAG_SOFTEN,key=places?'plGlass':family;
    window.PatternLowpass.blurWrap(mask,size,soften?.RADIUS[key]||0,soften?.AMOUNT[key]??1);
    const data=new Uint8Array(image.data);
    for(let i=3;i<data.length;i+=4)data[i]=mask[i];
    stats.glassImages++;return {...image,data};
  }
  let buildings=[],proxy=null,proxyDirty=true,proxyTimer=null,proxyMap=null,proxySigBuilt=null;
  // Only what is DRAWN may cast. The Tower, hero, Drag, arts, Moody and West
  // Campus passes draw their own buildings and hide the legacy prism with the
  // shared ['!',['in',['get','id'],['literal',ids]]] clause on buildings-3d.
  // Before 2026-09-19 those hidden prisms still cast (the Tower's was a 94 m
  // block over the whole 79 x 87 m Main Building, darkening its roofs, the
  // shaft and a 900 m golden-hour streak), while the geometry actually drawn
  // cast nothing. docs/dark-campus-diagnosis.md has the measurements.
  //
  // ADDING A PASS: if your pass hides legacy prisms on buildings-3d, its source
  // MUST be listed here or those buildings will cast no shadow at all — the
  // prism is skipped and nothing replaces it, which is the same bug the other
  // way round. Volumes only: detail overlays that sit ON a building already
  // counted here (austin-places, austin-entrances, austin-roofs,
  // austin-roofscape, campus-storeys) are deliberately left out, because they
  // would add coincident geometry to the shadow map for nothing.
  // scripts/verify/dark-campus.mjs asserts the skip list is non-empty.
  const casterSources=['austin-outer','austin-parts','austin-stadium','austin-tower','austin-heroes','austin-drag','austin-arts','austin-moody','austin-westcampus'];
  function hiddenIds(filter,out=new Set()) {
    if(!Array.isArray(filter))return out;
    if(filter[0]==='all'){for(const f of filter.slice(1))hiddenIds(f,out);return out;}
    const m=filter[0]==='!'&&filter[1];
    if(Array.isArray(m)&&m[0]==='in'&&m[1]?.[0]==='get'&&m[1][1]==='id'&&m[2]?.[0]==='literal')for(const id of m[2][1])out.add(id);
    return out;
  }
  function shadowProxy(map) {
    if(!proxyMap) {
      proxyMap=map;
      map.on('sourcedata',e=>{if(casterSources.includes(e.sourceId))proxyDirty=true;});
      // The proxy is built from the tiles MapLibre is drawing, so moving the
      // camera changes it only by changing that tile set: a move asks for a
      // CHECK (proxyInputs), never a rebuild on its own, and nothing is
      // checked or rebuilt until the camera is still. Until 2026-09-23 every
      // moveend marked the proxy dirty. The flycam flies by one jumpTo per
      // frame and each jumpTo ends in a moveend, so a flight rebuilt the proxy
      // every ~1.5 s, each rebuild a 1.0-1.4 s stall of the main thread: 73-76 %
      // of a boost's wall time on both GPUs, the owner's "freeze, then a burst"
      // (astra-pipe research/frame-cost.md, section 8, fix 1).
      map.on('move',()=>{proxyMovedAt=Date.now();});
      map.on('moveend',()=>{proxyMovedAt=Date.now();proxyViewMoved=true;});
      map.on('remove',()=>{clearTimeout(proxyTimer);proxyTimer=null;proxyJob=null;stats.shadowProxyBuilding=false;proxyDirty=true;proxySigBuilt=null;proxyViewMoved=false;proxyMovedAt=0;proxyInputs=null;proxy?.geometry.dispose();proxy?.material.dispose();proxy=null;proxyMap=null;});
    }
    if(!sameList(proxySignature(map),proxySigBuilt))proxyDirty=true;
    if((proxyDirty||proxyViewMoved)&&!proxyTimer&&!map.isMoving())proxyTimer=setTimeout(()=>proxyRebuild(map),PROXY_PACE.settleMs);
    return proxy;
  }
  // What the proxy reads from the authored apartments and the base layer,
  // checked every frame: the catalogue whose footprints and ids it leaves out
  // (a new object whenever an area attaches or detaches), the switch, the
  // buildings-3d filter it takes the hide list from (its source is not a
  // caster, so no sourcedata reports it) and the authored triangle count,
  // which moves only when a build lands or an area comes and goes.
  // Until 2026-09-28 this was count.buildings, which rises once per building
  // DURING the time-sliced build. The proxy uses none of that progress, but
  // it rebuilt the proxy every ~2.5 s of the build under the veil, the same
  // mesh each time: 11-12 rebuilds, ~8.5 s of main thread. Measured on the
  // AMD iGPU, 3 interleaved pairs: 6-8 rebuilds (~2.4 s) remain, all from
  // tiles arriving (sourcedata), and the veil lifts at 38.0-40.0 s, not
  // 44.3-46.1 s (speed night 09-28, shadow-proxy-no-storm).
  // map.getLayer throws while the map has no style (a context restore).
  const proxySignature=map=>{
    const A=window.slopesApartments;
    return [A?.count.triangles,window.APARTMENTS?.on,proxyRef(A?.data?.buildings),proxyRef(map.style?map.getLayer?.('buildings-3d')?.filter:undefined)];
  };
  const sameList=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  // settleMs: how long the camera must have been still (no move event, no
  // camera animation, the flycam not driving) before the proxy is checked
  // or rebuilt. It was the old fixed delay after a moveend, so a camera that
  // stops gets the rebuild it always got, at the same moment.
  // budgetMs: the rebuild runs in slices of about this much main thread, one
  // task each, so frames keep being drawn while it works (proxyGeometry). 0
  // builds in one piece, as before 2026-09-28. MEASURED before slicing, the
  // one piece was a stall of the still picture ~0.3 s after every turn or
  // flight that changed the drawn caster tiles (TURN-LAG lane, turnmeter.mjs
  // "stop"). A slice can run over its budget by one indivisible step (one
  // tile query, one polygon); stats.shadowProxyMaxSliceMs records by how much.
  // stretchMs / maxBudgetMs: a slice runs between two frames, so when frames
  // are slow the build takes (slices x frame time): 52 s once, on a loaded
  // machine at ~4 fps. For every stretchMs a build has been running (camera
  // pauses not counted) the slice budget doubles, up to maxBudgetMs, so a slow
  // machine finishes in a few seconds at the price of a few longer frames.
  // yieldMs: the pause between slices. trustLayerFilters: query each layer
  // with the filter MapLibre already validated when that layer was added
  // (validate:false). MapLibre 5.24 otherwise re-validates a query filter by
  // serialising the WHOLE style, once per caster layer per rebuild; the
  // features returned are the same either way. (Ported from Codex's
  // codex/overnight-shadow-proxy 75930c7 onto this file's current rebuild.)
  const PROXY_PACE={settleMs:300,budgetMs:5,stretchMs:1000,maxBudgetMs:40,yieldMs:0,trustLayerFilters:true};
  let proxyMovedAt=0,proxyViewMoved=false,proxyInputs=null,proxyJob=null;
  const proxyNow=()=>globalThis.performance?.now?.()??Date.now();
  // Everything a rebuild reads, as a flat list compared entry by entry: the
  // drawn tiles of every caster source and each tile's decoded data (what
  // querySourceFeatures walks), the fill-extrusion layers that draw those
  // sources (filter, visibility), the base layer's hide list, the legacy
  // prisms and the authored set. Equal lists build an identical proxy. Objects
  // enter as small ids, so an evicted tile is not kept alive by the list.
  // null means "cannot tell" (a MapLibre without these internals): rebuild.
  const proxyRefIds=new WeakMap();let proxyRefNext=0;
  const proxyRef=o=>o&&typeof o==='object'?proxyRefIds.get(o)??(proxyRefIds.set(o,++proxyRefNext),proxyRefNext):o;
  function proxyKey(map,signature) {
    const caches=map.style?.tileManagers||map.style?.sourceCaches;
    if(!caches||typeof map.getLayersOrder!=='function'||typeof map.getLayer!=='function')return null;
    const key=[...signature,proxyRef(buildings)];
    for(const source of casterSources) {
      key.push(source);
      if(!map.getSource(source))continue;
      const cache=caches[source];
      if(typeof cache?.getRenderableIds!=='function'||typeof cache.getTileByID!=='function')return null;
      for(const id of cache.getRenderableIds())key.push(id,proxyRef(cache.getTileByID(id)?.latestFeatureIndex));
    }
    for(const id of map.getLayersOrder()) {
      const l=map.getLayer(id);
      if(l?.type==='fill-extrusion'&&casterSources.includes(l.source))key.push(id,l.sourceLayer,proxyRef(l.filter),l.visibility);
    }
    return key;
  }
  function proxyRebuild(map) {
    proxyTimer=null;
    if(proxyMap!==map)return;
    // Never mid-flight. Re-arm while anything is moving the camera; the
    // rebuild waits for the flight to end instead of stalling inside it.
    // A build already under way is paused the same way, not thrown away.
    const flying=map.isMoving()||!!window.__fly?.eye?.().driving;
    const wait=flying?PROXY_PACE.settleMs:PROXY_PACE.settleMs-(Date.now()-proxyMovedAt);
    if(wait>0){if(proxyJob&&!proxyJob.paused){proxyJob.paused=true;proxyJob.activeMs+=proxyNow()-proxyJob.runStart;}proxyTimer=setTimeout(()=>proxyRebuild(map),wait);return;}
    let job=proxyJob;
    // A paused build resumes only if nothing it reads has changed since it
    // started; otherwise it is dropped and a fresh one starts from today's
    // tiles. (No check between ordinary slices: the camera has not moved.)
    if(job?.paused) {
      const signature=proxySignature(map),inputs=proxyKey(map,signature);
      if(job.inputs&&map.style===job.styleOwner&&sameList(inputs,job.inputs)&&sameList(signature,job.signature)){job.paused=false;job.runStart=proxyNow();}
      else{proxyJob=job=null;proxyDirty=true;stats.shadowProxyBuilding=false;stats.shadowProxyRestarts=(stats.shadowProxyRestarts||0)+1;}
    }
    if(!job) {
      const signature=proxySignature(map);
      const inputs=proxyKey(map,signature);
      // Source notifications (including image/paint updates) ask for a check,
      // not new geometry. Compare against the last SUCCESSFUL commit, even
      // when dirty; actual tile data, filters and authored changes remain keyed.
      if(proxy&&sameList(signature,proxySigBuilt)&&inputs&&sameList(inputs,proxyInputs)){proxyDirty=false;proxyViewMoved=false;return;}
      // A restored context briefly has no style while MapLibre rebuilds it.
      // Keep the rebuild pending; neither discard the existing proxy nor read
      // layers until the replacement style is available.
      const style=proxyStyleLayers(map);
      if(!style){proxyDirty=true;return;}
      proxyDirty=false;proxyViewMoved=false;
      job=proxyJob={map,style,signature,inputs,styleOwner:map.style,started:proxyNow(),runStart:proxyNow(),activeMs:0,slices:0,paused:false};
      job.steps=proxyGeometry(job);stats.shadowProxyBuilding=true;
    }
    const started=proxyNow();
    const P=PROXY_PACE,budget=Math.min(Math.max(P.budgetMs,P.maxBudgetMs||0),P.budgetMs*2**Math.floor((job.activeMs+started-job.runStart)/(P.stretchMs||Infinity)));
    try {
      for(;;) {
        const step=job.steps.next();
        if(step.done){proxyCommit(map,job,step.value);return;}
        // Bound CPU work, not the number of layer queries. Forcing a fresh
        // task for every query costs one software-rendered frame per layer
        // even when queries are cheap, defeating the stretched time budget.
        // An indivisible query/polygon may overrun by one step, as before.
        if(budget>0&&proxyNow()-started>=budget)break;
      }
    } catch(e) {
      const m=e.message||String(e);if(!(stats.failures??=[]).includes(m)){stats.failures.push(m);console.error('[city-lighting]',m);}
      proxyJob=null;proxyDirty=true;stats.shadowProxyBuilding=false;return;
    } finally {
      const ms=proxyNow()-started;job.slices++;
      stats.shadowProxySlices=(stats.shadowProxySlices||0)+1;
      stats.shadowProxyMaxSliceMs=Math.max(stats.shadowProxyMaxSliceMs||0,ms);
    }
    proxyTimer=setTimeout(()=>proxyRebuild(map),PROXY_PACE.yieldMs);
  }
  // The rebuild, one small step per `yield`: the same features, the same
  // order, the same triangles and so the same bytes as the one-piece build it
  // replaced (proxyHash compares them), only interruptible.
  function* proxyGeometry(job) {
    const map=job.map,style=job.style,T=window.THREE,S=window.slopes,seen=new Set();
    const authored=window.APARTMENTS?.on?window.slopesApartments?.data?.buildings||[]:[];
    const ids=new Set(authored.map(b=>b.id)),insideAuthored=footprintLookup(authored.map(b=>b.footprint?.ring).filter(Boolean));
    yield;
    // The displayed base layer suppresses parent prisms with detailed parts,
    // and replaced prisms by id (see casterSources).
    const hidden=hiddenIds(style.find(l=>l.id==='buildings-3d')?.filter);
    const features=[];let hiddenCount=0,n=0;
    for(const f of buildings) {
      if(!f.properties?.has_parts){if(hidden.has(f.properties?.id))hiddenCount++;else features.push(f);}
      if(++n%1024===0)yield;
    }
    job.hidden=hiddenCount;
    const trust=PROXY_PACE.trustLayerFilters&&window.maplibregl?.getVersion?.()==='5.24.0';
    for(const source of casterSources) {
      if(!map.getSource(source))continue;
      // Each visible layer with its own display filter: a part, deck or
      // detail that no layer draws does not cast.
      for(const l of style) {
        if(l.type!=='fill-extrusion'||l.source!==source||l.visibility==='none')continue;
        yield true;
        const o={};if(l.sourceLayer)o.sourceLayer=l.sourceLayer;if(l.filter)o.filter=l.filter;
        // Only the exact filter object the live layer draws with, which
        // MapLibre validated when it was set.
        if(trust&&o.filter&&map.getLayer?.(l.id)?.filter===o.filter)o.validate=false;
        try{features.push(...map.querySourceFeatures(source,o));}catch(e){const m='shadow proxy '+l.id+': '+e.message;if(!(stats.failures??=[]).includes(m)){stats.failures.push(m);console.error('[city-lighting]',m);}}
        yield;
      }
    }
    // Triangles go straight into Float32 chunks: the bytes a Float32 copy of
    // the old number array held, without the number array.
    const CHUNK=9*1024,chunks=[];let chunk=null,used=0,length=0,sinceYield=0;
    const local=p=>{const v=S.toLocal(p[0],p[1],0);return new T.Vector2(v.x,v.y);};
    const tri=(a,b,c,za,zb=za,zc=za)=>{
      if(!chunk||used===CHUNK){chunk=new Float32Array(CHUNK);chunks.push(chunk);used=0;}
      chunk[used++]=a.x;chunk[used++]=a.y;chunk[used++]=za;
      chunk[used++]=b.x;chunk[used++]=b.y;chunk[used++]=zb;
      chunk[used++]=c.x;chunk[used++]=c.y;chunk[used++]=zc;
      length+=9;sinceYield++;
    };
    for(const f of features) {
      // Parts, stadium decks and the replacement passes carry `base`; the
      // outer ring carries `b`. Reading only `b` stood decks on the ground.
      // Heroes and arts use `b` for a building KEY ('gdc', 'petal'), so
      // only a finite number counts; NaN would reach the GPU as geometry.
      const p=f.properties||{},num=v=>v==null||v===''||!isFinite(+v)?null:+v;
      const h=num(p.final_height)??num(p.h)??num(p.height)??0,base=num(p.b)??num(p.base)??num(p.min_height)??0;
      if(!(h>base)||h<=0||ids.has(p.id)||ids.has(f.id)){if(++n%256===0)yield;continue;}
      const polys=f.geometry?.type==='Polygon'?[f.geometry.coordinates]:f.geometry?.type==='MultiPolygon'?f.geometry.coordinates:[];
      for(const poly of polys) {
        const ring=poly[0];if(!ring?.length)continue;
        const key=[p.id??f.id,base,h,ring[0].join(','),ring.length].join('|');if(seen.has(key))continue;seen.add(key);
        const centre=ring.slice(0,-1).reduce((v,p)=>[v[0]+p[0]/(ring.length-1),v[1]+p[1]/(ring.length-1)],[0,0]);
        if(insideAuthored(centre))continue; // actual authored mesh casts instead
        const contours=poly.map(r=>r.slice(0,-1).map(local));
        const flat=contours.flat(),faces=T.ShapeUtils.triangulateShape(contours[0],contours.slice(1));
        for(const face of faces)tri(...face.map(i=>flat[i]),h);
        for(const contour of contours)for(let i=0;i<contour.length;i++) {
          const a=contour[i],b=contour[(i+1)%contour.length];tri(a,b,a,base,base,h);tri(b,b,a,base,h,h);
        }
        if(sinceYield>=256){sinceYield=0;yield;}
      }
    }
    const positions=new Float32Array(length);let offset=0;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(let i=0;i<chunks.length;i++) {
      const count=Math.min(CHUNK,length-offset),part=chunks[i];positions.set(part.subarray(0,count),offset);
      for(let j=0;j<count;j+=3) {
        const x=part[j],y=part[j+1],z=part[j+2];
        if(x<minX)minX=x;if(y<minY)minY=y;if(z<minZ)minZ=z;if(x>maxX)maxX=x;if(y>maxY)maxY=y;if(z>maxZ)maxZ=z;
      }
      offset+=count;chunks[i]=null;yield;
    }
    // Three sorts even an unculled mesh by its bounding-sphere centre, and
    // computes a missing sphere on the first frame that draws it: a scan of
    // the whole buffer inside the first shadow render after the commit. The
    // same sphere (box centre, farthest vertex), computed here in slices.
    if(T.Sphere&&T.Vector3) {
      const cx=length?(minX+maxX)/2:0,cy=length?(minY+maxY)/2:0,cz=length?(minZ+maxZ)/2:0;let r2=0;
      for(let s=0;s<length;s+=CHUNK) {
        for(let i=s,e=Math.min(s+CHUNK,length);i<e;i+=3){const dx=positions[i]-cx,dy=positions[i+1]-cy,dz=positions[i+2]-cz,d=dx*dx+dy*dy+dz*dz;if(d>r2)r2=d;}
        yield;
      }
      job.sphere=new T.Sphere(new T.Vector3(cx,cy,cz),Math.sqrt(r2));
    }
    return positions;
  }
  function proxyCommit(map,job,positions) {
    proxyJob=null;stats.shadowProxyBuilding=false;
    // The style this build read was replaced under it (a context restore):
    // keep the old proxy and build again from the new one.
    if(map.style!==job.styleOwner){proxyDirty=true;return;}
    const T=window.THREE;
    proxy?.geometry.dispose();proxy?.material.dispose();
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));
    if(job.sphere)geometry.boundingSphere=job.sphere;
    // A NEW Mesh, never new geometry on the old one: the sun shadow's cache
    // key is the proxy's uuid (slopes.js updateSunShadows).
    proxy=new T.Mesh(geometry,new T.MeshBasicMaterial());proxy.frustumCulled=false;proxy.visible=false;
    proxySigBuilt=job.signature;proxyInputs=job.inputs;
    stats.shadowProxyRebuilds=(stats.shadowProxyRebuilds||0)+1;stats.shadowProxyHidden=job.hidden;
    stats.shadowProxyTriangles=positions.length/9;stats.shadowProxyLastBuildMs=proxyNow()-job.started;stats.shadowProxyLastSlices=job.slices+1;
    map.triggerRepaint();
  }
  // The style's layers in draw order, read off MapLibre's live layer objects
  // (id, type, source, sourceLayer, filter, visibility: the fields proxyKey
  // already compares). Custom layers are skipped, as getStyle() skips them.
  // Until 2026-09-28 this was map.getStyle().layers, a full serialise and deep
  // clone of every layer, the authored hide clauses included, on every
  // rebuild. null while there is no loaded style (getStyle()'s undefined).
  function proxyStyleLayers(map) {
    const style=map.style;
    if(!style||(typeof style._loaded==='boolean'?!style._loaded:!map.getStyle?.()))return null;
    if(typeof map.getLayersOrder!=='function'||typeof map.getLayer!=='function')return map.getStyle()?.layers.map(l=>({id:l.id,type:l.type,source:l.source,sourceLayer:l['source-layer'],filter:l.filter,visibility:l.layout?.visibility}))||null;
    const layers=[];
    for(const id of map.getLayersOrder()){const l=map.getLayer(id);if(l&&l.type!=='custom')layers.push(l);}
    return layers;
  }
  // The authored-footprint test, as a lookup built once per rebuild. Each
  // ring is filed under every PROXY_GRID_DEG cell its bounding box touches, so
  // a caster's centre is tested only against the rings of its own cell: the
  // same even-odd test on the same rings, the same answer. Until 2026-09-28
  // every caster polygon was tested against EVERY authored ring: 0.35-0.55 s
  // per rebuild on the core catalogue, 2.2-7.1 s once Riverside's 353 rings
  // join (offline bench, node). The grid takes 3-9 ms.
  // PROXY_GRID_DEG: cell size in degrees (~100 m). Speed only, never picture:
  // any size gives the same answer. PROXY_GRID_MAX_CELLS: a ring whose box
  // would span more cells than this (bad data, a campus-sized outline) is
  // tested for every centre instead of being filed.
  const PROXY_GRID_DEG=0.001,PROXY_GRID_MAX_CELLS=4096;
  const insideRing=(p,r)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;};
  function footprintLookup(rings,cell=PROXY_GRID_DEG) {
    // pad: a centre within rounding of a box edge still finds that ring
    const cells=new Map(),wide=[],pad=1e-9,key=(i,j)=>i*1e6+j;
    for(const r of rings) {
      let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity,finite=true;
      for(const p of r){if(!(Number.isFinite(p[0])&&Number.isFinite(p[1])))finite=false;if(p[0]<w)w=p[0];if(p[0]>e)e=p[0];if(p[1]<s)s=p[1];if(p[1]>n)n=p[1];}
      if(!r.length)continue; // the even-odd test never hits an empty ring
      // A broken vertex can leave an odd crossing count outside the box:
      // such a ring is tested for every centre, exactly as before.
      if(!finite){wide.push(r);continue;}
      const i0=Math.floor((w-pad)/cell),i1=Math.floor((e+pad)/cell),j0=Math.floor((s-pad)/cell),j1=Math.floor((n+pad)/cell);
      if((i1-i0+1)*(j1-j0+1)>PROXY_GRID_MAX_CELLS){wide.push(r);continue;}
      for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const k=key(i,j);let list=cells.get(k);if(!list)cells.set(k,list=[]);list.push(r);}
    }
    return p=>{
      const list=cells.get(key(Math.floor(p[0]/cell),Math.floor(p[1]/cell)));
      if(list)for(const r of list)if(insideRing(p,r))return true;
      for(const r of wide)if(insideRing(p,r))return true;
      return false;
    };
  }
  // Debug only (parity checks): a hash of the current proxy's triangles.
  // `ordered` follows the vertex order; `set` sums one hash per triangle, so
  // two proxies with the same triangles in a different order hash the same.
  function proxyHash() {
    const a=proxy?.geometry.getAttribute('position')?.array;
    if(!a)return null;
    const u=new Uint32Array(a.buffer,a.byteOffset,a.length);let ordered=0x811c9dc5,set=0;
    for(let t=0;t<u.length;t+=9){let h=0x811c9dc5;for(let k=t;k<t+9;k++){h=Math.imul(h^u[k],0x01000193);ordered=Math.imul(ordered^u[k],0x01000193);}set=(set+(h>>>0))>>>0;}
    return {triangles:u.length/9,ordered:(ordered>>>0).toString(16),set:set.toString(16)};
  }
  function install(map) {
    const gl=map.painter.context.gl;
    if(gl.__cityLighting)return;
    gl.__cityLighting=true;
    // Reflections also run on a cold night load or with shadows disabled.
    // Samplers still need a complete texture even when the shader skips them.
    const oldTexture=gl.getParameter(gl.TEXTURE_BINDING_2D);
    fallbackShadow=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,fallbackShadow);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D,oldTexture);
    const originals={},shaders=new WeakMap(),programs=new WeakMap(),locations=new WeakMap();
    const groundLights=new Set(['night-streetlight-pool','night-streetlight-core',
      'night-tower-pool-fill','entrances-pool','signs-ground-glow','props-lit','props-lit-core']);
    const depthPool=id=>window.NIGHT_TUNE?.DEPTH_POOLS!==false&&groundLights.has(id);
    const painter=map.painter,drawFunctions=painter.drawFunctions;
    let activeSolidSurface=0;
    // MapLibre treats circles after its first 3D layer as painter-ordered 2D
    // overlays, with depth testing disabled. A ground glow then crosses walls.
    // These seven ground-light layers use the existing 3D depth range, read-only.
    // MapLibre 5.24 dispatches the style type fill-extrusion through the
    // camelCase fillExtrusion method; a hyphenated property is never called.
    painter.drawFunctions={...drawFunctions,fillExtrusion(...args){
      const previous=activeSolidSurface;
      activeSolidSurface=solidSurfaceFor(args[2]?.id);
      try{return drawFunctions.fillExtrusion(...args);}finally{activeSolidSurface=previous;}
    },circle(...args){
      const p=args[0],layer=args[2],original=p.getDepthModeForSublayer;
      if(!depthPool(layer.id))return drawFunctions.circle(...args);
      p.getDepthModeForSublayer=()=>({...p.getDepthModeFor3D(),mask:false});
      try{return drawFunctions.circle(...args);}finally{p.getDepthModeForSublayer=original;}
    }};
    let current=null;
    const fail=message=>{stats.failures.push(message);console.error('[city-lighting]',message);};
    const wrap=(name,fn)=>{originals[name]=gl[name];gl[name]=fn(originals[name].bind(gl));};
    const replace=(source,from,to)=>{
      if(!source.includes(from))throw new Error('MapLibre lighting shader contract changed: '+from);
      return source.replace(from,to);
    };
    const varying='vec3 v_cityPos; out vec3 v_cityNormal; out vec4 v_cityAlbedo;';
    wrap('shaderSource',native=>(shader,source)=>{
      let kind=null;
      try {
        if(source.includes('uniform bool u_pitch_with_map;')&&source.includes('circle_center')) {
          kind='pool-vertex';
          source=source.replace(/void main\(\s*(?:void)?\s*\)/,`uniform float u_cityPoolLift; uniform vec4 u_cityLampEye;
            highp uvec3 cityPcg(highp uvec3 v){v=v*1664525u+1013904223u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;v^=v>>16u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;return v;}
            void main()`);
          // A lamp head's shimmer: its radius breathes by a per-lamp hash of its tile position and the clock.
          // u_cityLampEye = (seconds, amplitude at full distance, near metres, camera-to-centre metres); amplitude
          // is 0 on every circle layer but the lamp heads (set per draw below), so every other circle is untouched.
          source=replace(source,'float ele=get_elevation(circle_center);',`float ele=get_elevation(circle_center)+u_cityPoolLift;
            if(u_cityLampEye.y>0.0){
              vec4 cp=projectTileWithElevation(circle_center,ele);
              float dm=cp.w/u_camera_to_center_distance*u_cityLampEye.w;
              float a=u_cityLampEye.y*smoothstep(u_cityLampEye.z,${E.farM.toFixed(1)},dm);
              highp uvec3 h=cityPcg(uvec3(uint(max(circle_center.x,0.0)),uint(max(circle_center.y,0.0)),4093u));
              vec3 f=vec3(h>>8u)/16777216.0;
              float n=sin(6.2831853*(mix(${E.hz[0].toFixed(3)},${E.hz[1].toFixed(3)},f.x)*u_cityLampEye.x+f.z))+sin(6.2831853*(mix(${E.hz[0].toFixed(3)},${E.hz[1].toFixed(3)},f.y)*u_cityLampEye.x+f.x));
              radius*=max(.3,1.0+a*n);
            }`);
        } else if(source.includes('in vec4 a_normal_ed;')) {
          kind=source.includes('out vec4 v_lighting;')?'pattern-vertex':'solid-vertex';
          source=replace(source,'void main()',`uniform mat4 u_cityTileToLocal; out ${varying}\nvoid main()`);
          source=replace(source,'vec2 posInTile=a_pos+u_fill_translate;',`vec2 posInTile=a_pos+u_fill_translate;
            v_cityPos=(u_cityTileToLocal*vec4(posInTile,elevation,1.0)).xyz;
            v_cityNormal=normalize(vec3(-normal.x,normal.y,normal.z));
            v_cityAlbedo=${kind==='solid-vertex'?'color':'vec4(1.0)'};`);
          stats.vertexShaders++;
        } else if(source.includes('fragColor=mixedColor*v_lighting;')||source.includes('fragColor=v_color;')) {
          // The solid signature alone also occurs in unrelated shaders. Only
          // the minimal extrusion fragment has no texture/point/fog inputs.
          const pattern=source.includes('fragColor=mixedColor*v_lighting;');
          const minimal=/in vec4 v_color;\s*void main\(\)\s*\{fragColor=v_color;/.test(source);
          if(pattern||minimal) {
            kind=pattern?'pattern-fragment':'solid-fragment';
            const packing=`float unpackRGBAToDepth(vec4 v){return dot(v,vec4(255.0/256.0/16777216.0,255.0/256.0/65536.0,255.0/256.0/256.0,255.0/256.0));}`;
            source=replace(source,'void main()',`in vec3 v_cityPos; in vec3 v_cityNormal; in vec4 v_cityAlbedo;\n${uniforms}\n${packing}\n${glsl.replaceAll('texture2D(', 'texture(')}\n${pattern&&patternFilter.compiled?patternFilterGlsl:''}\nvoid main()`);
            if(pattern&&patternFilter.compiled) {
              const read=(ab,pos)=>`texture(u_image,${pos})`;
              const filtered=(ab,pos,v)=>`cityPatternTexel(u_image,${read(ab,pos)},${v},pattern_tl_${ab}/u_texsize,pattern_br_${ab}/u_texsize,u_texsize,cityPatternDist)`;
              source=replace(source,'vec2 imagecoord=mod(v_pos_a,1.0);','float cityPatternDist=distance(u_eye,v_cityPos);vec2 imagecoord=mod(v_pos_a,1.0);');
              source=replace(source,`vec4 color1=${read('a','pos')};`,`vec4 color1=${filtered('a','pos','v_pos_a')};`);
              // The second read only matters while MapLibre crossfades two zooms.
              source=replace(source,`vec4 color2=${read('b','pos2')};`,`vec4 color2=u_fade>0.0?${filtered('b','pos2','v_pos_b')}:${read('b','pos2')};`);
            }
            // The glass code is a FACADE-atlas convention: opaque texels, and
            // alpha 191 reserved for glass (see glassRect). A texel below
            // OVERLAY_ALPHA is neither: it is a translucent ground overlay
            // (creek ripple, walk grain, Speedway brick; measured max alpha
            // 121/255, facades min 191/255). Read as glass it became an opaque
            // sky mirror that hid the surface it only meant to tint, which is
            // what made the creek's z-fight full-contrast. Those texels keep
            // MapLibre's own premultiplied output. docs/water-flicker.md.
            const output=pattern?`if(mixedColor.a<${OVERLAY_ALPHA.toFixed(3)}){fragColor=mixedColor*v_lighting;}else{
              float glass=clamp((1.0-mixedColor.a)*255.0/64.0,0.0,1.0);
              vec3 cityBase=mixedColor.rgb;
              vec3 shaded=cityShade(cityBase*v_lighting.rgb/max(v_lighting.a,.0001),cityBase,v_cityPos,v_cityNormal,glass);
              shaded=cityCrown(shaded,v_cityPos,v_cityNormal);
              shaded=cityLocalLight(shaded,min(cityBase*4.0,vec3(1.0)),v_cityPos,v_cityNormal,glass);
              vec3 lit=cityEmission(shaded,cityBase,glass);
              // The gain scales the whole lit window, not only the emission term: the window's edge pixels (filtered with the wall) are bright
              // by their texel colour with little emission, and a gain on emission alone left most of a far window's pixels still. A resting
              // window falls to a tenth of its lit colour, a shimmering one goes above it.
              vec3 eg=cityEyeGain(v_cityPos,cityBase);lit=mix(shaded*.1,lit,min(eg,vec3(1.0)))*max(eg,vec3(1.0));
              if(int(u_cityEye2.w+.5)>=4){float sl=dot(cityBase,vec3(.2126,.7152,.0722));lit=sl>=u_cityNight.z?(glass>.5?vec3(0.,1.,0.):vec3(1.,0.,0.)):vec3(0.,0.,.4);}
              fragColor=vec4(lit*v_lighting.a,v_lighting.a);}`
              :`if(u_citySolidSurface<.5){
              vec3 shaded=cityShade(v_color.rgb/max(v_color.a,.0001),v_cityAlbedo.rgb,v_cityPos,v_cityNormal,0.0);
              shaded=cityCrown(shaded,v_cityPos,v_cityNormal);
              fragColor=vec4(cityLocalLight(shaded,min(v_cityAlbedo.rgb*4.0,vec3(1.0)),v_cityPos,v_cityNormal,0.0)*v_color.a,v_color.a);
              }else if(u_citySolidSurface>2.5){
              vec3 shaded=cityShade(v_color.rgb/max(v_color.a,.0001),v_cityAlbedo.rgb,v_cityPos,v_cityNormal,${campusMaterials.gdcReflection.toFixed(3)});
              shaded=cityCrown(shaded,v_cityPos,v_cityNormal);
              shaded=cityLocalLight(shaded,v_cityAlbedo.rgb,v_cityPos,v_cityNormal,1.0);
              vec3 lit=cityEmission(shaded,v_cityAlbedo.rgb,1.0);lit=shaded+(lit-shaded)*cityEyeGain(v_cityPos,vec3(-1.0));
              fragColor=vec4(lit*v_color.a,v_color.a);
              }else{
              float glass=1.0-step(1.5,u_citySolidSurface);
              vec4 grid=glass>.5?landmarkGrid(v_cityPos,normalize(v_cityNormal)):vec4(0.0);
              float recess=mix(1.0,${landmarkMaterials.balconyShade.toFixed(3)},landmarkBalcony(v_cityPos,normalize(v_cityNormal))*glass);
              vec3 albedo=mix(v_cityAlbedo.rgb*recess,grid.rgb,grid.a);
              vec3 original=mix(v_color.rgb/max(v_color.a,.0001)*recess,grid.rgb*${landmarkMaterials.frameShade.toFixed(3)},grid.a);
              vec3 shaded=cityShade(original,albedo,v_cityPos,v_cityNormal,glass*(1.0-grid.a)*${landmarkMaterials.reflection.toFixed(3)});
              shaded=cityCrown(shaded,v_cityPos,v_cityNormal);
              if(glass>.5){vec3 lit=cityEmission(shaded,v_cityAlbedo.rgb,1.0-grid.a);shaded=shaded+(lit-shaded)*cityEyeGain(v_cityPos,vec3(-1.0));if(int(u_cityEye2.w+.5)>=4)shaded=vec3(0.,1.,1.);}
              else shaded=mix(shaded,max(shaded,albedo*u_cityNight.y),u_cityNight.x);
              fragColor=vec4(shaded*v_color.a,v_color.a);
              }`;
            source=replace(source,pattern?'fragColor=mixedColor*v_lighting;':'fragColor=v_color;',output);
            stats.fragmentShaders++;
          }
        }
      } catch(e) {fail(e.message);}
      if(kind)shaders.set(shader,kind);
      return native(shader,source);
    });
    wrap('compileShader',native=>shader=>{
      native(shader);
      if(shaders.has(shader)&&!gl.getShaderParameter(shader,gl.COMPILE_STATUS))fail(gl.getShaderInfoLog(shader));
    });
    wrap('linkProgram',native=>program=>{
      native(program);
      const attached=gl.getAttachedShaders(program),kinds=attached.map(s=>shaders.get(s));
      if(!kinds.some(k=>k?.endsWith('-vertex')))return;
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)){fail(gl.getProgramInfoLog(program));return;}
      if(kinds.includes('pool-vertex')){
        programs.set(program,{poolLift:gl.getUniformLocation(program,'u_cityPoolLift'),lampEye:gl.getUniformLocation(program,'u_cityLampEye')});
        stats.poolPrograms++;return;
      }
      const u={};
      for(const name of [...uniforms.matchAll(/uniform \w+ ([^;]+);/g)].flatMap(m=>m[1].split(',').map(s=>s.trim())))u[name]=gl.getUniformLocation(program,name);
      u.u_cityTileToLocal=gl.getUniformLocation(program,'u_cityTileToLocal');
      const projection=gl.getUniformLocation(program,'u_projection_matrix');
      const record={u,serial:-1,projection:null,tile:null,tileDirty:true};
      programs.set(program,record);if(projection)locations.set(projection,record);
      stats.programs++;
    });
    wrap('getUniformLocation',native=>(program,name)=>{
      const loc=native(program,name);
      if(loc&&name==='u_projection_matrix'&&programs.get(program)?.u)locations.set(loc,programs.get(program));
      return loc;
    });
    wrap('useProgram',native=>program=>{current=programs.get(program)||null;return native(program);});
    wrap('uniformMatrix4fv',native=>(location,transpose,value,...rest)=>{
      const p=locations.get(location);
      if(p){
        p.projection??=new Float64Array(16);
        for(let i=0;i<16;i++)p.projection[i]=value[(rest[0]||0)+i];
        p.tileDirty=true;
      }
      return native(location,transpose,value,...rest);
    });
    // Bind two spare texture units only for an extrusion draw, then restore
    // them: Three and MapLibre both cache their own texture bindings.
    const textureUnits=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    const units=[textureUnits-2,textureUnits-1];
    // Binding queries add WebGL traffic and can wait on Safari's GPU process.
    // Three queries accompany each extrusion draw even though every binding
    // change already passes through this context. Track the two borrowed units
    // and the active unit, including texture disposal, then restore exactly
    // what the other renderer left there. Context restoration reinstalls this
    // adapter and seeds the state again; cleanup removes all three hooks.
    const maxUnits=gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    let activeTexture=gl.getParameter(gl.ACTIVE_TEXTURE);
    const textureBindings=new Map();
    for(const unit of units){
      gl.activeTexture(gl.TEXTURE0+unit);
      textureBindings.set(gl.TEXTURE0+unit,gl.getParameter(gl.TEXTURE_BINDING_2D));
    }
    gl.activeTexture(activeTexture);
    wrap('activeTexture',native=>unit=>{
      native(unit);
      const value=unit>>>0;
      if(value>=gl.TEXTURE0&&value<gl.TEXTURE0+maxUnits)activeTexture=value;
    });
    wrap('bindTexture',native=>(target,texture)=>{
      native(target,texture);
      if(target===gl.TEXTURE_2D&&textureBindings.has(activeTexture))textureBindings.set(activeTexture,texture);
    });
    wrap('deleteTexture',native=>texture=>{
      native(texture);
      for(const [unit,bound] of textureBindings)if(bound===texture)textureBindings.set(unit,null);
    });
    const binding=(pname)=>{
      const tracked=pname===gl.ACTIVE_TEXTURE?activeTexture:textureBindings.get(activeTexture);
      const state=window.GLSTATE;
      if(state?.check)state.verify(gl,'city.'+pname,pname,tracked);
      return state?.on===false?gl.getParameter(pname):tracked;
    };
    function draw(native,args) {
      if(current?.poolLift){
        gl.uniform1f(current.poolLift,depthPool(painter.id)?(window.NIGHT_TUNE?.POOL_ELEVATION_M??0.25):0);
        if(current.lampEye){
          // Only the lamp heads shimmer, and only while the night clock says so (frame() sets u_cityEye2).
          let a=0,t=0,dc=0;
          if(painter.id==='night-streetlight-core'&&frame){
            const e1=frame.U.u_cityEye?.value,e2=frame.U.u_cityEye2?.value,tr=painter.transform;
            dc=tr&&tr.pixelsPerMeter>0?tr.cameraToCenterDistance/tr.pixelsPerMeter:0;
            if(e1&&e2&&dc>0&&(Math.round(e2.w)&1)){a=e2.x;t=e1.x;}
          }
          gl.uniform4f(current.lampEye,t,a,frame?.U.u_cityEye2?.value.y??0,dc);
        }
        stats.poolDraws++;return native(...args);
      }
      if(!current||!frame)return native(...args);
      const p=current,u=p.u;
      // A shader program is shared by many layers. Reset the semantic on
      // every layer transition, including the first ordinary draw afterward.
      const surface=activeSolidSurface;
      if(u.u_citySolidSurface&&p.solidSurface!==surface){
        gl.uniform1f(u.u_citySolidSurface,surface);p.solidSurface=surface;
      }
      if(surface===1||surface===3)stats.solidGlassDraws++;
      if(surface===2)stats.solidLightDraws++;
      if(p.serial!==serial) {
        for(const [name,slot] of Object.entries(u)) {
          if(!slot||name.startsWith('u_sunShadow')&&!name.includes('Matrix')||name==='u_cityTileToLocal'||name==='u_citySolidSurface')continue;
          const v=frame.U[name]?.value;if(v==null)continue;
          if(typeof v==='number')gl.uniform1f(slot,v);
          else if(v.isMatrix4)gl.uniformMatrix4fv(slot,false,v.elements);
          else {const a=v.toArray();gl['uniform'+a.length+'fv'](slot,a);}
        }
        p.tileDirty=true;
        p.serial=serial;
      }
      if(p.tileDirty&&p.projection){
        p.tile??=new THREE.Matrix4();p.tile.fromArray(p.projection).premultiply(frame.inverse);
        gl.uniformMatrix4fv(u.u_cityTileToLocal,false,p.tile.elements);p.tileDirty=false;
      }
      const active=binding(gl.ACTIVE_TEXTURE),old=[];
      try {
        for(let i=0;i<2;i++) {
          gl.activeTexture(gl.TEXTURE0+units[i]);old[i]=binding(gl.TEXTURE_BINDING_2D);
          gl.bindTexture(gl.TEXTURE_2D,frame.textures[i]);gl.uniform1i(u['u_sunShadow'+i],units[i]);
        }
        stats.draws++;return native(...args);
      } finally {
        for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE0+units[i]);gl.bindTexture(gl.TEXTURE_2D,old[i]);}
        gl.activeTexture(active);
      }
    }
    for(const name of ['drawElements','drawArrays'])wrap(name,native=>(...args)=>draw(native,args));
    const imageMethods={};
    for(const method of ['addImage','updateImage']) {
      imageMethods[method]=map[method];
      const native=map[method].bind(map);
      map[method]=function(id,image,...rest){
        return native(id,bandGlassImage(id,image),...rest);
      };
    }
    // The restored map owns a new painter, while the WebGL JS object survives.
    // Remove old hooks/resources before installing on that replacement painter.
    const cleanup=()=>{painter.drawFunctions=drawFunctions;for(const [name,native] of Object.entries(originals))gl[name]=native;for(const [name,native] of Object.entries(imageMethods))map[name]=native;if(!gl.isContextLost())gl.deleteTexture(fallbackShadow);fallbackShadow=null;frame=null;gl.__cityLighting=false;};
    const removed=()=>{map.off('webglcontextlost',lost);cleanup();};
    const lost=()=>{map.off('remove',removed);cleanup();map.once('webglcontextrestored',()=>install(map));};
    map.once('webglcontextlost',lost);map.once('remove',removed);
  }
  window.CityLighting={uniforms,glsl,balance,landmarkMaterials,campusMaterials,glassRect,glassColour,install,stats,shadowProxy,proxyHash,patternFilter,
    setBuildings(features){buildings=features;proxyDirty=true;},
    frame(U,inverse,textures){
      // Before either renderer draws. Materials retain this shared U object.
      U.u_citySkyFill??={value:new THREE.Vector2()};
      U.u_citySkyFill.value.set(balance.skyFill,balance.roofFill);
      U.u_cityPatternFilter??={value:new THREE.Vector4()};
      // The shader's loops were sized from maxTaps when it compiled; a live
      // change can lower the count, not raise it past that.
      U.u_cityPatternFilter.value.set(patternFilter.on?1:0,patternFilter.nearM,patternFilter.fullM,Math.max(1,patternFilter.maxTaps));
      U.u_cityPatternFilterB??={value:new THREE.Vector4()};
      U.u_cityPatternFilterB.value.set(patternFilter.maxSpacing,0,0,0);
      U.u_cityNight??={value:new THREE.Vector4()};
      U.u_cityEye??={value:new THREE.Vector4()};U.u_cityEye2??={value:new THREE.Vector4()};
      const night=window.CityNight,t=night?.tune;
      U.u_cityNight.value.set(t?.on?night.lamps(window.__todCurrentP??.5):0,t?.emissionGain??1,...(t?.glassThreshold??[.26,.48]));
      if(night?.uniforms)night.uniforms(U,window.__todCurrentP??.5,window.__map);
      if(window.slopes&&!U.u_cityLandmarkOrigins){
        const a=window.slopes.toLocal(...landmarkMaterials.waterline.center,0),b=window.slopes.toLocal(...landmarkMaterials.sixth.center,0);
        U.u_cityLandmarkOrigins={value:new THREE.Vector4(a.x,a.y,b.x,b.y)};
      }
      const fixtures=t?.on&&U.u_cityNight.value.x>0?night.nearest(U.u_eye.value):[];
      U.u_cityCrown??={value:new THREE.Vector4()};U.u_cityCrownColour??={value:new THREE.Vector4()};
      const crown=t?.on?night.crown:null;
      if(crown&&window.slopes){const pos=window.slopes.toLocal(...crown.center,0);U.u_cityCrown.value.set(pos.x,pos.y,crown.base,crown.radius);U.u_cityCrownColour.value.set(...crown.colour,crown.top);}
      else U.u_cityCrown.value.set(0,0,0,0);
      for(let i=0;i<8;i++){
        const pos=U['u_cityFixture'+i]??={value:new THREE.Vector4()},col=U['u_cityFixtureColour'+i]??={value:new THREE.Vector4()},f=fixtures[i];
        if(f){pos.value.set(...f.position,f.radius);col.value.set(...f.colour.map(c=>Math.pow(c,2.2)),f.power*(t.fixtureGain??1));}else{pos.value.set(0,0,0,0);col.value.set(0,0,0,0);}
      }
      frame={U,inverse,textures:textures||[fallbackShadow,fallbackShadow]};serial++;
    }
  };
})();
