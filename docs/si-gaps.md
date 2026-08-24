# The eleven buildings a schedule could name and the router could not

2026-08-24, acer lane, branch `acer/si-gaps`. Round 2.

A class-schedule import turns *"SSW 1.214, TTh 2:00pm"* into a building code and
hands it to the router. So the import feature is only ever as good as the answer
the router gives for an arbitrary code — and eleven UT codes had **no answer at
all**. This pass closes one of them for real, and gives the other ten a specific
answer instead of the silence they had.

**The judged number: `walkmeter.mjs` reports "UT buildings this build cannot
route to at all" — 11 before, 10 after, with all twenty baseline pairs identical
on every field.**

---

## 1. What the eleven actually were — measured, not inherited

The brief listed eleven and reported two claims second-hand. Both were re-checked
here from the repo's own files before anything was written.

**Re-verified the list itself first.** `walkmeter.mjs` against `origin/main` on
port 8912: `BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB`. Eleven, unchanged.

Then every one of them was put through the same two questions — *how far is UT's
own surveyed door from the nearest node of `data/walk_graph.json`*, and *is there
a building footprint in the snapshot the app actually draws*:

| code | nearest walk node | nearest drawn footprint |
|---|---|---|
| **SSW** | **37.4 m** | **0.4 m** — UT's SW door is on the wall |
| SV1 | 9 602 m | nothing within 200 m |
| MER | 9 890 m | nothing within 200 m |
| FS1 | 10 006 m | nothing within 200 m |
| FSL | 10 066 m | nothing within 200 m |
| PX3 | 10 091 m | nothing within 200 m |
| TCB | 10 116 m | nothing within 200 m |
| EME | 10 376 m | nothing within 200 m |
| ROC | 10 498 m | nothing within 200 m |
| BEG | 10 555 m | nothing within 200 m |
| BE1 | 10 626 m | nothing within 200 m |

Three orders of magnitude apart. **These are two different problems and they get
two different fixes.** (Method: `data/walk_graph.json`'s delta-decoded nodes and
`data/snapshots/2026-08-24/buildings.enriched.geojson`'s polygon *edges* — not
centroids, because an L-shaped building's centroid is nowhere near its wall.
Same flat metres-per-degree the router itself uses.)

### Claim 1 — "ten are ~11 km north at Pickle." Confirmed.

Measured 9.6–10.6 km to the nearest *node of the graph*, which is the northern
edge of what this app draws, not the middle of campus; from the Main Building's
own surveyed door it is 10.8–11.8 km. All ten sit at latitude 30.382–30.392
against main campus's 30.28–30.29. `docs/import-bar-ut.md` independently matched
all ten against UT Direct's public Pickle Research Campus building index, code by
code. Two methods, same answer.

### Claim 2 — "SSW is not in UT's own building register." Half true, and the half that is true is misleading.

SSW **is** genuinely absent from `data/ut_buildings.json` — that much is right,
and it is checkable in one line. But the conclusion drawn from it, that SSW is
therefore not a real main-campus building, is wrong, and it is the reason SSW sat
in the unroutable list for a whole round as though it were a Pickle building.

- Our register file is a **198-code snapshot retrieved 2026-08-05**. It is
  incomplete, not authoritative-by-omission.
- `docs/import-bar-ut.md` checked three public sources and found UT files SSW
  under its own `UTM` (main campus) path, as *school of social work building
  (ssw – 0625)*.
- **And the geometry settles it independently of any register.** UT's two
  published SSW doors land **0.4 m and 2.5 m from the edge of one footprint the
  app already draws** (id `3fcbe266-e290-46d8-8f81-149d0f98af99`, 9.8 m tall,
  unnamed in the snapshot). A building we draw, with UT's own doors on its wall,
  37 m from mapped pavement. Nothing about that is off-map.

So the corrected split is **1 fixable, 10 genuinely off-map** — not 0 and 11.

---

## 2. Why SSW would not route, and the one-line shape of the fix

Not a pavement problem, not a door problem. A **naming** problem.

`resolve()` looks a code up in an index built from three sources: the graph's own
codes, the West Campus list, and the register merge (QUEUE Z3). SSW is in none of
them, so `resolve('SSW')` returned `null` and `wayfindRoute` answered
`why: 'notfound'` — **the same word a typo gets**.

