/**
 * loader.js — the load screen, and the one hard constraint it is built around.
 *
 * WHY THIS IS ALL CSS AND ALMOST NO JAVASCRIPT.
 *
 * The site takes ~20 s to become interactive and almost none of that is the
 * network: measured on the live site, all 44 requests and 2.2 MB finish by
 * 2.5 s. The rest is the main thread, flat out — parsing ~22 MB of GeoJSON
 * (6.3 MB of trees alone), generating the 128-tile facade atlas, and letting
 * MapLibre tile 12,000 trees, 7,625 outer-ring buildings and 12,058 roof
 * features.
 *
 * So the thread this screen would animate on is exactly the thread that is
 * blocked. A requestAnimationFrame loop here would sit frozen for seconds at a
 * time, which reads as a crashed page — strictly worse than no load screen at
 * all. Everything that MOVES is therefore a CSS animation on transform or
 * opacity, which the compositor runs on its own thread and which keeps going
 * smoothly while JS is stuck. JavaScript only ever sets a value at a stage
 * boundary, when the thread is briefly free anyway.
 *
 * The skyline is the favicon's three bars grown up: the mark is already a
 * little skyline, so the load screen is that motif at full size, lighting up
 * window by window as the real city assembles behind it.
 *
 * WHAT IS MEASURED AND WHAT IS PACED — the honest split.
 *
 *   The RAIL and the STATUS TEXT are real. Both are driven by app.js calling
 *   window.loaderStage(name) at each buildScene() boundary. No timers.
 *
 *   The SKYLINE is paced, and has to be. Instrumenting a real load shows all 26
 *   stages firing between 1678 ms and 1954 ms — the whole named build is 276 ms
 *   — while the veil does not lift until 9007 ms. Lighting a building per stage
 *   therefore flashes the entire city on at once and then leaves seven seconds
 *   of nothing. The buildings instead light on a CSS stagger spread across the
 *   real wait, which is also the only thing that can animate while the main
 *   thread is blocked.
 */
