import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {launch,BASE} from './chrome.mjs';
const browser=await launch(chromium,{gl:'hardware'});
const out=process.env.VERIFY_OUT;
try {
  const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const leaks=[];page.on('request',r=>{if((r.url()+(r.postData()||'')).includes('LIVEHERE_SYNTHETIC_PRIVATE'))leaks.push(r.url());});
  await page.addInitScript(()=>{const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},50);});
  await page.goto(BASE+'/index.html?intro=0&drift=0&livehere=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.liveHereState?.().ready&&window.slopesApartments?.count.done&&window.__fly?.indexed(),null,{timeout:180000});
  console.log('City loaded',await page.evaluate(()=>({state:liveHereState(),buildings:slopesApartments.count.buildings,warnings:slopesApartments.count.warnings.length})));
  await page.evaluate(()=>applyTimeOfDay(__map,0.12,true));
  const shot=async name=>{if(!out)return;await page.waitForTimeout(4000);await page.screenshot({path:out+'/'+name+'.jpg',quality:85});await page.waitForTimeout(900);await page.screenshot({path:out+'/'+name+'.jpg',quality:85});};
  if(process.env.BASELINE){
    await page.evaluate(()=>{document.querySelector('#live-here').hidden=true;__map.jumpTo({center:[-97.74610,30.28720],zoom:20.2,pitch:77,bearing:185,padding:0});});
    await shot('standard-before');
  }
  await page.evaluate(()=>{document.querySelector('#live-here').hidden=false;});
  await page.click('#lh-example');await page.click('#lh-compare');
  await page.waitForFunction(()=>window.liveHereState().complete,null,{timeout:30000});
  let state=await page.evaluate(()=>window.liveHereState());
  assert.equal(state.apartments.length,3);assert.ok(state.apartments.every(a=>a.ok&&a.total.lo>0));
  console.log('Comparison',JSON.stringify(state));
  for(let i=0;i<3;i++){
    await page.locator('.lh-apartment').nth(i).click();
    await shot('live-here-home-'+i);
    await page.locator('#lh-legs button').first().click();
    assert.ok(await page.locator('#lh-preview').isVisible());
    assert.ok(await page.evaluate(async()=>(await __map.getSource('live-here-route').getData()).features.some(f=>f.properties.kind==='network')));
    await page.waitForFunction(()=>!__map.isEasing());
    const projected=await page.evaluate(async()=>{
      const data=await __map.getSource('live-here-route').getData(),mobile=innerWidth<=650;
      const points=data.features.flatMap(f=>f.geometry.coordinates.map(p=>__map.project(p)));
      return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
    });
    assert.ok(projected.minX>=400&&projected.maxX<=1420&&projected.minY>=20&&projected.maxY<=930,'whole route fits beside the panel: '+JSON.stringify(projected));
    if(i===1)await shot('live-here-route');
    await page.click('#lh-street');
    await page.locator('#lh-scrub').fill('150');
    assert.ok(await page.evaluate(()=>liveHereState().street));
    if(i===0)await shot('live-here-street');
  }
  assert.deepEqual(errors,[]);
  if(process.env.BASELINE)console.log('BASELINE COMPLETE');
  else {
    const shared=state.shared;
    await page.click('#lh-editor summary');await page.click('#lh-avoid');await page.click('#lh-compare');
    await page.waitForFunction(()=>liveHereState().complete);
    assert.ok(await page.evaluate(()=>liveHereState().apartments.every(a=>a.ok)));
    await page.click('#lh-editor summary');
    await page.locator('#lh-classes input[type=time]').first().fill('23:00');
    await page.click('#lh-compare');
    await page.waitForFunction(()=>document.querySelector('#lh-status').textContent.includes('check the start'));
    assert.equal(await page.evaluate(()=>liveHereState().complete),false);
    await page.click('#lh-example');await page.click('#lh-compare');await page.waitForFunction(()=>liveHereState().complete);
    await page.click('#lh-editor summary');await page.click('#lh-import');
    assert.ok(await page.locator('#wf-imp').isVisible(),'existing importer is usable above the preview');
    await page.evaluate(async()=>wayfindImportText('BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:livehere-synthetic\nSUMMARY:LIVEHERE_SYNTHETIC_PRIVATE\nLOCATION:WEL 1.306\nDTSTART;TZID=America/Chicago:20260914T100000\nDTEND;TZID=America/Chicago:20260914T105000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\nEND:VEVENT\nEND:VCALENDAR','gcal'));
    await page.locator('#wf-imp-foot .wf-imp-go').click();
    assert.equal(await page.locator('#lh-classes fieldset').count(),1);
    assert.match(await page.locator('#lh-kind').textContent(),/imported/);
    assert.equal(await page.evaluate(()=>wayfindStore.has()),true);
    await page.click('#lh-clear');await page.waitForFunction(()=>!wayfindStore.has());
    assert.equal(await page.locator('#lh-classes fieldset').count(),0);assert.deepEqual(leaks,[],'synthetic schedule label never leaves the browser');
    await page.click('#lh-example');await page.click('#lh-compare');await page.waitForFunction(()=>liveHereState().complete);
    await page.setViewportSize({width:393,height:852});
    const bounds=await page.locator('#live-here').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=393&&bounds.y>=0&&bounds.y+bounds.height<=852);
    await shot('live-here-phone');
    await page.click('#lh-hide');assert.equal(await page.locator('#live-here').isVisible(),false);
    await page.click('#lh-toggle');assert.equal(await page.locator('#live-here').isVisible(),true);
    await page.goto(BASE+'/index.html?intro=0&drift=0&livehere=1&walk=0',{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#live-here').count(),0);assert.equal(await page.evaluate(()=>window.wayfindStairs===undefined),true);
    assert.deepEqual(errors,[]);console.log('PASS comparison, all apartment routes, street preview, stairs option, invalid times, phone, hide/reopen and explicit off');
  }
} finally {await browser.__done();}
