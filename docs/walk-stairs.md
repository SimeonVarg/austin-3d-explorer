# Stairs on the walk, and the way round them

**Date:** 2026-08-23. **Branch:** `acer/w-stairs`, cut from `origin/main`
(`5896981`). **Server:** `python scripts/serve.py 8713`. **Harness-drift:**
PASS — 31 scripts in `index.html`, 31 in `_harness.html`, run before and after
the code changes. **Instrument:** playwright-core from
`scripts/verify/node_modules` (installed into this worktree; it starts empty),
Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`,
`gl:'hardware'`, `?walk=1&intro=0&drift=0`, `cancelGraphicsAutoDetect()`
called, waited on `!document.getElementById('veil')`, every frame taken twice
and the second kept.

Owns: `js/wayfind.js` (cost/penalty and alternate-route functions only),
`scripts/bake_ground.py`, `shots/walk/stairs/`, this file. Two changes that
belong to other lanes are written out verbatim in §5 and §6 rather than made.

---

## 0. The headline

Three things were wrong and are now right.

1. **One mapped staircase on campus was drawn nowhere.** OSM way `147362093`
   is tagged `highway=steps area=yes`; the ground bake skipped every
   `area=yes` pedestrian way as "a plaza, handled with the areas", and the
   plaza pass reads a different Overpass query, so it fell between the two.
   The walk graph charges people for it. **189 of 189 mapped staircases are
   now drawn**, and every stepped slab carries the OSM way ids that made it,
   so the drawn staircase and the routed staircase join on identity instead of
   on a centroid guess.

2. **"Avoid stairs" was routing people over stairs.** A route is graph edges
   *plus two straight lines we drew ourselves* — door to network, network to
   door — and those are not surveyed paths. Over 396 routes, **11 of the 140
   step-free routes the feature offered walked a door leg clean across a
   mapped staircase.** Four door anchors of 421 do it (COM, CS3, MAG, STD) and
   they sit on popular ends. The avoiding pass now refuses those anchors:
   **140 offered before, 140 offered after; 11 dirty before, 0 after.**

3. **Nothing offered the way round unless you found the toggle.** Every route
   with stairs on it now computes and *verifies* a step-free alternative
   alongside the direct one, and hands it back on the answer object with what
   it costs. When there is no such walk — 31 of 171 stair routes on this
   campus — it says so rather than offering nothing.

Pictures: `shots/walk/stairs/`.

| file | what it shows |
|---|---|
| `ART-STD-1-direct.png` / `-2-stepfree.png` | Same camera. `2-4 min walk · 160 m · **Stairs: 4 sets**` becomes `2-4 min walk · 210 m · **No stairs on this route**`, and the ribbon visibly swings west round the stepped approach to DKR. |
| `com-door-1-before.png` / `-2-after.png` | Same camera, the one constant flipped. Before: the dashed last stretch lands **on** the highlighted staircase while the card says "No stairs on this route". After: 180 m, the walk comes round the plaza and the dashed stub never touches it. |
| `campus-1-plain.png` / `-2-stairs-lit.png` | Every `u:"steps"` slab lit cyan — what "know where the stairs are" looks like. |
| `area-steps-1-plain.png` / `-2-lit.png` | The staircase at the north-west corner of the PCL plaza that was drawn nowhere until this round, plain and then lit. |

The lit layer is a **test-only** `fill-extrusion` added by the verify script and
filtered on `wid`; nothing in the app draws it. It is there because
"189 of 189 are drawn" read out of a JSON count is not the same claim as
looking at them.

---

## 1. The 179 and the 189 are the same staircases, and neither number was wrong

The brief says `data/ground.geojson` has 179 features tagged `steps`. It did.
The walk graph prices 189 `highway=steps` ways. Both are true and they are the
same staircases counted two ways:

* `data/osm_cache/footways.json` holds **189** ways with `highway=steps`.
* `data/walk_graph.json`'s `e.s` holds **exactly those 189 ids** — set
  equality, nothing in the cache missing from the graph, nothing in the graph
  invented. 215 edges over 189 ways.
* `widen_paths()` buffers each stepped centreline and **unions per
  `(use, surface)`**, so flights that touch merge into one drawn polygon. 188
  ways came out as 179 slabs.
* The 189th, way `147362093`, was tagged `area=yes` and drawn nowhere at all.

So "179 features" was never a count of staircases; it was a count of connected
blobs. **The honest number is 189 mapped staircases**, and after this round the
drawing carries the ids to prove it:

```
patharea u:steps        179  ->  180        (+1: the stepped area)
distinct OSM way ids drawn      188  ->  189
slabs with no `wid`                    0
slabs made by one way                171
slabs made by two ways                 9
```

The extra tags now on the slab, and **only** where OSM actually says it:
`inc` 76, `hr` (handrail) 57, `sc` (step_count) 9, `rmp` 3, `lit` 2. `inc` is
written only when a single way made the slab — "up" on a merged blob of three
flights is not a direction, and inventing one is the failure this file's own
TRUTH RULE forbids.

`data/ground.geojson` 5,192,647 → 5,197,734 bytes (+0.1 %), one extra feature,
and **nothing else in the file moved**: the bake was byte-for-byte reproducible
against the shipped file before the change, and the only signature difference
after it is `('patharea','steps','concrete') 151 → 152`. `data/roads.geojson`
is untouched.

## 2. The bug this round actually fixes

`js/wayfind.js` prices every `highway=steps` edge at `Infinity` when the toggle
is on. That is not the whole route. The last stretch from the walk network to a
door is a straight line we drew, and it is drawn dashed precisely because it is
not surveyed — but it is still metres a person walks.

Measured offline against the shipped graph, 396 pseudo-random building pairs:

```
                                                     before      after
routes that completed                                   396        396
routes with a staircase on them                         171        171
step-free route existed and was offered                 140        140
   ...of which walked a door leg over a staircase        11          0
no step-free route exists at all                         31         31
median extra distance of the alternative               111 m      118 m
worst extra distance                                   702 m      702 m
```

Coverage did not move. The 7 m of extra median is the price of arriving at a
door you can actually reach.

**Only four door anchors of 421 cause it** — on `COM`, `CS3`, `MAG`, `STD` —
which is why it went unnoticed and why it mattered anyway: those are common
destinations, so four anchors poisoned 8 % of every offer.

Re-measured in the real client (115 routes routed through `wayfindRoute` in the
page, not a mirror):

```
routes with stairs                48
step-free alternative offered     36     of which not genuinely step-free: 0
no alternative exists             12
the shipped toggle, same pairs    36 routes, not genuinely step-free: 0
```

### The A/B, in the browser, on the one constant that fixes it

`WAYFIND.stairAltCleanDoors` is a taste constant, so the old behaviour can be
put back in one line and the two answers compared in the same session:

```
BAT > COM   direct 151 m, "no stairs", last stretch crosses way 126328792
            toggle, cleanDoors OFF   151 m   legWays [126328792]   clean false
            toggle, cleanDoors ON    183 m   legWays []            clean true
ART > MAG   direct 544 m, 3 sets, last stretch crosses way 1512289474
            toggle, cleanDoors OFF   582 m   legWays [1512289474]  clean false
            toggle, cleanDoors ON    579 m   legWays []            clean true
PCL > COM   direct 504 m, 2 sets, last stretch crosses way 126328792
            toggle, cleanDoors OFF   523 m   legWays [126328792]   clean false
            toggle, cleanDoors ON    556 m   legWays []            clean true
```

`BAT > COM` is the ugliest of the three and it is in the pictures: with the old
rule the "avoid stairs" answer is **byte-identical to the direct route**, says
"No stairs on this route", and ends by walking down a flight of steps. `ART >
MAG` is the pleasant surprise — the clean door is 3 m *closer*.

## 3. What the code now says about a staircase

`window.wayfindStairs()` returns facts, never sentences — the wording belongs
to `docs/walk/what-we-can-honestly-say.md`, not here.

```js
{
  avoidingStairs, clean,
  sets, ways,                       // staircases the ROUTED path climbs
  list: [{ way, atM, m, dir, steps }],   // in walk order, capped at stairListMax
  legWays, legWayCount,             // staircases the two unmapped door legs cross
  stepFree: { clean, distM, extraM, lo, hi, extraMinLo, extraMinHi,
              far, sameWalk, doorChanged, doorsRefused, doorsForced,
              avoided, vertices } | null,
  stepFreeNone,                     // true when we looked and there is no way round
  graphStaircases                   // 189
}
```

`list` is the Citymapper-shaped leg list: **one entry per staircase**, never per
step and never per drawn segment, because a staircase drawn in fourteen pieces
is one staircase you climb once. What each entry may claim:

* `way` — the OSM way id, which now joins straight to `wid` on the drawn slab.
* `atM` — metres from the start of the walk to the foot of it.
* `m` — its plan length. Campus staircases run 0.7 m to 63.9 m, median 3.7 m.
* `dir` — `'up'`, `'down'`, or `''`. Direction of travel over the actual edge,
  so `up` means up **for you**, not up in OSM's node order. `''` today for 150
  of the 189, and `''` is the truth, not a gap to paper over. §5 halves that.
* `steps` — `null` today. OSM carries `step_count` on 9 ways of 189 and the
  graph does not carry it at all. §5 wires it; until then we do not print a
  number of steps, and Citymapper's "Up 24 steps" is a claim this data cannot
  make.

Nothing here says "flight". Nothing in OSM records a landing, so a flight is not
in the data — the same ruling `interface.md` already lost once.

Live example, `ART > STD`:

```
157 m, 4 sets
  way 1526526671  at   9 m   3.6 m   dir ''
  way 1526526673  at  14 m   3.1 m   dir ''
  way 1526526669  at  20 m   3.9 m   dir ''
  way 1419272907  at 142 m   7.4 m   dir 'up'
step-free: 212 m, +55 m, verified clean, 1 door anchor refused
```

## 4. What it costs

One extra Dijkstra per route that has stairs on it. **Eight fixed pairs, nine
interleaved reps, minimum of each, hardware GL, no CPU throttle, one browser:**

```
pair        without   with    extra
ART>STD      0.4 ms   0.9 ms   +0.5
GEB>WEL      0.4      1.7      +1.3      <- worst
COM>WEL      0.4      1.6      +1.2
JES>PCL      0.3      0.7      +0.4
PCL>GDC      0.7      1.3      +0.6
WEL>RLP      0.9      0.9       0.0      (no stairs, no second search)
BAT>COM      0.4      0.8      +0.4
ART>MAG      1.0      2.1      +1.1
```

Worst +1.3 ms on a route that costs 0.4 ms. `WAYFIND.stairAlt = false` turns it
off entirely. The stair spatial index is built lazily on the first stair
question and memoised, so a session that never routes over a staircase never
pays for it.

## 5. TWO PATCHES FOR `scripts/bake_walk.py` — NOT THIS LANE'S FILE

Both are small, both are the difference between a leg list that reads like
Citymapper's and one that reads like ours. `js/wayfind.js` **already accepts
both** (`stairExtras()`) and reports `''` / `null` until they arrive, so these
land with no client change.

### 5a. `incline=down` is being thrown away

Flag bit 8 only ever means "up in the stored a→b order", and the bake sets it
only for `incline=up`. A way tagged `incline=down` therefore arrives as *no
direction at all*: 80 of 189 staircases carry `incline` in OSM and only **39**
reach the client with a usable direction.

There is no free flag bit (1,2,4,8,16,32,64,128 are all taken), so the down
edges ship as their own sparse list.

In the edge loop, replace:

```python
            ef = f
            # incline is a direction on the way's node order, not a gradient.
            if inc == "up":
                ef |= F_INCLINE_UP_AB
            key = (a, b) if a < b else (b, a)
            if inc == "up" and key[0] != a:
                ef &= ~F_INCLINE_UP_AB   # stored a->b in sorted order
