# Street lighting on a walking route — what we can know, and what we did with it

Lane `acer/w-lit`, 2026-08-23. Owns `js/wayfind.js` (§6b only),
`scripts/bake_props.py`, `data/walk_lamps.json`, `shots/walk/lit/`, this file.
`js/props.js` read-only. Nothing else in `js/wayfind.js` was touched except four
one-line calls, listed in §7.

Simeon asked for *"streetlights for safety"*. This is what exists to answer that,
what it is worth, and the case for the design that came out of it.

> **ROUND 2 (later the same day) added a second source and it is the more
> important one.** §8 of the first round named its own biggest gap: 193 OSM
> street lamps is obviously an undercount, and somebody should go looking for
> more. Round 2 went looking and found something better than another lamp
> inventory — **the City of Austin's 2017 West Campus Lighting Survey**, in
> which residents dropped 262 pins where they thought a light was needed and
> typed why. It is the only signal in this feature that is about the world
> rather than the map. Everything from §9 down is round 2; §1–§8 are the first
> round's and are unchanged except where a number moved.

---

## 0. The headline, in one paragraph

The scene already draws **236 lights** — 193 OpenStreetMap street lamps and 43
UT blue-light emergency phones — and the router could not see any of them. It
can now. Against the whole walk network, a mapped street lamp within 25 m covers
**9.2 % of the metres**; over 120 random building-to-building routes, **77 of
them (64 %) have not one mapped street lamp anywhere on them**. That number is
the whole argument for the design: a route feature that silently steered by a
signal this thin would be steering by who bothered to map, not by where the
light is. So the default **annotates**, and the lit alternative is **computed,
priced, and offered** — the user takes it or doesn't. When an alternative exists
at all it is a median **2 % longer** for a median **five more lamps**, and the
demo case (KIN → LTH) is **+5 m for seven streetlights instead of zero**, which
is a trade worth putting a button on and not worth taking on someone's behalf.

---

## 1. Where the lights are, and why it is `k:"lit"` and nothing else

`data/props.geojson` carries two prop kinds that matter here, both measured on
this date **[M]**:

| | n | what it is | drawn as |
|---|---|---|---|
| `k:"lamp"` | 532 | tall thin things | a dark pole |
| `k:"lit"` | 236 | a light | a warm/blue pool + bright core |

**Only the 236 are lights.** The other 296 poles are flagpoles, masts, bus-stop
poles, gates, traffic signals and bike repair stands — `k:"lamp"` is a *layer*
("tall thin"), not a claim about illumination. Indexing poles instead of lights
would have put a "lit" claim under a flagpole. Split by colour class, the 236
are:

* **193 warm** — `highway=street_lamp`, every one `src:"osm"`.
* **43 blue** — `emergency=phone`, UT's blue-light call boxes. Counted and shown
  **separately**: a call box is a thing you run to, not a thing that lights your
  path, and folding it into a lamp count would inflate the lamp count with
  something that does not light anything.

There are **zero** procedurally-placed lamps in the shipped file (`rule` is
absent on all 236) — every light in this city is an OSM node someone surveyed.

`data/ground.geojson` has no `lit` tag on any way (confirmed, zero hits), which
is what the brief said; the answer was never in the ways.

### The other light in the scene, and why it is NOT counted

`js/night.js` paints pools of light along the **basemap's** road and path
classes at a fixed spacing (46 / 64 / 70 m by tier) to stop the city reading as
a void after dark. Those pools have no pole under them and no survey behind
them — they are our own decoration. Counting them would be counting our own
scenery back to the user as a safety fact. So they are not counted, and every
sentence the interface says is about the **map** ("mapped", "none mapped",
"OpenStreetMap has"), never about the street.

---

## 2. The number that decided the design

Measured against `data/walk_graph.json`'s 11,773 routable edges (155,763 m),
warm street lamps only:

| radius | edges covered | metres covered |
|---|---|---|
| 20 m | 7.9 % | 6.3 % |
| **25 m** | **10.8 %** | **9.2 %** |
| 30 m | 13.0 % | 10.9 % |
| 40 m | 16.7 % | 14.8 % |
| 50 m | 19.5 % | 17.6 % |

Adding the 43 blue phones takes 25 m to 12.0 % of metres — which is exactly why
they are reported separately rather than blended in: they would nearly double
the apparent "coverage" without adding a single lumen to the pavement.

**25 m is the shipped radius** (`WAYFIND.litRadiusM`). A UT walkway lamp is a
~5 m mast; the scene draws its pool at a 7–9 m ground radius
(`PROPS.litGroundNear`). 25 m is deliberately more generous than the drawn disc,
so the claim is about a lamp being *there*, not about a rendering choice.

### Over real routes

120 random routable building pairs, driven through the real `window.wayfindRoute`
in the real page:

```
mean share of a route's metres with a mapped lamp within 25 m      4 %
routes with ZERO mapped street lamps anywhere on them        77 / 120  (64 %)
routes where a lit alternative exists and clears both gates  13 / 120  (11 %)
   median extra distance of that alternative                       +2 %
   median extra lamps it buys                                       +5
```

