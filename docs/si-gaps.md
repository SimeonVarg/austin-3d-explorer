# The eleven buildings a schedule could name and the router could not

2026-08-24, acer lane, branch `acer/si-gaps`. **Round 3** — every number in
round 2 was re-measured here from scratch before anything was added to it, and
one thing round 2 wrote down as "somebody else's to fix" turned out to be
fixable inside this lane.

A class-schedule import turns *"SSW 1.214, TTh 2:00pm"* into a building code and
hands it to the router. So the import feature is only ever as good as the answer
the router gives for an arbitrary code — and eleven UT codes had **no answer at
all**. This branch closes one of them for real, gives the other ten a specific
answer instead of the silence they had, and makes the one it closed actually
reachable through the interface rather than only through the API.

**The judged number: `walkmeter.mjs` reports "UT buildings this build cannot
route to at all" — 11 before, 10 after, all twenty baseline pairs unmoved.**

---

## What round 3 changed, in one paragraph

Round 2 shipped the two code tables (§3) and then wrote §6(e): *SSW and HLB
route perfectly well, but the search list greys their row out and refuses to let
anybody click it, and fixing that needs a change in the copy/render block this
lane does not own.* That was wrong, and re-reading it was the most useful thing
this round did. The row says "0 doors" because **`e.doors` is empty**, not
because the copy is wrong — and `e.doors` is empty only because `virtualDoor()`
is not run until route time. Run it at index time instead and the list counts
real doors, `routable` becomes true because those doors really are anchored to
the network, and **not one string in anybody else's block has to change.** Two
buildings went from "not walkable yet, unclickable" to pickable. Measured cost
to everything else: zero, in the strongest sense available (§4).

---

## 1. What the eleven actually were — re-measured this round, not inherited

The brief listed eleven and passed on two claims second-hand. Both were checked
again here, from the repo's own files, with a script that reads
`UT_CELEBRATED` out of `js/wayfind.js`, delta-decodes `data/walk_graph.json`
exactly as the router does, and measures against **polygon edges** in
`data/snapshots/2026-08-24/buildings.enriched.geojson` — edges, not centroids,
because an L-shaped building's centroid is nowhere near its wall.

**The list itself first.** `walkmeter.mjs` against `origin/main`'s `js/wayfind.js`
on port 8912: `BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB`. Eleven, unchanged.

| code | in the register file | UT doors | nearest walk node | nearest drawn wall | km from MAI's door | latitude |
|---|---|---|---|---|---|---|
| **SSW** | **no** | 2 | **37.4 m** | **0.37 m** | 0.90 | 30.2805 |
| SV1 | no | 1 | 9 602 m | — | 10.82 | 30.3824 |
| MER | no | 3 | 9 890 m | — | 11.11 | 30.3853 |
| FS1 | no | 1 | 10 006 m | — | 11.25 | 30.3869 |
| FSL | no | 1 | 10 066 m | — | 11.31 | 30.3874 |
| PX3 | no | 1 | 10 091 m | — | 11.32 | 30.3873 |
| TCB | no | 1 | 10 116 m | — | 11.33 | 30.3872 |
| EME | no | 1 | 10 376 m | — | 11.59 | 30.3896 |
| ROC | no | 1 | 10 498 m | — | 11.71 | 30.3905 |
| BEG | no | 1 | 10 555 m | — | 11.77 | 30.3910 |
| BE1 | no | 1 | 10 626 m | — | 11.84 | 30.3918 |

(The dashes are not "we did not look": the footprint scan is only run for a
door within 500 m of any mapped pavement, because a building ten kilometres off
the edge of the city we draw has nothing to be near.)

Three orders of magnitude apart. **Two different problems, two different fixes.**

### Claim 1 — "ten are ~11 km north at Pickle." Confirmed, independently.