(function () {
  'use strict';

  // ── Taste block ─────────────────────────────────────────────────────
  const L = {
    BARS: 15,                 // one per weighted stage, plus the boot bar
    LIT_ROWS: 7,              // window rows in the tallest bar
    GLOW: 'rgba(245,166,35,.30)',
  };

  // The stages, in the order app.js runs them, with the share of the wait each
  // one owns. The weights are not guesses: they are the measured split, and the
  // three that dominate are the three with the most features — trees and props
  // (detail), the outer ring, and the roofscape. `boot` covers everything before
  // buildScene(): the fetch, the JSON parse and the style load.
  //
  // Heights are a skyline, not data — but the ORDER is the real build order, so
  // the bar that is rising is genuinely the thing being built.
  const STAGES = [
    ['boot',      22, 0.42],
    ['facades',    7, 0.70],
    ['buildings', 10, 0.95],
    ['ground',     5, 0.55],
    ['props',      9, 1.00],
    ['shadows',    4, 0.48],
    ['roofs',      7, 0.78],
    ['stadium',    3, 0.60],
    ['detail',    14, 0.88],
    ['capitol',    3, 0.52],
    ['labels',     2, 0.34],
    ['outer',      8, 0.92],
    ['sky',        2, 0.40],
    ['graphics',   2, 0.30],
    ['controls',   2, 0.26],
  ];
  // What each stage is actually doing, in words a person would use. Counts are
  // the real feature counts in data/, not decoration.
  const SAYS = {
    boot:      'Reading the city',
    facades:   'Drawing 128 facade textures',
    buildings: 'Raising 2,453 buildings',
    ground:    'Paving 3,117 surfaces',
    props:     'Placing 6,000 street props',
    shadows:   'Casting shadows',
    roofs:     'Fitting 12,058 roof details',
    stadium:   'Building DKR, band by band',
    detail:    'Planting 12,000 trees',
    capitol:   'Assembling the Capitol dome',
    labels:    'Naming the landmarks',
    outer:     'Sketching 7,625 buildings beyond',
    sky:       'Hanging the sky',
    graphics:  'Tuning the lens',
    controls:  'Handing you the controls',
  };

  const TOTAL = STAGES.reduce((s, x) => s + x[1], 0);
  let done = 0, idx = 0, el = null, fill = null, status = null, pct = null, bars = [];

  function build() {
    const veil = document.getElementById('veil');
    if (!veil) return false;
    const mark = document.getElementById('veil-mark');
    if (mark) mark.remove();          // replaced by the full skyline below

    el = document.createElement('div');
    el.id = 'veil-load';
    el.innerHTML =
      '<div id="vl-glow"></div>' +
      '<div id="vl-city"></div>' +
      '<div id="vl-ground"></div>' +
      '<div id="vl-foot">' +
        '<div id="vl-title">Austin 3D Explorer</div>' +
        '<div id="vl-rail"><i id="vl-fill"></i></div>' +
        '<div id="vl-row"><span id="vl-status">Reading the city</span><span id="vl-pct">0%</span></div>' +
      '</div>';
    veil.appendChild(el);

    const city = el.querySelector('#vl-city');
    for (let i = 0; i < STAGES.length; i++) {
      const b = document.createElement('div');
      b.className = 'vl-bar';
      b.style.setProperty('--h', (STAGES[i][2] * 100).toFixed(1) + '%');
      // Two staggers. --i paces when this building lights up, spread across the
      // real wait; --d offsets its window shimmer so the skyline never pulses in
      // unison. Both are consumed by CSS animations, never by JS.
      b.style.setProperty('--i', i);
      b.style.setProperty('--d', (i * 0.13).toFixed(2) + 's');
      const rows = Math.max(2, Math.round(STAGES[i][2] * L.LIT_ROWS));
      let win = '';
      for (let r = 0; r < rows; r++) win += '<i></i><i></i>';
      b.innerHTML = '<u></u><s>' + win + '</s>';
      city.appendChild(b);
      bars.push(b);
    }
    fill = el.querySelector('#vl-fill');
    status = el.querySelector('#vl-status');
    pct = el.querySelector('#vl-pct');
    return true;
  }

  // MEASURED, and it is not what the first cut of this file assumed.
  //
  // Instrumenting every stage boundary on a real load gives: the page spends
  // ~1.7 s fetching and parsing before buildScene() runs at all, then ALL 26
  // stages fire between 1678 ms and 1954 ms — the entire named build is 276
  // MILLISECONDS — and the veil does not lift until 9007 ms. So roughly 78% of
  // the wait is one block with no stages in it at all: MapLibre tiling and
  // rasterising everything buildScene just handed it, until the first idle frame.
  //
  // The first cut gave those 276 ms 88% of the bar and the seven-second block
  // 12%. That is a progress bar that sprints to 88% and then sits, which is the
  // single worst-looking state a progress bar has. The split below is the
  // measured one: stages take it to ~34%, and the long tail owns the rest.
  //
  // That tail is a CSS creep — one transform with a long transition, run by the
  // COMPOSITOR, so it keeps gliding through exactly the multi-second main-thread
  // blocks that would freeze anything driven from JS. It never reaches 100%:
  // only loaderDone(), on the real first frame, does that.
  const STAGE_SHARE = 0.34;
  const CREEP_TO = 0.97, CREEP_MS = 7600;   // ~= INTRO.maxVeilMs in app.js

  function paint() {
    const f = Math.min(1, done / TOTAL) * STAGE_SHARE;
    // Two style writes per stage. That is the entire per-frame JS cost of this
    // screen, and it is why it keeps animating while the thread is buried.
    if (fill) fill.style.transform = 'scaleX(' + f.toFixed(4) + ')';
    if (pct) pct.textContent = Math.round(f * 100) + '%';
  }

  function settle() {
    if (!fill) return;
    if (status) status.textContent = 'Drawing the first frame';
    fill.style.transitionDuration = CREEP_MS + 'ms';
    fill.style.transitionTimingFunction = 'cubic-bezier(.12,.7,.25,1)';
    fill.style.transform = 'scaleX(' + CREEP_TO + ')';
    // The number cannot ride the compositor, so it stops counting rather than
    // pretending to: a digit frozen mid-count reads as a hang, an ellipsis does
    // not.
    if (pct) pct.textContent = 'ALMOST';
  }

  /** Called by app.js at each stage boundary. Unknown names are ignored. */
  window.loaderStage = function loaderStage(name) {
    const i = STAGES.findIndex(s => s[0] === name);
    if (i < 0 || i < idx) return;
    // The SKYLINE is paced by CSS, not by these stages, and that is deliberate:
    // the stages all fire inside 276 ms, so lighting a bar on each one makes the
    // whole city flash on at once and then nothing moves for seven seconds. The
    // bars instead light on a CSS stagger spread across the real wait, which is
    // the only thing that can keep animating while the main thread is blocked.
    //
    // The honest signals are the RAIL and the STATUS TEXT: both are driven from
    // here, from what actually just happened.
    if (el && i > 0) el.classList.add('building');
    for (let k = idx; k <= i; k++) done += STAGES[k][1];
    idx = i + 1;
    if (status) status.textContent = SAYS[name] || name;
    paint();
    if (idx >= STAGES.length) settle();
  };

  /** Called when the scene is genuinely ready; hands off to the veil lift. */
  window.loaderDone = function loaderDone() {
    idx = STAGES.length;
    done = TOTAL;
    if (status) status.textContent = 'Welcome to Austin';
    if (fill) {
      fill.style.transitionDuration = '420ms';
      fill.style.transitionTimingFunction = 'cubic-bezier(.16,1,.3,1)';
      fill.style.transform = 'scaleX(1)';
    }
    if (pct) pct.textContent = '100%';
    if (el) el.classList.add('vl-done');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { if (build()) window.loaderStage('boot'); });
  } else if (build()) {
    window.loaderStage('boot');
  }
})();