---

## 3. The judgement: does it change the route, or only annotate it?

**It annotates by default. It changes the route only when the user presses a
button, and it prints the price before the button.** The case:

1. **64 % of routes have no lamp at all on them.** A default lit-preference
   would do nothing on two routes in three, and on the third it would move you
   onto the corridors where OSM mapping happens to be dense. That is mapping
   coverage wearing a safety feature's clothes. Coverage is 9.2 % of metres —
   this is a *thinner* field than the 1.4 % accessibility coverage that
   `docs/walk/what-we-can-honestly-say.md` §12 already rules unfit to route on.
2. **A longer route after dark has its own cost** — more time outside — and we
   cannot measure the trade between "more mapped lamps" and "twelve more minutes
   alone". A feature that silently makes that trade for a student is making a
   safety decision it has no standing to make.
3. **But refusing to offer it is also a choice made for them.** A student
   deciding at 11 pm may well want the mapped-lamp corridor even on a thin
   signal, and the measurement says that wanting it is usually nearly free:
   median +2 %, and one offer in eight is not longer at all. Hiding a +5 m
   route that goes from zero lamps to seven would be paternalism dressed as
   rigour.

So: the card names what is mapped, names where it runs out, and — when a better
alternative exists inside a hard 35 % detour ceiling and buys at least 40 m of
extra covered walking — offers it with its price in metres and in lamps. Taking
it is one tap. It is deliberately **not sticky**: change the destination, the
stairs toggle or the coffee stop and you are back on the shortest route with the
offer re-priced for the new walk, because a preference that survives a change of
question is a preference nobody asked the new question about.

---

## 4. Verification — the claim against the pixels

House rule: prove the subject is on screen. Every frame below is in
`shots/walk/lit/`, taken through `_harness.html?intro=0&drift=0&walk=1`, graphics
auto-detect cancelled, veil gone, second screenshot of a pair, time-of-day
`p = 0.92`.

Route **ANB → ETC**, 1,738 m, scan: 24 mapped street lamps, 2 emergency phones,
536 m covered (31 %), longest unmapped stretch 678 m.

| frame | what it shows | renderer says |
|---|---|---|
| `anb-etc-walk-lit.png` | walking the **claimed-lit** stretch: the amber route down a sidewalk with lamp poles and their warm pools standing beside it | `wayfind-lit-pad` 1 in frame centre |
| `anb-etc-walk-dark.png` | walking the **claimed-unmapped** stretch, same route, same night: the route is cool grey-blue and there is no pole and no pool anywhere along it | `wayfind-lit-dark` 10 |
| `anb-etc-lamp-close.png` | closer, at a counted lamp: an amber ring on the ground with the pole standing in it | `props-lit` 3, `props-lamp` 3, `wayfind-lit-pad` 2 |
| `anb-etc-gap-close.png` | the same distance into the unmapped stretch | `props-lit` 0, `props-lamp` 0, `wayfind-lit-dark` 8 |
| `anb-etc-pair-air.png` | the transition in one frame: amber where the lamps are, blue-grey where none are mapped, past DKR | — |
| `anb-etc-day-air.png` | the same route by day: the marks step back to a quarter and the route is the ordinary cream ribbon | — |
| `anb-etc-card.png` | the pill at night: "24 mapped streetlights along this route" above the fold, and the card block under it | — |
| `kin-lth-card.png` | the card with no lamps at all: the 1.2 km gap, 4 emergency phones, and the offer with its price | — |
| `kin-lth-swap.png` / `kin-lth-swap-taken.png` | the route before and after taking the lit way — a visibly different corridor, 0 lamps → 7, for +5 m | — |

The pixel check and the layer query agree in both directions, which is the test
that mattered: **where the interface says a lamp covers the path, there is a
pole with a pool standing in the frame; where it says none is mapped, there is
no pole in the frame.**

