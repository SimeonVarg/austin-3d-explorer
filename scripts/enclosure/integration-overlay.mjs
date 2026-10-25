// Reviewable integration adapter for branches whose generator is owned by other PRs.
// A verification browser serves this transformed source; production files are unchanged.
// Once ownership clears, replace this with these explicit hooks in the generator.
export function integrationOverlay(source,module) {
  const once=(from,to)=>{if(source.split(from).length!==2)throw Error('Integration source drift: '+from);source=source.replace(from,to);};
  once('    B.filterPending=[];','    B.filterPending=[];\n    const enclosureRanges=[];');
  once('      const pendingStart=B.filterPending.length;','      const enclosureStart=B.triangles;\n      const pendingStart=B.filterPending.length;');
  once('        _built.push(r.value);','        _built.push(r.value);\n        enclosureRanges.push({id:spec.name,start:enclosureStart,end:B.triangles,filtered:B.allowFilter});');
  once("      mesh.name = 'apartments';",`      mesh.name = 'apartments';
      const enclosure=BakedEnclosure.create();
      const enclosureLease=await enclosure.attach({mesh,ranges:enclosureRanges,
        manifestURL:'data/enclosure/manifest.json',payloadURL:'data/enclosure/enclosure.bin'});
      mesh.userData.enclosure={session:enclosure,lease:enclosureLease,ranges:enclosureRanges};
      geom.addEventListener('dispose',()=>enclosure.dispose());
      // Test observation only; does not drive readiness or renderer behavior.
      window.__enclosureBuild={...enclosure.state,facetVersion:geom.attributes.aFacet.version,
        attributes:Object.keys(geom.attributes),beforeSceneAdd:mesh.parent===null};`);
  return module+'\n'+source;
}
