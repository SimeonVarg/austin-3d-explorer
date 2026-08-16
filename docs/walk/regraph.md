# The graph was routing students into the wall, on nine buildings out of eleven

**Date:** 2026-08-16. **Branch:** `acer/o5-regraph`, cut from `origin/main`
(`55170d1`). **Server:** `python scripts/serve.py 8521` from a throwaway
worktree. **Harness-drift:** PASS — 29 scripts in `index.html`, 29 in
`_harness.html`, run from the worktree root before any pixel work.

`docs/entrances/relocated.md` §7.4 handed this over and named its own blast
radius: *"`data/walk_graph.json` is now stale by up to 9.61 m on 11 buildings
and this pass did NOT re-bake it … It needs re-baking."* Nobody picked it up.
This is that re-bake, plus the thing the handover did not know.

---

## 0. THE HEADLINE: IT WAS NOT "BESIDE THE DOOR"

The handover described the error as up to 9.61 m of drift. That is true and it
undersells it. Measured — the shipped graph's own door position against the
footprint rings the renderer actually extrudes:

```
  eid   building                            err m  where the stale arrival landed
  138   Graduate School of Business          9.56  INSIDE its own host footprint
  281   (unnamed block)                      8.12  INSIDE its own host footprint
  486   Mezes Hall                           7.37  INSIDE its own host footprint
  276   (unnamed block)                      7.31  INSIDE its own host footprint
  285   Brackenridge Hall Dormitory          6.48  INSIDE its own host footprint
  345   South End Zone                       5.96  INSIDE its own host footprint
  346   South End Zone                       5.28  INSIDE its own host footprint
  172   Engineering Discovery Building       4.46  INSIDE its own host footprint
  194   (unnamed block)                      4.10  INSIDE its own host footprint
  391   (unnamed block)                      3.27  open air, 3.27 m from the door
  38    Jester West Hall                     2.01  open air, 2.01 m from the door
```

**Nine of the eleven stale arrival points were inside the building.** Not
beside the door, not on the wrong bit of pavement — inside the drawn footprint,
which is exactly where a person cannot stand. That is the honest statement of
what a student walking to Mezes or Brackenridge was being told this morning.

It follows directly from what NB8 fixed. Those eleven doors had been sitting
*in* their own walls; NB8 pushed them out onto free wall and the graph was
never told, so the graph kept the buried positions. The drift number and the
burial are the same fact seen twice.

---

## 1. The eleven are exactly eleven, matched by identity and not by order

`build_doors()` sorts on `(ref, nm, lon)`, so a door that moves can change its
own index — comparing the two files positionally would invent movers. Doors are
matched on `(ref, nm, role, src)` and then on nearest position within that
identity. 656 groups in `data/entrances.geojson`, 656 rows in the shipped
graph's `d` array, **11 displaced by more than 0.25 m, none by less**, and the
eleven are the eleven the handover named.

**Twenty-one rows looked like identity drift and are not.** Their `ref` is `''`
in `entrances.geojson` and `STD` / `KIN` / `ATT` / `BMK` / `TCP` / `AF2` /
`CLK` in the graph. `bake_walk.py` fills those in itself from `CODE_ALIASES`
by building name — the graph's `ref` is a *post-alias* field and the entrance
file's is raw OSM. Matching on the raw field reports 21 phantom losses. Nothing
was lost: 158 codes before, 158 after, none gained, none dropped.

---

## 2. What the re-bake changed, which is only what it should have

```
                        shipped        re-baked
nodes                    11,281          11,284   +3
edges                    12,228          12,231   +3
anchor_splits               575             578   +3
door_links_rerouted           4               5   +1
doors                       656             656
codes in the index          158             158
routable / register     135 / 198       135 / 198
bytes                   348,751         348,868   +117
```

Twenty-five of the thirty `meta` fields are untouched. The three new nodes are
the three new anchor splits: re-anchoring a moved door splices a node into an
existing edge, which is the documented cost and is why two frozen pairs move by
half a metre in §3.

**Routable is 135 of 198, said rather than assumed** — gate H prints
`135 / 198` on the re-baked graph.

---

## 3. The frozen 19-pair regression, and the two rows that moved

```
REGRESSION - 19 frozen pairs, tolerance 5 %
  ...
REGRESSION: PASS (0 bad of 19)          walls 0 on every one of the nineteen
```

Seventeen of nineteen reproduce their frozen baseline to the tenth of a metre.
Two move and **neither is caused by this re-bake**:

```
  GRE>MNC   975.8 -> 991.2   +1.6 %
  JES>MCA   827.2 -> 822.7   -0.5 %
```