9.6–10.6 km to the nearest *node of the graph* — which is the northern edge of
what this app draws, not the middle of campus — and 10.8–11.8 km from the Main
Building's own surveyed door. All ten sit at latitude 30.382–30.392 against main
campus's 30.28–30.29. `docs/import-bar-ut.md` independently matched all ten
against UT Direct's public Pickle Research Campus building index, code by code.
Two methods, one answer.

### Claim 2 — "SSW is not in UT's own register." True of OUR COPY, and the conclusion drawn from it was wrong.

SSW is genuinely absent from `data/ut_buildings.json` — checked, and it is one
line to check. But the conclusion, that SSW is therefore not a real main-campus
building, is what kept it in the unroutable list for a whole round.

- Our register file is a **198-code snapshot retrieved 2026-08-05**, and its own
  `_note` says main campus. Incomplete, not authoritative-by-omission.
- `docs/import-bar-ut.md` checked three public sources and found UT filing SSW
  under its own `UTM` (main campus) path as *school of social work building
  (ssw – 0625)*.
- **The geometry settles it without reference to any register.** UT's two
  published SSW doors land **0.37 m and 2.45 m from the edge of one footprint
  this app already draws** (id `3fcbe266-e290-46d8-8f81-149d0f98af99`, 9.8 m
  tall, unnamed in the snapshot), 37.4 m and 50.9 m from mapped pavement.

So the corrected split is **1 fixable, 10 genuinely off-map** — not 0 and 11.

### And the completeness check round 2 did not run

`CAMPUS_EXTRA` has one row. Is one row *enough*? The question is answerable
exactly: which UT-surveyed codes are missing from the register file at all, and
which of those are anywhere near this city?

```
UT_CELEBRATED codes absent from the register file (11): BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB
  ...of which within 500 m of mapped pavement: SSW
```

**Eleven and exactly one.** The table is complete by construction against the
data this repo holds, and if the register file is ever refreshed the check is
one script away from being run again.

---

## 2. Why SSW would not route, and the shape of the fix

Not a pavement problem, not a door problem. A **naming** problem.

`resolve()` looks a code up in an index built from three sources: the graph's own
codes, the West Campus list, and the register merge (QUEUE Z3). SSW is in none of
them, so `resolve('SSW')` returned `null` and `wayfindRoute` answered
`why: 'notfound'` — **the same word a typo gets**.

The machinery to route it was already there and already proven. `doorSet()`'s
rule 4 — *no door of ours, but UT surveyed one, so walk to UT's own coordinate* —
is exactly what makes **HLB** work today. SSW never reached rule 4 because it
never got an index entry. `utVirtualSnapM` is 75 m and SSW's doors are 37.4 m and
50.9 m from the network, so the snap had room to spare all along.

---

## 3. What is in the file

All of it is in `js/wayfind.js`, in the building-code tables and the
routing-graph connection, which is this lane's ownership line.

**Table A, `CAMPUS_EXTRA`** (§4b) — codes UT surveys and files as main campus
that our register snapshot omits. One row: SSW. Flagged `reg: true`, because
this *is* a register building; ours is the register copy that is short a row.

**Table B, `OFF_MAP`** (§4b) — a real UT building at a campus this app does not
draw. Ten rows, all Pickle. Deliberately **no** `reg` flag: a register entry
renders as *"X is not walkable in this build yet"*, which is a promise, and
nobody is ever going to walk from the PCL to the Research Office Complex.

Neither table stores a coordinate. Both read UT's own out of `UT_CELEBRATED`, so
the distance and direction reported for an off-map building cannot drift away
from the survey they came from. The campus centre is `MAI`'s own surveyed door
rather than a second hand-typed number.

**§4c, new this round — the UT doors are materialised at index time.** For every
entry that has no baked door and does have a UT-surveyed one (`utRoutable`,
which is true for exactly two entries on this graph), `virtualDoor()` is run once
at load and the result is written into `e.doors`. That is what makes the search
list offer the building.