```

with:

```python
            ef = f
            # incline is a direction on the way's node order, not a gradient.
            # `down` is as much a direction as `up`; dropping it lost 36 of
            # the 80 tagged staircases (docs/walk-stairs.md §5a).
            up_ab = True if inc == "up" else (False if inc == "down" else None)
            key = (a, b) if a < b else (b, a)
            if up_ab is not None and key[0] != a:
                up_ab = not up_ab            # stored a->b in sorted order
            if up_ab is True:
                ef |= F_INCLINE_UP_AB
            elif up_ab is False:
                down_keys.add(key)
```

with `down_keys = set()` declared next to `edges = {}`, and — once `order` (the
emitted edge order) exists — one more array in the `e` block:

```python
    dn, prev = [], 0
    for i, k in enumerate(order):
        if k in down_keys:
            dn.append(i - prev)
            prev = i
    ...
    "e": {..., "dn": dn},
```

`dn` is delta-coded edge indices, the same shape as `re`. On today's data it is
about 40 small integers. Extend `_format` with:
`"e.dn: delta-coded edge indices whose stored a->b direction is DOWNhill; bit 8 is UP, and an edge in neither has no tagged incline."`

### 5b. `step_count` never reaches the client

Nine ways of 189 carry `step_count` and the graph drops it, so the interface
cannot say "21 steps" about the one staircase where OSM knows. Emit a small
top-level map beside `code` / `name`:

```python
    sc = {}
    for w in load("data/osm_cache/footways.json")["elements"]:
        t = w.get("tags") or {}
        if t.get("highway") != "steps":
            continue
        v = str(t.get("step_count") or "").strip()
        if v.isdigit():
            sc[str(w["id"])] = int(v)
    ...
    "sc": sc,          # way id -> OSM step_count. NINE ways of 189 have one.
```

Nine entries, ~150 bytes. `js/wayfind.js` reads `g.raw.sc` already.

## 6. THE INTERFACE PATCH — NOT THIS LANE'S FUNCTIONS EITHER

Four sibling lanes are in `js/wayfind.js` this round and `renderPill()` is not
mine, so the presentation is written out rather than made. Everything it needs
is already on the answer object.

Wording is a **proposal**, not a decision: `docs/walk/what-we-can-honestly-say.md`
§11 outranks this file and should ratify these before they ship. They are built
to survive its three existing rulings — no single number, no "flight", and
never the phrase "step-free" as a headline promise (the audit already replaced
`Step-free: 15 min` with `Avoid stairs` for exactly that reason).

Add to `SAY`:

```js
    // one line per staircase, in walk order — the leg list
    stairLegUp:   (d) => 'Up a staircase, ' + d + ' in',
    stairLegDown: (d) => 'Down a staircase, ' + d + ' in',
    stairLeg:     (d) => 'A staircase, ' + d + ' in',
    // ...and, once bake_walk ships `sc` (§5b), only where OSM has the number
    stairLegUpN:   (n, d) => 'Up ' + n + ' steps, ' + d + ' in',
    stairLegDownN: (n, d) => 'Down ' + n + ' steps, ' + d + ' in',
    // the offer. `Avoiding stairs`, not `Step-free`, per the honesty audit.
    avoidOffer: (lo, hi, dist, extra) =>
      'Avoiding stairs: ' + lo + '-' + hi + ' min, ' + dist + ' (+' + extra + ')',
    avoidOfferSame: (lo, hi, dist) =>
      'Avoiding stairs costs nothing here: ' + lo + '-' + hi + ' min, ' + dist,
    avoidOfferFar: (extra) => 'The way round adds ' + extra + '.',
    // the disclosure the router could never make before
    legStairs: (n) => 'The last stretch crosses ' + n + ' mapped staircase' +
      (n === 1 ? '' : 's'),
```

In `renderPill()`, immediately after the `r.m.signals` line:

```js
    // THE STAIRS, ONE LINE EACH, IN WALK ORDER (docs/walk-stairs.md §3).
    if (r.stair && r.stair.list.length) {
      const ul = h('div', 'wf-stairs');
      for (const s of r.stair.list) {
        const d = fmtDist(s.atM);
        const t = s.steps != null
          ? (s.dir === 'up' ? SAY.stairLegUpN(s.steps, d)
            : s.dir === 'down' ? SAY.stairLegDownN(s.steps, d) : SAY.stairLeg(d))
          : (s.dir === 'up' ? SAY.stairLegUp(d)
            : s.dir === 'down' ? SAY.stairLegDown(d) : SAY.stairLeg(d));
        ul.appendChild(h('div', 'wf-c wf-stair', t));
      }
      el.card.appendChild(ul);
    }
    // The unmapped last stretch crossing a staircase is a DIFFERENT fact from
    // the route climbing one, and it is the fact the toggle used to get wrong.
    if (r.stair && r.stair.legWayCount) {
      el.card.appendChild(h('div', 'wf-c wf-dim', SAY.legStairs(r.stair.legWayCount)));
    }
    // THE OFFER. Not behind the toggle: a person who cannot climb should not
    // have to find a checkbox to be told the way round exists.
    if (r.stepFree) {
      const sf = r.stepFree;
      const b = h('button', 'wf-alt', sf.sameWalk
        ? SAY.avoidOfferSame(sf.time.lo, sf.time.hi, fmtDist(sf.distM))
        : SAY.avoidOffer(sf.time.lo, sf.time.hi, fmtDist(sf.distM), fmtDist(sf.extraM)));
      b.addEventListener('click', (ev) => {
        ev.stopPropagation(); state.avoid = true; run();
      });
      el.card.appendChild(b);
      if (sf.far) el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidOfferFar(fmtDist(sf.extraM))));
    } else if (r.stepFreeNone) {
      el.card.appendChild(h('div', 'wf-c wf-dim', SAY.avoidNone));
    }
```

`SAY.avoidNone` already exists in the file and is currently referenced nowhere —
this is the branch it was written for.

**One CSS note for whoever owns the stylesheet:** `.wf-alt` should read as a
button, not a sentence; `.wf-stair` wants a small left rule or a glyph so the
leg list reads as a list at a glance. Both are taste and both are theirs.

## 7. What this pass did NOT establish

1. **Lighting is untouched.** The brief asked about streetlights and this lane
   did not do them; `data/props.geojson` has 532 OSM lamps and nothing routes
   on them (`docs/walk-evidence.md`). Two of the 189 staircases carry `lit` and
   that is now on the slab as `lit`, which is a start and not an answer.
2. **A staircase nobody mapped is still invisible.** Everything here is a claim
   about `highway=steps` in OSM, and the interface already says so
   ("there may be steps nobody has mapped"). The `clean` flag means "no MAPPED
   stairs", and no wording should promise more.
3. **Ramps beside steps are not used.** 12 ways carry `ramp` and 1
   `ramp:wheelchair`; a staircase with a ramp beside it is still refused by the
   avoiding pass. That is the conservative direction and it is deliberate, but
   it is a decision someone could revisit with better data.
4. **`sc`/`inc`/`hr` on the drawn slab are carried, not yet drawn.** Nothing in
   `js/ground.js` reads them. They exist so the two files can be joined and so
   the risers in `data/depth.geojson` have something to key on later.
5. **The base route still prefers the same doors it always did.** Only the
   avoiding pass is fussy. Changing the default door policy would desynchronise
   the client from `bake_walk.py`'s audited router, and that is a decision for
   whoever owns the bake, not a side effect of a stairs pass.
6. **No pixel assertion on the stepped slab's colour.** The new staircase is
   proved present by `querySourceFeatures` carrying `wid: 147362093` *and* by a
   filtered highlight layer in the frame. Its surface class is `concrete`, the
   same as the plaza it sits on, so a hex probe would not have distinguished
   it — the highlight is the honest instrument here.

---
---

# Round 2 — the card, and four things that only showed up once you could see it

**Date:** 2026-08-23, later the same day. **Branch:** `acer/w-stairs`, continued
on top of `735e235`. **Server:** `python scripts/serve.py 8713`. Same
instrument as round 1: playwright-core from `scripts/verify/node_modules`,
Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`,
`?walk=1&intro=0&drift=0`, `cancelGraphicsAutoDetect()`, waited on
`!document.getElementById('veil')`, every frame taken twice and the second kept.
**Harness-drift:** PASS, 31 / 31.

Round 1 stopped at the route object and wrote §6's interface patch out rather
than making it, because four lanes were in `js/wayfind.js`. **§6 is made now.**
The rest of this section is what happened once the facts were on screen.

**The one-line answer.** Of 300 random routable pairs, 125 walk over stairs and
**113 of those (90.4 %) now carry a verified step-free alternative on the card
with its price on the button**; the flights are listed in walk order, named by
the building each one is beside (215 of 216); and four defects that every number
in round 1 said were fine turned up the moment there was a picture to look at or
a control to click.

---

## R1. §6 is made. What the card says now

`shots/walk/stairs/` gained eight frames; round 1's are still there.

| file | what it shows |
|---|---|
| `before-card-crop.png` | the card as shipped: `Stairs: 7 sets`, a checkbox, nothing else |
| `after-card-legs.png` | the leg list, positioned and named, with the offer under it |
| `after-card-stepfree.png` | what the offer button lands on, with the way back priced |
| `after-card-nostepfree.png` | FAC → ASE: stairs, and no step-free answer, said in plain sight |
| `after-card-longdetour.png` | MAI → TNH, where step-free costs 460 m |
| `after-card-direction.png` | WIN → DKR, one of the flights where OSM says which way is up |
| `after-phone-legs.png` | 393 × 852, because that is what he judges it on |
| `after-city-stepfree.png` | the step-free ribbon on the city, camera from the app's own fit |

ART → UT Tower, seven flights, after:

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
**[M]**. OSM ways `1526526671`, `1526526673`, `1526526669`, at 30.28584 /
30.28579 / 30.28574 — three short flights with landings between them on the
terraced approach out of the Art Building, each tagged `handrail=yes`,
`ramp=separate` and **`incline=down`**. The card cannot say "down the steps"
about any of the three, which is §5a of round 1 showing up in a screenshot.

Two additions to round 1's leg-list facts, both in `stairLegs()`:

* **`code`** — the nearest register code within `STAIRS.nearBuildingM = 70 m` of
  where the flight starts. "620 m in" alone makes a reader count; "620 m in ·
  near WEL" is a place. **215 of 216** flights in the census got a name **[M]**.
* **position rounds to `STAIRS.atRoundM = 10 m`** in the copy, and collapses to
  *"at the start"* below one rounding step. The first cut printed `8.6 m in`,
  which reads as a survey and is worth nothing to a walker.

