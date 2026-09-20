/**
 * mobile.js — keep the phone alive, and keep it showing the REAL city.
 *
 * WHY THIS FILE EXISTS. On an iPhone the full scene loaded, ran, and then the
 * tab died and reloaded: Safari "A problem repeatedly occurred", Chrome for iOS
 * "Can't open this page". That pair is WebKit taking a tab for memory; nothing
 * is thrown and nothing is logged. So a phone gets a lighter profile, and a
 * phone that still dies falls back further. History and measurements:
 * HANDOFF.md "Sep 15 2026" and "Sep 16 2026", docs/mobile-real-buildings.md.
 *
 *     full scene (?lite=0)          ~657 MB JS heap (390x844 DPR 3)
 *     THE PHONE PROFILE             ~485 MB   authored buildings, roofs, windows
 *     the safe fallback (slopes=0)  ~190 MB   no three.js layer: flat prisms
 *
 * THE DEFECT THIS VERSION FIXES (2026-09-19, docs/mobile-real-buildings.md).
 * Phones that had never crashed were shown the safe fallback — The Standard as
 * two plain pillars, campus as flat prisms — and stayed there. Measured on an
 * emulated phone against main at c656249: three ordinary visits, each one
 * finished and open for ~50 s, and the third was the fallback. Two faults:
 *
 *   1. The counter never cleared. It waited for the veil to read `gone`, or
 *      opacity '0' — but app.js REMOVES the veil ~1.15 s into its fade, so a
 *      1 s poll almost never saw either, found no element, and returned early
 *      forever. Only a 120 s timer cleared it, and iOS suspends timers in a
 *      background tab. Every visit shorter than two minutes was a "crash".
 *   2. The fallback was written INTO the URL (`lite=safe&slopes=0&...`), where
 *      `lite=safe` means "forced by hand" and skipped the counter. Reload,
 *      bookmark, home-screen icon or restored tab: the old scene, permanently,
 *      with nothing on screen to say why. The same URL, shared, forced it on
 *      whoever opened it.
 *
 * HOW IT WORKS NOW
 *
 *   A BOOT IS A RECORD, NOT A COUNT. `pending` is set while a boot is running
 *   AND the page is visible. It is cleared by success (the veil has lifted,
 *   the authored buildings have landed, and the page stayed visible for
 *   `settleMs` after that) and by every way a load
 *   ends that is not a crash: pagehide (reload, navigation, close), the page
 *   going hidden (app switch, lock, another tab), a freeze. A boot that finds a
 *   `pending` left behind by the one before it knows that one died while
 *   visible with none of those events — which is what a WebKit memory kill
 *   looks like, and nothing else does. Two of those in a row and the next boot
 *   takes the fallback.
 *
 *   THE FALLBACK IS EXPLICIT AND RECOVERABLE. It is never written to the
 *   address bar: the flags every module reads out of `location.search` are put
 *   there for the few hundred milliseconds the scripts take to parse, then the
 *   visitor's own URL is put back (DOMContentLoaded). A notice says simplified
 *   buildings are shown and why, with one tap to load the full city. A visit
 *   more than `retryAfterMs` after the fallback started tries the full city
 *   once more by itself.
 *
 *   A SLOW PHONE STILL GETS THE REAL BUILDINGS. app.js gives up on the
 *   authored buildings 90 s into a load and keeps the old prisms for the
 *   visit. On a phone (LITE.lateAuthored) it lifts the veil instead and the
 *   authored meshes replace the prisms when their build lands.
 *
 *   A LOST GRAPHICS CONTEXT RELOADS. If the phone takes the WebGL context back
 *   and the page survives, the three.js layer does not come back by itself
 *   (the authored and campus buildings are holes). The page reloads once the
 *   context is restored and the page is visible — at most once per
 *   LITE.ctxReloadGapMs; after that the notice offers the reload.
 *
 *   OLD STATE RECOVERS BY ITSELF. The pre-fix integer counter is discarded (it
 *   counted every short visit), and a URL still carrying what the old version
 *   wrote — `lite=safe` with all three safe flags, or `lite=1` with the phone
 *   profile — is recognised by that signature and cleaned, so a bookmark or a
 *   home-screen icon made before the fix comes back to the real city.
 *
 * ESCAPE HATCHES
 *   ?lite=0     never apply the phone profile (the full scene)
 *   ?lite=1     apply it anywhere, including a desktop, for testing
 *   ?lite=safe  the fallback by hand. Honoured, and the notice says so.
 *   An explicit flag always wins: ?slopes=1 on a phone keeps the slopes layer.
 *
 * Desktop is untouched: no coarse pointer, no touch digitiser → this returns
 * before it reads or writes anything (except to clean an old phone URL).
 */
