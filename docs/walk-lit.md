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
>
> **ROUND 3 stopped adding sources and audited the claim instead.** Rounds 1
> and 2 checked it at six places they picked themselves. Round 3 wrote an
> instrument that picks the places — 43 sites off 12 real routes, a confusion
> matrix, committed next to its output — and it came back clean in the
> direction that matters: **no site this card calls unmapped has a street lamp
> standing in it.** Then the two sites it could not explain turned out to have
> a live oak sitting on the lamp, which is now a field in the index and a
> sentence in the card, and which was measured *out* of the router rather than
> argued into it. §17–§24, and they are the sections to read first.

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

---

# ROUND 3 — the claim, audited over a sample instead of six places; and the
# thing the audit found that nobody had looked for

Rounds 1 and 2 verified this feature's claim at six sites they chose themselves,
two of them deliberately extreme. Six frames chosen by the author is an
anecdote, and the question being asked of this lane — *does the lit/unlit claim
match the lamps actually present in the 3D scene at that location* — has a
proper form: a confusion matrix over sites a script picked.

Round 3 built that. The matrix is in §18. It came back clean, and then the two
places it did NOT come back clean turned out to be the interesting part: **a
counted street lamp with a live oak standing on top of it.** That is now a
field in the index, a sentence in the card, and — after being A/B'd over sixty
routes — deliberately *not* a term in the router. §20 and §21.

Everything here is reproducible: the three scripts are committed next to their
output in `shots/walk/lit/`, which rounds 1 and 2 did not do.

---

## 17. The instrument, and the four ways the first cut of it was wrong

`shots/walk/lit/litaudit.mjs`. One page load, night (`p = 0.92`, asserted, not
assumed), graphics auto-detect cancelled, veil gone, hardware GL. It routes
twelve fixed building pairs through the real `window.wayfindRoute`, samples
sites off the classified geometry `litScan` itself produced, flies to each one
and reads three instruments: `queryRenderedFeatures`, a framebuffer, and a
masked framebuffer.

**It is worth reading the four things that were wrong with it first, because
each one produced a confident, plausible, false number, and three of the four
would have survived into this document.**

**a) The frame was not the claim.** The first pose was pitch 55 at z19.4 — the
walking pose, the obvious choice. At that pitch the frame sees several hundred
metres up the street, so two sites reported *"said none is mapped, and a lamp
IS on screen"* when the lamp was three hundred metres away and had nothing to
do with the stretch being described. A claim about a 25 m disc has to be
measured on that disc. Every pose is now plan view with the site dead centre and
a zoom chosen so the disc is a circle of known pixel radius about the frame
centre — which also makes WebGL's bottom-left origin irrelevant, because a
circle about the centre is the same circle either way up. **The disc is drawn on
every saved frame**, so a picture shows the window its own number came from.

**b) Counting coloured pixels is not the same as counting a layer.**
`night-lamps.mjs` marks the light layers in flat primaries and counts only
pixels that CHANGED between the two frames; this script dropped the diff and
counted green pixels directly. Night tree canopy is green-dominant. One site
came back with 423 "surveyed lamp" pixels and zero `props-lit` features in the
same disc, on the run where that bug was live. The diff is back, and the two frames are now taken back to back at
one pose with the mask restored after every site.

**c) `props-lit` is two different facts wearing one layer.** It carries the 193
warm street lamps *and* the 43 blue emergency phones, and this card counts those
separately on purpose — a call box is a thing you run to, not a thing that
lights the pavement. Painting the layer one colour produced three more
*"said none is mapped, a lamp IS on screen"* reports, every one of them a blue
phone the card had already counted correctly in its own sentence. The mask now
splits on the `c` property.