`legWays` — round 1's staircases that the unmapped door leg crosses rather than
the router climbs — gets its own line, because it is a different fact from the
list and the route cannot avoid it.

---

## R2. The offer and the button were not the same route

The card offered **"Step-free: 14–19 min · 1.2 km"** on ART → MAI. Pressing the
button answered **"No route that avoids mapped stairs."**

Round 1 built the alternative in `stepFreeAlternative()` with its own door and
anchor handling while `run()` built the toggle's answer through `computeRoute`,
and the two agreed only because they happened to make the same choices. The
moment R4 below let the alternative use side doors they diverged. **Every number
in the census was already green while this was on screen.** It was found by
reading `after-card-stepfree.png`.

There is one implementation now. `stepFreeRoute()` in §5b is it;
`computeRoute()` delegates to it whenever `avoidStairs` arrives without an
explicit profile, and `stepFreeAlternative()` decorates its answer with the
price. The census carries an assertion for it — *"the offered route IS the route
the toggle produces"* — and it is checked on every offer.

## R3. Ticking "Avoid stairs" folded the card shut

`#wf-pill` toggles `state.expanded` on **any** click inside it. Every other
control on the card calls `stopPropagation` — the chips, both action buttons,
the result rows. The **Avoid stairs** checkbox did not. So ticking the one
control this whole feature is about turned step-free on *and closed the panel
the answer was on*, in the same gesture. One line. `smoke.mjs` drives it as a
person does and reads back `"2-4 min walk · 190 m · Stairs: 1 set"` →
`"2-4 min walk · 210 m · No stairs on this route"`, card still open.

## R4. Under step-free, any door — not only the ranked front one

`STAIRS.allDoorsStepFree`. Round 1 used `doorSet()`, which returns `role: main`
doors when a building has any. Measured over 300 random routable pairs, same
browser, interleaved, repeated for drift **[M]**:

```
                                 stairy  offered          extra distance (m)
A+B  (shipped)                    125    113  90.4%  | med  40  p90 291  max 706 | diffdoor 64
     main door only               125     96  76.8%  | med 116  p90 328  max 770 | diffdoor  1
A, no front-door slack            125    113  90.4%  | med  40  p90 283  max 706 | diffdoor 89
A+B  (repeat, drift check)        125    113  90.4%  | med  40  p90 291  max 706 | diffdoor 64
```

**17 more routes get an answer at all** (96 → 113) and the typical detour drops
by two thirds (median 116 m → 40 m). The justification is not convenience:
`docs/walk-progress.md` (2026-08-23, the recon lane) found UT's own
`Celebrated_Entrances` survey records a *separate accessible door* where it
differs from the front door, and our `main` label came out of a ranking rather
than out of anybody standing in front of the building. Refusing the side door
because a ranking called it "secondary" is the ranking overruling the person the
toggle exists for. Citymapper's published behaviour is the same instinct — its
step-free router *"finds the best accessible entrances"*.

**`STAIRS.mainDoorSlackM = 40`** is the brake. Without it, 89 of 113 offers
moved you to a different entrance, most of them to save a handful of metres. The
step-free pass runs **twice** — front doors only, and every door — and the front
door wins unless the other saves more than 40 m. Different-door **89 → 64 with
no change at all in the median detour** (40 m either way) and 8 m at the p90
**[M]**. Twenty-five fewer surprise entrances for nothing.

## R5. The card was claiming 189 and the number is 168

`dijkstra()` skips every `F_OFFMAIN` edge with the toggle on or off, and **21 of
the 189** steps ways are entirely on stranded components **[M]**. So the filter
never "avoided" them — it changes nothing about them in either state. The card
said *"Avoids 189 mapped staircases"* directly under *"Routes around every
staircase OpenStreetMap has mapped on campus"*. It now reads 168, off
`routableStairways(g)`, which counts exactly the set `edgeCost()` prices at
Infinity **and** `dijkstra()` will relax; and the blurb above it reads *"Routes
around every mapped staircase it can reach."*

189 is still what the file holds, and `window.wayfindStairs()` returns both
(`graphStaircases`, `routableStaircases`) so a test can tell them apart.

## R6. And the phone

Five leg rows put the card at **825 px of an 852 px screen**, over the joystick
and the whole city, and the rows themselves read `S…`, `St…`, `Ste…` — the first
cut gave the instruction `flex:1` with `text-overflow:ellipsis` and the position
`flex:none`, so the position won the width fight and the instruction, the half
you cannot lose, was lost. `.wf-step` wraps and never ellipses now; the position
drops to its own line. `STAIRS.legListMaxNarrow = 3` under
`STAIRS.narrowPx = 520` brings the card to 812 px. `nb()` keeps a quantity as
one word, because the button was breaking as "Step-free: 14–19 min · 1.2 / km".

`#wf-pill` still has no joystick clearance — `#wf-sheet` got that in QUEUE Z8 via
`--drive-clear` and the pill never did. That is not this lane's to fix and it is
not caused by this lane; `legListMaxNarrow` is only this lane declining to make
it worse.

---

## R7. `179` reproduced to the digit

Round 1 §1 said the 179 and the 189 were never a disagreement. Here is the
arithmetic, run from the OSM cache with `bake_ground.py`'s own constants
(`DEFAULT_WIDTH['steps'] = 3.0`, `PATH_SIMPLIFY_M = 0.15`,
`PATH_MIN_AREA_M2 = 1.0`, `LAT0 = 30.285`), producing the shipped file's
per-surface counts exactly **[M]**:

```
steps ways entering the ground bake: 188        (189 minus one tagged as a crossing)
  surface brick        2 flights ->   2 polygons
  surface concrete   159 flights -> 151 polygons
  surface limestone    1 flights ->   1 polygons
  surface paving      26 flights ->  25 polygons
reproduced polygon count: 179
shipped ground.geojson u='steps': 179  [concrete 151, paving 25, brick 2, limestone 1]
```

**179 = 188 flights with nine merges.** No sentence may ever print it as a
number of staircases. Script: `prove179.py`, §R11.

---

## R8. The gate, and it can be watched failing

Six assertions over 300 random routable pairs, driven through the real
`js/wayfind.js` by `window.wayfindStairs(from, to)` — which routes without
touching the UI or the map and re-derives the step-free claim straight from the
graph, so a test never takes the card's word for anything.

```
 PASS  every offered step-free route is CLEAN — no stepped edge, no door leg across one
 PASS  headline set-count == distinct steps ways on the path
 PASS  the leg list accounts for every steps way on the path
 PASS  every flight is positioned inside the route it is on
 PASS  the offered route IS the route the toggle produces
 PASS  the list is in walk order and never runs past the route
```

And the watched failure, per `scripts/verify/README.md`. `WAYFIND.stairs
.breakStepFree = true` makes `edgeCost()`'s step-free filter leaky **inside the
page** — no file on disk changes:

```
stairy 125 | offers WITHHELD by the verification: 108 | still offered: 17 | of those LEAKING: 0
 PASS  the guard fires, and nothing leaks past it
```

The 17 still offered are routes where even a leaky filter happened to find a
genuinely clean path, and they are checked too.

## R9. And what it costs

Round 1 measured the alternative at +1.3 ms. Round 2 runs the step-free pass
twice (front doors, then every door), so a route WITH stairs is three routings
instead of one. Measured inside the page, 300 routes a run, reported as the
**minimum of three runs** per `scripts/verify/README.md` — the machine was **not
quiet**, several sibling lanes were driving browsers, and the three medians for
the with-stairs case came out 6.9 / 7.7 / 11.6 ms, which is the machine and not
the code **[M]**:

```
no stairs      (1 routing)       1.3 ms median   (min of 3 runs; spread 1.3-1.9)
with stairs    (3 routings)      6.9 ms median   (min of 3 runs; spread 6.9-11.6)
worst single answer             34.3 ms          (the first call, cold)
```

It is on a button press, not a frame. On a 4× throttled phone assume ~26 ms
**[D]**.

With the feature off — which is how it ships, `WAYFIND.on = false` — none of it
exists: no injected `<style>`, no `window.wayfindStairs`, no `WAYFIND.stairs`,
and **zero** requests for `walk_graph.json` **[M]**, checked on a plain
`index.html`.

---

## R10. Against Citymapper

The literal instruction strings are not published anywhere I could source, so
this is against Citymapper's own **published behaviour**, stated rather than
guessed.

| Citymapper says it does | us, now |
|---|---|
| step-free is a **route option** giving *"journeys with NO stairs"* | an offered alternative with its own time and distance, and the claim is verified against the graph on every route before it is shown |
| *"finds the best accessible entrances"* | R4 — any door, not just the ranked front one. We may not call a door accessible, so the card says *"It uses a different entrance"* |
| steps appear **in the leg list**, in sequence, with a direction | one row per flight, in walk order, positioned by distance into the walk, named by the building beside it, up/down where the tag survives |
| never states a number of individual steps | never. `docs/walk/graph.md` §6c has the measurement that forbids it, and round 1 §5b keeps `step_count` behind the same bar |
| *"walking times are adjusted for people with reduced mobility"* | **deliberately not done.** Our time is a 1.1–1.4 m/s band from Bohannon; there is no honest reduced-mobility number in this repo, and inventing one turns an assumption into a promise about a specific person |
| *"routes prioritise simplicity over travel times"* | not done. Ours is still shortest-path with a stair penalty |

Two places we say more than Citymapper does, both because the data is thin
enough that saying less would be dishonest: *"Up or down is only mapped on some
of them"*, and *"We can't tell whether the last few metres into the door involve
steps"* (round 1's `doorsForced`).

---

## R11. What round 2 did not do

* **`scripts/bake_ground.py` is unchanged this round.** Round 1 already fixed
  the missing `area=yes` staircase and stamped `wid` on the slabs, which is the
  change that mattered; nothing further was needed and re-baking a 5 MB data
  file for cosmetics is not a good trade.
* **`scripts/bake_walk.py` is still untouched**, so round 1 §5a and §5b stand as
  written. §5a is worth more now than it was: with the leg list on screen,
  direction is visible, and it is right **26 of 216 times (12.0 %)**. Of the
  same 216 flights, **49 (22.7 %)** are on a way OSM does tag `incline` **[M]** —
  the patch nearly doubles it.
* **The checkbox and the button now do the same thing.** The button is the
  priced call to action, the checkbox the sticky preference. If the card is ever
  redesigned, the button is the one that goes above the fold.

## R12. How to re-run it

`python scripts/serve.py 8713`, then, from a directory where `playwright-core`
resolves:

```
node census.mjs 300 census300.json     # the six assertions, exit 1 on any failure
node ab.mjs 300                        # allDoorsStepFree / mainDoorSlackM + the watched failure
node smoke.mjs                         # the via stop, the checkbox, both buttons, clear
node offcheck.mjs                      # the ship switch still ships nothing
python prove179.py                     # 188 flights -> 179 polygons, reproduced
```

They live in the session scratchpad. `census.mjs` is the gate and should be
lifted into `scripts/verify/stairs.mjs` by whoever owns that directory; it needs
only `window.wayfindStairs(from, to)`, which is public and read-only.

`smoke.mjs` covers what a census cannot, because it clicks:

