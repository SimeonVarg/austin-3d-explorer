/* An opt-in apartment decision, using the existing walking graph. */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  if (q.get('livehere') !== '1' || q.get('walk') === '0') return;
  const C = window.LiveHereCore;
  const noPadding = {left:0,right:0,top:0,bottom:0};
  const tune = window.LIVE_HERE = {
    duration:1200, routeColor:'#ff713f', routeWidth:5, streetPitch:85, eyeHeight:2.2, roofClearance:3,
    homes:[
      {name:'The Standard', address:'715 W 23rd St', point:[-97.74614,30.287225],
        center:[-97.74643,30.28698], zoom:18.2, pitch:65, bearing:155, approach:'Mapped entrance on 23rd St'},
      {name:'Union on 24th', address:'701 W 24th St', point:[-97.745205,30.287883],
        center:[-97.74522,30.28764], zoom:17.9, pitch:65, bearing:155, approach:'Approximate 24th St approach; lobby door unverified'},
      {name:'Villas on Rio', address:'2111 Rio Grande St', point:[-97.744888,30.284705],
        center:[-97.74462,30.28478], zoom:18.1, pitch:65, bearing:125, approach:'Approximate Rio Grande approach; lobby door unverified'}
    ]
  };
  document.body.classList.add('live-here');
  const root = document.createElement('aside'); root.id='live-here'; root.setAttribute('aria-label','Compare apartments');
  root.innerHTML = `<header><p class="lh-kicker">AUSTIN / WEST CAMPUS · PREVIEW</p>
    <h1>What if you<br>lived here?</h1><p class="lh-muted">Three places. Your classes. See how the walk changes.</p>
    <div class="lh-actions"><button id="lh-hide">More room for the city</button></div></header>
    <details id="lh-editor" open><summary>Your class week <span id="lh-kind"></span></summary>
      <p class="lh-muted">Manual edits last until reload. Imported schedules stay in this browser.</p>
      <div id="lh-classes"></div><div class="lh-actions"><button id="lh-add">Add class</button>
      <button id="lh-example">Try example week</button><button id="lh-import">Import schedule</button>
      <button id="lh-clear">Clear classes & saved schedule</button></div>
      <div class="lh-actions"><label><input id="lh-avoid" type="checkbox"> Avoid mapped stairs</label></div>
      <p class="lh-muted">This compares a recurring week. Check imported days and times, including any date-only events.</p>
      <div class="lh-actions"><button id="lh-compare" class="lh-primary" disabled>Compare my walks</button></div>
      <p id="lh-status" role="status" class="lh-muted">Loading mapped paths…</p></details>
    <section><h2>Choose a place</h2><p class="lh-muted">Home → first class + last class → home, per week.</p>
      <div id="lh-homes"></div><p id="lh-shared" class="lh-muted"></p></section>
    <section id="lh-day-section" hidden><h2 id="lh-day-title">A day from here</h2>
      <label for="lh-day">Day</label> <select id="lh-day"></select><div id="lh-legs"></div>
      <div id="lh-preview" hidden><div class="lh-actions"><button id="lh-overview">Whole walk</button>
      <button id="lh-street">Street preview</button></div><label for="lh-scrub">Along this walk</label>
      <input id="lh-scrub" type="range" min="0" max="1000" value="0"><p id="lh-progress" class="lh-muted"></p></div>
    </section><details><summary>What goes into the estimate</summary>
      <p class="lh-muted">Walking ranges include mapped crossings and stairs. Allow extra time for elevators and finding your classroom. This is a comparison, not live navigation.</p>
      <p class="lh-muted">Solid lines follow mapped paths. Dashed ends are estimated connections. Union and Villas start on approximate street frontages; lobby entrances still need verification. Avoiding mapped stairs does not establish wheelchair access.</p>
      <p id="lh-source" class="lh-muted"></p></details>`;
  document.body.append(root);
  const $ = id => root.querySelector('#lh-'+id);
  const toggle=document.createElement('button'); toggle.id='lh-toggle'; toggle.textContent='Compare apartments'; toggle.hidden=true;
  document.body.append(toggle);
  $('hide').onclick=()=>{root.hidden=true;toggle.hidden=false;toggle.focus();};
  toggle.onclick=()=>{root.hidden=false;toggle.hidden=true;$('hide').focus();};
  root.addEventListener('keydown',e=>e.stopPropagation());
  root.addEventListener('keyup',e=>e.stopPropagation());
  let rows=[], codes=[], result=null, homeIndex=0, revision=0, activeLeg=null, street=false, ready=false;
  const fmt = t => t ? `${Math.round(t.lo)}–${Math.round(t.hi)} min` : 'Unavailable';
  const dayNames={MO:'Monday',TU:'Tuesday',WE:'Wednesday',TH:'Thursday',FR:'Friday',SA:'Saturday',SU:'Sunday'};
  function button(text, action, host) { const b=document.createElement('button'); b.textContent=text;b.onclick=action;host.append(b);return b; }
  function note(text,error=false) {$('status').textContent=text;$('status').className=error?'lh-error':'lh-muted';}
  function clearMap() { activeLeg=null;$('preview').hidden=true; window.__map?.getSource('live-here-route')?.setData({type:'FeatureCollection',features:[]}); }
  function dirty() {
    revision++;result=null;clearMap();renderHomes();$('day-section').hidden=true;
    $('compare').disabled=!ready;note('Ready when your class week looks right.');
  }
  const timeString = n => Number.isInteger(n) ? String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0') : '';
  const minutes = s => /^\d{2}:\d{2}$/.test(s) ? Number(s.slice(0,2))*60+Number(s.slice(3)) : null;
  function renderEditor() {
    const host=$('classes');host.replaceChildren();
    rows.forEach((r,i)=>{
      const field=document.createElement('fieldset'), legend=document.createElement('legend');legend.textContent='Class '+(i+1);field.append(legend);
      const select=document.createElement('select');select.setAttribute('aria-label','Building for class '+(i+1));
      const placeholder=new Option(r.code && !codes.some(c=>c.code===r.code) ? 'Unresolved: '+r.code : 'Choose a building','');select.add(placeholder);
      for(const c of codes)select.add(new Option(c.code+' · '+c.name,c.code));
      select.value=r.code;select.onchange=()=>{r.code=select.value;dirty();};field.append(select);
      const times=document.createElement('div');times.className='lh-times';
      for(const [key,title] of [['startMin','Starts'],['endMin','Ends']]) {
        const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='time';input.value=timeString(r[key]);
        input.onchange=()=>{r[key]=minutes(input.value);dirty();};label.append(input);times.append(label);
      }field.append(times);
      const days=document.createElement('div');days.className='lh-days';
      for(const d of C.days){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=r.days.includes(d);
        input.setAttribute('aria-label',dayNames[d]+' for class '+(i+1));input.onchange=()=>{r.days=C.days.filter(x=>x===d?input.checked:r.days.includes(x));dirty();};label.append(input,d);days.append(label);}
      field.append(days);button('Remove class '+(i+1),()=>{rows.splice(i,1);renderEditor();dirty();},field);host.append(field);
      if(r.needsReview){const warning=document.createElement('p');warning.className='lh-error';warning.textContent='This imported class needs review.';field.append(warning);
        button('I checked the building, days and times',()=>{r.needsReview=false;renderEditor();dirty();},field);}
    });
    $('add').disabled=rows.length>=40;
  }
  function renderHomes(){
    $('homes').replaceChildren();
    const ranked=result?.complete ? [...result.apartments].sort((a,b)=>a.total.distM-b.total.distM) : [];
    tune.homes.forEach((home,i)=>{
      const b=button('',()=>selectHome(i,true),$('homes'));b.className='lh-apartment';b.setAttribute('aria-pressed',String(i===homeIndex));
      const title=document.createElement('strong');title.textContent=home.name;const address=document.createElement('span');address.textContent=home.address;b.append(title,address);
      if(result){const a=result.apartments[i],metric=document.createElement('b');metric.textContent=fmt(a.total);b.append(metric);
        if(ranked[0]===a){const tag=document.createElement('em');tag.textContent='SHORTEST ESTIMATED HOME WALK';b.append(tag);}}
      const approach=document.createElement('span');approach.textContent=home.approach;b.append(approach);
    });
    $('shared').textContent=result ? (result.shared ? `${fmt(result.shared)} between classes each week, the same from all three apartments. Ranges can overlap.` : 'A between-class route is unavailable. No overall ranking shown.') : '';
  }
  function duration(){return matchMedia('(prefers-reduced-motion: reduce)').matches?0:tune.duration;}
  function selectHome(i,fly){
    homeIndex=i;renderHomes();clearMap();
    if(fly&&window.__map){const h=tune.homes[i];window.__map.stop();window.__map.flyTo({center:h.center,zoom:h.zoom,pitch:h.pitch,bearing:h.bearing,duration:duration(),padding:noPadding});}
    if(result)renderDay();
  }
  function padding(){return innerWidth>650 ? {left:root.hidden?40:420,right:50,top:60,bottom:70} : {left:30,right:30,top:60,bottom:root.hidden?60:innerHeight*.57};}
  function renderDay(){
    $('day-section').hidden=false;$('day-title').textContent='A day from '+tune.homes[homeIndex].name;
    const old=$('day').value;$('day').replaceChildren();for(const d of result.week)$('day').add(new Option(dayNames[d.day],d.day));
    if(result.week.some(d=>d.day===old))$('day').value=old;
    renderLegs();
  }
  function renderLegs(){
    clearMap();$('legs').replaceChildren();const day=$('day').value,d=result.week.find(d=>d.day===day),a=result.apartments[homeIndex].daily.find(d=>d.day===day);
    const legs=[a.legs[0],...d.shared,a.legs[1]];
    legs.forEach((leg,i)=>{
      const title=leg.kind==='out'?'Home → '+leg.to:leg.kind==='home'?leg.from+' → home':leg.from+' → '+leg.to;
      const b=button(title,()=>preview(leg,b),$('legs'));b.setAttribute('aria-pressed','false');
      const small=document.createElement('small');let text=leg.route.ok?fmt(leg.route):'No mapped route available';
      if(leg.route.ok&&leg.gap!=null)text+=` · ${leg.gap} min between classes`+(leg.gap<leg.route.hi?' · tight connection':'');
      if(leg.route.ok&&i===0)text+=' · leave by '+timeString(Math.max(0,d.classes[0].startMin-leg.route.hi));
      small.textContent=text;b.append(small);b.disabled=!leg.route.ok;
    });
  }
  function routeSource(){
    const map=window.__map;if(!map?.isStyleLoaded())return null;
    if(!map.getSource('live-here-route')){
      map.addSource('live-here-route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      for(const [id,dashed] of [['network',false],['connection',true]])map.addLayer({id:'live-here-'+id,type:'line',source:'live-here-route',
        filter:['==',['get','kind'],id],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':tune.routeColor,'line-width':tune.routeWidth,...(dashed?{'line-dasharray':[1,2]}:{})}});
    }return map.getSource('live-here-route');
  }
  function preview(leg,b){
    const source=routeSource();if(!source){note('The map is still loading. Try this walk again in a moment.',true);return;}
    activeLeg=leg;street=false;$('scrub').value='0';$('preview').hidden=false;
    for(const x of $('legs').children)x.setAttribute('aria-pressed',String(x===b));
    const g=leg.route.geom,features=[];
    for(const [kind,points] of [['network',g?.net],['connection',g?.startLeg],['connection',g?.endLeg]])if(points?.length>1)features.push({type:'Feature',properties:{kind},geometry:{type:'LineString',coordinates:points}});
    source.setData({type:'FeatureCollection',features});overview();
  }
  function overview(){if(!activeLeg)return;street=false;const pts=activeLeg.route.geom?.line;if(!pts?.length)return;
    // Fit into the visible rectangle without persistent MapLibre padding.
    // The flight controller derives its eye from an unpadded viewport; retaining
    // asymmetric camera padding shifted the right end beyond the screen.
    const m=pts.map(p=>maplibregl.MercatorCoordinate.fromLngLat(p)),pad=padding();
    const west=Math.min(...m.map(p=>p.x)),east=Math.max(...m.map(p=>p.x));
    const north=Math.min(...m.map(p=>p.y)),south=Math.max(...m.map(p=>p.y));
    const width=innerWidth-pad.left-pad.right,height=innerHeight-pad.top-pad.bottom;
    const zoom=Math.min(18.5,Math.log2(width/(512*Math.max(east-west,1e-9))),Math.log2(height/(512*Math.max(south-north,1e-9))));
    const scale=512*2**zoom;
    const x=(west+east)/2-(pad.left+width/2-innerWidth/2)/scale;
    const y=(north+south)/2-(pad.top+height/2-innerHeight/2)/scale;
    window.__map.stop();window.__map.easeTo({center:new maplibregl.MercatorCoordinate(x,y).toLngLat(),zoom,pitch:0,bearing:0,padding:noPadding,duration:duration()});
    $('progress').textContent='Select Street preview, then drag along the mapped walk.';
  }
  function streetAt(){
    if(!activeLeg)return;street=true;const pts=activeLeg.route.geom?.net;if(!pts||pts.length<2)return;
    const lengths=[],latScale=111320,lonScale=latScale*Math.cos(pts[0][1]*Math.PI/180);let sum=0;
    for(let i=1;i<pts.length;i++){const d=Math.hypot((pts[i][0]-pts[i-1][0])*lonScale,(pts[i][1]-pts[i-1][1])*latScale);lengths.push(d);sum+=d;}
    let at=sum*Number($('scrub').value)/1000,i=0;while(i<lengths.length-1&&at>lengths[i]){at-=lengths[i];i++;}
    const f=lengths[i]?at/lengths[i]:0,a=pts[i],b=pts[i+1],eye=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
    const bearing=Math.atan2((b[0]-a[0])*lonScale,(b[1]-a[1])*latScale)*180/Math.PI,map=window.__map;
    const roof=window.__fly?.roofAt(...eye,0.5)||0,alt=Math.max(tune.eyeHeight,roof?roof+tune.roofClearance:0);
    const pitch=tune.streetPitch,rad=Math.PI/180,lead=alt*Math.tan(pitch*rad),px=map.transform.cameraToCenterDistance;
    const zoom=Math.log2(px*40075016.686*Math.cos(eye[1]*rad)*Math.cos(pitch*rad)/(512*alt));
    map.stop();map.jumpTo({center:[eye[0]+lead*Math.sin(bearing*rad)/lonScale,eye[1]+lead*Math.cos(bearing*rad)/latScale],zoom,pitch,bearing,padding:noPadding});
    $('progress').textContent=Math.round(sum*Number($('scrub').value)/1000)+' m along mapped paths'+(roof?' · raised above an obstructing building':' · street preview')+'. Dashed connections are excluded.';
  }
  $('day').onchange=renderLegs;$('overview').onclick=overview;$('street').onclick=streetAt;$('scrub').oninput=streetAt;
  $('add').onclick=()=>{rows.push({code:'',days:[],startMin:null,endMin:null});renderEditor();dirty();};
  $('example').onclick=()=>{rows=[{code:'WEL',days:['MO','WE','FR'],startMin:600,endMin:650},{code:'PCL',days:['MO','WE','FR'],startMin:840,endMin:890},
    {code:'GDC',days:['TU','TH'],startMin:660,endMin:735}];$('kind').textContent='· example';renderEditor();dirty();};
  $('import').onclick=()=>window.wayfindImportOpen();
  $('clear').onclick=async()=>{rows=[];$('kind').textContent='';renderEditor();dirty();await window.wayfindStore.clearAsync();note('Classes and saved schedule cleared from this browser.');};
  $('avoid').onchange=dirty;
  async function run(){
    const token=++revision;$('compare').disabled=true;note('Comparing mapped walks…');clearMap();
    const snapshot=rows.map(r=>({...r,days:[...r.days]})),avoid=$('avoid').checked;
    const answer=await C.compare(snapshot,tune.homes,(a,b)=>window.wayfindStairs(a,b,{geom:true,avoidStairs:avoid}),new Set(codes.map(c=>c.code)));
    if(token!==revision)return;
    $('compare').disabled=false;if(answer.error){note(answer.error,true);return;}
    result=answer;renderHomes();renderDay();note(answer.complete?'Comparison ready. Choose an apartment and a walk.':'Some walks are unavailable. No overall ranking shown.',!answer.complete);
    $('editor').open=false;root.scrollTop=0;
  }
  $('compare').onclick=run;
  function useSchedule(s){if(!s){rows=[];$('kind').textContent='';}else{rows=C.imported(s);$('kind').textContent='· imported';}
    renderEditor();dirty();$('editor').open=true;note('Check the imported days and times before comparing.');}
  window.addEventListener('wayfind:schedule',e=>useSchedule(e.detail));
  async function boot(){
    try{codes=(await window.wayfindScheduleCodes()).filter(c=>window.wayfindSearch(c.code).some(r=>r.code===c.code&&r.routable));
      if(!codes.length)throw new Error('no paths');ready=true;renderEditor();$('compare').disabled=false;note('Add your classes, or try the example week.');
      if(window.wayfindSchedule)useSchedule(window.wayfindSchedule);
      const stats=window.wayfindStats();$('source').textContent='Path data: '+(stats.asOf||'OpenStreetMap snapshot')+'. Building data and route coverage can differ.';
      const wait=()=>{const map=window.__map;if(!map?.getStyle()?.layers?.length)return setTimeout(wait,150);
        for(const [i,h] of tune.homes.entries()){const el=document.createElement('button');el.className='lh-map-label';el.textContent=h.name;el.onclick=()=>{root.hidden=false;toggle.hidden=true;selectHome(i,true);};new maplibregl.Marker({element:el}).setLngLat(h.point).addTo(map);}
        selectHome(0,true);
      };wait();
    }catch(e){note('Could not load mapped paths. Reload to try again.',true);}
  }
  renderHomes();boot();
  // Read-only seam for the browser gate. No identifiers or schedule contents.
  window.liveHereState=()=>({ready,complete:result?.complete??false,apartments:result?.apartments.map(a=>({name:a.home.name,ok:a.ok,total:a.total})),shared:result?.shared,active:!!activeLeg,street});
})();
