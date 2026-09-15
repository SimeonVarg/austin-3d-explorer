/**
 * mobile.js — keep the phone alive.
 *
 * THE DEFECT. On an iPhone the site loaded, ran, and then the tab died and
 * reloaded, over and over: Safari says "A problem repeatedly occurred", Chrome
 * for iOS (same WebKit) says "Can't open this page". Desktop was fine. That
 * pair of messages is WebKit killing a tab for memory, not a JavaScript error —
 * there is nothing in the console to find, which is why this looked mysterious.
 *
 * THE MEASUREMENT (scripts/verify/mobile-budget.mjs, 390x844 at DPR 3, heap
 * read after a forced GC so it is retained memory and not allocator noise).
 * MINIMUM of the reps, per CLAUDE.md rule 10 — a single heap reading moved by
 * 60 MB run to run on this build, and the veil by a factor of two under load,
 * so the spread is quoted with the number and only the GAP is load-bearing:
 *
 *                              heap (min of reps)   veil (min of reps)
 *     full scene                    1035 MB   (6 reps, 1035-1109)   39 s
 *     ?apartments=0                  419 MB   (2 reps, 419-445)     42 s
 *     ?slopes=0                      189 MB   (6 reps, 189-222)     14 s
 *
 * That is the JS heap ALONE. GPU buffers, the tile workers and the decoded
 * basemap sit on top of it, so the real footprint is worse than these say.
 *
 * Desktop Chrome's heap limit is 4096 MB, so 1.1 GB is survivable there and
 * invisible. WebKit on a phone is nowhere near that, and it does not throw —
 * it takes the tab.
 *
 * WHERE IT ALL IS. One layer, and inside it one generator. js/slopes.js draws
 * 3,294,128 triangles; 2,570,081 of them are js/slopes-apartments.js. Those
 * meshes are NON-INDEXED and carry 22 floats a vertex (position, normal, the
 * day/golden/night colour triples, aGrad, aFacet, aSurface), so one triangle
 * costs 264 bytes of attribute buffer:
 *
 *     2,570,081 triangles x 3 vertices x 22 floats x 4 bytes = 679 MB
 *
 * That is the number above, and it is a DATA problem — indexing the geometry
 * or packing those attributes would fix it for every device. That is a real
 * pass, not a morning's work, and it is written up in HANDOFF.md. This file is
 * the thing that has to be true before then: the phone must not crash.
 *
 * WHAT THIS FILE DOES, AND WHY IT IS A URL REWRITE. Every subsystem in this app
 * already reads its own on/off switch out of `location.search` at boot
 * (`q.get('slopes') !== '0'`, and the same shape in a dozen files). So the
 * smallest correct lever is to write the phone's defaults INTO the query
 * string before any of those modules parse it — one file, loaded first, and not
 * one line changed in js/slopes.js, js/graphics.js or any other module. Nothing
 * else in the app has to know this file exists.
 *
 * It is `history.replaceState`, so the address bar shows what the scene
 * actually is and the page is shareable and reloadable as-is.
 *
 * ESCAPE HATCHES, both ways:
 *   ?lite=0   never apply the phone profile (full scene on a phone — this is
 *             what crashed, so it is opt-in on purpose)
 *   ?lite=1   apply it anywhere, including a desktop, for testing
 *   An explicit flag always wins: ?slopes=1 on a phone keeps the slopes layer,
 *   because a value the visitor typed is not this file's to overrule.
 */
(function () {
  'use strict';

  // ── Taste block (CLAUDE.md rule 11) ─────────────────────────────────
  const LITE = {
    // The profile. Each key is an existing URL flag; each value is what the
    // phone gets when the visitor has not said otherwise.
    //
    // `slopes: '0'` takes the whole three.js layer out, which is every one of
    // its generators — the apartments that cost the 679 MB, and with them the
    // Capitol dome, the pitched roofs, the arches, the campus art and the
    // stadium mesh. Dropping ONLY the apartments leaves 419 MB, which is
    // better looking and a worse bet: 419 MB is a guess about someone else's
    // phone, and the fill-extrusion stand-ins this layer replaces are still
    // there underneath it, so the roofs and the dome do not vanish — they go
    // back to being slabs. Everything else in the city stays: the buildings,
    // the ground, the Tower, the trees, the props, the outer ring, West
    // Campus, the storefronts, the entrances.
    profile: {
      slopes: '0',
      preset: 'performance',   // renderScale 0.75, no bloom/god-rays/flare
    },
    // What counts as a phone. Deliberately narrow: a coarse pointer AND a real
    // touch digitiser. A desktop has neither, and the verification harness —
    // which drives a headless Chrome at a desktop viewport — has neither, so
    // it keeps measuring the full scene and none of its numbers move.
    // A touch laptop reports `pointer: fine` for its mouse and is not caught.
    maxShortEdge: 1024,        // CSS px; admits phones and iPads, not desktops
  };

  function isSmallTouchDevice() {
    try {
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const touch = (navigator.maxTouchPoints || 0) > 0;
      const shortEdge = Math.min(screen.width || 0, screen.height || 0);
      return !!(coarse && touch && shortEdge > 0 && shortEdge <= LITE.maxShortEdge);
    } catch (e) { return false; }
  }

  const q = new URLSearchParams(location.search);
  const asked = q.get('lite');

  const on = asked === '1' ? true
           : asked === '0' ? false
           : isSmallTouchDevice();

  window.LITE_PROFILE = { on, applied: [] };
  if (!on) return;

  // Only fill in what the visitor has not set. An explicit ?slopes=1 stands.
  for (const [k, v] of Object.entries(LITE.profile)) {
    if (q.has(k)) continue;
    q.set(k, v);
    window.LITE_PROFILE.applied.push(k + '=' + v);
  }
  if (!q.has('lite')) q.set('lite', '1');

  try {
    history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
  } catch (e) {
    // A browser that refuses replaceState (file://, a sandboxed frame) simply
    // gets the full scene. Better than throwing on line one of the boot path.
    console.warn('[mobile] could not apply the phone profile:', e && e.message);
  }
})();