**d) …and even split, the classifier leaked, until the data said where.** Two
sites still showed warm-lamp pixels with no warm lamp within 260 m. Looking at
the channels rather than the totals: `green: 0, cyan: 53, blue: 1818` — a blue
phone's glow composited over green canopy reads cyan, and cyan is the warm
lamp's *core*. So the rule is not "green or cyan": **a warm lamp is present when
its POOL is**, `props-lit` green. Measured, the two populations do not overlap
at all — every one of the seventeen real lamps has green ≥ 691 px, and all three
phone-only sites have green = 0.

All four were caught by looking at a frame or at the raw channel counts. None
would have been caught by reasoning about the code.

---

## 18. The matrix

43 sites off 12 real routes: 19 where `litScan` classified the stretch as
covered by a mapped lamp, 24 where it classified it as unmapped **and** the
nearest counted lamp is more than 60 m away — clear of the 25 m boundary on
purpose, so the sample tests the claim rather than the arithmetic either side of
it. Sites are drawn with a fixed seed from `runsAt`, which is `litScan`'s own
classified geometry, so a camera stands exactly where the claim was made.

Pose: plan, `p = 0.92`, z19.8, hardware GL, graphics auto-detect cancelled, veil
gone. The map's canvas ran at a 0.75 device scale on this run, so the 25 m disc
is **253 device pixels of a 960 × 600 buffer** — the script measures it through
the map's own `project()` at the site rather than from a formula, and asserts it
fits the frame, so a different device scale changes the pixel totals below and
not a single verdict.

| what the card said | sites | a warm lamp on screen | a blue phone | any decorative glow | decoration as bright as a real lamp | nothing lit at all |
|---|---|---|---|---|---|---|
| a lamp within 25 m — **"lit"** | 19 | **17** | 0 | 17 | 2 | 0 |
| none within 60 m — **"unmapped"** | 24 | **0** | 3 | 10 | 5 | 13 |

The classes do not merely separate, they do not touch: every one of the 17 real
lamps put down **at least 691 green pixels**, and **every single "unmapped" site
put down exactly 0.** There is no threshold to argue about.

**Read it in the direction that matters.** The claim this feature makes is
about *mapped* lamps, and against the scene it is exact:

* **No site the card called unmapped has a warm street lamp standing in it.**
  Zero false "dark". The three blue phones that show up there are counted by a
  different sentence in the same card, and that sentence is right too.
* **Every "lit" site has the lamp the index claims** — verified two ways, see
  below. Zero invented lamps.

The two "lit" sites where no lamp pixel survived are not the index being wrong.
They are §20.

**The frames, every one with its own measurement window drawn on it.** Base and
`-mask` pairs at eight sampled sites (`r2-site-NN-{lit,unmapped}.png`), plus a
frame for every site that failed or glowed, taken whether or not the random draw
picked it — a failure nobody can look at is a number, and this house does not
ship those. Worth opening first:

* `r2-site-20-unmapped.png` — a brick path between buildings, trees, and inside
  the ring nothing at all. This is what "no mapped streetlight" looks like when
  it is true, which is 13 of the 24.
* `r2-site-05-lit.png` / `-mask.png` — the same disc with a lamp in it, and the
  mask showing the pool is `props-lit` and not something else warm.
* `r2-flag-decorloud-2.png` — §22 in one picture: a warm glow inside a disc the
  card calls unmapped, with no pole under it and no bright core.
* `r2-flag-nolamp-0.png` and `r2-occl-4.png` — §20.

---

## 19. What the tiles carry, and the one honest caveat about altitude

`data/walk_lamps.json` is republished from `data/props.geojson`; the page never
fetches that GeoJSON — it streams `data/tiles/props.pmtiles`. Two files, two
bakes, and nothing in this repo checked that they agree. Now something does.

**At walking zoom they agree exactly.** Flown to a seeded random sample of 30 of
the index's own lamps at z19.8 and asked what the props source decodes there:
**30 of 30 within 3 m.** No lamp the card counts is missing from the scene where
a walker would be standing.

**At planning zoom they do not, and that is worth saying out loud.** A zoom
ladder over four anchors (campus core, West Campus, the Drag, south campus):

