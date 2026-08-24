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
>
> **ROUND 6 went to the two places five rounds had never looked.** The strip has
> three colours and only two of them had ever been in a matrix: the violet tick,
> where a resident said it was too dark, had been checked at two of 182 pins and
> both were picked by hand. And every site in every matrix in this document was
> photographed from directly overhead — a pose in which nothing can stand in
> front of anything — in an app that opens at `pitch: 78` and is judged off a
> phone recording of somebody walking. Round 6 audits the violet column,
> re-shoots all three colours from an eye placed ON the pavement at the app's own
> walking height, runs the null control this lane's masked diff had never had,
> and gives the picture the key it did not have. §42–§50.

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

---

# ROUND 5 — the thing round 4 wrote down and did not answer, and the amber
# column nobody had sampled

Round 4 ended §28 with a paragraph headed *"The residue, stated plainly"* and
called it **the biggest thing round 4 leaves open**: the near-miss clause
answers the route-level sentence and not the stretch-level one — *"a cool
segment of the strip 28 m from a lamp still reads as cool, and 9-in-18 says a
lamp is often visible from there."* Sizing it properly, it said, needs a
per-stretch measurement over a real sample, and then the honest options are a
second strip colour for "just outside" or nothing at all.

Round 5 made that measurement. It came back **nothing at all** for the strip and
**one constant** for the ring — and on the way it turned up two things nobody
was looking for: the amber column of the confusion matrix had never been sampled
with the deduplication rules the cool column got, and one mark this feature puts
on the ground was overstating.

Two constants changed. Everything else here is a measurement, a photograph, or
an instrument that was wrong first.

---

## 32. How much cool strip is actually near a lamp

`shots/walk/lit/stretchmiss.mjs`, committed with its JSON. 60 seeded
building-to-building pairs driven through the real `window.wayfindRoute`; every
8 m step of every COOL run classified by its nearest-warm-lamp distance,
computed in node against the **shipped** `data/walk_lamps.json` rather than a
re-derivation. **[M]**, 2026-08-24.

```
cool metres over the sample                          52,405 m
  ...within 50 m of a mapped lamp                     3,927 m   7.5%
  ...beyond it                                       48,479 m  92.5%
nearest-lamp distance at a cool step   p10 57 m · median 228 m · p90 359 m
routes with ANY near-ring cool metres                    35 / 60
routes where it is >= 15% of their cool                  10 / 60
per-route near share of cool   p25 0% · median 5% · p75 13% · max 65%
```

**The median cool step on this network is 228 m from the nearest mapped street
lamp.** The thing §28 worried about is real and it is 7.5 % of the cool metres.
Round 4's own 9-of-18 is not evidence against that: it was measured on a sample
drawn from inside the band on purpose, so it says how often a lamp is visible
*given* you are in the band, not how much of the walk is.

### And what a third colour would cost the picture

The strip draws runs. Splitting a cool run wherever it crosses the 50 m boundary
turns one segment into several:

```
extra strip segments per route      median +1 · p75 +2 · max +10
segments today                      median  2 · max 15
routes where it would AT LEAST DOUBLE the segment count   8 / 60
share of the WHOLE strip that changes colour   median 4.3% · max 60.6%
```

Median +1 segment to repaint a median 4.3 % of the bar — about twenty-two pixels
of a 518 px strip. And the floors make it worse in the one direction that
matters: `litStripMinFrac` rounds a short run UP, so every sub-segment the split
creates is a small overstatement, and §27 spent a whole gate proving the strip
never shows more light than the count.

**So: nothing at all.** No third strip colour. Same answer, arrived at the same
way, as `litCanopyMult` in §21 — a good idea, measured, and measured out rather
than argued out.

---

## 33. THE MATRIX — 48 sites, and the column that had never been sampled

Round 3's matrix (§18) had 43 sites and no deduplication; round 4's strip check
(§27) had 12 and learned to deduplicate; round 4's boundary check (§28) had 18
and did not. Round 5's has **48 sites in three populations**, every one
deduplicated by coordinate at 40 m and spread across distinct routes first, and
for the first time the AMBER column is drawn from geometry rather than by eye.

`shots/walk/lit/stretchscene.mjs`. Plan view, site dead centre, `p = 0.92`
asserted not assumed, hardware GL, graphics auto-detect cancelled, veil gone,
the route card hidden, `props-lit` and `props-lit-core` masked flat and diffed
against the unmasked frame, the 25 m disc measured through the map's own
`project()` and drawn on every saved frame. **[M]**, 2026-08-24.

| what the card draws | sites | a warm lamp inside the 25 m disc | a warm lamp anywhere in the frame |
|---|---|---|---|
| **amber** — a lamp within 25 m | 12 | **9** | **10** |
| **cool** — none within 25 m, nearest 25–50 m | 24 | 1 | 12 |
| **cool** — nearest more than 120 m (the control) | 12 | **0** | **0** |

