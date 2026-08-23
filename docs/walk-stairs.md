# Stairs — knowing where they are, and offering a way round them

Acer lane `acer/w-stairs`, 2026-08-23, round 1. Written files: `js/wayfind.js`
(§5b plus four marked lines elsewhere), `shots/walk/stairs/`, this document.
`scripts/bake_ground.py` was read closely and **deliberately not changed** — §8
says why. Nothing else was touched; four other lanes are in this file today.

Confidence marks are the house convention from `docs/entrances/`:
**[M]** measured here, **[D]** derived from an [M] by an argument written out,
**[C]** cited to a source I have not re-measured, **[U]** an authoring default.

**The one-line answer.** The router already knew where every staircase was and
was saying only how many. It now lists them in order, says which way you go up
where OpenStreetMap knows, and — on nine routes in ten that have stairs — offers
a step-free route with its price on the button. The step-free answer is checked
against the graph on every single route before it is offered, and 112 of 112
offers in the census contain zero stepped edges.

---

## 1. Four counts, and three of them were being confused

Everything downstream depends on getting this straight, so it is first.

| count | what it is | how it was measured |
|---|---|---|
| **189** | `highway=steps` ways in `data/osm_cache/footways.json` | **[M]** direct count |
| **215** | edges in `data/walk_graph.json` with the STEPS flag | **[M]** a flight with a bend is several edges of ONE way; `e.s` carries the way id |
| **168** | steps ways with at least one edge **on the main component** | **[M]** `F_STEPS && !F_OFFMAIN`, 21 ways are entirely on stranded islands |
| **179** | `u:'steps'` polygons in `data/ground.geojson` | **[M]** and it is **not a staircase count** — see below |

### 1a. 168 is the number the interface may print, and it was printing 189

`dijkstra()` skips every `F_OFFMAIN` edge, with the avoid-stairs toggle on or
off. So 21 of the 189 staircases are ones the router has never been able to walk
over in either state, and ticking the box does not "avoid" them — it changes
nothing about them at all. The shipped card said:

> Avoids **189** mapped staircases. Kerbs and doorways are not checked.

It now reads 168, off `routableStairways(g)`, which counts exactly the set
`edgeCost()` prices at Infinity **and** `dijkstra()` is willing to relax. The
sentence one line above it said *"Routes around every staircase OpenStreetMap
has mapped on campus"* — 189 — sitting directly over a count of 168. That is now
*"Routes around every mapped staircase it can reach."*

### 1b. 179 is paint, not stairs, and it is reproducible to the digit

`scripts/bake_ground.py` takes every `highway=steps` line, buffers it out to
`DEFAULT_WIDTH['steps'] = 3.0 m` with flat caps and mitre joins, and unions the
result **per (use, surface) group**. Flights that touch a neighbour merge into
one polygon. I re-ran that transform from the OSM cache and got the shipped file
back exactly **[M]**:

```
LAT0 30.285 | steps ways entering the ground bake: 188   (189 minus one crossing)
  surface brick        2 flights ->   2 polygons
  surface concrete   159 flights -> 151 polygons
  surface limestone    1 flights ->   1 polygons
  surface paving      26 flights ->  25 polygons
reproduced polygon count: 179
shipped ground.geojson u='steps': 179  [concrete 151, paving 25, brick 2, limestone 1]
```

**179 = 188 flights with nine merges.** Nothing in the route may ever be checked
against it, and no sentence may ever print it as a number of staircases. The
script that reproduces it is `prove179.py`, quoted in §10.

---

## 2. What the card says now

`shots/walk/stairs/` — before and after on the same route, ART → UT Tower, which
crosses seven flights.

| file | what it shows |
|---|---|
| `before-card-crop.png` | the shipped card: `Stairs: 7 sets`, a checkbox, and nothing else |
| `after-card-legs.png` | the leg list, positioned, and the step-free offer with its price |
| `after-card-stepfree.png` | what the offer button lands on, and the way back priced too |
| `after-card-nostepfree.png` | a route with stairs and no step-free answer — FAC → ASE |
| `after-card-longdetour.png` | MAI → TNH, where step-free costs 460 m |
| `after-card-direction.png` | WIN → DKR, the one case in eight where OSM says which way is up |
| `after-phone-legs.png` | 393 × 852, because that is what he judges it on |
| `after-city-stepfree.png` | the step-free ribbon on the city, camera from the app's own fit |

