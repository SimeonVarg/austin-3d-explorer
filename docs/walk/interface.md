# The walking interface — one control, one pill, one ribbon

**What this is.** The interface design for "I am here, I need to get to WEL",
drawn on top of a flying 3D city on a phone. Written 2026-08-06, Acer lane,
**design only — no code, no data, nothing built and nothing changed.** Every
number below was measured off the files in this repo today, and where a number
in the brief disagrees with the file, the file is quoted and the brief is
corrected.

**The one-sentence design.** At rest the feature is a single 44 × 44 button in
the empty top-left corner; open, it is one text field; answered, it is one line
of text in the pill slot the title already occupies, and a ribbon painted on the
ground. **The app never gains a second panel and never gains a sidebar.**

---

## 0. The data, as it actually is today

Verified by reading the files, not by trusting the brief. Four of the brief's
counts are wrong and one of them would have shaped the design wrongly.

| | brief says | the file says |
|---|---|---|
| walkable ways | 3,430 | **3,430** ✓ (`data/osm_cache/footways.json`; 189 `highway=steps`) |
| UT building register | 198 | **198** ✓ (`data/ut_buildings.json` — `ref`, `name`, `number`, `occupied`) |
| modelled doors | 584 on 258 buildings | **629 door groups on 280 buildings**, 11,777 pieces |
| West Campus towers | 24 | **24** ✓ (`data/westcampus.geojson`) |
| places for the coffee stop | 209 cafes, 268 restaurants, 230 fast food, 81 convenience | **126 distinct named businesses**: 22 cafes, 28 restaurants, 26 fast food, 6 convenience, 5 pubs, 3 bars, 2 bakeries, 1 ice cream, plus ~30 non-food shops |

**The places correction matters.** 436 / 591 / 534 are counts of *polygon
pieces* in `data/places.geojson` — each tenant is a front, an entry, an awning, a
label and sometimes a pool, so every business is counted four or five times. The
routable set is **126 names**, and the wider cache `data/osm_cache/places.json`
has 156 elements / 29 cafes for the whole bbox. 126 is plenty for "grab a coffee
on the way". It is *not* enough to build a browse-and-filter screen on, which is
one more reason section 5 does not build one.

**Three numbers nobody has written down before, and the design turns on them:**

**(a) The footway graph is one connected mesh, and it is tiny.** Built from the
shared node ids: **10,637 nodes, 11,566 edges, 59 components, and the largest
component holds 10,026 nodes — 94.3 %.** Total walkable length **160.6 km**.
Dijkstra over 11,566 edges is well under a millisecond in a browser. The
client-side-only architecture is not a compromise here, it is oversized for the
job. The 58 small components (85 nodes and below) are the honest edge case: a
route that starts or ends in one of them cannot reach the rest of campus, and
section 3 says exactly what the interface prints when that happens.

**(b) Only 106 of the 198 register codes have a modelled door.** Another 22 can
be located by an exact name match against `buildings.detailed.geojson`, which
carries `name` but no code. **70 codes cannot be located at all** — mostly
outlying and service buildings (`FC1`–`FC9`, `E11`–`E27`, `ACS`, `ATT`, `BMK`,
`FTC`…). So a student typing a valid UT code has **a 54 % chance of a real door,
a 65 % chance of a location, and a 35 % chance we have nothing**. An interface
that offers all 198 and silently guesses on 70 of them is the "made me late for
my exam" failure. Section 1 makes the three states visible in the result row
itself.

**(c) Stairs are real; hills are not, yet.** 189 `highway=steps` ways, median
length **3.7 m** (p10 1.6 m, p90 12.4 m, max 64.2 m). Only **9 ways carry
`step_count`**; 86 ways carry `incline` (48 up, 38 down); 72 carry `handrail`.
And there is **no elevation source in this repo** — no `raster-dem`, no
`setTerrain`, the city is flat. **So the headline may say stairs. It may not say
"uphill".** Saying "uphill" today would be inventing data, which is the one
thing this feature cannot do. When step_count is tagged we print steps; when it
is not we print flights, which is a thing we can count exactly.