| zoom | share of the index's lamps in view that the tiles carry |
|---|---|
| 15.0 | **33–43 %** |
| 16.0 | 100 % |
| 17.0 | 100 % |
| 18.0 | 100 % |
| 19.4 | 100 % |

So `props.pmtiles` drops points below about z16, the way every vector tileset
does. Nothing is stale and nothing is broken — but **a user who reads "24 mapped
streetlights along this route" and then pulls back to see the whole walk is
looking at a third of them.** This lane's own `wayfind-lit-pad` rings are drawn
from the index rather than from the tiles, so the receipt stays complete when
the poles thin out; that is now a reason the pads exist rather than a
coincidence. Nothing was changed for this. It is written down because it is the
one place the count and the picture legitimately disagree, and the next person
to notice should find it here rather than rediscover it.

---

## 20. A live oak on top of a street lamp

Two of the nineteen "lit" sites had a lamp by every instrument except the one
that matters: `queryRenderedFeatures` reported `props-lit: 1` inside the disc,
and the night frame had no lamp pixel in it at all.

**The probe.** Hide the layers that could be standing over it, read the same
frame again, and see whether the lamp appears. It did — about 2,950 pixels at
both sites. But that first probe hid trees *and* buildings *and* ground in one
go, which is a bundle, not an attribution, and a bundle is how a fix gets
shipped for the wrong layer. `shots/walk/lit/occluder.mjs` hides one family at a
time:

| hidden | lamp pixels in the disc, site A | site B |
|---|---|---|
| nothing (as shipped) | **0** | **0** |
| buildings (41 layers) | 0 | 0 |
| ground (24 layers) | 0 | 0 |
| **trees (4 layers)** | **3,285** | **3,282** |

Trees, entirely. `shots/walk/lit/occl-flag-A-shipped.png` and
`occl-flag-A-no-trees.png` are the same pose one second apart: in the first the
disc is empty, in the second a masked lamp is burning in the middle of it.

**And `data/trees.geojson` says the same thing independently.** Both lamps are
4.93 m heads sitting under a stack of canopy shells of radius 10.3 m centred
within a metre of them, reaching 12 m. A big cedar directly over a street light.
Across the whole city that is **56 of 193 warm street lamps — 29 %.**

That is not a rendering curiosity. A campus lamp under a live oak is a real
thing a student walks under, and it throws a fraction of its light onto the
pavement. The pixel audit went looking for whether the claim matched the scene
and found a fact about the city instead.

### What shipped

`scripts/bake_props.py --lamp-index` now reads the same `trees.geojson` the
renderer draws and emits `warm_canopy[i]` alongside `warm[i]` — 1 where the lamp
stands inside a canopy disc that reaches its own head. Two named constants,
`CANOPY_MARGIN_M` (0, so the lamp must be inside the disc the renderer actually
draws) and `CANOPY_REACH_SLACK_M` (1 m, because both heights are modelled rather
than surveyed). Widen the margin and the count rises — measured, 0 m → 56 lamps,
1 m → 77, 2 m → 87.

`litScan` counts them per route. The card says, under the count and never
instead of it:

> `24 mapped streetlights along this route`
> `4 of them are under tree cover`

**It is counted, never deducted.** A lamp under an oak is still a lamp, and
subtracting it would be a claim about how much light reaches the pavement, which
nobody here has measured. The sentence survives §5's test for the same reason
every other permitted sentence does: it is about the same map and the same scene
as the count above it, it is checkable by flying there and looking up, and it
can only make a counted lamp sound like *less* light, never more.

Banned alongside the rest: ~~`these lamps are blocked`~~ ·
~~`the trees make this dark`~~ · any present-tense claim about light reaching
the ground.

### The test that could have failed, and did once

`shots/walk/lit/canopy.mjs` picks the covered lamp and an uncovered lamp **from
the data, on the same route**, and takes two frames at each: as shipped, and
with the tree layers hidden. A flag worth printing has to separate them.

