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

> **Where the lane is now.** Round 2 put the stairs on the card; round 3 gave
> the leg list Citymapper's shape; round 4 caught nine offers walking a door leg
> ALONG a flight; round 5 found the way round for five walks the feature had
> been refusing. **Round 6 (§R38-R40, 2026-08-24) asks the question all five
> stopped short of: is the DOOR at the end of a step-free walk step-free?** UT
> publishes the answer per entrance and the app had never read it — 20 of 38
> step-free endpoints were going to a door other than the one UT lists as
> barrier-free, up to 63 m away. Now 29 of 38, for 353 m of extra walking over
> 300 routes, with offers and refusals unmoved.

## 0. The headline

> **Rounds 2-8 are appended below in order and each one starts with its own
> headline.** Round 8 is the last: UT publishes a verdict on 24 of our doors
> and round 6 only ever spent the half that says YES — §R52 onwards. The
> shortest way in is §R54's table, which is the first time this app's own
> geometry and UT's survey have been asked the same question.

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

---
---

# ROUND 5 — the refusal was a claim too, and five of fourteen were false

Round 4 ended by admitting, in §R26, that its own fix had raised "no step-free
way round" from 7 routes of 300 to 14, and handed the problem to
`bake_walk.py`. That was the wrong instinct, and this round is about why.

> Every "this route is step-free" claim has now been checked against two files
> the router never reads. **"There is no step-free way to get you there" had
> never been checked against anything at all** — and it is a universal
> negative, said to the one person the feature exists for, who has no way to
> falsify it.

Checked at last: **all fourteen are false on raw OpenStreetMap, and five of
them are false on the app's own graph, using the app's own anchors.** The five
are fixed here. The nine that remain are a specific, named defect in
`bake_walk.py`, written out in §R32 with the way ids.

**FNT → GEA is the whole round in one card.** Before, the app told you there
was no step-free way from the Pharmacy Building to Gearing Hall. After, there
is one, and it is **eleven metres longer**.

| file | what it shows |
|---|---|
| `shots/walk/stairs/r5-FNTGEA-before-card.png` | `Stairs: 1 set` · **"No step-free route we can find between these two."** |
| `shots/walk/stairs/r5-FNTGEA-after-card.png` | `3-5 min walk · 270 m · No stairs on this route` · **"✓ Step-free · 11 m further than the route with stairs"** · `With stairs: 3–4 min · 250 m` |
| `shots/walk/stairs/r5-FNTGEA-before.jpg` | the same, in the city |
| `shots/walk/stairs/r5-FNTGEA-after.jpg` | identical camera, offer pressed, the walk redrawn round the flight |

## R28. First: the 189 still hold, and round 4 reproduces to the digit

Before touching anything. `data/osm_cache/footways.json` carries **189**
`highway=steps` ways; `data/ground.geojson` draws **180** polygons carrying
**189 distinct `wid`s**; the join is exact both ways — **0 OSM step ways not
drawn, 0 drawn ids that are not OSM step ways.** Round 1's fix stands, and the
180-versus-189 gap is still just touching flights merging into one shape.

Round 4's gate, re-run unmodified at 300 pairs on this branch merged with
`main`: **300 routes, 134 with a staircase, 120 step-free offered, 14 no way
round, all seven assertions green.** Identical to what §R21 published.

## R29. The instrument for a refusal, and it needed a positive control first

A refusal cannot be checked the way an offer is. There is no route to
inspect — the claim is that no route exists — so the only test is to go and
find one somewhere else.

`osmfree.mjs` (§R36) builds a step-free walking network from OSM node ids with
every `highway=steps` way **deleted outright**, snaps each door to it, and asks
whether the two buildings are connected. Door legs are held to the app's own
standard: at most 30 m (`bake_walk.py`'s own anchor cap, measured at 29.94 m
over 1,648 anchors) and not lying on a drawn staircase.

**The first version of it was wrong, and its own positive control caught it.**
An instrument that convicts the app of refusing a walk that exists must first
be shown to find the walks the app *did* find. It found only **111 of 120**:

```
  MISSED: PCL>SSB (unreachable), AHG>LLE (no clean attach), STD>SSB,
          MAI>LLE, LLF>TMM, TSG>WCH, GEB>BLD ...
  Instrument not trusted. Stopping before it accuses anything.
```

Two real bugs in the instrument, either of which would have produced a
spectacular and false accusation:

* **it snapped doors to OSM nodes only.** The bake splits ways at door
  anchors, so a door's nearest point on the network is routinely in the middle
  of an OSM edge. LLE and LLF had no node at all within 30 m. Fixed by snapping
  to the nearest point on a segment and seeding both its endpoints with the
  along-way metres added.
* **it read `footways.json` alone**, while `bake_walk.py` also adopts
  `service`, `residential`, `living_street` and `unclassified` from
  `roads.json` for stranded doors. SSB, BLD and WCH reach campus only along a
  service road.

With both fixed: **120 of 120, then 125 of 125.** Only then was it allowed to
say anything.

## R30. What it found, and then what the app's OWN graph said

```
all 14 refusals, on raw OSM with every staircase deleted:   14 of 14 FALSE
```

Raw OSM is not the last word, because it still contains the footways the bake
deletes for passing through a building — a fair objection to a distance and a
fatal one to an existence claim. So the same question was put to
`walk_graph.json` itself (`owngraph.mjs`), already cleaned of those edges, with
**exactly one thing changed: a door may leave the network at any graph node
within 30 m whose leg is clean of stairs, not only at its <= 3 baked anchors.**
Stepped edges Infinity, `F_OFFMAIN` skipped, precisely as `edgeCost` and
`dijkstra` do it.

```
pair         app anchors   as shipped   any node <= 30 m   raw OSM
GEA>JON          2/6          NONE          883 m           883 m
FNT>GEA          2/2          NONE          136 m           110 m
GUG>GEA          5/2          NONE         1217 m          1171 m
WAG>GEA         10/2          NONE          504 m           392 m
ADH>GEA         11/2          NONE          510 m           481 m
LTH>PAR          3/3          NONE          NONE            868 m
LTH>CMA / FAC>AF2 / MAG>FAC / CRH>FAC / LTH>BMA / TS2>BBR / LTH>SAG / D21>TS2
                              NONE          NONE            (all reachable)
```

**Five refusals are the anchor list's fault and nothing else's**, and all five
are Gearing Hall.

### The mechanism, and it is not what §R26 guessed

`cleanAnchors()` was not emptying. GEA has two doors and six baked anchors; the
stair test drops four and **keeps two, one per door** — node 1089 at 1.5 m from
the main door, node 10582 at 0.6 m from the other:

```
  door 386  main       anchor  1089   1.5 m   clean
                       anchor 10582  17.8 m   DIRTY  way 1512521141, 1.73 m at 1.1 deg
                       anchor  1095  20.2 m   DIRTY  way 1512521141, 3.96 m at 1.0 deg
  door 387  secondary  anchor 10582   0.6 m   clean
                       anchor  1089  16.8 m   DIRTY
                       anchor  6982  22.3 m   DIRTY
```

**Both surviving anchors sit on the same stub, and the only way off that stub
is the flight of steps.** Priced at Infinity under the step-free profile it is
an island; the Dijkstra correctly finds nothing, and the feature then says
something far stronger than "nothing from *here*". The step-free network runs
**13 metres away**. No local test on a door can see this — only the search
can — so §R26's guess that this was a `bake_walk.py` door-placement problem
was wrong for these five.

## R31. The fix: a third pass, and a radius read off a curve

`stepFreeRoute()` gains a third attempt **and only if the first two failed**,
so every route that works today takes the identical path through the function
and never reaches the new line. In that pass `cleanAnchors()` also offers every
graph node within `stairAltWideRadiusM` whose leg is clean of stairs.

`computeRoute()` is **not touched by a single line**, deliberately: it is the
`acer/w-door` lane's function this round and its diff already covers exactly
that region. The third pass is signalled by a module-scoped `stairWidePass`
flag, set and cleared in a `finally` — uglier than an option, and the correct
trade against a conflict in a file four lanes are editing.

### And the first cut of it walked three people through a wall

At 30 m — chosen as "no more permissive than the bake's own anchor cap" — the
five walks came back and **three of them drew a door leg straight through a
building**:

```
  FNT>GEA  13.81 m through the Pharmacy Building
  WAG>GEA  11.32 m through Mary E. Gearing Hall
  GUG>GEA   9.42 m through Mary E. Gearing Hall
```

A door leg is a line this file draws itself, and this file has no footprints —
they are a 1.4 MB snapshot the client never loads — so the only available
defence is a constant measured against them offline. Measured over all 300
pairs against the same `buildings.enriched.geojson` snapshot `bake_walk.py`
snaps to. **Worst added door leg inside a footprint, and (+n) refusals
answered:**

```
     radius \ cap        4            8           24
       13 m         0.00 (+0)    0.00 (+0)    0.00 (+0)
       20 m         0.00 (+5)    0.00 (+5)    0.00 (+5)   <-- SHIPPED
       24 m         0.00 (+5)    0.00 (+5)    0.00 (+5)
       28 m         0.00 (+5)  * 9.42 (+5)  * 9.42 (+5)
       30 m         0.00 (+5)  *13.81 (+5)  *13.81 (+5)
       40 m         0.00 (+5)  *13.81 (+5)  *24.70 (+14)
```

**And the first version of this section was wrong about which constant does
the work.** It swept the radius alone, with `stairAltWideMax` still at its
first-cut 24, and concluded the radius was what kept a leg out of a wall. The
matrix says otherwise: **the cap is the binding constraint.** Candidates are
taken nearest-first and every through-wall anchor on this campus is a FAR one,
so a small cap excludes them at any radius. The single-variable sweep is still
right *along its own row* — 13.5 m turns the fix on, 24 m is the last wholly
clean radius at cap 24, 25–27 m clips 2.48 m (under `WALL_CLIP_TOL_M`), 28 m
goes through — it was just the wrong row to generalise from.

The shipped pair sits clean with margin in **both** directions: the radius
could double to 40 m, or the cap could reach 24 at 24 m, and either way it is
still 0.00. Below 13.5 m the fix stops working at all.

**Look at the bottom-right cell.** At 40 m with cap 24 the pass "answers" all
fourteen refusals — by walking somebody 24.7 m through a building. A number
that looks like a total victory is exactly what a wrong constant looks like
here, and it is the reason this is a matrix and not a preference.

*(Re-checked against the `2026-08-24` snapshot that landed on `main`
mid-round. The bake's own baseline below is identical to the metre on both
snapshots — 221 legs touching, 123 over 3.0 m, worst 29.77 m — which is also
the check that the footprint reader is really reading the new file rather than
silently matching nothing.)*

**The yardstick nobody had published, and it is not flattering.** The same
measurement run over what the app already ships:

```
  the bake's own 1,078 door legs:  123 spend more than 3.0 m inside a
                                   building footprint, worst 29.77 m
  direct routes, both legs, 300 pairs:  58 of 600 over 3.0 m  (9.7 %)
```

So one door leg in ten already crosses a wall on every walk this app draws.
That is not this round's to fix — it is `bake_walk.py`'s snap — but it is why
the radius here is held to a *stricter* bar than the shipped data meets, not a
looser one. **Every one of the five walks the widened pass adds is outside
every footprint for its whole length.**

### And the cap: the answer was two

`stairAltWideMax` is the whole cost of the pass — every candidate is
stair-tested and every kept one is a Dijkstra seed. Swept over 300 pairs:

```
  stairAltWideMax   2   3   4   6   8  12  24
  offered         125 125 125 125 125 125 125
  refused           9   9   9   9   9   9   9
```

It buys nothing above two. The nearest two clean anchors per door already carry
all five walks. Shipped at **4**, double the measured need — and it cost a real
3x to learn: WAG>GEA measured p50 247 ms at 24 and 86 ms at 8 on a busy
machine.

## R32. The result, and the nine that are left

```
                                              round 4    round 5
routes                                          300        300
routes with a staircase on them                 134        134
step-free offered                               120        125
   ...whose door leg lies on a drawn staircase    0          0
   ...that traverse an OSM staircase              0          0
routes with a staircase the card never states     0          0
no way round                                     14          9
   ...of which false on the app's own graph        5          0
   ...of which false on raw OSM                   14          9
```

All seven of round 4's assertions stay green at 125 offered.
`stairAltWide = false` restores round 4 exactly, and is the A/B every number
above is from.

**Nothing that already worked moved.** All 120 pre-existing offers come back
with the identical distance and the identical arrival door — checked pair by
pair, 0 changed — and the third pass adds **10 `computeRoute` calls in 758 over
300 routes**.

### THE NINE ARE A NAMED DEFECT IN `scripts/bake_walk.py` — NOT THIS LANE'S FILE

Every one of the nine involves one of three buildings, and the reason is the
same for all three. Their entire step-free neighbourhood in `walk_graph.json`
is an **island**, and the only edges joining that island to the rest of the
graph are flights of steps:

```
  FAC  step-free component of  38 nodes   boundary: steps ways 129733836, 126328789
  LTH  step-free component of   4 nodes   boundary: steps way  146428823
  TS2  step-free component of  22 nodes   boundary: steps way  1212689333
                     (the main component is 10,383 nodes of 11,284)

  LTH > PAR / CMA / BMA / SAG      4 routes
  FAC > AF2, MAG > FAC, CRH > FAC  3 routes
  TS2 > BBR, D21 > TS2             2 routes   = the nine
```

So on the app's own data the refusal is **true**, and no change inside
`js/wayfind.js` can help. On raw OSM all nine have a step-free walk — and
before that becomes a bug report, each of those nine walks was put through the
same footprint test as everything else above:

```
  LTH>PAR 868 m, LTH>CMA 895 m, FAC>AF2 1882 m, MAG>FAC 1396 m, CRH>FAC 922 m,
  LTH>BMA 1063 m, TS2>BBR 204 m, LTH>SAG 984 m, D21>TS2 1257 m
     metres of each spent inside a building footprint:  0.0
```

**Outdoors the whole way, all nine.** The walk graph is dropping a step-free
connection to the Flawn Academic Center, the Littlefield Home and Texas Student
Housing that OSM has. Whoever owns `bake_walk.py`: start at the four steps way
ids above — the island boundary is only four edges wide, and whatever should
have been the fifth is what is missing.

## R33. What it costs, and the honest answer is that the clock cannot see it

**The structural number is the one to quote: 10 extra `computeRoute` calls in
758, over 300 routes — 1.3 %,** on the 3 % of routes that reach the third pass
at all.

The clock cannot resolve that on this machine, and pretending otherwise would
be the mistake `scripts/verify/README.md` exists to prevent. Two runs of the
identical 300-route census in the identical configuration, each the minimum of
several interleaved reps, an hour apart:

```
  stairAltWide=false   total 1029 ms, p50 2.1 ms      (3 reps)
  stairAltWide=false   total 1458 ms, p50 2.9 ms      (6 reps, later)
```

The run-to-run spread on ONE configuration is larger than the difference
between the two configurations. Sibling lanes were driving browsers throughout.
The pairs that actually pay, minimum of 5 interleaved reps of 40 routes,
hardware GL, no CPU throttle:

```
                                     stairAltWide=false    =true
  GEA>JON   reaches the third pass        2.1 ms          7.4 ms
  WAG>GEA   reaches the third pass        9.5 ms         17.4 ms
  ART>MAI   never reaches it             21.0 ms         22.5 ms
  JES>PCL   no stairs at all              2.0 ms          2.4 ms
```

A route that reaches the pass pays for one more Dijkstra, on a button press,
once. A route that does not pay nothing, and the two rows that never reach it
say so.

`WAYFIND.on` is **still `false`**. `harness-drift.mjs`: **PASS, 31 scripts in
`index.html`, 31 in `_harness.html`** (no new `<script>` this round).

## R34. Watched failing, on instruments that could not have been rigged

```
node gate.mjs 300 --oldleg          rounds 1-3's door-leg test, no width
   step-free offered 122
   FAIL  no offered step-free walk lays a DOOR LEG over a drawn staircase
         9 dirty of 122
   FAIL  every staircase the walk touches is stated by the card — 5 routes
```

Read the nine: `GEA>JON`, `FNT>GEA`, `GUG>GEA`, `WAG>GEA`, `ADH>GEA`,
`AND>NUR`, `FDH>WAG`, `WAG>KIN`, `WAG>BMC`. **Five of them are the exact five
walks this round recovers.** That is the arc of this lane in one line: rounds
1-3 offered those five *down the Gearing Hall steps*; round 4 saw it and
correctly refused them; round 5 found the real way round. The same person, the
same trip, three different answers, and only the last one is both true and
useful.

```
node gate.mjs 300 --break --breakgate
   step-free offered 134 (nothing withheld), no way round 0
   FAIL  no offered step-free walk TRAVERSES an OSM staircase — 96 dirty of 134
```

(Round 4 reported 117 of 134 for the same switches. The difference is not a
regression: with the filter leaky almost every route is unclean, so the third
pass fires on almost every route and picks a different broken walk. The point
is unchanged — the guard is watched failing loudly against the raw OSM survey.)

## R35. The frames, and `queryRenderedFeatures` is not proof

The house rule is to prove the subject is on screen. **This round shows why the
obvious way of doing that is not enough.** Two poses passed a
`queryRenderedFeatures` check on the four walk layers — 72 features, then 33 —
with the route entirely hidden behind the card and off the bottom of the frame.
`queryRenderedFeatures` counts what the **map** drew; the card is an HTML
overlay on top of it.

So the frames here are proved in **pixels**: the same camera shot twice, once
with the four walk layers visible and once with `visibility: none`, and the two
decoded and diffed (`png.mjs`, §R36 — nothing but `zlib`). Those pixels *are*
the walk.

```
  before   3963 px change, bbox [190,544,616,822], card [440,16,1000,408]
  after    3918 px change, bbox [272,544,616,806], card [440,16,1000,375]
```

And a third trap, caught the same way: **the map draws the DIRECT route until
the offer is pressed.** A before/after taken without clicking the button is the
same walk twice, and the diff said so — 2272 px versus 2269 px, a three-pixel
"difference" between two frames that were supposed to be the whole point of the
round. The script presses the button and reports whether it found one.

## R36. The instruments, written out

`gate.mjs` and `lib.mjs` are unchanged from §R27; run them with
`window.WAYFIND.stairAltWide = false` for the A/B. Four new files. They still
belong in `scripts/verify/`, which is still not this lane's directory.

### `osmfree.mjs` — a step-free network with no bake in it

Builds a walking graph from OSM node ids out of `footways.json` **plus** the
four `ROAD_WALKABLE` classes of `roads.json`, with every `highway=steps` way
deleted. `attach(doorLL)` returns the step-free attach points for a door: the
nearest point on any segment within `LEG_MAX_M` (30 m), rejected if the
straight leg lies >= 1.5 m along a drawn staircase within 20 deg of it (the
round-4 test, against `ground.geojson` rather than against the graph), seeded
at both endpoints of its segment with the along-way metres added.
`stepFreeDist(seeds, targets, wantPath)` is a plain Dijkstra over it.

### `noway.mjs` — the refusal check, positive control first

Drives the same 300 seeded pairs through `window.wayfindStairs`, then:

1. **POSITIVE CONTROL.** For every pair the app DID answer step-free, the
   outside network must independently find a step-free walk. If it cannot, the
   run prints `Instrument not trusted. Stopping before it accuses anything.`
   and exits 1 **without evaluating a single refusal.** This is not decoration
   — it is what caught the two instrument bugs in §R29.
2. Only then, for every `stepFreeNone` pair, report whether a walk exists.

### `owngraph.mjs` — the same question on `walk_graph.json`

Decodes the shipped graph in node (delta-coded nodes and edges, `F_STEPS`
priced Infinity, `F_OFFMAIN` skipped exactly as `dijkstra()` line 586 does — an
instrument that forgets that line is more permissive than the router and will
accuse it of refusals it is right to make). `bakedAnchors(di)` is what the app
has today; `wideAnchors(di, R)` is every graph node within `R` whose leg passes
the app's own `legCrossesStairs`, re-implemented line for line in
`anchdiag.mjs`. The difference between the two is §R30's table.

### `legcheck.mjs` — the footprint test that chose the radius

Reads the newest `data/snapshots/*/buildings.enriched.geojson`, drops
`building_class: roof` (a canopy is not a wall — `bake_walk.py` says so), and
returns the metres a straight leg spends inside any footprint, sampled at
0.5 m. `WALL_CLIP_TOL_M = 3.0` is the bake's own bar. This produced the radius
curve, the 123-of-1,078 baseline, and the all-clear on the five.

## R37. Where the doubt is, stated rather than buried

* **Nine refusals remain, and they are still wrong** — true on the app's data,
  false on the ground. §R32 names the file, the three buildings and the four
  way ids. Until that is fixed the feature tells nine people in 300 that they
  cannot get somewhere they can.
* **The 20 m / 4 pair is a property of THIS graph and THIS snapshot.** The
  plateau was measured on the shipped `walk_graph.json` against the 2026-08-23
  and 2026-08-24 footprint snapshots (identical results). A data refresh can
  move it and **nothing at runtime would notice** — the client has no
  footprints, so this is a verified invariant of the shipped data, not a check
  the code performs. Re-run §R31's matrix after any re-bake. The honest
  permanent fix is for `bake_walk.py` to publish, per door, the candidate
  attach nodes it has already checked against the footprints; this file would
  then never have to guess.
* **One door leg in ten already crosses a building** on the walks this app
  ships today (58 of 600 over 3.0 m). Round 5 does not add to that and holds
  its own five to zero, but the number belongs in the open, not in a footnote.
* **`stairWidePass` is module-scoped mutable state.** It is set and cleared in
  a `finally` inside one synchronous call and nothing in this file is
  re-entrant, so it is safe — but it is a workaround for not touching
  `computeRoute()` while another lane rewrites it, and it should become a plain
  option the moment that lane lands.
* **`doorsWide` is reported and nothing reads it.** A walk that only exists
  because a door left the network somewhere the bake did not precompute is
  worth telling apart, and arguably worth saying out loud. The card's wording
  is `docs/walk/what-we-can-honestly-say.md`'s, and another lane's.
* Round 1 §5a (`incline=down` discarded), §5b (`step_count`), round 3 §R15
  (`#wf-pill` is 197 px wide on a phone) and round 4 §R23 (the headline still
  says "No stairs on this route" over a body that says the last stretch crosses
  one) **all still stand unmade.**
* **Everything here is still a claim about `highway=steps` in OSM.** A
  staircase nobody mapped is invisible, and the card still says so.
* **`scripts/bake_ground.py` is unchanged this round**, as in rounds 2, 3 and
  4. Round 1's fix — the missing `area=yes` staircase and `wid` on every slab —
  is what makes the ground-truth join possible, and §R28 re-verified it holds
  at 189 of 189.


# ROUND 6 — the walk was step-free and the door at the end of it was not

Rounds 1-5 verified the PATH. Round 1 stopped the router climbing. Round 4
stopped the two straight door legs lying on a flight. Round 5 found a real way
round where the app had been refusing. **All five checks stop at the
threshold.** Nobody ever asked whether the door the walk arrives at is a door a
wheelchair can get through, and the answer is published — by UT, per entrance,
with the barrier named in prose.

> "The celebrated entrance for Gearing Hall is located on the south side of the
> building. **Access is off 24th Street up the stairs** and through the
> courtyard."
> — `Celebrated_Entrances_view`, `Bldg_Abbr: GEA`, `BarrierFree: N`.
> Our door 386 sits **1.2 m** from that point and is labelled `role: main`.

## R38. The door at the end of it

### The source, and it is the one docs/walk-evidence.md already found

`services9.arcgis.com/w9x0fkENXvuWZY26`, layer `Celebrated_Entrances_view`,
FeatureServer 0, queried live 2026-08-24 with `where=1=1&outFields=*&f=json&
outSR=4326`. **98 rows**, `sha256
ffb9ac935653c8ee72cbaa4685830843beef7584e4ab0770ed8c65f184c0c7a1`. The field
that matters is `BarrierFree` (`Y`/`N`) and it comes with `Longitude`,
`Latitude`, `Directional` and a `Description` that says what the barrier is.
The sibling layers `ADA_Celebrated_Entrances_view` (86 rows) and
`Non_ADA_Celebrated_Entrances_view` (12 rows) are the same rows split; the
parent is used here so both verdicts arrive in one pull with one hash.

Of the 98: **29 carry null coordinates** and cannot be placed at all, 2 name a
building `walk_graph.json` does not have, 1 is an exact duplicate (WCH
publishes its west entrance twice). **66 rows over 50 buildings** are usable,
and those 66 are what `UT_ENTRANCES` in `js/wayfind.js` transcribes.

### The join, and its positive control comes first

A UT survey point is not a door index. The rule, and every threshold is a named
constant on `WAYFIND`:

* the nearest UT row must be within **`stairBarrierFreeMatchM` = 8 m**, and
* the nearest row of the **opposite** verdict must be at least
  **`stairBarrierFreeMarginX` = 2** times farther.

Both halves matter. The margin is what refuses ECJ, where UT's accessible and
inaccessible entrances are 17 m and 37 m from the same door of ours and picking
one would be a coin toss. Swept, the two doors it convicts are the same two at
every setting — the answer is a plateau, not a choice:

```
  match \ margin      2.0                          doors labelled   Y    N
     5 m           GEA 386, PAR 512                      14         12    2
     8 m           GEA 386, PAR 512      <-- SHIPPED     24         22    2
    12 m           GEA 386, PAR 512                      32         30    2
    20 m           GEA 386, PAR 512, ECJ 362             42         39    3
```

**And the join is not trusted until it reproduces somebody else's.**
`docs/walk-baseline.md` names a UT-verified door for 19 of its 20 pairs'
endpoints, built by a different lane from the same FeatureServer by a different
method (per-pair nearest graph door, no margin rule). All **19 of 19** come
back out of this join — BUR 306, ECJ 362, EER 363, GAR 377, GDC 382, JES 435,
MAI 463, MEZ 481, NHB 499, PAI 509, PAT 513, PCL 518, PHR 521, PMA 526,
RLP 545, SZB 594, UTC 627, WAG 636, WCH 637 — and the two endpoints that lane
could not correct, CAL and UNB, are exactly the two where UT publishes no row
with coordinates. The instruments agree about the gaps as well as the matches.
`bfdoor.mjs` exits 1 without evaluating anything if that control fails.

**One thing that fell out of the control and belongs to that lane:**
`walk-baseline.md`'s UT-verified door for ECJ is **362, which is UT's
NOT-barrier-free entrance** (17.2 m from the `N` row, 37.1 m from the `Y`).
The correction is right about which door UT celebrates and wrong about which
door somebody in a wheelchair should be sent to.

### What it found, over the same 300 seeded pairs

```
  step-free offers                                                    125
  endpoints at a building UT surveyed a barrier-free door for          38
     ...that the walk went to a DIFFERENT door                         20    <-- 
  offers starting or ending on a door UT publishes as NOT barrier-free  2
```

Twenty of thirty-eight. Up to **63 m** away (GDC 381 instead of 382). The two
on an `N` door are both PAR, and PAR has exactly one door in the graph — see
the bake gaps below.

### The fix: a fourth pass, and it cannot make anything worse

`stepFreeRoute()` gains a fourth pass **after** the answer already exists.
Everything above it is untouched: front doors, every door, and round 5's
widened anchors run exactly as they did, and a route that already lands on UT's
door never reaches the new code.

```js
if (WAYFIND.stairBarrierFree && r && r.ok && r.stair && r.stair.clean) {
  const wantFrom = barrierFreeDoor(g, from.code), wantTo = barrierFreeDoor(g, to.code);
  const usable = (entry, di) => di >= 0 && entry.doors.indexOf(di) >= 0 &&
    g.doors[di][2] && g.doors[di][2].length;
  // ...ends where UT names a USABLE door we are not already using...
  const tries = fix.length === 2 ? [fix, [fix[0]], [fix[1]]] : [fix];
  ...
  if (!cand || !cand.ok || !cand.stair || !cand.stair.clean) continue;
  if (cand.distM - r.distM > WAYFIND.stairBarrierFreeSlackM) continue;
```

`usable` is not decoration. A door the bake never snapped to the network is not
in `stepFreeDoors()`'s list, so the filter would keep nothing, fall back to
every door, and hand back **the same walk** — which the loop below would then
record as a move that never happened and set `doorsBF` on. Caught by reading
the fall-through, not by a test; the check lives in the caller so the
restriction stays a filter and never a silent no-op.

`r` is only ever REPLACED, never invalidated, and only by a candidate that is
itself `ok` and `clean` and within slack. Both ends together first, then each
alone, so one unreachable barrier-free door cannot cost the walker the other
end's.

**`computeRoute()` is not touched by one line** — it is `acer/w-door`'s
function this round — so the restriction reaches it the way round 5's did, as
a module flag set and cleared in a `finally`:

```js
let stairBFOnly = null;                         // entry -> the door to insist on
function stepFreeDoors(g, entry) {
  const all = entry.doors.filter(di => g.doors[di][2] && g.doors[di][2].length);
  if (stairBFOnly && stairBFOnly.has(entry)) { ... }
  return all;
}
```

`stepFreeDoors()` is reached only when the step-free profile is running, and
`cleanAnchors()`/`anchors()` are untouched, so **an ordinary walk cannot change
by construction** — not by a metre, and not by a door.

### The slack, read off a curve

`stairBarrierFreeSlackM` is the taste knob and it is the whole argument of the
feature: for the person the toggle exists for, a door with steps is not a
slightly worse door, it is a wall. `docs/walk-baseline.md` measured that
forcing UT's door on EVERYBODY makes 9 of 19 ordinary trips longer, which is
why this is a slack and not a rule, and why it lives only in the step-free
profile where the other door is not an option at all.

Same 300 pairs, same page load, one constant moving:

```
   slack   offers  refused   ends on UT's bf door   extra m sum/med/max
   (off)      125        9        18 of 38             0 /   0 /   0
       0      125        9        19 of 38             0 /   0 /   0
      20      125        9        22 of 38            13 /   3 /   7
      40      125        9        25 of 38            96 /  26 /  31
      60      125        9        28 of 38           258 /  26 /  54
      80      125        9        28 of 38           258 /  26 /  54
     100      125        9        29 of 38           353 /  31 /  95   <-- the knee
     150      125        9        29 of 38           353 /  31 /  95   <-- SHIPPED
     200      125        9        29 of 38           353 /  31 /  95
     600      125        9        29 of 38           353 /  31 /  95
  100000      125        9        29 of 38           353 /  31 /  95
```

