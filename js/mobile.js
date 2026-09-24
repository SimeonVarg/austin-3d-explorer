/**
 * mobile.js — keep the phone alive, and keep it showing the REAL city.
 *
 * WHY THIS FILE EXISTS. On an iPhone the full scene loaded, ran, and then the
 * tab died and reloaded: Safari "A problem repeatedly occurred", Chrome for iOS
 * "Can't open this page". That pair is WebKit taking a tab for memory; nothing
 * is thrown and nothing is logged. So a phone gets a lighter profile, and a
 * phone that still dies falls back further. History and measurements:
 * HANDOFF.md "Sep 15", "Sep 16", "Sep 19" and "Sep 24 2026",
 * docs/mobile-real-buildings.md, docs/mobile-device-check.md.
 *
 * THE DEFECT THE SEP 24 VERSION FIXES. Reported: "it loads for like 15
 * seconds, but during the intro it refreshes, and then i get an error 'a
 * problem repeatedly occured'". Measured on an emulated phone (desktop Chrome,
 * 390x844 at DPR 3 — not a phone), the phone profile held ~1.3 GB when the veil
 * lifted and ~2.0 GB twelve seconds later: the opening flight crosses downtown
 * and every tile it loads carried a facade pattern atlas of up to 30 MB, and
 * MapLibre keeps ~30 of those tiles after they leave the screen. A phone tab is
 * killed far below that. Then two things turned one kill into Safari's error
 * page, and both were ours:
 *
 *   1. SAFARI RELOADS A KILLED PAGE EXACTLY ONCE BY ITSELF, and shows "A
 *      problem repeatedly occurred" if that reload dies too. The fallback here
 *      needed TWO deaths before it did anything, so the one reload a visitor
 *      ever got was the same heavy scene, which died the same way. The
 *      fallback could only ever be seen by someone who tapped Reload on
 *      Safari's error page.
 *   2. A LOST WEBGL CONTEXT RELOADED THE PAGE INTO THE SAME SCENE. Under
 *      memory pressure iOS takes the GPU memory back before it takes the page;
 *      the old handler reloaded, same profile, and the reload ran the same
 *      flight into the same wall.
 *
 * HOW IT WORKS NOW
 *
 *   A PHONE BUDGET. LITE.budget is every phone memory limit in one place, read
 *   at parse time by the modules it names (facade atlas resolution, MapLibre's
 *   tile cache, how the authored buildings are built, packed and kept).
 *   Desktop never sees it.
 *
 *   TIERS, ONE STEP PER DEATH. `phone` (the real city on a budget) ->
 *   `lighter` (the same buildings minus balconies, no opening flight) ->
 *   `safe` (no three.js layer: flat prisms). A boot that finds the previous
 *   boot died while visible steps down ONE tier, so Safari's own automatic
 *   reload already lands on the lighter one. A WebGL context lost during the
 *   boot or the opening flight is the same evidence and steps down too.
 *
 *   A BOOT IS A RECORD, NOT A COUNT (PR #270, kept). `pending` is set while a
 *   boot is running AND the page is visible. It is cleared by success (the veil
 *   has lifted, the authored buildings have landed, and the page stayed visible
 *   for `settleMs` after that) and by every way a load ends that is not a
 *   crash: pagehide (reload, navigation, close), the page going hidden (app
 *   switch, lock, another tab), a freeze. A `pending` left behind means the
 *   page died while visible with none of those events — a WebKit memory kill.
 *
 *   AT MOST ONE AUTOMATIC RELOAD. Every reload this file starts by itself is
 *   recorded (LITE.autoReload); inside `gapMs` of the last one it shows the
 *   notice with a button instead. This file can never reload in a loop, and
 *   the one reload it does make is always to a lighter tier when the reason
 *   was memory.
 *
 *   THE FALLBACK IS EXPLICIT AND RECOVERABLE (PR #270, kept). It is never
 *   written to the address bar: the flags every module reads out of
 *   `location.search` are put there for the few hundred milliseconds the
 *   scripts take to parse, then the visitor's own URL is put back
 *   (DOMContentLoaded). A notice says what is being shown and why, with one
 *   tap to load the full city. A visit more than `retryAfterMs` after a step
 *   down tries one tier heavier by itself.
 *
 *   A SLOW PHONE STILL GETS THE REAL BUILDINGS (PR #270, kept). Past app.js's
 *   90 s ceiling a phone (LITE.lateAuthored) lifts the veil on the prisms and
 *   the authored meshes replace them when their build lands.
 *
 *   A LOST GRAPHICS CONTEXT AFTER THE CITY IS UP RELOADS, SAME TIER (PR #270,
 *   kept). The three.js layer does not come back by itself (the authored and
 *   campus buildings are holes), so the page reloads once the context is
 *   restored and the page is visible — subject to the one-reload rule.
 *
 *   OLD STATE RECOVERS BY ITSELF. Older boot records (the pre-#270 integer,
 *   #270's two-death record) are discarded — they describe a heavier scene —
 *   and a URL still carrying what the pre-#270 version wrote is recognised by
 *   that signature and cleaned.
 *
 * ESCAPE HATCHES
 *   ?lite=0     never apply the phone profile (the full scene, no budget)
 *   ?lite=1     apply it anywhere, including a desktop, for testing
 *   ?lite=safe  the fallback by hand. Honoured, and the notice says so.
 *   ?litetier=phone|lighter|safe   start on a tier by hand (testing), no record
 *   An explicit flag always wins: ?slopes=1 on a phone keeps the slopes layer.
 *
 * Desktop is untouched: no coarse pointer, no touch digitiser → this returns
 * before it reads or writes anything (except to clean an old phone URL), and
 * LITE_PROFILE.budget is null, which every reader treats as "no change".
 */
