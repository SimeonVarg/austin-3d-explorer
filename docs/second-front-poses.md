# The second front — where the crawl actually is, per file

**Status: MEASURED, 2026-08-22.** Reproduces and corrects the round-one
`street-drag` reading, attributes crawl to layers by isolation (not guess),
adds five poses covering the five untouched files, and reports the noise
floor at every one. Masks: `shots/shimmer/front2/`. Instrument:
`scripts/verify/shimmer.mjs` (unmodified scoring logic — see §5 for the two
small, additive config fixes made to it). Poses: `scripts/verify/shimmer-poses.json`
(now 9 poses, each with a `note` naming its target file/layer).

**Headline correction, stated first because it changes the priority order:**
`street-drag`'s 38.36% is real and reproduces exactly, but **it is not
primarily the window-pattern defect this investigation is chasing.** Isolating
layers shows `js/drag.js`'s own `drag-wall` contributes **zero** measurable
crawl at this pose, and ~74% of the number (28.43 of 38.36 points) survives
stripping every `fill-extrusion-pattern` wall layer in the scene — it is the
ground/road, a different, already-tracked bug. `tower-close`, not
`street-drag`, is where a real, large, currently-unmitigated wall-pattern
crawl lives, and it matches what Simeon named.

## 1. `street-drag` reproduced, then corrected

| run | crawl% | moved% |
|---|---|---|
| task's number | 38.36 | 57.6 |
| my rep 1 (`shimmer-poses.json`, 4-pose file) | 38.36 | 57.6 |
| my rep 2 (same file, independent browser launch) | 38.36 | 57.6 |
| my rep 3 (6-pose front2 file, different pose ordering) | 38.36 | 57.6 |

**Confirmed exactly, three independent ways — noise floor 0.00 percentage
points at this pose**, matching `shimmer-verdict.md` Pass 1's finding.

**The `movedPct` check the task asked for.** 57.6% is genuinely high — but
`SHIM_PATTERN=0` (every wall pattern stripped to flat colour, same 3 m/9-frame
sweep) still moves 47.4% of the frame and still "crawls" 28.43%. A step that
were simply too big would show elevated *movedPct* with *crawlPct* collapsing
toward the other poses' 1-2% floor once texture sampling is removed — that is
not what happened. So the number is not an artifact of an oversized step; it
is real non-monotonicity, most of it just not attributable to
`fill-extrusion-pattern` at all. See §2.

**Verdict on the pose:** keep it — it is legitimately the worst frame in the
city — but stop reading its headline number as "the window defect, ×10." The
mask makes this obvious at a glance (`shots/shimmer/front2/street-drag-baseline.png`
vs `...-patternoff.png`): the near shopfront wall and the downtown towers go
fully clean when patterns are stripped; the road surface filling the bottom
~40% of the frame (two clusters spanning the full 1440 px width, boxes
`0,559,1439,816` and `0,747,1439,899`) does not change AT ALL between the two
— byte-identical cluster boxes in every arm tested. That is `js/ground.js`'s
already-tracked `fill-pattern` road aliasing (`docs/GROUND_TEXTURE.md`,
`scripts/verify/pattern-scale.mjs`), not a wall.

## 2. Layer attribution at `street-drag`, by isolation (`SHIM_ONLY`)

Each row strips **only** the named layer and re-measures the identical sweep.

| layer stripped | crawl% | Δ vs baseline (38.36%) | share of the removable 9.93 pp |
|---|---|---|---|
| `drag-wall` (js/drag.js) | 38.36 | **0.00** | 0% |
| `wc-wall` (js/westcampus.js) | 37.11 | 1.25 | 13% |
| `buildings-3d` (js/facades.js core) | 29.80 | 8.56 | 86% |
| *(all wall patterns, `SHIM_PATTERN=0`)* | 28.43 | 9.93 | 100% (floor) |

0 + 1.25 + 8.56 = 9.81 ≈ 9.93 — the ledger closes to within 0.12 pp (`places-glass`
and `stadium-wall`, not isolated individually, account for the remainder).
`js/drag.js` — the file this pose was named for, the file the task's own grep
flagged as "0 refs, 2 pattern layers" — **owns none of it.** The dominant wall
contributor is `buildings-3d`, the CORE system that already shipped
`shim-lowpass`, still crawling hard at this close (z19), steep (pitch 76)
angle. Two readings follow: (a) the round-one fix is real but its calibration
does not reach this obliqueness, consistent with `docs/shimmer-mechanism.md`'s
own conclusion that the mechanism is continuous and the mitigation tuned to
one nominal ratio; (b) `js/drag.js` porting tier/soften machinery would not
move this specific pose's number at all.