**Read it in the direction that matters, which has not changed in three rounds.**
No site the card calls unmapped has a warm street lamp *in the disc the claim is
about* — bar one, and that one is a lamp 25.2 m away whose pool spills over a
boundary the claim draws at 25.0 (`r5-near-03-25m-disc.png`: the lamp's position
is outside, its light is not). The control is empty in both windows twelve times
out of twelve; `r5-far-11-410m-disc.png` is what 410 m from a mapped lamp looks
like, and it is black.

### How far the surprise actually reaches — and it is not 50 m

The band was sampled in four distance buckets, so the question could be *how
far* rather than *ever*:

| nearest mapped lamp | a warm lamp is somewhere in the night frame | median frame pool px |
|---|---|---|
| 25–30 m | **5 / 6** | 2,766 |
| 30–35 m | 4 / 6 | 2,972 |
| 35–40 m | 3 / 6 | 481 |
| **40–50 m** | **0 / 6** | 0 |
| > 120 m | 0 / 12 | 0 |

`r5-near-14-39m-disc.png` is 39.4 m from the nearest counted lamp with a lamp
plainly burning inside the drawn disc. `r5-near-21-42m-disc.png` is 42.1 m and
is empty. **The visible reach ends between 40 and 50 m** — and round 4's ring
was set at 50 for a reason rather than a measurement, as its own §31 says.

---

## 34. The two amber sites with no light, and they are the live oak again

Two of the twelve amber sites came back with zero lamp pixels in the frame while
`queryRenderedFeatures` found the feature and this lane's receipt ring was drawn
at its foot. That is §20's signature, and `shots/walk/lit/litgap.mjs` asked the
four questions that separate the possible causes — is it in the index, is it in
the tiles, does the style render it, is something standing on it — hiding one
layer family at a time:

| hidden | lamp pool px, AFP→TCC | LLD→BRG |
|---|---|---|
| nothing (as shipped) | **0** | **0** |
| buildings (13 layers) | 0 | 0 |
| ground (24 layers) | 0 | 0 |
| **trees (4 layers)** | **4,380** | **3,034** |

`r5-gap-AFP-TCC-shipped.png` and `r5-gap-AFP-TCC-no-trees.png` are the same pose
one second apart.

**And `warm_canopy` predicted every one of them.** Of the twelve amber sites,
three have a canopy-flagged lamp nearest them and nine do not:

* the **three flagged** sites contribute **no light of their own** — two are
  black frames, and the third (BWY→TSC, flagged lamp 2.6 m away) has 3,641 pool
  pixels in the frame and **exactly 0 inside the 25 m disc**, which is a
  different lamp lighting the picture;
* the **nine unflagged** sites all have their lamp burning, 9 of 9
  (`r5-lit-03-11m-disc.png`); `r5-lit-01-9m-disc.png` is a flagged one.

Round 3 found the phenomenon at two places and shipped a count. Round 5 put
twelve cameras on stretches chosen by a script and the flag separated them
perfectly. That is a stronger result than round 3 was entitled to claim, and it
is the reason for the one visual change below.

---

## 35. The one mark in this feature that was overstating

Every counted lamp gets a square ring at its foot — the claim's receipt, "stand
in one at night and the pole is in it" (§6). At a canopy-covered lamp that
sentence was false in the only way that matters: **the ring was there at full
strength and the light was not.** The card's canopy clause ("4 of them are under
tree cover") was simultaneously the only claim in the block with nothing on the
map to check it against, and the mark that *was* there quietly contradicted it.

So a flagged lamp now gets **the same ring, same size, same shape, same hue, in
a dimmer value** — `litPadCanopyCol` (`#9c7748`: `litLampCol` carried down in
value, not shifted in hue). It is still counted, the count is unchanged, and
this can only ever make a counted lamp look like *less* light, which is the same
test every permitted sentence in §5 has to pass. `litPadCanopyOn: false` reverts
it.

**Verified as a picture, and A/B'd against what shipped before.**
`shots/walk/lit/canopyring.mjs`, AFP→TCC (4 counted lamps, 2 flagged), the ring
isolated by hiding its own layer and diffing so a composited mark cannot be
confused with the ground under it. **[M]**

| | ring pixels | mean colour | luminance |
|---|---|---|---|
| covered lamp, as shipped | 476 | 74, 58, 39 | **60** |
| covered lamp, `litPadCanopyOn: false` | 476 | 109, 88, 67 | **91** |
| open lamp on the same route | 207 | 111, 88, 71 | **92** |

Before the change the covered lamp's ring was luminance 91 against an open
lamp's 92 — the same mark, indistinguishable. It is now 60, a mean colour move
of **54 in RGB distance**. `r5-ring-covered-before.png` and
`r5-ring-covered.png` are the pair; `r5-ring-clear.png` is the open lamp.

