/**
 * finder.js — "Where should I live?" The apartment finder.
 *
 * The first thing a visitor meets once the opening flight lands: a panel (left
 * on desktop, a bottom sheet on a phone) that asks for a major — or imports the
 * student's own class schedule — and a commute mode, and answers with every
 * home the app knows ranked by minutes to that student's classes. The city
 * shows the same answer: the ground is coloured by minutes, the homes are
 * numbered pins, choosing one flies there and draws the way to the top class
 * buildings, and a tray holds up to three homes side by side.
 *
 * WHAT IT READS (all static, same-origin, fetched once when the panel first
 * opens — never on a visit that does not open it):
 *   data/finder/homes.json           scripts/bake_finder_homes.py
 *   data/finder/major-buildings.json scripts/bake_finder_majors.py
 *   data/finder/transit.json         scripts/bake_finder_transit.py
 *   data/walk_graph.json             scripts/bake_walk.py (the walking router's graph)
 * The arithmetic is js/finder-core.js; the header there is the formula.
 *
 * THE SCHEDULE NEVER LEAVES THE BROWSER. The import is js/wayfind.js's own
 * (Google / Apple / UT paste / photo), reused through its import-only door:
 * this file sets `window.__wayfindImportOnly` and loads wayfind.js a second
 * time, which installs the store and the egress guard (§12) exactly as the
 * walking feature does, but no router button, sheet or day view. WAYFIND.on
 * stays false. The finder reads only building codes and meeting-day counts off
 * the published schedule, keeps them in memory, and makes no network call of
 * its own except the four GETs above. scripts/verify/finder-static.mjs checks
 * that by reading this file.
 *
 * NOT live-here.js. That preview (?livehere=1) is a week planner for three
 * hard-coded homes and routes through wayfind's UI router, which needs the
 * walking feature switched on. This ranks every home, needs no router UI, and
 * stands down when ?livehere=1 is asked for so the two never share the screen.
 *
 * Every taste value — colours, sizes, copy, thresholds, first-visit behaviour —
 * is one line in FINDER below (CLAUDE.md rule 11); finder.css holds the rest.
 */
import * as core from './finder-core.js';
import { decodeWalkGraph } from './walkgraph.js';

const q = new URLSearchParams(location.search);

// ══════════════════════════════════════════════════════════════════════════
// TASTE BLOCK
// ══════════════════════════════════════════════════════════════════════════
const FINDER = {
  on: true,
  // Any of these URL flags = 1 means a capture or another feature owns the
  // screen, and the finder does not appear at all. `?finder=0` also turns it
  // off; `?finder=1` opens it at once (no waiting for the flight).
  standDownOn: ['clip', 'autopilot', 'timelapse', 'tour', 'sliderdemo', 'livehere'],

  // ── the first visit ──────────────────────────────────────────────────────
  // During the intro only a small "Where should I live?" pill is on screen, so
  // the flight is untouched. When the flight LANDS the panel opens by itself:
  // fully on a desktop, as a short sheet on a phone (the city stays visible).
  // A visitor who takes the controls mid-flight is exploring, so they keep the
  // pill; one who closed the finder last time is not re-opened.
  firstVisit: {
    openWhenLanded: 'open',       // desktop: 'open' | 'pill'
    openWhenLandedPhone: 'peek',  // phone:   'peek' | 'open' | 'pill'
    openIfIntroCancelled: false,
    landedDelayMs: 700,           // a beat after the flight settles
    noIntroDelayMs: 1200,         // no flight on this URL: after the veil is gone
    pollMs: 300,
    rememberClosed: true,
  },
  phoneMaxW: 650,                 // at or under this width the panel is a bottom sheet
  prefsKey: 'austin3d.finder.ui', // per-viewer prefs ONLY: major id, mode, heat, closed

  data: {
    homes: 'data/finder/homes.json',
    majors: 'data/finder/major-buildings.json',
    transit: 'data/finder/transit.json',
    graph: 'data/walk_graph.json',
  },

  // ── the answer ───────────────────────────────────────────────────────────
  defaultMode: 'either',          // 'walk' | 'bus' | 'either'
  defaultTargets: [['MAI', 1]],   // before a major is chosen: the Main Building
  showDorms: true,                // UT residence halls in the list
  rowBuildings: 4,                // buildings listed under a selected row
  compareMax: 3,
  compareBuildings: 6,            // rows in a compare card

  // Minutes -> colour. Near is warm light, far is dusk violet: the app's own
  // amber at the good end. Pins, heat and legend all read this one ramp.
  ramp: [[3, '#fff3c4'], [8, '#ffd27a'], [13, '#ffab4a'], [20, '#f07a3a'],
         [30, '#d24b4f'], [45, '#9c3b73'], [60, '#5a3a86']],
  legendTicks: [5, 15, 30, 45, 60],

  heat: {
    on: true,                     // default for the "colour the map" switch
    // 'slab': a thin fill-extrusion resting on the pavement slabs, depth-sorted
    //   under the buildings (js/ground.js's paths are extrusions that paint
    //   over any flat layer beneath them — wayfind.js §6 learned this).
    // 'wash': a flat fill drawn over everything, buildings included.
    render: 'slab',
    cellM: 90,                    // walking-area cell size
    baseM: 0.26,                  // just above GROUND.pathRaise (0.22 m)
    heightM: 0.30,
    opacity: 0.5,
    washOpacity: 0.3,
    fadeZoom: [16.8, 17.8],       // gone by walking height
  },
  route: {
    topN: 3,                      // routes drawn to this many top class buildings
    walkColour: '#fff4d8',        // wayfind's day ribbon colour
    busColour: '#8fd3ff',         // wayfind's "via" blue: a different kind of leg
    widthPx: 4,
    casingPx: 2,
    casingColour: 'rgba(38,20,4,.6)',
    linkDash: [1.2, 1.4],         // straight connections we drew ourselves
    linkOpacity: 0.75,
  },
  fly: {
    durationMs: 1400,
    walkPitch: 52,
    pitchZoomLoss: 0.35,          // a pitched view sees less ground than the flat fit
    minZoom: 14.4,
    maxZoom: 17.4,
    marginPx: 56,
    busZoom: 15.3,
    busPitch: 58,
    busFaceCampus: [-97.7394, 30.2861], // bus homes look toward the UT Tower
  },

  copy: {
    pill: 'Where should I live?',
    kicker: 'UT AUSTIN · APARTMENT FINDER',
    title: 'Where should I live?',
    lede: 'Tell us your major, or import your schedule. Every home on the map, ranked by minutes to your classes.',
    majorLabel: 'Your major',
    majorPlaceholder: (n) => 'Search ' + n + ' majors…',
    majorNone: 'No major matches. Try a shorter word.',
    or: 'or',
    importBtn: 'Import my class schedule',
    importNote: 'Your schedule stays on this device.',
    importUnavailable: 'The schedule import could not load. Reload to try again.',
    usingSchedule: (n, b) => 'Using your schedule: ' + n + (n === 1 ? ' class meeting' : ' class meetings') +
      ' a week in ' + b + (b === 1 ? ' building.' : ' buildings.'),
    useMajor: 'Use a major instead',
    useSchedule: 'Use my schedule',
    modeLabel: 'Getting to class',
    modes: { walk: 'Walk', bus: 'Bus', either: 'Either' },
    basisDefault: 'Pick your major to rank these by your classes. Until then: minutes to the Main Building.',
    basisSolid: (m) => 'Ranked by where ' + m + ' classes met in Fall 2026, across the first three years of the degree.',
    basisEstimated: (m, pct) => 'This one is an estimate: about ' + pct + '% of ' + m +
      '’s first three years are core and elective classes that meet all over campus, so these buildings are a best guess. Import your schedule for your real ones.',
    basisSchedule: 'Ranked by the buildings your own classes meet in, weighted by how often you go.',
    dropped: (pct, codes) => pct + '% of these classes meet where the walking map has no door (' + codes +
      '), so they are left out.',
    listTitle: (n) => n + (n === 1 ? ' home' : ' homes') + ', closest first',
    unavailable: {
      walk: (n) => n + (n === 1 ? ' home needs' : ' homes need') + ' the bus (East Riverside). Choose Bus or Either to see ' + (n === 1 ? 'it.' : 'them.'),
      bus: (n) => n + (n === 1 ? ' home is' : ' homes are') + ' a walk, not a bus ride. Choose Walk or Either to see ' + (n === 1 ? 'it.' : 'them.'),
      either: (n) => n + (n === 1 ? ' home has' : ' homes have') + ' no route to these buildings.',
    },
    minutes: (lo, hi) => lo + '–' + hi,
    minUnit: 'min',
    avgNote: 'average trip to your classes',
    how: { walk: 'walk', bus: 'bus', mixed: 'walk + bus' },
    dorm: 'UT residence hall',
    busLeg: (route, name, kind) => kind + ' ' + route + ' · ' + name.replace(/^\d+-/, ''),
    busTimes: (dep, board) => 'bus leaves ' + board + ' at ' + dep,
    busNote: (arrive) => 'Bus times: weekday, arriving by ' + arrive + ', from the CapMetro timetable. UT shuttles run only when classes are in session, every 15–20 min, and not on Saturdays.',
    compareAdd: 'Compare',
    compareOn: 'In compare',
    compareFull: 'Compare holds three homes. Remove one first.',
    compareTitle: 'Side by side',
    compareRemove: (n) => 'Remove ' + n + ' from compare',
    compareClear: 'Clear',
    heatToggle: 'Colour the map by minutes',
    legendTitle: 'Minutes to your classes',
    hide: 'Hide the finder',
    expand: 'Show the list',
    collapse: 'Show more city',
    loading: 'Loading paths and homes…',
    loadFail: 'The finder could not load its data. Reload to try again.',
    sourcesTitle: 'Where these numbers come from',
    sources: (asOf) => 'Walking: OpenStreetMap paths (walking graph ' + (asOf || 'snapshot') +
      '), brisk to slow pace, lights and stairs included. Buses: CapMetro timetable, one ride, no transfers. ' +
      'Majors: the 2026–27 catalog’s first three years, with the rooms those courses used in Fall 2026. ' +
      'Riverside has no 3D buildings yet; its pins and colours are still exact.',
    pinLabel: (n, name, t) => '#' + n + ' ' + name + ', ' + t + ' minutes',
  },
};
window.FINDER = FINDER;