| lamp | pose | as shipped | trees hidden | revealed |
|---|---|---|---|---|
| covered | plan | 17,337 | 17,989 | **+652** |
| covered | eye (pitch 58) | 5,055 | 5,203 | +148 |
| clear | plan | 3,050 | 3,050 | 0 |
| clear | eye | 1,923 | 1,967 | +44 |

**800 revealed at the covered lamp against 44 at the clear one.** PASS.

The first run of this script reported FAIL — and it was the script, not the
flag. It counted "any bright warm pixel", and `js/night.js`'s decorative road
pool is also bright and warm and was drowning the thing being measured. Masking
`props-lit` flat green, the way `occluder.mjs` had done from the start, made the
separation obvious. *Two scripts measuring the same fact and disagreeing is the
cheapest bug detector in this whole harness.*

---

## 21. Does it change the route? No — and that is a measurement, not a preference

The obvious next move was to teach the search about it: charge more for a
stretch whose only light is under a tree, so the offered alternative leans to
the open one. It was written, at `litCanopyMult = 1.25` — between 1 (as good as
open light) and `litAltMult` (as bad as no lamp at all), which is where the
truth sits.

Then it was A/B'd. `shots/walk/lit/canopy-ab.mjs`, 60 seeded building pairs
drawn from the codes in `data/entrances.geojson`, every pair routed twice:

```
routed pairs                                    60 / 60
...carrying at least one tree-covered lamp      12
offers made at litCanopyMult 1.25               17
offers made at litCanopyMult 1.0                18
routes where the OFFER differs                   1
...of those, routes that had a covered lamp      0
```

**It does nothing where it was aimed and one thing where it was not.** Zero of
the twelve routes that actually carry a covered lamp changed. The single route
that changed had no covered lamp on it at all — and it changed for the worse:
at 1.25 it lost an offer that 1.0 makes, 1,201 m with ten mapped streetlights.
The multiplier reshaped the search space around the route rather than the route.

**So it ships at `litCanopyMult: 1`, which is off.** The canopy count is
verified and worth *saying*; it is not verified to be worth *routing by*. A term
in a cost function that provably moves nothing should not ship steering
anything, however good the reasoning behind it — and the reasoning here was
good, which is exactly why it needed the A/B. One line raises it to 1.25 if
Simeon disagrees, and the count in the card is identical either way.

This is the same answer rounds 1 and 2 gave, arrived at the same way: **the
feature annotates; it re-routes only where a measurement says the alternative is
real, and only when the user presses the button.** The lamp preference earns its
place in the search (17 offers over 60 pairs). The reported-dark preference
earns its place (§12). The canopy preference did not, and was measured out
rather than argued out.

### An A/B that measured nothing, first

Worth recording because round 2 wrote the warning and round 3 walked into it
anyway. `litEdgeWeights` memoises its weight array on the graph; §12 of this
document says so and says "two page loads, because there is no hook to drop it".
Round 3 read that, wrote a single-page A/B, flipped the constant between runs
and got a clean `0/12 offers differ` — from a second run that was answering with
the first run's array. A note is not a guard. There is now a hook,
`window.wayfindLitReprice()`, in §6b's test surface, and both A/B scripts check
its return value before believing anything, because a hook that quietly is not
there looks exactly like a clean null result.

---

## 22. One line for the glow that is not a lamp

§13 of round 2 found that `js/night.js` paints soft warm pools along road
classes that have no pole under them and no survey behind them, named it as a
real reason a user could think this card is wrong, and left it — correctly, as
a request to a lane that owns that file.

The audit measured it. Inside the 25 m disc, at the sites this card calls
unmapped:

```
any decorative glow at all                      10 / 24
decoration as bright as a real street lamp       5 / 24
decorative footprint, px   p25 0 · median 1 · p75 385 · max 7,787
```

"As bright as a real lamp" is calibrated against this run's own lamps — half the
median footprint a surveyed lamp puts inside the same disc at the same zoom
(1,685 px, so the bar is 843), not a number picked by hand. So **one time in five, a user who flies
down to check a stretch the card calls unmapped is looking at something that
reads exactly like a street light, and is right to wonder.**