**A harness trap found doing this, worth the next lane's time.**
`map.queryRenderedFeatures` stops returning `props-lit` *and* `props-lamp*
above roughly 70° of pitch, at every zoom — measured at the same centre:

```
z20.2 pitch 58   lit 16  core 16  lamp 19
z20.2 pitch 80   lit  0  core  0  lamp  1
z21.0 pitch 58   lit 12  core 12  lamp 16
z21.0 pitch 80   lit  0  core  0  lamp  0
```

The screenshot at pitch 80 plainly shows poles, so it is the *query* that fails,
not the renderer. A pitch-80 pose is the natural "standing on the pavement"
pose, so this is exactly where a lighting assertion would be written — and it
would read zero and be believed. Assert at pitch ≤ 62, or assert on pixels.

### Two things the verification turned up that are worth writing down

**a) No graphics preset ever thins the lights the claim is built on.** Props are
density-filtered on a quantile `d`; every one of the 236 `lit` features has
`d ≤ 0.3689`, and the lowest reachable prop density is `0.35 + 0.65 × 0.2 =
0.48` (the Trees slider's own floor). Driven and confirmed at 44 m altitude:

```
preset       lit  lamp  furn   treeDensity
cinematic      8     9    21   1.0
balanced       8     9     9   0.675
performance    8     9     6   0.52
slider floor   8     9     0   0.2
```

Furniture goes to zero; the lights never move. So the claim cannot disagree with
the scene because of a quality setting.

**b) …but the LOD tier can hide the glows at altitude, and its layer list is
stale.** `js/lod.js`'s `fine` tier contains `props-lit`, so above
`renderDistance × 0.45` of camera altitude the glows are hidden — at the
`performance` preset that is 158 m, and a query at 282 m altitude returned
`props-lit: 0` while `props-lamp: 29`. The poles stay, so the claim still has a
visible referent, but the pools do not. **While measuring this I found that the
same `fine` list names four layer ids that no longer exist** — `props-furniture`,
`props-flat`, `props-pole`, `props-construction`, against `js/props.js`'s actual
`props-furn`, `props-lamp`, `props-line`, `props-cons`. The detail-distance
control therefore drops the lamp glow and the art label at altitude but has
never dropped the furniture, the poles, the fences or the construction it thinks
it is dropping. **That is `js/lod.js`, which this lane does not own — it is
written up here and not touched.** §7 has the request.

---

## 5. What the interface says, and why each sentence is allowed

`docs/walk/what-we-can-honestly-say.md` §12 bans "accessible route" on a field
with 1.4 % coverage. Mapped street lighting is 9.2 %. The same argument, only
stronger — being wrong about a staircase costs a detour, being wrong about
safety costs something we are not entitled to gamble — bans this family
outright:

> ~~`Well lit`~~ · ~~`Safe route`~~ · ~~`Safest way home`~~ · ~~`Avoids the dark
> stretches`~~ · ~~`Lit the whole way`~~ · ~~`This route is dark`~~ · and no
> shield, torch or lightbulb icon on a route.

*Reason:* 9.2 % coverage of a 12 June 2026 snapshot, from a source with no
concept of a lamp being switched off, broken, or behind a tree.

Permitted, and shipped verbatim:

* `24 mapped streetlights along this route` / `No mapped streetlight along this route`
* `Longest stretch with none mapped: 680 m`
* `4 emergency phones near this route` / `No emergency phone mapped near this route`
* `A way with more mapped light: 61 m further (5%), 9 streetlights instead of 4`
* `A way with more mapped light, no further: 7 streetlights instead of 0`
* `No way with more mapped light within the extra distance we allow`
* `OpenStreetMap has 193 streetlights mapped in this area, from 12 June 2026.
  Real lighting is denser than that, and a mapped lamp can be out. This is not
  a safety rating.`

Every one is a statement about the map. The one place we describe the world is
to say the map **understates** it — the direction that cannot hurt anyone.

**The date is its own snapshot.** The lights come from the furniture Overpass
caches, `osm3s.timestamp_osm_base` = **2026-06-12**; the path network is
**2026-07-30**. Two different dates for two different facts, and the lighting
block prints its own, read out of `data/walk_lamps.json`, never the graph's.

---

## 6. What was built

**`scripts/bake_props.py --lamp-index`** → `data/walk_lamps.json`, 2.5 KB.
Delta-coded quantised integers, same convention as `walk_graph.json`. It reads
the **shipped** `data/props.geojson` rather than re-baking, for the reason
`reshape()` in the same file already documents (HANDOFF §44: a re-bake without
the City of Austin inventory caches emits a fraction of the shipped file). An
index built from a local re-bake would claim lights the scene does not draw —
the exact failure the index exists to prevent. `props.geojson` is not written.

A separate file rather than reading `props.geojson` at runtime, because props
ship as `data/tiles/props.pmtiles` and the 1.5 MB GeoJSON is **never fetched by
the page at all** — asking for it would be a 1.5 MB download for 236 points.

**`js/wayfind.js` §6b** — all of it inside one commented section:

* `loadLamps()` / `lampGrid()` / `lampsNear()` — fetch, decode, metric hash grid.
* `litScan(route)` — resamples the whole walked polyline (both unmapped door
  legs included: those are real metres in the dark too) every 8 m, classifies
  each step by its midpoint, and returns lit/unlit metres, the distinct lamps
  and phones, the longest unmapped run, and the runs themselves. Memoised.
* `litEdgeWeights()` / `litRemeasure()` / `litAlternative()` — the offered route.
* `litEnsure()` / `litDraw()` / `litRetint()` — three layers of its own.
* `litPillLine()` / `litCard()` / `litSwap()` — the words and the button.
* `window.wayfindLit()` / `window.wayfindLitSwap()` — the test surface.

**How the alternative is searched without a second Dijkstra.** `edgeCost` prices
an edge off `g.W`, the decoded centimetre-length array. A lit-preferring search
is therefore the *same* search over a swapped `g.W` in which every unmapped edge
is `litAltMult` (1.7×) longer than it really is. The swap is synchronous,
restored in a `finally`, and nothing runs between. The answer is then
**re-measured against the true lengths** — a route whose printed distance came
off the inflated array would be lying by exactly the size of the preference.
Both acceptance gates (≤ 35 % longer, ≥ 40 m of extra covered walking) are
checked against the re-measured reality, never against the search's own numbers.

**Three map layers, all new, none shared:**

* `wayfind-lit-dark` — a fill-extrusion strip over the unmapped stretches, 5 cm
  above the ribbon's own top so the two cannot z-fight. An extrusion for the
  same reason the ribbon is one (§6 of `js/wayfind.js`): a 2D line under
  `js/ground.js`'s proud pavement slabs renders nine pixels.
* `wayfind-lit-thread` — the same split **at altitude**. Above `threadFadeZoom`
  the route on screen is the thread, not the ribbon, and the first cut of this
  pass recoloured only the ribbon — so from 600 m up the whole route read as one
  amber line with no lighting in it, at exactly the altitude where you are
  choosing between two ways home. Same width and fade curve, off the same two
  constants, so they cannot drift.
* `wayfind-lit-pad` — a square **ring** at the foot of every counted lamp, in
  that lamp's own colour (`#ffc27a` warm, `#6fa8ff` blue, both taken from
  `js/props.js` so a mark under a lamp is never a second light source). A ring
  and not a filled pad: the lamp already throws its own pool, and an amber blob
  on top of it reads as another lamp. This is the claim's receipt — stand in one
  at night and the pole is in it.