The machinery to route it was already there and already proven. `doorSet()`'s
rule 4 — *no door of ours, but UT surveyed one, so walk to UT's own coordinate* —
is exactly what makes **HLB** work today (PCL → HLB, 1 339 m, measured before and
after this change, unchanged). SSW never reached rule 4 because it never got an
index entry. `utVirtualSnapM` is 75 m and SSW's doors are 37.4 m and 50.8 m from
the network, so the snap had room to spare all along.

**The fix is the entry.** One row in a table.

---

## 3. What changed, and what deliberately did not

All of it is in `js/wayfind.js`, in the building-code tables and the
routing-graph connection, which is this lane's ownership line. Two literal tables
in the house style, next to `UT_CELEBRATED`, under a new §4b — plus two switches
in the config block so either behaviour is one line to turn off.

**Table A, `CAMPUS_EXTRA`** — codes UT surveys and files as main campus that our
register snapshot omits. One row: SSW. Flagged `reg: true`, because this *is* a
register building; ours is the register copy that is short a row.

**Table B, `OFF_MAP`** — a real UT building at a campus this app does not draw.
Ten rows, all Pickle. Deliberately **no** `reg` flag: a register entry renders as
*"X is not walkable in this build yet"*, which is a promise, and nobody is ever
going to walk from the PCL to the Research Office Complex.

Neither table stores a coordinate. Both read UT's own out of `UT_CELEBRATED`, so
the distance and direction reported for an off-map building cannot drift away
from the survey they came from. The campus centre is likewise `MAI`'s own
surveyed door rather than a second hand-typed number.

**The seam the import lane consumes:**

```js
window.wayfindOffMap('MER')
// → { code:'MER', name:'Microelectronics & Engineering Research Center',
//     campus:'J.J. Pickle Research Campus', lat:30.385289, lon:-97.728277,
//     km:11.09, direction:'north', doors:3, from:'MAI' }

window.wayfindOffMap()      // the whole table + the campuses in it
await window.wayfindRoute('PCL','MER')   // → { ok:false, why:'offmap', offMap:{…} }
await window.wayfindDoors('MER')         // → { …, doors:[], offMap:{…} }
```

`why` is now three distinguishable things where it used to be one silence:
`offmap` (real, elsewhere), `nodoor` (real, here, no door mapped), `notfound`
(not a UT code). That is the shape an OCR or Registration-Plus source can be
added behind later without a rewrite — they produce codes, and a code's answer is
already a closed set.

### What was deliberately NOT done, and why

**`data/entrances.geojson` and `data/walk_graph.json` were not touched**, though
this lane owns both. The obvious-looking fix — add SSW's doors to
`entrances.geojson` and re-run the bake — was tried, measured, and rejected:

> `data/walk_graph.json` in `main` is **stale**. It carries `snapshot:
> "2026-08-16"` while `bake_facades.snapshot_date()` now returns `2026-08-24`.
> A clean re-bake with **no input changes at all** produces a different file:
> **+50 doors, +69 nodes, +73 edges, one fewer component**, and the snapshot
> stamp moves eight days.

Shipping that under cover of a one-building fix would put fifty unreviewed doors
into the router and hand the next lane a regression with my name on it. The
`bake_walk.py` route is also not available to this lane — the script belongs to
whoever owns the graph bake, and pinning its snapshot date would mean editing it.

So: **the low-blast-radius path was taken on purpose.** SSW routes through the
same virtual-door mechanism HLB already uses, the graph is byte-identical to
`main`, and the durable upstream fix is written down in §6 rather than smuggled
in.

---

## 4. The measurement

Server `python scripts/serve.py 8912`; `node scripts/verify/walkmeter.mjs`
(the full run, live UI gate included); `node scripts/verify/harness-drift.mjs`
green first. Same port, same browser, same page, before and after.

```
UT buildings this build cannot route to at all
   before (11):  BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB
   after  (10):  BE1 BEG EME FS1 FSL MER PX3 ROC     SV1 TCB
   newly routable:    SSW
   newly UNroutable:  none
```