The card is still defensible sentence by sentence — every one is about the map,
and the provenance line already says the map understates reality. But "our copy
is technically correct" is a poor answer to a person looking at a light. The
cheapest honest answer available to a lane that does not own `js/night.js` is to
say so, once, at the bottom with the other provenance and only after dark:

> `The soft glow along roads after dark is scenery, not mapped light. Every
> counted lamp has a ring drawn at its foot.`

The second sentence is the useful half: `wayfind-lit-pad` already draws a ring
at every counted lamp, so a glow without a ring is a glow this card did not
count — and now the user has been told how to tell. Behind `WAYFIND.decorNoteOn`,
one word to drop. §14's request to `js/night.js` still stands and is still the
better fix.

---

## 23. What round 3 changed

* `scripts/bake_props.py` — `canopy_cover()`, and `warm_canopy` /
  `n_warm_under_canopy` in `data/walk_lamps.json`. 9.5 KB, up from 8.9.
  `props.geojson` still untouched.
* `js/wayfind.js` §6b only — decode the flag; `lampsUnderCanopy` /
  `lampsInClear` on the scan; the canopy line and the decoration line in the
  card; `litCanopyMult` (shipped off) in `litEdgeWeights`; `runsAt` and the
  canopy fields on `window.wayfindLit()`; and `window.wayfindLitReprice()`.
  Two new named constants and one new switch, all in the constants block.
* `shots/walk/lit/litaudit.mjs`, `canopy.mjs`, `canopy-ab.mjs`, `occluder.mjs`
  — committed, not left in a scratchpad, so the next round argues with the
  method instead of rebuilding it.

## 24. What round 3 did NOT establish

* **How much of UT's real lighting is missing from OSM.** Round 1 called this
  its own biggest gap and round 3 went looking properly: the City of Austin's
  ArcGIS org (2,172 services, searched for light/lamp/luminaire/pole/Austin
  Energy), ArcGIS Online's public catalogue, and `data.austintexas.gov`'s
  Socrata catalogue on eight queries. **There is no public streetlight inventory
  for Austin.** The only light-adjacent layer in the city org is
  `pole_attachments`, which is 1,218 telecom attachments on traffic-signal
  poles, no lighting. So the undercount cannot be measured from public data, and
  the card's "real lighting is denser than that" stays a direction-only claim,
  which is the only form it is entitled to take. That closes the question rather
  than answering it.
* **Whether a canopy-covered lamp is meaningfully darker on the ground.** The
  flag says a tree is over the lamp. It does not say how much light gets past
  it, and neither does anything in this repo.
* **Whether 29 % is the right count.** It is the count at `CANOPY_MARGIN_M = 0`,
  which is the strictest reading and the one that matches the picture. One line.
* **Anything at all about crime, response times, or how safe a stretch is.**
  Unchanged, and it will stay unchanged.

---

# ROUND 4 — the block the claim is printed in, and the band the audit skipped

Rounds 1–3 verified the lighting CLAIM against the scene at six sites, then at
forty-three. None of them ever looked at the card. Simeon's brief for this
feature ends *"The UI should be outstanding for the walk feature"*, and three
rounds of careful, honest prose had made the lighting block the longest thing in
the app that nobody would read.

Round 4 photographed it, measured it, rebuilt it around a picture, and then went
back to the one part of round 3's matrix that was chosen to be easy.

---

## 25. What the block actually looked like

