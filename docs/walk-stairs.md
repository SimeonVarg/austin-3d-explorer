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