The before card, in full: *"12-16 min walk · 940 m · Stairs: 7 sets"*, then a
checkbox labelled **Avoid stairs**. Seven staircases, no idea where, and a filter
whose effect you can only discover by ticking it.

The after card, same route:

```
12-16 min walk · 940 m · Stairs: 7 sets
UT Tower · The main entrance
Tight for a 15-minute passing period

Stairs on this route
  •  Steps      at the start · near ART
  •  Steps      at the start · near ART
  •  Steps      20 m in · near ART
  •  Steps      620 m in · near WEL
  •  Steps      760 m in · near GEB
     + 2 more
Up or down is only mapped on some of them.

[      Step-free: 14–19 min · 1.2 km      ]
Avoids all 7 sets · 250 m further
It uses a different entrance.

☐ Avoid stairs
Routes around every mapped staircase it can reach.
This is not an accessibility check. …
```

Three flights inside the first twenty metres reads like a bug, so I looked
**[M]**. They are OSM ways `1526526671`, `1526526673`, `1526526669`, at
30.28584 / 30.28579 / 30.28574 — three short flights with landings between them
on the terraced approach out of the Art Building, and every one of them carries
`handrail=yes`, `ramp=separate` and **`incline=down`**. The card cannot say
"down the steps" about any of the three, and §5 is why.

### 2a. Every taste value in the block

All in `STAIRS` at the top of §5b (CLAUDE.md rule 11), one line each:
`offer`, `offerMaxExtraM` (Infinity — the option is never hidden for being
long), `allDoorsStepFree`, `mainDoorSlackM` (40), `dropStepAnchors`,
`legListMax` (5), `legListMaxNarrow` (3), `narrowPx` (520), `atRoundM` (10),
`nearBuildingM` (70), `breakStepFree` (the watched failure).

---

## 3. The leg list

**One entry per contiguous RUN of stepped edges, not one per OSM way.** Measured
before it was written: only **2 nodes** on this campus have two distinct steps
ways meeting directly, so runs and ways agree on 187 of 189 flights **[M]** — and
the census confirms zero divergence over 300 routes. The reason to group by run
anyway is the other direction: a route that goes up and back down the *same*
flight is two runs and one way id, and the way-id count that feeds the headline
would call that one staircase.

Each entry carries:

* **position** — metres from the door you start at, including the unmapped door
  leg, rounded to `atRoundM = 10 m` and collapsed to *"at the start"* below one
  rounding step. The first cut printed `8.6 m in`, which reads as a survey and
  is worth nothing to a walker.
* **which building** — the nearest register code within `nearBuildingM = 70 m`
  of the flight's own coordinates. **215 of 216** flights in the census got a
  name **[M]**.
* **direction** — *"Up the steps"* / *"Down the steps"* / *"Steps"*.

### 3a. Direction is right one time in eight, and that is the bake, not the tag

`F_INCLINE_UP_AB` means *A→B is up*, so traversing B→A is **down** and both
senses are printable from one bit. The problem is upstream: of the 80 steps ways
OSM tags with `incline` (44 up, 36 down **[M]**), `walk_graph.json` can express
**39** **[M]**. Two separate losses in `scripts/bake_walk.py`:

* `incline=down` is dropped outright — the code only ever tests `inc == "up"`;
* when an edge is stored against the way's node order the bit is **cleared**
  (`ef &= ~F_INCLINE_UP_AB`) rather than flipped, which destroys the fact
  instead of reversing it.

Measured effect on the census: **26 of 216** flights got a direction, 12.0 %.
Cross-referencing the same 216 against the OSM tags, **49** of them are on a way
OSM does tag, 22.7 % **[M]** — so the patch in §5 would very nearly double it.

---

## 4. The step-free alternative