**The trap that was nearly walked into, and why it does not fire.**
`virtualDoor()` snaps *differently* with "avoid stairs" on: the anchor must sit
in the step-free component (`utVirtualStepFree`). Filling `e.doors` gives
`doorSet()` a non-empty `all`, so it stops taking its `!pool.length` branch —
and that branch is where the step-free re-snap lives. Handing an avoid-stairs
walker the stair-climbing anchor is the exact bug `utVirtualStepFree` exists to
prevent, one level up.

It does not happen, because of a line that was already there: `doorSet()` filters
the pool through `stepFreeDoor()`, which keeps a door only when one of its
anchors is in the big step-free component. If the plain snap landed somewhere a
step-free walker can stand, using it is correct; if it did not, the pool empties
and the old branch re-snaps exactly as before. That is an argument, and §4 is the
measurement.

Three switches, all defaulting on, each restoring the previous behaviour when
turned off: `campusExtraCodes`, `offMapCodes`, `utDoorsIndexed`.

**The seam the import lane consumes** — read off the running page, not
transcribed:

```js
window.wayfindOffMap('MER')
// → { code:'MER', name:'Microelectronics & Engineering Research Center',
//     campus:'J.J. Pickle Research Campus', lat:30.385289, lon:-97.728277,
//     km:11.09, direction:'north', doors:3, from:'MAI' }

window.wayfindOffMap()                    // the whole table + the campuses in it
await window.wayfindRoute('PCL','MER')    // → { ok:false, why:'offmap', offMap:{…} }
await window.wayfindDoors('MER')          // → { code:'MER', doors:[], offMap:{…} }
await window.wayfindRoute('PCL','ZZQ')    // → { ok:false, why:'notfound' }
```

`why` is now four distinguishable things where two of them used to be the same
silence: `offmap` (real, elsewhere), `nodoor` (real, here, no door mapped),
`notfound` (not a UT code), and `ok`. That is the shape an OCR or a
Registration-Plus source can be added behind later without a rewrite — they
produce codes, and a code's answer is already a closed set.

### What was deliberately NOT done, and why

**`data/entrances.geojson` and `data/walk_graph.json` were not touched**, though
this lane owns both. The obvious-looking fix — add SSW's doors to
`entrances.geojson` and re-run the bake — was tried, measured, and rejected:

> `data/walk_graph.json` in `main` is **stale**. It carries `snapshot:
> "2026-08-16"` while the app draws `2026-08-24`. A clean re-bake with **no
> input changes at all** produces a different file: **+50 doors, +69 nodes,
> +73 edges, one fewer component**, and the snapshot stamp moves eight days.

Shipping that under cover of a one-building fix would put fifty unreviewed doors
into the router and hand the next lane a regression with my name on it. And it
would buy nothing on the judged metric: `walkmeter` scores the 67 codes UT
surveyed, and every one of them that a re-bake could newly reach is already
reachable through rule 4. The durable upstream fix is written down in §6 instead.

`data/walk_graph.json` is byte-for-byte `main`'s; the re-bake experiment was
rolled back and the file re-checked afterwards.

---

## 4. The measurement

`python scripts/serve.py 8912`; `node scripts/verify/harness-drift.mjs` green
first (31 scripts / 31 scripts, PASS); `node scripts/verify/walkmeter.mjs` — the
full run, live UI gate included. Same port, same browser, same page. "Before" is
this same checkout with `js/wayfind.js` restored to `origin/main`'s copy, so
nothing but that one file differs.

```
UT buildings this build cannot route to at all
   before (11):  BE1 BEG EME FS1 FSL MER PX3 ROC SSW SV1 TCB
   after  (10):  BE1 BEG EME FS1 FSL MER PX3 ROC     SV1 TCB
   newly routable:    SSW
   newly UNroutable:  none
```

**The twenty baseline pairs, checked field by field rather than by eye.** All 20
pairs compared across the 36 fields `walkmeter --json` records for each —
**720 comparisons**, covering `appDistM`, both door sources, both roles, both
link lengths, the minute range, stair sets, the corrected distance, `extraM`,
`doorExtraM`, both door errors and the self-check drift.

