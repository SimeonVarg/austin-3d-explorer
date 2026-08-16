# Y7 — the outer-ring scan: what is actually over budget, and why the three
# obvious fixes are the wrong three

Written 2026-08-16 by the Acer lane on `acer/o3-palette`. **Not fixed. Measured,
and handed to the lane that owns the file.** This document is the deliverable.

Owner of this file: whoever holds the perf lane. Nothing else writes it.

---

## 0. The one-paragraph version

`perf-budget.mjs` G3 asserts that a whole outer-ring scan costs ≤ 8 ms and it has
never once passed. The scan is `outerStamp()` in **`js/controls.js:503-571`** —
one `querySourceFeatures` call followed by a stamping loop. Every proposal on the
table (a spatial index, a cap on work per frame, a movement gate) is a proposal
about **the loop**. The loop is already capped, already resumable across frames,
already gated on 200 m of movement and a 1.5 s floor with a ×4 idle backoff, and
it already stamps into a sparse cell `Map`. **The cost is the query**, and a
single `querySourceFeatures` call cannot be split, budgeted, or deferred — it
builds its whole feature list before it returns. Measured at its cheapest,
counterbalanced minimum, that one call is **6.10 ms of the 8 ms budget** before
the loop has done anything at all. No amount of bounding the loop reaches
budget. §4 has the candidate that does, and it is a two-line change in
`js/controls.js`.

---

## 1. Conditions, quoted with every number below

* Served from a throwaway worktree of `acer/o3-palette` **with `origin/main`
  merged in**, `python scripts/serve.py 8502`. `harness-drift.mjs` PASS first.
* `perf-budget.mjs` runs headless, `gl=hardware`, **no CPU throttle**,
  `cancelGraphicsAutoDetect()` called, 1500 m driven cruise phase, min across
  interleaved counterbalanced reps.
* The two bespoke probes run **headed** with `gl: 'hardware'` — rAF timing, so
  the renderer must not be backgrounded.
* **Two other lanes were working the whole time.** Chrome process count 21-35,
  node 1-3, CPU 5-100 %, sampled before and after every reading and printed
  beside it in the raw logs.
* Every comparison below is **inside one page session**, arms interleaved, and
  reported as the **minimum** of many reps. No percentage is carried across
  sessions — HANDOFF §143 showed profiler shares on this app fall monotonically
  in sweep order regardless of which arm is under test.

---

## 2. Where the cost is — the split

`outerStamp()` is two things with one clock:

```js
const t0 = performance.now();            // controls.js:505 — clock starts HERE
... feats = map.querySourceFeatures(OUTER_SRC, { sourceLayer, filter });
while (outerPendingAt < outerPending.length) {
  if ((outerPendingAt & 63) === 0 && performance.now() - t0 > OUTER_BUDGET_MS) return;
  ...
}
```

`OUTER_BUDGET_MS` is 4. The clock starts **before** the query, so whenever the
query costs more than 4 ms the loop is already over budget on its first check
and returns after one 64-feature batch. The budget is therefore not a budget on
the loop at all; it is a budget the query has usually already spent.

Instrumented by patching `maplibregl.Map.prototype.querySourceFeatures` in an
`addInitScript` — so every call is timed from the first one, including the boot
build — over four headed cruise reps:

| rep | G3 `outerScanMsMax` | worst `querySourceFeatures('austin-outer')` | query as share of worst scan |
|---|---:|---:|---:|
| 1 | 38.3 ms | 38.2 ms | **100 %** |
| 2 | 62.7 ms | 62.5 ms | **100 %** |
| 3 | 55.1 ms | 54.9 ms | **100 %** |
| 4 | 85.6 ms | 45.7 ms | 53 % |

In three of four reps the worst scan the app has ever recorded **is** a single
query call, to within 0.2 ms. That is the finding. The stamping loop is not the
problem and never was.

---

## 3. The filter: the source comment is wrong about the cost, and right about
## the decision

`js/controls.js:521` states as fact:

> The FILTER is not a nicety: it makes MapLibre drop the low-rise before it
> builds the feature objects, and the low-rise is most of the ring.

The first half is measurably false. Filtering is **more** expensive than not
filtering, every rep, in both orderings.

Method: one page session per rep; camera placed and then **not moved**, so both
arms see an identical tile set by construction; 8 rounds of `ABBA` on even reps
and `BAAB` on odd, giving 16 timings per arm per rep with each arm in first
position equally often; **minimum** per arm; 4 reps.

| rep | first arm | A: `filter ['>',['get','h'],12]` | B: no filter |
|---|---|---:|---:|
| 1 | filtered | 10.2 ms → 926 feats | 5.5 ms → 5,964 feats |
| 2 | plain | 9.6 ms → 1,641 feats | 4.3 ms → 8,680 feats |
| 3 | filtered | 10.9 ms → 1,641 feats | 4.8 ms → 8,680 feats |
| 4 | plain | **6.1 ms** → 1,641 feats | **3.8 ms** → 8,680 feats |

Evaluating the filter expression per feature costs more than materialising the
feature. Removing the filter makes the query **1.6-2.5× cheaper** and returns
**5.3× more** features.