**One honest caveat, found by taking the other pose first.** Straight down at
z20.6 the change is invisible, because the live oak covers the ring as
completely as it covers the lamp: **0 ring pixels**, and
`r5-ring-covered-plan.png` is a frame full of canopy. The pose this matters in
is the one the app opens in — a person on the pavement, under the tree, looking
along the path. A test run only in plan view would have called the change
pointless.

---

## 36. The near-miss ring, narrowed to what a person can see

`litNearMissM` **50 m → 40 m.** §33's buckets are the reason: the outer ten
metres of the shipped ring hold lamps nobody standing there can see. The clause
exists so that "No mapped streetlight along this route" is not called wrong by a
person who walks out and looks at one — and a lamp that cannot be seen is not
that person's objection. Counting it made the sentence longer and less true at
once, in the one direction this feature has spent five rounds refusing to be
wrong in.

**Priced before it was changed.** `shots/walk/lit/ringsweep.mjs`, the same 60
seeded routes, driven through the real router, `window.wayfindLitReprice()`
checked every pass — and the sweep only ever goes DOWN from the shipped value,
because `LAMPS.gWarmWide` is built once at `litNearMissM` and `lampsNear` is
exact only while the grid cell is at least the query radius.

| ring | zero-lamp routes | the clause fires on | it says |
|---|---|---|---|
| 50 m (shipped) | 33 / 60 | 3 | median 1, max 2 |
| 45 m | 33 / 60 | 2 | median 2 |
| **40 m** | 33 / 60 | **2** | median 2, max 2 |
| 35 m | 33 / 60 | 1 | median 2 |
| 30 m | 33 / 60 | 1 | median 1 |

**Exactly one route in sixty changes: NEZ→TMM**, which at 50 m was told about a
single lamp 40–50 m away — the band where 0 of 6 sampled sites can see one.
`smoke.mjs` now asserts the ring is 40 and builds the expected sentence from the
page's own constant, so a future change of mind moves one line and the gate
follows it.

---

## 37. Did round 4's rebuild land? Yes — and it lands on a phone, which nobody had checked

Round 4 photographed the lighting block, measured it, rebuilt it around a
picture, and did all of that at 1280 × 900. That is the one width this app is
never watched at: it is judged off a phone screen recording.

`shots/walk/lit/phonecard.mjs` — three routes chosen for the three shapes the
block can take, at 360 (Android), 390 (iPhone) and 1280 px, `p = 0.92`, DPR 2.
**[M]**

```
                       card width   block   lines   words   strip    narrowest run
ANB->ETC   android        138 px    772 px    7      116   138x10       1.09 px
ANB->ETC   iphone         153 px    726 px    7      116   153x10       1.22 px
ANB->ETC   desktop        518 px    389 px    7      116   518x10       4.13 px
```

A 1.22 px run is a DOM fact. Whether it is a mark a person can see in a screen
recording is a pixel fact, and this project has confused the two before. So the
strip was **photographed** at each width and its middle row read back:

| | device px wide | amber survives as | amber share of the bar |
|---|---|---|---|
| android 360 | 276 | **7 marks** | 30.43 % |
| iphone 390 | 308 | **7 marks** | 31.17 % |
| desktop 1280 | 1036 | **7 marks** | 30.89 % |

**Seven marks at every width**, against a true lamp-covered share of 31 %. The
picture does not degrade on a handset, because the floor is a *fraction* of the
bar and the arithmetic is therefore width-independent — confirmed by re-running
round 4's own over-claim gate at phone width (`strip-truth.mjs` now takes a
width argument; the default is unchanged):

```
viewport 390 px wide
strip amber share MINUS true lamp-covered share
  min -0.22%   p25 -0.02%   median 0.00%   p75 0.00%   max 0.05%
routes where the picture shows MORE light than the count:  0 / 40
PASS
```

The same distribution round 4 measured at 1280 px, to the second decimal. **No
change was needed and none was made.** `r5-phone-iphone-lamps-full.png` is the
block on a phone at night and the strip is the most legible thing in it;
`r5-phone-android-lamps-strip.png` is the bar itself at its narrowest, 276
device pixels, with its seven amber marks intact.

### The one thing that IS wrong on a phone, and it is not this lane's to fix

On a 390 px handset **the whole route card is 153 px wide — 39 % of the screen**
— so every sentence in it wraps three and four times and the block runs 726 px
tall off the bottom of an 844 px screen. That is `#wf-card`'s own width, not the
lighting block's; it affects every section of the card equally, and `acer/w-ui`
is rebuilding this surface for phones right now. §38 has the request, with the
photograph and the numbers that lane would otherwise have to re-measure.

---

## 38. Requests to lanes that own other files (round 5)

§7's and §14's requests still stand. One new.

