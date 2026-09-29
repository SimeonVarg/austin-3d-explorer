/* Loading work is measured, never animated toward an invented percentage.
 * The drawing moves on its own: each island floats (a CSS transform, so the
 * compositor keeps it smooth while the city loads on the main thread) and the
 * West Campus islet turns a quarter at a time, drawn in a worker. A tap turns
 * the main island over (see ISLAND), drawn with WebGL in another worker. The
 * small pulses (halo, stars, fountain glint, path) are CSS opacity. All of it
 * stops under prefers-reduced-motion. */
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
    // new 2026-09-28 with the island flip, waiting for the owner's look
    'story.flip_aria': "Flip the island over",
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
    // the flip side: the rock under the island (lit face, shade face, the lit lip
    // of each ledge), then the apartments (light concrete, brick, flat roofs,
    // balcony slab edges)
    'rock-lit': '#34474f', 'rock-shade': '#1f2e36', 'rock-band': '#4a6068',
    'apt-lit': '#b3a58c', 'apt-shade': '#4a4d58', 'apt-roof': '#6f6b66', 'apt-band': '#2c2f38',
    'brick-lit': '#9a5640', 'brick-shade': '#4d2e2a',
    // animation timings
    'halo-breath': '3.6s', 'glint-blink': '2.8s', 'star-twinkle': '5.5s', 'route-walk': '3.6s'
  };
  // How each island floats: lift in drawing units (the drawing is 680 wide),
  // seconds for one rise, and a start offset so no two move in step.
  const FLOAT = {
    main: { lift: 6, rise: 3.4, delay: 0 },      // the big island: heaviest, slowest
    west: { lift: 4, rise: 2.5, delay: -1.1 },   // West Campus islet
    city: { lift: 7, rise: 2.9, delay: -2.2 }    // downtown islet
  };
  // The West Campus islet's quarter turns, in seconds: one turn, the rest
  // between turns, the longer rest at home, and the overshoot (0 = none).
  // on: false keeps the islet still (it still floats).
  const TURN = { on: true, time: 1.25, hold: 1.7, holdHome: 3.8, back: 0.55 };
  // The main island turns over when it is tapped or clicked (the owner asked for
  // it to answer a tap, not to turn on a timer). It rolls over on a slanted axis
  // with a half spin, solid, its sides showing as it goes. The Tower's floors
  // slide into each other and become the rock ledges; the ledges it stood on push
  // up and split into West Campus apartment towers, whose windows light floor by
  // floor; every block changes colour as it passes the middle. Tap again to turn
  // it back; a tap mid-turn turns it round from where it is. A worker draws the
  // turn with WebGL on its own canvas, so once it has started a busy page cannot
  // make it stutter (the tap itself waits for the page). At rest on the Tower
  // side the page shows the still drawing, exactly as before.
  // Times are shares of one turn (0 = Tower up, 1 = apartments up); lengths are
  // drawing metres (i east, j south, z up).
  const ISLAND = {
    on: true,             // false = no turn: the still drawing and no tap target
    time: 2.6,            // seconds for one whole turn
    pivot: [-4, 35, -9],  // the point it turns round
    roll: { dir: 1, from: 0, to: 0.85 },   // rolling over its long axis (dir -1 = the other way round)
    spin: { dir: 1, from: 0.1, to: 1 },    // the half spin round the upright
    lift: 8,              // how far it rises at mid-turn
    shrink: 0.1,          // how much smaller it looks at mid-turn (0 = not at all)
    floors: { from: 0.1, stagger: 0.25, span: 0.4 },               // Tower floors into ledges, the top floor first
    towers: { from: 0.4, stagger: 0.2, blocks: 0.1, span: 0.35 },  // ledges into towers, from the pad out, block after block
    pads: [0.15, 0.85],   // the pads moving to their place on the other side
    retract: [0.3, 0.7],  // ledges with nothing to become fold into their pad
    swap: 0.05,           // how quickly a block changes colour as it passes the middle
    out: [0, 0.35, 0.2],  // the Tower side's windows fading into the stone: start, end, delay for the lowest row
    lights: [0.4, 0.75, 0.25], // the apartments' windows lighting: start, end, delay for the top floor
    prim: [0, 0.3],       // roofs, mast, fountain and figure settling into what they stand on
    trees: [0.7, 1],      // the apartment side's trees growing
    halo: [0, 0.35],      // the Tower's halo fading out
    faces: [0.02, 0.15],  // faces the still drawing leaves out (the ledges' tops) coming in
    fade: 0.25,           // reduced motion: a crossfade of this many seconds instead of the turn
    // how it is drawn, not how it looks: the hand-over from the drawing's paint order
    // to real depth, the depth range and offsets, frames averaged a fraction of a pixel apart for
    // the drawing's smooth edges (1 = none), MSAA
    painter: 0.06, s0: 50, depth: 500, bias: 0.04, spriteLift: 1.5, aa: 4, msaa: true
  };
  // slowAfter*: seconds after which the time line switches from estimate.usual
  // to estimate.slow (phones load slower).
  // The seconds on the time line count on the compositor, like the floating
  // islands, so a busy page cannot stall them. Measured 2026-09-28 on a cold
  // desktop load: the main thread was blocked for 20-27 s of a 30-36 s load,
  // once for 4.9 s straight, and the old text only changed when it was free,
  // so the count jumped 4-5 s at a time. Two digit wheels (tens, ones) step
  // with a transform animation started at the loader's own start time. Past
  // `max` seconds, or without Web Animations on pseudo-elements, the plain
  // number shows instead. on: false = the old text.
  const CLOCK = { on: true, max: 99 };
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
  let graph = 'optional', sceneReady = false, revealed = false, timer, root, dialog, opener, clock = null;
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
  // #load-estimate holds [pre][wheels][number][post]; its textContent is still
  // exactly the copy line ("12s in. Beats sitting on I-35."), because the
  // wheels draw their digits in ::before and carry no text of their own. The
  // number span is what a screen reader reads; it is only hidden from sight
  // while the wheels are running.
  function setEstimate(line, secs) {
    const p = root.querySelector('#load-estimate'), [pre, post = ''] = line.split('\u0000');
    if (clock && secs > CLOCK.max) { clock.forEach(a => a.cancel()); clock = null; p.classList.remove('odo'); }
    for (const [sel, text] of [['.load-pre', pre], ['.load-num', String(secs)], ['.load-post', post]]) {
      const el = p.querySelector(sel); if (el.textContent !== text) el.textContent = text;
    }
  }
  function startClock() {
    const p = root.querySelector('#load-estimate'), odo = p.querySelector('.load-odo');
    if (!CLOCK.on || typeof odo.animate !== 'function') return;
    const [tens, ones] = odo.children, strip = [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }];
    const run = (el, pseudo, frames, duration, opts) => {
      const a = el.animate(frames, { duration, pseudoElement: pseudo, ...opts });
      a.startTime = state.started;   // the loader's clock, not whenever the page is next free
      return a;
    };
    // Show the wheels BEFORE animating them: an animation aimed at a ::before
    // that does not exist yet (display:none parent) never attaches to it.
    p.classList.add('odo'); void getComputedStyle(ones, '::before').transform;
    try {
      clock = [
        run(ones, '::before', strip, 10000, { iterations: Infinity, easing: 'steps(10, end)' }),
        run(tens, '::before', strip, 100000, { easing: 'steps(10, end)', fill: 'forwards' }),
        // The tens wheel is blank until 10 s; slide the run left over it so
        // "5s" does not start one digit in.
        run(p.querySelector('.load-run'), undefined, [{ transform: 'translateX(-1ch)' }, { transform: 'none' }], 10000, { easing: 'steps(1, end)', fill: 'forwards' })
      ];
      // A browser without pseudo-element animation would move the whole wheel.
      if (clock[0].effect.pseudoElement !== '::before') throw new Error('no pseudo-element animation');
    } catch (e) { clock?.forEach(a => a.cancel()); clock = null; p.classList.remove('odo'); }
  }
  function update() {
    if (!root) return;
    const r = readings();
    const elapsed = (performance.now()-state.started)/1000;
    const slowAfter = matchMedia('(pointer:coarse)').matches ? TUNE.slowAfterPhone : TUNE.slowAfterDesktop;
    const estimate = t(elapsed < slowAfter ? 'estimate.usual' : 'estimate.slow', {elapsed: '\u0000'});
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
    setEstimate(estimate, Math.floor(elapsed));
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
  const ART_CSS = ".mvh .rf{fill:var(--roof-flat)}.mvh .lt{fill:var(--lime-top)}.mvh .ll{fill:var(--lime-lit)}.mvh .ls{fill:var(--lime-shade)}.mvh .ct,.mvh .trim{fill:var(--crown-top)}.mvh .cl{fill:var(--crown-lit)}.mvh .cs{fill:var(--crown-shade)}.mvh .ot{fill:var(--win-top)}.mvh .ol{fill:var(--win-lit)}.mvh .os{fill:var(--win-shade)}.mvh .kt{fill:var(--copper-top)}.mvh .kl{fill:var(--copper-lit)}.mvh .ks{fill:var(--copper-shade)}.mvh .rl{fill:var(--tile-lit)}.mvh .rm{fill:var(--tile-mid)}.mvh .rs{fill:var(--tile-shade)}.mvh .ht{fill:var(--hall-top)}.mvh .hl{fill:var(--hall-lit)}.mvh .hs{fill:var(--hall-shade)}.mvh .ft{fill:var(--far-top)}.mvh .fl{fill:var(--far-lit)}.mvh .fs{fill:var(--far-shade)}.mvh .wo{fill:var(--opening)}.mvh .ao{fill:var(--opening-deep)}.mvh .wg,.mvh .ag{fill:var(--glow)}.mvh .door{fill:var(--door)}.mvh .gl2{fill:var(--glass-lit)}.mvh .gs2{fill:var(--glass-shade)}.mvh .bez{fill:var(--bezel)}.mvh .dial{fill:var(--clock)}.mvh .hand,.mvh .rail,.mvh .bronze{fill:var(--hands)}.mvh .bell{fill:var(--bell)}.mvh .mast{fill:var(--mast)}.mvh .it{fill:var(--island-top)}.mvh .ie{fill:var(--island-edge)}.mvh .is{fill:var(--island-side)}.mvh .pt,.mvh .st{fill:var(--pave-top)}.mvh .sr{fill:var(--riser)}.mvh .ss{fill:var(--riser-shade)}.mvh .gt{fill:var(--lawn-top)}.mvh .gl{fill:var(--lawn-lit)}.mvh .gs{fill:var(--lawn-shade)}.mvh .water{fill:var(--water)}.mvh .glint{fill:var(--glint)}.mvh .fig{fill:var(--figure)}.mvh .pack{fill:var(--pack)}.mvh .shade,.mvh .esh{fill:var(--shadow)}.mvh .so{stroke:var(--opening)}.mvh .sd{stroke:var(--opening-deep)}.mvh .sg{stroke:var(--glow)}.mvh .sbz{stroke:var(--bronze-lit)}.mvh .sbs{stroke:var(--bronze-shade)}.mvh .scn{stroke:var(--crown-shade)}.mvh .sgd{stroke:var(--bezel)}.mvh .rg{stroke:var(--tile-ridge)}.mvh .route{stroke:var(--accent)}.mvh [stroke-dasharray],.mvh .rg,.mvh .route{fill:none}.mvh .rg{stroke-width:.6;stroke-linejoin:round}.mvh .route{stroke-linecap:round}.mvh .moon{fill:var(--moon);opacity:var(--moon-alpha)}.mvh .stars{fill:var(--star);opacity:var(--star-alpha)}.mvh .shade{opacity:.55}.mvh .esh{opacity:var(--eave-alpha)}.mvh .u1{opacity:.7}.mvh .u2{opacity:.32}.mvh .u3{opacity:.14}.mvh .glint{animation:mvh-blink var(--glint-blink) ease-in-out infinite}.mvh .stars circle:nth-child(2n){animation:mvh-blink var(--star-twinkle) ease-in-out infinite}.mvh .route path{animation:mvh-walk var(--route-walk) ease-in-out infinite}.mvh .route .w1{animation-delay:calc(var(--route-walk)/-1.5)}.mvh .route .w2{animation-delay:calc(var(--route-walk)/-3)}@keyframes mvh-breathe{50%{opacity:.72}}@keyframes mvh-blink{50%{opacity:.25}}@keyframes mvh-walk{50%{opacity:.45}}.mvh .ril{fill:var(--rock-lit)}.mvh .ris{fill:var(--rock-shade)}.mvh .rib{fill:var(--rock-band)}.mvh .al{fill:var(--apt-lit)}.mvh .as{fill:var(--apt-shade)}.mvh .ar{fill:var(--apt-roof)}.mvh .ab{fill:var(--apt-band)}.mvh .bl{fill:var(--brick-lit)}.mvh .bs{fill:var(--brick-shade)}.mvh-a{position:absolute;inset:0}.mvh-isl{position:absolute;opacity:0;pointer-events:none}.mvh-glow,.mvh-a,.mvh-isl{will-change:opacity}.mvh-show .mvh-isl{opacity:1!important}.mvh-show .mvh-a{opacity:0!important}.mvh-flip{position:absolute;margin:0;padding:0;border:0;background:none;cursor:pointer;border-radius:14px;-webkit-tap-highlight-color:transparent}.mvh-flip:focus-visible{outline:2px solid var(--load-accent);outline-offset:2px}.mvh-stack{position:relative;margin-top:4px}.mvh-stack>div{position:absolute;inset:0}.mvh-stack svg.mvh{position:absolute;inset:0;width:100%;height:100%;margin:0;display:block}.mvh-turn{position:absolute;inset:0;width:100%;height:100%;visibility:hidden}.mvh-west.turning>svg{visibility:hidden}.mvh-west.turning>.mvh-turn{visibility:visible}@media (prefers-reduced-motion:reduce){.mvh-stack,.mvh-stack *{animation:none!important}}";
  // One layer per island, in paint order, so each can float on its own.
  // ART_BOX is where each moving layer is cut from the drawing: [x, y, w, h].
  const ART_LAYERS = {
    sky: "<circle class=\"moon\" cx=\"128\" cy=\"70\" r=\"38\"/><g class=\"stars\"><circle cx=\"232\" cy=\"30\" r=\"1.2\"/><circle cx=\"560\" cy=\"44\" r=\"1.1\"/><circle cx=\"626\" cy=\"150\" r=\".9\"/><circle cx=\"84\" cy=\"196\" r=\".8\"/></g>",
    halo: "<ellipse class=\"halo\" cx=\"398\" cy=\"55.8\" rx=\"78\" ry=\"53.8\" fill=\"url(#mvh-halo)\"/>",
    city: "<g class=\"u2\"><path class=\"ie\" d=\"M550.8 216.1l12.4 7.2v6.3l-12.4-7.2z\"/><path class=\"is\" d=\"M563.2 223.3l8.4-4.8v6.3l-8.4 4.8z\"/></g><g class=\"u1\"><path class=\"ie\" d=\"M543.5 209.8l19.7 11.4v6.3l-19.7-11.4z\"/><path class=\"is\" d=\"M563.2 221.2l15.6-9v6.3l-15.6 9z\"/></g><path class=\"it\" d=\"M559.1 184.6l27 15.6-22.9 13.2-27-15.6z\"/><path class=\"ie\" d=\"M536.2 197.8l27 15.6v12l-27-15.6z\"/><path class=\"is\" d=\"M563.2 213.4l22.9-13.2v12l-22.9 13.2z\"/><path class=\"ft\" d=\"M559.1 160.6l7.3 4.2-6.3 3.6-7.3-4.2z\"/><path class=\"fl\" d=\"M552.8 164.2l7.3 4.2v26.4l-7.3-4.2z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 4.2\" d=\"M3.1-10.3h.8M1.4-3.5h.8M4.8 3.3h.8\" transform=\"matrix(1.04.6 0-1.2 552.8 173.8)\"/><path class=\"fs\" d=\"M560.1 168.4l6.3-3.6v26.4l-6.3 3.6z\"/><path class=\"ft\" d=\"M572.6 170.8l7.3 4.2-6.3 3.6-7.2-4.2z\"/><path class=\"fl\" d=\"M566.4 174.4l7.2 4.2v22.8l-7.2-4.2z\"/><path class=\"fs\" d=\"M573.6 178.6l6.3-3.6v22.8l-6.3 3.6z\"/><path class=\"ft\" d=\"M560.1 152.8l8.3 4.8-8.3 4.8-8.3-4.8z\"/><path class=\"fl\" d=\"M551.8 157.6l8.3 4.8v38.4l-8.3-4.8z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 5.2\" d=\"M3.6-10.3h.8M1.6-3.5h.8M5.6 3.3h.8M3.6 10.1h.8\" transform=\"matrix(1.04.6 0-1.2 551.8 179.2)\"/><path class=\"fs\" d=\"M560.1 162.4l8.3-4.8v38.4l-8.3 4.8z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 5.2\" d=\"M3.6-10.3h.8M1.6-3.5h.8M5.6 3.3h.8M3.6 10.1h.8\" transform=\"matrix(1.04-.6 0-1.2 560.1 184)\"/><path class=\"ft\" d=\"M560.1 149.8l6.3 3.6-6.3 3.6-6.2-3.6z\"/><path class=\"fl\" d=\"M553.9 153.4l6.2 3.6v4.2l-6.2-3.6z\"/><path class=\"fs\" d=\"M560.1 157l6.3-3.6v4.2l-6.3 3.6z\"/><path class=\"ft\" d=\"M560.1 147l3.8 2.2-3.8 2.2-3.7-2.2z\"/><path class=\"fl\" d=\"M556.4 149.2l3.7 2.2v4.2l-3.7-2.2z\"/><path class=\"fs\" d=\"M560.1 151.4l3.8-2.2v4.2l-3.8 2.2z\"/><rect class=\"mast\" x=\"559.8\" y=\"139.2\" width=\".7\" height=\"10\"/><path class=\"ft\" d=\"M548.7 178.6l8.3 4.8-7.3 4.2-8.3-4.8z\"/><path class=\"fl\" d=\"M541.4 182.8l8.3 4.8v15.6l-8.3-4.8z\"/><path class=\"fs\" d=\"M549.7 187.6l7.3-4.2v15.6l-7.3 4.2z\"/><path class=\"ft\" d=\"M564.3 181.6l8.3 4.8-8.3 4.8-8.3-4.8z\"/><path class=\"fl\" d=\"M556 186.4l8.3 4.8v19.2l-8.3-4.8z\"/><path class=\"sg\" stroke-width=\"1.3\" stroke-dasharray=\".8 5.2\" d=\"M3.6-10.3h.8M1.6-3.5h.8\" transform=\"matrix(1.04.6 0-1.2 556 188.8)\"/><path class=\"fs\" d=\"M564.3 191.2l8.3-4.8v19.2l-8.3 4.8z\"/>",
    west: "<g class=\"u2\"><path class=\"ie\" d=\"M208.9 177.1l10.4 6v6.3l-10.4-6z\"/><path class=\"is\" d=\"M219.3 183.1l6.2-3.6v6.3l-6.2 3.6z\"/></g><g class=\"u1\"><path class=\"ie\" d=\"M201.6 170.8l17.7 10.2v6.3l-17.7-10.2z\"/><path class=\"is\" d=\"M219.3 181l13.5-7.8v6.3l-13.5 7.8z\"/></g><path class=\"it\" d=\"M215.1 146.8l24.9 14.4-20.7 12-25-14.4z\"/><path class=\"ie\" d=\"M194.3 158.8l25 14.4v12l-25-14.4z\"/><path class=\"is\" d=\"M219.3 173.2l20.7-12v12l-20.7 12z\"/><path class=\"gt\" d=\"M215.1 147.3l22.9 13.2-18.7 10.8-22.9-13.2z\"/><path class=\"gl\" d=\"M196.4 158.1l22.9 13.2v.7l-22.9-13.2z\"/><path class=\"gs\" d=\"M219.3 171.3l18.7-10.8v.7l-18.7 10.8z\"/><path class=\"ht\" d=\"M215.1 127.6l12.5 7.2-10.4 6-12.5-7.2z\"/><path class=\"hl\" d=\"M204.7 133.6l12.5 7.2v22.1l-12.5-7.2z\"/><g transform=\"matrix(1.04.6 0-1.2 204.7 149.2)\"><path class=\"so\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 .7\" d=\"M1.6-1.6h8.9M1.6 1.5h8.9M1.6 4.6h8.9M1.6 7.8h8.9M1.6 10.9h8.9\"/><path class=\"sg\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 4.6\" d=\"M3.5-1.6h7M1.6 1.5h7M5.4 4.6h1.2M3.5 7.8h7M1.6 10.9h7\"/></g><path class=\"hs\" d=\"M217.2 140.8l10.4-6v22.1l-10.4 6z\"/><g transform=\"matrix(1.04-.6 0-1.2 217.2 156.4)\"><path class=\"sd\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 .7\" d=\"M1.6-1.6h6.9M1.6 1.5h6.9M1.6 4.6h6.9M1.6 7.8h6.9M1.6 10.9h6.9\"/><path class=\"sg\" stroke-width=\"1.7\" stroke-dasharray=\"1.2 4.5\" d=\"M3.5-1.6h1.2M1.6 1.5h6.9M5.4 4.6h1.2M3.5 7.8h1.2M1.6 10.9h6.9\"/><rect class=\"door\" x=\"3.9\" y=\"-5.4\" width=\"2.2\" height=\"2.8\"/></g><path class=\"ht\" d=\"M215.1 126.4l4.2 2.4-3.2 1.8-4.1-2.4z\"/><path class=\"hl\" d=\"M212 128.2l4.1 2.4v3.6l-4.1-2.4z\"/><path class=\"hs\" d=\"M216.1 130.6l3.2-1.8v3.6l-3.2 1.8z\"/><path class=\"ht\" d=\"M217.2 133.6l2.6 1.5-2.6 1.5-2.6-1.5z\"/><path class=\"hl\" d=\"M214.6 135.1l2.6 1.5v2.4l-2.6-1.5z\"/><path class=\"hs\" d=\"M217.2 136.6l2.6-1.5v2.4l-2.6 1.5z\"/><g class=\"route\" stroke-width=\"2.2\"><path class=\"w0\" d=\"M224.7 160.4h0\"/><path class=\"w1\" d=\"M227.6 162.1h0\"/><path class=\"w2\" d=\"M230.5 163.8h0\"/></g>",
    main: "<path class=\"pt\" d=\"M304.5 180.4l39.5 22.8-52 30-39.5-22.8z\"/><rect class=\"gt\" x=\"3\" y=\"3\" width=\"32\" height=\"44\" transform=\"matrix(1.04.6-1.04.6 304.5 180.4)\"/><path class=\"ie\" d=\"M252.5 210.4l39.5 22.8v10.8l-39.5-22.8z\"/><path class=\"is\" d=\"M292 233.2l52-30v10.8l-52 30z\"/><path class=\"pt\" d=\"M385.5 168.4l91.5 52.8-79 45.6-91.5-52.8z\"/><path class=\"ie\" d=\"M306.5 214l91.5 52.8v21.6l-91.5-52.8z\"/><path class=\"is\" d=\"M398 266.8l79-45.6v21.6l-79 45.6z\"/><path class=\"pt\" d=\"M435.4 256l31.2 18-33.3 19.2-31.1-18z\"/><rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"26\" transform=\"matrix(1.04.6-1.04.6 435.4 256)\"/><path class=\"ie\" d=\"M402.2 275.2l31.1 18v10.8l-31.1-18z\"/><path class=\"is\" d=\"M433.3 293.2l33.3-19.2v10.8l-33.3 19.2z\"/><path class=\"ht\" d=\"M300.3 169l22.9 13.2-27 15.6-22.9-13.2z\"/><path class=\"hl\" d=\"M273.3 184.6l22.9 13.2v21l-22.9-13.2z\"/><g transform=\"matrix(1.04.6 0-1.2 273.3 194.8)\"><path class=\"wo\" d=\"M3.2 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM7.7 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM12.2 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM16.7 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4z\"/><path class=\"so\" stroke-width=\"3.6\" stroke-dasharray=\"1.8 2.7\" d=\"M3.4-4.7h15.3\"/></g><path class=\"hs\" d=\"M296.2 197.8l27-15.6v21l-27 15.6z\"/><g transform=\"matrix(1.04-.6 0-1.2 296.2 208)\"><path class=\"wg\" d=\"M2.5-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM5.6-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM8.8-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM11.9-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM15-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM18.2-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM21.3-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"sd\" stroke-width=\"3.8\" stroke-dasharray=\"1.6 1.5\" d=\"M2.8-4.9h20.5\"/><rect class=\"door\" x=\"11.7\" y=\"-9\" width=\"2.6\" height=\"4.8\"/></g><path class=\"esh\" d=\"M273.3 185.7l22.9 13.2v1.9l-22.9-13.2zM296.2 198.9l27-15.6v1.9l-27 15.6z\"/><path class=\"rm\" d=\"M270 184.6l26.2 15.1v1.1l-26.2-15.1z\"/><path class=\"rs\" d=\"M296.2 199.7l30.3-17.5v1.1l-30.3 17.5z\"/><path class=\"rm\" d=\"M300.3 167.1l26.2 15.1-26.2-9.1z\"/><path class=\"rl\" d=\"M300.3 167.1v6l-4.1 2.4-26.2 9.1z\"/><path class=\"rs\" d=\"M326.5 182.2l-30.3 17.5v-24.2l4.1-2.4z\"/><path class=\"rl\" d=\"M270 184.6l26.2-9.1v24.2z\"/><path class=\"rg\" d=\"M270 184.6L296.2 175.5L296.2 199.7M296.2 175.5L300.3 173.1\"/><path class=\"rf\" d=\"M385.5 146.3l20.8 12-45.7 26.4-20.8-12z\"/><path class=\"ll\" d=\"M339.8 172.7l20.8 12v29.3l-20.8-12z\"/><path class=\"ls\" d=\"M360.6 184.7l45.7-26.4v29.3l-45.7 26.4z\"/><path class=\"sd\" stroke-width=\"2.4\" stroke-dasharray=\"1.6 2.4\" d=\"M3.2 21.8h37.6\" transform=\"matrix(1.04-.6 0-1.2 360.6 214)\"/><path class=\"esh\" d=\"M360.6 185.8l45.7-26.4v1.9l-45.7 26.4z\"/><path class=\"rm\" d=\"M337.3 172.7l23.3 13.5v1l-23.3-13.4z\"/><path class=\"rs\" d=\"M360.6 186.2l48.2-27.9v1.1l-48.2 27.8z\"/><path class=\"rm\" d=\"M385.5 144.9l23.3 13.4-23.3-8.1z\"/><path class=\"rl\" d=\"M385.5 144.9v5.3l-24.9 14.4-23.3 8.1z\"/><path class=\"rs\" d=\"M408.8 158.3l-48.2 27.9v-21.6l24.9-14.4z\"/><path class=\"rl\" d=\"M337.3 172.7l23.3-8.1v21.6z\"/><path class=\"rg\" d=\"M337.3 172.7L360.6 164.6L360.6 186.2M360.6 164.6L385.5 150.2\"/><path class=\"rf\" d=\"M402.2 165.8l37.4 21.6-41.6 24-37.4-21.6z\"/><path class=\"ll\" d=\"M360.6 189.8l37.4 21.6v24.2l-37.4-21.6z\"/><path class=\"ls\" d=\"M398 211.4l41.6-24v24.2l-41.6 24z\"/><path class=\"lt\" d=\"M397.1 64.1l23.5 13.6-21.7 12.5-23.5-13.6z\"/><path class=\"ll\" d=\"M375.4 76.6l23.5 13.6v136.8l-23.5-13.5z\"/><g transform=\"matrix(1.04.6 0-1.2 375.4 213.5)\"><path class=\"gl2\" d=\"M5 6h2.5v105.1h-2.5zM10 6h2.5v105.1h-2.5zM15 6h2.5v105.1h-2.5z\"/><path class=\"sbz\" stroke-width=\"2.5\" stroke-dasharray=\"2.1 3.8\" d=\"M6.3 9.7v101.4M11.3 9.7v101.4M16.3 9.7v101.4\"/><path class=\"wg\" d=\"M5.4 60.3h1.8v3h-1.8zM10.4 24.6h1.8v3h-1.8zM10.4 102h1.8v3h-1.8zM15.4 66.2h1.8v3h-1.8z\"/></g><path class=\"ls\" d=\"M398.9 90.2l21.7-12.5v136.8l-21.7 12.5z\"/><g transform=\"matrix(1.04-.6 0-1.2 398.9 227)\"><path class=\"gs2\" d=\"M4.2 6h2.5v105.1h-2.5zM9.2 6h2.5v105.1h-2.5zM14.2 6h2.5v105.1h-2.5z\"/><path class=\"sbs\" stroke-width=\"2.5\" stroke-dasharray=\"2.1 3.8\" d=\"M5.4 9.7v101.4M10.4 9.7v101.4M15.4 9.7v101.4\"/><path class=\"wg\" d=\"M4.5 60.3h1.8v3h-1.8zM9.5 24.6h1.8v3h-1.8zM9.5 102h1.8v3h-1.8zM14.5 66.2h1.8v3h-1.8z\"/></g><path class=\"ct\" d=\"M397.1 57.9l24 13.9-22.2 12.8-24-13.9z\"/><path class=\"cl\" d=\"M374.9 70.7l24 13.9v5.9l-24-13.9z\"/><path class=\"scn\" stroke-width=\"1.1\" stroke-dasharray=\".6 1.4\" d=\"M1.3 114.6h20.5\" transform=\"matrix(1.04.6 0-1.2 374.9 213.5)\"/><path class=\"cs\" d=\"M398.9 84.6l22.2-12.8v5.9l-22.2 12.8z\"/><path class=\"scn\" stroke-width=\"1.1\" stroke-dasharray=\".6 1.3\" d=\"M1.2 114.6h18.9\" transform=\"matrix(1.04-.6 0-1.2 398.9 227.4)\"/><path class=\"ot\" d=\"M397.2 47.4l20.2 11.6-18.6 10.8-20.2-11.7z\"/><path class=\"ol\" d=\"M378.6 58.1l20.2 11.7v12.6l-20.2-11.6z\"/><g transform=\"matrix(1.04.6 0-1.2 378.6 213.6)\"><circle class=\"bez\" cx=\"9.7\" cy=\"124.6\" r=\"4.1\"/><circle class=\"dial\" cx=\"9.7\" cy=\"124.6\" r=\"2.9\"/><path class=\"hand\" d=\"M9.5 124.6h.4v2.2h-.4zM9.7 124.3h1.6v.4h-1.6z\"/></g><path class=\"os\" d=\"M398.8 69.8l18.6-10.8v12.7l-18.6 10.7z\"/><g transform=\"matrix(1.04-.6 0-1.2 398.8 225.2)\"><circle class=\"bez\" cx=\"9\" cy=\"124.6\" r=\"4.1\"/><circle class=\"dial\" cx=\"9\" cy=\"124.6\" r=\"2.9\"/><path class=\"hand\" d=\"M8.7 124.6h.4v2.2h-.4zM9 124.3h1.6v.4h-1.6z\"/></g><path class=\"ot\" d=\"M397.2 45.1l19.7 11.3-.5.3-19.7-11.3zM397.2 45.1l.6.3-18.7 10.7-.5-.3z\"/><path class=\"os\" d=\"M379.1 56.1l18.7-10.7v2.3l-18.7 10.7z\"/><path class=\"bell\" d=\"M386.9 40.9l11.5 6.6v15.9l-11.5-6.6z\"/><g transform=\"matrix(1.04.6 0-1.2 386.9 213.7)\"><path class=\"ol\" d=\"M0 130.8h1.3v13.3h-1.3zM2.3 130.8h.6v13.3h-.6zM3.2 130.8h.6v13.3h-.6zM7.3 130.8h.6v13.3h-.6zM8.1 130.8h.6v13.3h-.6zM9.8 130.8h1.3v13.3h-1.3z\"/><rect class=\"ol\" x=\"0\" y=\"130.8\" width=\"11.1\" height=\".9\"/></g><path class=\"bell\" d=\"M398.4 47.5l10.7-6.1v15.9l-10.7 6.1z\"/><g transform=\"matrix(1.04-.6 0-1.2 398.4 220.4)\"><path class=\"os\" d=\"M0 130.8h1.2v13.3h-1.2zM2.1 130.8h.6v13.3h-.6zM2.9 130.8h.6v13.3h-.6zM6.7 130.8h.6v13.3h-.6zM7.5 130.8h.6v13.3h-.6zM9 130.8h1.2v13.3h-1.2z\"/><rect class=\"os\" x=\"0\" y=\"130.8\" width=\"10.2\" height=\".9\"/></g><path class=\"ot\" d=\"M379.1 55.5l20.2 11.7-.5.3-20.2-11.7z\"/><path class=\"ol\" d=\"M378.6 55.8l20.2 11.7v2.3l-20.2-11.7z\"/><path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1\" d=\"M1.3 130.4h16.8\" transform=\"matrix(1.04.6 0-1.2 378.6 213.6)\"/><path class=\"ot\" d=\"M416.9 56.4l.5.3-18.6 10.8-.6-.3z\"/><path class=\"os\" d=\"M398.8 67.5l18.6-10.8v2.3l-18.6 10.8z\"/><path class=\"sd\" stroke-width=\"1.2\" stroke-dasharray=\".5 .9\" d=\"M1.3 130.4h15.4\" transform=\"matrix(1.04-.6 0-1.2 398.8 225.2)\"/><path class=\"ot\" d=\"M397.5 32.3l12.2 7.1-11.2 6.5-12.2-7.1z\"/><path class=\"ol\" d=\"M386.3 38.8l12.2 7.1v2l-12.2-7z\"/><path class=\"sgd\" stroke-width=\".7\" stroke-dasharray=\".7 1.9\" d=\"M1.6 144.9h8.6\" transform=\"matrix(1.04.6 0-1.2 386.3 213.7)\"/><path class=\"os\" d=\"M398.5 45.9l11.2-6.5v2l-11.2 6.5z\"/><path class=\"sgd\" stroke-width=\".7\" stroke-dasharray=\".7 1.7\" d=\"M1.5 144.9h7.9\" transform=\"matrix(1.04-.6 0-1.2 398.5 220.8)\"/><path class=\"ot\" d=\"M397.6 30.6l10.5 6.1-9.7 5.6-10.5-6.1z\"/><path class=\"ol\" d=\"M387.9 36.2l10.5 6.1v2.7l-10.5-6.1z\"/><path class=\"os\" d=\"M398.4 42.3l9.7-5.6v2.6l-9.7 5.7z\"/><path class=\"ol\" d=\"M389.9 33.8l8.4 4.8v2.5l-8.4-4.8z\"/><path class=\"os\" d=\"M398.3 38.6l7.8-4.5v2.5l-7.8 4.5z\"/><path class=\"kt\" d=\"M397.7 28.9l9 5.2-8.7-3.6zM397.7 28.9l.3 1.6-8.7 3.3z\"/><path class=\"kl\" d=\"M389.3 33.8l8.7-3.3.3 8.5z\"/><path class=\"ks\" d=\"M406.7 34.1l-8.4 4.9-.3-8.5z\"/><rect class=\"mast\" x=\"397.6\" y=\"21.5\" width=\".9\" height=\"9\"/><path class=\"rf\" d=\"M443.7 179.9l20.8 12-45.7 26.4-20.8-12z\"/><path class=\"ll\" d=\"M398 206.3l20.8 12v29.3l-20.8-12z\"/><path class=\"ls\" d=\"M418.8 218.3l45.7-26.4v29.3l-45.7 26.4z\"/><g transform=\"matrix(1.04-.6 0-1.2 418.8 247.6)\"><path class=\"sd\" stroke-width=\"2.8\" stroke-dasharray=\"1.6 2.4\" d=\"M3.2 3.8h37.6M3.2 10.4h37.6M3.2 15.9h37.6M3.2 21h37.6\"/><path class=\"sg\" stroke-width=\"2.8\" stroke-dasharray=\"1.6 10.4\" d=\"M7.2 3.8h25.6M3.2 10.4h37.6M11.2 15.9h25.6M7.2 21h25.6\"/></g><path class=\"esh\" d=\"M418.8 219.4l45.7-26.4v1.9l-45.7 26.4z\"/><path class=\"rm\" d=\"M395.5 206.3l23.3 13.5v1l-23.3-13.4z\"/><path class=\"rs\" d=\"M418.8 219.8l48.2-27.9v1.1l-48.2 27.8z\"/><path class=\"rm\" d=\"M443.7 178.5l23.3 13.4-23.3-8.1z\"/><path class=\"rl\" d=\"M443.7 178.5v5.3l-24.9 14.4-23.3 8.1z\"/><path class=\"rs\" d=\"M467 191.9l-48.2 27.9v-21.6l24.9-14.4z\"/><path class=\"rl\" d=\"M395.5 206.3l23.3-8.1v21.6z\"/><path class=\"rg\" d=\"M395.5 206.3L418.8 198.2L418.8 219.8M418.8 198.2L443.7 183.8\"/><path class=\"rf\" d=\"M339.8 172.7l27 15.6-22.8 13.2-27.1-15.6z\"/><path class=\"ll\" d=\"M316.9 185.9l27.1 15.6v29.3l-27.1-15.6z\"/><g transform=\"matrix(1.04.6 0-1.2 316.9 215.2)\"><path class=\"wo\" d=\"M1.8 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM7.7 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM13.5 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM19.3 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9z\"/><path class=\"wg\" d=\"M1.8 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM7.7 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM13.5 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM19.3 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"wo\" d=\"M2 20.4h1.8v2.2h-1.8zM7.9 20.4h1.8v2.2h-1.8zM13.7 20.4h1.8v2.2h-1.8zM19.5 20.4h1.8v2.2h-1.8z\"/><path class=\"trim\" d=\"M0 17.2h26v.8h-26zM0 20h26v.5h-26z\"/></g><path class=\"esh\" d=\"M316.9 187l27.1 15.6v1.9l-27.1-15.6z\"/><path class=\"rm\" d=\"M314.4 185.9l40.8 23.5v1.1l-40.8-23.5zM339.8 171.3l40.7 23.5-12.6-1.5-28.1-16.2z\"/><path class=\"rl\" d=\"M339.8 171.3v5.8l-25.4 8.8zM314.4 185.9l25.4-8.8 28.1 16.2-12.7 16.1z\"/><path class=\"rg\" d=\"M314.4 185.9L339.8 177.1L363.7 190.9\"/><path class=\"rf\" d=\"M371 183.8l24.9 14.4-30.1 17.4-25-14.4z\"/><path class=\"ll\" d=\"M340.8 201.2l25 14.4v31.4l-25-14.4z\"/><g transform=\"matrix(1.04.6 0-1.2 340.8 232.6)\"><path class=\"ao\" d=\"M1.2 0v5a1.2 1.2 0 0 0 2.4 0v-5zM4.4 0v5a1.2 1.2 0 0 0 2.4 0v-5zM7.6 0v5a1.2 1.2 0 0 0 2.4 0v-5zM10.8 0v5a1.2 1.2 0 0 0 2.4 0v-5zM14 0v5a1.2 1.2 0 0 0 2.4 0v-5zM17.2 0v5a1.2 1.2 0 0 0 2.4 0v-5zM20.4 0v5a1.2 1.2 0 0 0 2.4 0v-5z\"/><path class=\"ag\" d=\"M1.7 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM4.9 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM8 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM11.3 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM14.5 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM17.7 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM20.8 0v4.8a.8.8 0 0 0 1.5 0v-4.7z\"/><path class=\"sg\" stroke-width=\"7.6\" stroke-dasharray=\"1.7 1.5\" d=\"M1.5 12.2h20.9\"/><rect class=\"rail\" x=\".6\" y=\"8.4\" width=\"22.8\" height=\".5\"/><path class=\"so\" stroke-width=\"2.6\" stroke-dasharray=\"1.4 1.8\" d=\"M1.7 22.2h20.6\"/><path class=\"trim\" d=\"M0 17.2h24v.8h-24zM0 20h24v.5h-24z\"/><path class=\"so\" stroke-width=\"1.5\" stroke-dasharray=\".4 1.2\" d=\"M1.2 18.9h21.6\"/></g><path class=\"ls\" d=\"M365.8 215.6l30.1-17.4v31.4l-30.1 17.4z\"/><path class=\"esh\" d=\"M340.8 202.2l25 14.4v2l-25-14.4zM365.8 216.6l30.1-17.4v2l-30.1 17.4z\"/><path class=\"rm\" d=\"M338.3 201.2l27.5 15.8v1.1l-27.5-15.9z\"/><path class=\"rs\" d=\"M365.8 217l32.6-18.8v1l-32.6 18.9z\"/><path class=\"rm\" d=\"M371 182.3l27.4 15.9-27.4-9.6z\"/><path class=\"rl\" d=\"M371 182.3v6.3l-5.2 3-27.5 9.6z\"/><path class=\"rs\" d=\"M398.4 198.2l-32.6 18.8v-25.4l5.2-3z\"/><path class=\"rl\" d=\"M338.3 201.2l27.5-9.6v25.4z\"/><path class=\"rg\" d=\"M338.3 201.2L365.8 191.6L365.8 217M365.8 191.6L371 188.6\"/><path class=\"rf\" d=\"M391.8 202.7l27 15.6-22.9 13.2-27-15.6z\"/><path class=\"ll\" d=\"M368.9 215.9l27 15.6v29.3l-27-15.6z\"/><g transform=\"matrix(1.04.6 0-1.2 368.9 245.2)\"><path class=\"wo\" d=\"M22 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM16.2 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM10.3 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM4.5 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9z\"/><path class=\"wg\" d=\"M22 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM16.2 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM10.3 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM4.5 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"wo\" d=\"M22.2 20.4h1.8v2.2h-1.8zM16.4 20.4h1.8v2.2h-1.8zM10.5 20.4h1.8v2.2h-1.8zM4.7 20.4h1.8v2.2h-1.8z\"/><path class=\"trim\" d=\"M0 17.2h26v.8h-26zM0 20h26v.5h-26z\"/></g><path class=\"ls\" d=\"M395.9 231.5l22.9-13.2v29.3l-22.9 13.2z\"/><path class=\"esh\" d=\"M368.9 217l27 15.6v1.9l-27-15.6zM395.9 232.6l22.9-13.2v1.9l-22.9 13.2z\"/><path class=\"rm\" d=\"M368.9 217.4l27 15.6v1l-27-15.6z\"/><path class=\"rs\" d=\"M395.9 233l25.4-14.7v1.1l-25.4 14.6z\"/><path class=\"rm\" d=\"M394.3 202.7l27 15.6-25.4-8.8-23.9-13.8 19.1 6.7z\"/><path class=\"rl\" d=\"M368.9 217.4l27 15.6v-23.5l-23.9-13.8v17.7z\"/><path class=\"rs\" d=\"M421.3 218.3l-25.4 14.7v-23.5z\"/><path class=\"rg\" d=\"M372 195.7L395.9 209.5L395.9 233\"/><path class=\"pt\" d=\"M307.3 211.7l33.2 19.2-.7.4-33.3-19.2z\"/><path class=\"ll\" d=\"M306.5 212.1l33.3 19.2v1.9l-33.3-19.2z\"/><path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\" transform=\"matrix(1.04.6 0-1.2 306.5 214)\"/><path class=\"pt\" d=\"M277.4 208l106.1 61.2-37.5 21.6-106-61.2z\"/><g transform=\"matrix(1.04.6-1.04.6 277.4 208)\"><rect class=\"gt\" x=\"31\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"74\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"2\" y=\"2\" width=\"26\" height=\"32\"/></g><path class=\"ie\" d=\"M240 229.6l106 61.2v10.8l-106-61.2z\"/><path class=\"is\" d=\"M346 290.8l37.5-21.6v10.8l-37.5 21.6z\"/><path class=\"st\" d=\"M310.7 216.4l3.1 1.8-3.6 2.1-3.1-1.8zM313.8 219.7l3.1 1.8-3.6 2.1-3.1-1.8zM316.9 223.1l3.2 1.8-3.7 2.1-3.1-1.8zM320.1 226.4l3.1 1.8-3.7 2.1-3.1-1.8zM323.2 229.8l3.1 1.8-3.6 2.1-3.2-1.8zM326.3 233.1l3.1 1.8-3.6 2.1-3.1-1.8zM329.4 236.5l3.1 1.8-3.6 2.1-3.1-1.8z\"/><path class=\"ss\" d=\"M310.2 220.3l3.6-2.1v1.5l-3.6 2.1zM313.3 223.6l3.6-2.1v1.6l-3.6 2.1zM316.4 227l3.7-2.1v1.5l-3.7 2.1zM319.5 230.3l3.7-2.1v1.6l-3.7 2.1zM322.7 233.7l3.6-2.1v1.5l-3.6 2.1zM325.8 237l3.6-2.1v1.6l-3.6 2.1zM328.9 240.4l3.6-2.1v1.5l-3.6 2.1z\"/><path class=\"sr\" d=\"M307.1 229.3v-10.8l3.1 1.8v1.5l3.1 1.8v1.6l3.1 1.8v1.5l3.1 1.8v1.6l3.2 1.8v1.5l3.1 1.8v1.6l3.1 1.8v1.5z\"/><path class=\"st\" d=\"M339.8 233.2l24.9 14.4-2 1.2-25-14.4zM337.7 235.9l25 14.4-2.1 1.2-25-14.4zM335.6 238.7l25 14.4-2.1 1.2-24.9-14.4zM333.6 241.4l24.9 14.4-2.1 1.2-24.9-14.4zM331.5 244.2l24.9 14.4-2 1.2-25-14.4zM329.4 246.9l25 14.4-2.1 1.2-25-14.4zM327.3 249.7l25 14.4-2.1 1.2-24.9-14.4z\"/><path class=\"sr\" d=\"M337.7 234.4l25 14.4v1.5l-25-14.4zM335.6 237.1l25 14.4v1.6l-25-14.4zM333.6 239.9l24.9 14.4v1.5l-24.9-14.4zM331.5 242.6l24.9 14.4v1.6l-24.9-14.4zM329.4 245.4l25 14.4v1.5l-25-14.4zM327.3 248.1l25 14.4v1.6l-25-14.4zM325.3 250.9l24.9 14.4v1.5l-24.9-14.4z\"/><path class=\"ss\" d=\"M364.7 258.4v-10.8l-2 1.2v1.5l-2.1 1.2v1.6l-2.1 1.2v1.5l-2.1 1.2v1.6l-2 1.2v1.5l-2.1 1.2v1.6l-2.1 1.2v1.5z\"/><path class=\"pt\" d=\"M365.5 245.3l33.2 19.2-.7.4-33.3-19.2z\"/><path class=\"ll\" d=\"M364.7 245.7l33.3 19.2v1.9l-33.3-19.2z\"/><path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\" transform=\"matrix(1.04.6 0-1.2 364.7 247.6)\"/><path class=\"ht\" d=\"M265 193.8l22.8 13.2-14.5 8.4-22.9-13.2z\"/><path class=\"hl\" d=\"M250.4 202.2l22.9 13.2v23.8l-22.9-13.2z\"/><g transform=\"matrix(1.04.6 0-1.2 250.4 215.2)\"><path class=\"so\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 1.7\" d=\"M2.3-5.1h17.3M2.3.9h17.3M2.3 6.7h17.3\"/><path class=\"sg\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 11.2\" d=\"M5.5-5.1h14.2M11.8.9h1.5M5.5 6.7h14.2\"/></g><path class=\"hs\" d=\"M273.3 215.4l14.5-8.4v23.8l-14.5 8.4z\"/><g transform=\"matrix(1.04-.6 0-1.2 273.3 228.4)\"><path class=\"wg\" d=\"M2.2-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9zM5.9-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9zM9.6-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9z\"/><path class=\"sd\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 2.2\" d=\"M2.6 1.7h8.8M2.6 6.7h8.8\"/></g><path class=\"esh\" d=\"M250.4 203.3l22.9 13.2v1.9l-22.9-13.2zM273.3 216.5l14.5-8.4v1.9l-14.5 8.4z\"/><path class=\"rm\" d=\"M247.5 202.2l25.8 14.9v1.1l-25.8-14.9z\"/><path class=\"rs\" d=\"M273.3 217.1l17.5-10.1v1.1l-17.5 10.1z\"/><path class=\"rm\" d=\"M265 192.2l25.8 14.8-17.5-6-8.3-4.8z\"/><path class=\"rl\" d=\"M265 192.2v4l-17.5 6zM247.5 202.2l17.5-6 8.3 4.8v16.1z\"/><path class=\"rs\" d=\"M290.8 207l-17.5 10.1v-16.1z\"/><path class=\"rg\" d=\"M247.5 202.2L265 196.2L273.3 201L273.3 217.1\"/><path class=\"pt\" d=\"M387.6 266.8l31.2 18-27 15.6-31.2-18z\"/><rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"20\" transform=\"matrix(1.04.6-1.04.6 387.6 266.8)\"/><path class=\"ie\" d=\"M360.6 282.4l31.2 18v10.8l-31.2-18z\"/><path class=\"is\" d=\"M391.8 300.4l27-15.6v10.8l-27 15.6z\"/><path class=\"ht\" d=\"M387.6 251.8l18.7 10.8-12.5 7.2-18.7-10.8z\"/><path class=\"hl\" d=\"M375.1 259l18.7 10.8v24.6l-18.7-10.8z\"/><g transform=\"matrix(1.04.6 0-1.2 375.1 272.8)\"><path class=\"so\" stroke-width=\"3.6\" stroke-dasharray=\"1.5 1.5\" d=\"M2.3-5h13.5M2.3 1.2h13.5M2.3 7h13.5\"/><path class=\"sg\" stroke-width=\"3.6\" stroke-dasharray=\"1.5 7.5\" d=\"M5.3-5h10.5M2.3 1.2h10.5M8.3 7h1.5\"/></g><path class=\"hs\" d=\"M393.8 269.8l12.5-7.2v24.6l-12.5 7.2z\"/><g transform=\"matrix(1.04-.6 0-1.2 393.8 283.6)\"><path class=\"sg\" stroke-width=\"6.8\" stroke-dasharray=\"1.8 1.2\" d=\"M2.1 1.9h7.8\"/><rect class=\"rail\" x=\"1\" y=\"-1.5\" width=\"10\" height=\".4\"/><path class=\"sd\" stroke-width=\"3\" stroke-dasharray=\"1.5 1.5\" d=\"M2.3-5.3h7.5M2.3 8.1h7.5\"/></g><path class=\"esh\" d=\"M375.1 260.1l18.7 10.8v1.9l-18.7-10.8zM393.8 270.9l12.5-7.2v1.9l-12.5 7.2z\"/><path class=\"rm\" d=\"M372.2 259l21.6 12.5v1.1l-21.6-12.5z\"/><path class=\"rs\" d=\"M393.8 271.5l15.4-8.9v1.1l-15.4 8.9z\"/><path class=\"rm\" d=\"M387.6 250.1l21.6 12.5-15.4-5.3-6.2-3.6z\"/><path class=\"rl\" d=\"M387.6 250.1v3.6l-15.4 5.3zM372.2 259l15.4-5.3 6.2 3.6v14.2z\"/><path class=\"rs\" d=\"M409.2 262.6l-15.4 8.9v-14.2z\"/><path class=\"rg\" d=\"M372.2 259L387.6 253.7L393.8 257.3L393.8 271.5\"/><path class=\"ht\" d=\"M435.4 247.7l20.8 12-20.8 12-20.8-12z\"/><path class=\"hl\" d=\"M414.6 259.7l20.8 12v15.5l-20.8-12z\"/><g transform=\"matrix(1.04.6 0-1.2 414.6 264.4)\"><path class=\"wg\" d=\"M3.8-8v5.9a1.5 1.5 0 0 0 3 0v-5.9zM8.5-8v5.9a1.5 1.5 0 0 0 3 0v-5.9zM13.2-8v5.9a1.5 1.5 0 0 0 3 0v-5.9z\"/><path class=\"so\" stroke-width=\"1.6\" stroke-dasharray=\"1.4 1.6\" d=\"M1.8 1.8h16.4\"/></g><path class=\"hs\" d=\"M435.4 271.7l20.8-12v15.5l-20.8 12z\"/><g transform=\"matrix(1.04-.6 0-1.2 435.4 276.4)\"><path class=\"sd\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 1.9\" d=\"M2.5-5.3h15.1M2.5-.1h15.1\"/><path class=\"sg\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 8.7\" d=\"M5.9-5.3h11.7M2.5-.1h11.7\"/></g><path class=\"esh\" d=\"M414.6 260.8l20.8 12v1.9l-20.8-12zM435.4 272.8l20.8-12v1.9l-20.8 12z\"/><path class=\"rm\" d=\"M411.7 259.7l23.7 13.7v1.1l-23.7-13.7z\"/><path class=\"rs\" d=\"M435.4 273.4l23.7-13.7v1.1l-23.7 13.7z\"/><path class=\"rm\" d=\"M435.4 246l23.7 13.7-23.7-8.2v0z\"/><path class=\"rl\" d=\"M435.4 246v5.5l-23.7 8.2zM411.7 259.7l23.7-8.2v0 21.9z\"/><path class=\"rs\" d=\"M459.1 259.7l-23.7 13.7v-21.9z\"/><path class=\"rg\" d=\"M411.7 259.7L435.4 251.5L435.4 251.5L435.4 273.4\"/><path class=\"st\" d=\"M297.2 262.6l35.3 20.4-1 .6-35.3-20.4zM296.2 264.4l35.3 20.4-1 .6-35.4-20.4zM295.1 266.2l35.4 20.4-1.1.6-35.3-20.4zM294.1 268l35.3 20.4-1 .6-35.4-20.4z\"/><path class=\"sr\" d=\"M296.2 263.2l35.3 20.4v1.2l-35.3-20.4zM295.1 265l35.4 20.4v1.2l-35.4-20.4zM294.1 266.8l35.3 20.4v1.2l-35.3-20.4zM293 268.6l35.4 20.4v1.2l-35.4-20.4z\"/><path class=\"ss\" d=\"M332.5 287.8v-4.8l-1 .6v1.2l-1 .6v1.2l-1.1.6v1.2l-1 .6v1.2z\"/><path class=\"pt\" d=\"M293 269.8l35.4 20.4-18.7 10.8-35.4-20.4z\"/><path class=\"ie\" d=\"M274.3 280.6l35.4 20.4v6l-35.4-20.4z\"/><path class=\"is\" d=\"M309.7 301l18.7-10.8v6l-18.7 10.8z\"/><g class=\"route\" stroke-width=\"2.2\"><path class=\"w0\" d=\"M309.2 280.1h0M316.5 271.1h0M326.5 265.3h0M338.8 256.7h0M345 248.5h0M351.2 240.2h0\"/><path class=\"w1\" d=\"M311.2 277.7h0M319.8 269.2h0M329.8 263.4h0M340.8 253.9h0M347.1 245.7h0\"/><path class=\"w2\" d=\"M313.3 274.1h0M323.2 267.2h0M337.1 259.2h0M342.9 251.2h0M349.2 243h0\"/></g><path class=\"ll\" d=\"M291.9 282.8V285.4A9.4 5.4 0 0 0 310.8 285.4V282.8z\"/><ellipse class=\"lt\" cx=\"301.4\" cy=\"282.8\" rx=\"9.4\" ry=\"5.4\"/><ellipse class=\"water\" cx=\"301.4\" cy=\"282.8\" rx=\"7.4\" ry=\"4.2\"/><path class=\"bronze\" d=\"M297 283.4l1 -2h6.8l1 2zM300.6 281.4v-4.6l-2.3 -2.1 2.6 1 .5 -1.2 .5 1.2 2.6 -1 -2.3 2.1v4.6z\"/><path class=\"glint\" d=\"M305.8 280.4l.7 1.8 1.8 .7 -1.8 .7 -.7 1.8 -.7 -1.8 -1.8 -.7 1.8 -.7z\"/><ellipse class=\"shade\" cx=\"335\" cy=\"261.7\" rx=\"3.4\" ry=\"1.2\"/><path class=\"fig\" d=\"M332.3 261.7v-6.6a1.8 1.8 0 0 1 3.6 0V261.7z\"/><circle class=\"fig\" cx=\"334.7\" cy=\"252.2\" r=\"1.8\"/><rect class=\"pack\" x=\"331.6\" y=\"254.2\" width=\"3.1\" height=\"4.2\" rx=\".9\"/>",
    // the rock under the main island (the iceberg)
    ice: "<g opacity=\"0.46\"><path class=\"ril\" d=\"M349.2 339.4l10.3 6v19.2l-10.3-6z\"/><path class=\"ris\" d=\"M359.5 345.4l13.6-7.8v19.2l-13.6 7.8z\"/><path class=\"rib\" d=\"M349.2 339.4l10.3 6v1.1l-10.3-6zM359.5 345.4l13.6-7.8v1.1l-13.6 7.8z\"/></g><g opacity=\"0.58\"><path class=\"ril\" d=\"M335.6 322l22.9 13.2v16.8l-22.9-13.2z\"/><path class=\"ris\" d=\"M358.5 335.2l27-15.6v16.8l-27 15.6z\"/><path class=\"rib\" d=\"M335.6 322l22.9 13.2v1.1l-22.9-13.2zM358.5 335.2l27-15.6v1.1l-27 15.6z\"/></g><g opacity=\"0.7\"><path class=\"ril\" d=\"M321.1 305.2l37.4 21.6v15.6l-37.4-21.6z\"/><path class=\"ris\" d=\"M358.5 326.8l41.6-24v15.6l-41.6 24z\"/><path class=\"rib\" d=\"M321.1 305.2l37.4 21.6v1.1l-37.4-21.6zM358.5 326.8l41.6-24v1.1l-41.6 24z\"/></g><g opacity=\"0.8\"><path class=\"ril\" d=\"M302.4 289.6l56.1 32.4v14.4l-56.1-32.4z\"/><path class=\"ris\" d=\"M358.5 322l60.3-34.8v14.4l-60.3 34.8z\"/><path class=\"rib\" d=\"M302.4 289.6l56.1 32.4v1.1l-56.1-32.4zM358.5 322l60.3-34.8v1.1l-60.3 34.8z\"/></g><g opacity=\"0.88\"><path class=\"ril\" d=\"M288.9 247l8.3 4.8v13.2l-8.3-4.8zM281.6 276.4l74.8 43.2v13.2l-74.8-43.2zM428.1 314.2l6.3 3.6v13.2l-6.3-3.6z\"/><path class=\"ris\" d=\"M297.2 251.8l14.5-8.4v13.2l-14.5 8.4zM356.4 319.6l81.1-46.8v13.2l-81.1 46.8zM434.4 317.8l7.2-4.2v13.2l-7.2 4.2z\"/><path class=\"rib\" d=\"M288.9 247l8.3 4.8v1.1l-8.3-4.8zM297.2 251.8l14.5-8.4v1.1l-14.5 8.4zM281.6 276.4l74.8 43.2v1.1l-74.8-43.2zM356.4 319.6l81.1-46.8v1.1l-81.1 46.8zM428.1 314.2l6.3 3.6v1.1l-6.3-3.6zM434.4 317.8l7.2-4.2v1.1l-7.2 4.2z\"/></g><g opacity=\"0.95\"><path class=\"ril\" d=\"M279.5 236.8l14.6 8.4v12l-14.6-8.4zM258.7 263.2l95.7 55.2v12l-95.7-55.2zM422.9 302.8l10.4 6v12l-10.4-6z\"/><path class=\"ris\" d=\"M294.1 245.2l24.9-14.4v12l-24.9 14.4zM354.4 318.4l101.8-58.8v12l-101.8 58.8zM433.3 308.8l12.5-7.2v12l-12.5 7.2z\"/><path class=\"rib\" d=\"M279.5 236.8l14.6 8.4v1.1l-14.6-8.4zM294.1 245.2l24.9-14.4v1.1l-24.9 14.4zM258.7 263.2l95.7 55.2v1.1l-95.7-55.2zM354.4 318.4l101.8-58.8v1.1l-101.8 58.8zM422.9 302.8l10.4 6v1.1l-10.4-6zM433.3 308.8l12.5-7.2v1.1l-12.5 7.2z\"/></g><g opacity=\"1\"><path class=\"ril\" d=\"M271.2 228.4l20.8 12v9.6l-20.8-12zM325.3 242.8l72.7 42v9.6l-72.7-42zM258.7 247.6l87.3 50.4v9.6l-87.3-50.4zM379.3 300.4l12.5 7.2v9.6l-12.5-7.2zM420.9 293.2l12.4 7.2v9.6l-12.4-7.2z\"/><path class=\"ris\" d=\"M292 240.4l33.3-19.2v9.6l-33.3 19.2zM398 284.8l60.3-34.8v9.6l-60.3 34.8zM346 298l18.7-10.8v9.6l-18.7 10.8zM391.8 307.6l8.3-4.8v9.6l-8.3 4.8zM433.3 300.4l14.6-8.4v9.6l-14.6 8.4z\"/><path class=\"rib\" d=\"M271.2 228.4l20.8 12v1.1l-20.8-12zM292 240.4l33.3-19.2v1.1l-33.3 19.2zM325.3 242.8l72.7 42v1.1l-72.7-42zM398 284.8l60.3-34.8v1.1l-60.3 34.8zM258.7 247.6l87.3 50.4v1.1l-87.3-50.4zM346 298l18.7-10.8v1.1l-18.7 10.8zM379.3 300.4l12.5 7.2v1.1l-12.5-7.2zM391.8 307.6l8.3-4.8v1.1l-8.3 4.8zM420.9 293.2l12.4 7.2v1.1l-12.4-7.2zM433.3 300.4l14.6-8.4v1.1l-14.6 8.4z\"/></g><g opacity=\"1\"><path class=\"ril\" d=\"M260.8 221.2l31.2 18v7.2l-31.2-18zM314.9 235.6l83.1 48v7.2l-83.1-48zM248.4 240.4l97.6 56.4v7.2l-97.6-56.4zM368.9 293.2l22.9 13.2v7.2l-22.9-13.2zM410.5 286l22.8 13.2v7.2l-22.8-13.2zM282.6 286.6l27.1 15.6v7.2l-27.1-15.6z\"/><path class=\"ris\" d=\"M292 239.2l43.6-25.2v7.2l-43.6 25.2zM398 283.6l70.7-40.8v7.2l-70.7 40.8zM346 296.8l29.1-16.8v7.2l-29.1 16.8zM391.8 306.4l18.7-10.8v7.2l-18.7 10.8zM433.3 299.2l25-14.4v7.2l-25 14.4zM309.7 302.2l10.4-6v7.2l-10.4 6z\"/><path class=\"rib\" d=\"M260.8 221.2l31.2 18v1.1l-31.2-18zM292 239.2l43.6-25.2v1.1l-43.6 25.2zM314.9 235.6l83.1 48v1.1l-83.1-48zM398 283.6l70.7-40.8v1.1l-70.7 40.8zM248.4 240.4l97.6 56.4v1.1l-97.6-56.4zM346 296.8l29.1-16.8v1.1l-29.1 16.8zM368.9 293.2l22.9 13.2v1.1l-22.9-13.2zM391.8 306.4l18.7-10.8v1.1l-18.7 10.8zM410.5 286l22.8 13.2v1.1l-22.8-13.2zM433.3 299.2l25-14.4v1.1l-25 14.4zM282.6 286.6l27.1 15.6v1.1l-27.1-15.6zM309.7 302.2l10.4-6v1.1l-10.4 6z\"/></g>"
  };
  // The main island in 3D, both sides, for its turn (see startIsland): the Tower
  // side as drawn above and the West Campus apartment side, from
  // scripts/loader-art/export.mjs model (the record format is described there).
  const ART_MODEL = {"flip":[-4,-9],"dot":2.2,"A":[["b","ice",[-11,-1,23,36,-108,-92],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-92.9\" width=\"10\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-92.9\" width=\"13\" height=\".9\"/>"]],8,0.46,"T"],["b","ice",[-18,4,16,42,-92,-78],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-78.9\" width=\"22\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-78.9\" width=\"26\" height=\".9\"/>"]],7,0.58,"T"],["b","ice",[-26,10,8,48,-78,-65],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-65.9\" width=\"36\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-65.9\" width=\"40\" height=\".9\"/>"]],6,0.7,"T"],["b","ice",[-36,18,-2,56,-65,-53],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-53.9\" width=\"54\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-53.9\" width=\"58\" height=\".9\"/>"]],5,0.8,"T"],["b","ice",[-67,-59,24,38,-53,-42],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"8\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"14\" height=\".9\"/>"]],4,0.88,"T"],["b","ice",[-46,26,-12,66,-53,-42],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"72\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"78\" height=\".9\"/>"]],4,0.88,"T"],["b","ice",[56,62,20,27,-53,-42],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"6\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"7\" height=\".9\"/>"]],4,0.88,"T"],["b","ice",[-70,-56,20,44,-42,-32],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"14\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"24\" height=\".9\"/>"]],3,0.95,"T"],["b","ice",[-58,34,-22,76,-42,-32],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"92\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"98\" height=\".9\"/>"]],3,0.95,"T"],["b","ice",[54,64,18,30,-42,-32],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"10\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"12\" height=\".9\"/>"]],3,0.95,"T"],["b","ice",[-73,-53,17,49,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"20\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"32\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-35,35,-23,35,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"70\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"58\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-63,21,53,71,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"84\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"18\" height=\".9\"/>"]],2,1,"T"],["b","ice",[39,51,49,57,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"12\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"8\" height=\".9\"/>"]],2,1,"T"],["b","ice",[53,65,17,31,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"12\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"14\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-78,-48,12,54,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"30\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"42\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-40,40,-28,40,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"80\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"68\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-68,26,48,76,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"94\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"28\" height=\".9\"/>"]],1,1,"T"],["b","ice",[34,56,44,62,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"22\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"18\" height=\".9\"/>"]],1,1,"T"],["b","ice",[48,70,12,36,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"22\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"24\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-13,13,88,98,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"26\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"10\" height=\".9\"/>"]],1,1,"T"],["b","pad:battle",[-82,-44,8,58,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"3\" y=\"3\" width=\"32\" height=\"44\"/>"]]],["b","pad:podium",[-44,44,-32,44,-18,0],"pt ie is",[]],["b","pad:garrison",[44,74,8,40,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"26\"/>"]]],["b","battle",[-76,-54,18,44,-9,8.5],"ht hl hs",[["L","<path class=\"wo\" d=\"M3.2 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM7.7 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM12.2 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4zM16.7 0v5.4a1.1 1.1 0 0 0 2.2 0v-5.4z\"/><path class=\"so\" stroke-width=\"3.6\" stroke-dasharray=\"1.8 2.7\" d=\"M3.4-4.7h15.3\"/>"],["R","<path class=\"wg\" d=\"M2.5-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM5.6-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM8.8-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM11.9-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM15-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM18.2-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM21.3-.4v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"sd\" stroke-width=\"3.8\" stroke-dasharray=\"1.6 1.5\" d=\"M2.8-4.9h20.5\"/><rect class=\"door\" x=\"11.7\" y=\"-9\" width=\"2.6\" height=\"4.8\"/>"]]],["p","esh",[-76,44,7.6,-54,44,7.6,-54,44,6,-76,44,6],24],["p","esh",[-54,44,7.6,-54,18,7.6,-54,18,6,-54,44,6],24],["p","rm",[-77.6,45.6,8.5,-52.4,45.6,8.5,-52.4,45.6,7.6,-77.6,45.6,7.6],24],["p","rs",[-52.4,45.6,8.5,-52.4,16.4,8.5,-52.4,16.4,7.6,-52.4,45.6,7.6],24],["p","rm",[-77.6,16.4,8.5,-52.4,16.4,8.5,-65,29,16.07],24],["p","rl",[-77.6,16.4,8.5,-65,29,16.07,-65,33,16.07,-77.6,45.6,8.5],24],["p","rs",[-52.4,16.4,8.5,-52.4,45.6,8.5,-65,33,16.07,-65,29,16.07],24],["p","rl",[-77.6,45.6,8.5,-65,33,16.07,-52.4,45.6,8.5],24],["l","rg",[-77.6,45.6,8.5,-65,33,16.07,-52.4,45.6,8.5],24,0.6],["l","rg",[-65,33,16.07,-65,29,16.07],24,0.6],["b","mainbldg",[-38,-18,-26,18,0,24.4],"rf ll ls",[["R","<path class=\"sd\" stroke-width=\"2.4\" stroke-dasharray=\"1.6 2.4\" d=\"M3.2 21.8h37.6\"/>"]]],["p","esh",[-18,18,23.5,-18,-26,23.5,-18,-26,21.9,-18,18,21.9],35],["p","rm",[-39.2,19.2,24.4,-16.8,19.2,24.4,-16.8,19.2,23.5,-39.2,19.2,23.5],35],["p","rs",[-16.8,19.2,24.4,-16.8,-27.2,24.4,-16.8,-27.2,23.5,-16.8,19.2,23.5],35],["p","rm",[-39.2,-27.2,24.4,-16.8,-27.2,24.4,-28,-16,31.13],35],["p","rl",[-39.2,-27.2,24.4,-28,-16,31.13,-28,8,31.13,-39.2,19.2,24.4],35],["p","rs",[-16.8,-27.2,24.4,-16.8,19.2,24.4,-28,8,31.13,-28,-16,31.13],35],["p","rl",[-39.2,19.2,24.4,-28,8,31.13,-16.8,19.2,24.4],35],["l","rg",[-39.2,19.2,24.4,-28,8,31.13,-16.8,19.2,24.4],35,0.6],["l","rg",[-28,8,31.13,-28,-16,31.13],35,0.6],["b","mainbldg",[-18,18,-22,18,0,20.2],"rf ll ls",[]],["b","tower",[-11.28,11.28,-10.42,10.42,0,114.04],"lt ll ls",[["L","<path class=\"gl2\" d=\"M5 6h2.5v105.1h-2.5zM10 6h2.5v105.1h-2.5zM15 6h2.5v105.1h-2.5z\"/><path class=\"sbz\" stroke-width=\"2.5\" stroke-dasharray=\"2.1 3.8\" d=\"M6.3 9.7v101.4M11.3 9.7v101.4M16.3 9.7v101.4\"/><path class=\"wg\" d=\"M5.4 60.3h1.8v3h-1.8zM10.4 24.6h1.8v3h-1.8zM10.4 102h1.8v3h-1.8zM15.4 66.2h1.8v3h-1.8z\"/>"],["R","<path class=\"gs2\" d=\"M4.2 6h2.5v105.1h-2.5zM9.2 6h2.5v105.1h-2.5zM14.2 6h2.5v105.1h-2.5z\"/><path class=\"sbs\" stroke-width=\"2.5\" stroke-dasharray=\"2.1 3.8\" d=\"M5.4 9.7v101.4M10.4 9.7v101.4M15.4 9.7v101.4\"/><path class=\"wg\" d=\"M4.5 60.3h1.8v3h-1.8zM9.5 24.6h1.8v3h-1.8zM9.5 102h1.8v3h-1.8zM14.5 66.2h1.8v3h-1.8z\"/>"]]],["b","tower",[-11.57,11.57,-10.69,10.69,114.04,118.98],"ct cl cs",[["L","<path class=\"scn\" stroke-width=\"1.1\" stroke-dasharray=\".6 1.4\" d=\"M1.3 114.6h20.5\"/>"],["R","<path class=\"scn\" stroke-width=\"1.1\" stroke-dasharray=\".6 1.3\" d=\"M1.2 114.6h18.9\"/>"]]],["b","tower",[-9.7,9.7,-8.96,8.96,118.98,129.51],"ot ol os",[["L","<circle class=\"bez\" cx=\"9.7\" cy=\"124.6\" r=\"4.1\"/><circle class=\"dial\" cx=\"9.7\" cy=\"124.6\" r=\"2.9\"/><path class=\"hand\" d=\"M9.5 124.6h.4v2.2h-.4zM9.7 124.3h1.6v.4h-1.6z\"/>"],["R","<circle class=\"bez\" cx=\"9\" cy=\"124.6\" r=\"4.1\"/><circle class=\"dial\" cx=\"9\" cy=\"124.6\" r=\"2.9\"/><path class=\"hand\" d=\"M8.7 124.6h.4v2.2h-.4zM9 124.3h1.6v.4h-1.6z\"/>"]]],["b","tower",[-9.7,9.2,-8.96,-8.46,129.51,131.46],"ot ot ot",[],0,1,"LR"],["b","tower",[-9.7,-9.2,-8.96,8.96,129.51,131.46],"ot ot os",[],0,1,"L"],["b","tower",[-5.53,5.53,-5.11,5.11,130.81,144.07],"bell bell bell",[["L","<path class=\"ol\" d=\"M0 130.8h1.3v13.3h-1.3zM2.3 130.8h.6v13.3h-.6zM3.2 130.8h.6v13.3h-.6zM7.3 130.8h.6v13.3h-.6zM8.1 130.8h.6v13.3h-.6zM9.8 130.8h1.3v13.3h-1.3z\"/><rect class=\"ol\" x=\"0\" y=\"130.8\" width=\"11.1\" height=\".9\"/>"],["R","<path class=\"os\" d=\"M0 130.8h1.2v13.3h-1.2zM2.1 130.8h.6v13.3h-.6zM2.9 130.8h.6v13.3h-.6zM6.7 130.8h.6v13.3h-.6zM7.5 130.8h.6v13.3h-.6zM9 130.8h1.2v13.3h-1.2z\"/><rect class=\"os\" x=\"0\" y=\"130.8\" width=\"10.2\" height=\".9\"/>"]],0,1,"T"],["b","tower",[-9.7,9.7,8.46,8.96,129.51,131.46],"ot ol ot",[["L","<path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1\" d=\"M1.3 130.4h16.8\"/>"]],0,1,"R"],["b","tower",[9.2,9.7,-8.96,8.96,129.51,131.46],"ot ot os",[["R","<path class=\"sd\" stroke-width=\"1.2\" stroke-dasharray=\".5 .9\" d=\"M1.3 130.4h15.4\"/>"]],0,1,"L"],["b","tower",[-5.87,5.87,-5.42,5.42,144.07,145.76],"ot ol os",[["L","<path class=\"sgd\" stroke-width=\".7\" stroke-dasharray=\".7 1.9\" d=\"M1.6 144.9h8.6\"/>"],["R","<path class=\"sgd\" stroke-width=\".7\" stroke-dasharray=\".7 1.7\" d=\"M1.5 144.9h7.9\"/>"]]],["b","tower",[-5.08,5.08,-4.69,4.69,145.76,147.97],"ot ol os",[]],["b","tower",[-4.06,4.06,-3.75,3.75,147.97,150.05],"ot ol os",[],0,1,"T"],["p","kt",[-4.36,-4.05,150.05,4.36,-4.05,150.05,0,0,152.91],56],["p","kt",[-4.36,-4.05,150.05,0,0,152.91,-4.36,4.05,150.05],56],["p","kl",[-4.36,4.05,150.05,0,0,152.91,4.36,4.05,150.05],56],["p","ks",[4.36,-4.05,150.05,4.36,4.05,150.05,0,0,152.91],56],["s",[0,0,152.91],"<rect class=\"mast\" x=\"397.6\" y=\"21.5\" width=\".9\" height=\"9\"/>",56],["b","mainbldg",[18,38,-26,18,0,24.4],"rf ll ls",[["R","<path class=\"sd\" stroke-width=\"2.8\" stroke-dasharray=\"1.6 2.4\" d=\"M3.2 3.8h37.6M3.2 10.4h37.6M3.2 15.9h37.6M3.2 21h37.6\"/><path class=\"sg\" stroke-width=\"2.8\" stroke-dasharray=\"1.6 10.4\" d=\"M7.2 3.8h25.6M3.2 10.4h37.6M11.2 15.9h25.6M7.2 21h25.6\"/>"]]],["p","esh",[38,18,23.5,38,-26,23.5,38,-26,21.9,38,18,21.9],62],["p","rm",[16.8,19.2,24.4,39.2,19.2,24.4,39.2,19.2,23.5,16.8,19.2,23.5],62],["p","rs",[39.2,19.2,24.4,39.2,-27.2,24.4,39.2,-27.2,23.5,39.2,19.2,23.5],62],["p","rm",[16.8,-27.2,24.4,39.2,-27.2,24.4,28,-16,31.13],62],["p","rl",[16.8,-27.2,24.4,28,-16,31.13,28,8,31.13,16.8,19.2,24.4],62],["p","rs",[39.2,-27.2,24.4,39.2,19.2,24.4,28,8,31.13,28,-16,31.13],62],["p","rl",[16.8,19.2,24.4,28,8,31.13,39.2,19.2,24.4],62],["l","rg",[16.8,19.2,24.4,28,8,31.13,39.2,19.2,24.4],62,0.6],["l","rg",[28,8,31.13,28,-16,31.13],62,0.6],["b","mainbldg",[-38,-12,18,40,0,24.4],"rf ll ls",[["L","<path class=\"wo\" d=\"M1.8 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM7.7 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM13.5 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM19.3 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9z\"/><path class=\"wg\" d=\"M1.8 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM7.7 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM13.5 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM19.3 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"wo\" d=\"M2 20.4h1.8v2.2h-1.8zM7.9 20.4h1.8v2.2h-1.8zM13.7 20.4h1.8v2.2h-1.8zM19.5 20.4h1.8v2.2h-1.8z\"/><path class=\"trim\" d=\"M0 17.2h26v.8h-26zM0 20h26v.5h-26z\"/>"]],0,1,"R"],["p","esh",[-38,40,23.5,-12,40,23.5,-12,40,21.9,-38,40,21.9],72],["p","rm",[-39.2,41.2,24.4,0,41.2,24.4,0,41.2,23.5,-39.2,41.2,23.5],72],["p","rm",[-39.2,16.8,24.4,0,16.8,24.4,0,29,31.73,-27,29,31.73],72],["p","rl",[-39.2,16.8,24.4,-27,29,31.73,-39.2,41.2,24.4],72],["p","rl",[-39.2,41.2,24.4,-27,29,31.73,0,29,31.73,0,41.2,24.4],72],["l","rg",[-39.2,41.2,24.4,-27,29,31.73,-4,29,31.73],72,0.6],["b","mainbldg",[-12,12,14,43,0,26.2],"rf ll ls",[["L","<path class=\"ao\" d=\"M1.2 0v5a1.2 1.2 0 0 0 2.4 0v-5zM4.4 0v5a1.2 1.2 0 0 0 2.4 0v-5zM7.6 0v5a1.2 1.2 0 0 0 2.4 0v-5zM10.8 0v5a1.2 1.2 0 0 0 2.4 0v-5zM14 0v5a1.2 1.2 0 0 0 2.4 0v-5zM17.2 0v5a1.2 1.2 0 0 0 2.4 0v-5zM20.4 0v5a1.2 1.2 0 0 0 2.4 0v-5z\"/><path class=\"ag\" d=\"M1.7 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM4.9 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM8 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM11.3 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM14.5 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM17.7 0v4.8a.8.8 0 0 0 1.5 0v-4.7zM20.8 0v4.8a.8.8 0 0 0 1.5 0v-4.7z\"/><path class=\"sg\" stroke-width=\"7.6\" stroke-dasharray=\"1.7 1.5\" d=\"M1.5 12.2h20.9\"/><rect class=\"rail\" x=\".6\" y=\"8.4\" width=\"22.8\" height=\".5\"/><path class=\"so\" stroke-width=\"2.6\" stroke-dasharray=\"1.4 1.8\" d=\"M1.7 22.2h20.6\"/><path class=\"trim\" d=\"M0 17.2h24v.8h-24zM0 20h24v.5h-24z\"/><path class=\"so\" stroke-width=\"1.5\" stroke-dasharray=\".4 1.2\" d=\"M1.2 18.9h21.6\"/>"]]],["p","esh",[-12,43,25.3,12,43,25.3,12,43,23.7,-12,43,23.7],79],["p","esh",[12,43,25.3,12,14,25.3,12,14,23.7,12,43,23.7],79],["p","rm",[-13.2,44.2,26.2,13.2,44.2,26.2,13.2,44.2,25.3,-13.2,44.2,25.3],79],["p","rs",[13.2,44.2,26.2,13.2,12.8,26.2,13.2,12.8,25.3,13.2,44.2,25.3],79],["p","rm",[-13.2,12.8,26.2,13.2,12.8,26.2,0,26,34.13],79],["p","rl",[-13.2,12.8,26.2,0,26,34.13,0,31,34.13,-13.2,44.2,26.2],79],["p","rs",[13.2,12.8,26.2,13.2,44.2,26.2,0,31,34.13,0,26,34.13],79],["p","rl",[-13.2,44.2,26.2,0,31,34.13,13.2,44.2,26.2],79],["l","rg",[-13.2,44.2,26.2,0,31,34.13,13.2,44.2,26.2],79,0.6],["l","rg",[0,31,34.13,0,26,34.13],79,0.6],["b","mainbldg",[12,38,18,40,0,24.4],"rf ll ls",[["L","<path class=\"wo\" d=\"M22 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM16.2 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM10.3 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9zM4.5 1.6v2.9a1.1 1.1 0 0 0 2.2 0v-2.9z\"/><path class=\"wg\" d=\"M22 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM16.2 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM10.3 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3zM4.5 8.6v6.3a1.1 1.1 0 0 0 2.2 0v-6.3z\"/><path class=\"wo\" d=\"M22.2 20.4h1.8v2.2h-1.8zM16.4 20.4h1.8v2.2h-1.8zM10.5 20.4h1.8v2.2h-1.8zM4.7 20.4h1.8v2.2h-1.8z\"/><path class=\"trim\" d=\"M0 17.2h26v.8h-26zM0 20h26v.5h-26z\"/>"]]],["p","esh",[12,40,23.5,38,40,23.5,38,40,21.9,12,40,21.9],90],["p","esh",[38,40,23.5,38,18,23.5,38,18,21.9,38,40,21.9],90],["p","rm",[13.2,41.2,24.4,39.2,41.2,24.4,39.2,41.2,23.5,13.2,41.2,23.5],90],["p","rs",[39.2,41.2,24.4,39.2,16.8,24.4,39.2,16.8,23.5,39.2,41.2,23.5],90],["p","rm",[13.2,16.8,24.4,39.2,16.8,24.4,27,29,31.73,4,29,31.73,13.2,19.8,26.2],90],["p","rl",[13.2,41.2,24.4,39.2,41.2,24.4,27,29,31.73,4,29,31.73,13.2,38.2,26.2],90],["p","rs",[39.2,16.8,24.4,39.2,41.2,24.4,27,29,31.73],90],["l","rg",[4,29,31.73,27,29,31.73,39.2,41.2,24.4],90,0.6],["b","bal",[-44,-12,43.3,44,0,1.6],"pt ll pt",[["L","<path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\"/>"]],0,1,"R"],["b","pad:mall",[-72,30,44,80,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"31\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"74\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"2\" y=\"2\" width=\"26\" height=\"32\"/>"]]],["b","stairI",[-40,-37,44,47.5,-9,0],"st sr ss",[]],["b","stairI",[-37,-34,44,47.5,-9,-1.29],"st sr ss",[]],["b","stairI",[-34,-31,44,47.5,-9,-2.57],"st sr ss",[]],["b","stairI",[-31,-28,44,47.5,-9,-3.86],"st sr ss",[]],["b","stairI",[-28,-25,44,47.5,-9,-5.14],"st sr ss",[]],["b","stairI",[-25,-22,44,47.5,-9,-6.43],"st sr ss",[]],["b","stairI",[-22,-19,44,47.5,-9,-7.71],"st sr ss",[]],["b","stair",[-12,12,44,46,-9,0],"st sr ss",[]],["b","stair",[-12,12,46,48,-9,-1.29],"st sr ss",[]],["b","stair",[-12,12,48,50,-9,-2.57],"st sr ss",[]],["b","stair",[-12,12,50,52,-9,-3.86],"st sr ss",[]],["b","stair",[-12,12,52,54,-9,-5.14],"st sr ss",[]],["b","stair",[-12,12,54,56,-9,-6.43],"st sr ss",[]],["b","stair",[-12,12,56,58,-9,-7.71],"st sr ss",[]],["b","bal",[12,44,43.3,44,0,1.6],"pt ll pt",[["L","<path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\"/>"]],0,1,"R"],["b","parlin",[-70,-48,58,72,-9,10.8],"ht hl hs",[["L","<path class=\"so\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 1.7\" d=\"M2.3-5.1h17.3M2.3.9h17.3M2.3 6.7h17.3\"/><path class=\"sg\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 11.2\" d=\"M5.5-5.1h14.2M11.8.9h1.5M5.5 6.7h14.2\"/>"],["R","<path class=\"wg\" d=\"M2.2-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9zM5.9-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9zM9.6-7v3.9a1.1 1.1 0 0 0 2.2 0v-3.9z\"/><path class=\"sd\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 2.2\" d=\"M2.6 1.7h8.8M2.6 6.7h8.8\"/>"]]],["p","esh",[-70,72,9.9,-48,72,9.9,-48,72,8.3,-70,72,8.3],116],["p","esh",[-48,72,9.9,-48,58,9.9,-48,58,8.3,-48,72,8.3],116],["p","rm",[-71.4,73.4,10.8,-46.6,73.4,10.8,-46.6,73.4,9.9,-71.4,73.4,9.9],116],["p","rs",[-46.6,73.4,10.8,-46.6,56.6,10.8,-46.6,56.6,9.9,-46.6,73.4,9.9],116],["p","rm",[-71.4,56.6,10.8,-46.6,56.6,10.8,-55,65,15.85,-63,65,15.85],116],["p","rl",[-71.4,56.6,10.8,-63,65,15.85,-71.4,73.4,10.8],116],["p","rl",[-71.4,73.4,10.8,-63,65,15.85,-55,65,15.85,-46.6,73.4,10.8],116],["p","rs",[-46.6,56.6,10.8,-46.6,73.4,10.8,-55,65,15.85],116],["l","rg",[-71.4,73.4,10.8,-63,65,15.85,-55,65,15.85,-46.6,73.4,10.8],116,0.6],["b","pad:batts",[30,60,40,66,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"20\"/>"]]],["b","batts",[38,56,48,60,-9,11.5],"ht hl hs",[["L","<path class=\"so\" stroke-width=\"3.6\" stroke-dasharray=\"1.5 1.5\" d=\"M2.3-5h13.5M2.3 1.2h13.5M2.3 7h13.5\"/><path class=\"sg\" stroke-width=\"3.6\" stroke-dasharray=\"1.5 7.5\" d=\"M5.3-5h10.5M2.3 1.2h10.5M8.3 7h1.5\"/>"],["R","<path class=\"sg\" stroke-width=\"6.8\" stroke-dasharray=\"1.8 1.2\" d=\"M2.1 1.9h7.8\"/><rect class=\"rail\" x=\"1\" y=\"-1.5\" width=\"10\" height=\".4\"/><path class=\"sd\" stroke-width=\"3\" stroke-dasharray=\"1.5 1.5\" d=\"M2.3-5.3h7.5M2.3 8.1h7.5\"/>"]]],["p","esh",[38,60,10.6,56,60,10.6,56,60,9,38,60,9],127],["p","esh",[56,60,10.6,56,48,10.6,56,48,9,56,60,9],127],["p","rm",[36.6,61.4,11.5,57.4,61.4,11.5,57.4,61.4,10.6,36.6,61.4,10.6],127],["p","rs",[57.4,61.4,11.5,57.4,46.6,11.5,57.4,46.6,10.6,57.4,61.4,10.6],127],["p","rm",[36.6,46.6,11.5,57.4,46.6,11.5,50,54,15.95,44,54,15.95],127],["p","rl",[36.6,46.6,11.5,44,54,15.95,36.6,61.4,11.5],127],["p","rl",[36.6,61.4,11.5,44,54,15.95,50,54,15.95,57.4,61.4,11.5],127],["p","rs",[57.4,46.6,11.5,57.4,61.4,11.5,50,54,15.95],127],["l","rg",[36.6,61.4,11.5,44,54,15.95,50,54,15.95,57.4,61.4,11.5],127,0.6],["b","garrison",[50,70,14,34,-9,3.9],"ht hl hs",[["L","<path class=\"wg\" d=\"M3.8-8v5.9a1.5 1.5 0 0 0 3 0v-5.9zM8.5-8v5.9a1.5 1.5 0 0 0 3 0v-5.9zM13.2-8v5.9a1.5 1.5 0 0 0 3 0v-5.9z\"/><path class=\"so\" stroke-width=\"1.6\" stroke-dasharray=\"1.4 1.6\" d=\"M1.8 1.8h16.4\"/>"],["R","<path class=\"sd\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 1.9\" d=\"M2.5-5.3h15.1M2.5-.1h15.1\"/><path class=\"sg\" stroke-width=\"3.4\" stroke-dasharray=\"1.5 8.7\" d=\"M5.9-5.3h11.7M2.5-.1h11.7\"/>"]]],["p","esh",[50,34,3,70,34,3,70,34,1.4,50,34,1.4],137],["p","esh",[70,34,3,70,14,3,70,14,1.4,70,34,1.4],137],["p","rm",[48.6,35.4,3.9,71.4,35.4,3.9,71.4,35.4,3,48.6,35.4,3],137],["p","rs",[71.4,35.4,3.9,71.4,12.6,3.9,71.4,12.6,3,71.4,35.4,3],137],["p","rm",[48.6,12.6,3.9,71.4,12.6,3.9,60,24,10.75,60,24,10.75],137],["p","rl",[48.6,12.6,3.9,60,24,10.75,48.6,35.4,3.9],137],["p","rl",[48.6,35.4,3.9,60,24,10.75,60,24,10.75,71.4,35.4,3.9],137],["p","rs",[71.4,12.6,3.9,71.4,35.4,3.9,60,24,10.75],137],["l","rg",[48.6,35.4,3.9,60,24,10.75,60,24,10.75,71.4,35.4,3.9],137,0.6],["b","stairP",[-17,17,80,81,-13,-9],"st sr ss",[]],["b","stairP",[-17,17,81,82,-13,-10],"st sr ss",[]],["b","stairP",[-17,17,82,83,-13,-11],"st sr ss",[]],["b","stairP",[-17,17,83,84,-13,-12],"st sr ss",[]],["b","pad:plaza",[-17,17,84,102,-18,-13],"pt ie is",[]],["d",[0,85.4,-13],0,151],["d",[0,83.5,-12],1,150],["d",[0,81.5,-10],2,148],["d",[0,78.4,-9],0,100],["d",[0,75.2,-9],1,100],["d",[0,72,-9],2,100],["d",[0,68.8,-9],0,100],["d",[0,65.6,-9],1,100],["d",[0,58.6,-9],2,100],["d",[0,57,-7.71],0,114],["d",[0,55,-6.43],1,113],["d",[0,53,-5.14],2,112],["d",[0,51,-3.86],0,111],["d",[0,49,-2.57],1,110],["d",[0,47,-1.29],2,109],["d",[0,45,0],0,108],["c","ll lt",[0,93,-13],6.4,2.2,151],["e","water",[0,93,-10.8],5.04,4.99,151],["s",[0,93,-10.8],"<path class=\"bronze\" d=\"M297 283.4l1 -2h6.8l1 2zM300.6 281.4v-4.6l-2.3 -2.1 2.6 1 .5 -1.2 .5 1.2 2.6 -1 -2.3 2.1v4.6z\"/>",151],["s",[0,93,-10.8],"<path class=\"glint\" d=\"M305.8 280.4l.7 1.8 1.8 .7 -1.8 .7 -.7 1.8 -.7 -1.8 -1.8 -.7 1.8 -.7z\"/>",151],["e","shade",[0.43,61.07,-9],2.31,1.41,100],["s",[0,61.5,-9],"<path class=\"fig\" d=\"M332.3 261.7v-6.6a1.8 1.8 0 0 1 3.6 0V261.7z\"/><circle class=\"fig\" cx=\"334.7\" cy=\"252.2\" r=\"1.8\"/><rect class=\"pack\" x=\"331.6\" y=\"254.2\" width=\"3.1\" height=\"4.2\" rx=\".9\"/>",100]],"B":[["b","ice",[-7,3,23,36,-108,-92],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-92.9\" width=\"10\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-92.9\" width=\"13\" height=\".9\"/>"]],8,0.46,"T"],["b","ice",[-12,10,16,42,-92,-78],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-78.9\" width=\"22\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-78.9\" width=\"26\" height=\".9\"/>"]],7,0.58,"T"],["b","ice",[-18,18,8,48,-78,-65],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-65.9\" width=\"36\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-65.9\" width=\"40\" height=\".9\"/>"]],6,0.7,"T"],["b","ice",[-26,28,-2,56,-65,-53],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-53.9\" width=\"54\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-53.9\" width=\"58\" height=\".9\"/>"]],5,0.8,"T"],["b","ice",[51,59,24,38,-53,-42],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"8\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"14\" height=\".9\"/>"]],4,0.88,"T"],["b","ice",[-34,38,-12,66,-53,-42],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"72\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"78\" height=\".9\"/>"]],4,0.88,"T"],["b","ice",[-70,-64,20,27,-53,-42],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"6\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-42.9\" width=\"7\" height=\".9\"/>"]],4,0.88,"T"],["b","ice",[48,62,20,44,-42,-32],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"14\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"24\" height=\".9\"/>"]],3,0.95,"T"],["b","ice",[-42,50,-22,76,-42,-32],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"92\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"98\" height=\".9\"/>"]],3,0.95,"T"],["b","ice",[-72,-62,18,30,-42,-32],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"10\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-32.9\" width=\"12\" height=\".9\"/>"]],3,0.95,"T"],["b","ice",[45,65,17,49,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"20\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"32\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-43,27,-23,35,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"70\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"58\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-29,55,53,71,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"84\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"18\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-59,-47,49,57,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"12\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"8\" height=\".9\"/>"]],2,1,"T"],["b","ice",[-73,-61,17,31,-32,-24],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"12\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-24.9\" width=\"14\" height=\".9\"/>"]],2,1,"T"],["b","ice",[40,70,12,54,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"30\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"42\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-48,32,-28,40,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"80\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"68\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-34,60,48,76,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"94\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"28\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-64,-42,44,62,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"22\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"18\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-78,-56,12,36,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"22\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"24\" height=\".9\"/>"]],1,1,"T"],["b","ice",[-21,5,88,98,-24,-18],"rib ril ris",[["L","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"26\" height=\".9\"/>"],["R","<rect class=\"rib\" x=\"0\" y=\"-18.9\" width=\"10\" height=\".9\"/>"]],1,1,"T"],["b","pad:battle",[36,74,8,58,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"3\" y=\"3\" width=\"32\" height=\"44\"/>"]]],["b","pad:podium",[-52,36,-32,44,-18,0],"pt ie is",[]],["b","pad:garrison",[-82,-52,8,40,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"26\"/>"]]],["b","apt",[44,70,14,50,-9,9],"ar bl bs",[["L","<path class=\"so\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1\" d=\"M1.7-5.8h22.6M1.7-2.7h22.6M1.7.4h22.6M1.7 3.5h22.6M1.7 6.6h22.6\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 6.3\" d=\"M4.3-5.8h17.3M1.7-2.7h17.3M7 .4h17.3M4.3 3.5h17.3M1.7 6.6h17.3\"/>"],["R","<path class=\"sd\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.2\" d=\"M1.8-5.8h32.4M1.8-2.7h32.4M1.8.4h32.4M1.8 3.5h32.4M1.8 6.6h32.4\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 9.6\" d=\"M4.6-5.8h24M10.2-2.7h24M4.6.4h24M10.2 3.5h24M4.6 6.6h24\"/>"]],0,1,"T"],["b","apt",[44,70,14,50,9,10.1],"ar al as",[]],["b","apt",[58,64,22,28,10.1,13],"al al as",[]],["b","apt",[-12,14,-26,-2,0,62],"ar al as",[["L","<path class=\"so\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1\" d=\"M1.7 3.2h22.6M1.7 6.3h22.6M1.7 9.4h22.6M1.7 12.5h22.6M1.7 15.6h22.6M1.7 18.7h22.6M1.7 21.8h22.6M1.7 24.9h22.6M1.7 28h22.6M1.7 31.1h22.6M1.7 34.2h22.6M1.7 37.3h22.6M1.7 40.4h22.6M1.7 43.5h22.6M1.7 46.6h22.6M1.7 49.7h22.6M1.7 52.8h22.6M1.7 55.9h22.6M1.7 59h22.6\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 6.3\" d=\"M4.3 3.2h17.3M1.7 6.3h17.3M7 9.4h17.3M4.3 12.5h17.3M1.7 15.6h17.3M7 18.7h17.3M4.3 21.8h17.3M1.7 24.9h17.3M7 28h17.3M4.3 31.1h17.3M1.7 34.2h17.3M7 37.3h17.3M4.3 40.4h17.3M1.7 43.5h17.3M7 46.6h17.3M4.3 49.7h17.3M1.7 52.8h17.3M7 55.9h17.3M4.3 59h17.3\"/><path class=\"ab\" d=\"M0 3.1h26v.5h-26zM0 6.2h26v.5h-26zM0 9.3h26v.5h-26zM0 12.4h26v.5h-26zM0 15.5h26v.5h-26zM0 18.6h26v.5h-26zM0 21.7h26v.5h-26zM0 24.8h26v.5h-26zM0 27.9h26v.5h-26zM0 31h26v.5h-26zM0 34.1h26v.5h-26zM0 37.2h26v.5h-26zM0 40.3h26v.5h-26zM0 43.4h26v.5h-26zM0 46.5h26v.5h-26zM0 49.6h26v.5h-26zM0 52.7h26v.5h-26zM0 55.8h26v.5h-26zM0 58.9h26v.5h-26z\"/>"],["R","<path class=\"sd\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.1\" d=\"M1.8 3.2h20.5M1.8 6.3h20.5M1.8 9.4h20.5M1.8 12.5h20.5M1.8 15.6h20.5M1.8 18.7h20.5M1.8 21.8h20.5M1.8 24.9h20.5M1.8 28h20.5M1.8 31.1h20.5M1.8 34.2h20.5M1.8 37.3h20.5M1.8 40.4h20.5M1.8 43.5h20.5M1.8 46.6h20.5M1.8 49.7h20.5M1.8 52.8h20.5M1.8 55.9h20.5M1.8 59h20.5\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 9.2\" d=\"M4.5 3.2h12.4M9.9 6.3h12.4M4.5 9.4h12.4M9.9 12.5h12.4M4.5 15.6h12.4M9.9 18.7h12.4M4.5 21.8h12.4M9.9 24.9h12.4M4.5 28h12.4M9.9 31.1h12.4M4.5 34.2h12.4M9.9 37.3h12.4M4.5 40.4h12.4M9.9 43.5h12.4M4.5 46.6h12.4M9.9 49.7h12.4M4.5 52.8h12.4M9.9 55.9h12.4M4.5 59h12.4\"/><path class=\"ab\" d=\"M0 3.1h24v.5h-24zM0 6.2h24v.5h-24zM0 9.3h24v.5h-24zM0 12.4h24v.5h-24zM0 15.5h24v.5h-24zM0 18.6h24v.5h-24zM0 21.7h24v.5h-24zM0 24.8h24v.5h-24zM0 27.9h24v.5h-24zM0 31h24v.5h-24zM0 34.1h24v.5h-24zM0 37.2h24v.5h-24zM0 40.3h24v.5h-24zM0 43.4h24v.5h-24zM0 46.5h24v.5h-24zM0 49.6h24v.5h-24zM0 52.7h24v.5h-24zM0 55.8h24v.5h-24zM0 58.9h24v.5h-24z\"/>"]],0,1,"T"],["b","apt",[-12,14,-26,-2,62,63.1],"ar al as",[]],["b","apt",[-8,10,-22,-6,63.1,67],"ar al as",[["L","<rect class=\"wg\" x=\".6\" y=\"64.3\" width=\"16.8\" height=\"1.3\"/>"],["R","<rect class=\"ag\" x=\".6\" y=\"64.3\" width=\"14.8\" height=\"1.3\"/>"]]],["b","apt",[-2,6,-18,-12,67,70],"ar al as",[]],["b","apt",[-2,32,6,40,0,20],"ar bl bs",[["L","<path class=\"so\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.3\" d=\"M1.8 3.2h30.3M1.8 6.3h30.3M1.8 9.4h30.3M1.8 12.5h30.3M1.8 15.6h30.3\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 7\" d=\"M4.7 3.2h27.5M1.8 6.3h27.5M7.6 9.4h18.8M4.7 12.5h27.5M1.8 15.6h27.5\"/>"],["R","<path class=\"sd\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.3\" d=\"M1.8 3.2h30.3M1.8 6.3h30.3M1.8 9.4h30.3M1.8 12.5h30.3M1.8 15.6h30.3\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 7\" d=\"M4.7 3.2h27.5M1.8 6.3h27.5M7.6 9.4h18.8M4.7 12.5h27.5M1.8 15.6h27.5\"/>"]],0,1,"T"],["b","apt",[-2,32,6,40,20,21.1],"ar al as",[]],["b","apt",[-48,-20,-24,16,0,30],"ar al as",[["L","<path class=\"so\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.2\" d=\"M1.8 3.2h24.4M1.8 6.3h24.4M1.8 9.4h24.4M1.8 12.5h24.4M1.8 15.6h24.4M1.8 18.7h24.4M1.8 21.8h24.4M1.8 24.9h24.4\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 9.8\" d=\"M4.7 3.2h13M10.4 6.3h13M4.7 9.4h13M10.4 12.5h13M4.7 15.6h13M10.4 18.7h13M4.7 21.8h13M10.4 24.9h13\"/><path class=\"ab\" d=\"M0 3.1h28v.5h-28zM0 6.2h28v.5h-28zM0 9.3h28v.5h-28zM0 12.4h28v.5h-28zM0 15.5h28v.5h-28zM0 18.6h28v.5h-28zM0 21.7h28v.5h-28zM0 24.8h28v.5h-28zM0 27.9h28v.5h-28z\"/>"],["R","<path class=\"sd\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.3\" d=\"M1.8 3.2h36.3M1.8 6.3h36.3M1.8 9.4h36.3M1.8 12.5h36.3M1.8 15.6h36.3M1.8 18.7h36.3M1.8 21.8h36.3M1.8 24.9h36.3\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 7.1\" d=\"M4.7 3.2h27.6M1.8 6.3h36.3M7.6 9.4h27.6M4.7 12.5h27.6M1.8 15.6h36.3M7.6 18.7h27.6M4.7 21.8h27.6M1.8 24.9h36.3\"/><path class=\"ab\" d=\"M0 3.1h40v.5h-40zM0 6.2h40v.5h-40zM0 9.3h40v.5h-40zM0 12.4h40v.5h-40zM0 15.5h40v.5h-40zM0 18.6h40v.5h-40zM0 21.7h40v.5h-40zM0 24.8h40v.5h-40zM0 27.9h40v.5h-40z\"/>"]],0,1,"T"],["b","apt",[-48,-20,-24,16,30,31.1],"ar al as",[]],["b","apt",[-48,-12,18,40,0,12],"ar al as",[["L","<path class=\"sd\" stroke-width=\"2.4\" stroke-dasharray=\"2.6 1.2\" d=\"M1.6 1.8h32.8\"/><path class=\"sg\" stroke-width=\"2.4\" stroke-dasharray=\"2.6 5\" d=\"M5.4 1.8h25.3\"/><path class=\"so\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.2\" d=\"M1.8 6.6h32.4M1.8 9.6h32.4\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 6.8\" d=\"M4.6 6.6h26.8M1.8 9.6h26.8\"/>"],["R","<path class=\"sd\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 1.2\" d=\"M1.8 3.2h18.4M1.8 6.3h18.4M1.8 9.4h18.4\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 9.6\" d=\"M4.6 3.2h12.8M10.2 6.3h1.6M4.6 9.4h12.8\"/>"]],0,1,"T"],["b","apt",[-48,-12,18,40,12,12.8],"pt al as",[["T","<rect class=\"water\" x=\"6\" y=\"4\" width=\"20\" height=\"13\"/><rect class=\"glint\" x=\"28\" y=\"5\" width=\"2.4\" height=\"2.4\"/>"]]],["b","bal",[4,36,43.3,44,0,1.6],"pt ll pt",[["L","<path class=\"so\" stroke-width=\"1.2\" stroke-dasharray=\".5 1.1\" d=\"M1.4.5h29.3\"/>"]],0,1,"R"],["b","pad:mall",[-38,64,44,80,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"31\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"74\" y=\"16\" width=\"25\" height=\"16\"/><rect class=\"gt\" x=\"2\" y=\"2\" width=\"26\" height=\"32\"/>"]]],["b","stairI",[11,14,44,47.5,-9,0],"st sr ss",[]],["b","stairI",[14,17,44,47.5,-9,-1.29],"st sr ss",[]],["b","stairI",[17,20,44,47.5,-9,-2.57],"st sr ss",[]],["b","stairI",[20,23,44,47.5,-9,-3.86],"st sr ss",[]],["b","stairI",[23,26,44,47.5,-9,-5.14],"st sr ss",[]],["b","stairI",[26,29,44,47.5,-9,-6.43],"st sr ss",[]],["b","stairI",[29,32,44,47.5,-9,-7.71],"st sr ss",[]],["b","stair",[-20,4,44,46,-9,0],"st sr ss",[]],["b","stair",[-20,4,46,48,-9,-1.29],"st sr ss",[]],["b","stair",[-20,4,48,50,-9,-2.57],"st sr ss",[]],["b","stair",[-20,4,50,52,-9,-3.86],"st sr ss",[]],["b","stair",[-20,4,52,54,-9,-5.14],"st sr ss",[]],["b","stair",[-20,4,54,56,-9,-6.43],"st sr ss",[]],["b","stair",[-20,4,56,58,-9,-7.71],"st sr ss",[]],["b","apt",[40,60,58,74,-9,2],"ar bl bs",[["L","<path class=\"so\" stroke-width=\"2.2\" stroke-dasharray=\"1.8 .7\" d=\"M1.6-5.7h16.9M1.6-2.4h16.9\"/><path class=\"sg\" stroke-width=\"2.2\" stroke-dasharray=\"1.8 3.2\" d=\"M4.1-5.7h11.9M4.1-2.4h11.9\"/>"],["R","<path class=\"sd\" stroke-width=\"2.2\" stroke-dasharray=\"1.8 .9\" d=\"M1.7-5.7h12.7M1.7-2.4h12.7\"/><path class=\"sg\" stroke-width=\"2.2\" stroke-dasharray=\"1.8 3.6\" d=\"M4.4-5.7h7.2M4.4-2.4h7.2\"/><rect class=\"door\" x=\"6.9\" y=\"-9\" width=\"2.2\" height=\"2.8\"/>"]],0,1,"T"],["b","apt",[40,60,58,74,2,3.1],"ar al as",[]],["b","pad:batts",[-68,-38,40,66,-18,-9],"pt ie is",[["T","<rect class=\"gt\" x=\"3\" y=\"3\" width=\"24\" height=\"20\"/>"]]],["b","apt",[-64,-46,48,60,-9,-3],"ar gl2 gs2",[["L","<path class=\"sg\" stroke-width=\"4.4\" stroke-dasharray=\"2 3.3\" d=\"M4-6h12.7\"/>"]],0,1,"T"],["b","apt",[-64,-46,48,60,-3,-1.9],"ar al as",[]],["b","apt",[-78,-58,14,34,-9,4],"ar bl bs",[["L","<path class=\"so\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 .9\" d=\"M1.7-5.8h16.7M1.7-2.7h16.7M1.7.4h16.7\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 5.9\" d=\"M4.2-5.8h9.1M1.7-2.7h16.7M6.7.4h9.1\"/>"],["R","<path class=\"sd\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 .9\" d=\"M1.7-5.8h16.7M1.7-2.7h16.7M1.7.4h16.7\"/><path class=\"sg\" stroke-width=\"1.9\" stroke-dasharray=\"1.6 3.4\" d=\"M4.2-5.8h11.7M4.2-2.7h11.7M4.2.4h11.7\"/>"]],0,1,"T"],["b","apt",[-78,-58,14,34,4,5.1],"ar al as",[]],["s",[28,66,-9],"<rect class=\"hs\" x=\"358.2\" y=\"277.4\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"358.5\" cy=\"275\" r=\"4.1\"/><circle class=\"gt\" cx=\"357.5\" cy=\"274.1\" r=\"2.5\"/>",38],["s",[14,72,-9],"<rect class=\"hs\" x=\"337.4\" y=\"272.6\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"337.7\" cy=\"270.2\" r=\"4.1\"/><circle class=\"gt\" cx=\"336.7\" cy=\"269.3\" r=\"2.5\"/>",38],["s",[-14,64,-9],"<rect class=\"hs\" x=\"316.6\" y=\"251\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"316.9\" cy=\"248.6\" r=\"4.1\"/><circle class=\"gt\" cx=\"315.9\" cy=\"247.7\" r=\"2.5\"/>",38],["s",[-28,72,-9],"<rect class=\"hs\" x=\"293.7\" y=\"247.4\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"294.1\" cy=\"245\" r=\"4.1\"/><circle class=\"gt\" cx=\"293.1\" cy=\"244.1\" r=\"2.5\"/>",38],["s",[-41,63,-9],"<rect class=\"hs\" x=\"289.6\" y=\"234.2\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"289.9\" cy=\"231.8\" r=\"4.1\"/><circle class=\"gt\" cx=\"288.9\" cy=\"230.9\" r=\"2.5\"/>",55],["s",[-66,64,-9],"<rect class=\"hs\" x=\"262.6\" y=\"219.8\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"262.9\" cy=\"217.4\" r=\"4.1\"/><circle class=\"gt\" cx=\"261.9\" cy=\"216.5\" r=\"2.5\"/>",55],["s",[-80,38,-9],"<rect class=\"hs\" x=\"275\" y=\"195.8\" width=\".7\" height=\"3.8\"/><circle class=\"gl\" cx=\"275.4\" cy=\"193.4\" r=\"4.1\"/><circle class=\"gt\" cx=\"274.4\" cy=\"192.5\" r=\"2.5\"/>",23],["b","stairP",[-25,9,80,81,-13,-9],"st sr ss",[]],["b","stairP",[-25,9,81,82,-13,-10],"st sr ss",[]],["b","stairP",[-25,9,82,83,-13,-11],"st sr ss",[]],["b","stairP",[-25,9,83,84,-13,-12],"st sr ss",[]],["b","pad:plaza",[-25,9,84,102,-18,-13],"pt ie is",[["T","<rect class=\"water\" x=\"4\" y=\"3\" width=\"26\" height=\"12\"/><rect class=\"glint\" x=\"25\" y=\"5\" width=\"2.2\" height=\"2.2\"/>"]]]]};
  // main is the main island: the Tower side and its rock. Its turn is drawn over
  // the whole drawing.
  const ART_BOX = { halo: [317, -1, 162, 114], city: [533, 136, 57, 97], west: [191, 117, 53, 84], main: [237, 18, 243, 352] };
  const ART_W = 680, ART_H = 372; // the drawing's size, in drawing units
  // The drawing (an ART_W x ART_H isometric scene).
  function cityArt() {
    // Inline vector art: no image download, no extra WebGL scene. Each island is
    // its own small <svg>, cut to its box, so floating it is a compositor move,
    // not a repaint.
    const vars = Object.entries(ART).map(([k,v]) => '--'+k+':'+v).join(';');
    const halo = (offset, alpha) => `<stop offset="${offset}" stop-color="${ART.halo}" stop-opacity="${alpha}"/>`;
    const pct = v => +v.toFixed(3)+'%';
    const at = ([x,y,w,ht]) => ` style="left:${pct(x/ART_W*100)};top:${pct(y/ART_H*100)};width:${pct(w/ART_W*100)};height:${pct(ht/ART_H*100)}"`;
    // each layer floats by its island's FLOAT; the halo rides with the main island
    const bob = Object.entries(ART_BOX).map(([k,[,,,ht]]) => { const f=FLOAT[k==='halo'?'main':k];
      return `@keyframes mvh-bob-${k}{to{transform:translateY(${(-f.lift/ht*100).toFixed(2)}%)}}`+
        `.mvh-${k}{animation:mvh-bob-${k} ${f.rise}s ease-in-out ${f.delay}s infinite alternate${k==='halo'?',mvh-breathe var(--halo-breath) ease-in-out infinite':''}}`; }).join('');
    const svg = (k, body, box, extra='', place=true) => `<svg xmlns="http://www.w3.org/2000/svg" class="mvh mvh-${k}" viewBox="${box.join(' ')}"${place?at(box):''} aria-hidden="true">${extra}${body}</svg>`;
    const island = islandOK(), M = ART_BOX.main;
    // the Tower side: its rock, then the island, each on the main island's whole box
    const face = (k, body) => `<svg xmlns="http://www.w3.org/2000/svg" class="mvh mvh-${k}" viewBox="${M.join(' ')}" aria-hidden="true">${body}</svg>`;
    return `<div class="mvh-stack" style="aspect-ratio:${ART_W}/${ART_H}">`+
      svg('sky', ART_LAYERS.sky, [0,0,ART_W,ART_H], `<style>.mvh{${vars}}${ART_CSS}${bob}</style>`, false).replace(' aria-hidden="true"', ` role="img" aria-label="${h('story.art_aria')}"`)+
      `<div class="mvh-glow">${svg('halo', ART_LAYERS.halo, ART_BOX.halo, `<defs><radialGradient id="mvh-halo">${halo('0',ART['halo-alpha'])}${halo('.45',ART['halo-mid-alpha'])}${halo('1','0')}</radialGradient></defs>`)}</div>`+
      svg('city', ART_LAYERS.city, ART_BOX.city)+
      `<div class="mvh-west"${at(ART_BOX.west)}>${svg('westart', ART_LAYERS.west, ART_BOX.west, '', false)}</div>`+
      `<div class="mvh-main"${at(M)}><div class="mvh-a">${face('ice', ART_LAYERS.ice)}${face('tower', ART_LAYERS.main)}</div></div>`+
      (island ? `<button type="button" class="mvh-flip" aria-pressed="false" aria-label="${h('story.flip_aria')}"${at(M)}></button>` : '')+'</div>';
  }
  // ---- The main island's turn (see ISLAND). Needs a worker, a canvas it can
  // hand to the worker, Web Animations and (checked in the worker) WebGL2; the
  // schedule privacy guard (see startTurn) must not be watching. Without any of
  // them there is no tap target and the still drawing stays.
  function islandOK() {
    if (!ISLAND.on || typeof Worker !== 'function' || typeof Element.prototype.animate !== 'function' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) return false;
    const guard = window.WAYFIND && WAYFIND.store && WAYFIND.store.guard;
    return !(guard && guard.state && guard.state().watched);
  }
  // The drawing's classes as the worker needs them: each one's colour and the see-through ones' opacity.
  function artClasses() {
    const cls = {}, alpha = {}, val = v => { const m = /^var\(--([\w-]+)\)$/.exec(v); return m ? ART[m[1]] : v; };
    for (const [, sels, prop, v] of ART_CSS.matchAll(/([^{}]+)\{(fill|stroke|opacity):([^;{}]+)\}/g))
      for (const s of sels.split(',')) {
        const k = /^\.mvh \.(\w+)$/.exec(s), to = prop === 'opacity' ? alpha : cls;
        if (k && !(k[1] in to)) to[k[1]] = prop === 'opacity' ? +val(v) : val(v);
      }
    return { cls, alpha };
  }
  // The worker's whole program: the main island's transformation, drawn with
  // WebGL2 on an OffscreenCanvas. It runs as its own script, so it may use only
  // what arrives by message: the model (ART_MODEL), the class colours, ISLAND.
  function islandWorker() {
    let K, CLS, ALPHA, PR, cv = null, gl = null, G = null, lost = false, box, W = 1, H = 1;
    let parts = [], NORD = 1, PIV, FIX, run = null, raf = 0, tInit = 0, walk0 = 0, DOT = 2.2;
    const ms = [], ts = [];
    const now = () => performance.timeOrigin + performance.now();
    const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };
    const lerp = (a, b, t) => a + (b - a) * t;
    const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16) / 255);
    const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 1e-4;
    const col = c => hex(CLS[c] || '#ff00ff');
    // CSS ease-in-out, cubic-bezier(.42, 0, .58, 1), for the shimmers the SVG runs in CSS
    const bz = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    function easeIO(x) {
      let t = x;
      for (let k = 0; k < 8; k++) { const f = bz(t, .42, .58) - x, d = 3 * (1 - t) * (1 - t) * .42 + 6 * (1 - t) * t * .16 + 3 * t * t * .42; if (Math.abs(f) < 1e-7 || !d) break; t = clamp(t - f / d); }
      return bz(t, 0, 1);
    }
    // a CSS pulse: 1 -> lo at half the period -> 1, eased per half
    const pulse = (time, per, lo) => { const ph = ((time % per) + per) % per / per; return ph < .5 ? 1 + (lo - 1) * easeIO(ph * 2) : lo + (1 - lo) * easeIO(ph * 2 - 1); };

    // ---- SVG snippets (face details and sprites) as flat polygons
    const NUM = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
    function arcTo(out, x1, y1, rx, ry, phi, fa, fs, x2, y2) {
      rx = Math.abs(rx); ry = Math.abs(ry);
      if (!rx || !ry) { out.push([x2, y2]); return; }
      const c = Math.cos(phi * Math.PI / 180), s = Math.sin(phi * Math.PI / 180);
      const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = c * dx + s * dy, yp = -s * dx + c * dy;
      let L = xp * xp / (rx * rx) + yp * yp / (ry * ry); if (L > 1) { L = Math.sqrt(L); rx *= L; ry *= L; }
      const nu = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, de = rx * rx * yp * yp + ry * ry * xp * xp;
      let k = Math.sqrt(Math.max(0, nu / (de || 1e-9))); if (+fa === +fs) k = -k;
      const cxp = k * rx * yp / ry, cyp = -k * ry * xp / rx, cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
      let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
      if (!+fs && dt > 0) dt -= 2 * Math.PI; else if (+fs && dt < 0) dt += 2 * Math.PI;
      const n = Math.max(4, Math.ceil(Math.abs(dt) * Math.max(rx, ry) * 1.5 + 2));
      for (let q = 1; q <= n; q++) { const t = t1 + dt * q / n, ex = rx * Math.cos(t), ey = ry * Math.sin(t); out.push([c * ex - s * ey + cx, s * ex + c * ey + cy]); }
    }
    function pathPts(d) {
      const tk = d.match(NUM) || [], subs = [];
      let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
      const num = () => +tk[i++];
      while (i < tk.length) {
        if (/^[a-zA-Z]$/.test(tk[i])) cmd = tk[i++];
        if (!cmd) { i++; continue; }
        const rel = cmd >= 'a', C = cmd.toUpperCase();
        if (C === 'Z') { x = sx; y = sy; cur = null; if (/^[a-zA-Z]$/.test(tk[i] || 'M')) continue; cmd = ''; continue; }
        if (C === 'M') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); sx = x; sy = y; cur = [[x, y]]; subs.push(cur); cmd = rel ? 'l' : 'L'; continue; }
        if (!cur) { cur = [[x, y]]; subs.push(cur); sx = x; sy = y; }
        if (C === 'L') { x = (rel ? x : 0) + num(); y = (rel ? y : 0) + num(); }
        else if (C === 'H') x = (rel ? x : 0) + num();
        else if (C === 'V') y = (rel ? y : 0) + num();
        else if (C === 'A') { const rx = num(), ry = num(), ph = num(), fa = num(), fs = num(), ex = (rel ? x : 0) + num(), ey = (rel ? y : 0) + num(); arcTo(cur, x, y, rx, ry, ph, fa, fs, ex, ey); x = ex; y = ey; continue; }
        else { i++; continue; }
        cur.push([x, y]);
      }
      return subs;
    }
    const quad = (x0, y0, x1, y1, w, out) => { const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L * w / 2, ny = (x1 - x0) / L * w / 2; out.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]); };
    // a dashed stroke with butt ends; the pattern starts again on every subpath, as SVG does
    function dashes(pts, da, ga, w, out) {
      let on = true, left = da;
      for (let k = 1; k < pts.length; k++) {
        let [x0, y0] = pts[k - 1]; const [x1, y1] = pts[k]; let L = Math.hypot(x1 - x0, y1 - y0);
        if (L < 1e-9) continue;
        const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
        while (L > 1e-9) {
          const st = Math.min(left, L);
          if (on && st > 1e-6) quad(x0, y0, x0 + ux * st, y0 + uy * st, w, out);
          x0 += ux * st; y0 += uy * st; L -= st; left -= st;
          if (left <= 1e-9) { on = !on; left = on ? da : ga; }
        }
      }
    }
    const ring = (cx, cy, rx, ry, n = Math.max(16, Math.ceil(Math.max(rx, ry) * 7))) => Array.from({ length: n }, (_, k) => [cx + rx * Math.cos(2 * Math.PI * k / n), cy + ry * Math.sin(2 * Math.PI * k / n)]);
    function shapes(svg) {
      const out = [];
      for (const m of svg.matchAll(/<(path|rect|circle|ellipse)\b([^>]*?)\/?>/g)) {
        const at = {}; for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) at[a[1]] = a[2];
        const polys = [], v = k => +at[k] || 0;
        if (m[1] === 'path') {
          const subs = pathPts(at.d || '');
          if (at['stroke-dasharray']) { const [da, ga] = at['stroke-dasharray'].split(/[ ,]+/).map(Number); for (const s of subs) dashes(s, da, ga, v('stroke-width') || 1, polys); }
          else for (const s of subs) if (s.length > 2) polys.push(s);
        } else if (m[1] === 'rect') {
          const x = v('x'), y = v('y'), w = v('width'), h = v('height'), r = Math.min(v('rx'), w / 2, h / 2);
          if (!r) polys.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
          else { const p = []; [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]].forEach(([cx, cy, a0]) => { for (let q = 0; q <= 5; q++) { const a = (a0 + 18 * q) * Math.PI / 180; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } }); polys.push(p); }
        } else if (m[1] === 'circle') polys.push(ring(v('cx'), v('cy'), v('r'), v('r')));
        else polys.push(ring(v('cx'), v('cy'), v('rx'), v('ry')));
        if (polys.length) out.push({ c: at.class, polys });
      }
      return out;
    }
    // ear clipping; returns a flat list of points, three per triangle
    function tri(pts) {
      const P = pts.filter((q, k) => { const r = pts[(k + 1) % pts.length]; return Math.abs(q[0] - r[0]) + Math.abs(q[1] - r[1]) > 1e-9; });
      const n = P.length, out = [];
      if (n < 3) return out;
      let A = 0; for (let k = 0; k < n; k++) { const a = P[k], b = P[(k + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
      const idx = [...Array(n).keys()]; if (A < 0) idx.reverse();
      const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      let guard = 0;
      while (idx.length > 3 && guard++ < 4 * n * n) {
        let cut = false;
        for (let k = 0; k < idx.length && !cut; k++) {
          const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], a = P[ia], b = P[ib], c = P[ic], x = cr(a, b, c);
          if (Math.abs(x) < 1e-12) { idx.splice(k, 1); cut = true; break; }
          if (x < 0) continue;
          let inside = false;
          for (const q of idx) { if (q === ia || q === ib || q === ic) continue; const p = P[q]; if (cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12) { inside = true; break; } }
          if (inside) continue;
          out.push(a, b, c); idx.splice(k, 1); cut = true;
        }
        if (!cut) break;
      }
      if (idx.length >= 3) for (let k = 1; k + 1 < idx.length; k++) out.push(P[idx[0]], P[idx[k]], P[idx[k + 1]]);
      return out;
    }
    // keep the part of a polygon with lo <= y <= hi
    function clipY(pts, lo, hi) {
      const cut = (ps, keep, yv) => { const o = []; for (let k = 0; k < ps.length; k++) { const a = ps[k], b = ps[(k + 1) % ps.length], ka = keep(a[1]), kb = keep(b[1]); if (ka) o.push(a); if (ka !== kb) { const t = (yv - a[1]) / (b[1] - a[1]); o.push([a[0] + (b[0] - a[0]) * t, yv]); } } return o; };
      return cut(cut(pts, y => y >= lo - 1e-9, lo), y => y <= hi + 1e-9, hi);
    }

    // ---- the model: both sides, and what each piece of one side becomes on the other
    // Faces: 0 top, 1 bottom, 2 south (+j), 3 north, 4 east (+i), 5 west. f = a point as fractions of its box.
    const FN = [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]];
    const FQ = [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]]];
    const FACE = { T: 0, L: 2, R: 4 }, FL = ['T', '', 'L', '', 'R', ''];
    // three-tone light: a face's colour from its normal in the world (top / lit south / shaded east)
    const shade = (pal, n) => { const a = n[2] > 0 ? n[2] : 0, b = n[1] > 0 ? n[1] : 0, c = n[0] > 0 ? n[0] : 0, s = a + b + c || 1; return [0, 1, 2].map(k => (a * pal[0][k] + b * pal[1][k] + c * pal[2][k]) / s); };
    const TRI = { rl: ['rm', 'rl', 'rs'], rm: ['rm', 'rl', 'rs'], rs: ['rm', 'rl', 'rs'], kt: ['kt', 'kl', 'ks'], kl: ['kt', 'kl', 'ks'], ks: ['kt', 'kl', 'ks'], ll: ['lt', 'll', 'ls'], lt: ['lt', 'll', 'ls'] };
    function build(Md) {
      const U = PR.u, CW = U * Math.cos(Math.PI / 6), CH = U / 2;
      Object.assign(PR, { CW, CH });
      const [mi, mz] = Md.flip; DOT = Md.dot || 2.2;
      PIV = K.pivot; FIX = [2 * (PIV[0] - mi), 2 * (PIV[2] - mz)];
      const Eb = b => [2 * mi - b[1], 2 * mi - b[0], b[2], b[3], 2 * mz - b[5], 2 * mz - b[4]];
      const Ep = v => [2 * mi - v[0], v[1], 2 * mz - v[2]];
      const scr = v => [PR.X0 + (v[0] - v[1]) * CW, PR.Y0 + (v[0] + v[1]) * CH - v[2] * U];
      // decode both sides; B goes into the island's own frame (as it lies before the turn)
      const side = (list, S) => list.map((r, k) => {
        const o = { t: r[0], S, k };
        if (r[0] === 'b') Object.assign(o, { part: r[1], w: r[2], l: S === 'A' ? r[2] : Eb(r[2]), cls: r[3].split(' '), dec: r[4], g: r[5] || 0, a: r[6] == null ? 1 : r[6], h: r[7] || '' });
        else if (r[0] === 'p' || r[0] === 'l') { const p = []; for (let q = 0; q < r[2].length; q += 3) p.push(r[2].slice(q, q + 3)); Object.assign(o, { c: r[1], p, par: r[3], w: r[4] }); }
        else if (r[0] === 's') Object.assign(o, { a: r[1], svg: r[2], par: r[3] });
        else if (r[0] === 'd') Object.assign(o, { a: r[1], set: r[2], par: r[3] });
        else if (r[0] === 'c') Object.assign(o, { c: r[1].split(' '), a: r[2], r: r[3], h: r[4], par: r[5] });
        else if (r[0] === 'e') Object.assign(o, { c: r[1], a: r[2], ra: r[3], rb: r[4], par: r[5] });
        return o;
      });
      const A = side(Md.A, 'A'), B = side(Md.B, 'B');
      const boxes = L => L.filter(r => r.t === 'b');
      const vol = b => (b[1] - b[0]) * (b[3] - b[2]) * (b[5] - b[4]);
      const ctr = b => [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
      const dist = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[1]), Math.max(b[2] - p[1], 0, p[1] - b[3]), Math.max(b[4] - p[2], 0, p[2] - b[5]));
      // ---- paint order of side A: the order the still drawing paints in, so the first frame is the drawing
      let n = 0;
      for (let k = 0; k < A.length; k++) {
        const r = A[k];
        if (r.t === 'b' && r.g) { // an iceberg level: all south faces, then all east faces, then every lip
          let e = k; while (e < A.length && A[e].t === 'b' && A[e].g === r.g) e++;
          const nf = e - k;
          for (let f = 0; f < nf; f++) { const b = A[k + f]; b.ord = [n + f, n + f, n + f, n + f, n + nf + f, n + f]; b.dord = { L: n + 2 * nf + 2 * f, R: n + 2 * nf + 2 * f + 1 }; }
          n += 4 * nf; k = e - 1; continue;
        }
        if (r.t === 'b') {
          const o = [0, 0, 0, 0, 0, 0], dord = {};
          for (const F of ['T', 'L', 'R']) { o[FACE[F]] = n++; dord[F] = n; n += r.dec.filter(d => d[0] === F).length * 64; }
          o[1] = o[3] = o[5] = o[0]; r.ord = o; r.dord = dord;
        } else if (r.t === 'c') { r.ord = n; n += 2; } else r.ord = n++;
      }
      NORD = n + 4096;
      let nb = n + 1; // side B only shows once the turn has handed over to real depth; any order will do
      for (const r of B) { if (r.t === 'b') { r.ord = [nb, nb, nb, nb, nb, nb]; r.dord = { T: nb, L: nb, R: nb }; } else r.ord = nb; nb++; }
      const pal = cls => cls.map(col);
      // ---- a piece: one box that morphs from src to dst over its window
      const mk = (o) => Object.assign({ da: [], db: [], pr: [], ga: 0, gb: 0, aa: 1, ab: 1, only: '' }, o);
      // a box's details, clipped to a slab of it, as triangles in the piece's fractions
      function decals(r, slab, fr, S, out) {
        if (!r.dec.length) return;
        const w = r.w, Wz0 = w[4], Wz1 = w[5], sw = S === 'A' ? [slab[4], slab[5]] : [2 * mz - slab[5], 2 * mz - slab[4]];
        for (const [F, svg] of r.dec) {
          if (F === 'T' && Math.abs(sw[1] - Wz1) > 1e-6) continue; // the top's details ride the top slab
          const face = FACE[F], toW = F === 'L' ? (x, y) => [w[0] + x, w[3], y] : F === 'R' ? (x, y) => [w[1], w[3] - x, y] : (x, y) => [w[0] + x, w[2] + y, Wz1];
          const lf = S === 'A' ? toW : (x, y) => Ep(toW(x, y));
          const fc = S === 'A' ? face : [1, 0, 2, 3, 5, 4][face];
          for (const sh of shapes(svg)) {
            const c = hex(CLS[sh.c] || '#ff00ff'), f = [];
            let ymin = 1e9, ymax = -1e9;
            for (let poly of sh.polys) {
              if (F !== 'T') poly = clipY(poly, sw[0], sw[1]);
              if (poly.length < 3) continue;
              for (const q of tri(poly)) { const v = lf(q[0], q[1]); f.push((v[0] - fr[0]) / (fr[1] - fr[0] || 1), (v[1] - fr[2]) / (fr[3] - fr[2] || 1), (v[2] - fr[4]) / (fr[5] - fr[4] || 1)); ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
            }
            if (!f.length) continue;
            const row = F === 'T' ? 1 : clamp(((ymin + ymax) / 2 - Wz0) / (Wz1 - Wz0 || 1));
            out.push({ f: new Float32Array(f), fc, c, row, ord: (r.dord[F] || 0) + out.filter(d => d.fc === fc && d.S === S).length, S, blink: sh.c === 'glint' });
          }
        }
      }
      const slabsZ = (b, q, down) => Array.from({ length: q }, (_, r) => { const h = (b[5] - b[4]) / q; return down ? [b[0], b[1], b[2], b[3], b[5] - (r + 1) * h, b[5] - r * h] : [b[0], b[1], b[2], b[3], b[4] + r * h, b[4] + (r + 1) * h]; });
      const Ab = boxes(A), Bb = boxes(B), padA = {}, padB = {};
      Ab.filter(r => r.part.startsWith('pad:')).forEach(r => padA[r.part] = r);
      Bb.filter(r => r.part.startsWith('pad:')).forEach(r => padB[r.part] = r);
      const padNames = Object.keys(padA).filter(k => padB[k]);
      const colOf = b => { const [ci, cj] = ctr(b); let best = padNames[0], bd = 1e9; for (const k of padNames) { const p = padA[k].l, d = Math.hypot(Math.max(p[0] - ci, 0, ci - p[1]), Math.max(p[2] - cj, 0, cj - p[3])); if (d < bd) { bd = d; best = k; } } return best; };
      const pieceOf = new Map(); // box record -> its pieces
      const addP = (r, p) => { parts.push(p); if (r) { if (!pieceOf.has(r)) pieceOf.set(r, []); pieceOf.get(r).push(p); } return p; };
      // pads: each keeps its name, and moves to where the other side has it
      const pw = K.pads;
      for (const k of padNames) {
        const a = padA[k], b = padB[k];
        const p = mk({ s: a.l, d: b.l, a: pw[0], b: pw[1], pa: pal(a.cls), pb: pal(b.cls), o: a.ord, ps: 0.5, rA: a, rB: b });
        decals(a, a.l, a.l, 'A', p.da); decals(b, b.l, b.l, 'B', p.db);
        addP(a, p); pieceOf.set(b, [p]);
      }
      // children: a box of side B that grows out of the face of a piece it stands on
      function child(parent, r, win) {
        const Pd = parent.d, Ps = parent.s, b = r.l;
        const onTop = Math.abs(b[4] - Pd[5]) <= Math.abs(b[5] - Pd[4]), zs = onTop ? Ps[5] : Ps[4];
        const fx = (v, a0, a1, s0, s1) => s0 + (v - a0) / (a1 - a0 || 1) * (s1 - s0);
        const s = [fx(b[0], Pd[0], Pd[1], Ps[0], Ps[1]), fx(b[1], Pd[0], Pd[1], Ps[0], Ps[1]), fx(b[2], Pd[2], Pd[3], Ps[2], Ps[3]), fx(b[3], Pd[2], Pd[3], Ps[2], Ps[3]), zs, zs];
        const p = mk({ s, d: b, a: win ? win[0] : parent.a, b: win ? win[1] : parent.b, pa: pal(r.cls), pb: pal(r.cls), aa: r.a, ab: r.a, ga: r.g, gb: r.g, o: r.ord, ps: 0, only: 'B', rB: r });
        decals(r, b, b, 'B', p.db);
        return addP(r, p);
      }
      const supports = (r, L) => L.find(s => s !== r && Math.abs(s.w[5] - r.w[4]) < 0.06 && s.w[0] - 0.01 <= (r.w[0] + r.w[1]) / 2 && (r.w[0] + r.w[1]) / 2 <= s.w[1] + 0.01 && s.w[2] - 0.01 <= (r.w[2] + r.w[3]) / 2 && (r.w[2] + r.w[3]) / 2 <= s.w[3] + 0.01);
      const later = [];
      for (const c of padNames) {
        const padPiece = pieceOf.get(padA[c])[0];
        const inCol = (L, f) => L.filter(r => !r.part.startsWith('pad:') && f(r) && colOf(r.l) === c);
        // ---- the Tower side's buildings -> the rock ledges over this pad (floor k becomes ledge k)
        const topA = inCol(Ab, r => r.part !== 'ice'), iceB = inCol(Bb, r => r.part === 'ice').sort((x, y) => x.l[4] - y.l[4]);
        const nL = iceB.length;
        const bld = topA.filter(r => !/^(stair|bal)/.test(r.part)); // steps and railings are never a floor
        if (bld.length && nL) {
          const tower = bld.filter(r => r.part === 'tower');
          const stack = (tower.length ? tower : [bld.reduce((x, y) => vol(y.l) > vol(x.l) ? y : x)]).slice().sort((x, y) => x.l[4] - y.l[4]);
          let floors = stack.filter(r => Math.min(r.l[1] - r.l[0], r.l[3] - r.l[2]) >= 1.5);
          if (!floors.length) floors = [stack.reduce((x, y) => vol(y.l) > vol(x.l) ? y : x)];
          if (floors.length > nL) floors = floors.slice().sort((x, y) => vol(y.l) - vol(x.l)).slice(0, nL).sort((x, y) => x.l[4] - y.l[4]);
          let fl = floors.map(r => ({ r, b: r.l }));
          while (fl.length < nL) { // slice the tallest floor into two, until there is a floor for every ledge
            let t = 0; fl.forEach((f, k) => { if (f.b[5] - f.b[4] > fl[t].b[5] - fl[t].b[4]) t = k; });
            const f = fl[t], m = (f.b[4] + f.b[5]) / 2;
            fl.splice(t, 1, { r: f.r, b: [...f.b.slice(0, 4), f.b[4], m] }, { r: f.r, b: [...f.b.slice(0, 4), m, f.b[5]] });
          }
          const W = K.floors, host = [];
          fl.forEach((f, k) => {
            const q = iceB[k], rr = nL > 1 ? (nL - 1 - k) / (nL - 1) : 0, a = W.from + W.stagger * rr;
            const p = mk({ s: f.b, d: q.l, a, b: a + W.span, pa: pal(f.r.cls), pb: pal(q.cls), ab: q.a, gb: q.g, o: f.r.ord, rA: f.r, rB: q });
            decals(f.r, f.b, f.b, 'A', p.da);
            host.push(addP(f.r, p));
          });
          // everything else on the pad sinks into the ledge nearest it
          for (const r of topA) {
            if (fl.some(f => f.r === r)) continue;
            const cc = ctr(r.l); let h = host[0], bd = 1e9;
            host.forEach(p => { const d = dist(cc, p.s); if (d < bd - 1e-6) { bd = d; h = p; } });
            const D = h.d, e = r.l, g = 0.5;
            let s = [Math.max(e[0], D[0]) + g, Math.min(e[1], D[1]) - g, Math.max(e[2], D[2]) + g, Math.min(e[3], D[3]) - g, D[4] + g, D[5] - g];
            if (s[1] - s[0] < 0.2 || s[3] - s[2] < 0.2) { const m = ctr(D); s = [m[0] - .1, m[0] + .1, m[1] - .1, m[1] + .1, m[2] - .1, m[2] + .1]; }
            if (s[5] - s[4] < 0.2) { const m = (D[4] + D[5]) / 2; s[4] = m - .1; s[5] = m + .1; }
            const p = mk({ s: r.l, d: s, a: h.a, b: h.b, pa: pal(r.cls), pb: h.pb, ab: h.ab, gb: h.gb, o: r.ord, rA: r, extra: 1 });
            decals(r, r.l, r.l, 'A', p.da);
            addP(r, p);
          }
        } else {
          iceB.forEach(q => later.push(() => child(padPiece, q)));
          topA.forEach(r => { const p = mk({ s: r.l, d: [...r.l.slice(0, 4), r.l[4], r.l[4]], a: pw[0], b: pw[1], pa: pal(r.cls), pb: pal(r.cls), o: r.ord, only: 'A', rA: r }); decals(r, r.l, r.l, 'A', p.da); addP(r, p); });
        }
        // ---- the rock ledges under this pad -> the apartment blocks on the other side (ledges shared out by height)
        const iceA = inCol(Ab, r => r.part === 'ice').sort((x, y) => y.l[5] - x.l[5]);
        const topB = inCol(Bb, r => r.part !== 'ice');
        const blocks = topB.filter(r => r.part === 'apt' && (supports(r, Bb) || {}).part === padB[c].part).sort((x, y) => (x.w[5] - x.w[4]) - (y.w[5] - y.w[4]));
        const m = iceA.length, kk = blocks.length, T = K.towers;
        const cnt = blocks.map(() => 0);
        if (kk && m >= kk) {
          const hs = blocks.map(r => r.w[5] - r.w[4]), sum = hs.reduce((x, y) => x + y, 0), raw = hs.map(h => h / sum * m);
          raw.forEach((v, k) => cnt[k] = Math.max(1, Math.floor(v)));
          while (cnt.reduce((x, y) => x + y, 0) > m) { let t = -1; cnt.forEach((v, k) => { if (v > 1 && (t < 0 || raw[k] - v < raw[t] - cnt[t])) t = k; }); if (t < 0) break; cnt[t]--; }
          while (cnt.reduce((x, y) => x + y, 0) < m) { let t = 0; cnt.forEach((v, k) => { if (raw[k] - v > raw[t] - cnt[t]) t = k; }); cnt[t]++; }
        } else for (let k = kk - m; k < kk; k++) if (k >= 0) cnt[k] = 1;
        let li = 0;
        blocks.forEach((r, bi) => {
          if (!cnt[bi]) { later.push(() => child(padPiece, r)); return; }
          slabsZ(r.l, cnt[bi], true).forEach((sl, q) => {
            const L = iceA[li++], a = T.from + T.stagger * (cnt[bi] > 1 ? q / (cnt[bi] - 1) : 0) + T.blocks * (kk > 1 ? bi / (kk - 1) : 0);
            const p = mk({ s: L.l, d: sl, a, b: Math.min(1, a + T.span), pa: pal(L.cls), pb: pal(r.cls), aa: L.a, ga: L.g, o: L.ord, rA: L, rB: r, outer: q === cnt[bi] - 1 });
            decals(L, L.l, L.l, 'A', p.da); decals(r, sl, sl, 'B', p.db);
            addP(L, p); if (!pieceOf.has(r)) pieceOf.set(r, []); pieceOf.get(r).push(p);
          });
        });
        // ledges with nothing to become fold up into the pad
        for (; li < m; li++) {
          const L = iceA[li], z = padB[c].l[4] + 0.3, R = K.retract;
          const p = mk({ s: L.l, d: [L.l[0], L.l[1], L.l[2], L.l[3], z, z], a: R[0], b: R[1], pa: pal(L.cls), pb: pal(L.cls), aa: L.a, ab: L.a, ga: L.g, gb: L.g, o: L.ord, only: 'A', rA: L });
          decals(L, L.l, L.l, 'A', p.da); addP(L, p);
        }
        // stairs, balustrades: they grow out of the pad
        topB.filter(r => r.part !== 'apt').forEach(r => later.push(() => child(padPiece, r)));
      }
      later.forEach(f => f());
      // boxes that stand on another box of side B: a roof slab on a block, a crown on the roof
      let left = Bb.filter(r => !pieceOf.has(r)), guard = 0;
      while (left.length && guard++ < 20) {
        for (const r of left) {
          const s = supports(r, Bb), ps = s && pieceOf.get(s);
          if (!ps) continue;
          const top = ps.find(p => p.outer) || ps[ps.length - 1];
          child(top, r);
        }
        left = Bb.filter(r => !pieceOf.has(r));
      }
      // ---- everything that rides on a box: roofs, ridges, sprites, dots, the fountain
      const onPiece = (S, r) => {
        const L = S === 'A' ? A : B, pb = L[r.par], ps = pb && pieceOf.get(pb);
        if (!ps) return null;
        const zref = r.t === 'p' || r.t === 'l' ? r.p.reduce((s, v) => s + v[2], 0) / r.p.length : r.a[2];
        const zl = S === 'A' ? zref : 2 * mz - zref;
        return ps.find(p => { const b = S === 'A' ? p.s : p.d; return zl >= b[4] - 1e-6 && zl <= b[5] + 1e-6; }) || ps.reduce((x, y) => { const bx = S === 'A' ? x.s : x.d, by = S === 'A' ? y.s : y.d; return (S === 'A' ? by[5] > bx[5] : by[4] < bx[4]) ? y : x; });
      };
      const fr3 = (v, b) => [(v[0] - b[0]) / (b[1] - b[0] || 1), (v[1] - b[2]) / (b[3] - b[2] || 1), (v[2] - b[4]) / (b[5] - b[4] || 1)];
      for (const S of ['A', 'B']) for (const r of (S === 'A' ? A : B)) {
        if (r.t === 'b') continue;
        const p = onPiece(S, r); if (!p) continue;
        const bx = S === 'A' ? p.s : p.d, loc = S === 'A' ? v => v : Ep, F = v => fr3(loc(v), bx);
        const q = { t: r.t, S, ord: r.ord };
        if (r.t === 'p' || r.t === 'l') {
          q.f = r.p.map(F); q.c = hex(CLS[r.c] || '#ff00ff'); q.cls = r.c; q.w = r.w || 0.6; q.al = ALPHA[r.c] == null ? 1 : ALPHA[r.c];
          if (r.t === 'p') {
            // the plane's normal (outward: away from the box it rides on) and its triangles in its own plane
            const P3 = r.p.map(loc); let nx = 0, ny = 0, nz = 0;
            for (let k = 0; k < P3.length; k++) { const a = P3[k], b = P3[(k + 1) % P3.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
            const nl = Math.hypot(nx, ny, nz) || 1, cc = ctr(bx), m0 = P3.reduce((s, v) => [s[0] + v[0] / P3.length, s[1] + v[1] / P3.length, s[2] + v[2] / P3.length], [0, 0, 0]);
            let N = [nx / nl, ny / nl, nz / nl]; if (N[0] * (m0[0] - cc[0]) + N[1] * (m0[1] - cc[1]) + N[2] * (m0[2] - cc[2]) < 0) N = N.map(v => -v);
            const ax = Math.abs(N[0]) > Math.abs(N[1]) && Math.abs(N[0]) > Math.abs(N[2]) ? 0 : Math.abs(N[1]) > Math.abs(N[2]) ? 1 : 2, u = (ax + 1) % 3, w = (ax + 2) % 3;
            const t2 = tri(P3.map((v, k) => [v[u], v[w], k])), fl = [];
            for (const pt of t2) fl.push(...q.f[pt[2]]);
            q.tri = new Float32Array(fl); q.n = N;
            const T3 = TRI[r.c]; q.pal = T3 && T3.map(col); q.rest = q.pal ? q.c.map((v, k) => v - shade(q.pal, S === 'A' ? N : [-N[0], N[1], -N[2]])[k]) : null;
          }
        } else if (r.t === 's') {
          q.fa = F(r.a); q.c0 = scr(r.a);
          q.sh = shapes(r.svg).map(s => { const t = []; for (const poly of s.polys) for (const v of tri(poly)) t.push(v[0], v[1]); return { c: hex(CLS[s.c] || '#ff00ff'), blink: s.c === 'glint', t: new Float32Array(t) }; });
        } else if (r.t === 'd') { q.fa = F(r.a); q.set = r.set; q.c = hex(CLS.route || '#f6b85e'); }
        else if (r.t === 'c' || r.t === 'e') {
          const nS = 48, ring3 = [], a = r.a;
          const s2 = Math.SQRT1_2;
          for (let k = 0; k < nS; k++) { const t = 2 * Math.PI * k / nS; ring3.push(r.t === 'c' ? [a[0] + r.r * Math.cos(t), a[1] + r.r * Math.sin(t)] : [a[0] + (r.ra * Math.cos(t) + r.rb * Math.sin(t)) * s2, a[1] + (-r.ra * Math.cos(t) + r.rb * Math.sin(t)) * s2]); }
          q.fa = F(r.t === 'c' ? a : a);
          if (r.t === 'c') { q.lo = ring3.map(v => F([v[0], v[1], a[2]])); q.hi = ring3.map(v => F([v[0], v[1], a[2] + r.h])); q.cs = col(r.c[0]); q.ct = col(r.c[1]); q.pal = TRI[r.c[0]].map(col);
            q.fh = F([a[0], a[1], a[2] + r.h]); q.rest = ring3.map((v, k) => { const t = 2 * Math.PI * (k + .5) / nS, N = [Math.cos(t), Math.sin(t), 0]; return q.cs.map((c, m) => c - shade(q.pal, N)[m]); }); }
          else { q.ring = ring3.map(v => F([v[0], v[1], a[2]])); q.c = col(r.c); q.al = ALPHA[r.c] == null ? 1 : ALPHA[r.c]; }
        }
        p.pr.push(q);
      }
      // ---- when each piece's colour turns: as its middle passes the pivot's height
      for (const p of parts) {
        p.ps = 0.5;
        let s0 = 0;
        for (let k = 0; k <= 100; k++) {
          const t = k / 100, m = sstep(p.a, p.b, t), c = ctr(p.s.map((v, q) => lerp(v, p.d[q], m))), R = rot(t).m;
          const z = R[6] * (c[0] - PIV[0]) + R[7] * (c[1] - PIV[1]) + R[8] * (c[2] - PIV[2]);
          if (k === 0) { s0 = Math.sign(z); if (Math.abs(z) < 1) break; continue; }
          if (Math.sign(z) !== s0) { p.ps = t; break; }
        }
        p.ps = Math.min(1 - K.swap - 1e-3, Math.max(K.swap + 1e-3, p.ps)); // exact colours at both rests
      }
      return { A: A.length, B: B.length, parts: parts.length };
    }
    // ---- the turn: a roll over the island's long axis and a half spin, together a turn round a slanted axis
    function rot(p) {
      const e = (k, x) => { const w = K[k]; return sstep(w.from, w.to, x); };
      const th = K.roll.dir * Math.PI * e('roll', p), ph = K.spin.dir * Math.PI * e('spin', p);
      const ct = Math.cos(th), sn = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph), bump = Math.sin(Math.PI * clamp(p)), fe = sstep(0, 1, p);
      return { m: [cp, -sp * ct, sp * sn, sp, cp * ct, -cp * sn, 0, sn, ct], t: [PIV[0] - FIX[0] * fe, PIV[1], PIV[2] + K.lift * bump - FIX[1] * fe], sc: 1 - K.shrink * bump };
    }
    // ---- one frame's triangles, in buckets: opaque, one per see-through rock level, and see-through extras
    function Bucket() { return { f: new Float32Array(6144), c: new Uint8ClampedArray(4096), n: 0, d: 0, dn: 0 }; }
    let BK = { o: Bucket(), t: Bucket() }, GR = new Map();
    function grow(b) { const f = new Float32Array(b.f.length * 2); f.set(b.f); b.f = f; const c = new Uint8ClampedArray(b.c.length * 2); c.set(b.c); b.c = c; }
    function vtx(b, x, y, s, o, l, c, a) {
      if ((b.n + 1) * 5 > b.f.length) grow(b);
      const i = b.n * 5, j = b.n * 4; b.f[i] = x; b.f[i + 1] = y; b.f[i + 2] = s; b.f[i + 3] = o; b.f[i + 4] = l;
      b.c[j] = c[0] * 255; b.c[j + 1] = c[1] * 255; b.c[j + 2] = c[2] * 255; b.c[j + 3] = a * 255; b.n++;
    }
    function frame(p, time) {
      const t0 = performance.now();
      for (const b of [BK.o, BK.t]) b.n = 0;
      GR.forEach(b => { b.n = 0; b.d = 0; b.dn = 0; });
      const R = rot(p), m = R.m, sc = R.sc, CW = PR.CW, CH = PR.CH, U = PR.U = PR.u, bounds = [1e9, 1e9, -1e9, -1e9];
      const w = sstep(0, K.painter, p);
      const rotN = v => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
      const FNW = FN.map(rotN), vis = FNW.map(n => n[0] + n[1] + n[2] > 1e-5);
      // the path's shimmer and the fountain's glint, in step with the drawing's CSS (time: its animation clock)
      const walk = k => K.still ? 1 : pulse(time + [0, K.walk / 1.5, K.walk / 3][k], K.walk, .45), blink = K.still ? 1 : pulse(time, K.blink, .25);
      for (const P of parts) {
        const mm = sstep(P.a, P.b, p);
        if ((P.only === 'B' && mm <= 1e-4) || (P.only === 'A' && mm >= 1 - 1e-4)) continue;
        const lo = [0, 2, 4].map(q => lerp(P.s[q], P.d[q], mm)), hi = [1, 3, 5].map(q => lerp(P.s[q], P.d[q], mm));
        const dd = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        if (P.only === 'B' && dd[0] * dd[1] < 1e-6) continue;
        // f (fractions of the box) -> screen x, y and depth s = i + j + z, as one affine map for this frame
        const g0 = [0, 1, 2].map(r => R.t[r] + sc * (m[r * 3] * (lo[0] - PIV[0]) + m[r * 3 + 1] * (lo[1] - PIV[1]) + m[r * 3 + 2] * (lo[2] - PIV[2])));
        const Gm = [0, 1, 2].map(r => [0, 1, 2].map(q => sc * m[r * 3 + q] * dd[q]));
        const ax = [0, 1, 2].map(q => CW * (Gm[0][q] - Gm[1][q])), ay = [0, 1, 2].map(q => CH * (Gm[0][q] + Gm[1][q]) - U * Gm[2][q]), as = [0, 1, 2].map(q => Gm[0][q] + Gm[1][q] + Gm[2][q]);
        const bx = PR.X0 + CW * (g0[0] - g0[1]), by = PR.Y0 + CH * (g0[0] + g0[1]) - U * g0[2], bs = g0[0] + g0[1] + g0[2];
        const X = (a, b, c) => bx + ax[0] * a + ax[1] * b + ax[2] * c, Y = (a, b, c) => by + ay[0] * a + ay[1] * b + ay[2] * c, S = (a, b, c) => bs + as[0] * a + as[1] * b + as[2] * c;
        const cb = sstep(P.ps - K.swap, P.ps + K.swap, p), al = lerp(P.aa, P.ab, cb), gk = cb < .5 ? (P.ga ? 'A' + P.ga : '') : (P.gb ? 'B' + P.gb : '');
        let bk = BK.o;
        if (al < .999) { if (gk) { if (!GR.has(gk)) GR.set(gk, Bucket()); bk = GR.get(gk); } else bk = BK.t; }
        const mid = S(.5, .5, .5), ord0 = P.o[0];
        bk.d += lerp(1 - 2 * (ord0 + 1) / (NORD + 2), -(mid - K.s0) / K.depth, w); bk.dn++;
        const kA = sstep(K.out[0], K.out[1], mm);
        const faceCol = [];
        for (let fi = 0; fi < 6; fi++) {
          if (!vis[fi]) continue;
          const n = FNW[fi], cA = shade(P.pa, n), cB = shade(P.pb, n), c = [0, 1, 2].map(k => lerp(cA[k], cB[k], cb));
          faceCol[fi] = { c, rA: lum(cA) / lum(shade(P.pa, FN[fi])), rB: lum(cB) / lum(shade(P.pb, [-FN[fi][0], FN[fi][1], -FN[fi][2]])) };
          // a face the still drawing leaves out (the iceberg's ledge tops) comes in as the turn starts
          let fb = bk, fa = al;
          if (P.rA && P.rA.h && FL[fi] && P.rA.h.includes(FL[fi])) { const k = sstep(K.faces[0], K.faces[1], p); if (k <= 0) continue; if (k < 1) { fb = BK.t; fa = al * k; } }
          const q = FQ[fi], o = P.o[fi];
          const v = q.map(f => [X(f[0], f[1], f[2]), Y(f[0], f[1], f[2]), S(f[0], f[1], f[2])]);
          for (const [a, b2, c2] of [[0, 1, 2], [0, 2, 3]]) for (const k of [a, b2, c2]) vtx(fb, v[k][0], v[k][1], v[k][2], o, 0, c, fa);
          for (const u of v) { if (u[0] < bounds[0]) bounds[0] = u[0]; if (u[1] < bounds[1]) bounds[1] = u[1]; if (u[0] > bounds[2]) bounds[2] = u[0]; if (u[1] > bounds[3]) bounds[3] = u[1]; }
        }
        // the details: side A's go dark into the face as the piece moves off; side B's come on floor by floor
        const dec = (list, isA) => {
          for (const d of list) {
            const fcd = faceCol[d.fc]; if (!fcd) continue;
            let k, c;
            if (isA) { k = sstep(K.out[0] + K.out[2] * (1 - d.row), K.out[1] + K.out[2] * (1 - d.row), mm); if (k >= 1) continue; c = d.c.map((v, q) => lerp(Math.min(1, v * fcd.rA), fcd.c[q], k)); }
            else { const L = K.lights; k = sstep(L[0] + L[2] * d.row, L[1] + L[2] * d.row, mm); if (k <= 0) continue; c = d.c.map((v, q) => lerp(fcd.c[q], Math.min(1, v * fcd.rB), k)); }
            const b = d.blink ? BK.t : bk, a = d.blink ? al * blink : al, f = d.f;
            for (let q = 0; q < f.length; q += 3) vtx(b, X(f[q], f[q + 1], f[q + 2]), Y(f[q], f[q + 1], f[q + 2]), S(f[q], f[q + 1], f[q + 2]), d.ord, 1, c, a);
          }
        };
        if (P.da.length && kA < 1) dec(P.da, true);
        if (P.db.length) dec(P.db, false);
        // what rides on the piece: A's shrink and settle onto it, B's (the trees) grow at the end
        const topC = faceCol[0] ? faceCol[0].c : shade(P.pa, FNW[0]);
        for (const q of P.pr) {
          const kq = q.S === 'A' ? sstep(K.prim[0], K.prim[1], mm) : 1 - sstep(K.trees[0], K.trees[1], mm);
          if (kq >= 1) continue;
          const shr = (f, fa) => [fa[0] + (f[0] - fa[0]) * (1 - kq), fa[1] + (f[1] - fa[1]) * (1 - kq), f[2] > 1 ? 1 + (f[2] - 1) * (1 - kq) : f[2]];
          const tb = q.al != null && q.al < 1 ? BK.t : bk;
          if (q.t === 'p') {
            const n = rotN(q.S === 'A' ? q.n : q.n); if (n[0] + n[1] + n[2] <= 1e-5) continue;
            let c = q.pal ? shade(q.pal, n).map((v, k) => clamp(v + q.rest[k])) : q.c;
            c = c.map((v, k) => lerp(v, topC[k], kq));
            const f = q.tri;
            for (let k = 0; k < f.length; k += 3) { const g = q.S === 'A' ? [f[k], f[k + 1], f[k + 2] > 1 ? 1 + (f[k + 2] - 1) * (1 - kq) : f[k + 2]] : [f[k], f[k + 1], f[k + 2]]; vtx(tb, X(...g), Y(...g), S(...g), q.ord, 1, c, al * (q.al ?? 1) * (q.al < 1 ? 1 - kq : 1)); }
          } else if (q.t === 'l') {
            const pts = q.f.map(f => { const g = [f[0], f[1], f[2] > 1 ? 1 + (f[2] - 1) * (1 - kq) : f[2]]; return [X(...g), Y(...g), S(...g)]; }), hw = q.w / 2 * (1 - kq) * sc;
            const c = q.c.map((v, k) => lerp(v, topC[k], kq));
            for (let k = 1; k < pts.length; k++) {
              const a = pts[k - 1], b = pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * hw, ny = ux * hw;
              const ea = k > 1 ? hw : 0, eb = k < pts.length - 1 ? hw : 0; // square ends at the joins stand in for round ones
              const A0 = [a[0] - ux * ea + nx, a[1] - uy * ea + ny], A1 = [a[0] - ux * ea - nx, a[1] - uy * ea - ny], B0 = [b[0] + ux * eb + nx, b[1] + uy * eb + ny], B1 = [b[0] + ux * eb - nx, b[1] + uy * eb - ny];
              for (const [v, s] of [[A0, a[2]], [B0, b[2]], [B1, b[2]], [A0, a[2]], [B1, b[2]], [A1, a[2]]]) vtx(bk, v[0], v[1], s, q.ord, 2, c, al);
            }
          } else if (q.t === 's' || q.t === 'd') {
            const x = X(...q.fa), y = Y(...q.fa), s = S(...q.fa) + K.spriteLift, k = (1 - kq) * sc;
            if (q.t === 'd') {
              const r = DOT / 2 * k, cy = y - DOT * 0.35 * k, a = walk(q.set) * al;
              for (let e = 0; e < 16; e++) { const t1 = e / 16 * 2 * Math.PI, t2 = (e + 1) / 16 * 2 * Math.PI; vtx(BK.t, x, cy, s, q.ord, 2, q.c, a); vtx(BK.t, x + r * Math.cos(t1), cy + r * Math.sin(t1), s, q.ord, 2, q.c, a); vtx(BK.t, x + r * Math.cos(t2), cy + r * Math.sin(t2), s, q.ord, 2, q.c, a); }
            } else for (const sh of q.sh) {
              const b = sh.blink ? BK.t : bk, a = sh.blink ? al * blink : al;
              for (let e = 0; e < sh.t.length; e += 2) vtx(b, x + (sh.t[e] - q.c0[0]) * k, y + (sh.t[e + 1] - q.c0[1]) * k, s, q.ord, 2, sh.c, a);
            }
          } else if (q.t === 'c') {
            const nS = q.lo.length;
            for (let e = 0; e < nS; e++) {
              const t = 2 * Math.PI * (e + .5) / nS, n = rotN([Math.cos(t), Math.sin(t), 0]); if (n[0] + n[1] + n[2] <= 1e-5) continue;
              const c = shade(q.pal, n).map((v, k) => lerp(clamp(v + q.rest[e][k]), topC[k], kq));
              const P4 = [q.lo[e], q.lo[(e + 1) % nS], q.hi[(e + 1) % nS], q.hi[e]].map(f => shr(f, q.fa)).map(g => [X(...g), Y(...g), S(...g)]);
              for (const k of [0, 1, 2, 0, 2, 3]) vtx(bk, P4[k][0], P4[k][1], P4[k][2], q.ord, 1, c, al);
            }
            const nt = rotN([0, 0, 1]);
            if (nt[0] + nt[1] + nt[2] > 1e-5) { const c = shade(q.pal, nt).map((v, k) => lerp(clamp(v + q.ct[k] - q.pal[0][k]), topC[k], kq)), cc = shr(q.fh, q.fa), C3 = [X(...cc), Y(...cc), S(...cc)];
              for (let e = 0; e < nS; e++) { const a = shr(q.hi[e], q.fa), b = shr(q.hi[(e + 1) % nS], q.fa); vtx(bk, C3[0], C3[1], C3[2], q.ord + 1, 1, c, al); vtx(bk, X(...a), Y(...a), S(...a), q.ord + 1, 1, c, al); vtx(bk, X(...b), Y(...b), S(...b), q.ord + 1, 1, c, al); } }
          } else if (q.t === 'e') {
            const nt = rotN([0, 0, 1]); if (nt[0] + nt[1] + nt[2] <= 1e-5) continue;
            const nS = q.ring.length, fa = q.fa, cc = shr(fa, fa), C3 = [X(...cc), Y(...cc), S(...cc)], b = q.al < 1 ? BK.t : bk, a = al * q.al;
            for (let e = 0; e < nS; e++) { const u = shr(q.ring[e], fa), v = shr(q.ring[(e + 1) % nS], fa); vtx(b, C3[0], C3[1], C3[2], q.ord, 1, q.c, a); vtx(b, X(...u), Y(...u), S(...u), q.ord, 1, q.c, a); vtx(b, X(...v), Y(...v), S(...v), q.ord, 1, q.c, a); }
          }
        }
      }
      const groups = [...GR.values()].filter(b => b.n).sort((a, b) => b.d / b.dn - a.d / a.dn); // far (larger depth) first
      const cpu = performance.now() - t0;
      return { w, groups, bounds, cpu, n: BK.o.n + BK.t.n + groups.reduce((s, b) => s + b.n, 0) };
    }
    // ---- WebGL2
    function setup() {
      const ss = K.aa > 1; // with jittered passes the scene draws into its own targets, not the canvas's
      gl = cv.getContext('webgl2', { antialias: !ss && K.msaa !== false, alpha: true, premultipliedAlpha: true, depth: !ss, stencil: !ss });
      if (!gl) throw new Error('no WebGL2');
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pg = gl.createProgram();
      gl.attachShader(pg, sh(gl.VERTEX_SHADER, `#version 300 es
invariant gl_Position;
in vec3 aP; in vec2 aO; in vec4 aC; uniform vec4 uBox; uniform vec4 uD; uniform float uW; uniform vec2 uJ; out vec4 vC;
void main() {
  float zt = -(aP.z - uD.x) * uD.y - aO.y * uD.z, zp = 1.0 - 2.0 * (aO.x + 1.0) / (uD.w + 2.0);
  gl_Position = vec4((aP.x - uBox.x) / uBox.z * 2.0 - 1.0 + uJ.x, 1.0 - (aP.y - uBox.y) / uBox.w * 2.0 + uJ.y, mix(zp, zt, uW), 1.0);
  vC = vec4(aC.rgb * aC.a, aC.a);
}`));
      gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; in vec4 vC; out vec4 o; void main() { o = vC; }`));
      gl.bindAttribLocation(pg, 0, 'aP'); gl.bindAttribLocation(pg, 1, 'aO'); gl.bindAttribLocation(pg, 2, 'aC');
      gl.linkProgram(pg);
      if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pg));
      const vf = gl.createBuffer(), vc = gl.createBuffer(), va = gl.createVertexArray();
      gl.bindVertexArray(va);
      gl.bindBuffer(gl.ARRAY_BUFFER, vf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, vc);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 4, 0);
      G = { pg, vf, vc, va, uBox: gl.getUniformLocation(pg, 'uBox'), uD: gl.getUniformLocation(pg, 'uD'), uW: gl.getUniformLocation(pg, 'uW'), uJ: gl.getUniformLocation(pg, 'uJ'), cap: 0 };
      if (ss) { // copies one target into another, scaled (a triangle over the whole target, no vertex data)
        const qp = gl.createProgram();
        gl.attachShader(qp, sh(gl.VERTEX_SHADER, `#version 300 es
void main() { gl_Position = vec4(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1), 0.0, 1.0); }`));
        gl.attachShader(qp, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; uniform highp sampler2D uT; uniform float uK; out vec4 o; void main() { o = texelFetch(uT, ivec2(gl_FragCoord.xy), 0) * uK; }`));
        gl.linkProgram(qp);
        if (!gl.getProgramParameter(qp, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(qp));
        G.qp = qp; G.uT = gl.getUniformLocation(qp, 'uT'); G.uK = gl.getUniformLocation(qp, 'uK'); G.qa = gl.createVertexArray();
        G.fx = gl.getExtension('EXT_color_buffer_float') ? gl.RGBA16F : gl.RGBA8;
        // the jitters: with the usual 4x MSAA pattern, K.aa passes put every sample on its own row and column
        const n = K.aa, perm = k => (k * (n > 2 ? n - 1 : 1) + (n >> 1)) % n;
        G.jit = Array.from({ length: n }, (_, k) => [((k + 0.5) / n - 0.5) / 4, ((perm(k) + 0.5) / n - 0.5) / 4]);
      }
    }
    // the supersampling targets at W x H: a multisampled scene, its resolve, and the sum of the passes
    function targets() {
      if (!G.qp) return;
      const T = G.T || (G.T = { ms: gl.createFramebuffer(), rf: gl.createFramebuffer(), af: gl.createFramebuffer() });
      if (T.w === W && T.h === H) return;
      [T.cb, T.db, T.rt, T.at].forEach(o => o && (o instanceof WebGLTexture ? gl.deleteTexture(o) : gl.deleteRenderbuffer(o)));
      const ns = K.msaa === false ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
      const rb = fmt => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ns, fmt, W, H); return r; };
      const tx = fmt => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, W, H); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
      T.cb = rb(gl.RGBA8); T.db = rb(gl.DEPTH24_STENCIL8); T.rt = tx(gl.RGBA8);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, T.cb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, T.db);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.rf); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.rt, 0);
      for (const f of [G.fx, gl.RGBA8]) { // the sum: half floats where the GPU can draw into them
        T.at = tx(f); gl.bindFramebuffer(gl.FRAMEBUFFER, T.af); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.at, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) break;
        gl.deleteTexture(T.at); T.at = null;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms);
      if (!T.at || gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('no render targets');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      T.w = W; T.h = H;
    }
    let F32 = new Float32Array(0), U8 = new Uint8Array(0);
    function draw(p, time) {
      const fr = frame(p, time);
      if (!gl || lost) return fr;
      const t0 = performance.now(), list = [BK.o, ...fr.groups, BK.t];
      const total = list.reduce((s, b) => s + b.n, 0);
      if (F32.length < total * 5) { F32 = new Float32Array(total * 10); U8 = new Uint8Array(total * 8); }
      let off = 0; const rng = list.map(b => { F32.set(b.f.subarray(0, b.n * 5), off * 5); U8.set(b.c.subarray(0, b.n * 4), off * 4); const r = [off, b.n]; off += b.n; return r; });
      gl.useProgram(G.pg); gl.bindVertexArray(G.va);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.vf); gl.bufferData(gl.ARRAY_BUFFER, F32.subarray(0, total * 5), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.vc); gl.bufferData(gl.ARRAY_BUFFER, U8.subarray(0, total * 4), gl.STREAM_DRAW);
      gl.uniform4f(G.uBox, box[0], box[1], box[2], box[3]); gl.uniform4f(G.uD, K.s0, 1 / K.depth, K.bias / K.depth, NORD); gl.uniform1f(G.uW, fr.w);
      gl.viewport(0, 0, W, H);
      if (!G.qp) { gl.uniform2f(G.uJ, 0, 0); scene(fr, rng); }
      else { // K.aa passes, each nudged by a fraction of a pixel, averaged: the drawing's smooth edges
        targets();
        const T = G.T, n = G.jit.length;
        G.jit.forEach(([jx, jy], k) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms); gl.useProgram(G.pg); gl.bindVertexArray(G.va); gl.uniform2f(G.uJ, 2 * jx / W, -2 * jy / H);
          scene(fr, rng);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.rf);
          gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.bindFramebuffer(gl.FRAMEBUFFER, T.af); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST);
          if (k) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); } else gl.disable(gl.BLEND);
          copy(T.rt, 1 / n);
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.BLEND);
        copy(T.at, 1);
      }
      fr.cpu += performance.now() - t0;
      ms.push(+fr.cpu.toFixed(2)); if (ms.length > 600) ms.shift();
      return fr;
    }
    function copy(t, k) {
      gl.useProgram(G.qp); gl.bindVertexArray(G.qa); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(G.uT, 0); gl.uniform1f(G.uK, k); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // the scene into whatever target is bound: opaque, then each see-through rock level as one layer, then the rest
    function scene(fr, rng) {
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clearStencil(0); gl.depthMask(true); gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      // LEQUAL: of two things at one depth the later wins, as in the drawing's paint order
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
      if (rng[0][1]) gl.drawArrays(gl.TRIANGLES, rng[0][0], rng[0][1]);
      // a see-through rock level fades as ONE layer, like the drawing's <g opacity>: its nearest surface only
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      fr.groups.forEach((g, k) => {
        const [o, c] = rng[k + 1];
        gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
        gl.drawArrays(gl.TRIANGLES, o, c);
        gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(gl.EQUAL); gl.enable(gl.BLEND);
        gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.NOTEQUAL, k + 1, 255); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.drawArrays(gl.TRIANGLES, o, c);
      });
      gl.disable(gl.STENCIL_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.enable(gl.BLEND); gl.colorMask(true, true, true, true);
      const [o, c] = rng[rng.length - 1]; if (c) gl.drawArrays(gl.TRIANGLES, o, c);
      gl.depthMask(true);
    }
    const clock = t => walk0 + (t - tInit) / 1000;
    function loop() {
      raf = 0;
      if (!run) return;
      const t = now();
      let p = run.p0 + run.dir * (t - run.t0) / (K.time * 1000);
      const done = run.dir > 0 ? p >= 1 : p <= 0;
      p = clamp(p); run.p = p;
      draw(p, clock(t)); ts.push(t); if (ts.length > 600) ts.shift();
      if (done) { run = null; postMessage({ rest: p }); }
      else raf = requestAnimationFrame(loop);
    }
    // a posed frame is on screen once the frame after it has begun
    const shown = f => requestAnimationFrame(() => requestAnimationFrame(f));
    onmessage = ({ data }) => {
      try {
        if (data.init) {
          ({ K, cls: CLS, alpha: ALPHA, proj: PR } = data.init); box = data.box;
          walk0 = data.init.time || 0; tInit = now();
          const info = build(data.init.model);
          if (data.canvas) {
            cv = data.canvas;
            cv.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; run = null; postMessage({ lost: 1 }); });
            setup();
            W = cv.width = data.w; H = cv.height = data.h;
            draw(data.init.p || 0, clock(now()));
            shown(() => postMessage({ ready: info }));
          } else postMessage({ ready: info });
        } else if (data.go) { run = { t0: data.go.t0, p0: data.go.p0, dir: data.go.dir }; if (!raf) raf = requestAnimationFrame(loop); }
        else if (data.at != null) { run = null; const fr = draw(data.at, data.time != null ? data.time : clock(now())); shown(() => postMessage({ at: data.at, cpu: fr.cpu, n: fr.n })); }
        else if (data.probe != null) { const fr = frame(data.probe, 0); postMessage({ probe: data.probe, bounds: fr.bounds, cpu: fr.cpu, n: fr.n }); }
        else if (data.w) { W = cv.width = data.w; H = cv.height = data.h; box = data.box; if (!run) draw(data.p || 0, clock(now())); }
        else if (data.stats) postMessage({ stats: ms.slice(), ts: ts.slice() });
      } catch (e) { postMessage({ fail: String(e && e.stack || e) }); }
    };
  }
  // Wire the tap. The canvas covers the whole drawing inside the main island's
  // float, so it bobs with it; it shows only while the island is off the Tower
  // side. Its swap with the still drawing and the halo's fade are Web Animations
  // on the page's clock; the worker runs the turn on the same clock. Reduced
  // motion: the two still sides crossfade instead (ISLAND.fade). The handle goes
  // on the stack as .flip: toggle(), at(p) (holds the turn at p, 0-1, and
  // resolves once the worker has drawn it), state, ready, stats().
  function startIsland(stack) {
    const btn = stack && stack.querySelector('.mvh-flip'), main = stack && stack.querySelector('.mvh-main'), art = main && main.querySelector('.mvh-a');
    if (!btn || !art) return null;
    const M = ART_BOX.main, still = matchMedia('(prefers-reduced-motion: reduce)').matches, dur = (still ? ISLAND.fade : ISLAND.time) * 1000;
    const cv = document.createElement('canvas');
    cv.className = 'mvh-isl';
    main.append(cv);
    // The canvas sits a whole number of device pixels off the main island's own
    // box (the still drawing's layer), so both land on the same pixel grid and
    // the compositor treats them alike; the worker draws the drawing at its exact
    // scale inside it. It spans the whole drawing's box, with a pixel to spare,
    // so the turn has room.
    const size = () => {
      const d = devicePixelRatio || 1, s = stack.getBoundingClientRect(), kx = s.width * d / ART_W || 1, ky = s.height * d / ART_H || 1;
      const L = Math.ceil(M[0] * kx) + 1, T = Math.ceil(M[1] * ky) + 1, W = L + Math.ceil((ART_W - M[0]) * kx) + 1, H = T + Math.ceil((ART_H - M[1]) * ky) + 1;
      Object.assign(cv.style, { left: -L / d + 'px', top: -T / d + 'px', width: W / d + 'px', height: H / d + 'px' });
      return { w: W, h: H, box: [M[0] - L / kx, M[1] - T / ky, W / kx, H / ky] };
    };
    // again at every tap, and only if it moved (the stack's box can move without resizing)
    let last = '';
    const sync = () => { const z = size(), k = JSON.stringify(z); if (k !== last && w) { last = k; w.postMessage({ ...z, p: still ? 1 : progress() }); } };
    let w = null, ro = null, alive = 0, ready = false, pending = false, dir = -1, anims = [], readyRes;
    const atQ = [], statQ = [], readyP = new Promise(r => { readyRes = r; });
    // back to the still drawing for good: no worker, no canvas, no tap target
    const fail = () => {
      if (w) w.terminate(); w = null; if (ro) ro.disconnect(); clearInterval(alive);
      anims.forEach(a => a.cancel()); anims = []; cv.remove(); btn.remove(); stack.classList.remove('mvh-show');
      atQ.splice(0).forEach(r => r(false)); readyRes(false); if (stack.flip === handle) stack.flip = null;
    };
    try { w = new Worker(URL.createObjectURL(new Blob([`(${islandWorker})()`], { type: 'text/javascript' }))); }
    catch (e) { cv.remove(); btn.remove(); return null; }
    // the path's shimmer and the glint run in CSS; the worker keeps in step with their clock
    const css = stack.querySelector('.mvh-main .route .w0'), ca = css && css.getAnimations ? css.getAnimations()[0] : null;
    const { cls, alpha } = artClasses();
    const K = Object.assign({}, ISLAND, { walk: parseFloat(ART['route-walk']), blink: parseFloat(ART['glint-blink']), still });
    try {
      const off = cv.transferControlToOffscreen(), z = size();
      last = JSON.stringify(z);
      w.postMessage({ init: { K, cls, alpha, proj: ART_PROJ, model: ART_MODEL, time: ca && ca.currentTime ? ca.currentTime / 1000 : 0, p: still ? 1 : 0 }, canvas: off, ...z }, [off]);
    } catch (e) { fail(); return null; }
    const swap = (a, b) => still ? [{ opacity: a }, { opacity: b }] : [{ opacity: a }, { opacity: a, offset: 1e-4 }, { opacity: b, offset: 1e-4 }, { opacity: b }];
    const H = ISLAND.halo, halo = still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1 }, { opacity: 1, offset: H[0] }, { opacity: 0, offset: H[1] }, { opacity: 0 }];
    anims = [[art, swap(1, 0)], [cv, swap(0, 1)], [stack.querySelector('.mvh-glow'), halo]].filter(x => x[0]).map(([el, f]) => {
      const a = el.animate(f, { duration: dur, easing: 'linear', fill: 'both' }); a.pause(); a.currentTime = 0; return a;
    });
    const progress = () => anims.length ? Math.min(1, Math.max(0, (anims[0].currentTime || 0) / dur)) : 0;
    function toggle() {
      if (!w) return;
      if (!ready) { pending = !pending; return; }
      sync();
      dir = -dir;
      btn.setAttribute('aria-pressed', String(dir > 0));
      stack.classList.remove('mvh-show');
      const now = performance.now(), p0 = progress();
      anims.forEach(a => { a.playbackRate = dir; a.startTime = dir > 0 ? now - p0 * dur : now + p0 * dur; });
      if (!still) w.postMessage({ go: { t0: performance.timeOrigin + now, p0, dir } });
    }
    btn.addEventListener('click', toggle);
    w.onmessage = ({ data }) => {
      if (data.ready) { ready = true; readyRes(true); if (pending) { pending = false; toggle(); } }
      else if (data.at != null) { const r = atQ.shift(); if (r) r(true); }
      else if (data.stats) { const r = statQ.shift(); if (r) r(data); }
      else if (data.lost || data.fail) { if (data.fail) console.warn('[loader] island turn off:', data.fail); fail(); }
    };
    w.onerror = fail;
    ro = new ResizeObserver(sync); ro.observe(stack);
    // the veil is removed after the reveal: stop the worker with it
    alive = setInterval(() => { if (!cv.isConnected) fail(); }, 1000);
    const handle = {
      toggle, ready: readyP, canvas: cv,
      get state() { return { p: progress(), dir, ready, still, on: !!w }; },
      // hold the turn at p; time: the CSS clock for the shimmer (seconds); show: the canvas even at p = 0
      at(p, o = {}) {
        sync();
        anims.forEach(a => { a.pause(); a.currentTime = p * dur; });
        stack.classList.toggle('mvh-show', !!o.show);
        return !w ? Promise.resolve(false) : new Promise(r => { atQ.push(r); w.postMessage({ at: p, time: o.time }); });
      },
      stats: () => !w ? Promise.resolve(null) : new Promise(r => { statQ.push(r); w.postMessage({ stats: 1 }); })
    };
    return (stack.flip = handle);
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
    root.innerHTML=`<div class="load-story"><p class="load-eyebrow">${h('story.eyebrow')}</p><h1>${h('story.headline')}</h1><p class="load-subtitle">${h('story.subtitle')}</p>${cityArt()}<p class="load-caption">${h('story.caption')}</p></div><div class="load-card"><div class="load-heading"><h2>${h('card.title')}</h2><span id="load-percent">0%</span></div><div class="load-rail" role="progressbar" aria-label="${h('card.progress_aria')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p id="load-estimate"><span class="load-pre"></span><span class="load-run"><span class="load-odo" aria-hidden="true"><i></i><i></i></span><span class="load-num"></span><span class="load-post"></span></span></p><div id="load-stages"></div><div class="load-choice"><h3>${h('choice.title')}</h3><p>${h('choice.body')}</p><button type="button" id="load-modes">${h('choice.button')}</button><small>${h('choice.fine')}</small></div></div><footer>${h('story.footer')}</footer>`;
    veil.append(root);
    startTurn(root.querySelector('.mvh-stack'));
    startIsland(root.querySelector('.mvh-stack'));
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
    startClock();update();timer=setInterval(update,TUNE.pollMs);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();