All three ride nightness: a quarter strength by day (you may be planning a walk
you will take at nine), full strength after dark. Measured across the slider:
`fill-extrusion-opacity` 0.225 → 0.792, geometry unchanged (159 dark polygons,
23 rings, 9 dark threadlines at every value).

**Two tuning calls made by looking, both wrong the first time:**

* `litDarkCol` was `#59637a`, which made the *unmapped* stretch the brightest
  thing in a night aerial — the stretch we are warning about looking like the
  one we are recommending. Two steps down in value, still cool: `#39435e`.
* The pill line lived inside `#wf-sub`, which carries `opacity:.62`, and a child
  cannot be more opaque than its parent — so the line meant to be read while
  walking at night came out at 62 % of everything else in the pill. It is now a
  node in the pill itself, and owns its own lifetime.

**Cost.** The index is one 2.5 KB fetch. Per route, `window.wayfindLit()` — a
scan of the drawn route, plus the lit-preferring search, plus a scan of *its*
result — measured over 25 calls across 5 pairs: **min 0.5 ms, median 4.9 ms**,
against the router's own 3.7 ms for the same query. The alternative is only
computed when the card is **open**; a closed pill pays for the scan alone.

**With the ship switch off, none of this exists.** Driven on `index.html` with
no `?walk`: no `wayfind-*` layers in the style, no `wayfind-lit` source, no
button, and `walk_lamps.json` / `walk_graph.json` / `props.geojson` are not
fetched.

---

## 7. Requests to lanes that own other files

Written here rather than made, per CLAUDE.md rule 1.

**a) `js/lod.js` — the `fine` tier list has four dead layer ids.** (Owner of
`js/lod.js`.) `TIERS.fine` names `props-furniture`, `props-flat`, `props-pole`,
`props-construction`. `js/props.js` adds `props-furn`, `props-lamp`,
`props-line`, `props-cons`. Nothing named by those four ids has ever been
hidden, so the detail-distance control drops the lamp glow (`props-lit`) and the
art label at altitude and drops none of the bulk it is aimed at. Exact patch:

```js
    fine: [
-     'props-lit', 'props-art', 'props-art-label', 'props-furniture',
-     'props-construction', 'props-flat', 'props-pole', 'props-canopy',
+     'props-lit', 'props-art', 'props-art-label', 'props-furn',
+     'props-cons', 'props-line', 'props-lamp', 'props-canopy',
      'trees-trunk', 'roofscape-minor', 'tower-detail', 'arts-panel',
```

Do not apply this blind: it will make the `performance` preset visibly emptier
above 158 m altitude, which is the intent, but it wants a before/after aerial
pair before it ships. Consider also whether `props-lit` belongs in `fine` at all
— it is the cheapest layer in `js/props.js` by its own header and the
furthest-read, and dropping the city's street lighting is a bigger visual change
than dropping bollards.

**b) Whoever owns `doorSet()`.** If UT's `Celebrated_Entrances` import lands
(`docs/walk-evidence.md` §B/§G), the door chosen changes and so does the first
and last 30 m of every route's lighting scan. Nothing here needs changing for
that — `litScan` reads `route.geom`, which already includes both door legs — but
the numbers in §2 above should be re-measured after it, because they are
measured against today's doors.

**c) Nobody needs to change anything for this to ship.** §6b is behind
`WAYFIND.litOn` and inside `WAYFIND.on`.