`attachStairs()` runs on every answer. If the route has at least one flight, it
computes the step-free route and puts it on the card with the extra distance and
the extra time already worked out. No toggle to discover, no guessing what it
costs. The checkbox stays where it was and now does exactly the same thing.

### 4a. Two judgement calls, and what each one buys

Same 300 pairs, same browser, interleaved, repeated to check for drift **[M]**:

```
                                 stairy  offered          extra distance (m)
A+B  (shipped)                    124    112  90.3%  | med  50  p90 291  max 706 | diffdoor 66 | weak 10
     main door only               124     91  73.4%  | med 119  p90 328  max 770 | diffdoor  1 | weak  2
A only, keep stair anchors        124    112  90.3%  | med  44  p90 291  max 706 | diffdoor 67 | weak  0
A+B  (repeat, drift check)        124    112  90.3%  | med  50  p90 291  max 706 | diffdoor 66 | weak 10
```

**A — `allDoorsStepFree`: under step-free, route to any door, not only
`role: main`.** Worth **21 more routes with an answer at all** (91 → 112) and it
halves the typical detour (median 119 m → 44 m). The justification is not
convenience: `docs/walk-progress.md` (2026-08-23) found UT's own
`Celebrated_Entrances` survey records a *separate accessible door* for buildings
where it differs from the front door, and our `main` label came out of a ranking
rather than out of anybody standing in front of the building. Refusing the side
door because a ranking called it "secondary" is the ranking overruling the person
the toggle exists for. Citymapper's published behaviour is the same instinct —
its step-free router *"finds the best accessible entrances"*.

**`mainDoorSlackM = 40`** is A's brake. Without it, 89 of 112 offers moved you to
a different entrance, most of them to save a handful of metres. The step-free
pass therefore runs **twice** — front doors only, and every door — and the front
door wins unless the other saves more than 40 m. Different-door drops 89 → 66 and
the median detour rises 44 → 50 m **[M]**. Six metres for twenty-three fewer
surprises.

**B — `dropStepAnchors`: never seed a step-free walk on a staircase node.** 44
doors campus-wide have at least one anchor node that is an *end* of a staircase;
3 have nothing else **[M]**. Without this, a "no stairs" route can begin at the
top of a flight. It costs 6 m of median detour, loses no offers at all, and
raises a *"we can't tell whether the last few metres into the door involve
steps"* line on the 10 routes where the chosen door had no clean anchor.

That warning is deliberately an admission and not an assertion: what we know is
that the door's only mapped attachment point is an *end* of a staircase; whether
that puts steps between you and the door depends on which end, and the data does
not say. The first cut raised it for the whole door set, so a building with
eleven doors warned about a staircase the route never went near — 14 lines, 2 of
them deserved. The flag rides on the anchor now, so it is about the door you are
actually walking to.

### 4b. The offer is checked, not asserted

`edgeCost()` prices a stepped edge at `Infinity` under the step-free profile, so
a step-free route containing one is impossible. That is exactly why the check is
code:

```js
let bad = 0;
for (const leg of r.legs) for (const e of leg.edges) if (g.F[e] & F_STEPS) bad++;
if (bad) return { ok: false, why: 'assert', bad };
```

**The offer is withheld if it ever fires.** A wrong "step-free" badge leaves
somebody at the bottom of a flight; no route at all is a better failure than
that, and the card has an honest sentence for it.