`shots/walk/lit/cardshot.mjs` — committed, with its before and after JSON. It
opens the card at night, walks the card's own children from the `Street
lighting` heading, and measures the block: pixel height, share of the card,
rendered lines, words on screen. **[M]**, 2026-08-23, 1280 × 900, `p = 0.92`.

| | height | share of the card | lines | words |
|---|---|---|---|---|
| ANB → ETC | 252 px | 54 % | 13 | 105 |
| GDC → The Castilian | 312 px | **59 %** | 16 | **162** |
| PMA → WEL | 232 px | 52 % | 12 | 99 |

`shots/walk/lit/cardfull-before-GDC-TheCastilian.png` is the picture, and it is
the argument. The walk home into West Campus — the walk this whole feature
exists for — printed **`No mapped streetlight along this route`** in the same
grey, at the same size, in the same weight as three paragraphs of provenance
below it. Eight of those twenty lines were sourcing. Every sentence was honest
and every sentence had the same standing, which is the same as no sentence
having any.

**The consequence is not aesthetic.** Copy nobody reads is not a caveat. The
three source paragraphs were the longest text in the app and therefore the
least-read, so the honesty they carry was, in practice, not being delivered.

---

## 26. What it looks like now

`shots/walk/lit/cardfull-after-GDC-TheCastilian.png`, `card-after-ANB-ETC.png`,
`card-after-CMB-TMM.png`. Same instrument, same routes, same night:

| | height | share | lines | words on screen | behind one tap |
|---|---|---|---|---|---|
| ANB → ETC | 195 px (−23 %) | 48 % | 10 | **67** (−36 %) | 52 |
| GDC → The Castilian | 240 px (−23 %) | 53 % | 13 | **87** (−46 %) | 90 |
| PMA → WEL | 195 px (−16 %) | 48 % | 11 | **63** (−36 %) | 52 |

Nothing was deleted. Three things changed.

**a) The strip.** The whole walk, left to right: amber where a mapped street
lamp is within `litRadiusM`, cool where none is, a violet tick at every spot
somebody reported too dark, `START` and `DOOR` under the ends. It answers the
question the numbers structurally could not — **where**. `Longest stretch with
none mapped: 700 m` is true and cannot distinguish a 700 m gap in the middle of
a walk from a 700 m gap at your door, which are the same sentence and two
different walks.

**b) One headline instead of six equals.** The count is 13 px and coloured; the
canopy split and the near-miss ride *on* it as clauses rather than under it as
lines; the longest-gap and emergency-phone sentences share one row, joined by a
middot and otherwise verbatim.

**c) The provenance folded, with its warning promoted.** The three dated
paragraphs sit behind one always-visible line:

> `▸ Mapped lamps only, and not a safety rating — where these numbers come from`

The two disclaimers that must never be behind a tap are in the label. Every
source line, every date, and the decoration note are unchanged one tap away.
`litProvenanceFold: false` prints all three in full again.

---

## 27. The strip is a schematic, so it was tested as one

`litStripMinFrac` floors the width of a short run so one lamp on a 2 km walk is
a visible mark rather than a rounding error. Every floor is a small lie, and on
a fragmented route the floors compound. **If they compounded upward the
prettiest thing in this block would also be the only part of it that overstates
light** — the one direction this feature has spent three rounds refusing to be
wrong in.

**`shots/walk/lit/strip-truth.mjs`** — 40 seeded building pairs, amber share
read off the laid-out DOM (`getBoundingClientRect` on the segments, colour read
back with `getComputedStyle`, not assumed from the loop that built them),
against `litM / totalM`. **[M]**

```
strip amber share MINUS true lamp-covered share
  min -0.22%   p25 -0.02%   median 0.00%   p75 0.00%   max +0.05%