---

## 8. What this pass did NOT establish

* **Whether a mapped lamp is on.** OSM has no state for that and neither do we.
  The copy says so in the block, every time.
* **How much of UT's real lighting is missing from OSM.** 193 street lamps for
  the whole render area is obviously an undercount of a university that lights
  its malls; how big an undercount is unmeasured. UT Facilities may publish a
  lighting layer alongside the `Celebrated_Entrances` FeatureServer that
  `docs/walk-evidence.md` found — not checked, and it is the single highest-value
  follow-up here. Every number in §2 would move.
* **Whether the 25 m radius is the right radius.** It is defended above but it
  is a judgement, and it is one line (`WAYFIND.litRadiusM`).
* **Anything about crime, blue-light response, or how safe a stretch is.** Not
  in the data, not in the interface, not in this document.
* **Tree cover over a lamp.** `data/trees.geojson` could in principle tell us a
  lamp is under a canopy. Not attempted.


---

## 9. The second source: 182 pins where people said it was dark

`docs/walk-evidence.md` §D searched OpenStreetMap for lighting and found street
lamps. `scripts/fetch_city_props.py`'s own header records an earlier search of
the City of Austin's Socrata catalogue for a street-lamp inventory — *"searched
the Socrata catalogue for 'street furniture', 'bench', 'light pole' — zero
results"* — and that is still true. **[M]**, re-run 2026-08-23: five queries
(`street light`, `streetlight`, `lighting`, `light pole`, `luminaire`) against
`api.us.socrata.com/api/catalog/v1?domains=data.austintexas.gov`, all zero.

The city's ArcGIS org is a different catalogue and nobody had searched it.
**[M]**, 2026-08-23: `services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services`
lists **2,172 services**, two of which are `WestCampusLightingSurvey` and
`WestCampusLightingSurvey_2`.

**It is not an inventory of lights. It is the opposite, and that is why it is
worth more.** Layer 0 is 262 points named "Suggested Lighting", each with a
free-text `Comments` field, published by `ATD_Publisher` — the City of Austin
Transportation Department. It is a public-input map: residents dropped a pin
where they wanted a light and typed why.

```
This street isn't lit at all at night
The alleyway here is very dark at night. Makes me feel uncomfortable
San gabriel from 23rd to MLK is very dark
Walking behind 2400 is really sketchy for the most part
There are no street lights on this block
Lots of shrubs and vehicles along the roadway make this section of the sidewalk dark
```
**[M]**, verbatim from the layer, 2026-08-23.

### Provenance and age, stated first because it is the weakness

| | |
|---|---|
| Publisher | City of Austin Transportation Department (`ATD_Publisher`) |
| ArcGIS item | `2dddd24022e64b809188fa15e12a05ee` |
| Created | 2017-09-21 **[M]** |
| Last pin dropped | **2018-01-26** (`editingInfo.dataLastEditDate` = 1516985019079) **[M]** |
| Access | public FeatureServer, no authentication |

**It is eight years old and lights have been added since — that is what the
survey was for.** Every sentence the interface builds on it says so. That is not
a caveat bolted on afterwards; it is the reason the copy is phrased the way it
is (§11).

### The cleaning, and what each filter is for

`scripts/bake_props.py --lamp-index` now also fetches this layer, caches it at
`data/osm_cache/city_wc_lighting.json`, and applies three filters in order:

```
raw pins                                      262
  dropped: outside the survey's own study area  78   layer 1's polygon. The public
                                                     map let people pin anywhere in
                                                     Austin; one landed 6 km north.
  dropped: outside this project's render bbox    0   kept as a filter anyway: a pin
                                                     we cannot fly to cannot be
                                                     verified by looking.
  dropped: somebody testing the form             2   "Test", "te", "vintage" — an
                                                     EXACT-match list, not a substring
                                                     one. The first cut dropped a pin
                                                     whose whole comment was "dark".
shipped                                       182
  ...of which carry the person's own words      100
```

They ride in `data/walk_lamps.json` — the same file, one fetch, 2.5 KB -> **8.9
KB** — under their own keys with their own `dark_source`, `dark_license` and
`dark_as_of`. Two sources with two dates never share one banner.

**One decode bug worth writing down.** `json.load(urlopen(...))` on this
endpoint turns the curly apostrophe in *"This street isn't lit at all at
night"* into U+FFFD. The bytes on the wire are correct UTF-8 (`\xe2\x80\x99`,
checked); the encoding sniff is what loses it. This feature quotes people, so
the fetch now decodes explicitly. Found by grepping the shipped index for
non-ASCII, not by reading the code.

---

## 10. The measurement that justifies carrying an eight-year-old file

All **[M]** on this repo, 2026-08-23, inside the survey's own study-area polygon.

**West Campus is exactly where the lamp layer runs out.**