**But keep the filter anyway**, because the loop then has to reject them itself,
and that reject pass — the exact two lines `controls.js:536-537` already runs —
costs **17.1-23.7 ms** for the 8,680-feature list. Filtered end to end is
~6-11 ms; unfiltered end to end is ~4 + ~17 = ~21 ms. The filter is worth about
15 ms per scan. It is just worth it for the opposite reason to the one written
in the file: not because it makes the query cheap, but because it is the only
place the rejection can happen at a tolerable price at all.

**Correct the comment when the file is next opened.** It currently tells the
next reader that the query is cheap because of the filter, which is the belief
that stops anyone looking at the query.

---

## 4. Why the three proposed fixes do not reach budget, and what does

| proposal | verdict |
|---|---|
| **A spatial index** | The field is already a sparse `Map` keyed on cell, and `outerSeen` already dedupes by position+height. Indexing does not change what `querySourceFeatures` costs, which is 100 % of the worst case. **No effect on G3.** |
| **A cap on work per frame, remainder deferred** | Already implemented — `OUTER_BUDGET_MS`, `outerPending`/`outerPendingAt`, resume on the next frame. Tightening it cannot help: at the measured minimum the query alone is 6.10 ms of an 8 ms budget, so G3 is over before the loop is entered. **No effect on G3.** |
| **A gate on how far the camera moved** | Already implemented — `OUTER_RESCAN_M` 200 m, `OUTER_RESCAN_MS` 1.5 s, `outerIdleBackoff` ×4. This reduces the *duty cycle* (G5a), not the *worst case* (G3). G3 is a max, and one scan still has to happen when you arrive somewhere new. **No effect on G3.** |

**The candidate that does reach budget** — and it is in `js/controls.js`, not
this lane's file:

> **Move `t0` to after the query returns**, so `OUTER_BUDGET_MS` bounds the loop
> it was written to bound, and **charge the query separately**. Then the worst
> case is `query + 4 ms + one 64-feature batch`. With the filter kept, that is
> 6-11 + 4 ≈ 10-15 ms — still over. So it has to be paired with cutting the
> query itself, and the only honest lever left is **calling it less**: the query
> is already throttled to 1.5 s / 200 m, so the remaining move is to stop asking
> for the whole source and ask per newly-loaded tile instead — hang the stamp
> off the source's `data` event with `e.tile`, so each instalment sees one
> tile's features rather than every loaded tile's, and the same building is
> never re-materialised on every later scan. That is the shape §109 already
> guessed at ("spread the query itself across frames by tile rather than asking
> for everything") and it is the only one of the four ideas that touches the
> thing that costs.

**This lane did not implement it. `js/controls.js` belongs to another lane** and
CLAUDE.md rule 1 says a lane may read any file and write only its own.

### Why it could not be done from `js/outer.js` either

`js/outer.js` was this lane's writable file and it has no lever on this.
`controls.js`'s outer scan reads exactly two globals — `window.TILES.layers.outer.layer`
and the source id `'austin-outer'`. It never reads `window.OUTER`, so no taste
value or setting in `js/outer.js` reaches the scan. The one thing `js/outer.js`
does control that would change the query's cost is how many outer tiles are
loaded and how much each holds — and that is the drawn skyline. **Making the far
horizon smaller to make its collision scan cheaper is trading a visible defect
for an invisible one**, which is the trade this pass was told not to make. So
nothing was changed, and nothing should be.

---

## 5. The gate is real, and it is live in both directions

A gate only ever seen red could be stuck. Watched, on the merged tree:

```
PB_OUTER_MS=8   (default)  3 reps, cruise valid 3/3   FAIL  G3  12.90 ms vs 8 ms
PB_OUTER_MS=4              2 reps, cruise valid 2/2   FAIL  G3  13.60 ms vs 4 ms
PB_OUTER_MS=200            2 reps, cruise valid 2/2    ok   G3  20.70 ms vs 200 ms
```

**12.90 ms is the lowest reading anyone has taken of this scan** — the previous
low was 17.30 (§143), and before that 37.9, 40.1, 43.3 and 154. It is still
**1.6× over budget**, and the claim from §143 stands unchanged and is now better
evidenced: *there is no machine state in which the outer-ring scan comes in under
budget.*

---

## 6. What this pass did NOT establish

* **The per-tile rewrite in §4 was not built and not measured.** It is a
  reasoned candidate from a measured cause, not a demonstrated fix. Nobody
  should quote a number for it.
* **No visual work was done on the horizon**, because nothing was changed. The
  "does the skyline pop" question has no answer from this pass and needs one
  from whoever implements §4.
* **G1, G2, G4, G5a and G5b were not investigated.** They failed on every run
  here and are quoted only as context.
* **The boot-time share of the outer scan was not separated out.** In two of six
  cruise reps the cumulative maximum was set before the phase began, i.e. by the
  boot's first full field build, and that build was not measured on its own.
* **Nothing was measured on a quiet machine.** Two other lanes ran throughout.
  Every figure here is a minimum taken under contention, which biases against
  the app, not for it.