---

## 1. Naming the building

**One field. Codes, names and numbers all go in it.** There is no "search by"
selector, because a student who knows `WEL` should not have to tell us what kind
of thing `WEL` is.

### The index (built once at load, ~200 KB of strings)

| rows | from | carries |
|---|---|---|
| 198 | `data/ut_buildings.json` | code, official name, building number, year |
| 629 | `data/entrances.geojson` | door point, role, `ref`, `nm`, host building |
| 24 | `data/westcampus.geojson` | tower name + lobby door |
| 126 | `data/places.geojson` | business name, category, point |

### The match ladder, in order, first hit wins

1. **Exact code**, case-insensitive, 2–4 letters. `wel` → WEL, and it is the
   *only* result — no list, no disambiguation, the field commits on Enter.
2. **Code prefix.** `we` → WEL, WCP, WMB (a list).
3. **Building number.** `0161` → WEL. Leading zeros optional: `161` works.
4. **Token prefix on the name, order-free.** Every typed token must be a prefix
   of some name token. `welch` → ROBERT A. WELCH HALL. `robert a welch` → the
   same. `welch robert` → the same. Stop-tokens (`HALL`, `BUILDING`, `BLDG`,
   `CENTER`, `THE`, `AND`, `OF`) never have to be typed but never block a match
   if they are.
5. **Aliases**, a small authored table (`WALK.ALIASES`, a named constant — see
   §8). `the tower` → MAI. `pcl` is already a code. `the union` → UNB. `chem`
   → WEL. `the drag` → the Guadalupe block. Ten to twenty entries, no more; an
   alias list is a maintenance liability and it is not a search engine.
6. **One typo, on words only.** Damerau-Levenshtein distance 1 on tokens of
   **4 characters or more**: `welhc` → `welch`, `jestre` → `jester`.
   **Never on a 2–4 letter code.** The 1-edit neighbourhood of `WEL` contains
   `WCP`, `WMB`, `MEL` and a dozen other real codes, so fuzzy-matching codes
   would confidently route you to the wrong building — the exact failure this
   feature is not allowed to have.

### What a row looks like, and the three honesty states

```
WEL   Robert A. Welch Hall                     1930    ● 7 doors
GDC   Gates Dell Complex                       2010    ● 7 doors
FC1   Facilities Complex Building 1            1972    ○ not in the model
```

* **● with a door count** — 106 codes. We route to a real door.
* **◐ "door not mapped"** — 22 codes. We can find the building and we route to
  its edge, and the answer pill says so in words. It does not pretend.
* **○ "not in the model"** — 70 codes. **The row is shown and is not
  selectable**, greyed, so a student who types `FC1` learns that we do not have
  it instead of being handed a route to something else with a similar name.
  Hiding these rows would be worse: silence reads as "you typed it wrong".

Names come out of the register in ALL CAPS and are title-cased for display with
a keep-caps set (`II`, `III`, `UT`, `LBJ`, `RLM`…). The code stays capitals and
is the first thing in the row, because it is what the student typed.

Result list: **6 rows maximum**, no scrolling. If more than 6 match, the 7th
line is `+ 14 more — keep typing`.

---

## 2. Where they start

**Default: where you are standing in the app.** The From field is pre-filled
with `Here` and a plain-English location taken from the nearest named way —
`Here · near Speedway at 24th`. No typing, no permission, no prompt, and it is
true the instant the panel opens. It also makes the flying camera into the input
device, which is the one thing this app has that a maps app does not.

**Device location: offered, never taken.** Inside the From field there is a
small chip, `Use my location`. It is the *only* thing that calls
`navigator.geolocation`, it is only ever called from that tap, and it is never
called on page load, never from a URL parameter, and never as a fallback.

* Before the tap: `Use my location` and, under it in small text,
  `Stays in your browser.`
* If the fix lands outside the model bbox, or accuracy is worse than 50 m:
  `You're outside the campus model — using the nearest campus point instead.`
  and the chip stays available.