| inside the West Campus study area | |
|---|---|
| OSM street lamps mapped there | **58** of 193 |
| walk-network metres with a mapped lamp within 25 m | **7.1 %** (4,418 of 61,832 m) |
| walk-network metres within 35 m of a reported-dark pin | **32.6 %** (20,152 m) |

The pins touch **4.6x more of the network** than the lamps do. West Campus after
midnight is the walk this whole feature exists for, and before this the lamp
layer had almost nothing to say about it.

**And the two sources do not fight.**

| pins with a mapped OSM street lamp within... | n | of 182 |
|---|---|---|
| 15 m | 1 | 1 % |
| 25 m | **3** | **2 %** |
| 40 m | 4 | 2 % |

A point dropped at random along the same network sits within 25 m of a mapped
lamp **7.1 %** of the time — that is the coverage figure above, by length. The
pins do it **2 %** of the time, about a third as often as chance. They land
where OSM has no light either, which is exactly what a report of darkness ought
to do. **[D]** from the two **[M]** rows above; n=182, expected around 13,
observed 3.

That is the whole argument for the import in three numbers: the pins are dense
where the lamps are absent, they are not noise, and they say something the lamp
layer structurally cannot.

---

## 11. What it says, and why every sentence survives §5's test

§5 banned "well lit", "safe route" and "this route is dark" on a 9.2 %-coverage
lamp field. **This data licenses a sentence that one never could — somebody
stood on that pavement and said it was too dark — and it licenses it only while
it stays attributed and dated.** So the rule for this family is: *name the
reporter and the year, every time.*

Banned, on top of everything §5 already bans:

> ~~`3 dark spots on this route`~~ - ~~`Dangerous`~~ - ~~`Unsafe`~~ -
> ~~`Avoid this street`~~ - and **any sentence in the present tense about the
> street rather than about the report**.

*Reason:* "3 dark spots on this route" claims to know the street is dark today,
off a file that stopped taking pins in January 2018.

Shipped verbatim:

* `6 spots on this route were reported too dark`
* `No spot on this route was reported too dark`
* `"This entire corner of the GWB building is too dark."`
  `— a resident, City of Austin lighting survey, 2017-18`
* `Nobody was asked about lighting along this route`
* `A way past fewer reported-dark spots: 61 m further (5%), 4 instead of 11`
* `The City of Austin asked West Campus where lighting was needed and 182 pins
  came back in this area, the last on 26 January 2018. Lights may have been
  added since — that is what the survey was for.`

**Three drafting calls worth defending.**

1. **The quote is the point.** A count is a number we produced; *"This street
   isn't lit at all at night"* is a person. It is the only testimony in this
   feature, and it does the honesty work for free — nobody reads a quotation
   mark as a live measurement. `darkQuoteFor` picks the **longest** usable
   comment on the route, not the nearest, because the nearest is usually "too
   dark here", which tells the reader nothing the count above it did not.
2. **"2017-18", not "2018".** The first cut attributed the quote to
   `dark_as_of.slice(0,4)` = 2018, the date of the *last* pin. Nothing records
   which pin came when, so a single year printed under a specific person's
   sentence is a fact we do not have. The range is one we do.
3. **`Nobody was asked about lighting along this route`** exists so that zero
   reports is never read as an all-clear. On a route that never enters the
   surveyed area the count is not printed at all — only the absence of standing
   to print it. This is the whole reason `scan.inDarkArea` exists. The word is
   "area" and not "West Campus" because the polygon ATD drew reaches east over
   Guadalupe onto the campus blocks, and pins landed there (`PAI is too dark
   here`, `MAI is too dark here`, `WEL is too dark here`).

---

## 12. Does it change the route, or only annotate it — round 2's answer

**Still: annotates by default, re-routes only on a button. But the button now
has a second reason to exist, and in West Campus it is the only reason.**

The first round's offered alternative preferred edges with a mapped lamp near
them. West of Guadalupe there are 58 lamps in the whole neighbourhood, so that
preference had almost nothing to bite on — the offer could essentially never
fire on exactly the walk it was built for. `litEdgeWeights` now also charges
`darkAltMult` (1.5x) on an edge within `darkNearM` of a reported-dark pin. The
two multipliers **compound** on an edge that is both unmapped and reported,
which is the right ordering: no light recorded *and* a person saying so is a
worse edge than either alone.

The acceptance gate is now an OR, and this is the substantive change:

```
offer the alternative when it is <= litAltMaxFrac (35%) longer   AND
    (  it gains >= litAltMinGainM (40 m) of lamp-covered walking
    OR it sheds >= darkAltMinDrop (2) reported-dark spots        )
```

**Why an OR and not an AND.** In West Campus a route can shed four reported-dark
spots while gaining no mapped lamp at all, because there are no lamps there to
gain. An AND would have made the new signal decorative.

**The offer names what it actually bought.** `alt.__litWhy` records which gate
fired and the sentence follows it. An offer that says "more mapped light" when
what it did was route around four reported-dark spots would be selling the user
the wrong reason — and the wrong reason is the one they would judge the result
by.