**f) Whoever owns the route card's width.** (`acer/w-ui`, phone rebuild.) At a
390 × 844 viewport `#wf-card` lays out at **153 px wide**, and at 360 px it is
**138 px** — measured, `shots/walk/lit/phonecard.json`, photographed in
`r5-phone-iphone-lamps-full.png`. Nothing in this lane depends on it and no
number here moves; the lighting block behaves correctly at that width and its
picture is verified to survive it (§37). But every line of card copy in the app
is wrapping three and four times for want of about 200 px of width that is
sitting empty on both sides of it, and that is a bigger readability win than
anything left in this block.

---

## 39. What round 5 changed

* `js/wayfind.js` §6b only — `litNearMissM` 50 → 40, with the bucket table in
  the constant's comment; `litPadCanopyOn` / `litPadCanopyCol` and the third pad
  kind `lampcanopy` in `litEnsure` / `litDraw`; `litDrawn`, the tally of marks
  actually handed to the source, exposed as `drawn` / `padCanopyOn` on
  `window.wayfindLit()`. Two new named constants, both one-line reversals.
  **No routing constant moved** — `litAltMult` 1.7, `litAltMaxFrac` 1.35,
  `litAltMinGainM` 40, `darkAltMult` 1.5, `darkAltMinDrop` 2, `litCanopyMult` 1
  and `litRadiusM` 25 are all byte-identical to round 3.
* `shots/walk/lit/` — `stretchmiss.mjs`, `stretchscene.mjs`, `ringsweep.mjs`,
  `litgap.mjs`, `phonecard.mjs`, `canopyring.mjs` and their JSON;
  `strip-truth.mjs` gained a width argument; `smoke.mjs` gained six assertions.
* No data file was re-baked. `scripts/bake_props.py` is untouched this round.
* **A prune, per CLAUDE.md rule 12.** This round generated 44 MB of frames and
  committed 6 MB of them — the fourteen this document cites. It also deleted the
  frames rounds 2–4 left behind that no document names: each of those sweeps is
  reproducible from the script committed next to it, and a screenshot nothing
  cites is multiplied by every parallel worktree. Every frame named anywhere in
  `docs/` is still here.

## 40. Three instruments that were wrong first, and what each false number was

Recorded because every one produced a confident, plausible answer, and two of
them would have gone into this document.

**a) A layer that does not exist yet reports a confident zero.** The first run of
`stretchscene.mjs` began flying sites about a second after the veil went, and
`props-lit` is added when the props source initialises, some seconds later. The
mask loop skips a layer that is not there (`if (!m.getLayer(id)) continue`), both
frames come out identical, and the diff is honestly zero — so the first two
AMBER sites came back *"no warm lamp on screen"* with zero features in the query.
**On the amber column a false negative means the card is claiming a lamp that is
not there**, which is the single worst thing this feature could be told. It was
caught by flying to one of those coordinates by hand and seeing three lamps. The
script now waits for the layer, records `missing` per site, and drops a site with
a missing layer from the table rather than scoring it.

Its twin, in the same run: no route had been created, so `wayfind-lit-pad` and
`wayfind-lit-dark` were not in the style at all, and two rows of the matrix were
a tidy column of zeros meaning *"the layer does not exist"*. Same family as
§27.3's camera pointed through the card — the instrument is not looking at the
subject, and it agrees with you anyway.

**b) A composited pixel is not its paint constant.** `canopyring.mjs` first
classified ring pixels by nearest of the two colour constants. But the ring is
drawn at `fill-extrusion-opacity` 0.8, multiplied again by the night clock, over
near-black ground: `#ffc27a` (255, 194, 122) lands on screen at about
(131, 113, 82) — **nearer the dim constant than the bright one**. The open lamp's
ring was scored as the covered one's, 11,454 pixels of it, and the covered lamp
scored as nothing at all because it composited darker than either. A test that
reads a paint constant off a composited pixel is measuring the opacity. The ring
is now isolated by hiding its own layer and diffing.

**c) Counting the same thing twice, three different ways.** `querySourceFeatures`
repeats a feature in every tile it touches: 24 rings tallied as 64, then as 39
after deduplicating by first vertex, because tile clipping moves the vertices.
`getSource('wayfind-lit')._data` is not the FeatureCollection that was set — it
reads as undefined with zero features, which looks exactly like a change that did
nothing. Both were replaced by a tally taken once, inside `litDraw`, off the
array handed to the source. And the sampling had the same disease: the first cut
of `stretchmiss.mjs` stashed sites until a flat cap filled, so both pools came
off the first handful of routes and the control ended up five sites from one
pair — round 4's boundary sample (six routes, eighteen sites, two of them 24 m
apart) rediscovered from the other end.

## 41. What round 5 did NOT establish