**Everything reachable is reached by 100 m and an unbounded slack buys nothing
more.** 150 is the knee with half again as much margin — and it is a real bound,
not decoration: unbounded, a future re-bake could send somebody 800 m out of
their way and nothing at runtime would notice. The binding case needs 95 m.

**`offers` and `refused` do not move at any setting, including unbounded.** The
pass cannot turn a walk into a refusal, and that is measured across the whole
curve rather than argued from the code.

### The result

```
                                                    round 5    round 6
  routes                                              300        300
  step-free offered                                   125        125
     ...door leg on a drawn staircase                    0          0
     ...traversing an OSM staircase                      0          0
  no way round                                          9          9
  endpoints on UT's published barrier-free door        18 of 38   29 of 38
  offers touching a UT NOT-barrier-free door             2          2  (both PAR,
                                                                       its only door)
  total extra walking bought with it                    —      353 m over 300 routes
                                                                (median 31 m, worst 95 m)
```

All seven of round 4's assertions stay green with the pass on:

```
node gate.mjs 300
  OSM steps ways 189 | drawn stair polygons 180
  routes 300 | with stairs 134 | step-free offered 125 | no way round 9
  PASS  routes completed — 300 of 300
  PASS  no offered step-free walk TRAVERSES an OSM staircase — 0 dirty of 125
  PASS  no offered step-free walk lays a DOOR LEG over a drawn staircase — 0 dirty of 125
  PASS  every staircase the card states is one the walk comes within 1.5 m of — 0 routes
  PASS  every staircase the walk touches is stated by the card — 0 routes
  PASS  a staircase the router walks along is filed as climbed, not as a door leg — 0 routes
  PASS  the leg list carries every staircase the router climbs — 0 bad of 300
```

**And the 189 re-verified first, before anything was touched** (`drawn189.py`,
written out below): 189 `highway=steps` ways in `data/osm_cache/footways.json`,
189 distinct way ids drawn across 180 polygons in `data/ground.geojson`,
**0 not drawn, 0 drawn that OSM does not have.**

### The nine that are left, and both families are somebody else's file

Nine of the thirty-eight still go to a different door at ANY slack, including
unbounded — so the reason is not the constant. They are two buildings, and both
were checked rather than guessed at:

**CMB — the barrier-free door is on a step-free island.** `reach.py` builds the
step-free components of the shipped graph (steps priced Infinity, `F_OFFMAIN`
skipped exactly as `dijkstra()` line 586 does):

```
  step-free components: 597, largest 10383 of 11284 nodes
  CMB  door 324  node 452 comp 20 (16 nodes) ISLAND | node 11040 comp 20 (16 nodes) ISLAND
```

Both of its anchors are stranded on a 16-node island. Nothing in
`js/wayfind.js` can reach it.

**WAG — the barrier-free door can only be reached over a flight.**
`anchdiag.py` re-implements `legCrossesStairs()` against the graph's own
stepped edges:

```
  WAG  door 636  node 10294: 0.0 m | node 10295: 3.5 m DROPPED | node 908: 2.0 m DROPPED
```

The two anchors that reach the main component both run along a mapped flight
for over the 1.5 m bar and are correctly refused; the one that survives is a
**one-node island**. So Waggener Hall's published barrier-free entrance is, on
this graph, only reachable by taking steps — **and the router is right to
refuse it.** That refusal is the feature working, and it is written down here
because it looks like a miss in the table above and is not one.

### AND THE BIGGEST NUMBER IN THIS ROUND IS NOT THIS LANE'S TO FIX

`gaps.py`, over the 60 barrier-free rows UT places on a building the graph has:

```
  ...with one of our doors within 8 m : 22
  ...with NO door within 8 m          : 38
```

**Thirty-eight of sixty.** The top of that list is not survey imprecision — at
these distances the point is on a different face of the building:

```
  SEA SW 79.8 m | GOL NW 64.1 | JON S 62.1 | BRB W 55.3 | FAC NW 50.7 | BIO W 48.8
  FNT E 44.7 | UTA W 44.6 | NHB NE 44.4 | GAR W 42.2 | MEZ SW 41.9 | PAR W 41.0
  ASE W 37.8 | UTA E 33.8 | ECJ W 33.7 | FAC SE 31.4 | DMC S 30.0 | ...
```

Read three of those with UT's own prose beside them:

* **PAR** — "the barrier-free celebrated entrance for Parlin Hall is located on
  the west side. Access point is **down a ramp** accessed from the northwest
  corner." Parlin has **one** door in `walk_graph.json`, on the east side, and
  it is the one UT flags `N`. The ramp is not in the graph, so every step-free
  walk to Parlin Hall arrives at the door UT says has the barrier — two of them
  in this census — and no routing change can help.
* **GEA** — the barrier-free entrance is on the EAST side off University Avenue,
  25.5 m from door 386 and 32.5 m from door 387. Neither of our two Gearing Hall
  doors is it, which is why `barrierFreeDoor('GEA')` returns -1 and this pass
  never fires there. Round 5's five recovered Gearing Hall walks arrive at
  **387**, which UT has not surveyed either way.
* **WCH** — door 637 IS the barrier-free west entrance, at 1.4 m. The app's
  `role: main` is 638, 51 m from the `N` row and 29 m from the `Y`.

**For whoever owns `scripts/bake_entrances.py` / `scripts/bake_walk.py`:** the
honest permanent home for all of this is a `barrierFree` flag published per
door, derived at bake time from these same rows, plus the 38 doors above that
the survey has and the graph does not. This file would then never have to carry
a transcription, and `barrierFreeDoor()` would collapse to a field read. The
list is reproducible in one command (`gaps.py`, below).

### Why the table is in the code, and what it costs to have it there

`UT_ENTRANCES` is 66 four-element rows — about 33 lines — sitting in
`js/wayfind.js` next to the pass that uses it. It is there for the same reason
round 5's 20 m radius is: **the client cannot fetch it, no bake this lane owns
writes it, and a number nobody can see is worse than a number in the open.**
It is a transcription with its source and hash directly above it, and it is
read by nothing outside the step-free profile.

The match is deliberately fussy so that a re-bake **degrades to round 5's
behaviour rather than to a wrong answer**: doors move, the 8 m/2× test stops
passing, `barrierFreeDoor()` returns -1, and the fourth pass simply never
fires. The failure mode is losing the improvement, never sending somebody
somewhere worse.

### What it costs, and the clock could not see it — again

**The structural number is the one to quote: at most 2 extra `computeRoute`
calls on a route where an end has a UT barrier-free door it is not already
using, and 0 on every other route. Over the 300-route census, 758 -> 780.**

```
node calls.mjs                     computeRoute calls   off   on
  PCL>PMA   sets=1 offer=true                            5     7
  WCH>JES   sets=1 offer=true                            5     7
  JES>PCL   sets=1 offer=true                            5     7
  ART>MAI   sets=7 offer=true                            3     3   <-- pays nothing
  GEA>JON   sets=1 offer=true                            3     3   <-- pays nothing
```

And here is why the stopwatch is not quoted. Minimum of 5 interleaved reps,
median of 5 calls each, hardware GL, no CPU throttle, machine NOT quiet
(sibling lanes driving browsers throughout):

```
                off       on
  PCL>PMA      5.20     8.60      pays 2 calls
  WCH>JES      2.10     5.10      pays 2 calls
  JES>PCL      2.00     3.00      pays 2 calls
  ART>MAI     15.10    25.90      PAYS NOTHING — and "slowed down" 72 %
```

`ART>MAI` is the control and it convicts the instrument: a pair proved to make
the identical 3 calls in both configurations moved 15.1 ms to 25.9 ms. Anything
read off the other three rows would have been that same noise wearing a
plausible story. `scripts/verify/README.md` exists for exactly this.

### Watched failing

An assertion nobody has watched go red is an assertion nobody has tested. Both
of this round's do.

```
node bfdoor.mjs 300 --nobf          # the pass off; nothing else changes
  FAIL  most step-free endpoints at a surveyed building use UT's barrier-free
        door — 18 of 38
```

```
UT_MATCH_M=35 UT_MARGIN=1.05 node bfdoor.mjs 300 --nobf
  # loosening the join to the point where it labels ECJ and GEA's doors too
  FAIL  no step-free walk starts or ends at a door UT publishes as NOT
        barrier-free, at a building that has another door at all — 10 of 125
     BTL>ECJ arrives at 361 | GEA>JON starts at 387 | AF2>ECJ arrives at 362
     FNT>GEA arrives at 387 | SEZ>ECJ arrives at 362 | GUG>GEA arrives at 387
     WAG>GEA arrives at 387 | RLP>ECJ arrives at 360 | ADH>GEA arrives at 387
     ECJ>ECG starts at 362
```

The second one is also the clearest picture of where the doubt lives: at a
loose enough join, five of round 5's recovered Gearing Hall walks are exactly
the rows that light up. At the shipped 8 m they are not labelled, because
door 387 is 19.5 m from UT's `N` point and 32.5 m from its `Y` — **UT has not
surveyed the door we arrive at, and this round refuses to guess.**

### The frames, and the same camera in both

`queryRenderedFeatures` is not proof (§R35). These are proved in pixels: the
same camera shot twice, once with the four walk layers visible and once with
`visibility: none`, decoded and diffed. The offer button is PRESSED in both —
the map draws the direct route until it is, so an A/B without the click is the
same walk twice.

The subject is chosen by the instrument, not by hand: of the 300 pairs, the one
whose door moves farthest on a walk short enough to photograph. That is
**PCL -> PMA**, arrival door **525 -> 526, 50.7 m apart**. The camera is
computed once from those two doors and reused, so nothing between the two
pictures moves except the ribbon.

| frame | what it shows |
|---|---|
| `shots/walk/stairs/r6-PCLPMA-before.jpg` | the ribbon comes up Speedway and **stops at the SOUTH side of PMA** — door 525 |
| `shots/walk/stairs/r6-PCLPMA-after.jpg` | identical camera, offer pressed: it carries on up the courtyard to the **NORTH-EAST corner** — door 526, UT's `Directional: Northeast`, `BarrierFree: Y` |
| `shots/walk/stairs/r6-PCLPMA-before-card.png` | `9-12 min walk · 770 m · No stairs on this route` · "✓ Step-free · no further to walk than the route with stairs" |
| `shots/walk/stairs/r6-PCLPMA-after-card.png` | `9-13 min walk · 820 m` · **"The last stretch isn't a mapped path"** · "✓ Step-free · 21 m further than the route with stairs" |

```
  before   2009 px change, bbox [434,444,623,799]
  after    2072 px change, bbox [434,342,669,799]
```

### A PATCH FOR THE CARD — NOT THIS LANE'S FUNCTION

The card still says, correctly for round 5 and no longer completely for round 6:

> This is not an accessibility check. We don't have data on kerbs, ramps, door
> widths or automatic doors, and there may be steps nobody has mapped.

Every clause of that stays true. But on the 29 endpoints where this pass lands
on UT's published barrier-free entrance, there is now one thing we DO know and
do not say. The sentence to argue for in
`docs/walk/what-we-can-honestly-say.md`, and then to add in `stairsSection()`:

```js
// after the offerDoorAt line
if (sf.doorsBF) card.appendChild(h('div', 'wf-c wf-dim', SAY_S.offerDoorBF));
// SAY_S:
offerDoorBF: 'Ends at the entrance UT lists as barrier-free.',
```

`stepFreeAlternative()` already hands `doorsBF` out (0, 1 or 2 — how many ends
were moved), and `wayfindStairs()` does not report it yet; both of those are
one line each in functions this lane does not own this round. Note the wording:
**UT lists it**, not "it is accessible". We have checked a survey, not a door.

## R39. Where the doubt is, stated rather than buried

* **29 of 38 is not 38 of 38.** Nine endpoints are CMB's island and WAG's
  stepped approach, both proved above to be data defects rather than routing
  ones, both named for the lane that owns them.
* **38 of UT's 60 placed barrier-free entrances have no door of ours within
  8 m.** For those buildings this pass does nothing at all, and the app has no
  opinion about whether the door it picks is accessible. That is the single
  biggest remaining gap in this feature and it is a bake gap.
* **29 of UT's 98 rows carry null coordinates** and were dropped. Four of those
  are `BarrierFree: N`. There may be a building on this campus whose celebrated
  entrance UT knows has steps and this file cannot see.
* **The 8 m / 2x pair is a property of THIS graph and THIS pull**, exactly as
  round 5's 20 m radius is. Re-run the sweep after any re-bake or any refresh
  of the survey. The code fails safe when it stops holding.
* **A `Y` row is a statement about a door; a door with no row is not thereby
  inaccessible.** Nothing here labels an unsurveyed door either way, and the
  round deliberately does not penalise one.
* **UT's survey is about the ENTRANCE, not the approach.** A door UT calls
  barrier-free at the end of a path with an unmapped kerb is still a door at
  the end of a path with an unmapped kerb. The card's disclaimer is still true
  and still needed.
* **`stairBFOnly` is module-scoped mutable state**, like round 5's
  `stairWidePass`, set and cleared in a `finally` inside one synchronous call.
  Safe because nothing in this file is re-entrant, and a workaround for not
  touching `computeRoute()` while another lane rewrites it. Both should become
  plain options the moment that lane lands.
* Round 1 §5a (`incline=down` discarded), §5b (`step_count`), round 3 §R15
  (`#wf-pill` is 197 px wide on a phone), round 4 §R23 (the headline) and round
  5 §R32 (the nine refusals, `bake_walk.py`) **all still stand unmade.**
* **`scripts/bake_ground.py` is unchanged this round**, as in rounds 2-5.
  §R38 re-verified round 1's fix holds at 189 of 189.

## R40. The instruments, written out

Save these beside `lib.mjs` and `gate.mjs` from §R27, `npm install
playwright-core`, `python scripts/serve.py 8813`, and fetch the survey once:

```bash
python - <<'EOF'
import urllib.request
u=('https://services9.arcgis.com/w9x0fkENXvuWZY26/arcgis/rest/services/'
   'Celebrated_Entrances_view/FeatureServer/0/query'
   '?where=1%3D1&outFields=*&f=json&outSR=4326')
open('Celebrated_Entrances_view.json','wb').write(urllib.request.urlopen(u,timeout=60).read())
EOF
REPO_ROOT=/path/to/repo node bfdoor.mjs 300                 # the three assertions
REPO_ROOT=/path/to/repo node bfdoor.mjs 300 --nobf          # the A/B: goes RED
UT_MATCH_M=35 UT_MARGIN=1.05 node bfdoor.mjs 300 --nobf     # the other one goes RED
REPO_ROOT=/path/to/repo node slack.mjs 300                  # the curve
REPO_ROOT=/path/to/repo node frames.mjs ./frames            # the pictures
python drawn189.py  /path/to/repo                           # 189 of 189
python reach.py     /path/to/repo CMB,WAG,PAR,GEA           # step-free components
python anchdiag.py  /path/to/repo WAG,CMB                   # which anchors survive
python gaps.py      /path/to/repo 8                         # the 38
```

They still belong in `scripts/verify/`, which is still not this lane's
directory. Until then they are at least IN the repository.


### `bfdoor.mjs` — THE GATE. The join, its positive control, and the three assertions.

```js
/**
 * bfdoor.mjs — ROUND 6. Is the door the step-free walk ARRIVES AT step-free?
 *
 * Rounds 1-5 verified the PATH: no stepped edge, no door leg lying on a drawn
 * flight, and (round 5) a real way round where the app used to refuse. Every
 * one of those checks stops at the threshold. Nobody has ever asked whether
 * the door the walk ends at is a door a wheelchair can get through.
 *
 * UT Austin publishes the answer itself, per entrance, in the same ArcGIS
 * FeatureServer docs/walk-evidence.md found: `Celebrated_Entrances_view`,
 * field `BarrierFree` = Y/N, with Longitude/Latitude and a prose Description
 * that names the barrier ("Access is off 24th Street up the stairs").
 *
 * That file is not in this repo and the router has never read it. It is
 * fetched to a scratchpad cache by fetch_ut.py; this script only joins.
 *
 *   node bfdoor.mjs [pairs] [--nobf] [--json out.json]
 *
 * --nobf turns the round-6 penalty off in the page (WAYFIND.stairBarrierFree
 * = false) and is the A/B every number is quoted against.
 */
import fs from 'node:fs';
import { open, ok } from './lib.mjs';

const ROOT = process.env.REPO_ROOT || process.cwd();
const CACHE = process.env.UT_CACHE || '.';

// ── every threshold a named constant (CLAUDE.md rule 11) ──────────────────
// How close a UT survey point must be to one of our doors before the two are
// called the same physical door. Read off a sweep, not guessed: the two
// non-barrier-free doors it convicts (GEA 386 at 1.2 m, PAR 512 at 0.9 m) are
// the same two at 5, 8, 12 and 20 m, and the Y set only grows. 8 m is inside
// that plateau and about one door's width plus GPS.
const UT_MATCH_M = Number(process.env.UT_MATCH_M || 8);
// ...and the runner-up UT row of the OPPOSITE verdict must be at least this
// many times farther away. A building whose accessible and inaccessible
// entrances are both near one of our doors gets NO label rather than a coin
// toss. At 2.0 this drops ECJ 362 (17.2 m N / 37.1 m Y) and keeps GEA and PAR.
const UT_MARGIN = Number(process.env.UT_MARGIN || 2.0);

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const NOBF = process.argv.includes('--nobf');
const JSONOUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();

const MPD_LON = 96061, MPD_LAT = 111195;   // same constants js/wayfind.js uses
const mBetween = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);

// ── the join, in node, against files the router never reads ───────────────
const graph = JSON.parse(fs.readFileSync(`${ROOT}/data/walk_graph.json`, 'utf8'));
const D = graph.d, CODE = graph.code;
const dll = (i) => [D[i][0] * 1e-6, D[i][1] * 1e-6];

const cel = JSON.parse(fs.readFileSync(`${CACHE}/Celebrated_Entrances_view.json`, 'utf8')).features;
const byBldg = new Map();
let nullCoord = 0;
for (const f of cel) {
  const a = f.attributes;
  if (a.Longitude == null || a.Latitude == null) { nullCoord++; continue; }
  const c = String(a.Bldg_Abbr || '').trim().toUpperCase();
  if (!byBldg.has(c)) byBldg.set(c, []);
  byBldg.get(c).push({ bf: a.BarrierFree, ll: [a.Longitude, a.Latitude],
    dirn: a.Directional, desc: String(a.Description || '').replace(/\s+/g, ' ') });
}

/** door index -> 'Y' | 'N', only where the match is unambiguous. */
const LABEL = new Map(), LABEL_WHY = new Map();
for (const [c, rows] of byBldg) {
  const doors = CODE[c];
  if (!doors) continue;
  for (const di of doors) {
    const near = rows.map(r => ({ m: mBetween(dll(di), r.ll), r })).sort((a, b) => a.m - b.m);
    const best = near[0];
    if (best.m > UT_MATCH_M) continue;
    const opp = near.slice(1).find(x => x.r.bf !== best.r.bf);
    if (opp && opp.m < best.m * UT_MARGIN) continue;
    LABEL.set(di, best.r.bf);
    LABEL_WHY.set(di, { code: c, m: +best.m.toFixed(2), dirn: best.r.dirn,
      next: opp ? +opp.m.toFixed(1) : null, desc: best.r.desc.slice(0, 150) });
  }
}
const labN = [...LABEL].filter(([, v]) => v === 'N').map(([i]) => i);
const labY = [...LABEL].filter(([, v]) => v === 'Y').map(([i]) => i);
console.log(`UT rows ${cel.length} (${nullCoord} with null coords) | buildings ${byBldg.size}`);
console.log(`doors labelled ${LABEL.size}  barrier-free ${labY.length}  NOT barrier-free ${labN.length}`);
for (const di of labN) {
  const w = LABEL_WHY.get(di);
  console.log(`   N  door ${di}  ${w.code} ${w.dirn} @${w.m} m (next opposite ${w.next} m)  role=${D[di][4]}`);
  console.log(`      "${w.desc}"`);
}

// ── POSITIVE CONTROL. The join has to reproduce a match somebody else made
// independently before it is allowed to accuse the router of anything.
// docs/walk-baseline.md's table, built by a different lane from the same
// FeatureServer by a different method (per-pair nearest graph door), names a
// UT-verified door for 19 of its 20 pairs' endpoints. Every one of them has
// to come back out of this join. If it disagrees, it is the join that is
// wrong. (CAL and UNB are NOT in this list because UT publishes no row with
// coordinates for either — which is exactly what that doc's §3 says, so the
// two instruments agree about the gaps as well as about the matches.)
const CONTROL = [['BUR', 306], ['ECJ', 362], ['EER', 363], ['GAR', 377],
  ['GDC', 382], ['JES', 435], ['MAI', 463], ['MEZ', 481], ['NHB', 499],
  ['PAI', 509], ['PAT', 513], ['PCL', 518], ['PHR', 521], ['PMA', 526],
  ['RLP', 545], ['SZB', 594], ['UTC', 627], ['WAG', 636], ['WCH', 637]];
let controlOK = true;
for (const [c, want] of CONTROL) {
  const rows = byBldg.get(c) || [];
  const doors = CODE[c] || [];
  let best = null;
  for (const di of doors) for (const r of rows) {
    const m = mBetween(dll(di), r.ll);
    if (!best || m < best.m) best = { di, m, bf: r.bf };
  }
  const good = best && best.di === want;
  if (!good) controlOK = false;
  if (!good) console.log(`   control ${c}: nearest UT row lands on door ${best ? best.di : '—'} ` +
    `(walk-baseline.md says ${want}) DISAGREE`);
}
console.log(`   positive control: ${CONTROL.filter(([c, w]) => {
  const rows = byBldg.get(c) || []; let b = null;
  for (const di of (CODE[c] || [])) for (const r of rows) {
    const m = mBetween(dll(di), r.ll); if (!b || m < b.m) b = { di, m };
  }
  return b && b.di === w;
}).length} of ${CONTROL.length} of docs/walk-baseline.md's UT-verified doors reproduced`);
if (!controlOK) {
  console.log('Join not trusted. Stopping before it accuses anything.');
  process.exit(1);
}

// ── the census ────────────────────────────────────────────────────────────
const { browser, page } = await open();
await page.evaluate((nobf) => {
  if (nobf && window.WAYFIND) window.WAYFIND.stairBarrierFree = false;
}, NOBF);
console.log(`pairs ${N} | stairBarrierFree=${!NOBF}`);

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
    const r = await window.wayfindStairs(a, b, {});
    if (!r || !r.ok) continue;
    out.push({
      from: a, to: b, clean: r.clean, sets: r.sets,
      fromDoor: r.fromDoor, toDoor: r.toDoor, distM: Math.round(r.distM),
      stepFreeNone: !!r.stepFreeNone,
      sf: r.stepFree ? { fromDoor: r.stepFree.fromDoor, toDoor: r.stepFree.toDoor,
        distM: r.stepFree.distM, clean: r.stepFree.clean } : null,
    });
  }
  return out;
}, N);

const stairy = res.filter(r => r.sets > 0);
const offers = res.filter(r => r.sf);
const bad = [], badDirect = [];
for (const r of offers) {
  for (const [role, di] of [['arrives at', r.sf.toDoor], ['starts at', r.sf.fromDoor]]) {
    if (LABEL.get(di) === 'N') bad.push({ ...r, role, di });
  }
}
for (const r of res) {
  for (const di of [r.toDoor, r.fromDoor]) if (LABEL.get(di) === 'N') badDirect.push({ ...r, di });
}

console.log('');
console.log(`routes ${res.length} | with a staircase ${stairy.length} | step-free offered ${offers.length}` +
  ` | no way round ${res.filter(r => r.stepFreeNone).length}`);
console.log(`step-free offers touching a UT non-barrier-free door: ${bad.length}`);
for (const b of bad.slice(0, 20)) {
  const w = LABEL_WHY.get(b.di);
  console.log(`   ${b.from}>${b.to}  ${b.role} door ${b.di} (${w.code} ${w.dirn}) — ${Math.round(b.sf.distM)} m`);
}
console.log(`(for scale: ordinary routes touching one: ${badDirect.length} of ${res.length * 2} endpoints)`);

// ── AND THE SHARPER QUESTION. Not "did it end on a door UT flags", but "when
// UT publishes a barrier-free entrance for this building, did the step-free
// walk go to it?" A door with no N label is not thereby accessible; it is
// only unsurveyed. The Y rows are the positive statement.
const bfDoorOf = new Map();          // building code -> the Y-labelled door
for (const [di, v] of LABEL) if (v === 'Y') bfDoorOf.set(LABEL_WHY.get(di).code, di);
const miss = [];
for (const r of offers) {
  for (const [role, di, c] of [['arrives', r.sf.toDoor, r.to], ['starts', r.sf.fromDoor, r.from]]) {
    const want = bfDoorOf.get(c);
    if (want == null || want === di) continue;
    miss.push({ from: r.from, to: r.to, role, got: di, want,
      apartM: +mBetween(dll(di), dll(want)).toFixed(1) });
  }
}
const eligible = offers.reduce((n, r) =>
  n + (bfDoorOf.has(r.to) ? 1 : 0) + (bfDoorOf.has(r.from) ? 1 : 0), 0);
console.log(`step-free endpoints at a building UT surveyed a barrier-free door for: ${eligible}`);
console.log(`   ...that went to a DIFFERENT door: ${miss.length}`);
const byPair = new Map();
for (const x of miss) {
  const k = `${x.role} ${x.role === 'arrives' ? x.to : x.from}: ${x.got} not ${x.want}`;
  byPair.set(k, (byPair.get(k) || 0) + 1);
}
for (const [k, n] of [...byPair].sort((a, b) => b[1] - a[1]))
  console.log(`      ${k}  x${n}  (${miss.find(x => `${x.role} ${x.role === 'arrives' ? x.to : x.from}: ${x.got} not ${x.want}` === k).apartM} m apart)`);

// The claim the CODE can be held to. A building whose only door in the graph
// is the one UT flags has no alternative for the router to find — that is a
// bake gap, reported above and named in §R38, and convicting the router of it
// would be convicting it of somebody else's missing data.
const badFixable = bad.filter(b => (CODE[LABEL_WHY.get(b.di).code] || []).length > 1);
const pass = [];
pass.push(ok(badFixable.length === 0,
  'no step-free walk starts or ends at a door UT publishes as NOT barrier-free, ' +
  'at a building that has another door at all',
  `${badFixable.length} of ${offers.length} offers ` +
  `(${bad.length} touch one where it is the building's ONLY door)`));
pass.push(ok(miss.length < eligible / 2,
  'most step-free endpoints at a surveyed building use UT\'s barrier-free door',
  `${eligible - miss.length} of ${eligible}`));
pass.push(ok(LABEL.size >= 20,
  'the UT join actually labelled doors (a vacuous check passes by labelling none)',
  `${LABEL.size} doors, ${labN.length} of them N`));

if (JSONOUT) {
  fs.writeFileSync(JSONOUT, JSON.stringify({
    utMatchM: UT_MATCH_M, utMargin: UT_MARGIN, nobf: NOBF,
    labels: [...LABEL].map(([di, v]) => ({ di, v, ...LABEL_WHY.get(di) })),
    routes: res.length, offers: offers.length, bad, badDirect,
  }, null, 1));
  console.log(`wrote ${JSONOUT}`);
}
await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```


### `slack.mjs` — The curve `stairBarrierFreeSlackM` is read off.

```js
/**
 * slack.mjs — ROUND 6. The curve WAYFIND.stairBarrierFreeSlackM is read off.
 *
 * One browser, one page load, the same 300 seeded pairs at every setting, so
 * the only thing that moves between rows is the constant. Reports, per slack:
 *   endpoints moved onto UT's barrier-free door, the extra metres that cost,
 *   step-free offers, refusals, and computeRoute calls.
 *
 *   node slack.mjs [pairs]
 */
import fs from 'node:fs';
import { open } from './lib.mjs';

const ROOT = process.env.REPO_ROOT || process.cwd();
const CACHE = process.env.UT_CACHE || '.';
const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const SLACKS = (process.env.SLACKS || '-1,0,20,40,60,80,100,150,200,300,600,100000')
  .split(',').map(Number);

const MPD_LON = 96061, MPD_LAT = 111195;
const mBetween = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);
const graph = JSON.parse(fs.readFileSync(`${ROOT}/data/walk_graph.json`, 'utf8'));
const D = graph.d, CODE = graph.code;
const dll = (i) => [D[i][0] * 1e-6, D[i][1] * 1e-6];
const MATCH = 8, MARGIN = 2;

const cel = JSON.parse(fs.readFileSync(`${CACHE}/Celebrated_Entrances_view.json`, 'utf8')).features;
const byB = new Map();
for (const f of cel) {
  const a = f.attributes;
  if (a.Longitude == null) continue;
  const c = String(a.Bldg_Abbr || '').trim().toUpperCase();
  if (!byB.has(c)) byB.set(c, []);
  byB.get(c).push({ bf: a.BarrierFree === 'Y' ? 1 : 0, ll: [a.Longitude, a.Latitude] });
}
/** the same match the router does, re-implemented here from the raw rows */
const BF = new Map();
for (const [c, rows] of byB) {
  const doors = CODE[c]; if (!doors) continue;
  let best = -1, bestM = Infinity;
  for (const di of doors) {
    const p = dll(di);
    let near = null, opp = Infinity;
    for (const r of rows) { const m = mBetween(p, r.ll); if (!near || m < near.m) near = { m, bf: r.bf }; }
    for (const r of rows) { const m = mBetween(p, r.ll); if (r.bf !== near.bf && m < opp) opp = m; }
    if (near.bf !== 1 || near.m > MATCH || opp < near.m * MARGIN) continue;
    if (near.m < bestM) { bestM = near.m; best = di; }
  }
  if (best >= 0) BF.set(c, best);
}
console.log(`UT barrier-free doors matched: ${BF.size} buildings`);