**703 of the 720 are byte-identical. The other 17 are door INDEX values, all of
them ≥ 656, all shifted by exactly +3, and §4's next subsection proves they are
the same physical doors.** No distance, door source, role, link length, minute
range, stair count or error moved on any pair. Summary metrics identical too:
route-extra total 87.0 m, signed −393.7 m, door-extra total 90.6 m, mean route
440.9 m, 38/38 ends at the right door, self-check drift 0.00 m on all 20.

Against **round 2's** branch rather than `main`, the same comparison is
720/720 identical apart from those 17 indices, and the per-building, stairs and
reachability rows do not move at all.

What moved, and only what should have:

| | before | after |
|---|---|---|
| routable buildings scored | 56 | **57** |
| every candidate door inside 15 m | 56/56 | **57/57** |
| mean worst-case door error | 2.324 m | **2.283 m** |
| reachable step-free from a hub | 56/56 | **57/57** |
| "avoid stairs" at the door | 9/9 clean | **10/10 clean** |

SSW does not merely route — it lands on UT's own coordinate (worst-case door
error 4 × 10⁻¹⁰ m, so the mean *improved*), it is reachable step-free, and with
"avoid stairs" ticked its two candidate doors correctly drop to the one UT marks
barrier-free. The stairs lane's fix covers it for free because SSW arrived
through the normal door path, not a special case.

**The live UI gate still passes:** a real mouse click on "Avoid stairs" turns the
routing on (WCH → MAI, 240 m → 46 m) and back off, and the pill still collapses
and reopens.

### The one difference §4c makes to that table, and why it is not one

Turning `utDoorsIndexed` on moves **17 numbers** in the per-pair JSON, and a
diff will show them, so here is exactly what they are. Every one is a door
**index**, every one is ≥ 656, and 656 is the number of doors in
`data/walk_graph.json`. Indices below that are baked doors and none of them
moved. Indices at or above it belong to doors the router *invents* at run time —
and three such doors are now invented at load instead of on demand, so the ones
invented later are numbered three higher. The shift is exactly +3, on all 17.

Saying "it is only an index" is not evidence, so it was measured as geometry.
The same build was run with `utDoorsIndexed` off and on, and the door the router
picked was recorded as a **coordinate** instead of an index:

```
20 pairs: door-index changed on 17 ends; of those, any BAKED index (<656) involved: 0
         index shifts seen: 3
         DOOR COORDINATE changed on 0 ends
         every other reported field changed on 0 ends
all 67 UT-surveyed buildings, candidate doors as COORDINATES:
         stairs allowed: 0 changed;  avoid stairs: 0 changed
```

That last line is the one that retires the step-free trap in §3: **with the
switch off and on, every one of the 67 UT-surveyed buildings offers the identical
candidate doors, in both stairs modes, to seven decimal places.** walkmeter's own
stairs and reachability rows agree — with the switch on, those rows are identical
to round 2's, not merely to `main`'s.

The switch has to be flipped **in the file**, not on `window.WAYFIND` after
load. It is read inside `buildIndex()`, and by the time a verify script can
reach the page the graph has already loaded and the index is already built. An
earlier attempt to A/B it from the page produced a perfect null result for
exactly that reason and was thrown away — the flag never did anything in either
pass. No timing claim is made about the added work either: siblings were running
on this machine, `indexMs` read 14.1 ms with the switch on and 27.1 ms with it
off in single samples, which measures the machine, not the change.

### The wider surface a schedule actually hits

`walkmeter` only scores the 67 buildings UT surveyed. A schedule can name any of
209 codes (198 register + 11 UT-only). All 209 were driven through
`wayfindRoute('PCL', code)` on both builds, by one script, with the code list
built from sources neither build can influence:

| | before | after |
|---|---|---|
| codes tried | 209 | 209 |
| codes that route | 136 | **137** |
| answered `nodoor` — real, here, no door mapped | 62 | 62 |
| answered `offmap` — real, elsewhere | 0 | **10** |
| **answered `notfound` — silence** | **11** | **0** |