### The A/B, because "it earns its place in the search" is a claim

Same 36 pairs, same page, driven twice through the real `window.wayfindRoute`
with `WAYFIND.darkOn` flipped between runs. Pairs are a campus building code to
a West Campus address, seeded and identical across both runs — the walk home.
Two page loads, because `litEdgeWeights` memoises its weight array on the graph
and there is no hook to drop it. **[M]**, 2026-08-23.

| | lamps only | + reported dark |
|---|---|---|
| routes that produced an alternative at all | **17 / 36** | **25 / 36** |
| ...because it gained mapped lamps | 17 | 17 |
| ...because it shed reported-dark spots | — | **8** |
| median extra distance of an offer | 24 m | **24 m** |
| routes with zero mapped lamps on them | 17 | 17 |
| median reported-dark spots on a route in the surveyed area | — | 8 |

**Eight offers exist that did not exist before, and they cost the same.** The
median offer is 24 m further in both configurations — the new signal is not
buying its extra offers by relaxing the price, because it cannot: the 35 %
ceiling is checked against the re-measured true distance either way. The 17
lamp-driven offers are byte-identical between the runs, which is the control:
adding the second preference did not quietly rewrite the answers the first one
was already giving.

**What did NOT change, and the first round's argument is undamaged.** This is a
2017 self-selected public-input survey. Steering every night walk by it would
optimise for who filled in a form eight years ago. It is offered, priced in
metres, taken by the user, and still not sticky.

---

## 13. Verification — the claim against the pixels, in both directions

House rule: prove the subject is on screen. The test picked its two sites **from
the data rather than by eye**, which is the only way it could have failed
honestly: the pin furthest from any mapped lamp, and the pin nearest one.

| | site | the resident's words | nearest mapped lamp |
|---|---|---|---|
| **agree** | `-97.747965 30.286507` (San Gabriel St) | *"San gabriel from 23rd to MLK is very dark"* | **563 m** — the furthest any pin gets |
| **disagree** | `-97.741670 30.287032` (Guadalupe, by the 7-Eleven) | *"too dim"* | **9.3 m** — the nearest any pin gets |

Plan view, pitch 0, z 20.6, `p = 0.92`, graphics auto-detect cancelled, veil
gone, second screenshot of a pair, hardware GL.

| frame | renderer says | what is in it |
|---|---|---|
| `wc-pole-lamp.png` | `props-lit 1 · props-lit-core 1 · props-lamp 1` | a warm pool with **a dark pole square in the middle of it**, at the exact coordinate of the mapped lamp |
| `wc-pole-nolamp.png` | `props-lit 0 · props-lit-core 0 · props-lamp 0` | **black.** Tree canopy and dark ground. No pole, no pool |
| `wc-agree-plan.png` | `props-lit 0 · props-lamp 0` | the San Gabriel block — dark, and see the caveat below |
| `wc-disagree-plan.png` | `props-lit 2 · props-lamp 1` | the Drag: real lamp pools, with cores |
| `wc-pin.png` | `wayfind-dark-mark 1` | standing at a counted pin: the violet diamond on the pavement, no pole anywhere near it |
| `wc-card.png` | — | the card: count, quote, attribution, both source lines |

**The claim matches the scene in both directions.** Where the index says a lamp,
the scene stands a pole in a pool. Where it says none for 563 m, the frame is
black. And at the one place the two sources look like they disagree, they do
not: the resident wrote *"too dim"*, not "no light" — a lamp being present and
being too dim are both true at once.

### The one real mismatch, and it is ours, not the data's

`wc-agree-plan.png` shows **two soft warm glows on a street where nothing is
mapped**. They are not lamps: `props-lit 0`, `props-lamp 0` in that frame, and
cropped at 3x the glow has **no pole and no bright core** — compare
`wc-pole-lamp.png`, where both are unmistakable. They are `js/night.js`'s
decorative pools, painted at fixed spacing along the basemap's road classes so
the city does not read as a void after dark. §1 already refuses to count them,
and that is right.

**But a person flying there sees light on a street the card calls unmapped.**
The card is defensible — every sentence is about the map, and it says the map
understates reality. The *scene* is what creates the impression. Naming it
rather than leaving it to be found:

* it is not a defect in this lane's claim, and no number here moves;
* it is a real reason a user could believe the feature is wrong;
* the fix, if Simeon wants one, is in `js/night.js`, which this lane does not
  own: either give the decorative pools a visibly cooler falloff than a surveyed
  lamp's, or fade them while a walking route is on screen. §14 has the request.

### A trap, and what it cost

`page.evaluate((ll) => window.__map.jumpTo({...}), ll)` — an **expression-bodied
arrow returns the Map**, and Playwright then tries to serialise that whole
cyclic object graph across CDP. The call never returns, the run dies at the
watchdog with no error, and nothing is written. **Two full runs, about
twenty-five minutes.** Braces are load-bearing:

```js
page.evaluate((ll) => { window.__map.jumpTo({ ... }); }, ll)
```