const { browser, page } = await open();
const rows = [];
for (const slack of SLACKS) {
  const r = await page.evaluate(async ([n, s]) => {
    window.WAYFIND.stairBarrierFree = s >= 0;
    window.WAYFIND.stairBarrierFreeSlackM = s;
    const st0 = window.wayfindStats ? window.wayfindStats().timings.routes : 0;
    const g = await fetch('data/walk_graph.json').then(r => r.json());
    const codes = Object.keys(g.code);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = []; let tries = 0;
    const t0 = performance.now();
    while (out.length < n && tries < n * 6) {
      tries++;
      const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
      if (a === b) continue;
      const q = await window.wayfindStairs(a, b, {});
      if (!q || !q.ok) continue;
      out.push({ from: a, to: b, sets: q.sets, none: !!q.stepFreeNone,
        sf: q.stepFree ? { f: q.stepFree.fromDoor, t: q.stepFree.toDoor, d: q.stepFree.distM } : null });
    }
    return { out, ms: performance.now() - t0,
      calls: (window.wayfindStats ? window.wayfindStats().timings.routes : 0) - st0 };
  }, [N, slack]);
  rows.push({ slack, ...r });
}
await browser.close();

const base = rows[0];                       // slack 0 == round 5's doors
const baseBy = new Map(base.out.map(o => [`${o.from}>${o.to}`, o]));
console.log('');
console.log(' slack   offers  refused   ends on UT bf-door   extra m (sum/med/max)   routes  ms');
for (const r of rows) {
  const offers = r.out.filter(o => o.sf);
  let onBF = 0, eligible = 0, extras = [];
  for (const o of offers) {
    for (const [di, c] of [[o.sf.f, o.from], [o.sf.t, o.to]]) {
      if (!BF.has(c)) continue;
      eligible++;
      if (BF.get(c) === di) onBF++;
    }
    const b = baseBy.get(`${o.from}>${o.to}`);
    if (b && b.sf) extras.push(o.sf.d - b.sf.d);
  }
  const pos = extras.filter(x => x > 0.5).sort((a, b) => a - b);
  const sum = pos.reduce((a, b) => a + b, 0);
  console.log(` ${String(r.slack).padStart(6)}  ${String(offers.length).padStart(6)}` +
    `  ${String(r.out.filter(o => o.none).length).padStart(7)}` +
    `   ${String(onBF).padStart(3)} of ${String(eligible).padStart(3)}` +
    `           ${sum.toFixed(0).padStart(5)} / ${(pos.length ? pos[pos.length >> 1] : 0).toFixed(0).padStart(4)}` +
    ` / ${(pos.length ? pos[pos.length - 1] : 0).toFixed(0).padStart(4)}` +
    `   ${String(r.calls).padStart(5)}  ${r.ms.toFixed(0).padStart(5)}`);
}
```


### `frames.mjs` — The pictures, proved in pixels, on one shared camera.

```js
/**
 * frames.mjs — ROUND 6. The picture, proved in PIXELS.
 *
 * Round 5 learned that `queryRenderedFeatures` is not proof — two poses passed
 * it with the walk entirely behind the card and off the bottom of the frame,
 * because it counts what the MAP drew and the card is an HTML overlay on top.
 * So the proof here is the same camera shot twice, once with the four walk
 * layers visible and once with `visibility: none`, and the two decoded and
 * diffed. Those pixels ARE the walk. The decode is the browser's own, done in
 * the page on two data: URLs, so there is no PNG reader to get wrong.
 *
 * It also presses the offer button, because the map draws the DIRECT route
 * until it is pressed — an A/B taken without the click is the same walk twice.
 *
 *   node frames.mjs [outdir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { open, shot, ok } from './lib.mjs';

const OUT = process.argv[2] || './frames';
fs.mkdirSync(OUT, { recursive: true });
const W = 1280, H = 800;
const LAYERS = ['wayfind-ribbon', 'wayfind-ghost', 'wayfind-thread', 'wayfind-column'];

const { browser, page } = await open({ w: W, h: H });

// ── 1. find the pair whose arrival/start door moves farthest under the pass ──
const pick = await page.evaluate(async () => {
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const MPD_LON = 96061, MPD_LAT = 111195;
  const dll = (i) => [g.d[i][0] * 1e-6, g.d[i][1] * 1e-6];
  const mB = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);
  const codes = Object.keys(g.code);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pairs = []; let tries = 0;
  while (pairs.length < 300 && tries < 1800) {
    tries++;
    const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
    if (a !== b) pairs.push([a, b]);
  }
  let best = null;
  for (const [a, b] of pairs) {
    window.WAYFIND.stairBarrierFree = false;
    const r0 = await window.wayfindStairs(a, b, {});
    if (!r0 || !r0.ok || !r0.stepFree) continue;
    window.WAYFIND.stairBarrierFree = true;
    const r1 = await window.wayfindStairs(a, b, {});
    if (!r1 || !r1.ok || !r1.stepFree) continue;
    const moved = Math.max(
      r0.stepFree.toDoor !== r1.stepFree.toDoor ? mB(dll(r0.stepFree.toDoor), dll(r1.stepFree.toDoor)) : 0,
      r0.stepFree.fromDoor !== r1.stepFree.fromDoor ? mB(dll(r0.stepFree.fromDoor), dll(r1.stepFree.fromDoor)) : 0);
    // Short enough that one frame can hold both ends of it — a 1.4 km
    // cross-campus walk photographs as a thread and shows nothing.
    if (r1.stepFree.distM > 900) continue;
    if (moved > 0 && (!best || moved > best.moved)) {
      const moving = r0.stepFree.toDoor !== r1.stepFree.toDoor
        ? [r0.stepFree.toDoor, r1.stepFree.toDoor] : [r0.stepFree.fromDoor, r1.stepFree.fromDoor];
      best = { a, b, moved, moving, movingLL: moving.map(dll),
        before: { f: r0.stepFree.fromDoor, t: r0.stepFree.toDoor, d: Math.round(r0.stepFree.distM) },
        after: { f: r1.stepFree.fromDoor, t: r1.stepFree.toDoor, d: Math.round(r1.stepFree.distM) } };
    }
  }
  return best;
});
console.log('subject:', JSON.stringify(pick));
if (!pick) { await browser.close(); throw new Error('no pair moves'); }

/** shoot the same camera twice, walk layers on and off, and diff in the page */
async function proveOnScreen(tag) {
  const on = path.join(OUT, `${tag}-on.png`), off = path.join(OUT, `${tag}-off.png`);
  await shot(page, on);
  await page.screenshot({ path: path.join(OUT, `${tag}.jpg`), type: 'jpeg', quality: 82 });
  await page.evaluate((ls) => {
    for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'none');
  }, LAYERS);
  await page.waitForTimeout(500);
  await shot(page, off);
  await page.evaluate((ls) => {
    for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'visible');
  }, LAYERS);
  await page.waitForTimeout(500);
  const a = 'data:image/png;base64,' + fs.readFileSync(on).toString('base64');
  const b = 'data:image/png;base64,' + fs.readFileSync(off).toString('base64');
  const d = await page.evaluate(async ([sa, sb]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(ia, 0, 0); const pa = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0); const pb = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) < 24) continue;
      n++;
      const p = (i / 4) | 0, px = p % c.width, py = (p / c.width) | 0;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return { n, bbox: [x0, y0, x1, y1], w: c.width, h: c.height };
  }, [a, b]);
  fs.unlinkSync(off);
  return d;
}

// ── 2. drive it by URL + CLICK, not by API ───────────────────────────────
const results = {};
for (const mode of ['before', 'after']) {
  await page.goto(`http://127.0.0.1:${process.env.PORT || 8813}/index.html` +
    `?walk=1&intro=0&drift=0&from=${pick.a}&to=${pick.b}`,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
  await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 180000 });
  await page.waitForFunction(() => !!window.__map && !!window.wayfindStairs, null, { timeout: 120000 });
  await page.evaluate((m) => { window.WAYFIND.stairBarrierFree = (m === 'after'); }, mode);
  await page.waitForTimeout(1200);
  // The card is collapsed behind the pill until it is clicked, and the offer
  // button lives inside it. Both clicks are real clicks — no API shortcut.
  await page.evaluate(() => {
    const p = document.getElementById('wf-pill'); if (p) p.click();
  });
  await page.waitForTimeout(900);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('button.wf-act.wf-alt');
    if (!b) return false;
    b.click(); return true;
  });
  if (!clicked) console.log(`  ${mode}: NO OFFER BUTTON FOUND`);
  await page.waitForTimeout(2500);
  const cardText = await page.evaluate(() => {
    const c = document.querySelector('#wf-pill') || document.querySelector('.wf-card');
    return c ? c.innerText.replace(/\n+/g, ' | ').slice(0, 400) : null;
  });
  // The card, cropped, before it is folded away — it is the other half of the
  // evidence and it is an HTML overlay, so it has to be shot separately.
  const cardBox = await page.evaluate(() => {
    const c = document.getElementById('wf-pill');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 };
  });
  if (cardBox) await shot(page, path.join(OUT, `r6-${pick.a}${pick.b}-${mode}-card.png`), cardBox);
  // Now fold the card away and frame THE END OF THE WALK. The thing that
  // changed is which door the last stretch runs to; an 800 m walk photographed
  // whole is a thread, and the card covers a third of the frame.
  await page.evaluate(() => { const p = document.getElementById('wf-pill'); if (p) p.click(); });
  await page.waitForTimeout(700);
  // THE SAME CAMERA IN BOTH FRAMES. The bbox is the two doors that swap,
  // padded, and it is computed once from `pick` — so nothing between the two
  // pictures moves except the ribbon.
  const framed = await page.evaluate(([lls, padM]) => {
    const MPD_LON = 96061, MPD_LAT = 111195;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of lls) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    const dx = padM / MPD_LON, dy = padM / MPD_LAT;
    window.__map.jumpTo({ pitch: 0, bearing: 0 });
    window.__map.fitBounds([[x0 - dx, y0 - dy], [x1 + dx, y1 + dy]],
      { padding: 20, duration: 0, pitch: 0, maxZoom: 17.9 });
    return { bbox: [x0, y0, x1, y1], zoom: window.__map.getZoom() };
  }, [pick.movingLL, 150]);
  await page.waitForTimeout(2600);
  const doors = await page.evaluate(async ([a, b]) => {
    const r = await window.wayfindStairs(a, b, {});
    return r && r.stepFree ? { f: r.stepFree.fromDoor, t: r.stepFree.toDoor, d: Math.round(r.stepFree.distM) } : null;
  }, [pick.a, pick.b]);
  const px = await proveOnScreen(`r6-${pick.a}${pick.b}-${mode}`);
  results[mode] = { clicked, cardText, doors, px, framed };
  console.log(`  ${mode}: clicked=${clicked} doors=${JSON.stringify(doors)} ` +
    `pixels=${px.n} bbox=${JSON.stringify(px.bbox)}`);
  console.log(`     card: ${cardText}`);
}

const pass = [];
pass.push(ok(results.before.clicked && results.after.clicked,
  'the offer button was pressed in both frames (the map draws the DIRECT route until it is)'));
pass.push(ok(results.before.px.n > 500 && results.after.px.n > 500,
  'the walk is actually on screen in both frames, proved by hiding it and diffing',
  `${results.before.px.n} px / ${results.after.px.n} px changed`));
pass.push(ok(JSON.stringify(results.before.doors) !== JSON.stringify(results.after.doors),
  'the two frames are different walks, not the same walk twice',
  `${JSON.stringify(results.before.doors)} vs ${JSON.stringify(results.after.doors)}`));
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ pick, results }, null, 1));
await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```


### `calls.mjs` — How many `computeRoute` calls each pair costs, on and off.

```js
/** calls.mjs — how many computeRoute calls each pair costs, on and off. */
import { open } from './lib.mjs';
const PAIRS = [['PCL', 'PMA'], ['WCH', 'JES'], ['ART', 'MAI'], ['JES', 'PCL'], ['GEA', 'JON']];
const { browser, page } = await open();
const out = await page.evaluate(async (pairs) => {
  const n = () => window.wayfindStats().timings.routes;
  const res = [];
  for (const [a, b] of pairs) {
    const row = { pair: `${a}>${b}` };
    for (const mode of ['off', 'on']) {
      window.WAYFIND.stairBarrierFree = (mode === 'on');
      await window.wayfindStairs(a, b, {});          // warm
      const s = n();
      await window.wayfindStairs(a, b, {});
      row[mode] = n() - s;
    }
    const r = await window.wayfindStairs(a, b, {});
    row.sets = r && r.sets; row.offer = !!(r && r.stepFree);
    res.push(row);
  }
  return res;
}, PAIRS);
for (const r of out) console.log(`  ${r.pair.padEnd(10)} sets=${r.sets} offer=${r.offer}  computeRoute calls: off ${r.off}  on ${r.on}`);
await browser.close();
```


### `cost.mjs` — The stopwatch, interleaved — and the control that convicts it.

```js
/**
 * cost.mjs — ROUND 6. What the fourth pass costs.
 *
 * Interleaved A/B, minimum of REPS, hardware GL, no CPU throttle, one page
 * load. Interleaving is the point: the machine is not quiet (sibling lanes
 * drive browsers throughout), so the two configurations have to share the
 * same noise rather than be measured an hour apart.
 */
import { open } from './lib.mjs';
const REPS = Number(process.env.REPS || 5);
const PAIRS = [['PCL', 'PMA'], ['WCH', 'JES'], ['ART', 'MAI'], ['JES', 'PCL']];
const { browser, page } = await open();
const out = await page.evaluate(async ([pairs, reps]) => {
  const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
  const res = {};
  for (const [a, b] of pairs) res[`${a}>${b}`] = { on: [], off: [] };
  const total = { on: [], off: [] };
  for (let r = 0; r < reps; r++) {
    for (const mode of ['off', 'on']) {
      window.WAYFIND.stairBarrierFree = (mode === 'on');
      let t0 = performance.now();
      for (const [a, b] of pairs) {
        const s = performance.now();
        const inner = [];
        for (let k = 0; k < 5; k++) {
          const u = performance.now();
          await window.wayfindStairs(a, b, {});
          inner.push(performance.now() - u);
        }
        res[`${a}>${b}`][mode].push(med(inner));
      }
      total[mode].push(performance.now() - t0);
    }
  }
  const mins = {};
  for (const k of Object.keys(res)) mins[k] = { on: Math.min(...res[k].on), off: Math.min(...res[k].off) };
  mins._total = { on: Math.min(...total.on), off: Math.min(...total.off) };
  return mins;
}, [PAIRS, REPS]);
console.log(`min of ${REPS} interleaved reps, median of 5 calls each, ms`);
for (const [k, v] of Object.entries(out))
  console.log(`  ${k.padEnd(12)} off ${v.off.toFixed(2).padStart(7)}   on ${v.on.toFixed(2).padStart(7)}`);
await browser.close();
```


### `drawn189.py` — 189 of 189, re-verified before anything was touched.

```python
"""drawn189.py — ROUND 6 re-verification of round 1's claim: every highway=steps
way in the raw OSM survey is DRAWN, and nothing is drawn that OSM does not have.
"""
import json, io, os, sys
ROOT = sys.argv[1]
def J(p): return json.load(io.open(os.path.join(ROOT, p), encoding='utf-8'))
fw = J('data/osm_cache/footways.json')
els = fw['elements'] if isinstance(fw, dict) else fw
osm = set()
for e in els:
    if e.get('type') != 'way': continue
    t = e.get('tags') or {}
    if t.get('highway') == 'steps': osm.add(e['id'])
gr = J('data/ground.geojson')
drawn = set(); polys = 0
for f in gr['features']:
    p = f.get('properties') or {}
    if 'wid' not in p: continue
    polys += 1
    w = p['wid']
    for x in (w if isinstance(w, list) else [w]): drawn.add(x)
print('OSM highway=steps ways      : %d' % len(osm))
print('drawn staircase polygons    : %d' % polys)
print('distinct way ids drawn      : %d' % len(drawn))
print('OSM ways NOT drawn          : %d  %s' % (len(osm - drawn), sorted(osm - drawn)[:10]))
print('drawn ids NOT in OSM        : %d  %s' % (len(drawn - osm), sorted(drawn - osm)[:10]))
```


### `reach.py` — Step-free components of the app's OWN graph.

```python
"""reach.py — ROUND 6. Is a given door reachable step-free on the app's OWN
graph? Decodes data/walk_graph.json in python the way js/wayfind.js decodes it
(delta-coded nodes and edges, F_STEPS priced Infinity, F_OFFMAIN skipped
exactly as dijkstra() does) and reports, for each door of a building, which
step-free component its anchors land in and how big that component is.

    python reach.py <repo-root> CMB,WAG,PAR,GEA
"""
import json, io, os, sys, heapq
ROOT = sys.argv[1]
CODES = sys.argv[2].split(',')
F_STEPS, F_OFFMAIN = 1, 128
g = json.load(io.open(os.path.join(ROOT, 'data/walk_graph.json'), encoding='utf-8'))
Q = g['q']
N = len(g['n']['x'])
X = []; Y = []
ax = ay = 0
for dx, dy in zip(g['n']['x'], g['n']['y']):
    ax += dx; ay += dy; X.append(ax * Q); Y.append(ay * Q)
E = len(g['e']['a'])
A = []; B = []
a = 0
for i in range(E):
    a += g['e']['a'][i]; A.append(a); B.append(a + g['e']['b'][i])
F = g['e']['f']; W = g['e']['w']
adj = [[] for _ in range(N)]
for i in range(E):
    if F[i] & F_OFFMAIN: continue          # never route on a stranded island
    if F[i] & F_STEPS: continue            # priced Infinity under step-free
    adj[A[i]].append((B[i], W[i] / 100.0))
    adj[B[i]].append((A[i], W[i] / 100.0))

# step-free connected components
comp = [-1] * N
sizes = []
for s in range(N):
    if comp[s] != -1: continue
    k = len(sizes); stack = [s]; comp[s] = k; n = 0
    while stack:
        u = stack.pop(); n += 1
        for v, _ in adj[u]:
            if comp[v] == -1: comp[v] = k; stack.append(v)
    sizes.append(n)
print('step-free components: %d, largest %d of %d nodes' % (len(sizes), max(sizes), N))
main = sizes.index(max(sizes))
for c in CODES:
    print('=== %s' % c)
    for di in g['code'].get(c, []):
        d = g['d'][di]
        parts = []
        for nd in d[2]:
            parts.append('node %d comp %d (%d nodes)%s' %
                         (nd, comp[nd], sizes[comp[nd]], '' if comp[nd] == main else '  ISLAND'))
        print('  door %-4d role=%-9s  %s' % (di, d[4], ' | '.join(parts)))
```


### `anchdiag.py` — `legCrossesStairs()`, re-implemented outside the app.

```python
"""anchdiag.py — ROUND 6. js/wayfind.js's own legCrossesStairs(), re-implemented
against the GRAPH's stepped edges, so a claim about which anchors the router
keeps can be checked instead of assumed.

    python anchdiag.py <repo-root> WAG,CMB,GEA
"""
import json, io, os, sys, math
ROOT = sys.argv[1]
CODES = sys.argv[2].split(',')
F_STEPS = 1
HALF_W = 1.5          # WAYFIND.stairLegHalfWidthM
OVERLAP_MIN = 1.5     # WAYFIND.stairLegOverlapMinM
PAR_DEG = 20          # WAYFIND.stairLegParallelDeg
LEG_SAMPLE_DIV = 6
MPD_LON, MPD_LAT = 96061, 111195
g = json.load(io.open(os.path.join(ROOT, 'data/walk_graph.json'), encoding='utf-8'))
Q = g['q']
X = []; Y = []
ax = ay = 0
for dx, dy in zip(g['n']['x'], g['n']['y']):
    ax += dx; ay += dy; X.append(ax * Q); Y.append(ay * Q)
E = len(g['e']['a'])
A = []; B = []
a = 0
for i in range(E):
    a += g['e']['a'][i]; A.append(a); B.append(a + g['e']['b'][i])
F = g['e']['f']; S = g['e']['s']
steps = [(A[i], B[i], S[i]) for i in range(E) if F[i] & F_STEPS]
print('stepped edges in the graph:', len(steps))

def m2(p, q):
    return ((p[0] - q[0]) * MPD_LON, (p[1] - q[1]) * MPD_LAT)

def seg_overlap(a, b, c, d, r):
    """metres of segment ab lying within r of segment cd (sampled, as the app does)"""
    ux, uy = m2(b, a)
    L = math.hypot(ux, uy)
    if L == 0: return 0.0
    n = max(1, int(math.ceil(L / (r / LEG_SAMPLE_DIV))))
    step = L / n
    tot = 0.0
    cx, cy = c; dx, dy = d
    vx, vy = m2(d, c)
    vv = vx * vx + vy * vy
    for i in range(n + 1):
        t = i / n
        px = a[0] + (b[0] - a[0]) * t; py = a[1] + (b[1] - a[1]) * t
        wx, wy = m2((px, py), (cx, cy))
        s = 0.0 if vv == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / vv))
        qx = cx + (dx - cx) * s; qy = cy + (dy - cy) * s
        ex, ey = m2((px, py), (qx, qy))
        if math.hypot(ex, ey) <= r: tot += step
    return tot

def nearly_parallel(a, b, c, d, cosb):
    ux, uy = m2(b, a); vx, vy = m2(d, c)
    lu = math.hypot(ux, uy); lv = math.hypot(vx, vy)
    if lu == 0 or lv == 0: return False
    return abs((ux * vx + uy * vy) / (lu * lv)) >= cosb

COS = math.cos(PAR_DEG * math.pi / 180)
for c in CODES:
    print('=== %s' % c)
    for di in g['code'].get(c, []):
        d = g['d'][di]
        dll = (d[0] * 1e-6, d[1] * 1e-6)
        out = []
        for nd in d[2]:
            nll = (X[nd], Y[nd])
            worst = 0.0; ways = set()
            for (u, v, sw) in steps:
                p = (X[u], Y[u]); q = (X[v], Y[v])
                # cheap bbox reject
                if min(p[0], q[0]) - 0.001 > max(dll[0], nll[0]): continue
                if max(p[0], q[0]) + 0.001 < min(dll[0], nll[0]): continue
                if min(p[1], q[1]) - 0.001 > max(dll[1], nll[1]): continue
                if max(p[1], q[1]) + 0.001 < min(dll[1], nll[1]): continue
                if not nearly_parallel(dll, nll, p, q, COS): continue
                m = seg_overlap(dll, nll, p, q, HALF_W)
                if m > worst: worst = m
                if m >= OVERLAP_MIN: ways.add(sw)
            out.append('node %d: %.1f m%s' % (nd, worst, ' DROPPED' if ways else ''))
        print('  door %-4d role=%-9s  %s' % (di, d[4], ' | '.join(out)))
```


### `gaps.py` — UT's barrier-free entrances the graph has no door for.

```python
"""gaps.py — ROUND 6. Which of UT's published barrier-free entrances the app
does not have a door for at all. Not this lane's file to fix; this is the list.
"""
import json, io, os, sys, math
D = os.path.dirname(os.path.abspath(__file__))
ROOT = sys.argv[1]
MATCH = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
def J(p): return json.load(io.open(p, encoding='utf-8'))
cel = J(os.path.join(D, 'Celebrated_Entrances_view.json'))['features']
g = J(os.path.join(ROOT, 'data/walk_graph.json')); d = g['d']; code = g['code']
MPD_LON, MPD_LAT = 96061, 111195
def m(a, b): return math.hypot((a[0]-b[0])*MPD_LON, (a[1]-b[1])*MPD_LAT)
def dll(i): return [d[i][0]*1e-6, d[i][1]*1e-6]
rows = []
for f in cel:
    a = f['attributes']
    if a.get('Longitude') is None: continue
    c = (a.get('Bldg_Abbr') or '').strip().upper()
    if c not in code: continue
    if a['BarrierFree'] != 'Y': continue
    rows.append((c, [a['Longitude'], a['Latitude']], a.get('Directional')))
near = []; far = []
for c, ll, dirn in rows:
    best = min(((m(dll(i), ll), i) for i in code[c]), default=(1e9, None))
    (near if best[0] <= MATCH else far).append((c, dirn, round(best[0], 1), best[1]))
print('UT barrier-free rows placed on a building the graph has: %d' % len(rows))
print('  ...with one of our doors within %.0f m: %d' % (MATCH, len(near)))
print('  ...with NO door within %.0f m       : %d' % (MATCH, len(far)))
for c, dirn, mm, di in sorted(far, key=lambda t: -t[2]):
    print('     %-4s %-10s nearest door %-4s at %6.1f m  (%d doors in graph)'
          % (c, dirn, di, mm, len(code[c])))
```

---

# ROUND 7 — the app says "up the steps", and nothing downstream of that sentence used it

Rounds 1-6 asked, six different ways, **whether there is a staircase on the
walk**. Round 1 stopped the router climbing when told not to, round 4 stopped
the two straight door legs lying on a flight, round 5 found real ways round
where the app was refusing, round 6 checked the door at the end. Not one of
them asked **which way the staircase goes**.

The file already knows. `js/wayfind.js` `stairLegs()` reads `F_UP_AB` against
the direction you are walking and puts the word on the card:

```js
const ab = leg.nodes[i] === g.A[e];
if (g.F[e] & F_UP_AB) dir = ab ? 'up' : 'down';
```

`WAYFIND.stairUpMult` has sat in the constants block since the arithmetic was
written, commented *"going up costs more, where `incline` is known"*. And
`edgeCost()` — the function that CHOSE the route — had no direction in it at
all.

## R41. The defect, and it is a claim about the world that is false

An undirected cost function makes an undirected graph, and an undirected graph
gives you the same answer both ways. Over the same 300 seeded pairs rounds 4-6
use, run **in both directions** (600 walks):

```
routable both ways        : 300 of 300
with >=1 mapped flight    : 129
with >=1 KNOWN direction  : 33
dist(A->B) == dist(B->A)  : 300 of 300   (differ: 0)
doors mirror exactly      : 300 of 300
routes that only CLIMB    : 8
routes that only DESCEND  : 10
```

**300 of 300**, to the millimetre, including the 33 pairs where OSM says which
way the hill goes. There is no rounding in that number and no near-miss in it:
the router could not tell up from down, so it did not.

### And the same is true of the clock, which is worse, because the clock TELLS you

`timeRange()` bills the high end of the printed band at `stairUpMult` for
**every stair metre on the route**, regardless of direction — including
flights the very same card has just labelled "down the steps":

```
CCJ>LTD   1151 m, 48.7 m of steps, ALL down  -> "14-19 min"; the high end
                                                includes 34.1 s of climbing
                                                that does not happen
CBA>ARC    900 m, 50.6 m of steps, ALL down  -> 35.4 s of it
AFP>CT2   1197 m, 48.7 m of steps, ALL down  -> 34.1 s
PAC>BME   1028 m, 48.7 m of steps, ALL down  -> 34.1 s
STD>SSB   1022 m,  7.4 m of steps, ALL down  ->  5.2 s
GRE>UTA   1137 m,  4.9 m of steps, ALL down  ->  3.4 s
PAT>MNAC  1174 m,  4.5 m of steps, ALL down  ->  3.2 s
RSC>HTB    533 m,  2.1 m of steps, ALL down  ->  1.5 s
```

Ten of 600 walks descend a known flight and climb nothing, and every one of
them is billed for the climb. A worst-case upper bound is a fair thing to
print about an UNKNOWN flight; it is not a fair thing to print about one the
app has just told you is downhill. **`timeRange()` is not this lane's function
this round** — §R44 has the patch, written out and not made.

## R42. What the graph actually asserts, measured before touching anything

| | |
|---|---|
| `highway=steps` ways in `data/osm_cache/footways.json` | **189** |
| ...tagged `incline` | **80** — 44 `up`, 36 `down` |
| ...reaching the client with a usable direction | **39** |
| steps EDGES in `data/walk_graph.json` | 215, 1,374.3 m of plan length |
| ...carrying `F_UP_AB` | **45**, 343.2 m |
| edges inside an up-tagged way with the bit MISSING | **4**, 46.2 m |
| NON-steps edges carrying `F_UP_AB` | **17**, 120.0 m (16 of them `wheelchair=yes`) |

Three things fall out of that table and each changed a decision:

1. **An edge without the bit is UNTAGGED, not downhill.** `scripts/bake_walk.py`
   sets bit 8 only for `incline=up` and then CLEARS it again when the edge's
   stored order is reversed, instead of inverting it — so `down` is dropped
   entirely and five `up` ways lose their direction as well. That is round 1
   §5a, still unmade, and it is why 109 of 189 flights arrive here with nothing
   said about them. **Those cost exactly what they cost in round 6.** Guessing
   a direction for them would be inventing data.
2. **Three ways are MIXED** — some edges flagged, some not, inside one OSM way
   whose `incline` tag is by definition uniform. Way `581040959`, the 64.0 m
   flight this round moves four walks off, ships with **2 of its 4 edges**
   flagged, so even where the router now knows it is climbing, it is only
   pricing half the climb.
3. **The 17 non-steps inclined edges are left alone on purpose.** 16 are
   `wheelchair=yes` — they are ramps, and an uphill ramp is genuinely harder.
   But the flat-walk cost model has no gradient term at all, and inventing one
   for 6 ways out of 3,430 on 120 m of campus would be a constant with almost
   no evidence under it. Round 5's lesson stands: a number that looks like it
   answers everything is what a wrong constant looks like. Written down, not
   made.

### And the client-side workaround was considered and rejected

The 4 missing edges inside up-tagged ways ARE recoverable without touching the
bake: the edges of one way form a chain, the stored order is ascending node
index, and one flagged edge orients the whole chain. It is about thirty lines
and a chain reconstruction that can be subtly wrong, to recover **46.2 m of
1,374**. §5a recovers four times as much with eight lines in the file that
owns the problem. Not done; named here so the next round does not rediscover it.

## R43. The fix, and its whole safety argument is one clamp

`edgeCost()` gains the node the walk arrives from — one extra argument, at one
call site, and `dijkstra()` is otherwise untouched because it is
`acer/w-door`'s function this round:

```js
function stairClimbMult() {
  const v = WAYFIND.stairClimbCostMult;
  const m = Number(v == null ? WAYFIND.stairUpMult : v);
  return isFinite(m) && m > 1 ? m : 1;
}