(function () {
  'use strict';

  // ── Taste block (CLAUDE.md rule 11) ─────────────────────────────────
  const LITE = {
    // The phone profile. Each key is an existing URL flag; each value is what
    // a phone gets when the visitor has not said otherwise. The authored
    // buildings STAY: at `preset: performance` js/slopes-apartments.js drops
    // only the window reveals and the sign dots. `campuslandscape: '0'` is the
    // one whole subsystem a phone gives up (planting detail, ~97 MB).
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
    bootKey: 'flyover.boot',
    // Unexplained deaths in a row before the fallback.
    crashesBeforeFallback: 2,
    // A boot is a success once the veil has lifted, the authored buildings
    // have landed, AND the page has stayed visible this long afterwards.
    // Covers the jump to full resolution at reveal and the GPU upload.
    settleMs: 15000,
    // A `pending` boot older than this is not evidence of a crash LOOP (the
    // phone was restarted, the browser was killed days ago...). Not counted.
    pendingMaxAgeMs: 30 * 60 * 1000,
    // After a fallback, a visit this long after it started gets one more try
    // at the full city. If that try dies too, the fallback starts again.
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
    // build finishes. Measured on a loaded machine (CPU at 100%), 8 of 14
    // emulated-phone visits crossed the ceiling, and every one of them showed
    // the old buildings for the whole visit. false = the desktop behaviour.
    lateAuthored: true,
    // WebGL context loss. A phone can take a page's WebGL context back under
    // memory pressure (typically while the tab is in the background) WITHOUT
    // killing the page. MapLibre restores its own layers; the three.js layer
    // does not come back — measured: every authored building and campus
    // building is a HOLE after a restore. On a phone the recovery is a reload,
    // done while the page is visible. How long to wait for the browser's own
    // restore before reloading anyway, and the shortest gap between two
    // automatic reloads (inside it the notice offers the reload instead, so a
    // phone that keeps losing the context cannot reload forever).
    ctxRestoreWaitMs: 3000,
    ctxReloadGapMs: 10 * 60 * 1000,
    ctxKey: 'flyover.ctxreload',

    // The notice shown whenever simplified buildings are on screen.
    notice: {
      title: 'Simplified buildings',
      titles: { ctx: 'Graphics were reset' },
      why: {
        crashes: 'The full city stopped loading on this device twice, so this visit shows plain blocks instead of the detailed buildings.',
        url: 'This link asks for the lightweight city (lite=safe), so the buildings are plain blocks.',
        slow: 'The detailed buildings took too long to load this time, so plain blocks are shown instead.',
        ctx: 'The phone took back the graphics memory, so some buildings are missing. Reloading brings them back.',
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

  window.LITE_PROFILE = { on, safe: false, reason: null, applied: [], crashes: 0, legacy, query: visitorQuery };
  if (legacy) console.info('[mobile] cleaned a pre-fix phone URL (' + legacy + ')');
  if (!on) {
    // A desktop opening an old phone link gets the full scene and a clean URL.
    if (legacy) replaceURL(visitorQuery);
    return;
  }

  // ── The boot record ─────────────────────────────────────────────────
  // Every read and write is guarded: localStorage throws in some private
  // windows and on a page whose site data is blocked. Without storage there is
  // no record, so no fallback — the same as before.
  const read = () => {
    let raw = null, o = null;
    try { raw = localStorage.getItem(LITE.bootKey); } catch (e) {}
    try { o = JSON.parse(raw); } catch (e) {}
    if (o && typeof o === 'object' && o.v === 2) return o;
    if (raw != null) console.info('[mobile] discarded the pre-fix boot counter (' + String(raw).slice(0, 12) + ')');
    return { v: 2, n: 0, pending: null, safeAt: null };
  };
  const st = read();
  const save = () => { try { localStorage.setItem(LITE.bootKey, JSON.stringify(st)); } catch (e) {} };
  const visible = () => document.visibilityState !== 'hidden';

  const now = Date.now();
  let safe = false, reason = null;
  if (forcedSafe) {
    safe = true; reason = 'url';            // by hand: the record is left alone
  } else {
    const p = st.pending;
    if (p && typeof p.t === 'number' && now >= p.t && now - p.t < LITE.pendingMaxAgeMs) st.n = (st.n | 0) + 1;
    st.pending = null;
    if ((st.n | 0) >= LITE.crashesBeforeFallback) {
      if (st.safeAt && now - st.safeAt >= LITE.retryAfterMs) {
        st.n = LITE.crashesBeforeFallback - 1;   // one more try; one more death re-arms the fallback
        st.safeAt = null;
        reason = 'retry';
      } else {
        safe = true; reason = 'crashes';
        if (!st.safeAt) st.safeAt = now;
      }
    }
    if (visible()) st.pending = { t: now, safe };
    save();
  }
  Object.assign(window.LITE_PROFILE, { safe, reason, crashes: st.n | 0, lateAuthored: LITE.lateAuthored && !safe });
  if (safe && reason === 'crashes') {
    console.warn('[mobile] ' + st.n + ' boots died before the city was up — this visit uses the safe scene. ?lite=0 for everything.');
  }

  // ── Lifecycle: tell a crash from everything else ────────────────────
  if (!forcedSafe) {
    let revealed = false, succeeded = false, settle = null, veilSeen = false;
    const succeed = () => {
      if (succeeded) return;
      succeeded = true;
      st.pending = null;
      // Only a FULL boot proves the full city fits. A safe boot that survives
      // proves nothing about it, so the fallback stays until retryAfterMs.
      if (!safe) { st.n = 0; st.safeAt = null; }
      save();
    };
    const arm = () => {                  // alive, visible and still booting
      if (succeeded || !visible()) return;
      st.pending = { t: Date.now(), safe };
      save();
      if (revealed && !settle) settle = setTimeout(() => { settle = null; if (visible()) succeed(); else interrupt(); }, LITE.settleMs);
    };
    const interrupt = () => {            // whatever happens next is not our crash
      if (settle) { clearTimeout(settle); settle = null; }
      if (succeeded || !st.pending) return;
      st.pending = null;
      save();
    };
    document.addEventListener('visibilitychange', () => { if (visible()) arm(); else interrupt(); });
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('pageshow', (e) => { if (e.persisted) arm(); });
    document.addEventListener('freeze', interrupt);
    document.addEventListener('resume', arm);
    window.LITE_PROFILE.__retry = () => { st.n = Math.max(0, LITE.crashesBeforeFallback - 1); st.safeAt = null; st.pending = null; succeeded = true; save(); };

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
      revealed = true;
      arm();
    }, LITE.revealPollMs);
  } else {
    // ?lite=safe by hand: the tap is the visitor choosing the full city, so it
    // also gives that city a fair start if the record was near the fallback.
    window.LITE_PROFILE.__retry = () => { st.n = Math.min(st.n | 0, LITE.crashesBeforeFallback - 1); st.safeAt = null; st.pending = null; save(); };
  }

  // ── WebGL context loss (LITE.ctxRestoreWaitMs) ──────────────────────
  // Only the map's canvas, and only while the three.js layer is on (the safe
  // scene is MapLibre alone, which restores itself). Listened for in the
  // capture phase on window: the event does not bubble, but it does capture.
  (function () {
    let lostAt = 0, restored = false, timer = null;
    const isMapCanvas = (e) => !!(e.target && e.target.classList && e.target.classList.contains('maplibregl-canvas'));
    const recover = () => {
      timer = null;
      if (!lostAt || !visible()) return;
      if (!(window.SLOPES && window.SLOPES.on)) return;
      let last = 0;
      try { last = +sessionStorage.getItem(LITE.ctxKey) || 0; } catch (e) {}
      if (Date.now() - last < LITE.ctxReloadGapMs) { showNotice('ctx'); return; }
      try { sessionStorage.setItem(LITE.ctxKey, String(Date.now())); } catch (e) {}
      console.warn('[mobile] WebGL context was lost' + (restored ? ' and restored' : '') + '; reloading so the buildings come back');
      location.reload();            // pagehide: an interruption, not a crash
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
  const profile = safe ? LITE.safeProfile : LITE.profile;
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

  // ── The notice ──────────────────────────────────────────────────────
  function retryFull(kind) {
    // A slow build or a lost context is not a crash record: just load again.
    if (kind === 'slow' || kind === 'ctx') { location.reload(); return; }
    try { window.LITE_PROFILE.__retry(); } catch (e) {}
    const u = new URLSearchParams(visitorQuery);
    u.delete('lite');
    if (u.get('slopes') === '0') u.delete('slopes');
    if (u.get('apartments') === '0') u.delete('apartments');
    const s = u.toString();
    location.replace(location.pathname + (s ? '?' + s : '') + location.hash);
  }

  function showNotice(kind) {
    const N = LITE.notice;
    window.LITE_PROFILE.notice = kind;
    const mount = () => {
      if (document.getElementById('lite-notice')) return;
      const css = document.createElement('style');
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
      const el = document.createElement('div');
      el.id = 'lite-notice';
      el.setAttribute('role', 'status');
      const t = document.createElement('div'); t.className = 'ln-t'; t.textContent = N.titles[kind] || N.title;
      const b = document.createElement('div'); b.className = 'ln-b'; b.textContent = N.why[kind] || '';
      const a = document.createElement('div'); a.className = 'ln-a';
      const go = document.createElement('button'); go.type = 'button'; go.dataset.act = 'full'; go.textContent = N.retries[kind] || N.retry;
      const x = document.createElement('button'); x.type = 'button'; x.dataset.act = 'close'; x.textContent = '\u00d7';
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