* If denied: the chip greys to `Location off` and **we do not ask again this
  session**. The default (camera position) was already working, so nothing is
  broken by refusing.
* Nothing is stored, nothing is sent anywhere, and the coordinate never enters
  the URL. §6's URL grammar has `from=me` resolve to *the chip in its
  un-tapped state*, not to a prompt — a link someone shares must not be able to
  make your phone ask for your location.

**A West Campus apartment: the same field.** All 24 towers are in the index with
their lobby doors, so `rambler`, `the castilian`, `21 rio`, `dobie` are typed
into From exactly like a building code. **There is no apartment picker screen.**
A separate list of 24 would be a second app for a thing the search already does.

**A second building: also the same field.** `JES` in From, `WEL` in To.

**Rejected:** a permanent second search box on screen. From is collapsed to one
line reading `Here` until it is tapped; two open fields double the interface for
a case that is the minority.

---

## 3. The answer

The headline is **the thing Google will not tell you**, and it is three facts
separated by middots, in decreasing order of how much they change your decision:

```
9 min · no stairs · 650 m
```

The pill's second line names the door, because ending at a door is the other
thing no map does:

```
9 min · no stairs · 650 m
Welch Hall · north door, off the West Mall
```

### The real copy, all of it

Flat route, door known:

```
9 min · no stairs · 650 m
Welch Hall · north door, off the West Mall
```

Stairs, counted from `step_count`:

```
12 min · 40 steps up · 850 m
Step-free: 15 min, +250 m
```

Stairs, not tagged — we count flights, which we can do exactly:

```
11 min · 2 flights up · 800 m
Step-free: 13 min, +150 m
```

Downhill flights read the same way (`1 flight down`), and a route with both
says `2 flights up, 1 down`.

Door not modelled:

```
7 min · no stairs · 500 m
Facilities Complex · we route to the building edge — the door isn't mapped
```

The last stretch is not on the path network (nearest node > 60 m from the door):

```
8 min · 1 flight up · 600 m
Welch Hall · last 80 m aren't mapped — the dashed part is your guess, not ours
```

Disconnected (one of the 58 small components):

```
We can't find a walking path to Brackenridge Field Lab from here.
It isn't joined to the campus path network in our data.
```

**No route is drawn in that last case.** A beautiful wrong line is the failure
mode this feature is not allowed to have.

Under a minute: `under a minute · no stairs · 60 m`. Never `0 min`.

### The arithmetic behind the words, and its honesty

* `WALK_MPS = 1.35` (4.9 km/h, a student on a flat pavement).
* `STAIR_SEC_PER_STEP = 0.8`, applied per estimated step.
* Steps when `step_count` is tagged (**9 ways**). Otherwise
  `round(length / STEP_TREAD_M)` with `STEP_TREAD_M = 0.35`, **and then we do
  not print it as a step count** — we print flights. The 9 tagged ways measure
  0.30–0.50 m per step for short flights and 3.0 m per "step" on the two 64 m
  ways, which is a stepped path with landings, so a length estimate is honest
  to ±1 flight and dishonest to ±1 step.
* A **flight** is one `highway=steps` way on the route. That is countable
  exactly, needs no estimate, and is the unit a person actually feels.
* Minutes round **up**. Metres round to two significant figures below 950 m and
  become `1.1 km` above it. Never `647 m`.
* **Never the word "uphill"** until an elevation source exists (§0c).

### The step-free alternative

Computed on the same graph with `highway=steps` edges removed, and shown **only
when the main route has stairs and the step-free one exists**. Tapping the line
swaps the drawn route and the two lines trade places. If no step-free route
exists: `No step-free route in our data.` — not "none exists".

`wheelchair=*` is on 59 ways and `handrail` on 72; both go into the expanded
card as detail, not into the headline. The headline holds three facts and stops.

---

## 4. How the route is drawn

Four layers, one GeoJSON source, **added on first route and not before** — with
no route the map has no extra source, no extra layer and no extra paint
expression, which is what makes §7's "off means byte-identical" true of the
scene.

