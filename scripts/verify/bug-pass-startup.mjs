import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const browser=await launch(chromium,{gl:'hardware',maxMs:420000});
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let release,requested=false;
  const hold=new Promise(r=>release=r);
  await page.route('**/data/apartments/the-standard.json',async route=>{requested=true;await hold;await route.continue()});
  if(process.argv.includes('--break'))await page.route('**/js/app.js',r=>r.fulfill({contentType:'application/javascript',body:execFileSync('git',['show','14d2bc1:js/app.js'],{maxBuffer:2000000})}));
  await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){cancelGraphicsAutoDetect();clearInterval(t)}},50)});
  await page.goto(BASE+'/index.html?intro=0&drift=0&livehere=1',{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.__intro,null,{timeout:180000});
  while(!requested)await page.waitForTimeout(100);
  await page.waitForTimeout(21000);
  const held=await page.evaluate(()=>({reason:__intro.reason,missing:__intro.gate().missing,veil:!!document.querySelector('#veil:not(.lift)')}));
  assert.equal(held.reason,null,'a delayed authored model must hold the veil past the old 18s tile ceiling');
  assert.ok(held.veil&&held.missing.includes('authored-buildings'));
  release();
  await page.waitForFunction(()=>window.slopesApartments?.readyToReveal()&&window.__intro.reason&&window.liveHereState?.().ready,null,{timeout:180000});
  await page.waitForTimeout(2800);
  const proof=await page.evaluate(()=>({reason:__intro.reason,missing:__intro.missingAtLift,legacyRigs:slopesApartments.hidden.rigsMissing,filters:slopesApartments.hidden.missing,names:slopesApartments.built.map(b=>b.name)}));
  assert.ok(proof.names.includes('The Standard'));
  assert.deepEqual(proof.legacyRigs,[]);assert.deepEqual(proof.filters,[]);
  assert.ok(!proof.missing.includes('authored-buildings'));
  const out=process.env.VERIFY_OUT;
  if(out){
    for(const suffix of ['first','settled']){
      await page.screenshot();await page.waitForTimeout(900);
      await page.screenshot({path:out+'/startup-'+suffix+'.jpg',quality:90});
      if(suffix==='first')await page.waitForTimeout(10000);
    }
    fs.writeFileSync(out+'/startup-proof.json',JSON.stringify({held,proof,errors},null,2));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS delayed Standard: veil holds, replacement renders, legacy roofs and layers retire before reveal');
} finally {await browser.__done()}
