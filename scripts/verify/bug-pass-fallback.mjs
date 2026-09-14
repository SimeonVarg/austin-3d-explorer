import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const standard=JSON.parse(fs.readFileSync(new URL('../../data/apartments/the-standard.json',import.meta.url)));
const browser=await launch(chromium,{gl:'hardware',maxMs:300000});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/data/apartments/the-standard.json',r=>r.fulfill({status:503,body:'simulated unavailable model'}));
  await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
  await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.slopesApartments?.count.done&&window.slopesApartments.readyToReveal()&&!document.getElementById('veil'),null,{timeout:180000});
  const result=await page.evaluate(()=>({names:slopesApartments.built.map(b=>b.name),ids:slopesApartments.data.replacedBuildingIds, retired:slopesApartments.hidden.rigs, filters:JSON.stringify(['wc-wall'].map(id=>__map.getLayer(id)?__map.getFilter(id):null))}));
  assert.ok(!result.names.includes(standard.name));
  assert.ok(result.names.includes('Union on 24th'),'other authored models still render');
  assert.ok(!result.ids.includes(standard.id),'failed model must not be in the replacement footprint filter');
  assert.ok(!result.retired.some(id=>id.startsWith(standard.id)),'failed model must retain its legacy roof rig');
  assert.ok(!result.filters.includes(standard.name),'failed model must not hide its legacy facade');
  assert.deepEqual(errors,[]);
  console.log('PASS failed Standard download reveals a usable fallback without retiring the missing model');
}finally{await browser.__done()}