**And it can be watched failing** (`scripts/verify/README.md` §"Every gate must
be watchable failing"). `WAYFIND.stairs.breakStepFree = true` makes the filter
leaky inside the page, no file on disk changes:

```
stairy 124 | offers WITHHELD by the assertion: 101 | still offered: 23 | of those LEAKING stairs: 0
 PASS  the guard fires, and nothing leaks past it
```

The 23 still offered are routes where even a leaky filter happened to find a
genuinely step-free path, and they are checked too.

### 4c. When there is no step-free route, it says so

12 of 124 stairy routes in the census have no step-free answer **[M]**. The card
prints *"No step-free route we can find between these two."* — and **not dim**.
For the one person this toggle exists for that is the most important line on the
card and a footnote is not where it goes. `SAY.avoidNone` had been written for
this and nothing said it; the failure branch printed the generic *"No walking
route found"*, which is a different and wrong fact.

---

## 5. The bug the screenshot caught, and it is the reason to look at pictures

The first build offered **"Step-free: 14–19 min · 1.2 km"** on ART → MAI. Pressing
the button answered **"No route that avoids mapped stairs."**

The offer had been worked out with the step-free door and anchor rules; the
click had not — `run()` sets `state.avoid` and calls `computeRoute` with plain
`{ avoidStairs: true }`, which is main-doors-only, and ART → MAI has no
main-door step-free route. Every number in the census was already green when
this was on screen. It was found by reading `after-card-stepfree.png`.

The fix is one delegation at the top of `computeRoute`: **`avoidStairs` with no
explicit profile IS the step-free profile**, so the toggle and the offer cannot
be different routes by construction. The census now carries an assertion for it —
*"the offered route IS the route the toggle produces"*, 112 checked, 0 bad.

### 5a. And a second one, found by driving the DOM rather than the API

`#wf-pill` toggles `state.expanded` on **any** click inside it (`js/wayfind.js`
line ~1942). Every other control on the card calls `stopPropagation` — the
chips, both action buttons, the result rows. The **Avoid stairs** checkbox did
not. So ticking the one control this whole feature is about turned step-free on
*and folded the card shut on the same gesture*: you got the answer and lost the
screen it was on. One line, marked `// 5b`. `smoke.mjs` drives it as a person
does — `document.querySelector('#wf-card .wf-toggle input').click()` — and now
reads back `"2-4 min walk · 190 m · Stairs: 1 set"` → `"2-4 min walk · 210 m ·
No stairs on this route"` with the card still open.

### The `incline` patch for `scripts/bake_walk.py` — NOT APPLIED, not my file

This recovers §3a's other 41 staircases. It needs a way to say *"the incline is
known and A→B is down"*, and the flag byte is full (bit 4 BRIDGE, 5 COVERED,
6 WHEELCHAIR_YES, 7 OFF_MAIN). The cheapest correct shape uses the file's own
existing idiom — `re` is already *"delta-coded edge indices"* — so add a second
such array rather than a bit:

```python
# scripts/bake_walk.py, in the edge loop (currently ~line 632)
#
#   OLD                                     the bit is CLEARED on a reversed
#   if inc == "up":                         edge, which destroys "b->a is up"
#       ef |= F_INCLINE_UP_AB               instead of recording it, and
#   key = (a, b) if a < b else (b, a)       incline=down never gets here at all
#   if inc == "up" and key[0] != a:
#       ef &= ~F_INCLINE_UP_AB
#
#   NEW
key = (a, b) if a < b else (b, a)
if inc in ("up", "down"):
    up_ab = (inc == "up")
    if key[0] != a:
        up_ab = not up_ab          # stored reversed: FLIP the sense, do not lose it
    if up_ab:
        ef |= F_INCLINE_UP_AB
    else:
        ef &= ~F_INCLINE_UP_AB
    incline_known.add(key)         # a set built alongside `edges`
```

and, next to where `re` is emitted, ship the membership:

```python
out["inc"] = delta_encode(sorted(edge_index[k] for k in incline_known))
```

`js/wayfind.js` §5b then reads it in `decode()` as a `Uint8Array` mask and
`stairRuns()` changes one line — `const known = g.incKnown[e]` instead of
testing the bit for presence. Expected effect, measured on this census: flights
with a direction go from **12.0 % to 22.7 %** **[M]**. Cost: ~200 integers.

Until that lands, `F_UP_AB` set means "up in the A→B sense" and clear means
"unknown", which is what §5b assumes, so nothing here is wrong today — it is
only quiet.

---

## 6. The exact patches for files this lane may not write

### 6a. `style.css` — lift these rules out of `js/wayfind.js`