The last row is the number that matters for the import feature. A made-up code
(`ZZQ`) still answers `notfound`, which is what that word is for.

---

## 5. The pictures

Three frames, and each one is cited for exactly what it shows.

### `shots/si/gaps/ssw-search-before.png` and `ssw-search-after.png`

The same panel, the same camera, the same three keystrokes typed with a real
keyboard into `#wf-to`. Before, on `origin/main`'s `js/wayfind.js`: **SSW is
typed into the box and the list is empty** — which reads as *you typed it
wrong*. After: **`SSW · School of Social Work Building · 2 doors`**, highlighted
and clickable.

Both are 1:1 crops of the top-left 480 × 300 of a 1280 × 800 frame — the panel
is the subject and the city behind it is not, and rule 12 counts every committed
byte against every parallel worktree. The rows were also read back from the DOM,
and the DOM agrees with the pixels:

| typed | before | after | read from |
|---|---|---|---|
| `SSW` | *(no rows)* | `SSW School of Social Work Building 2 doors`, **not** greyed | the DOM, `#wf-list .wf-item` |
| `MER` | *(no rows)* | `MER Microelectronics & Engineering Research Center not walkable yet`, greyed | the DOM, `#wf-list .wf-item` |
| `HLB` | `routable:false, doors:0` | `routable:true, doors:1` | `wayfindSearch()`, not the DOM |

The HLB row is labelled honestly: it was measured through `wayfindSearch()`,
which is the API `renderList()` builds the list from and which carries the same
`routable` flag that decides the `off` class — but nobody typed HLB into the box
and photographed it, so it is not claimed as a pixel.

MER staying greyed is correct and deliberate — it is eleven kilometres away.
Its *tag* is still the generic one, and that is the remaining shortfall; see
§6(b).

### `shots/si/gaps/ssw-route-eye.png`

JES → SSW, standing on the pavement the router chose and facing the way you
walk. The route reads as a cream line up the middle of the frame, between DKR
Memorial Stadium and San Jacinto Hall, and the card says **"110 m, then right ·
5–7 min walk REMAINING · 460 m · School of Social Work Building"**.

Pose, so anyone can retake it: `center [-97.734662, 30.283164], zoom 19.6,
pitch 72, bearing 93.8` — which is not a guess, it is `wayfindRoute()`'s own
`on` and `onNext` (30 % along the route, and the heading between them).
`?walk=1&drift=0&intro=0`, `cancelGraphicsAutoDetect()`, veil gone, 1280 × 800,
screenshot twice and keep the second.

**And it is our line, proved with a control rather than asserted.** At the
identical camera, the eight layers this feature owns — `wayfind-ribbon`,
`-ghost`, `-thread`, `-column`, `-lit-pad`, `-lit-dark`, `-lit-thread`,
`-dark-mark` — were set `visibility: none` and nothing else was touched:

| | changed pixels vs its own control | where |
|---|---|---|
| after (this branch) | **15 976** | x 626–842, y 279–799 — the middle of the frame |
| before (`origin/main`) | **0** | nowhere |

`wayfindClear()` is deliberately NOT the control: clearing also drops
`wf-routed` off `<body>` and restyles the whole scene, and the "difference" then
measures the theme. That mistake cost round 2 a frame; it is written down here so
it costs nobody a third.

### The two frames round 2 committed have been deleted

`ssw-arrival.png` and `ssw-route-jes.png` are gone, and not for disk. Round 2's
§5 described both as *"card collapsed"*; in both frames the card is fully
expanded, with its own **Walk it** and **Show route** buttons covering the top
of the viewport. The route in them is real — that much re-checks — but a
citation that does not match its own picture is worse than no picture, and the
frames above say the same thing without needing the reader to take anything on
trust. 2.0 MB out, 1.0 MB in.

Round 2's §5 also reported *"194 607 ribbon pixels, 319.6 per mapped metre"* for
this route. **Do not reuse that number.** It came from frames taken while tiles
were still arriving, which its own text half-admits; a clean control at a settled
camera gives 15 976 for a much closer view. The comparison it was used for was
fair — same protocol both sides — but the absolute figure is not a measurement of
anything.