**1. The ribbon.** A `line` layer on the ground, **1.6 m wide in the world**,
warm white (`ROUTE_C_DAY`) by day and warm amber (`ROUTE_C_NIGHT`) after dark.
MapLibre line widths are pixels, so the width is an exponential-base-2 zoom
interpolation that holds 1.6 m of ground at every altitude. Measured for
lat 30.2862 (m/px = 40075016.686·cos φ / (512·2^z)):

| zoom | m/px | 1.6 m is |
|---|---|---|
| 15 (cruise, ~600 m up) | 2.063 | 0.8 px → clamped to `ROUTE_MIN_PX` 3 |
| 17 | 0.516 | 3.1 px |
| 18 | 0.258 | 6.2 px |
| 20.1 (the measured eye-level pose) | 0.060 | 26.6 px |
| 21.5 (`ZOOM_MAX`) | 0.023 | 70.2 px |

So from 200 m up it is a 3 px thread you can follow across the whole campus, and
at walking height it is a painted stripe the width of a pavement slab under your
feet. One clamp at the top end (`ROUTE_MAX_PX`) stops it swallowing the frame if
Y4 ever raises `ZOOM_MAX` to 25.

It must be inserted into **PR #78's ground rank ladder**, not on top of it, or
it will z-fight the pavement it lies on — that is the single most likely way
this feature ships a flicker.

**2. The ghost, which is the answer to "what if it runs behind a building".**
The same geometry drawn a second time, dashed, at `ROUTE_GHOST_OPACITY` 0.22,
in a layer placed **above** the building extrusions. MapLibre line layers do not
depth-test against fill-extrusions; their draw order is their layer order. So
putting one copy under the buildings and one over them gives, for free and with
no new render pass: **solid ribbon on open ground, faint dashed hint through the
wall.** You always know where the path goes, and you are never fooled into
thinking you can walk through a building. This is the whole occlusion design and
it costs one extra layer.

**3. Turn beads.** A `circle` layer at every vertex where the bearing changes by
more than `TURN_MIN_DEG` 35°, 0.9 m radius, same colour. Circles need no sprite
image, which keeps this feature out of the facade atlas entirely. At cruise they
merge into the line; at eye level they mark the corners you actually turn at.

**4. The door marker.** At the destination: a ground ring at the door point plus
a **12 m column** (`fill-extrusion`, 1.2 m square, `ARRIVE_H_M` 12,
`ARRIVE_OPACITY` 0.55) standing on it. From 200 m up the column is the only
thing in the frame that says *there*; at walking height you walk up to it and it
is standing in front of the actual modelled door leaf, at the door's own
`base`/`h` from `entrances.geojson`. The start gets a ground ring and no column
— you already know where you are.

**Direction is shown by movement, not by arrowheads.** With `lineMetrics: true`
the ribbon carries a `line-gradient` whose bright band is offset once per frame,
so a pulse runs start → end every `PULSE_SEC` 4 s. It reads at both altitudes,
needs no icons, and it is the only animation the feature has. Off under
`prefers-reduced-motion`.

**The camera never moves on its own.** The answer does not fly you anywhere.
There is one explicit `Show route ⤢` button in the expanded card that eases to a
pose framing the route's bbox at pitch 55 over 1.2 s. Automatic camera moves
would fight the user, and — more to the point — the intro, the tour and the
default pose are untouchable while the AWS recording is live.

---

## 5. The coffee stop

**One chip row, only in the expanded card, and it picks *one* place.**

```
+ Coffee     + Food     + Store
```

Tapping `+ Coffee` re-runs the same Dijkstra with a via-node, choosing the cafe
that **adds the fewest metres**, considering only cafes whose nearest path node
is within `DETOUR_MAX_M` 250 m of the route. The pill becomes:

```
13 min · no stairs · 900 m
Coffee at Medici on Guadalupe · 4 min out of your way          Next ›  ✕
```