function isClimb(g, i, from) {
  if (from == null) return false;
  const ab = from === g.A[i];
  if (g.F[i] & F_UP_AB) return ab;
  const ex = stairExtras(g);
  return ex.down.size ? (ex.down.has(i) ? !ab : false) : false;
}
```

Three decisions in that, and each is load-bearing:

* **Never below 1.** At `>= 1` no edge in this graph can get CHEAPER than
  round 6 priced it, so the pass can only ever move a route OFF a climb. A bad
  override cannot turn that around — it can only turn the pass off. Watched
  refusing 0.2, 0.5, 0.99, 0, −3, `NaN` and `"banana"` in §R46.
* **Only the TRAVEL term is multiplied.** `stairFixedS` is the cost of spotting
  the flight and turning onto it, and that is the same job whichever way you
  then go.
* **`ex.down` is read from `stairExtras()`** — the same place `stairLegs()`
  reads it. The bake does not emit `e.dn` yet; the day §5a lands, the sentence
  on the card and the price in the router turn on together, and the 39 becomes
  80 with no further change here.

The constant is `WAYFIND.stairClimbCostMult`, default `null`, meaning **use
`stairUpMult`** — the number `walk_graph.json`'s own `tune` block already
ships (`STAIR_UP_MULT: 1.35`) and the card already bills a climb at. So this
round does not introduce a number. It stops two parts of the same file
disagreeing about one that was already there. Setting it to `1` restores the
round-6 router exactly, and that is the A/B every measurement below uses.

## R44. What it did, over the same 600 walks

11 of 600 walks changed. **Every one of them got longer, none got shorter, and
not one gained a staircase.**

```
directed walks compared         : 600
walks that CHANGED              : 11
  ...longer in metres           : 11
  ...shorter in metres          :  0
  ...GAINED a staircase         :  0
  ...LOST a staircase           :  8
  ...changed a DOOR             :  0
total walked metres before/after: 604,701.7 / 605,150.9   (+449.2 m, +0.07 %)
```

```
  CBA>MBE   956.1 -> 1048.2 m  sets 2->1  left [130882578, 581040959]  took [129733844]
  LTD>CCJ  1150.8 -> 1212.5 m  sets 1->0  left [130882578]             took []
  SEA>CCJ   881.9 ->  941.3 m  sets 1->0  left [130882578]             took []
  ARC>CBA   899.6 ->  958.9 m  sets 1->1  left [581040959]             took [147365574]
  SJG>CBA   759.0 ->  818.3 m  sets 1->1  left [581040959]             took [147365574]
  MBE>CBA   956.1 -> 1015.5 m  sets 2->2  left [581040959]             took [147365574]
  SSB>STD  1022.5 -> 1039.2 m  sets 1->0  left [1419272907]            took []
  PHR>STD   908.3 ->  925.0 m  sets 1->0  left [1419272907]            took []
  HTB>RSC   533.1 ->  541.3 m  sets 1->0  left [1429644803]            took []
  CS3>RSC   349.8 ->  358.0 m  sets 2->1  left [1429644803]            took []
  EAS>RSC   614.9 ->  623.1 m  sets 2->1  left [1429644803]            took []
```

**Every flight left is one OSM tags `incline=up`. There are no exceptions and
there is nothing else in the column.**

| way | `incline` | other tags | plan m | edges / flagged |
|---|---|---|---|---|
| `130882578` | **up** | `handrail=no`, `wheelchair=no`, `ramp=no` | 60.7 | 4 / 3 |
| `581040959` | **up** | `step_count=21`, `handrail=yes` | 64.0 | 4 / 2 |
| `1419272907` | **up** | `handrail=yes` | 7.4 | 1 / 1 |
| `1429644803` | **up** | — | 2.1 | 1 / 1 |
| `129733844` | *(none)* | taken instead | 10.8 | 1 / 0 |
| `147365574` | *(none)* | taken instead | 5.8 | 1 / 0 |

The two flights taken INSTEAD are 10.8 m and 5.8 m. The router traded a 64 m
climb for a 5.8 m one — a trade it could not see when both cost the same per
metre in either direction.

### The step-free walk did not move, and that is checked rather than argued

`edgeCost()` returns `Infinity` for a steps edge under `avoidStairs` **before**
it ever asks which way the flight goes, so a step-free walk cannot see this
round by construction. "By construction" is what rounds 1-3 said about claims
that turned out to be false, so it was measured instead — every step-free
answer on the 600, at `mult=1` and at the shipped setting, compared field by
field:

```
walks with a step-free answer at BOTH settings : 243
   ...that changed in any field                :   0
refused at both                                :  18
turned from refused into offered               :   0
turned from offered into refused               :   0
```

Same distance, same verified distance, same two doors, same verified step-edge
count, same verified leg-way count. **0 of 243.**

And round 4's gate, re-run on the merged result, in both configurations:

```
--mult 1 (round 6)  routes 300 | with stairs 134 | step-free offered 125 | no way round 9
shipped             routes 300 | with stairs 132 | step-free offered 123 | no way round 9
```

All seven assertions green in both. Round 6's numbers reproduce to the digit
under the switch, which is the strongest thing that can be said about an A/B.
The 125 → 123 is not a loss: **two ordinary walks stopped touching a staircase
at all**, so there is no longer anything to offer a way round. `SEA>CCJ` is one
of them by name — it used to need a step-free alternative and now the ordinary
answer is already step-free.

## R45. The constant, read off a curve — which does NOT plateau, and saying so is the point

Same 600 walks at a ladder of prices, one browser, one page:

```
  mult    changed  longer  shorter  +stair  -stair   climbing   extra m   sf offer  refused
       1        0       0        0       0       0         34         0        250       18
     1.1        0       0        0       0       0         34         0        250       18
     1.2        1       1        0       0       1         33        92        250       18
    1.35       11      11        0       0       8         23       449        245       18   SHIPPED
     1.6       14      13        1       0      11         20       554        244       18
     2.5       23      22        1       0      18         12      1119        240       18
      10       32      31        1       0      28          2      2549        236       18
  100000       32      31        1       0      28          2      2549        236       18
```

Rounds 5 and 6 both shipped the knee of a curve. **This one has no knee.** It
keeps buying climbs off the route all the way to unbounded, at a rising price
in real metres — 2,549 m across 600 walks at the top, and 32 walks doing about
80 m each to dodge flights as short as 2.1 m.

So the number is not chosen off the curve. It is **1.35 because that is
`STAIR_UP_MULT`**, already in `walk_graph.json`'s `tune` block, already what
the card bills a climb at. The router now charges exactly what the clock
charges and nothing has been invented. *How much harder than that a walking
router should work to dodge a climb* is a taste question, not a correctness
one — CLAUDE.md rule 9 says that one goes to Simeon, and rule 11 says it must
be a one-line edit, so it is: `WAYFIND.stairClimbCostMult`.

What the ladder DOES settle, on all 4,800 walks it drove:

* **`+stair` is 0 at every rung, unbounded included.** No setting of this
  constant puts a staircase on a walk that did not have one.
* **`refused` is 18 at every rung, unbounded included.** The pass cannot turn
  a walk into a refusal. It is measured across the whole curve, not argued
  from the code.
* **`climbing` only ever falls**: 34, 34, 33, 23, 20, 12, 2, 2.

### The assertion that went red, and it deserved to

The first cut of the ladder asserted *"no walk comes out shorter in metres
than round 6"* and it is **false** — four rungs produce one. Cost is
equivalent-flat-metres, not metres: a road crossing costs 8 m of nothing, so a
path can be physically shorter and still dearer. When the climb finally
outprices it, the router picks a route that is **both shorter and stair-free**:

```
  mult >=1.6   UTA>GRE   1137.3 -> 1112.4 m   sets 1->0   ways [1199982733] -> []
```

25 m shorter and one flight fewer, sitting there the whole time behind a road
crossing. The monotone property this round actually has is about **cost**, not
metres, and the assertion now says so.

### And how close these decisions are

`LTD>CCJ` is a near-tie broken by a hair, not a landslide — swept finely:

```
   x1.00 .. x1.30   1151 m   sets=1   ways=[130882578]
   x1.35            1213 m   sets=0   ways=[]
```

The flip is between ×1.30 and ×1.35. A 62 m detour and a 48.7 m climb are
within about thirty equivalent-flat-metres of each other, and the price of
climbing is what separates them.

## R46. Watched failing

* **`--mult 1`** on round 4's gate returns `134 | 125 | 9` — round 6's census,
  to the digit. If the switch did nothing, that is the run that would say so.
* **The clamp, fed rubbish.** `stairClimbCostMult` set to `0.2`, `0.5`, `0.99`,
  `0`, `-3`, `NaN`, `Infinity` and `"banana"`, each over a 240-walk census:
  every one comes back **byte-identical to `mult=1`**. And the shipped setting
  over the same census comes back **different** (4 walks), so "identical" is a
  clamp working rather than an instrument that cannot tell two censuses apart.
  `Infinity` is in that list on purpose and it fails to OFF, not to "never
  climb" — anyone wanting that wants a large finite number, and the constant's
  own comment says so.
* **The pixel proof went red first, and it was right to.** See §R47.

## R47. The frames — and the first cut of them was measuring the city loading

The instrument reloaded the page for each frame and shot 2.6 s later. It
reported **193,687 "walk pixels"** on a 1,100×700 frame with a mask bounding
box covering the entire picture. A 3 m ribbon is not half a photograph.

`pxfloor.mjs` was written before believing any of it — the same camera shot
twice with **nothing changed at all**:

```
NOISE FLOOR (same camera, nothing changed, 500 ms apart):
   >=24: 1535 px (0.2%)   >=120: 954 px
   hiding wayfind-ribbon   >=24:  7104 px   >=120:  2801 px
   hiding wayfind-ghost    >=24:  6356 px   >=120:  2795 px
   hiding wayfind-thread   >=24:  9730 px   >=120:  5430 px
   hiding wayfind-column   >=24:  6345 px   >=120:  2795 px
   hiding ALL FOUR         >=24:  9790 px   >=120:  5852 px
```

The whole walk is worth about 9,800 pixels. The first cut's 193,687 was ~95 %
tiles, trees and labels still arriving. Three changes followed, and all three
are in the file:

1. **One page load** for all three frames, so the scene is identical by
   construction and the only thing that moves is the ribbon.
2. **A quiet gate.** Two shots 700 ms apart must differ by under 1,500 px
   before anything is believed, re-checked before every frame. It reports what
   it measured: `0 px strict` on all three.
3. **The strict threshold** (≥120 summed RGB), where the floor is 954 px.

And one more: the whole-frame comparison excludes the **card**, which is an
HTML overlay whose text differs per walk. Comparing two frames through it
measures the wording. Uncropped it read 4,869 px; cropped, 10.

### The three frames, one camera, and the camera is derived not chosen

The camera is the box holding OSM way `130882578` plus every point of the
reversed walk more than 25 m from the forward one — exactly the ground where
the two answers disagree — padded 60 m. The first cut framed the staircase
alone and the way round left the picture: **215 walk pixels, in a corner.** A
frame that cannot show the thing the round is about is not evidence, however
green its assertions are.

| | |
|---|---|
| ![A](../shots/walk/stairs/r7-ccj-ltd-down.jpg) | **A — CCJ → LTD, shipped.** 1,151 m, `ways=[130882578]`, `dirs=["down"]`. Card: *"14-19 min walk · 1.2 km · Stairs: 1 set"*. Comes DOWN the flight. |
| ![B](../shots/walk/stairs/r7-ltd-ccj-round6-up.jpg) | **B — LTD → CCJ, `mult=1` (round 6).** 1,151 m, the SAME way, `dirs=["up"]`. Card: *"Stairs: 1 set"*. Climbs it. |
| ![C](../shots/walk/stairs/r7-ltd-ccj-round7-way-round.jpg) | **C — LTD → CCJ, shipped.** 1,213 m, `ways=[]`. Card: *"14-21 min walk · 1.2 km · No stairs on this route"*. Goes round, north of Townes Hall. |

```
camera bbox [-97.734677, 30.287075, -97.729365, 30.289150]   z=16.8205  c=[-97.732021, 30.288113]
walk mask (strict)   A 2785 px   B 2800 px   C 3514 px       floor 954 px
whole-frame diff     A~B    10 px      A~C  5946 px      B~C  5985 px
walk-mask IoU        A~B  0.991       A~C  0.026        B~C  0.027
```

**A and B differ by ten pixels.** Round 6's router drew, quite literally, the
same photograph walking up as walking down — that is the defect stated in
pixels rather than argued from the code. C shares 2.6 % of its ribbon with it.

## R48. What it costs

The pass adds **no `computeRoute` call at all**. It is one extra argument, a
bitmask test and a comparison inside a Dijkstra relaxation, on the 215 steps
edges of a 12,231-edge graph — and only where the bit is set, which is 45 of
them.

The stopwatch was run anyway, interleaved, minimum of nine reps of five routes,
on a machine with sibling lanes driving browsers:

```
    CCJ>LTD  (walks a tagged flight)  off 7.56 ms   on 7.62 ms     drift +0.06 ms
    BUR>SZB  (no tagged flight)       off 1.34 ms   on 1.32 ms     drift -0.02 ms
    subject answer identical both ways: true  (1150.810|130882578|1|1)
    control answer identical both ways: true  (1039.520||0|0)
```

+0.06 ms on a 7.6 ms route, against a control that moved −0.02 ms on its own.
That is the machine, not the pass.

**And the first cut of this measurement was nonsense, for a reason worth
keeping.** It timed `LTD>CCJ` — the pair whose whole point is that the ANSWER
changes. At `mult=1` that route has a staircase, so `wayfindStairs()` runs a
second avoid-stairs Dijkstra and a third to re-derive the claim; shipped, it
has none and runs one. It read **9.18 ms "off" against 1.94 ms "on"** — the
pass making routing nearly five times faster, which is not a thing that
happens. `CCJ>LTD` is the same flight in the descending direction: byte-
identical answer in both configurations, and the tagged edges are still walked,
so `isClimb()` is still evaluated. **Both timed pairs are now asserted to
return the same answer in both configurations before either time is read.**

## R49. Where the doubt is, stated rather than buried

* **39 of 189 flights, not 189 of 189.** The router is blind to direction on
  the other 150 and prices them exactly as round 6 did. That is `bake_walk.py`'s
  §5a and it is named, measured and unmade.
* **Half of one climb.** `581040959` ships 2 of its 4 edges flagged, so even
  where the router knows, it under-prices. Same defect, same file.
* **`incline` is a direction, not a gradient.** A tagged flight might be three
  steps or thirty; OSM says `step_count` on 10 of 189. This round prices the
  climb by the flight's PLAN LENGTH, which is what round 6 did too, and does
  not pretend to know the rise.
* **The 17 inclined non-steps edges are untouched.** 16 are ramps and an uphill
  ramp is real. Not modelled, because a gradient term for 6 ways of 3,430 is a
  constant with nothing under it.
* **1.35 is not the knee of anything**, because there is no knee. It is the
  number already in the file. §R45 says so in the open, and the ladder is there
  for Simeon to move it with one line.
* **`stairClimbCostMult` is read at every relaxation**, not cached per query.
  It is a property read on an object literal and the profile could not see it,
  but it means a mid-query mutation would be honoured mid-query. Nothing does
  that; the harness sets it between queries.
* **The card and the clock still bill every flight as a climb** (§R41). Not
  this lane's function; patch in §R50.
* **`scripts/bake_ground.py` is unchanged this round**, as in rounds 2-6.
  Round 1's fix re-verified at 189 of 189 before anything else was touched:
  189 OSM `highway=steps` ways, 180 drawn polygons, 189 distinct way ids drawn,
  **0 not drawn, 0 invented**.
* Round 1 §5a and §5b, round 3 §R15 (`#wf-pill` is 197 px wide on a phone),
  round 4 §R23 (the headline) and round 5 §R32 (the nine refusals) **all still
  stand unmade.**

## R50. A PATCH FOR `timeRange()` — NOT THIS LANE'S FUNCTION

Four sibling lanes are in `js/wayfind.js` this round and this lane owns the
cost and alternate-route functions, so this is written out rather than made.
Everything it needs is already on the objects it is handed.

`measure()` totals stair metres with no direction, and `timeRange()` bills the
high end at `stairUpMult` for all of them:

```js
    if (g.F[e] & F_STEPS) { stair += m; sets.add(g.S[e]); }
...
    const highS = m.flat / WAYFIND.speedLow +
      (m.stair / WAYFIND.stairSpeed) * WAYFIND.stairUpMult + ...
```

`measure()` already has what it needs to split them — it walks `leg.edges`,
and `leg.nodes[i]` is the node each edge is entered from, exactly as
`stairLegs()` uses it. Split the total three ways:

```js
  function measure(g, leg) {
    let flat = 0, stair = 0, stairUp = 0, stairDown = 0, signals = 0;
    const sets = new Set();
    for (let i = 0; i < leg.edges.length; i++) {
      const e = leg.edges[i];
      const m = g.W[e] / 100;
      if (g.F[e] & F_STEPS) {
        stair += m; sets.add(g.S[e]);
        // ROUND 7 §R41 — the same test the card's "up the steps" is printed
        // from. An edge with no known direction stays in neither bucket.
        if (isClimb(g, e, leg.nodes[i])) stairUp += m;
        else if (isDescent(g, e, leg.nodes[i])) stairDown += m;
      } else flat += m;
      if (g.F[e] & F_SIGNAL) signals++;
    }
    return { flat, stair, stairUp, stairDown, signals, stairSets: sets.size };
  }
```

...and charge the climb multiplier only to metres that are not KNOWN to be
downhill:

```js
    // ROUND 7 §R41. The high end is a worst case, and a worst case is a fair
    // thing to assume about a flight nobody has tagged. It is not a fair thing
    // to assume about one this very card has just called "down the steps":
    // over 600 walks, ten descend a known flight and climb nothing, and every
    // one of them was billed up to 35.4 s of climbing that does not happen.
    const climbable = m.stair - (m.stairDown || 0);
    const highS = m.flat / WAYFIND.speedLow +
      ((m.stair - climbable) + climbable * WAYFIND.stairUpMult) / WAYFIND.stairSpeed +
      m.stairSets * WAYFIND.stairFixedS +
      m.signals * WAYFIND.signalWaitHighS;
```

`isDescent()` is `isClimb()` with the sense inverted and the same
"untagged is not downhill" rule; both belong beside `isClimb()` in the cost
block. On today's data this narrows the printed band on 10 of 600 walks and
changes nothing else, because `stairDown` is 0 wherever OSM is silent.

The low end is deliberately left alone: it is the optimistic floor and
`stairSpeed` unmultiplied is already the fastest honest number for a flight.

## R51. The instruments, written out

Save these beside `lib.mjs` and `gate.mjs` from §R27 (this round's copies
import `_r7lib.mjs`, which is `lib.mjs` with `PORT` defaulted to 8813), run
`npm install playwright-core`, and start `python scripts/serve.py 8813`:

```bash
python drawn189.py /path/to/repo                 # 189 of 189, before anything
REPO_ROOT=/path/to/repo node updown.mjs 300      # the defect: 300 of 300 symmetric
REPO_ROOT=/path/to/repo node gate.mjs 300        # round 4's seven, shipped
REPO_ROOT=/path/to/repo node gate.mjs 300 --mult 1   # ...and round 6's numbers back
node sfsame.mjs 300                              # the step-free walk did not move
node climbcurve.mjs 300                          # the ladder, 4,800 walks
node pxfloor.mjs 500                             # the noise floor, FIRST
node frames7.mjs ./frames                        # the three pictures
node clampcost.mjs 120 9                         # the clamp, and the stopwatch
```

`scripts/verify/` is still not this lane's directory, so they are here rather
than there — but they are in the repository, and every number in §R41-§R48 is
the printed output of one of them.

### The `--mult` hook added to round 4's `gate.mjs`

Five lines, right after the `--oldleg` banner, so the A/B runs on the
same gate rather than a copy of it:

```js
const R7MULT = process.argv.includes('--mult')
  ? Number(process.argv[process.argv.indexOf('--mult') + 1]) : null;
if (R7MULT !== null) {
  await page.evaluate(m => { window.WAYFIND.stairClimbCostMult = m; }, R7MULT);
  console.log('*** stairClimbCostMult := ' + R7MULT + ' ***');
}
```

### `updown.mjs` — THE DEFECT. Every seeded pair driven both ways.

```js
/**
 * updown.mjs — ROUND 7. Is a walk UP a flight the same walk as the walk DOWN it?
 *
 * The app tells you "up the steps" or "down the steps" per flight (js/wayfind.js
 * stairLegs(), which reads F_UP_AB against the traversal direction). This asks
 * whether anything downstream of that sentence ever uses it:
 *
 *   1. THE ROUTER. Runs every seeded pair BOTH WAYS and compares. A cost
 *      function with no direction in it makes an undirected graph, and an
 *      undirected graph gives dist(A->B) == dist(B->A) exactly, on every pair,
 *      including the ones that climb.
 *   2. THE CLOCK. Compares the printed time band on a route whose flights are
 *      ALL known descents against what it would be if the climb multiplier were
 *      only charged for a climb.
 *
 * Nothing here reads a cost. It reads `distM`, the stair `list` (with `dir`),
 * and `lo`/`hi` off the public `wayfindStairs()` answer — the same numbers the
 * card prints.
 *
 *   node updown.mjs [pairs] [--mult N] [--json out.json]
 *
 * --mult sets WAYFIND.stairClimbCostMult live, so the A/B is one browser and
 * one page: `--mult 1` is the router with direction OFF (round 6 behaviour).
 */
import fs from 'node:fs';
import { open, ok } from './_r7lib.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const MULT = process.argv.includes('--mult')
  ? Number(process.argv[process.argv.indexOf('--mult') + 1]) : null;
const JSON_OUT = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1] : null;

const { browser, page } = await open();

if (MULT !== null) {
  const applied = await page.evaluate((m) => {
    if (!window.WAYFIND) return 'no WAYFIND';
    window.WAYFIND.stairClimbCostMult = m;
    return String(window.WAYFIND.stairClimbCostMult);
  }, MULT);
  console.log(`*** stairClimbCostMult := ${applied} ***`);
}

const tune = await page.evaluate(() => ({
  stairUpMult: window.WAYFIND && window.WAYFIND.stairUpMult,
  stairSpeed: window.WAYFIND && window.WAYFIND.stairSpeed,
  speedLow: window.WAYFIND && window.WAYFIND.speedLow,
  climb: window.WAYFIND && window.WAYFIND.stairClimbCostMult,
}));
console.log(`pairs ${N} | stairUpMult=${tune.stairUpMult} stairSpeed=${tune.stairSpeed} ` +
  `speedLow=${tune.speedLow} stairClimbCostMult=${tune.climb}`);

const res = await page.evaluate(async (n) => {
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code);
  // the same LCG and the same seed as gate.mjs, so this census is the same 300
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const strip = (r) => ({
    ok: !!(r && r.ok), distM: r && r.ok ? +r.distM.toFixed(3) : -1,
    lo: r && r.ok ? r.lo : -1, hi: r && r.ok ? r.hi : -1,
    sets: r && r.ok ? r.sets : -1,
    ways: r && r.ok ? r.ways.slice() : [],
    fromDoor: r && r.ok ? r.fromDoor : -1, toDoor: r && r.ok ? r.toDoor : -1,
    list: r && r.ok ? r.list.map(x => ({ way: x.way, m: +x.m.toFixed(2), dir: x.dir || '' })) : [],
  });
  const out = []; let tries = 0;
  while (out.length < n && tries < n * 6) {
    tries++;
    const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
    if (a === b) continue;
    const fwd = await window.wayfindStairs(a, b, {});
    if (!fwd || !fwd.ok) continue;
    const rev = await window.wayfindStairs(b, a, {});
    out.push({ a, b, fwd: strip(fwd), rev: strip(rev) });
  }
  return out;
}, N);

// ── the accounting ────────────────────────────────────────────────────────
const upM = (s) => s.list.filter(x => x.dir === 'up').reduce((t, x) => t + x.m, 0);
const dnM = (s) => s.list.filter(x => x.dir === 'down').reduce((t, x) => t + x.m, 0);
const unkM = (s) => s.list.filter(x => x.dir !== 'up' && x.dir !== 'down').reduce((t, x) => t + x.m, 0);

let bothOk = 0, sameDist = 0, sameDoors = 0, directedPairs = 0;
let asymDist = [], climbOnly = [], descentOnly = [];
let stairyPairs = 0;
for (const p of res) {
  if (!p.rev.ok) continue;
  bothOk++;
  const d = Math.abs(p.fwd.distM - p.rev.distM);
  if (d < 1e-6) sameDist++; else asymDist.push({ ...p, d: +d.toFixed(2) });
  if (p.fwd.fromDoor === p.rev.toDoor && p.fwd.toDoor === p.rev.fromDoor) sameDoors++;
  if (p.fwd.sets > 0 || p.rev.sets > 0) stairyPairs++;
  const directed = upM(p.fwd) + dnM(p.fwd) + upM(p.rev) + dnM(p.rev);
  if (directed > 0) directedPairs++;
  // a route whose every mapped flight is a KNOWN descent
  if (p.fwd.sets > 0 && dnM(p.fwd) > 0 && upM(p.fwd) === 0 && unkM(p.fwd) === 0) descentOnly.push(p);
  if (p.fwd.sets > 0 && upM(p.fwd) > 0 && dnM(p.fwd) === 0 && unkM(p.fwd) === 0) climbOnly.push(p);
}

console.log(`\nroutable both ways        : ${bothOk} of ${res.length}`);
console.log(`with >=1 mapped flight    : ${stairyPairs}`);
console.log(`with >=1 KNOWN direction  : ${directedPairs}`);
console.log(`dist(A->B) == dist(B->A)  : ${sameDist} of ${bothOk}   (differ: ${asymDist.length})`);
console.log(`doors mirror exactly      : ${sameDoors} of ${bothOk}`);
console.log(`routes that only CLIMB    : ${climbOnly.length}`);
console.log(`routes that only DESCEND  : ${descentOnly.length}`);

if (asymDist.length) {
  console.log('\nasymmetric pairs (metres apart), worst first:');
  for (const p of asymDist.sort((x, y) => y.d - x.d).slice(0, 12)) {
    console.log(`  ${p.a}>${p.b}  ${p.fwd.distM.toFixed(1)} m  vs  ` +
      `${p.b}>${p.a} ${p.rev.distM.toFixed(1)} m   D=${p.d} m` +
      `   up/down/? fwd ${upM(p.fwd).toFixed(0)}/${dnM(p.fwd).toFixed(0)}/${unkM(p.fwd).toFixed(0)}` +
      `  rev ${upM(p.rev).toFixed(0)}/${dnM(p.rev).toFixed(0)}/${unkM(p.rev).toFixed(0)}`);
  }
}

// THE CLOCK. On a route whose flights are all known DESCENTS, the printed high
// end still bills every stair metre at stairUpMult.
if (descentOnly.length) {
  console.log('\nthe clock, on routes with no climb on them at all:');
  for (const p of descentOnly.slice(0, 8)) {
    const st = dnM(p.fwd);
    const overS = (st / tune.stairSpeed) * (tune.stairUpMult - 1);
    console.log(`  ${p.a}>${p.b}  ${p.fwd.distM.toFixed(0)} m, ${st.toFixed(1)} m of steps, ` +
      `ALL down  ->  card says ${p.fwd.lo}-${p.fwd.hi} min; the high end includes ` +
      `${overS.toFixed(1)} s of climbing that does not happen`);
  }
}

const pass = [];
pass.push(ok(bothOk > 0, 'both directions routable on at least one pair', `${bothOk}`));
pass.push(ok(directedPairs > 0, 'the census reaches routes with a KNOWN stair direction',
  `${directedPairs} pairs`));
if (MULT === 1 || MULT === null) {
  // nothing asserted here; this run is the description of the defect
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ tune, N, res }, null, 1));
  console.log(`\nwrote ${JSON_OUT}`);
}

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `sfsame.mjs` — The step-free walk did not move, checked field by field. Plus the tipping point.

```js
/**
 * sfsame.mjs — ROUND 7. The step-free walk did not move, and that is checked,
 * not assumed.
 *
 * `edgeCost()` returns Infinity for a steps edge under `avoidStairs` BEFORE it
 * ever asks which way the flight goes, so a step-free walk cannot see round 7
 * by construction. "By construction" is what rounds 1-3 said about things that
 * turned out to be false, so: same 300 pairs, both directions, at mult=1 and
 * at the shipped setting, and every step-free answer compared field by field.
 *
 *   node sfsame.mjs [pairs]
 */
import { open, ok } from './_r7lib.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const { browser, page } = await open();

async function run(mult) {
  return page.evaluate(async ([n, m]) => {
    window.WAYFIND.stairClimbCostMult = m;
    const g = await fetch('data/walk_graph.json').then(r => r.json());
    const codes = Object.keys(g.code);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = {}; let tries = 0, pairs = 0;
    while (pairs < n && tries < n * 6) {
      tries++;
      const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
      if (a === b) continue;
      const fwd = await window.wayfindStairs(a, b, {});
      if (!fwd || !fwd.ok) continue;
      pairs++;
      const rev = await window.wayfindStairs(b, a, {});
      for (const [k, s] of [[a + '>' + b, fwd], [b + '>' + a, rev]]) {
        if (!s || !s.ok) continue;
        out[k] = s.stepFree ? {
          d: Math.round(s.stepFree.distM), vd: Math.round(s.stepFree.verifiedDistM),
          f: s.stepFree.fromDoor, t: s.stepFree.toDoor,
          clean: s.stepFree.clean, se: s.stepFree.verifiedStepEdges,
          lw: s.stepFree.verifiedLegWays,
        } : (s.stepFreeNone ? 'NONE' : null);
      }
    }
    return out;
  }, [N, mult]);
}

const off = await run(1);
const on = await run(null);

