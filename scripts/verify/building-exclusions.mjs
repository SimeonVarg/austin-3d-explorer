import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const id = '526f0b7f-19e1-4489-826c-bff4b095c961';
const phantom = {type:'Feature',properties:{id,name:'Computation Center',final_height:5.5},geometry:{type:'Polygon',coordinates:[]}};
const retained = {type:'Feature',properties:{id:'retained'},geometry:{type:'Polygon',coordinates:[]}};
const app = fs.readFileSync(new URL('js/app.js',root),'utf8');
const start = app.indexOf('    const excludedIds =');
// The slice is the exclusion code only. It stops at the first block that follows it:
// the lidar knob (it awaits a fetch, and this vm is not async) or the Capitol splice.
const end = ['    // The lidar knob','    // The Capitol Complex'].map(mark=>app.indexOf(mark,start)).filter(at=>at>start).sort((a,b)=>a-b)[0];
assert.ok(start>=0 && end>start);
const osmPhantom = {properties:{id:'alternate-source',osm:'way/129435969'}};
const scope = vm.createContext({overrides:read('data/building_overrides.json'),buildings:{features:[phantom,osmPhantom,retained]},parts:{features:[{properties:{pid:id}},retained]},roofs:{features:[{properties:{bid:id}},retained]}});
vm.runInContext(app.slice(start,end),scope);
for(const collection of [scope.buildings,scope.parts,scope.roofs])assert.deepEqual(JSON.parse(JSON.stringify(collection.features)),[retained]);
const labels=read('data/labels.json').labels;
assert.ok(!labels.some(row=>row.buildingIds.includes(id)||row.name==='Computation Center'));
const entrances=read('data/entrances.geojson');
assert.ok(!entrances.features.some(feature=>feature.properties.bid===id||feature.properties.ref==='COM'));
const roofs=read('data/roofs.geojson');
assert.ok(!roofs.caps[id]);
const graph=read('data/walk_graph.json');
assert.ok(!graph.code.COM);
assert.ok(!Object.keys(graph.name).some(name=>/computation center/i.test(name)));
const roofSource = fs.readFileSync(new URL('js/roofs.js',root),'utf8');
const maskStart = roofSource.indexOf('  function excludeRetired(filter) {');
const maskEnd = roofSource.indexOf('\n  }',maskStart)+4;
assert.ok(maskStart>=0 && maskEnd>maskStart);
const masks = vm.createContext({excludedFootprints:[read('data/building_overrides.json').buildings[id].geometry]});
vm.runInContext(roofSource.slice(maskStart,maskEnd),masks);
const rooftopFilter = vm.runInContext("excludeRetired(['==', ['get', 'k'], 'deck'])",masks);
assert.equal(rooftopFilter[0],'all');
assert.deepEqual(JSON.parse(JSON.stringify(rooftopFilter[2].slice(0,2))),['>',['distance',read('data/building_overrides.json').buildings[id].geometry]]);
const footprint = read('data/building_overrides.json').buildings[id].geometry.coordinates[0];
function inside(point) {
  let contained = false;
  for(let current=0,previous=footprint.length-1;current<footprint.length;previous=current++){
    const [currentX,currentY]=footprint[current];
    const [previousX,previousY]=footprint[previous];
    if((currentY>point[1])!==(previousY>point[1]) && point[0]<(previousX-currentX)*(point[1]-currentY)/(previousY-currentY)+currentX)contained=!contained;
  }
  return contained;
}
for(const path of ['data/roofscape.geojson','data/roofscape.detail.geojson']){
  assert.ok(!read(path).features.some(feature=>feature.geometry.type==='Polygon' && feature.geometry.coordinates[0].every(inside)),`${path} has an excluded rooftop piece`);
}
console.log('PASS durable ID/OSM exclusion: building, part, roof, rooftop equipment, label, entrance and walk code; neighbouring building retained');