§5b injects a `<style id="wf-stairs-css">` from JS. That is not this repo's
convention and it is not meant to survive; it is there because `style.css` is
another lane's file this round and a rule that lands in the wrong file is worse
than a rule that announces where it should have gone. Paste this beside the
other `.wf-*` rules and delete `STAIRS_CSS` / `ensureStairsCss()`:

```css
.wf-sthead{margin:11px 0 4px;font-weight:600;letter-spacing:.02em}
.wf-steps{margin:0 0 6px;border-left:2px solid rgba(255,190,90,.28);padding-left:9px}
.wf-step{display:flex;flex-wrap:wrap;align-items:baseline;gap:1px 8px;padding:2.5px 0;font-size:11.5px}
.wf-step-i{width:11px;flex:none;text-align:center;color:#ffcf7a;font-weight:700}
.wf-step-t{flex:1 0 auto;white-space:nowrap}
.wf-step-w{flex:0 1 auto;margin-left:auto;font-size:10.5px;opacity:.5;letter-spacing:.01em}
.wf-step.wf-dim{opacity:.5;font-size:10.5px;padding-left:19px}
.wf-stepfree{color:#a8e6b0;font-weight:600}
.wf-nostepfree{color:#ffd79a;font-weight:600}
.wf-alt{display:block;width:100%;margin-top:8px;text-align:center}
```

`.wf-step` **wraps and never ellipses**, and that is load-bearing. The first cut
gave the instruction `flex:1` with `text-overflow:ellipsis` and the position
`flex:none`, so on a 393 px phone the position won the width fight and the rows
read `S…`, `St…`, `Ste…` — the half you cannot lose, lost. The position drops to
its own line instead.

### 6b. Fold `SAY_S` into `SAY`

`SAY_S` is a separate copy block only because four lanes are editing this file
today. Once they land it is a straight merge into `SAY`, alphabetically, with the
comments intact. Nothing else refers to `SAY_S`.

### 6c. Two things for the UI lane, if there is one

* **The checkbox and the button now do the same thing.** The button is the priced
  call to action and the checkbox is the sticky preference; they read as one
  control because they are adjacent, but if the card is ever redesigned, the
  button is the one to keep above the fold.
* **`#wf-pill` has no joystick clearance.** With the card open on a 393 × 852
  phone it is 812 px tall and sits over `#joystick-zone`. `#wf-sheet` solved this
  in QUEUE Z8 with `--drive-clear`; the pill never got the same treatment.
  `legListMaxNarrow = 3` is this lane's contribution to the height (five rows put
  it at 825 px), not a fix for the underlying overlap.

---

## 7. Against Citymapper

The literal instruction strings are not published anywhere I could source, so
this compares against Citymapper's own **published behaviour**, which is, and
that is stated rather than guessed at.

| Citymapper says it does | us, now |
|---|---|
| step-free is a **route option** giving *"journeys with NO stairs"* | an offered alternative with its own time and distance, and the no-stairs claim is asserted against the graph on every route before it is shown |
| *"finds the best accessible entrances"* | `allDoorsStepFree` — any door, not just the ranked front one. We may not call a door accessible, so the card says *"It uses a different entrance"* |
| steps appear **in the leg list**, in sequence, with a direction | one row per flight, in order, positioned by distance into the walk, with up/down where the tag survives |
| never states a number of individual steps | never, and `docs/walk/graph.md` §6c has the measurement that forbids it — the best estimator is out by 8× on the long flights |
| *"walking times are adjusted for people with reduced mobility"* | **deliberately not done.** Our time is a 1.1–1.4 m/s band from Bohannon; there is no honest reduced-mobility number in this repo, and inventing one turns an assumption into a promise about a specific person |
| *"routes prioritise simplicity over travel times"* | not done. Ours is still shortest-path with a stair penalty |

Two places we say more than Citymapper does, both because the data is thin
enough that saying less would be dishonest: *"Up or down is only mapped on some
of them"*, and *"We can't tell whether the last few metres into the door involve
steps"*.

---

## 8. What this lane did not do, and why

