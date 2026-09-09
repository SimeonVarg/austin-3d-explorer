// Same loaded city and camera; switch only the Villas panel window rule.
import {chromium} from 'playwright-core';
import {BASE, launch} from './chrome.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.VERIFY_OUT;
if (!out) throw new Error('Set VERIFY_OUT to a scratch directory');
fs.mkdirSync(out, {recursive:true});
const browser = await launch(chromium, {gl:'hardware'});
try {
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},50);
  });
  await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.slopesApartments?.count.done && window.slopesApartments.count.buildings>0,null,{timeout:240000});
  await page.waitForFunction(()=>!window.__fly?.eye().driving,null,{timeout:30000});
  await page.evaluate(()=>window.__map.jumpTo({center:[-97.74469,30.28494],zoom:18.85,pitch:65,bearing:95}));
  const results=[];
  for (const tod of [0.3,1]) {
    for (const state of ['before','after']) {
      results.push(await page.evaluate(({state,tod})=>{
        const a=window.slopesApartments;
        const p=a.data.buildings.find(b=>b.name==='Villas on Rio').skins.panel;
        p.bay=state==='before'?3.15:1.575;
        if(state==='before') delete p.windowRule; else p.windowRule='checker';
        a.rebuild();
        const el=document.getElementById('tod-slider');
        el.value=String(tod);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
        return {state,tod,buildings:a.count.buildings,windows:a.count.windows,warnings:a.count.warnings};
      },{state,tod}));
      await page.waitForTimeout(4500);
      await page.evaluate(()=>window.__map.triggerRepaint());
      const path=`${out}/villas-${tod===1?'night':'day'}-${state}.jpg`;
      await page.screenshot({path,quality:88});
      await page.waitForTimeout(900);
      await page.screenshot({path,quality:88});
    }
  }
  assert.deepEqual(errors,[]);
  assert.ok(results.every(r=>r.buildings===results[0].buildings));
  assert.ok(Math.abs(results[0].windows-results[1].windows)<100);
  assert.deepEqual(results[1].warnings,results[0].warnings);
  fs.writeFileSync(`${out}/window-rule-results.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
  console.log('PASS: city loaded, generator rebuilt, window population retained, no new warnings or page errors; day/night pairs captured twice');
} finally {await browser.__done();}