```
 PASS  ?from=ART&to=MAI still routes from the URL
 PASS  a coffee stop with avoidStairs=false -> {"via":"Starbucks","sets":4,"dist":1864}
 PASS  a coffee stop with avoidStairs=true  -> {"via":"Jester Java","sets":0,"dist":1276}
 PASS  the checkbox itself produces a step-free answer
 PASS  offer "Step-free: 14–19 min · 1.2 km" lands on "14-19 min walk · 1.2 km · No stairs on this route"
 PASS  back  "With stairs: 12–16 min · 940 m" lands on "12-16 min walk · 940 m · Stairs: 7 sets"
 PASS  clear still clears
```

Round 1 refused the combination of a via stop and the step-free pass outright.
Round 2 carries the stop through and verifies the whole walk, because refusing
it silently dropped the option for anyone who had picked a coffee shop — and the
verification does not care that there is a stop in the middle.

### The stylesheet, for whoever owns `style.css`

§5b injects a `<style id="wf-stairs-css">` from JS. That is not this repo's
convention and it is not meant to survive; `style.css` is another lane's file
this round. Paste this beside the other `.wf-*` rules and delete `STAIRS_CSS`
and `ensureStairsCss()`:

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

`.wf-step` wrapping rather than ellipsing is load-bearing — see R6.

`SAY_S` is a separate copy block for the same reason and folds straight into
`SAY` once the other lanes land. Nothing else refers to it.

---
---

# ROUND 3 — the bar, actually fetched

Round 2's critic passed both checkable claims and then wrote `oursWins: false`
for one reason, quoted here so it does not get lost:

> *"one third of the stated bar was never obtained... get an actual Citymapper
> leg list for a real walking route with stairs in front of a person... until
> that exists, 'matches Citymapper's format' is asserted, not verified."*

That is the whole of round 3. §R10 above compared us against Citymapper's
**marketing copy**, which was the only thing either the builder or the critic
had. It is now compared against **captured frames of the product**, and five
things changed in `js/wayfind.js` because of what they showed.

## R13. The bar, fetched — Citymapper's own frames

Citymapper publishes screenshots of its own UI in its newsroom. No app, no
device, no login: the images sit on a public S3 bucket linked from two public
articles. They are **not** copied into this repo — it is a public repo and they
are someone else's product shots — so what is recorded here is the URL and the
sha256, and anyone can re-fetch and re-check every claim below.