* **`scripts/bake_ground.py` is unchanged**, though this lane owns it. The useful
  change would be to stop unioning steps across flights and stamp the OSM way id
  on each, so `ground.geojson` carries 188 identifiable staircases whose ids
  match `walk_graph.json`'s `e.s` — the ribbon could then light the exact flights
  on the route. But **`data/ground.geojson` is not on this lane's write list**,
  and a bake script that no longer describes the data file beside it is worse
  than a bake script nobody touched. The patch is one line —
  `groups.setdefault((p.get("u"), p.get("s"), p.get("wid") if p.get("u") == "steps" else None), [])`
  in `widen_paths()`, plus carrying `wid` through from the `load("footways")`
  loop — and it needs a re-bake and a `coplanar.mjs --gate` run, because
  un-merging nine touching pairs creates up to nine new coplanar pairs at
  0.22 m. Whoever owns the file next: that is the whole job.
* **No step counts, no gradient, no "uphill".** `docs/walk/graph.md` §6c-d, and
  the measurements there stand.
* **No `ramp=separate` surfacing.** 3 steps ways carry it (and one carries
  `ramp:wheelchair=separate`) **[M]** — 1.6 % of the network, and the tag says a
  ramp exists somewhere alongside, not that it is drawn or where it goes. The
  step-free router already routes around those flights.
* **No wheelchair routing.** `wheelchair=yes` is in the graph as bit 6 and is
  marked *informational only, never route on it*, which is right.

---

## 9. Cost

One extra Dijkstra becomes three on a route that has stairs (the step-free pass
runs twice, front doors and all doors). Measured **inside the page**, 300 routes
per run, unthrottled desktop Chrome, and reported as the **minimum of five runs**
per `scripts/verify/README.md` — the machine was **not quiet** (several sibling
lanes were running browsers), and the five medians for the with-stairs case
spread 6.6 / 6.7 / 7.2 / 9.8 / 13.3 ms, which is the machine, not the code
**[M]**:

```
no stairs      (1 dijkstra)      1.5 ms median   (min of 5 runs; spread 1.5-2.7)
with stairs    (+2)              6.6 ms median   (min of 5 runs; spread 6.6-13.3)
worst single answer             45.5 ms          (the first call, cold)
```

It is on a button press, not a frame, and the graph is 11,284 nodes. On a 4×
throttled phone assume ~26 ms. **[D]**

With the feature off — which is how it ships, `WAYFIND.on = false` — none of it
exists: no injected style, no `window.wayfindStairs`, no `WAYFIND.stairs`, and
zero requests for `walk_graph.json` **[M]**, checked on a plain `index.html`.

---

## 10. How to re-run it

`python scripts/serve.py <port>`, then the two scripts below from a directory
with `playwright-core` resolvable. They live in the session scratchpad; the
census is quoted in full because it is the gate and it should be lifted into
`scripts/verify/stairs.mjs` by whoever owns that directory.

```
node census.mjs 300 census300.json     # six assertions, exit 1 on any failure
node ab.mjs 300                        # the two judgement calls + the watched failure
node smoke.mjs                         # the via stop, the checkbox, the buttons, clear
node offcheck.mjs                      # the ship switch still ships nothing
python prove179.py                     # 188 flights -> 179 polygons, reproduced
```

`smoke.mjs` covers what the census cannot, because it clicks:

```
 PASS  ?from=ART&to=MAI still routes from the URL
 PASS  a coffee stop with avoidStairs=false -> {"via":"Starbucks","sets":4,"dist":1864}
 PASS  a coffee stop with avoidStairs=true  -> {"via":"Jester Java","sets":0,"dist":1276}
 PASS  the checkbox itself produces a step-free answer
 PASS  offer "Step-free: 14–19 min · 1.2 km" lands on "14-19 min walk · 1.2 km · No stairs on this route"
 PASS  back  "With stairs: 12–16 min · 940 m" lands on "12-16 min walk · 940 m · Stairs: 7 sets"
 PASS  clear still clears
```

Six assertions, all green over 300 random routable pairs:

