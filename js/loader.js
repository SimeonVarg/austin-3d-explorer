/* Loading work is measured, never animated toward an invented percentage.
 * Only the decorative route pulse animates independently of the main thread. */
(function () {
  'use strict';
  const TUNE = { estimateDesktop: 40, estimatePhone: 50, pollMs: 600,
    weights: { map: 20, data: 20, models: 45, light: 5, reveal: 10 },
    title: 'A city. A campus. Your next chapter.', subtitle: 'Explore Austin in 3D, from your apartment to your next class.' };
  const MODES = [
    ['explore','Explore freely','Fly across campus and downtown.',{}],
    ['home','Find your place · preview','Compare apartments and walks to class.',{livehere:'1'}],
    ['tour','Campus tour','A guided flight through Austin.',{tour:'1'}],
    ['autopilot','Scenic flight','An automatic route with controls to take over.',{autopilot:'1'}],
    ['timelapse','Day into night','Watch the city and its lighting change.',{timelapse:'1'}],
    ['sunset','Sunset lookout','Stay in one place as sunset turns to night.',{sliderdemo:'1'}],
    ['photo','Photo mode','A clean view; touch flight controls remain available.',{clip:'1',drive:'1'}],
    ['walk','Walk to class · preview','Opt in to experimental walking directions.',{walk:'1'}]
  ];
  const files = new Map();
  let graph = 'optional', sceneReady = false, revealed = false, timer, root, dialog, opener;
  let last = '', mapReady = false;
  const state = window.__loading = { history: [], started: performance.now(), complete: false };
  window.loaderData = (url, phase) => { files.set(url, phase); update(); };
  window.loaderGraph = phase => { graph = phase; update(); };
  window.loaderSceneReady = () => { sceneReady = true; update(); };
  window.loaderStage = () => update();
  window.loaderWatch = map => { map.on('load', () => {mapReady = true; update();}); mapReady = map.isStyleLoaded(); update(); };
  window.loaderWaiting = () => update();
  function readings() {
    const map = window.__map, a = window.slopesApartments;
    let tiles = false;
    try { tiles = !!(mapReady||sceneReady) && !!map?.areTilesLoaded(); } catch (_) {}
    const off = window.SLOPES?.on === false || window.APARTMENTS?.on === false;
    const total = a?.data?.buildings?.length || 0, built = a?.count?.names?.length || 0;
    const models = off ? 1 : total ? Math.min(1,built/total) : 0;
    const values = [...files.values()], dataDone = values.filter(x=>x==='done').length;
    const errors = values.filter(x=>x==='error').length;
    const graphActive = graph !== 'optional';
    const dataTotal = values.length + (graphActive?1:0);
    const data = dataTotal ? (dataDone+(graph==='done'?1:0))/dataTotal : 0;
    const lighting = window.CityLighting?.stats;
    const light = !!lighting?.draws && !lighting.failures?.length;
    const complete = sceneReady && tiles && models===1 && data===1 && light && (off || !!a?.readyToReveal());
    const w = TUNE.weights;
    const percent = Math.floor(w.map*((mapReady||sceneReady)?(tiles?1:.5):0)+w.data*data+w.models*models+w.light*(light?1:0)+w.reveal*(revealed&&complete&&state.complete?1:0));
    return {total,built,tiles,off,models,dataDone,dataTotal:values.length,errors,light,complete,percent};
  }
  function update() {
    if (!root) return;
    const r = readings();
    const elapsed = (performance.now()-state.started)/1000;
    const expected = matchMedia('(pointer:coarse)').matches ? TUNE.estimatePhone : TUNE.estimateDesktop;
    const estimate = elapsed < expected ? 'Usually about '+expected+' seconds · '+Math.floor(elapsed)+'s elapsed' : 'Taking longer than usual · '+Math.floor(elapsed)+'s elapsed';
    const rows = [
      ['Map & city tiles',r.tiles?'Ready':sceneReady?'Drawing tiles':'Loading style'],
      ['City data',r.dataDone+' / '+r.dataTotal+' files'+(r.errors?' · some unavailable':'')],
      ['Authored buildings',r.off?'Disabled by your settings':r.total?r.built+' / '+r.total+' built':'Reading the catalogue'],
      ['Sunlight & reflections',r.light?'Ready':'Preparing lighting'],
      ['Walking graph',graph==='optional'?'Loads when requested':graph==='done'?'Ready':graph==='error'?'Unavailable':'Preparing paths']
    ];
    const signature = JSON.stringify([r,graph,Math.floor(elapsed)]);
    if(signature===last)return; last=signature;
    state.current = r;
    state.history.push({ms:Math.round(performance.now()),...r,graph});
    if(state.history.length>600)state.history.shift();
    root.querySelector('#load-percent').textContent = r.percent+'%';
    const bar = root.querySelector('[role=progressbar]');
    bar.setAttribute('aria-valuenow',r.percent);
    bar.querySelector('i').style.transform='scaleX('+r.percent/100+')';
    root.querySelector('#load-estimate').textContent=estimate;
    root.querySelector('#load-stages').replaceChildren(...rows.map(([name,value])=>{
      const row=document.createElement('div'), n=document.createElement('span'), v=document.createElement('span');
      n.textContent=name;v.textContent=value;row.append(n,v);return row;
    }));
  }
  window.loaderDone = result => {
    revealed=true;
    state.reveal={...result,ms:Math.round(performance.now())};
    state.complete=readings().complete && !result?.modelLate && !result?.missing?.length;
    update();
    document.getElementById('veil')?.setAttribute('inert','');
    const button=document.getElementById('mode-launcher');
    if(button) {button.hidden=false;button.textContent=state.complete?'Explore modes':'City still loading · modes';}
    clearInterval(timer);
    if(!state.complete) {
      let checks=0;
      timer=setInterval(()=>{
        if(readings().complete){state.complete=true;button.textContent='Explore modes';clearInterval(timer);}
        else if(++checks>=100){button.textContent='Some detail unavailable · modes';clearInterval(timer);}
        update();
      },TUNE.pollMs);
    }
  };
  function cityArt() {
    // A tiny vector postcard, not another WebGL scene or an image download.
    const blocks=[[45,180,65,60],[140,140,50,95],[232,156,58,70],[322,155,72,48],[413,112,42,110],[487,65,40,150],[560,110,52,100]];
    let shapes='';
    for(const [x,y,w,h] of blocks) {
      shapes+=`<path d="M${x} ${y}l${w} -22 24 14 -${w} 22z" fill="#bc8c5d"/><path d="M${x} ${y}l${w} -22v${h}l-${w} 22z" fill="#745744"/><path d="M${x+w} ${y-22}l24 14v${h}l-24 -14z" fill="#393e49"/>`;
      for(let f=10;f<h-8;f+=16)shapes+=`<path d="M${x+9} ${y+f}l${w-18} -${(w-18)*22/w}" stroke="#efb66b" stroke-width="4"/>`;
    }
    return `<svg viewBox="0 0 680 340" role="img" aria-label="Illustrated campus tower, apartments and Austin skyline"><path d="M10 250L405 100 672 246 280 330Z" fill="#202c31"/><path d="M40 263L424 125M120 289L506 153M208 314L586 193M109 211L338 331M205 171L444 287" stroke="#57635f" stroke-width="3"/>${shapes}<path d="M287 91l25 -9 18 10v136l-25 9 -18 -10z" fill="#b99367"/><path d="M305 95l25 -3v136l-25 9z" fill="#66584a"/><path d="M280 90l32 -13 25 15 -32 13zM291 64l20 -8 18 10 -21 9z" fill="#e4be84"/><path d="M291 64v24l17 9V75z" fill="#d6ae77"/><path d="M308 75l21 -9v23l-21 8z" fill="#807157"/><circle cx="299" cy="80" r="4" fill="#fff0c7"/><path class="load-route" d="M101 279L239 227 274 249 404 200" fill="none" stroke="#f6b85e" stroke-width="4" stroke-dasharray="6 7"/><circle cx="101" cy="279" r="6" fill="#f6b85e"/><circle cx="404" cy="200" r="6" fill="#f6b85e"/></svg>`;
  }
  function openModes(event) { opener=event.currentTarget; dialog.showModal(); }
  function build() {
    const veil=document.getElementById('veil'); if(!veil)return;
    veil.replaceChildren();veil.classList.add('loading-v2');veil.removeAttribute('aria-hidden');
    root=document.createElement('section');root.id='load-city';
    root.innerHTML=`<div class="load-story"><p class="load-eyebrow">AUSTIN 3D EXPLORER</p><h1></h1><p class="load-subtitle"></p>${cityArt()}<p class="load-caption">WEST CAMPUS &nbsp; / &nbsp; UT AUSTIN &nbsp; / &nbsp; DOWNTOWN</p></div><div class="load-card"><div class="load-heading"><h2>Building your Austin</h2><span id="load-percent">0%</span></div><div class="load-rail" role="progressbar" aria-label="City loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p id="load-estimate"></p><div id="load-stages"></div><div class="load-choice"><h3>Where will you go first?</h3><p>Find a home, tour campus, or watch the city turn to night.</p><button type="button" id="load-modes">Choose an experience &rarr;</button><small>Free exploration opens automatically.</small></div></div><footer>Built by Simeon Varghese</footer>`;
    root.querySelector('h1').textContent=TUNE.title;root.querySelector('.load-subtitle').textContent=TUNE.subtitle;
    veil.append(root);
    const button=document.createElement('button');button.id='mode-launcher';button.textContent='Explore modes';button.hidden=true;button.type='button';button.addEventListener('click',openModes);document.body.append(button);
    dialog=document.createElement('dialog');dialog.id='mode-dialog';dialog.setAttribute('aria-label','Choose your Austin');
    dialog.innerHTML='<form method="dialog"><div class="mode-header"><h2>Choose your Austin</h2><button aria-label="Close mode launcher" value="close">×</button></div><p class="mode-intro">Launch a new experience. Changing modes reloads the city.</p><div class="mode-grid"></div><div class="mode-settings"><label>Lighting<select id="mode-time"><option value="">Keep current lighting</option><option value="0">Daylight</option><option value="0.5">Golden hour</option><option value="1">Night</option></select></label><label>Graphics<select id="mode-graphics"><option value="">Keep current settings</option><option value="performance">Performance · lighter</option><option value="balanced">Balanced · everyday</option><option value="cinematic">Cinematic · richer effects</option><option value="ultra">Ultra · highest detail</option></select></label></div><button class="mode-go" type="button">Launch experience &rarr;</button></form>';
    const q=new URLSearchParams(location.search);
    root.querySelector('.load-choice small').textContent='Your current experience opens automatically.';
    for(const [id,title,desc,params] of MODES){const label=document.createElement('label');label.className='mode-option';const input=document.createElement('input');input.type='radio';input.name='experience';input.value=id;input.checked=id===(MODES.slice(1).find(m=>(m[0]!=='home'||q.get('walk')!=='0')&&Object.entries(m[3]).every(([k,v])=>q.get(k)===v))?.[0]||'explore');const text=document.createElement('span');const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=desc;text.append(strong,small);label.append(input,text);dialog.querySelector('.mode-grid').append(label);}
    dialog.querySelector('.mode-go').onclick=()=>{
      const chosen=MODES.find(m=>m[0]===dialog.querySelector('input:checked').value);
      const url=new URL(location.href);
      for(const key of ['tour','autopilot','timelapse','sliderdemo','clip','drive','livehere','walk','from','to','intro'])url.searchParams.delete(key);
      Object.entries(chosen[3]).forEach(([k,v])=>url.searchParams.set(k,v));
      if(Number.isFinite(window.__todCurrentP))url.searchParams.set('p',window.__todCurrentP);
      if(window.GFX?.preset)url.searchParams.set('preset',window.GFX.preset);
      for(const [id,key] of [['mode-time','p'],['mode-graphics','preset']]){const value=dialog.querySelector('#'+id).value;if(value)url.searchParams.set(key,value);}
      location.assign(url.href);
    };
    dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('pointerdown',e=>e.stopPropagation());
    dialog.addEventListener('close',()=>{const target=opener?.isConnected?opener:button;if(!target.hidden)target.focus();});
    document.body.append(dialog);root.querySelector('#load-modes').addEventListener('click',openModes);
    update();timer=setInterval(update,TUNE.pollMs);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();