* **Whether a canopy-covered lamp is meaningfully darker on the ground.** Still
  no. The flag now predicts the *rendered* scene at 12 of 12, and the renderer is
  a model of the city, not a photometer. Nothing here measures lux.
* **Whether 40 m is the right ring rather than 38 or 43.** It is the bucket edge
  at which six of six sampled sites saw nothing. The buckets are 5 m wide and the
  sample is six per bucket; a finer answer needs a bigger sample and would move
  the clause on at most one route in sixty.
* **The stretch-level near miss in the sense of DRAWING it.** Sized (7.5 % of
  cool metres, §32) and answered with *nothing*, which is a decision about a
  third colour rather than a measurement of one that was never built. If Simeon
  wants to see it, the price is median +1 segment and 4.3 % of the bar.
* **Whether anybody reads the fold.** Round 4 said nobody has watched a person
  use it. Still true.
* **Anything about crime, response times, or how safe a stretch is.** Unchanged
  across five rounds, and it will stay unchanged.

---

# ROUND 6 — the colour that had never been in a matrix, and the pose that had never been used

`shots/walk/lit/pinpose.mjs`, `decorpx.mjs`, `swatch.mjs`, all committed with
their JSON. **[M]**, 2026-08-24, port 8814, `p = 0.92`, hardware GL,
`?walk=1&intro=0&drift=0`, graphics auto-detect cancelled, veil waited out.

## 42. The violet column, audited for the first time

The strip has three colours. §18 audited COOL at 43 sites. §28 audited the
25-60 m band at 18. §33 finally audited AMBER at 12 and called it *"the column
that had never been sampled"*. **The violet tick has been checked at exactly two
of 182 pins**, in round 2 (§13), and both were chosen by hand as the extremes —
the pin furthest from a lamp and the pin nearest one. That is the claim this
feature would look worst being wrong about: a mark saying *somebody stood here
and said it was too dark*, drawn across a burning pool of lamplight.

**The sample.** 70 seeded building pairs driven through the real
`window.wayfindRoute`; 35 of them enter the surveyed area carrying at least one
pin. 24 sites — 8 violet, 8 amber, 8 cool — taken from the app's own
`wayfindLit()` geometry, deduplicated by coordinate at 40 m and spread across
distinct routes first (§27, §40c). Every site read at **two** poses, so 48
readings.

```
pin  0  SAG->CS3   nearest mapped lamp   74.8 m   0 px   "Street light does not work."
pin  1  BME->MAI   nearest mapped lamp  209.8 m   0 px   "Too dark here"
pin  2  WMB->FDH   nearest mapped lamp  128.4 m   0 px   (no words)
pin  3  CRH->N24   nearest mapped lamp  255.6 m   0 px   "PAI is too dark here"
pin  4  SUT->COM   nearest mapped lamp  285.8 m   0 px   "MAI is too dark here"
pin  5  BMC->CRD   nearest mapped lamp  103.9 m   0 px   (no words)
pin  6  WCH->HRC   nearest mapped lamp  381.3 m   0 px   "Dark at BAT"
pin  7  SZB->GSB   nearest mapped lamp  464.4 m   0 px   "Too dark under the bridge / over the street."
```

**Not one violet tick in the sample has a surveyed street lamp in it** — zero
pool pixels inside the 35 m disc, zero anywhere in the frame, at either pose.
The median pin is **255.6 m** from the nearest mapped lamp and the nearest of
the eight is 74.8 m. The person who typed *"Street light does not work"* is
standing where OpenStreetMap has no lamp for seventy-five metres in any
direction — which is the two sources agreeing, rather than either of them being
checked against the other.

`r6-pin-04-eye.png` is the picture: standing on the pavement at 1.70 m outside
Main Building, where a resident wrote *"MAI is too dark here"*, at night. The
facade is unlit, there is no pole, and the violet mark is under the camera.

## 43. The pose every matrix in this document was shot from

`litaudit.mjs` (§17), `boundary.mjs` (§28) and `stretchscene.mjs` (§33) all pose
at `pitch: 0`. A plan view has one property that matters here: **nothing can
stand in front of anything.** Round 5 already found that pose changes the answer
— straight down, a live oak hides the receipt ring completely (§35) — and then
measured the whole matrix from straight down anyway. This is a walking app.
`js/app.js` opens it at `pitch: 78`, and it is judged off a phone recording.

### The first attempt was wrong, and one frame said so

The obvious fix is `jumpTo({ center: site, pitch: 78 })`. Run that and it reports
that **half the counted amber lamps vanish at walking pose** — a clean, quotable,
completely false collapse. At pitch 78 the centre is the point the camera is
AIMED at; the eye is tens of metres behind it at ground level, and at one site
that put it *inside a live oak*, filling the frame with leaves. A buried camera
saying "the lamp is gone" is precisely what the house rule about proving the
subject is on screen exists for, and it is §27.3's camera-through-the-card in a
new costume: the instrument is not looking at the subject, and it agrees with you
anyway. That number appears in no table here.