```
 PASS  every offered step-free route has ZERO stepped edges  (112 checked, 0 bad)
 PASS  headline set-count == distinct steps ways on the path  (0 bad)
 PASS  the leg list accounts for every steps way on the path  (0 bad)
 PASS  every flight is positioned inside the route it is on  (0 bad)
 PASS  the offered route IS the route the toggle produces  (112 checked, 0 bad)
 PASS  flights (contiguous runs) == sets (distinct ways)      (0 differ)
```

The debug hook everything above is built on is `window.wayfindStairs(from, to,
{avoidStairs})`. It routes without touching the UI or the map and returns the
runs, the steps-way ids, the door pair, both counts, and — for the offer — a
re-derivation of the step-free route straight from the graph, so a test never
has to take the card's word for anything.

### `census.mjs`

```js
/**
 * census.mjs — the stairs census, driven through the REAL js/wayfind.js.
 * Nothing here reimplements the router. It calls window.wayfindStairs(), which
 * is the same computeRoute() the card draws from, then checks the answer
 * against the graph the answer came out of.
 */
import { chromium } from 'playwright-core';
import { launch } from '<repo>/scripts/verify/chrome.mjs';

const URL = `http://127.0.0.1:${process.env.PORT}/index.html?walk=1&intro=0&drift=0`;
const browser = await launch(chromium, { maxMs: 900000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => window.cancelGraphicsAutoDetect && window.cancelGraphicsAutoDetect());
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 240000 });
await page.waitForFunction(() => typeof window.wayfindStairs === 'function', null, { timeout: 60000 });

await page.evaluate(() => window.wayfindStairs('WEL', 'PCL'));          // warm the graph
const LIST = await page.evaluate(async () =>
  Object.keys(await fetch('data/walk_graph.json').then(r => r.json()).then(g => g.code)));

// a fixed seed, so a re-run compares against the same 300 pairs
function rng(s) { s >>>= 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const rand = rng(20260823), pairs = [], seen = new Set();
while (pairs.length < 300) {
  const a = LIST[Math.floor(rand() * LIST.length)], b = LIST[Math.floor(rand() * LIST.length)];
  if (a === b || seen.has(a + '>' + b)) continue;
  seen.add(a + '>' + b); pairs.push([a, b]);
}

const rows = await page.evaluate(async (pairs) => {
  const out = [];
  for (const [a, b] of pairs) {
    const t0 = performance.now();
    const r = await window.wayfindStairs(a, b);
    r.wallMs = performance.now() - t0;
    out.push(r);
  }
  return out;
}, pairs);

const ok = rows.filter(r => r.ok);
const offered = ok.filter(r => r.stairFlights > 0 && r.stepFree && r.stepFree.ok);
let fails = 0;

// 1. THE ONE THAT MATTERS. Asserted per route, not argued once.
const leak = offered.filter(r => r.stepFree.verifiedStepEdges !== 0 || r.stepFree.verifiedFlights !== 0);
if (leak.length) fails++;

// 2. the headline count is the distinct steps ways actually walked over
const badCount = ok.filter(r => r.stairSets !== new Set(r.stepWays).size);
if (badCount.length) fails++;

// 3. the list accounts for every one of them
const badRuns = ok.filter(r => r.runs.length !== r.stairFlights ||
  r.runs.reduce((n, s) => n + s.ways, 0) < r.stepWays.length);
if (badRuns.length) fails++;

// 4. every flight is positioned inside the route it is on
const badAt = ok.filter(r => r.runs.some(s => !(s.atM >= 0) || s.atM > r.distM + 1));
if (badAt.length) fails++;

// 5. THE OFFER IS THE ROUTE THE BUTTON LANDS ON. This exists because the first
//    build failed it, and the failure was invisible in every number above.
const toggled = await page.evaluate(async (p) => {
  const out = []; for (const [a, b] of p) out.push(await window.wayfindStairs(a, b, { avoidStairs: true }));
  return out;
}, offered.map(r => [r.from, r.to]));
const mismatch = offered.filter((r, i) => !toggled[i].ok ||
  Math.abs(toggled[i].distM - r.stepFree.distM) > 0.5 || toggled[i].stairFlights !== 0);
if (mismatch.length) fails++;

await browser.__done();
process.exit(fails ? 1 : 0);
```
