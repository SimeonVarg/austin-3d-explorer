/** Unified public-data name inventory. Run: node scripts/bake_labels.mjs [--report PATH]
 * No network, no dependency install, and no source-data mutation. This bake owns
 * only data/labels.json. Optional --report writes the coverage audit outside data.
 * Finder homes are read from their local file or the read-only claude/finder ref.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const exists = p => fs.existsSync(path.join(ROOT, p));
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const dist = (a,b) => Math.hypot((a[0]-b[0])*96000,(a[1]-b[1])*111320);
const pointOf = r => [r.lng,r.lat];
const unique = a => [...new Set(a.filter(Boolean))];
// Residential use wins over skyline prominence. OSM compound values such as
// apartments;commercial still describe homes. AMLI is the named apartment
// operator; several cached records omit building type entirely.
const apartmentUse=(name,type='',height=0)=>/(?:^|;)\s*(?:apartments|dormitory)\s*(?:;|$)/i.test(type)
  ||type==='residential'&&height>=18
  ||/\b(?:apartments|condominiums|residences|amli)\b/i.test(name)&&!/\boffice\b/i.test(name);
const snapshot = read('data/manifest.json').latest;
const sourcePath = `data/snapshots/${snapshot}/buildings.detailed.geojson`;
const features = read(sourcePath).features;
const byId = new Map(features.map(f => [f.properties.id,f]));
const graph = read('data/walk_graph.json');
const register = new Map(read('data/ut_buildings.json').buildings.map(b=>[b.ref,b.name]));
const lookupCode = new Map([
  ...[...register].map(([c,n])=>[norm(n),c]),
  ...Object.entries(graph.name).filter(([,c])=>register.has(c)).map(([n,c])=>[norm(n),c]),
]);
const oldSigns = read('data/signs.json').features;
const nameExtras = read('data/building_names.json');
const rows = [], gaps = [], candidates = [], modelHosts = new Map();
const rejectedCodes = [], skippedNumericNames = new Set();
// Graph aliases include inventory numbers (e.g. "740" -> MBB) and generic
// names. A name match alone must never move a UT identity across the city.
const codeSites = new Map(Object.entries(graph.code).filter(([c])=>register.has(c)).map(([c,indices])=>[c,indices.map(i=>graph.d[i]).filter(Boolean).map(d=>[d[0]*graph.q,d[1]*graph.q])]));
for(const [code,name] of register)if(!codeSites.has(code)) {
  const sites=features.filter(f=>norm(f.properties.name)===norm(name)).map(f=>anchor(f.geometry)).filter(Boolean);
  if(sites.length)codeSites.set(code,sites);
}
function validCode(code,p,name) {
  if(!code||!p)return;
  if(register.has(code)&&codeSites.get(code)?.some(site=>dist(p,site)<300))return code;
  rejectedCodes.push({name,code,lng:p[0],lat:p[1],reason:'No mapped UT site within 300 metres'});
}
function codeAt(name,p){return validCode(lookupCode.get(norm(name)),p,name);}

function ringsOf(g) { return g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []; }
function area(r) {
  const o=r[0]; let a=0;
  for(let i=0;i<r.length-1;i++) a+=(r[i][0]-o[0])*(r[i+1][1]-o[1])-(r[i+1][0]-o[0])*(r[i][1]-o[1]);
  return Math.abs(a)/2;
}
function inRing(p,r) {
  let yes=false;
  for(let i=0,j=r.length-1;i<r.length;j=i++) {
    const a=r[i],b=r[j];
    if((a[1]>p[1]) !== (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) yes=!yes;
  }
  return yes;
}
function inPoly(p,rings) { return inRing(p,rings[0]) && !rings.slice(1).some(r=>inRing(p,r)); }
function inGeometry(p,g) { return ringsOf(g).some(r=>inPoly(p,r)); }
function anchor(g) {
  if(g?.type==='Point') return g.coordinates;
  const poly=ringsOf(g).sort((a,b)=>area(b[0])-area(a[0]))[0];
  if(!poly) return null;
  const r=poly[0], xs=r.map(p=>p[0]),ys=r.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const c=[(minX+maxX)/2,(minY+maxY)/2];
  if(inPoly(c,poly)) return c;
  // A courtyard centroid is empty air. Pick a deterministic point inside the
  // solid footprint, favouring room around the point and proximity to centre.
  let best=null,score=-Infinity;
  for(let y=0;y<23;y++) for(let x=0;x<23;x++) {
    const p=[minX+(x+.5)*(maxX-minX)/23,minY+(y+.5)*(maxY-minY)/23];
    if(!inPoly(p,poly))continue;
    let edge=Infinity;
    for(const ring of poly) for(let i=0;i<ring.length-1;i++) {
      const a=[(ring[i][0]-p[0])*96000,(ring[i][1]-p[1])*111320];
      const b=[(ring[i+1][0]-p[0])*96000,(ring[i+1][1]-p[1])*111320];
      const vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*vx+a[1]*vy)/(vx*vx+vy*vy||1)));
      edge=Math.min(edge,Math.hypot(a[0]+vx*t,a[1]+vy*t));
    }
    const s=edge-.04*dist(p,c);if(s>score){score=s;best=p;}
  }
  return best || r[0];
}
const buildings=features.map(f=>({f,p:anchor(f.geometry)})).filter(x=>x.p);
function buildingAt(p,name) {
  const named=buildings.filter(x=>norm(x.f.properties.name)===norm(name)&&dist(p,x.p)<250);
  if(named.length)return named.sort((a,b)=>dist(p,a.p)-dist(p,b.p))[0].f;
  return buildings.find(x=>dist(p,x.p)<200&&inGeometry(p,x.f.geometry))?.f;
}
function roof(b) {
  const levels=b.levels || {}, floors=levels.floors||[];
  return Number(levels.roof || floors[floors.length-1] || byId.get(b.id)?.properties.final_height || 0);
}
function add({name,kind,p,height=0,code,buildingIds=[],source,aliases=[],fullName,geometry,area:region}) {
  name=clean(name); if(!name||!p||!p.every(Number.isFinite))return;
  const parts=unique(name.split(';').map(clean));
  if(parts.length>1){name=[...parts].sort((a,b)=>a.length-b.length)[0];aliases=unique([...aliases,...parts]).filter(n=>n!==name);}
  if(/^\d+$/.test(name)){skippedNumericNames.add(name);return;}
  code=validCode(code,p,name);
  if(p[0]<-97.80||p[0]>-97.69||p[1]<30.225||p[1]>30.325)return;
  if(/^(permanently closed|demolished|construction site)/i.test(name))return;
  const keys=unique([name,...aliases,code].map(norm));
  let previous=rows.find(r=>dist(pointOf(r),p)<250 && (
    buildingIds.length&&r.buildingIds.some(id=>buildingIds.includes(id))&&kind!== 'place'&&r.kind!== 'place' ||
    dist(pointOf(r),p)<110&&keys.some(k=>r._keys.includes(k))));
  if(previous) {
    previous.sources=unique([...previous.sources,source]);
    previous.aliases=unique([...previous.aliases,name,...aliases]).filter(n=>n!==previous.name);
    previous._keys=unique([...previous._keys,...keys]);
    previous.buildingIds=unique([...previous.buildingIds,...buildingIds]);
    if(code&&!previous.code) previous.code=code;
    if(kind==='campus'&&code&&previous.kind==='apartment'&&!['D21','N24'].includes(code))previous.kind='campus';
    if(kind==='apartment'&&['landmark','place'].includes(previous.kind))previous.kind='apartment';
    if(fullName&&!previous.fullName)previous.fullName=fullName;
    if(!previous.height&&height)previous.height=height;
    return previous;
  }
  const row={name,kind,lng:+p[0].toFixed(7),lat:+p[1].toFixed(7),height:+height.toFixed(2),buildingIds,sources:[source],aliases,_keys:keys};
  if(code)row.code=code;if(fullName)row.fullName=fullName;if(region)row.area=region;
  if(geometry)row._geometry=geometry;
  rows.push(row);return row;
}
function addModel(b,source,forceKind) {
  if(!b.footprint?.ring)return;
  const geometry={type:'Polygon',coordinates:[b.footprint.ring,...(b.footprint.holes||[])]};
  if(!modelHosts.has(b.id))modelHosts.set(b.id,{geometry,height:roof(b),source});
  const code=validCode(b.code||lookupCode.get(norm(b.name)),anchor(geometry),b.name);
  const kind=forceKind || ((code&&!['D21','N24'].includes(code))||/dormitory|jester .*hall|san jacinto hall/i.test(b.name)?'campus':/hotel|moody center/i.test(b.name)?'landmark':'apartment');
  const row=add({name:b.name,kind,p:anchor(geometry),geometry,height:roof(b),code,buildingIds:[b.id],aliases:b.aliases||[],source});
  if(kind==='apartment')candidates.push({name:b.name,p:pointOf(row),source});
}

for(const file of read('data/apartments/index.json').buildings) addModel(read(`data/apartments/${file}`),`data/apartments/${file}`);
for(const file of ['neighborhood_apartments.json','campus_buildings.json','speedway_buildings.json','south_campus.json']) {
  if(exists(`data/${file}`))for(const b of read(`data/${file}`).buildings||[])addModel(b,`data/${file}`,file.includes('apartments')?'apartment':'campus');
}

let finder, finderSource;
if(exists('data/finder/homes.json')){finder=read('data/finder/homes.json');finderSource='data/finder/homes.json';}
else for(const ref of ['origin/claude/finder','claude/finder']) {
  try{finder=JSON.parse(execFileSync('git',['show',`${ref}:data/finder/homes.json`],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}));finderSource=`${ref}:data/finder/homes.json`;break;}catch{}
}
// Preserve the small finder-only public inventory on machines where the reviewed
// finder branch no longer exists. Provenance remains the original public data.
if(!finder&&exists('data/labels.json')) {
  const old=read('data/labels.json');finder={homes:old.finderHomes||[]};finderSource=old.finderSource;
}
if(!finder?.homes?.length)throw Error('Finder homes unavailable: supply data/finder/homes.json or claude/finder ref before baking.');
for(const h of finder.homes) {
  const b=buildingAt(h.p,h.name),kind=h.kind==='dorm'?'campus':'apartment';
  add({name:h.name,kind,p:b?anchor(b.geometry):h.p,height:b?.properties.final_height||0,buildingIds:b?[b.properties.id]:[],aliases:[h.wc].filter(Boolean),source:finderSource,area:h.area});
  if(kind==='apartment')candidates.push({name:h.name,p:h.p,source:finderSource});
}
function doors(indices) {
  const ds=indices.map(i=>graph.d[i]).filter(Boolean),main=ds.filter(d=>d[4]==='main'),use=main.length?main:ds;
  return use.length?[use.reduce((s,d)=>s+d[0],0)*graph.q/use.length,use.reduce((s,d)=>s+d[1],0)*graph.q/use.length]:null;
}
for(const [name,indices] of Object.entries(graph.wc)) {
  const p=doors(indices),b=buildingAt(p,name);
  add({name,kind:'apartment',p:b?anchor(b.geometry):p,height:b?.properties.final_height||0,buildingIds:b?[b.properties.id]:[],source:'data/walk_graph.json:wc'});
  candidates.push({name,p,source:'data/walk_graph.json:wc'});
}
for(const [code,indices] of Object.entries(graph.code)) {
  if(!register.has(code))continue; // OSM also uses ref for hotel/property identifiers.
  const p=doors(indices), ds=indices.map(i=>graph.d[i]), name=ds.find(d=>d?.[7])?.[7]||register.get(code);
  if(!p||!name)continue;
  const b=buildingAt(p,name),id=b?.properties.id;
  add({name,code,kind:'campus',p:b?anchor(b.geometry):p,height:b?.properties.final_height||0,buildingIds:id?[id]:[],fullName:register.get(code),source:'data/walk_graph.json:code',aliases:[register.get(code)].filter(Boolean)});
}

for(const f of features) {
  const b=f.properties,name=b.name||nameExtras[b.id];if(!name)continue;
  const p=anchor(f.geometry),code=codeAt(name,p);
  const kind=code||b.building_class==='university'?'campus':apartmentUse(name,b.building_class,b.final_height)?'apartment':b.final_height>=60?'landmark':'place';
  add({name,kind,p,height:b.final_height||0,code,buildingIds:[b.id],source:b.name?sourcePath:'data/building_names.json'});
  if(kind==='apartment')candidates.push({name,p,source:sourcePath});
}

const outer=read('data/outer_ring.geojson').features;
const outerIndex=outer.map(f=>({f,p:anchor(f.geometry)}));
const outerBodies=outer.map((f,index)=>{
  if(f.properties.k||!(f.properties.h>0))return null;
  const points=ringsOf(f.geometry).flatMap(p=>p[0]);if(!points.length)return null;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return {f,index,center:[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2]};
}).filter(Boolean);
const inventory=read('data/massing_targets.json');
const disputedSites=inventory.filter(b=>/^UNIDENTIFIED/i.test(b.name));
// The named inventory carries current tower heights; old imagery-derived outer
// masses can still be the demolished low building formerly occupying the site.
for(const b of inventory) {
  if(b.area!=='downtown'||/^UNIDENTIFIED/i.test(b.name))continue;
  add({name:b.name,kind:'landmark',p:[b.lng,b.lat],height:b.height_m||0,buildingIds:b.snapshot_ids||[],source:'data/massing_targets.json'});
}
const tags=read('data/osm_cache/outer_tags.json');
for(const t of tags) {
  if(!t.n)continue;
  const p=[t.x,t.y],b=buildingAt(p,t.n),code=codeAt(t.n,p);
  if(disputedSites.some(site=>dist(p,[site.lng,site.lat])<25))continue;
  const ext=!b?outerIndex.find(x=>dist(x.p,p)<160&&inGeometry(p,x.f.geometry))?.f:null;
  const h=b?.properties.final_height||ext?.properties.h||Number(t.h)||Number(t.lv||0)*3.3;
  const kind=code||t.b==='university'?'campus':apartmentUse(t.n,t.b,h)?'apartment':h>=60?'landmark':'place';
  add({name:t.n,kind,p:b?anchor(b.geometry):ext?anchor(ext.geometry):p,height:h,code,buildingIds:b?[b.properties.id]:[],source:'data/osm_cache/outer_tags.json'});
  if(kind==='apartment')candidates.push({name:t.n,p,source:'data/osm_cache/outer_tags.json'});
}

// Places use their street-facing sign anchor, not the unrelated roof above them.
const placeFeatures=read('data/places.geojson').features;
for(const f of placeFeatures) {
  const p=f.properties;if(p.kind!=='label')continue;
  add({name:p.nm,kind:'place',p:anchor(f.geometry),height:Number(p.h)||0,buildingIds:[p.bid].filter(Boolean),source:'data/places.geojson'});
}
for(const file of ['places.json','food.json']) for(const e of read(`data/osm_cache/${file}`).elements||[]) {
  const t=e.tags||{},p=e.lon?[e.lon,e.lat]:e.center?[e.center.lon,e.center.lat]:null;
  if(!t.name||!p)continue;
  add({name:t.name,kind:'place',p,height:0,source:`data/osm_cache/${file}`});
}
for(const f of read('data/props.geojson').features) {
  const p=f.properties;
  if(p.k==='art'&&p.name)add({name:p.name,kind:'place',p:anchor(f.geometry),height:Number(p.h)||0,source:'data/props.geojson'});
}
for(const f of oldSigns) {
  const p=f.properties,loc=f.geometry.coordinates;
  const kind=p.category==='apartment'?'apartment':p.category==='food'?'place':'landmark';
  // Curated shorthand is an alias when the named building occupies this point.
  const b=buildingAt(loc,p.label),existing=b&&rows.find(r=>r.buildingIds.includes(b.properties.id));
  add({name:p.label,kind,p:loc,height:p.height||0,buildingIds:existing&&kind!=='place'?[b.properties.id]:[],source:'data/signs.json'});
}

// Sources can bridge two authored wings after each wing was already read.
// Resolve those transitive identities once; tenants never merge by building id.
for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++) {
  const a=rows[i],b=rows[j];
  if(a.kind==='place'||b.kind==='place'||dist(pointOf(a),pointOf(b))>=250)continue;
  if(!a.buildingIds.some(id=>b.buildingIds.includes(id)))continue;
  a.aliases=unique([...a.aliases,b.name,...b.aliases]).filter(n=>n!==a.name);
  a.sources=unique([...a.sources,...b.sources]);a.buildingIds=unique([...a.buildingIds,...b.buildingIds]);
  a._keys=unique([...a._keys,...b._keys]);if(!a.code&&b.code)a.code=b.code;
  rows.splice(j--,1);
}

// Local brand aliases only: never a global prefix merge. Preserve directional
// qualifiers, numbered wings and house names (Pearl North/South, Colorado A/B).
function apartmentKey(name) {
  return norm(clean(name).toLowerCase().replace(/^the\s+/,'')
    .replace(/\bapts?\.?\b/g,'apartments').replace(/\bapartments\b/g,'')
    .trim().replace(/(?:\s+(?:at|in))?\s+(?:austin|west campus|atx)$/,''));
}
const apartmentAliasMerges=[];
for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++) {
  const a=rows[i],b=rows[j];if(a.kind!=='apartment'||b.kind!=='apartment')continue;
  const distance=dist(pointOf(a),pointOf(b));
  const sameBrand=distance<60&&apartmentKey(a.name).length>=4&&apartmentKey(a.name)===apartmentKey(b.name);
  // The generic legacy sign sits in Grayson House's courtyard, six metres
  // from its roof anchor. This exception never aliases the other Quarters houses.
  const graysonSign=distance<15&&a.name==='The Quarters Grayson House'&&b.name==='The Quarters'&&b.sources.every(s=>s==='data/signs.json');
  if(!sameBrand&&!graysonSign)continue;
  apartmentAliasMerges.push({name:a.name,alias:b.name,distanceMetres:Math.round(distance),reason:graysonSign?'Legacy sign at Grayson House courtyard':'Same normalized local brand; apartment/Apts or city/campus suffix'});
  a.aliases=unique([...a.aliases,b.name,...b.aliases]).filter(n=>n!==a.name);
  a.sources=unique([...a.sources,...b.sources]);a.buildingIds=unique([...a.buildingIds,...b.buildingIds]);
  a._keys=unique([...a._keys,...b._keys]);if(!a.height&&b.height)a.height=b.height;
  rows.splice(j--,1);
}

// On-demand areas (data/apartments/index.json `areas`, e.g. Riverside) build
// their authored complexes only when the camera comes near. The sources above
// name each complex at a site point (a finder home, an office tag, an old
// outer-ring mass) that the authored buildings now replace. Put the name on
// the complex's own building that holds, or is nearest to, that site point,
// above its real top: pitched ridges and roof meshes, not the eave line.
// Canopies, carports, pools and ground-only site paths never host a name.
const areaHostTune = { maxSiteDistanceMetres:250, minTopMetres:2,
  notAHost:/\b(canopy|carport|covered parking|pool|service)\b/i };
function authoredTop(b) {
  let top=0;
  for(const blk of b.blocks||[]) {
    top=Math.max(top,blk.z1+(blk.parapet||0));
    for(const it of blk.roofItems||[])top=Math.max(top,blk.z1+(it.z0||0)+(it.h||0));
    // A pitched block roof rises at most half the frame's short side at its pitch.
    const pitch=blk.roof?.pitch,w=b.frame?.obb?.W;
    if(pitch>0&&w>0)top=Math.max(top,blk.z1+w/2*Math.tan(pitch*Math.PI/180));
  }
  for(const m of b.detailMeshes||[])for(const v of m.vertices||[])top=Math.max(top,v[2]);
  return top;
}
const areaHostAudit=[];
for(const [area,spec] of Object.entries(read('data/apartments/index.json').areas||{})) {
  const hosts=[];
  for(const file of spec.collections||[])for(const b of read(file).buildings||[]) {
    if(!b.footprint?.ring||!b.name||areaHostTune.notAHost.test(b.name))continue;
    const top=authoredTop(b);if(!(top>=areaHostTune.minTopMetres))continue;
    const geometry={type:'Polygon',coordinates:[b.footprint.ring,...(b.footprint.holes||[])]};
    hosts.push({b,file,geometry,top,p:anchor(geometry),key:apartmentKey(b.complex||b.name)});
    if(!modelHosts.has(b.id))modelHosts.set(b.id,{geometry,height:top,source:file});
  }
  for(const r of rows.filter(r=>r.kind==='apartment')) {
    const key=apartmentKey(r.name),site=pointOf(r);
    if(key.length<4)continue;
    const own=hosts.filter(h=>h.key.startsWith(key)).map(h=>({...h,distance:inGeometry(site,h.geometry)?0:dist(site,h.p)}));
    if(!own.length)continue;
    const host=own.sort((a,b)=>a.distance-b.distance||a.b.id.localeCompare(b.b.id))[0];
    if(host.distance>areaHostTune.maxSiteDistanceMetres)throw Error(`Area host too far from its site: ${r.name}`);
    r.lng=+host.p[0].toFixed(7);r.lat=+host.p[1].toFixed(7);r.height=+host.top.toFixed(2);
    r.buildingIds=unique([...r.buildingIds,host.b.id]);r.sources=unique([...r.sources,host.file]);
    areaHostAudit.push({name:r.name,area,site,lng:r.lng,lat:r.lat,height:r.height,buildingId:host.b.id,
      building:host.b.name,source:host.file,siteDistanceMetres:+host.distance.toFixed(1),
      method:'Authored building of this complex holding or nearest its site point; label above its highest roof'});
  }
}

// OSM bounds centres can lie in empty courtyards or concave cut-outs. A unique
// sub-two-metre match to the shipped footprint's bounds verifies that identity;
// nearby-but-unmatched buildings never supply apartment heights.
const recoveredApartmentHeights=[];
// The Capitol extension is merged into the same rendered building source.
// Recover only a unique, exactly named solid host; its baked height describes
// the current scene, not an independently measured architectural height.
const capitolBodies=read('data/capitol.geojson').features;
for(const r of rows.filter(r=>r.kind==='apartment'&&!r.height)) {
  const matches=capitolBodies.filter(f=>norm(f.properties.name)===norm(r.name)
    &&Number(f.properties.final_height)>0&&inGeometry(pointOf(r),f.geometry));
  if(matches.length!==1)continue;
  const host=matches[0];r.height=Number(host.properties.final_height);
  r.sources=unique([...r.sources,'data/capitol.geojson']);
  r.buildingIds=unique([...r.buildingIds,host.properties.id]);
  recoveredApartmentHeights.push({name:r.name,height:r.height,lng:r.lng,lat:r.lat,
    source:'data/capitol.geojson',buildingId:host.properties.id,solidFootprintAnchor:true,
    method:'Exact name and containment in one loaded Capitol-extension building'});
}
const officeAnchors={
  'Town Lake Student Apartments':'Town Lake apartments office',
  'The Element Austin':'The Element Austin office',
};
for(const r of rows.filter(r=>r.kind==='apartment'&&!r.height)) {
  const officeName=officeAnchors[r.name];
  const office=officeName&&tags.find(t=>t.n===officeName&&Number(t.h)>0&&dist([t.x,t.y],pointOf(r))<250);
  const p=office?[office.x,office.y]:pointOf(r);
  const matches=outerBodies.filter(x=>dist(x.center,p)<2);
  const body=matches.length===1?matches[0]:null;
  if(!body&&!office)continue;
  const next=body?anchor(body.f.geometry):p;
  r.lng=+next[0].toFixed(7);r.lat=+next[1].toFixed(7);
  r.height=+(body?body.f.properties.h:Number(office.h)).toFixed(2);
  r.sources=unique([...r.sources,'data/osm_cache/outer_tags.json',...(body?['data/outer_ring.geojson']:[])]);
  recoveredApartmentHeights.push({name:r.name,height:r.height,lng:r.lng,lat:r.lat,
    method:office?`Named complex office: ${officeName}`:'Unique OSM/baked footprint bounds-centre match under 2 m',
    ...(body?{outerFeatureIndex:body.index,solidFootprintAnchor:true}:{solidFootprintAnchor:false,note:'Named OSM office point and explicit height; small office geometry absent from loaded outer source'})});
}

// These sites have no matching rendered building. Use their mapped access
// frontage rather than borrowing a neighbour's roof. Reviewed OSM way ids keep
// the placement deliberate; the inset points toward the original property.
// Estates and Village at East Riverside now have authored buildings in an
// on-demand area (above), so their entries apply only if that area is removed.
const besideSiteWays = {
  'Colorado D':136149802, 'Colorado J':136224826, 'Colorado K':136224826,
  'Colorado L':820431909, 'Colorado M':773679741, 'Colorado N':136149803,
  'Echo':1257622167, 'Estates at East Riverside':465490658,
  'Village at East Riverside':465477024,
};
const besideSiteTune = { frontageInsetMetres:3, maxSiteDistanceMetres:55 };
const accessWays=read('data/osm_cache/roads.json').elements;
const deliberateApartmentAnchors=[];
for(const r of rows.filter(r=>r.kind==='apartment'&&!r.height&&besideSiteWays[r.name])) {
  const site=pointOf(r),way=accessWays.find(w=>w.id===besideSiteWays[r.name]);
  if(!way?.geometry?.length)throw Error(`Missing reviewed frontage: ${r.name}`);
  const line=way.geometry.map(p=>[p.lon,p.lat]);let nearest=null;
  for(let i=1;i<line.length;i++) {
    const a=line[i-1],b=line[i],vx=(b[0]-a[0])*96000,vy=(b[1]-a[1])*111320;
    const t=Math.max(0,Math.min(1,((site[0]-a[0])*96000*vx+(site[1]-a[1])*111320*vy)/(vx*vx+vy*vy||1)));
    const p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=dist(p,site);
    if(!nearest||distance<nearest.distance)nearest={p,distance};
  }
  if(!nearest||nearest.distance>besideSiteTune.maxSiteDistanceMetres)throw Error(`Frontage moved too far: ${r.name}`);
  const fraction=Math.min(1,besideSiteTune.frontageInsetMetres/Math.max(.01,nearest.distance));
  const next=nearest.p.map((v,i)=>v+(site[i]-v)*fraction);
  const occupying=[...buildings.map(b=>b.f),...outerBodies.map(b=>b.f),...capitolBodies,...[...modelHosts.values()].map(b=>({geometry:b.geometry}))]
    .some(f=>inGeometry(next,f.geometry));
  if(occupying)throw Error(`Beside-site anchor intersects loaded building: ${r.name}`);
  r.lng=+next[0].toFixed(7);r.lat=+next[1].toFixed(7);
  r.placement={type:'beside-site',site,accessWayId:way.id,
    reason:'No matching loaded building; mapped access frontage beside the property'};
  r.sources=unique([...r.sources,'data/osm_cache/roads.json']);
  deliberateApartmentAnchors.push({name:r.name,...r.placement,lng:r.lng,lat:r.lat,height:0,
    distanceMetres:+dist(site,pointOf(r)).toFixed(2),outsideLoadedFootprints:true});
}

// Cached POI points can be indoors. Recover only exact, unambiguous containment
// in shipped solid building bodies, using authored replacement roofs where one
// exists. Keep the POI's own horizontal position and identity so separate shops
// are not collapsed onto a shared building-centre label. Authored street-facing
// data/places anchors are deliberately preserved.
function strictlyInside(p,g) {
  if(!inGeometry(p,g))return false;
  for(const poly of ringsOf(g))for(const ring of poly)for(let i=0;i<ring.length-1;i++) {
    const a=[(ring[i][0]-p[0])*96000,(ring[i][1]-p[1])*111320];
    const b=[(ring[i+1][0]-p[0])*96000,(ring[i+1][1]-p[1])*111320];
    const vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*vx+a[1]*vy)/(vx*vx+vy*vy||1)));
    if(Math.hypot(a[0]+vx*t,a[1]+vy*t)<.1)return false;
  }
  return true;
}
const placeHeightAudit={recovered:[],preservedStreetAnchors:0,unmatched:0,unresolved:[]};
for(const r of rows.filter(r=>r.kind==='place'&&!r.height)) {
  if(r.sources.includes('data/places.geojson')){placeHeightAudit.preservedStreetAnchors++;continue;}
  const p=pointOf(r),hosts=[];
  for(const {f} of buildings) {
    const b=f.properties,model=modelHosts.get(b.id),geometry=model?.geometry||f.geometry;
    const height=model?.height||b.final_height||0;
    if(height>0&&strictlyInside(p,geometry))hosts.push({geometry,height,source:model?.source||sourcePath,buildingId:b.id,name:b.name});
  }
  for(const body of outerBodies)if(strictlyInside(p,body.f.geometry))hosts.push({geometry:body.f.geometry,height:body.f.properties.h,source:'data/outer_ring.geojson',outerFeatureIndex:body.index});
  if(!hosts.length){placeHeightAudit.unmatched++;continue;}
  // Stadium seating replaces the snapshot mass with a nonuniform bowl. The
  // old footprint and a single maximum height cannot establish this cafe roof.
  if(hosts.length!==1||hosts[0].buildingId==='6b5bbe97-18db-42fa-94c1-5d63cf7ffe34') {
    placeHeightAudit.unresolved.push({name:r.name,lng:r.lng,lat:r.lat,reason:hosts.length!==1?'Multiple overlapping loaded bodies; no unique host':'Custom stadium bowl has no verified roof height at this POI'});continue;
  }
  const host=hosts[0];r.height=+host.height.toFixed(2);
  r.sources=unique([...r.sources,host.source]);
  if(host.buildingId)r.buildingIds=unique([...r.buildingIds,host.buildingId]);
  placeHeightAudit.recovered.push({name:r.name,lng:r.lng,lat:r.lat,height:r.height,source:host.source,
    ...(host.buildingId?{buildingId:host.buildingId,buildingName:host.name}:{outerFeatureIndex:host.outerFeatureIndex}),
    method:'POI remains at its original point strictly inside one loaded solid footprint; verified host roof height'});
}

// Massing inventory heights are rounded architectural figures. Do not let a
// rounded-down value put the label into a loaded roof/crown at the SAME point.
// This never borrows a nearby tower's height or lowers a label onto a podium.
const downtownRoofAudit=[];
for(const r of rows.filter(r=>r.sources.includes('data/massing_targets.json'))) {
  const p=pointOf(r);
  const covering=outer.map((f,index)=>({f,index})).filter(({f})=>
    (!f.properties.k||f.properties.k==='c')&&f.properties.h>r.height&&strictlyInside(p,f.geometry));
  if(!covering.length)continue;
  const top=covering.sort((a,b)=>b.f.properties.h-a.f.properties.h)[0];
  downtownRoofAudit.push({name:r.name,before:r.height,height:top.f.properties.h,lng:r.lng,lat:r.lat,outerFeatureIndex:top.index});
  r.height=top.f.properties.h;r.sources=unique([...r.sources,'data/outer_ring.geojson']);
}

// Factual reductions of the UT register/source names; codes remain separate.
const campusDisplay = {
  ATT:'AT&T Conference Center', AF2:'Athletic Fields Pavilion - East',
  BBR:'Basketball & Rowing Training', BRB:'Rapoport Building', GDC:'Gates Dell Complex',
  CLK:'Clark Field Support', CPE:'Chemical & Petroleum Engineering', PAC:'Performing Arts Center',
  DFA:'Doty Fine Arts Building', EER:'Engineering Education & Research', GLT:'Thomas Energy Engineering',
  GSB:'Graduate School of Business', PAT:'Patterson Laboratories', JGB:'Jackson Geological Sciences',
  CMA:'Jones Communication - A', CMB:'Jones Communication - B', TCC:'Thompson Conference Center',
  CCJ:'Connally Center for Justice', FNT:'Faulkner Nano Science & Tech', TSC:'Jamail Texas Swimming Center',
  MBB:'Moffett Molecular Biology', LBJ:'Lyndon B. Johnson Library', NMS:'Neural Molecular Science',
  POB:"Peter O'Donnell Jr. Building", PMA:'Physics, Math & Astronomy', MFH:'Mithoff Track & Soccer Fieldhouse',
  SEA:'Seay Building', WCP:'Powers Student Activity Center',
};
for(const r of rows)if(r.kind==='campus'&&r.code&&campusDisplay[r.code]) {
  const display=campusDisplay[r.code];
  if(display!==r.name){
    r.aliases=unique([...r.aliases,r.name,register.get(r.code)]);
    if(!r.fullName||r.name.length>r.fullName.length)r.fullName=r.name;
    r._keys=unique([...r._keys,norm(display)]);r.name=display;
  }
}

// Compare eligibility, not a single screenshot: a formerly eligible name could
// still lose a screen-space collision. Keep those cases out of "newly named".
function oldShort(n) {
  let s=n.replace(/^permanently closed:\s*/i,'').replace(/\s*\([^)]*\)/g,'').trim();
  if(s.length>30)s=s.replace(/^(.+?\s+\S+)\s+for\s+.+$/i,'$1');
  const w=s.split(/\s+/);return w.length>=4&&/^(building|complex|facility)$/i.test(w.at(-1))?w.slice(0,-1).join(' '):s;
}
const oldEligible=oldSigns.map(f=>({name:f.properties.label,p:f.geometry.coordinates,source:'signs-label'}));
for(const f of features) {
  const p=f.properties,name=p.name||nameExtras[p.id],h=p.final_height||0;if(!name||h<12)continue;
  const v=ringsOf(f.geometry).reduce((s,p)=>s+area(p[0]),0)*96000*111320*h;
  let tier=v>=130000||h>=55?0:v>=42000||h>=30?1:v>=13000?2:3;
  const short=oldShort(name);
  if(/\b(garage|parking|cooling tower|chilling|chiller|power plant|substation|annex|utility plant|storage|maintenance)\b/i.test(short))tier=Math.min(3,tier+2);
  if(short.length>34)tier=Math.min(3,tier+1);
  if(tier<=2)oldEligible.push({name:short,p:anchor(f.geometry),source:'buildings-labels',buildingId:p.id});
}
for(const f of placeFeatures)if(f.properties.kind==='label')oldEligible.push({name:f.properties.nm,p:anchor(f.geometry),source:'places-label'});
const apartments=rows.filter(r=>r.kind==='apartment');
const missing=[],renamed=[],existing=[];
for(const r of apartments) {
  const near=oldEligible.filter(x=>dist(x.p,pointOf(r))<160);
  const exact=near.find(x=>norm(x.name)===norm(r.name));
  const alias=near.find(x=>r._keys.includes(norm(x.name))||x.buildingId&&r.buildingIds.includes(x.buildingId)||norm(x.name).length>=6&&(norm(r.name).includes(norm(x.name))||norm(x.name).includes(norm(r.name))));
  const entry={name:r.name,lng:r.lng,lat:r.lat,sources:r.sources};
  if(exact)existing.push(entry);else if(alias)renamed.push({...entry,before:alias.name});else missing.push(entry);
}
const uncovered=candidates.filter(c=>!rows.some(r=>['apartment','campus','landmark'].includes(r.kind)&&r._keys.includes(norm(c.name))&&dist(pointOf(r),c.p)<250));
gaps.push(...uncovered.map(c=>({name:c.name,reason:'Source classified differently or duplicate position needs review',source:c.source})));
const unnamed=tags.filter(t=>t.b==='apartments'&&!t.n).length;
const allCodes=unique(rows.map(r=>r.code));
const stats={labels:rows.length,apartments:apartments.length,campus:rows.filter(r=>r.kind==='campus').length,places:rows.filter(r=>r.kind==='place').length,landmarks:rows.filter(r=>r.kind==='landmark').length,utCodes:allCodes.length,newlyNamedApartments:missing.length,renamedApartments:renamed.length,previouslyEligibleApartments:existing.length,unnamedOsmApartmentParts:unnamed};
for(const r of rows) {
  r.id=`${r.kind}-${createHash('sha1').update(`${norm(r.name)}|${r.lng.toFixed(5)}|${r.lat.toFixed(5)}`).digest('hex').slice(0,12)}`;
  delete r._keys;delete r._geometry;
  r.sources.sort();r.aliases.sort();r.buildingIds.sort();
}
rows.sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate catalog label id');
for(const r of rows)if(![r.lng,r.lat,r.height].every(Number.isFinite))throw Error(`Invalid position/height: ${r.name}`);
const data={version:1,license:'OpenStreetMap-derived records: ODbL-1.0; UT register: published factual building names.',heightMeaning:'Metres above local ground; 0 means no measured roof height. Explicit beside-site placements and place anchors are at street level.',snapshot,finderSource,finderHomes:finder.homes.map(h=>({id:h.id,name:h.name,kind:h.kind,p:h.p,area:h.area,wc:h.wc})),stats,labels:rows};
fs.writeFileSync(path.join(ROOT,'data/labels.json'),JSON.stringify(data)+'\n');
const report={...stats,definition:'Missing means absent from the former eligible sign/building/place name inventory, not simply absent in one screenshot. Renamed/shortened aliases are separate. Current catalog eligibility does not promise simultaneous display.',missingBefore:missing,renamedAliases:renamed,previouslyEligible:existing,gaps,limitations:[`${unnamed} OpenStreetMap apartment parts have no public name in this cache. No names were invented.`, `${deliberateApartmentAnchors.length} apartments without matching loaded buildings use documented access-frontage placements; no roof height is invented.`, `${areaHostAudit.length} apartments in on-demand areas sit on their own authored buildings, which load only near the area.`, 'UT register rows without mapped walking-graph sites cannot be placed from the register alone.']};
report.codeValidation={maxDistanceMetres:300,rejected:rejectedCodes,skippedNumericNames:[...skippedNumericNames].sort()};
report.apartmentAliasMerges=apartmentAliasMerges;
report.placeHeightAudit=placeHeightAudit;
report.downtownRoofAudit=downtownRoofAudit;
report.areaHostAudit=areaHostAudit;
report.apartmentHeightAudit={recovered:recoveredApartmentHeights,deliberateBesideSite:deliberateApartmentAnchors,unresolved:apartments.filter(r=>!r.height&&!r.placement).map(r=>({name:r.name,lng:r.lng,lat:r.lat,reason:'No matched loaded footprint and no deliberate beside-site placement'}))};
const reportArg=process.argv.indexOf('--report');
if(reportArg>=0){const target=process.argv[reportArg+1];if(!target)throw Error('--report requires path');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(stats,null,2));console.log('Coverage gaps:',gaps.length);