**Zero regression, checked field by field rather than by eye.** All 20 baseline
pairs were compared across 17 fields each — `appDistM`, both door indices, both
roles, both sources, both link lengths, the minute range, stair sets, the
corrected distance, `extraM`, `doorExtraM`, both door errors and the self-check
drift — **340 comparisons, all identical.** The summary metrics are identical
too: route-extra total 87.0 m, signed −393.7 m, door-extra total 90.6 m, mean
route 440.9 m, 38/38 ends at the right door. Self-check drift 0.00 m on all 20.

What moved, and only what should have:

| | before | after |
|---|---|---|
| routable buildings scored | 56 | **57** |
| every candidate door inside 15 m | 56/56 | **57/57** |
| mean worst-case door error | 2.324 m | **2.283 m** |
| reachable step-free from a hub | 56/56 | **57/57** |
| "avoid stairs" at the door | 9/9 clean | **10/10 clean** |

SSW does not merely route — it lands on UT's own coordinate (so the worst-case
door error *improved*), it is reachable step-free, and with "avoid stairs" ticked
its two candidate doors correctly drop to the one UT marks barrier-free. The
stairs lane's fix covers it for free because it arrived through the normal door
path, not a special case.

**The live UI gate still passes:** the real-mouse click on "Avoid stairs" turns
the routing on (WCH → MAI, 240 m → 46 m) and back off, and the pill still
collapses and reopens.

### The wider surface a schedule actually hits

`walkmeter` only scores the 67 buildings UT surveyed. A schedule can name any of
209 codes (198 register + 11 UT-only), so all 209 were driven through
`wayfindDoors` and `wayfindRoute('PCL', code)`:

| | before | after |
|---|---|---|
| codes that resolve to something | 198 | **209** |
| codes that route | 136 | **137** |
| answered `nodoor` — real, here, no door mapped | 62 | 62 |
| answered `offmap` — real, elsewhere | 0 | **10** |
| **answered `notfound` — silence** | **11** | **0** |

The number that matters for the import feature is the last row.

**And the search box was driven for real, not just the API** — the lesson
`walkmeter`'s own UI gate exists to enforce. Each code was typed into `#wf-to`
and the rendered `.wf-item` rows read back:

| typed | row now shown | pickable |
|---|---|---|
| `SSW` | *School of Social Work Building* — "not walkable yet" | no |
| `MER` | *Microelectronics & Engineering Research Center* — "not walkable yet" | no |
| `HLB` | *Health Learning Building* — "not walkable yet" | no |
| `PCL` | *Perry-Castañeda Library* — "4 doors" | yes |

Before this branch, `SSW` and `MER` returned **an empty list** — which reads as
"you typed it wrong". Now both name the building. Neither is pickable yet, and
that is a real remaining shortfall rather than a rounding error: it is written
up as §6(e), including why widening the one line that controls it was tried and
reverted.

**That table is a DOM read and is labelled as one.** A screenshot was taken of
it and then thrown away, because it did not show the list: the search sheet was
not on screen at the moment of capture, so the frame was a picture of the route
card with the evidence nowhere in it. Row classes and tag text are a fair thing
to assert from the DOM; *"the student can see this"* is not, and no such claim
is made here. The two frames in §5 are the only pixels this doc stands on.

---

## 5. The picture, and four things that went wrong before it was trustworthy

`shots/si/gaps/ssw-route-jes.png` — JES → SSW, card collapsed, the walk framed
below the pill. This frame cost four attempts and every one of the first three
would have been a lie of a different kind. Writing them down because each is a
trap the next lane will hit.

**1. The card sat on top of its own subject.** The first frame had
`expand: true`, so 560 px of open route card covered the middle of the viewport
— including the ribbon it was describing. A picture that does not show its own
subject is exactly how this project has voided rounds before. Fixed by
collapsing the card and padding the fit 430 px at the top.

**2. The obvious control measured the wrong thing.** To prove the ribbon was on
the glass, the plan was: photograph, `wayfindClear()`, photograph again,
difference. But clearing also drops the `wf-routed` class off `<body>`, which
restyles the whole scene — **56 507 pixels "changed" and their mean colour came
back brown.** That control was measuring the theme. The fix is to hide the
single layer `wayfind-ribbon` and change literally nothing else.