const keys = new Set([...Object.keys(off), ...Object.keys(on)]);
let both = 0, moved = 0, gained = 0, lost = 0, sameNone = 0;
const detail = [];
for (const k of keys) {
  const a = off[k], b = on[k];
  if (a === 'NONE' && b === 'NONE') { sameNone++; continue; }
  if (a === 'NONE' && b !== 'NONE') { gained++; detail.push(`${k}: refused -> offered`); continue; }
  if (a !== 'NONE' && b === 'NONE') { lost++; detail.push(`${k}: offered -> refused`); continue; }
  if (!a || !b) { detail.push(`${k}: ${JSON.stringify(a)} vs ${JSON.stringify(b)} (one side had no stairs)`); continue; }
  both++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    moved++; detail.push(`${k}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
}
console.log(`walks with a step-free answer at BOTH settings : ${both}`);
console.log(`refused at both                                : ${sameNone}`);
console.log(`turned from refused into offered              : ${gained}`);
console.log(`turned from offered into refused              : ${lost}`);
for (const d of detail.slice(0, 20)) console.log('   ' + d);

// ── and the tipping point on the frame pair, measured rather than argued ────
// LTD>CCJ is a NEAR TIE, not a landslide: the climb has to get slightly dearer
// than the flight is long before the way round wins. Finding the exact price
// at which it flips says how close the two answers were.
const tip = await page.evaluate(async () => {
  const out = [];
  for (const m of [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4]) {
    window.WAYFIND.stairClimbCostMult = m;
    const r = await window.wayfindStairs('LTD', 'CCJ', {});
    out.push({ m, d: Math.round(r.distM), sets: r.sets, ways: r.ways });
  }
  window.WAYFIND.stairClimbCostMult = null;
  return out;
});
console.log('\nLTD>CCJ, the price of a climb against the answer:');
for (const t of tip) console.log(`   x${t.m.toFixed(2)}  ${t.d} m  sets=${t.sets}  ways=${JSON.stringify(t.ways)}`);

const pass = [];
pass.push(ok(both > 0, 'the comparison actually reached step-free answers', `${both}`));
pass.push(ok(moved === 0,
  'not one step-free walk changed: same distance, same doors, same verified step edges',
  `${moved} of ${both}`));
pass.push(ok(lost === 0, 'no step-free offer was turned into a refusal', `${lost}`));

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `climbcurve.mjs` — THE LADDER. 4,800 walks, and the two assertions that survive it.

```js
/**
 * climbcurve.mjs — ROUND 7. The curve `stairClimbCostMult` is read off.
 *
 * Runs the same 300 seeded pairs BOTH WAYS at a ladder of settings, in ONE
 * browser and one page, and reports what each setting buys. 1 is the round-6
 * router. The last rung is effectively unbounded: if the numbers stop moving
 * there, no larger value can buy anything, and a bigger constant would only be
 * a bigger claim.
 *
 *   node climbcurve.mjs [pairs]
 */
import { open, ok } from './_r7lib.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const LADDER = [1, 1.1, 1.2, 1.35, 1.6, 2.5, 10, 100000];

const { browser, page } = await open();

const rows = [];
for (const mult of LADDER) {
  const r = await page.evaluate(async ([n, m]) => {
    window.WAYFIND.stairClimbCostMult = m;
    const g = await fetch('data/walk_graph.json').then(r => r.json());
    const codes = Object.keys(g.code);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const walks = []; let tries = 0, pairs = 0;
    while (pairs < n && tries < n * 6) {
      tries++;
      const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
      if (a === b) continue;
      const fwd = await window.wayfindStairs(a, b, {});
      if (!fwd || !fwd.ok) continue;
      pairs++;
      const rev = await window.wayfindStairs(b, a, {});
      for (const [k, s] of [[a + '>' + b, fwd], [b + '>' + a, rev]]) {
        if (!s || !s.ok) continue;
        walks.push({ k, d: +s.distM.toFixed(3), sets: s.sets, ways: s.ways.slice(),
          none: !!s.stepFreeNone, sf: s.stepFree ? 1 : 0,
          climbM: +s.list.filter(x => x.dir === 'up').reduce((t, x) => t + x.m, 0).toFixed(2) });
      }
    }
    return walks;
  }, [N, mult]);
  rows.push({ mult, walks: r });
  console.log(`  ${String(mult).padStart(7)} done — ${r.length} walks`);
}

const base = new Map(rows[0].walks.map(w => [w.k, w]));
console.log('\n  mult    changed  longer  shorter  +stair  -stair   climbing   extra m   sf offer  refused');
for (const row of rows) {
  let chg = 0, up = 0, dn = 0, plus = 0, minus = 0, extra = 0, climbing = 0, sf = 0, none = 0;
  for (const w of row.walks) {
    const b = base.get(w.k); if (!b) continue;
    if (w.climbM > 0) climbing++;
    if (w.sf) sf++;
    if (w.none) none++;
    if (Math.abs(w.d - b.d) > 1e-6 || String(w.ways) !== String(b.ways)) {
      chg++;
      if (w.d > b.d + 1e-6) up++;
      if (w.d < b.d - 1e-6) dn++;
      if (w.sets > b.sets) plus++;
      if (w.sets < b.sets) minus++;
    }
    extra += w.d - b.d;
  }
  console.log(`  ${String(row.mult).padStart(6)}  ${String(chg).padStart(7)} ${String(up).padStart(7)} ` +
    `${String(dn).padStart(8)} ${String(plus).padStart(7)} ${String(minus).padStart(7)} ` +
    `${String(climbing).padStart(10)} ${extra.toFixed(0).padStart(9)} ${String(sf).padStart(10)} ${String(none).padStart(8)}`);
}

// THE CURVE DOES NOT PLATEAU AT THE SHIPPED VALUE, and saying so is the point
// of running it. 1.35 is not a tuning choice — it is STAIR_UP_MULT, the number
// `walk_graph.json` already ships and the card already bills a climb at. How
// much harder than that the router should work to dodge a climb is a taste
// call (CLAUDE.md rule 9), so the ladder is reported rather than optimised and
// the constant is one line (rule 11).
let plusAny = 0, minusAny = 0;
const shorter = [], refusedAt = [], climbingAt = [];
for (const row of rows) {
  let none = 0, climbing = 0;
  for (const w of row.walks) {
    const b = base.get(w.k); if (!b) continue;
    if (w.none) none++;
    if (w.climbM > 0) climbing++;
    if (w.sets > b.sets) plusAny++;
    if (w.sets < b.sets) minusAny++;
    if (w.d < b.d - 1e-6) shorter.push({ mult: row.mult, k: w.k, was: b.d, now: w.d,
      sets: [b.sets, w.sets], ways: [b.ways, w.ways] });
  }
  refusedAt.push(none); climbingAt.push(climbing);
}
const pass = [];
pass.push(ok(plusAny === 0,
  'NO setting on the ladder — unbounded included — puts a staircase on a walk that had none',
  `${plusAny} of ${rows.length * rows[0].walks.length} walks`));
pass.push(ok(new Set(refusedAt).size === 1,
  'the refusal count does not move at ANY setting, unbounded included', refusedAt.join(' ')));
pass.push(ok(climbingAt.every((v, i) => i === 0 || v <= climbingAt[i - 1]),
  'walks still climbing a KNOWN flight only ever falls as the price rises', climbingAt.join(' ')));
// NOT asserted: "no walk comes out shorter in metres". It is false, and the
// first cut of this file asserted it and went red. Cost is equivalent-flat-
// metres, not metres: a shorter path can be dearer (a road crossing costs 8 m
// of nothing), so when a climb finally outprices it the router can pick a path
// that is BOTH shorter and dearer. Named rather than hidden:
console.log(`\n  walks that came out SHORTER in metres than round 6: ${shorter.length}`);
for (const s of shorter) console.log(`    mult ${s.mult}  ${s.k}  ${s.was.toFixed(1)} -> ` +
  `${s.now.toFixed(1)} m  sets ${s.sets.join('->')}  ways ${JSON.stringify(s.ways)}`);
console.log(`  walks that dropped a staircase, summed over the ladder: ${minusAny}`);

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `pxfloor.mjs` — THE NOISE FLOOR, measured before any pixel claim.

```js
/**
 * pxfloor.mjs — ROUND 7. The NOISE FLOOR of the pixel proof.
 *
 * frames7.mjs's first cut reported 193,687 "walk pixels" on a 1,100x700 frame
 * and a mask bbox covering the whole picture. A 3 m ribbon is not half a frame.
 * So before any IoU is believed: shoot the SAME camera twice with NOTHING
 * changed and diff that. Whatever that costs is what the scene does on its own,
 * and any mask smaller than it is noise wearing a ribbon's name.
 *
 *   node pxfloor.mjs [settleMs]
 */
import fs from 'node:fs';
import path from 'node:path';
import { open, shot, ok } from './_r7lib.mjs';

const SETTLE = Number(process.argv[2] || 500);
const OUT = process.env.OUT || './pxfloor';
fs.mkdirSync(OUT, { recursive: true });
const W = 1100, H = 700, PORT = process.env.PORT || 8813;
const WAY_BBOX = [-97.733293, 30.287075, -97.732741, 30.287190];
const PAD_M = 150;
const ALL = ['wayfind-ribbon', 'wayfind-ghost', 'wayfind-thread', 'wayfind-column'];

const { browser, page } = await open({ w: W, h: H });
await page.goto(`http://127.0.0.1:${PORT}/index.html?walk=1&intro=0&drift=0`,
  { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 180000 });
await page.waitForFunction(() => !!window.__map && !!window.wayfindRoute, null, { timeout: 120000 });
await page.evaluate(async () => { await window.wayfindRoute('CCJ', 'LTD'); });
await page.evaluate(([bb, pad]) => {
  const dx = pad / 96061, dy = pad / 111195;
  window.__map.jumpTo({ pitch: 0, bearing: 0 });
  window.__map.fitBounds([[bb[0] - dx, bb[1] - dy], [bb[2] + dx, bb[3] + dy]],
    { padding: 10, duration: 0, pitch: 0, maxZoom: 18 });
}, [WAY_BBOX, PAD_M]);
await page.waitForTimeout(3000);

const grab = async (name) => { const p = path.join(OUT, name + '.png'); await shot(page, p); return p; };
const diff = async (pa, pb) => {
  const a = 'data:image/png;base64,' + fs.readFileSync(pa).toString('base64');
  const b = 'data:image/png;base64,' + fs.readFileSync(pb).toString('base64');
  return page.evaluate(async ([sa, sb]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(ia, 0, 0); const pa2 = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0); const pb2 = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, big = 0;
    for (let i = 0; i < pa2.length; i += 4) {
      const d = Math.abs(pa2[i] - pb2[i]) + Math.abs(pa2[i + 1] - pb2[i + 1]) + Math.abs(pa2[i + 2] - pb2[i + 2]);
      if (d >= 24) n++;
      if (d >= 120) big++;
    }
    return { n, big, tot: (pa2.length / 4) | 0 };
  }, [a, b]);
};

const s1 = await grab('still1');
await page.waitForTimeout(SETTLE);
const s2 = await grab('still2');
const floor = await diff(s1, s2);
console.log(`NOISE FLOOR (same camera, nothing changed, ${SETTLE} ms apart):`);
console.log(`   >=24: ${floor.n} px (${(100 * floor.n / floor.tot).toFixed(1)}%)   >=120: ${floor.big} px`);

// per layer, one at a time
for (const l of ALL) {
  await page.evaluate((x) => { if (window.__map.getLayer(x)) window.__map.setLayoutProperty(x, 'visibility', 'none'); }, l);
  await page.waitForTimeout(SETTLE);
  const p = await grab('off-' + l);
  const d = await diff(s2, p);
  await page.evaluate((x) => { if (window.__map.getLayer(x)) window.__map.setLayoutProperty(x, 'visibility', 'visible'); }, l);
  await page.waitForTimeout(SETTLE);
  console.log(`   hiding ${l.padEnd(16)} >=24: ${String(d.n).padStart(7)} px   >=120: ${String(d.big).padStart(7)} px`);
}

// all four at once
await page.evaluate((ls) => { for (const x of ls) if (window.__map.getLayer(x)) window.__map.setLayoutProperty(x, 'visibility', 'none'); }, ALL);
await page.waitForTimeout(SETTLE);
const pAll = await grab('off-all');
const dAll = await diff(s2, pAll);
console.log(`   hiding ALL FOUR         >=24: ${String(dAll.n).padStart(7)} px   >=120: ${String(dAll.big).padStart(7)} px`);

ok(dAll.big > 10 * Math.max(1, floor.big),
  'the walk is worth more than ten times the noise floor at the strict threshold',
  `${dAll.big} vs ${floor.big}`);

await browser.close();
```

### `frames7.mjs` — The three pictures, on one derived camera.

```js
/**
 * frames7.mjs — ROUND 7. The round in three pictures, proved in PIXELS, with
 * the noise floor measured FIRST.
 *
 * ONE page load, ONE camera, three walks over OSM way 130882578 — a 60.7 m
 * flight tagged `incline=up`, `handrail=no`, `wheelchair=no`:
 *
 *   A  CCJ > LTD, shipped        comes DOWN the flight
 *   B  LTD > CCJ, mult=1         round 6's router: climbs the SAME flight
 *   C  LTD > CCJ, shipped        goes round it
 *
 * A and B must be the SAME PICTURE to within the noise floor — that is round
 * 6's defect stated as pixels rather than argued. C must not be.
 *
 * THE FIRST CUT OF THIS FILE WAS MEASURING THE CITY LOADING. It reloaded the
 * page per frame and shot 2.6 s later, and reported 193,687 "walk pixels" with
 * a mask bbox covering the whole 1,100x700 frame. A 3 m ribbon is not half a
 * picture. pxfloor.mjs put the real number at ~9,800 px for all four walk
 * layers together and ~1,500 px for the scene doing nothing at all, so the
 * first cut was ~95 % tiles and trees still popping in. Hence:
 *
 *   - ONE page load. The scene is then identical by construction and the only
 *     thing that moves between frames is the ribbon.
 *   - QUIET FIRST. Two shots QUIET_GAP_MS apart must differ by less than
 *     QUIET_PX before anything is believed, re-checked before every frame.
 *   - The strict threshold. A pixel counts at >=120 of summed RGB, where the
 *     floor was 954 px and the walk is 5,852.
 *
 *   node frames7.mjs [outdir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { open, shot, ok } from './_r7lib.mjs';

const OUT = process.argv[2] || './frames7';
fs.mkdirSync(OUT, { recursive: true });
const W = 1100, H = 700, PORT = process.env.PORT || 8813;

const WAY = 130882578;
const WAY_BBOX = [-97.733293, 30.287075, -97.732741, 30.287190];
// The camera is NOT chosen. It is the box that holds the flight plus every
// point of the reversed walk that is more than DIVERGE_M from the forward one
// — i.e. exactly the ground where the two answers disagree — padded. The first
// cut framed the staircase alone at 150 m and the way round left the picture:
// 215 walk pixels for C, in a corner. A frame that cannot show the thing the
// round is about is not evidence, however green its assertions are.
const DIVERGE_M = 25;
const PAD_M = 60;
const WALK_LAYERS = ['wayfind-ribbon', 'wayfind-ghost', 'wayfind-thread', 'wayfind-column'];
// A pixel is DIFFERENT at this much summed |dR|+|dG|+|dB|. 24 is what round 5
// used; at 24 the settling scene alone spends 1,535 px, so this round reads the
// strict one and quotes both.
const DIFF_STRICT = 120;
// The scene is QUIET when two shots this far apart differ by less than this at
// the strict threshold. Measured floor: 954 px.
const QUIET_GAP_MS = 700, QUIET_PX = 1500, QUIET_TRIES = 20;
// Two masks this alike are the same ribbon.
const SAME_IOU = 0.90;
// A mask this small is not a walk. Measured: all four layers = 5,852 px strict.
const MIN_WALK_PX = 1500;   // re-read after the camera moved; see the run log

const { browser, page } = await open({ w: W, h: H });
await page.goto(`http://127.0.0.1:${PORT}/index.html?walk=1&intro=0&drift=0`,
  { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => { try { window.cancelGraphicsAutoDetect(); } catch (e) {} });
await page.waitForFunction(() => !document.getElementById('veil'), null, { timeout: 180000 });
await page.waitForFunction(() => !!window.__map && !!window.wayfindRoute, null, { timeout: 120000 });

// ── the camera, derived: where the two answers put a person on different ground
const CAM_BBOX = await page.evaluate(async ([wb, dm]) => {
  const MPD_LON = 96061, MPD_LAT = 111195;
  const line = async (f, t, m) => {
    window.WAYFIND.stairClimbCostMult = m;
    const r = await window.wayfindStairs(f, t, { geom: true });
    return r && r.geom ? r.geom.line : null;
  };
  const a = await line('CCJ', 'LTD', null);
  const c = await line('LTD', 'CCJ', null);
  const far = (p, L) => {
    let best = 1e9;
    for (const q of L) {
      const d = Math.hypot((p[0] - q[0]) * MPD_LON, (p[1] - q[1]) * MPD_LAT);
      if (d < best) best = d;
    }
    return best;
  };
  let x0 = wb[0], y0 = wb[1], x1 = wb[2], y1 = wb[3];
  for (const p of c) if (far(p, a) > dm) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  for (const p of a) if (far(p, c) > dm) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}, [WAY_BBOX, DIVERGE_M]);
console.log(`camera bbox (flight + where the two walks diverge): ${JSON.stringify(CAM_BBOX)}`);

const grab = async (name) => { const p = path.join(OUT, name + '.png'); await shot(page, p); return p; };
const diff = async (pa, pb, excl) => {
  const a = 'data:image/png;base64,' + fs.readFileSync(pa).toString('base64');
  const b = 'data:image/png;base64,' + fs.readFileSync(pb).toString('base64');
  return page.evaluate(async ([sa, sb, TH, EX]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(ia, 0, 0); const pa2 = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0); const pb2 = x.getImageData(0, 0, c.width, c.height).data;
    const bits = []; let n24 = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < pa2.length; i += 4) {
      const p = (i / 4) | 0, px = p % c.width, py = (p / c.width) | 0;
      // EX is the card. It is an HTML overlay, its text differs per walk, and
      // it is not the map — comparing two frames THROUGH it just measures the
      // wording. Excluded for the whole-frame comparisons only.
      if (EX && px >= EX[0] && px <= EX[2] && py >= EX[1] && py <= EX[3]) continue;
      const d = Math.abs(pa2[i] - pb2[i]) + Math.abs(pa2[i + 1] - pb2[i + 1]) + Math.abs(pa2[i + 2] - pb2[i + 2]);
      if (d >= 24) n24++;
      if (d < TH) continue;
      bits.push(p);
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return { n: bits.length, n24, bbox: [x0, y0, x1, y1], bits };
  }, [a, b, DIFF_STRICT, excl || null]);
};

/** Refuse to shoot a scene that is still moving. */
async function quiet(tag) {
  for (let i = 0; i < QUIET_TRIES; i++) {
    const p1 = await grab(`${tag}-q1`);
    await page.waitForTimeout(QUIET_GAP_MS);
    const p2 = await grab(`${tag}-q2`);
    const d = await diff(p1, p2);
    fs.unlinkSync(p1);
    if (d.n <= QUIET_PX) return { tries: i + 1, n: d.n, n24: d.n24, still: p2 };
    fs.unlinkSync(p2);
  }
  throw new Error(`${tag}: scene never went quiet`);
}

async function frame(tag, from, to, mult) {
  await page.evaluate((m) => { window.WAYFIND.stairClimbCostMult = m; }, mult);
  const answer = await page.evaluate(async ([f, t]) => {
    await window.wayfindRoute(f, t);
    const r = window.wayfindStairs();
    return r ? { distM: Math.round(r.distM), sets: r.sets, ways: r.ways,
      dirs: r.list.map(x => x.dir), lo: r.lo, hi: r.hi } : null;
  }, [from, to]);
  await page.evaluate(([bb, pad]) => {
    const dx = pad / 96061, dy = pad / 111195;
    window.__map.jumpTo({ pitch: 0, bearing: 0 });
    window.__map.fitBounds([[bb[0] - dx, bb[1] - dy], [bb[2] + dx, bb[3] + dy]],
      { padding: 10, duration: 0, pitch: 0, maxZoom: 18 });
  }, [CAM_BBOX, PAD_M]);
  const q = await quiet(tag);
  const cam = await page.evaluate(() => ({ z: +window.__map.getZoom().toFixed(4),
    c: window.__map.getCenter().toArray().map(v => +v.toFixed(6)) }));
  const card = await page.evaluate(() => {
    const c = document.getElementById('wf-pill');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { text: c.innerText.replace(/\n+/g, ' | ').slice(0, 300),
      rect: [Math.floor(r.x) - 4, Math.floor(r.y) - 4, Math.ceil(r.right) + 4, Math.ceil(r.bottom) + 4] };
  });
  const cardText = card && card.text;
  await page.screenshot({ path: path.join(OUT, `r7-${tag}.jpg`), type: 'jpeg', quality: 74 });
  // the mask: the same camera with the walk off
  await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'none'); }, WALK_LAYERS);
  await page.waitForTimeout(QUIET_GAP_MS);
  const off = await grab(`${tag}-off`);
  await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'visible'); }, WALK_LAYERS);
  await page.waitForTimeout(QUIET_GAP_MS);
  const mask = await diff(q.still, off);
  fs.unlinkSync(off);
  console.log(`  ${tag}: ${answer.distM} m sets=${answer.sets} ways=${JSON.stringify(answer.ways)} ` +
    `dirs=${JSON.stringify(answer.dirs)}`);
  console.log(`     quiet after ${q.tries} try(s) (${q.n} px strict / ${q.n24} loose) | ` +
    `camera z=${cam.z} c=${JSON.stringify(cam.c)}`);
  console.log(`     walk mask ${mask.n} px strict (${mask.n24} loose) bbox ${JSON.stringify(mask.bbox)}`);
  console.log(`     card: ${cardText}`);
  return { tag, from, to, mult, answer, cam, cardText, cardRect: card && card.rect,
    still: q.still, quietPx: q.n,
    n: mask.n, n24: mask.n24, bbox: mask.bbox, bits: new Set(mask.bits) };
}

const A = await frame('A-CCJ-LTD-shipped', 'CCJ', 'LTD', null);
const B = await frame('B-LTD-CCJ-round6', 'LTD', 'CCJ', 1);
const C = await frame('C-LTD-CCJ-shipped', 'LTD', 'CCJ', null);

// A vs B as WHOLE PICTURES: if round 6 drew the same ribbon both ways, these
// two frames are the same photograph.
const CARD = [A, B, C].reduce((r, f) => [Math.min(r[0], f.cardRect[0]), Math.min(r[1], f.cardRect[1]),
  Math.max(r[2], f.cardRect[2]), Math.max(r[3], f.cardRect[3])], A.cardRect);
console.log(`\n  card rect excluded from the whole-frame diffs: ${JSON.stringify(CARD)}`);
const wholeAB = await diff(A.still, B.still, CARD);
const wholeAC = await diff(A.still, C.still, CARD);
const wholeBC = await diff(B.still, C.still, CARD);
for (const f of [A, B, C]) fs.unlinkSync(f.still);

const iou = (a, b) => { let i = 0; for (const p of a) if (b.has(p)) i++; return i / (a.size + b.size - i); };
const iAB = iou(A.bits, B.bits), iAC = iou(A.bits, C.bits), iBC = iou(B.bits, C.bits);
console.log(`\n  whole-frame diff  A~B ${wholeAB.n} px   A~C ${wholeAC.n} px   B~C ${wholeBC.n} px  (strict)`);
console.log(`  walk-mask IoU     A~B ${iAB.toFixed(3)}   A~C ${iAC.toFixed(3)}   B~C ${iBC.toFixed(3)}`);

const camSame = JSON.stringify(A.cam) === JSON.stringify(B.cam) && JSON.stringify(A.cam) === JSON.stringify(C.cam);
const pass = [];
pass.push(ok(camSame, 'ONE camera in all three frames', JSON.stringify(A.cam)));
pass.push(ok(A.n > MIN_WALK_PX && B.n > MIN_WALK_PX && C.n > MIN_WALK_PX,
  'the walk is on screen in every frame, proved by hiding it and diffing',
  `${A.n} / ${B.n} / ${C.n} px strict`));
pass.push(ok(wholeAB.n <= QUIET_PX,
  'ROUND 6 DREW THE SAME PHOTOGRAPH BOTH WAYS — A and B differ by no more than the scene does standing still',
  `${wholeAB.n} px vs a ${QUIET_PX} px floor`));
pass.push(ok(iAB >= SAME_IOU, '...and their walk masks are the same ribbon', `IoU ${iAB.toFixed(3)}`));
pass.push(ok(wholeAC.n > QUIET_PX && wholeBC.n > QUIET_PX && iAC < SAME_IOU && iBC < SAME_IOU,
  'ROUND 7 DOES NOT — C is a different picture and a different ribbon',
  `${wholeAC.n}/${wholeBC.n} px, IoU ${iAC.toFixed(3)}/${iBC.toFixed(3)}`));
pass.push(ok(A.answer.ways.includes(WAY) && B.answer.ways.includes(WAY) && !C.answer.ways.includes(WAY),
  `A and B walk way ${WAY}; C does not`,
  `${JSON.stringify(A.answer.ways)} / ${JSON.stringify(B.answer.ways)} / ${JSON.stringify(C.answer.ways)}`));
pass.push(ok(A.answer.dirs.includes('down') && B.answer.dirs.includes('up'),
  'and the card called the direction correctly both times: A down, B up',
  `${JSON.stringify(A.answer.dirs)} / ${JSON.stringify(B.answer.dirs)}`));
pass.push(ok(A.answer.distM === B.answer.distM && C.answer.distM > A.answer.distM,
  'the numbers agree with the pictures',
  `A ${A.answer.distM} = B ${B.answer.distM} < C ${C.answer.distM} m`));

fs.writeFileSync(path.join(OUT, 'frames7.json'), JSON.stringify({
  frames: [A, B, C].map(f => ({ ...f, bits: undefined, still: undefined })),
  wholeAB: wholeAB.n, wholeAC: wholeAC.n, wholeBC: wholeBC.n, iAB, iAC, iBC,
  DIFF_STRICT, QUIET_PX, QUIET_GAP_MS,
}, null, 1));
await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `clampcost.mjs` — The clamp watched refusing, and the stopwatch with its control.

```js
/**
 * clampcost.mjs — ROUND 7. The clamp, watched refusing; and what the pass costs.
 *
 * 1. THE CLAMP. `stairClimbMult()` never returns below 1, so no override can
 *    make a staircase CHEAPER than round 6 priced it and no override can turn
 *    the pass into one that pulls people ONTO stairs. Fed 0.2, 0.5, 0.99, NaN,
 *    'banana' and -3, the router must come back byte-identical to mult=1.
 *    And then the shipped setting, which must come back DIFFERENT — otherwise
 *    "identical" above is an instrument that cannot tell two censuses apart
 *    rather than a clamp that works.
 *
 * 2. THE COST. Interleaved reps, minimum of each, on a machine with sibling
 *    lanes running (CLAUDE.md rule 10). The pass adds no computeRoute call at
 *    all — it is three integer operations inside one Dijkstra relaxation — so
 *    the expectation is that the clock cannot see it, and the control is the
 *    point: a pair with NO tagged flight on it must move the same way the
 *    subject pair does, or the reading is machine noise.
 *
 *   node clampcost.mjs [pairs] [reps]
 */
import { open, ok } from './_r7lib.mjs';

const N = Number(process.argv[2] || 120);
const REPS = Number(process.argv[3] || 9);
const { browser, page } = await open();

async function census(mult) {
  return page.evaluate(async ([n, m]) => {
    window.WAYFIND.stairClimbCostMult = m;
    const g = await fetch('data/walk_graph.json').then(r => r.json());
    const codes = Object.keys(g.code);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = []; let tries = 0, pairs = 0;
    while (pairs < n && tries < n * 6) {
      tries++;
      const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
      if (a === b) continue;
      const f = await window.wayfindStairs(a, b, {});
      if (!f || !f.ok) continue;
      pairs++;
      const r = await window.wayfindStairs(b, a, {});
      for (const s of [f, r]) if (s && s.ok) out.push(`${s.from}>${s.to}|${s.distM.toFixed(3)}|${s.ways}`);
    }
    return out.join('\n');
  }, [N, mult]);
}

const base = await census(1);
console.log(`baseline (mult=1): ${base.split('\n').length} walks`);

const pass = [];
// `null` is NOT in this list: null is the documented "use stairUpMult" value.
// NaN is printed as its own name because JSON.stringify(NaN) is the string
// "null", which would read here as a claim about the wrong thing entirely.
const RUBBISH = [[0.2, '0.2'], [0.5, '0.5'], [0.99, '0.99'], [-3, '-3'],
  [NaN, 'NaN'], ['banana', '"banana"'], [0, '0'], [Infinity, 'Infinity']];
for (const [bad, label] of RUBBISH) {
  const c = await census(bad);
  pass.push(ok(c === base, `an override of ${label} is clamped to 1, not obeyed`,
    c === base ? 'identical' : 'DIFFERENT'));
}
const good = await census(null);
pass.push(ok(good !== base,
  '...and the instrument CAN tell two censuses apart — the shipped setting is not identical',
  `${good.split('\n').filter((l, i) => l !== base.split('\n')[i]).length} walks differ`));

// ── 2. the cost, interleaved, minimum of each ─────────────────────────────
// THE SUBJECT MUST DO THE SAME WORK IN BOTH CONFIGURATIONS or the clock is
// timing the answer, not the pass. The first cut used LTD>CCJ, whose whole
// point is that the answer CHANGES: at mult=1 it has a staircase, so
// wayfindStairs() runs a second avoid-stairs Dijkstra and a third to re-derive
// the claim; shipped, it has none and runs one. It read 9.18 ms "off" against
// 1.94 ms "on" — the pass making routing five times faster, which is not a
// thing that happens. CCJ>LTD is the same flight in the DESCENDING direction:
// its answer is byte-identical in both configurations, it traverses the tagged
// way, so `isClimb()` is evaluated on those edges and nothing else moves.
const SUBJECT = ['CCJ', 'LTD'];     // walks a tagged flight; answer unchanged
const CONTROL = ['BUR', 'SZB'];     // no tagged flight anywhere on it
const t = { subOn: [], subOff: [], conOn: [], conOff: [] };
for (let i = 0; i < REPS; i++) {
  for (const [key, pair, mult] of [
    ['subOff', SUBJECT, 1], ['subOn', SUBJECT, null],
    ['conOff', CONTROL, 1], ['conOn', CONTROL, null]]) {
    const ms = await page.evaluate(async ([p, m]) => {
      window.WAYFIND.stairClimbCostMult = m;
      await window.wayfindStairs(p[0], p[1], {});           // warm
      const t0 = performance.now();
      for (let k = 0; k < 5; k++) await window.wayfindStairs(p[0], p[1], {});
      return (performance.now() - t0) / 5;
    }, [pair, mult]);
    t[key].push(ms);
  }
}
const mn = (a) => +Math.min(...a).toFixed(2);
// and the control that the control needs: prove the two configurations really
// did produce the same answer on both pairs, or the times are incomparable.
const stable = await page.evaluate(async ([s, c]) => {
  const one = async (p, m) => {
    window.WAYFIND.stairClimbCostMult = m;
    const r = await window.wayfindStairs(p[0], p[1], {});
    return `${r.distM.toFixed(3)}|${r.ways}|${r.sets}|${r.stepFree ? 1 : 0}`;
  };
  return { sub: [await one(s, 1), await one(s, null)], con: [await one(c, 1), await one(c, null)] };
}, [SUBJECT, CONTROL]);
console.log(`\n  ${REPS} interleaved reps, 5 routes each, MINIMUM (sibling lanes were running):`);
console.log(`    ${SUBJECT.join('>')}  (walks a tagged flight)  off ${mn(t.subOff)} ms   on ${mn(t.subOn)} ms`);
console.log(`    ${CONTROL.join('>')}  (no tagged flight)       off ${mn(t.conOff)} ms   on ${mn(t.conOn)} ms`);
console.log(`    subject answer identical both ways: ${stable.sub[0] === stable.sub[1]}  (${stable.sub[0]})`);
console.log(`    control answer identical both ways: ${stable.con[0] === stable.con[1]}  (${stable.con[0]})`);
pass.push(ok(stable.sub[0] === stable.sub[1] && stable.con[0] === stable.con[1],
  'both timed pairs return the SAME answer in both configurations, so the clock is timing the pass',
  `${stable.sub[0]} / ${stable.con[0]}`));
console.log(`    subject drift ${(mn(t.subOn) - mn(t.subOff)).toFixed(2)} ms | ` +
  `control drift ${(mn(t.conOn) - mn(t.conOff)).toFixed(2)} ms — the control is the machine`);

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

---
---

# ROUND 8 — half of UT's table was never spent, and the half nobody spent is the half that says NO

Round 6 fetched `Celebrated_Entrances_view`, joined it to our doors, and moved
29 of 38 step-free endpoints onto the entrance UT publishes as barrier-free.
The rows in the same array marked `BarrierFree = N` — the ones whose own field
notes name the barrier — were used for exactly one thing: as the margin test
that stops the POSITIVE verdict guessing. Nothing has ever declined one, moved
off one, or said a word about one.

> *"The celebrated entrance for Gearing Hall is located on the south side.
> Access is off 24th Street UP THE STAIRS and through the courtyard."*
> — `Celebrated_Entrances_view`, GEA, `BarrierFree: N`

And this is the row that answers round 3's one open question against
Citymapper. §R17's table has a line in it that reads, in full:

| Citymapper, from the frame | us, at round 3 |
|---|---|
| sf3 — the label asserts the entrance itself is step-free | **we do not.** We verified the walk, not the door |

That was the honest answer for three rounds and it is not the honest answer any
more. For 24 of our doors somebody from UT has stood in front of the entrance
and written down a verdict. Round 8 spends both halves of it.

## R52. First: the 189 still hold, and rounds 4 and 7 reproduce to the digit

Re-run before a line was written, because every round of this lane is allowed
to be wrong about its own subject and none of them is allowed to break the one
before:

```
OSM highway=steps ways      : 189
drawn staircase polygons    : 180
distinct way ids drawn      : 189
OSM ways NOT drawn          : 0  []
drawn ids NOT in OSM        : 0  []

