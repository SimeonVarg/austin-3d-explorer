/* Shared night clock and stable room lighting. Values are art direction unless
 * a building's own night profile cites a reference; occupancy is never universal.
 * Light colours describe the source, before directional light or colour grading.
 */
(function(){
  'use strict';
  const tune={on:new URLSearchParams(location.search).get('citynight')!=='0',
    materialStart:0,materialFull:-12,emissionGain:1.12,
    bloomWidth:512,bloomBrightness:.64,bloomBlur:1.2,
    residential:[.24,.54],office:[.16,.38],unitBays:2,
    windowScatter:new URLSearchParams(location.search).get('windowScatter')!=='0',
    floorOccupancy:[.72,1.12],commercialOccupancy:.88,storefrontMaxBase:8,fixtureSize:.18,
    tones:['#eed8b4','#e5ddc9','#cbdde2','#f7e8cd'],unlitGlass:'#101823',
    brightness:[.62,1],glassThreshold:[.26,.48],wallAmbient:.22,fixtureLimit:8,fixtureGain:1,downlightCone:[-.05,.25]};
  // Frost's white crown in the elevated skyline reference. Bounds follow the
  // current outer-ring crown geometry, not a claim about surveyed roof height.
  const crown={center:[-97.742699,30.266409],base:126.49,top:145.01,radius:58,ambient:.4,direction:[.3,-.6,.7],colour:[.72,.79,.78]};
  const profiles=new Map();
  const fixtures=new Map();
  let fixtureList=null;
  const hash=(...parts)=>{let h=2166136261;for(const c of parts.join('|')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return (h>>>0)/4294967296;};
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  function lamps(p){return tune.on?(window.skyBodies?.(p).lamps??smooth(.54,.62,p)):Math.max(0,(p-.55)/.45);}
  function materialP(p){
    if(!tune.on||p<=.56)return p;
    const elev=window.skyBodies?.(p).sun.elev??(0.56-p)*100;
    return .56+.44*smooth(tune.materialStart,tune.materialFull,elev);
  }
  function register(spec){
    const id=spec.id||spec.name,range=spec.category==='office'?tune.office:tune.residential;
    profiles.set(id,{occupancy:range[0]+(range[1]-range[0])*hash(id,'occupancy'),unitBays:tune.unitBays,category:spec.category,...spec.night});
  }
  function room(key,floor,bay,pane=0){
    const id=key.split('|')[0],profile=profiles.get(id)||{occupancy:tune.residential[0]+(tune.residential[1]-tune.residential[0])*hash(id,'occupancy'),unitBays:tune.unitBays};
    const unit=tune.windowScatter ? bay+':'+pane : Math.floor(bay/Math.max(1,profile.unitBays)),face=key.split('|').slice(0,3).join('|');
    // Each opening has its own stable pick, including openings within one bay.
    // Preserve building/floor occupancy; the legacy pairing is an A/B knob.
    const floorFactor=tune.floorOccupancy[0]+(tune.floorOccupancy[1]-tune.floorOccupancy[0])*hash(id,'floor',floor);
    const lit=hash(face,'home',floor,unit)<profile.occupancy*floorFactor;
    const tone=pickTone(profile,hash(face,'tone',floor,unit),hash(face,'tv',floor,unit));
    const gain=tune.brightness[0]+(tune.brightness[1]-tune.brightness[0])*hash(face,'brightness',floor,unit);
    const rgb=tone.match(/[a-f0-9]{2}/gi).map(v=>Math.round(parseInt(v,16)*gain));
    return {lit,nightTone:'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('')};
  }
  function emissive(triple,tone){const c=triple.slice();if(tone)c[2]=tone;c.surface=[5,1,1,1];return c;}
  function registerFixtures(spec,frame){
    fixtureList=null;
    fixtures.set(spec.id||spec.name,(spec.night?.fixtures||[]).map(f=>({
      position:frame.at(...f.position),radius:f.radius??12,power:f.power??1,
      colour:(f.colour||'#fff0da').match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255)
    })));
  }
  function nearest(eye){return (fixtureList??=[...fixtures.values()].flat()).map(f=>({f,d:Math.hypot(f.position[0]-eye.x,f.position[1]-eye.y,f.position[2]-eye.z)})).filter(x=>x.d<350).sort((a,b)=>a.d-b.d).slice(0,tune.fixtureLimit).map(x=>x.f);}

  // ── THE EYE AT NIGHT ────────────────────────────────────────────────────────
  // Research and sources: docs/night-eye-2026-10-10.md. Every value is one line; every part has a
  // URL switch (rule 11). `?nighteye=0` puts the previous night back whole.
  //   ?twinkle=<n>     scale of the far-light shimmer (0 off, 1 default, 2 double)
  //   ?glare=<n>       scale of the eye's glare lobes added to the bloom (0 off)
  //   ?nightcolour=0   the old four-tone window palette for every building type
  //   ?officecool=<n>  share of office windows lit cool white (0 = the old mix, default .85)
  //   ?nightdrift=0    no slow switching and no late-night windows going dark
  //   ?nightseed=<n>   freeze every time-driven and random part of the night at seed n
  //   ?nightfreeze=1   same, at seed 0 (what the picture checks use)
  const q=new URLSearchParams(location.search);
  const num=(k,d)=>{const v=parseFloat(q.get(k));return Number.isFinite(v)?v:d;};
  const seedParam=q.get('nightseed');
  const frozen=seedParam!==null||(q.get('nightfreeze')!==null&&q.get('nightfreeze')!=='0');
  const seed=seedParam!==null?(parseInt(seedParam,10)||0):0;
  const master=q.get('nighteye')!=='0';
  const eye={
    on:master,
    // 1. Far-light shimmer. Fractional RMS of a lit window's brightness at `farM` (and beyond). Atmospheric
    //    scintillation proper belongs to compact sources: a window is metres wide against a 2 cm Fresnel
    //    scale, so physically it averages out. What a person sees on a far window is a mix of that, image
    //    boil and retinal noise near threshold, so the window figure is small on purpose and the lamp figure
    //    larger. Both are fade-in with distance: nothing twinkles near the camera.
    twinkle:master?num('twinkle',1):0,
    windowAmp:.28,       // RMS fraction of a lit window's brightness, at farM (measured: 3.5 to 7% mean in the final far frame, docs/night-eye-2026-10-10.md)
    lampAmp:.45,         // the same for a lamp head (as a change of its radius, so about 2x in light): compact sources twinkle more than windows
    nearM:200,           // no shimmer inside this distance
    farM:1200,           // full strength from here
    hz:[2.0,6.0],        // the two slow oscillators per light, under half the 15 Hz redraw and under the ~15 Hz the dark-adapted eye follows
    colourWobble:.45,    // share of the amplitude that goes to a red/blue swing (1 = as large as brightness)
    footprintM:[4,14],   // the shimmer fades out where one pixel covers more than this much wall (no aliasing)
    repaintHz:15,        // a parked camera is redrawn this often at night, only while shimmer is on
    idleStopS:300,       // ...and stops this long after the last touch, so a left-open tab does not cook a laptop
    cardsOnly:true,      // on by default only where graphics.js finds a graphics card (like the far pattern filter)
    // 3. Variety by building type and hour.
    colour:master&&q.get('nightcolour')!=='0',
    officeCool:master?num('officecool',.85):0,   // share of an office family's lit windows that are neutral or cool white (generic buildings, facades.js)
    // 4. Slow change. Each lit window rests for `offBase` of a private cycle of switchS seconds; late in the
    //    night the windows go dark in order (each has a fixed bedtime), offices sooner than homes.
    drift:master&&q.get('nightdrift')!=='0',
    switchS:[150,900],
    offBase:.045,
    lateStart:.75,       // slider position where the evening ends...
    lateDropout:.18,     // ...and the share of homes' windows that are dark by slider 1.0
    officeExtra:1.3,     // offices lose this many times as many
    // 2. Glare: the eye's point spread, as two soft lobes beside the existing tight bloom, cooler than the lamp.
    //    Angles are for the 58 degree lens; the canvas widths below are what set them. See graphics.js.
    glare:master?num('glare',1):0,
    glareLobes:[{w:96,blur:1.0,alpha:.12},{w:40,blur:1.0,alpha:.09}],
    glareTint:'#bcd0ff',
    glareNightOnly:true,
    debug:false,         // true paints lit window texels by the path that draws them: green MapLibre glass, red bright non-glass, blue below the lit threshold, yellow authored buildings, cyan landmark glass
  };
  // Window palettes. Warm 2700 K homes with a few TVs; offices 4000-5000 K; shops stay on the old palette.
  const palettes={
    residential:{tones:['#eed8b4','#e5ddc9','#f7e8cd','#f1cf9d','#eed8b4','#e8d2ac'],tv:'#a9c0e6',tvShare:.045},
    office:{tones:['#e9f0f2','#d8e6ea','#f1f0e2','#cbdde2','#e6ecec'],tv:null,tvShare:0},
  };
  function pickTone(profile,u,v){
    if(!eye.colour)return tune.tones[Math.floor(u*tune.tones.length)];
    const pal=profile.category==='office'?palettes.office:palettes.residential;
    if(pal.tv&&v<pal.tvShare)return pal.tv;
    return pal.tones[Math.floor(u*pal.tones.length)];
  }
  // Random numbers and the clock, both freezable. mulberry32; the clock is milliseconds.
  let held=null;
  const rand=(()=>{let a=(seed>>>0)+0x9e3779b9;return frozen?()=>{a=(a+0x6d2b79f5)>>>0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}:Math.random;})();
  const now=()=>held!==null?held:frozen?seed*1000*37.7:performance.now();
  const hold=ms=>{held=ms==null?null:+ms;try{window.__map?.triggerRepaint();}catch(e){}};
  // The two uniforms every window shader reads (see city-lighting.js, cityEyeGain).
  // u_cityEye = (seconds, window amp, 1/pixel footprint rad, late), u_cityEye2 = (lamp amp, nearM, farM, bits)
  function uniforms(U,p,map){
    const night=tune.on?lamps(p):0,on=eye.on&&night>0&&eye.twinkle>0;
    let px=.0013;try{const t=map?.transform;if(t)px=2*Math.tan(t.fov*Math.PI/360)/Math.max(1,t.height);}catch(e){}
    const late=eye.drift?smooth(eye.lateStart,1,p):0;
    U.u_cityEye.value.set(now()/1000,on?eye.windowAmp*eye.twinkle:0,px,late);
    U.u_cityEye2.value.set(on?eye.lampAmp*eye.twinkle:0,eye.nearM,eye.farM,(on?1:0)+(eye.drift&&night>0?2:0)+(eye.debug&&night>0?4:0));   // bit 0 shimmer, bit 1 slow change, bit 2 debug colours
  }
  // The shimmer needs frames: this app draws only when something changes. A parked night camera is redrawn at
  // eye.repaintHz while shimmer is on, the tab is visible, the camera is still and someone touched it lately.
  let ticking=false,lastTouch=performance.now();
  function startTicker(){
    if(ticking)return;ticking=true;
    const touch=()=>{lastTouch=performance.now();};
    for(const ev of ['pointerdown','pointermove','wheel','keydown','touchstart'])addEventListener(ev,touch,{passive:true});
    setInterval(()=>{
      const map=window.__map;
      if(!map||!eye.on||!(eye.twinkle>0)||document.hidden||frozen||held!==null)return;   // a frozen night must not move
      // Phones and integrated chips keep the still frame unless ?twinkle=1 asks for it.
      if(eye.cardsOnly&&q.get('twinkle')===null&&(window.LITE_PROFILE?.on||!window.GFX_GPU_CARD?.()))return;
      if(lamps(window.__todCurrentP??.5)<.3)return;
      if(performance.now()-lastTouch>eye.idleStopS*1000)return;
      try{if(map.isMoving())return;}catch(e){return;}
      map.triggerRepaint();
    },Math.round(1000/eye.repaintHz));
  }
  // The ticker starts after the first lamps-on frame; harmless before the map exists.
  if(typeof document!=='undefined'&&typeof addEventListener==='function')setTimeout(startTicker,0);
  window.CityNight={eye,now,hold,rand,frozen,seed,uniforms,tune,crown,profiles,fixtures,hash,smooth,lamps,materialP,register,registerFixtures,nearest,room,emissive};
})();
