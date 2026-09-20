/** Shared sunlight for the authored meshes AND MapLibre's city extrusions.
 * The adapter targets the pinned MapLibre 5.24 extrusion shader contracts.
 * It does not replace geometry, style filters, picking, LOD or texture atlases.
 * A changed upstream contract fails visibly in diagnostics instead of silently
 * reverting half the city. Both renderers consume the same GLSL and uniforms.
 */
(function () {
  'use strict';
  const stats = {vertexShaders:0, fragmentShaders:0, programs:0, draws:0, failures:[], glassImages:0};
  let frame=null, serial=0, fallbackShadow=null;
  // Pattern texels below this alpha are translucent overlays, not glass-coded
  // facade texels (which are 191..255). Anything between the two bands works.
  const OVERLAY_ALPHA=0.70;
  const uniforms = `
    uniform vec3 u_eye;
    uniform vec4 u_sunlight;
    uniform float u_glassStrength;
    uniform vec3 u_sunDirection, u_sunColour, u_shadeColour;
    uniform vec3 u_skyZenith, u_skyHorizon, u_sunsetColour, u_groundColour;
    uniform vec4 u_glassSun, u_reflectionSky;
    uniform vec2 u_sunPresence;
    uniform sampler2D u_sunShadow0, u_sunShadow1;
    uniform mat4 u_sunShadowMatrix0, u_sunShadowMatrix1;
    uniform vec4 u_shadowSettings;
  `;
  const glsl = `
    vec3 linearColour(vec3 c) { return pow(max(c,vec3(0.0)),vec3(2.2)); }
    vec3 displayColour(vec3 c) { return pow(max(c,vec3(0.0)),vec3(1.0/2.2)); }
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
      vec3 diffuse=linearColour(albedo)*(linearColour(u_shadeColour)*u_sunlight.y+
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
  let buildings=[],proxy=null,proxyDirty=true,proxyTimer=null,proxyMap=null,proxyBuilt=0;
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
      map.on('moveend',()=>{proxyDirty=true;});
      map.on('remove',()=>{clearTimeout(proxyTimer);proxy?.geometry.dispose();proxy?.material.dispose();proxy=null;proxyMap=null;});
    }
    const built=window.slopesApartments?.count.buildings||0;
    if(proxyBuilt!==built)proxyDirty=true;
    if(proxyDirty&&!proxyTimer&&!map.isMoving())proxyTimer=setTimeout(()=>{
      proxyTimer=null;proxyDirty=false;proxyBuilt=built;
      const T=window.THREE,S=window.slopes,positions=[],seen=new Set();
      const authored=window.APARTMENTS?.on?window.slopesApartments?.data?.buildings||[]:[];
      const ids=new Set(authored.map(b=>b.id)),rings=authored.map(b=>b.footprint?.ring).filter(Boolean);
      const inside=(p,r)=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p[1])!==(r[j][1]>p[1])&&p[0]<(r[j][0]-r[i][0])*(p[1]-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;};
      // The displayed base layer suppresses parent prisms with detailed parts,
      // and replaced prisms by id (see casterSources).
      const style=map.getStyle().layers,hidden=hiddenIds(style.find(l=>l.id==='buildings-3d')?.filter);
      const features=buildings.filter(f=>!f.properties?.has_parts&&!hidden.has(f.properties?.id));
      stats.shadowProxyHidden=buildings.filter(f=>!f.properties?.has_parts&&hidden.has(f.properties?.id)).length;
      for(const source of casterSources) {
        if(!map.getSource(source))continue;
        // Each visible layer with its own display filter: a part, deck or
        // detail that no layer draws does not cast.
        for(const l of style) {
          if(l.type!=='fill-extrusion'||l.source!==source||l.layout?.visibility==='none')continue;
          const o={};if(l['source-layer'])o.sourceLayer=l['source-layer'];if(l.filter)o.filter=l.filter;
          try{features.push(...map.querySourceFeatures(source,o));}catch(e){const m='shadow proxy '+l.id+': '+e.message;if(!stats.failures.includes(m)){stats.failures.push(m);console.error('[city-lighting]',m);}}
        }
      }
      const local=p=>{const v=S.toLocal(p[0],p[1],0);return new T.Vector2(v.x,v.y);};
      const tri=(a,b,c,za,zb=za,zc=za)=>positions.push(a.x,a.y,za,b.x,b.y,zb,c.x,c.y,zc);
      for(const f of features) {
        // Parts, stadium decks and the replacement passes carry `base`; the
        // outer ring carries `b`. Reading only `b` stood decks on the ground.
        // Heroes and arts use `b` for a building KEY ('gdc', 'petal'), so
        // only a finite number counts; NaN would reach the GPU as geometry.
        const p=f.properties||{},num=v=>v==null||v===''||!isFinite(+v)?null:+v;
        const h=num(p.final_height)??num(p.h)??num(p.height)??0,base=num(p.b)??num(p.base)??num(p.min_height)??0;
        if(!(h>base)||h<=0||ids.has(p.id)||ids.has(f.id))continue;
        const polys=f.geometry?.type==='Polygon'?[f.geometry.coordinates]:f.geometry?.type==='MultiPolygon'?f.geometry.coordinates:[];
        for(const poly of polys) {
          const ring=poly[0];if(!ring?.length)continue;
          const key=[p.id??f.id,base,h,ring[0].join(','),ring.length].join('|');if(seen.has(key))continue;seen.add(key);
          const centre=ring.slice(0,-1).reduce((v,p)=>[v[0]+p[0]/(ring.length-1),v[1]+p[1]/(ring.length-1)],[0,0]);
          if(rings.some(r=>inside(centre,r)))continue; // actual authored mesh casts instead
          const contours=poly.map(r=>r.slice(0,-1).map(local));
          const flat=contours.flat(),faces=T.ShapeUtils.triangulateShape(contours[0],contours.slice(1));
          for(const face of faces)tri(...face.map(i=>flat[i]),h);
          for(const contour of contours)for(let i=0;i<contour.length;i++) {
            const a=contour[i],b=contour[(i+1)%contour.length];tri(a,b,a,base,base,h);tri(b,b,a,base,h,h);
          }
        }
      }
      proxy?.geometry.dispose();proxy?.material.dispose();
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
      proxy=new T.Mesh(geometry,new T.MeshBasicMaterial());proxy.frustumCulled=false;proxy.visible=false;
      stats.shadowProxyTriangles=positions.length/9;map.triggerRepaint();
    },300);
    return proxy;
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
    let current=null;
    const fail=message=>{stats.failures.push(message);console.error('[city-lighting]',message);};
    const wrap=(name,fn)=>{originals[name]=gl[name];gl[name]=fn(originals[name].bind(gl));};
    const replace=(source,from,to)=>{
      if(!source.includes(from))throw new Error('MapLibre extrusion shader contract changed: '+from);
      return source.replace(from,to);
    };
    const varying='vec3 v_cityPos; out vec3 v_cityNormal; out vec4 v_cityAlbedo;';
    wrap('shaderSource',native=>(shader,source)=>{
      let kind=null;
      try {
        if(source.includes('in vec4 a_normal_ed;')) {
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
            source=replace(source,'void main()',`in vec3 v_cityPos; in vec3 v_cityNormal; in vec4 v_cityAlbedo;\n${uniforms}\n${packing}\n${glsl.replaceAll('texture2D(', 'texture(')}\nvoid main()`);
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
              fragColor=vec4(cityShade(cityBase*v_lighting.rgb/max(v_lighting.a,.0001),cityBase,v_cityPos,v_cityNormal,glass)*v_lighting.a,v_lighting.a);}`
              :`fragColor=vec4(cityShade(v_color.rgb/max(v_color.a,.0001),v_cityAlbedo.rgb,v_cityPos,v_cityNormal,0.0)*v_color.a,v_color.a);`;
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
      if(loc&&name==='u_projection_matrix'&&programs.has(program))locations.set(loc,programs.get(program));
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
    const units=[gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)-2,gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)-1];
    function draw(native,args) {
      if(!current||!frame)return native(...args);
      const p=current,u=p.u;
      if(p.serial!==serial) {
        for(const [name,slot] of Object.entries(u)) {
          if(!slot||name.startsWith('u_sunShadow')&&!name.includes('Matrix')||name==='u_cityTileToLocal')continue;
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
      const active=gl.getParameter(gl.ACTIVE_TEXTURE),old=[];
      try {
        for(let i=0;i<2;i++) {
          gl.activeTexture(gl.TEXTURE0+units[i]);old[i]=gl.getParameter(gl.TEXTURE_BINDING_2D);
          gl.bindTexture(gl.TEXTURE_2D,frame.textures[i]);gl.uniform1i(u['u_sunShadow'+i],units[i]);
        }
        stats.draws++;return native(...args);
      } finally {
        for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE0+units[i]);gl.bindTexture(gl.TEXTURE_2D,old[i]);}
        gl.activeTexture(active);
      }
    }
    for(const name of ['drawElements','drawArrays'])wrap(name,native=>(...args)=>draw(native,args));
    for(const method of ['addImage','updateImage']) {
      const native=map[method].bind(map);
      map[method]=function(id,image,...rest){
        return native(id,bandGlassImage(id,image),...rest);
      };
    }
    map.on('remove',()=>{for(const [name,native] of Object.entries(originals))gl[name]=native;gl.deleteTexture(fallbackShadow);fallbackShadow=null;frame=null;});
  }
  window.CityLighting={uniforms,glsl,glassRect,glassColour,install,stats,shadowProxy,
    setBuildings(features){buildings=features;proxyDirty=true;},
    frame(U,inverse,textures){frame={U,inverse,textures:textures||[fallbackShadow,fallbackShadow]};serial++;}
  };
})();