**3. A faint line in a wide frame is not evidence it is OUR line.** With the
clean control, the wide frame at zoom 15.65 gave **567 changed pixels, scattered
over the whole viewport, mean colour `#9e723d`** — brown, not the ribbon's
`#fff4d8` cream. At that zoom the scale is **2.6 m per pixel**, so the ribbon is
under a pixel wide. The pale line visible in that frame is as likely to be a
basemap sidewalk as our own layer, and the playbook's warning about sampling a
plausible-looking fallback instead of your own output applies exactly.

**4. Closing in on the door made it worse, for a reason worth knowing.** A
zoom-17.4 frame centred on SSW's door found **253 ribbon pixels**. The reason is
in the route's own numbers: `toLinkM = 50.8 m`. **The last 50.8 m into SSW is
the dashed "not a mapped path" leg, not the ribbon** — that is what a
`utVirtualDoors` arrival is, and HLB's looks the same. Framing the door frames
the one stretch where the ribbon does not exist.

**So the honest test is a control, not a threshold.** The identical harness was
run on **WCH → MAI, a shipped pair from `walk-pairs.json` this branch does not
touch**, and on JES → SSW, at the same padding, reporting ribbon pixels per
metre of *mapped* route (route length minus both dashed link legs):

| | WCH → MAI (shipped control) | JES → SSW (new) |
|---|---|---|
| route / mapped / dashed links | 236 m / 218 m / 17 m | 660 m / 609 m / 51 m |
| camera | zoom 18.71, 0.315 m/px | zoom 16.55, 1.409 m/px |
| pixels only the ribbon draws | 20 248 | **194 607** |
| per mapped metre | 92.8 | **319.6** |

SSW's ribbon puts an order of magnitude *more* paint on the glass than a pair
that has been shipping for weeks. Whatever else is true, it is drawn. (The
absolute counts are inflated by tiles still settling and should be read as a
comparison, not as an area — the two ran under the identical protocol, which is
what makes the comparison fair.)

`shots/si/gaps/ssw-arrival.png` is the frame to actually look at: the cream
ribbon running south past San Jacinto Hall toward SSW, card collapsed, with the
headline naming the School of Social Work Building and 660 m — the same 660 m
the API reports.

The ribbon in this app is genuinely thin at a whole-route zoom. What matters is
that SSW's is drawn no differently from a route that has been shipping for
weeks.

---

## 6. Written down rather than done — for the lanes that own these files

Five things this pass found and did not fix, because the files belong elsewhere.

**(a) `scripts/verify/walkmeter.mjs` now prints a stale, and partly wrong, line.**
Its footer is hard-coded:

```
(10 of those are 11 km north at the Pickle campus, off this map; SSW is not in UT's own register)
```

SSW is no longer in that list, and the register clause repeats the claim §1
corrects. The exact replacement:

```js
console.log('    (all of those are ~11 km north at the Pickle Research Campus, off this map —\n' +
            '     window.wayfindOffMap() has the per-code record)');
```

