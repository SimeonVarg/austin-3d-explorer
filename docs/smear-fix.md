# The opening smear, settled: it is the campus GROUND SHADOWS painting over the downtown ring

**One-line mechanism.** `buildings-shadow` (js/shadows.js) is a **2D fill** —
it never depth-tests, it paints over every pixel drawn before it — and
js/outer.js inserts the whole downtown ring **below** it (outer anchors before
`buildings-ao`; the shadow fill sits above `buildings-ao`). At `INTRO.start`
(z16.2, pitch 78, bearing 5) the campus shadow hulls compress into the horizon
band, which is the same screen rows as the downtown towers' upper floors — so
the dark hulls smear straight across the towers. It clears in ~2 s because the
intro flight tilts the horizon band and the towers apart, not because anything
loads.

**The fix is one `moveLayer`, in js/shadows.js** — a file no lane in the
2026-08-22 fix round owns, so the ship lane can apply it directly. This lane
(acer/f-smear, owner of js/tower.js only) proved the patch live via the console
and committed the evidence, but made **no code change**.

## What it is NOT — both prior diagnoses are now disproven

1. **Not two duplicate downtown towers** (pre-Aug-22 QUEUE text). Already
   killed by `acer/q-slidein` (6c212c3): 0 of 243 outer-ring tower centroids
   fall in the core bbox.
2. **Not the real UT Tower / campus extrusions losing a depth fight** (the
   q-slidein refinement, and this lane's brief). Masked magenta one layer at a
   time at the exact pose: `tower-wall`, `tower-solid`, `tower-detail`,
   `buildings-3d`, `buildings-roof`, `parts-3d`, `outer-tower` — the tear
   stayed dark under every one (`shots/f/smear/s-mag-tower-wall.jpg`,
   `s-mag-buildings-3d.jpg`). The UT Tower at that pose is a few-pixel sliver
   at the horizon. Fill-extrusions depth-test correctly here; the fighter was
   never 3D-vs-3D.
3. **The culprit, positively identified:** magenta on `buildings-shadow` alone
   turns the entire tear magenta — `s-mag-buildings-shadow.jpg`, zoomed pair
   `crop2-s-mag-BASE.png` / `crop2-s-mag-buildings-shadow.png`. q-slidein's
   "hiding `buildings-*` kills it" was true because the glob included
   `buildings-shadow`; the extrusions it blamed were bystanders.

Layer stack at the pose (queried live): `outer-3d` 127 … `outer-midrise-roof`
132, then `buildings-ao` 133, `night-tower-pool-fill` 137, **`buildings-shadow`
139** — three 2D layers above six extrusion layers.

## The exact patch (js/shadows.js, initShadows)

```diff
     if (!map.getLayer(LAYER)) {
       // Below the buildings but above roads/ground, so shadows fall on the
       // street the way they should.
       const before = map.getLayer('buildings-shadow-anchor') ? 'buildings-shadow-anchor'
+                  : map.getLayer(RING_BOTTOM) ? RING_BOTTOM
                   : map.getLayer('buildings-3d') ? 'buildings-3d' : undefined;
       map.addLayer({
         id: LAYER, type: 'fill', source: SRC, minzoom: 13.5,
         paint: {
           'fill-color': '#2b2013',
           'fill-opacity': shadowOpacity(p),
           'fill-antialias': true,
         },
       }, before);
+      // THE OPENING SMEAR (QUEUE "THE OPENING SMEAR", diagnosed 2026-08-22,
+      // acer/f-smear). This layer is a 2D fill: it never depth-tests, it
+      // paints over every pixel drawn before it. js/outer.js adds the
+      // downtown ring later (network) and anchors it below `buildings-ao`,
+      // i.e. BELOW this fill — so at INTRO.start (pitch 78) the campus
+      // shadows, compressed into the horizon band, painted their dark hulls
+      // straight across the downtown towers for ~2 s after the title card
+      // lifts. Ground shadows belong under every extrusion: once the ring's
+      // lowest layer exists, tuck this fill beneath it. Proof:
+      // shots/f/smear/fix-A-before.jpg vs fix-B-after.jpg.
+      let tuckTries = 0;
+      (function tuck() {
+        if (!_map || !_map.getLayer(LAYER)) return;
+        if (_map.getLayer(RING_BOTTOM)) {
+          try { _map.moveLayer(LAYER, RING_BOTTOM); } catch (e) {}
+          return;
+        }
+        if (++tuckTries < TUCK_TRIES) setTimeout(tuck, TUCK_POLL_MS);
+      })();
     }
```

plus, next to `MIN_HEIGHT` / `MAX_LENGTH` at the top of the module:

```js
  const RING_BOTTOM = 'outer-3d'; // js/outer.js L_FLAT — the ring's lowest layer
  const TUCK_POLL_MS = 250;       // outer's layers arrive after a network fetch
  const TUCK_TRIES = 240;         // ~60 s, then give up (?outer=0 has no ring)
```

Why both halves: `initShadows` runs during buildScene, the ring lands after an
async fetch, so at add time `outer-3d` usually does not exist yet (the `before`
chain covers the rare opposite order; the tuck covers the common one). The
`buildings-shadow-anchor` escape hatch keeps its priority. `moveLayer(id, ref)`
places the layer immediately below `ref`.

## The patch was proven live before being written down

Simulated in-page (`map.moveLayer('buildings-shadow', 'outer-3d')`) on the
served worktree at the exact pose, settled 25 s, `?intro=0&drift=0`,
`cancelGraphicsAutoDetect()`, SwiftShader, screenshot-twice:

- **Tear gone**: `fix-A-before.jpg` vs `fix-B-after.jpg` (zoom pair
  `crop3-*`). 14.1% of the band's pixels changed (mean |diff|>12), 1.32%
  full-frame — the subject was on screen by the posebug house rule's own scale.
- **Shadows still draw** (the fix must not delete them): at a campus pose,
  toggling the moved layer's visibility changes 6.94% of the frame
  (`chk-A-shadows-on.jpg` / `chk-B-shadows-off.jpg`).
- **Crown intact at z16.25** (`chk-C-crown-z1625.jpg`, `crop4-crown.png`) and
  **night flood + numeral at p=0.92** (`chk-D-night-p092.jpg`,
  `crop4-night.png`) — with the move applied. js/tower.js untouched, so
  TOWER.tiling, the LEVELS tables, unstackShaft and PatternLowpass are
  untouched by construction.

Repro note for whoever applies it: the settled-pose repro is
`scripts/verify/smear3.mjs --arm settled`; the culprit isolation was
`--arm magenta --fams buildings-shadow` (the stock fams list omits it — that
omission is how two rounds blamed extrusions).

## Same defect class, left open (deliberately)

- **`buildings-ao`** (2D line, app.js) also sits above the ring and leaves a
  much fainter thin-scribble residue after the shadow fix (visible in
  `crop3-fix-B-after.png`; its magenta mask shifts the band by ~1.3/255 —
  `crop5-*`). Same one-line treatment if it ever reads as a defect on camera;
  it did not dominate a single frame this pass.
- **`night-tower-pool-fill`** (2D fill, night-only) is also above the ring.
  Not observed misbehaving; flagged so nobody rediscovers the class.

## Not established

- Whether buildings-ao's residue is visible in a real phone recording (only
  measured on SwiftShader stills).
- Anything about Z1 (the horizon slide-in) — different mechanism, untouched.
- No timing numbers anywhere: contended machine, per the round's rule.