routes 300 | with stairs 132 | step-free offered 123 | no way round 9
 PASS  routes completed — 300 of 300
 PASS  no offered step-free walk TRAVERSES an OSM staircase — 0 dirty of 123
 PASS  no offered step-free walk lays a DOOR LEG over a drawn staircase — 0 dirty of 123
 PASS  every staircase the card states is one the walk comes within 1.5 m of — 0 routes
 PASS  every staircase the walk touches is stated by the card — 0 routes
 PASS  a staircase the router walks along is filed as climbed, not as a door leg — 0
 PASS  the leg list carries every staircase the router climbs — 0 bad of 300
```

`132 | 123 | 9` is round 7's census to the digit, and it is still `132 | 123 |
9` with everything below shipped. `harness-drift` PASS 31/31, no new `<script>`
in either page. `scripts/bake_ground.py` unchanged, as in rounds 2-7.
`WAYFIND.on` still false.

## R53. The join, run for the verdict it was never run for

Same function, same radius, same margin — literally the same function, because
`barrierFreeDoor()` and the new `barrieredDoor()` are now one parameterised
`utDoor(g, code, want)` and the two verdicts cannot drift apart by construction.

```
UT rows transcribed 66 over 51 buildings | Y 59  N 7
doors labelled 24  |  Y 22  N 2
   N  door 386  GEA @1.26 m (next opposite 25.5 m)  role=main  building has 2 doors
   N  door 512  PAR @0.93 m (next opposite 41.0 m)  role=main  building has 1 door
```

**Two positive controls, and neither is this round's own work.** The census
refuses to evaluate anything and exits 1 if either fails:

* **Round 6's two convictions come back out exactly** — GEA 386 and PAR 512,
  no more and no fewer. Round 6 named those two in prose while doing nothing
  with them; this reproduces them from the shipped transcription.
* **`docs/walk-baseline.md`'s 19 UT-verified doors, 19 of 19.** Another lane
  built that table from the same FeatureServer by a different method. If this
  join disagreed with it, it is this join that would be wrong.

The transcription is read out of `js/wayfind.js` itself rather than retyped, so
the instrument and the shipped code cannot hold different tables.

## R54. AND THE PRIOR QUESTION NOBODY HAD ASKED: can we even GET to UT's doors?

Round 6 asked whether the walk went to UT's barrier-free door where one exists.
It never asked whether a step-free walk can reach those doors at all — and a
door nothing can reach is a door round 6's pass can never move anybody onto.

`utreach.py` answers it in python, with no browser and nothing but
`data/walk_graph.json`: round 6's `reach.py` (step-free connected components,
`F_STEPS` priced Infinity and `F_OFFMAIN` skipped exactly as `dijkstra()` does)
and round 6's `anchdiag.py` (`legCrossesStairs()` re-implemented outside the
app) run together over all 24 labelled doors.

```
step-free components 597 | largest 10383 of 11284 nodes (92.0%)

  verdict door bldg  baked anchors            reachable  widened
    Y       323 CMB   452~,11040~,441~        no         NO
    Y       324 CMB   452~,11040~             no         NO
    N       386 GEA   1089~,10582!~,1095!     no         NO
    N       512 PAR   10283,325,10300         YES        -
    Y       636 WAG   10294~,10295!,908!      no         NO
    ...19 others, all YES
  ! = door leg lies along a mapped flight   ~ = not on the main step-free component

UT BARRIER-FREE doors reachable step-free from a BAKED anchor : 19 of 22
   ...of the rest, rescued by round 5's widened anchors       : 0 of 3
   ...unreachable step-free by any means this app has          : CMB 323, CMB 324, WAG 636
UT NOT-barrier-free doors the step-free profile can reach       : PAR 512
   ...and that it cannot reach anyway                           : GEA 386
```

Three things worth saying out loud about that table.

**It reproduces round 6's nine refusals from the outside.** Round 6 explained
them in prose — "CMB's barrier-free door has both anchors on a 16-node
step-free island", "WAG's is reachable only over a flight, 3.5 m and 2.0 m
along mapped steps". This is a different instrument, in a different language,
reading a different property, and it names the same three doors. That is the
strongest corroboration this lane has produced of anything.

**AND UT'S SURVEY AND OUR OWN GEOMETRY CONVICT THE SAME DOOR, INDEPENDENTLY.**
Gearing Hall's door 386 is the one UT says is up the stairs. It is also the one
whose only main-component anchor has its door leg lying *along* a mapped
flight, which is round 4's width test — written eighteen months of rounds
before anybody had heard of `Celebrated_Entrances_view`, from OSM geometry
alone. Two sources that share no code and no data agree that you cannot get a
wheelchair to Gearing Hall's celebrated entrance. Nineteen of 22 the same way
in the other direction.

**They disagree in exactly one place, and that place is the round.** Parlin
Hall's only door in the graph is 512, UT publishes it as not barrier-free, and
the step-free profile walks straight to it.

## R55. What was actually wrong, and it is a sentence not a route

Over round 4's 300 seeded pairs:

```
STEP-FREE OFFERS TOUCHING A DOOR UT PUBLISHES AS NOT BARRIER-FREE: 2
   ...where the building has another door in the graph : 0
   ...where it is the building's ONLY door             : 2
   PAR>GRE  starts at door 512 (PAR)   481 m  clean=true
   PAR>PAC  starts at door 512 (PAR)  1382 m  clean=true
(scale: ordinary walks touching one: 8 endpoints of 600)
```

Two of 123. Round 6 saw the same two — its own gate excused them with the
clause *"at a building that has another door at all"*, and filed the rest under
somebody else's missing data. Parlin's barrier-free entrance is real; UT
describes it as *"down a ramp accessed from the northwest corner"*; it is
simply not in `data/entrances.geojson`. **The missing door is somebody else's
file. The green tick is ours.** A person who cannot climb stairs asked this app
for a step-free walk to Parlin Hall, and got one, and UT's own survey says the
door at the end of it is up a flight.

### The fix, in two halves, and only one of them can move anybody

`stepFreeRoute()` gains a fifth pass, after round 6's fourth, on a route that
already has a clean step-free answer.

1. **Leave by a door UT has not convicted, if the building has one.** Baked
   anchors first, then round 5's widened ones — and the second half is not
   optional: at the one building where this pass has anywhere to go, the door
   it wants (Gearing Hall's 387) has *no baked anchor a step-free walk can
   use*. The first cut of this pass tried baked anchors only, moved nobody, and
   said so in a log line rather than in a green assertion, which is how it was
   caught. `r` is only ever replaced by a candidate that is itself ok, clean and
   within `stairBarrierDoorSlackM`, so no offer can become a refusal and round
   6's door choice cannot be undone — a door UT publishes as barrier-free is by
   construction never one it convicts.
2. **Where it has nowhere to go, say so.** `doorBarriered` carries the door,
   the building, which end of the walk it is, and whether it is the building's
   only door — recomputed against the route actually being returned, so it is a
   statement about the answer and not about an earlier draft of it.

**And the sentence Citymapper has and we did not.** `doorBarrierFree` names the
ends sitting on a door UT publishes *as* barrier-free — sf3's
`Best Step-Free Entrance`, which §R17 said we could not honestly print. **25 of
123 offers carry it.** It changes no route; it only names what the walk already
chose, and it is only ever set where UT has surveyed the door.

Both fields are on the offer object AND on `wayfindStairs()`'s verification
surface, because a census that cannot see them cannot hold the code to them.

### The routing half fires ZERO times today, and that is the finding

`gea.mjs` drives every routable code against Gearing Hall, both directions,
four configurations:

```
round-4 leg test, §8a off      walks 308 | on door 386   0 | on 387 308 | moved 0
round-4 leg test, §8a ON       walks 308 | on door 386   0 | on 387 308 | moved 0
rounds 1-3 leg test, §8a off   walks 304 | on door 386 304 | on 387   0 | moved 0
rounds 1-3 leg test, §8a ON    walks 304 | on door 386   0 | on 387 304 | moved 304
 PASS  SHIPPED: the step-free profile never reaches the convicted door anyway
 PASS  CONTROL: with round 4 turned off the convicted door comes back within reach
 PASS  ...and §8a is then the only thing that takes them off it
 PASS  every walk it moved is still verified step-free — 304 of 304
 PASS  the pass never turned a walk into a refusal — 304 -> 304
```

An untested branch is a branch that does not work, so the control is the point
of that table: `stairLegOverlapMinM = Infinity` is round 4's own documented
switch back to rounds 1-3, it puts door 386 within reach again, and §8a then
moves all 304 walks off it — for **-8,614 m**, i.e. the accessible door is also
the nearer one, median 28 m nearer, and not one walk got longer.

On the SHIPPED build the pass is a no-op, because round 4's door-leg width test
already keeps every step-free walk off that door. It is kept anyway: it costs
nothing measurable (§R58), it is the only thing standing there if a re-bake
moves an anchor, and it is what makes the negative half of UT's table mean
something in the router rather than only in a doc.

## R56. AND THE OTHER QUESTION ROUND 5 LEFT OPEN, WHICH TURNED OUT TO BE A NO

Round 5's widened anchors fire only as a rescue — only when the first two
passes cannot produce a clean walk at all. That left the obvious question
unasked for three rounds: when the ordinary passes DO succeed, is the walk they
found the shortest step-free walk between those two doors, or just the shortest
one reachable from at most three baked anchors?

It is the second. It also barely matters, and **that is the answer, not an
excuse for not shipping.** `stairAltShortcut` is built, works, and is OFF.

The pass is pinned to the doors the passes above already chose, so every door
decision survives it by construction; it is accepted only if it is itself clean
and shorter by more than `stairAltShortcutMinM`. Swept over the same 300 pairs:

```
   min    offered  refused  shortened   metres saved   max   median
    0.001      123        9         55            292     63       3
        1      123        9         44            281     63       3
        5      123        9         14            206     63      13
       10      123        9          8            167     63      14
       15      123        9          3            101     63      22
       25      123        9          1             63     63      63
      100      123        9          0              0      0       0
   100000      123        9          0              0      0       0
```

**292 m of 130,596 at an unbounded margin — 0.22 %, median 3 m, and exactly one
walk in 123 gains more than 25 m.** Offers stay at 123 and refusals at 9 at
EVERY rung, unbounded included, so the pass genuinely cannot take a walk away
from anybody. The A/B at the shipped 15 m:

```
walks shorter 3 | longer 0 | identical 120 | door moved 0
metres saved 101 of 130,596 (0.08%), worst single walk 63 m
   GLT>HDB  1341 -> 1278 m   JGB>HRH  773 -> 751 m   BEL>UPB  594 -> 578 m
 PASS  no step-free walk got LONGER — 0 of 123
 PASS  the pass offered exactly the same walks — 123 vs 123
 PASS  the pass refused exactly the same walks — 9 vs 9
 PASS  no door changed — every door decision above §8b survives it — 0 of 123
 PASS  every walk it moved somebody onto is still verified step-free — 123 of 123
```

**And it costs a third of the Dijkstras.** 772 `computeRoute` calls over 300
pairs becomes 1,018, +31.9 %, and +2.5 ms on a control pair whose answer is
byte-identical in both configurations — so that is real cost and not the five
sibling agents. There is no cheap gate to hang it on either: only **1 of the 3**
walks that gain more than 15 m has an anchor `cleanAnchors()` refused, so "look
only where a door lost an anchor" predicts nothing.

A third of the work for 0.08 % of the metres is a bad trade, and the honest
report is the one this lane would want from somebody else: **`bake_walk.py`'s
three anchors per door were already right.** One line turns it on.

## R57. §R50, MADE — the card said "down the steps" and the clock charged for the climb

Round 7 taught the ROUTER which way a flight goes and wrote the matching patch
for the arithmetic out in §R50 rather than making it, on the grounds that four
sibling lanes were in this file. `measure()` and `timeRange()` ARE the cost
model — §3, every constant in them a cost constant — and neither open sibling
PR touches them or the accumulator they feed, checked before touching either.
So it is made.

`measure()` now splits the descent out using `leg.nodes[i]`, the same node
`stairLegs()` uses to print the sentence, and `timeRange()` charges
`stairUpMult` only to metres that are not KNOWN to be downhill. **Silence is
still billed as a climb** — the worst case is a fair assumption about a flight
nobody has surveyed; it is not a fair assumption about one this very card has
just called a descent. Driven over the same 300 pairs BOTH WAYS, because
direction is the whole subject:

```
walks driven 600 (both directions of 300 seeded pairs)
   with a mapped DESCENT on them            : 33
   descending a known flight and climbing 0 : 33
   with a mapped CLIMB on them              : 23
seconds of climbing that does not happen, taken off the HIGH end: 603.0 s, worst 40.0 s

printed bands that CHANGED: 8 of 600 walks (high end 8, low end 0)
   PAC>BME   1028 m   13-18 min -> 13-17 min   descends 48.7 m, climbs 0 m
   CBA>SJG    759 m   10-14 min -> 10-13 min   descends 50.6 m, climbs 0 m
   TMM>GWB    821 m   11-15 min -> 11-14 min   descends 57.1 m, climbs 0 m
   ...5 more
 PASS  the census contains walks that descend a KNOWN flight — 33 of 600
 PASS  no printed band got WIDER — the fix can only ever remove a climb — 0 of 8
 PASS  the optimistic low end is untouched — it never billed a climb — 0 of 600
 PASS  every band that moved belongs to a walk OSM says goes DOWN — 8 bands
 PASS  the printed band is still a band, never a point — 600 of 600
 PASS  a walk with no tagged descent is byte-identical to round 7 — 567 walks
```

`stairDownDiscount: false` restores round 7's clock exactly and is the A/B every
number above is quoted against.

### The frames, and one of them was true and unreadable at the same time

ONE page load, quiet gate before every shot, `?walk=1&intro=0&drift=0`,
`cancelGraphicsAutoDetect()`, veil waited out.

| file | what it shows |
|---|---|
| `shots/walk/stairs/r8-A1-clock-round7.jpg` | PAC>BME, round 7's clock: **`13-18 min walk · 1.0 km · Stairs: 1 set`** |
| `shots/walk/stairs/r8-A2-clock-round8.jpg` | identical camera, identical walk, one constant flipped: **`13-17 min`** |
| `shots/walk/stairs/r8-B1-door386-round7-crop.png` | Gearing Hall, the walk ending at door **386** — UT: *up the stairs* |
| `shots/walk/stairs/r8-B2-door387-round8-crop.png` | same camera, §8a on: it ends at **387** instead |

Frame A is the cleanest pixel result this lane has produced: **94 px differ
inside the card and 0 px differ anywhere else in the picture**, against a quiet
floor the same instrument measured at 0. The walk is 1,028 m in both — this is
the clock, not the router.

Frame B needed three cuts and both failures are worth writing down.

* **A frame can be true and unreadable at once.** The first cut fitted at zoom
  18 and reported 3,751 changed pixels when the walk layers were hidden — a
  correct measurement of a route that a human being cannot see, because a warm
  white 1.6 m ribbon on tan ground is invisible at that scale and
  `wayfind-thread`, the line that actually reads at a glance, is faded out
  above `threadFadeZoom` 17.2 and gone by 18.4. Capped at zoom 17 the route is
  a line anybody can follow. That is the house's own *"visible in the DOM is
  not visible on camera"*, in pixels.
* **`fitBounds` does not give you the pitch you ask for.** Passing `pitch: 0`
  came back oblique, which puts the ground you aimed at near the bottom edge:
  the frame was aimed at Gearing Hall and returned a picture of Norman
  Hackerman Building with Gearing off the bottom. The fit now picks the zoom
  and the camera is then set outright, and the pose is re-read AT THE SHUTTER
  and printed, not at the moment it was requested.
* **And the first version claimed a difference smaller than its own noise.** It
  passed a quiet gate at 820 px of residual motion and then reported a 73 px
  difference. The gate is 200 px now — round 7's 1,500 is the allowance for a
  whole city settling after a page load, and this file loads the page once —
  and both frames reach 0.

With that fixed: the ribbon is 2,458 px and 2,404 px against a measured 0 px
quiet floor in the two frames, and the two pictures differ by 114 px in a
12x61 px band right at the door. Small, because 25 m of a 590 m walk is small.
The crops are there so it can be seen rather than taken on trust.

## R58. What it costs

The structural number first, because five sibling agents drive browsers on this
machine and the clock reads the neighbours — round 6 and round 7 both threw a
stopwatch out for exactly that.

```
computeRoute calls over the same 300 seeded pairs:
   round 7 (8a off, 8b off)     772
   round 8a only                772  (+0, 0.0%)
   round 8b only               1018  (+246, +31.9%)
   round 8 shipped              772  (+0, 0.0%)
```

**§8a is free.** It only ever runs on a route with a convicted door at an end —
2 of 300 — and at Parlin there is no other door to try, so it makes no extra
call at all. `doorBarrierFree` costs one memoised map lookup per end.
§R57 is arithmetic on numbers `measure()` was already walking.

§8b's +31.9 % is why it is off (§R56).

## R59. Where the doubt is, stated rather than buried

* **The negative half of UT's table is THIN and this round does not pretend
  otherwise.** 7 rows of 66 carry `BarrierFree = N` with coordinates, and only
  2 survive the 8 m / 2x join. ECJ is refused on the margin — UT's accessible
  and inaccessible entrances there are 17 m and 37 m from the same door of ours
  — and refusing it is right, but it means a real N verdict is being dropped
  for want of a door we can pin it to.
* **A door with no N label is not thereby accessible. It is unsurveyed.** 24 of
  656 doors carry any verdict at all. Everything this round says is about those
  24 and nothing else, and the card must never round that up.
* **PAR 512 still gets a step-free offer.** The walk to it is verified
  step-free and the door at the end of it is not, and both halves are now on
  the answer object. Withholding the offer was considered and rejected: UT
  publishes a ramp at Parlin's northwest corner, so *"there is no step-free way
  to Parlin Hall"* would be a second false sentence, and round 5 is this lane's
  own evidence that a false refusal is as bad as a false promise. The honest
  answer is the walk plus the caveat, and the caveat needs the card.
* **THE CARD DOES NOT PRINT EITHER SENTENCE YET.** `stairsSection()` is the UI
  lane's function this round and its branch is +1,881 lines in this same file;
  writing into it would be picking a fight with work in flight. §R60 has the
  patch, and until it lands `doorBarriered` is a fact in an object rather than
  a sentence on a screen. That is the biggest single thing wrong with round 8
  and it is stated here rather than buried.
* **`utreach.py` implements only the parallel half of `legCrossesStairs()`**
  (round 5's `anchdiag.py` did too). It is therefore a LOWER bound on dropped
  anchors: a door leg that genuinely crosses a flight at an angle is not
  counted, so 19 of 22 could only ever get worse, never better.
* **Round 1 §5a and §5b, round 3 §R15, round 4 §R23, round 5 §R32 and round 7
  §R49's 150 direction-blind flights all still stand unmade.** §R50 is made
  (§R57); the rest are other lanes' files.
* **`scripts/bake_ground.py` is unchanged this round**, as in rounds 2-7, and
  round 1's fix re-verified at 189 of 189 first.

## R60. A PATCH FOR THE CARD — NOT THIS LANE'S FUNCTION

Everything it needs is on the object `stairsSection()` is already handed. Two
sentences, and the negative one must never be softened into the positive one.

```js
    // ROUND 8 §R55. UT has surveyed this entrance and published a verdict.
    // The POSITIVE sentence is Citymapper's `Best Step-Free Entrance` (sf3),
    // and it is only ever printed where UT has actually stood in front of the
    // door — 24 of 656 doors. The NEGATIVE one is the one that matters: it is
    // UT saying, in prose, that the entrance is up a flight of steps, on a
    // walk this card is about to call step-free.
    if (alt.doorBarrierFree) {
      for (const d of alt.doorBarrierFree) {
        row(card, 'wf-stepfree',
          d.end === 'end' ? 'Arrives at the barrier-free entrance UT lists.'
                          : 'Leaves by the barrier-free entrance UT lists.');
      }
    }
    if (alt.doorBarriered) {
      for (const d of alt.doorBarriered) {
        row(card, 'wf-nostepfree',
          (d.end === 'end' ? 'Ends at ' : 'Starts at ') +
          placeName(g, d.code) + ', which UT lists as NOT barrier-free' +
          (d.only ? ' — and it is the only entrance we have for it.' : '.'));
      }
    }
```

`.wf-nostepfree` already exists in `STAIRS_CSS` and is already the warning
colour. The negative row must come SECOND and must not be suppressed by the
positive one: a walk can leave by a surveyed accessible door and arrive at a
convicted one, and both facts belong on the card.

## R61. The instruments, written out

Save these beside `lib.mjs` from §R27 (`PORT` defaulted to 8813), run
`npm install playwright-core`, start `python scripts/serve.py 8813`:

```bash
python drawn189.py /path/to/repo            # 189 of 189, before anything
python bfneg.py   /path/to/repo             # the join, both verdicts, no browser
python utreach.py /path/to/repo             # THE PRIOR QUESTION. §R54.
REPO_ROOT=/path/to/repo node gate.mjs 300   # round 4's seven, on the round-8 build
REPO_ROOT=/path/to/repo node bfneg.mjs 300  # §8a's census, five assertions
REPO_ROOT=/path/to/repo node gea.mjs --all  # §8a's other branch, with its control
node shortcut.mjs 300                       # §8b's A/B
node shortcut.mjs 300 --curve               # ...and the curve it is OFF because of
node gate8b.mjs                             # the precondition that does not exist
node clock8.mjs 300                         # §R57, both directions
node cost8.mjs 300 9                        # calls first, then the clock
node frames8.mjs ./frames8                  # the four pictures
python flagmix.py /path/to/repo             # what the flag byte actually asserts
```

`scripts/verify/` is still not this lane's directory, so the sources are below
rather than there.

### `bfneg.py`

The join in python, both verdicts, no browser and nothing but the repo.

```python
"""bfneg.py — ROUND 8. The NEGATIVE half of UT's entrance survey.

Round 6 joined UT's `Celebrated_Entrances_view` rows with `BarrierFree = Y`
to our doors and moved the step-free walk onto them. The rows with
`BarrierFree = N` -- the ones whose own field notes say "up the stairs" --
were used only as the margin test and never as a verdict.

This asks the other question with the SAME join, the same radius and the same
margin: which of our doors is a door UT has surveyed and published as NOT
barrier-free?

Run:  python bfneg.py <repo-root>
"""
import json, io, re, math, sys
from collections import defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
MATCH_M = 8.0      # WAYFIND.stairBarrierFreeMatchM
MARGIN_X = 2.0     # WAYFIND.stairBarrierFreeMarginX


def load_rows(root):
    src = io.open(root + '/js/wayfind.js', encoding='utf-8').read()
    m = re.search(r'const UT_ENTRANCES = \[(.*?)\n  \];', src, re.S)
    rows = re.findall(r"\['([A-Z0-9]+)',(-?[\d\.]+),([\d\.]+),(\d)\]", m.group(1))
    return [(a, float(b), float(c), int(d)) for a, b, c, d in rows]


def metres(a, b):
    R = 6371000.0
    la = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(b[0] - a[0]) * math.cos(la) * R
    dy = math.radians(b[1] - a[1]) * R
    return math.hypot(dx, dy)


def main():
    rows = load_rows(ROOT)
    g = json.load(io.open(ROOT + '/data/walk_graph.json', encoding='utf-8'))
    q, d, code = g['q'], g['d'], g['code']
    print('UT rows transcribed  : %d  (bf=Y %d, bf=N %d)' % (
        len(rows), sum(1 for r in rows if r[3] == 1), sum(1 for r in rows if r[3] == 0)))
    print('bf=N rows            : %s' % ', '.join(
        '%s %.6f,%.6f' % (r[0], r[1], r[2]) for r in rows if r[3] == 0))

    byc = defaultdict(list)
    for r in rows:
        byc[r[0]].append(r)

    convict, bfree = {}, {}
    for c, entry in code.items():
        rs = byc.get(c)
        if not rs:
            continue
        for di in entry:
            p = (d[di][0] * q, d[di][1] * q)
            near = min(((metres(p, (r[1], r[2])), r[3]) for r in rs), key=lambda t: t[0])
            opp = min([metres(p, (r[1], r[2])) for r in rs if r[3] != near[1]] or [float('inf')])
            if near[0] > MATCH_M or opp < near[0] * MARGIN_X:
                continue
            anch = len(d[di][2]) if d[di][2] else 0
            rec = (di, round(near[0], 1), (round(opp, 1) if opp < 1e9 else None),
                   d[di][4], anch)
            (convict if near[1] == 0 else bfree).setdefault(c, []).append(rec)

    print()
    print('DOORS UT PUBLISHES AS **NOT** BARRIER-FREE  (<=%.0f m, %.0fx margin)' % (MATCH_M, MARGIN_X))
    print('  code  door  dist  opp   role     anchors')
    n = 0
    for c, v in sorted(convict.items()):
        for di, m1, m2, role, anch in v:
            print('  %-4s  %4d  %4.1f  %-5s %-8s %d' % (c, di, m1, ('%.1f' % m2) if m2 else '-', role, anch))
            n += 1
    print('  total %d doors over %d buildings' % (n, len(convict)))
    print()
    print('positive control (round 6): bf doors %d over %d buildings' % (
        sum(len(v) for v in bfree.values()), len(bfree)))
    for c in sorted(convict):
        print('  %-4s has a bf door too: %s' % (c, bfree.get(c, 'NO')))


main()
```

### `utreach.py`

**THE PRIOR QUESTION.** Round 6's `reach.py` and `anchdiag.py` run together over
all 24 labelled doors: can a step-free walk get to the entrances UT surveyed?

```python
"""utreach.py — ROUND 8. UT publishes an entrance as barrier-free. Can a
step-free walk on OUR graph actually get to it?

Round 6 asked whether the walk went to UT's barrier-free door where one
existed and moved 29 of 38 endpoints onto it. It never asked the prior
question: of the doors UT has surveyed and published a verdict for, how many
can this app's step-free profile reach AT ALL? A door nobody can reach
step-free is a door round 6's pass can never move anybody onto, and that is
the whole of the nine refusals it could not explain away.

This is reach.py (round 6) and anchdiag.py (round 6) run together over the
join, in python, against data/walk_graph.json only. Nothing in the browser.

    python utreach.py <repo-root>
"""
import json, io, os, sys, math, re
from collections import defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
F_STEPS, F_OFFMAIN = 1, 128
HALF_W = 1.5          # WAYFIND.stairLegHalfWidthM
OVERLAP_MIN = 1.5     # WAYFIND.stairLegOverlapMinM
PAR_DEG = 20          # WAYFIND.stairLegParallelDeg
WIDE_R = 20.0         # WAYFIND.stairAltWideRadiusM
LEG_SAMPLE_DIV = 6
UT_MATCH_M, UT_MARGIN = 8.0, 2.0
MPD_LON, MPD_LAT = 96061, 111195

g = json.load(io.open(os.path.join(ROOT, 'data/walk_graph.json'), encoding='utf-8'))
Q = g['q']
X, Y = [], []
ax = ay = 0
for dx, dy in zip(g['n']['x'], g['n']['y']):
    ax += dx
    ay += dy
    X.append(ax * Q)
    Y.append(ay * Q)