---

## 6. Written down rather than done — for the lanes that own these files

**(a) `scripts/verify/walkmeter.mjs` prints a stale, and partly wrong, footer.**
It is hard-coded:

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
MER takes the generic non-routable tag, `SAY.notWalkableTag` — *"not walkable
yet"* — which over-promises about a building 11 km away. Clicking it is already
honest (`SAY.notRoutable`, *"We have no door or path for this building."*),
because these entries deliberately carry no `reg` flag. The tag is the residual.
Fixing it needs a new permitted sentence, which is
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
`2026-08-24`. The router is avoiding walls that have since moved and missing
ones that have since arrived, and it is why a re-bake with no input changes still
moves 50 doors. `scripts/snapshot_parity.py` exists to catch exactly this, so it
is worth asking why it did not. For whoever owns `scripts/bake_walk.py`.

**(d) The remaining 62 `nodoor` codes are the next real gap, and the bake already
knows which ones are winnable.** Its own health block splits them: **49 are not
on the map at all** (no OSM ref, no footprint carrying the register's name) and
**14 are on the map but the nearest mapped door is more than 40 m away and
belongs to another building.** Those 14 are the SSW-shaped ones — a real drawn
building our door-matching missed — and they are `entrances.geojson` plus a
re-bake, i.e. blocked behind (c). None of them is in `UT_CELEBRATED`, which is
why rule 4 cannot rescue them the way it rescued SSW, and why closing them is
data work rather than table work.

**(e) `e.routable` was narrower than the router. FIXED this round — see §4c.**
Round 2 measured the problem correctly (exactly two entries, HLB and SSW, routed
while the list refused to offer them) and drew the wrong conclusion from its own
experiment: widening `routable` alone made the row read "0 doors", so it
concluded the fix belonged to the copy/render block. The count was never a copy
problem. `e.doors` was empty. Filling it fixes the count, the greying and the
click together, inside this lane, with `renderList()` untouched. Left as a note
for the next lane: *when a widening produces a nonsense number, check whether the
number's source is empty before concluding the number's owner is at fault.*

---

## 7. Files

* `js/wayfind.js` — **additive only, 0 deletions**:
  * §4b — `CAMPUS_EXTRA`, `OFF_MAP`, `offMapIndex()`, `window.wayfindOffMap`,
    next to `UT_CELEBRATED`;
  * §4c — the index-time materialisation of UT's rule-4 doors (round 3);
  * three switches at the end of the config block — `campusExtraCodes`,
    `offMapCodes`, `utDoorsIndexed` — all defaulting on;
  * two merge blocks in `buildIndex()` after the register merge, plus
    `e.utRoutable` and `e.utIndexed`;
  * the `offmap` branch at the top of `wayfindRoute()`;
  * `offMap` on `wayfindDoors()`' return.

  Nothing outside `buildIndex()`, the §4b/§4c tables, the config block and those
  two API returns was touched, which matters because four sibling lanes are
  editing this file this round. As of this writing `origin/main` carries **no
  sibling code at all** since this branch's base — the only changes on it are
  docs and one screenshot — so there is nothing yet to re-check this against.
  Whoever integrates should re-run `walkmeter.mjs` on the merged tree anyway;
  a lane's own green is not proof it did not break a sibling's fix.
* `docs/si-gaps.md` — this file.
* `shots/si/gaps/` — `ssw-search-before.png`, `ssw-search-after.png`,
  `ssw-route-eye.png`. Three frames, each cited above, and nothing else
  (CLAUDE.md rule 12).
* `data/entrances.geojson`, `data/walk_graph.json`, `scripts/bake_entrances.py`
  — owned by this lane, **unchanged on purpose**, see §3.

`WAYFIND.on` untouched — the ship switch is where it was, and everything above
sits after `if (!ENABLED) return;`.
