// Package an independently baked export into the versioned runtime contract.
// Geometry exports stay outside the repository; only compact shading is shipped.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import '../../js/baked-enclosure.js';
const args=process.argv.slice(2),source=args[args.indexOf('--source')+1],out=args[args.indexOf('--out')+1];
assert(args.includes('--source')&&args.includes('--out'),'usage: --source <bake directory> --out <asset directory>');
const api=globalThis.BakedEnclosure, input=JSON.parse(fs.readFileSync(path.join(source,'occlusion-manifest.json')));
const geometrySource=args.includes('--geometry')?args[args.indexOf('--geometry')+1]:source;
const manifest={version:1,encoding:'facet-low-bit-occlusion-7bit',bytes:0,sourceCommit:input.sourceCommit,sourceHashes:input.sourceHashes,settings:input.settings,targets:[]};
const chunks=[];
for(const t of input.targets) {
  const raw=fs.readFileSync(path.join(geometrySource,t.slug+'-geometry.json'));
  assert.equal(await api.sha256(raw),t.geometrySha256,'stale export');
  const data=JSON.parse(raw),attrs={};
  for(const [name,size] of [['position',3],['normal',3],['aSurface',4],['aFacet',1]]) {
    const array=new (name==='aFacet'?Uint8Array:Float32Array)(data.attributes[name].array);
    attrs[name]={array,itemSize:size,count:array.length/size,normalized:false};
  }
  const geometry={attributes:attrs,index:{array:new Uint32Array(data.indices)}};
  const range={id:t.name,start:0,end:data.indices.length/3};
  const fp=await api.fingerprint(geometry,range);
  const payload=fs.readFileSync(path.join(source,t.file));
  assert.equal(await api.sha256(payload),t.sha256,'corrupt bake');
  const target={id:t.name,vertices:fp.vertices,triangles:fp.triangles,hashes:fp.hashes,sha256:t.sha256,offset:manifest.bytes,bytes:payload.length};
  // Exercise the runtime decoder against each source geometry before publishing.
  await api.prepare(geometry,[range],{...manifest,bytes:payload.length,targets:[{...target,offset:0}]},new Uint8Array(payload));
  manifest.targets.push(target);manifest.bytes+=payload.length;chunks.push(payload);
}
const bytes=Buffer.concat(chunks);
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'enclosure.bin'),bytes);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({targets:manifest.targets.length,bytes:bytes.length,gzipBytes:zlib.gzipSync(bytes).length}));
