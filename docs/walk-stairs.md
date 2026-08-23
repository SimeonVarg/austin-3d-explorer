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
