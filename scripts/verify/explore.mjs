import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const browser=await launch(chromium,{gl:'hardware'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},50);});
  await page.goto(BASE+'/index.html?intro=0&drift=0',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.slopesStadium?.count.done&&window.__fly?.indexed(),null,{timeout:240000});
  const start=await page.evaluate(()=>{const m=window.__map,c=m.getCenter();return [c.lng,c.lat,m.getZoom()];});
  await page.click('#explore-toggle');
  assert.equal(await page.locator('#explore-toggle').getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#explore-panel').isVisible(),false);
  for(let i=0;i<4;i++){
    await page.click('#explore-toggle');
    await page.locator('#explore-places button').nth(i).click();
    await page.waitForTimeout(700);
    const result=await page.evaluate(i=>{const m=window.__map,p=window.EXPLORE.places[i],c=m.getCenter();return {distance:Math.hypot(c.lng-p.center[0],c.lat-p.center[1]),zoom:Math.abs(m.getZoom()-p.zoom),easing:m.isEasing()};},i);
    assert.ok(result.distance<0.00001&&result.zoom<0.01,JSON.stringify(result));
    assert.equal(result.easing,false,'reduced motion arrives without animation');
    assert.equal(await page.locator('#explore-panel').isVisible(),false);
    if(process.env.VERIFY_OUT){
      await page.waitForTimeout(4000);
      const path=process.env.VERIFY_OUT+'/explore-arrival-'+i+'.jpg';
      await page.screenshot({path,quality:80});await page.waitForTimeout(900);await page.screenshot({path,quality:80});
    }
    if(i===0){
      await page.click('#explore-toggle');await page.click('#explore-back');await page.waitForTimeout(500);
      const returned=await page.evaluate(()=>{const m=window.__map,c=m.getCenter();return [c.lng,c.lat,m.getZoom()];});
      assert.ok(returned.every((v,j)=>Math.abs(v-start[j])<0.00001),'restores previous camera');
      assert.ok(await page.locator('#explore-back').isDisabled());
    }
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.click('#explore-toggle');await page.locator('#explore-places button').first().click();
  await page.waitForFunction(()=>!window.__map.isEasing());
  await page.waitForTimeout(4000);
  const out=process.env.VERIFY_OUT;
  if(out){fs.mkdirSync(out,{recursive:true});await page.click('#explore-toggle');await page.screenshot({path:out+'/explore-desktop.jpg',quality:85});await page.waitForTimeout(900);await page.screenshot({path:out+'/explore-desktop.jpg',quality:85});}
  await page.setViewportSize({width:393,height:852});
  assert.ok(await page.locator('#explore-panel').isVisible());
  const bounds=await page.locator('#explore-panel').boundingBox();
  assert.ok(bounds.x>=0&&bounds.x+bounds.width<=393,'panel fits phone');
  if(out){await page.screenshot({path:out+'/explore-phone.jpg',quality:85});await page.waitForTimeout(900);await page.screenshot({path:out+'/explore-phone.jpg',quality:85});}
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#explore-panel').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS all four arrivals, return, Escape, reduced motion, animated arrival, phone fit and browser errors');
}finally{await browser.__done();}