routes where the picture shows MORE light than the count:  0 / 40
most fragmented: TSC->ETC, 15 runs over 1,429 m -> strip 37.42% vs true 37.51%
reported-dark ticks equal the printed count on all 22 routes that have any
```

The first cut of this compared against `lit.pct`, which the test surface rounds
to a whole percent — so the tolerance and the instrument's own noise floor were
the same size and the gate could not fail by less than it could not see. Taking
the truth from `litM/totalM` (metres, ±1 in ~1,500) dropped the noise to 0.07 %
and left the gate something to catch.

**And the ratio is the easy half.** The strip's real claim is about *position*,
and position is exactly what a floor distorts.
**`shots/walk/lit/strip-scene.mjs`** does what a person does: put a finger on
the widest amber block and the widest cool block, read its left-to-right
fraction as a fraction of the walk, go and stand there at night, and look. Plan
view, site dead centre, `p = 0.92` asserted, hardware GL, `props-lit` and
`props-lit-core` masked flat and diffed against the unmasked frame, the 25 m
disc measured through the map's own `project()` and drawn on every saved frame.

Eight routes, **12 readings at 12 distinct places** (deduplicated by
coordinate — the first cut used ANB→ETC and TSC→ETC and both routes' widest
amber run is the *same* stretch of the tail into ETC, so two "independent" sites
were one point measured twice):

| what the finger was on | sites | warm-lamp pool pixels in the 25 m disc |
|---|---|---|
| **amber** | 4 | 10,394 · 3,130 · 2,287 · 2,257 |
| **cool** | 8 | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 |

The populations do not touch — the same result round 3's matrix got, on a
surface that did not exist when round 3 ran. `r4-strip-WEL-amber-disc.png` is a
lamp with a bright core, its warm pool, and this lane's square receipt ring
around its foot, inside the drawn disc. `r4-strip-GAR-cool-disc.png` is the same
disc with tree canopy, a cool route strip, and nothing else.

### Three instrument bugs, all of them mine, all found by looking

Recorded because each produced a confident number and two of them flattered the
change.

1. **The measurement counted the drawer.** A collapsed element has zero client
   rects, and the first cut scored that as `|| 1` line and all of its words — so
   the round-4 block came back with *more* words than the round-3 block it had
   just cut eight lines out of.
2. **A line is a row, not a box.** The second cut counted `getClientRects()`
   directly, and the strip's fifteen flex segments registered as fifteen lines
   of text. Adding a picture appeared to make the block longer to read. Distinct
   rect *tops* is the count that means what the word means.
3. **The card was standing in front of the evidence.** `strip-scene.mjs` first
   measured pixels through the open route card, which covers the middle of a
   960 × 600 frame and most of the 25 m disc. It *passed* — the amber sites had
   lamps outside the card's footprint — but a cool site whose lamp was behind
   the card would have read zero green and been recorded as a clean pass. With
   `#wf-root` hidden the amber sites went 7,328 → 10,394 green pixels and the
   cool sites stayed at exactly 0. **An occluded instrument that happens to
   agree with you is the worst kind.**

And one trap worth the next lane's time, the same family as §13's:
`new Promise(r => map.once('idle', r) || setTimeout(r, 3000))` looks like a
fallback and is not one — `once` returns the Map, which is truthy, so the
timeout never arms and a frame that never idles hangs the run until the
watchdog. Cost one five-minute run.

---

## 28. The band round 3 chose not to look at

Round 3's matrix sampled "unmapped" sites only where the nearest counted lamp is
**more than 60 m away**, *"clear of the 25 m boundary on purpose, so the sample
tests the claim rather than the arithmetic either side of it."* That is a fair
thing to do, and it means the clean result was obtained on the easy half. The
hard half is 25–60 m: places the card calls unmapped with a mapped lamp standing
just off the radius, which is exactly where a user goes looking and finds one.

**`shots/walk/lit/boundary.mjs`** — nearest-lamp distance computed in node
against the *shipped* `data/walk_lamps.json` (not a re-derivation), 18 sites off
8 real routes inside the band, same night pose, card hidden. **[M]**

```
a warm street lamp is somewhere in the night frame        9 / 18
...its pool reaches inside the 25 m disc itself           5 / 18
nearest-lamp distance   min 25.2 m   median 28.9 m   max 56.2 m
```

**Half the time, at a place this card calls unmapped, you can see a street
lamp.** The card is right — its claim is about 25 m — and it is right in a way
that will get it called wrong.

### The fix is a clause, and deliberately not a wider radius