N = len(X)
E = len(g['e']['a'])
A, B = [], []
a = 0
for i in range(E):
    a += g['e']['a'][i]
    A.append(a)
    B.append(a + g['e']['b'][i])
F, W, S = g['e']['f'], g['e']['w'], g['e']['s']
D, CODE = g['d'], g['code']


def mdist(p, q):
    return math.hypot((p[0] - q[0]) * MPD_LON, (p[1] - q[1]) * MPD_LAT)


# ── the step-free component structure of the app's own graph (reach.py) ────
adj = [[] for _ in range(N)]
for i in range(E):
    if F[i] & F_OFFMAIN or F[i] & F_STEPS:
        continue
    adj[A[i]].append(B[i])
    adj[B[i]].append(A[i])
comp = [-1] * N
sizes = []
for s in range(N):
    if comp[s] != -1:
        continue
    k = len(sizes)
    stack = [s]
    comp[s] = k
    n = 0
    while stack:
        u = stack.pop()
        n += 1
        for v in adj[u]:
            if comp[v] == -1:
                comp[v] = k
                stack.append(v)
    sizes.append(n)
MAIN = sizes.index(max(sizes))
print('step-free components %d | largest %d of %d nodes (%.1f%%)'
      % (len(sizes), max(sizes), N, 100.0 * max(sizes) / N))

# ── legCrossesStairs()'s parallel half (anchdiag.py) ───────────────────────
steps = [(A[i], B[i]) for i in range(E) if F[i] & F_STEPS]
COS = math.cos(PAR_DEG * math.pi / 180)


def m2(p, q):
    return ((p[0] - q[0]) * MPD_LON, (p[1] - q[1]) * MPD_LAT)


def seg_overlap(p1, p2, c, d, r):
    ux, uy = m2(p2, p1)
    L = math.hypot(ux, uy)
    if L == 0:
        return 0.0
    n = max(1, int(math.ceil(L / (r / LEG_SAMPLE_DIV))))
    step = L / n
    vx, vy = m2(d, c)
    vv = vx * vx + vy * vy
    tot = 0.0
    for i in range(n + 1):
        t = i / n
        px = p1[0] + (p2[0] - p1[0]) * t
        py = p1[1] + (p2[1] - p1[1]) * t
        wx, wy = m2((px, py), c)
        s = 0.0 if vv == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / vv))
        qx = c[0] + (d[0] - c[0]) * s
        qy = c[1] + (d[1] - c[1]) * s
        ex, ey = m2((px, py), (qx, qy))
        if math.hypot(ex, ey) <= r:
            tot += step
    return tot


def parallel(p1, p2, c, d):
    ux, uy = m2(p2, p1)
    vx, vy = m2(d, c)
    lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
    if lu == 0 or lv == 0:
        return False
    return abs((ux * vx + uy * vy) / (lu * lv)) >= COS


def leg_dirty(dll, nll):
    for (u, v) in steps:
        p, q = (X[u], Y[u]), (X[v], Y[v])
        if min(p[0], q[0]) - 0.001 > max(dll[0], nll[0]):
            continue
        if max(p[0], q[0]) + 0.001 < min(dll[0], nll[0]):
            continue
        if min(p[1], q[1]) - 0.001 > max(dll[1], nll[1]):
            continue
        if max(p[1], q[1]) + 0.001 < min(dll[1], nll[1]):
            continue
        if not parallel(dll, nll, p, q):
            continue
        if seg_overlap(dll, nll, p, q, HALF_W) >= OVERLAP_MIN:
            return True
    return False


# ── the join, from the transcription in the shipped file ──────────────────
src = io.open(os.path.join(ROOT, 'js/wayfind.js'), encoding='utf-8').read()
blk = re.search(r'const UT_ENTRANCES = \[(.*?)\n  \];', src, re.S).group(1)
rows = [(m[0], float(m[1]), float(m[2]), int(m[3]))
        for m in re.findall(r"\['([A-Z0-9]+)',(-?[\d\.]+),([\d\.]+),(\d)\]", blk)]
byc = defaultdict(list)
for r in rows:
    byc[r[0]].append(r)

LABEL, WHY = {}, {}
for c, entry in CODE.items():
    rs = byc.get(c)
    if not rs:
        continue
    for di in entry:
        p = (D[di][0] * Q, D[di][1] * Q)
        near = min(((mdist(p, (r[1], r[2])), r[3]) for r in rs), key=lambda t: t[0])
        opp = min([mdist(p, (r[1], r[2])) for r in rs if r[3] != near[1]] or [1e18])
        if near[0] > UT_MATCH_M or opp < near[0] * UT_MARGIN:
            continue
        LABEL[di] = 'Y' if near[1] == 1 else 'N'
        WHY[di] = (c, near[0])

print('UT rows %d | doors labelled %d (Y %d, N %d)'
      % (len(rows), len(LABEL), sum(1 for v in LABEL.values() if v == 'Y'),
         sum(1 for v in LABEL.values() if v == 'N')))

# ── the question ──────────────────────────────────────────────────────────
grid = defaultdict(list)
CELL = 0.0006
for i in range(N):
    grid[(int(X[i] / CELL), int(Y[i] / CELL))].append(i)


def wide_ok(dll):
    """round 5's widened anchor: any node within WIDE_R on the main step-free
    component whose straight leg is clean."""
    dlon, dlat = WIDE_R / MPD_LON, WIDE_R / MPD_LAT
    best = None
    cand = []
    for cx in range(int((dll[0] - dlon) / CELL), int((dll[0] + dlon) / CELL) + 1):
        for cy in range(int((dll[1] - dlat) / CELL), int((dll[1] + dlat) / CELL) + 1):
            for i in grid.get((cx, cy), ()):
                m = mdist(dll, (X[i], Y[i]))
                if m <= WIDE_R:
                    cand.append((m, i))
    cand.sort()
    for m, i in cand[:40]:
        if comp[i] != MAIN:
            continue
        if leg_dirty(dll, (X[i], Y[i])):
            continue
        best = (i, m)
        break
    return best


print('')
print('  verdict door bldg  baked anchors                       reachable  widened')
rowsout = []
for di in sorted(LABEL):
    d = D[di]
    dll = (d[0] * Q, d[1] * Q)
    parts, good = [], False
    for nd in (d[2] or []):
        nll = (X[nd], Y[nd])
        dirty = leg_dirty(dll, nll)
        island = comp[nd] != MAIN
        okk = (not dirty) and (not island)
        good = good or okk
        parts.append('%d%s%s' % (nd, '!' if dirty else '', '~' if island else ''))
    w = None if good else wide_ok(dll)
    rowsout.append((LABEL[di], di, WHY[di][0], good, w))
    print('    %-6s %4d %-5s %-34s %-10s %s'
          % (LABEL[di], di, WHY[di][0], ','.join(parts) or '(none)',
             'YES' if good else 'no',
             '-' if good else ('node %d @%.1f m' % w if w else 'NO')))

print('')
print('  ! = door leg lies along a mapped flight (dropped by cleanAnchors)')
print('  ~ = anchor is not on the main step-free component')
Yr = [r for r in rowsout if r[0] == 'Y']
Nr = [r for r in rowsout if r[0] == 'N']
print('')
print('UT BARRIER-FREE doors reachable step-free from a BAKED anchor : %d of %d'
      % (sum(1 for r in Yr if r[3]), len(Yr)))
print('   ...of the rest, rescued by round 5\'s widened anchors      : %d of %d'
      % (sum(1 for r in Yr if not r[3] and r[4]), sum(1 for r in Yr if not r[3])))
print('   ...unreachable step-free by any means this app has         : %s'
      % ', '.join('%s %d' % (r[2], r[1]) for r in Yr if not r[3] and not r[4]) or 'none')
print('UT NOT-barrier-free doors the step-free profile can reach      : %s'
      % ', '.join('%s %d (%s)' % (r[2], r[1], 'baked' if r[3] else 'widened only')
                  for r in Nr if r[3] or r[4]) or 'none')
print('   ...and that it cannot reach anyway                          : %s'
      % ', '.join('%s %d' % (r[2], r[1]) for r in Nr if not r[3] and not r[4]) or 'none')
```

### `bfneg.mjs`

**THE GATE for §8a.** The join, its two positive controls, and five assertions.

```js
/**
 * bfneg.mjs — ROUND 8. The NEGATIVE half of round 6's join.
 *
 * Round 6 asked "does UT publish a barrier-free entrance for this building,
 * and are we using it?" and moved 29 of 38 endpoints onto one. It also had the
 * other half of the same table in its hands the whole time — the rows UT
 * publishes as BarrierFree = N, whose own field notes name the barrier ("up
 * the stairs") — and used them ONLY as the margin test for the positive
 * verdict. Nothing has ever refused, moved off, or even mentioned a door UT
 * itself says is up a flight of steps.
 *
 * This is round 6's join, run for the N verdict, over round 4's 300 seeded
 * pairs, and asking one question: does the app hand somebody a green
 * "step-free" walk that ENDS at a door UT publishes as not barrier-free?
 *
 *   node bfneg.mjs [pairs] [--off]
 *
 * --off turns round 8's pass off in the page (WAYFIND.stairBarrierDoor=false)
 * and is the A/B every number is quoted against.
 *
 * The UT rows come from the TRANSCRIPTION already in js/wayfind.js, not from
 * a fetched cache, so this runs with nothing but the repo. The transcription
 * is trusted only because it reproduces two independent things first: round
 * 6's two convictions (GEA 386, PAR 512) and docs/walk-baseline.md's 19
 * UT-verified doors, built by another lane by another method.
 */
import fs from 'node:fs';
import { open, ok } from './lib.mjs';

const ROOT = process.env.REPO_ROOT || process.cwd();
const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const OFF = process.argv.includes('--off');

const UT_MATCH_M = Number(process.env.UT_MATCH_M || 8);
const UT_MARGIN = Number(process.env.UT_MARGIN || 2.0);

const MPD_LON = 96061, MPD_LAT = 111195;
const mBetween = (a, b) => Math.hypot((a[0] - b[0]) * MPD_LON, (a[1] - b[1]) * MPD_LAT);

const graph = JSON.parse(fs.readFileSync(`${ROOT}/data/walk_graph.json`, 'utf8'));
const D = graph.d, CODE = graph.code;
const dll = (i) => [D[i][0] * 1e-6, D[i][1] * 1e-6];

// ── the transcription, read out of the shipped file rather than retyped ────
const src = fs.readFileSync(`${ROOT}/js/wayfind.js`, 'utf8');
const block = src.match(/const UT_ENTRANCES = \[([\s\S]*?)\n {2}\];/)[1];
const ROWS = [...block.matchAll(/\['([A-Z0-9]+)',(-?[\d.]+),([\d.]+),(\d)\]/g)]
  .map(m => ({ code: m[1], ll: [Number(m[2]), Number(m[3])], bf: Number(m[4]) }));
const byBldg = new Map();
for (const r of ROWS) {
  if (!byBldg.has(r.code)) byBldg.set(r.code, []);
  byBldg.get(r.code).push(r);
}
console.log(`UT rows transcribed ${ROWS.length} over ${byBldg.size} buildings ` +
  `| Y ${ROWS.filter(r => r.bf === 1).length}  N ${ROWS.filter(r => r.bf === 0).length}`);

const LABEL = new Map(), WHY = new Map();
for (const [c, rows] of byBldg) {
  for (const di of (CODE[c] || [])) {
    const near = rows.map(r => ({ m: mBetween(dll(di), r.ll), r })).sort((a, b) => a.m - b.m);
    const best = near[0];
    if (best.m > UT_MATCH_M) continue;
    const opp = near.slice(1).find(x => x.r.bf !== best.r.bf);
    if (opp && opp.m < best.m * UT_MARGIN) continue;
    LABEL.set(di, best.r.bf === 1 ? 'Y' : 'N');
    WHY.set(di, { code: c, m: +best.m.toFixed(2), next: opp ? +opp.m.toFixed(1) : null,
      role: D[di][4], siblings: (CODE[c] || []).length });
  }
}
const labN = [...LABEL].filter(([, v]) => v === 'N').map(([i]) => i);
const labY = [...LABEL].filter(([, v]) => v === 'Y').map(([i]) => i);
console.log(`doors labelled ${LABEL.size}  |  Y ${labY.length}  N ${labN.length}`);
for (const di of labN) {
  const w = WHY.get(di);
  console.log(`   N  door ${di}  ${w.code} @${w.m} m (next opposite ${w.next ?? '—'} m)  ` +
    `role=${w.role}  the building has ${w.siblings} door(s) in the graph`);
}

// ── POSITIVE CONTROLS. Two, and neither is this round's own work. ──────────
const CONTROL6 = [386, 512];                 // round 6's two convictions
const c6 = CONTROL6.every(di => LABEL.get(di) === 'N') && labN.length === CONTROL6.length;
const CONTROL = [['BUR', 306], ['ECJ', 362], ['EER', 363], ['GAR', 377],
  ['GDC', 382], ['JES', 435], ['MAI', 463], ['MEZ', 481], ['NHB', 499],
  ['PAI', 509], ['PAT', 513], ['PCL', 518], ['PHR', 521], ['PMA', 526],
  ['RLP', 545], ['SZB', 594], ['UTC', 627], ['WAG', 636], ['WCH', 637]];
let cB = 0;
for (const [c, want] of CONTROL) {
  const rows = byBldg.get(c) || []; let b = null;
  for (const di of (CODE[c] || [])) for (const r of rows) {
    const m = mBetween(dll(di), r.ll); if (!b || m < b.m) b = { di, m };
  }
  if (b && b.di === want) cB++;
}
console.log(`   control A — round 6's convictions reproduced exactly: ${c6 ? 'YES' : 'NO'}`);
console.log(`   control B — docs/walk-baseline.md's UT-verified doors: ${cB} of ${CONTROL.length}`);
if (!c6 || cB !== CONTROL.length) {
  console.log('Join not trusted. Stopping before it accuses anything.');
  process.exit(1);
}

// ── the census ────────────────────────────────────────────────────────────
const { browser, page } = await open();
await page.evaluate((off) => {
  if (off && window.WAYFIND) window.WAYFIND.stairBarrierDoor = false;
}, OFF);
console.log(`\npairs ${N} | stairBarrierDoor=${!OFF}`);

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
    const r = await window.wayfindStairs(a, b, {});
    if (!r || !r.ok) continue;
    out.push({
      from: a, to: b, sets: r.sets, legWayCount: r.legWayCount,
      fromDoor: r.fromDoor, toDoor: r.toDoor,
      distM: Math.round(r.distM), stepFreeNone: !!r.stepFreeNone,
      sf: r.stepFree ? {
        fromDoor: r.stepFree.fromDoor, toDoor: r.stepFree.toDoor,
        distM: Math.round(r.stepFree.distM), clean: r.stepFree.clean,
        doorsBF: r.stepFree.doorsBF || 0,
        barriered: r.stepFree.doorBarriered || null,
        bfree: r.stepFree.doorBarrierFree || null,
      } : null,
    });
  }
  return out;
}, N);

const offers = res.filter(r => r.sf);
const refused = res.filter(r => r.stepFreeNone);
console.log(`routes ${res.length} | with a staircase ${res.filter(r => r.sets > 0).length}` +
  ` | step-free offered ${offers.length} | no way round ${refused.length}`);

const touch = [];
for (const r of offers) {
  for (const [role, di] of [['ends at', r.sf.toDoor], ['starts at', r.sf.fromDoor]]) {
    if (LABEL.get(di) === 'N') touch.push({ r, role, di });
  }
}
const fixable = touch.filter(t => WHY.get(t.di).siblings > 1);
const only = touch.filter(t => WHY.get(t.di).siblings === 1);
console.log('');
console.log(`STEP-FREE OFFERS TOUCHING A DOOR UT PUBLISHES AS NOT BARRIER-FREE: ${touch.length}`);
console.log(`   ...where the building has another door in the graph : ${fixable.length}`);
console.log(`   ...where it is the building's ONLY door             : ${only.length}`);
for (const t of touch.slice(0, 24)) {
  console.log(`   ${t.r.from}>${t.r.to}  ${t.role} door ${t.di} (${WHY.get(t.di).code})` +
    `  ${t.r.sf.distM} m  clean=${t.r.sf.clean}  disclosed=${t.r.sf.barriered ? 'YES' : 'no'}`);
}
const disclosed = touch.filter(t => t.r.sf.barriered);
console.log(`   ...disclosed by the answer object: ${disclosed.length} of ${touch.length}`);

// for scale: the ordinary walk, which is allowed to use any door
const ord = res.reduce((n, r) =>
  n + (LABEL.get(r.toDoor) === 'N' ? 1 : 0) + (LABEL.get(r.fromDoor) === 'N' ? 1 : 0), 0);
console.log(`(scale: ordinary walks touching one: ${ord} endpoints of ${res.length * 2})`);

const pass = [];
pass.push(ok(fixable.length === 0,
  'no step-free walk uses a door UT publishes as NOT barrier-free when the building has another',
  `${fixable.length} of ${offers.length} offers`));
pass.push(ok(only.length === disclosed.length,
  'where it IS the only door, the answer says so instead of promising step-free silently',
  `${disclosed.length} of ${only.length} disclosed`));
pass.push(ok(LABEL.size >= 20 && labN.length >= 2,
  'the join labelled doors at all (a vacuous check passes by labelling none)',
  `${LABEL.size} doors, ${labN.length} of them N`));
// A route is "stairy" when the router walks a flight OR one of our own two
// door legs lies on one — `sets` alone misses the second, which is exactly the
// family round 4 found. 132, not 127.
const stairy = res.filter(r => r.sets > 0 || r.legWayCount > 0).length;
pass.push(ok(offers.length + refused.length === stairy,
  'every stairy route is either offered a way round or told there is none',
  `${offers.length} + ${refused.length} = ${stairy}`));
pass.push(ok(res.filter(r => r.sf && r.sf.bfree).length > 0,
  'the answer NAMES the door where UT has published one as barrier-free (Citymapper sf3)',
  `${res.filter(r => r.sf && r.sf.bfree).length} of ${offers.length} offers`));

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `gea.mjs`

§8a's other branch, driven on purpose, with the control that makes it fire.

```js
/**
 * gea.mjs — ROUND 8a's OTHER BRANCH, driven on purpose, with a control that
 * makes it fire.
 *
 * The 300-pair census never lands on Gearing Hall, so the half of §8a that
 * MOVES somebody off a door UT convicts is untested by it. GEA is the only
 * building on this campus with both a convicted door (386, "Access is off
 * 24th Street up the stairs") and another door in the graph (387), so every
 * GEA pair is driven here, both directions, four ways.
 *
 * AND THE FIRST TWO RUNS FIND NOTHING, which is the round's result rather
 * than a broken test: 386's usable anchor is dropped by round 4's door-leg
 * width test, so the step-free profile could never reach it in the first
 * place. UT's survey and this app's own geometry convict the same door from
 * two directions that share no code and no data.
 *
 * So the control turns round 4 off — `stairLegOverlapMinM = Infinity` is the
 * documented switch that restores rounds 1-3 exactly — which puts 386 back
 * within reach and leaves §8a as the only thing standing between the walker
 * and it.
 *
 *   node gea.mjs [--all]
 */
import { open, ok } from './lib.mjs';

const ALL = process.argv.includes('--all');
const { browser, page } = await open();

const run = (cfg) => page.evaluate(async ({ cfg, all }) => {
  const W = window.WAYFIND;
  W.stairBarrierDoor = cfg.on;
  W.stairLegOverlapMinM = cfg.round4 ? 1.5 : Infinity;
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code).filter(c => c !== 'GEA');
  const pick = all ? codes : codes.filter((_, i) => i % 4 === 0);
  const out = [];
  for (const c of pick) {
    for (const [a, b] of [['GEA', c], [c, 'GEA']]) {
      const r = await window.wayfindStairs(a, b, {});
      if (!r || !r.ok || !r.stepFree) continue;
      const geaDoor = a === 'GEA' ? r.stepFree.fromDoor : r.stepFree.toDoor;
      out.push({ k: a + '>' + b, geaDoor, distM: r.stepFree.distM,
        clean: r.stepFree.clean, off: r.stepFree.doorsOffBarriered || 0,
        barr386: !!(r.stepFree.doorBarriered || []).some(x => x.door === 386) });
    }
  }
  return out;
}, { cfg, all: ALL });

const label = (c) => `${c.round4 ? 'round-4 leg test' : 'rounds 1-3 leg test'}, §8a ${c.on ? 'ON ' : 'off'}`;
const cfgs = [
  { round4: true, on: false }, { round4: true, on: true },
  { round4: false, on: false }, { round4: false, on: true },
];
const R = [];
for (const c of cfgs) {
  const rows = await run(c);
  R.push(rows);
  console.log(`${label(c).padEnd(34)} walks ${String(rows.length).padStart(3)} | ` +
    `on door 386 ${String(rows.filter(r => r.geaDoor === 386).length).padStart(3)} | ` +
    `on 387 ${String(rows.filter(r => r.geaDoor === 387).length).padStart(3)} | ` +
    `moved off ${rows.filter(r => r.off > 0).length} | disclosed ${rows.filter(r => r.barr386).length}`);
}
const [S_off, S_on, C_off, C_on] = R;

// what the control's move actually costs, walk by walk
const byK = new Map(C_off.map(r => [r.k, r]));
let moved = 0, cost = 0, worst = 0, shown = 0;
for (const b of C_on) {
  const a = byK.get(b.k);
  if (!a || a.geaDoor === b.geaDoor) continue;
  moved++;
  const d = b.distM - a.distM;
  cost += d; if (d > worst) worst = d;
  if (shown++ < 8) console.log(`   ${b.k}: door ${a.geaDoor} -> ${b.geaDoor}, ` +
    `${Math.round(a.distM)} -> ${Math.round(b.distM)} m (${d >= 0 ? '+' : ''}${Math.round(d)})`);
}
if (moved) console.log(`   moved ${moved} walks off the convicted door, ` +
  `${Math.round(cost)} m in total, worst ${Math.round(worst)} m, median ${Math.round(cost / moved)} m`);

const pass = [];
pass.push(ok(S_off.filter(r => r.geaDoor === 386).length === 0 &&
             S_on.filter(r => r.geaDoor === 386).length === 0,
  'SHIPPED: the step-free profile never reaches the convicted door anyway — round 4 already had it',
  `${S_off.length} walks, 0 on door 386 with §8a off and on`));
pass.push(ok(C_off.filter(r => r.geaDoor === 386).length > 0,
  'CONTROL: with round 4 turned off the convicted door comes back within reach',
  `${C_off.filter(r => r.geaDoor === 386).length} of ${C_off.length} walks`));
pass.push(ok(C_on.filter(r => r.geaDoor === 386).length === 0,
  '...and §8a is then the only thing that takes them off it',
  `${C_on.filter(r => r.geaDoor === 386).length} of ${C_on.length} walks`));
pass.push(ok(C_on.every(r => r.clean) && S_on.every(r => r.clean),
  'every walk it moved is still verified step-free',
  `${C_on.filter(r => r.clean).length} of ${C_on.length}`));
pass.push(ok(C_on.length === C_off.length && S_on.length === S_off.length,
  'the pass never turned a walk into a refusal', `${C_off.length} -> ${C_on.length}`));

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `shortcut.mjs`

§8b's A/B and the curve it is switched OFF because of.

```js
/**
 * shortcut.mjs — ROUND 8b. How much longer is the step-free walk than it has
 * to be, and what does §8b get back?
 *
 * The same 300 seeded pairs rounds 4-7 use, driven twice in ONE page with the
 * pass on and off, so the two censuses cannot differ by anything except the
 * constant. Every offer is compared field by field, not just in total.
 *
 *   node shortcut.mjs [pairs] [--min N] [--curve]
 *
 * --curve sweeps stairAltShortcutMinM instead, which is where the shipped
 * value is read off.
 */
import { open, ok } from './lib.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const CURVE = process.argv.includes('--curve');
const MIN = (() => { const i = process.argv.indexOf('--min'); return i > 0 ? Number(process.argv[i + 1]) : null; })();

const { browser, page } = await open();

const census = async (cfg) => page.evaluate(async ({ n, cfg }) => {
  const W = window.WAYFIND;
  W.stairAltShortcut = cfg.on;
  if (cfg.min != null) W.stairAltShortcutMinM = cfg.min;
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = []; let tries = 0;
  while (out.length < n && tries < n * 6) {
    tries++;
    const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
    if (a === b) continue;
    const r = await window.wayfindStairs(a, b, {});
    if (!r || !r.ok) continue;
    out.push({
      k: a + '>' + b, sets: r.sets, legWayCount: r.legWayCount,
      distM: Math.round(r.distM), stepFreeNone: !!r.stepFreeNone,
      sf: r.stepFree ? {
        distM: r.stepFree.distM, clean: r.stepFree.clean,
        fromDoor: r.stepFree.fromDoor, toDoor: r.stepFree.toDoor,
        extraM: r.stepFree.extraM, lo: r.stepFree.lo, hi: r.stepFree.hi,
        shortcutM: r.stepFree.shortcutM || 0,
        barr: r.stepFree.doorBarriered ? r.stepFree.doorBarriered.map(x => x.door).join(',') : null,
        off: r.stepFree.doorsOffBarriered || 0,
        verts: r.stepFree.vertices,
      } : null,
    });
  }
  return out;
}, { n: N, cfg });

const summarise = (tag, rows) => {
  const off = rows.filter(r => r.sf);
  console.log(`${tag}: routes ${rows.length} | stairy ${rows.filter(r => r.sets > 0 || r.legWayCount > 0).length}` +
    ` | offered ${off.length} | refused ${rows.filter(r => r.stepFreeNone).length}` +
    ` | total step-free metres ${Math.round(off.reduce((s, r) => s + r.sf.distM, 0))}`);
  return off;
};

if (CURVE) {
  console.log('stairAltShortcutMinM sweep — offers, refusals, walks shortened, metres saved\n');
  console.log('   min    offered  refused  shortened   metres saved   max   median');
  for (const min of [0.001, 1, 5, 10, 15, 25, 50, 100, 100000]) {
    const rows = await census({ on: true, min });
    const off = rows.filter(r => r.sf);
    const cut = off.filter(r => r.sf.shortcutM > 0).map(r => r.sf.shortcutM).sort((a, b) => a - b);
    const sum = cut.reduce((s, v) => s + v, 0);
    console.log(`  ${String(min).padStart(7)}  ${String(off.length).padStart(7)}  ` +
      `${String(rows.filter(r => r.stepFreeNone).length).padStart(7)}  ${String(cut.length).padStart(9)}  ` +
      `${String(Math.round(sum)).padStart(13)}  ${String(Math.round(cut[cut.length - 1] || 0)).padStart(5)}  ` +
      `${String(Math.round(cut[cut.length >> 1] || 0)).padStart(6)}`);
  }
  await browser.close();
  process.exit(0);
}

const offRows = await census({ on: false, min: MIN });
const onRows = await census({ on: true, min: MIN });
const A = summarise('OFF (round 7)', offRows);
const B = summarise('ON  (round 8) ', onRows);

const byK = new Map(A.map(r => [r.k, r]));
let shorter = 0, longer = 0, same = 0, doorMoved = 0, saved = 0, worst = 0;
const list = [];
for (const b of B) {
  const a = byK.get(b.k);
  if (!a) continue;
  const d = a.sf.distM - b.sf.distM;
  if (d > 0.5) { shorter++; saved += d; if (d > worst) worst = d; list.push([b.k, a.sf.distM, b.sf.distM, d]); }
  else if (d < -0.5) { longer++; list.push([b.k, a.sf.distM, b.sf.distM, d]); }
  else same++;
  if (a.sf.fromDoor !== b.sf.fromDoor || a.sf.toDoor !== b.sf.toDoor) doorMoved++;
}
list.sort((x, y) => y[3] - x[3]);
console.log('');
console.log(`walks shorter ${shorter} | longer ${longer} | identical ${same} | door moved ${doorMoved}`);
console.log(`metres saved ${Math.round(saved)} of ${Math.round(A.reduce((s, r) => s + r.sf.distM, 0))} ` +
  `(${(100 * saved / A.reduce((s, r) => s + r.sf.distM, 0)).toFixed(2)}%), worst single walk ${Math.round(worst)} m`);
for (const [k, a, b, d] of list.slice(0, 15)) console.log(`   ${k}  ${Math.round(a)} -> ${Math.round(b)} m  (-${Math.round(d)})`);

const pass = [];
pass.push(ok(longer === 0, 'no step-free walk got LONGER', `${longer} of ${B.length}`));
pass.push(ok(A.length === B.length, 'the pass offered exactly the same walks',
  `${A.length} vs ${B.length}`));
pass.push(ok(offRows.filter(r => r.stepFreeNone).length === onRows.filter(r => r.stepFreeNone).length,
  'the pass refused exactly the same walks',
  `${offRows.filter(r => r.stepFreeNone).length} vs ${onRows.filter(r => r.stepFreeNone).length}`));
pass.push(ok(doorMoved === 0, 'no door changed — every door decision above §8b survives it',
  `${doorMoved} of ${B.length}`));
pass.push(ok(B.every(r => r.sf.clean), 'every walk it moved somebody onto is still verified step-free',
  `${B.filter(r => r.sf.clean).length} of ${B.length}`));
pass.push(ok(B.filter(r => r.sf.shortcutM > 0).length === shorter,
  'the route reports the same number of shortcuts the A/B measures',
  `${B.filter(r => r.sf.shortcutM > 0).length} vs ${shorter}`));

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `gate8b.mjs`

The cheap precondition for §8b — which does not exist. 1 of 3.

```js
/** gate8b.mjs — is there a cheap precondition that predicts the shortcut? */
import { open } from './lib.mjs';
const { browser, page } = await open();
const rows = await page.evaluate(async (n) => {
  window.WAYFIND.stairAltShortcut = true;
  window.WAYFIND.stairAltShortcutMinM = 0.001;
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = []; let tries = 0;
  while (out.length < n && tries < n * 6) {
    tries++;
    const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
    if (a === b) continue;
    const r = await window.wayfindStairs(a, b, {});
    if (!r || !r.ok) continue;
    out.push(r.stepFree ? { cut: r.stepFree.shortcutM || 0,
      refused: r.stepFree.doorsRefused || 0, forced: !!r.stepFree.doorsForced } : null);
  }
  return out.filter(Boolean);
}, 300);
const cut = rows.filter(r => r.cut > 0);
const big = rows.filter(r => r.cut >= 15);
console.log(`offers ${rows.length} | shortened at all ${cut.length} | by >=15 m ${big.length}`);
console.log(`   of those shortened, doorsRefused>0 : ${cut.filter(r => r.refused > 0).length}`);
console.log(`   of those >=15 m,    doorsRefused>0 : ${big.filter(r => r.refused > 0).length}`);
console.log(`   offers with doorsRefused>0 overall : ${rows.filter(r => r.refused > 0).length}`);
console.log(`   offers with doorsForced           : ${rows.filter(r => r.forced).length}`);
await browser.close();
```