`Next ›` cycles the top five by detour. `✕` removes the stop. **There is no
list, no filter, no rating, no photo, and no browse screen** — that is exactly
where this becomes a second app. The student asked for coffee on the way; the
app's job is to name one and say what it costs. 22 cafes is a set you can
enumerate in your head, not one that needs search.

`+ Food` spans restaurant / fast food / bakery / ice cream (58 names) and
`+ Store` spans convenience / supermarket (~8). If nothing is within 250 m:
`No coffee within a short detour of this route.`

---

## 6. Clip mode and the URL grammar

**Clip mode hides the interface and keeps the route.** The chrome is UI; the
ribbon is scene. `?clip=1&from=JES&to=WEL&fit=1` is a recordable shot of a route
with no controls on screen at all, which is precisely why the parameters exist.

One line is added to `style.css`'s existing `.clip` rule — the same rule that
already hides `#hud`, `#tod-panel`, `#joystick-zone`, `#gfx-*` and `#fb-*`:

```
.clip #walk-button,.clip #walk-sheet,.clip #walk-pill{display:none!important}
```

### The grammar

| parameter | value | what it does |
|---|---|---|
| `to` | `WEL` · `welch-hall` · `door:WEL:3` | destination: code, name slug, or one specific door group |
| `from` | `WEL` · `wc:rambler` · `here` (default) · `me` | origin |
| `via` | `cafe` · `food` · `medici` | best-detour place of a kind, or a named one |
| `step` | `free` | request the step-free variant |
| `fit` | `1` | on load, ease the camera to frame the route. **Absent = no camera move.** |
| `walk` | `1` | open the panel with nothing routed (deep link to the feature) |

Rules that are part of the grammar, not implementation details:

* **`from=me` never prompts.** It opens the panel with the `Use my location`
  chip showing. A shared link cannot make someone's phone ask for a permission.
* **Unresolvable values draw nothing.** `to=WELCHX` opens the sheet with the
  text pre-filled and one line: `We couldn't find "WELCHX".` Never a silent
  nearest-guess.
* **The app does not rewrite the URL as you type.** Typing must not create
  history entries or mutate a recording's address bar. `Copy link` in the
  expanded card writes the canonical URL once, on demand.
* Parameters are read exactly once, at load.

---

## 7. Mobile: what it costs and where it sits

