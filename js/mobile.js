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
 * 3,294,128 triangles; 2,570,081 of them are js/slopes-apartments.js.
 *
 * THE FIRST CUT OF THIS FILE TOOK THE WHOLE LAYER OUT ON A PHONE, and that was
 * wrong in a way only Simeon could see: the flat prisms the mesh replaces come
 * back when it goes, so The Standard stood up as TWO PLAIN PILLARS instead of
 * its W, and every one of the 195 authored buildings reverted to a box. The
 * phone stopped crashing and started lying. Two people reported it.
 *
 * So the layer was made to fit instead (js/slopes.js, the build() header):
 * planar quads are INDEXED, which is 4 vertices where there were 6, and the
 * three colour triples are normalized BYTES rather than floats, which they can
 * be because they are read from six-digit hex and never had more than 8 bits a
 * channel. Both are lossless and both were proved so rather than argued:
 * same triangle count, same geometry hash, same colour hash, 33.2% fewer
 * vertices. A vertex went from 88 bytes to 58.
 *
 * WHAT IS LEFT, and why a phone still does not get everything:
 *
 *     full scene, after both        665 MB     (was 1035)
 *     ... campus landscape off      568 MB
 *     ... + reveals and signs off   450 MB     <- the phone profile
 *     the old take-it-all-out        214 MB     (?lite=safe)
 *
 * The remaining big one is the cell tiler: 583,089 panel cells, one quad each.
 * Merging same-tone cells per face would take another ~1.1M triangles out and
 * is the next real pass; it is written up in HANDOFF.md.
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
 *   ?lite=0     never apply the phone profile (the full 665 MB scene)
 *   ?lite=1     apply it anywhere, including a desktop, for testing
 *   ?lite=safe  the fallback by hand: no three.js layer at all, 214 MB. The
 *               authored buildings revert to their flat prisms, which is ugly
 *               and cannot run out of memory.
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
    // The authored buildings STAY. `preset: performance` now also means
    // something to js/slopes-apartments.js — its byPreset table was dead and
    // is wired up, so at 0.5 the window reveals and the sign dots go and the
    // massing, the windows and the balconies do not.
    //
    // `campuslandscape: '0'` is the one whole subsystem a phone gives up:
    // 731,928 triangles of planting detail, ~97 MB, and it is the layer a
    // phone screen can least tell is missing.
    profile: {
      campuslandscape: '0',
      preset: 'performance',   // renderScale 0.75, no bloom/god-rays/flare
    },
    // THE FALLBACK, and why it is not just a smaller profile.
    //
    // 450 MB is a judgement about a phone this code cannot measure. If it is
    // wrong the failure is the worst one there is — the tab dies, reloads,
    // dies again — and it would happen in front of a recruiter with no way to
    // type a URL flag fast enough. So the page counts its own boots: the
    // counter goes up before the heavy build and is CLEARED when the veil
    // lifts, which only happens if the city finished. Two boots in a row that
    // never cleared it means the page is dying, and the third takes the safe
    // profile by itself.
    safeProfile: {
      slopes: '0',
      campuslandscape: '0',
      preset: 'performance',
    },
    bootKey: 'flyover.boot',
    crashesBeforeFallback: 2,
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

  // ?lite=safe forces the fallback by hand — the one to type if a phone is
  // still unhappy, and what the boot counter reaches on its own.
  const forcedSafe = asked === 'safe';
  const on = forcedSafe ? true
           : asked === '1' ? true
           : asked === '0' ? false
           : isSmallTouchDevice();

  window.LITE_PROFILE = { on, safe: false, applied: [], crashes: 0 };
  if (!on) return;

  // ── The boot counter ────────────────────────────────────────────────
  // Every read and write is guarded: localStorage throws in a private window
  // and on a page whose site data is blocked, and a load screen is no place
  // to find that out.
  let crashes = 0;
  const readCount = () => { try { return Math.max(0, parseInt(localStorage.getItem(LITE.bootKey) || '0', 10) || 0); } catch (e) { return 0; } };
  const writeCount = (n) => { try { localStorage.setItem(LITE.bootKey, String(n)); } catch (e) {} };

  if (!forcedSafe) {
    crashes = readCount();
    writeCount(crashes + 1);
    // Clear it the moment the city is actually up. The veil is the app's own
    // "we made it" signal, so this cannot be fooled by a page that loaded its
    // scripts and then died building the scene.
    const clear = () => writeCount(0);
    const watch = setInterval(() => {
      const v = document.getElementById('veil');
      if (!v) return;                       // not built yet; the page is early
      const gone = v.classList.contains('gone') || v.style.display === 'none' ||
                   getComputedStyle(v).opacity === '0';
      if (gone) { clearInterval(watch); clear(); }
    }, 1000);
    // A belt-and-braces clear for a browser that never reports the veil gone:
    // a page that has been alive this long did not crash-loop.
    setTimeout(clear, 120000);
  }

  const safe = forcedSafe || crashes >= LITE.crashesBeforeFallback;
  const profile = safe ? LITE.safeProfile : LITE.profile;
  window.LITE_PROFILE.safe = safe;
  window.LITE_PROFILE.crashes = crashes;
  if (safe) {
    console.warn('[mobile] ' + crashes + ' boots did not finish — falling back to the safe scene. ?lite=0 for everything.');
  }

  // Only fill in what the visitor has not set. An explicit ?slopes=1 stands.
  for (const [k, v] of Object.entries(profile)) {
    if (q.has(k)) continue;
    q.set(k, v);
    window.LITE_PROFILE.applied.push(k + '=' + v);
  }
  if (!q.has('lite')) q.set('lite', safe ? 'safe' : '1');

  try {
    history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
  } catch (e) {
    // A browser that refuses replaceState (file://, a sandboxed frame) simply
    // gets the full scene. Better than throwing on line one of the boot path.
    console.warn('[mobile] could not apply the phone profile:', e && e.message);
  }
})();