`do_regress()` re-bakes in memory and routes that, so it reads the entrance
file, not the shipped graph — it returned these same two numbers on `main`
before this branch existed. They are the NB2 relocations of the Moncrief-Neuhaus
and Moody Center doors, already shipped, landing in a baseline frozen
2026-08-15 before those doors moved. Both are inside the 5 % tolerance, both
audit `walls 0`. **The baselines are stale by a known and measured amount, and
this pass did not re-freeze them** — re-freezing is a decision about which
number is the truth, and it belongs with whoever last touched those two doors.

---

## 4. The bake's own gates

`19 of 19 green` on the re-baked graph. The ones that could plausibly have
broken and did not:

```
  F  >= 95 % of doors linked within 30 m        ok   99.2 %
  G  door links re-routed around a neighbour    ok   5 (cap 20)
  H  routable UT register codes >= 118          ok   135 / 198
  O  worst door link <= 30 m                    ok   27.7 m
  S  every findable entry is routable           ok   0 entries with no anchored door
  T  every West Campus tower routes to WEL      ok   24 of 24
```

`ROUTE FAILURES: 1` — `GRE > MNC`, which is the pre-existing `KNOWN_BAD` entry
about the athletic-complex fence, printed with its written reason. Not new.

---

## 5. A route to each of the eleven, which is the thing that was asked

Routed door-to-door from the nearest of five real origins (`JES`, `PCL`, `GRE`,
`GDC`, `WEL`), then the arrival leg — the unmapped last line from the network
to the door — measured against the door `entrances.geojson` actually draws.

```
  eid   building                           code    route m  arrival  ->drawn  walls
  138   Graduate School of Business        GSB       118.1     0.7 m    0.00 m    0
  281   (unnamed block)                    -         965.2     2.8 m    0.00 m    0
  486   Mezes Hall                         MEZ       261.1     0.5 m    0.00 m    0
  276   (unnamed block)                    -         497.8     1.8 m    0.00 m    0
  285   Brackenridge Hall Dormitory        BHD       226.3     3.2 m    0.00 m    0
  345   South End Zone                     SEZ       990.1     1.3 m    0.00 m    0
  346   South End Zone                     SEZ       501.1     5.2 m    0.00 m    0
  172   Engineering Discovery Building     -         292.8     1.7 m    0.00 m    0
  194   (unnamed block)                    -         700.4    22.4 m    0.00 m    0
  391   (unnamed block)                    -         619.0    22.4 m    0.00 m    0
  38    Jester West Hall                   -          31.1     4.3 m    0.00 m    0

SPOT-CHECK: PASS (0 bad of 11)
```

`->drawn` is **0.00 m on all eleven**: the arrival ends at the door that is
drawn, not at the old position. Four of the eleven carry no register code
(`281`, `276`, `194`, `391` are unnamed blocks with no `ref`), so they were
routed **to the door directly** rather than through a code lookup — a code
route to them does not exist and pretending otherwise would have been the easy
wrong answer.

The two 22.4 m arrival legs on `194` and `391` are long but pre-existing and
inside `DOOR_LINK_MAX_M = 30`; gate O's worst link across the whole graph is
27.7 m.

---

## 6. The arrival-leg property, held two ways

`docs/walk/the-78.md` measured **2,145 arrival legs, 0 crossing a building**,
by driving 143 origins into 15 new buildings — 2,145 *routes*, one arrival leg
each. Both shapes hold here:

```
EXHAUSTIVE — every door -> every one of its anchor nodes
  arrival legs in the graph                 1,648
  legs crossing a building (NOT a roof)         0
  legs passing under a roof or canopy          16   (counted, not a fault)

ROUTE-DRIVEN — the-78's shape, 158 origins x the 11 moved buildings
  routes that completed                     1,738
  arrival legs crossing a building              0
  longest arrival leg                        25.2 m   (AF2 -> Brackenridge, cap 30)
```

The exhaustive number is the stronger one: 1,648 is *every* leg the router
could ever choose, not the subset some sample of routes happened to pick. The
route-driven run is there because it is the measurement the earlier pass made,
and a property is worth more when two different instruments agree.

---

## 7. What this pass did NOT establish

1. **Nothing here was photographed.** Job one is a graph, and the graph is
   checked by geometry against the file the renderer draws. That the *doors*
   are visible is `docs/entrances/relocated.md`'s claim, taken on trust.
2. **The two moved regression baselines were not re-frozen** (§3). They are
   stale against the shipped doors by +1.6 % and −0.5 % and someone should
   decide which number is the truth.
3. **`GRE>MNC` still fails its audit** for the reason `KNOWN_BAD` gives. Not
   looked at again.
4. **The 63 unroutable register codes were not touched.** 135 of 198 is held,
   not improved.
5. **NB5's snapshot question is inherited, not answered** — the walk bake reads
   `manifest.latest` = `2026-08-16` and says so in `snapshot`, but nothing here
   re-checked that against what the app draws.