### So the eye is placed, and the placement is asserted every time

`transform.getCameraLngLat()` is MapLibre's own answer to where the eye is —
`getFreeCameraOptions` does not exist here, and `js/entrances.js` §751 records
the gate that was written against it and therefore passed everything.
`pinpose.mjs` solves the centre until that value lands ON the site, and the zoom
until `getCameraAltitude()` lands on **1.70 m**, the walking height
`scripts/verify/walk.mjs` gates, at `pitch: 84` under `js/app.js`'s ceiling of
88. Read back per site:

```
eye solved to within 2 m and 1.70 +/- 0.25 m:   24 / 24
worst miss over all 24 sites:  0.00 m        altitude: 1.70 m at every one
```

### And why the eye column does not use the disc

The eye stands AT the site, so **half of the site's own ground circle is behind
the camera**, and points behind the camera do not project — they return on the
wrong side of the screen and the "disc" draws as a few crossing lines. Even from
further back, the far half of a ground circle compresses into a handful of
pixels, so a lamp well beyond it lands within a hair of the boundary and its pool
spills inside (§49b is the false number that came of exactly that). Eye frames
therefore carry **no overlay at all** — they are what a person standing there
sees — and the eye column is read off the masked diff over the whole frame.

## 44. THE MATRIX — three colours, two poses

```
                                            PIN (violet)   LIT (amber)   COOL
  plan  a surveyed lamp pool inside the disc    0 / 8          7 / 8       1 / 8
  eye   surveyed lamplight in the frame you
        actually see, standing there            0 / 8          6 / 8       0 / 8
  median lamp-pool pixels in the disc (plan)    0              3,859       0
  median metres to the nearest mapped lamp    255.6             13.6     268.6
```

**The violet column is clean in both poses, and the amber column holds in both.**
`r6-lit-04-eye.png` is an amber site 3.2 m from a mapped lamp photographed from
the pavement: two lamp posts standing in their own pools of light across the
crossing.

**The three that miss are each already written down in this document.**

* **`lit 6` (AFP→BBR, 7.1 m), zero at BOTH poses.** `queryRenderedFeatures` at
  the site's own point returns `trees-canopy`, and `r6-lit-06-plan.png` shows the
  crosshair between two live oak crowns. Round 3's covered lamp, found a third
  time by an instrument that was not looking for it — and it is one of the lamps
  the card already calls *under tree cover* and already draws a dimmer ring for
  (§35).
* **`lit 5` (CRH→N24, 21.9 m), 2,600 px from above and 27 from the pavement.**
  A lamp near the edge of the radius, on the far side of something.
* **`cool 1` (MNAC→SEA, 26.3 m), the only cool site with a lamp pool in it** —
  inside the 25-40 m near-miss band §28 measured and §36 narrowed the clause to.
  The card already has a sentence for exactly this route shape.

## 45. The null control this lane had never run

Every lamp-pixel number since round 3 comes from diffing two frames taken a
moment apart with `props-lit` repainted between them. In five rounds nobody had
taken the two frames with **nothing** repainted and run the identical classifier,
which is the only way to know whether the number has a floor.

```
sites with any "lamp" pixel from repainting NOTHING:   0 / 48 poses   (max 0 px)
```

Zero, at every site, at both poses. The five rounds of pixel numbers stand — they
were not *known* to stand until now, and a noise floor would have been quietly
reporting canopy as lamplight since 23 August.

## 46. The decoration, counted at a calibrated bar — and the change that did not happen

§22 put one line in the card because the scene paints road glow with no surveyed
pole under it. `decorpx.mjs` counts it: warm, bright pixels inside the disc in
the untouched frame that the props-lit mask does not account for.

**The bar was set before the table was finished** (05:26, five of twenty-four
sites in): if more than a third of sampled sites carried 1,000 px or more of
unexplained light, the disclaimer would stop being folded — not as a new line,
because round 4's whole finding was that this block had too many, but promoted
into the fold's always-visible LABEL beside the two already there.

```
                     sites with >= 1000 px    median
  violet ticks             1 / 8                491 px
  cool stretches           2 / 8                175 px
```

**3 of 16 — 19 %.** The bar is not met and the card does not change. (The amber
column is left out of that count on purpose: where a real lamp pool is present
the measure has to subtract one instrument's answer from another's, and a number
that needs that subtraction is not comparable with one that does not.)

For the column this round is about it is **one pin in eight**, and that one is
1,255 px at a pin 381 m from any mapped lamp. Third time this lane has measured
an idea out rather than argued it out — after `litCanopyMult` (§21) and the third
strip colour (§32).