// ══════════════════════════════════════════════════════════════════════════
// ON / OFF
// ══════════════════════════════════════════════════════════════════════════
const standDown = !FINDER.on || q.get('finder') === '0' ||
  FINDER.standDownOn.some(k => q.get(k) === '1') ||
  document.documentElement.classList.contains('clip');

if (!standDown) boot();

function boot() {
  const C = FINDER.copy;
  const S = {
    view: 'pill',           // 'pill' | 'peek' | 'open'
    loaded: false, loading: null, failed: false,
    G: null, homes: [], majors: [], transit: null, graphAsOf: null,
    majorId: null, mode: FINDER.defaultMode, heat: FINDER.heat.on,
    basis: 'default',       // 'default' | 'major' | 'schedule'
    schedule: null,         // [[code, meetings/week]] — codes and counts only
    preferMajor: false,     // the student chose "use a major instead"
    result: null, selected: null, hot: null, compare: [],
    markers: new Map(), destMarkers: [],
    importReady: false, importLoading: null,
  };
  const prefs = loadPrefs();
  if (prefs.mode && FINDER.copy.modes[prefs.mode]) S.mode = prefs.mode;
  if (typeof prefs.heat === 'boolean') S.heat = prefs.heat;
  if (prefs.major) S.majorId = prefs.major;
  if (q.get('major')) S.majorId = q.get('major');
  if (q.get('mode') && FINDER.copy.modes[q.get('mode')]) S.mode = q.get('mode');

  // ── DOM ──────────────────────────────────────────────────────────────────
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const pill = el('button', null, C.pill); pill.id = 'fd-pill'; pill.type = 'button';
  pill.setAttribute('aria-controls', 'finder'); pill.setAttribute('aria-expanded', 'false');

  const root = el('aside'); root.id = 'finder'; root.hidden = true;
  root.setAttribute('aria-label', C.title);
  root.innerHTML = `
    <button class="fd-handle" type="button" aria-label="${C.expand}"><span></span></button>
    <header class="fd-head">
      <p class="fd-kicker"></p><h1 class="fd-title"></h1>
      <button class="fd-hide" type="button"></button>
      <p class="fd-lede"></p>
    </header>
    <section class="fd-ask">
      <label class="fd-lab" for="fd-major"></label>
      <div class="fd-combo">
        <input id="fd-major" type="text" autocomplete="off" spellcheck="false" role="combobox"
          aria-autocomplete="list" aria-expanded="false" aria-controls="fd-majors">
        <ul id="fd-majors" class="fd-majors" role="listbox" hidden></ul>
      </div>
      <div class="fd-import-row"><span class="fd-or"></span>
        <button class="fd-import" type="button"></button></div>
      <p class="fd-sched" hidden><span></span> <button class="fd-link fd-swap" type="button"></button></p>
      <div class="fd-lab fd-mode-lab"></div>
      <div class="fd-modes" role="radiogroup"></div>
      <p class="fd-basis"></p>
    </section>
    <section class="fd-results">
      <div class="fd-list-head"><h2 class="fd-list-title"></h2></div>
      <p class="fd-status" role="status"></p>
      <ol class="fd-list"></ol>
      <p class="fd-unav"></p>
    </section>
    <footer class="fd-foot">
      <label class="fd-heat"><input type="checkbox"> <span></span></label>
      <div class="fd-legend"><div class="fd-legend-title"></div><div class="fd-ramp"></div><div class="fd-ticks"></div></div>
      <details class="fd-src"><summary></summary><p class="fd-src-text"></p><p class="fd-bus-note"></p></details>
      <div class="fd-priv"></div>
    </footer>`;
  const tray = el('div'); tray.id = 'fd-tray'; tray.hidden = true;
  tray.setAttribute('aria-label', C.compareTitle);
  document.body.append(pill, root, tray);

  const $ = (s) => root.querySelector(s);
  $('.fd-kicker').textContent = C.kicker;
  $('.fd-title').textContent = C.title;
  $('.fd-hide').textContent = '×'; $('.fd-hide').setAttribute('aria-label', C.hide); $('.fd-hide').title = C.hide;
  $('.fd-lede').textContent = C.lede;
  $('.fd-lab').textContent = C.majorLabel;
  $('.fd-or').textContent = C.or;
  $('.fd-import').textContent = C.importBtn;
  $('.fd-import').title = C.importNote;
  $('.fd-mode-lab').textContent = C.modeLabel;
  $('.fd-heat span').textContent = C.heatToggle;
  $('.fd-heat input').checked = S.heat;
  $('.fd-legend-title').textContent = C.legendTitle;
  $('.fd-src summary').textContent = C.sourcesTitle;
  for (const m of ['walk', 'bus', 'either']) {
    const b = el('button', 'fd-mode', C.modes[m]); b.type = 'button'; b.dataset.mode = m;
    b.setAttribute('role', 'radio');
    b.onclick = () => { S.mode = m; savePrefs(); renderModes(); recompute(); };
    $('.fd-modes').append(b);
  }
  buildLegend();

  // The app flies on W A S D and friends; typing a major must not fly the
  // camera (controls.js ignores INPUT targets, this covers the buttons too).
  for (const n of [root, tray]) {
    n.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (S.selected) select(null); else setView('pill', true); }
      e.stopPropagation();
    });
    n.addEventListener('keyup', (e) => e.stopPropagation());
  }

  pill.onclick = () => setView(isPhone() ? 'peek' : 'open', true);
  $('.fd-hide').onclick = () => setView('pill', true);
  $('.fd-handle').onclick = () => setView(S.view === 'open' ? 'peek' : 'open', true);
  $('.fd-heat input').onchange = (e) => { S.heat = e.target.checked; savePrefs(); drawHeat(); };
  $('.fd-import').onclick = openImport;
  $('.fd-swap').onclick = () => { S.preferMajor = !S.preferMajor; recompute(); };
  window.addEventListener('resize', () => { if (S.view === 'peek' && !isPhone()) setView('open'); });

  // ── the major search ─────────────────────────────────────────────────────
  const input = $('#fd-major'), listbox = $('#fd-majors');
  let active = -1, matches = [];
  function majorName(m) { return m.name + (m.degree ? ' (' + m.degree + ')' : ''); }
  function renderMajors() {
    const t = input.value.trim().toLowerCase();
    matches = S.majors.filter(m => !t || (m.name + ' ' + m.degree + ' ' + m.college).toLowerCase().includes(t));
    listbox.replaceChildren();
    if (!matches.length) {
      const li = el('li', 'fd-none', C.majorNone); listbox.append(li);
    }
    matches.forEach((m, i) => {
      const li = el('li', 'fd-opt'); li.id = 'fd-opt-' + m.id; li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.append(el('span', null, m.name), el('small', null, m.degree + ' · ' + m.college));
      li.onmousedown = (e) => { e.preventDefault(); chooseMajor(m.id); };
      listbox.append(li);
    });
    if (active >= 0 && matches[active]) input.setAttribute('aria-activedescendant', 'fd-opt-' + matches[active].id);
    else input.removeAttribute('aria-activedescendant');
  }
  function openList(on) {
    listbox.hidden = !on; input.setAttribute('aria-expanded', String(on));
    if (on) renderMajors();
  }
  input.addEventListener('focus', () => { input.select(); active = -1; openList(true); });
  input.addEventListener('input', () => { active = -1; openList(true); });
  input.addEventListener('blur', () => setTimeout(() => {
    openList(false);
    const m = S.majors.find(x => x.id === S.majorId);
    input.value = m ? majorName(m) : '';
  }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (listbox.hidden) openList(true);
      active = Math.max(0, Math.min(matches.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      renderMajors();
      const o = listbox.querySelector('[aria-selected=true]'); if (o) o.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = matches[active >= 0 ? active : 0]; if (m) chooseMajor(m.id);
    } else if (e.key === 'Escape' && !listbox.hidden) {
      e.preventDefault(); e.stopPropagation(); openList(false); input.blur();
    }
  });
  function chooseMajor(id) {
    S.majorId = id; S.preferMajor = true; savePrefs();
    const m = S.majors.find(x => x.id === id);
    input.value = m ? majorName(m) : '';
    openList(false); input.blur();
    recompute();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW STATE AND THE FIRST VISIT
  // ══════════════════════════════════════════════════════════════════════════
  function isPhone() { return innerWidth <= FINDER.phoneMaxW; }
  function setView(v, byUser) {
    if (v === 'peek' && !isPhone()) v = 'open';
    S.view = v;
    const shown = v !== 'pill';
    root.hidden = !shown; pill.hidden = shown;
    pill.setAttribute('aria-expanded', String(shown));
    root.dataset.view = v;
    document.body.classList.toggle('fd-on', shown);
    $('.fd-handle').setAttribute('aria-label', v === 'open' ? C.collapse : C.expand);
    if (byUser && FINDER.firstVisit.rememberClosed) { prefs.closed = !shown; savePrefs(); }
    if (shown) { if (S.loaded) renderAll(); else ensureLoaded(); }
    else { clearCity(); tray.hidden = true; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════════════════════
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(r => {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }
  function ensureLoaded() {
    if (S.loading) return S.loading;
    status(C.loading);
    S.loading = Promise.all([getJSON(FINDER.data.homes), getJSON(FINDER.data.majors),
      getJSON(FINDER.data.transit), getJSON(FINDER.data.graph)])
      .then(([homes, majors, transit, raw]) => {
        const G = decodeWalkGraph(raw);
        G.wc = raw.wc || {};
        S.G = G; S.graphAsOf = raw.as_of || null;
        S.homes = homes.homes.filter(h => FINDER.showDorms || h.kind !== 'dorm');
        S.majors = majors.majors; S.transit = transit;
        input.placeholder = C.majorPlaceholder(S.majors.length);
        input.setAttribute('aria-label', C.majorLabel);
        const m = S.majors.find(x => x.id === S.majorId);
        if (m) input.value = majorName(m); else S.majorId = null;
        $('.fd-src-text').textContent = C.sources(S.graphAsOf);
        $('.fd-bus-note').textContent = C.busNote(transit.arrive_by || '09:00');
        S.loaded = true;
        status('');
        // A schedule saved on an earlier visit: bring the import (and with it
        // the egress guard) up now so the restored schedule can rank homes.
        if (hasSavedSchedule()) ensureImport();
        recompute();
      })
      .catch((e) => { S.failed = true; status(C.loadFail, true); console.warn('[finder]', e); });
    return S.loading;
  }
  function hasSavedSchedule() {
    try { return !!localStorage.getItem('austin3d.schedule.v1'); } catch (e) { return false; }
  }
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(FINDER.prefsKey) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    // Only the four UI choices. Never the schedule, never a building list.
    const p = { major: S.majorId || null, mode: S.mode, heat: S.heat, closed: !!prefs.closed };
    try { localStorage.setItem(FINDER.prefsKey, JSON.stringify(p)); } catch (e) {}
  }

  // ── the schedule import, reused ─────────────────────────────────────────
  function ensureImport() {
    if (typeof window.wayfindImportOpen === 'function') { onImportReady(); return Promise.resolve(true); }
    if (q.get('walk') === '0') return Promise.resolve(false);   // the walking feature's own veto
    if (S.importLoading) return S.importLoading;
    window.__wayfindImportOnly = true;
    S.importLoading = new Promise((resolve) => {
      const own = [...document.scripts].map(s => s.getAttribute('src'))
        .find(s => s && /(^|\/)js\/wayfind\.js(\?|$)/.test(s)) || 'js/wayfind.js';
      const s = document.createElement('script');
      s.src = own;
      s.onload = () => { const ok = typeof window.wayfindImportOpen === 'function'; if (ok) onImportReady(); resolve(ok); };
      s.onerror = () => resolve(false);
      document.body.append(s);
    });
    return S.importLoading;
  }
  function onImportReady() {
    if (S.importReady) return;
    S.importReady = true;
    // Only when WE brought the import up is the privacy panel ours to show;
    // with the walking feature on it belongs in the router sheet.
    if (window.WAYFIND && window.WAYFIND.importOnly && window.wayfindStore && window.wayfindStore.mount) {
      try { window.wayfindStore.mount($('.fd-priv')); } catch (e) {}
    }
    if (window.wayfindSchedule) useSchedule(window.wayfindSchedule);
  }
  async function openImport() {
    const ok = await ensureImport();
    if (!ok) { status(C.importUnavailable, true); return; }
    window.wayfindImportOpen();
  }
  function useSchedule(s) {
    const pairs = s ? core.scheduleTargets(s) : [];
    S.schedule = pairs.length ? pairs : null;
    if (S.schedule) S.preferMajor = false;
    if (S.loaded) recompute();
  }
  window.addEventListener('wayfind:schedule', (e) => useSchedule(e.detail));

  // ══════════════════════════════════════════════════════════════════════════
  // THE ANSWER
  // ══════════════════════════════════════════════════════════════════════════
  const toMin = (s) => s ? { lo: s.lo / 60, hi: s.hi / 60, anchor: s.anchor } : null;
  const fmtRange = (lo, hi) => {
    let a = Math.floor(lo), b = Math.ceil(hi);
    if (b <= a) b = a + 1;
    return C.minutes(a, b);
  };
  const anchorCache = new Map();
  function anchorsOf(h) {
    if (!anchorCache.has(h.id)) anchorCache.set(h.id, core.homeAnchors(S.G, h));
    return anchorCache.get(h.id);
  }
  const stopAnchors = new Map();
  function stopAnchor(aid) {
    if (stopAnchors.has(aid)) return stopAnchors.get(aid);
    const a = (S.transit.anchors || []).find(x => x.id === aid);
    const st = a && S.transit.stops[a.stop];
    const s = st ? core.nearestNode(S.G, [st[0], st[1]]) : null;
    const out = s ? [{ node: s.node, c: s.m, m: s.m, from: [st[0], st[1]] }] : [];
    stopAnchors.set(aid, out);
    return out;
  }

  function currentTargets() {
    const ok = (c) => !!core.buildingTree(S.G, c);
    if (S.schedule && !S.preferMajor) {
      return { basis: 'schedule', ...core.normaliseTargets(S.schedule, ok) };
    }
    const m = S.majors.find(x => x.id === S.majorId);
    if (m) return { basis: 'major', major: m, ...core.normaliseTargets(m.b, ok) };
    return { basis: 'default', ...core.normaliseTargets(FINDER.defaultTargets, ok) };
  }

  function recompute() {
    if (!S.loaded) return;
    const T = currentTargets();
    S.basis = T.basis;
    const trees = T.targets.map(t => core.buildingTree(S.G, t.code));
    const anchorIds = (S.transit.anchors || []).map(a => a.id);
    const walkFromAnchor = T.targets.map((t, i) => {
      const o = {};
      for (const aid of anchorIds) o[aid] = core.walkFrom(S.G, trees[i], stopAnchor(aid));
      return o;
    });
    const items = S.homes.map(home => {
      const anchors = anchorsOf(home);
      const row = S.transit.homes[home.id] || null;
      const legs = T.targets.map((t, i) => ({
        code: t.code, w: t.w,
        walk: anchors.length ? toMin(core.walkFrom(S.G, trees[i], anchors)) : null,
        bus: row ? core.busTo(row, walkFromAnchor[i]) : null,
      }));
      return { home, legs, score: core.scoreHome(legs, S.mode) };
    });
    const { ranked, unranked } = core.rankHomes(items);
    S.result = { T, trees, anchorIds, walkFromAnchor, ranked, unranked };
    if (S.selected && !ranked.some(r => r.home.id === S.selected)) S.selected = null;
    S.compare = S.compare.filter(id => ranked.some(r => r.home.id === id));
    let fly = false;
    if (q.get('home') && !S._homeFromUrl) {
      S._homeFromUrl = true;
      if (ranked.some(r => r.home.id === q.get('home'))) { S.selected = q.get('home'); fly = true; }
    }
    renderAll();
    if (fly) select(S.selected);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // THE PANEL
  // ══════════════════════════════════════════════════════════════════════════
  function status(t, bad) {
    const s = $('.fd-status'); s.textContent = t || ''; s.classList.toggle('bad', !!bad);
  }
  function renderModes() {
    for (const b of root.querySelectorAll('.fd-mode')) {
      const on = b.dataset.mode === S.mode;
      b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on);
    }
  }
  function renderBasis() {
    const R = S.result; if (!R) return;
    const T = R.T, basis = $('.fd-basis');
    let t = C.basisDefault;
    if (T.basis === 'schedule') t = C.basisSchedule;
    else if (T.basis === 'major') {
      const m = T.major;
      t = m.conf === 'solid' ? C.basisSolid(m.name) : C.basisEstimated(m.name, Math.round((1 - m.spec) * 100));
    }
    if (T.droppedShare > 0.005) {
      t += ' ' + C.dropped(Math.round(T.droppedShare * 100), T.dropped.map(d => d.code).join(', '));
    }
    basis.textContent = t;
    basis.classList.toggle('est', T.basis === 'major' && T.major.conf !== 'solid');
    const sched = $('.fd-sched');
    sched.hidden = !S.schedule;
    if (S.schedule) {
      const n = S.schedule.reduce((a, p) => a + p[1], 0);
      sched.firstChild.textContent = C.usingSchedule(n, S.schedule.length);
      $('.fd-swap').textContent = S.preferMajor ? C.useSchedule : C.useMajor;
      sched.classList.toggle('off', S.preferMajor);
    }
  }
  function colourOf(m) { return core.rampColour(FINDER.ramp, m); }

  function renderList() {
    const R = S.result, list = $('.fd-list');
    list.replaceChildren();
    if (!R) return;
    $('.fd-list-title').textContent = C.listTitle(R.ranked.length);
    for (const r of R.ranked) {
      const h = r.home, sc = r.score;
      const li = el('li', 'fd-item'); li.dataset.id = h.id;
      const row = el('button', 'fd-row'); row.type = 'button';
      row.setAttribute('aria-pressed', String(S.selected === h.id));
      const n = el('span', 'fd-n', String(r.rank)); n.style.setProperty('--c', colourOf(sc.mid));
      const name = el('span', 'fd-name', h.name);
      const sub = el('span', 'fd-sub', (h.kind === 'dorm' ? C.dorm : h.area) + ' · ' + C.how[sc.how]);
      const min = el('span', 'fd-min'); min.append(fmtRange(sc.lo, sc.hi), el('small', null, ' ' + C.minUnit));
      row.append(n, name, sub, min);
      row.onclick = () => select(S.selected === h.id ? null : h.id);
      row.onmouseenter = () => setHot(h.id); row.onmouseleave = () => setHot(null);
      row.onfocus = () => setHot(h.id); row.onblur = () => setHot(null);
      const cmp = el('button', 'fd-cmp'); cmp.type = 'button';
      const inCmp = S.compare.includes(h.id);
      cmp.textContent = inCmp ? C.compareOn : C.compareAdd;
      cmp.setAttribute('aria-pressed', String(inCmp));
      cmp.onclick = () => toggleCompare(h.id);
      li.append(row, cmp);
      if (S.selected === h.id) li.append(detailOf(r));
      list.append(li);
    }
    const un = R.unranked.length;
    $('.fd-unav').textContent = un ? C.unavailable[S.mode](un) : '';
  }
  function detailOf(r) {
    const d = el('div', 'fd-detail');
    const legs = r.score.legs.slice().sort((a, b) => b.w - a.w).slice(0, FINDER.rowBuildings);
    const chips = el('div', 'fd-chips');
    for (const l of legs) {
      const c = el('span', 'fd-chip');
      c.append(el('b', null, l.code), ' ' + fmtRange(l.lo, l.hi) + ' ' + C.minUnit);
      c.title = C.how[l.how];
      chips.append(c);
    }
    d.append(el('p', 'fd-avg', C.avgNote), chips);
    const bus = legs.find(l => l.bus);
    if (bus) {
      const t = bus.bus.t, route = S.transit.routes[t.route] || { name: t.route, kind: 'bus' };
      const board = S.transit.stops[t.board];
      d.append(el('p', 'fd-busline', C.busLeg(t.route, route.name, route.kind) + ' · ' +
        C.busTimes(t.bus_departs, board ? board[2] : '')));
    }
    return d;
  }

  function buildLegend() {
    const stops = FINDER.ramp, lo = stops[0][0], hi = stops[stops.length - 1][0];
    const pct = (m) => ((m - lo) / (hi - lo) * 100).toFixed(1) + '%';
    $('.fd-ramp').style.background = 'linear-gradient(90deg,' + stops.map(([m, c]) => c + ' ' + pct(m)).join(',') + ')';
    const ticks = $('.fd-ticks');
    for (const t of FINDER.legendTicks) {
      const s = el('span', null, String(t)); s.style.left = pct(t); ticks.append(s);
    }
  }

  function renderAll() {
    if (!S.loaded) return;
    renderModes(); renderBasis(); renderList(); renderPins(); drawHeat(); drawRoute(); renderTray();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // THE CITY: PINS, HEAT, ROUTES, CAMERA
  // ══════════════════════════════════════════════════════════════════════════
  const map = () => window.__map;
  const mapReady = () => { const m = map(); return !!(m && m.getStyle && m.getStyle() && m.getStyle().layers && m.getLayer('buildings-3d')); };
  function whenMap(fn) {
    if (mapReady()) return fn();
    setTimeout(() => whenMap(fn), 200);
  }

  function renderPins() {
    if (S.view === 'pill') return;
    whenMap(() => {
      const R = S.result; if (!R || S.view === 'pill') return;
      const want = new Set(R.ranked.map(r => r.home.id));
      for (const [id, mk] of S.markers) if (!want.has(id)) { mk.marker.remove(); S.markers.delete(id); }
      for (const r of R.ranked) {
        const h = r.home;
        let mk = S.markers.get(h.id);
        if (!mk) {
          const wrap = el('div', 'fd-pinwrap');
          const b = el('button', 'fd-pin'); b.type = 'button';
          wrap.append(b);
          b.onclick = (e) => { e.stopPropagation(); if (S.view === 'pill') setView(isPhone() ? 'peek' : 'open'); select(h.id); };
          b.onmouseenter = () => setHot(h.id); b.onmouseleave = () => setHot(null);
          const marker = new maplibregl.Marker({ element: wrap, anchor: 'center' }).setLngLat(h.p).addTo(map());
          mk = { marker, wrap, b };
          S.markers.set(h.id, mk);
        }
        mk.b.textContent = String(r.rank);
        mk.b.style.setProperty('--c', colourOf(r.score.mid));
        const t = fmtRange(r.score.lo, r.score.hi);
        mk.b.setAttribute('aria-label', C.pinLabel(r.rank, h.name, t));
        mk.b.title = h.name + ' · ' + t + ' ' + C.minUnit;
        mk.wrap.classList.toggle('sel', S.selected === h.id);
        mk.wrap.style.zIndex = String(S.selected === h.id ? 3 : S.hot === h.id ? 2 : 1);
      }
    });
  }
  function setHot(id) {
    S.hot = id;
    for (const [hid, mk] of S.markers) {
      mk.wrap.classList.toggle('hot', hid === id);
      mk.wrap.style.zIndex = String(S.selected === hid ? 3 : hid === id ? 2 : 1);
    }
    for (const li of root.querySelectorAll('.fd-item')) li.classList.toggle('hot', li.dataset.id === id);
  }

  // ── layers ──
  const SRC_HEAT = 'finder-heat', SRC_ROUTE = 'finder-route';
  const L_HEAT = 'finder-heat', L_CASE = 'finder-route-casing', L_WALK = 'finder-route-walk',
    L_BUS = 'finder-route-bus', L_LINK = 'finder-route-link';
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  function overOf(m) {
    // The first symbol layer above the buildings: over the city, under labels.
    const stack = m.getStyle().layers;
    const after = Math.max(0, stack.findIndex(l => l.id === 'buildings-3d'));
    const s = stack.slice(after + 1).find(l => l.type === 'symbol');
    return s ? s.id : undefined;
  }
  function ensureLayers() {
    const m = map();
    if (!mapReady()) return false;
    if (!m.getSource(SRC_HEAT)) m.addSource(SRC_HEAT, { type: 'geojson', data: empty() });
    if (!m.getSource(SRC_ROUTE)) m.addSource(SRC_ROUTE, { type: 'geojson', data: empty() });
    const H = FINDER.heat, Rt = FINDER.route;
    if (!m.getLayer(L_HEAT)) {
      if (H.render === 'wash') {
        m.addLayer({ id: L_HEAT, type: 'fill', source: SRC_HEAT, paint: {
          'fill-color': ['get', 'c'],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], H.fadeZoom[0], H.washOpacity, H.fadeZoom[1], 0],
        } }, overOf(m));
      } else {
        const before = ['buildings-ao', 'buildings-3d'].find(id => m.getLayer(id));
        m.addLayer({ id: L_HEAT, type: 'fill-extrusion', source: SRC_HEAT, paint: {
          'fill-extrusion-color': ['get', 'c'],
          'fill-extrusion-base': H.baseM,
          'fill-extrusion-height': H.baseM + H.heightM,
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], H.fadeZoom[0], H.opacity, H.fadeZoom[1], 0],
          'fill-extrusion-vertical-gradient': false,
        } }, before);
      }
    }
    const over = overOf(m);
    const line = (id, filter, paint, layout) => {
      if (!m.getLayer(id)) m.addLayer({ id, type: 'line', source: SRC_ROUTE, filter,
        layout: { 'line-cap': 'round', 'line-join': 'round', ...(layout || {}) }, paint }, over);
    };
    line(L_CASE, ['match', ['get', 'k'], ['walk', 'bus'], true, false],
      { 'line-color': Rt.casingColour, 'line-width': Rt.widthPx + 2 * Rt.casingPx });
    line(L_WALK, ['==', ['get', 'k'], 'walk'], { 'line-color': Rt.walkColour, 'line-width': Rt.widthPx });
    line(L_BUS, ['==', ['get', 'k'], 'bus'], { 'line-color': Rt.busColour, 'line-width': Rt.widthPx });
    line(L_LINK, ['==', ['get', 'k'], 'link'], { 'line-color': Rt.walkColour, 'line-width': Rt.widthPx * 0.7,
      'line-opacity': Rt.linkOpacity, 'line-dasharray': Rt.linkDash }, { 'line-cap': 'butt' });
    return true;
  }
  // A graphics preset or a style recovery can rebuild the style; put ours back.
  let styleHooked = false;
  function hookStyle() {
    if (styleHooked || !map()) return;
    styleHooked = true;
    let t = 0;
    map().on('styledata', () => {
      clearTimeout(t);
      t = setTimeout(() => { if (S.view !== 'pill' && S.loaded && mapReady() && !map().getLayer(L_HEAT)) { drawHeat(); drawRoute(); } }, 250);
    });
  }

  function square(c, hx, hy, m) {
    const [x, y] = c;
    return { type: 'Feature', properties: { m: Math.round(m * 10) / 10, c: colourOf(m) },
      geometry: { type: 'Polygon', coordinates: [[[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy], [x - hx, y - hy]]] } };
  }
  function heatFeatures() {
    const R = S.result; if (!R) return [];
    const feats = [], targets = R.T.targets;
    if (!targets.length) return feats;
    if (S.mode !== 'bus') {
      for (const c of core.walkCells(S.G, FINDER.heat.cellM)) {
        const m = core.walkMidAt(R.trees, targets, c.node);
        if (m != null) feats.push(square(c.c, c.hx, c.hy, m));
      }
    }
    if (S.mode !== 'walk' && S.transit.grid) {
      const walkMid = R.walkFromAnchor.map(o => {
        const out = {};
        for (const [aid, w] of Object.entries(o)) out[aid] = w ? (w.lo + w.hi) / 120 : null;
        return out;
      });
      const g = S.transit.grid, lat = (g.bbox[0] + g.bbox[2]) / 2;
      const hy = g.step_m / 2 / 111320, hx = g.step_m / 2 / (111320 * Math.cos(lat * Math.PI / 180));
      for (const cell of g.cells) {
        const m = core.busMidAt(cell, R.anchorIds, targets, walkMid);
        if (m != null) feats.push(square([cell[0], cell[1]], hx, hy, m));
      }
    }
    return feats;
  }
  function drawHeat() {
    if (S.view === 'pill' || !S.loaded) return;
    whenMap(() => {
      if (!ensureLayers()) return;
      hookStyle();
      const features = S.heat ? heatFeatures() : [];
      S.heatCount = features.length;
      map().getSource(SRC_HEAT).setData({ type: 'FeatureCollection', features });
    });
  }

  // ── selection: routes, labels, camera ──
  function routeOf(r) {
    const feats = [], ends = [], pts = [];
    const push = (k, coords) => { if (coords.length > 1) { feats.push({ type: 'Feature', properties: { k }, geometry: { type: 'LineString', coordinates: coords } }); pts.push(...coords); } };
    // treePath: [where we started (a door or the snapped centre), graph
    // nodes..., the class building's door]. The two ends are our own straight
    // connections, drawn dashed; the middle is the mapped path.
    const walkPath = (tree, anchor) => {
      const p = core.treePath(S.G, tree, anchor);
      push('link', p.slice(0, 2));
      push('walk', p.slice(1, -1));
      push('link', p.slice(-2));
      return p[p.length - 1];
    };
    const R = S.result;
    const legs = r.score.legs.map((l, i) => ({ ...l, i: R.T.targets.findIndex(t => t.code === l.code) }))
      .sort((a, b) => b.w - a.w).slice(0, FINDER.route.topN);
    for (const l of legs) {
      const tree = R.trees[l.i];
      if (!tree) continue;
      let end = null;
      if (l.how === 'walk') {
        const w = core.walkFrom(S.G, tree, anchorsOf(r.home));
        if (w) end = walkPath(tree, w.anchor);
      } else if (l.bus) {
        const t = l.bus.t, st = S.transit.stops;
        const board = st[t.board], alight = st[t.alight];
        const aStop = stopAnchor(l.bus.via)[0];
        if (board) push('link', [r.home.p, [board[0], board[1]]]);
        const shp = S.transit.shapes[t.shape];
        if (shp) push('bus', shp);
        if (alight && aStop) push('link', [[alight[0], alight[1]], aStop.from]);
        const w = aStop && core.walkFrom(S.G, tree, [aStop]);
        if (w) end = walkPath(tree, w.anchor);
      }
      if (end) ends.push({ code: l.code, p: end, t: fmtRange(l.lo, l.hi) + ' ' + C.minUnit, how: l.how });
    }
    return { feats, ends, pts };
  }
  function drawRoute() {
    whenMap(() => {
      if (!ensureLayers()) return;
      for (const m of S.destMarkers) m.remove();
      S.destMarkers = [];
      const r = S.selected && S.result && S.result.ranked.find(x => x.home.id === S.selected);
      if (!r || S.view === 'pill') { map().getSource(SRC_ROUTE).setData(empty()); return; }
      const { feats, ends } = routeOf(r);
      map().getSource(SRC_ROUTE).setData({ type: 'FeatureCollection', features: feats });
      for (const e of ends) {
        const tag = el('div', 'fd-dest');
        tag.append(el('b', null, e.code), ' ' + e.t);
        S.destMarkers.push(new maplibregl.Marker({ element: tag, anchor: 'bottom', offset: [0, -6] }).setLngLat(e.p).addTo(map()));
      }
    });
  }
  function freeArea() {
    // The part of the screen the panel does not cover, as offsets from centre.
    const box = root.hidden ? null : root.getBoundingClientRect();
    if (!box) return { w: innerWidth, h: innerHeight, dx: 0, dy: 0 };
    if (isPhone()) {
      const h = Math.max(120, box.top);
      return { w: innerWidth, h, dx: 0, dy: (h - innerHeight) / 2 };
    }
    const left = box.right;
    return { w: innerWidth - left, h: innerHeight, dx: left / 2, dy: 0 };
  }
  function flyToHome(r) {
    const m = map(); if (!m) return;
    const F = FINDER.fly;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fa = freeArea();
    let center, zoom, pitch, bearing = m.getBearing();
    if (r.score.how === 'walk') {
      const { pts } = routeOf(r);
      pts.push(r.home.p);
      const M = pts.map(p => maplibregl.MercatorCoordinate.fromLngLat(p));
      const br = bearing * Math.PI / 180, rx = [Math.cos(br), Math.sin(br)], uy = [Math.sin(br), -Math.cos(br)];
      const pr = M.map(p => [p.x * rx[0] + p.y * rx[1], p.x * uy[0] + p.y * uy[1]]);
      const xs = pr.map(p => p[0]), ys = pr.map(p => p[1]);
      const w = Math.max(1e-9, Math.max(...xs) - Math.min(...xs)), h = Math.max(1e-9, Math.max(...ys) - Math.min(...ys));
      zoom = Math.min(Math.log2((fa.w - 2 * F.marginPx) / (512 * w)), Math.log2((fa.h - 2 * F.marginPx) / (512 * h)));
      zoom = Math.max(F.minZoom, Math.min(F.maxZoom, zoom - F.pitchZoomLoss));
      const cx = M.reduce((a, p) => a + p.x, 0) / M.length, cy = M.reduce((a, p) => a + p.y, 0) / M.length;
      const mid = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
      // back from the rotated frame to mercator
      const mx = mid[0] * rx[0] + mid[1] * uy[0], my = mid[0] * rx[1] + mid[1] * uy[1];
      center = [Number.isFinite(mx) ? mx : cx, Number.isFinite(my) ? my : cy];
      pitch = F.walkPitch;
    } else {
      const c = maplibregl.MercatorCoordinate.fromLngLat(r.home.p);
      center = [c.x, c.y]; zoom = F.busZoom; pitch = F.busPitch;
      if (F.busFaceCampus) {
        const [lon, lat] = r.home.p, [tl, tt] = F.busFaceCampus;
        bearing = Math.atan2((tl - lon) * Math.cos(lat * Math.PI / 180), tt - lat) * 180 / Math.PI;
      }
    }
    // Shift so the target sits in the middle of the free area, not under the
    // panel. Done on the centre, not with MapLibre padding: the flight
    // controller derives its eye from an unpadded viewport (live-here.js).
    const scale = 512 * Math.pow(2, zoom), b = bearing * Math.PI / 180;
    const right = [Math.cos(b), Math.sin(b)], up = [Math.sin(b), -Math.cos(b)];
    const kUp = 1 / Math.max(0.35, Math.cos(pitch * Math.PI / 180));
    const ox = -fa.dx / scale, oy = fa.dy / scale * kUp;
    const cm = new maplibregl.MercatorCoordinate(center[0] + right[0] * ox + up[0] * oy, center[1] + right[1] * ox + up[1] * oy);
    const target = { center: cm.toLngLat(), zoom, pitch, bearing, padding: { left: 0, right: 0, top: 0, bottom: 0 } };
    m.stop();
    if (reduce) m.jumpTo(target);
    else m.flyTo({ ...target, duration: F.durationMs, essential: true });
  }
  function select(id, opt = {}) {
    S.selected = id;
    if (id && isPhone() && S.view === 'open') setView('peek');
    renderList(); renderPins(); drawRoute();
    const r = id && S.result && S.result.ranked.find(x => x.home.id === id);
    if (r && opt.keepCamera !== true) whenMap(() => flyToHome(r));
    const li = id && root.querySelector('.fd-item[data-id="' + id + '"]');
    if (li) li.scrollIntoView({ block: 'nearest' });
  }

  // ── the compare tray ──
  function toggleCompare(id) {
    const i = S.compare.indexOf(id);
    if (i >= 0) S.compare.splice(i, 1);
    else if (S.compare.length >= FINDER.compareMax) { status(C.compareFull, true); return; }
    else S.compare.push(id);
    status('');
    renderList(); renderTray();
  }
  function renderTray() {
    const R = S.result;
    const rows = R ? S.compare.map(id => R.ranked.find(r => r.home.id === id)).filter(Boolean) : [];
    tray.hidden = !rows.length || S.view === 'pill';
    tray.replaceChildren();
    if (!rows.length) return;
    const head = el('div', 'fd-tray-head');
    head.append(el('b', null, C.compareTitle));
    const clr = el('button', 'fd-link', C.compareClear); clr.type = 'button';
    clr.onclick = () => { S.compare = []; renderList(); renderTray(); };
    head.append(clr);
    tray.append(head);
    const codes = R.T.targets.slice(0, FINDER.compareBuildings).map(t => t.code);
    const grid = el('div', 'fd-cards');
    for (const r of rows) {
      const card = el('div', 'fd-card');
      const x = el('button', 'fd-x', '×'); x.type = 'button'; x.setAttribute('aria-label', C.compareRemove(r.home.name));
      x.onclick = () => toggleCompare(r.home.id);
      const title = el('button', 'fd-card-name', r.home.name); title.type = 'button';
      title.onclick = () => select(r.home.id);
      const n = el('span', 'fd-n', String(r.rank)); n.style.setProperty('--c', colourOf(r.score.mid));
      card.append(x, n, title,
        el('div', 'fd-sub', (r.home.kind === 'dorm' ? C.dorm : r.home.area) + ' · ' + C.how[r.score.how]),
        el('div', 'fd-card-min', fmtRange(r.score.lo, r.score.hi) + ' ' + C.minUnit));
      const tbl = el('div', 'fd-card-legs');
      for (const code of codes) {
        const l = r.score.legs.find(x => x.code === code);
        const line = el('div', 'fd-card-leg');
        line.append(el('b', null, code), el('span', null, l ? fmtRange(l.lo, l.hi) + (l.how === 'bus' ? ' · ' + C.how.bus : '') : '—'));
        tbl.append(line);
      }
      card.append(tbl);
      grid.append(card);
    }
    tray.append(grid);
  }

  function clearCity() {
    for (const mk of S.markers.values()) mk.marker.remove();
    S.markers.clear();
    for (const m of S.destMarkers) m.remove();
    S.destMarkers = [];
    const m = map();
    S.heatCount = 0;
    if (m && m.getSource && m.getSource(SRC_HEAT)) {
      m.getSource(SRC_HEAT).setData(empty());
      m.getSource(SRC_ROUTE).setData(empty());
    }
  }

  // ── read-only seam for the browser checks. Building codes are shown only
  //    for a major; for an imported schedule, only how many buildings. ──
  window.finderState = () => {
    const R = S.result;
    return {
      view: S.view, loaded: S.loaded, failed: S.failed, basis: S.basis, major: S.majorId, mode: S.mode,
      heat: S.heat, selected: S.selected, compare: S.compare.slice(),
      targets: R ? (R.T.basis === 'schedule' ? R.T.targets.length : R.T.targets.map(t => [t.code, +t.w.toFixed(3)])) : null,
      ranked: R ? R.ranked.map(r => ({ id: r.home.id, rank: r.rank, lo: +r.score.lo.toFixed(2), hi: +r.score.hi.toFixed(2), how: r.score.how })) : [],
      unranked: R ? R.unranked.map(r => r.home.id) : [],
      pins: S.markers.size,
      heatCells: S.heatCount == null ? null : S.heatCount,
      importReady: S.importReady,
    };
  };
  window.finderOpen = (v) => setView(v || (isPhone() ? 'peek' : 'open'));
  window.finderSelect = (id) => select(id);
  window.finderChooseMajor = (id) => { if (S.loaded) chooseMajor(id); };

  // ── start: last, so every const above exists before anything runs ──
  setView('pill');

  // Landed = the veil is gone AND the opening flight is done (app.js
  // publishes it on window.__intro.flight: primed | flying | done | cancelled;
  // null when this URL has no flight).
  function whenLanded(fn) {
    const F = FINDER.firstVisit;
    let veilGoneAt = null;
    const later = () => setTimeout(tick, F.pollMs);
    const tick = () => {
      if (document.getElementById('veil')) return later();
      if (veilGoneAt == null) veilGoneAt = performance.now();
      const f = window.__intro && window.__intro.flight;
      if (f && (f.state === 'primed' || f.state === 'flying')) return later();
      if (f && f.state === 'cancelled' && !F.openIfIntroCancelled) return;
      if (!f && performance.now() - veilGoneAt < F.noIntroDelayMs) return later();
      setTimeout(fn, f ? F.landedDelayMs : 0);
    };
    tick();
  }
  if (q.get('finder') === '1') {
    setView(isPhone() ? 'peek' : 'open');
  } else if (!(FINDER.firstVisit.rememberClosed && prefs.closed)) {
    whenLanded(() => {
      if (S.view !== 'pill') return;
      const want = isPhone() ? FINDER.firstVisit.openWhenLandedPhone : FINDER.firstVisit.openWhenLanded;
      if (want !== 'pill') setView(want);
    });
  }
}
