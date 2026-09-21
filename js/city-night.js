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
    profiles.set(id,{occupancy:range[0]+(range[1]-range[0])*hash(id,'occupancy'),unitBays:tune.unitBays,...spec.night});
  }
  function room(key,floor,bay){
    const id=key.split('|')[0],profile=profiles.get(id)||{occupancy:tune.residential[0]+(tune.residential[1]-tune.residential[0])*hash(id,'occupancy'),unitBays:tune.unitBays};
    const unit=Math.floor(bay/Math.max(1,profile.unitBays)),face=key.split('|').slice(0,3).join('|');
    // Adjacent panes share a home, with a few darker floors. No time/camera seed.
    const floorFactor=tune.floorOccupancy[0]+(tune.floorOccupancy[1]-tune.floorOccupancy[0])*hash(id,'floor',floor);
    const lit=hash(face,'home',floor,unit)<profile.occupancy*floorFactor;
    const tone=tune.tones[Math.floor(hash(face,'tone',floor,unit)*tune.tones.length)];
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
  window.CityNight={tune,crown,profiles,fixtures,hash,smooth,lamps,materialP,register,registerFixtures,nearest,room,emissive};
})();