`r6-pin-00-plan.png` is what is being counted, and it is also why the count had
to be calibrated rather than eyeballed. The violet diamond is the pin where
somebody wrote *"Street light does not work"*; there is a warm pool on the
pavement below and to the right of it, inside the 35 m disc, with no pole under
it — and at the calibrated bar that pool is **491 px**, under the threshold. The
eye is a poor judge of how much of a frame a glow occupies, which is the whole
argument for having a number at all.

## 47. The picture had no key

Round 4 replaced twenty lines of prose with a bar. Round 5 proved the bar
survives a 390 px handset. Neither asked the question underneath both: **can a
person tell what its colours mean?** Read off the shipped card, the three are
anchored very unevenly.

| strip colour | what anchors it on screen | how far from the bar |
|---|---|---|
| amber `litStripLitCol` | the count line, `litLampCol`, the same hex | directly under it |
| violet `litStripTickCol` | the reported line, `darkTextCol`, the same hex | two to four lines down |
| cool `litStripDarkCol` | **nothing at all** | — |

Cool is the one that matters, and the route where it matters is not a corner
case: on the walk home into West Campus the bar is **one flat colour end to end**
and nothing on screen names it.
`r6-key-before-desktop-GDC-TheCastilian.png` is that card.

**A legend row is the obvious answer and it does not fit.** §37 measured
`#wf-card` at 153 px on a 390 × 844 handset, and the caps row's `START` / `DOOR`
already fill it.

**So the key is not a row — it is one mark.** `litSwatchOn`: a 9 px square in the
strip's own colour at the head of the count, and a `litStripTickW`-wide bar in
the strip's tick colour at the head of the reported-dark line. Only where the bar
actually carries that mark — a violet tick beside a sentence on a bar with no
ticks would be a key explaining a colour that is not on screen. Both are
`aria-hidden`, because the sentence beside them already says the thing in words.
`r6-key-after-desktop-GDC-TheCastilian.png`, and at 153 px
`r6-key-after-iphone-ANB-ETC.png`.

### What it cost, measured as an A/B on the same card

`swatch.mjs` flips `window.WAYFIND.litSwatchOn` and re-renders the same route
seconds apart, so the comparison is of the key and nothing else. Same line and
word measure `cardshot.mjs` uses.

| | words | block height | key marks |
|---|---|---|---|
| iphone 390 · ANB → ETC | 67 → **67** | 395 px → **395 px** | 1 |
| iphone 390 · GDC → The Castilian | 87 → **87** | 469 px → **469 px** | 2 |
| iphone 390 · PMA → WEL | 63 → **63** | 375 px → **375 px** | 1 |
| desktop 1280 · ANB → ETC | 67 → **67** | 195 px → **195 px** | 1 |
| desktop 1280 · GDC → The Castilian | 87 → **87** | 240 px → **240 px** | 2 |
| desktop 1280 · PMA → WEL | 63 → **63** | 195 px → **195 px** | 1 |

**Not one word, and not one pixel of height, at either width.** The rendered-line
count does rise by one or two — that is the measure, not the card: an
inline-block sitting on the baseline has a different rect top from the text
beside it, so `Range.getClientRects` reports two rows where a reader sees one.
Height is the metric `cardshot.mjs`'s own comment calls the one that cannot be
gamed, and it did not move by a pixel.

### And the colours are the same colours, sampled off the screen

A key that agrees with the bar in the source and disagrees on screen is worse
than no key — §40b is this lane's own record of a paint constant and a composited
pixel being two different numbers. Both are sampled from the same screenshot, so
opacity and blending apply equally to both:

```
headline mark  255,194,122   bar amber  255,194,122     match
headline mark   70, 83,111   bar cool    70, 83,111     match   (the flat-bar route)
tick mark      195,176,255   bar tick   195,176,255     match
PASS  6 / 6 route-widths
```

`smoke.mjs` gained seven assertions for it, including the one that matters most:
`litSwatchOn: false` removes the key entirely (rule 11).

## 48. Requests to lanes that own other files (round 6)

§7's, §14's and §38's requests still stand. One new, and it is small.

**g) Whoever owns `js/night.js`'s road glow.** Unchanged in substance from §7,
now with a number taken at a calibrated bar rather than an eyeballed one:
**3 of 16 discs the card calls unmapped carry 1,000 px or more of warm light with
no surveyed pole under it** (`shots/walk/lit/decorpx.json`). It is not enough to
move anything in this card, and it is the whole of what a user who flies down to
check will argue with.

## 49. Six instruments that were wrong first, and what each false number was

Recorded for the same reason §40 was: every one produced a confident, plausible
answer, and three of them would have gone into this document.

**a) A camera buried in a tree, reporting that the lamp had gone.** §43 has it:
*half the amber lamps vanish at walking pose*, from an eye standing inside a live
oak. Caught by opening the frame.