| ref | article | image (prefix `https://cm-messenger-blog-assets.s3.eu-west-1.amazonaws.com/`) | sha256 (first 16) |
|---|---|---|---|
| **w4** | [Turn-by-turn directions for Walking](https://content.citymapper.com/news/2194/turn-by-turn-directions-for-walking) | `b68c754f-6266-4930-b78a-9e2036263d86` | `825d3aaaee9e41ba` |
| **w7** | same | `c67cb488-1675-4c88-92fa-5858e4a9b0b2` | `847b32c1f15a1ead` |
| **w3** | same | `48e48861-f4de-451f-824f-05977dcf6047` | `9f180c744efdab78` |
| **sf2** | [Find the best accessible journey with step-free routes](https://content.citymapper.com/news/2577/find-the-best-accessible-journey-with-step-free-routes) | `8b1ba990-a647-4ae2-959d-8f5133cbda3c` | `616b18705534b065` |
| **sf3** | same | `97df4248-31ba-4da8-8830-c3631f460218` | `7688b5a24415e7d4` |

**The Citymapper walking leg row, read off w4 and again off w7** — two
different cities, two different manoeuvres, identical structure:

```
 [icon]   in 85 m              1 min          [icon]   in 25 m           1 min
          Turn left onto                               Turn right onto
          Rue de l'Échiquier                           Goldsmith's Row
```

Three lines and a right-hand column. **Line 1 is WHERE, and it leads with the
preposition.** Line 2 is the verb alone. Line 3 is the **named thing**, bold.
The right column is the leg's own size, in minutes. w7 also shows the spoken
form of the same row — *"In 25m, turn right onto Goldsmith's Row"* — which
confirms the ordering is the product's, not the layout's.

w3 is the route summary above that list: `Walk for 2.7 mi` with `42 min` and a
`185 cal` chip, then `Leave now` / `Arrive 14:38`.

**The step-free side, read off sf2 and sf3.** sf2 is the results list with the
mode on: a header row reading `Step-free` over `Avoiding steps and stairs`, and
a mode bar along the bottom — `Classic`, `Step-free`, `Bus+`, `Train+`,
`Walk Less`, `Mix`. sf3 is one of those routes opened up, and it is the frame
that mattered most: inside the leg list, under a leg reading `Go to`
*Raffles Place* with `4 min` on the right, sits an inset row labelled
**`Best Step-Free Entrance`** and, beneath it, the entrance's own name —
`D - Republic Plaza`. The map behind it labels the same door `Entrance D`.

**So Citymapper names the door.** That is the single biggest thing round 2's
card was missing, and it was invisible from the marketing copy §R10 was written
against.

## R14. What changed because of the frames

All of it is in `js/wayfind.js`, in this lane's own §3b/§5b blocks. Numbers are
from a 300-pair census; how to re-run it is §R16.

### 1. The row is Citymapper's shape, in two lines instead of three

`Up the steps` · `620 m in · near WEL`  becomes

```
 ↑   in 630 m                                     5.8 m
     Steps at Robert A. Welch Hall
```

Position leads and carries the preposition (`SAY_S.at`); the verb is the small
dim one; the **named building is the anchor and is bold**. Citymapper's three
lines are merged into two because it owns the whole screen and this card owns
233 px of text over a 3D city — the hierarchy is kept, the line count is not.

The right-hand column is **the flight's own plan length, not minutes, and that
is deliberate**: at `stairSpeed` 0.5 m/s every flight on this campus rounds to
"1 min", and §3 of the honesty audit forbids collapsing a range to a single
number. The metre is measured off the graph; the minute would be theatre.

### 2. It says the building's name, not its register code

`near WEL` → `at Robert A. Welch Hall`, via `buildIndex()`'s own display name —
the same string the search list shows. **210 of 210 rows in the census got a
name**, 41 of them the code because the register has nothing better or the name
is too long for a row (`STAIRS.placeNameMaxCh` 26; measured on the shipped
graph, that keeps the name on 111 of 158 buildings and falls back for exactly
the ones people abbreviate out loud anyway — POB, GDC, ATT).

The cap is on the ROW only. The entrance sentence in §3 gets the full name,
because the card was printing "Jackson Geological Sciences Building" in the
headline and "Ends at the north side of JGB" three lines below it — one
building under two names, in one frame.

### 3. The step-free entrance is named — sf3's `Best Step-Free Entrance`

`It uses a different entrance.` → `Ends at the north side of Jackson
Geological Sciences Building.`

`doorWhere()` takes the bearing from the centroid of **that building's own
doors** to the door the alternative arrives at, and rounds to eight points. It
is withheld when the building has one door (nothing to be a side of) or when
the door sits within `STAIRS.doorSideMinM` of the centroid (the bearing is
noise). **50 of 50 changed arrival doors in the census got a named building AND
a side; 0 named a building other than the one you asked for** — which is the
assertion, not the anecdote.

**We deliberately do not copy the words "Best Step-Free Entrance."** What the
route verified is that nothing between the two doors crosses a mapped
staircase, including the two straight lines we drew ourselves. It did not
verify the door. `doorForced` is the same distinction and it is the one this
feature must not blur.

### 4. One approach is one row

This came out of the frame, not the census — every number was green while it
was on screen. ART → MAI printed:

```
 •   at the start        Steps at Art Building and Museum
 •   at the start        Steps at Art Building and Museum
 •   in 20 m             Steps at Art Building and Museum
```

Three rows that read as a rendering bug, spending the whole phone list on one
thing. They are three genuine `highway=steps` ways and OSM is right — the
approach to the Art Building really is three mapped flights. But **a leg list
states manoeuvres, not ways**: Citymapper's rows are one thing you do. So
consecutive flights at the same building within `STAIRS.mergeGapM` (40 m) are
one row that says how many:

```
 •   at the start                                  11 m
     3 sets of steps at Art Building and Museum
```

`shots/walk/stairs/r3-legs-desk-ungrouped.png` is the same route with
`mergeGapM = 0` — the A/B on one constant.

**The staircase count is untouched by this.** `sets`, `ways` and the headline
still come off the way ids; only the row count changes. The census asserts it —
*grouping rows loses no staircase and invents none, 0 bad* — and every row
carries the way ids it swallowed, so a row joins back to the ground.

Across 300 pairs, **210 flights draw as 164 rows; 37 rows carry more than one
flight.**

### 5. A leg position no longer collapses to a kilometre

`SAY_S.at` used `fmtDist`, which is the ROUTE's formatter and rounds anything
over 950 m to one decimal of a kilometre. On ADH → COM that printed two
different flights 20 m apart as `in 1.1 km` and `in 1.1 km` — the same row
twice, in the frame. Leg positions are metres all the way out now, with a
thousands separator, at the resolution `atRoundM` already promises.

### The frames

| file | what it shows |
|---|---|
| `r3-legs-desk.png` | ART → MAI. Five rows, five different buildings, the merged Art Building approach at the top. |
| `r3-legs-desk-ungrouped.png` | The same route, `mergeGapM = 0`. Three identical-looking Art Building rows. |
| `r3-entrance-desk.png` | ADH → COM. `Ends at the south-west side of Computation Center.` |
| `r3-down-desk.png` | HRH → JGB. A mapped `↓` — `Down the steps at Waggener Hall`, 51 m. |
| `r3-legs-phone.png` | 393×852. **The card is 926 px tall on an 852 px screen.** See §R15. |
| `r3-legs-phone-pillpatch.png` | The same frame with §R15's two lines injected: 634 px, and it fits. |
| `r3-entrance-phone-pillpatch.png` | ADH → COM, same patch. |

## R15. A PATCH FOR `style.css` — NOT THIS LANE'S FILE

**The walk card has been running off the bottom of the phone, and the leg list
is not why.** Measured on a 393×852 viewport, `#wf-pill` is **197 px wide** —
half the screen — and the leg list is only 185 px of the 926 px total. Capping
the list would lose information and would not fix it.

The mechanism, confirmed in the page rather than reasoned about:

```
#wf-pill{position:absolute;left:50%;transform:translateX(-50%);
         max-width:min(560px,calc(100vw - 120px))}
```

`left:50%` puts the box's containing-block edge at 196.5 px, so the space
available to a shrink-to-fit element is `100vw - 196.5px` = **196.5 px**. The
`max-width` of 273 px never binds. `translateX(-50%)` re-centres it visually
*after* layout and cannot give the width back.

Measured, in the page, on ART → MAI at 393×852:

```
                                             width     card height
as shipped                                   197 px      926 px
left:0;right:0;transform:none;margin:0 auto  273 px      694 px
   ...+ a phone-sized gutter                 369 px      634 px    (viewport 852)
```

Two lines, and the card stops being clipped:

```css
/* Shrink-to-fit against `left:50%` can only ever be 50vw wide; the transform
   re-centres it after layout and cannot give the width back. Lay it out
   across the viewport and centre it with auto margins instead. */
#wf-pill{left:0;right:0;transform:none;margin:0 auto;width:fit-content}
/* 120px of gutter is a desktop number. On a phone it is a third of the screen. */
@media (max-width:520px){#wf-pill{max-width:calc(100vw - 24px)}}
```

`body.wf-routed.flying #wf-pill{opacity:1}` and the `.hidden` rule are
unaffected; nothing else in `style.css` targets `#wf-pill`'s box.

This lane did not make the change — `style.css` belongs to another lane, and a
rule that lands in the wrong file is worse than a rule that says where it
should have gone. `r3-legs-phone.png` and `r3-legs-phone-pillpatch.png` are the
before and the after.

## R16. The gate, and BOTH halves of the watched failure

Round 2's watched failure was half a watched failure, and it took running it to
see that. `WAYFIND.stairs.breakStepFree = true` makes the step-free edge filter
leaky on purpose — and the verification inside `stepFreeRoute()` then catches
every leak and **withholds the offer**, so the census comes back *green*:
offers collapse from 91 to 6 over 120 pairs and 0 of them are dirty. That
proves the gate works. It never proved the census's own "verified clean"
assertion could go red, and an assertion nobody has watched fail is an
assertion nobody has tested.

So there is a second switch, `STAIRS.breakStepFreeGate`, which removes the
verification itself. Both on:

```
 PASS  WATCHED FAILURE: with the gate removed the leak reaches the answer
       — 49 dirty of 55 offered
```

**49 of 55.** That is the number of bad "step-free" promises the gate stands
between this feature and the one person it exists for. Both switch names live
in `STAIRS` and both ship `false`.

### The census, ready to lift into `scripts/verify/stairs.mjs`

It still lives in a session scratchpad because `scripts/verify/` is not this
lane's directory (round 2's §R12 said the same and it is still true). It needs
no page API beyond `window.wayfindStairs(from, to)`, which is public and
read-only, and it reads its building pool straight out of
`data/walk_graph.json` rather than out of the page.

```
node census.mjs 300 out.json               # eleven assertions, exit 1 on any failure
node census.mjs 120 --break                # the gate WITHHOLDS: offers collapse, 0 dirty
node census.mjs 120 --break --breakgate    # the gate is gone: 49 of 55 dirty, RED
node smoke.mjs                             # the same, by CLICK
```

The eleven, all green at 300 pairs on `?walk=1&intro=0&drift=0`, port 8713:

```
 PASS  routes completed — 300 of 300 pairs
 PASS  every named staircase is a real way id — 0 bad
 PASS  leg list in walk order and inside the route — 0 bad
 PASS  every step-free offer verified clean — 0 dirty of 115 offered
 PASS  offer distance == what the button produces — 0 mismatched
 PASS  routable count is below the file count — 168 routable of 189 in the file
 PASS  every row with a code prints a place — 0 bad of 210 rows
 PASS  every named step-free entrance is on the target building — 0 bad of 50 named
 PASS  grouping rows loses no staircase and invents none — 0 bad
 PASS  grouped rows in walk order — 0 bad
 PASS  every row's flight count equals its way ids — 0 bad

  with stairs 125   offered 115   no way round 10
  drawn rows 164 for those 210 flights — 37 rows carry more than one flight
  arrival door moved and named 50 (with a side: 50), moved and unnameable 0
```

`smoke.mjs` clicks rather than calls, because §R2's bug — the offer and the
button being different routes — was green in every census and visible in a
screenshot. Fourteen assertions, all green, including that `WAYFIND.on` is
**still `false`**: nothing this round ships anything.

## R17. Against Citymapper — the table §R10 could not write

§R10's left column was Citymapper's marketing copy. This one is the frames.

| Citymapper, from the frame | us, now |
|---|---|
| w4/w7 — a row is `in 25 m` / `Turn right onto` / **`Goldsmith's Row`**: position first, named thing bold | `in 630 m` / `Steps at` **`Robert A. Welch Hall`** — same order, two lines instead of three |
| w4/w7 — a per-leg quantity, right-aligned: `1 min` | the flight's plan length, `5.8 m`. **Deliberately not minutes** — every flight here rounds to "1 min", and a one-number time is what §3 of the audit forbids |
| w4/w7 — one row is one manoeuvre | one row is one manoeuvre. The three mapped flights at the Art Building are one row saying `3 sets of steps` |
| sf3 — names the door: `Best Step-Free Entrance` / `D - Republic Plaza` | names the door: `Ends at the north side of Jackson Geological Sciences Building.` We have no entrance letters; we have the building and the side, checked against the target building 50 of 50 |
| sf3 — the label asserts the entrance itself is step-free | **we do not.** We verified the walk, not the door. Saying otherwise is the one promise this feature must not make |
| sf2 — `Step-free` / `Avoiding steps and stairs`, an unpriced mode | `Step-free: 14–19 min · 1.2 km` with `Avoids all 7 sets · 250 m further`. **Ours is better here**: it prices the alternative before you pick it |
| sf2 — a mode among six in a bottom bar | a button in the answer plus a sticky checkbox — same route, one implementation, asserted (§R2) |
| never prints a number of individual steps | never. `step_count` is on 9 of 189 ways and stays behind the same bar |
| *(marketing, still unverifiable from any frame)* walking times adjusted for reduced mobility | still deliberately not done. There is no honest reduced-mobility number in this repo |

Two places we say more than Citymapper does, both because the data is thin
enough that saying less would be dishonest: *"Up or down is only mapped on some
of them"*, and *"We can't tell whether the last few metres into the door
involve steps."*

## R18. What round 3 did NOT do

* **`scripts/bake_ground.py` is unchanged**, as in round 2. Round 1's fix — the
  missing `area=yes` staircase and `wid` on every slab — is what mattered, and
  nothing this round needed the ground re-baked.
* **`scripts/bake_walk.py` is still untouched**, so §5a (`incline=down` thrown
  away) and §5b (`step_count`) stand exactly as written. §5a is worth more
  again now: direction is the arrow at the left of every row, and it is known
  on 26 of 216 flights.
* **A flight is named after the nearest door within 70 m, and sometimes that
  door is on a service building.** HRH → JGB reads `Steps at Chilling Station
  No. 6` — a real building with real doors, and not what a person would call
  that place. The honest fix is a filter on building class in the bake rather
  than a hand-written exclusion list here, and that is another lane's file.
  Left visible rather than papered over.
* **The sub-metre "staircases" are still reported.** Several mapped
  `highway=steps` ways on campus are under a metre long — kerb steps, not
  flights. They are in the data and the router charges for them, so the card
  names them. Suppressing them would make the reported count stop matching the
  ground, which is the first thing this round is judged on.

---
---

# ROUND 4 — checked against files the router never reads, and it was wrong

Round 3's critic returned nothing at all — no verdict, no gap named. So this
round did the critic's job on this lane's own work first, and the harshest
question available was the one nobody had asked in three rounds:

> Every "this route is step-free" claim so far has been verified against
> `walk_graph.json` — the same object that built the route. That is asking
> the witness to confirm his own alibi.

It does not survive. **Nine of 122 offered step-free walks (7.4 %) had their
last stretch lying on a mapped staircase**, and five routes of 300 said *"No
stairs on this route"* while walking over one. Every one of them was green in
round 3's eleven-assertion census, because the census and the defect shared a
blind spot.

## R19. The blind spot, and it is a one-line piece of geometry

`legCrossesStairs()` is the test the whole step-free promise rests on: does
the straight line from the walk network to a door cross a staircase? Rounds
1-3 answered it with `segmentsCross()`, a proper segment-segment intersection
in local metres — correct code, and:

```js
    const den = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(den) < 1e-12) return false;          // parallel or degenerate
```

**Two parallel segments never intersect.** A door leg drawn straight *up a
flight of steps* — the single worst thing this feature can do to somebody who
cannot climb — is parallel to it, so `den` is zero and the answer is "no
crossing". The one case that matters most is the one case the test is
mathematically incapable of seeing. A staircase was also being treated as a
line with no width, while `bake_ground.py` draws it 3.0 m wide.

WAG → KIN, with **Avoid stairs already ticked**, is the picture:

| file | what it shows |
|---|---|
| `r4-legonstairs-before.png` | the dashed last stretch coming straight out of the middle of a lit staircase (OSM way `1429644810`, `incline=down`), card reading **"9-13 min walk · 760 m · No stairs on this route"** |
| `r4-legonstairs-after.png` | identical camera, identical zoom, one constant flipped: the walk is not there any more |
| `r4-legonstairs-before-card.png` | the offer that produced it — **"✓ Step-free · no further to walk than the route with stairs"**. A free lunch, and it went down a flight of steps |
| `r4-legonstairs-after-card.png` | the honest answer: 1.1 km, 160 m further |

The cyan slab is a test-only `fill-extrusion` filtered on `wid`; nothing in
the app draws it. The tree canopy is hidden in both frames — it sits directly
over the subject — and both frames are checked with `queryRenderedFeatures`
for the ribbon *and* the lit slab before either is kept.

## R20. The fix: give the staircase the width the map already draws it with

`legCrossesStairs()` now convicts on **either** test:

1. the centreline is genuinely crossed — rounds 1-3's test, unchanged;
2. **or** the leg runs *along* the flight: at least `stairLegOverlapMinM` of
   it inside `stairLegHalfWidthM` of the centreline, pointing within
   `stairLegParallelDeg` of the flight's own direction.

The angle is not decoration and the frame is what proved it. Without it the
test convicts every door leg that merely **leaves** the top of a flight —
such a leg starts *on* the staircase and diverges, so it overlaps for a metre
or two while the walker takes no step at all. Measured on the eight legs the
width test catches, the angle is completely bimodal:

```
  1  1  1  1 deg    the leg IS the flight            4.0-4.2 m of overlap
 32 61 61 61 deg    it leaves an end and walks away  1.7-2.9 m of overlap
```

Both groups share an endpoint with the staircase to within 6 cm, so *"does it
touch"* cannot separate them and *"which way does it point"* separates them
completely. `20` sits in a twelve-degree empty gap. The first cut of this
round shipped the width test **without** the angle, refused five good offers,
and only the picture showed why.

All three numbers are `WAYFIND` constants (CLAUDE.md rule 11), and
`stairLegOverlapMinM = Infinity` restores rounds 1-3 exactly — which is the
A/B below.

## R21. The instrument: two files, and neither is the walk graph

`scripts/serve.py 8713`, 300 pseudo-random routable pairs, `?walk=1&intro=0
&drift=0`, `cancelGraphicsAutoDetect()`, waited on `!veil`, one browser.

* **TRAVERSAL** — `data/osm_cache/footways.json`, the raw Overpass survey with
  no bake between it and the assertion. A staircase counts as walked when half
  its own centreline lies within 0.3 m of the **surveyed** part of the walk.
* **CROSSING** — `data/ground.geojson`, the drawn slabs from `bake_ground.py`.
  Only the two straight door legs are tested against these, in metres of leg
  inside the polygon.

Round 4 adds `wayfindStairs(from, to, { geom: true })`, which hands back the
walked polyline — the surveyed part and the two door legs as separate objects.
Opt-in and verification-only; the shipped answer object is unchanged.

**THE A/B, one constant, same 300 pairs, same browser:**

```
                                              rounds 1-3      round 4
routes completed                                 300            300
routes with a staircase on them                  129            134
step-free offered                                122            120
   ...whose door leg lies on a drawn staircase     9              0
   ...that traverse an OSM staircase                0              0
routes with a staircase the card never states      5              0
door legs inside a slab the app calls clean        8              0
no way round                                       7             14
```

**Nine false step-free promises and five undisclosed staircases, for the
price of two offers of 122.** The five routes that gained a staircase did not
get worse; they stopped lying about one they already had.

The door-leg histogram is the same measurement seen the other way round — the
metres each door leg spends inside a drawn staircase, split by whether the app
calls it a crossing:

```
rounds 1-3   app calls it a crossing   1.49 1.49
             app says clean            0.25 0.25 0.25 1.98 1.98 2.74 2.74 5.50
round 4      app calls it a crossing   0.25 0.25 0.25 1.49 1.49 1.98 1.98 2.74 2.74 5.50
             app says clean            (none)
```

**Nothing is left in the second row.** There is no longer a single door leg on
this campus lying inside a drawn staircase that the router calls clean.

### The seven assertions, all green at 300 pairs

```
 PASS  routes completed — 300 of 300
 PASS  no offered step-free walk TRAVERSES an OSM staircase — 0 dirty of 120 offered
 PASS  no offered step-free walk lays a DOOR LEG over a drawn staircase — 0 dirty of 120
 PASS  every staircase the card states is one the walk comes within 1.5 m of — 0 routes
 PASS  every staircase the walk touches is stated by the card — 0 routes
 PASS  a staircase the router walks along is filed as climbed, not as a door leg — 0
 PASS  the leg list carries every staircase the router climbs — 0 bad of 300
```

### And watched failing, both switches, on the outside instrument

```
node gate.mjs 300 --break --breakgate
  step-free offered 134 (nothing withheld)
  FAIL  no offered step-free walk TRAVERSES an OSM staircase — 117 dirty of 134
```

117 of 134. Rounds 2 and 3 watched their guard fail against the graph; this
watches it fail against the OSM survey, which is the version that could not
have been rigged by the thing being tested.

## R22. Four times this round the number was green and the picture was not

Kept as a list because it is the argument for the house rule, not decoration.

1. **The parallel door leg** (§R19) — eleven green assertions over 300 pairs
   while a step-free walk went down a flight of steps.
2. **The angle** (§R20) — the width test alone refused five good offers.
   Frames of the acquitted cases showed door legs *leaving* staircases at
   32° and 61°, which is not walking on them.
3. **`Avoids all 0 sets`** — the offer's price line counted only the
   staircases the router *climbs*, so on WEL → AND, where the only staircase
   is under the last stretch, it printed that. Fixed here: it counts
   `sets + legWayCount`, and the unreachable `n <= 0` arm now says "the
   stairs" rather than arithmetic. `r4-disclose-WELAND-after.png`.
4. **The A/B that was not one** — the first cut of the frames came back at
   zoom 20.41 and 19.24 with the card open in one and shut in the other,
   because `state.expanded` survives a re-route. Both passes are separated
   and the camera is pinned now.

And one trap avoided rather than fallen into: the first pose put the camera
under a building roof with the subject invisible, exactly as the brief warns.
Every frame this round is confirmed with `queryRenderedFeatures` before it is
kept.

## R23. A PATCH FOR `renderPill()`'s HEADLINE — NOT THIS LANE'S FUNCTION

**The headline still says "No stairs on this route" while the body of the same
card says the last stretch crosses one.** Visible in
`r4-disclose-WELAND-after.png`: WEL → AND, 400 m, headline *"No stairs on this
route"*, three lines below it *"The unmapped stretch to the door crosses a
staircase."* Round 4 made this visible by detecting the crossing; the
contradiction is older than round 4 and belongs to whoever owns the headline.

`js/wayfind.js` line ~2661 reads `r.m.stairSets`, which counts only the
staircases the **router climbs**. `r.stair.clean` is already the AND of both
kinds. Replace:

```js
      r.m.stairSets ? SAY.stairsSets(r.m.stairSets) : SAY.stairsNone,
```

with:

```js
      // A staircase under our own straight door leg is still a staircase you
      // walk over, and `r.stair.clean` is already the AND of both kinds. The
      // headline read only the climbed half and printed "No stairs on this
      // route" three lines above "The unmapped stretch to the door crosses a
      // staircase" (docs/walk-stairs.md §R23; 5 routes of 300).
      r.m.stairSets ? SAY.stairsSets(r.m.stairSets)
        : (r.stair && !r.stair.clean) ? SAY.stairsLegOnly : SAY.stairsNone,
```

and add one line to `SAY`, wording subject to
`docs/walk/what-we-can-honestly-say.md` as always:

```js
    stairsLegOnly: 'Steps on the last stretch',
```

Round 1 §5a (`incline=down` thrown away) and §5b (`step_count`) still stand
unmade, and so does round 3 §R15 (`#wf-pill` is 197 px wide on a phone because
shrink-to-fit against `left:50%` can only ever be half the viewport). The
phone card measured **869 px of an 852 px screen** on WEL → AND this round,
which is that same rule and not the leg list.

## R24. What it costs: nothing measurable

`legCrossesStairs()` now samples a capsule as well as solving an intersection,
and `cleanAnchors()` calls it once per door anchor, so this is where a stairs
change gets expensive. It does not, because the angle test rejects almost
every candidate before any sampling happens.

**Interleaved A/B, three reps of 120 routes, MINIMUM of each per
`scripts/verify/README.md`. Hardware GL, no CPU throttle. The machine was NOT
quiet — sibling lanes were driving browsers — which is why the minimum is the
only number quoted:**

```
                         rounds 1-3   round 4
a route WITH stairs        5.2 ms      5.1 ms    (median)
   ...p90                  8.7 ms      8.1 ms
a route with no stairs     1.1 ms      1.1 ms    (median)
```

The two are the same to within the run-to-run spread; the new one reading
nominally faster is noise, not a win.

`WAYFIND.on` is **still `false`** — a plain `index.html` makes **zero**
requests for `walk_graph.json` and exposes no `window.wayfindStairs`. Nothing
this round ships anything. `harness-drift.mjs`: **PASS, 31 scripts in
`index.html`, 31 in `_harness.html`** (no new `<script>` this round).

And it still works by **click**, not only by census — round 2's worst bug was
green in every census and visible only in a screenshot:

```
 PASS  a route renders — 11-17 min walk · 950 m · Stairs: 1 set
 PASS  the card offers a priced step-free button — Step-free: 13–19 min · 1.1 km
 PASS  clicking the offer does not fold the card shut
 PASS  the offer lands on a step-free answer — ... No stairs on this route
 PASS  and a way back, priced — With stairs: 11–17 min · 950 m
 PASS  no "Avoids all 0 sets" anywhere on the card
```

## R25. Against Citymapper, one line added

§R17's table stands. One row changes, and it is the row this round is about:

| Citymapper, from the frame | us, now |
|---|---|
| sf2 — `Step-free` / `Avoiding steps and stairs` | the claim is now verified against two files the router never reads, including the last few metres to the door. Citymapper publishes no equivalent check, so this is not a comparison — it is the standard we hold ourselves to for the one person the feature exists for |

## R26. Where the remaining doubt is, stated rather than buried

* **14 routes of 300 have no step-free answer**, up from 7. Seven of those are
  new and every one is a building whose every door anchor is reachable only by
  a straight line over a staircase. "We cannot get you there without steps" is
  the truthful answer to that and the card says it in full colour, not as a
  footnote — but it is a worse *product* answer than the lie it replaces, and
  somebody should look at whether those doors have another anchor. That is
  `bake_walk.py`, not this lane.
* **The corridor and the angle are thresholds, and thresholds can be wrong.**
  Both were read off histograms with a visible empty gap (0.3–0.5 of a
  flight's length; 1–32 degrees), and both are `WAYFIND` constants, so
  disagreeing with either is a one-line edit. The fraction histogram has ten
  samples in the 0.5–0.6 bucket sitting just above the bar; nothing at all
  between 0.3 and 0.5.
* **Everything here is still a claim about `highway=steps` in OSM.** A
  staircase nobody mapped is still invisible and the card still says so.
* **Two of the 189 carry `lit`, and lighting is still not wired to anything.**
  Unchanged from round 1 §7.
* **`scripts/bake_ground.py` is unchanged this round**, as in rounds 2 and 3.
  Round 1's fix — the missing `area=yes` staircase and `wid` on every slab —
  is what made this round's ground-truth join possible at all, and nothing
  further needed re-baking a 5 MB file.

## R27. The gate, committed, so the next critic can run it

Rounds 2 and 3 both ended with the census "in a session scratchpad" because
`scripts/verify/` is not this lane's directory. That is three rounds of
numbers nobody else could reproduce, and it is the fairest criticism available
of this lane. The whole instrument is therefore written out below. It needs
only `window.wayfindStairs(from, to, {geom:true})`, which is public and
read-only, and two data files. Save the two blocks beside each other, run
`npm install playwright-core`, start `python scripts/serve.py 8713`, then:

```
REPO_ROOT=/path/to/repo node gate.mjs 300              # the seven assertions
REPO_ROOT=/path/to/repo node gate.mjs 300 --oldleg     # §R21's A/B: goes RED
REPO_ROOT=/path/to/repo node gate.mjs 300 --break --breakgate   # watched failure
REPO_ROOT=/path/to/repo node gate.mjs 300 --hist       # the histograms above
```

It should still be lifted into `scripts/verify/stairs.mjs` by whoever owns
that directory. Until then it is at least *in the repository* rather than in a
directory that gets deleted.

### `lib.mjs`

```js
// Round-4 stairs harness. ONE browser, per the lane brief.
import { chromium } from 'playwright-core';

export const PORT = process.env.PORT || 8713;
export const BASE = `http://127.0.0.1:${PORT}`;
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function open({ w = 1440, h = 900, q = '' } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-gl=angle', '--no-sandbox', '--disable-dev-shm-usage',
      '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h },
    deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)));
  const url = `${BASE}/index.html?walk=1&intro=0&drift=0${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Correctness measure, not a speed one (CLAUDE.md rule 10).
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForFunction(() => !document.getElementById('veil'), null,
    { timeout: 180000 });
  await page.waitForFunction(() => !!window.__map && !!window.wayfindStairs, null,
    { timeout: 120000 });
  await page.waitForTimeout(600);
  return { browser, page };
}

/** Screenshot twice, keep the second (CLAUDE.md rule 10). */
export async function shot(page, path, clip) {
  const o = clip ? { path, clip } : { path };
  await page.screenshot(o);
  await page.waitForTimeout(180);
  await page.screenshot(o);
  return path;
}

export function ok(cond, label, detail = '') {
  console.log(`${cond ? ' PASS ' : ' FAIL '} ${label}${detail ? ' — ' + detail : ''}`);
  return !!cond;
}
```

