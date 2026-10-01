// Export the actual generated triangle ranges. Scratch geometry stays outside Git.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {launch,HW_ARGS} from './chrome.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),outArg=args.indexOf('--out');
assert(outArg>=0&&args[outArg+1],'usage: VERIFY_URL=<local server> node scripts/verify/export-enclosure.mjs --out <outside-repo directory>');
const out=path.resolve(args[outArg+1]),relative=path.relative(root,out);
assert(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'geometry exports must be outside the repository');
const url=new URL(process.env.VERIFY_URL||'http://127.0.0.1:8000');
assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'export must use a local server for this checkout');
url.pathname='/index.html';url.search='intro=0&drift=0&preset=balanced&clip=1';
const names=['Battle Hall','Union Building','Mary E. Gearing Hall'];
let source=fs.readFileSync(path.join(root,'js/slopes-apartments.js'),'utf8');
const once=(from,to)=>{assert.equal(source.split(from).length,2,'generator source drift');source=source.replace(from,to)};
once('    B.filterPending=[];','    B.filterPending=[]; window.__enclosureExportRanges=[];');
once('      const pendingStart=B.filterPending.length;','      const enclosureStart=B.triangles;\n      const pendingStart=B.filterPending.length;');
once('        _built.push(r.value);','        _built.push(r.value); window.__enclosureExportRanges.push({name:spec.name,start:enclosureStart,end:B.triangles,filtered:B.allowFilter});');
const browser=await launch(chromium,{gl:'hardware',maxMs:360000,args:[...HW_ARGS,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  await page.route('**/js/slopes-apartments.js*',r=>r.fulfill({contentType:'application/javascript',body:source}));
  await page.addInitScript(()=>{const timer=setInterval(()=>{window.cancelGraphicsAutoDetect?.();if(window.cancelGraphicsAutoDetect)clearInterval(timer)},10)});
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.slopesApartments?.group&&slopesApartments.readyToReveal()&&!document.getElementById('veil')&&!window.__fly?.eye().driving,null,{timeout:240000});
  const ranges=await page.evaluate(names=>window.__enclosureExportRanges.filter(r=>names.includes(r.name)),names);
  assert.equal(ranges.length,names.length);assert.equal(new Set(ranges.map(r=>r.name)).size,names.length);
  assert(!ranges.some(r=>r.filtered),'filtered geometry requires a near/far bake contract');
  const manifest={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),exported:new Date().toISOString(),targets:[],sources:{}};
  for(const file of ['js/slopes.js','js/slopes-apartments.js','data/campus_buildings.json','data/apartments/battle-hall.json'])
    manifest.sources[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  fs.mkdirSync(out,{recursive:true});
  for(const range of ranges) {
    const data=await page.evaluate(r=>{
      const g=slopesApartments.group.children.find(m=>m.name==='apartments').geometry;
      const index=g.index.array.slice(r.start*3,r.end*3);let lo=Infinity,hi=-1;
      for(const i of index){lo=Math.min(lo,i);hi=Math.max(hi,i)}
      const result={indices:Array.from(index,i=>i-lo),attributes:{}};
      for(const name of ['position','normal','aSurface','aFacet']) {
        const a=g.attributes[name];result.attributes[name]={itemSize:a.itemSize,array:Array.from(a.array.slice(lo*a.itemSize,(hi+1)*a.itemSize))};
      }
      return result;
    },range);
    const slug=range.name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    fs.writeFileSync(path.join(out,slug+'-geometry.json'),JSON.stringify(data));
    manifest.targets.push({name:range.name,slug,vertices:data.attributes.aFacet.array.length,triangles:data.indices.length/3});
  }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({targets:manifest.targets.length,output:out}));
} finally {await browser.close();await browser.__done()}