### `clock8.mjs`

§R57. Every seeded pair driven BOTH WAYS, the fix off and on in one page.

```js
/**
 * clock8.mjs — ROUND 8 §R57. The card said "down the steps" and the clock
 * charged for the climb.
 *
 * Round 7 gave the ROUTER the direction of a flight and wrote the matching
 * patch for the arithmetic out in §R50 rather than making it. This is that
 * patch, measured: every seeded pair driven BOTH WAYS — the direction is the
 * whole subject, so a one-way census cannot see it — with the fix off and on
 * in ONE page, so the two runs cannot differ by anything but the constant.
 *
 *   node clock8.mjs [pairs]
 */
import { open, ok } from './lib.mjs';

const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 300);
const { browser, page } = await open();

const census = (on) => page.evaluate(async ({ n, on }) => {
  window.WAYFIND.stairDownDiscount = on;
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = []; let tries = 0, pairs = 0;
  while (pairs < n && tries < n * 6) {
    tries++;
    const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
    if (a === b) continue;
    const probe = await window.wayfindStairs(a, b, {});
    if (!probe || !probe.ok) continue;
    pairs++;
    for (const [x, y] of [[a, b], [b, a]]) {
      const r = x === a ? probe : await window.wayfindStairs(x, y, {});
      if (!r || !r.ok) continue;
      // the descent metres this walk has, read off the leg list the CARD
      // prints — the same source the sentence "down the steps" comes from.
      const dn = (r.list || []).filter(s => s.dir === 'down').reduce((s, v) => s + v.m, 0);
      const up = (r.list || []).filter(s => s.dir === 'up').reduce((s, v) => s + v.m, 0);
      out.push({ k: x + '>' + y, sets: r.sets, lo: r.lo, hi: r.hi,
        distM: Math.round(r.distM), dn: +dn.toFixed(1), up: +up.toFixed(1) });
    }
  }
  return out;
}, { n: N, on });

const A = await census(false);   // round 7's clock
const B = await census(true);    // round 8's
const tune = await page.evaluate(() => ({
  stairSpeed: window.WAYFIND.stairSpeed, up: window.WAYFIND.stairUpMult,
  fixed: window.WAYFIND.stairFixedS }));

console.log(`walks driven ${A.length} (both directions of ${N} seeded pairs)`);
const withDown = A.filter(r => r.dn > 0);
const pureDown = A.filter(r => r.dn > 0 && r.up === 0);
console.log(`   with a mapped DESCENT on them            : ${withDown.length}`);
console.log(`   descending a known flight and climbing 0 : ${pureDown.length}`);
console.log(`   with a mapped CLIMB on them              : ${A.filter(r => r.up > 0).length}`);

let secs = 0, worst = 0, worstK = '';
for (const r of withDown) {
  const s = (r.dn * (tune.up - 1)) / tune.stairSpeed;
  secs += s;
  if (s > worst) { worst = s; worstK = r.k; }
}
console.log(`seconds of climbing that does not happen, taken off the HIGH end: ` +
  `${secs.toFixed(1)} s total, worst ${worst.toFixed(1)} s (${worstK})`);
console.log(`   (stairSpeed ${tune.stairSpeed} m/s, stairUpMult ${tune.up} — both read out of the page)`);

const byK = new Map(A.map(r => [r.k, r]));
let moved = 0, wider = 0, loMoved = 0;
const list = [];
for (const b of B) {
  const a = byK.get(b.k);
  if (!a) continue;
  if (a.lo !== b.lo) loMoved++;
  if (a.hi !== b.hi) {
    moved++;
    if (b.hi > a.hi) wider++;
    list.push([b.k, a.lo, a.hi, b.lo, b.hi, a.dn, a.up, a.distM]);
  }
}
console.log('');
console.log(`printed bands that CHANGED: ${moved} of ${B.length} walks (high end ${moved}, low end ${loMoved})`);
for (const [k, alo, ahi, blo, bhi, dn, up, d] of list.slice(0, 12)) {
  console.log(`   ${k.padEnd(10)} ${d} m   ${alo}-${ahi} min  ->  ${blo}-${bhi} min` +
    `   descends ${dn} m, climbs ${up} m`);
}

const pass = [];
pass.push(ok(withDown.length > 0,
  'the census contains walks that descend a KNOWN flight (otherwise it proves nothing)',
  `${withDown.length} of ${A.length}`));
pass.push(ok(wider === 0, 'no printed band got WIDER — the fix can only ever remove a climb',
  `${wider} of ${moved} changed`));
pass.push(ok(loMoved === 0, 'the optimistic low end is untouched — it never billed a climb',
  `${loMoved} of ${B.length}`));
pass.push(ok(list.every(([, , , , , dn]) => dn > 0),
  'every band that moved belongs to a walk OSM says goes DOWN', `${list.length} bands`));
pass.push(ok(B.every(r => r.hi > r.lo), 'the printed band is still a band, never a point',
  `${B.filter(r => r.hi > r.lo).length} of ${B.length}`));
pass.push(ok(A.filter(r => r.dn === 0).every(r => {
  const b = B.find(x => x.k === r.k); return b && b.lo === r.lo && b.hi === r.hi;
}), 'a walk with no tagged descent is byte-identical to round 7',
  `${A.filter(r => r.dn === 0).length} walks`));

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `cost8.mjs`

What round 8 costs: the Dijkstra count first, then the clock with its control.

```js
/**
 * cost8.mjs — what round 8 costs, counted before it is timed.
 *
 * The stopwatch has been thrown out twice on this lane (round 6, round 7) for
 * the same reason: five sibling agents drive browsers on this machine and the
 * clock reads the neighbours. So the STRUCTURAL number comes first — how many
 * Dijkstras each pair costs — because that one cannot be moved by load. Then
 * the clock, interleaved, minimum of reps, against a control pair whose answer
 * is asserted byte-identical in both configurations before either time is
 * read.
 *
 *   node cost8.mjs [pairs] [reps]
 */
import { open, ok } from './lib.mjs';

const N = Number(process.argv[2] || 300);
const REPS = Number(process.argv[3] || 9);
const { browser, page } = await open();

// ── 1. THE STRUCTURAL COST, over the whole seeded census ───────────────────
const calls = await page.evaluate(async (n) => {
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  const codes = Object.keys(g.code);
  const mk = () => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
  const modes = {
    'round 7 (8a off, 8b off)': { a: false, b: false },
    'round 8a only': { a: true, b: false },
    'round 8b only': { a: false, b: true },
    'round 8 shipped': { a: true, b: true },
  };
  const out = {};
  for (const [name, cfg] of Object.entries(modes)) {
    window.WAYFIND.stairBarrierDoor = cfg.a;
    window.WAYFIND.stairAltShortcut = cfg.b;
    const rnd = mk();
    let tries = 0, done = 0;
    const before = window.wayfindStats().timings.routes;
    while (done < n && tries < n * 6) {
      tries++;
      const a = codes[Math.floor(rnd() * codes.length)], b = codes[Math.floor(rnd() * codes.length)];
      if (a === b) continue;
      const r = await window.wayfindStairs(a, b, {});
      if (!r || !r.ok) continue;
      done++;
    }
    out[name] = { routes: done, calls: window.wayfindStats().timings.routes - before };
  }
  return out;
}, N);
const base = calls['round 7 (8a off, 8b off)'].calls;
console.log(`computeRoute calls over the same ${N} seeded pairs:`);
for (const [k, v] of Object.entries(calls)) {
  console.log(`   ${k.padEnd(26)} ${String(v.calls).padStart(5)}  ` +
    `(${v.calls >= base ? '+' : ''}${v.calls - base}, ${((100 * (v.calls - base)) / base).toFixed(1)}%)  ` +
    `over ${v.routes} routes`);
}

// ── 2. THE CLOCK, with its control ─────────────────────────────────────────
// PAR>PAC is the pair §8a actually touches; GEA>JON is the control, chosen
// because its answer is identical in both configurations.
const PAIRS = [['PAR', 'PAC'], ['GEA', 'JON']];
const times = await page.evaluate(async ({ pairs, reps }) => {
  const key = (r) => !r || !r.ok ? 'x' : JSON.stringify([r.distM, r.fromDoor, r.toDoor,
    r.stepFree && [r.stepFree.distM, r.stepFree.fromDoor, r.stepFree.toDoor]]);
  const out = {};
  for (const [a, b] of pairs) {
    const k = `${a}>${b}`;
    out[k] = { off: [], on: [], same: null };
    const seen = {};
    for (let i = 0; i < reps; i++) {
      for (const mode of ['off', 'on']) {
        window.WAYFIND.stairBarrierDoor = (mode === 'on');
        window.WAYFIND.stairAltShortcut = (mode === 'on');
        const t = performance.now();
        const r = await window.wayfindStairs(a, b, {});
        out[k][mode].push(performance.now() - t);
        seen[mode] = key(r);
      }
    }
    out[k].same = seen.off === seen.on;
  }
  return out;
}, { pairs: PAIRS, reps: REPS });

console.log('');
console.log(`the clock, ${REPS} interleaved reps, MINIMUM of each (the house rule):`);
const pass = [];
for (const [k, v] of Object.entries(times)) {
  const lo = (a) => Math.min(...a);
  console.log(`   ${k.padEnd(10)} answer identical both ways: ${v.same ? 'YES' : 'NO — do not read the times'}` +
    `   off ${lo(v.off).toFixed(2)} ms   on ${lo(v.on).toFixed(2)} ms   ` +
    `(${(lo(v.on) - lo(v.off) >= 0 ? '+' : '')}${(lo(v.on) - lo(v.off)).toFixed(2)})`);
}
pass.push(ok(times['GEA>JON'].same,
  'the control pair answers identically in both configurations, so its drift is the instrument\'s',
  ''));
pass.push(ok(calls['round 8 shipped'].routes === calls['round 7 (8a off, 8b off)'].routes,
  'the same routes completed in every configuration',
  `${calls['round 8 shipped'].routes} vs ${calls['round 7 (8a off, 8b off)'].routes}`));

await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `frames8.mjs`

The four pictures, quiet floor first, pose re-read at the shutter.

```js
/**
 * frames8.mjs — ROUND 8 in two pictures, proved in PIXELS, noise floor first.
 *
 * ONE page load, so the only thing that can move between frames is the thing
 * being changed. Quiet gate before every shot. The card is an HTML overlay
 * whose TEXT is the subject of frame 1 and NOT the subject of frame 2, so it
 * is measured in frame 1 and excluded from frame 2.
 *
 *   A  §R57  PAC>BME, stairDownDiscount off then on. The card prints the leg
 *            "down the steps" and the clock stops charging for the climb:
 *            13-18 min becomes 13-17.
 *   B  §8a   GEA>ADH under rounds 1-3's leg test (the control config that puts
 *            the convicted door back within reach), §8a off then on. The walk
 *            leaves Gearing Hall by 387 instead of the door UT publishes as
 *            "up the stairs", and the ribbon moves.
 *
 *   node frames8.mjs [outdir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { open, shot, ok } from './lib.mjs';

const OUT = process.argv[2] || './frames8';
fs.mkdirSync(OUT, { recursive: true });
const W = 1100, H = 700;
const WALK_LAYERS = ['wayfind-ribbon', 'wayfind-ghost', 'wayfind-thread', 'wayfind-column'];
const DIFF_STRICT = 120;
// THE QUIET GATE IS TIGHTER THAN ROUND 7's AND IT HAD TO BE. 1500 px is the
// allowance for a whole city settling after a page load; this file loads the
// page ONCE and only moves the camera, and the difference frame B is about is
// 25 m of a 590 m walk. The first cut passed its gate at 820 px of residual
// motion and then claimed a 73 px difference -- a claim smaller than its own
// noise. 200 px, and both frames reach 0.
const QUIET_GAP_MS = 700, QUIET_PX = 200, QUIET_TRIES = 30;
const PAD_M = 60, DIVERGE_M = 20;

const { browser, page } = await open({ w: W, h: H });

const grab = async (name) => { const p = path.join(OUT, name + '.png'); await shot(page, p); return p; };
const diff = async (pa, pb, excl, only) => {
  const a = 'data:image/png;base64,' + fs.readFileSync(pa).toString('base64');
  const b = 'data:image/png;base64,' + fs.readFileSync(pb).toString('base64');
  return page.evaluate(async ([sa, sb, TH, EX, ON]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [ia, ib] = await Promise.all([load(sa), load(sb)]);
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(ia, 0, 0); const A = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(ib, 0, 0); const B = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, n24 = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.length; i += 4) {
      const p = (i / 4) | 0, px = p % c.width, py = (p / c.width) | 0;
      if (EX && px >= EX[0] && px <= EX[2] && py >= EX[1] && py <= EX[3]) continue;
      if (ON && !(px >= ON[0] && px <= ON[2] && py >= ON[1] && py <= ON[3])) continue;
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d >= 24) n24++;
      if (d < TH) continue;
      n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return { n, n24, bbox: [x0, y0, x1, y1] };
  }, [a, b, DIFF_STRICT, excl || null, only || null]);
};

async function quiet(tag) {
  for (let i = 0; i < QUIET_TRIES; i++) {
    const p1 = await grab(`${tag}-q1`);
    await page.waitForTimeout(QUIET_GAP_MS);
    const p2 = await grab(`${tag}-q2`);
    const d = await diff(p1, p2);
    fs.unlinkSync(p1);
    if (d.n <= QUIET_PX) return { tries: i + 1, n: d.n, still: p2 };
    fs.unlinkSync(p2);
  }
  throw new Error(`${tag}: scene never went quiet`);
}

const cardOf = () => page.evaluate(() => {
  const c = document.getElementById('wf-pill');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { text: c.innerText.replace(/\n+/g, ' | ').slice(0, 400),
    rect: [Math.max(0, Math.floor(r.x) - 4), Math.max(0, Math.floor(r.y) - 4),
      Math.ceil(r.right) + 4, Math.ceil(r.bottom) + 4] };
});

/** camera: the ground where two walks put a person in different places */
const camFor = (lineA, lineB) => page.evaluate(([a, b, dm]) => {
  const MPD_LON = 96061, MPD_LAT = 111195;
  const far = (p, L) => {
    let best = 1e9;
    for (const q of L) {
      const d = Math.hypot((p[0] - q[0]) * MPD_LON, (p[1] - q[1]) * MPD_LAT);
      if (d < best) best = d;
    }
    return best;
  };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (p) => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  for (const p of b) if (far(p, a) > dm) add(p);
  for (const p of a) if (far(p, b) > dm) add(p);
  if (x1 < x0) { for (const p of a) add(p); }
  return [x0, y0, x1, y1];
}, [lineA, lineB, DIVERGE_M]);

// MAX ZOOM 17, AND IT IS NOT A TASTE CHOICE. The first cut of frame B fitted
// at zoom 18 and the walk was INVISIBLE to the eye at 3,751 changed pixels —
// a warm-white 1.6 m ribbon on tan ground, and `wayfind-thread`, the line that
// actually reads at a glance, is faded out above `threadFadeZoom` 17.2 and
// gone by 18.4. So the frame was true and unreadable at the same time, which
// is the house's own "visible in the DOM is not visible on camera" written in
// pixels. Below 17.2 the thread is at full opacity and the route is a line
// anybody can follow.
const MAX_Z = 17;
// ...AND `fitBounds` DOES NOT GIVE YOU THE PITCH YOU ASK FOR. The first cut
// passed `pitch: 0` and the frame came back oblique, which puts the ground you
// aimed at near the bottom edge instead of the middle: frame B was framed on
// Gearing Hall and returned a picture of Norman Hackerman Building with
// Gearing off the bottom. So the fit is used only to pick the ZOOM, and the
// camera is then set outright.
const fit = (bb, pad) => page.evaluate(([b, p, mz]) => {
  const dx = p / 96061, dy = p / 111195;
  const m = window.__map;
  m.fitBounds([[b[0] - dx, b[1] - dy], [b[2] + dx, b[3] + dy]],
    { padding: 10, duration: 0, pitch: 0, maxZoom: mz });
  m.jumpTo({ center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
    zoom: Math.min(mz, m.getZoom()), pitch: 0, bearing: 0 });
  return { z: +m.getZoom().toFixed(3), pitch: m.getPitch(), bearing: m.getBearing(),
    c: m.getCenter().toArray().map(v => +v.toFixed(6)) };
}, [bb, pad == null ? PAD_M : pad, MAX_Z]);

const setCfg = (cfg) => page.evaluate((c) => { Object.assign(window.WAYFIND, c); }, cfg);
const route = (f, t) => page.evaluate(async ([a, b]) => {
  await window.wayfindRoute(a, b);
  const r = window.wayfindStairs();
  return r ? { distM: Math.round(r.distM), sets: r.sets, lo: r.lo, hi: r.hi,
    fromDoor: r.fromDoor, toDoor: r.toDoor,
    dirs: (r.list || []).map(x => x.dir),
    sf: r.stepFree ? { fromDoor: r.stepFree.fromDoor, toDoor: r.stepFree.toDoor,
      distM: r.stepFree.distM, barr: r.stepFree.doorBarriered, off: r.stepFree.doorsOffBarriered } : null } : null;
}, [f, t]);

const pass = [];

// ══ A. §R57 — the card says "down the steps" and the clock stops charging ══
console.log('A  §R57  PAC>BME — the printed band, with the descent billed as a climb and not');
await setCfg({ stairDownDiscount: false });
const aAns = await route('PAC', 'BME');
const aLine = await page.evaluate(async () => (await window.wayfindStairs('PAC', 'BME', { geom: true })).geom.line);
await fit(await camFor(aLine, aLine));
let q = await quiet('A-off');
const cardOff = await cardOf();
await page.screenshot({ path: path.join(OUT, 'r8-A1-clock-round7.jpg'), type: 'jpeg', quality: 80 });
const stillOff = q.still;

await setCfg({ stairDownDiscount: true });
const aAns2 = await route('PAC', 'BME');
q = await quiet('A-on');
const cardOn = await cardOf();
await page.screenshot({ path: path.join(OUT, 'r8-A2-clock-round8.jpg'), type: 'jpeg', quality: 80 });
const cardDiff = await diff(stillOff, q.still, null, cardOff.rect);
const mapDiff = await diff(stillOff, q.still, cardOff.rect, null);
fs.unlinkSync(stillOff); fs.unlinkSync(q.still);
console.log(`   round 7 clock: ${aAns.lo}-${aAns.hi} min, ${aAns.distM} m, dirs ${JSON.stringify(aAns.dirs)}`);
console.log(`   round 8 clock: ${aAns2.lo}-${aAns2.hi} min, ${aAns2.distM} m`);
console.log(`   card off : ${cardOff.text}`);
console.log(`   card on  : ${cardOn.text}`);
console.log(`   pixels: inside the card ${cardDiff.n} strict (${cardDiff.n24} loose), ` +
  `everywhere else ${mapDiff.n} strict (${mapDiff.n24} loose)`);
pass.push(ok(aAns.hi !== aAns2.hi, 'the printed high end actually moved',
  `${aAns.lo}-${aAns.hi} -> ${aAns2.lo}-${aAns2.hi} min`));
pass.push(ok(aAns.dirs.includes('down'), 'the card really is calling this flight a descent',
  JSON.stringify(aAns.dirs)));
pass.push(ok(cardDiff.n > 0, 'the change is VISIBLE — the card\'s own pixels differ',
  `${cardDiff.n} px`));
pass.push(ok(mapDiff.n <= QUIET_PX, 'and nothing else in the picture moved',
  `${mapDiff.n} px outside the card, quiet floor ${QUIET_PX}`));
pass.push(ok(aAns.distM === aAns2.distM, 'the WALK is byte-identical — this is the clock, not the router',
  `${aAns.distM} m both ways`));

// ══ B. §8a — the walk leaves by the door UT has not convicted ══════════════
console.log('');
console.log('B  §8a  GEA>ADH — off the door UT publishes as "up the stairs"');
console.log('   (under rounds 1-3\'s door-leg test, the config that puts door 386 back in reach;');
console.log('    on the SHIPPED test round 4 already keeps every step-free walk off it)');
await setCfg({ stairLegOverlapMinM: Infinity, stairBarrierDoor: false });
// the two Gearing Hall doors, straight out of the graph the app loaded
await page.evaluate(async () => {
  const g = await fetch('data/walk_graph.json').then(r => r.json());
  window.__gdoors = g.code['GEA'].map(di => [g.d[di][0] * g.q, g.d[di][1] * g.q]);
});
const bOff = await route('GEA', 'ADH');
const bLineOff = await page.evaluate(async () => {
  const r = await window.wayfindStairs('GEA', 'ADH', { geom: true });
  return r.stepFree ? r.stepFree.geom.line : r.geom.line;
});
await setCfg({ stairBarrierDoor: true });
const bOn = await route('GEA', 'ADH');
const bLineOn = await page.evaluate(async () => {
  const r = await window.wayfindStairs('GEA', 'ADH', { geom: true });
  return r.stepFree ? r.stepFree.geom.line : r.geom.line;
});
// THE CAMERA IS DERIVED AND THE FIRST CUT OF IT WAS POINTING AT THE WRONG
// BUILDING. "Where the two walks diverge by more than 20 m" put the frame at
// Almetris Duren Hall, because the arrival door moves too and moves further.
// The subject of §8a is the DEPARTURE door, so the camera is the two Gearing
// Hall doors plus every metre of either walk within GEA_NEAR_M of them.
const GEA_NEAR_M = 120;
const camB = await page.evaluate(([a, b, near]) => {
  const MPD_LON = 96061, MPD_LAT = 111195;
  const g = window.__map;
  const doors = [386, 387];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (p) => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  const D = window.__gdoors;
  for (const d of D) add(d);
  for (const line of [a, b]) for (const p of line) {
    for (const d of D) {
      if (Math.hypot((p[0] - d[0]) * MPD_LON, (p[1] - d[1]) * MPD_LAT) <= near) { add(p); break; }
    }
  }
  return [x0, y0, x1, y1];
}, [bLineOff, bLineOn, GEA_NEAR_M]);
console.log(`   camera bbox (both Gearing Hall doors + ${GEA_NEAR_M} m of each walk): ${JSON.stringify(camB)}`);

// the ground the two walks disagree about, padded, read off the first A/B run
const CROP = [560, 250, 780, 470];
const frameB = async (tag, on) => {
  await setCfg({ stairBarrierDoor: on });
  const ans = await page.evaluate(async () => {
    await window.wayfindRoute('GEA', 'ADH', { avoidStairs: true });
    const r = window.wayfindStairs();
    return { distM: Math.round(r.distM), fromDoor: r.fromDoor, toDoor: r.toDoor,
      sets: r.sets, lo: r.lo, hi: r.hi };
  });
  const camState = await fit(camB);
  console.log(`      camera z=${camState.z} pitch=${camState.pitch} bearing=${camState.bearing} c=${JSON.stringify(camState.c)}`);
  const qq = await quiet(tag);
  const card = await cardOf();
  const pose = await page.evaluate(() => ({ z: +window.__map.getZoom().toFixed(3),
    pitch: +window.__map.getPitch().toFixed(1), bearing: +window.__map.getBearing().toFixed(1),
    c: window.__map.getCenter().toArray().map(v => +v.toFixed(6)) }));
  console.log(`      pose AT THE SHUTTER: z=${pose.z} pitch=${pose.pitch} bearing=${pose.bearing} c=${JSON.stringify(pose.c)}`);
  await page.screenshot({ path: path.join(OUT, `r8-${tag}.jpg`), type: 'jpeg', quality: 80 });
  // ...and a crop of the ground the two answers disagree about, because a
  // 25 m difference inside a 567 m frame is true and unreadable at once.
  await page.screenshot({ path: path.join(OUT, `r8-${tag}-crop.png`),
    clip: { x: CROP[0], y: CROP[1], width: CROP[2] - CROP[0], height: CROP[3] - CROP[1] } });
  // mask: the same camera with the walk layers off, so "is the ribbon on screen"
  // is measured rather than assumed
  await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'none'); }, WALK_LAYERS);
  await page.waitForTimeout(QUIET_GAP_MS);
  const offp = await grab(`${tag}-hidden`);
  await page.evaluate((ls) => { for (const l of ls) if (window.__map.getLayer(l)) window.__map.setLayoutProperty(l, 'visibility', 'visible'); }, WALK_LAYERS);
  await page.waitForTimeout(QUIET_GAP_MS);
  const mask = await diff(qq.still, offp, card.rect, null);
  fs.unlinkSync(offp);
  console.log(`   ${tag}: door ${ans.fromDoor} -> ${ans.toDoor}, ${ans.distM} m, ${ans.lo}-${ans.hi} min` +
    ` | quiet ${qq.n} px | ribbon ${mask.n} px strict bbox ${JSON.stringify(mask.bbox)}`);
  console.log(`      card: ${card.text}`);
  return { ans, still: qq.still, mask, card, quiet: qq.n };
};

const B1 = await frameB('B1-door386-round7', false);
const B2 = await frameB('B2-door387-round8', true);
const bDiff = await diff(B1.still, B2.still, B1.card.rect, null);
fs.unlinkSync(B1.still); fs.unlinkSync(B2.still);
console.log(`   the two ribbons differ by ${bDiff.n} px strict (${bDiff.n24} loose) ` +
  `bbox ${JSON.stringify(bDiff.bbox)}, card excluded`);
pass.push(ok(B1.ans.fromDoor === 386 && B2.ans.fromDoor === 387,
  'the walk left by the convicted door and then by the other one',
  `${B1.ans.fromDoor} -> ${B2.ans.fromDoor}`));
// THE BAR IS THE MEASURED FLOOR, NOT THE CONSTANT. QUIET_PX 1500 is the
// allowance for a whole city still settling; these two frames measured their
// own quiet at B1 and B2 above, and on a static scene that is the number a
// pixel claim has to clear. MIN_WALK_PX is a ribbon's worth of pixels.
const MIN_WALK_PX = 300;
// ...and the bar for "the two frames are different pictures" is separate and
// smaller, because the two walks share every metre except the last stretch
// into the door: that stretch is the whole subject and it is 25 m of a 590 m
// walk. 100 px against a measured 0 px quiet floor is signal, not settling.
const DIFF_MIN_PX = 50;
pass.push(ok(B1.mask.n > MIN_WALK_PX && B2.mask.n > MIN_WALK_PX,
  'THE SUBJECT IS ON SCREEN — hiding the walk layers changes the picture in both frames',
  `${B1.mask.n} px and ${B2.mask.n} px, against measured quiet of ${B1.quiet} and ${B2.quiet} px`));
pass.push(ok(bDiff.n > DIFF_MIN_PX,
  'and the two frames are genuinely different pictures, not the same one twice',
  `${bDiff.n} px, against measured quiet of ${B1.quiet} and ${B2.quiet} px`));

for (const f of fs.readdirSync(OUT)) if (/-q2\.png$|-q1\.png$|-hidden\.png$/.test(f)) {
  try { fs.unlinkSync(path.join(OUT, f)); } catch (e) {}
}
await browser.close();
process.exit(pass.every(Boolean) ? 0 : 1);
```

### `flagmix.py`

What the flag byte actually asserts, edge by edge. 0 stepped edges carry
`wheelchair=yes`, so the step-free profile is not refusing a way OSM calls
accessible; 21 of 189 flights are `F_OFFMAIN`, which is exactly 189 - 168.

```python
"""flagmix.py — what the flag byte actually asserts, edge by edge.

e.f: 1 steps, 2 crossing, 4 signalled, 8 incline-up-a-to-b, 16 bridge,
32 covered, 64 wheelchair=yes, 128 off-main-component.
"""
import json, io, sys
from collections import defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
g = json.load(io.open(ROOT + '/data/walk_graph.json', encoding='utf-8'))
e = g['e']
A = []
a = 0
for d in e['a']:
    a += d
    A.append(a)
F, W, S = e['f'], e['w'], e['s']
E = len(A)

NAMES = [(1, 'steps'), (2, 'crossing'), (4, 'signal'), (8, 'up_ab'),
         (16, 'bridge'), (32, 'covered'), (64, 'wheelchair'), (128, 'offmain')]
tot = defaultdict(int)
mlen = defaultdict(float)
for i in range(E):
    for b, n in NAMES:
        if F[i] & b:
            tot[n] += 1
            mlen[n] += W[i] / 100.0
print('edges %d, %.1f km' % (E, sum(W) / 100.0 / 1000))
for b, n in NAMES:
    print('  %-11s %5d edges  %8.1f m' % (n, tot[n], mlen[n]))

print()
print('CROSS-TABULATION AGAINST steps')
steps = [i for i in range(E) if F[i] & 1]
for b, n in NAMES:
    if b == 1:
        continue
    k = [i for i in steps if F[i] & b]
    print('  steps AND %-11s %4d edges  %7.1f m  %d ways' % (
        n, len(k), sum(W[i] / 100.0 for i in k), len(set(S[i] for i in k))))

print()
print('WHEELCHAIR=YES EDGES THAT ARE ALSO steps (the step-free profile refuses these):')
for i in steps:
    if F[i] & 64:
        print('   edge %d  way %d  %.1f m  flags %d' % (i, S[i], W[i] / 100.0, F[i]))

print()
print('STEPPED WAYS BY PLAN LENGTH (the router prices every one of these as impassable)')
byway = defaultdict(float)
for i in steps:
    byway[S[i]] += W[i] / 100.0
ls = sorted(byway.values())
buckets = [(0, 1), (1, 2), (2, 4), (4, 8), (8, 16), (16, 32), (32, 1e9)]
for lo, hi in buckets:
    n = sum(1 for v in ls if lo <= v < hi)
    print('   %5.0f - %-6.0f m : %3d ways' % (lo, hi if hi < 1e9 else 999, n))
print('   total %d ways, %.0f m, median %.1f m' % (len(ls), sum(ls), ls[len(ls) // 2]))
```