### `gate.mjs`

```js
/**
 * gate.mjs — ROUND 4. The stair claims, checked against files the router
 * never reads.
 *
 * Rounds 1-3 asked `walk_graph.json` whether a route built out of
 * `walk_graph.json` touched a staircase. Two outside instruments here:
 *
 *   TRAVERSAL, from `data/osm_cache/footways.json` — the raw OSM survey, no
 *   bake in between. A staircase counts as walked when TRAVERSE_MIN_FRAC of
 *   its own centreline lies within CORRIDOR_M of the SURVEYED part of the
 *   walk. Measured off the way's geometry rather than by node identity, so
 *   the bake's 578 anchor splits (which insert vertices between OSM nodes)
 *   cannot fool it. `area=yes` staircases are rings and are tested as
 *   polygons instead.
 *
 *   CROSSING, from `data/ground.geojson` — the drawn slabs, written by
 *   `bake_ground.py`, 3.0 m wide. Only the two straight DOOR LEGS are tested
 *   against these: a door leg is the one part of the walk not made of graph
 *   edges, and it can lie flat on top of a staircase without ever crossing
 *   its centreline. Counted in METRES OF LEG INSIDE THE SLAB and only where
 *   the leg runs ALONG the flight, both thresholds read off `--hist`.
 *
 * Nothing in this file imports a flag, an edge or a cost from the router.
 *
 *   node gate.mjs [pairs] [--break] [--breakgate] [--oldleg] [--hist]
 *                 [--json out.json]
 *
 * --break/--breakgate are the watched failure (leaky filter / no guard).
 * --oldleg restores rounds 1-3's door-leg test, which is the A/B this round
 * turns on. Run from a directory where `playwright-core` resolves, with
 * `python scripts/serve.py 8713` up.
 */
import fs from 'node:fs';
import { open, ok } from './lib.mjs';

// Repo root. Override with REPO_ROOT when running from elsewhere.
const ROOT = process.env.REPO_ROOT || process.cwd();

// ── every threshold a named constant (CLAUDE.md rule 11) ──────────────────
// How close the walk must run to a centreline to count as ON it. The graph
// quantises node positions to q=1e-6 deg = 0.11 m, so a way the router really
// traverses lies within about 0.15 m of the walked line — measured at
// 0.02-0.07 m on every traversal checked by hand. At 1.0 m this test also
// convicted a footway running PARALLEL 0.9 m from a 2.1 m flight (CS3>RSC,
// way 1429644803), which is a path beside a staircase and not a staircase.
// 0.3 m is double the quantisation and a third of that parallel path.
const CORRIDOR_M = Number(process.env.CORRIDOR_M || 0.3);
// ...and for what FRACTION of the staircase's own length, before it counts as
// walked. An absolute metre bar cannot work: campus staircases run 0.7 m to
// 64 m, so 1 m is 100 % of one flight and 2 % of another. Read off --hist.
const TRAVERSE_MIN_FRAC = Number(process.env.TRAVERSE_MIN_FRAC || 0.5);
const SAMPLE_M = 0.25;
const CELL_M = 25;
// Metres of a straight door leg lying inside a drawn staircase before it
// counts as walking over it. A leg that merely TOUCHES an endpoint and leaves
// at an angle clips at most half the 3.0 m slab width. Chosen off the
// histogram in --hist, not assumed.
// Same 1.5 m the app uses, and for the same reason: half the drawn slab's
// own width. The two measurements are still independent — the app measures a
// capsule round the GRAPH's centreline, this measures the inside of the
// polygon `bake_ground.py` drew.
const LEG_OVERLAP_MIN_M = Number(process.env.LEG_OVERLAP_MIN_M || 1.5);
// Metres of walk inside a stepped AREA before it counts as crossing it.
const AREA_MIN_M = Number(process.env.AREA_MIN_M || 1.0);
// How close the walk must come to a staircase before the card is ALLOWED to
// state it. Over-disclosure is not a defect — a door leg that passes 6 cm
// from a 4.6 m flight (MFH>GRE, way 1212689302) is a staircase the walker is
// on, and saying so is the conservative call. The bar is only there to catch
// the card naming a staircase the walk goes nowhere near. Same 1.5 m as the
// drawn slab's half-width.
const NEAR_M = Number(process.env.NEAR_M || 1.5);
// A door leg only walks a staircase when it runs ALONG it. Every leg that
// leaves the top of a flight starts on the flight and diverges, overlapping
// the slab for a metre or two without anyone taking a step. Measured on the
// eight legs the width test catches, the angle is bimodal 1/1/1/1 vs
// 32/61/61/61 degrees. Same 20 deg the app uses, arrived at from the same
// measurement — and the direction here comes from footways.json, not from the
// walk graph, so the two are still independent.
const PARALLEL_DEG = Number(process.env.PARALLEL_DEG || 20);

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 120);
const BREAK = process.argv.includes('--break');
const BREAKGATE = process.argv.includes('--breakgate');
const HIST = process.argv.includes('--hist');
// THE A/B ON ONE CONSTANT. Puts rounds 1-3's door-leg test back — centreline
// intersection only, no width — without touching a file on disk.
const OLDLEG = process.argv.includes('--oldleg');
const JSONOUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();

const MPD_LAT = 111320.0, MPD_LON = 111320.0 * Math.cos(30.2862 * Math.PI / 180);
const mBetween = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);
const key = (i, j) => i + ':' + j;
const CL = CELL_M / MPD_LON, CB = CELL_M / MPD_LAT;

// ── INSTRUMENT 1: the raw OSM staircases ──────────────────────────────────
const fw = JSON.parse(fs.readFileSync(`${ROOT}/data/osm_cache/footways.json`, 'utf8'));
const WAY_BY_ID = new Map();
const stepWays = [];
for (const e of fw.elements) {
  if (((e.tags || {}).highway) !== 'steps') continue;
  const pts = (e.geometry || []).map(p => [p.lon, p.lat]);
  if (pts.length < 2) continue;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, L = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i][0] < x0) x0 = pts[i][0]; if (pts[i][0] > x1) x1 = pts[i][0];
    if (pts[i][1] < y0) y0 = pts[i][1]; if (pts[i][1] > y1) y1 = pts[i][1];
    if (i) L += mBetween(pts[i - 1], pts[i]);
  }
  // `area=yes` staircases are a RING, not a centreline: way 147362093 at the
  // north-west corner of the PCL plaza is the one on this campus. A route
  // crossing it covers almost none of its perimeter, so the corridor test
  // below would call it untouched. Tested as a polygon instead.
  const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  stepWays.push({ id: e.id, pts, bbox: [x0, y0, x1, y1], len: L, closed });
}
for (const w of stepWays) WAY_BY_ID.set(w.id, w);
const wayGrid = new Map();
for (const w of stepWays) {
  const pad = 2 / MPD_LON, padY = 2 / MPD_LAT;
  for (let i = Math.floor((w.bbox[0] - pad) / CL); i <= Math.floor((w.bbox[2] + pad) / CL); i++)
    for (let j = Math.floor((w.bbox[1] - padY) / CB); j <= Math.floor((w.bbox[3] + padY) / CB); j++) {
      const k = key(i, j); if (!wayGrid.has(k)) wayGrid.set(k, new Set()); wayGrid.get(k).add(w);
    }
}
function inRing(ring, x, y) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const xa = ring[a][0], ya = ring[a][1], xb = ring[b][0], yb = ring[b][1];
    if (((ya > y) !== (yb > y)) && (x < (xb - xa) * (y - ya) / (yb - ya) + xa)) inside = !inside;
  }
  return inside;
}

/** perpendicular metres from point p to segment AB */
function distToSeg(p, A, B) {
  const ax = (p[0] - A[0]) * MPD_LON, ay = (p[1] - A[1]) * MPD_LAT;
  const bx = (B[0] - A[0]) * MPD_LON, by = (B[1] - A[1]) * MPD_LAT;
  const L2 = bx * bx + by * by;
  let t = L2 ? (ax * bx + ay * by) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax - bx * t, ay - by * t);
}
function distToLine(p, line) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const d = distToSeg(p, line[i], line[i + 1]);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}
/** closest approach in metres from a walked polyline to one steps way */
function lineNearWay(line, wayId) {
  const w = WAY_BY_ID.get(wayId);
  if (!w || line.length < 2) return Infinity;
  // Sample the WAY against the line's SEGMENTS, not the line's vertices
  // against the way. A door leg is one 23 m segment with two vertices, and a
  // 1.5 m flight sitting in the middle of it (MAG>CPE, 7.9-12.0 m along the
  // leg) is 9 m from the nearest vertex — the vertex form of this test called
  // that "nowhere near" while the walker was on the steps.
  let best = Infinity;
  for (let j = 0; j + 1 < w.pts.length; j++) {
    const seg = mBetween(w.pts[j], w.pts[j + 1]);
    const n = Math.max(1, Math.ceil(seg / SAMPLE_M));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = [w.pts[j][0] + (w.pts[j + 1][0] - w.pts[j][0]) * t,
        w.pts[j][1] + (w.pts[j + 1][1] - w.pts[j][1]) * t];
      const d = distToLine(p, line);
      if (d < best) best = d;
    }
  }
  return best;
}

/** ways whose centreline the walked polyline runs along -> metres walked of each */
const FRACS = [];
function traversed(line) {
  // candidate ways: any whose cell the polyline visits
  const cand = new Set();
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const n = Math.max(1, Math.ceil(mBetween(a, b) / CELL_M));
    for (let s = 0; s <= n; s++) {
      const t = s / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const c = wayGrid.get(key(Math.floor(x / CL), Math.floor(y / CB)));
      if (c) for (const w of c) cand.add(w);
    }
  }
  const out = new Map();
  for (const w of cand) {
    if (w.closed) {
      // does the walk enter the stepped AREA at all?
      let inM = 0;
      for (let i = 0; i + 1 < line.length; i++) {
        const seg = mBetween(line[i], line[i + 1]);
        const steps = Math.max(1, Math.ceil(seg / SAMPLE_M));
        for (let s2 = 0; s2 <= steps; s2++) {
          const t = s2 / steps;
          const x = line[i][0] + (line[i + 1][0] - line[i][0]) * t;
          const y = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
          if (inRing(w.pts, x, y)) inM += seg / (steps + 1);
        }
      }
      if (inM >= AREA_MIN_M) out.set(w.id, +inM.toFixed(1));
      continue;
    }
    let along = 0;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const seg = mBetween(w.pts[i], w.pts[i + 1]);
      const steps = Math.max(1, Math.ceil(seg / SAMPLE_M));
      let inside = 0;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = [w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * t,
          w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * t];
        if (distToLine(p, line) <= CORRIDOR_M) inside++;
      }
      along += seg * (inside / (steps + 1));
    }
    const frac = w.len > 0 ? along / w.len : 0;
    if (frac > 0) FRACS.push({ way: w.id, len: +w.len.toFixed(1), along: +along.toFixed(1), frac: +frac.toFixed(3) });
    if (frac >= TRAVERSE_MIN_FRAC) out.set(w.id, +along.toFixed(1));
  }
  return out;
}

// ── INSTRUMENT 2: the drawn slabs, for the two straight door legs ─────────
// (inRing is shared with the area-staircase test above.)
const gj = JSON.parse(fs.readFileSync(`${ROOT}/data/ground.geojson`, 'utf8'));
const slabs = [];
for (const f of gj.features) {
  const p = f.properties || {};
  if (p.u !== 'steps') continue;
  const ring = f.geometry.coordinates[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of ring) {
    if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
    if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
  }
  slabs.push({ ring, wid: Array.isArray(p.wid) ? p.wid : (p.wid != null ? [p.wid] : []), bbox: [x0, y0, x1, y1] });
}
const slabGrid = new Map();
for (const s of slabs) {
  for (let i = Math.floor(s.bbox[0] / CL); i <= Math.floor(s.bbox[2] / CL); i++)
    for (let j = Math.floor(s.bbox[1] / CB); j <= Math.floor(s.bbox[3] / CB); j++) {
      const k = key(i, j); if (!slabGrid.has(k)) slabGrid.set(k, []); slabGrid.get(k).push(s);
    }
}
/** is the leg pointing along this steps way (either direction)? */
function legAlong(leg, wayId) {
  const w = WAY_BY_ID.get(wayId);
  if (!w) return false;
  const ux = (leg[1][0] - leg[0][0]) * MPD_LON, uy = (leg[1][1] - leg[0][1]) * MPD_LAT;
  const lu = Math.hypot(ux, uy); if (!lu) return false;
  const cos = Math.cos(PARALLEL_DEG * Math.PI / 180);
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const vx = (w.pts[i + 1][0] - w.pts[i][0]) * MPD_LON, vy = (w.pts[i + 1][1] - w.pts[i][1]) * MPD_LAT;
    const lv = Math.hypot(vx, vy); if (!lv) continue;
    if (Math.abs((ux * vx + uy * vy) / (lu * lv)) >= cos) return true;
  }
  return false;
}
/** METRES of a straight door leg lying inside each drawn staircase, counted
 *  only where the leg runs ALONG that staircase. */
function legInside(leg) {
  const out = new Map();
  if (!leg || leg.length < 2) return out;
  const len = mBetween(leg[0], leg[1]);
  const n = Math.max(1, Math.ceil(len / SAMPLE_M));
  const step = len / n;
  for (let s = 0; s <= n; s++) {
    const t = s / n, x = leg[0][0] + (leg[1][0] - leg[0][0]) * t, y = leg[0][1] + (leg[1][1] - leg[0][1]) * t;
    const cand = slabGrid.get(key(Math.floor(x / CL), Math.floor(y / CB)));
    if (!cand) continue;
    for (const sl of cand) {
      if (x < sl.bbox[0] || x > sl.bbox[2] || y < sl.bbox[1] || y > sl.bbox[3]) continue;
      if (!inRing(sl.ring, x, y)) continue;
      for (const w of sl.wid) {
        if (!legAlong(leg, w)) continue;   // leaving an end is not walking it
        out.set(w, (out.get(w) || 0) + step);
      }
    }
  }
  return out;
}
function legsInside(geom) {
  const out = new Map();
  for (const leg of [geom.startLeg, geom.endLeg]) {
    for (const [w, m] of legInside(leg)) out.set(w, Math.max(out.get(w) || 0, m));
  }
  return out;
}

console.log(`OSM steps ways ${stepWays.length} | drawn stair polygons ${slabs.length}`);
console.log(`pairs ${N} | breakStepFree=${BREAK} breakStepFreeGate=${BREAKGATE}`);
console.log(`corridor ${CORRIDOR_M} m / traverse frac>=${TRAVERSE_MIN_FRAC} | door-leg overlap>=${LEG_OVERLAP_MIN_M} m`);

const { browser, page } = await open();
if (BREAK || BREAKGATE || OLDLEG) {
  await page.evaluate(([b, bg, ol]) => {
    if (b) window.WAYFIND.stairs.breakStepFree = true;
    if (bg) window.WAYFIND.stairs.breakStepFreeGate = true;
    if (ol) window.WAYFIND.stairLegOverlapMinM = Infinity;   // width test off
  }, [BREAK, BREAKGATE, OLDLEG]);
}
if (OLDLEG) console.log('*** --oldleg: door-leg width test DISABLED (rounds 1-3 behaviour) ***');

const res = await page.evaluate(async (n) => {
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = []; let tries = 0;
  while (out.length < n && tries < n * 6) {
    tries++;
    const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
    if (a === b) continue;
    const r = await window.wayfindStairs(a, b, { geom: true });
    if (!r || !r.ok || !r.geom) continue;
    out.push({
      from: a, to: b, clean: r.clean, sets: r.sets, ways: r.ways, legWays: r.legWays,
      distM: Math.round(r.distM), rowCount: r.rowCount,
      list: (r.list || []).map(x => ({ way: x.way, atM: Math.round(x.atM), m: +x.m.toFixed(1) })),
      rows: (r.rows || []).map(x => ({ ways: x.ways, atM: Math.round(x.atM), place: x.place, flights: x.flights })),
      geom: r.geom, stepFreeNone: r.stepFreeNone,
      sf: r.stepFree ? { distM: r.stepFree.distM, verifiedDistM: r.stepFree.verifiedDistM,
        verifiedStepEdges: r.stepFree.verifiedStepEdges, verifiedLegWays: r.stepFree.verifiedLegWays,
        clean: r.stepFree.clean, geom: r.stepFree.geom } : null,
    });
  }
  return out;
}, N);

// ── the assertions ────────────────────────────────────────────────────────
let stairy = 0, offered = 0, none = 0;
let dirtyTraverse = 0, dirtyLeg = 0, namedNotWalked = 0, walkedNotNamed = 0, listBad = 0, legNotNamed = 0;
const detail = { dirty: [], join: [] };
const histTouch = [], histCross = [];

for (const r of res) {
  if (!r.clean) stairy++;
  if (r.sf) offered++;
  if (r.stepFreeNone) none++;

  // THE CARD MAKES TWO DIFFERENT CLAIMS AND THEY GET TWO DIFFERENT
  // INSTRUMENTS. `ways` = staircases the ROUTER walks along, checked against
  // the OSM centrelines. `legWays` = staircases one of the two straight door
  // legs cuts across, checked against the drawn slabs.
  //
  // The two do NOT partition cleanly and pretending they do is wrong: on a
  // 1.4 m flight the door leg IS the traversal, so way 1512289474 on MAG>CPE
  // shows up in both instruments at once. So the gate asserts the claim that
  // actually matters — every staircase the walk touches is STATED, by one
  // route or the other — and only checks the classification where the two
  // instruments agree it is unambiguous.
  const li = legsInside(r.geom);                       // drawn-slab crossings
  const legCrossed = new Set([...li.entries()].filter(([, mm]) => mm >= LEG_OVERLAP_MIN_M).map(([w]) => w));
  const t = traversed(r.geom.net);   // centreline traversals, GRAPH EDGES ONLY
  const climbed = new Set(r.ways || []);
  const legNamed = new Set(r.legWays || []);
  const stated = new Set([...climbed, ...legNamed]);
  const touched = new Set([...t.keys(), ...legCrossed]);

  const a = [...stated].filter(w => !touched.has(w) && lineNearWay(r.geom.line, w) > NEAR_M);
  const b = [...touched].filter(w => !stated.has(w));
  if (a.length) { namedNotWalked++; detail.join.push({ p: `${r.from}>${r.to}`, stated_not_touched: a }); }
  if (b.length) { walkedNotNamed++; detail.join.push({ p: `${r.from}>${r.to}`, touched_not_stated: b }); }
  // classification: a way the router walks along and NO door leg goes near
  // must be in `ways`, not `legWays`.
  const c = [...t.keys()].filter(w => !legCrossed.has(w) && !li.has(w) && !climbed.has(w));
  if (c.length) { legNotNamed++; detail.join.push({ p: `${r.from}>${r.to}`, walked_but_filed_as_legcross: c }); }
  // the leg list must carry every staircase the ROUTER climbs
  const listWays = new Set(r.list.map(x => x.way));
  const d = [...climbed].filter(w => !listWays.has(w));
  if (d.length) { listBad++; detail.join.push({ p: `${r.from}>${r.to}`, missing_from_list: d }); }

  for (const [w, mm] of li) ((r.legWays || []).includes(w) ? histCross : histTouch).push(+mm.toFixed(2));

  if (r.sf) {
    const t2 = traversed(r.sf.geom.net);
    if (t2.size) { dirtyTraverse++; detail.dirty.push({ p: `${r.from}>${r.to}`, traversed: [...t2.entries()] }); }
    const l2 = [...legsInside(r.sf.geom).entries()].filter(([, mm]) => mm >= LEG_OVERLAP_MIN_M);
    if (l2.length) { dirtyLeg++; detail.dirty.push({ p: `${r.from}>${r.to}`, doorLegInside: l2.map(([w, mm]) => [w, +mm.toFixed(1)]) }); }
  }
}

console.log(`\nroutes ${res.length} | with stairs ${stairy} | step-free offered ${offered} | no way round ${none}`);
if (HIST) {
  const show = (name, arr) => {
    arr.sort((x, y) => x - y);
    console.log(`  ${name}: n=${arr.length} ` + (arr.length ? `min=${arr[0]} p50=${arr[Math.floor(arr.length / 2)]} max=${arr[arr.length - 1]}` : ''));
    console.log(`    ${JSON.stringify(arr)}`);
  };
  const f = FRACS.map(x => x.frac).sort((a, b) => a - b);
  console.log(`centreline fraction of a nearby staircase covered by the walk: n=${f.length}`);
  const buckets = {};
  for (const v of f) { const b = Math.min(9, Math.floor(v * 10)); buckets['0.' + b + '-0.' + (b + 1)] = (buckets['0.' + b + '-0.' + (b + 1)] || 0) + 1; }
  console.log('  ' + JSON.stringify(buckets));
  console.log('door-leg metres inside a drawn staircase, DIRECT routes:');
  show('app already calls it a crossing', histCross);
  show('app says clean', histTouch);
}

let pass = true;
pass &= ok(res.length === N, 'routes completed', `${res.length} of ${N}`);
pass &= ok(dirtyTraverse === 0,
  'no offered step-free walk TRAVERSES an OSM staircase',
  `${dirtyTraverse} dirty of ${offered} offered  [footways.json, no bake]`);
pass &= ok(dirtyLeg === 0,
  'no offered step-free walk lays a DOOR LEG over a drawn staircase',
  `${dirtyLeg} dirty of ${offered} offered  [ground.geojson slabs]`);
pass &= ok(namedNotWalked === 0, `every staircase the card states is one the walk comes within ${NEAR_M} m of`, `${namedNotWalked} routes`);
pass &= ok(walkedNotNamed === 0, 'every staircase the walk touches is stated by the card', `${walkedNotNamed} routes`);
pass &= ok(legNotNamed === 0, 'a staircase the router walks along is filed as climbed, not as a door leg', `${legNotNamed} routes`);
pass &= ok(listBad === 0, 'the leg list carries every staircase the router climbs', `${listBad} bad of ${res.length}`);

if (detail.dirty.length) console.log('\nDIRTY:\n' + JSON.stringify(detail.dirty.slice(0, 15)));
if (detail.join.length) console.log('\nJOIN:\n' + JSON.stringify(detail.join.slice(0, 15)));

if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify({
  res: res.map(r => ({ ...r, geom: undefined, sf: r.sf ? { ...r.sf, geom: undefined } : null })), detail }, null, 1));
await browser.close();
process.exit(pass ? 0 : 1);
```
