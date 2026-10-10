/**
 * wayfind-loader.js — load js/wayfind.js (893 KB, the walking feature) only when the feature is asked for.
 *
 * WHY. js/wayfind.js returns on its first line unless the feature is switched on (its own header: "OFF MEANS
 * OFF"), but the browser still downloads and parses all 893 KB of it on every visit, in the middle of the
 * blocking script list, before app.js (docs/speed-2026-10-09.md section 5, rank 7: 24 % of the page's gzipped
 * script). With the feature off it added nothing to the page and cost a download and a parse. This file is
 * the 1 KB that decides, so the other 893 KB is not requested at all on a normal visit.
 *
 * WHEN IT LOADS. Exactly when js/wayfind.js would have run past its first line. The condition below is a COPY of
 * the one in js/wayfind.js ("ON/OFF, decided before anything else happens"): ?walk=0 vetoes everything; else on
 * for ?walk=<anything>, ?from=, ?to=, ?livehere=1, or when the ship switch is on. scripts/verify/wayfind-lazy.mjs
 * fails if the two ever differ, or if the ship switch here and `on:` in js/wayfind.js disagree. When the
 * conditions hold the file is written into the page with document.write, which is parser-blocking, so it
 * runs at exactly the place in the script order it always did (after js/slopes-*.js, before js/live-here*.js,
 * js/controls.js and js/app.js) and window.WAYFIND, wayfindStore and the rest exist when those run.
 *
 * WHEN IT DOES NOT. With none of those, window.WAYFIND is not defined (it used to be the taste block with
 * on:false and nothing else; js/loader.js and js/analytics.js already guard on `window.WAYFIND &&`), and no
 * network request for js/wayfind.js is made. ?wayfind=eager loads it anyway: the switch for A/B on one build.
 *
 * FOR ANOTHER FEATURE THAT NEEDS THE IMPORTER OR THE ROUTER. js/wayfind.js still decides for itself whether it is
 * on, from the same URL, so a feature that needs it must be reached with one of the switches above (the apartment
 * finder uses ?livehere=1, which is on that list). `ensureWayfind()` is the late path: it resolves when
 * js/wayfind.js has been loaded, and a page that is not on the list gets the file but not the feature. If a
 * future module needs the importer without the URL, js/wayfind.js has to learn a second switch; this file will
 * then need it too, and wayfind-lazy.mjs will say so.
 */
(function () {
  'use strict';
  const SHIP = false;   // = WAYFIND.on in js/wayfind.js: the switch that ships the button to everyone
  const q = new URLSearchParams(window.location.search);
  const urlWalk = q.get('walk');
  const urlFrom = q.get('from');
  const urlTo = q.get('to');
  const ENABLED = urlWalk !== '0' &&
    (SHIP || urlWalk != null || urlFrom != null || urlTo != null || q.get('livehere') === '1');
  const SRC = 'js/wayfind.js';
  let loaded = false, pending = null;
  window.WAYFIND_LAZY = { enabled: ENABLED, eager: q.get('wayfind') === 'eager', loadedAtBoot: false, requested: false };
  if (ENABLED || window.WAYFIND_LAZY.eager) {
    loaded = true; window.WAYFIND_LAZY.loadedAtBoot = true; window.WAYFIND_LAZY.requested = true;
    document.write('<script src="' + SRC + '"><\/script>');
  }
  /** Resolves when js/wayfind.js has run. Loads it now if the page did not at boot. */
  window.ensureWayfind = function ensureWayfind() {
    if (loaded) return Promise.resolve(window.WAYFIND || null);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC; s.onload = () => { loaded = true; window.WAYFIND_LAZY.requested = true; resolve(window.WAYFIND || null); };
        s.onerror = () => { pending = null; reject(new Error('could not load ' + SRC)); };
        document.head.appendChild(s);
      });
    }
    return pending;
  };
})();
