import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const once={},events={},timers=[],sources=new Map(),layers=new Map([['buildings-3d',{}]]);
let roads=[],writes=0;
const map={getCenter:()=>({lng:-97.74,lat:30.276}),getStyle:()=>({sources:{basemap:{type:'vector'}}}),getSource:id=>sources.get(id),getLayer:id=>layers.get(id),
 addSource(id,s){sources.set(id,{...s,setData(d){this.data=d;writes++;}});},addLayer:l=>layers.set(l.id,l),setPaintProperty(){},
 querySourceFeatures:()=>roads,once:(e,f)=>once[e]=f,on:(e,f)=>events[e]=f};
const ctx={window:{skyBodies:()=>({lamps:1})},console:{log(){},warn(){},error(...args){throw Error(args.join(' '));}},setTimeout:f=>(timers.push(f),timers.length),clearTimeout(){}};
vm.runInNewContext(readFileSync(new URL('../js/night.js',import.meta.url),'utf8'),ctx);
const road=(lat)=>({properties:{class:'secondary'},geometry:{type:'LineString',coordinates:[[-97.746,lat],[-97.736,lat]]}});
roads=[road(30.286)];ctx.window.initNight(map);once.idle();
const campus=ctx.window.__nightLights.count;assert.ok(campus>10);
roads=[road(30.264)];ctx.window.applyNightLayer(map,1);events.moveend();events.idle();
assert.ok(ctx.window.__nightLights.count>campus,'new downtown tiles must add lamps beyond the campus fence');
const n=ctx.window.__nightLights.count,w=writes;events.idle();assert.equal(ctx.window.__nightLights.count,n);assert.equal(writes,w,'unchanged tiles must not write the source again');
roads=[road(29.9)];events.moveend();events.idle();assert.equal(ctx.window.__nightLights.count,n,'city boundary remains bounded');
roads=[];events.moveend();events.idle();
roads=[road(30.273)];once.idle();events.idle();
assert.ok(ctx.window.__nightLights.count>n,'late road tiles must extend coverage without a second camera move');
console.log('PASS streetlights extend downtown, retain campus, deduplicate idle events, respect city bounds, and retry late road tiles');
