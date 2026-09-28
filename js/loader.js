/* Loading work is measured, never animated toward an invented percentage.
 * The drawing moves on its own: each island floats (a CSS transform, so the
 * compositor keeps it smooth while the city loads on the main thread) and the
 * West Campus islet turns a quarter at a time, drawn in a worker. The small
 * pulses (halo, stars, fountain glint, path) are CSS opacity. All of it stops
 * under prefers-reduced-motion. */
(function () {
  'use strict';
  // Every word on the loading screen, the mode pill and the "Where to?" launcher.
  // Owner-approved copy (2026-09-28): change wording here and nowhere else.
  // {elapsed}, {done}/{total} and {built}/{total} are filled with live numbers.
  // index.html repeats "Austin 3D Explorer" in <title> and #veil-title for the
  // first paint, before this script replaces the veil.
  const COPY = {
    'story.eyebrow': "AUSTIN 3D EXPLORER",
    'story.headline': "Austin's under construction. As usual.",
    'story.subtitle': "The real walk to class. Not the listing's “5 min.”",
    'story.art_aria': "Drawing of the UT Tower and the South Mall, with West Campus apartments and downtown behind it",
    'story.caption': "THE FORTY ACRES, GIVE OR TAKE",
    'story.footer': "Built by Simeon Varghese",
    'card.title': "Still building",
    'card.progress_aria': "City loading progress",
    'estimate.usual': "{elapsed}s in. Beats sitting on I-35.",
    'estimate.slow': "{elapsed}s in. Okay, now it's I-35.",
    'stage.map.name': "Map",
    'stage.map.ready': "done",
    'stage.map.drawing': "drawing streets",
    'stage.map.style': "surveying the site",
    'stage.data.name': "Paperwork",
    'stage.data.count': "{done} / {total} files",
    'stage.data.errors': ", some flaked",
    'stage.models.name': "Buildings",
    'stage.models.off': "switched off in settings",
    'stage.models.count': "{built} / {total} standing",
    'stage.models.reading': "reading blueprints",
    'stage.light.name': "Lighting",
    'stage.light.ready': "done",
    'stage.light.preparing': "polishing windows",
    'stage.walk.name': "Sidewalks",
    'stage.walk.optional': "not needed yet",
    'stage.walk.ready': "done",
    'stage.walk.error': "didn't make it",
    'stage.walk.preparing': "finding shortcuts",
    'choice.title': "Don't just stare at the bar.",
    'choice.body': "Apartment hunting's in here. So are sunsets.",
    'choice.button': "Pick a mode →",
    'choice.fine': "Or ignore me. It opens when it's done.",
    'pill.ready': "Switch modes",
    'pill.incomplete': "Modes (still loading)",
    'pill.gaveup': "Modes (some bits flaked)",
    'dialog.aria': "Where to?",
    'dialog.title': "Where to?",
    'dialog.close_aria': "Close the mode picker",
    'dialog.close_glyph': "×",
    'dialog.intro': "Switching modes reloads the whole city. Sorry in advance.",
    'settings.lighting.label': "Time of day",
    'settings.lighting.keep': "Same as now",
    'settings.lighting.day': "Daylight",
    'settings.lighting.golden': "Golden hour",
    'settings.lighting.night': "Night",
    'settings.graphics.label': "Graphics",
    'settings.graphics.keep': "Same as now",
    'settings.graphics.performance': "Performance: fastest, plainest",
    'settings.graphics.balanced': "Balanced: the default",
    'settings.graphics.cinematic': "Cinematic: film look",
    'settings.graphics.ultra': "Ultra: everything on",
    'dialog.go': "Send it →",
    'mode.explore.title': "Free roam",
    'mode.explore.desc': "Fly wherever. Nobody's grading this one.",
    'mode.home.title': "Apartment hunt (beta)",
    'mode.home.desc': "Compare apartments by the walk to class.",
    'mode.tour.title': "Campus tour",
    'mode.tour.desc': "Like the real one, no walking backwards.",
    'mode.autopilot.title': "Autopilot",
    'mode.autopilot.desc': "A drone shot you don't have to fly.",
    'mode.timelapse.title': "Day to night",
    'mode.timelapse.desc': "Fast-forward the sun.",
    'mode.sunset.title': "Sunset spot",
    'mode.sunset.desc': "The Mt. Bonnell move, from the couch.",
    'mode.photo.title': "Photo mode",
    'mode.photo.desc': "Hides the buttons. Wallpaper material.",
    'mode.walk.title': "Walk to class (beta)",
    'mode.walk.desc': "Walking directions. Don't bet a midterm on it."
  };
  // Owner-approved drawing (2026-09-28): the UT Tower on floating islands.
  // Its colours and animation timings, in one place. Each entry becomes a CSS
  // variable on the SVG (--moon, --halo-breath, ...), so one edit here restyles
  // the whole picture. The geometry lives in ART_LAYERS near cityArt().
  const ART = {
    moon: '#f6ecdc', 'moon-alpha': '0.07', star: '#f6ecdc', 'star-alpha': '0.6',
    halo: '#bf5700', 'halo-alpha': '0.35', 'halo-mid-alpha': '.15', 'lime-top': '#e4be84',
    'lime-lit': '#b99367', 'lime-shade': '#66584a', 'roof-flat': '#7a6a55', 'crown-top': '#f1d6a6',
    'crown-lit': '#d6ae77', 'crown-shade': '#807157', 'win-top': '#e07a2a', 'win-lit': '#bf5700',
    'win-shade': '#8a3f00', 'copper-top': '#8fa596', 'copper-lit': '#6f8477', 'copper-shade': '#4a5a52',
    'tile-lit': '#b2613c', 'tile-mid': '#9c4a2f', 'tile-shade': '#5a2f25', 'tile-ridge': '#cf8057',
    'eave-alpha': '0.4', 'hall-top': '#bc8c5d', 'hall-lit': '#745744', 'hall-shade': '#393e49',
    'far-top': '#3c4a4e', 'far-lit': '#2b3a40', 'far-shade': '#1d2a31', opening: '#393e49',
    'opening-deep': '#262b33', glow: '#efb66b', door: '#3f6f73', 'glass-lit': '#343944',
    'glass-shade': '#23272e', 'bronze-lit': '#8a7448', 'bronze-shade': '#56492f', clock: '#fff0c7',
    bezel: '#d8b247', hands: '#3a352f', bell: '#231b16', mast: '#b5bfc0',
    'island-top': '#202c31', 'island-edge': '#2b3a40', 'island-side': '#16222a', 'lawn-top': '#3f5a4b',
    'lawn-lit': '#2f4439', 'lawn-shade': '#22322a', 'pave-top': '#57635f', riser: '#46524f',
    'riser-shade': '#2f3a3c', water: '#7fa9b0', glint: '#f6ecdc', accent: '#f6b85e',
    figure: '#f6ecdc', pack: '#bf5700', shadow: '#0b141b',
    // animation timings
    'halo-breath': '3.6s', 'glint-blink': '2.8s', 'star-twinkle': '5.5s', 'route-walk': '3.6s'
  };
  // How each island floats: lift in drawing units (the drawing is 680 wide),
  // seconds for one rise, and a start offset so no two move in step.
  const FLOAT = {
    main: { lift: 1.2, rise: 3.4, delay: 0 },    // the big island: heaviest, slowest, smallest
    west: { lift: 2.6, rise: 2.5, delay: -1.1 }, // West Campus islet
    city: { lift: 2.0, rise: 2.9, delay: -2.2 }   // downtown islet
  };
  // The West Campus islet's quarter turns, in seconds: one turn, the rest
  // between turns, the longer rest at home, and the overshoot (0 = none).
  // on: false keeps the islet still (it still floats).
  const TURN = { on: true, time: 1.25, hold: 1.7, holdHome: 3.8, back: 0.55 };
  // slowAfter*: seconds after which the time line switches from estimate.usual
  // to estimate.slow (phones load slower).
  const TUNE = { slowAfterDesktop: 40, slowAfterPhone: 50, pollMs: 600,
    weights: { map: 20, data: 20, models: 45, light: 5, reveal: 10 } };
  const t = (key, vars) => String(COPY[key] ?? '').replace(/\{(\w+)\}/g, (m, n) => vars && n in vars ? vars[n] : m);
  const h = (key, vars) => t(key, vars).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // [id, title, description, URL flags]; the words come from COPY mode.<id>.*
  const MODES = [
    ['explore',{}],
    ['home',{livehere:'1'}],
    ['tour',{tour:'1'}],
    ['autopilot',{autopilot:'1'}],
    ['timelapse',{timelapse:'1'}],
    ['sunset',{sliderdemo:'1'}],
    ['photo',{clip:'1',drive:'1'}],
    ['walk',{walk:'1'}]
  ].map(([id,params]) => [id, t('mode.'+id+'.title'), t('mode.'+id+'.desc'), params]);
  const files = new Map();
  let graph = 'optional', sceneReady = false, revealed = false, timer, root, dialog, opener;
  // shown: the highest reading so far. The measurement can dip (new data files are
  // discovered mid-load; the opening camera re-requests tiles under the veil, -10),
  // so the bar holds its best reading while the stage list shows the real state.
  let last = '', mapReady = false, shown = 0;
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
    const slowAfter = matchMedia('(pointer:coarse)').matches ? TUNE.slowAfterPhone : TUNE.slowAfterDesktop;
    const estimate = t(elapsed < slowAfter ? 'estimate.usual' : 'estimate.slow', {elapsed: Math.floor(elapsed)});
    const rows = [
      [t('stage.map.name'),t(r.tiles?'stage.map.ready':sceneReady?'stage.map.drawing':'stage.map.style')],
      [t('stage.data.name'),t('stage.data.count',{done:r.dataDone,total:r.dataTotal})+(r.errors?t('stage.data.errors'):'')],
      [t('stage.models.name'),r.off?t('stage.models.off'):r.total?t('stage.models.count',{built:r.built,total:r.total}):t('stage.models.reading')],
      [t('stage.light.name'),t(r.light?'stage.light.ready':'stage.light.preparing')],
      [t('stage.walk.name'),t(graph==='optional'?'stage.walk.optional':graph==='done'?'stage.walk.ready':graph==='error'?'stage.walk.error':'stage.walk.preparing')]
    ];
    const signature = JSON.stringify([r,graph,Math.floor(elapsed)]);
    if(signature===last)return; last=signature;
    state.current = r;
    shown = Math.max(shown, r.percent);
    state.history.push({ms:Math.round(performance.now()),...r,shown,graph});
    if(state.history.length>600)state.history.shift();
    root.querySelector('#load-percent').textContent = shown+'%';
    const bar = root.querySelector('[role=progressbar]');
    bar.setAttribute('aria-valuenow',shown);
    bar.querySelector('i').style.transform='scaleX('+shown/100+')';
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
    if(button) {button.hidden=false;button.textContent=t(state.complete?'pill.ready':'pill.incomplete');}
    clearInterval(timer);
    if(!state.complete) {
      let checks=0;
      timer=setInterval(()=>{
        if(readings().complete){state.complete=true;button.textContent=t('pill.ready');clearInterval(timer);}
        else if(++checks>=100){button.textContent=t('pill.gaveup');clearInterval(timer);}
        update();
      },TUNE.pollMs);
    }
  };
  // The drawing's own stylesheet: which ART colour each part uses, and the pulses.
  const ART_CSS = ".mvh .rf{fill:var(--roof-flat)}.mvh .lt{fill:var(--lime-top)}.mvh .ll{fill:var(--lime-lit)}.mvh .ls{fill:var(--lime-shade)}.mvh .ct,.mvh .trim{fill:var(--crown-top)}.mvh .cl{fill:var(--crown-lit)}.mvh .cs{fill:var(--crown-shade)}.mvh .ot{fill:var(--win-top)}.mvh .ol{fill:var(--win-lit)}.mvh .os{fill:var(--win-shade)}.mvh .kt{fill:var(--copper-top)}.mvh .kl{fill:var(--copper-lit)}.mvh .ks{fill:var(--copper-shade)}.mvh .rl{fill:var(--tile-lit)}.mvh .rm{fill:var(--tile-mid)}.mvh .rs{fill:var(--tile-shade)}.mvh .ht{fill:var(--hall-top)}.mvh .hl{fill:var(--hall-lit)}.mvh .hs{fill:var(--hall-shade)}.mvh .ft{fill:var(--far-top)}.mvh .fl{fill:var(--far-lit)}.mvh .fs{fill:var(--far-shade)}.mvh .wo{fill:var(--opening)}.mvh .ao{fill:var(--opening-deep)}.mvh .wg,.mvh .ag{fill:var(--glow)}.mvh .door{fill:var(--door)}.mvh .gl2{fill:var(--glass-lit)}.mvh .gs2{fill:var(--glass-shade)}.mvh .bez{fill:var(--bezel)}.mvh .dial{fill:var(--clock)}.mvh .hand,.mvh .rail,.mvh .bronze{fill:var(--hands)}.mvh .bell{fill:var(--bell)}.mvh .mast{fill:var(--mast)}.mvh .it{fill:var(--island-top)}.mvh .ie{fill:var(--island-edge)}.mvh .is{fill:var(--island-side)}.mvh .pt,.mvh .st{fill:var(--pave-top)}.mvh .sr{fill:var(--riser)}.mvh .ss{fill:var(--riser-shade)}.mvh .gt{fill:var(--lawn-top)}.mvh .gl{fill:var(--lawn-lit)}.mvh .gs{fill:var(--lawn-shade)}.mvh .water{fill:var(--water)}.mvh .glint{fill:var(--glint)}.mvh .fig{fill:var(--figure)}.mvh .pack{fill:var(--pack)}.mvh .shade,.mvh .esh{fill:var(--shadow)}.mvh .so{stroke:var(--opening)}.mvh .sd{stroke:var(--opening-deep)}.mvh .sg{stroke:var(--glow)}.mvh .sbz{stroke:var(--bronze-lit)}.mvh .sbs{stroke:var(--bronze-shade)}.mvh .scn{stroke:var(--crown-shade)}.mvh .sgd{stroke:var(--bezel)}.mvh .rg{stroke:var(--tile-ridge)}.mvh .route{stroke:var(--accent)}.mvh [stroke-dasharray],.mvh .rg,.mvh .route{fill:none}.mvh .rg{stroke-width:.6;stroke-linejoin:round}.mvh .route{stroke-linecap:round}.mvh .moon{fill:var(--moon);opacity:var(--moon-alpha)}.mvh .stars{fill:var(--star);opacity:var(--star-alpha)}.mvh .shade{opacity:.55}.mvh .esh{opacity:var(--eave-alpha)}.mvh .u1{opacity:.7}.mvh .u2{opacity:.32}.mvh .u3{opacity:.14}.mvh .glint{animation:mvh-blink var(--glint-blink) ease-in-out infinite}.mvh .stars circle:nth-child(2n){animation:mvh-blink var(--star-twinkle) ease-in-out infinite}.mvh .route path{animation:mvh-walk var(--route-walk) ease-in-out infinite}.mvh .route .w1{animation-delay:calc(var(--route-walk)/-1.5)}.mvh .route .w2{animation-delay:calc(var(--route-walk)/-3)}@keyframes mvh-breathe{50%{opacity:.72}}@keyframes mvh-blink{50%{opacity:.25}}@keyframes mvh-walk{50%{opacity:.45}}.mvh-stack{position:relative;aspect-ratio:680/340;margin-top:4px}.mvh-stack>div{position:absolute;inset:0}.mvh-stack svg.mvh{position:absolute;inset:0;width:100%;height:100%;margin:0;display:block}.mvh-turn{position:absolute;inset:0;width:100%;height:100%;visibility:hidden}.mvh-west.turning>svg{visibility:hidden}.mvh-west.turning>.mvh-turn{visibility:visible}@media (prefers-reduced-motion:reduce){.mvh-stack,.mvh-stack *{animation:none!important}}";
  // One layer per island, in paint order, so each can float on its own.
  // ART_BOX is where each moving layer is cut from the drawing: [x, y, w, h].
  const ART_LAYERS = {
    sky: "<circle class=\"moon\" cx=\"128\" cy=\"70\" r=\"38\"/><g class=\"stars\"><circle cx=\"232\" cy=\"30\" r=\"1.2\"/><circle cx=\"560\" cy=\"44\" r=\"1.1\"/><circle cx=\"626\" cy=\"150\" r=\".9\"/><circle cx=\"84\" cy=\"196\" r=\".8\"/></g>",
    halo: "<ellipse class=\"halo\" cx=\"398\" cy=\"55.8\" rx=\"78\" ry=\"53.8\" fill=\"url(#mvh-halo)\"/>",
    city: "<g class=\"u2\"><path class=\"ie\" d=\"M550.8 216.1l12.4 7.2v6.3l-12.4-7.2z\"/><path class=\"is\" d=\"M563.2 223.3l8.4-4.8v6.3l-8.4 4.8z\"/></g><g class=\"u1\"><path class=\"ie\" d=\"M543.5 209.8l19.7 11.4v6.3l-19.7-11.4z\"/><path class=\"is\" d=\"M563.2 221.2l15.6-9v6.3l-15.6 9z\"/></g><path class=\"it\" d=\"M559.1 184.6l27 15.6-22.9 13.2-27-15.6z\"/><path class=\"ie\" d=\"M536.2 197.8l27 15.6v12l-27-15.6z\"/><path class=\"is\" d=\"M563.2 213.4l22.9-13.2v12l-22.9 13.2z\"/><path class=\"ft\" d=\"M559.1 160.6l7.3 4.2-6.3 3.6-7.3-4.2z\"/><path class=\"fl\" d=\"M552.8 164.2l7.3 4.2v26.4l-7.3-4.2z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 4.2\" d=\"M3.1-10.3h.8M1.4-3.5h.8M4.8 3.3h.8\" transform=\"matrix(1.04.6 0-1.2 552.8 173.8)\"/><path class=\"fs\" d=\"M560.1 168.4l6.3-3.6v26.4l-6.3 3.6z\"/><path class=\"ft\" d=\"M572.6 170.8l7.3 4.2-6.3 3.6-7.2-4.2z\"/><path class=\"fl\" d=\"M566.4 174.4l7.2 4.2v22.8l-7.2-4.2z\"/><path class=\"fs\" d=\"M573.6 178.6l6.3-3.6v22.8l-6.3 3.6z\"/><path class=\"ft\" d=\"M560.1 152.8l8.3 4.8-8.3 4.8-8.3-4.8z\"/><path class=\"fl\" d=\"M551.8 157.6l8.3 4.8v38.4l-8.3-4.8z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 5.2\" d=\"M3.6-10.3h.8M1.6-3.5h.8M5.6 3.3h.8M3.6 10.1h.8\" transform=\"matrix(1.04.6 0-1.2 551.8 179.2)\"/><path class=\"fs\" d=\"M560.1 162.4l8.3-4.8v38.4l-8.3 4.8z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 5.2\" d=\"M3.6-10.3h.8M1.6-3.5h.8M5.6 3.3h.8M3.6 10.1h.8\" transform=\"matrix(1.04-.6 0-1.2 560.1 184)\"/><path class=\"ft\" d=\"M560.1 149.8l6.3 3.6-6.3 3.6-6.2-3.6z\"/><path class=\"fl\" d=\"M553.9 153.4l6.2 3.6v4.2l-6.2-3.6z\"/><path class=\"fs\" d=\"M560.1 157l6.3-3.6v4.2l-6.3 3.6z\"/><path class=\"ft\" d=\"M560.1 147l3.8 2.2-3.8 2.2-3.7-2.2z\"/><path class=\"fl\" d=\"M556.4 149.2l3.7 2.2v4.2l-3.7-2.2z\"/><path class=\"fs\" d=\"M560.1 151.4l3.8-2.2v4.2l-3.8 2.2z\"/><rect class=\"mast\" x=\"559.8\" y=\"139.2\" width=\".7\" height=\"10\"/><path class=\"ft\" d=\"M548.7 178.6l8.3 4.8-7.3 4.2-8.3-4.8z\"/><path class=\"fl\" d=\"M541.4 182.8l8.3 4.8v15.6l-8.3-4.8z\"/><path class=\"fs\" d=\"M549.7 187.6l7.3-4.2v15.6l-7.3 4.2z\"/><path class=\"ft\" d=\"M564.3 181.6l8.3 4.8-8.3 4.8-8.3-4.8z\"/><path class=\"fl\" d=\"M556 186.4l8.3 4.8v19.2l-8.3-4.8z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 5.2\" d=\"M3.6-10.3h.8M1.6-3.5h.8\" transform=\"matrix(1.04.6 0-1.2 556 188.8)\"/><path class=\"fs\" d=\"M564.3 191.2l8.3-4.8v19.2l-8.3 4.8z\"/>",
    west: "<g class=\"u2\"><path class=\"ie\" d=\"M208.9 177.1l10.4 6v6.3l-10.4-6z\"/><path class=\"is\" d=\"M219.3 183.1l6.2-3.6v6.3l-6.2 3.6z\"/></g><g class=\"u1\"><path class=\"ie\" d=\"M201.6 170.8l17.7 10.2v6.3l-17.7-10.2z\"/><path class=\"is\" d=\"M219.3 181l13.5-7.8v6.3l-13.5 7.8z\"/></g><path class=\"it\" d=\"M215.1 146.8l24.9 14.4-20.7 12-25-14.4z\"/><path class=\"ie\" d=\"M194.3 158.8l25 14.4v12l-25-14.4z\"/><path class=\"is\" d=\"M219.3 173.2l20.7-12v12l-20.7 12z\"/><path class=\"gt\" d=\"M215.1 147.3l22.9 13.2-18.7 10.8-22.9-13.2z\"/><path class=\"gl\" d=\"M196.4 158.1l22.9 13.2v.7l-22.9-13.2z\"/><path class=\"gs\" d=\"M219.3 171.3l18.7-10.8v.7l-18.7 10.8z\"/><path class=\"ht\" d=\"M215.1 127.6l12.5 7.2-10.4 6-12.5-7.2z\"/><path class=\"hl\" d=\"M204.7 133.6l12.5 7.2v22.1l-12.5-7.2z\"/><g transform=\"matrix(1.04.6 0-1.2 204.7 149.2)\"><path class=\"so\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 .7\" d=\"M1.6-1.6h8.9M1.6 1.5h8.9M1.6 4.6h8.9M1.6 7.8h8.9M1.6 10.9h8.9\"/><path class=\"sg\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 4.6\" d=\"M3.5-1.6h7M1.6 1.5h7M5.4 4.6h1.2M3.5 7.8h7M1.6 10.9h7\"/></g><path class=\"hs\" d=\"M217.2 140.8l10.4-6v22.1l-10.4 6z\"/><g transform=\"matrix(1.04-.6 0-1.2 217.2 156.4)\"><path class=\"sd\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 .7\" d=\"M1.6-1.6h6.9M1.6 1.5h6.9M1.6 4.6h6.9M1.6 7.8h6.9M1.6 10.9h6.9\"/><path class=\"sg\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 4.5\" d=\"M3.5-1.6h1.2M1.6 1.5h6.9M5.4 4.6h1.2M3.5 7.8h1.2M1.6 10.9h6.9\"/><rect class=\"door\" x=\"3.9\" y=\"-5.4\" width=\"2.2\" height=\"2.8\"/></g><path class=\"ht\" d=\"M215.1 126.4l4.2 2.4-3.2 1.8-4.1-2.4z\"/><path class=\"hl\" d=\"M212 128.2l4.1 2.4v3.6l-4.1-2.4z\"/><path class=\"hs\" d=\"M216.1 130.6l3.2-1.8v3.6l-3.2 1.8z\"/><path class=\"ht\" d=\"M217.2 133.6l2.6 1.5-2.6 1.5-2.6-1.5z\"/><path class=\"hl\" d=\"M214.6 135.1l2.6 1.5v2.4l-2.6-1.5z\"/><path class=\"hs\" d=\"M217.2 136.6l2.6-1.5v2.4l-2.6 1.5z\"/><g class=\"route\" stroke-width=\"2.2\"><path class=\"w0\" d=\"M224.7 160.4h0\"/><path class=\"w1\" d=\"M227.6 162.1h0\"/><path class=\"w2\" d=\"M230.5 163.8h0\"/></g>",
    main: "<g class=\"u2\"><path class=\"ie\" d=\"M267.1 227.5l24.9 14.4v6.3l-24.9-14.4zM327.3 244l70.7 40.8v8.4l-70.7-40.8zM254.6 246.7l91.4 52.8v6.3l-91.4-52.8zM375.1 299.5l16.7 9.6v6.3l-16.7-9.6zM416.7 292.3l16.6 9.6v6.3l-16.6-9.6zM288.9 292.9l20.8 12v6.3l-20.8-12z\"/><path class=\"is\" d=\"M292 241.9l37.4-21.6v6.3l-37.4 21.6zM398 284.8l58.2-33.6v8.4l-58.2 33.6zM346 299.5l22.9-13.2v6.3l-22.9 13.2zM391.8 309.1l12.4-7.2v6.3l-12.4 7.2zM433.3 301.9l18.7-10.8v6.3l-18.7 10.8zM309.7 304.9l4.1-2.4v6.3l-4.1 2.4z\"/></g><g class=\"u1\"><path class=\"ie\" d=\"M259.8 221.2l32.2 18.6v6.3l-32.2-18.6zM316.9 235.6l81.1 46.8v8.4l-81.1-46.8zM247.3 240.4l98.7 57v6.3l-98.7-57zM367.9 293.2l23.9 13.8v6.3l-23.9-13.8zM409.4 286l23.9 13.8v6.3l-23.9-13.8zM281.6 286.6l28.1 16.2v6.3l-28.1-16.2z\"/><path class=\"is\" d=\"M292 239.8l44.7-25.8v6.3l-44.7 25.8zM398 282.4l68.6-39.6v8.4l-68.6 39.6zM346 297.4l30.2-17.4v6.3l-30.2 17.4zM391.8 307l19.7-11.4v6.3l-19.7 11.4zM433.3 299.8l26-15v6.3l-26 15zM309.7 302.8l11.4-6.6v6.3l-11.4 6.6z\"/></g><path class=\"pt\" d=\"M304.5 180.4l39.5 22.8-52 30-39.5-22.8z\"/><rect class=\"gt\" x=\"3\" y=\"3\" width=\"32\" height=\"44\" transform=\"matrix(1.04.6-1.04.6 304.5 180.4)\"/><path class=\"ie\" d=\"M252.5 210.4l39.5 22.8v10.8l-39.5-22.8z\"/><path class=\"is\" d=\"M292 233.2l52-30v10.8l-52 30z\"/><path class=\"pt\" d=\"M385.5 168.4l91.5 52.8-79 45.6-91.5-52.8z\"/><path class=\"ie\" d=\"M306.5 214l91.5 52.8v21.6l-91.5-52.8z\"/><path class=\"is\" d=\"M398 266.8l79-45.6v21.6l-79 45.6z\"/><path class=\"pt\" d=\"M435.4 256l31.2 18-33.3 19.2-31.1-18z\"/><rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"26\" transform=\"matrix(1.04.6-1.04.6 435.4 256)\"/><path class=\"ie\" d=\"M402.2 275.2l31.1 18v10.8l-31.1-18z\"/><path class=\"is\" d=\"M433.3 293.2l33.3-19.2v10.8l-33.3 19.2z\"/><path class=\"ht\" d=\"M300.3 169l22.9 13.2-27 15.6-22.9-13.2z\"/><path class=\"hl\" d=\"M273.3 184.6l22.9 13.2v21l-22.9-13.2z\"/><g transform=\"matrix(1.04.6 0-1.2 273.3 194.8)\"><path class=\"wo\" d=\"M3.2 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM7.7 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM12.2 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM16.7 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4z\"/><path class=\"so\" stroke-width=\"3.6\" stroke-dasharray=\"1.8 2.7\" d=\"M3.4-4.7h15.3\"/></g><path class=\"hs\" d=\"M296.2 197.8l27-15.6v21l-27 15.6z\"/><g transform=\"matrix(1.04-.6 0-1.2 296.2 208)\"><path class=\"wg\" d=\"M2.5-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM5.6-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM8.8-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM11.9-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM15-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM18.2-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM21.3-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"sd\" stroke-width=\"3.8\" stroke-dasharray=\"1.6 1.5\" d=\"M2.8-4.9h20.5\"/><rect class=\"door\" x=\"11.7\" y=\"-9\" width=\"2.6\" height=\"4.8\"/></g><path class=\"esh\" d=\"M273.3 185.7l22.9 13.2v1.9l-22.9-13.2zM296.2 198.9l27-15.6v1.9l-27 15.6z\"/><path class=\"rm\" d=\"M270 184.6l26.2 15.1v1.1l-26.2-15.1z\"/><path class=\"rs\" d=\"M296.2 199.7l30.3-17.5v1.1l-30.3 17.5z\"/><path class=\"rm\" d=\"M300.3 167.1l26.2 15.1-26.2-9.1z\"/><path class=\"rl\" d=\"M300.3 167.1v6l-4.1 2.4-26.2 9.1z\"/><path class=\"rs\" d=\"M326.5 182.2l-30.3 17.5v-24.2l4.1-2.4z\"/><path class=\"rl\" d=\"M270 184.6l26.2-9.1v24.2z\"/><path class=\"rg\" d=\"M270 184.6L296.2 175.5L296.2 199.7M296.2 175.5L300.3 173.1\"/><path class=\"rf\" d=\"M385.5 146.3l20.8 12-45.7 26.4-20.8-12z\"/><path class=\"ll\" d=\"M339.8 172.7l20.8 12v29.3l-20.8-12z\"/><path class=\"ls\" d=\"M360.6 184.7l45.7-26.4v29.3l-45.7 26.4z\"/><path class=\"sd\" stroke-width=\"2.4\" stroke-dasharray=\"1.6 2.4\" d=\"M3.2 21.8h37.6\" transform=\"matrix(1.04-.6 0-1.2 360.6 214)\"/><path class=\"esh\" d=\"M360.6 185.8l45.7-26.4v1.9l-45.7 26.4z\"/><path class=\"rm\" d=\"M337.3 172.7l23.3 13.5v1l-23.3-13.4z\"/><path class=\"rs\" d=\"M360.6 186.2l48.2-27.9v1.1l-48.2 27.8z\"/><path class=\"rm\" d=\"M385.5 144.9l23.3 13.4-23.3-8.1z\"/><path class=\"rl\" d=\"M385.5 144.9v5.3l-24.9 14.4-23.3 8.1z\"/><path class=\"rs\" d=\"M408.8 158.3l-48.2 27.9v-21.6l24.9-14.4z\"/><path class=\"rl\" d=\"M337.3 172.7l23.3-8.1v21.6z\"/><path class=\"rg\" d=\"M337.3 172.7L360.6 164.6L360.6 186.2M360.6 164.6L385.5 150.2\"/><path class=\"rf\" d=\"M402.2 165.8l37.4 21.6-41.6 24-37.4-21.6z\"/><path class=\"ll\" d=\"M360.6 189.8l37.4 21.6v24.2l-37.4-21.6z\"/><path class=\"ls\" d=\"M398 211.4l41.6-24v24.2l-41.6 24z\"/><path class=\"lt\" d=\"M397.1 64.1l23.5 13.6-21.7 12.5-23.5-13.6z\"/><path class=\"ll\" d=\"M375.4 76.6l23.5 13.6v136.8l-23.5-13.5z\"/><g transform=\"matrix(1.04.6 0-1.2 375.4 213.5)\"><path class=\"gl2\" d=\"M5 6h2.5v105.1h-2.5zM10 6h2.5v105.1h-2.5zM15 6h2.5v105.1h-2.5z\"/><path class=\"sbz\" stroke-width=\"2.5\" stroke-dasharray=\"2.1 3.8\" d=\"M6.3 9.7v101.4M11.3 9.7v101.4M16.3 9.7v101.4\"/><path class=\"wg\" d=\"M5.4 60.3h1.8v3h-1.8zM10.4 24.6h1.8v3h-1.8zM10.4 102h1.8v3h-1.8zM15.4 66.2h1.8v3h-1.8z\"/></g><path class=\"ls\" d=\"M398.9 90.2l21.7-12.5v136.8l-21.7 12.5z\"/><g transform=\"matrix(1.04-.6 0-1.2 398.9 227)\"><path class=\"gs2\" d=\"M4.2 6h2.5v105.1h-2.5zM9.2 6h2.5v105.1h-2.5zM14.2 6h2.5v105.1h-2.5z\"/><path class=\"sbs\" stroke-width=\"2.5\" stroke-dasharray=\"2.1 3.8\" d=\"M5.4 9.7v101.4M10.4 9.7v101.4M15.4 9.7v101.4\"/><path class=\"wg\" d=\"M4.5 60.3h1.8v3h-1.8zM9.5 24.6h1.8v3h-1.8zM9.5 102h1.8v3h-1.8zM14.5 66.2h1.8v3h-1.8z\"/></g><path class=\"ct\" d=\"M397.1 57.9l24 13.9-22.2 12.8-24-13.9z\"/><path class=\"cl\" d=\"M374.9 70.7l24 13.9v5.9l-24-13.9z\"/><path class=\"scn\" stroke-width=\"1.1\" stroke-dasharray=\".6 1.4\" d=\"M1.3 114.6h20.5\" transform=\"matrix(1.04.6 0-1.2 374.9 213.5)\"/><path class=\"cs\" d=\"M398.9 84.6l22.2-12.8v5.9l-22.2 12.8z\"/><path class=\"scn\" stroke-width=\"1.1\" stroke-dasharray=\".6 1.3\" d=\"M1.2 114.6h18.9\" transform=\"matrix(1.04-.6 0-1.2 398.9 227.4)\"/><path class=\"ot\" d=\"M397.2 47.4l20.2 11.6-18.6 10.8-20.2-11.7z\"/><path class=\"ol\" d=\"M378.6 58.1l20.2 11.7v12.6l-20.2-11.6z\"/><g transform=\"matrix(1.04.6 0-1.2 378.6 213.6)\"><circle class=\"bez\" cx=\"9.7\" cy=\"124.6\" r=\"4.1\"/><circle class=\"dial\" cx=\"9.7\" cy=\"124.6\" r=\"2.9\"/><path class=\"hand\" d=\"M9.5 124.6h.4v2.2h-.4zM9.7 124.3h1.6v.4h-1.6z\"/></g><path class=\"os\" d=\"M398.8 69.8l18.6-10.8v12.7l-18.6 10.7z\"/><g transform=\"matrix(1.04-.6 0-1.2 398.8 225.2)\"><circle class=\"bez\" cx=\"9\" cy=\"124.6\" r=\"4.1\"/><circle class=\"dial\" cx=\"9\" cy=\"124.6\" r=\"2.9\"/><path class=\"hand\" d=\"M8.7 124.6h.4v2.2h-.4zM9 124.3h1.6v.4h-1.6z\"/></g><path class=\"ot\" d=\"M397.2 45.1l19.7 11.3-.5.3-19.7-11.3zM397.2 45.1l.6.3-18.7 10.7-.5-.3z\"/><path class=\"os\" d=\"M379.1 56.1l18.7-10.7v2.3l-18.7 10.7z\"/><path class=\"bell\" d=\"M386.9 40.9l11.5 6.6v15.9l-11.5-6.6z\"/><g transform=\"matrix(1.04.6 0-1.2 386.9 213.7)\"><path class=\"ol\" d=\"M0 130.8h1.3v13.3h-1.3zM2.3 130.8h.6v13.3h-.6zM3.2 130.8h.6v13.3h-.6zM7.3 130.8h.6v13.3h-.6zM8.1 130.8h.6v13.3h-.6zM9.8 130.8h1.3v13.3h-1.3z\"/><rect class=\"ol\" x=\"0\" y=\"130.8\" width=\"11.1\" height=\".9\"/></g><path class=\"bell\" d=\"M398.4 47.5l10.7-6.1v15.9l-10.7 6.1z\"/><g transform=\"matrix(1.04-.6 0-1.2 398.4 220.4)\"><path class=\"os\" d=\"M0 130.8h1.2v13.3h-1.2zM2.1 130.8h.6v13.3h-.6zM2.9 130.8h.6v13.3h-.6zM6.7 130.8h.6v13.3h-.6zM7.5 130.8h.6v13.3h-.6zM9 130.8h1.2v13.3h-1.2z\"/><rect class=\"os\" x=\"0\" y=\"130.8\" width=\"10.2\" height=\".9\"/></g><path class=\"ot\" d=\"M379.1 55.5l20.2 11.7-.5.3-20.2-11.7z\"/><path class=\"ol\" d=\"M378.6 55.8l20.2 11.7v2.3l-20.2-11.7z\"/><path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1\" d=\"M1.3 130.4h16.8\" transform=\"matrix(1.04.6 0-1.2 378.6 213.6)\"/><path class=\"ot\" d=\"M416.9 56.4l.5.3-18.6 10.8-.6-.3z\"/><path class=\"os\" d=\"M398.8 67.5l18.6-10.8v2.3l-18.6 10.8z\"/><path class=\"sd\" stroke-width=\"1.2\" stroke-dasharray=\".5 .9\" d=\"M1.3 130.4h15.4\" transform=\"matrix(1.04-.6 0-1.2 398.8 225.2)\"/><path class=\"ot\" d=\"M397.5 32.3l12.2 7.1-11.2 6.5-12.2-7.1z\"/><path class=\"ol\" d=\"M386.3 38.8l12.2 7.1v2l-12.2-7z\"/><path class=\"sgd\" stroke-width=\".7\" stroke-dasharray=\".7 1.9\" d=\"M1.6 144.9h8.6\" transform=\"matrix(1.04.6 0-1.2 386.3 213.7)\"/><path class=\"os\" d=\"M398.5 45.9l11.2-6.5v2l-11.2 6.5z\"/><path class=\"sgd\" stroke-width=\".7\" stroke-dasharray=\".7 1.7\" d=\"M1.5 144.9h7.9\" transform=\"matrix(1.04-.6 0-1.2 398.5 220.8)\"/><path class=\"ot\" d=\"M397.6 30.6l10.5 6.1-9.7 5.6-10.5-6.1z\"/><path class=\"ol\" d=\"M387.9 36.2l10.5 6.1v2.7l-10.5-6.1z\"/><path class=\"os\" d=\"M398.4 42.3l9.7-5.6v2.6l-9.7 5.7z\"/><path class=\"ol\" d=\"M389.9 33.8l8.4 4.8v2.5l-8.4-4.8z\"/><path class=\"os\" d=\"M398.3 38.6l7.8-4.5v2.5l-7.8 4.5z\"/><path class=\"kt\" d=\"M397.7 28.9l9 5.2-8.7-3.6zM397.7 28.9l.3 1.6-8.7 3.3z\"/><path class=\"kl\" d=\"M389.3 33.8l8.7-3.3.3 8.5z\"/><path class=\"ks\" d=\"M406.7 34.1l-8.4 4.9-.3-8.5z\"/><rect class=\"mast\" x=\"397.6\" y=\"21.5\" width=\".9\" height=\"9\"/><path class=\"rf\" d=\"M443.7 179.9l20.8 12-45.7 26.4-20.8-12z\"/><path class=\"ll\" d=\"M398 206.3l20.8 12v29.3l-20.8-12z\"/><path class=\"ls\" d=\"M418.8 218.3l45.7-26.4v29.3l-45.7 26.4z\"/><g transform=\"matrix(1.04-.6 0-1.2 418.8 247.6)\"><path class=\"sd\" stroke-width=\"2.8\" stroke-dasharray=\"1.6 2.4\" d=\"M3.2 3.8h37.6M3.2 10.4h37.6M3.2 15.9h37.6M3.2 21h37.6\"/><path class=\"sg\" stroke-width=\"2.8\" stroke-dasharray=\"1.6 10.4\" d=\"M7.2 3.8h25.6M3.2 10.4h37.6M11.2 15.9h25.6M7.2 21h25.6\"/></g><path class=\"esh\" d=\"M418.8 219.4l45.7-26.4v1.9l-45.7 26.4z\"/><path class=\"rm\" d=\"M395.5 206.3l23.3 13.5v1l-23.3-13.4z\"/><path class=\"rs\" d=\"M418.8 219.8l48.2-27.9v1.1l-48.2 27.8z\"/><path class=\"rm\" d=\"M443.7 178.5l23.3 13.4-23.3-8.1z\"/><path class=\"rl\" d=\"M443.7 178.5v5.3l-24.9 14.4-23.3 8.1z\"/><path class=\"rs\" d=\"M467 191.9l-48.2 27.9v-21.6l24.9-14.4z\"/><path class=\"rl\" d=\"M395.5 206.3l23.3-8.1v21.6z\"/><path class=\"rg\" d=\"M395.5 206.3L418.8 198.2L418.8 219.8M418.8 198.2L443.7 183.8\"/><path class=\"rf\" d=\"M339.8 172.7l27 15.6-22.8 13.2-27.1-15.6z\"/><path class=\"ll\" d=\"M316.9 185.9l27.1 15.6v29.3l-27.1-15.6z\"/><g transform=\"matrix(1.04.6 0-1.2 316.9 215.2)\"><path class=\"wo\" d=\"M1.8 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM7.7 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM13.5 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM19.3 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9z\"/><path class=\"wg\" d=\"M1.8 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM7.7 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM13.5 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM19.3 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"wo\" d=\"M2 20.4h1.8v2.2h-1.8zM7.9 20.4h1.8v2.2h-1.8zM13.7 20.4h1.8v2.2h-1.8zM19.5 20.4h1.8v2.2h-1.8z\"/><path class=\"trim\" d=\"M0 17.2h26v.8h-26zM0 20h26v.5h-26z\"/></g><path class=\"esh\" d=\"M316.9 187l27.1 15.6v1.9l-27.1-15.6z\"/><path class=\"rm\" d=\"M314.4 185.9l40.8 23.5v1.1l-40.8-23.5zM339.8 171.3l40.7 23.5-12.6-1.5-28.1-16.2z\"/><path class=\"rl\" d=\"M339.8 171.3v5.8l-25.4 8.8zM314.4 185.9l25.4-8.8 28.1 16.2-12.7 16.1z\"/><path class=\"rg\" d=\"M314.4 185.9L339.8 177.1L363.7 190.9\"/><path class=\"rf\" d=\"M371 183.8l24.9 14.4-30.1 17.4-25-14.4z\"/><path class=\"ll\" d=\"M340.8 201.2l25 14.4v31.4l-25-14.4z\"/><g transform=\"matrix(1.04.6 0-1.2 340.8 232.6)\"><path class=\"ao\" d=\"M1.2 0v5a1.2 1.2 0 0 0 2.4 0v-5zM4.4 0v5a1.2 1.2 0 0 0 2.4 0v-5zM7.6 0v5a1.2 1.2 0 0 0 2.4 0v-5zM10.8 0v5a1.2 1.2 0 0 0 2.4 0v-5zM14 0v5a1.2 1.2 0 0 0 2.4 0v-5zM17.2 0v5a1.2 1.2 0 0 0 2.4 0v-5zM20.4 0v5a1.2 1.2 0 0 0 2.4 0v-5z\"/><path class=\"ag\" d=\"M1.7 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM4.9 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM8 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM11.3 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM14.5 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM17.7 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM20.8 0v4.8a.8.8 0 0 0 1.5 0v-4.7z\"/><path class=\"sg\" stroke-width=\"7.6\" stroke-dasharray=\"1.7 1.5\" d=\"M1.5 12.2h20.9\"/><rect class=\"rail\" x=\".6\" y=\"8.4\" width=\"22.8\" height=\".5\"/><path class=\"so\" stroke-width=\"2.6\" stroke-dasharray=\"1.4 1.8\" d=\"M1.7 22.2h20.6\"/><path class=\"trim\" d=\"M0 17.2h24v.8h-24zM0 20h24v.5h-24z\"/><path class=\"so\" stroke-width=\"1.5\" stroke-dasharray=\".4 1.2\" d=\"M1.2 18.9h21.6\"/></g><path class=\"ls\" d=\"M365.8 215.6l30.1-17.4v31.4l-30.1 17.4z\"/><path class=\"esh\" d=\"M340.8 202.2l25 14.4v2l-25-14.4zM365.8 216.6l30.1-17.4v2l-30.1 17.4z\"/><path class=\"rm\" d=\"M338.3 201.2l27.5 15.8v1.1l-27.5-15.9z\"/><path class=\"rs\" d=\"M365.8 217l32.6-18.8v1l-32.6 18.9z\"/><path class=\"rm\" d=\"M371 182.3l27.4 15.9-27.4-9.6z\"/><path class=\"rl\" d=\"M371 182.3v6.3l-5.2 3-27.5 9.6z\"/><path class=\"rs\" d=\"M398.4 198.2l-32.6 18.8v-25.4l5.2-3z\"/><path class=\"rl\" d=\"M338.3 201.2l27.5-9.6v25.4z\"/><path class=\"rg\" d=\"M338.3 201.2L365.8 191.6L365.8 217M365.8 191.6L371 188.6\"/><path class=\"rf\" d=\"M391.8 202.7l27 15.6-22.9 13.2-27-15.6z\"/><path class=\"ll\" d=\"M368.9 215.9l27 15.6v29.3l-27-15.6z\"/><g transform=\"matrix(1.04.6 0-1.2 368.9 245.2)\"><path class=\"wo\" d=\"M22 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM16.2 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM10.3 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM4.5 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9z\"/><path class=\"wg\" d=\"M22 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM16.2 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM10.3 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM4.5 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"wo\" d=\"M22.2 20.4h1.8v2.2h-1.8zM16.4 20.4h1.8v2.2h-1.8zM10.5 20.4h1.8v2.2h-1.8zM4.7 20.4h1.8v2.2h-1.8z\"/><path class=\"trim\" d=\"M0 17.2h26v.8h-26zM0 20h26v.5h-26z\"/></g><path class=\"ls\" d=\"M395.9 231.5l22.9-13.2v29.3l-22.9 13.2z\"/><path class=\"esh\" d=\"M368.9 217l27 15.6v1.9l-27-15.6zM395.9 232.6l22.9-13.2v1.9l-22.9 13.2z\"/><path class=\"rm\" d=\"M368.9 217.4l27 15.6v1l-27-15.6z\"/><path class=\"rs\" d=\"M395.9 233l25.4-14.7v1.1l-25.4 14.6z\"/><path class=\"rm\" d=\"M394.3 202.7l27 15.6-25.4-8.8-23.9-13.8 19.1 6.7z\"/><path class=\"rl\" d=\"M368.9 217.4l27 15.6v-23.5l-23.9-13.8v17.7z\"/><path class=\"rs\" d=\"M421.3 218.3l-25.4 14.7v-23.5z\"/><path class=\"rg\" d=\"M372 195.7L395.9 209.5L395.9 233\"/><path class=\"pt\" d=\"M307.3 211.7l33.2 19.2-.7.4-33.3-19.2z\"/><path class=\"ll\" d=\"M306.5 212.1l33.3 19.2v1.9l-33.3-19.2z\"/><path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\" transform=\"matrix(1.04.6 0-1.2 306.5 214)\"/><path class=\"pt\" d=\"M277.4 208l106.1 61.2-37.5 21.6-106-61.2z\"/><g transform=\"matrix(1.04.6-1.04.6 277.4 208)\"><rect class=\"gt\" x=\"31\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"74\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"2\" y=\"2\" width=\"26\" height=\"32\"/></g><path class=\"ie\" d=\"M240 229.6l106 61.2v10.8l-106-61.2z\"/><path class=\"is\" d=\"M346 290.8l37.5-21.6v10.8l-37.5 21.6z\"/><path class=\"st\" d=\"M310.7 216.4l3.1 1.8-3.6 2.1-3.1-1.8zM313.8 219.7l3.1 1.8-3.6 2.1-3.1-1.8zM316.9 223.1l3.2 1.8-3.7 2.1-3.1-1.8zM320.1 226.4l3.1 1.8-3.7 2.1-3.1-1.8zM323.2 229.8l3.1 1.8-3.6 2.1-3.2-1.8zM326.3 233.1l3.1 1.8-3.6 2.1-3.1-1.8zM329.4 236.5l3.1 1.8-3.6 2.1-3.1-1.8z\"/><path class=\"ss\" d=\"M310.2 220.3l3.6-2.1v1.5l-3.6 2.1zM313.3 223.6l3.6-2.1v1.6l-3.6 2.1zM316.4 227l3.7-2.1v1.5l-3.7 2.1zM319.5 230.3l3.7-2.1v1.6l-3.7 2.1zM322.7 233.7l3.6-2.1v1.5l-3.6 2.1zM325.8 237l3.6-2.1v1.6l-3.6 2.1zM328.9 240.4l3.6-2.1v1.5l-3.6 2.1z\"/><path class=\"sr\" d=\"M307.1 229.3v-10.8l3.1 1.8v1.5l3.1 1.8v1.6l3.1 1.8v1.5l3.1 1.8v1.6l3.2 1.8v1.5l3.1 1.8v1.6l3.1 1.8v1.5z\"/><path class=\"st\" d=\"M339.8 233.2l24.9 14.4-2 1.2-25-14.4zM337.7 235.9l25 14.4-2.1 1.2-25-14.4zM335.6 238.7l25 14.4-2.1 1.2-24.9-14.4zM333.6 241.4l24.9 14.4-2.1 1.2-24.9-14.4zM331.5 244.2l24.9 14.4-2 1.2-25-14.4zM329.4 246.9l25 14.4-2.1 1.2-25-14.4zM327.3 249.7l25 14.4-2.1 1.2-24.9-14.4z\"/><path class=\"sr\" d=\"M337.7 234.4l25 14.4v1.5l-25-14.4zM335.6 237.1l25 14.4v1.6l-25-14.4zM333.6 239.9l24.9 14.4v1.5l-24.9-14.4zM331.5 242.6l24.9 14.4v1.6l-24.9-14.4zM329.4 245.4l25 14.4v1.5l-25-14.4zM327.3 248.1l25 14.4v1.6l-25-14.4zM325.3 250.9l24.9 14.4v1.5l-24.9-14.4z\"/><path class=\"ss\" d=\"M364.7 258.4v-10.8l-2 1.2v1.5l-2.1 1.2v1.6l-2.1 1.2v1.5l-2.1 1.2v1.6l-2 1.2v1.5l-2.1 1.2v1.6l-2.1 1.2v1.5z\"/><path class=\"pt\" d=\"M365.5 245.3l33.2 19.2-.7.4-33.3-19.2z\"/><path class=\"ll\" d=\"M364.7 245.7l33.3 19.2v1.9l-33.3-19.2z\"/><path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\" transform=\"matrix(1.04.6 0-1.2 364.7 247.6)\"/><path class=\"ht\" d=\"M265 193.8l22.8 13.2-14.5 8.4-22.9-13.2z\"/><path class=\"hl\" d=\"M250.4 202.2l22.9 13.2v23.8l-22.9-13.2z\"/><g transform=\"matrix(1.04.6 0-1.2 250.4 215.2)\"><path class=\"so\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 1.7\" d=\"M2.3-5.1h17.3M2.3.9h17.3M2.3 6.7h17.3\"/><path class=\"sg\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 11.2\" d=\"M5.5-5.1h14.2M11.8.9h1.5M5.5 6.7h14.2\"/></g><path class=\"hs\" d=\"M273.3 215.4l14.5-8.4v23.8l-14.5 8.4z\"/><g transform=\"matrix(1.04-.6 0-1.2 273.3 228.4)\"><path class=\"wg\" d=\"M2.2-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9zM5.9-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9zM9.6-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9z\"/><path class=\"sd\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 2.2\" d=\"M2.6 1.7h8.8M2.6 6.7h8.8\"/></g><path class=\"esh\" d=\"M250.4 203.3l22.9 13.2v1.9l-22.9-13.2zM273.3 216.5l14.5-8.4v1.9l-14.5 8.4z\"/><path class=\"rm\" d=\"M247.5 202.2l25.8 14.9v1.1l-25.8-14.9z\"/><path class=\"rs\" d=\"M273.3 217.1l17.5-10.1v1.1l-17.5 10.1z\"/><path class=\"rm\" d=\"M265 192.2l25.8 14.8-17.5-6-8.3-4.8z\"/><path class=\"rl\" d=\"M265 192.2v4l-17.5 6zM247.5 202.2l17.5-6 8.3 4.8v16.1z\"/><path class=\"rs\" d=\"M290.8 207l-17.5 10.1v-16.1z\"/><path class=\"rg\" d=\"M247.5 202.2L265 196.2L273.3 201L273.3 217.1\"/><path class=\"pt\" d=\"M387.6 266.8l31.2 18-27 15.6-31.2-18z\"/><rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"20\" transform=\"matrix(1.04.6-1.04.6 387.6 266.8)\"/><path class=\"ie\" d=\"M360.6 282.4l31.2 18v10.8l-31.2-18z\"/><path class=\"is\" d=\"M391.8 300.4l27-15.6v10.8l-27 15.6z\"/><path class=\"ht\" d=\"M387.6 251.8l18.7 10.8-12.5 7.2-18.7-10.8z\"/><path class=\"hl\" d=\"M375.1 259l18.7 10.8v24.6l-18.7-10.8z\"/><g transform=\"matrix(1.04.6 0-1.2 375.1 272.8)\"><path class=\"so\" stroke-width=\"3.6\" stroke-dasharray=\"1.5 1.5\" d=\"M2.3-5h13.5M2.3 1.2h13.5M2.3 7h13.5\"/><path class=\"sg\" stroke-width=\"3.6\" stroke-dasharray=\"1.5 7.5\" d=\"M5.3-5h10.5M2.3 1.2h10.5M8.3 7h1.5\"/></g><path class=\"hs\" d=\"M393.8 269.8l12.5-7.2v24.6l-12.5 7.2z\"/><g transform=\"matrix(1.04-.6 0-1.2 393.8 283.6)\"><path class=\"sg\" stroke-width=\"6.8\" stroke-dasharray=\"1.8 1.2\" d=\"M2.1 1.9h7.8\"/><rect class=\"rail\" x=\"1\" y=\"-1.5\" width=\"10\" height=\".4\"/><path class=\"sd\" stroke-width=\"3\" stroke-dasharray=\"1.5 1.5\" d=\"M2.3-5.3h7.5M2.3 8.1h7.5\"/></g><path class=\"esh\" d=\"M375.1 260.1l18.7 10.8v1.9l-18.7-10.8zM393.8 270.9l12.5-7.2v1.9l-12.5 7.2z\"/><path class=\"rm\" d=\"M372.2 259l21.6 12.5v1.1l-21.6-12.5z\"/><path class=\"rs\" d=\"M393.8 271.5l15.4-8.9v1.1l-15.4 8.9z\"/><path class=\"rm\" d=\"M387.6 250.1l21.6 12.5-15.4-5.3-6.2-3.6z\"/><path class=\"rl\" d=\"M387.6 250.1v3.6l-15.4 5.3zM372.2 259l15.4-5.3 6.2 3.6v14.2z\"/><path class=\"rs\" d=\"M409.2 262.6l-15.4 8.9v-14.2z\"/><path class=\"rg\" d=\"M372.2 259L387.6 253.7L393.8 257.3L393.8 271.5\"/><path class=\"ht\" d=\"M435.4 247.7l20.8 12-20.8 12-20.8-12z\"/><path class=\"hl\" d=\"M414.6 259.7l20.8 12v15.5l-20.8-12z\"/><g transform=\"matrix(1.04.6 0-1.2 414.6 264.4)\"><path class=\"wg\" d=\"M3.8-8v5.9a1.5 1.5 0 0 0 3 0v-5.9zM8.5-8v5.9a1.5 1.5 0 0 0 3 0v-5.9zM13.2-8v5.9a1.5 1.5 0 0 0 3 0v-5.9z\"/><path class=\"so\" stroke-width=\"1.6\" stroke-dasharray=\"1.4 1.6\" d=\"M1.8 1.8h16.4\"/></g><path class=\"hs\" d=\"M435.4 271.7l20.8-12v15.5l-20.8 12z\"/><g transform=\"matrix(1.04-.6 0-1.2 435.4 276.4)\"><path class=\"sd\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 1.9\" d=\"M2.5-5.3h15.1M2.5-.1h15.1\"/><path class=\"sg\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 8.7\" d=\"M5.9-5.3h11.7M2.5-.1h11.7\"/></g><path class=\"esh\" d=\"M414.6 260.8l20.8 12v1.9l-20.8-12zM435.4 272.8l20.8-12v1.9l-20.8 12z\"/><path class=\"rm\" d=\"M411.7 259.7l23.7 13.7v1.1l-23.7-13.7z\"/><path class=\"rs\" d=\"M435.4 273.4l23.7-13.7v1.1l-23.7 13.7z\"/><path class=\"rm\" d=\"M435.4 246l23.7 13.7-23.7-8.2v0z\"/><path class=\"rl\" d=\"M435.4 246v5.5l-23.7 8.2zM411.7 259.7l23.7-8.2v0 21.9z\"/><path class=\"rs\" d=\"M459.1 259.7l-23.7 13.7v-21.9z\"/><path class=\"rg\" d=\"M411.7 259.7L435.4 251.5L435.4 251.5L435.4 273.4\"/><path class=\"st\" d=\"M297.2 262.6l35.3 20.4-1 .6-35.3-20.4zM296.2 264.4l35.3 20.4-1 .6-35.4-20.4zM295.1 266.2l35.4 20.4-1.1.6-35.3-20.4zM294.1 268l35.3 20.4-1 .6-35.4-20.4z\"/><path class=\"sr\" d=\"M296.2 263.2l35.3 20.4v1.2l-35.3-20.4zM295.1 265l35.4 20.4v1.2l-35.4-20.4zM294.1 266.8l35.3 20.4v1.2l-35.3-20.4zM293 268.6l35.4 20.4v1.2l-35.4-20.4z\"/><path class=\"ss\" d=\"M332.5 287.8v-4.8l-1 .6v1.2l-1 .6v1.2l-1.1.6v1.2l-1 .6v1.2z\"/><path class=\"pt\" d=\"M293 269.8l35.4 20.4-18.7 10.8-35.4-20.4z\"/><path class=\"ie\" d=\"M274.3 280.6l35.4 20.4v6l-35.4-20.4z\"/><path class=\"is\" d=\"M309.7 301l18.7-10.8v6l-18.7 10.8z\"/><g class=\"route\" stroke-width=\"2.2\"><path class=\"w0\" d=\"M309.2 280.1h0M316.5 271.1h0M326.5 265.3h0M338.8 256.7h0M345 248.5h0M351.2 240.2h0\"/><path class=\"w1\" d=\"M311.2 277.7h0M319.8 269.2h0M329.8 263.4h0M340.8 253.9h0M347.1 245.7h0\"/><path class=\"w2\" d=\"M313.3 274.1h0M323.2 267.2h0M337.1 259.2h0M342.9 251.2h0M349.2 243h0\"/></g><path class=\"ll\" d=\"M291.9 282.8V285.4A9.4 5.4 0 0 0 310.8 285.4V282.8z\"/><ellipse class=\"lt\" cx=\"301.4\" cy=\"282.8\" rx=\"9.4\" ry=\"5.4\"/><ellipse class=\"water\" cx=\"301.4\" cy=\"282.8\" rx=\"7.4\" ry=\"4.2\"/><path class=\"bronze\" d=\"M297 283.4l1 -2h6.8l1 2zM300.6 281.4v-4.6l-2.3 -2.1 2.6 1 .5 -1.2 .5 1.2 2.6 -1 -2.3 2.1v4.6z\"/><path class=\"glint\" d=\"M305.8 280.4l.7 1.8 1.8 .7 -1.8 .7 -.7 1.8 -.7 -1.8 -1.8 -.7 1.8 -.7z\"/><ellipse class=\"shade\" cx=\"335\" cy=\"261.7\" rx=\"3.4\" ry=\"1.2\"/><path class=\"fig\" d=\"M332.3 261.7v-6.6a1.8 1.8 0 0 1 3.6 0V261.7z\"/><circle class=\"fig\" cx=\"334.7\" cy=\"252.2\" r=\"1.8\"/><rect class=\"pack\" x=\"331.6\" y=\"254.2\" width=\"3.1\" height=\"4.2\" rx=\".9\"/>"
  };
  const ART_BOX = { halo: [317, -1, 162, 114], city: [533, 136, 57, 97], west: [191, 117, 53, 84], main: [237, 18, 243, 301] };
  // The drawing (680 x 340 isometric scene).
  function cityArt() {
    // Inline vector art: no image download, no extra WebGL scene. Each island is
    // its own small <svg>, cut to its box, so floating it is a compositor move,
    // not a repaint.
    const vars = Object.entries(ART).map(([k,v]) => '--'+k+':'+v).join(';');
    const halo = (offset, alpha) => `<stop offset="${offset}" stop-color="${ART.halo}" stop-opacity="${alpha}"/>`;
    const pct = v => +v.toFixed(3)+'%';
    const at = ([x,y,w,ht]) => ` style="left:${pct(x/6.8)};top:${pct(y/3.4)};width:${pct(w/6.8)};height:${pct(ht/3.4)}"`;
    // each layer floats by its island's FLOAT; the halo rides with the main island
    const bob = Object.entries(ART_BOX).map(([k,[,,,ht]]) => { const f=FLOAT[k==='halo'?'main':k];
      return `@keyframes mvh-bob-${k}{to{transform:translateY(${(-f.lift/ht*100).toFixed(2)}%)}}`+
        `.mvh-${k}{animation:mvh-bob-${k} ${f.rise}s ease-in-out ${f.delay}s infinite alternate${k==='halo'?',mvh-breathe var(--halo-breath) ease-in-out infinite':''}}`; }).join('');
    const svg = (k, body, box, extra='', place=true) => `<svg xmlns="http://www.w3.org/2000/svg" class="mvh mvh-${k}" viewBox="${box.join(' ')}"${place?at(box):''} aria-hidden="true">${extra}${body}</svg>`;
    return `<div class="mvh-stack" role="img" aria-label="${h('story.art_aria')}">`+
      svg('sky', ART_LAYERS.sky, [0,0,680,340], `<style>.mvh{${vars}}${ART_CSS}${bob}</style>`, false)+
      svg('halo', ART_LAYERS.halo, ART_BOX.halo, `<defs><radialGradient id="mvh-halo">${halo('0',ART['halo-alpha'])}${halo('.45',ART['halo-mid-alpha'])}${halo('1','0')}</radialGradient></defs>`)+
      svg('city', ART_LAYERS.city, ART_BOX.city)+
      `<div class="mvh-west"${at(ART_BOX.west)}>${svg('westart', ART_LAYERS.west, ART_BOX.west, '', false)}</div>`+
      svg('main', ART_LAYERS.main, ART_BOX.main)+'</div>';
  }
  // ---- The West Campus islet's quarter turns. A worker draws it on an
  // OffscreenCanvas, so the city's loading work cannot stall it. No
  // OffscreenCanvas, TURN.on false, reduced motion, or a class schedule saved
  // on the device (see startTurn): the still SVG islet stays.
  // The drawing's projection: screen units per metre, and where the Tower stands.
  const ART_PROJ = { u: 1.2, X0: 398, Y0: 214 };
  // The islet in drawing metres (i east, j south, z up), as the drawing builds it.
  function turnModel() {
    const wi = -150, wj = 26, wz = -6, top = wz + 19;
    const B = (i0, i1, j0, j1, z0, z1, c, extra) => Object.assign({ i0, i1, j0, j1, z0, z1, c }, extra);
    const a0 = wi + 3, a1 = wi + 15, b0 = wj + 3, b1 = wj + 13;
    const under = [2, 1].map(k => B(wi + 3.5 * k, wi + 24 - 3.5 * k, wj + 3.5 * k, wj + 20 - 3.5 * k, wz - 10 - 5.25 * k, wz - 10 - 5.25 * (k - 1), [null, 'ie', 'is'], { a: k === 1 ? 0.7 : 0.32 }));
    return {
      centre: [wi + 12, wj + 10],
      under,
      pad: B(wi, wi + 24, wj, wj + 20, wz - 10, wz, ['it', 'ie', 'is']),
      grass: B(wi + 1, wi + 23, wj + 1, wj + 19, wz, wz + 0.6, ['gt', 'gl', 'gs']),
      // windows on all four walls; the door is on the east wall, facing campus
      block: B(a0, a1, b0, b1, wz + 0.6, top, ['ht', 'hl', 'hs'], { win: true, door: 'E' }),
      roof: [B(a0 + 2, a0 + 6, b0 + 2, b0 + 5, top, top + 3, ['ht', 'hl', 'hs']), B(a1 - 4, a1 - 1.5, b1 - 4, b1 - 1.5, top, top + 2, ['ht', 'hl', 'hs'])],
      dots: [[wi + 17.2, wj + 8], [wi + 20, wj + 8], [wi + 22.8, wj + 8]].map(([i, j], k) => [i, j, wz + 0.6, k % 3])
    };
  }
  // The worker's whole program. It runs as its own script, so it may use only
  // what arrives by message.
  function turnWorker() {
    let cv, ctx, M, P, T, box, PAL, freeze = null, t0 = 0, walk0 = 0, sent = false, stepped = false;
    const hex = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
    const mix = (a, b, t) => { const A = hex(a), Bv = hex(b); return 'rgb(' + A.map((v, k) => Math.round(v + (Bv[k] - v) * t)).join(',') + ')'; };
    const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const easeBack = u => { const c = T.back * 1.525; return u < .5 ? (4 * u * u * ((c + 1) * 2 * u - c)) / 2 : ((2 * u - 2) ** 2 * ((c + 1) * (2 * u - 2) + c) + 2) / 2; };
    // the angle over one full cycle: a long rest at home, then four quarter turns with short rests between
    function angle(s) {
      const cyc = T.holdHome + 4 * T.time + 3 * T.hold;
      let t = ((s % cyc) + cyc) % cyc;
      if (t < T.holdHome) return 0;
      t -= T.holdHome;
      for (let q = 0; q < 4; q++) {
        if (t < T.time) return (q + easeBack(t / T.time)) * 90;
        t -= T.time;
        if (q < 3) { if (t < T.hold) return (q + 1) * 90; t -= T.hold; }
      }
      return 0;
    }
    function draw(deg, time) { // time: seconds since the drawing appeared
      const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), [ci, cj] = M.centre;
      const U = P.u, CW = U * Math.cos(Math.PI / 6), CH = U / 2;
      const R = (i, j) => { const di = i - ci, dj = j - cj; return [ci + di * ca - dj * sa, cj + di * sa + dj * ca]; };
      const Pj = (i, j, z) => [P.X0 + (i - j) * CW, P.Y0 + (i + j) * CH - z * U];
      const poly = (pts, fill, alpha = 1) => { ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); };
      // one wall's windows and door in the wall's own frame: x metres from its screen-left end, y = height
      function details(b, A, Bp, w, side, t) {
        const o = Pj(A[0], A[1], 0), e = [(Pj(Bp[0], Bp[1], 0)[0] - o[0]) / w, (Pj(Bp[0], Bp[1], 0)[1] - o[1]) / w];
        const rect = (x, y, rw, rh, fill) => poly([[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]].map(([px, py]) => [o[0] + px * e[0], o[1] + px * e[1] - py * U]), fill);
        const dark = mix(PAL.openingDeep, PAL.opening, t);
        const count = Math.round(w / 2.4), p = (w - 2.4) / count, s = 1.2 + (p - 1.2) / 2;
        for (let r = 0; r < 5; r++) {
          const y = b.z0 + 3 + r * 3.1, k0 = (r * 2 + 1) % 3;
          for (let c = 0; c < count; c++) rect(s + c * p, y, 1.2, 1.7, c >= k0 && (c - k0) % 3 === 0 ? PAL.glow : dark);
        }
        if (b.door === side) rect(w / 2 - 1.1, b.z0, 2.2, 2.8, PAL.door);
      }
      function drawBox(b, alpha = 1) {
        const [ct, cl, cs] = b.c;
        const c = [[b.i0, b.j0], [b.i1, b.j0], [b.i1, b.j1], [b.i0, b.j1]].map(([i, j]) => R(i, j));
        if (ct) poly(c.map(([i, j]) => Pj(i, j, b.z1)), PAL[ct], alpha);
        // walls: north, east, south, west, each with its outward normal before the turn
        [[0, 1, [0, -1], 'N'], [1, 2, [1, 0], 'E'], [2, 3, [0, 1], 'S'], [3, 0, [-1, 0], 'W']].forEach(([p, q, [ni, nj], side]) => {
          const vi = ni * ca - nj * sa, vj = ni * sa + nj * ca;
          if (vi + vj < 0.02) return; // facing away, or edge-on
          const t = clamp(vj); // south-facing walls are the lit ones, east-facing the shaded ones
          let A = c[p], Bp = c[q];
          if (Pj(A[0], A[1], 0)[0] > Pj(Bp[0], Bp[1], 0)[0]) [A, Bp] = [Bp, A];
          poly([Pj(A[0], A[1], b.z1), Pj(Bp[0], Bp[1], b.z1), Pj(Bp[0], Bp[1], b.z0), Pj(A[0], A[1], b.z0)], mix(PAL[cs], PAL[cl], t), alpha);
          if (b.win) details(b, A, Bp, side === 'N' || side === 'S' ? b.i1 - b.i0 : b.j1 - b.j0, side, t);
        });
      }
      // is a ground point hidden behind the block? cast it toward the viewer, in the block's own frame
      function behind(i, j, b) {
        const di = i - ci, dj = j - cj, li = ci + di * ca + dj * sa, lj = cj - di * sa + dj * ca;
        const vi = ca + sa, vj = -sa + ca; // the view direction (1, 1), turned back by the same angle
        let ta0 = 1e-6, ta1 = 1e9;
        for (const [p, v, lo, hi] of [[li, vi, b.i0, b.i1], [lj, vj, b.j0, b.j1]]) {
          if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return false; continue; }
          let ta = (lo - p) / v, tb = (hi - p) / v; if (ta > tb) [ta, tb] = [tb, ta];
          ta0 = Math.max(ta0, ta); ta1 = Math.min(ta1, tb);
        }
        return ta0 <= ta1;
      }
      const walk = k => { // the path's shimmer, in step with the CSS one on the main island
        const per = PAL.routeWalk, off = [0, per / 1.5, per / 3][k];
        const ph = (((walk0 + time + off) % per) + per) % per / per, u = ph < .5 ? ph * 2 : (ph - .5) * 2, e = u * u * (3 - 2 * u);
        return ph < .5 ? 1 - .55 * e : .45 + .55 * e;
      };
      const dot = ([i, j, z, k]) => { const [ri, rj] = R(i, j), [x, y] = Pj(ri, rj, z); ctx.globalAlpha = walk(k); ctx.fillStyle = PAL.accent; ctx.beginPath(); ctx.arc(x, y - 2.2 * 0.35, 1.1, 0, 7); ctx.fill(); };

      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      const kx = cv.width / box[2], ky = cv.height / box[3]; ctx.setTransform(kx, 0, 0, ky, -box[0] * kx, -box[1] * ky);
      M.under.forEach(b => drawBox(b, b.a));
      drawBox(M.pad); drawBox(M.grass);
      const back = M.dots.filter(d => behind(d[0], d[1], M.block)), front = M.dots.filter(d => !back.includes(d));
      back.forEach(dot);
      drawBox(M.block);
      M.roof.map(b => { const [i, j] = R((b.i0 + b.i1) / 2, (b.j0 + b.j1) / 2); return [i + j, b]; }).sort((x, y) => x[0] - y[0]).forEach(([, b]) => drawBox(b));
      front.forEach(dot);
      ctx.globalAlpha = 1;
    }
    function frame() {
      if (stepped) return;
      const time = performance.now() / 1000 - t0;
      draw(freeze !== null ? freeze : angle(time), time);
      if (!sent) { sent = true; postMessage('drawn'); }
      if (freeze === null) (self.requestAnimationFrame || (f => setTimeout(f, 16)))(frame);
    }
    onmessage = ({ data }) => {
      if (data.canvas) {
        ({ canvas: cv, model: M, proj: P, turn: T, box, pal: PAL } = data);
        freeze = data.freeze ?? null; walk0 = data.walk0 || 0; t0 = performance.now() / 1000;
        cv.width = data.w; cv.height = data.h; ctx = cv.getContext('2d');
        frame();
      } else if (data.at != null) { stepped = true; draw(angle(data.at), data.at - walk0); postMessage('at'); } // posed frame by frame, for films
      else if (data.w) { cv.width = data.w; cv.height = data.h; if (freeze !== null) draw(freeze, 0); }
    };
  }
  // Start the turn on a freshly built drawing. The handle goes on the stack as
  // .turn for checks: { freeze: deg } draws one still angle, .turn.at(t) poses
  // the islet as it is t seconds in.
  function startTurn(stack, opt = {}) {
    const wrap = stack && stack.querySelector('.mvh-west');
    if (!wrap || !TURN.on || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return null;
    if (opt.freeze == null && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    // The schedule privacy guard (js/wayfind.js) refuses any worker message it
    // cannot read while a class schedule is saved, and a canvas is one. Ask it
    // first instead of tripping it: with a schedule saved, the islet stays still.
    const guard = window.WAYFIND && WAYFIND.store && WAYFIND.store.guard;
    if (guard && guard.state && guard.state().watched) return null;
    const vb = wrap.querySelector('svg').viewBox.baseVal, box = [vb.x, vb.y, vb.width, vb.height];
    const cv = document.createElement('canvas');
    cv.className = 'mvh-turn';
    wrap.append(cv);
    const size = () => { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; return { w: Math.max(1, Math.round(r.width * d)), h: Math.max(1, Math.round(r.height * d)) }; };
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([`(${turnWorker})()`], { type: 'text/javascript' }))); }
    catch (e) { cv.remove(); return null; } // a blocked worker leaves the still islet
    const off = cv.transferControlToOffscreen();
    const pal = { it: ART['island-top'], ie: ART['island-edge'], is: ART['island-side'], gt: ART['lawn-top'], gl: ART['lawn-lit'], gs: ART['lawn-shade'],
      ht: ART['hall-top'], hl: ART['hall-lit'], hs: ART['hall-shade'], opening: ART.opening, openingDeep: ART['opening-deep'],
      glow: ART.glow, door: ART.door, accent: ART.accent, routeWalk: parseFloat(ART['route-walk']) };
    const path = stack.querySelector('.mvh-main .route .w0');
    const walk0 = path && path.getAnimations ? ((path.getAnimations()[0] || {}).currentTime || 0) / 1000 : 0;
    // if the message is refused anyway, the still islet stays and the rest of
    // the loading screen still builds
    try { w.postMessage({ canvas: off, model: turnModel(), proj: ART_PROJ, turn: TURN, box, pal, freeze: opt.freeze, walk0, ...size() }, [off]); }
    catch (e) { w.terminate(); cv.remove(); return null; }
    let atDone = null;
    w.onmessage = e => { if (e.data === 'at') { if (atDone) atDone(); return; } wrap.classList.add('turning'); };
    const ro = new ResizeObserver(() => w.postMessage(size())); ro.observe(cv);
    // the veil is removed after the reveal: stop the worker with it
    const alive = setInterval(() => { if (!cv.isConnected) { w.terminate(); ro.disconnect(); clearInterval(alive); } }, 1000);
    return (stack.turn = { worker: w, canvas: cv, box, at: t => new Promise(r => { atDone = r; w.postMessage({ at: t }); }) });
  }
  function openModes(event) { opener=event.currentTarget; dialog.showModal(); }
  function build() {
    const veil=document.getElementById('veil'); if(!veil)return;
    veil.replaceChildren();veil.classList.add('loading-v2');veil.removeAttribute('aria-hidden');
    root=document.createElement('section');root.id='load-city';
    root.innerHTML=`<div class="load-story"><p class="load-eyebrow">${h('story.eyebrow')}</p><h1>${h('story.headline')}</h1><p class="load-subtitle">${h('story.subtitle')}</p>${cityArt()}<p class="load-caption">${h('story.caption')}</p></div><div class="load-card"><div class="load-heading"><h2>${h('card.title')}</h2><span id="load-percent">0%</span></div><div class="load-rail" role="progressbar" aria-label="${h('card.progress_aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p id="load-estimate"></p><div id="load-stages"></div><div class="load-choice"><h3>${h('choice.title')}</h3><p>${h('choice.body')}</p><button type="button" id="load-modes">${h('choice.button')}</button><small>${h('choice.fine')}</small></div></div><footer>${h('story.footer')}</footer>`;
    veil.append(root);
    startTurn(root.querySelector('.mvh-stack'));
    const button=document.createElement('button');button.id='mode-launcher';button.textContent=t('pill.ready');button.hidden=true;button.type='button';button.addEventListener('click',openModes);document.body.append(button);
    dialog=document.createElement('dialog');dialog.id='mode-dialog';dialog.setAttribute('aria-label',t('dialog.aria'));
    const option=(value,key)=>`<option value="${value}">${h(key)}</option>`;
    dialog.innerHTML=`<form method="dialog"><div class="mode-header"><h2>${h('dialog.title')}</h2><button aria-label="${h('dialog.close_aria')}" value="close">${h('dialog.close_glyph')}</button></div><p class="mode-intro">${h('dialog.intro')}</p><div class="mode-grid"></div><div class="mode-settings"><label>${h('settings.lighting.label')}<select id="mode-time">${option('','settings.lighting.keep')}${option('0','settings.lighting.day')}${option('0.5','settings.lighting.golden')}${option('1','settings.lighting.night')}</select></label><label>${h('settings.graphics.label')}<select id="mode-graphics">${option('','settings.graphics.keep')}${option('performance','settings.graphics.performance')}${option('balanced','settings.graphics.balanced')}${option('cinematic','settings.graphics.cinematic')}${option('ultra','settings.graphics.ultra')}</select></label></div><button class="mode-go" type="button">${h('dialog.go')}</button></form>`;
    const q=new URLSearchParams(location.search);
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