Measured against a 393 × 852 phone (Simeon's class of device) and against the
real occupancy in `style.css` today.

**Occupied:** top-centre `#hud` pill; top-right `#gfx-button` (16, 16) with
`#fb-button` stacking under it at ≤520 px; right edge `#tod-panel`, vertically
centred, ~190 px tall on a phone; bottom-left `#joystick-zone` (bottom 70,
left 32, 100 px ring + the 60 × 44 BOOST button on its 45° shoulder);
bottom-centre `#controls-hint` (bottom 38); bottom-right the attribution.

**Free at every breakpoint: the top-left corner.** That is where the button
goes, at (16, 16), 44 × 44 — the same minimum thumb target the BOOST button
already uses, mirroring the gear across the frame.

| state | what is on screen | cost |
|---|---|---|
| **rest** | one 44 × 44 button, top-left | 1,936 px² = **0.58 %** of the frame |
| **searching** | bottom sheet, same pattern as `#gfx-panel` ≤640 px | ≤ 46 % of height while typing; the joystick and hint are hidden (unusable with a keyboard up), `#tod-panel` dims to .45 using the rule that already exists |
| **routed** | the headline **replaces `#hud` in the same slot** — same pill shape, same blur, same border | **net zero new area** |
| **expanded** | the pill grows downward to ~120 px for the alternative, the chips and `Show route` | one tap to collapse |

**The headline taking over the title pill is the core of the "least interface"
claim.** While a route is live the app does not have a title *and* a route bar;
it has one pill in one place, and the title comes back when the route is
cleared. The visible chrome count does not increase at all. `#hud` is static
markup and only `#hud-snapshot` is written by `js/app.js:296`, so this needs no
`js/app.js` edit — `js/walk.js` hides `#hud` and shows `#walk-pill` in its
position, and restores it on clear.

One difference from `#hud` on purpose: `body.flying #hud{opacity:.35}` must
**not** apply to the route pill. You read the headline *while* walking; that is
when it matters.

**Desktop keyboard:** `/` opens the field (free — the app uses W A S D Q E R P T
and `?`), `Esc` closes it. No new modifier keys.
`js/controls.js:1270-1280` already ignores keystrokes aimed at a text input, so
typing `WEL` will not fly the camera west — that guard exists and was checked.

---

## 8. Constants, and how it is wired

Everything with taste in it is a named constant in one marked block at the top
of `js/walk.js`, per CLAUDE.md rule 11:

```
WALK_MPS 1.35        STAIR_SEC_PER_STEP 0.8    STEP_TREAD_M 0.35
ROUTE_W_M 1.6        ROUTE_MIN_PX 3            ROUTE_MAX_PX 90
ROUTE_C_DAY          ROUTE_C_NIGHT             ROUTE_GHOST_OPACITY 0.22
TURN_MIN_DEG 35      ARRIVE_H_M 12             ARRIVE_OPACITY 0.55
PULSE_SEC 4          SNAP_MAX_M 60             DETOUR_MAX_M 250
FUZZY_MIN_LEN 4      RESULT_ROWS 6             WALK.ALIASES {...}
```

`js/walk.js` self-registers off `window.__map` exactly as `js/places.js` does
and **needs no `js/app.js` edit**. Its `<script>` tag goes in **both**
`index.html` and `_harness.html` or `harness-drift.mjs` fails, which is the rule
that already caught `js/outer.js` rendering in the harness and not on the site.

### The one thing that is not additive, and what to do about it

Strictly, "off is byte-identical" is true of the **scene** — no source, no
layer, no paint expression until a route exists — but **not of the chrome**: the
button is a new 44 px element in the top-left corner of every frame, including
the recording.

**So build the whole feature behind `?walk=1` and leave the button off `main`
until after the AWS shoot.** With no parameter the app is byte-identical
including chrome, which is the promise `main` is under right now. Flipping one
constant later ships the button. This is an execution call and it is made here
rather than handed back.

---

## 9. What this design does NOT do

* **No indoor routing, ever.** One feature in the whole OSM cache carries an
  `indoor` tag. The route ends at a door and the copy says which door.
* **No "uphill".** No elevation source exists in this repo (§0c). Stairs and
  flights only, until someone bakes a DEM into the graph — and that is a data
  pass, not an interface change.
* **No turn-by-turn list.** "Left on Speedway, right at the Union" is a maps
  app's answer to not being able to show you the city. This app can show you the
  city.
* **No saved places, no history, no account, no schedule import.** Every one of
  them is a second app.
* **No automatic camera movement**, and nothing that touches the intro, the
  tour, the default pose or `ALT_MIN`.

## What I did NOT manage to do

* **Did not open a browser and did not render anything.** No pixel in this
  document was measured; every number is from the data files or from
  `style.css`. The layout is specified, not photographed.
* **Did not build the search index or the graph**, so the match ladder's
  behaviour on real strings is reasoned, not tested. The graph statistics in
  §0a are measured; the routing quality is not.
* **Did not check that the ribbon's rank in PR #78's ground ladder is free.**
  Flagged as the most likely place this ships a flicker.
* **Did not verify the 22 "name-only" buildings are the right buildings** — the
  match was exact on a normalised name, which is strict, but two buildings can
  share a name and no code exists on the footprints to break the tie.
* **Did not measure the load cost of the index.** `data/entrances.geojson` is
  already 5.44 MB raw and QUEUE W3 says nobody has measured it; this feature
  reads it for door points and must not be the pass that finally makes that
  bite.
* **Did not design the empty/first-run state** — what the sheet says before a
  single character is typed. It should probably be three example chips (`WEL`,
  `PCL`, `GDC`) and nothing else, but that is a taste call worth making with a
  picture.