Worth adding to `scripts/verify/README.md`'s trap list by whoever owns it.

Second, smaller: these screenshot passes run on **hardware GL**
(`launch(chromium, { gl: 'hardware' })`), which the README already sanctions for
screenshot scripts. On SwiftShader the page's main thread stayed saturated long
enough that even a bare `jumpTo` took minutes to return. No assertion in this
pass depends on exact hex, so determinism is not being traded away.

### And a mistake of mine, recorded because it cost somebody else

Clearing a stalled run I used `taskkill /F /IM node.exe`, which killed **every**
node process on the machine — including a sibling lane's browser run that was
mid-flight. The brief says not to run `reap.mjs` because siblings are live; this
was worse. The right move, used for every kill after it: match the command line
first (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`) and stop only
your own PID.

---

## 14. Requests to lanes that own other files (round 2)

Written here rather than made, per CLAUDE.md rule 1. §7's two requests still
stand; these are new.

**d) `js/night.js` — the decorative pools versus a surveyed lamp.** (Owner of
`js/night.js`.) See §13. The pools have no pole and no survey behind them, but
at a walking camera they read like street lighting, on streets this feature is
telling the user have none mapped. Nothing here needs it to change — but if it
should, the cheapest version is a cooler tint and a flatter falloff for the
decorative pool so the two are distinguishable at a glance, which is a taste
call for Simeon, not an execution one.

**e) `scripts/bake_walk.py` — nothing is wrong, and here is the near-miss.**
While picking demo endpoints this lane decoded `walk_graph.json`'s `wc` register
as node indices and got nonsense: "21 Rio" 800 m from 21 Rio, every West Campus
address collapsed into one blob south of MLK. It was about to be written up as a
defect. **`wc` maps a name to DOOR indices** (`js/wayfind.js:846`), and decoded
that way every one of the 24 addresses lands correctly. No bug — but the file's
own `_format` string documents `n`, `e`, `re`, `d` and not `wc`/`code`/`poi`, and
one line saying which array those index would have saved the trip.

---

## 15. What round 2 did NOT establish

* **Whether any given reported-dark spot is still dark.** It is a 2017 report.
  The whole survey existed to get lights installed, so the best case is that
  many of these are fixed. Nothing in the interface claims otherwise, and the
  attribution line says it in as many words.
* **Who did not fill in the form.** A self-selected public-input map measures
  who answers surveys as much as it measures darkness. The blocks with no pins
  are not blocks with no problem; they may be blocks with nobody who saw the
  map. This is the honest ceiling on the whole source and it cannot be measured
  from inside it.
* **Whether `darkNearM` = 35 m is the right radius.** It is defended in the
  constant's comment — a pin is a finger on a phone map describing a stretch of
  street, not a survey point — but it is a judgement and it is one line.
* **Whether UT Facilities publishes campus lighting.** Checked the UT ArcGIS org
  (123 services) and there is no lighting layer; the closest are
  `Emergency_Phones_view` and `Sure_Walk_view`. Still unchecked: whether UT
  publishes it anywhere else. §16.
* **Anything about crime.** Not in the data, not in the interface, not here.

---

## 16. Two more UT layers found while looking, not used, worth someone's round

Both **[M]**, live 2026-08-23, from the same UT ArcGIS org
(`services9.arcgis.com/w9x0fkENXvuWZY26`) that `docs/walk-evidence.md` §B found
the entrance data on. Neither is in this lane's scope; both are better leads
than another lamp hunt.

**`Emergency_Phones_view` — 116 rows, and the app counts 43.** UT's own survey
of its blue-light phones, with `Status` (109 `Reviewed`, 3 `Inactive`),
`DeviceLocation` (EXT/INT) and a written `Description` per phone
(*"located southwest of San Jacinto Garage (SJG) along San Jacinto Blvd near the
intersection of 24th Street"*). The app's 43 come from OSM `emergency=phone`.
**This lane deliberately did not import them**, and the reason is the same rule
that governs everything above: the scene draws 43 blue posts, and a card
claiming 116 would be a claim about lights the renderer does not stand. Importing
them properly means putting them in `data/props.geojson` so they are *drawn* —
which is `bake_props.py`'s main path, and HANDOFF §44 says that path cannot be
re-run here without the City of Austin inventory caches. That is a whole task,
and it is a good one.

**`Sure_Walk_view` — the UT night walking escort.** Five polygons: one pickup
zone, four drop-off zones, with `Phone_Number` (512-232-9255) and
`Home_URL` (`parking.utexas.edu/transportation/walking`), and the note
*"If you are on campus late and have concerns about your safety getting home,
students, faculty, and staff can request Sure Walkers for assistance."* For the
question Simeon actually asked — streetlights, for safety — the most useful
thing this project could say to a student at 1 a.m. may not be a lamp count at
all. It may be that somebody will walk with them, free, and here is the number.
That is a UI call and belongs to whoever owns the card, not here.
