// Real-canvas contract for hero atlas registration, not a city visual test.
// Deliberate failures: --break-ratio changes world scale; --break-transform
// leaves most of the enlarged backing image blank.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { launch } from './chrome.mjs';

let source=fs.readFileSync(new URL('../../js/heroes.js',import.meta.url),'utf8');
const end=source.indexOf('  function restoreWallPlane(gj)');
assert(end>0,'actual atlas function boundary exists');
// Cut before geometry and bootstrap, retaining every actual tile function.
source=source.slice(0,source.lastIndexOf('/**',end))+
  '\nwindow.__atlasTest={ensureImages};\n})();';
if(process.argv.includes('--break-ratio')) {
  assert(source.includes('pixelRatio: TEXTURE_SCALE'),'ratio control targets registration');
  source=source.replace('pixelRatio: TEXTURE_SCALE','pixelRatio: 1');
}
if(process.argv.includes('--break-transform')) {
  const pattern=/_ctx\.setTransform\(TEXTURE_SCALE,\s*0,\s*0,\s*TEXTURE_SCALE,\s*0,\s*0\);/;
  assert(pattern.test(source),'transform control targets actual canvas');
  source=source.replace(pattern,'');
}
const lighting=fs.readFileSync(new URL('../../js/city-lighting.js',import.meta.url),'utf8');
const glassStart=lighting.indexOf('  function glassRect(');
const glassEnd=lighting.indexOf('  function glassColour(',glassStart);
assert(glassStart>=0&&glassEnd>glassStart,'actual semantic glass painter exists');
const browser=await launch(chromium);
try {
  const page=await browser.newPage();
  const result=await page.evaluate(({source,glass})=>{
    window.CityLighting=Function(glass+';return {glassRect};')();
    (0,eval)(source);
    const images=new Map(),events=[];
    const map={
      hasImage:id=>images.has(id),
      addImage(id,image,options){images.set(id,{image,options});events.push(['add',id]);},
      updateImage(id,image){images.get(id).image=image;events.push(['update',id]);},
    };
    function snapshot(){
      return [...images].map(([id,{image,options}])=>{
        let glass=0,opaque=0,blank=0,rgb=0;
        for(let i=0;i<image.data.length;i+=4){
          const a=image.data[i+3];
          glass+=a===191;opaque+=a===255;blank+=a<190;
          rgb+=image.data[i]+image.data[i+1]+image.data[i+2];
        }
        return {id,width:image.width,height:image.height,ratio:options?.pixelRatio??1,
          bytes:image.data.length,glass,opaque,blank,rgb};
      });
    }
    window.__atlasTest.ensureImages(map,.3);
    const day=snapshot();
    window.__atlasTest.ensureImages(map,.9);
    return {day,night:snapshot(),events};
  },{source,glass:lighting.slice(glassStart,glassEnd)});
  assert.equal(result.day.length,7,'all distinct hero patterns registered');
  assert.equal(result.events.filter(e=>e[0]==='add').length,7);
  assert.equal(result.events.filter(e=>e[0]==='update').length,7);
  for(const [i,d] of result.day.entries()){
    const n=result.night[i];
    for(const s of [d,n]){
      assert.equal(s.width,256,s.id+' backing width');
      assert.equal(s.height,256,s.id+' backing height');
      assert.equal(s.width/s.ratio,64,s.id+' logical repeat preserved');
      assert.equal(s.bytes,256*256*4,s.id+' complete RGBA image');
      assert.equal(s.blank,0,s.id+' complete opaque/glass coverage');
      assert(s.glass>0,s.id+' glass mask survives');
      assert(s.opaque>0,s.id+' masonry/frame mask survives');
    }
    assert.equal(d.id,n.id,'update keeps image identity');
    assert.equal(d.glass,n.glass,d.id+' glass layout survives repaint');
    assert.equal(d.opaque,n.opaque,d.id+' solid layout survives repaint');
    assert.notEqual(d.rgb,n.rgb,d.id+' time-of-day repaint changes pixels');
  }
  console.log('PASS seven real-canvas hero patterns: 256px backing, 64px display, glass mask, day/night updates');
} finally {
  await browser.__done();
}