**(b) The copy block has no sentence for an off-map building.** A search row for
MER currently takes the generic non-routable tag, `SAY.notWalkableTag` —
*"not walkable yet"* — which is over-promising for a building 11 km away.
Clicking it is already honest (`SAY.notRoutable`, *"We have no door or path for
this building."*), because these entries deliberately carry no `reg` flag. The
tag is the residual. Fixing it needs a new permitted sentence, which is
`docs/walk/what-we-can-honestly-say.md` §11's call, not this file's. Suggested,
to be argued there first:

```js
// SAY
offMapTag: 'another campus',
offMap: (r) => r.code + ' is at UT\'s ' + r.campus + ', about ' +
               Math.round(r.km) + ' km ' + r.direction + ' — not on this map',
// renderList(), where the tag is chosen
: (e.offMap ? SAY.offMapTag : SAY.notWalkableTag));
// and the click branch
answerFail(e.offMap ? SAY.offMap(e.offMap) : e.reg ? SAY.notWalkable(e.code) : SAY.notRoutable);
```

Everything that patch needs is already on the entry — `e.offMap` carries the
code, name, campus, km and direction.

**(c) The graph bake is eight days behind the city it routes around.**
`data/walk_graph.json` says `snapshot: "2026-08-16"`; the app draws
`2026-08-24`. That means the router is avoiding walls that have since moved and
missing ones that have since arrived, and it is why a re-bake with no input
changes still moves 50 doors. Not this lane's file and not a small change —
`scripts/snapshot_parity.py` exists to catch exactly this, so it is worth asking
why it did not. Flagged for whoever owns `scripts/bake_walk.py`.

**(d) The remaining 62 `nodoor` codes are the next real gap, and the bake already
knows which ones are winnable.** Its own health block splits them: **49 are not
on the map at all** (no OSM ref, no footprint carrying the register's name) and
**14 are on the map but the nearest mapped door is more than 40 m away and
belongs to another building.** Those 14 are the SSW-shaped ones — a real drawn
building with our door-matching missing it — and they are `entrances.geojson`
plus a re-bake, i.e. blocked behind (c).
**(e) `e.routable` is narrower than the router, and it greys out two buildings
that route.** `buildIndex()` sets `e.routable` from "has a door OUR BAKE
anchored". `doorSet()` rule 4 has since made a building routable from UT's own
coordinate with no baked door at all — so the search list marks the row `off`,
tags it *"not walkable yet"*, and **refuses to let anybody click it**, while
`wayfindRoute()` takes you there without complaint. Measured against
`data/walk_graph.json`, exactly **two** entries are in that state: **HLB
(PCL → HLB, 1339 m)** — which predates this branch — and **SSW (JES → SSW,
660 m)**. Driven through the real search box, both render
`{greyed: true, meta: "not walkable yet"}` while both route.

**This lane tried the one-line widening and reverted it, which is the useful
part of the finding.** With `e.routable` widened the row became pickable and
immediately read **"0 doors"**, because `renderList()` prints `e.doors.length`
and that array is empty for exactly these two until `virtualDoor()` runs at
route time. Trading an over-promising tag for a nonsense number is not a fix,
and both strings live in the copy/render block. So the fact is published on the
entry instead — **`e.utRoutable` is set, changes nothing, and costs nothing** —
and the coherent change is one patch for whoever owns that block:

```js
// renderList(): a UT-door building is pickable, and its door count comes from
// the router rather than from the (empty) baked list.
const usable = e.routable || e.utRoutable;
const r = h('div', 'wf-item' + (usable ? '' : ' off') + (isActive ? ' active' : ''));
r.appendChild(h('span', 'wf-meta', e.routable ? (n + (n === 1 ? ' door' : ' doors'))
  : e.utRoutable ? SAY.utDoorTag          // e.g. 'entrance from UT's map'
  : e.offMap ? SAY.offMapTag
  : SAY.notWalkableTag));
if (usable) r.addEventListener('mousedown', ...);
```

`SAY.utDoorTag` needs `docs/walk/what-we-can-honestly-say.md` §11's agreement
first, same as (b). Until then the current behaviour is at least a permitted
sentence, which is why it was left alone.


---

## 7. Files

* `js/wayfind.js` — **additive only, 5 hunks, 0 deletions**, which matters
  because four sibling lanes are editing this file this round:
  * §4b — `CAMPUS_EXTRA`, `OFF_MAP`, `offMapIndex()`, `window.wayfindOffMap`,
    next to `UT_CELEBRATED`;
  * two switches at the end of the config block, `campusExtraCodes` and
    `offMapCodes`, both defaulting on;
  * two merge blocks in `buildIndex()` after the register merge, plus the
    `e.utRoutable` flag (§6e, changes no behaviour);
  * the `offmap` branch at the top of `wayfindRoute()`;
  * `offMap` on `wayfindDoors()`' return.
* `docs/si-gaps.md` — this file.
* `shots/si/gaps/` — `ssw-arrival.png` and `ssw-route-jes.png`, the two frames
  §5 cites, and nothing else (CLAUDE.md rule 12 — every committed frame is
  multiplied by every parallel worktree).
* `data/entrances.geojson`, `data/walk_graph.json`, `scripts/bake_entrances.py`
  — owned by this lane, **unchanged on purpose**, see §3. `data/walk_graph.json`
  is byte-for-byte `main`'s: sha256 `e4d28ac1fd41…`, verified after the
  re-bake experiment was rolled back.

`WAYFIND.on` untouched — the ship switch is where it was, and everything above
sits after `if (!ENABLED) return;`, so with the feature off this file is still
byte-identical past that line.