(function () {
  'use strict';

  // ── Taste and budget block (CLAUDE.md rule 11) ──────────────────────
  const LITE = {
    // The phone profile's URL flags. Each key is an existing URL flag; each
    // value is what a phone gets when the visitor has not said otherwise. The
    // authored buildings STAY: at `preset: performance` js/slopes-apartments.js
    // drops only the window reveals and the sign dots. `campuslandscape: '0'`
    // is the one whole subsystem a phone gives up (planting detail, ~97 MB).
    profile: {
      campuslandscape: '0',
      preset: 'performance',   // renderScale 0.75, no bloom/god-rays/flare
    },
    // The emergency fallback: no three.js layer at all. The authored buildings
    // revert to their flat prisms, which is ugly and cannot run out of memory.
    safeProfile: {
      slopes: '0',
      campuslandscape: '0',
      preset: 'performance',
    },

    // ── THE PHONE MEMORY BUDGET ──────────────────────────────────────
    // Every phone memory limit, in one place. Read at parse time by the file
    // named on each line through window.LITE_PROFILE.budget; a desktop gets
    // `null` and every reader keeps its desktop value. Measured with
    // scripts/verify/mobile-memory.mjs (desktop Chrome, 390x844 at DPR 3, the
    // phone profile, phone = JS heap + ArrayBuffers + every live WebGL texture,
    // buffer and renderbuffer): 1.95-2.08 GB at the peak on main, most of it
    // in the three lines below. Numbers per line: HANDOFF "Sep 24 2026".
    budget: {
      // js/facades.js: facade pattern texels per CSS px (desktop: min(2, dpr)).
      // The phone renders at DPR 3 x renderScale 0.75 = 2.25 device px per CSS
      // px, so a 1x pattern is magnified 1.1x — the 2x one was MINIFIED 1.8x
      // with no mipmaps, i.e. texels nobody saw. A quarter of the atlas bytes,
      // in every tile's atlas texture and in MapLibre's CPU copy of each image.
      facadeScale: 1,
      // js/app.js -> MapLibre maxTileCacheSize: tiles kept per source after
      // they leave the screen (MapLibre's own default here is ~30). Each one
      // holds its pattern atlas texture and its geometry on the GPU. Cost: a
      // tile you fly back to is re-read from the browser cache (a moment of
      // the coarser tile) instead of shown at once.
      tileCacheSize: 6,
      // js/slopes.js: once three.js has put a mesh's vertices on the GPU, drop
      // the CPU copy (~260 MB for the authored buildings). It is only needed to
      // upload again after a lost WebGL context, and a phone recovers from that
      // by reloading (below). Nothing on a phone raycasts the meshes.
      freeGeometryCpu: true,
      // js/slopes-apartments.js via js/slopes.js buildChunked: build the
      // authored buildings in pieces of at most this many triangles instead of
      // one set of buffers that doubles to 8.4 M vertices for 4.2 M used. Same
      // triangles in the same order, ~8 draw calls instead of 1. This was the
      // load's peak once the atlases were fixed: ~820 MB of ArrayBuffers for a
      // ~235 MB result. 300k keeps a chunk inside 2^20 vertices (~52 MB).
      geometryChunkTris: 300000,
      // js/slopes.js packGeometry, on those chunks: normals as signed bytes,
      // the surface parameters as half floats — 34 bytes a vertex
      // instead of 50, on the GPU and in the build (~150 MB off the peak).
      // Axis-aligned walls and roofs are exact; any other normal is within
      // half a degree. The one visible-in-a-diff cost: the fine brick-joint
      // grain on far walls sits a fraction of a brick along (see packGeometry).
      // false = exact vertices.
      packVertices: true,
      // js/slopes-apartments.js: balcony slabs and rails on the authored
      // buildings. Kept here; the `lighter` tier drops them.
      aptBalconies: true,
      // js/app.js: the opening flight from downtown to campus. It is the peak:
      // every tile it crosses is loaded at the pitch it is flown at.
      intro: true,
    },
    // The tiers, lightest last. Each is the phone budget with its own changes.
    // `flags` are the URL flags that tier writes for the parse (see above).
    tiers: [
      { name: 'phone', flags: 'profile', budget: {} },
      // After one death or one lost context during the boot. The same authored
      // buildings and look, minus their balconies (flush walls); no opening
      // flight (the camera starts at West Campus, js/app.js SPAWN) and no
      // out-of-view tile cache.
      { name: 'lighter', flags: 'profile', budget: { intro: false, tileCacheSize: 0, aptBalconies: false } },
      // After two. No three.js layer: flat prisms, and the notice says so.
      { name: 'safe', flags: 'safeProfile', budget: { intro: false, tileCacheSize: 0 } },
    ],

    bootKey: 'flyover.boot',
    // A boot is a success once the veil has lifted, the authored buildings
    // have landed, AND the page has stayed visible this long afterwards.
    // Covers the jump to full resolution at reveal, the GPU upload and the
    // opening flight (12.6 s, js/app.js INTRO.leg1Ms + leg2Ms).
    settleMs: 15000,
    // A `pending` boot older than this is not evidence of a crash LOOP (the
    // phone was restarted, the browser was killed days ago...). Not counted.
    pendingMaxAgeMs: 30 * 60 * 1000,
    // After a step down, a visit this long after it tries one tier heavier.
    // If that try dies too, it steps down again.
    retryAfterMs: 60 * 60 * 1000,
    // What counts as a phone: a coarse pointer AND a touch digitiser AND a
    // short screen edge. A desktop has none, and neither does the desktop
    // verification harness. A touch laptop reports `pointer: fine`.
    maxShortEdge: 1024,        // CSS px; admits phones and iPads, not desktops
    // How often the veil is checked for the reveal.
    revealPollMs: 250,
    // Past app.js's INTRO.authoredCeilingMs (90 s) a desktop gives up on the
    // authored buildings for the visit and keeps the old prisms. A phone does
    // not: the veil lifts on the prisms and the authored meshes land when their
    // build finishes. false = the desktop behaviour.
    lateAuthored: true,
    // WebGL context loss. How long to wait for the browser's own restore before
    // reloading anyway.
    ctxRestoreWaitMs: 3000,
    // Every reload this file starts by itself. At most one per `gapMs`; inside
    // it the notice offers the reload instead. localStorage, so it survives
    // Safari's own crash-reload and a new tab.
    autoReload: { key: 'flyover.autoreload', gapMs: 10 * 60 * 1000, legacySessionKey: 'flyover.ctxreload' },

    // The notice shown whenever the visitor is not getting the full city.
    notice: {
      title: 'Simplified buildings',
      titles: { ctx: 'Graphics were reset', lighter: 'Lighter city', lighterCtx: 'Lighter city' },
      why: {
        crashes: 'The full city stopped loading on this device twice, so this visit shows plain blocks instead of the detailed buildings.',
        url: 'This link asks for the lightweight city (lite=safe), so the buildings are plain blocks.',
        slow: 'The detailed buildings took too long to load this time, so plain blocks are shown instead.',
        ctx: 'The phone took back the graphics memory, so some buildings are missing. Reloading brings them back.',
        lighter: 'The full city ran out of memory on this device, so this visit uses lighter buildings (no balconies) and skips the opening flight.',
        lighterCtx: 'The phone ran short of graphics memory during the opening flight, so this visit uses lighter buildings (no balconies) and skips the flight.',
      },
      retry: 'Load full city',
      retries: { ctx: 'Reload city' },
      dismiss: 'Dismiss',
      // Under the veil (z 60), over the HUD and the buttons (z 30-31), so it
      // appears as the veil lifts. Clear of the top-right button column.
      top: 'calc(16px + 44px + 12px)',
      left: '12px',
      right: 'calc(16px + 44px + 8px)',
      z: 55,
      bg: 'rgba(16,10,3,.92)',
      edge: 'rgba(255,190,90,.30)',
      ink: '#f5dfa0',
      accent: '#f5a623',
      accentInk: '#1a1208',
    },
  };
  const MAX_TIER = LITE.tiers.length - 1;
  const tierBudget = (t) => Object.assign({}, LITE.budget, LITE.tiers[t].budget);
  const tierFlags = (t) => LITE[LITE.tiers[t].flags];

  function isSmallTouchDevice() {
    try {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const touch = (navigator.maxTouchPoints || 0) > 0;
      const shortEdge = Math.min(screen.width || 0, screen.height || 0);
      return !!(coarse && touch && shortEdge > 0 && shortEdge <= LITE.maxShortEdge);
    } catch (e) { return false; }
  }

  const replaceURL = (search) => {
    try {
      history.replaceState(history.state, '', location.pathname + (search ? '?' + search : '') + location.hash);
      return true;
    } catch (e) { return false; }
  };

  // ── The visitor's own query ─────────────────────────────────────────
  // Strip anything this file (or the pre-fix version of it) wrote into the
  // URL, so it is never mistaken for something the visitor asked for.
  const q = new URLSearchParams(location.search);
  const AUTO = Object.assign({}, LITE.profile, LITE.safeProfile);
  const has = (o) => Object.keys(o).every(k => q.get(k) === o[k]);
  let legacy = null;
  if (q.get('lite') === 'auto') legacy = 'auto';                           // ours, a reload mid-boot
  else if (q.get('lite') === 'safe' && has(LITE.safeProfile)) legacy = 'safe';  // the old auto fallback
  else if (q.get('lite') === '1' && has(LITE.profile)) legacy = '1';        // the old phone URL
  if (legacy) {
    q.delete('lite');
    for (const k of Object.keys(AUTO)) if (q.get(k) === AUTO[k]) q.delete(k);
  }
  const visitorQuery = q.toString();

  const asked = q.get('lite');
  const forcedSafe = asked === 'safe';
  const on = forcedSafe ? true
           : asked === '1' ? true
           : asked === '0' ? false
           : isSmallTouchDevice();
  const handTier = LITE.tiers.findIndex(t => t.name === q.get('litetier'));

  window.LITE_PROFILE = { on, safe: false, tier: null, tierName: null, budget: null, reason: null, applied: [], crashes: 0, legacy, query: visitorQuery };
  if (legacy) console.info('[mobile] cleaned a pre-fix phone URL (' + legacy + ')');
  if (!on) {
    // A desktop opening an old phone link gets the full scene and a clean URL.
    if (legacy) replaceURL(visitorQuery);
    return;
  }

  // ── Storage, guarded ────────────────────────────────────────────────
  // Every read and write is guarded: localStorage throws in some private
  // windows and on a page whose site data is blocked. Without storage there is
  // no record, so no step down and no reload limit across loads — the reload
  // limit then falls back to sessionStorage, and failing that to never
  // reloading by itself at all.
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const visible = () => document.visibilityState !== 'hidden';

  // ── The automatic-reload limit (LITE.autoReload) ────────────────────
  const lastAutoReload = () => {
    let t = +lsGet(LITE.autoReload.key) || 0;
    try { t = Math.max(t, +sessionStorage.getItem(LITE.autoReload.key) || 0, +sessionStorage.getItem(LITE.autoReload.legacySessionKey) || 0); } catch (e) {}
    return t;
  };
  const autoReloadAllowed = () => {
    const last = lastAutoReload(), now = Date.now();
    return !(last && now >= last && now - last < LITE.autoReload.gapMs);
  };
  // Records the reload and returns false if it could not be recorded anywhere:
  // a reload that cannot be remembered could be repeated, so it is not made.
  const noteAutoReload = () => {
    const v = String(Date.now());
    let ok = lsSet(LITE.autoReload.key, v);
    try { sessionStorage.setItem(LITE.autoReload.key, v); ok = true; } catch (e) {}
    return ok;
  };
  function autoReload(why) {
    if (!autoReloadAllowed() || !noteAutoReload()) return false;
    console.warn('[mobile] reloading once by itself: ' + why);
    window.LITE_PROFILE.autoReloaded = why;
    location.reload();             // pagehide: an interruption, not a crash
    return true;
  }

  // ── The boot record ─────────────────────────────────────────────────
  // v3 { tier, deaths, pending, tierAt, why }. Anything older is discarded:
  // the pre-#270 integer counted every short visit, and #270's v2 { n, pending,
  // safeAt } counted deaths of a ~2 GB scene that no longer exists — neither is
  // evidence about the budgeted one, and keeping it would hold a phone that
  // crashed under the old code on a lighter tier for hours after the fix.
  const read = () => {
    const raw = lsGet(LITE.bootKey);
    let o = null;
    try { o = JSON.parse(raw); } catch (e) {}
    if (o && typeof o === 'object' && o.v === 3) return o;
    if (raw != null) console.info('[mobile] discarded an older boot record (' + String(raw).slice(0, 40) + ')');
    return { v: 3, tier: 0, deaths: 0, pending: null, tierAt: null, why: null };
  };
  const st = read();
  const save = () => { lsSet(LITE.bootKey, JSON.stringify(st)); };

  const now = Date.now();
  let tier = 0, reason = null;
  if (forcedSafe) {
    tier = MAX_TIER; reason = 'url';            // by hand: the record is left alone
  } else if (handTier >= 0) {
    tier = handTier; reason = 'hand';           // ?litetier= for testing: no record
  } else {
    st.tier = Math.max(0, Math.min(MAX_TIER, st.tier | 0));
    const p = st.pending;
    // The previous boot died while visible. One step down, unless a lost
    // context during that boot already took the step (p.struck).
    if (p && typeof p.t === 'number' && now >= p.t && now - p.t < LITE.pendingMaxAgeMs) {
      st.deaths = (st.deaths | 0) + 1;
      if (!p.struck) { st.tier = Math.min(MAX_TIER, st.tier + 1); st.why = 'crashes'; }
      st.tierAt = now;
      reason = st.why || 'crashes';
    }
    st.pending = null;
    if (!reason && st.tier > 0) {
      if (st.tierAt && now - st.tierAt >= LITE.retryAfterMs) {
        st.tier--; st.tierAt = now; reason = 'retry';   // one tier heavier; one more death steps back
      } else reason = st.why || 'crashes';
    }
    tier = st.tier;
    if (visible()) st.pending = { t: now, tier };
    save();
  }
  const safe = tier === MAX_TIER;
  const budget = tierBudget(tier);
  Object.assign(window.LITE_PROFILE, {
    safe, tier, tierName: LITE.tiers[tier].name, budget, reason, crashes: st.deaths | 0,
    lateAuthored: LITE.lateAuthored && !safe,
  });
  if (tier > 0 && reason !== 'url' && reason !== 'hand') {
    console.warn('[mobile] the full city did not survive on this device (' + reason + ') — this visit uses the "' +
                 LITE.tiers[tier].name + '" tier. ?lite=0 for everything.');
  }

  // ── Lifecycle: tell a crash from everything else ────────────────────
  const B = { revealed: false, succeeded: false, struck: false };
  const introFlying = () => {
    const f = window.__intro && window.__intro.flight;
    return !!(f && (f.state === 'primed' || f.state === 'flying'));
  };
  // Evidence of running out of memory without dying: step the RECORD down now,
  // so whatever happens next — our one reload, Safari's, or the visitor's —
  // lands on the lighter tier. Marks the running boot so its own later death
  // does not take a second step for the same event.
  function strike(why) {
    if (forcedSafe || handTier >= 0 || st.tier >= MAX_TIER) return false;
    st.tier = Math.min(MAX_TIER, Math.max(st.tier, tier) + 1);
    st.tierAt = Date.now();
    st.why = why;
    B.struck = true;
    if (st.pending) st.pending.struck = true;
    save();
    window.LITE_PROFILE.struck = why;
    return true;
  }
  if (!forcedSafe && handTier < 0) {
    let settle = null, veilSeen = false;
    const succeed = () => {
      if (B.succeeded) return;
      B.succeeded = true;
      st.pending = null;
      // Only a boot at the heaviest tier proves the heaviest tier fits. A
      // lighter boot that survives proves nothing about the one above it, so
      // the step stays until retryAfterMs.
      if (tier === 0 && st.tier === 0) { st.deaths = 0; st.tierAt = null; st.why = null; }
      save();
    };
    const arm = () => {                  // alive, visible and still booting
      if (B.succeeded || !visible()) return;
      st.pending = { t: Date.now(), tier, struck: B.struck };
      save();
      if (B.revealed && !settle) settle = setTimeout(() => { settle = null; if (visible()) succeed(); else interrupt(); }, LITE.settleMs);
    };
    const interrupt = () => {            // whatever happens next is not our crash
      if (settle) { clearTimeout(settle); settle = null; }
      if (B.succeeded || !st.pending) return;
      st.pending = null;
      save();
    };
    document.addEventListener('visibilitychange', () => { if (visible()) arm(); else interrupt(); });
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('pageshow', (e) => { if (e.persisted) arm(); });
    document.addEventListener('freeze', interrupt);
    document.addEventListener('resume', arm);
    window.LITE_PROFILE.__retry = () => { st.tier = 0; st.tierAt = null; st.why = null; st.pending = null; B.succeeded = true; save(); };

    // The reveal: app.js records why the veil lifted in window.__intro.reason,
    // adds `.lift`, and then REMOVES the element — so any of the three counts.
    // It is not the end of the boot while the authored buildings are still
    // on their way (LITE.lateAuthored): their landing is the biggest single
    // allocation of the load, so a death there must still count.
    const authoredSettled = () => {
      const A = window.slopesApartments;
      if (!A || !window.SLOPES || !window.SLOPES.on || !window.APARTMENTS || !window.APARTMENTS.on) return true;
      try { return !!A.group || A.readyToReveal(); } catch (e) { return true; }
    };
    let noticed = false;
    const poll = setInterval(() => {
      const v = document.getElementById('veil');
      if (v) veilSeen = true;
      const lifted = !!(window.__intro && window.__intro.reason) ||
                     !!(v && v.classList.contains('lift')) || (veilSeen && !v);
      if (!lifted) return;
      const fb = window.__intro && window.__intro.modelFallback;
      if (fb && !safe && !noticed) { noticed = true; showNotice('slow'); }
      if (!authoredSettled()) return;
      clearInterval(poll);
      B.revealed = true;
      arm();
    }, LITE.revealPollMs);
  } else {
    // ?lite=safe or ?litetier= by hand: the tap is the visitor choosing the
    // full city, so it also gives that city a fair start.
    window.LITE_PROFILE.__retry = () => { st.tier = 0; st.tierAt = null; st.why = null; st.pending = null; save(); };
  }

  // ── WebGL context loss ──────────────────────────────────────────────
  // Only the map's canvas, and only while the three.js layer is on (the safe
  // scene is MapLibre alone, which restores itself). Listened for in the
  // capture phase on window: the event does not bubble, but it does capture.
  //
  // Lost while visible during the boot or the opening flight: memory. Step the
  // record down first, then make the one allowed reload, which therefore lands
  // on the lighter tier. Lost after the city is up (typically in the
  // background): reload on the same tier, as before. Either way at most one
  // automatic reload per LITE.autoReload.gapMs; after that, the notice.
  (function () {
    let lostAt = 0, restored = false, timer = null, struck = false;
    const isMapCanvas = (e) => !!(e.target && e.target.classList && e.target.classList.contains('maplibregl-canvas'));
    const recover = () => {
      timer = null;
      if (!lostAt || !visible()) return;
      if (!(window.SLOPES && window.SLOPES.on)) return;
      const why = 'WebGL context was lost' + (restored ? ' and restored' : '') +
                  (struck ? ' during the boot; the next load is the "' + LITE.tiers[Math.min(MAX_TIER, st.tier)].name + '" tier' : '');
      if (!autoReload(why)) showNotice('ctx');
    };
    const schedule = () => {
      if (!lostAt || !visible()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(recover, restored ? 0 : LITE.ctxRestoreWaitMs);
    };
    window.addEventListener('webglcontextlost', (e) => {
      if (!isMapCanvas(e)) return;
      lostAt = Date.now(); restored = false;
      window.LITE_PROFILE.contextLost = (window.LITE_PROFILE.contextLost | 0) + 1;
      if (!struck && visible() && window.SLOPES && window.SLOPES.on && (!B.revealed || introFlying())) struck = strike('ctx');
      schedule();
    }, true);
    window.addEventListener('webglcontextrestored', (e) => {
      if (!isMapCanvas(e) || !lostAt) return;
      restored = true;
      schedule();
    }, true);
    document.addEventListener('visibilitychange', () => { if (visible()) schedule(); });
  })();

  // ── The profile, for the length of the parse ────────────────────────
  // Every module reads its switch out of location.search while it is being
  // evaluated, so the flags go into the URL now and come back out once the
  // last script has run. Only fill in what the visitor has not set.
  const profile = tierFlags(tier);
  const eff = new URLSearchParams(visitorQuery);
  for (const [k, v] of Object.entries(profile)) {
    if (eff.has(k)) continue;
    eff.set(k, v);
    window.LITE_PROFILE.applied.push(k + '=' + v);
  }
  if (!eff.has('lite')) eff.set('lite', 'auto');   // marks a reload mid-boot as ours
  const written = eff.toString();
  if (replaceURL(written)) {
    const restore = () => {
      if (location.search === '?' + written) replaceURL(visitorQuery);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore, { once: true });
    else restore();
  } else {
    // A browser that refuses replaceState (file://, a sandboxed frame) simply
    // gets the full scene. Better than throwing on line one of the boot path.
    console.warn('[mobile] could not apply the phone profile');
  }

  if (safe) showNotice(reason === 'url' ? 'url' : 'crashes');
  else if (tier > 0 && reason !== 'hand') showNotice(st.why === 'ctx' ? 'lighterCtx' : 'lighter');

  // ── The notice ──────────────────────────────────────────────────────
  function retryFull(kind) {
    // A slow build or a lost context is not a step down: just load again.
    if (kind === 'slow' || kind === 'ctx') { location.reload(); return; }
    try { window.LITE_PROFILE.__retry(); } catch (e) {}
    const u = new URLSearchParams(visitorQuery);
    u.delete('lite');
    u.delete('litetier');
    if (u.get('slopes') === '0') u.delete('slopes');
    if (u.get('apartments') === '0') u.delete('apartments');
    const s = u.toString();
    location.replace(location.pathname + (s ? '?' + s : '') + location.hash);
  }

  function showNotice(kind) {
    const N = LITE.notice;
    window.LITE_PROFILE.notice = kind;
    const mount = () => {
      const old = document.getElementById('lite-notice');
      if (old) { if (old.dataset.kind === kind) return; old.remove(); }
      if (!document.getElementById('lite-notice-css')) {
        const css = document.createElement('style');
        css.id = 'lite-notice-css';
        css.textContent =
          '#lite-notice{position:absolute;top:' + N.top + ';left:' + N.left + ';right:' + N.right + ';z-index:' + N.z + ';' +
          'max-width:420px;background:' + N.bg + ';-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);' +
          'border:1px solid ' + N.edge + ';border-radius:14px;padding:11px 13px 11px 14px;color:' + N.ink + ';' +
          'font-size:12.5px;line-height:1.38;box-shadow:0 8px 26px rgba(0,0,0,.35);pointer-events:auto}' +
          '#lite-notice .ln-t{font-weight:600;letter-spacing:.02em;margin-bottom:3px;padding-right:26px}' +
          '#lite-notice .ln-b{opacity:.86}' +
          '#lite-notice .ln-a{margin-top:9px}' +
          '#lite-notice button[data-act=full]{min-height:36px;padding:0 16px;border-radius:999px;border:0;' +
          'background:' + N.accent + ';color:' + N.accentInk + ';font-family:inherit;font-weight:600;font-size:12.5px;line-height:1;cursor:pointer}' +
          '#lite-notice button[data-act=close]{position:absolute;top:4px;right:4px;width:36px;height:36px;border:0;' +
          'background:none;color:' + N.ink + ';opacity:.7;font-size:18px;line-height:1;cursor:pointer}';
        document.head.appendChild(css);
      }
      const el = document.createElement('div');
      el.id = 'lite-notice';
      el.dataset.kind = kind;
      el.setAttribute('role', 'status');
      const t = document.createElement('div'); t.className = 'ln-t'; t.textContent = N.titles[kind] || N.title;
      const b = document.createElement('div'); b.className = 'ln-b'; b.textContent = N.why[kind] || '';
      const a = document.createElement('div'); a.className = 'ln-a';
      const go = document.createElement('button'); go.type = 'button'; go.dataset.act = 'full'; go.textContent = N.retries[kind] || N.retry;
      const x = document.createElement('button'); x.type = 'button'; x.dataset.act = 'close'; x.textContent = '×';
      x.setAttribute('aria-label', N.dismiss);
      a.appendChild(go); el.append(t, b, a, x);
      go.addEventListener('click', (e) => { e.stopPropagation(); retryFull(kind); });
      x.addEventListener('click', (e) => { e.stopPropagation(); el.remove(); });
      document.body.appendChild(el);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