`drag.js` has **one** pattern layer (`drag-wall`), not two — see §5.

## 3. `tower-close` — the pose that matches what Simeon named

| run | crawl% | moved% |
|---|---|---|
| rep 1 | 14.16 | 54.2 |
| rep 2 (independent browser launch) | 14.16 | 54.2 |

Second-worst pose in the set, confirmed exact (noise floor 0.00 pp). This is
the real, large, still-open crawl that matches *"the bottom of the tower is
having the same window glitching problem."*

**But isolating `tower-wall` (js/tower.js's own layer) tells a sharper story
than the task's premise assumed:**

| strip | crawl% | Δ vs baseline |
|---|---|---|
| `tower-wall` only | 13.68 | **0.48 pp** (3% of baseline) |
| everything (`SHIM_PATTERN=0`) | 3.88 | 10.28 pp (73%) |

`tower-wall` alone moves the number almost nothing, and the three largest
mask clusters (boxes `795,684-1301,817`, `0,427-302,726`, `104,647-554,746`)
are **byte-identical** between the baseline and the tower-wall-only-stripped
run — same pixels, same size, unmoved. Overlaying those boxes on the frame:
none of them sit on the Tower shaft (roughly x=690-790 in this pose); they sit
on San Jacinto Hall and the other dorms/halls crowding the foreground and
midground, all painted by `buildings-3d`. The full-strip mask
(`tower-close-patternoff.png`) confirms this by eye — the surrounding
buildings go from saturated magenta to clean, and the shaft's own change is
comparatively minor.

**Correction to the task's framing:** at a pose that puts the Tower's base
front and centre, most of the measured crawl is the *already-shipped, already
partially-mitigated* `buildings-3d` system still crawling hard at this
close/steep angle — not `tower.js`'s own unmitigated layer. Porting
tier/soften to `tower.js` alone would fix ~3% of this pose's number. The
bigger, harder finding is that **`shim-lowpass`'s calibration does not reach
this obliqueness even on the system it already covers.** `tower.js` is still
worth fixing (see §5), just not the dominant story at this specific framing.

## 4. The other four poses — baseline, floor, and what the masks show

All confirmed exact across two independent reps (noise floor 0.00 pp at every
one — see the raw logs referenced in §6 for the paired numbers).

| pose | targets | baseline crawl% | pattern-off floor% | relative drop | what the mask shows |
|---|---|---|---|---|---|
| `moody-west` | js/moody.js `moody-wall` | 2.51 | 2.22 | 12% | Moody Center itself carries almost no visible magenta in EITHER mask; the scattered specks are distant background buildings/labels, not this building. Low-priority — this framing does not exercise moody.js much. |
| `arts-ransom` | js/arts.js `arts-panel` | 6.11 | 4.40 | 28% | The clearest change is a patterned cluster on a **background** tower near the Capitol, not obviously the Ransom Center panel wall itself. Real, moderate, but not cleanly isolated to arts.js by this pose. |
| `places-shopfront` | js/places.js `places-glass` (+ drag-wall overlap) | 4.21 | 2.69 | 36% | The dominant visible change is on the **West Campus dorm towers** in frame (Moontower, Skyloft — `wc-wall`), not the ground-floor shopfronts `places-glass` targets. This pose does not isolate places.js well; see §7. |
| `westcampus-street` | js/westcampus.js `wc-wall` | 4.12 | 2.52 | 39% | Dramatic, clean visual confirmation on the near dorm tower — dense diagonal-hatched magenta in baseline, mostly gone in pattern-off. Real crawl, despite `wc-wall` already being tier+soften-mitigated (see the correction below). |

## 5. Two corrections to the task's own premises, both source- and live-confirmed

1. **`js/westcampus.js` does not belong on the "untouched" list.**
   `js/westcampus.js:1025` paints `wc-wall` with
   `'fill-extrusion-pattern': window.FACADE_PATTERN_EXPR` — read live off the
   running style (`getPaintProperty`), it is the **byte-identical** expression
   object `buildings-3d` uses, confirmed also by static read
   (`docs/facade-atlas-map.md` §2, already said this). It already has the
   full tier+soften chain. Its grep-based "0 refs" in the task brief is a
   false negative of grepping the file's own text for `facadeTierExpr` — the
   reference is to a *global* set by `js/facades.js`, so it doesn't appear
   textually in `westcampus.js` even though the mechanism applies. The real
   count of untouched files is **five, not six**: `drag.js`, `tower.js`,
   `arts.js`, `moody.js`, `places.js`.

2. **`drag.js` and `tower.js` each have ONE pattern layer, not two.** Live
   inventory (`m.getStyle().layers` filtered to `fill-extrusion` layers
   carrying a `fill-extrusion-pattern` paint property) shows: `drag-wall`
   only (drag-cap/drag-detail are flat colour); `tower-wall` only
   (tower-solid/tower-detail are flat colour). `arts.js` does have two
   (`arts-panel`, `arts-glass`), `moody.js` and `places.js` one each
   (`moody-wall`, `places-glass`), matching the brief.

**A bonus, unflagged sixth front: `js/heroes.js`.** Not on the task's list at
all, but the live inventory shows **seven** raw pattern layers with no tier
suffix and no `SOFTEN` reference — `heroes-lime`, `heroes-brick`,
`heroes-nbrick`, `heroes-glass`, `heroes-glassb`, `heroes-glassc`,
`heroes-lattice` (EER, Dell CS and PCL-adjacent buildings). More untouched
pattern layers than any single file on the original list. Not measured this
round (no pose targets it) — flagged for whoever picks this up next.

**A latent bug found and fixed in `shimmer.mjs` itself while building the
isolation harness:** `SHIM_PATTERN=0`'s hardcoded strip list had
`'places-solid'` (a flat-colour layer with nothing to strip) where
`'places-glass'` (the actual pattern layer) belonged, and was missing
`'arts-glass'` and all seven `heroes-*` layers. Before this fix, every prior
`SHIM_PATTERN=0` control run in this repo's history was silently leaving
those four+ layers patterned. Fixed in the same commit as the new `SHIM_ONLY`
knob (below) — corrected list confirmed against the live style, no
`missing_*` errors in any run's `CONFIG` echo.

## 6. Instrument changes (additive only, scoring logic untouched)

`scripts/verify/shimmer.mjs`:
- Fixed the `SHIM_PATTERN=0` strip list (see §5).
- Added `SHIM_ONLY=id[,id...]` — strips only the named layer(s) instead of
  the full list, for exactly this kind of per-layer isolation. Same
  `setPaintProperty` code path as the existing full strip; nothing about the
  9-frame sign-change scan changed.

`scripts/verify/shimmer-poses.json` (I own this file): grew from 4 to 9
poses. The 5 new poses each carry a `note` naming the file/layer they target
and where their coordinates came from (reused from existing pose files in
this directory — `shots-towerglow.json`, `moody-shots.json`, `shots-arts.json`,
`shots-places.json`, `shots-drag.json` — not invented). Two small helper files
used for the isolation runs, kept for reuse: `shimmer-poses-front2.json` (the
6 non-original poses in one file) and single-pose files
`shimmer-poses-iso-{tower,drag}.json`.

## 7. What this did NOT establish

- **`places-glass` and `arts-panel`/`arts-glass` were not isolated
  individually** (only measured via the full pattern-off floor at their
  poses) — §2's arithmetic bounds `places-glass`'s own street-drag
  contribution at ≲0.12 pp, but `arts-ransom` and `places-shopfront`'s splits
  between "this file's own layer" and "a neighbouring building in frame"
  are inferred from the mask images, not confirmed by `SHIM_ONLY` the way
  `drag-wall`/`tower-wall`/`wc-wall`/`buildings-3d` were. Both poses'
  dominant visible crawl looks like it belongs to a NEIGHBOURING building
  (a downtown tower near arts-ransom, West Campus dorm towers near
  places-shopfront) rather than the named file's own layer — worth a
  follow-up isolation pass before spending build effort on `arts.js` or
  `places.js` specifically based on these two poses alone.
- **`js/heroes.js`'s seven pattern layers are not measured at any pose** —
  flagged in §5 as a structural fact (live inventory), not a measured
  contributor.
- **`moody-west` barely exercises `js/moody.js`** — Moody Center itself
  shows almost no crawl in this framing; a tighter pose closer to the
  building may be needed before concluding moody.js is low-priority.
- Frame/render cost of any of this was not measured — this pass is
  pixel-correctness only, per the instrument's own nature.
- The exact identity of the "neighbouring building" driving `arts-ransom`'s
  and `places-shopfront`'s crawl (which layer, which specific building) was
  read off the mask by eye, not confirmed by a further isolation run.
