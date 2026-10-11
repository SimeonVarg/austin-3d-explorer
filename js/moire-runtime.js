/* Opt-in integration for the measured spatial candidate. Not accepted as free.
 * ?samplelattice=1&samplecompact=1; other experiment switches remain explicit. */
(function(){
  'use strict';
  const q=new URLSearchParams(location.search),stats={phase:'waiting',error:null};
  const load=file=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='js/'+file+'.js';s.onload=resolve;s.onerror=()=>reject(Error('Could not load '+file));document.head.append(s);});
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const API=window.MoireRuntime={stats,ready:null};
  API.ready=(async()=>{
    const deadline=performance.now()+240000;
    while(document.getElementById('veil')||!window.slopesApartments?.count.done||!window.slopes?.renderer){if(performance.now()>deadline)throw Error('scene readiness timed out');await wait(100);}
    await wait(1000);
    stats.phase='compacting';await load('mesh-compact');await window.MeshCompact.apply();
    if(q.get('sampleday')==='1'){await load('day-specialize');window.DaySpecialize.attach();}
    const strips=Number(q.get('sampletiles')||1);window.SampleLattice.tiles(strips);
    if(strips>1){await load('strip-cull');window.StripCull.attach();}
    window.SampleLattice.set(true);stats.phase='ready';return stats;
  })().catch(e=>{stats.phase='failed';stats.error=String(e.message||e);window.SampleLattice.set(false);throw e;});
})();
