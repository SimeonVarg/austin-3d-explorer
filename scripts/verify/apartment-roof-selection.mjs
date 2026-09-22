// Production selective-roof lifecycle: replace one roof without losing its
// siblings; a failed model must give the original roof back.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../js/slopes-apartments.js',import.meta.url),'utf8');
const at=source.lastIndexOf('})();');
const hook=`window.test={setup(data){_data=data},fail(id){_failed.add(id)},stashRigs,rigsMissing,openings,validateDetailMeshes};`;
const location={search:'?slopes=0'}, roofs={'hall/0/north':{name:'north'},'hall/0/south':{name:'south'},'neighbor/0':{name:'neighbor'}};
let rebuilds=0;
const window={location,slopesRoofs:{data:{roofs},rebuild(){rebuilds++}}};
const scope=vm.createContext({window,location,URLSearchParams,console});
vm.runInContext(source.slice(0,at)+hook+source.slice(at),scope);
const api=window.test;
api.setup({buildings:[{id:'hall',name:'Hall',preserveRoof:true,excludeRoofIds:['hall/0/north']}],replacedBuildingIds:['hall']});
assert.equal(api.rigsMissing().length,1);
api.stashRigs(true);
assert.deepEqual(Object.keys(roofs).sort(),['hall/0/south','neighbor/0']);
assert.equal(api.rigsMissing().length,0);
api.stashRigs(true);assert.equal(rebuilds,1,'stable apply must not rebuild roofs');
api.fail('hall');api.stashRigs(true);
assert.ok(roofs['hall/0/north'],'failed replacement restores its selective fallback');
api.stashRigs(false);assert.equal(Object.keys(roofs).length,3);
const skin={windows:[]},arch={rise:1.2,trim:.15},mullion={cols:[.5],rows:[.5],w:.04};
api.openings(skin,{openings:[{s0:1,s1:4,z0:0,z1:3,d:.3,glass:'glass',tone:'frame',arch,mullion}]},5,0,4,{}, {floors:[]},{},0);
assert.equal(skin.windows[0].arch,arch);assert.equal(skin.windows[0].mullion,mullion);
assert.equal(skin.windows[0].revealTone,'frame');
console.log('PASS: selective roof sibling preservation, stable reapply, failed fallback, and shaped opening data');

const mesh={id:'bad',tone:'steel',vertices:[[0,0,0],[1,0,0],[0,1,0]],triangles:[[0,1,2],[0,1,99]]};
assert.throws(()=>api.validateDetailMeshes({detailMeshes:[mesh]},{steel:['#000']}),/Invalid detail mesh/);
mesh.triangles.pop();api.validateDetailMeshes({detailMeshes:[mesh]},{steel:['#000']});
mesh.vertices[1][0]=NaN;assert.throws(()=>api.validateDetailMeshes({detailMeshes:[mesh]},{steel:['#000']}),/Invalid detail mesh/);
console.log('PASS: detail mesh rejects late invalid triangles and non-finite vertices before geometry emission');