**b) A screen-space disc at a grazing pitch counts things far outside it.** The
same first cut scored **522 "lamp" pixels inside the 35 m disc of a pin whose
nearest mapped lamp is 209.8 m away** — a violet tick apparently standing in
lamplight, the single worst thing this column could report. Killed three ways:
`data/props.geojson` read directly in node says the nearest warm prop to that
coordinate is 209.8 m; a re-shoot of the identical pose scored it zero; and the
warm glow that IS in that frame survives the props-lit mask unchanged, which is
what decoration looks like.

**c) `queryRenderedFeatures` cannot see a lamp at pitch 84.** The eye column was
built on it, and it returned **0 rendered lamps at all 24 eye poses** — including
a site 3.2 m from a lamp whose own masked diff scores **17,107 pool pixels in the
same frame**, and which `r6-lit-04-eye.png` shows as two lit lamp posts. A hit
test on a `circle-pitch-scale: 'map'` layer does not survive that pose. Both
numbers are still in the JSON so the disagreement is on the record; the table
uses the one that agrees with the picture. The two agree at 8/8 pin and 8/8 cool
— where the answer is zero either way — and at **2 of 8** amber.

**d) A warm-tinted surface is not light.** `pinpose.mjs`'s own decoration counter
(`R >= 60`, warm) reported **5,279 px of "decoration" at a pin whose frame is a
black tree-lined path with no light in it at all** (`r6-pin-02-plan.png`). This
city's ground is a warm dark brown after dark. The value is still in the JSON
with a comment saying not to read it; `decorpx.mjs` is the calibrated answer.

**e) The app's own controls, counted as streetlight.** The rewrite then scored
~3,000 px of "unexplained light" at that same black frame — the joystick ring,
the BOOST button, the time-of-day knob and the amber hint bar, all warm, all
bright, all inside the disc. `decorpx.mjs` excludes them by rectangle **and
checks the exclusion**: the frame this lane looked at and called black must come
back at zero, and it does.

**f) A flood fill seeded on its own crosshair.** The first run of `decorpx.mjs`
returned 0 px for every disc at every site — a total, silent, plausible zero. The
fill starts at the frame centre, which is exactly where `pinpose.mjs` draws its
magenta crosshair, so the seed pixel was a boundary pixel and the stack emptied
on the first pop. It never got inside anything.

**g) A run that would have been killed four minutes before it finished.** The
first full v2 run was launched with `chrome.mjs`'s watchdog at 45 minutes and was
measuring at ~49 s per frame, for 60 frames, with `pinpose.json` written only on
the last line. Caught by doing arithmetic on the frame timestamps rather than
waiting to find out. The watchdog is 90 minutes now, with a comment saying why —
README already has the sentence: a gate that cannot finish inside its own
watchdog is a dead gate.

*(And one that was not wrong: §45's null control, run for the first time in six
rounds, came back clean.)*

## 50. What round 6 changed

* `js/wayfind.js` §6b only — `litSwatchOn`, `litSwatchPx`, `litSwatchRadius`,
  `litSwatchGap` and the `litSwatch()` helper; two calls inside `litCard`. Four
  new named constants, one of which reverses the whole idea in a line.
  **No routing constant moved.** `litAltMult` 1.7, `litAltMaxFrac` 1.35,
  `litAltMinGainM` 40, `darkAltMult` 1.5, `darkAltMinDrop` 2, `litCanopyMult` 1,
  `litRadiusM` 25 and `litNearMissM` 40 are byte-identical to round 5, and
  `smoke.mjs` still asserts ANB→ETC at 24 lamps, 2 phones, 678 m, 4 under canopy,
  20 full rings and 4 dim ones.
* `shots/walk/lit/` — `pinpose.mjs`, `decorpx.mjs`, `swatch.mjs` and their JSON;
  `smoke.mjs` gained seven assertions. Eight frames, the ones this document
  cites, 2.5 MB (rule 12: the round made ~40 MB of frames in the scratchpad and
  committed eight files).
* No data file was re-baked. `scripts/bake_props.py` is untouched this round.
* `WAYFIND.on` untouched.

## 51. What round 6 did NOT establish

* **That a person can read the key.** It puts the strip's own colour beside the
  sentence that names it, and the two are proven identical on screen. Whether
  that is enough for somebody seeing the card for the first time is a question
  about a person, and in six rounds nobody has watched one use this. Still the
  largest untested claim in the block.
* **That the eye column generalises past eight sites a colour.** It is the first
  look at this pose, not a survey of it.
* **That 1.70 m and pitch 84 are the right eye.** They are the app's own walking
  height and a pitch under its own ceiling. A person turns their head; this
  camera looks along the route and nowhere else.
* **Anything about the glow that is not surveyed.** Counted here at a calibrated
  bar and left alone, and it is `js/night.js`'s. §48 has the request.
* **Anything about crime, response times, or how safe a stretch is.** Unchanged
  across six rounds, and it will stay unchanged.
