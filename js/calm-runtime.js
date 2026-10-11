/* One private switch: ?calm=1. Exact compaction, generated far facades and
 * finite rest accumulation. Moving multisampling is disabled until paid for. */
(function(){
  'use strict';
  const TUNE={rest:true,smooth:false,edge:true};
  const stats={phase:'building',error:null};
  const load=file=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='js/'+file+'.js';s.onload=resolve;s.onerror=()=>reject(Error('Could not load '+file));document.head.append(s);});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const C=window.Calm={TUNE,stats,bootReady:window.__calmVerify?.savingsOnly?Promise.resolve():load('calm-far'),ready:null};
  C.ready=(async()=>{
    await C.bootReady;
    const deadline=performance.now()+240000;
    while(document.getElementById('veil')||!window.slopesApartments?.count.done||!window.slopes?.renderer){if(performance.now()>deadline)throw Error('scene readiness timed out');await wait(100);}
    await wait(1000);
    stats.phase='compacting';await load('mesh-compact');stats.compact=await window.MeshCompact.apply();
    // Verification can isolate savings without adding a second product flag.
    if(window.__calmVerify?.savingsOnly){if(window.CalmFar)window.CalmFar.enabled=false;}
    if(!window.__calmVerify?.savingsOnly)await load('calm-edge');
    await load('calm-rest');window.FrameTarget.attach(window.__map);
    const paid=stats.compact.savedBytes>12*window.__map.getCanvas().width*window.__map.getCanvas().height;
    window.FrameTarget.setRest(TUNE.rest&&paid&&!window.__calmVerify?.savingsOnly);
    window.FrameTarget.setSmooth(false);
    stats.restStoragePaid=paid;stats.phase='ready';return stats;
  })().catch(e=>{stats.phase='failed';stats.error=String(e.stack||e);console.error('[calm]',e);throw e;});
})();