Raising `litRadiusM` to swallow the band would inflate every coverage figure in
this feature and make "covers the path" mean a lamp across a lawn. The radius is
defended on what a 5 m mast throws (§2) and it stays at 25 m.

Instead the scan counts the ring outside it — `litNearMissM: 50`, on its own
hash grid, because `lampsNear` only visits the 3×3 block around a point and is
exact only while the cell is at least the query radius; asking the 25 m grid for
50 m would quietly miss lamps two cells away. **The clause prints only on a
route with no counted lamp at all**, because that is the sentence that reads
like a verdict and the only one worth qualifying:

> `No mapped streetlight along this route · 2 more are mapped within 50 m of it`

**Priced before it was written.** `shots/walk/lit/nearmiss.mjs`, 60 seeded
routes: 33 have no counted lamp, and only **3 of those 33** have any lamp in the
25–50 m ring — median 1, at most 2. So it fires on **one route in twenty** and
says a small number when it does, which is the whole reason it is affordable as
a clause on an existing line rather than a new line. It rides on the count as a
suffix and costs no rendered line at all. It is still a statement about the map,
and it can only ever make an empty count sound like *more* light, never less.
`shots/walk/lit/card-after-CMB-TMM.png` is the photograph; `smoke.mjs` asserts
it on that named route and asserts it is *absent* on ANB→ETC.

**The residue, stated plainly.** The clause answers the route-level sentence. It
does not answer the stretch-level one: a *cool segment of the strip* 28 m from a
lamp still reads as cool, and 9-in-18 says a lamp is often visible from there.
Sizing that properly needs a per-stretch measurement over a real sample, and the
honest options then are a second strip colour for "just outside" or nothing at
all. Not attempted. It is the biggest thing round 4 leaves open.

---

## 29. Does it change the route? Still no, and round 4 added nothing to the search

`litNearMissM` is a counting radius and appears nowhere in `litEdgeWeights`. The
strip is a rendering of a scan that already existed. The fold is a `display`
toggle. **Every routing constant is byte-identical to round 3** — `litAltMult`
1.7, `litAltMaxFrac` 1.35, `litAltMinGainM` 40, `darkAltMult` 1.5,
`darkAltMinDrop` 2, `litCanopyMult` 1 — and `smoke.mjs` still asserts ANB→ETC at
24 lamps, 2 phones, 678 m, 4 under canopy, unchanged since round 2.

The argument is unchanged and is now four rounds old: **the feature annotates by
default and re-routes only on a button, with the price printed before the
button.** Round 4's contribution to it is that the annotation is finally
readable, which is the part that had been quietly failing.

---

## 30. What round 4 changed

* `js/wayfind.js` §6b only — `litStrip()`; `reportedAtM` on the scan; the
  rebuilt `litCard()` body (headline weight, merged secondary row, folded
  provenance with the warning in the label); `nearMiss` on the scan and its
  clause; `gWarmWide`. Eleven new named constants, all in the constants block,
  every one a one-line override.
* `shots/walk/lit/` — `cardshot.mjs`, `strip-truth.mjs`, `strip-scene.mjs`,
  `boundary.mjs`, `nearmiss.mjs`, their JSON, and the frames. `smoke.mjs` gained
  eleven assertions.
* No data file was re-baked. `scripts/bake_props.py` is untouched this round.

## 31. What round 4 did NOT establish

* **The stretch-level near miss.** §28's residue, and the honest headline of it:
  a cool segment 28 m from a lamp still reads cool, and a lamp is often visible
  there. Route-level is answered; stretch-level is not.
* **Whether the fold is the right trade.** It is defended above — a short caveat
  that is read beats a long one that is not — but nobody has watched a person
  use it, and it is one constant to reverse.
* **Whether `litNearMissM` = 50 m is the right ring.** It is twice the counting
  radius and inside round 3's 60 m, which is a reason, not a measurement.
* **Anything about crime, response times, or how safe a stretch is.** Unchanged
  across four rounds, and it will stay unchanged.
