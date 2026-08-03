# Austin 3D Explorer — Full Handoff

## 56. Aug 3 2026 — downtown was never dark. It was UNDIFFERENTIATED, and the atlas was eating the difference. (acer lane)

**Branch:** `acer/downtown-colour`. **QUEUE F3 / E1's colour question.** Files:
`scripts/bake_outer_facades.py`, `data/outer_tower_palette.json` (its output),
and a new instrument `scripts/verify/downtown-colour.mjs`.
**`data/outer_ring.geojson` is byte-identical — NO RE-TILE IS NEEDED.** `fb`
did not move on a single feature; the palette is a runtime `fetch`, not tile
content.

### The three candidates, each answered by running it rather than reading it

`downtown-colour.mjs` builds the §48 visibility mask ONCE and then re-reads that
same index set under one switched term at a time — one build, one session, and
a `restore` row that came back **0.0** on every run. Tour pose
`downtown-skyline`, tod 0.30, tiled path.

**1. A REGRESSION FROM THE FACADE TILE SWITCH (#84/#94)? NO — and reverting it
would be worse.** The pre-#84 frame is reproducible exactly: set `outer-tower`'s
pattern back to the literal `'mh00'` every tower used to fall through to.

```
                       luma    sd    B-R
today (baked buckets) 119.7   9.0  -13.6
pre-#84 ('mh00')      125.5   7.4  -39.8
```

The switch cost **5.9 luma** and **bought 1.6 of spread**. 5.9 luma is not a
smudge of charcoal, and the old state put all 243 towers on one brick-red
pattern.

**2. THE ATMOSPHERIC FADE OVER-DARKENING? THE EXACT OPPOSITE.** `HAZE_TUNE.on
= false` and the towers **fall to 78.3 luma**. The haze is worth **+41.4 luma**
to downtown — it is the only reason downtown is visible at that range at all.
And `fill-extrusion-vertical-gradient`, which QUEUE F1 names as a suspect, is
worth **-0.3 luma on the towers** (6.8 on the flat ring, where it is doing its
job). **For the fade lane: the ring's vertical gradient is not F1's culprit.**

**3. THE DATA? THE DATA IS RIGHT. THE ATLAS THROWS IT AWAY.** This is the
answer. Population-weighted over the 243 towers:

```
                    luma     sd     B-R
the baked palette  159.2   27.0   +14.6
the ATLAS TILE     131.4   16.3    -9.4     <- 60% of the spread survives
the SCREEN pixel   119.7    9.0   -13.6     <- half of what is left survives
```

### The photograph, and the number nobody had taken

Two references, both CC-licensed, both looked at before anything was changed:
Wikimedia Commons **"Aerial view of Downtown Austin"** (CC BY-SA 4.0, clear
midday) and **"Austin Texas skyline, December 2023 - Day"** (CC BY-SA 2.0).

Twelve individual tower facades sampled off the aerial — and **the swatch sheet
was rendered and looked at before the numbers were used, which is how two of the
fourteen patches were caught sitting on a ROOF and thrown out.**

```
real Austin facades   luma 104.9   sd 28.5   B-R +20.1   (range +1..+45, all positive)
the skyline photo, resampled so the cluster subtends the pixels it does in our
frame                 towers luma 116.5 sd 35.6 | low-rise 127.9 sd 43.7
```

**Our MEAN was already right — 119.7 against 116.5.** So was the bake's own
spread — 27.0 against the photograph's 28.5. **The defect is that only a third
of that spread reaches the screen.** A mass is not a dark thing, it is an
undifferentiated thing, and that is the word he used. Every tower in the
photograph is a different colour from its neighbour; ours were inside a 22-luma
band.

### Where it goes, and why the fix is in the bake

`js/facades.js:drawTile` paints the glazed 51% of a `tg` tile as
`mix(wall, [46,58,74], 0.62)` — so only 38% of a bucket's difference from its
neighbours survives in half the tile — then washes it with
`mix(glass, [255,176,96], golden*0.45)`. **§53 already wrote that request into
this file and nothing came of it**, and repainting `drawTile` moves every
building in Austin, not the 243 that are wrong.

So the compression is **inverted in the file that owns the atlas generator's
input**. That is not a workaround dressed up: `outer_tower_palette.json` is not
a list of wall colours anybody sees. Nothing renders it — checked, including
that the tower FEATURES' own `wd` is dead at render time too, since `js/outer.js`
sends `t=1` to a pattern layer and a roof layer that reads `rd/rg/rn`. Its only
job is to be the number that makes the TILE come out right.

**The map from `wd` to the tile is AFFINE and was FITTED, not assumed** — ten
buckets read straight off the registered atlas images by `tower-atlas-tone.mjs`,
one line per channel, residuals under one level. Two terms:

1. **Spread.** Expand each centroid about the **population-weighted** mean by
   exactly `1/slope`, per channel. Weighted by building count, not by bucket —
   the towers run 6..34 to a bucket and an unweighted mean would shift the whole
   skyline instead of stretching it. Expanding about the mean is the point: the
   mean was already right.
2. **Hue, and the one place it can be put.** `drawTile`'s amber is scaled by
   `golden = 1 - |p-0.5|/0.5`. A bucket's `wg` is weighted by `p/0.5` below noon
   and `1-(p-0.5)/0.5` above it — **the same ramp, both halves of the day**. So
   a fixed cool offset carried on `wg` ALONE cancels a constant fraction of the
   amber at every hour and leaves p=0 and p=1, where there is no amber, exactly
   alone. Put it on `wd` and midnight goes blue. It cancels **half** —
   `AMBER_CANCEL`, a taste knob — because a curtain wall genuinely does pick up
   the sky at sunset and the two references disagree about how much (+20 clear
   midday, -0.3 hazy low sun). And it is **renormalised back to its own luma**,
   so it rotates the hue without dimming anything.

Predicted, then verified against the real atlas — **within one level on every
channel of every bucket**:

```
tg25  predicted 115.7,132.3,143.7   measured 116,132,144
tg20  predicted  80.4, 91.1, 99.5   measured  81, 92, 99
tg23  predicted 146.0,117.3, 87.1   measured 146,117, 86
```

### Result, measured at two ranges

```
                        before   after   reference
atlas tile     sd        16.3    27.0    (the bake's own 27.0)
               B-R       -9.4    +5.0
screen, 2.7 km luma     119.7   116.9    116.5
               sd         9.0    13.1     35.6
               B-R      -13.6    -5.6     -0.3
screen, close  sd          --    30.2     28.5     <- p10..p90 85..169 vs 65..167
sunset  0.62   luma      61.1    59.9
               sd         7.4     8.1
night   0.95   crop sd   12.41   12.40    (unchanged by design)
```

### Four things that went wrong on the way, all of them instructive

1. **THE FIRST PREDICTOR REPORTED THE HUE AS UNCHANGED, AND THE NUMBER LOOKED
   FINE.** `TILE_FIT` was fitted against `wd` while `wg` was still a fixed
   multiple of it, so the fit had silently absorbed `drawTile`'s own wd→wg lerp.
   The moment the amber cancel moved `wg` independently, a wd-only predictor was
   blind to it and printed B-R -9.1, i.e. "no change", next to a spread that had
   genuinely doubled. **A fit absorbs every variable you held constant while
   fitting it.**
2. **A NIGHT REGRESSION THAT WAS A HALF-DRAWN FRAME.** Deriving `wn` from the
   expanded centroid looked like it had cost the night skyline a quarter of its
   contrast (crop sd 12.00 → 8.59, mean unmoved). Interleaved reps — after,
   before, after, after — read **12.43 / 12.41 / 12.40** and the single low
   reading never came back. `pose.mjs` already shoots twice; **after a jump to
   tod 0.95 even twice is not always enough for the facade atlas to land.**
   `wn` is nonetheless left on the ORIGINAL centroid, and for a real reason:
   `TILE_FIT` was fitted at p=0.30, at night `drawTile` does
   `mix(glass,[12,15,28],dark*0.9)` and throws away 90% of the bucket, and
   applying a correction outside the range it was measured in is how you get
   a defect you cannot see coming.
3. **THE SUNSET PICTURE PAIR IS NOT EVIDENCE AND IS NOT QUOTED AS ANY.** The two
   `pose.mjs` runs differ on 98.7% of the frame with the SKY — which has no
   facades in it — moving 61.93 → 69.48. §43's exposure step, and quite possibly
   another lane's live edit (below). The sunset claim above comes from the mask
   probe, whose `outer-midrise` / `outer-3d` / `buildings-3d` rows were
   **identical to one decimal** across the pair, which is what proves one build.
4. **A HAND-PICKED PATCH WAS WRONG AGAIN, for the fourth time in this repo.**
   Five facade patches picked by eye off the close frame; four of them landed on
   pixels that had not changed at all. The mask is not a nicety.

### TWO LANES WERE LIVE IN THE SAME WORKING DIRECTORY, AND THIS IS THE WARNING

Mid-pass, `C:/Users/simip/Projects/austin-3d-explorer` was found checked out on
**`acer/dof-horizon-line`** with `f491f77` committed on it — another lane
editing `js/graphics.js` in the tree I was measuring in. CLAUDE.md's split is by
FILE and that held; nothing collided. **The working DIRECTORY is not covered by
it and that is a real gap.** Every shot here predates `f491f77` by timestamp,
and every A/B pair's unchanged-layer controls were identical, so the numbers
survive — but that was luck, not method. The rest of this pass was done from
`git worktree add`, which is the answer: **if two lanes may run at once, the
second one takes a worktree.** `reap.mjs` is the other hazard — it kills every
headless verification browser on the machine, including the other lane's live
one. It was run `--dry` here and reported nothing to reap, so nothing was
killed.

### What is still owed, with the number, for whoever takes it next

- **The remaining compression is the haze, and it is not this lane's file.**
  Same towers, same build, same tod, two ranges: **close, sd 30.2 and 10.1 luma
  below their own surround; at 2.7 km, sd 13.1 and 24.6 below.** The reference
  photograph puts the gap at **11.4**. So the haze halves the spread and doubles
  the contrast deficit over that distance. It is doing real work (+41.4 luma)
  and this is not a claim that it is wrong — it is the measurement the fade lane
  needs to decide.
- **The ring low-rise is relatively too bright.** Reference towers:low-rise is
  116.5 : 127.9 (0.911). Ours is 116.9 : 150.1 (0.779) — the backdrop is ~17%
  hot relative to downtown. That is `PALETTE` in `scripts/bake_outer.py`, it is
  this lane's file, and it is left alone deliberately: re-grading the whole
  backdrop is "should the city look like this", which CLAUDE.md rule 9 says is
  Simeon's call, not mine.
- **E1's second half is smaller than it reads.** Inside the downtown box there
  are **889** flat prisms left, median height **6.3 m** and only **80 at or
  above 8 m** — #112 already gave the 645 real streetwall buildings their
  pattern, parapet and ground floor. What is left is one- and two-storey
  outbuildings, and a punched window grid is the wrong thing to put on them.
- `TOWER_MIX` is still 42/24/18/16 and still untouched, for the same reason §53
  gave.

Pictures: `docs/shots/f3-downtown-skyline-before-after.jpg` and
`docs/shots/f3-downtown-close-before-after.jpg`; raw frames in `shots/f3-*`.
## 55. Aug 3 2026 — the horizon line was never the haze. It was a CSS blur pinned to a screen row. (acer lane)

**Branch:** `acer/dof-horizon-line`, PR #116. **QUEUE F1 and F2, and they were
one knob.** One file changed: `js/graphics.js`.

### What he said, and what it turned out to be

*"the horizontal line thing is inverted - i prefer this version over the last
but as you can see its still a bit harsh with the gradient on the uppser side.
far away buildings dont have it anymore which is nice"*, with a screenshot of one
tower that is normal at the base and washes out pale toward its top.

PR #107 was right and it is not the suspect. The haze is on the depth buffer now
and it fades by real distance; peeled off on a live frame it moves the ten
100-row bands by **3.01 / 3.86 / 2.70 / 2.08 / 1.62 / 1.24 / 0.85 / 0.74** mean
|dLuma| down the frame — smooth, monotone, no edge, and only 0.74 in the nearest
band. That is a distance fade behaving like one.

**The remaining artefact is `#fx-dof`**, the "distance blur" in `js/graphics.js`:
a viewport-wide DOM rectangle pinned to the horizon ROW, `0.24H` tall, running
`backdrop-filter: blur()` under a mask that ramps in and out. It has no idea what
is in front of what — and the CSS comment on it in `style.css` says exactly that,
and says the real fix is to make it depth-aware. So:

* a **near** building whose top crosses that band gets its upper half blurred and
  its lower half sharp — a gradient up its own face, on the upper side;
* a **far** building sits entirely inside the band, blurs uniformly, and shows no
  gradient of its own — *"far away buildings dont have it anymore"*;
* and a blur pulls the pale sky and the pale distant city **into** whatever it
  covers, so "blurred" reads as "washed out".

It also **is F2**. *"at tod 0.62 the West Campus blocks read as brown lumps with
the detail lost"* is the same band across the same rows of the same frame.

### Measured

Same page, same tiles, same exposure, one toggle — mean `|dI/dy| + |dI/dx|` per
100-row band, i.e. **detail**, at tod 0.62, 1600x1000, one downtown tower filling
the frame from 163 m up:

| rows | band on | band hidden |
|---|---|---|
| 200–300 | 2.43 | **4.60** |
| 300–400 | 4.71 | **10.72** |
| 400–500 | 7.98 | **9.03** |
| all seven other bands | identical to the last bit | |

**56% of the detail in rows 300–400 was being thrown away.** Mean |dLuma| from
removing it: 1.68 / 4.03 / 0.83 in those three bands and **0.00** in all seven
others — a change that starts and stops at a screen row and has nothing to do
with distance. A fresh profile on this branch reproduces the right-hand column
and hiding `#fx-dof` then changes nothing at all (dLuma 0.00 in every band),
which is the assertion that the default really is off.

`graphics.mjs` **27/27** (including "distance blur (DOF) turns on" — the slider
still works), `sky.mjs` **12/12**. Pictures:
`docs/shots/f1-horizon-crop-before-after.jpg` is the clearest,
`f1-horizon-tower-{day,dusk}-before-after.jpg` and
`f2-westcampus-dusk-before-after.jpg` are the frames.

### Why it is OFF rather than fixed

A real depth-of-field needs the colour buffer **and** the depth buffer as
textures. MapLibre owns its framebuffer and hands a custom layer neither. The
colour could be recovered with a full-frame `copyTexImage2D` every frame; the
depth could not — WebGL cannot sample the default depth attachment — so the blur
radius would still have to be guessed from screen position. That is the same bug
with a shader in front of it, at the cost of a full-frame copy per frame, on a
scene that is already GPU-bound. The blur's own defence in the code was *"the
only depth cue available without a depth buffer"*; PR #107 gave the haze a depth
buffer, so that sentence stopped being true and this band was a second, wrong
copy of a cue that is already right.

The slider stays and its hint says what raising it brings back (CLAUDE.md 11 —
taste is his). `dof: 0` in all four presets.

### The trap that would have shipped this as a no-op

**Changing a preset default does not change anything for anyone who has already
opened the app.** `austin3d.gfx.v1` in localStorage holds their old `dof: 0.30`
and the restore loop puts it straight back. His browser is one of those. So
`js/graphics.js` now carries `SETTINGS_REV` / `REV_RESET`: each revision names
the keys it takes back and takes back **only** those. Do not "fix" this by
bumping `KEY` — that also wipes `preset` and `autoDetected`, and re-running the
auto-detect probe can drop a good machine to `performance`, which is a worse
regression than the one being fixed.

### What I tried that did NOT work

* **`fill-extrusion-vertical-gradient`.** The obvious suspect, named in the
  QUEUE, and it is **not** it. `map.getLight().intensity` is **0.2376**, and
  MapLibre's term is
  `clamp((t+base)*pow(height/150,0.5), mix(0.7,0.98,1-intensity), 1.0)` — the
  floor evaluates to **0.9135**, so the gradient can only span 8.6%, and it
  cannot fire at all below `150 * 0.9135² = 125 m` of building. Toggled off on
  all 60 fill-extrusion layers at once on a live frame: the screenshot came back
  **byte-identical**. Leave it alone.
* **The sky canvas washing the tops of towers that cross the horizon.** Plausible
  — it is `mix-blend-mode: screen` and clipped to a screen row — but measured it
  contributes 3.01 / 0.78 / 0.48 mean |dLuma| in the top three bands and **0.00**
  everywhere else, and on a masked tower it moves the top two deciles by ~1 luma.
  Real, tiny, and not what he is seeing.
* **The fog ladder having a base-to-crown gradient of its own.** It does, and it
  is negligible and the *wrong sign*: a shell is a plane of constant view-space
  depth, so a crown is `h·cos(pitch)` metres NEARER than its own base (73.6 m on
  a 267 m tower at pitch 74) and takes slightly LESS haze, not more.
* **Sampling a tower by masking it and taking the median luma per decile.** The
  magenta-mask trick works, but on a glass tower the median tracks the dark
  window glass and the wash never shows. Two poses were measured this way before
  I noticed, and both said "flat" while the picture plainly was not. Peel a
  suspect off and diff the whole frame instead; the per-band diff found it in one
  run.
* **Measuring on a tower whose top is BELOW the horizon.** Every toggle came back
  byte-identical four times over and I nearly concluded the overlays did nothing.
  They were all above the rows I was sampling.

## 42. Aug 3 2026 — DKR rebuild, PART ONE. Not merged, and the reason is the point. (mac lane)

**Branch:** `mac/dkr-rebuild`, PR open and **deliberately not merged**. The brief's
own acceptance test is *"put your render and a reference photograph side by side
from the same angle; if you would not recognise it as this stadium, it is not
done."* I would not. So it stays open.

What follows is worth more than the geometry, because two of the nine faults he
listed **cannot be fixed from this lane at all**, and that was not knowable
before this pass.

### The two blockers, both in `js/app.js`, which this lane must not write

**1. The "cutouts from a big pyramid" is `'fill-extrusion-base': 0`.**
`js/app.js:1191` hardcodes it on `stadium-seating`. A `seat` feature therefore
ALWAYS extrudes from the ground, whatever the bake writes. Forty-four nested
rings of rising height are not an approximation of a bowl — they are a solid
stepped cone, which is exactly the phrase he used. No base means no upper deck
over a void, and no void means no bowl.

**2. The glowing seats are `SEAT_COL`'s night column,** `js/app.js:758-771`:
`#d87c34 / #e08438 / #e88c3e / #f09a48`. Every seat in the stadium is amber
after dark and nothing else is. That is *"the seats become bright yellow and
everything else is dull - what?"*, it has now been rejected twice, and **no
value written into `data/stadium.geojson` can change it.**

**REQUEST TO THE OTHER LANE — one line, and it closes a twice-rejected fault:**
darken `SEAT_COL`'s third column so the bowl is unlit at night (something near
`#3a3d47` for `lower`, falling to `#2b2e36` for `upper`), and if a base is ever
wanted on `stadium-seating`, change the literal `0` at `js/app.js:1191` to
`['coalesce', ['get','base'], 0]`. Both are inside `addStadiumLayers`.

### What I tried that did not work

**Moving the whole bowl onto `stadium-detail`.** It solves both blockers at a
stroke: that layer honours `['coalesce', ['get','base'], 0]` and takes an
arbitrary per-feature day/golden/night trio, so I could author a real floodlight
falloff. I built it, rendered it, and **the stadium was an empty walled pit** —
`stadium-detail` is in `js/lod.js`'s `fine` tier and is dropped above
renderDistance x 0.45, which is 315 m on the default preset. Every view worth
looking at is above that. Reverted to `kind: "seat"`, which survives at altitude
and is stuck with the palette. **You cannot have correct night colour and a
visible bowl at the same time from inside this lane.**

### What the pass did land

- **Height, which he named first.** It was never measured: `h` is the surveyed
  footprint's `final_height`, **63.0 m on all four sides**, and the west took
  72.5 m from Bellmont Hall's own footprint — a figure that is 7.25 m per storey
  over its stated 10 floors, so it is an Overture attribute, not a survey. Wall
  tops are now per side and derived from each side's own MEASURED ring depth:
  **W 41.0, N 34.0, E 33.0, S 17.0 m**, seating topping at 38.5 m instead of
  58.6 m everywhere.
- **Four sides instead of a solid of revolution.** `deck_height(t, h)` took only
  a radius, so every bearing got the same profile — the definition of a drum.
  There is now a per-side deck table blended by bearing (`side_weights`,
  `profile_for`), so the west carries two decks plus a press crown, north and
  east a smaller wrapped upper deck, and the south a single shallow stand. The
  measured ring depths that force this: **W 87.7, E 71.3, N 70.7, S 32.6 m** —
  the south is 2.7x shallower than the west and was being built the same.
- **The rim is light fixtures, not wall** (`RIM_LIGHT`, 79 of them), and they
  are the only thing that stays bright after dark.
- **The 88 m light masts are deleted.** They were generative, they were taller
  than the stadium, and the aerial does not support them: there are no mast
  shadows on the plaza, and the four white discs around the rim sit exactly on
  the surveyed 14 m RAMP TOWER positions.
- **Burnt-orange seating is now in sections, not scattered** — measured by
  classifying `data/dkr_aerial_geo.png`: a continuous band across the NORTH
  upper deck and a block in the EAST lower bowl, with diffuse rust elsewhere
  that is weathering rather than chairbacks.

### Part one, corrected the same night

A five-agent research pass landed after the first commit and moved three numbers
and found a bug I had introduced:

- **The west should go UP, not down.** Published seat counts reconstruct the
  measured ring depth almost exactly: lower bowl 66 rows [P] x 0.74 m tread [M]
  = 48.8 m, plus ~8 m of concourse, plus a 43-row upper deck = **88.6 m against
  a measured 87.74 m [M]** — within 1%. So the west seating tops near **50 m**,
  the press/suite band near **57 m**. The drum came from all four sides
  MATCHING, not from the west being tall.
- **A hard ceiling that settles the masts for good.** Highest LiDAR return over
  the whole site is **68.1 m above field [M]** (City of Austin 2013 footprints,
  validated against the UT Tower at 329 ft returned vs 307 ft published, so it
  includes flagpoles). The deleted masts were modelled at **90.2 m — 22 m above
  the highest return on the site, appurtenances included.** Impossible, and now
  documented as such.
- **The one published height datum in the building:** the Veterans Plaza entry
  towers are **115 ft = 35.05 m [P]**, described as matching the east
  grandstand's. North rim ~32 m sits just under it, which is the corroboration.
- **BUG I SHIPPED IN THE FIRST COMMIT.** The aisle stairs and the midfield logo
  still called `deck_height(t, h)` — the vestigial global table times the raw
  63 m — while the bowl had moved to the per-side profile. Measured: **aisles
  topped at 58.9 m against a bowl topping at 35.7 m, a 23.2 m overshoot**,
  worst over the south end where the bowl is 12 m. Stair rails floating 23 m
  above the seating. Fixed with `bowl_height_at(t, ang, axis)`; aisles now track
  the bowl. **A per-side rewrite has to sweep everything that rides the bowl,
  not just the bowl.**

Final per-side wall tops: **W 53.0, E 36.5, N 34.0, S 26.0 m** (were 72.5 / 63 /
63 / 63).

### Part two — unblocked by PR #114, same night

The Acer shipped both blockers while this branch was open: `fill-extrusion-base`
is now `['coalesce', ['get','base'], 0]` on `stadium-seating`, and `SEAT_COL`'s
night column is dark. That turned two "impossible from this lane" items into one
commit:

- **The upper deck now stands over the concourse instead of growing out of the
  ground.** Lower-bowl rows keep `base 0`; upper-deck rows start at their own
  underside (`DECK_SLAB_M`), and the void is a thin soffit hanging under the
  deck (`VOID_SOFFIT_M`) with daylight beneath it rather than a solid ring.
  **367 of 649 seat bands now start above ground, the highest at 38.0 m.** That
  is the end of "cutouts from a big pyramid" — it was a literal description of
  `base: 0`, and the base is real now.
- **Night reads correctly for the first time.** The field is the brightest
  surface, the bowl is dark, the rim fixtures are the only pale thing, and the
  outside is dark. `shots/dkr2/night.png`.

**The lesson worth keeping:** two of the nine faults were unreachable from this
lane, and the correct move was to write the request down precisely — file, line,
and the exact expression — rather than to work around it. The other lane shipped
it in one PR within the hour. A precise request beats a clever workaround.

### Part three — the entrances, branch `mac/dkr-entrances`

*"there are cool entrances on the southwest and northwest sides."* They were
**one flat disc each** — `disc()` extruded to 22-25 m, five of them, which from
the air reads as a grain silo.

What the aerial shows at 0.129 m/px is an OPEN DRUM with a helical ramp winding
up inside it, which matches the 2008 contractor's note about *"radiused block
walls on the pedestrian ramps ... creates the angular expression seen from the
exterior"*. So each tower is now a wall annulus you can see into, a helix of
3 turns x 8 flights climbing inside it, and a parapet lip — **120 helix flights
across the five towers**, all in `RAMP_TOWER` as one-line knobs.

**And the videoboard was floating.** Its base was `BOARD_BASE_FRAC x h` where `h`
is the footprint's raw 63 m = 37.8 m — against a south wall that part one had
brought down to 26 m. The screen hung **11.8 m clear of the building holding it
up**. It now sits on the south side's own wall height. That is the second time
this pass that something derived from the old global `h` was left behind by the
per-side rewrite; the first was the aisles. **Anything that multiplies `h` is
suspect until it is checked against the side it stands on.**

Still not built: the south end is the pre-2021 arrangement, and its two
seven-storey entry towers are not modelled.

### Also found

- `data/dkr_aerial.png` and `dkr_aerial_geo.png` are **gitignored and were not
  on disk** — MAC_QUEUE says the reference imagery is "already here" and it was
  not. `python scripts/fetch_dkr_reference.py` rebuilds it (15.3 MB, 2915x2882
  at 0.129 m/px) and that is now the first step of any DKR pass.
- **`js/stadium.js` does not exist and nothing references it.** MAC_QUEUE grants
  this lane a file that is not wired to anything; creating it would render
  nothing without a script tag in `index.html`, which is not this lane's. All
  stadium rendering is `js/app.js:1063-1216`.
- Only **twelve `kind` strings render**. A feature with any other kind is
  fetched, tiled, and painted nowhere, with no warning.

### What is still wrong, honestly

The bowl still reads as smooth concentric bands rather than two distinct decks
with a shadow gap between them, because with `base` forced to 0 every band is a
solid ring from the ground and the void can only be a colour, not a hole. The
southwest and northwest entrance structures are still plain discs. The south end
is still the pre-2021 arrangement. **`shots/dkr2/reference-vs-render.png` is the
side-by-side and it does not pass.**
## 54. Aug 3 2026 — West Campus was fourteen more buildings than the pass knew about, and the renderer was throwing their colour away (acer lane)

**Branch:** `acer/westcampus-heroes`. QUEUE **C5** — the last item on his list and
the one he said he cares most about personally.

> *"so many apartments in austin wampus have such cool designs but are currently
> regular building blocks ... personally as someone staying in standard next
> year i love how it looks and if this tool wasn't mine and i saw standard look
> nice i would feel really cool, like 5x better about the project (not saying
> just cherrypick standard but you get what im saying)"*

`scripts/bake_westcampus.py` already did ten TOWERS (55–82 m). West Campus is not
made of towers. It is made of six-to-ten storey blocks, and every one of Simeon's
named buildings that was still a plain prism — **The Standard, Rambler, The
Quarters, 2400 Nueces, The Nine** — is one of those. Tier two adds fourteen of
them. `data/westcampus.geojson` 145 → 401 features, 24 buildings, 37 atlas images.

### The colour was already in the data and the renderer was throwing it away

`bake_detail.py` measures a wall colour per building. `quantiseFacades()` then
elects the FOURTEEN most populous tones city-wide and folds everything else into
its nearest survivor. Measured over the 284 West Campus buildings ≥12 m, that
fold moves a wall by a **median of 13.9 RGB and by up to 97.5** — Ion Austin's
#54555b charcoal is painted terracotta. Rambler's measured #966753 brick came out
#af785d, the same tan as the churches.

A feature in `data/westcampus.geojson` skips the election (`quantiseStadiumFacades`
gives every (family, colour) its own atlas entry), so **bringing a block into
this file is what lets it keep the colour the imagery measured off it.** Read off
the live atlas, **14 of 24 body bands are now closer to their authored colour
than to the nearest of the fourteen city buckets** (Rambler 8.2 vs 24.7).

**The Standard was being painted brick red.** Its snapshot `wd` is #aa8267, which
elects to the terracotta bucket. Humphreys & Partners' own exterior photographs
show a light three-tone panel field — cream, warm grey, charcoal, terracotta
accents, laid up in a broken "pixel" pattern over a two-storey glazed base with a
charcoal corner bay. The body hex is the area-weighted read of that field.

### Balconies are clipped to the footprint, and that is what makes them possible

A balcony slab is a rectangle across a whole elevation in the obb frame. On a
U-plan — Grayson has a light-well notch 18 m into its south elevation, Twenty Two
15 one into its north — that rectangle **bridges the notch and hangs in mid air,
once per floor**. `_clip_to(rect, footprint.buffer(BALC_PROJ))` removes the whole
class of error and still lets a real balcony project. 268 slabs over 14 buildings.

### What tier two deliberately does NOT do — each avoided a defect

- **It never changes a height.** The Standard is 17 storeys (Humphreys: 17
  floors, 287 units, 989 beds, 640 spaces, 1.34 acres, VIP deck on 17). The
  snapshot has it at **20.5 m**, which is the pre-2019 building's LiDAR: OSM way
  380916747 is a 2015 City-of-Austin import whose 19 nodes have never been
  redrawn, and a 2023 edit only added the name. Correcting it belongs in
  `scripts/hero_overrides.json` + `enrich.py`, because `js/controls.js` builds
  its **collision field** from `final_height`, `js/shadows.js` reads it and the
  labels sit on it. Raising it here would draw a tower you can fly through.
- **It never puts anything on a roof `bake_roofscape.py` already furnished.**
  Measured: The Standard carries a generic deck at b=21.50 h=21.75 covering
  **91.9%** of its footprint, plus 16 detail condensers; 2400 Nueces, Sterling,
  Grayson, Twenty Two 15, Block on 25th and The Nine the same. Those ids are not
  in `authoredRoofIds` and adding them needs `data/roofscape.geojson` re-baked,
  which is not this lane's file. **`authoredRoofIds` is now a SUBSET** (10, not
  24) — claiming all 24 would be a delayed-action bug that strips fourteen roofs
  the day someone re-runs that bake.
- **It never cuts a courtyard the data lacks.** 2400 Nueces really has two and
  its 8-node polygon has neither, but the generic roof deck spans the footprint,
  so a hole under it is invisible. Amenity goes only in courtyards that are
  ALREADY holes, placed from **that ring's own obb** as fractions of it, so
  nothing is eyeballed: Rambler, The Block, Pointe on Rio, Crest at Pearl, The
  Nine at Rio.
- **It never touches a pitched roof.** Checked `data/roofs.geojson`: none of the
  fourteen has a facet. Villas on Guadalupe, Block on 25th West and Greenwood
  Towers are left OUT — the first two have hip roofs the nadir shows plainly and
  this tier has no vocabulary for one; Greenwood's footprint sits 10 m off the
  building it names.

### The one thing that cost real work and was then deleted

**The Standard's pool deck.** The z20 nadir post-dates the building and shows the
lap pool, the spa at its north end and the tower shadow across the deck; the
architect's photographs show the jumbotron, the turf strip and the pergola. All
of it was built, measured in the bake's own (u,v) frame and checked by drawing
the rectangles back onto the nadir — and then removed, because every route to
drawing it fails on the same wall:

| route | why it fails |
|---|---|
| on top of the generic deck (21.75 m) | breaks "nothing stands above final_height"; H is 20.5 |
| on a lower stepped wing (the true massing) | the generic deck spans 91.9% of the roof and would hover over the wing |
| at the parapet | `roof_z` is H + cap_lift, still above H |

All three are downstream of ONE stale number. The measured numbers are kept in
the bake so the next lane can restore it in a line. **Fix the height first.**

### What I tried that did not work

- **`ondeck`** — an absolute z for roof amenity, standing on the measured top of
  the generic roofscape deck. Written, working, and reverted: it puts geometry
  above `final_height` by construction, which is exactly what the probe forbids.
- **Pre-compensating the cool greys.** The atlas mean of an `mh` tile is warmer
  and darker than the authored hex (2400 Nueces #9ea8af → #a09890, R/B 0.90 →
  1.11), so a blue-grey block still reads warm. Pushing the authored hex bluer to
  land on target would then be wrong at every other time of day, because much of
  that shift is the scene-wide golden ramp and not the tile. Left alone.
- **Reading `wp` off `map.getSource(...)._data`** — reports every band unstamped.
  MapLibre serialises the GeoJSON to its worker on `addSource` and the stamps live
  on the worker's copy. Use `querySourceFeatures`. Cost 20 minutes and a false
  "the pattern is missing" alarm.
- **A two-page-load before/after.** `?westcampus=0` is a load-time flag, so the
  pair also differs by a camera settle and a tile race — the first attempt came
  back with 40 px of horizon between the frames. `applyWestcampusSettings()`
  swaps both halves in one frame; that is what it is for.

### Owed

- **`scripts/verify/westcampus-probe.mjs` is truncated at HEAD** (66 lines — the
  whole `newPage` / `page.evaluate` block is gone) and dies on "d is not defined"
  before asserting anything. It is one of **17** scripts in `scripts/verify` with
  no `newPage` call left in them; the Mac lane owns that regression. The same 16
  assertions were run from the scratchpad instead and pass 16/16 on 24 buildings.
- The height correction above, which also unlocks the pool deck.

### Measured

- `data/westcampus.geojson` 145 → 401 features (36 → 78 wall bands, 268 balcony
  slabs), 50.1 → 171.7 KB, atlas 19 → 37 images.
- **Nothing stands above `final_height`**: max h − final_height is +0.00 for all
  24 buildings.
- `westcampus-perf.mjs`: delta −100 dropped frames against a within-config spread
  of 49/142, i.e. **no result** — the honest read is no measurable change.
- Two forced time-of-day ticks: 348 ms with the pass on vs 301 ms off (MIN of 7
  interleaved reps, spread 301–750 ms). Inside the noise, and the images stay
  registered when the pass is hidden, so this is a floor on the cost either way.
- Night re-checked at tod 0.95: bands read dark with lit windows, no pale wall
  after dark.

`docs/shots/westcampus-{standard,grayson,rambler,crest,wide}.jpg` are exact
before/after pairs — one browser, one camera, the pass toggled between the two
frames.

## 53. Aug 3 2026 — every pixel this project has measured was of a city with no vector tiles, again (acer lane)

**Branch:** `acer/downtown-depth`, PR #112. QUEUE **E1**.

### READ THIS FIRST — it invalidates numbers, not just this pass's

`_harness.html` loads maplibre from unpkg and **never loaded pmtiles**.
`js/tiles.js` reads that global at parse time and degrades SILENTLY —
`[tiles] pmtiles or maplibre not loaded - falling back to GeoJSON` — so
`TILES.on` went false and **every tiled layer served its GeoJSON fallback in
every pixel measurement any lane has ever taken through that page**: trees,
roads, props, roofdetail and the outer ring.

`e4883d1` is titled *"Every pixel we have measured was of a city with no vector
tiles"*. It added `js/tiles.js` to the harness and stopped one line short of the
library `js/tiles.js` needs. The same bug, in the fix for the same bug.

**`harness-drift.mjs` could not see it.** Its regex was
`/<script\s+src="(js\/[^"]+)"/` — local modules only, so a CDN `<script>` was
invisible. It compares EVERY `<script src>` now and additionally asserts the
pmtiles library precedes `js/tiles.js`, because "present in the list" is not
the invariant; "parsed before the file that reads its global" is. Negative
control run: removing the tag turns both assertions red.

Consequences worth knowing:

- **`--extra "&tiles=0"` and no flag were the same thing.** Every "verified on
  the tiled path" claim in this file predates the harness being able to load
  one. §45's `shots/dt-tiles/` is labelled "tiled, what the site serves"; it was
  not.
- **`outer-check.mjs` was 14/20 on `main`** once the harness could load a tile,
  and had been for passes. Five failures were the check describing a city from
  two passes ago; one was its own instrument. All six fixed, 21/21 now — see
  the commit, and note `querySourceFeatures` on a VECTOR source returns `[]`
  without `{sourceLayer}`, which is why "the ring tiled and is drawing" read 0
  while the ring was plainly on screen.

### E1's colour question, answered with a measurement and a photograph

The brief asked whether downtown reading as a dark grey mass is a REGRESSION
from #84/#94. **It is not, and it is not a luma problem at all:**

```
outer-tower  vs  buildings-3d      luma 119.5 vs 102.1   downtown is 1.17x BRIGHTER
tile path    vs  GeoJSON path      119.5 vs 119.6        the two paths agree
```

**It is the HUE.** Two reference photographs (Wikimedia Commons, *Austin Texas
skyline, December 2023 - Day* and *Austin Skyline from Loop 360 Overlook 2026*)
put the tower cluster at **B−R +1 hazy, +90 clear**. Never negative. The app
rendered it at **−15**.

`tower-atlas-tone.mjs` (new) reads the registered atlas images directly, because
measuring the baked hex and the screen pixel leaves the middle step a guess:

```
palette #8ca0b1 (B-R +37)  ->  atlas tile B-R  -1.3      before
                           ->  atlas tile B-R  +3.8      after
```

Two warming terms, and **only one of them is in this lane**:

1. **`wg` was derived with the masonry rule.** `js/facades.js` uses
   `v * (1.06, 1.06, 0.92)` — redder, greener, LESS BLUE — which is right for
   brick and limestone and wrong for a curtain wall, and downtown's `tg` family
   is **51% glass**. Glass does not warm at golden hour; it mirrors the sky.
   `GOLDEN["tower"]` in `bake_outer_facades.py` keeps the blue. Worth +5.
2. **`drawTile`'s `mix(glass, [255,176,96], golden * 0.45)`.** `golden` is
   `1 - |p-0.5|/0.5`, so at the app's **DEFAULT day `p = 0.30`** it is **0.60**
   and the glass takes a **27% orange wash at what everyone calls noon**. This
   is `js/facades.js` — **NOT this lane's file. This is the request, per
   CLAUDE.md's rule about writing it here rather than making it.** Narrowing
   the golden window, or exempting `tg` from the amber, is worth roughly three
   times what item 1 was.

### The content: 645 downtown buildings stopped being blank prisms

PR #99 gave the 114 towers podiums, setbacks and crowns. Everything under 40 m
kept the ring's flat untextured colour, because the ring's design is "one flat
colour, it is backdrop". **Downtown is not backdrop.** A building at or above
`MIDRISE_H` inside the downtown box is now `t=2` and gets:

- a real window pattern — family **`mh`** (punched, ~20% glazing), NOT the
  towers' `tg`. Its own six-bucket set, clustered on its own masonry colours,
  because snapping a two-storey shopfront onto ten glass centroids is the same
  category error #84 fixed for the towers.
- a **parapet**, on the shared `window.CAP_GEOM` rule, at **zero extra
  features** — `t=2` carries `rd/rg/rn` exactly as `t=1` does.
- **roof plant**: 189 mechanical boxes.
- a **ground floor**. `retail_min_building_h_m` was **18 m — six storeys** — so
  the entire 8–18 m streetwall, 604 buildings and most of what you see at
  street level, had none. **219 bands become 751**, and the band is now capped
  by share of the building so one rule works from 8 m to 300 m.

```
local detail (mean |neighbour delta|) over the mid-rise field   3.35 -> 4.38  +31%
```

Measured on a **controlled A/B — one build, one session, only the data file
swapped**. The first, uncontrolled pair showed a large whole-frame warm shift
that was pure run-to-run drift (§43's exposure step, exactly as documented), so
the controlled pair is the only evidence quoted.

### The tiling claim, measured again on a harness that can actually test it

```
outer.pmtiles          1,819,279 -> 1,982,385 bytes   +163 KB
visitor wire bytes         14.11 -> 14.14 MB          +30 KB   (both reps identical)
load to map.loaded()   main 39.0/24.0 s   branch 19.1/25.8 s
```

**Load time is inside the noise floor and no claim is made about it** — the
spread on one quiet machine is 19–39 s for the same page, which is CLAUDE.md
rule 10's whole point. The BYTES claim survives: the archive grew 163 KB and a
visitor at the spawn pose pays 30 KB of it.

### Geometry: what I got wrong, and the trap I walked into with it documented

Chasing a cube that **looked** like it floated over the street. **It did not.**
`queryRenderedFeatures` says that stack is contiguous — shaft 18.4–105.9, crown
→111.4, mast →121.7 — and what reads as plaza is a 106 m tower's blank roof.
Two crops and a confident read said otherwise; only asking the renderer settled
it. **§37 generalised: an eye is an under-settled instrument too.**

The detector written to check it found real ones. Every raised `k='c'` piece
must have a solid under it whose top reaches its base — **6 did not**:

- the **mast** sat on `ring_centroid(cap)`, and the centroid of a non-convex
  crown is outside it. `roof_seat()` returns a `representative_point`, which
  is not.
- **Frost Bank's spire started 6.5 m above the box holding it up** — at the
  FINS' top while standing on the centre box, which is deliberately lower.
  It starts at `cap_top` and still ends at the same height, so §33's
  re-measure is untouched.
- **one owl fin was off its own crown**: `centroid ± plan_width/2` uses `4A/P`,
  twice the INRADIUS, so on an oblong plan the fins land short.

**6 → 2.** 114 towers re-measured, 0 height mismatches, top still exactly
315.0 m. The detector is now a bake-time assertion (`floating_pieces`).

**AND ITS FIRST VERSION REPORTED 39, WRONG** — it accepted only a WALL as
support, and a mast stands on a crown. A detector that flags its own blind spot
has the exact shape of a real result (§45).

**THE BOUNDING-BOX FIX WAS WORSE AND IS THE PARAGRAPH WORTH KEEPING.** Replacing
the centroid rule with the crown's bbox corners dropped **two** fins instead of
one: Frost Bank's plan is **rotated** relative to north, so its bbox corners lie
outside the polygon. QUEUE already says *"a bounding box is not a shape"* (§50)
and I walked into it anyway. A corner of a rotated rectangle is a **VERTEX of
the ring** — inset by half the fin, then take the furthest vertex from the
centre in each quadrant. All four land, at any rotation.

### Also true, and deliberately not changed

- **`TOWER_MIX` is still 42/24/18/16** and its own comment says it was
  *"eyeballed against the real skyline"*. Re-rolling it from a reference is a
  TASTE call and CLAUDE.md rule 9 says that one is Simeon's, so it is measured
  and reported rather than changed.
- **One election instead of two.** The GeoJSON path used to discard the baked
  buckets and re-cluster the towers in the browser, so `&tiles=0` rendered
  downtown from different arithmetic than the site serves — and the fallback is
  the path you reach for when debugging the real one. Both read `fb` now.
- `downtown-tone.mjs` re-applies the hour AFTER the camera move and asserts it
  took. Its first night run returned luma identical to the day run to one
  decimal (116.4 against 116.5) — it had measured a daylit frame and called it
  night.
- Night re-checked: mid-rise parapet **34.4** luma against the tower parapet's
  **33.4**. §35 item 1 is not reintroduced.

Pictures: `shots/e1-ab-before/` against `shots/e1-ab-after/` (the controlled
pair), `shots/e1-final/` (tiled, what the site serves), `shots/e1-night/`.

## 52. Aug 3 2026 — Speedway was drawn all along, the walks had no surface, and the creek had never heard of a bridge (acer lane)

**Branch:** `acer/ground-speedway-creek`, PR #110, merged `e003b50`.
QUEUE **D6**, **D7**, **D8**, **D9**. (52 because §50 and §51 are already cited
by QUEUE.md for passes that were still in flight when this landed.)

### D6 — "speedway got slimed out". IT WAS NEVER DELETED, and there were two causes

Three separate hunts for a missing polygon came back empty, and each is worth
recording because each looked like the answer:

```
git history of s:'brickpave'   6,132 m2, unchanged across 8 commits
width profile over all 680 m   9.1 m throughout; no gap, no pinch
the resolver's own clip report 87 m2 removed, 1.4%
```

The corridor was fine. **The GOLDEN-HOUR palette was not.** Everything else in
the scene darkens at sunset; the pale-paving band stayed within 4 luma of
midday, so the brick rose to meet the concrete it runs through:

```
                   brickpave vs concrete
day     #e9cca4 vs #dfd9cb   sum|dRGB| 62   dLuma  -9.1
golden  #eec69b vs #e3cba6   sum|dRGB| 27   dLuma  -0.9   <- gone
now     #dda070 vs #cfb692   sum|dRGB| 70   dLuma -12.5
```

0.9 luma is the same brightness with a hint of hue. **tod 0.62 is the default,
and the default is where he looks** — photographed at one identical pose the
corridor is a confident ribbon at 0.30 and a smear at 0.62. Night had the same
collapse (brick sat 4.2 luma ABOVE concrete), less obviously.

**Second, independent cause: the herringbone was buried under its own deck.**
`ground-speedway-brick` was a flat `fill` at z=0; `ground-paths` is a
`fill-extrusion` at `pathRaise` 0.22 m drawn after it. A fill does not win a
depth test against an extrusion above it, so 92% of the weave was painted over
by the surface it decorates — only what `pathOpacity` 0.92 let through survived.
Proved by hiding `ground-paths`: the tile was there all along, complete and
crisp. **Same shape of defect as §49's park pad over the Capitol walks, one
layer down and inside this file's own stack.** Both grain layers are prisms from
`pathRaise` to `pathRaise + pathTexLift` (20 mm) now — the trick
`CHANNEL.sheen_m` already uses over the water.

### D7 — the walks had NO texture, and that is the whole of "ducttape"

`ground-texture` filters `k:'area'`. Every lawn, plaza and car park wore a
grain; every single walk was a flat fill with a hard bright stroke round it. It
was never the colour, it was the absence of a surface. New scored-concrete tile
(pure alpha: slab grid, per-slab jitter hashed on the WRAPPED position, joint +
shoulder highlight, aggregate), `kerbLight` 0.10 → 0.06, new `kerbOpacity`.

A square grid and not transverse bars, on purpose: `fill-pattern` is anchored in
TILE space, not to the feature's axis, so parallel scoring would run across the
walk on one street and along it on the next. A grid is the one scoring pattern
that reads the same at every orientation.

### D8 — 30 road crossings and 23 walk crossings, none of them decked

**Counted before building anything:** 30 road centrelines cross the creek's own
water polygons (11 carry an OSM `bridge` tag, 19 do not — the tag is not the
test; a culvert is not tagged and is still a crossing), plus 23 walks. **Zero
buildings overlap the water**, and DKR's footprint does not touch it, so
"slices through DKR" is the reach beside it, not an intersection.

The mechanism is PR #62's own rule, never applied to the creek: **a `fill` does
not depth-test against a `fill-extrusion`.** `ground-road` is a flat fill at z=0
and `ground-channel` is an extrusion drawn after it, so the trench painted
straight over the carriageway — that IS the creek "slicing through" 21st. The
walks, being extrusions at 0.22 m, won, and crossed the water on nothing.

Two problems, so two mechanisms:
- `RANK[('bank','deck')] = 95`, the top of the ladder, so the trench, both banks
  and all three planting zones give the footprint back in the BAKE (QUEUE A4).
- `ground-deck` is anchored `under` — BEFORE the roads and walks — so the
  carriageway and the pavement paint over their own bridge and what shows is the
  parapet and the soffit.

47 decks, 14,055 m2. The deck is derived from **what is drawn on it** (the band
`widen_roads` will really draw, plus the walk polygons, plus a 0.7 m parapet,
morphologically closed at 3 m so there is no slot of open trench between a road
and its sidewalk), not from a re-buffered centreline.

### D9 — the forecourt was the brightest object in a dusk frame

Same palette fault as D6 from the other side. Median rendered luma of the plaza
paving in front of the Tower, masked so trees and buildings cannot enter it:

```
            tod 0.30   tod 0.62   tod 0.95
before        213.3      159.4       47.1
after         194.5      141.2       45.2
```

Checked at all three hours as the brief asked.

### Whole-file effect

```
same-height pairs   1,354 / 390,562 m2  ->  22 / 20 m2
data/ground.geojson 3,763 KB -> 3,770 KB  (+6 KB for 47 decks)
```

`data/ground.geojson` re-bakes byte-identical, so the pass is reproducible.

### FIVE THINGS THAT DID NOT WORK

1. **A magenta mask on `ground-paths` returns ZERO. Every time.** Twice, with
   settling and re-reads until two agreed — and the layer demonstrably draws
   (hiding it changes the frame completely). It nearly produced the headline
   "Speedway is not rendered at all", which would have been false and would have
   sent the whole pass into the wrong file. The path surfaces are sampled by HUE
   instead (foliage is green-dominant, paving never is). **Masks are trusted all
   over this suite; this one is worth someone's attention.**
2. **The settle loop that made #1 worse.** `if (n === prev) break` with `prev`
   starting at -1 exits on two consecutive zeros, so an unsettled read and a true
   null are the same answer. §37 warns about exactly this and it happened anyway.
   Take the MAX of N reads, never "the first two that agree".
3. **Sizing the deck off the centreline.** Half-width + 3.5 m shoulder on a
   9.5 m street is a 16.5 m slab with 7 m of nothing drawn on it, and it
   photographed as a pale slab lying where the road should be. **Halving the
   shoulder barely moved it** — the number was never the problem; a deck derived
   from a centreline cannot know where the kerb is.
4. **Putting the decks in `ground-channel`.** It is an extrusion drawn after the
   roads, so the deck painted over the carriageway: the fix reproduced the exact
   bug it existed to remove, and only the layer's POSITION fixed it.
5. **Reading "slimed out" as deletion.** Three passes into the data (above)
   before looking at the thing at the hour he actually looks at it. The brief
   said "add it back"; the answer was that it had never gone.

### Owed

The corridor still has no mall AROUND it — the real Speedway is a brick spine
inside a 30 m promenade with a double tree allée and seat walls, and we draw the
9.1 m of brick and nothing else. That is `bake_props.py` / `shape_trees.py`
work, not this lane's.

**Pictures:** `docs/shots/d6-speedway-sunset-before-after.jpg`,
`d7-sidewalks-before-after.jpg`, `d8-creek-crossing-before-after.jpg`,
`d9-tower-forecourt-sunset-before-after.jpg`.


## 49. Aug 3 2026 — the Capitol's walkways were under a park pad, the dome was standing on an invented pyramid, and its merge had been failing in silence (acer lane)

**Branch:** `acer/capitol-walkways-dome`. QUEUE **D1**, all three parts.

*"same thing with capitol building and lawn - looks like u got rid of the
walkways around it those had a cool pattern add them back. also the thing on the
top of capitol buildings looks like its angled. Also its not the right color."*

### D1.1 — the walkways. NEITHER SUSPECT DID IT, and the real cause is worse

The brief named the rank ladder (#78) and the precinct lawns (#93). Neither ever
reads `data/capitol_ground.geojson`. There were **two** causes stacked, and the
first one hides the second:

1. **`bake_capitol.py` was left behind by the line-width pass.** On 2026-08-02
   *"Speedway fanned out because a line-width is pixels and the ground is not"*
   moved every walk in the city from `k:'path'` LineStrings to buffered
   `k:'patharea'` polygons, and `js/ground.js` dropped every `k == 'path'`
   filter in the same commit. This bake was not changed with it. Measured on
   merged main: `data/ground.geojson` holds **0** features with `k:'path'`,
   `data/capitol_ground.geojson` holds **1,480**, and js/ground.js has **0**
   layers that would draw one. Nothing failed, because a source feature that no
   filter matches is not an error.

2. **Even as polygons they were invisible.** `outer-detail` — one
   `fill-extrusion` carrying the outer ring's 309 flat park pads — covers the
   whole Capitol grounds with a slab at `h` **0.45 m**, opacity 1, `#8fa869`.
   `ground-areas` is a flat fill at z=0 and `ground-paths` stands at 0.22 m, so
   **both lose the depth test to it**. Layer order cannot help: `ground-paths`
   is already drawn after it (style index 138 against 129) and still loses.

**How #2 was found, and it is the reusable part.** §48's magenta mask, asked of
*every layer in the style in turn*, counting magenta only inside a box on the
south lawn. Exactly one layer covers it:

```
layers covering >1% of the Capitol's south lawn
   outer-detail   [fill-extrusion]   98.6%
```

**The green everybody has been looking at is the outer ring's pad, not this
bake's lawn.** That is why the grass looked fine and every walk was gone, and it
is why "restore the walkways" was not a one-line change.

### D1.1b — AND THE MERGE HAD NOT BEEN RUNNING AT ALL

`js/capitol.js` appended the grounds with `updateData({ add })`. MapLibre builds
an **id-keyed index of the source's current features** before it will apply a
diff, and gives up if any feature has no id. `data/ground.geojson` and
`data/trees.geojson` carry no ids, so the diff can never apply to either — and
the refusal arrives **in the worker, on the map's `error` event, after
`src.updateData()` has already returned normally**:

```
GeoJSONSource "austin-ground": GeoJSON data is not compatible with updateData
```

The old code logged `1,161 ground features appended` on the line after the call.
Magenta mask over the grounds, before and after the fix:

```
                      before      after
ground-paths          14,683      73,072   px
ground-areas          36,072      60,115   px
ground-paths-casing   10,604      39,746   px
```

Before, **every one of those 14,683 pixels was in the surrounding blocks and
none was inside the grounds.**

**`scripts/verify/capitol-merge.mjs` PASSED THROUGHOUT, and could not have
failed.** It asserts (a) that the console said `appended to`, which the old code
printed unconditionally before the worker rejected the diff, and (b) that
`querySourceFeatures` returns ≥100 trees and ≥200 ground features inside a
**3 km-wide** box — which the surrounding city meets on its own (9,499 and
1,401 measured, with the Capitol contributing zero). A guard that reads a log
line for an outcome is a guard on intent. **It is red now, and red by design:**
it asserts a code path this PR deletes. See "still owed".

**The fix, and why it breaks this file's own design rule.** The Capitol's ground
and trees get their own sources and their own layers, standing at
`CAPITOL.groundLift` 0.46 m — above the pad — with **every paint property
mirrored off the shared layers on every time-of-day change**. "Add nothing new
where something exists" is a rule about not creating a second *definition*; a
mirror reads the shared layer's value back out of the style, so it cannot drift.
It also drops a **26.3 MB** refetch: appending to `austin-trees` means
re-fetching and re-tiling the whole file.

**THE ROOT CAUSE IS NOT IN THIS LANE.** The outer ring should not pad an area
the city models properly, and the modelled box only just grew to include this
one (#105 took the fence from 10.1 km² to 77.4 km²). `scripts/bake_outer.py` /
`js/outer.js` — QUEUE **D11**.

### D1.2 — "angled". IT IS NOT LEANING, AND THAT MATTERED

Measured before changing anything, twice, because a lean and a slope look the
same in a screenshot. Every disc in `data/capitol_dome.geojson` is coaxial to
**0.27 m**, and the isolated layer, painted magenta, at frame centre, reads an
axis drift of **0.0 px over the whole 57 m stack** at bearing 0 and 90. So no
rotation and no offset — the angle is a **surface that should not be there**.

`SKIRT_STEPS`/`SKIRT_HALF` built a nine-step mansard from a square melting into
a circle: **7 m tall, 44 m across at the base**, wrapped round the drum. From
anywhere south of the building it is the largest object on the roof.
**Nothing in either elevation photograph has that shape.** What is actually
there is a LOW hipped roof over the crossing of the four arms, and then a
**square granite attic with vertical walls** carrying the six seals and the
south pediment, with the drum rising straight out of it.

The aerial is not in conflict: the four pale hips radiating from the dome base
in `data/capitol_aerial.png` are a real pitched roof, but they sit at roof level
and they are shallow. That is `COLLAR_STEPS`, 2.6 m of it.

Two more proportions, measured on the building's own 167.7 m footprint width in
a south-oblique photograph rather than recalled:

```
                      reference   was     now
colonnade across        26.5 m    29.7    25.9
dome springing across   24.6 m    30.1    25.1
cornice across          ~28 m     32.2    28.0   (was WIDER than the attic)
```

A dome wider than the drum holding it up is what makes a stack of discs read as
top-heavy. `DOME_SPRING` 0.82 and `DRUM_SCALE` 0.87. After: 31 coaxial pieces,
worst axis offset **5 mm over 57 m = 0.005°**.

### D1.3 — the colour. FACADE_PROTECTED IS HONOURED, AND THAT IS NOT THE QUESTION

```
Capitol feature   wd #bd8477  wf mh  wp mh00
facade palette    palette[0] = #bd8477, source "baked 2026-08-03"
```

The protected tone survives the bake, the election and the switch. **The dome
and the walls carry the identical hex and render as two different materials**,
because `buildings-3d` multiplies the wall by the window atlas and
`capitol-dome` paints `wd` flat. Masked in one frame, one light, at tod 0.30:

```
                    dome      wall     ratio            photograph
before          #b5846a   #815744   1.40 1.52 1.56     1.20 1.21 1.30
after           #a57158   #815744   1.28 1.30 1.29
```

`#d2b0a3` came off a **nadir** tile, which sees the dome's sky-facing paint and
cannot see a wall at all — it could only ever answer half the question, and the
half it could not see is the half the complaint is about. The dome family is now
`lerp(GRANITE, white, DOME_LIFT)` carried through `DOME_MATCH`, one measured
triple that compensates for the atlas the dome layer never gets. The cupola
stopped being grey-green sheet metal; only the WINGS' roofs are that.

### FIVE THINGS THAT DID NOT WORK

1. **A sample box placed by eye.** The first wall reading, `#8d6e4f`, was taken
   from a screen rectangle chosen off a screenshot — and it landed on KTBC
   Studios and the Dewitt Greer building in the foreground, not on the Capitol.
   A number with a plausible magnitude and the wrong subject is the worst kind.
   Every colour here is now masked by repainting the feature and reading the
   clean frame under the mask.
2. **Masking with a brightness threshold.** `r>180 && b>180` misses every shaded
   facet, and *which* facets are shaded depends on the bearing — so the dome
   measured 254 rows tall from the south and 140 from the east, and a lean was
   nearly reported off that. Hue tests only.
3. **`['get','id']` and `['get','name']` as the mask key.** Both match nothing on
   the rendered Capitol; `['get','wd']` works. Two runs were spent on a mask that
   painted the whole city `#101010` and found no green.
4. **Believing the data file over the framebuffer.** `data/trees.geojson` has
   grown to 64,003 features and contains 481 canopies inside the grounds, which
   reads as "this bake's trees are redundant now". Magenta over the south lawn:
   **0 px of 43,594**. The file has them and the map draws none of them.
5. **Mirroring the clones in the same tick.** `js/timeofday.js` calls
   `applyCapitolColors` at line 406 and repaints `trees-canopy` at line 416, so
   the mirror copied the previous hour and the Capitol's grove stayed daylit at
   night — photographed before it was fixed. It is deferred a task now, so it
   does not depend on where in that function the call sits.
6. **A kerb line on the twinned walks, and this is the one the merge rule
   caught.** js/ground.js strokes its walks with a `line` layer, so the twin got
   one too. A `line` does not depth-test against extrusions, and these layers
   have to sit ABOVE the buildings to clear the park pad — so from the standard
   approach pose the Capitol's kerbs drew as a **white grid floating across
   every downtown tower in front of them**. It is only visible when the branch
   is photographed AGAINST merged main at a pose neither change is about:
   origin/main is clean there, the branch was not. Dropped; the walks read
   without it.

**Still owed here:** `scripts/verify/capitol-merge.mjs` asserts a console string
for a code path that no longer exists, and must be rewritten to read
`window.__capitolMerge` and to count inside the Capitol's own sources
(`austin-capitol-ground`, `austin-trees-capitol`) over a box that is actually the
grounds. It was outside this lane's writable set. The Capitol's south portico and
steps, and the south-lawn monuments, are still owed from §23.

**Pictures:** `shots/cap-before-day/` against `shots/cap-after-day/`,
`shots/cap-before-sunset/` against `shots/cap-after-sunset/`,
`shots/cap-after-night/`, and the masks in `shots/paths-mask/` (before) against
`shots/paths-mask-after/`.

## 48. Aug 3 2026 — a tiled roof was painted the colour of its own wall (acer lane)

**Branch:** `acer/jester-greg-littlefield`. QUEUE **C1**, **C2**, **C3**.

### C3 first, because it turned out not to be about Littlefield

*"littlefeild dorm should have a red roof"*. It does not; Carothers and Blanton
either side of it do, which is what makes it read as a mistake rather than as
variety.

**The survey was never wrong.** Littlefield Dormitory measures `run 7.1 m,
eave 0.766` in `roof_runs.json`, and its offset rings run **0.77 / 0.99 / 1.00 /
0.99** out to its own half-span — the most unambiguous full hip on this campus,
a stronger reading than Carothers' 0.88. It gets the right geometry. **The
colour never asks the photograph at all.**

Every facet takes `rd` off the parent building, and `bake_detail.py` sets `rd`
from the OSM `roof:colour` tag when there is one and otherwise from **the
building's own WALL, 12% darker** — a rule with nothing to do with what is on
the roof. Littlefield's wall is limestone, so its terracotta hip renders
`#928776`, a pale tan. `shift_to_measured` cannot rescue that: it moves the
red/blue RATIO by at most 30% and holds luma, which is a nudge inside a colour
family, not a change of family.

**How many share it — the number he asked for. Of the 105 footprints the survey
gives a real tiled slope to, 65 are painted from an `rd` whose red/blue is under
1.55**: greys, olives and blue-greys, median 1.47 against 2.80 for the ones that
came out right.

### The rule, and the second reading that makes it safe

A roof the photograph is SURE is tile is painted a tile colour. "Sure" is two
independent readings, the discipline §37 used for the parapet-cap join: the eave
ring reads tile (`>= 0.55`) AND the whole footprint reads tile (`>= 0.45`).
Cross-checked before it was written, the two agree strongly — at `eave >= 0.55`
the median whole-footprint tile fraction is **0.80** — and the second test earns
its place on exactly one candidate, a roof at eave 0.72 whose footprint is only
0.31 tile, which is rejected and counted.

The colour is not invented: it is the **median `rd` of the pitched roofs that
already have a tile colour**, re-derived from the campus on every bake
(`#964b32`, from 40 buildings), with the constant only standing in when there is
nothing to derive it from. A retinted roof therefore lands on the median of its
own peers, the authored burnt orange does not move, and `shift_to_measured` then
spreads it again by its own measured red/blue. `--no-tile-colour` is the control.

```
33 roofs given a tile colour   (30 by the rule, 3 by override)
 1 rejected by the whole-footprint check
33 parapet caps took the same colour
```

**The caps had to move with them.** `buildings-roof` is painted from the
BUILDING's `rd` — the colour this pass has just decided was not a roof colour —
so leaving it would ring every corrected roof in the tan it was corrected out
of. That is §37's defect with the colours swapped. `deck_caps` never touches a
pitched building, so the `caps` table simply carries them too.

### C1 — Jester, and it was three separate failures

*"make jester look alot nicer if freshman r gonna see this then their dorm
shouldnt look like a prison ... Some of jesters roofs should have the red brick
pattern, some of should have a light gray flat concrete with roof details, the
color is not accurate. add the tennis / volleyball court between the buildings"*

**He is describing the photograph exactly.** Sampled off the z19 nadir tiles in
`data/imagery_cache`, inside the three footprints:

```
                        is_tile   neutral & bright (median)
Beauford H. Jester Ctr   46.5%    33.1%  (176,172,159)
Jester West Hall         28.1%    40.4%  (185,181,170)
Jester East Hall         30.9%    58.5%  (196,197,188)
```

A terracotta tile hip over the low wings, a light grey concrete deck in the
middle. That is the shape `bake_roofs.py` already builds. Three things stopped
it:

1. **The height gate.** West is 51.6 m and East 40.4 m, over `MAX_HEIGHT_M` 34,
   because a tower is flat-topped — true, except that these footprints are one
   polygon covering a tower AND two-storey tile-roofed wings.
2. **The ring survey.** All three read 0.27–0.51 at the eave, under `RING_MIN`,
   because the perimeter runs under canopy and along concrete walkway roofs.
3. **The colours.** The tile came from `rd` (`#948d7c`, a grey-tan) and the deck
   from `roofscape.geojson`'s own dark measurement (`#706a67`, `#7b7673`).

### The override mechanism, and why it is not an edit to the snapshot

A survey rule right 105 times out of 105 does not exist, and the wrong answer is
to hand-edit `buildings.detailed.geojson`, which the next bake silently wipes.
**`data/building_overrides.json`** is a small tracked file read by
`bake_roofs.py`: `roof_run_m`, `roof_over_max_height`, `roof_colour`,
`deck_colour`, `loggia`. Every entry carries the observation it answers in its
own `why` field, in his words, with the measurement beside it.

**The deck colour was entered COOL and DARK on purpose**, and the first cut was
wrong in a way only a pixel read caught. `#b0aca2` — a fair reading of the
measured (185,181,170) — came back on screen at **rgb(218,199,148), luma 199**,
a warm cream and the brightest thing in the frame, next to a campus whose other
roofs sit at 137–150. An extrusion's top face picks up the sun tint, the same
trap §27 records for the DKR deck. `#8f9294` lands at rgb(174,168,132), luma
167: the lightest large roof there, which is what the photograph says, without
glowing. At tod 0.95 it measures luma 16–18 against walls at 14 and sky at 21 —
no pale patch, no inverted silhouette.

### C1's courts — they were already there, which was the problem

`ground.geojson` carries four `k:'area', sport:'basketball'` polygons here
tagged `s:'grass'`, so the app drew a plain green rectangle. What makes a court
read is not its surface: it is the white lines, the fence and the hoops, and
none of those is a surface, so none of them was in the ground file. OSM way
1488977196 names the compound **Caven-Clark Courts**, 36.7 x 54.4 m, four courts
of 14.2 x 22.1 m. `bake_art.py` now draws boundary lines, a centre line and
circle, the keys, backboards and rims, net posts, and a post-and-rail fence —
**not a mesh panel**, because a solid 3.6 m slab round four courts reads as a
windowless building and `fill-extrusion` cannot be see-through. Lines are 0.35 m,
7x over-scale, declared for the same reason the lane markings are.

It rides in `bake_art.py` for **file ownership**, the same reason the
chilled-water plant does. When the ground lane can take it, `s:'pitch_hard'`
plus these markings belong there.

### C2 — Gregory Gym's entrance

*"greg gym is split into two sections (one building) one should replicate the
famous entrance with the three hall things and the roof."*

**Which wall was settled before any geometry was written**, because the wrong
face is worse than nothing. Three independent readings agree on the west side:
OSM node **1427259422** is `entrance=main` at 30.2840096,-97.7368337; the postal
address is 2101 Speedway, and Speedway runs down the west side; and the nadir
tile shows no comparable approach on any other face. **What I could NOT
establish is which of the two blocks is the 1930 auditorium** — RecSports says
the 1962 addition "extended down to 21st Street", which is the south block, yet
the south block is the one with the tile hip and the north block carries the
modern clerestory. So the porch sits on the wall the entrance node is on, and it
is one line in the override to move it.

The wall itself is found FROM THE FOOTPRINT — the polygon edge nearest the given
point — and the outward normal is tested, not assumed (offset a metre, ask
whether you are still inside). So the porch cannot float off the building.

**The arch is not a stack of squares** (QUEUE D3's fair complaint about the
sculptures). `fill-extrusion` cannot tilt a face, so a round arch has to be a row
of prisms — but the row is cut ACROSS the opening and each prism's BASE is the
arch's own curve, `spring + sqrt(r^2 - x^2)`, sampled at 11 points. The steps end
up in the top edge of the spandrel, where nothing looks at them.

### THINGS THAT DID NOT WORK

1. **The stair was built at negative v — inside the building.** Five slabs, and
   the render showed a portico with no steps rather than an error, because a
   slab inside a solid prism is simply invisible. Caught by a mechanical check,
   not by eye: every part of an outward porch must have its centroid OUTSIDE the
   footprint, and the stair had 3 of 4 corners inside. **That check is now in
   `loggia_parts`, and it drops and shouts.**
2. **Reading Jester's roof off the nadir tile without drawing the footprints on
   it first.** Twenty minutes went into "that courtyard building cannot be
   Jester" before an overlay of the actual polygons settled it. Overlay first,
   argue second — §50's "a bounding box is not a shape", one step earlier.
3. **The aerial "monumental stair" west of Gregory Gym.** A striped grey
   rectangle with terracotta trim that looked exactly like a flight of steps.
   Measured against the footprint it is 11 x 33 m and sits clear of the
   building: it is a canopy on the Speedway mall, not a stair. The OSM entrance
   node is what the placement actually rests on.
4. **Importing `bake_detail.py` to borrow `make_roof_colors`.** That module runs
   its whole bake at import — reads the snapshot, writes two files — so
   importing it to reuse nine lines would re-run it as a side effect. The three
   functions are copied, with the drift risk written next to them.
5. **Letting the deck's membrane-vs-tile vote decide Jester.** The probe's own
   sample ring there is half tile and half concrete, so `membrane` is a coin
   flip on a roof whose middle is plainly concrete. The override names the
   answer as well as the colour; naming only the colour left it unused half the
   time.
6. **`#b0aca2` for the concrete deck** — see above. A colour that is right on
   the photograph is not right on the screen; read the pixels of your own render.

### Verified

`harness-drift.mjs` PASS before every measurement. Day 0.30, dusk 0.62 and night
0.95 at Jester, Littlefield, Gregory Gym and the courts; wide campus before and
after at the same pose from the same session, with the baseline `roofs.geojson`
swapped in and out rather than a checkout. Bake audits unchanged and clean:
`roofs_with_a_hole` 0, `roofs_drawn_twice_or_over_air` 0, `folded_rings` 0,
`walls_with_no_slope` 0. `data/roofs.geojson` 1,240.8 -> 1,349.0 KB;
`data/art.geojson` 269.3 -> 315.0 KB for 166 court parts. Pictures in
`shots/cbefore/` against `shots/cafter/`, `shots/cwide-before/` against
`shots/cwide/`, plus `shots/cdusk/` and `shots/cnight/`.

### Known remainder, deliberately not in this PR

**Jester's massing is still wrong, and it is not this lane's file.** Each hall is
ONE prism at the tower's height, so the two-storey wings around the courtyards
are extruded to 51.6 m and 40.4 m. The roof is now right for what is modelled
and reads correctly from the air, which is how this app is used; fixing the
wings needs `building:part` splitting in the buildings bake. Same for the WALL
colour he flagged: `caps` can only reach `rd/rg/rn`, so `wd/wg/wn` on Jester
(`#c2b6a0`) is untouched here.


## 47. Aug 3 2026 — a road's width was a number of pixels, and the fence was drawn round the campus (acer lane)

**Branch:** `acer/road-width-fence`, PR #105, merged `a420d07`. QUEUE **A2** and
**A7**.

### A2 — "some roads dont do this" was the answer, not the puzzle

*"when im all the way down vertically and look at an angle towards the roads and
start facing upright, the roads get bigger. some roads dont do this."*

The roads that DON'T are the **sidewalks**. PR #70 moved their width out of
`line-width` and into the geometry and the carriageways were left behind — two
representations in one frame, which is exactly what "some do and some don't"
looks like. Nothing about the report was mysterious once that landed.

**Why pitch is what he noticed.** A `line-width` is one constant number of
SCREEN PIXELS for the whole line, so it can be right at exactly one distance —
and `w · 2^zoom / 67546` is derived from the map-centre scale, so that distance
is the map centre. `js/controls.js` holds altitude and derives zoom, so pitching
over drags the centre away from you (at 90 m, pitch 30 puts it 52 m ahead and
pitch 86 puts it 1,287 m ahead). Everything nearer than the centre is drawn too
NARROW and everything beyond it too WIDE, and pitching moves the whole frame
across that boundary.

**Measured in rendered pixels**, mid-block on Guadalupe (17.0–20.4 m in the
data), eye at 21st, 90 m up, bearing north:

    321 m out   before  x1.5 at pitch 50, x2.0 at 60, x1.0 at 82
                after   x1.0 at 50, 60, 75, 82 and 86
    657 m out   before  x0.5 at pitch 60, x1.0 at 82, x0.9 at 86
                after   x0.9–1.1 at every pitch

Half to twice its real width, depending on where you looked. `widen_roads()` in
`scripts/bake_ground.py` buffers every near carriageway and separate cycleway by
half its tagged width and unions per (class, surface): **3,015 `k:'roadarea'` /
`k:'cyclearea'` polygons**. `ground-road` is a fill; the kerb is a 2.6 px stroke
on the polygon boundary, in pixels on purpose (a kerb is a screen-space
highlight — the same argument `GROUND.kerbPx` already makes).

**The far-field armature stays a line, under a 3 px ceiling.** Everything in it
is at least 3.4 km away, measured off `roads.geojson` against the campus centre,
where a real 14 m carriageway is 3.0 px or less. A width that no longer depends
on the road's metres cannot fan. Polygonising it measured +185 KB gzipped to
draw roads nobody can reach.

**THE COST, AND IT IS THE ONE THING TO REVISIT.** `data/ground.geojson` went
1.58 → 3.59 MB raw, **293 → 738 KB gzipped**. Time-to-city was unchanged (min of
two interleaved reps on localhost, 6.97 s after vs 6.98 s before), so this is
transfer, not parse — but `ground.geojson` is NOT tiled and downloads whole.
**These polygons belong in `roads.pmtiles`.** That needs a `data/roads.geojson`
rewrite plus `gh workflow run build-tiles.yml`, and merging code before the
archive lands would leave the two disagreeing, which is the "a missing layer
makes every metric look better" trap. It is a follow-up with its own PR.

### A7 — "locked almost halfway" was literally true

The fence was the bbox of `scene.buildings` (campus + Capitol) padded 250 m, so
its south edge was **lat 30.2685**, and the downtown bake runs
**30.2560–30.2770**. 59% of the way down downtown. Downtown is not in
`scene.buildings` and never was — it is 8,428 outer-ring buildings on their own
tiled source.

The fence is the **modelled-city box** now, mirrored from `bake_outer.py`'s
`OUTER`. `fetch_city_trees.py` already writes the identical box in its own
header as *"modelled city … the buildings you can see"* and plants the canopy to
it, so this is a mirror of a definition two bakes already share, not a number
somebody picked.

    old   1.7 km W / 1.4 E / 1.8 S / 1.5 N of campus centre    10.1 km²
    new   5.1 km W / 3.7 E / 5.2 S / 3.6 N                     77.4 km²   (7.6x)

Driven through the REAL controller (keydown on `window`; a `jumpTo` teleports
past a fence that lives in the tick): south from campus he crosses all of
downtown and eases to a stop **89 m short of the fence at 5.4 m/s**. The ring's
own density says that edge is city and not blank: 1,956 buildings per 500 m band
at 2.0–2.5 km, still 485 at 4.0–4.5 km, 8 past 6.5 km, and every building over
40 m is inside 3.5 km.

### Widening the fence alone would have been a WORSE bug than the one it fixed

The collision grid is rasterised from `scene.buildings`. Past the campus there
was nothing to hit, and the new fence reaches 315 m towers. `maxHeightIn` is the
single choke point every collision path reads through — block-and-slide, the
rooftop floor, the speed brake, wall deflection, `writeToMap`'s hard net — so
teaching THAT about the ring gives all five of them downtown collision for free.

The ring is tiled, so there is no moment at which its full extent exists in the
browser. The second field is therefore built **incrementally, from whatever the
source is currently holding, every time the map settles**. Flying at a tower
means looking at it, which means its tile is loaded. **Bounding boxes, not
rasterised footprints** — and unlike §50 that is right here rather than lazy:
§50 is about SIZING something from a bbox, where over-covering throws a fan deck
off a roof; for a collision net over-covering stops you EARLY, which is the safe
direction. Flown at the 315 m tower at Sixth & Guadalupe at 80 m: deflected and
held at the facade, 31 m from the centroid.

**Budget it or it drops frames.** First measurement, unbudgeted: **8.9 ms
average and a 35.1 ms worst** — two frames gone, the kind of thing that gets
reported as "it stutters sometimes" and is never found. Now a 4 ms budget with
resume-next-frame, a de-dup set keyed on position+height (the same building
arrives in every later scan and in every overlapping tile), a
`['>', ['get','h'], 12]` filter pushed INTO `querySourceFeatures` so MapLibre
drops the low-rise before it builds the objects, and a backoff to 6 s when a
completed pass added nothing: **3.65 ms average over 106 scans in a 100 s
flight**, worst 13.9 ms. `querySourceFeatures` itself is the part that cannot be
budgeted — it builds the whole list before returning — so the cheapest saving
available is not making the call.

### What did NOT work, and two of these cost real time

1. **`road-fan.mjs` cannot verify this fix.** It reads the layer's own
   `line-width` expression, so on a fill it prints `GEOMETRY` and exits 0. True,
   and a tautology — §33's trap in a new costume. The A2 numbers above come from
   a framebuffer probe instead: magenta mask, horizontal cut, run length divided
   by what `map.project()` says 10 m of that same ground is.
2. **A pitch sweep that samples near the map centre reports 1.00x before AND
   after.** Correct by construction and useless. The samples have to be fixed
   ground points well beyond the centre.
3. **Sample points picked by eye put two of four in junctions**, where the bake's
   union genuinely does merge Guadalupe with the cross street into one wide slab
   — so the probe read x3.5 on a build that was correct. They are now the centres
   of the four longest gaps between crossing streets, found from the data.
4. **"The kerb is what darkened the far field."** Very plausible: the casing went
   from 1.16x the road's own drawn width to a constant 2.6 px, which at 4 km is
   wider than the road it edges, and it is 38% darker than asphalt. Measured with
   the layer toggled: **0.89 luma** in the far band. Wrong. The far band is 2.17
   luma darker because roads NEARER than the map centre used to be drawn too
   narrow and are now correct — the fix working, not a regression.
5. **A per-tile `distance-from-center` width correction** instead of geometry,
   abandoned before coding: roads tile at z≤16 and overzoom, so the width would
   step every ~527 m along a street. A road that changes width mid-block is a
   seam, which is a glitch, which is the thing being fixed.
6. **Two columns of the new probe are still not trustworthy** and are said so
   rather than hidden: at 1190 m and 1453 m under pitch 82–86 a horizontal
   scanline near the horizon stops cutting one road and starts crossing a whole
   block of contiguous pavement. Both builds report nonsense there.
7. **The A/B screenshots were taken twice.** The first set was on a working copy
   four commits behind (PR #103/#104 had landed), so they were re-shot after
   `git pull --rebase` confirmed `0 0`. The rule in CLAUDE.md is there because
   this is easy to do.

### Two things the next lane should know

- **`scripts/verify/node_modules` vanished mid-session** and every verify script
  died with `ERR_MODULE_NOT_FOUND` on `playwright-core`. Almost certainly another
  lane running `npm ci`, which wipes the directory before it repopulates it.
  `cd scripts/verify && npm ci` puts it back in 7 s. Do not conclude the harness
  is broken.
- **`ground-luma.mjs` and `roads-luma.mjs` now under-report the roads.** They
  call `setPaintProperty(id, 'line-color', …)` on anything matching
  `^ground-road`, which is a no-op on a fill (their `set` helper swallows it).
  The same thing already happened to `ground-paths` at PR #70 and nobody noticed.
  They need `fill-color` for `ground-road` and `ground-cycleway`; not this lane's
  files.

**Shots:** `shots/a2-before/` and `shots/a2-after/` (same three poses),
`shots/a7-fence/` (downtown from inside the new fence, and the south fence edge
looking back into the city).

## 46. Aug 3 2026 — a pitched frame is not at one zoom, so the far half of the city was stuck at one hour (acer lane)

**Branch:** `acer/facade-atlas-tier`, PR #103, merged `715fa49`. QUEUE **A1** and
**A4** — "the worst bug in the app". They are one defect seen from two sides,
and **the report named the mechanism**: *"it happens every quarter... fly over
each chunk to fix that chunk... they go back to being dark after a while"* is
TILES, and the quadrant boundaries are tile boundaries.

### THE FACT THAT MAKES THE WHOLE THING WORK, AND IT IS IN NONE OF OUR NOTES

**Past about 60 degrees of pitch, MapLibre picks a tile zoom PER TILE, by
distance from the camera.** `MercatorCoveringTilesDetailsProvider.allowVariableZoom`
returns true when `pitch > clamp(78.5 - zfov/2, 0, 60)`, which at this fov is
exactly 60.0. **This app spawns at pitch 74 and orbits at 73.** Measured at the
spawn pose, `getVisibleCoordinates()` on `austin-buildings`:

```
camera z16.50 pitch 74
in-view building tiles:  z13 x3   z14 x4   z15 x2   z16 x1   z17 x2   z18 x2
```

Six tile zooms in one frame. The facade pattern id is chosen by
`['step', ['zoom'], ...]`, and **MapLibre evaluates a zoom expression at the
TILE's zoom, not the camera's** — so a single pitched frame samples all three
mip tiers at once, the near field from one and the far field from another.

`updateFacades` repainted only the tiers `activeTiers(map)` named, which come
from the CAMERA's zoom, and left the rest in a `_stale` set drained on a `zoom`
event. At z16.5 that set is mid+near. **Tier `x` covers every tile at z below 16
— 9 of the 14 tiles on screen — and could not be reached at all** without flying
below z16 entirely. Its own comment defended the scheme as free because "in
practice the hour does not change mid-flight". Both halves were false.

### MEASURED, because "half the buildings" is not a number

Mean luma over the 100 registered images of each tier, spawn pose, one page load:

```
                            near     mid     far
BEFORE  after DAY           148.7   148.7   153.6
        DAY -> NIGHT         63.5    63.5   153.6   <- A4: daylit walls at night
        night, out to z14,
        back, then DAY      148.7   148.7    63.5   <- A1: night walls in daylight

AFTER   every step          identical across all three tiers
```

Worst per-bucket spread between tiers during a **40-step continuous drag at
40 Hz** (ten times the app's own quantised cadence): 24.5, against about 85 for a
tier a whole hour behind. **400 ms after it stops: 0.21.**

The pictures are the honest half: `shots/a1-before/a1-day-bearing-160.png`
against `shots/a1-after/a1-day-bearing-160.png` — same camera, tod 0.30, blue
sky, and in the BEFORE frame everything past the creek is charcoal-black with
night windows behind a hard vertical seam down the middle of the screen.
`shots/a1-crop/before-dt.png` vs `after-dt.png` is the A4 side: the downtown
skyline was a row of solid daylight slabs in the middle of a night frame.
`shots/a1-merged/a1-day-bearing-160.png` is the same frame re-verified on merged
`main` at `715fa49`, with `harness-drift.mjs` PASS before it.

### THE RULE NOW

**Every mip tier holds the same hour, always.** The lazy scheme survives only as
a LATENCY path — the camera-active tiers are painted in the calling frame so a
slider drag stays responsive — but the flush of the rest is on a TIMER that
always fires (`window.FACADE_ATLAS.FLUSH_MS`, 90 ms, a FLOOR and not a debounce)
rather than an event that may never come. `_tierP` records the hour each tier
actually holds, so "stale" is derived from the pixels rather than remembered in
a set that can be cleared without them changing.

Also: new combos registered after `initFacades` (`quantiseOuterFacades`,
`registerFacadeBuckets`) now draw at the ATLAS's hour, not at
`window.__todCurrentP`. And the silent `catch` around `map.updateImage` warns
once — `ImageManager.updateImage` THROWS on a size mismatch while MapLibre's own
wrapper only fires an error event, so swallowing it freezes the atlas at one
hour and looks exactly like this bug.

### THE COST, AND TWO THIRDS OF IT PAID BACK

`updateFacades` 57.7 -> 100.1 ms (min of 6 interleaved reps, hardware GL, no CPU
throttle, both configurations in ONE page load). One extra tier per repaint, and
it is the expensive tier: the far one carries the widest blur, the near one
carries none.

- **`softenTile` is a sliding-window box blur now** — O(n) instead of O(n\*r).
  `tmp` holds the window SUM rather than the mean, so every intermediate is a
  small integer and the result carries NO rounding (the old code rounded `s/win`
  into Float32 halfway through). Checked against the old implementation over 20
  cases at the radii actually used, RES 64 and 128: **worst channel difference
  0**, with a negative control (window skewed one texel) reading 23 and caught.
- **`tileData` hands MapLibre a view, not `d.buffer.slice(0)`.** Both `addImage`
  (`new Uint8Array(data)`) and `updateImage` (`RGBAImage.replace(data, copy=true)`
  for a plain object) copy on their side — read in the 5.24.0 source rather than
  assumed. That was 300 x 64 KB of memcpy and garbage per time-of-day step.
- The blur scratch buffer is reused instead of allocated per image.

### WHAT DID NOT WORK

- **The first cost measurement said the fix was free (56.6 vs 57.3 ms) and it
  was wrong.** `scheduleFlush` returned early whenever a timer was pending, so
  setting `FLUSH_MS = 0` to force the synchronous path was silently inert and
  both configurations measured the same code. **A knob that does nothing reads
  exactly like a change that costs nothing.** Fixed in the same PR: `FLUSH_MS = 0`
  clears a pending timer and flushes in the call.
- **The first combo audit reported 50 missing images and it was the audit.**
  `wp` is OVERLOADED across three independent pattern systems: `js/drag.js`
  writes `dg-*` and `js/moody.js` writes `health-body-grey`, and both paint it
  with a plain `['get','wp']`, untiered, one image per id repainted every
  time-of-day step. **They are immune to this defect by construction.** Only the
  facade families (`^[a-z]{2}\d\d$`) go through `facadeTierExpr`. Worth knowing
  before anyone greps for `wp` and assumes one owner.
- **The brief's third suspect is not the cause.** *"a combo added after
  initFacades has no image and MapLibre paints it transparent"* — audited after a
  day/night/day round trip: **33 pattern ids asked for by loaded features, 0
  missing at any tier.** MapLibre's `addImage` sets `_changedImages` and
  `_updateTilesForChangedImages` reloads the tiles that depend on it;
  `updateImage` deliberately does NOT, which is the other half of why this bug
  existed at all.

### THE NEXT WIN IN THIS FILE, WITH THE NUMBER ATTACHED

**The far tier is 128x128 texels to fill 16 CSS px** — about 32 device pixels, so
it carries 16x more texels than it can ever show, plus a prefilter blur to cope.
A real mip chain halves the resolution per level. Doing that would make the far
tier roughly 16x cheaper AND remove the blur it exists to carry (downsampling IS
the prefilter), which is where the remaining ~40 ms lives. Not done here because
it resamples every far-field wall and A1 should not wait on a taste review.

### TWO THINGS FOR OTHER LANES

1. **QUEUE E1's note that "downtown towers read as a dark grey mass next to a
   warm campus" is at least partly THIS BUG**, not a design choice — compare
   `shots/a1-crop/before-day-skyline.png` with `after-day-skyline.png`. Re-read
   E1 against the fixed build before adding anything to downtown.
2. **The A1 assertion is not committed**, because `scripts/verify/` was not this
   lane's to write. It is fifteen lines and it should be adopted — it is the only
   thing that will catch this coming back:

```js
// after driving tod day -> night -> day, in the page:
const im = window.__map.style.imageManager.images;
const per = {};                       // tier suffix -> mean luma per image
for (const k of Object.keys(im)) {
  if (!/^[a-z]{2}\d\d/.test(k)) continue;      // facade families only
  const d = im[k].data.data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
  (per[k.slice(4)] = per[k.slice(4)] || []).push(s / (d.length / 4));
}
// ASSERT: for each bucket index, the spread across tiers is small.
// A tier a whole hour behind reads ~85 luma apart; settled, it is 0.2.
```

The camera must be PITCHED past 60 for the defect to exist at all, so the probe
has to use the spawn pose (pitch 74). At pitch 45 every tile is at one zoom and
the bug is invisible — which is very likely why it survived this long.


## 45. Aug 3 2026 — downtown was forty boxes, and the crown was stacked on top of the height instead of carved out of it (acer lane)

**Branch:** `acer/downtown-detail`, PR #99. QUEUE **D2c** — the CONTENT half of
D2. PR #84 fixed the BUG (the baked facade buckets finally rendered, so downtown
stopped being one flat brick-red); every one of the 114 towers was still a single
prism from the pavement to a flat cut.

`scripts/bake_outer.py` PASS D decomposes a tower into **podium / shaft / crown /
mast**, PASS E puts the **parks** on the ground. `js/outer.js` gains ONE layer
(`outer-detail`, flat colour, filtered on a new `k` property) and a
`fill-extrusion-base` that coalesces a new `b` property to 0 on the two wall
layers.

```
podium 113 of 114      crown 106      mast 36      ground band 219
curated massings 10, unmatched 0      park/plaza pads 309
by kind: tower 243  flat 7,511  crown 146  band 219  green 309
```

### THE ERROR THAT ONLY THE RE-MEASURE COULD SEE

**The crown and the mast were stacked ON TOP of `h`.** `h` is the ARCHITECTURAL
height — `outer_heights.json`'s 90 entries are published roof-or-spire figures
and Overture's are LiDAR returns off the highest thing on the roof — so the
crown is **already inside that number**. The first cut took **Waterline from a
correct 315 m to 365.8 m**: a 16% error on the tallest building in Texas,
introduced by a pass whose entire subject is the skyline. Nothing on screen said
so. A 366 m tower standing next to a 315 m one still looks like a skyline.

§33's rule is what caught it, and it had to be *re-derived for this shape*: a
tower is now up to eight features, so `main()` walks the emitted pieces, groups
them **by which tower emitted them**, and asserts the tallest lands on that
tower's own height. **114 checked, 0 mismatches, top of file exactly 315.0 m.**

**And the FIRST version of that check was itself wrong.** It grouped pieces by a
padded bounding box and reported four errors — all the same artefact, the Four
Seasons at 40.3 m "measuring" 111.4 m because the tower on the next lot dropped a
mast inside its box. Guessing at the grouping made the instrument wrong in
exactly the way the instrument exists to catch. Every piece is now handed to its
producer's own bucket at emit time.

### A SHORT LIDAR RETURN UNDER A TALL BUILDING IS A MEASUREMENT, NOT AN ERROR

`PODIUM_RULE` has known since it was written that Overture sometimes returns
18.7 m for a 63-storey tower. It treated that as noise to be replaced. **It is
the roof of the podium** — a surveyed number for exactly the thing PASS D needs.

The first test asked whether `src == "podium_rule"` and got **1 measured podium
out of 114**, because PASS B's curated heights overwrite `src` for precisely the
named towers whose reading is short — Sixth and Guadalupe, Northshore, Fairmont
and One American Center were all being derived. **Test the NUMBER, not which rule
set it: 1 becomes 10.**

### THE PROBE SAID THE LAYER OWNED ZERO PIXELS, AND IT WAS THE PROBE

`scripts/verify/outer-detail-mask.mjs` is §48's magenta mask. Its first answer
was **`outer-detail` owns 0 px** — on a frame full of crowns. The cause is §36
point 4 in a new costume: it asked for the authored `#ff00ff` within 40 per
channel, and **this scene is lit and graded, so #ff00ff lands at about
(236,42,154)** — B is 154, not 255. It classifies by colour DIRECTION (cosine on
the normalised pixel) now.

**It was caught in one run because the next thing done was a PICTURE**
(`shots/dt-mask/magenta.png`), which shows every crown, mast, ground band and
park pad in magenta. **A wrong instrument reading zero has the exact shape of a
real null result** — §37's rule generalised: an under-settled read is a wrong
answer, and so is a mis-calibrated one.

Related, and NOT a defect: **`outer-tower` measures 0 px forever**, because it is
painted with `fill-extrusion-pattern` and ignores `fill-extrusion-color`. The
probe says so rather than warning.

### THE TILING CLAIM, MEASURED — BYTES YES, DRAW NO

```
outer.pmtiles       1,634,165 -> 1,819,279 bytes   +180.8 KB  +11.3%
outer_ring.geojson    505.7 -> 565.8 KB gzipped    (the fallback path)

load to first idle, 4 interleaved reps per side, MINIMUM taken
  main         25,446 ms   26631 25867 25628 25446   17,548 KB  outer 222 KB
  this branch  26,319 ms   26434 26319 26338 26497   17,576 KB  outer 250 KB
               +873 ms (+3.4%)                          +28 KB      +28 KB
```

**The archive grew 181 KB and a visitor at the spawn pose downloads 28 KB of
it** — that is what "detail is free once it is tiled" was supposed to mean, and
for BYTES it is true. First-idle is ~0.9 s slower and 7 of the 8 readings
separate cleanly, so it is probably real: **674 extra fill-extrusion features
are not free to tessellate and upload even when their bytes nearly are.** Quote
both halves; the bytes number alone is the flattering one.

Caveats, per CLAUDE.md rule 10: no CPU throttle (`perf.mjs` defaults to 4x), and
the byte counts are `content-length` on a PAGE-SCOPED response listener, which
under-reports anything MapLibre fetches from a worker.

### Night — the §35 item 1 test, passed with numbers

Merged result, tiled path, tod 0.95, same pose:

```
frame median luma below the horizon      31.7
outer-detail   177,363 px  11.09%   mean luma 29.7   320 px over luma 45
outer-3d       237,675 px  14.86%   mean luma 34.9   131 px over luma 45
```

The crowns are **0.94x the frame's own median** — darker than the city around
them — against DKR's bowl at 3.5x. The same 177k pixel set at day and at night,
so it is the same surfaces being measured both times. **The threshold is a
multiple of the frame's median, never a constant** (§35's instrument finding,
applied).

### Smaller things that are worth knowing

- **The parks are `js/ground.js`'s greens, copied byte for byte from its `SURF`
  table.** Authoring a second green would put a seam along the core box edge
  where the ring's parks meet campus's lawns. Copy, do not re-derive.
- **`plan_width` is `4A/P`, not `sqrt(area)`.** For a square of side s both give
  s; for a 12 x 90 m slab `sqrt` says 33 m and the setback whittles it to
  nothing. Twice the inradius returns the SHORT dimension, which is the one that
  decides whether an inset survives.
- **The ground band is outset 0.40 m.** A band coplanar with the wall above it is
  §34's A2 finding at building scale — two coplanar faces have no defined winner.
- **`data/outer/downtown_green_raw.json` is committed** (935 KB, trimmed from a
  2.6 MB Overpass response to the tags the bake reads), so PASS E is reproducible
  and the parks cannot move under a re-bake.

### AND THE THING THAT WAS BLOCKING EVERY LANE, IN `scripts/tile.sh`

**A completely successful tile build failed on its own last line, and threw the
archives away.** The last line totals the built archives with `du`, including
`$BUILDINGS_PMTILES`. `config.sh` dates the snapshot from `date -u`, so between
00:00 UTC and the day's first `build-data.yml` that path does not exist. `du`
exits non-zero, `2>/dev/null` hides why, and `set -euo pipefail` fails the job
**after every archive has been built correctly** — so the Commit step never runs.

```
acer/downtown-detail  01:11Z  failure   (outer.pmtiles built, 1.8M, discarded)
mac/creek-trees       00:28Z  failure
acer/tree-canopy      18:01Z  success   same UTC day as its snapshot
```

It fires **every night after 7 pm Austin time** until that day's snapshot exists.
Two lanes lost a build to it before anyone read past "Done. Totals:". `tile.sh`
was not on this lane's file list and it was fixed anyway, because the
verification the brief demanded could not be run without it.

### Known, and deliberately not in this PR

- **The mottled/streaky pattern on a few tall towers is D2a and predates this** —
  it is in `shots/dt-before/congress.png` on the same building.
- **Two flat tan wedges lie on the plaza south of 4th and Congress.** Also in the
  before frame. Identifying the owning layer needs its own magenta mask; §38
  spent 90 minutes proving that guessing does not work, and the shortcut taken
  here was to check the BEFORE frame — which answers "is it mine" without
  answering "whose is it".
- The ground band is one flat tone. It reads as a plinth line at the street,
  which is what was missing; it is not glazing.

Pictures: `shots/dt-before/` against `shots/dt-after/` (GeoJSON path),
`shots/dt-tiles/` (tiled, what the site serves), `shots/dt-merged/` (re-verified
on merged `main`), `shots/dt-night/`, `shots/dt-mask/magenta.png`.

## 44. Aug 3 2026 — the night lamps were blue because a taste call outvoted the city (acer lane)

**Branch:** `acer/night-lamp-colour`. §35 item **6** — *"night streetlights are a
carpet of cold blue-white bokeh"*. One symptom, and the brief was right that it
is four defects. Separating them before touching anything is the whole pass:
**three of the four are real and the third one is not what it looks like.**

### The instrument first — `scripts/verify/night-lamps.mjs`

`night-pale.mjs` has been reporting on this defect for three sessions and cannot
see it: it counts pixels over luma 120 and says nothing about their COLOUR,
their SIZE, or what they are standing on. So this asks the four questions
separately, in one page load, off the magenta mask (`roof-ring.mjs`): BASE for
the census, MARK for ownership and blob sizes, ROOF for the placement mask. At
`aerial-wide` (tour.mjs's own pose), tod 0.95:

```
                                    BEFORE              AFTER
hot pixels (luma>120) below horizon   7,604  0.66%      2,246  0.19%
   of those    WARM                          19.8%             96.2%
                BLUE-WHITE                   66.9%              2.5%
pool ground width   p90 / max          98.4 m / 361.7 m   62.7 m / 151.9 m
night-streetlight-pool owns            124,719 px 7.79%   25,563 px 1.60%
   of its pixels, drawn over a roof            3.77%             3.93%
props-lit / props-lit-core owns                    0 px              0 px
frame mean luma                                  32.6              30.4
```

**Two thirds of every lit pixel in the city was blue**, and the pool layer alone
covered **7.8% of the whole frame**.

### 1. COLOUR — it was authored blue, on purpose, and the note said so

`js/night.js` carried a second palette for the edge of the city — `#9db4e6`,
`#b8c8ee`, `#ccd8f2`, `#dde7f7` — on the theory that outer streets have been
retrofitted to ~4000K while the core keeps its sodium. Its own comment says
*"GENERATIVE, not sourced"*. Austin Energy's conversion is to **3000K**, chosen
for dark-sky reasons; there is no blue-white street fixture in this city.

The edge colour is now DERIVED from its own core colour by `cooler()`: mix
toward the grey **of that colour's own luma**. Luma is linear in R,G,B, so this
preserves brightness exactly (the four hand-tuned luma-matched hexes the old
comment defends are no longer needed) and it can only ever move a channel toward
the others — **a warm lamp gets whiter and cannot get bluer.** One knob,
`EDGE_DESAT: 0.45`.

```
#ffa63f b-r -192  ->  #dcab73 b-r -105     both luma 177
#ffbc6c b-r -147  ->  #e5c094 b-r  -81     both luma 197
#ffcf90 b-r -111  ->  #ecd2af b-r  -61     both luma 213
#ffe6b4 b-r  -75  ->  #f5e7cb b-r  -42     both luma 232
```

`window.__nightLights.worstBlueMinusRed` is the assertion, and it is checked in
the generator: the bluest colour anywhere in the 3,349-lamp file is **-45**. The
2.5% of hot pixels still reading cool are lit windows and the sky's own bleed,
not lamps.

### 2. SIZE — the curve was authored in PIXELS, which hid what it was asking for

`POOL_RADIUS: [13, 2.8, 15, 7.5, 17, 19, 19.5, 44]` px. Converted at this
latitude that is a lamp pool of **46 m radius at z13, 31 m at z15, 20 m at z17
and 8 m at z19.5** — the street-level end was right all along and the flying end
was six times too big. Which is exactly what the two poses show, and why nobody
caught it: `the-drag` at z17.2 has always looked like a row of lamps.

So the curve is authored in **ground metres** now (`POOL_GROUND_M`) and
converted to px per stop, and the conversion constant is in the file. A real
pool is 6-8 m; the low-zoom end is deliberately allowed to run to 18 m, because
a physically-correct 7 m pool at z14 is **one pixel** and the city goes dark
again — which is the defect this module was written to fix. That single trade is
now one legible knob instead of four opaque pixel values.

### 3. PLACEMENT — *"many sit over rooftops"* IS NOT TRUE, and the number says so

Only **3.77%** of pool pixels were drawn over a roof, on a frame where the
roof+building mask covers 34.6% of the screen. The layer goes in before
`buildings-shadow`/`buildings-3d` and is occluded correctly; if it were painting
over roofs the figure would be near 35%. **What looks like a lamp on a roof is a
98 m glow SURROUNDING the building it passes**, so the building reads as
standing in the light rather than beside it. Fixing SIZE fixes the appearance —
and note the ratio is unchanged after (3.93%), which is the check that the size
fix did not accidentally reposition anything.

**No data change was needed.** `data/props.geojson`'s 3,245 lamp and 2,949 lit
features are not involved at all: `props-lit` has `minzoom 14.6` and
`aerial-wide` sits at z14.4, so it owns **0 px** of the frame the complaint is
about. The entire carpet is `js/night.js`, generated off basemap road geometry.

### 4. THE SEAM — a ramp that saturates inside the frame puts a boundary in the frame

`WARM_FULL_M 430` / `WARM_FADE_M 1250` against a lamp fence **3.3 x 3.1 km**
across: nearly every lamp in the scene sat at the fully-cool end of a ramp that
had run out 1.25 km from the Tower, so the gradient did not read as a gradient,
it read as a line where campus met West Campus. The ramp is now **900 m to
2600 m — wider than the fence itself**, so it never saturates and cannot draw an
edge. Mean warmth over the generated file went to **0.853**: the city is one
sodium family with a slight whitening at the far corners, which is the honest
version of the original intent. This is independent of the colour fix and both
were needed.

### What did NOT work, and one instrument caveat worth keeping

- **A px floor written as `['max', ['interpolate', ['zoom'], …], 1.3]` is
  invalid.** A zoom expression may only be the input to a TOP-LEVEL step or
  interpolate, and a rejected paint property takes the whole layer down with it
  — this file already records that trap costing a session with the pool layer
  silently not existing. The floor and the per-tier scaling are both resolved in
  JS now and the emitted expression is a plain interpolate over constants.
- **The blob-size MEDIAN went the wrong way and it is the instrument, not the
  city:** 22.5 m → 34.0 m. The connected-component detector ignores components
  under 12 px, so shrinking the pools pushed the small glows below its own floor
  and left only the near-field survivors in the census. The size numbers to
  quote are total coverage (7.79% → 1.60% of frame) and the tail (p90 98.4 →
  62.7 m, max 361.7 → 151.9 m). **A statistic with a detection floor measures
  the floor as soon as you move the thing it is detecting.**
- **Do not trust one probe run in this tree.** Two runs died to a page error
  (`LABEL_RANK is not defined`) from another lane's in-flight edit to a file I
  do not own, and two more had the browser killed under them mid-read — §33's
  note that any other session's `reap.mjs` kills your browser, again. Every
  number above was re-read until two consecutive reads agreed.

### TWO NEW WAYS TO MEASURE THE WRONG THING, both hit while re-verifying

Both produced a *plausible* number rather than an error, which is what makes
them worth writing down.

1. **TWO SERVERS CAN BIND THE SAME PORT AND THE OTHER ONE ANSWERS.** The merged
   re-measurement came back **identical to BEFORE** — 66.89% blue-white, pool at
   7.87% of frame — on a build that demonstrably contains the fix. `netstat`
   showed **two** processes LISTENING on 8155: another lane had that port and
   mine bound second, so every request was served from THEIR checkout at an
   older commit. Nothing failed, nothing warned. **Check the port is free before
   serving, and prove the served build is yours** —
   `curl -s http://127.0.0.1:PORT/js/night.js | grep -c A_STRING_YOU_JUST_ADDED`
   is one line and it is now the first thing this lane does after starting a
   server. (Note `serve.py` resolves its root from `__file__`, not from cwd, so
   a worktree server does serve the worktree — that part was fine.)
2. **The time-of-day never took, and the probe scored the resulting DAYLIT frame
   as a triumph.** On merged `main` the tod handshake silently did nothing:
   frame mean luma **127.4**, 62% of the frame over the pale threshold, and the
   census reported **99.94% WARM / 0.00% BLUE-WHITE** — a perfect result, on a
   frame with no lamps in it at all. Setting a value and getting no exception is
   not the same as the scene being at that hour. `night-lamps.mjs` now reads
   `window.__todCurrentP` back and exits non-zero if it is not the hour asked
   for. Same shape as §37's rule and worth generalising: **a night probe that
   can measure noon will eventually measure noon.**

### Verified

**Re-verified on the merged result, not on the branch in isolation** (`main`
moved 20 commits in flight — facades, tower crown, ground precincts, trees; no
overlap with `js/night.js`). Merged in the worktree
`C:/Users/simip/Projects/austin-3d-night`, served on a port checked free first:

```
merged, aerial-wide, tod 0.95   WARM 97.7%   BLUE-WHITE 1.6%
pool owns 1.84% of frame   p90 57.7 m   max 151.9 m   on a roof 3.56%
```

`harness-drift.mjs` PASS before every measurement (24 scripts both sides).
Pictures, all read rather than exit-coded: `shots/lamps/before/aerial-wide.png`
against `shots/lamps/after/aerial-wide.png`, `before/the-drag.png` against
`after/the-drag.png` — street level got BETTER, not worse: discrete warm pools
with a bright head each, receding properly, instead of uniform speckle.
`shots/lamps/after-wc/west-campus.png` is the seam's old location, uniformly
warm from the foreground to the Capitol. `shots/lamps/after-dusk/aerial-wide.png`
is the tod 0.62 regression check — lamps just coming on, no blobs, no cast.

### Still open in night, deliberately not in this PR

§35 item **1** (DKR's seating bowl reading as daylit) is a TASTE call and is
still Simeon's. It is more visible now that the lamps have stopped shouting.
And `night-pale.mjs` is still measuring almost nothing — its fixed `PALE = 120`
against a frame median of 13.8 was already written up in §35 and is untouched
here; `night-lamps.mjs` does not replace it, it answers a different question.
## 43. Aug 3 2026 — the facade election left the browser, and the harness convicted the bake that had been sitting there (acer lane)

**Branches:** `acer/facade-bake` (PR #94) and `acer/facade-bake-0803` (PR #95).
QUEUE **C1**. `scripts/bake_facades.py` had been parked unmerged since the last
pass with a comparator that did not exist and a harness that had **never been
run**. Writing the comparator was the whole job, and it found things.

### Why C1 exists at all, in one line that was already in the repo

`scripts/tile.sh`: *"a tile of West Campus and a tile of downtown would each
elect their own 14 tones against one shared atlas."* `quantiseFacades` is a
function of the WHOLE feature list. A tiled source never hands you the whole
feature list. So the election has to happen offline, and until it does,
buildings cannot move onto vector tiles.

### What the harness caught, and it would not have been caught by re-reading

`familyFor` had been **paraphrased** into two tuples of substrings instead of
copied from the regexes. Missing: `condo`, `kindergarten`, `chapel`,
`cathedral`, `synagogue`, `mosque`, `temple`, `clinic`, `public`,
`train_station`, `transportation`, `industrial`, `manufacture`, `warehouse`,
`utility`, `service`. Invented: `house`, `religious`. **Four buildings were in
the wrong facade family.**

It also lower-cased `building_class`, which `js/facades.js` does not. That one
is **latent** — all 28 class values in this snapshot are already lower case —
so it is transcribed faithfully and written down rather than "fixed".
**Faithful beats correct in a port.** If the case-sensitivity is wrong it is
wrong in `js/facades.js`, and fixing it there is a separate, visible change.

### The proof is TWO claims, not one, and they are easy to conflate

1. **The port.** `scripts/verify/facade_parity.py` compares the bake against a
   live capture of the real `mergeCapitolScene` / `applyUnion24` /
   `quantiseFacades`. The outer-ring port could only compare the PARTITION,
   because its `tg<n>` counts from the end of the campus palette. Here the
   campus palette IS the whole palette, so this demands the same ordinal, the
   same family and the same hex.

```
features 3057 / 3057      assembly 12 patched / 604 appended / 1 U24
palette  14 / 14 identical    combos 64 / 64    wp exact 3057 / 3057
```

2. **The switch.** `js/facades.js` now adopts `data/facade_palette.json`, so
   `facade-parity.mjs` loads the page a SECOND time with the bake armed and
   diffs the two runs: 3057/3057 `wp`, 3057/3057 `wf`, 14/14 palette.

**THE JOIN IS POSITIONAL AND THAT IS NOT A SHORTCUT.** 604 of the 3,057
features are the authored Capitol and carry **no `id` at all**. An id-keyed
join would have checked 80% of the city and printed a pass.

**And the capture nearly became circular.** The moment `js/facades.js` started
adopting the baked file, `facade-parity.mjs` would have had the browser read
back the file `bake_facades.py` wrote and the comparator would have compared
the bake against itself — printing a triumphant 3057/3057 while proving
nothing. Pass A forces `?bakedfacades=0` and **asserts `FACADE_BAKED_ON` is
actually false**; pass B asserts `facadePaletteSource()` really says `baked`
before its diff is believed. Both guards in facades.js fall back to electing,
and a fallback makes that diff come out perfect — so without the assertion,
pass B passes loudest exactly when the bake was never used.

### NEGATIVE CONTROLS — a harness that passes first time has proved nothing

Broken on purpose, one axis at a time. All six fail:

```
the old paraphrased families      wf differs on 4 features
TARGET_BUCKETS 13                 palette length 13 vs 14
applyUnion24 skipped              final_height 97.5 vs 94.4 on #1212
FACADE_PROTECTED dropped          palette[0].wd #cebc9e vs #bd8477
capitol.geojson not appended      2453 vs 3057 features
python round() for Math.round     exactly 2 of 42 hex channels
```

That last one is why `_js_round` exists, and **two channels out of forty-two is
below what any amount of re-reading would find.**

**The first version of this control script reported three PASSes it had not
earned.** `facade_parity.py` does `from bake_facades import load_scene`, so the
name it calls is its OWN module global and rebinding `bake_facades.load_scene`
was a silent no-op. Patching the importer, not the importee, turned three
false passes into three real failures. Worth remembering for any Python
verification in this repo.

### The picture measurement was wrong on the first reading, by a lot

`docs/shots/facade-baked-vs-elected-tower.jpg` and `-westcampus.jpg`, top
baked / bottom elected, indistinguishable — which is the point. But the first
before/after pair said **62% of the frame changed**, and it was garbage:

```
tower       baked1 vs baked2   (THE SAME CONFIG)   52.7% of pixels differ by >8
            baked2 vs elected1                      0.02%,  max channel 11
            baked2 vs elected2                      0.00%,  max channel  8
```

**A whole-frame ~7-level exposure shift lands randomly per `pose.mjs` run — and
it is in the SKY, which has no facades in it.** That is what unmasked it: a
difference that shows up above the horizon cannot be a wall texture. Any pass
that has compared two `pose.mjs` frames from separate runs and quoted a
percentage has been exposed to this. CLAUDE.md rule 10 already says take the
minimum of interleaved reps; this is what one reading costs.

### The guard fired for real within the hour, which is the useful ending

The snapshot rolled to `2026-08-03` in the same merge window as #94. The baked
file said `2026-08-02`, guard 1 refused it, and the browser elected. Nothing
broke — and **the switch was silently inert on `main`**, which is the failure
mode to be loud about: a bake whose output nothing reads looks exactly like a
bake that works. #95 re-bakes it.

Measured across the roll: **0 palette entries moved, 0 bucket assignments
moved** — the only difference between the two files was the date string. So
the guard refuses on a date rather than on a difference, deliberately, because
the alternative is fourteen buckets that do not mean the same thing twice.

**`data/facade_palette.json` MUST BE RE-BAKED WHENEVER THE SNAPSHOT ROLLS**, or
C1 goes quietly back to being a browser election. `austin-data-bot` rolls it on
a schedule. That is the single maintenance obligation this pass adds, and the
emitted file's own `note` now says so.

### What is still NOT done

The tiles themselves. `scripts/tile.sh` builds `austin.pmtiles` and nothing
loads it; making a tiled buildings source carry the ordinal and wiring
`js/app.js` to it is the remaining half, and `js/app.js` was outside this
lane. What is now true that was not before: **the fourteen buckets are a
property of the data instead of a property of the session**, and `stampAll()`
is split out of the election so the only step a tiled feature needs is the one
that runs per feature.

Also: the coarse key had been written out **three times** inside
`quantiseFacades` and had to agree in all three or a building is counted into
one group and stamped out of another. One function now.

## 42. Aug 3 2026 — the campus is 51.8% bare, and the lawn was running under the buildings (acer lane)

**Branch:** `acer/ground-precincts`, PR #93. The ground brief's four items. Two
of them turned out to belong to other lanes and one was already done, so the
useful half of this entry is the measurements, not the diff.

### The one that was mine: PRECINCTS

*"BARE TAN GROUND EVERYWHERE OUTSIDE THE FEW BLOCKS ALREADY FILLED."*

**Measured before writing anything.** Rasterise the UT campus core at 6 m and
count every cell not covered by a ground polygon, a **buffered** carriageway or
a building footprint:

```
BARE  22,806 of 44,064 cells = 51.8% of the campus core = 821,016 m2
biggest connected bare blobs (m2)
  22,932  15,048  14,220  12,564  12,276  10,944  10,188  9,936  9,756
```

**The first cut of that raster read 74.1%, and it was wrong for a one-line
reason: `data/roads.geojson` holds LINES, not polygons.** The loader returned
`roads 0` and the whole street network went silently into the "bare" set. A
loader that returns zero features and does not say so is the same failure as a
counter that counts intent.

`PRECINCTS` had **one** entry. It has nine, each seeded on the mapped lawn
NEAREST one of those blobs with `grow` set to reach across it:

```
Ellsworth Kelly / Austin   seed  1,012 m2 ->  7 parts   5,003 m2
Blanton block                   25,472    -> 22        13,964
East Mall                          131    ->  7         3,074
Drama and art precinct           1,681    ->  8         8,011
Power plant yard                   603    ->  9         5,251
Speedway north                   1,001    ->  2         5,174
Whitis                           5,632    ->  4         4,943
LBJ east campus                  2,760    ->  6         6,709
San Jacinto south                2,000    ->  4         5,778
                                            71        55,974
```

**The blob is the evidence the block is bare; the seed lawn is the evidence it
is landscaped. Neither on its own would justify painting a block green.**

### The docstring's claim about buildings was HALF FALSE, and had been since #69

> *"grown outward ... until it meets the things that really bound it: the walks,
> and the buildings. Both are already in the data"*

The walks were. **The feature list at that point in the bake holds ground only**,
so the blocker list could never have contained a footprint, and the grown lawn
ran straight under the buildings it was written to stop at.

```
precinct lawn under a building   16.35%  ->  0.00%    11 holes cut
data/ground.geojson  2,825 -> 2,896 features, 1,519.1 -> 1,570.9 KB
by k: area 799 -> 870.  by u: lawn 145 -> 216.  EVERYTHING ELSE IDENTICAL.
```

Footprints come from `data/snapshots/<latest>/buildings.detailed.geojson`, the
file `shape_trees.py` already uses for the same question, with a 0.3 m standoff
for the mow strip. **Note `<latest>` moved to `2026-08-03` in the merge**, so a
re-bake will not reproduce this file byte for byte; pin `PRECINCT_SNAPSHOT` if
that matters.

### FOUR THINGS THAT DID NOT WORK, and the first is the reusable one

1. **THE RE-MEASURE THAT CHECKED THE FIX HAD THE SAME BUG AS THE FIX.** It built
   its polygon from `coordinates[0]` — the exterior ring only — so every
   building-shaped **HOLE** the subtraction had just cut was counted back in as
   lawn. It reported **2.0% under a building on a file that measures 0.00%**.
   Two full bakes and one complete rewrite of the subtraction were spent chasing
   a defect that did not exist. §35 already says an instrument that cannot see
   its own defect is worse than none; this is that, in the instrument written
   *for* the fix, in the same pass.
2. **Subtracting the buildings inside the one big cutter, then not.** The
   rewrite was built on the theory that a ~12,000-polygon union was
   under-removing. It was not — see (1). Kept because it is cheaper and clearer,
   but it fixed nothing, and the offline test that would have said so in thirty
   seconds (subtracting the buildings from the emitted lawn removes 1,273 m2,
   i.e. the operation works fine) was run *after* the rewrite instead of before.
3. **Seeding the table from polygon CENTROIDS.** The centroid of a concave lawn
   — an L round a building, a ring round a court — is not in the lawn. One entry
   measured **106 m** from its own seed at bake time and was dropped with a
   warning. Every point is a `representative_point()` now.
4. **West Campus cannot be done this way at all, and should not be faked.** The
   mechanism needs a mapped lawn and West Campus has none: the nearest mapped
   green to `-97.7470, 30.2890` is **409 m away and is a 1 m2 sliver**. A bigger
   `grow` is drawing a lawn freehand.

**Honest scale: 55,974 m2 against 821,016 m2 measured bare is 6.8%.** The tan
blocks in `shots/gnd/after/lbj.png` are still tan.

### The other three items, all answered, none of them ours to fix

**1. The sharp dark lines are `props-line` fences — §36 was right, confirmed
independently.** `queryRenderedFeatures` at the exact pixel of the bar across
Clark Field, tod 0.30, `dkr-field` pose:

```
(1287,750)  props-line | austin-props | {"k":"line","u":"fence","h":1.9,"c":"dark"}  x4
(1210,600)  props-line | austin-props | {"k":"line","u":"fence","h":1.9,"c":"dark"}  x2
column through the bar:
  y=744..747  (145,163,92)  the infield
  y=748       ( 86, 68,53)  one transition pixel
  y=749..752  ( 62, 49,37)  THE BAR — four pixels, hard edge
  y=753..756  (138,154,86)  the infield again
```

**Nobody needs to find this again.** The cause is that a chain-link fence is
modelled as a 1.90 m opaque wall — `bake_props.py` gives `fence` a 0.10 m width
and a 1.90 m height in the shared `dark` colour, neither of which this lane may
write. The 0.10 m width is invisible from altitude; the 3-4 px is the **vertical
face** at 45-60 degrees of pitch.

**2. The teal pools are `roofscape-major`, `k:'pool'` — NOT `js/westcampus.js`,
which is what I assumed for an hour off a grep.** `js/westcampus.js` really does
declare a `pool` material and it really is about the right colour, and it is not
what is on screen. The query at three pool pixels:

```
roofscape-major | austin-roofscape | {"k":"pool","rd":"#4f8ea8","rg":"#66a3ab","rn":"#0f121d"}
day #4f8ea8 = (79,142,168) lands as (98,143,131) — the teal, measured,
12 clusters / 889 px in one west-campus frame
```

The colour is **per feature in `data/roofscape.geojson`**, so the fix is in
`bake_roofscape.py`, not in a paint expression. Only 5 ponds and 1 fountain
exist in `ground.geojson` and all are on campus — there is no pool in it.

**AND THE NIGHT HALF OF §35's CLAIM DOES NOT REPRODUCE. Retracted.** At tod
0.95, same pose:

```
night frame median luma below the horizon   18.0
pool (837,875)  median 14.0        pool (859,504)  median 16.1
```

**The pools are DARKER than the city, not glowing.** The `rn` value is doing its
job. "Pools glow blue at night" has been on the defect list since §35 and is not
a defect.

**3. TURTLE_N was already 6, fixed in `aa8597a`, and the brief's "12" is
stale.** Verified from the emitted file rather than from the constant:
`data/depth.geojson` holds **24 `m:'shell'` parts = 6 turtles**, radii spanning
0.16-0.45 m under `TURTLE_BIAS = 1.7`. Nothing to do.

### The magenta mask FAILED FOUR TIMES here, and the reasons are worth knowing

The brief says use the mask for "which layer draws this", and it never returned
an answer for the pools. Four runs, four different causes:

1. **Another session's `reap.mjs` killed the browser**, twice — §33's note, and
   with seven agents on the box it is now the *likely* outcome of any run over a
   few minutes, not a hazard.
2. **The time of day silently did not take.** The frame came back at sunset and
   the teal predicate found **4 pixels instead of 889**. Setting `tod-slider`
   once before the camera move is not enough in `_harness.html`. The probe sets
   it three times *after* the move and now ASSERTS `window.__todCurrentP`.
3. **The predicate selected the SKY.** "blue beats red by 30 and green beats red
   by 20" is true of a blue sky, so it matched **65,894** pixels instead of 294
   and every layer owned 0% of a set that was 98% sky. A predicate that matches
   the thing you are not looking for is a hand-picked box with extra steps.
4. **The watchdog at 900 s with only two layers masked.** The settle step waits
   on `map.once('idle')`, and `pose.mjs`'s own comment says the sky canvas
   repaints every frame so `idle` is a coin flip — every wait pays the full
   fallback.

**`queryRenderedFeatures` answered both questions in about 90 seconds each.**
§38's warning that it answers a fill-extrusion by FOOTPRINT is real and it is
not a reason to reach for the mask first: reach for the query first, and use the
mask when the query's answer is suspicious. Both probes are on disk as
`scripts/verify/_owns.mjs` and `scripts/verify/_atpixel.mjs`, uncommitted
because this lane may not write that directory.

### Housekeeping

Worked from `git worktree add C:/Users/simip/Projects/austin-3d-gnd` per §33 —
with seven concurrent agents this is not advice. `scripts/verify/node_modules`
must be junctioned in (`mklink /J`); it is gitignored, so a fresh worktree has
none, and `pose.mjs` then fails with `ERR_MODULE_NOT_FOUND` and nothing else.
**Also: a background log written to this session's own scratchpad came back
containing another probe's streetlight output** — do not assume a temp path is
private on this box.

Pictures: `shots/gnd/before/` against `shots/gnd/after/`, same cameras, tod
0.30. `drama.png` is the clearest — green panels round the Art Building, cut by
the real walks that bound them. `shots/gnd/night/` is the tod 0.95 check.

## 41. Aug 3 2026 — why the canopy stops at the campus edge, measured (mac lane)

**Branch:** `mac/canopy-coverage` — MAC_QUEUE T2. **All three candidates in the
queue are wrong as stated, and the real answer changes what the fix costs.**

The queue offered: (1) the fetch bbox is tight around campus, (2) the city
inventory does not cover those blocks, (3) something downstream filters them
out. Measured against the cached inventory:

```
cached city rows        20,723
  in CORE box            1,322   ->   230 trees/km2
  OUTSIDE core box      18,556   ->   224 trees/km2
```

**The survey covers the wide box at the same density as campus.** Not the box,
not the coverage.

What makes campus lush is a third source: `data/canopy_detected.json` holds
**17,483 imagery-detected crowns inside one 5.85 km² block** (lon
-97.7523..-97.7257, lat 30.2757..30.2963) at **2,988 crowns/km² — thirteen
times the survey.** *The edge of the green is the edge of the aerial-detection
grid.* Everywhere else has only the public street-and-park inventory, which
never surveyed a private yard tree in its life.

### What was actually available to take, and it is small

`OUTER_MIN_DBH_IN = 5.0` was discarding **4,359 of the 18,556** surveyed trees
outside the core — 23% of them. Lowered to 3.0 (not the core's 2.0; true
saplings model to a 3 m crown that is a couple of pixels from any pose the tour
flies). That is the only honest lift available without inventing anything:

| | before | after |
|---|---|---|
| city trees used | 12,063 | **17,117** |
| `trees.geojson` | 63,128 / 25.93 MB | 64,003 / **26.29 MB** |
| `trees.pmtiles` | 5.48 MB | **5.59 MB** (+111 KB) |

Only +875 features for +5,054 trees, because most of the newly-admitted small
trees dedupe against imagery crowns already standing within 4 m, and outer
crowns are tier-capped at 2.

**And it does not fix the complaint.** `shots/canopy/after-wide.png` is the
honest picture: 5,054 more trees spread over 63 km² is +80/km² against a campus
at 3,200/km², and from altitude the city is still bare tan with one green
island. Reported rather than dressed up.

### What the real fix costs, so the decision can be made on numbers

Two routes, and both are Simeon's call, not mine:

- **Run the canopy detector over more imagery.** It is the only route that adds
  REAL trees. Cost is imagery tiles and detector time over ~63 km² against the
  5.85 km² already done.
- **Generate street trees along the road network** — sanctioned by the queue for
  this case provided it is labelled GENERATIVE. **Measured: 2,423 km of road
  outside the core box.** Both sides at 35 m spacing is **138,472 trees**, more
  than double everything in the app today; at 25 m it is 193,861. That is not a
  tuning decision, it is a different app, and it is why I did not quietly pick a
  number.

A bounded middle — filling only a ring of a few km² around campus, or only the
major roads — is affordable and is the thing I would try next.

## 40. Aug 3 2026 — crowns stopped being stacks of discs, for zero bytes (mac lane)

**Branch:** `mac/tree-shading` — MAC_QUEUE T1. **No data changed and the payload
is identical**: `tf` and `j` were baked by an earlier pass and left unread, with
a comment saying so. This is the one-liner they were baked for.

The paint being replaced was
`interpolate ['get','h'] 6 -> canopyLo, 15 -> canopyHi`, and
`shape_trees.py`'s own notes had already measured why it could not work:

1. it ramps on the tier's **top height**, a SIZE — so two tiers of one small
   crown differ by a fraction of the ramp while two tiers of a big one differ by
   most of it. The gradient was a function of the tree, not of where you are in
   its crown;
2. **34% of all tiers** (8,489 below, 2,464 above, of 32,651) fall outside the
   6..15 m window and clamp to one flat endpoint;
3. it was **inverted** — `canopyHi` is the darker colour, so the top of the
   canopy, the part in the sun, was drawn darker than the shaded underside.

`tf` (the tier's centre as a fraction of its crown, 0 at the base and 1 at the
top) fixes all three: the ramp is over crown POSITION and behaves identically on
a one-tier sapling and a five-tier live oak. `j` gives a per-tree hue bucket,
constant down a crown. Two nested interpolates — `tf` down the crown, `j` across
the forest — with the four endpoints computed once per retint rather than per
fragment.

**`fill-extrusion-vertical-gradient` is now OFF for the canopy.** It darkens the
bottom of every extrusion, and with a real crown gradient it was darkening the
bottom of every TIER — five shadows up one tree, which is the banding the tier
twist exists to hide.

**Knobs:** `window.TREE_SHADE = { depth: 0.85, jitter: 0.07 }` in `js/app.js`.
`depth: 0` is a flat canopy, `jitter: 0` is one green — either is a one-line
flatten.

**A boundary call, stated plainly.** The authoritative tree paint is
`js/timeofday.js:408`, not `js/app.js` — anything set in app.js is replaced on
the next retint. That file is not this lane's. I changed **one line** of it, and
made it a CALL into `window.treeCanopyColour` in app.js rather than an
expression, so the two paint sites cannot drift and the whole gradient still
lives in the tree lane's file. It falls back to the old expression if app.js has
not loaded. If the other lane wants that line back, the function is the only
thing that has to move.

## 39. Aug 3 2026 — Waller Creek got planted, and the tile workflow is a dated landmine (mac lane)

**Branch:** `mac/creek-trees` — MAC_QUEUE T3.

`data/ground.geojson` has carried 33 `creek_canopy`, 34 `creek_under` and 49
`creek_scrub` areas — **33.5 ha** — since the channel was cut, and nothing had
ever grown in them, because no survey covers a creek bed.
`fetch_city_trees.py` now scatters trees through them on a jittered grid (a
plain grid reads as an orchard from the air; pure noise clumps and leaves
holes). Deterministic, so a re-run plants the same forest.

```
creek_canopy  33 areas -> 1,138 trees at 12 m
creek_under   34 areas -> 1,306 trees at  8 m
creek_scrub   49 areas -> 2,215 trees at  6 m
                          57 rejected on buildings, 0 on water
```

Emitted **last**, so the 4 m dedupe always resolves in favour of a surveyed or
photographed tree already standing there. Marked `src:'creek'` and named
GENERATIVE in the provenance block — it is the only invented position source in
that file.

| | before | after |
|---|---|---|
| `trees.geojson` | 57,548 feats / 23.64 MB | 63,128 / **25.93 MB** (+9.7%) |
| `trees.pmtiles` **(what ships)** | 4.95 MB | **5.48 MB** (+524 KB, +10.6%) |

### THE TILE WORKFLOW BREAKS AT MIDNIGHT UTC, EVERY DAY

**This cost the first attempt and it will hit the other lane next.**
`gh workflow run build-tiles.yml` built all five archives correctly, printed
`Done. Totals: 10M total`, and then **exited 1** — so the commit step never ran
and nothing came back.

`scripts/config.sh` sets `SNAPSHOT_DATE` to *today* and
`BUILDINGS_PMTILES="data/snapshots/$SNAPSHOT_DATE/austin.pmtiles"`. The last
line of `scripts/tile.sh` is

```sh
du -ch "${DATA_DIR}/tiles"/*.pmtiles "${BUILDINGS_PMTILES}" 2>/dev/null | tail -1
```

and the script runs under `set -euo pipefail`. On any day whose snapshot has
not been baked yet, that path does not exist, `du` exits non-zero, `2>/dev/null`
hides the message but **not** the status, `pipefail` promotes it, and the whole
run fails *after* doing all its work. Every run before mine succeeded; mine was
at 00:28 UTC on the 3rd against a newest snapshot of `2026-08-02`.

**I did not fix it — `scripts/tile.sh` is not this lane's file.** The fix is one
line (drop the buildings archive from that `du`, or `|| true`). Until then, a
re-tile that "fails" may have built everything fine.

**AND THE UNBLOCK IS ALREADY SITTING ON A BRANCH.** The data bot pushes its
snapshot to whichever branch triggered the run, so
**`data/snapshots/2026-08-03/` exists only on `mac/creek-trees`** (commit
`26cc588`) — `main`'s newest is `2026-08-02`. That directory is precisely the
one whose absence fails the `du`. Landing that commit on `main` makes the tile
workflow pass again today without touching `tile.sh` at all. It is
`data/snapshots/`, which is not this lane's, so **I have left the branch
undeleted rather than merging it** — one cherry-pick by whoever owns the bake
and CI is green. The same is true of `mac/outer-bucket-inert`, which strands
`2026-08-02` the same way. I built
`data/tiles/trees.pmtiles` locally with tippecanoe 2.79 and CI's exact
`TIPPE_COMMON` flags instead, which is in-lane — that archive is this lane's.

### Also worth keeping

- **The pipeline is fetch → shape, and it reproduces exactly.** Before changing
  anything I ran both and got the shipped file back: 57,548 features, 23.64 MB,
  identical geometry. Only **255 of 57,548** differed, in `j` (the jitter salt)
  alone, because the City inventory returns rows in a slightly different order
  run to run.
- **The wide-box city cache was missing and is now committed** (5.4 MB).
  `BBOX` in `fetch_city_trees.py` has been the wide central-Austin box for some
  time but only the `CORE_BBOX` cache was on disk, so every rebuild needed the
  network. That is what `data/osm_cache` is for.
- **My first framing of both stretches was wrong**, and the check that caught it
  was arithmetic, not a screenshot: I averaged the Rec Center and the track and
  got a point with **zero** planting zones within 160 m, and briefly believed
  the Acer had not covered the stretch Simeon named. The creek runs ~175 m west
  of there. Measure the distance to the nearest zone before reporting a gap.

## 38. Aug 2 2026 — the fountain had no memorial, and three rules that drew the rest of them wrong (acer lane)

**Branch:** `acer/littlefield-memorial`, PR #89. §35's two loose ends plus the
landmark half of A8, driven off the contact sheet rather than off a hunch.

### The Littlefield Fountain

*"the Littlefield Fountain has no memorial at all — two flat puddles and one
six-step nub"*. `docs/shots/littlefield-before.jpg` and `-after.jpg` are the same
camera. `bake_depth.py` built the pool correctly off a measured z20 nadir and #75
gave its steps a riser — and nobody came back for the thing the pool exists to
hold. Coppini's 1933 group is in it now: the hull of the Ship of State on a
masonry pedestal, Columbia bearing the torch on the prow, three hippocampi
drawing it, the Army and the Navy flanking in the water. **Five figures, three
horses, one hull — that inventory is the accuracy test, and a statue on a block
does not pass it.**

**SIZE IS DERIVED, NOT GUESSED, and the derivation is off geometry this repo
already had.** `bake_depth.py` measures the top channel at 125.2 m2 over a
13.60 m run = **9.2 m clear**; the group fills it with the flankers just inside
the copings, so 9.2 less two 0.6 m weir walls and a clearance = **7.00 m wide**.
Height is a heroic-scale figure (2.75 m) on a prow deck 1.9 m over the water with
the torch above her head = **6.90 m**. Both are in `DIMS` with the working
written out, and `main()` re-measures the emitted file: 6.90 h, 7.9 x 10.1 m,
93 parts, PASS. The mall axis and the tier geometry are **imported from
`bake_depth.py`**, not restated — the mall runs 6 degrees east of north and two
copies of that fact would drift.

### Three rules the contact sheet convicted, and it took the sheet to see them

`art-sheet.mjs`, 35 pieces at one ground scale, `docs/shots/art-sheet-littlefield.jpg`.
No red borders. Then:

1. **`beam()` took its step count from the CALLER and every caller guessed** — 2
   to 7 steps for members from 0.4 m to 5.2 m long. Monochrome for Austin's
   5.17 m back-stay at 4 steps is 1.29 m per slab and renders as a literal
   six-tread STAIRCASE down the left of the sculpture. The count comes from the
   member's own 3-D length now; `steps` is a floor. Measured across the file:
   0.55 m/slab → 1,015 parts / 287 KB, 0.70 → 929 / 264, 0.85 → 875 / 249,
   against 716 / 202 before. **0.70 taken.** *And the trap in it:* `add()` drops
   anything under 2 cm, so slicing a shallow member finer DELETES it — §51 with
   more steps — so the count is clamped by the member's own rise.
2. **`generic('statue')` spent all the height on the FIGURE.** A constant
   0.85-1.15 m plinth and then the whole remainder of the props file's 4.2 m
   class default handed to the person: nine statues drawn 3.05-3.35 m tall, half
   again over heroic, each reading as a bare brown stick. A bronze is
   1.85-2.35 m; **the pedestal takes what the figure does not need.**
3. **The Nature's Neighborhood bronzes — §33's own finding left half-done.** Six
   small Texas natives by Lars Stanley and Dylan Connor arrive as `at=statue` at
   4.2 m. §33 sized the Sea Turtle and stopped. Armadillo, Bat, Horned Lizard,
   Prickly Pear and Bluebonnet were **each still a 4.2 m standing human figure.**

### What did NOT work, and it is the useful half

- **The "bench-shaped prop floating over the road beside the fountain" (§35) is
  not a floating prop.** Magenta-masked it is `props-furn`, and `js/props.js`
  draws that layer with `fill-extrusion-base: 0` — it cannot float. Measured:
  **0** furniture features inside a road polygon within 200 m of the fountain,
  and every furniture feature within 170 m is **≤ 2.73 m** tall. It is a
  PITCHED-CAMERA MISREAD: at 60 degrees, ground objects NORTH of a tree sit
  higher on screen than its base and read as hanging in its canopy. The playbook
  already says a single 2D projection lies about depth; this is that.
- **Four dead ends before that answer, ~90 minutes.** `queryRenderedFeatures`
  answers a fill-extrusion by FOOTPRINT, so it confirmed a bicycle rack under a
  pixel painted by something else. Guessing the sweep frame's camera from its
  contents put me 400 m away at the Blanton. Scanning `props.geojson` for tall or
  in-road furniture found nothing because there was nothing. **Only the magenta
  mask answered it**, and it answered in one run.
- **The head-on view is still the weak one.** From MLK the three horses
  foreshorten into blocks. Splaying the team's heads 0.55 m outboard fixed most
  of it; a fill-extrusion team pointing at the camera will not get better.
- **Monochrome is improved, not cured** — a fine staircase instead of a coarse
  one. Eight slabs is as far as that is worth taking.
- **15 of the 35 tiles contain no visible sculpture and I fixed none of them.**
  The Art Building group (Prometheus, Winged Victory, Swan's Dream, Amphora,
  History of Black Bronze), The Color Inside, Square Tilt and Vermillion are
  behind or on buildings; Circle with Towers is still under the tree §33
  reported. `shape_trees.py` and the camera, not `bake_art.py`.

### The working-directory hazard bit again, and this is the third time

**§33's disaster repeated exactly.** Mid-session another agent ran `git checkout`
in the shared tree, so a commit made on `acer/littlefield-memorial` landed on
`acer/roof-orange-ring` instead — discovered only when a worktree checkout of my
own branch came back at the wrong commit. It also deleted
`scripts/verify/node_modules` under me again, which surfaces as
`ERR_MODULE_NOT_FOUND` from `pose.mjs` and nothing else. Recovered by
cherry-picking into `C:/Users/simip/Projects/austin-3d-lf`.

**`git worktree add` is not advice any more, it is the only safe way to work in
this repo while another session is running.** And note `main` is already checked
out in `austin-3d-facades`, so `gh pr merge --delete-branch` fails on the local
checkout step — merge without it and delete the remote branch by hand.


## 37. Aug 2 2026 — a membrane roof does not get a terracotta parapet (acer lane)

**Branch:** `acer/roof-orange-ring`, PR #88. §35 item **2** — the
highest-COUNT visible defect on campus: every flat roof ringed in a hard burnt
orange, on hundreds of buildings, in every daytime frame.

### The measurement came before the change, and it moved the diagnosis

`scripts/verify/roof-ring.mjs` is the magenta-mask trick (§48) applied to three
layers at once: repaint `buildings-roof` / `roofscape-deck` / `roofs-pitched` in
flat primaries, read the framebuffer back, and report the ORIGINAL colour of
every pixel each layer owns. At `tour.mjs`'s `day-tower-close`, tod 0.30:

```
BEFORE (?roofcaps=0)                            AFTER
buildings-roof   9,537 px  rgb(173,88,51)       9,537 px  rgb(157,139,114)
                 93.3% of it burnt orange                 8.2% burnt orange
roofscape-deck  84,061 px  rgb(151,138,114)    84,061 px  rgb(151,138,114)
roofs-pitched  181,051 px  rgb(141,72,41)     181,051 px  rgb(141,72,41)
burnt orange, whole frame       214,997               197,184
cap pixels within 2 px of a deck pixel   5,185 / 9,497 — it is a rim
```

**Both columns come out of one build.** `?roofcaps=0` puts every cap back on the
building's terracotta, so BEFORE and AFTER are one session rather than a
checkout — which matters in a tree three sessions share (§32, §33). The
per-layer counts are identical to the digit because no geometry moved.

**And it corrected the target.** §35 named Calhoun Hall, and Calhoun measures
`run = 0.0` in `roof_runs.json` — it has NO tiled roof at all, so its ring could
not be the eave of a hip. Same for the Peter Flawn Academic Center, the
O'Donnell Building and McCombs. Meanwhile `roofs-pitched` is 82.4% burnt orange
and that is **correct** — those are the real tile roofs, and a fix that made
every roof grey would have destroyed them. The layer that owns the defect owns
0.60% of the frame; the layer that must not be touched owns 8.52%.

### The rule

**A building whose roof is a membrane deck has its parapet cap painted from THE
DECK'S OWN colour.** A building with a real tiled roof keeps the tile colour —
its cap sits under the eave of a hip, and terracotta is right there.

`scripts/bake_roofs.py` joins each deck in `data/roofscape.geojson` to its
building offline and writes `{id: [rd,rg,rn]}` as a `caps` member on
`data/roofs.geojson`; `js/app.js` stamps it onto the building feature in
`loadScene`, before `austin-buildings` is added.

```
1,810 caps recoloured of 1,821 decks read
   85 matched by a vertex walk (concave plans — crosses, courtyards)
    8 rejected because the deck was not standing on that building's cap
    3 skipped for having a real tiled roof
data/roofs.geojson 1,019.5 -> 1,145.0 KB — its FEATURES are byte-identical
```

Two independent checks on every join, because a wrong join is a wrong-coloured
building and nothing on screen would say so: the deck's representative point
inside the footprint, AND the deck's `b` equal to that building's
`final_height + capLift`. Eight failed the second and were dropped.

### FOUR THINGS THAT DID NOT WORK

1. **Covering the rim with a coping polygon.** The obvious fix, and the numbers
   killed it: measured on the real footprints, one full-footprint coping per
   decked building is **+783 KB** on a file that is not tiled — every visitor
   downloads it — to carry a colour. The table is +125 KB in the same file and
   adds no polygons to a fill-rate-bound scene. **A colour is not a shape; do
   not invent geometry to carry one.**
2. **Setting the colour as a paint expression on `buildings-roof`.**
   `js/timeofday.js:395` re-paints that layer from `rd`/`rg`/`rn` at every hour,
   so a paint fix survives exactly until the first move of the time slider.
   Changing the DATA is read by whatever timeofday sets, and needs no wrapper.
3. **Re-measuring the membrane colour in `bake_roofs.py`.** It has its own
   imagery and its own `deck_colour()`, and using them gives a cap close to the
   deck but not equal to it — **a fainter ring, not no ring.** The cap takes
   `roofscape.geojson`'s value byte for byte, which makes the dependency real
   and is written next to the constant.
4. **Masking one layer at a time, and any fixed wait after `setPaintProperty`.**
   A paint change on a layer this size re-uploads a vertex attribute for every
   loaded tile, LAZILY. Six layers one at a time hit the 900 s watchdog twice;
   and with a 1.2 s wait the same pose measured `roofs-pitched` at 181,051 px
   and then at 11,224, while `buildings-roof` came back as **zero** on a frame
   that visibly had the orange ring in it. That is the §34 trap in a new
   costume: an under-settled read is not a null result, it is a wrong one. The
   probe waits for the map's own idle and re-reads until two consecutive reads
   agree within 2%, and FAILS loudly if a layer it can see owns nothing.

### Verified

`harness-drift.mjs` PASS before every pixel measurement. Day, dusk 0.62 and
night 0.95 at the same pose — night is clean, no pale patch, no inverted
silhouette. `west-campus` and `aerial-wide` for regressions. And **re-verified
on the merged result**: `main` moved 9 commits in flight (`js/facades.js`,
`js/outer.js`, `js/sky.js`, trees — no overlap), merged in a separate worktree
and re-measured at `rgb(158,139,114)`, 8.4% orange, same counts.
`shots/roofring/cmp-calhoun.png` is before over after.

### Known remainder, deliberately not in this PR

`js/westcampus.js`, `js/drag.js`, `js/tower.js`, `js/moody.js` and `js/arts.js`
each hide `buildings-roof` for the buildings they take over and draw their own
cap from their own source's `rd`. **Those caps are still terracotta.** It does
not read as a ring in any pose shot here, because those passes do not lay a
membrane deck over their own buildings — but that is exactly where this defect
comes back, and each of those files would need the same `caps` lookup.

## 36. Aug 2 2026 — the creek's water was green, and the dark lines are fences (acer lane)

**Branch:** `acer/creek-water-canopy`. HANDOFF §35 items **9** and **10**, which
are one session because the second one turned out to take twenty minutes.

### Item 10 first, because it is answered and it is not ours

*"Sharp dark lines across the ground — one straight across Clark Field, one
tracing a plot by the creek, ticks along kerbs. 3-4 px, hard-edged, (59,45,32)."*

It is **`props-line`**, and one `queryRenderedFeatures` at the pixel he described
said so:

```
(893,423)  props-line | austin-props | {"k":"line","u":"fence","h":1.9,"c":"dark","src":"osm"}  x4
(713,507)  props-line | austin-props | {"k":"line","u":"fence","h":1.9,"c":"dark","src":"osm"}  x2
```

A column straight through the bar on Clark Field's north edge, tod 0.30:

```
y=421..424  157,80,59    the running track
y=425..428   66,54,44    THE BAR
y=429       168,87,64    a gap between panels
y=430..433   65,54,44    THE BAR
y=435       148,161,103  the infield
```

**(66,54,44), four pixels, one pixel of transition at each edge.** Hiding
`props-line` removes both bars and changes nothing else:
`shots/creek-before/crop-field.png` against `shots/creek-before/crop-fence-off.png`.

**The cause is that a fence is modelled as an opaque wall.** `bake_props.py:121`
is `"fence": (0.10, 1.90, "dark")` and `js/props.js:108` is
`dark: ['#4e5058', '#4c4238', '#15171d']`. The 0.10 m width is honest and
invisible — a fifth of a pixel from flying altitude. What you are seeing is the
**1.90 m of vertical face**, which at 60° of pitch is exactly the 3-4 px
reported. A chain-link fence round a ball field is ~90% air; drawn solid it is a
black bar across the infield, and the same object is the "plot boundary by the
creek" and the "ticks along kerbs".

**Not fixed here.** `js/props.js` and `scripts/bake_props.py` belong to another
lane this session and the brief limited this one to the ground. The fix is a
line of paint, not geometry: either an opacity/colour for `u:'fence'` that is
not the one shared with dark METAL, or a `fence_type` off OSM so chain-link
reads as haze while a masonry wall stays solid.

Also worth knowing, and it generalises: **the layer-hide sweep alone would have
sent someone the wrong way.** Ranked by warm-dark pixels removed it reads
`roofscape-major 12,704`, `props-line 7,797`, `buildings-3d 5,732` — and the top
entry is just the dark tops of buildings, which are meant to be dark. The sweep
says *where the dark pixels live*; only the query at the complained-about pixel
says *what he is pointing at*. Run both.

### Item 9 — the creek

*"Waller Creek is still a green stripe. The channel is real in the data but there
is NO WATER SURFACE and no canopy from flying altitude."*

There has been a water prism in that channel since §34 cut it. **It was painted
green.**

```
water     #41604a  rgb( 65, 96, 74)  luma 88   b-r =  +9
bankshade #425c33  rgb( 66, 92, 51)  luma 82   b-r = -15
```

Six luma and the same hue, two metres apart on screen. Two surfaces that measure
the same are one surface, and that is the whole of "it is still a green stripe":
three passes changed the colour of the corridor and none of them changed the
colour of the **water**. It is cool now — authored luma 118 between the chalk
toe's 142 and the bank shade's 82, b-r +63 — plus a rippled top face.

**And the ripple could not go on the water prism**, because a `fill-extrusion`
takes `fill-extrusion-color` OR `fill-extrusion-pattern` and never both, so the
pattern would have cost the water its time-of-day colour. It is its own 0.10 m
slab standing on the water (`m:'sheen'`), which is under a fifth of a pixel from
any altitude this camera flies and makes the depth order defined rather than
undefined.

**The canopy is baked as GEOMETRY here rather than waiting for
`shape_trees.py`.** The `src:'creek_canopy'` hook was written for that file and
nothing has ever read it, but the deeper point is that consuming it would not
have been enough on its own: what makes a canopy legible from 200 m is that it
is **ten metres off the ground**. A flat green polygon is a green stripe at
every colour. So `CANOPY` in `bake_ground.py` plants 465 crown prisms over the
understorey and canopy rings — three species, **one prism each**, because a
stack is the wedding-cake defect §35 item 7 already names.

Third thing in the same pass, and it is small and it mattered: **the scrub zone
was painted `grass`**. Same colour AND same texture tile as a mown lawn, so the
widest of the corridor's three "zones", the one right beside the water, was
indistinguishable from the field next to it. Two of three zones were one zone.

`data/ground.geojson` 1,332.3 → 1,483.5 KB, **+151.2 KB**. It is not tiled, so
that is a real download. `CANOPY.spacing_m` is the single knob that trades it.

### Four things that did NOT work, and the last one is the reusable one

1. **The sheen was deleted by the resolver and the bake reported it as shipped.**
   `k:'bank'` returns band `"flat"` from `_band`, so the sheen went into A2's
   ladder at `RANK[('bank','channel')] = 90` — same band, same rank, same
   footprint as the water prism it stands on. The resolver gave the ground to
   whichever sorted first and trimmed the other to nothing. All seven were
   emitted, all seven were deleted, **and the report still printed
   `creek_water_sheen: 7`**, because that counter is incremented at emit time.
   A statistic that counts intent rather than outcome is worse than no
   statistic. `main()` now derives a `shipped` block by walking the feature list
   it is about to write, which is the same argument `bake_art.py`'s re-measure
   makes.
2. **Requiring crowns to actually overlap kept 27 of 604.** The rule was right —
   a lone prism reads as a flat-topped green box and two overlapping ones merge
   into foliage — but the corridor is a 10-30 m ribbon and a 20 m lattice puts
   roughly ONE crown across it. There is no cluster to join. Literal overlap
   needs spacing under the crown diameter, which is 1,206 crowns and 374 KB on
   an untiled file. The rule survives at `min_neighbours: 1`, `touch: 1.5`,
   which deletes 139 genuinely stranded crowns and keeps 465.
3. **Six-sided crowns render as cubes.** `shots/creek-after/crop-corridor.png`.
   Eight sides plus a 0.34 per-vertex wobble plus **0.45 size variance** fixed
   most of it, and the variance is the part that mattered: at 0.30 a species is
   one repeated slab with every top within a metre of its neighbour, and a
   cluster of those is a plateau. Variance costs zero bytes, which is why it is
   the first knob to reach for and vertices are the last.
4. **THE AUTHORED HEX IS NOT WHAT LANDS.** This scene is colour-graded warm, and
   the section across the channel proves it: the chalk toe is authored `#9a8f70`
   = (154,143,112) and arrives as **(124,91,52)** — roughly
   (×0.81, ×0.64, ×0.46). A blue authored at (77,127,140) therefore renders near
   (62,81,64), which is not blue. **Every colour decision in this repo that was
   made by reading a hex was made in the wrong space.** What still works is
   RELATIVE: on screen the water sits ~50 units of `b-r` above everything beside
   it, and that is the number to quote, not the hex.

### And a trap in the instrument, twice in one session

The nadir section probe returned `(67-81)` on one run and a dead-flat
`(80,90,57)` on the next, same pose, same tod. The second was **a tree crown
top**. Nadir defeats an oblique occluder and does nothing at all about something
directly overhead, and §34's rule — an occluded sample is a wrong answer, not a
null one — applies to nadir too. The probe hides every layer that can stand over
the channel now.

**Also: `git add -A` in this checkout stages four other agents' in-flight work.**
One commit here picked up `data/art.geojson`, `data/trees.geojson`,
`js/facades.js`, `scripts/bake_art.py`, `scripts/shape_trees.py` and two other
sessions' temp scripts before it was reset. Stage the files you named in the
brief, by name, every time.

### Housekeeping

`tour.mjs`'s `waller-creek` pose is fixed: it sat at `-97.7330` with the channel
130 m to the west, so the one tour frame named after the corridor photographed
San Jacinto. It centres on the water at the Alumni Center reach now
(`-97.7344, 30.2845`, z17.2, pitch 62, bearing 8) and both stretches Simeon
named are in it. Pictures: `shots/creek-before/` against `shots/creek/`, and
`shots/creek-night/` for the after-dark check — the canopy adds nothing pale.

## 35. Aug 2 2026 — the full day/night sweep on merged `main`, and the ten things it is still visibly wrong about (acer lane)

**No code changed in this pass.** It is a read: pull `main`, run the whole sweep,
and then LOOK at all 24 frames rather than report that three scripts exited 0.
His complaint this round is that passes stop at the first thing that works, so
the deliverable here is the list of what is still wrong, ranked by how big it is
on screen — not a confirmation that the last seven PRs landed.

Served with `python scripts/serve.py 8136`; `tour.mjs day`, `tour.mjs night` and
`night-pale.mjs`, all at `VERIFY_MAX_MS=900000`. 24 frames in `shots/tour/`, plus
two poses in `shots/sweep-extra/` for work the tour does not cover.

### The night-pale number first, because it is the one that gets quoted

```
pale pixels below the horizon, all layers on: 871      (was 872)
(46 visible fill-extrusion layers)
mean luma  counted 34.3   skipped (sky) 36.7

by pass:      stadium-*  (5)     108   12.4%
              places-*   (2)       6    0.7%
inside stadium-*:   stadium-detail  154   17.7%
inside stadium-detail, by kind:  *** KILLED — watchdog at 900000 ms ***
```

**871 against 872. Seven merged PRs moved it by one pixel**, which is right —
none of them touched night — and the run **did not finish**: the by-kind pass that
§27 added, the step that turns a layer name into a cause, hit the watchdog. So
this script currently costs 15 minutes and returns less than it did in §27. Read
the section at the bottom before quoting 871 as the state of night; it is
measuring something much narrower than "is the city dark".

### What was merged before the sweep, so all of it is in these frames

```
#74  acer/roof-hole-coverage         A1     3 diagonal roofs, 75 roofs with a hole
#75  acer/fountain-steps             A5     terrace()/flight() grew a riser
#76  acer/trees-off-surfaces         A3+A4  trunks out of roads, pitches, open lawns
#77  acer/art-accurate-size          A8+A9  the DIMS table; Kelly's three windows
#78  acer/ground-coincident-surfaces A2     the RANK ladder; Speedway x 24th
#79  acer/creek-cut-channel          A7     Waller Creek cut below grade
#80  acer/garden-structure           A6*    beds, specimens, a built pond coping
#71 #72 #73  mac lane                       outer facade bake, LOD roof caps, `fb`
8188868                                     one lane, all files — the Mac is off
```

Plus two `austin-data-bot` archive rebuilds (`7f78264`, `7084045`), so the tiled
layers in these frames are current, not stale.

### RANKED — what is still wrong, most visible first

**1. DKR's seating bowl reads as daylit at night — and this one is a TASTE call,
so it goes to Simeon.** The outer facade darkens correctly and the decks inside
it do not, so the bowl is a flat caramel mass in a black city. In
`night-pale.mjs`'s own frame the whole-frame median luma is **13.8** and a
24,750 px box on the bowl medians **47.9** — 3.5x the city. It is legible from
2 km: it is the brightest thing on the horizon in `night-west-campus`,
`night-capitol`, `night-moody-arena` and `night-aerial-wide`.

**It is authored, not broken.** `SEAT_COL` in `js/app.js:539` gives every seat
band an explicitly burnt-orange night trio — `#d87c34`, `#e08438`, `#e88c3e`,
`#f09a48` — and §27 examined exactly this and defended it as the 2023-24 LED
upgrade. The intent is right and the result on screen is not, for a reason §27
could not see from one pose: **DKR is the only lit object in the entire city.**
Nothing else floodlights, the bowl casts no spill on its own facade or on the
ground, and the decks are uniformly bright with no falloff — so it does not read
as "the stadium is lit", it reads as "this object missed its night colour".
CLAUDE.md rule 9 puts this in his hands, so: the picture is
`docs/shots/sweep-night-dkr-glow.jpg`, and the choice is keep it, dim it to
roughly half, or light a few other landmarks so it has company.

**2. Every membrane roof on campus is ringed in burnt orange.** The cause is two
layers disagreeing about one roof. `bake_roofs.py` gives a flat "membrane" roof
its own sampled deck colour `dc` and `roofs.js` lays that deck over the top face;
the parapet cap under it (`buildings-roof`, `js/app.js`) is still painted
`['get','rd']`, the building's tile-roof colour. So a grey deck sits inside a
terracotta ring. Measured on Calhoun Hall: ring **(191,77,30)** / **(204,89,41)**
against a deck of **(159,132,99)**. It is on PCL, McCombs, the Moncrief-Neuhaus
Athletic Center, every garage — hundreds of buildings in every day frame, and it
reads as a selection highlight, not architecture.
`docs/shots/sweep-roof-orange-ring.jpg`.

**3. Downtown is still forty identical brick-red boxes.** Same hue, same flat
grey cap, no crowns, no setbacks, no podiums, no glass. Austin's skyline is a
glass skyline and this is a blockout. QUEUE **D2b** says why in one line — the
bake landed and the render switch is still inert — and nothing in this sweep
contradicts it. `docs/shots/sweep-downtown-boxes.jpg`.

**4. The outer ring is a tan carpet by day and dead black by night.** Green
pixels by screen row in `day-dkr-stadium`: **11.4% in the near field, 0.2% and
0.0% in the far ring**, with a hard horizon and no recession. At night the same
ground measures luma **13-19 across the whole band** — not one light past about a
kilometre. This is QUEUE **D3**, which was written up as a dusk problem; it is
every hour. `docs/shots/sweep-far-ring.jpg`.

**5. Windows are still blurred, and on some buildings they have collapsed into
bands.** QUEUE **D1** is untouched and it is the most-seen surface in the scene.
Worst case is not softness, it is total loss: the garages and blocks south of the
Blanton have no windows at all, just soft horizontal gradient stripes wrapping
the box. `docs/shots/sweep-facade-bands.jpg`.

**6. Night streetlights are a carpet of cold blue-white bokeh.** In
`night-aerial-wide` **0.84%** of the frame is above luma 120 and **87% of those
hot pixels are blue-white** against 13% warm — so the night palette is decided by
the lamps, not by the city. The glows are larger than the buildings they stand
between, many of them sit over rooftops rather than over streets, and the campus
uses a warm lamp while the west and south use a cold one, with the seam visible.
`docs/shots/sweep-night-lamps.jpg`.

**7. Every tree is a stack of flat octagonal discs.** Three to five tiers, hard
edges, one olive green. At any zoom past ~16.5 they read as wedding cakes. It is
39,580 features and it is in every frame.
`docs/shots/sweep-trees-and-blacklines.jpg`.

**8. The canopy stops at the campus edge.** `day-aerial-wide` shows the whole
city outside the core with essentially no trees — West Campus, East Austin and
everything south of the Capitol are bare tan blocks with grey roads. Austin is a
tree city and this reads as a dust bowl. Same root as (4): only mapped trees are
drawn, so the ring gets nothing.

**9. Waller Creek still reads as a green stripe.** §34's channel is real in the
data — it is cut, three planting zones, its own texture — but from a normal
flying altitude there is **no water surface and no canopy**, because §34's own
note is still open: the trees live in `data/trees.geojson` and the
`src:'creek_canopy'` hook has never been consumed. So the pass that was meant to
end "a bit of green" currently delivers a slightly darker bit of green.
`docs/shots/sweep-creek-no-canopy.jpg`.

**10. Stray dark lines lie across the ground.** One runs dead straight across the
Clark Field infield in `day-dkr-field`; a second traces a plot boundary by the
creek in `day-waller-creek`; short dark ticks sit along kerbs in most day frames.
Measured, it is **3-4 px wide with a hard edge**, `(59,45,32)` against the
field's `(152,170,93)` — so it is NOT the blurred `buildings-ao` halo, which is
`#120c06` under a 19 px blur. Something thin is being extruded at ground level in
a dark brown. Not attributed yet; worth one `queryRenderedFeatures` at those
coordinates. `docs/shots/sweep-trees-and-blacklines.jpg`.

### Two things the tour does not photograph, shot separately

**The Littlefield Fountain has no memorial.** A5 asked for the steps to be
accurate and #75 gave `terrace()` a riser, which is real — but the landmark
itself is **two flat blue-grey puddles with a tan coping and one six-step nub on
the upper basin's corner.** The fountain's entire subject — Pompeo Coppini's
bronze group, Columbia on a ship's prow with three horses and two mermen on a
stone pedestal — is not in the scene at all, and neither are the curved flights
the item explicitly named. `shots/sweep-extra/fountain.png`,
`docs/shots/sweep-littlefield-no-memorial.jpg`.

**A prop is floating.** Two long tan planks hang in mid-air, crossed at an angle,
over the roadway just south of the fountain (`shots/sweep-extra/fountain.png`
around x=1000, y=700). Nothing under them. Probably a bench or a shelter with
broken geometry — one bad feature, but it is at eye level in a landmark shot.

The Memorial Garden and Turtle Pond (#80) still have **no photograph on `main`**:
my pose for them was mis-aimed and I did not spend a second load on it. #80's own
`shots/garden/after3/pond.png` shows beds rendering as flat brown ovals on the
lawn and specimens as 10-sided green boulders larger than the buildings' windows,
so it is worth a real look before that item is called closed.

### Below the line — real, smaller

The **UT Tower's crown** is a blank tan box with one small clock face, no belfry
columns and no lantern, and its shaft's window columns cover only the middle
third of its width (`docs/shots/sweep-tower-crown.jpg`); at night the whole tower
is one flat orange slab. The **South Mall lawn** is a flat untextured green
rectangle now that A4 has cleared it. **Pools render teal** (~`(90,157,148)`,
8 clusters in `day-west-campus` alone) and glow blue at night. **Small grey
building labels** overlap each other and the Tower and are unreadable, while POI
labels are a rainbow of brand colours. The **Capitol's body** is a windowless
dark slab with no portico under a genuinely good dome. Ground **south of the
Capitol and east of I-35** is bare tan for whole blocks — QUEUE **B3** never left
campus.

### The instrument problem, which is the reusable part of this pass

**`night-pale.mjs` cannot see the defect it was written for.** Its threshold is
`PALE = 120` luma, a constant. Measured in the very frame it writes
(`shots/night-pale-before.png`):

```
whole-frame median luma            13.8
DKR bowl, 24,750 px box            median 47.9   1 px over 120   8,196 px over 60
Kelly's "Austin", night-blanton    median 94.0   0 px over 120   max 117.9
```

Both of those are the "inverted silhouette" failure the script's own docstring
describes — a building-shaped patch staying pale while the city is dark — and
both score **zero**. The 108 px the run does attribute to `stadium-*` are the
floodlight lamps §27 already cleared; the 25,000 px of glowing bowl right next to
them are invisible to it.

A surface does not have to be bright to be wrong; it has to be bright *relative
to the frame*, and at a night median of 13.8 anything over about 45 already reads
as lit. A fixed 120 was calibrated against a brighter frame and has been quietly
measuring almost nothing since. **The threshold should be a multiple of the
frame's own median, not a constant** — and until it is, the number this script
prints is not evidence that night is fixed.

This is the same shape as the trap CLAUDE.md rule 10 already records: an
instrument's defaults are part of its answer. The count went 6,206 -> 872 and
everyone read that as 86% solved; what actually happened is that the pixels which
survived the drop were the ones the threshold could still see.

**And the second half of the caveat, which §27 already wrote down and nobody has
acted on:** `_harness.html` is missing `js/tiles.js`, so in the harness
`window.tileSource` is undefined and trees, roads, roof detail, props and the
outer ring all silently fall back to GeoJSON. `night-pale.mjs` loads
`_harness.html`. **Every number it prints is measured on a scene the site does
not serve.** Two independent reasons to stop quoting this script's count as the
state of night.

### Housekeeping

- Eight merged branches are still on `origin` — `acer/roof-hole-coverage`,
  `acer/fountain-steps`, `acer/trees-off-surfaces`, `acer/art-accurate-size`,
  `acer/ground-coincident-surfaces`, `acer/creek-cut-channel`,
  `acer/garden-structure`, `mac/outer-bucket-inert`. CLAUDE.md rule 2 says delete
  after merging.
- **§31 and §33 are the same pass written twice** (`acer/art-accurate-size`), §33
  being the later and fuller copy. Nothing points at §31.
- `tour.mjs`'s `waller-creek` pose (`-97.7330, 30.2870`, bearing 180) does not
  contain the creek; the corridor is only legible from the `moody-arena` pose.
  The pose named after the newest ground work does not photograph it, and neither
  the Littlefield fountain's new risers (#75) nor the Memorial Garden beds (#80)
  appear in any tour pose at all. **A pass whose result no tour frame contains is
  a pass nobody will notice regressing.**

## 34. Aug 2 2026 — the ground stopped fighting itself, the creek got cut, and a garden stopped being a lawn (acer lane)

Three PRs: `acer/ground-coincident-surfaces` (#78), `acer/creek-cut-channel`
(#79), `acer/garden-structure` (#80). QUEUE **A2**, **A7** and the garden half of
**A6**. They are one thread — the second and third are only possible because of
the mechanism the first put in.

### A2 — one square metre of ground belongs to exactly one surface

*"speedway and 24th keep glitching on motion and combine on still, find out
other areas like this and fix"*

**Photographed the flip before changing anything, and the instrument is the
reusable part.** MapLibre keeps `center` at the SCREEN CENTRE at any
zoom/pitch/bearing, so a sweep that holds a point at the centre and moves only
the camera looks at one square metre of ground from many camera positions. At
Speedway and 24th, nadir, bearing 0 against bearing 72:

```
bearing  0   the crossing's asphalt paints OVER the brick mall
bearing 72   the brick mall paints OVER the crossing's asphalt
```

Both are `patharea`, both stand at exactly `GROUND.pathRaise` = 0.22 m, both are
in the one `ground-paths` fill-extrusion. Two coplanar top faces have no defined
winner. `docs/shots/ground-speedway-24th.jpg`.

**Not two streets — 1,669 pairs**, walked mechanically, in metres:

```
  642  same-height polygon pairs        271,820 m2
       337 patharea x patharea            1,791 m2   the true depth tie
       184 area x area                   90,433 m2   one fill composited through
                                                     another at 0.95
1,027  carriageway x patharea            22,582 m2   a 2.4 m sidewalk slab
                                                     standing 0.22 m proud
                                                     across a 15 m road
```

**One rule: `RANK` in `bake_ground.py` orders every ground class; the higher rank
keeps the ground and the lower one gives it up.** Nothing moved in z and no
layer order changed — the ambiguity is out of the DATA, so it cannot come back
at a camera angle nobody photographed.

```
same height     642 pairs / 271,820 m2  ->  16 pairs /  26 m2
carriageway   1,027 pairs /  22,582 m2  ->  77 pairs / 102 m2
```

All 93 residuals are shapely's edge residue: **mean width 1-29 mm over spans of
27-495 m**, a twentieth of a pixel from flying altitude. After, the same 10-pose
bearing sweep reads ONE tone at both worst overlaps (max spread 15 sum-rgb,
which is the light) against TWO before (max separation 237).

**Three things that did NOT work:**

1. **Diffing two near-identical poses.** 59% of pixels differ between two frames
   0.3 m apart — and **48% differ between two frames at the SAME pose**. Clouds,
   AA and light animation. It cannot see a z-fight at all.
2. **Sweeping at pitch 25-60.** Half the samples came back tree green and trunk
   brown. An occluded sample is not a null result, it is a wrong one. Nadir only.
3. **Measuring areas in degrees.** The first probe built shapely polygons
   straight off lon/lat. §32 already records this trap and it was walked into
   again inside an hour.

**The probe lives in the bake** and prints BEFORE and AFTER on every run, which
is the regression net QUEUE B6 asks for, for the class it covers.

### A7 — Waller Creek is a cut channel now

*"you added a bit of green around the creeky water when i asked for more than
just that ... not the bare minimum"*

**What unblocked the depth was re-reading one sentence in PR #62.** It says a
basin must build UP from z=0 because *"a `fill` does not depth-test against a
`fill-extrusion`, so a basin sunk below z=0 is painted straight over by the flat
ground fill above it."* True — of a fill drawn over that ground. So the answer
was never to build upward, it was to **stop drawing the flat fill there**, and
A2's resolver does exactly that for a living. `RANK[('bank','channel')] = 90`,
every lawn/wood/park polygon gives up the footprint, `js/ground.js` drops
`s:'creek'` from `ground-areas`, and with nothing flat over the hole
`fill-extrusion-base` is free to go negative.

Everything scales off the reach's own mean width (area / half-perimeter):

```
mean width  10.3  7.7  7.7  6.9  6.8  5.5  4.7 m
depth       3.10 2.32 2.30 2.08 2.04 1.66 1.40 m
```

Planting is three zones, not one colour — scrub 74,145 m2, understorey
79,222 m2, canopy 125,383 m2 — and `wood`/`understorey` wear their OWN texture
tile. That last one matters more than it sounds: **the colour was already
different from grass and the GRAIN was not, so at altitude the eye merged them**
and the corridor read as paint.

**Two things that did not work:**

1. **One list for the horizontal run and the vertical drop.** That gives the
   outermost course half the run at zero drop — a 2.6 m flat shelf at grade
   wearing the chalk colour — and from the air it read as a **dirt track running
   beside the water**. They are separate distributions now, and the bank is
   green except at the toe.
2. **Buffering a 3.9 km creek seven times with round joins.**
   `data/ground.geojson` DOUBLED, 1,067 -> 2,081 KB, on a file that is not
   tiled. `simplify(0.5 m)` and 3 segments per quarter turn: 1,306.6 KB.

**And a bug the re-bake caught in A2's own ladder:** `pitch` outranked `sand`,
and the five sand areas on this campus are **long-jump pits INSIDE a pitch
polygon**, so all five were deleted. Small and specific beats large and generic.
The bake reports every fully-covered feature by class for exactly this reason,
and that report is what caught it.

### A6 (garden half) — a garden is not a lawn

**The whole cause is one table entry.** OSM tags the Memorial Garden
`leisure=garden`, names it, and gives it 2,190 m2. `AREA_USE` maps that to
`u:'garden'` and `DEFAULT_SURFACE` then hands `u:'garden'` the colour `grass`.
The garden was being drawn. It was being drawn as a lawn.

Nothing is freehand: a **bed** is the band 1.0 m back from a real walk, 3.0 m
deep, inside a real garden polygon (11 of them); a **specimen** sits at each
remaining lawn panel's pole of inaccessibility via `shapely.ops.polylabel` (12);
the **pond coping** is a 1.2 m ring standing 0.38 m proud, applied BY A RULE — a
pond earns a built edge if it lies within 6 m of a garden or a plaza, which 1 of
5 does, and it is Turtle Pond. The other four are reported as `pond_no_coping`
so the rule can be argued with.

**Two more things that did not work:** `#4a442e` for a bed measures 67 luma
against grass's 158 and read as a HOLE cut in the lawn rather than as planting
(96 is right, and the number is in the comment); and **a 5.5 m specimen
simplified at the creek's 0.5 m is an octagon**, which is exactly what it looked
like. One simplify tolerance cannot serve a 3.9 km bank line and a 5 m circle.

### Running total on the file

`data/ground.geojson` 1,576 -> 2,353 features, 899.4 -> 1,332.3 KB. It is not
tiled, so that is a real download. The split: +168 KB for A2's clipping, +239 KB
for the creek, +26 KB for the gardens. `data/roads.geojson` is byte-identical
throughout — `bake_roads()` was never edited, it just runs earlier now.

### What this lane could NOT do, and where the hooks are

The brief limited this pass to `scripts/bake_ground.py`, `js/ground.js` and
`data/ground.geojson`. So the creek has no TREES and the garden has no BENCHES
or specimen trees — those are points in `data/trees.geojson` and
`data/props.geojson`. The hooks are in the data: the corridor carries
`src:'creek_canopy'` / `creek_under` / `creek_scrub` and the garden carries
`src:'garden_bed'` / `garden_specimen`, so a density rule in `shape_trees.py`
and a bench run in `bake_props.py` are both short. **That is the highest-value
follow-up on the board right now** — the ground under the creek is right and it
is still missing its canopy.

## 33. Aug 2 2026 — the landmarks were the wrong SIZE, and no recipe could have fixed it

**Branch:** `acer/art-accurate-size`. QUEUE A8 and A9 — the item he was most
annoyed about: *"make monochrome for austin look better not like a silver tree.
clock not looks like a fireplace and not big enough. I don't even want to check
out the other landmarks PLEASE make them accurate to size and architecture."*

**He put size first and the reason is one line of data.** Every recipe in
`bake_art.py` scaled off `hw`, `hd` and `H` handed in from `props.geojson`, and
those three numbers carry no information about the artwork. Print them and it is
obvious: **every `at=statue` is 4.2 m on a 1.83 m footprint, every
`at=sculpture` is 5.5 m on 3.17 m, every `at=installation` is 7.0 m on 4.81 m.**
Class defaults on a buffered OSM node — the same three numbers for the armadillo
and for the largest sculpture on campus. So no amount of care inside a recipe
could have produced a correct size, and ten hand-tuned multipliers would have
been ten guesses at the same missing fact. The fix is one `DIMS` table consulted
before any recipe runs, with the source written next to each entry.

```
Monochrome for Austin   7.0 m -> 15.24 m   46% of height   50x52x41 ft, Landmarks UT
Clock Knot              5.5 m -> 12.65 m   43% of height   498x260x420 in
Circle with Towers      3.2 m ring -> 7.82 m, towers 5.5 -> 4.27 m
The West                4.5 m -> 1.52 m    two 5 ft spheres, Met Museum
Austin (Kelly)          18.3 x 8.2 -> 18.29 x 22.25 cruciform
Mustangs                3.2 -> 11.0 m long, three horses -> seven
Sea Turtle              4.2 m -> 1.00 m    a bronze animal is animal-sized
```

**The pictures.** `docs/shots/art-sheet-after.jpg` is the whole ten at one
ground scale; the before/after pairs are `art-monochrome-before/after.jpg`,
`art-clockknot-before/after.jpg` and `art-kelly-before.jpg`, and the two windows
that were wrong are `art-kelly-east-tumbling.jpg` and
`art-kelly-west-starburst.jpg`.

**Unrelated defect the close-ups found, for A3:** a tree canopy stands directly
on Sol LeWitt's *Circle with Towers* and hides most of it from every direction
(`docs/shots/art-circle-towers.jpg`). The ring renders correctly — it is the
tree that is in the wrong place. `shape_trees.py` drops trees inside buildings
and checks nothing else, which is exactly what A3 says.

**Size was only half of Monochrome.** The old recipe put fourteen slabs on ONE
origin at even angles, and a single origin plus even angles is a daisy on a
post, which is a tree — his word, and the right one. It is now 32 hulls sampled
through a cloud whose centre is **not** the mast, five placed outriggers, and a
back-stay that exists only on the light side. Before and after at identical
framing: `shots/art/before/Monochrome_for_Austin.png` against
`shots/art/sheet-after-crops/Monochrome_for_Austin.png`.

**Clock Knot's shape came out of the published description, not a glance at a
photo.** Landmarks describes crossed I-beams, a circular knotted centre, and a
beam that reads as vertical until you move and it turns out to be *one leg of an
inverted V*. That clause is the whole silhouette. Three even legs under a
horizontal top member on a slab the width of the footprint is a mantel over a
hearth on a hearthstone, which is what he saw.

**A9, and the answer is that two of the three windows were on the wrong wall.**
Kelly's motifs are the colour grid (a 3×3 lattice of squares), tumbling squares
(the same squares rotated around a circle) and the starburst (those squares
elongated into narrow streaks), on the **south, east and west** in that order.
The bake had six tall spectrum lights on the east — a window this building does
not have — and the ring of squares on the west, where the streaks belong.
**3×3 + 12 + 12 = 33, and 33 is the published count of mouth-blown Franz Mayer
windows.** A reading that lands on the total is the check; one that does not is
wrong.

**And the massing is a CROSS, which is derived rather than guessed.** 60 × 73 ft
as a rectangle is 4,380 sq ft against a published 2,715. The same overall size
with 7.72 m arms is 2,733 sq ft — within 0.7%. So the arm width is solved for,
not chosen, and a cross plan is exactly what produces the **double** barrel
vault the building is known for. The old bake drew one vault over one box,
having read the 26 ft 4 in **height** as a depth.

### The bug this turned up, which is the reusable part

`art_lonestar` made fifteen calls and most of them emitted nothing: five beams
from a point to itself, five boxes from `z` to the same `z`, and of five star
arms only the two with a positive vertical component survived — `beam()` spreads
`z0..z1` across its steps and `add()` drops anything under 2 cm tall. **Three of
a five-pointed star's five points were never in the file, and nothing said so.**
Invisible in a screenshot, because what is left still looks like a shape.

So `main()` now **re-measures the file it just wrote** against `DIMS` and exits
non-zero on a disagreement. It caught two while this was being written — Diana
at 5.36 m against a 4.40 m table, Sea Turtle spanning 2.19 m against 1.60.

### `scripts/verify/art-sheet.mjs` — the instrument, built first

Every authored piece photographed at ONE ground scale, laid out in a grid with
its measured size beside the published one, red-bordered where they disagree.
The point is that a 15 m Rubins and a 1 m turtle have to *look* 15 m and 1 m in
the same grid or the sheet is decoration.

**Three things that did not work, and they cost most of the session:**

- **A 40 s per-pose wait for every `austin-*` source to report loaded.** At zoom
  20 they never all do, so 34 poses × 40 s hit the watchdog with **no output at
  all** — twice. Only the artwork's own source is worth waiting for, and it is
  plain GeoJSON loaded in full before the first tile.
- **Crops in a temp dir, and no resume.** A full pass is 34 camera moves at
  ~37 s each on a loaded machine, and when the watchdog fired it took twelve
  perfectly good frames with it. They are written next to the sheet now, and
  `--resume` keeps whatever is already there.
- **Sampling never reaches its own envelope.** 32 hulls drawn from an ellipsoid
  measured 12.85 m across against a published 15.85. Monochrome's five
  outriggers are placed rather than sampled for exactly that reason.

### And the thing that nearly lost the whole pass

**Two sessions were running in the same working directory.** Mid-pass the other
one ran `git checkout`, which reverted `bake_art.py` and `data/art.geojson`
under me, moved `HEAD` to its own branch, force-moved `acer/art-accurate-size`
off my commit, and deleted `scripts/verify/node_modules` — after which every
harness script failed with `Cannot find package 'playwright-core'`. The commit
survived only because it was already made and someone had left it on
`acer/art-accurate-size-recovered`.

**Two lessons, and the second is the durable one.** `git worktree add` is the
answer, not care — this pass finished from
`C:/Users/simip/Projects/austin-3d-acer-art`, which nothing else can check out
from under it. And note that **`node_modules` lives at `scripts/verify/`, not at
the repo root**, which is why a fresh worktree resolves nothing until it is
linked. It is gitignored, so a new worktree never has it.

Also worth knowing: **any other session's `reap.mjs` will kill your browser.**
It filters on `--enable-unsafe-swiftshader`, which `chrome.mjs` requires every
harness browser to carry, so it cannot tell yours from theirs. That killed one
run at the compose step. `--resume` exists because of it.

`data/art.geojson` 383 → 623 parts, 115.6 → 179.3 KB. The Hal C. Weaver plant
parts (PR #67) are untouched.

**Note for the next reader:** `QUEUE.md` points at "HANDOFF items 31–57" for
last night's lessons. **Those entries are not in this file** — it runs 30, 29,
28 … 23, then 13. The numbered references inside QUEUE (§44, §48, §50, §51)
therefore resolve to nothing. This entry took 31 when it was written and 33 by the time it landed, because the trees pass claimed 31 and 32 while it was in flight.

## 32. Aug 2 2026 — trees stood in roads because only buildings were ever checked (acer lane)

**Branch:** `acer/trees-off-surfaces`, PR #76. QUEUE **A3** and **A4** — one
mechanism, because they are one claim: *a trunk cannot be in a surface that has
no room for a trunk.* `shape_trees.py` tested a building footprint and nothing
else. It reads `data/ground.geojson` and `data/roads.geojson` now, through one
`SURFACES` table that gives every ground class a verdict and a margin.

**The trunk is the test, not the crown.** A live oak hanging half way over
Guadalupe is right and this campus is full of them.

```
road carriageway  737 DROPPED     patharea/footway   745 kept
area/pitch         15 DROPPED     area/park         1162 kept
area/water         10 DROPPED     area/lawn          593 kept
area/track         10 DROPPED     area/wood          454 kept
open lawn           6 DROPPED     area/parking       243 kept
area/endzone        4 DROPPED     area/plaza         115 kept
782 trees, 2,390 features.  41,964 -> 39,580.  trees.pmtiles -24,810 bytes.
```

**Footway, plaza and parking are KEPT, against the brief, and the measurement
is the argument.** The city inventory's 869 trunks here are SURVEYED positions,
so the fraction of them inside a surface measures that surface's positional
authority: **2.1% land inside a road carriageway — the error floor — but 28.3%
land inside a `footway` polygon.** A quarter of Austin's surveyed street trees
are not standing in the middle of the sidewalk; a 2 m walk widened from a
centreline has less authority than the survey, and a tree well in a pavement, a
planting island in a car park and a specimen tree in a plaza are real. Dropping
those three would have deleted **1,103 more trees** and stripped the Drag of the
street trees that make it read as a street. Every class is in the table either
way with its count printed, so flipping one is a one-line edit.

The road test insets **0.8 m**: `bake_ground.py` builds `w` as `lanes*3.4 + 1.6`
and the 1.6 is the kerb allowance for both sides, so the test lands on the
travelled way. Without it the count is 1,038 and the extra 301 sit on the kerb.

**A4 is three SEED POINTS, not three polygons** (`OPEN_LAWNS`). The lawn
containing each is the one cleared, so a ground re-bake cannot silently move the
rule off the South Mall, and a seed matching nothing is reported loudly.

**AND THE FILE WAS NEVER IDEMPOTENT, which its own docstring has claimed since
it was written.** Two consecutive no-op runs measured **41,964 -> 41,487 ->
41,158** features with nothing dropped. Three leaks, all in the merge:

- *"the widest ring is the crown's true extent"* is false for every species
  whose profile peaks below 1.0. A cedar's widest **tier** is 0.881 of its
  source ring, so every cedar and cypress on campus lost **12% per run** until
  it fell under a `TIERS_BY_RADIUS` threshold and shed a tier. The source radius
  is carried as `r0` now and restored exactly; 5,373 crowns were rescaled by
  more than 2%, recovering the one committed run's worth of shrink (`b719fb9`
  is the only profile-tiering run in the history, which is how much to undo).
- a tier carries `TIER_TWIST_DEG * i` of rotation and the merge never undid it,
  so a crown rotated a little further every run and **never reached a fixed
  point** — which is why one tree per run kept wandering across a kerb line.
- grouping on a centroid rounded to 1e-6 splits a crown in two when it sits near
  a cell boundary, and each half grew its own head. The key is claimed over its
  3x3 neighbourhood: ±0.11 m, far under the gap between two real trees.

Runs 4-7 are now exact no-ops: 39,580 features, 0 dropped, every time.

**Three things that did not work, and they generalise**

1. **Reporting per FEATURE rather than per tree.** A five-tier crown plus its
   trunk charges its surface six times. The first draft reported 1,320 trees in
   a carriageway when 737 was the truth — a 79% overcount that would have been
   written into a commit message as fact.
2. **Reprojecting a polygon by its exterior ring only.** A `footway` union is a
   loop AROUND a block; drop its holes and an 80 m city block becomes solid
   pavement. That probe reported 2,446 hits against the real 745.
3. **Buffering in degrees.** 1e-6 deg is 0.096 m east-west and 0.111 m
   north-south here, and every margin in this pass is smaller than that
   difference. The whole test runs in metres.

**A working-tree hazard worth writing down:** two sessions shared this checkout,
and one of them ran `git checkout main` + `reset --hard` mid-pass. For several
minutes `git status` reported a clean tree and `grep` found none of this work.
**Commit as soon as an edit is coherent, not when the pass is finished** — an
uncommitted edit in a shared checkout is one other session's reset away from
gone, and nothing warns you.

**Pictures, taken after the archive rebuild with tiles ON, not `?tiles=0`:**
`shots/treesurf/southmall-before-after.png` (the South Mall panel is open grass
again and the George Washington statue is no longer behind a tree) and
`shots/treesurf/road-before-after.png`.

## 31. Aug 2 2026 — the landmarks were the wrong SIZE, and no recipe could have fixed it (acer lane)

**Branch:** `acer/art-accurate-size`. QUEUE A8 and A9, the item he was most
annoyed about: *"make monochrome for austin look better not like a silver tree.
clock not looks like a fireplace and not big enough. I don't even want to check
out the other landmarks PLEASE make them accurate to size and architecture."*

**He put size first and the reason is one line of data.** Every recipe in
`bake_art.py` scaled off `hw`, `hd` and `H` handed in from `props.geojson`, and
those three numbers carry no information about the artwork. Print them and it is
obvious: **every `at=statue` is 4.2 m on a 1.83 m footprint, every
`at=sculpture` is 5.5 m on 3.17 m, every `at=installation` is 7.0 m on 4.81 m.**
Class defaults on a buffered OSM node — the same three numbers for the armadillo
and for the largest sculpture on campus. So no amount of care inside a recipe
could have produced a correct size, and ten hand-tuned multipliers would have
been ten guesses at the same missing fact. The fix is one `DIMS` table consulted
before any recipe runs, with the source written next to each entry.

```
Monochrome for Austin   7.0 m -> 15.24 m   46% of height   50x52x41 ft, Landmarks UT
Clock Knot              5.5 m -> 12.65 m   43% of height   498x260x420 in
Circle with Towers      3.2 m ring -> 7.82 m, towers 5.5 -> 4.27 m
The West                4.5 m -> 1.52 m    two 5 ft spheres, Met Museum
Austin (Kelly)          18.3 x 8.2 -> 18.29 x 22.25 cruciform
Mustangs                3.2 -> 11.0 m long, three horses -> seven
Sea Turtle              4.2 m -> 1.00 m    a bronze animal is animal-sized
```

**Size was only half of Monochrome.** The old recipe put fourteen slabs on ONE
origin at even angles, and a single origin plus even angles is a daisy on a
post, which is a tree — his word, and the right one. It is now 32 hulls sampled
through a cloud whose centre is **not** the mast, five placed outriggers, and a
back-stay that exists only on the light side. Before and after at identical
framing: `shots/art/before/Monochrome_for_Austin.png` against
`shots/art/sheet-after-crops/Monochrome_for_Austin.png`.

**Clock Knot's shape came out of the published description, not a glance at a
photo.** Landmarks describes crossed I-beams, a circular knotted centre, and a
beam that reads as vertical until you move and it turns out to be *one leg of an
inverted V*. That clause is the whole silhouette. Three even legs under a
horizontal top member on a slab the width of the footprint is a mantel over a
hearth on a hearthstone, which is what he saw.

**A9, and the answer is that two of the three windows were on the wrong wall.**
Kelly's motifs are the colour grid (a 3×3 lattice of squares), tumbling squares
(the same squares rotated around a circle) and the starburst (those squares
elongated into narrow streaks), on the **south, east and west** in that order.
The bake had six tall spectrum lights on the east — a window this building does
not have — and the ring of squares on the west, where the streaks belong.
**3×3 + 12 + 12 = 33, and 33 is the published count of mouth-blown Franz Mayer
windows.** A reading that lands on the total is the check; one that does not is
wrong.

**And the massing is a CROSS, which is derived rather than guessed.** 60 × 73 ft
as a rectangle is 4,380 sq ft against a published 2,715. The same overall size
with 7.72 m arms is 2,733 sq ft — within 0.7%. So the arm width is solved for,
not chosen, and a cross plan is exactly what produces the **double** barrel
vault the building is known for. The old bake drew one vault over one box,
having read the 26 ft 4 in **height** as a depth.

### The bug this turned up, which is the reusable part

`art_lonestar` made fifteen calls and most of them emitted nothing: five beams
from a point to itself, five boxes from `z` to the same `z`, and of five star
arms only the two with a positive vertical component survived — `beam()` spreads
`z0..z1` across its steps and `add()` drops anything under 2 cm tall. **Three of
a five-pointed star's five points were never in the file, and nothing said so.**
Same trap as the plant pipe run in §51, and invisible in a screenshot because
what is left still looks like a shape.

So `main()` now **re-measures the file it just wrote** against `DIMS` and exits
non-zero on a disagreement. It caught two while this was being written — Diana
at 5.36 m against a 4.40 m table, Sea Turtle spanning 2.19 m against 1.60.

### `scripts/verify/art-sheet.mjs` — the instrument, built first

Every authored piece photographed at ONE ground scale, laid out in a grid with
its measured size beside the published one, red-bordered where they disagree.
The point is that a 15 m Rubins and a 1 m turtle have to *look* 15 m and 1 m in
the same grid or the sheet is decoration.

**Two things that did not work and cost the time:**

- **A 40 s per-pose wait for every `austin-*` source to report loaded.** At zoom
  20 they never all do, so 34 poses × 40 s hit the watchdog with **no output at
  all** — twice. Only the artwork's own source is worth waiting for, and it is
  plain GeoJSON loaded in full before the first tile.
- **Crops in a temp dir.** A full pass is 34 camera moves and on a machine with
  three other agents' browsers on it those ran ~37 s each; when the watchdog
  fired it took twelve perfectly good before-frames with it. They are written
  next to the sheet now, so a killed run still leaves evidence.

Also worth knowing: **sampling 32 hulls from an ellipsoid never reaches the
ellipsoid's own envelope** — measured 12.85 m across against a published 15.85 —
which is why Monochrome's five outriggers are placed rather than sampled.

`data/art.geojson` 383 → 623 parts, 115.6 → 179.3 KB. The Hal C. Weaver plant
parts (PR #67) are untouched.

**Note for the next reader:** `QUEUE.md` points at "HANDOFF items 31–57" for
last night's lessons. **Those entries are not in this file** — it runs 30, 29,
28 … 23, then 13. Either they were never written or they were lost; the numbered
references inside QUEUE (§44, §48, §50, §51) therefore resolve to nothing. This
entry takes 31 because 31 was free.

## 30. Aug 2 2026 — the baked bucket had to stop being called `wp` (mac lane)

**Branch:** `mac/outer-bucket-inert`. A correction to §28, found within the hour
and worth the entry because of HOW it surfaced.

§28 stamped each downtown tower's facade bucket as `wp = "tb03"`. **`wp` is read
by the renderer.** `FACADE_PATTERN_EXPR` is `['coalesce', ['get','wp'], 'mh00']`,
so a baked `wp` resolves to an atlas image named `tb03` — which nothing
registers — and **MapLibre paints an unknown pattern transparent.** Every
downtown tower would have become a hole the moment a tile build ran.

And it did run. `austin-data-bot` rebuilt `outer.pmtiles` from the stamped
GeoJSON within the hour of the merge (`5a723ca`, 1,632,761 → 1,635,313 bytes) —
which is how this was noticed at all, while tidying merged branches. **The
archive on `main` was still the old one, so nothing shipped**, but the next
scheduled build would have.

Second problem in the same naming: `parseId` splits an id as
`fam=slice(0,2), idx=parseInt(slice(2))`, so `"tb03"` would have retinted
through family `"tb"` at palette index 3 — a campus colour and a family with no
tile generator — every time the hour changed.

**The fix is the ordinal under its own inert property:** `fb: 5`, an integer
nothing reads. The browser side, when it lands, maps that ordinal to whatever
palette index it allocates at boot. Keeping the two separate is the actual
design: **the ordinal belongs to the data, the id belongs to the session.**
`outer_ring.geojson` is 1,710 bytes *smaller* than the `wp` version. Parity
still PASSes.

**The lesson, which is the reusable part:** a baked property that shares a name
with a rendered one is not inert, however carefully the PR says "nothing renders
differently yet". I wrote that sentence in §28 and it was wrong. Check what
reads the name before you write it.

## 29. Aug 2 2026 — roofs stopped turning into windows at altitude (mac lane)

**Branch:** `mac/lod-roof-caps` — MAC_QUEUE M4's bug half. *"when i go up on
low detail mode the roofs of houses become windows this is pretty bad."*

The Acer diagnosed this and handed it over; the diagnosis was right and this
pass confirmed it **with a picture before changing anything**.
`TIERS.mid` in `js/lod.js` listed `buildings-roof`, `parts-roof` and
`outer-tower-roof` next to genuine detail layers. Those three are not detail —
they are the CAP over the top face of every building extrusion, and the walls
beneath carry `fill-extrusion-pattern`, which MapLibre paints on the TOP face as
well as the sides. Hide the cap and every roof in the city becomes the window
grid off its own walls. Photographed at detail 350 from 1,127 m:
`shots/lod/roof-caps.png`.

**The cost question, which the Acer flagged rather than assumed.** `lod-perf.mjs`
reads `window.LOD_TIERS` at runtime, so re-running it after the change measures
the NEW tier. Three interleaved, counterbalanced reps, dropped frames not means:

```
baseline           dropped 136   fps 30.8
tier1-off          dropped 134   fps 30.7   NO RESULT — spreads overlap
tier1+2-off        dropped  99   fps 40.1   +9.3 fps, separated
renderScale-0.75   dropped 138   fps 30.7   NO RESULT — spreads overlap
```

**The mid tier still delivers its entire win without the three cap layers.**
That does not prove the caps are free — it is not the same-run A/B that would —
but it does settle the question that mattered: there is no performance case for
keeping a visible bug. Note again that renderScale 0.75, which HANDOFF §20.1
calls the master lever, cannot be separated from baseline here.

Also worth keeping: dropping roofs was the wrong choice on its own terms. From
altitude, roofs are most of what you are looking at.

## 28. Aug 2 2026 — downtown's curtain wall, ported into the bake and proved (mac lane)

**Branch:** `mac/outer-facade-bake` — MAC_QUEUE M2 step 1, the parity half.

**The live symptom:** `shots/tour/day-downtown-skyline.png` is a field of
identical brick-red boxes. When the outer ring moved onto vector tiles, downtown
lost its curtain wall in the same commit — `quantiseOuterFacades` clusters the
towers' baked wall colours in the BROWSER and writes `wp` at runtime, a vector
tile cannot be mutated, so every tower falls through
`['coalesce', ['get','wp'], 'mh00']` to one pattern.

**What made it portable, and it is one sentence:** the tower assignment depends
only on the TOWERS' own colours. `clusterColours` runs over
`towers.map(f => f.wd)` and nothing else. Only the resulting bucket's *index*
depends on the browser, because tower buckets are appended after the campus
palette. So `scripts/bake_outer_facades.py` computes the partition offline and
names buckets `tb00..tb09` — an ordinal that is a property of the tower data
alone and cannot drift when the campus palette changes size.

**Proved against the real function, not against a re-reading of it.**
`outer-facade-parity.mjs` runs `window.quantiseOuterFacades` on the real data in
a real browser and dumps what it decided; `outer_facade_parity.py` checks a
**bijection both ways** between the two labellings plus the group centroids.
Both directions matters: a one-way check passes happily when Python collapses
ten buckets into three.

```
towers 114   python buckets 10   browser buckets 10
sizes  tb00=13 tb01=9 tb02=7 tb03=16 tb04=12 tb05=11 tb06=17 tb07=3 tb08=11 tb09=15
map    tb00->tg39 … tb09->tg48
PASS — the bake partitions the towers exactly as the browser does
```

**Cost:** `outer_ring.geojson` 2,719,131 → 2,721,639 bytes, **+2,508 bytes**
(+0.09%) for 114 towers' worth of `wp`/`wf`, plus a 1 KB
`data/outer_tower_palette.json`. Idempotent — a second run reports `changed: 0`.

**Deliberately NOT in this PR, and this is the thing to pick up next:** the
browser side (register one atlas tile per `tb` ordinal at boot, read `wp` off
the tile) and the re-tile that puts `wp` into `outer.pmtiles`. They have to land
together or the change is inert, and inert code that looks done is how this
regressed the first time. **Nothing renders differently yet.**

**And the half that is genuinely blocked:** the other 7,511 low-rise ring
features snap to the CAMPUS palette, which `js/facades.js` derives in the
browser from the campus buildings snapshot. Baking their `wp` needs that
derivation ported too. They fall back to `mh00` on the tile path and did so
before this change as well — this is the tower half, and it is the half you can
see.

## 27. Aug 2 2026 — DKR's night colour was not the defect. The ruler was. (mac lane)

**Branch:** `mac/dkr-night` — MAC_QUEUE M1c. **No stadium data or colour was
changed, and that is the finding.** Three claims put this item on the list and
all three are wrong; each took one measurement to overturn.

**1. "`night-pale.mjs` puts `stadium-*` at 16% of the wrongly-bright pixels."**
That script counted the wrong two-thirds of the frame. `gl.readPixels` returns
rows **bottom-up** — row 0 of the buffer is the BOTTOM of the screen — and the
loop skipped the first third of the buffer under a comment reading *"Skip the
top third: that is sky and horizon glow"*. It was skipping the **foreground**
and counting all of the sky. Proof is `shots/readpixels-unflipped.png`: the
buffer written straight out as PNG rows puts the sky at the bottom. Corrected,
the whole night frame has **957 pale pixels, not 1,381**, and `stadium-*` is
**10.7%, not 44.5%**.

**2. "The largest contributor is `stadium-detail`."** True and misleading. A
layer id is not a material: that one pass carries the aisles, the video board,
the ramp towers, the new arcade and the floodlight masts. Hiding one `kind` at a
time:

```
  hide mast     pale removed   154
  hide board    pale removed     0
  hide logo/ramp/aisle/pier/lintel/gate/canopy   0
```

**Every pale pixel is the lamp arrays**, which the bake sets deliberately:
*"an unlit floodlight over a stadium is a thing nobody has ever seen."* Stopping
at the layer name would have had somebody darkening a stadium that was right.
The by-kind pass is now part of `night-pale.mjs` so the next person gets the
cause and not just a name.

**3. "`data/stadium.geojson` has 499 of 511 features with no night colour at
all."** Counted today: of 643 features, **every one carries a night colour**
except the 44 seat bands, and those do not need a property — `seatColourAt()`
builds a `match` on `['get','s']` whose `SEAT_COL` trios are explicitly burnt
orange after dark, which is the 2023-24 LED upgrade the file documents.

**And the thread the queue said to pull:** *"`js/stadium.js` never builds a
time-of-day wrapper at all."* **There is no `js/stadium.js`.** The stadium is in
`js/app.js`, its retint is `window.applyStadiumColors`, and it is installed —
called directly from `js/timeofday.js:400`. The wrapper audit that generated
that line only looked for the `const wrapped = …` shape, so a pass wired the
other legitimate way reads as missing.

**Unrelated finding, not fixed here:** `_harness.html` is missing
`js/tiles.js`. `window.tileSource` is therefore undefined in the harness and
trees, roads, roof detail, props and the outer ring all silently fall back to
their GeoJSON. Every pixel test renders a scene the site does not serve. Same
class as the `js/outer.js` gap in §24, and it needs its own pass because adding
it moves baselines. It does **not** affect anything above: `stadium.geojson` is
fetched directly and is not tiled.

## 26. Aug 2 2026 — DKR got a ground floor (mac lane)

**Branch:** `mac/dkr-arcade` — MAC_QUEUE M1b. *"want the entrance, and the shops,
accurate pillars and whatnot."*

The bowl above had been worked on for two passes. The problem was never the
bowl: from the street DKR was **one flat extrusion wearing a facade tile** from
grade to rim, and a facade pattern cannot make a colonnade — it has no vertical
anchor and no idea where the wall's ends are, so it paints piers that march
through the corners and past the gates.

So the ground floor is geometry now, in `scripts/bake_stadium.py`'s new
`arcade()`: **108 piers, 8 gate pylons, 4 gates with canopies, 4 glazed
shopfront bands and 4 lintels**, built off arc length along each wall run so a
run that bends round a corner gets piers that follow the bend. The plinth wall
itself is **set back behind them** — that reveal is the whole effect. Everything
rides `stadium-detail`, which already interpolates a per-feature day/golden/
night trio, so no new layer and no new colour path.

**The number that mattered was the DEPTH, and only measurement found it.** The
first cut was 2.0 m piers standing 2.2 m proud of the 9.45 m plinth. At street
level it was perfect. At the oblique 200 m the app actually flies at, a
diagnostic render — every arcade kind painted its own screaming hue, then
counted — came back **0 pier pixels on two of the four sides**, against 12,061
on the west. The arcade was 71 px of a 470 px wall and the plaza grade and the
facade's own vertical ribbing ate it. Widening the piers would not have helped:
**it is the shadow in the reveal that reads at distance.** Reveal 2.2 → 3.4 m
and the plinth 0.15 → 0.19 of the wall (9.45 → 12.0 m, which is also closer to
what the 2008 north-end photograph shows), and it reads from every side.

**Two hours went into believing a render before checking the layer's own
visibility.** Three separate probes said "no piers" and the cause was
`js/lod.js` hiding `stadium-detail` above 315 m on the default preset — correct
behaviour, invisible in a screenshot. `getLayoutProperty(id, 'visibility')` is
one line and should have been the FIRST thing printed, not the fourth. The
probe prints it now.

**Also here: the midfield Longhorn is back, as geometry.** M1a traded it away
with the raster. It is flattened out of Simeon's own SVG path by
`SVGPathElement.getPointAtLength` — the browser's own flattener, exact, a dozen
lines, and it cannot disagree with the path the way a hand-rolled bezier
subdivider can. The path is one closed contour of `c` segments (checked).
**The end-zone wordmarks are NOT coming back and this is the reason:** from the
nadir the end zone is ~30 px wide, so a rect-font letter stroke lands at 0.7 px
and reads as noise rather than as TEXAS. That is a measurement, not a
preference — if it is ever wanted, it needs a different idea, not a font.

**Not regressed:** `field-bleed.mjs` still 18/18 with the arcade in.

## 25. Aug 2 2026 — the DKR field stopped bleeding through the walls (mac lane)

**Branch:** `mac/dkr-field-depth` — MAC_QUEUE M1a.

The report — *"bug where field is visible through north wall still there"* — had
been closed twice and come back twice, because every fix worked on the symptom.
The premise underneath them, written in `js/app.js`, was:

> A raster on the ground plane is ordinary ground: the walls are drawn after it
> and paint over it exactly as they do over the streets.

**That is false, and measuring it is what ended the bug.** `stadium-field` sat at
style index **145** and `stadium-wall` at **146** — the wall genuinely is drawn
after it — and the turf still painted on the outside face of the north wall. A
`raster` layer does not share the depth buffer the 3D pass writes, so its
position in the stack buys nothing. Symbols had already failed identically; the
file even says so about the same layer, one paragraph up.

**The experiment that decided it**, before writing any fix: three candidate
layers over the *identical* quad — the raster, a `fill`, and a `fill-extrusion`
0.3 m tall — photographed from outside the north wall and from over the rim.
The fill-extrusion was invisible from outside and correctly cut by the near rim
from above. So the field is now geometry, ~40 thin slabs (turf, mow bands, end
zones, sideline border, yard and goal lines) built at runtime from the four
baked `fieldCorners`, and **the camera gate is deleted** — `FIELD_VIS`,
`watchFieldVisibility`, and `scripts/verify/fieldprobe.mjs`, whose only subject
was the gate's opacity.

**`scripts/verify/field-bleed.mjs`** is the durable part: it toggles the layer
and calls the CHANGED PIXELS the field, so it cannot be fooled by anything else
in the frame being green. **18 of 18 poses pass, day and night** — six outside
poses at 0 px each (north was 3,318), and the three look-in poses still drawing
4,187 / 8,527 / 11,129, which is the half that a "fix" that simply never draws
the field would fail.

**Three things worth keeping from getting there:**

- **Two frames are not enough to diff a live scene.** A plain on/off diff
  reported 5,694 "field" pixels in the bottom corner of a frame where the field
  is not visible, at a mean rgb of 155,132,102 — pavement. Clouds and canopy
  keep moving. The fix is three frames: on, off, on, and count only pixels that
  changed with the toggle *and* agree across both on-frames.
- **The expectation table was wrong before the code was.** Pitch 62 was listed
  as a bleed case. The sight line from 398 m at pitch 62 clears the 63 m rim by
  9 m — you are looking into the bowl and the turf is genuinely visible. The
  arithmetic is now in the file for all three pitches.
- **A 0.20 m yard line does not survive to the screen.** At the nadir the field
  renders at 1.7 px/m, so it covers a third of a pixel and the lines came out as
  broken dashes. The raster never had this problem because mipmapping averages
  sub-pixel paint into a tint. Widened to 0.55 m and toned down to compensate;
  both are taste knobs.

**What this cost, and it is visible:** the yard numbers, the TEXAS / LONGHORNS
end-zone wordmarks and the midfield Longhorn are gone — canvas text and an SVG
path, neither of which survives to polygons without a path flattener. The
before/after is in `shots/dkr/field-detail-traded.png`. **Restoring the
wordmarks and the Longhorn as geometry belongs to M1b**, which is rebuilding the
stadium anyway. A blocky rect font was considered and rejected here: the end
zone is ~30 px wide from the nadir, so each stroke would land at 0.7 px and read
as noise rather than as letters.

**Do not reintroduce a raster or a symbol for the field.** Every version of that
bleeds, and the bleed is the thing he keeps reporting.

## 24. Aug 1 2026 — the verification suite was dead and said nothing (mac lane)

**Branch:** `mac/verify-suite-repair`

Fourteen scripts in `scripts/verify/` threw before doing any work. Commit
`90ad9d7` routed all ~110 scripts through `chrome.mjs`'s new `launch()` helper
and, in fourteen of them, deleted the surrounding statements along with the old
launch lines. `page is not defined` was only the first name each file happened to
reach; `bright`, `probe`, `caps`, `info`, `wiring`, `window.__settle` and
`window.__reset` were gone too.

**The count is 14 of 111, not 15 of 187**, and `node_modules` was NOT empty on
the Mac — `playwright-core` was installed, so the Acer's `npm ci` finding
explains none of these failures.

**Four repair attempts, each wrong in a way worth keeping:**

1. Greedy line copy — duplicated declarations; 11 of 14 stopped parsing.
2. Narrow line rules — restored `page` only. The files then failed on `bright`,
   `probe`, `caps`, and on helpers installed inside `page.evaluate` BLOCKS. **A
   line rule cannot see a block.**
3. Statement restore in the old file's order — parsed, passed the new lint, and
   exited **0** while every script died at `browser.newPage: browser has been
   closed`. Statements the current file had GAINED (`launch()`, `__done()`) were
   placed after the imports, closing the browser before the page opened. **A
   green exit code is not evidence a test ran.**
4. LCS alignment (kept) — current order wins, only genuinely deleted statements
   are re-inserted, and the statements `90ad9d7` deliberately replaced are never
   restored. One ordering bug remained: `const browser` landed below its first
   use, a temporal-dead-zone error `node --check` cannot see.

**`scripts/verify/suite-lint.mjs` is the guard, and it is the durable part.** No
browser, under a second, four blocking rules: uses `page` without creating one;
bypasses `launch()` (losing the watchdog and the reaper); never closes its
browser; uses a binding before declaring it. Rules 3 and 4 exist because the
repair itself tripped them — rule 4 catches statically what cost twelve minutes
of browser runs to discover.

**After the repair, running the real thing:** collision 8/8, motion-feel 19/19,
light-tone 12/12, graphics 26/27, arts-check 27/28, movement 12/14, plus
live-check, motion-caps, night-dusk-truth, roofz and westcampus-isolate
reporting normally. Nothing orphaned — `reap.mjs` clean after every run.

**Two findings the repair surfaced, neither fixed here:**

- **`js/outer.js` is in `index.html` and missing from `_harness.html`.** Every
  pixel test renders a city without the outer ring while the site serves one with
  it. Adding it moves every visual baseline, so it needs its own pass.
- **`movement.mjs` fails "Q and E move altitude in opposite directions" on
  `main`** — `Q: 161->161m`, ascend does nothing. Suspected to be the `#30`
  `PITCH_REACH` regression that `#31` reverts; being tested against that branch.
  Its other failure, `diagonal/cardinal = NaN`, is the script's own
  too-few-ticks guard firing under load, not a product defect.


> **Purpose:** This document brings a new AI collaborator (Fable 5) fully up to
> speed on the Austin 3D Explorer project — the vision, what was promised, the
> full journey (including the messy parts), the user's feedback and how it was
> handled, every bug fixed, the current state, and what's next. Read it top to
> bottom before touching anything.

---

## ★ FOR FABLE 5 — your environment, mandate, and first steps

**Read this first.** You are a different setup from the previous agent, and that
changes almost everything.

- **You run on the user's actual desktop computer**, with access to his local
  **projects folder**. The previous agent ran in a locked cloud sandbox that
  **could not open the live site in a browser** — that single limitation caused
  most of the pain in this project (guess-and-ship instead of verify). **You do
  not have that limitation.** Use it.
- **First steps:**
  1. **Read the existing `CLAUDE.md` in the projects folder** (the user keeps one)
     — follow whatever conventions/instructions it sets.
  2. **Create a dedicated folder for this project** inside the projects folder and
     work there (clone `SimeonVarg/austin-3d-explorer` into it).
  3. **Establish your own way to verify what the user actually sees — this is your
     responsibility, not something spelled out for you here.** You're on a real
     desktop: you can open the live URL, run a real browser, use dev tools,
     screenshot, run whatever local server or headless setup you like. Figure out
     a reliable loop and use it *before* claiming any fix works. (See §8 for how
     the previous agent worked around not having this — you can do better.)
- **You have full freedom.** Change the **tech stack, architecture, libraries,
  dependencies, tools, hosting — anything** — if it makes the project better or
  easier to verify. Nothing here is sacred. The MapLibre 4.7.1 / PMTiles / Vercel
  choices were pragmatic, not principled, and they caused real problems (see §7,
  §9). If upgrading MapLibre to v5, switching renderers (e.g. three.js/deck.gl),
  changing hosting, or restructuring the app gets to a **beautiful, accurate,
  flyable West Campus faster — do it.** The more you own end-to-end, the better.
- **The goal is the look and feel**, which the debugging churn kept us from. Get
  the engine confirmed working, then spend your energy making it *beautiful*. 

---

## 0. Who's who / how this project is built

- **The user (Simeon)** is building this **entirely from a phone** using the
  **Kiro iOS app** + GitHub. He does not sit at a desktop for this. Explanations
  should be plain and jargon-light; he has repeatedly (and reasonably) asked to
  "dumb it down."
- **Kiro** is an on-device AI coding agent (iOS). It writes the front-end code
  but is **network-locked** — it *cannot* fetch docs, npm packages, CDNs, or test
  anything live. So it's blind to library-version quirks and can't verify. It's
  good for small, self-contained edits driven from the phone.
- **The AI agent (me / now you, Fable 5)** runs in a cloud dev sandbox with the
  repo, shell, and a headless browser. Used for: debugging, anything needing
  knowledge of library behavior, real-world data, research, and **verification**.
  Pushes directly to `main`.
- **Division of labor that we landed on:** agent does debugging/data/research/
  verification; Kiro does small phone-friendly UI tweaks. **Kiro must `git pull`
  `main` before it edits**, or it will clobber agent commits.

---

## 1. The vision (what the user wants)

A **browser-based, flyable, low-poly but geographically accurate 3D recreation of
the UT Austin area** — UT campus, West Campus ("Wampus" = West Campus slang), The
Drag (Guadalupe St), Speedway. Shareable by link, works on mobile.

What he explicitly cares about, in his words:
- **"A beautiful low poly scene with accurate colors and designs on buildings."**
  Not a gray CAD model, not a Google-Maps-looking street map.
- **Accurate** building placement, heights, and shapes.
- **Signs / logos / text on real buildings** — flying down West Campus and seeing
  "Dobie Twenty21," "The Castilian," etc. at the right spots.
- A **day→night slider** (his idea, combining three looks into one axis): drag
  from daytime → golden hour → night, and as it gets dark the **signs glow**.
- It must work on his **phone** with touch controls.

What this is NOT: not a game engine, not photorealistic, not a native app, not
dependent on paid APIs, not manually 3D-modeled (everything is data-driven), and
not a live-updating map (data is baked into dated snapshots).

---

## 2. What you're looking at RIGHT NOW (current state)

- **Live URL:** https://flyover-utx.vercel.app (Vercel, custom-ish domain).
  Also deployed to GitHub Pages at some point, but Pages was flaky (see §9).
- **Deployment is Vercel via GitHub git integration.** Historically the user has
  sometimes had to manually "Create Deployment"; confirm it auto-deploys on push
  to `main`.
- **A temporary on-screen diagnostics readout** is in the **top-left corner**:
  `loaded:<n>  view:<n>  src:<true/false>  z:<zoom>  err:<count>`. This was added
  so the user can screenshot the app's runtime state (the agent can't load the
  live URL — see §8). **`loaded:` is the real signal** (features in loaded tiles,
  camera-independent); `view:` is queryRenderedFeatures which is view-dependent
  and jumps around for 3D — informational only. **Remove this diag once the user
  confirms buildings render** (`loaded:` ~1482).
- **As of the latest work:** a stack of real bugs was fixed (see §7). The final
  and most stubborn one — buildings appearing only far away / "loading then
  disappearing" — was traced to **Vercel breaking PMTiles byte-range requests**
  and fixed by loading the whole tile file into memory. This was **verified in a
  harness that runs the real app code**: `loaded:1482, view:760, err:0`, dense
  city renders (see `scratchpad` note in §8). **The user was asked to redeploy
  and confirm `loaded:` shows ~1482.** If Fable 5 is picking up here, first thing:
  find out whether that redeploy confirmed the fix.

---

## 3. What was promised vs. delivered (honest ledger)

| Promised | Status |
|---|---|
| Accurate footprints + LiDAR heights | ✅ Delivered. 2,443 buildings, 92% real Overture/LiDAR heights. |
| Every building as a 3D volume at the right spot | ✅ Delivered (data + `fill-extrusion`). |
| Flythrough navigation (desktop + mobile) | ✅ Delivered; had major bugs, now fixed (movement speed, joystick visibility, pinch-zoom). |
| Curated branded signs (names + brand colors) | ✅ Data built: 48 landmarks in `data/signs.json`. Rendering wired; needs live visual confirmation + tuning. |
| Day→night slider with sign glow | ✅ Built (`js/timeofday.js`): day→golden→night keyframes, sign glow ramps up at night, auto-cycle play button. Needs live visual confirmation + palette tuning. |
| Stylized low-poly look (not "Google Maps") | 🟡 Basemap-clutter stripping is built (`cleanupBasemap`), warm palette exists. **Not yet visually confirmed/tuned on the live site** — this is the "fun part" still owed. |
| Terrain / slope (West Campus → Waller Creek) | ⏸️ Built then **disabled** — terrain caused buildings to be culled/float. Deprioritized by the user ("idc about the slope rn"). Revisit later with a draped, non-exaggerated approach. |
| Versioning: date-switcher + "what changed" animation | 🟡 Data foundation done (snapshots + diffs + `manifest.json`); front-end date-switcher/diff-tour code exists (`js/date-switcher.js`, `js/diff-tour.js`) but only one snapshot exists so the picker stays hidden. |

**Bottom line for the user's core ask (a beautiful, accurate, flyable West
Campus with glowing signs):** the *engine and data* are done and (finally)
rendering; the *art/tuning pass* — making it actually look beautiful — has not
really started because rendering bugs ate the time. That's the next chapter.

---

## 4. Tech stack & architecture

- **MapLibre GL JS 4.7.1** (loaded from unpkg CDN in `index.html`) — WebGL map,
  3D `fill-extrusion` buildings, camera. **Version matters** (see the v5-only
  property bug in §7).
- **PMTiles 3.2.1** (unpkg) — single-file vector tile archive of the buildings.
- **OpenFreeMap "liberty"** style (`https://tiles.openfreemap.org/styles/liberty`)
  — the base street map + **glyphs/fonts** (fonts matter — see §7 glyph note).
  Most of its layers are stripped at runtime by `cleanupBasemap`.
- **Three.js** — mentioned in the plan for custom sign/logo billboards but **not
  actually used yet**; signs are currently MapLibre `symbol` layers.
- **Hosting:** Vercel (primary), GitHub Pages (set up, flaky).
- **No build step** — plain static HTML/CSS/JS. Deploys by serving repo root.

### Front-end files (`/`, `/js`)
- `index.html` — loads libs, defines the DOM (map, HUD, joystick, time-of-day
  slider, date panel, diff banner, debug panel, **diag readout**), includes the
  js modules.
- `style.css` — all styling. Note: mobile detection is **width-based**
  (`max-width:1024px`), NOT `(hover/pointer)` media queries (that bug hid the
  joystick — see §7).
- `js/app.js` — **main entry**. Loads `data/manifest.json`, registers the PMTiles
  archive **into memory** (the Vercel fix), creates the map, adds building layers,
  wires everything, runs the diagnostics readout. Camera **SPAWN** is set here.
- `js/controls.js` — flythrough. Desktop: WASD/arrows/Q-E + drag-look. Mobile:
  left **joystick** to move, right-half **swipe** to look, two-finger **pinch**
  to zoom. Movement speed is zoom-scaled.
- `js/signs.js` — curated branded landmark signs from `data/signs.json`
  (`signs-glow` colored halo underlay + `signs-label` white text). Glow opacity
  is driven by the time-of-day value.
- `js/timeofday.js` — the day→night system. `cleanupBasemap(map)` strips the
  OpenFreeMap clutter; `applyTimeOfDay(map, p)` interpolates sky/light/building
  colors/ground/sign-glow between DAY(0)→GOLDEN(0.5)→NIGHT(1); slider + auto-cycle
  UI. (Note: `map.setSky` is a **no-op in v4.7.1** — sky gradient isn't actually
  applied at this MapLibre version; light + colors do apply.)
- `js/date-switcher.js` — snapshot date dropdown (hidden while only 1 snapshot).
- `js/diff-tour.js` — "what changed" fly-to-and-animate mode (future-facing).

### Data files (`/data`)
- `data/manifest.json` — `{ snapshots:[...], latest, diffs:[...] }`. The app reads
  `latest` and loads that snapshot. **Don't hardcode dates.**
- `data/snapshots/2026-07-10/austin.pmtiles` — the baked buildings (~0.6 MB,
  2,443 buildings). Also `.geojson` + `.enriched.geojson` alongside.
- `data/signs.json` — 48 curated landmark signs: `{ label, category
  (landmark|apartment|food), color (brand hex), height, priority }` with real
  coordinates pulled from the baked data.

### Data pipeline (`/scripts`, `/.github/workflows`)
- Runs **in a GitHub Action** (`.github/workflows/build-data.yml`) triggered from
  the phone (Actions → Run workflow). Steps: extract Overture buildings for the
  bbox (DuckDB) → enrich (height fallback chain + OSM names via Overpass + manual
  `hero_overrides.json`) → tile to PMTiles (tippecanoe) → diff vs previous
  snapshot → update manifest → commit back to the repo.
- `scripts/config.sh` — bbox (UT + West Campus + The Drag) + `OVERTURE_RELEASE`
  (auto-detects latest).
- Height accuracy: Overture LiDAR → OSM `height` → OSM `building:levels`×3.2 →
  Overture floors → class default. Each building tagged with `source_height`.
- Full rationale in `RESEARCH.md`; overall plan in `PLAN.md`.

---

## 5. The bounding box & spawn

- **Bbox:** `min_lon -97.752, min_lat 30.276, max_lon -97.726, max_lat 30.296`
  (UT core + West Campus + The Drag).
- **Spawn** (`SPAWN` in `app.js`): `center [-97.7434, 30.2857], zoom 16.5,
  pitch 60, bearing 90` — placed inside the West Campus tower cluster (Dobie,
  Castilian, Skyloft, Moontower, Ion nearby), looking east toward campus.

---

## 6. The journey — how we got here (chronological)

1. **Planning review.** The repo started as just `PLAN.md`. The agent researched
   and added `RESEARCH.md` (accuracy strategy: Overture LiDAR heights over OSM
   levels; pre-baked dated snapshots; no manual modeling; terrain; tightened
   scope) and a **phone-triggerable GitHub Action data pipeline**.
2. **User feedback:** wanted *no live updates* (baked snapshots + a future
   date-switch/before-after animation) and *no manual 3D modeling* (data-driven
   only). The plan + pipeline were reworked to match (dated snapshots, diffs,
   `manifest.json`; `hero_overrides.json` as plain-data corrections).
3. **Ran the pipeline.** Several Action failures, each fixed (Overture release
   auto-detect, DuckDB geometry type, first-run commit path). Result: **2,443
   buildings, 92% real LiDAR heights** — a strong, accurate dataset.
4. **Kiro built Phase 1** (the flythrough app) in a PR; agent merged it to `main`
   after confirming it carried the real data. (Repo default branch was
   `add-plan`; work now lives on `main`.)
5. **Deploy struggles:** GitHub Pages env protection, then Vercel. Got a live URL.
6. **Visual reality check.** The user pointed out it looked like a "Google Maps
   preview," not the promised beautiful low-poly scene, and that signs/logos were
   missing. Agent explained the gap honestly (the art layer wasn't built) and
   proposed the **one day→night slider** concept; user chose "do all of it."
7. **Styling + signs built** (`timeofday.js`, `signs.js`, `cleanupBasemap`, 48
   curated signs). **Then a long, painful debugging stretch** on rendering bugs
   (see §7): buildings vanishing, only far buildings showing, movement dead on
   mobile, no joystick. Multiple fixes missed the mark before the root causes
   were nailed with a proper harness.
8. **The verification breakthrough** (see §8): the agent built a harness that runs
   the *real app code* locally and screenshots it, then reproduced Vercel's exact
   tile-serving failure and proved the fix. Buildings render (`loaded:1482`).

---

## 7. Every bug fixed (technical, with root causes)

1. **Overture release placeholder** — pipeline pointed at a non-existent release
   date. Fixed: auto-detect the latest release from the public bucket.
2. **DuckDB geometry type** — current Overture serves `GEOMETRY` (not WKB blob);
   `ST_GeomFromWKB` errored. Fixed: pass geometry straight through.
3. **First-run commit** — pipeline staged `data/diffs` which doesn't exist on the
   first run. Fixed: stage the whole `data` dir.
4. **Terrain source** — Kiro used `demotiles.maplibre.org` (a demo endpoint with
   **no Austin coverage**), so terrain silently did nothing. Switched to AWS
   Terrarium tiles. **Then terrain was disabled entirely** because terrain + sky +
   3D extrusions culled the buildings and made them float on slopes. Slope is
   deprioritized; revisit later.
5. **Buildings never rendered (the big one):** `buildings-3d` used
   `fill-extrusion-ambient-occlusion-intensity`/`-radius`, which are **MapLibre
   v5-only**. The app loads **v4.7.1**, where those are invalid, so `addLayer`
   rejected the whole layer — **our buildings never rendered at all**; the gray
   ones on screen were OpenFreeMap's own. Fixed: removed them, used
   `fill-extrusion-vertical-gradient`. (This is also why it looked like Google
   Maps — our palette was never on screen.)
6. **Mobile movement dead** — `MOVE_SPEED` was ~300× too fast (~13 km/s); any
   joystick nudge flung the camera into empty land. Fixed: sane, zoom-scaled speed.
   User asked to keep it slow-ish for now.
7. **No joystick on mobile** — joystick + mobile hint were gated on
   `@media (hover:none) and (pointer:coarse)`, which mis-detects iPhones
   (especially "Request Desktop Website"). Fixed: **width-based** media query,
   joystick visible by default.
8. **Pinch-to-zoom** added (two-finger), single-finger look suppressed while
   pinching.
9. **Basemap gray-building flash** — the basemap's own buildings flashed before
   being hidden. Fixed: run `cleanupBasemap` on `styledata` (before first paint).
10. **Vercel breaks PMTiles (the final root cause of "buildings only far away /
    load then disappear"):** Vercel serves the `.pmtiles` file **Brotli-compressed
    with no byte-range support** (`content-encoding: br`, no `accept-ranges`).
    PMTiles reads tiles via HTTP byte-ranges, so only coarse far tiles loaded and
    the source flapped. **Fixed: download the whole ~0.6 MB archive once and read
    tiles from an in-memory `FileSource`** — no range requests, host-agnostic.
    Proven: against a Vercel-mimicking server, range-based rendered 0 buildings,
    in-memory rendered 238; full app in harness = `loaded:1482, err:0`.
11. **Diagnostics readout** added (temporary) so the deployed app self-reports.
12. **[Fable 5, July 10] Buildings STILL didn't render live after #10 — missing
    fonts killed every tile.** Both sign layers requested the fontstack
    `Open Sans Semibold/Bold, Arial Unicode MS Bold`, which **does not exist on
    OpenFreeMap's glyph server** (404). When a glyph fetch 404s, MapLibre
    discards the ENTIRE vector tile that needed it — fill-extrusion buildings
    included — and marks the tile loaded-but-empty with **no error event**
    (`err:0`, `src:true`, `loaded:0`). The previous harness never caught this
    because it stubbed all glyph requests with empty-but-valid responses (§8's
    glyph gotcha) — the stub masked the live failure. Fixed: both layers use
    `Noto Sans Bold` (OpenFreeMap serves only Noto Sans Regular/Bold/Italic —
    any new text layer must stick to those). Verified against the real font
    server on a desktop browser: `loaded:1072 view:294 err:0`, buildings and
    branded signs render; live files confirmed byte-identical after deploy.

---

## 8. The verification tool (critical — read this)

**The agent's sandbox cannot load the live Vercel URL in a browser** — outbound
browser traffic is blocked by a restrictive proxy (`ERR_TUNNEL_CONNECTION_FAILED`),
and the Vercel deployment also has an auth wall. The agent *can* fetch file
contents (via the Vercel API tool) but cannot run the live page.

This caused real pain: several fixes were shipped on reasoning alone and missed.
The user (rightly) demanded a reliable verification method instead of guess-and-
ship.

**The solution — a local harness that runs the REAL app code and screenshots it:**
- A local static server serves the actual repo (`index.html`, `app.js`, all js,
  `data/`), optionally serving the `.pmtiles` under **Vercel's exact bad
  conditions** (Brotli + no range) to reproduce live behavior.
- **Playwright** (headless Chromium, already installed at
  `/opt/pw-browsers/chromium`, launch with `--use-gl=swiftshader
  --no-proxy-server`) loads the page and **intercepts external requests**:
  serves local vendored `maplibre-gl.js`/`pmtiles.js` for the unpkg CDN, returns a
  **stub basemap style** for OpenFreeMap, and returns empty-but-valid **glyphs**
  (fonts) so symbol layers don't error.
- **Route order gotcha:** Playwright applies the *most-recently-added* route
  first, so register broad `abort`s BEFORE specific `fulfill`s.
- **Glyph gotcha:** if fonts are blocked/aborted, MapLibre errors the *whole tile*
  (buildings included). Serve empty 200 glyphs, not abort. (This is what made an
  earlier harness look falsely broken.)
- It then reads the on-screen `#diag` text and takes a screenshot — so the agent
  verifies with its own eyes before shipping.

**Use this harness to verify every rendering change before pushing.** The scripts
were built in the session scratchpad (ephemeral); if it's gone, rebuild it from
this description — it's worth it. Pattern that proves buildings load:
`loaded:1482  view:700+  src:true  err:0`.

**Also:** the on-screen `#diag` readout lets the *user* verify on their real phone
by screenshotting it. Keep that loop until rendering is confirmed on the live site.

---

## 9. Deployment notes / gotchas

- **Repo:** `SimeonVarg/austin-3d-explorer`. Work is on **`main`**. (Original
  default was `add-plan`; a Phase-1 PR was merged into `main`. Make sure `main` is
  the GitHub default branch so Kiro/Vercel/Pages all agree.)
- **Vercel:** serves the app; **it Brotli-compresses `.pmtiles` and breaks ranges**
  — that's why the in-memory tile loading exists. Do NOT go back to range-based
  PMTiles loading on Vercel. If you ever host tiles elsewhere, a range-supporting
  host (GitHub Pages, jsDelivr, R2/S3) would also work, but in-memory is simplest.
- **GitHub Pages:** was enabled but returned 403 when checked; treat as unreliable
  unless re-verified.
- Redeploy after each push; confirm Vercel actually rebuilt (it has occasionally
  needed a manual "Create Deployment").

---

## 10. The user's feedback and how it was handled (READ THIS)

The user was patient but became (justifiably) frustrated. Honoring this section is
the difference between a good and bad collaboration going forward.

- **"Dumb it down."** Repeatedly asked for plain-English explanations. He is not a
  developer and works from a phone. **Explain simply, lead with what to do.**
- **Kiro can't debug.** When Kiro couldn't find bugs, we established Kiro is
  network-locked and blind to library behavior. **Route real debugging to the
  agent.** He asked directly whether to "just use Kiro for small changes" — yes.
- **"Wait 2 seconds" was a bad call.** The agent guessed the sparse buildings were
  "progressive loading" and told him to wait. He'd had it open for **minutes**.
  He called it out. **Lesson: don't rationalize a symptom to avoid admitting you
  can't see it. Own the gap.**
- **"You said you can verify — but you couldn't tell buildings still disappear."**
  He caught that the agent claimed verification ability while missing an obvious
  live bug. The honest answer: the harness at the time couldn't render the real
  basemap and the agent had under-prioritized a flash it had flagged. **Be
  precise about what you can and cannot verify.**
- **"You need a reliable verification tool. I'm not here to waste sessions on
  figuring out HOW to debug, let alone debugging."** This was the turning point.
  The agent stopped guessing and **built the real-code harness** (§8), then used
  it to find the actual root causes (v5 props, Vercel compression, glyph tile
  errors). **This is the standard now: reproduce and verify locally before
  shipping. No guess-and-ship.**
- He also noted, pointedly, that the agent itself had said *"you can't even do the
  fun part"* — i.e., all this debugging kept us from the actual goal (making it
  beautiful). **He wants to get to the styling/aesthetics.** Respect that; don't
  let infrastructure churn keep eating the sessions.

**How to work with him going forward:** verify with the harness + screenshot
before claiming a fix; explain plainly; be honest about limits; and push toward
the *look and feel*, which is what he actually cares about.

---

## 11. What's next — the fun part (finally)

Assuming the in-memory fix is confirmed on live (`loaded:` ~1482):

1. **Remove the temporary diagnostics readout** (`#diag` in `index.html`,
   `updateDiag`/`setInterval` + error capture in `app.js`, `#diag` CSS).
2. **Confirm and tune the look** using the harness screenshots:
   - The **day→night slider** (`timeofday.js`) — verify day/golden/night read
     well; tune the palette so it's genuinely "beautiful low-poly," not muddy.
     Note `setSky` is a no-op at v4.7.1, so the **sky gradient isn't actually
     rendering** — consider upgrading to MapLibre v5 (which also unlocks ambient
     occlusion for nicer shading) OR add a CSS/gradient sky behind the canvas.
   - **Signs** (`signs.json` + `signs.js`) — confirm the 48 landmark labels land
     on the right buildings and **glow at night**; tune sizes/colors; expand the
     list; consider real logos as billboard images later.
   - **Building color/variety and lighting** — make landmarks (burnt-orange
     accent) pop; add per-building variation so it's not monotone.
3. **Consider upgrading MapLibre to v5** — would enable real sky + ambient
   occlusion (nicer depth), but re-test everything in the harness first (v5 has
   API differences; that version mismatch already bit us once).
4. **Terrain, redone** (optional) — reintroduce the West Campus→Waller Creek slope
   with extrusions draped on terrain and no exaggeration, verified in the harness
   so it doesn't cull buildings again.
5. **Versioning UI** (later) — once a 2nd snapshot exists, surface the
   date-switcher and the "what changed" fly-through (`diff-tour.js`).

---

## 12. Quick reference

- **Live:** https://flyover-utx.vercel.app
- **Repo:** `SimeonVarg/austin-3d-explorer` (branch `main`)
- **Data:** 2,443 buildings, snapshot `2026-07-10`, 92% LiDAR heights; 48 signs.
- **Libs:** MapLibre GL JS **4.7.1**, PMTiles **3.2.1**, OpenFreeMap liberty.
- **Spawn:** `[-97.7434, 30.2857]`, zoom 16.5, pitch 60, bearing 90.
- **Golden rule:** verify rendering changes in the local real-code harness (and/or
  the on-screen `#diag`) **before** telling the user it's fixed.
  quick aside from simeon editing from github - i changed main branch to default from add-plan

---

## 13. July 10 late-night overhaul — detail + visuals pass (supersedes parts of §11-12)

Simeon confirmed buildings load, then asked for the fun part in one shot: max
low-poly building detail (esp. West Campus apartments + UT buildings), drastically
better day/night/sky/landscape, keep signs/glow/controls. What changed:

**Architecture: PMTiles is GONE from the client.**
- Buildings are now a plain GeoJSON source: `data/snapshots/<date>/buildings.detailed.geojson`
  (~1.4 MB raw, ~big-savings brotli'd by Vercel; MapLibre client-tiles it in a worker).
  This also permanently kills the Vercel byte-range/Brotli failure class (§7).
- MapLibre upgraded 4.7.1 → **5.24.0**. v5 notes: `antialias` must live in
  `canvasContextAttributes`; `map.on()` no longer chains; sky needs the horizon
  on-screen — we run `setVerticalFieldOfView(58)` + spawn pitch 64 so the
  `setSky` gradient actually shows. MapLibre has NO ambient-occlusion/flood-light
  (that's Mapbox v3) — night "flood light" is faked with `circle-blur` ground
  pools under signs (`signs-ground-glow` layer).

**Data added (all fetched from OSM Overpass, scripts in `scripts/`):**
- `data/parts.geojson` → baked to `parts.detailed.geojson`: 23 `building:part`
  volumes (incl. the 94 m UT Tower shaft on its 6.4 m base). Base buildings that
  parts replace carry `has_parts=1` and are filtered out of `buildings-3d`.
- `data/trees.geojson`: 498 real campus trees (octagon canopy + trunk extrusions).
- `data/landscape.geojson`: 52 pitches + fountain fills.
- `data/hero_designs.json`: curated real-world palettes for all 48 signed
  landmarks + ~19 OSM-name variants (UT limestone + red tile, Dobie gold glass,
  Skyloft blue, Castilian white...) plus per-`building_class` palette variants.
- OSM colour tags in this bbox are nearly nonexistent (5 buildings, 1 with real
  colours — Sutton Hall). Curated designs + class palettes carry the look; more
  data genuinely does not exist upstream.

**Bake step (`scripts/bake_detail.py <date>`):** merges base buildings + parts +
OSM tags + hero designs; bakes per-feature wall/roof colours for day/golden/night
(`wd/wg/wn`, `rd/rg/rn`) with deterministic per-building shade jitter. Hero
matching is sign-location-based disambiguated by height, then fuzzy-name.
Re-run it after editing `hero_designs.json`, then hard-reload.

**Client rendering:**
- `timeofday.js` v2: one `interpolate` expression with constant-`p` input blends
  each feature's baked colours — per-building identity at every hour. Scene
  keyframes drive sky (v5 `setSky`), light, ground/park/road/water/tree/pitch.
  Parks/landcover get their own GREEN bucket now (they were pavement-tinted).
  Pattern fills (plaza hatching) are hidden — they ignore tints and glow at night.
- Roof caps: top 1.2 m of every building ≥4 m re-extruded in roof colour
  (`buildings-roof`/`parts-roof`) — UT's red-tile roofs read from the air.
- v5 renders wide text halos as solid slabs; the old glow-underlay symbol layers
  are REMOVED (orphaned glow text made colored blocks where labels decluttered).
  Neon = label brand-halo widening at night + ground pools.
- Default time is now p=0.12 (late morning; palette variety visible on load).

**Verification:** everything above was verified in the `_harness.html` preview
loop (day/golden/night screenshots at spawn, UT Tower south-mall shot, West
Campus street shot). Screenshot tip: hidden-tab compositor serves ONE STALE
FRAME — always screenshot twice and trust the second.

---

## 23. July 30 2026 — the Capitol Complex (south of campus)

**The complaint:** "can you get the government buildings south of campus looking
a lot better — check whether they even exist."

**What was actually there.** They existed, and that was the smaller half of the
problem. `scripts/config.sh` models `30.276..30.296`, and that south edge falls
one block NORTH of the Capitol grounds. So the scene held the *back* of the
state complex — the Bullock, Bush, Barbara Jordan, Travis, Stephen F. Austin —
as anonymous tan boxes, and then stopped dead in an empty tan plain exactly
where the **Texas Capitol, its 22 acres of grounds and the Governor's Mansion**
belong. Flying south from campus, the city ended at MLK.

The heights were wrong too, and consistently in one direction: Overture reads
these buildings at roughly half true size. The **14-storey George H.W. Bush
State Office Building was a 24.9 m box** — 1.8 m per floor.

**What was added** (`scripts/fetch_capitol.py` → `scripts/bake_capitol.py`,
six data files, `js/capitol.js`):

| | |
|---|---|
| new modelled strip | `30.2710..30.2762`, full lon span — one block past the grounds |
| buildings | **604** from OSM, 78% with a recorded `height` or `building:levels` |
| the Texas Capitol | its real OSM footprint + **13 building:parts**, plus bespoke dome geometry |
| grounds | 322 areas + 1,480 paths — the Great Walk, the drives, the lawns |
| trees | **306** on the Capitol grounds; `trees.geojson` stopped at 30.27597 |
| corrected | 12 state buildings recoloured, **5 raised** (Bush 24.9 → 50.4 m) |

**The design rule: add nothing new where something exists.** Five of the six
baked files are merged into sources the app already has — `austin-buildings`,
`austin-parts`, `austin-ground`, `austin-trees` — so the new area inherits
facade patterns, ground shadows, label placement and dedup, the collision grid,
the day→night palette, the tree-density knob and the z-order for free and
permanently. Only the dome needed a layer of its own.

**The Capitol's massing is not invented.** OSM models it with building:parts,
and the numbers corroborate from two directions: the drum part carries
`height=75, roof:shape=dome`, the lantern part carries `height=92`, and 92 m is
the documented **302.64 ft** to the tip of the Goddess of Liberty's star. What
IS generative is form — `fill-extrusion` has one roof shape, so the dome, the
24-column drum colonnade, the mansard skirt, the pavilion caps and the Bullock's
rotunda are stacked rings, the same trick `bake_stadium.py` uses for the bowl.

**Things that were measured rather than recalled**
- The Capitol's roof is **pale grey-green standing-seam metal**, not terracotta
  — four clean samples off a z20 nadir tile (`#b7b8aa #aaaa9d #b5b6a7 #8d9085`).
  Worth knowing, because the campus roof pass would have tiled it in clay.
- The dome reads **lighter than the walls** from above (`#c9bba9 #ccb7a0
  #c0af9f`): it is sheet metal painted to match granite, and paint on a curved
  surface facing the sky is not a quarried wall. It has its own colour on purpose.
- The Capitol's **long axis runs east–west**, not north–south. The footprint's
  bbox is 167.9 × 102.6 m, which also settles which dimension the documented
  566 ft belongs to.
- The **granite wall colour is generative and labelled as such.** A nadir tile
  shows roofs; the few vertical strips it shows are shadowed or one pixel wide.
  Sampling those would have been a measurement in name only.

**Five bugs worth not repeating**

1. **`_harness.html` keeps a hand-maintained COPY of index.html's script list.**
   `capitol.js` was added to `index.html` only, and three shot runs "proved" the
   Capitol Complex had not changed. A module missing from the harness renders a
   scene that looks fine and is not the one the site serves. Both files now say so.
2. **The intro cinematic is a `map.flyTo`, not the flight controller.** So
   `__fly.eye().driving` stays **false** for its entire 9 s, the README's
   "wait for `!driving`" returns immediately, and the `jumpTo` after it is
   overwritten a frame later. Two probe runs screenshotted West Campus and were
   nearly read as "the buildings are missing at the Capitol". The fix is
   `?intro=0`; `shot.mjs` now loads with it.
3. **`fill-extrusion-vertical-gradient` on a stacked dome is 18 dark bands.**
   It darkens the bottom of *each* extrusion — right for one 30 m building,
   wrong for eighteen 1.3 m discs. With it on the dome read as a brown cone;
   off, MapLibre's per-facet shading carries the curvature.
4. **The facade quantiser will always lose a landmark's material.** Keeping the
   14 most POPULOUS tones is the right default and it also guarantees that a
   one-off granite on one building folds into whatever tan its neighbours
   average to — which put a pink dome on brown walls. `facades.js` now honours
   `window.FACADE_PROTECTED`: a protected tone keeps its own bucket and its
   *exact* colour, because the point is the material, not the neighbourhood.
5. **Overpass: `out` takes verbosity BEFORE geometry** (`out tags geom`, never
   `out geom tags`), and a tag key with a colon must be quoted
   (`way["area:highway"]`). Both are 400s, and 400 will never fix itself — the
   fetcher now fails fast on it instead of spending six minutes retrying mirrors.

**Two judgement calls, stated rather than hidden**
- **Levels → metres uses 3.6 m for civic/office**, not `config.sh`'s 3.2, which
  is a residential figure. At 3.2 the 14-storey Bush building is shorter than
  the 12-storey apartment blocks on Nueces. Generative, and reported by the bake.
- **The overrides pass may only touch a curated list inside a box around the
  complex.** The first cut matched any snapshot building whose name OSM also
  knew, which quietly raised **Dobie Twenty21 from its curated 82 m hero height
  to 99.2 m** and The Linden to 89.6 — a West Campus edit from a pass with no
  business there. The list is now the permission.

**Corrections are a runtime patch, not a rewrite of the snapshot.**
`data/capitol_overrides.json` is applied in `mergeCapitolScene()` on every load.
`buildings.detailed.geojson` is a generated artefact and a re-run of
`bake_detail.py` would silently undo anything written into it.

**Still owed here:** the Capitol's south portico and its steps; the monuments on
the south lawn (the `historic`/`memorial` nodes are fetched and cached but not
baked); the Bullock's bronze Lone Star; and 7 downtown building *relations*
that Overpass returned without member geometry and the bake skips — all hotels
and condos, none of them government, and the count is reported.

---

## 22. July 30 2026 — the ground pass (make it read like campus)

The complaint: the intro flies past the UT Tower and the ground under it is
empty — flat green, undifferentiated grey, nothing at people scale. It read
like a basemap with buildings pushed up.

### 22.1 The rule that governs this whole pass

**Position factual, form generative, and say which is which.** Every script
here prints its own provenance block. Nothing is scattered for looks.

### 22.2 What was sourced, and from where

| Layer | Count | Position source |
|---|---|---|
| paths/plazas/lawns/water/pitches (`ground.geojson`) | 2,881 | OSM |
| trees (`trees.geojson`) | 2,572 | city survey 878, OSM 489, **aerial imagery 1,205** |
| art / furniture / construction (`props.geojson`) | 501 | OSM |
| pitched roofs (`roofs.geojson`) | 100 buildings | terracotta tile read off aerial imagery |

**`scripts/survey_ground.py` caches every raw Overpass response under
`data/osm_cache/`** so nothing depends on that flaky API twice. Two hard-won
notes: an Overpass union group needs a `;` after it or every mirror answers
400 Bad Request (reads exactly like an outage), and running the queries back
to back earns a 429 then a cascade of 504s — pace them.

### 22.3 The tree problem, and the imagery answer

Neither survey covers the malls: OSM has 498 trees in the bbox and **none** on
them; the City of Austin inventory (Socrata `wrik-xasw`) has 1,566 with species
and trunk diameter and **none** on them either — the city surveys city land and
UT is state property. Its coverage also sits mostly at the eastern edge, leaving
the spawn and the flight corridor with **2 trees between them**.

So `scripts/detect_canopy.py` reads crowns off current nadir aerial imagery —
legitimate, and how OSM itself is made. Canopy separates from lawn on the two
things that actually differ: a crown is **darker** than mown grass and far more
**textured** at 0.26 m/px. `--debug` draws every detection onto the photograph,
which is how they were accepted by eye: crowns land on real trees, the open
South Mall lawn correctly stays empty with live oaks along its edges, and the
roofs and Littlefield Fountain stay untreed.

**NOTE for whoever reads this next: the "USGS LiDAR already in this project" is
Overture's LiDAR-*derived building heights*, not a point cloud.** There are no
vegetation returns to mine. That premise was checked and is false.

### 22.4 Roofs — the loudest generated-look tell

`fill-extrusion` has exactly one roof shape: flat. WHICH buildings have tile
(therefore pitched) roofs is **sourced**: each footprint is scored for
terracotta against the imagery, calibrated on the only ground truth available —
the five buildings OSM tags with `roof:shape`. The SHAPE is generative: stepped
inset facets at a 5:12 pitch. Offsetting a long rectangle inward collapses its
short axis to a line, so an elongated hall grows its own ridge. Reads as a pitch
at flying altitude; reads as steps up close, which is stated, not hidden.

**v2 (July 30) — "the roofs are still flat".** They were, on 96% of campus, for
two mechanical reasons and one rendering one. All three are worth knowing:

1. **The rule was never run.** `data/imagery_cache` held only the 176 z19 tiles
   fetched for an unrelated research task, so the bake reported `no_imagery
   1933` against `tiled 26` and every unscored building fell through to flat.
   Nothing was wrong with the rule; it had no photograph to read.
   `scripts/fetch_roof_imagery.py` derives the tile list from the footprints
   themselves and fills the cache (1,192 tiles). 26 → 76 buildings.
2. **The rule asked the wrong question.** v1 averaged terracotta over the WHOLE
   footprint and needed 0.50. But most of these hips are a tiled BAND around a
   flat membrane deck, so Welch, Calhoun, Hogg Auditorium, Gregory Gym, the
   Blanton, Goldsmith and Gearing all scored 0.30–0.55 and were thrown away —
   by their own decks. v2 walks INWARD from the eave and samples each offset
   ring, so the slope's run is measured per building and stops where the tile
   stops. 76 → 100, and the run is now data instead of an assumption.
   `python scripts/probe_roofs.py --sheet` writes the contact sheet that made
   this obvious; looking at the crops took ten seconds and was worth more than
   any amount of reasoning about the histogram.
3. **Stepped rings render flat, and no amount of pitch fixes that.** Every tread
   is horizontal, MapLibre shades horizontal tops identically, and the result is
   a flat plane with stripes on it — corrugated iron, not a roof. So each step
   is now one quad PER EDGE carrying `az`, the direction that slope faces, and
   `timeofday.js` picks its colour between a baked dark and bright end from the
   LIVE sun (`roofFacetColor`). The four slopes of a hip then differ, the hip
   diagonals appear, and the lighting rotates with the same sun as the shadows.

   Baking that tint into rd/rg/rn instead was tried first and failed in a way
   worth remembering: `bakedColor` LERPS day→golden, the morning sun sits at
   az 98 and the golden one at az 256, and at p=0.25 every facet averaged back
   to flat grey. **Directional shading cannot be baked at fixed hours and then
   interpolated across the day.**

Three geometry bugs found by looking at renders rather than at code:

- **Folded offsets.** A mitred offset turns inside out where a building is
  narrower than twice the offset. The Union's thin wings became spikes that
  rendered as steps floating over a flat plane. `fold_free_run` caps the slope
  at the last offset where the ring is still a true offset (every vertex still
  `d` from the wall that made it). Demanding EVERY vertex be clean dropped 34
  buildings whose single light-well notch folds early — Batts, Parlin, Rainey —
  so the test tolerates a tenth of the ring and `valid_step` cleans the rest.
- **The missing top.** The slope's interior was left on the wall cap while the
  band climbed 3 m above it, so the steps genuinely floated. It is now always
  filled at the top of the slope; its colour is the photograph's call (measured
  membrane grey where the middle is not tile, the building's tile where it is).
- **1 m wall jogs.** Shading by direction turns a staircase-shaped wall into
  alternating bright/dark dashes. The roof is simplified (Douglas–Peucker, 1.1 m
  — under the eave overhang) before offsetting.

Cost: measured with `scripts/verify/roof-perf.mjs`, roofs on vs off over the
halls, interleaved reps. The spreads overlap in both runs — **no measurable
frame cost**, which is the honest reading, not "free".

### 22.5 Two measurement lessons

- **The paths rendered correctly from the first try and were still invisible.**
  Concrete at luma 185 on a ground of 188.5 is 3.5 points of separation. Proved
  with a magenta pass (6.2% of frame) before touching anything, then fixed by
  dropping the catch-all `ground` from a pale sand to a mid warm grey.
- **Tree density is a parameter, not a cull.** Measured: the full set cost
  ~6–7 fps; the ground fills were within noise. Every tree carries `d`, a
  keep-order biased by crown size, so thinning drops small trees first and the
  mean canopy height *rises* 9.3 m → 13.8 m. `GFX.treeDensity` is in the menu.
  Back to 0 dropped-min / 59.4 fps at balanced.

### 22.6 Still missing (asked, not guessed)

Org tents on Speedway, the Jester courtyard interior, construction at the Tower
base and the Catholic Center, food carts, and parked cars are **not placed** —
no source carries them and the brief forbids guessing. See the report.

## 21. July 30 2026 (overnight) — the beauty pass

*(Being written as the night progresses; the morning report finalises it.)*

The brief: nothing is broken, tonight is about beauty. AWS is putting footage of
this app on the official Kiro channels; Simeon picks what to film in the
morning. Bar: a stranger scrolling stops. Branch: `feat/night-beauty`.

### 21.0 THE TOP NEXT ITEM — the snapshot data (deliberately NOT touched tonight)

The biggest real product gap is the data story: two distinct datasets and a diff
of twelve unnamed sheds. It is open-ended data work with uncertain payoff, which
is why the overnight brief explicitly excluded it. **Whoever picks this project
up next: start here.** Make the snapshot dates mean something — real diffs of
real named buildings between real dates — or fold the date UI away until the
data earns it. Nothing tonight touched `data/` or the diff pipeline.

### 21.1 The opening frame (framing pass, main session)

- The app now opens at **p = 0.50, peak golden hour** (`TOD_DEFAULT_P`,
  js/timeofday.js) — it used to open at 0.12, a pale flat morning that hid the
  app's best hour. Chosen against p = 0.47 by rendering both: at 0.47 the sun
  sits just above a portrait frame leaving a halo ring; at 0.50 the disc
  anchors the frame. `?p=<0..1>` overrides the opening hour for filming.
- **Spawn pose faces the sunset**: pitch 74 / bearing 250 (was 64 / 90). At
  pitch 64 a portrait frame kept ~6% sky and the golden-hour sun was BEHIND the
  camera; now the horizon sits about a fifth from the top and the disc, god
  rays and lens ghosts are all in frame. (`SPAWN`, js/app.js.)
- **The intro travels**: it starts low over campus ~430 m east and flies west
  down the 24th St canyon into the tower cluster, settling on the sunset pose —
  two chained easeTo legs, every value in the `INTRO` block (js/app.js).
  Verified frame-by-frame (portrait): towers pass the frame edges, no geometry
  clipping, and with the auto-detect probe cancelled the flight lands on the
  exact spawn pose. The probe used to stomp the ease mid-flight — the fix
  (probe defers while `map.isEasing()`) belongs to graphics.js.
- **The white void is gone**: a brand-dark `#veil` (index.html/style.css) holds
  an authored title card from the first paint until the map's first idle frame
  (capped by `INTRO.maxVeilMs`), then lifts as the flight departs. The first
  thing a visitor ever sees is the city already golden and in motion.
- **`?clip=1` cinematic capture mode**: hides all chrome (HUD, hints, panels,
  joystick, gear, toast) for filming; attribution stays for the license.
- **Phone chrome shrink** (style.css ≤640/≤520 blocks): the time-of-day pill
  dropped from 278 px (a third of a 390×844 frame) to ~210 px; the HUD loses
  the snapshot line on small screens; attribution links dimmed from orange to
  quiet cream. OSM ghost labels no longer smudge the spawn frame — the
  buildings-labels fade ramp now starts below the spawn zoom (16.8→17.5).

### 21.2 Presence (main session)

- **Idle cinema** (`DRIFT`, js/app.js): after 25 s of input silence the camera
  begins a slow tagged-easeTo orbit with the hour creeping forward (bouncing at
  day/night). Any input — or any untagged camera movement — reclaims control
  instantly. Gated out of the pixel harness via `__HARNESS`; `?drift=0` for
  scripted runs. Verified drift-check.mjs 4/4.
- **Landmark orbit** (`ORBIT`, js/app.js): tap a rendered sign label → the
  camera glides to that building and slowly circles it; any input ends it.
  Verified orbit-check.mjs 4/4 (glide lands 0.3 m from the sign). Honest test
  lesson: only RENDERED labels are tappable, and glyphs load late under load —
  the test waits for the label like a human would.
- **The Forty Acres tour** (`TOUR`, js/app.js): T or `?tour=1` flies a ~50 s
  authored route — the Drag, the South Mall with a held push-in dwell on the
  UT Tower postcard, a quarter-orbit, DKR with its own dwell, and a long
  settle home into the sunset. `?clip=1&tour=1` is a pure footage run. First
  cut was rejected by looking (Tower beat sampled mid-swing, Dobie dominated);
  dwell beats fixed it. tour-check.mjs 2/2.
- **Photo mode**: P toggles the same chrome-free view as `?clip=1`, live.

### 21.3 The night city (night workstream, merged)

Windows: five colour temperatures with weights (`WINDOW_TONES`, facades.js) —
warm incandescent through TV-blue — per-pane brightness with a dim tail, 5%
hot panes, and occupancy de-lockstepped from `bucketIdx % 5` to a continuous
per-(family × bucket) hash with per-family baselines (towers dimmest).
Streetlights: 1,201 lamps (482 major sodium / 719 minor warm) sampled from the
basemap's transportation geometry after idle, two circle layers inserted below
the extrusions so towers occlude, opacity ramping p 0.58→0.85 (`LIGHTS`,
night.js). Parking decks go cool-fluorescent after dark. Height falloff inside
a building was SKIPPED honestly: the facade tile repeats in world space every
~20 m of height, so it is not expressible without faking it badly.

**Harness truth learned tonight — the stock silhouette.mjs night check is
racy.** Cross-run evidence: bit-identical PASS values (55.8/21.2) and
bit-identical FAIL values (10.2/16.2) each appeared at MULTIPLE different
commits — the failure follows machine load, not code. Mechanism: its
single-column scan can "hit" a building at its very first row (y=0.05, deep in
the sky at that pose), after which it samples a dark tower wall as "sky". The
corrected ruler is `night-silhouette.mjs` (parts layers in the scan, sky
sampled above the computed horizon, median of 7 columns): night margin +20.9
on the merged tree. Its dusk half races the facade-atlas repaint under load —
`night-dusk-truth.mjs` (steady-state, atlas-byte read) is the reliable dusk
pattern, and the steady-state p=0.66 frame was verified correct by eye.

### 21.4 Light (light workstream, merged)

Filmic tone curve: exposure+contrast+curve baked into ONE SVG
`feComponentTransfer` LUT in the canvas filter chain (CSS clamps between
stages, so a separate brightness() would destroy what the shoulder recovers);
identity mid-band, Hermite toe/shoulder; `TONE` block + `GFX.filmic` slider.
Verified by pixels: golden flat-255 plateau 0.227%→0%, night flat-black
0.96%→0%. Auto-exposure: 40×24 mean-luma meter per frame, open-loop
(pre-grade, cannot pump), EMA τ=900 ms, clamps 0.85–1.20, target follows the
HOUR's authored luma (a fixed mid-grey target would re-grade the intentional
high-key day / dark night); `GFX.autoExposure`. God rays weighted by angle
from horizontal (ink ratio 3.42 vs 1.16 uniform) — glare streaks, not a
starburst. Second-sun ghost killed (sky-ghost ink −34–42% at every bearing).
The auto-detect probe now DEFERS while map.isEasing() (it was stomping the
new intro mid-flight) and is silent unless it actually downgrades. Vignette
tints by hour (`VIG_HOURS`). Clouds carry a lit rim and shaded base; a Belt
of Venus rises anti-solar at dusk (p 0.50–0.70); bright stars twinkle with no
new rAF loop. Perf: interleaved A/B vs a pristine baseline — dropped-min 0
both, p50 18.0 ms both; the whole pass costs less than run-to-run noise.

### 21.5 Motion (motion workstream, merged — with two suite lessons)

Bank roll into turns (native MapLibre roll, capability-checked), FOV kick
under speed, hover bob + landing settle, speed-adaptive pitch, and wall
deflection (damped + steered toward the freer side) — all as derived OUTPUT
offsets around writeToMap; the eye/alt/bearing/pitch state and every
collision guarantee untouched; everything in one `TUNE` block, live-tunable
via `__fly.tune`. Roll and FOV are hard-reset on every hand-back plus a
self-heal on the idle path. The agent died before finalising; its one
COMMITTED increment was merged and re-verified here (motion-feel 19/19,
movement 14/14 ×2, collision 8/8); its uncommitted wall-deflection iteration
was left out — unverified code doesn't ship.

Two movement.mjs defects the feel pass exposed (both now fixed in-file):
the speed ruler measured map.getCenter() — eye + a lead that now breathes
with dynamic pitch — instead of the eye; and __reset was a bare jumpTo that
the controller overwrote while it owned the camera (ownership now lasts ~8 s
after keyup for the bob wind-down), so positions accumulated leg over leg
until the DIAGONAL legs hit the soft data fence — a rock-stable-looking
diagonal/cardinal of 0.73 that was really the fence crushing vel.n. The eye
moved at exactly 56.71 m/s on both headings throughout.

## 20. July 29 2026 (later) — performance, the graphics menu, and a real sky

Five things were reported at once: the desktop was "super laggy"; the phone was
smooth but "roofs glitch out while I'm moving"; the time-of-day slider needed you
to *wait* after moving; the daytime sky was "too deep blue like I'm in space"; and
the whole thing was "too map-like" against a wanted "4K RTX / Minecraft shader"
look, with a menu to customise it.

### 20.1 The lag was fill rate, not JavaScript

Baseline at 2560x1400, flying: **27.9 fps with 53.6% of frames dropped**. The
median frame time was 16.7 ms — sitting exactly on vsync — which is why a median
is a useless performance metric here and everything is now counted in dropped
frames.

Four independent levers each roughly halved the drops. Ranked:

| lever | effect |
|---|---|
| `antialias: false` | 128 -> 53 dropped frames. One flag, the biggest single win. |
| basemap (40 Liberty layers) | 128 -> 54 |
| the DOM overlay stack | 128 -> 55 |
| the 23 widened road-line layers | 128 -> 64 |

`antialias` now defaults **off** and is a menu option with a reload prompt (it
cannot be changed on a live WebGL context). Render scale via `map.setPixelRatio`
— which does exist in 5.24 and works, 1100 -> 550 px verified — is the master
lever and supersedes MSAA anyway, since a scale above 1 supersamples.

**The sky canvas was uploading 13.7 MB every frame and 98.2% of it was empty.**
Everything in that pass was already clipped to `hzPx + 0.018H`; the element was
just full-screen anyway. It is now sized to the sky band (quantised to 96 px steps
so pitching does not reallocate the backing store), measured at **21% of a
full-screen buffer at the spawn pitch and 12% in the test viewport**. Same lesson
applied to the new FX canvas, which renders at half linear resolution because it
holds nothing but soft gradients.

Per-effect cost, measured on a deterministic bearing sweep, median of 3
interleaved runs at 2560x1400: **film grain 4.8 fps, colour grade 3.8, contact
shadows 3.6, distance blur 0.8.** Grain is therefore OFF in `balanced` — it is a
taste effect, not a depth cue — and the contact-shadow blur radii were halved
(84 px was pure overdraw across ~2,400 footprints).

Honest bottom line: **`balanced` with all the new effects runs at about the same
speed as the old build did** (35.3 fps / 106 dropped against 35.3 / 107). Turning
MSAA off buys 45.3 fps / 63 dropped, and the effects spend it back.
`performance` is 49.0 fps / 46 dropped. So what was really gained is *the choice*,
plus a much better-looking scene at parity.

### 20.2 The time-of-day lockout (the easiest real bug)

`style.css` hung `pointer-events: none` on the side panels off `body.flying` — and
`.flying` has a deliberate **4-second idle tail** so the hint always comes back. So
after every burst of flying the slider was dead for four seconds with nothing to do
but wait. That is exactly what was reported.

The protection is real (on a phone a right-thumb look swipe drags the slider into
night) but it only needs to last as long as the gesture. `controls.js` now sets
`body.input-active` on pointerdown and clears it on pointerup; the *fade* still
follows `.flying`, and hover/focus brings the panel back to full opacity.

### 20.3 The roofs — what was fixed, and what was NOT verified

The parapet cap was `base: h - 1.2, height: h + 0.4`. Its side faces were therefore
**exactly coplanar with the wall's over a 1.2 m band, in a different colour**, which
makes the winner undefined. It is now `base: h, height: h + max(1.0, 0.015h)` — the
cap sits ON the wall, shares no surface, and separates the two roof planes by
1.0-1.5 m instead of 0.4 m (scaled with height so the tall buildings, seen from
furthest away, get the most separation).

**This was not reproduced.** `scripts/verify/roofz.mjs` measures speckle density in
the old and new configurations at three poses and finds them within ~1% — and that
null result is expected, not reassuring: swiftshader rasterises with a 24-bit depth
buffer, and MapLibre draws `buildings-roof` after `buildings-3d` with `LEQUAL`, so
on a buffer with enough precision the later layer wins every tie deterministically.
A phone's buffer is often 16-bit. The change is justified on the geometry, not on a
repro. **Needs a real phone to confirm.**

Also fixed while in there: `diff-tour.js` carried its own copy of the
`+0.4 / -1.2` literals in three places. The rule now lives once in
`window.CAP_GEOM`.

### 20.4 The sky was wrong on both halves of the slider

Measured at the top of the visible band, day read **#284e97 — S 58%, L 37%**,
against roughly S 40-55% / L 55-70% for a real sky. Too dark and slightly too
saturated is exactly "deep blue, like I'm in space". And it was FLAT: one colour
across the whole band, because `sky-horizon-blend` was 0.5, which kept the pale
horizon colour so low that at any flying pitch you only ever saw near-pure zenith.

Worse, and not reported: **the day-to-golden half dragged through purple.**
`#21529f -> #6a2a4a` is a lerp through violet, and the rendered sky at p=0.30 —
mid-afternoon — was **#4d3a6c, a dark plum**. The `DUSK` route had already solved
this exact problem for the golden-to-night half in section 18; it just never
covered the first half. It is now one `ROUTES` table across the whole 0-to-1 range.

After: day runs **#5c93cd (S 53%, L 58%) -> #b4d1e8 (L 81%)** across the band — a
real gradient in the reference range — and p=0.30 is a desaturating blue-grey
afternoon instead of plum.

### 20.5 The post-process stack (js/graphics.js)

    downscale + threshold + blur + add  -> bloom       (canvas, from the GL canvas)
    additive wedges from the sun        -> god rays    (canvas)
    ghosts + anamorphic streak          -> lens flare  (canvas)
    masked blur at the horizon          -> aerial DOF  (CSS backdrop-filter)
    exposure/contrast/saturation        -> grade       (CSS filter on #map)
    overlay noise                       -> film grain  (tiled canvas)
    blurred dark line on the footprint  -> contact shadows (a MapLibre line layer)

**The bloom trap, because it cost the most time.** The obvious approach is one
full-screen div with `backdrop-filter: brightness(.45) contrast(4) blur(25px)` and
`mix-blend-mode: screen` — threshold, blur and add, free, in the compositor. **It
does not work.** Chrome paints the filtered backdrop as the element's own content
and the blend mode never adds it back, so you get a crushed, dark, blurred copy
laid *over* the frame. Rendered side by side the whole city went muddy brown and
soft. A screen blend can only ever lighten, so "it got darker" was the proof.

Bloom is now real: copy the GL canvas into a 256-px scratch canvas with
`filter = brightness(t) contrast(4) blur(r)` (one `drawImage` does the downscale,
the threshold and the blur together), then composite it back with
`globalCompositeOperation = 'lighter'`. Needs `preserveDrawingBuffer`, which is
requested at construction only when the saved bloom setting is above zero, so the
performance preset stops paying for it on the next load.

**The threshold is wrong in both directions and a test now pins it.**
`contrast(4)` maps `out = 4*in - 1.5`, so after `brightness(t)` only inputs above
`0.375/t` survive. At t=0.50 golden hour came through as one orange wash that
bleached the mid-distance city white. At t=0.404 nothing in a *daytime* frame
reaches the cutoff (the pale sky tops out near 0.91), so bloom silently did nothing
for half the slider — caught only because `graphics.mjs` samples day and golden
separately. Landed at t≈0.48. The bleaching turned out to be the alpha (0.89, now
0.4), not the threshold.

Contact shadows deserve a note: a blurred dark **line on the footprint outline**
puts half its width inside the building, where the extrusion hides it, and half
outside — a soft occlusion halo at every base. Sun shadow only ever falls on one
side, so this is what actually makes the extrusions stand on the ground instead of
looking pasted onto it. The first attempt, 0.38 alpha on a 5 px line, was invisible
in a side-by-side render: occlusion is a wide gradient, and the blur has to exceed
the line width or all you get is an outline.

### 20.6 The menu

Gear at top right, `G` to toggle, bottom sheet on a phone. Four presets
(Performance / Balanced / Cinematic / Ultra), 16 individual settings, live fps in
the header, persisted to `localStorage`. Built **from JS, not markup**, so
`_harness.html` cannot drift out of sync with `index.html` — that duplication has
already cost one debugging session.

First run measures ~1.4 s of frame times and picks a preset. It is **cancelled by
the first deliberate change**, because a probe that lands 11 seconds in and
silently resets a preset the user just picked is worse than no probe at all (it
also made `graphics.mjs` flaky in exactly that way). Tests and shot lists call
`window.cancelGraphicsAutoDetect()` up front.

Effects at zero are `display: none`, not `opacity: 0` — a zero-opacity full-screen
blend layer is still a full-screen blend to the compositor. Opening the panel adds
`body.gfx-open`, which slides the time-of-day slider and the snapshot picker clear;
the panel otherwise sits exactly on top of both.

### 20.6b The auto-detect probe was measuring nothing

Worth its own note, because it looked like it worked. The probe fired, reported
"60 fps", and **upgraded** to cinematic — on a machine that had just been called
super laggy. Two independent faults:

1. **It measured an IDLE camera.** MapLibre renders nothing when the camera is
   parked, so a flat 16.7 ms means "no work was done", not "there is headroom".
   The probe now nudges the bearing 0.01 deg per frame (skipped if the user is
   already flying, which is representative on its own) and snapshots/restores the
   bearing around itself.
2. **It could upgrade at all.** vsync clamps the measurement at 16.7 ms, so "hits
   60 at balanced" and "could run three times that" are indistinguishable. There
   is only ever evidence for a downgrade. It now steps down to `performance` or
   stays put; cinematic and ultra are opt-in.

And the guard was backwards: it required 12 frames and otherwise said "cannot
judge, keep the heavier preset". A machine too slow to render 12 frames in 1.4 s
is emphatically slow — failing to gather frames IS the measurement. Threshold is
now 4 frames, which only trips on a backgrounded tab.

`window.__gfxProbe()` runs it on demand so a test does not have to wait out the
11 s delay. Waiting is how a broken probe went unnoticed.

**Unrelated pre-existing bug found while verifying this:** the map bearing drifts
on its own while idle — 4.33 deg in 1.6 s with no probe running, `intro=0`, and
`__fly.eye().driving === false` the whole time. Not caused by anything in this
change (the probe's restore actually reduces it). Spawned as a follow-up.

### 20.7 Also fixed in passing

`diff-tour.js` scheduled `setTimeout(hideBanner, 3500)` for its transient messages
with no way to cancel it. Switching snapshots twice inside 3.5 s — which is what
stepping backwards through the list does — let the first message's timer fire on
top of the second selection's *running* tour: banner gone, prev/next/exit
unreachable, tour still active and still overriding building heights. Found by
`difftour.mjs` timing out on a click.

### 20.8 State

Suites green: graphics 27/27, movement 14/14, collision 8/8, sky 12/12,
difftour 11/11, silhouette 2/2. `roofz.mjs` reports and asserts nothing, by design.

Still not done, still needs a human with the phone: **none of this has been tested
on real iOS hardware.** The mobile checks use a synthetic 390x844 viewport with
`hasTouch`. Specifically unverified: the two-finger altitude gesture, the
joystick-plus-look combination, `mix-blend-mode` and `backdrop-filter` over a
WebGL canvas in Safari, and whether the roof change actually cures the reported
glitch.

## 19. July 29 2026 — shipped, plus the backlog

Everything in §15–§18 is **merged to `main` and live**, verified by driving
flyover-utx.vercel.app itself (not localhost): HTTP 200, `window.skyBodies` and
`window.__fly` present, 38 facade patterns registered, collision grid indexed,
45 shadows, 30 signs, snapshot `2026-07-27`, intro landing on the exact spawn
pose, zero page errors. **The verification harness is now in the repo** at
`scripts/verify/` with its own README — it lived in an ephemeral scratchpad
before, which §8 already records as expensive. `_harness.html` is tracked now
too; it was in `.git/info/exclude`, which is how the tooling got lost last time.

### `wn` is fixed at the source
`bake_detail.py` used to mix 30% of the warm `night_window` tint into the WALL,
landing the city on olive-khaki after dark. `js/facades.js` worked around it by
deriving its own night wall and ignoring `wn`. There is now ONE definition:
`bake_detail.py:night_wall()`, verified to produce **byte-identical values to the
old JS derivation across all 2,453 features (0 mismatches, worst channel diff 0)**,
so the workaround could be deleted with a guarantee of no visual change. All three
snapshots re-baked.

### The diff tour had never once run
`diff-tour.js` filtered for `f.geometry.type === 'Point'`, but
`diff_snapshots.py` emits **Polygon** footprints — so every feature was discarded
and it always reported "No changed buildings found in this diff." It also called
`d.includes()` on `manifest.diffs` entries, which are objects now (the same crash
class that took down `date-switcher.js`), and its height tween moved the wall but
not the roof cap, leaving a growing building's parapet hanging in mid-air.
All three fixed; centroids are derived from whatever geometry the diff carries.
Now verified end to end (`scripts/verify/difftour.mjs`, 9/9): banner reads
"1 / 12", camera flies 733 m to the first changed building, `next` advances to
2 / 12, and exit restores both height expressions.

### Trees: an upstream data gap, not a rendering bug — don't re-investigate
Measured: **zero trees within 200 m of spawn**, nearest 373 m, median distance
1,232 m, and over half of all 498 sit in two 400 m cells on the UT campus side.
The spawn is in West Campus, where OSM has no tree data at all.
`fetch_trees_landscape.py` already queries **both** `natural=tree` nodes *and*
`natural=tree_row` ways (interpolated every 8 m), so 498 is everything upstream
has — the same situation §13 records for building colours.
Where trees *do* exist they render well; screenshot the LBJ Library / Sid
Richardson walks at `[-97.7291, 30.2850]` to see hundreds of them.
**Do not synthesise West Campus street trees.** That is inventing geography, and
it contradicts both §1 ("everything is data-driven, not manually modelled") and
the playbook's rule about never inventing structure. If you want them, extend the
Overpass fetch or contribute to OSM.
One real fix applied: every canopy was the identical green, so a cluster read as
stamped copies. Canopy colour now interpolates over `h` (which already varies
7–15 m per tree), so bigger crowns read darker. No data change, one expression.

### Still not verified
**Nothing has been tested on a real iPhone.** Mobile checks use a synthetic
390×844 viewport with `hasTouch`. The joystick-plus-look fix, the two-finger
altitude gesture, and `mix-blend-mode: screen` over a WebGL canvas in Safari are
measured headless but not seen on real hardware. That is the next thing worth
doing, and it needs a human with the phone.

### Deliberately not done
The night dither — banding measured clean (`stepsOf2plus = 0` at every hour;
night shows ~9 px flat runs of single-code steps). Whether that still matters
after the skyglow band and lifted horizon should be **re-measured** before adding
another full-frame layer. `scripts/verify/banding.mjs` does the measurement.

---

## 18. July 29 2026 — sky, second pass (critique-driven)

A 5-agent critique of the sky built in §17 (cinematographer / art-director /
night-specialist lenses, plus a graphics-engineer recon that pulled MapLibre's
actual sky fragment shader out of the dist). It found one outright bug and two
structural defects, all in the default pitch-64 frame. Every number below was
re-measured here before acting on it.

**THE BUG — the horizon glow teleported at dusk.** `useMoon = !B.sunUp &&
B.moon.elev > -2` flips when the sun sets AND the moon crosses −2°, and those
coincide. Reproduced exactly: between p=0.5924 and p=0.5926 — **one frame of the
32 s auto cycle** — the glow's azimuth jumped **176.6°** (western horizon to
eastern) and its alpha dropped 0.459 → 0.168.
Fix: both bodies are now always drawn on independent schedules. The sun's
afterglow decays over its own elevation (`wSun`, reaching zero at −20°) while the
moon's rises over its own; they genuinely overlap from p=0.64, warm west and cool
east on screen together. **Measured worst frame-to-frame change: 0.291 → 0.00054,
a 540× reduction.**

**DEFECT 1 — the haze band was aimed below the horizon.** `#haze` is the only
layer in the sky stack with no blend mode, so it genuinely paints over geometry.
At pitch 64 / H=800 the horizon is at y=48 px and the old 13% stop peaked at
**y=61 — thirteen pixels below it** — laying 0.87 alpha just under the horizon and
still 0.48 at y=130, exactly where mid-distance rooflines live. Re-aimed to hug
the horizon: it now touches ~8 px of the 48 px of visible sky instead of 20, and
mid-distance alpha drops ~70%. This, not the sun bloom, was most of why golden
hour lost the mid-distance city.

**DEFECT 2 — the value ladder was inverted at both ends.**
- Day: road luma 231 > horizon 223 > sky 122. The pavement was the brightest
  thing in a daylight exterior and a wall had 13 codes of separation from the sky
  behind it. Deepened `sky` to `#21529f`, gave the horizon chroma (`#b7daec`),
  dropped the road to `#e2dac7`.
- Night: measured **sky luma 55.8 vs wall 21.2 → separation +34.6**, up from
  about −9 (the city glowed against a *darker* sky). Lifted the night horizon and
  fog, added an omnidirectional city-skyglow band at the horizon, softened the
  vignette.

**Two more real bugs found while implementing**
- *The sky was painting the city.* The horizon washes are ellipses centred on the
  horizon, so half of each landed below it — at dusk an 825×561 px lobe of deep
  red at 0.31 alpha screen-blended the **whole frame magenta, ground included**.
  Fixed by clipping the entire canvas sky pass to `y < horizon + 1.8%`. Light on
  buildings is `setLight`'s job; the sky's job stops at the horizon.
- *MapLibre's extrusion lighting doesn't tint, it DISTORTS — and it was making the
  roofs wine-purple.* Measured at golden hour: a baked roof of `#a1866b` (warm
  tan) rendered **`#543031`** at intensity 0.58 with a saturated light, `#8e5031`
  at 0.18, and `#7d6045` with a neutral light at 0.30. Same mechanism that turned
  the night roofs olive in §17. Day/golden intensity dropped to 0.28/0.30 with
  less saturated light colours; the *position* still comes from the shared sun,
  because that is the coherence shadows depend on.

**And one the critique's own measurement exposed:** the walls darkened on a
`p` schedule that lagged the sun, leaving them 60% golden-lit at p=0.7 when the
sun was already 8° below the horizon — an **inverted dusk silhouette** (sky 75.7
vs wall 88.5). `facades.js` now uses two night factors: `dark` (sun-elevation
driven) for the wall and its glass, `night` (p-driven) for the lit windows, whose
lag is deliberate — city lights come up as the sky finishes darkening. Dusk
separation went **−12.8 → +30.7**.

**Also:** twilight no longer lerps through khaki (a straight golden→night RGB lerp
put the haze at (174,123,87) at p=0.65 and dead-neutral (74,60,62) at p=0.875) —
four `DUSK` tracks route it orange → rose → violet → deep blue with saturation
held up, and their endpoints equal `PRESETS.golden`/`PRESETS.night` exactly so
there is no seam. `applyTimeOfDay` now quantises its expensive half to 1/128 of
p (**1,920 heavy passes per sweep → 128**) while the sky overlay still updates
every frame; and `setSky` drops from 7 properties to 3, since `fog-color`,
`horizon-fog-blend` and `fog-ground-blend` are terrain-only here.

**Banding, measured** (nobody had checked): `stepsOf2plus = 0` at day, golden and
night — every transition is a single code, so there are no hard edges. Night does
show ~9 px flat runs (21 unique colours over 192 px). A dither was deliberately
NOT shipped: its value depends on what the night sliver looks like after the
skyglow band and lifted horizon, and it should be re-measured before adding
another full-frame layer.

**Perf** (min-of-60, not mean — a mean on a busy machine measures the machine;
an earlier mean-based run reported *day* getting 3× slower after a change that
only touches the night path): sky overlay redraw at 900×800 is **1.0 ms night /
0.4 ms golden / 0.2 ms day**. Star halos are blitted from a cached sprite rather
than building ~78 `createRadialGradient` objects per frame.

Suites: sky 12/12, movement 14/14, collision 8/8, plus `duskcheck.mjs` and
`silhouette.mjs` in the scratchpad.

**Rejected, with reasons** (the judge's full list is in the workflow transcript):
pitch-driven `sky-horizon-blend` (rests on unverifiable MapLibre shader
internals, +5.7% day payoff, regresses night); crepuscular rays (most expensive
item, high-pitch-dominant); Milky Way and a high cirrus shelf (both live above
+3°, worth nothing at the default pitch); a directional downtown light dome
(downtown bears 179° against a spawn bearing of 90 — completely off-screen).

---

## 17. July 29 2026 — the sky (js/sky.js)

**Fixed a real incoherence first: there were TWO suns.** `shadows.js` walked its
own arc (az 150→245, elev 64→20) while `setLight` used another (az 205→252,
elev 58→14) — 55° apart at p=0. Shadows pointed one way and the scene was lit
from somewhere else. `skyBodies(p)` in `js/sky.js` is now the single source of
truth for shadow direction, MapLibre's light, and the visible disc. Verified:
`setLight` azimuth matches the shared sun to **0.00°**, and the shadow hulls
point anti-solar to within 2–9° wherever that is measurable.

Shadow opacity and existence now derive from the real solar **elevation** rather
than a hardcoded p, so they can never disagree with where the sun visibly is —
below the horizon there are no shadows at all.

**The geometry fact that drove the whole design.** MapLibre pitch is measured
from straight down, so the view axis is at `(pitch - 90)°` and the top of the
frame is at `(pitch - 90 + fov/2)°`. At the spawn pitch of 64 with a 58° FOV
that is **+3°** — you can see three degrees of sky. A sun disc is therefore
invisible at the default view no matter where you put it. So:
- the **horizon glow** (a wide gradient anchored to the sun's *azimuth* at the
  horizon) and a **low cloud band** carry the default frame;
- the **disc** is the reward for pitching up, or for golden hour;
- the **moon peaks at 24°**, not overhead — a moon high in the dome is a moon
  nobody ever sees at a flying pitch.

**Technique: DOM/canvas overlays with `mix-blend-mode: screen`.** Screen
blending can only ADD light, so a 97 m tower crossing the horizon line is never
painted over — it picks up bloom instead, which is what a bright sky does to a
silhouette. Elements: `#sky-canvas` (520 stars + 22 multi-lobe clouds),
`#sky-glow`, `#sky-bloom`, `#sky-core`. All `pointer-events:none`, all asserted
to be `screen` in the test suite.

**A custom WebGL layer was tried and rejected.** `{type:'custom'}` inserted at
the bottom of the style DOES own the sky — but it also painted over the ground
plane. Proven by rendering it solid magenta: the roads went magenta too, while
the buildings stayed correct. Screenshot-verified, not reasoned about.

**Bugs found and fixed while building it**
- Stars were weighted toward the zenith "to keep the horizon clean". Result: two
  visible stars, because at a flying pitch you only ever see the first ~20°.
  Now biased LOW (`1.5 + rnd^1.5 * 62`).
- Clouds were single blurred ellipses and read as smudges on the glass. Now
  clusters of 3–5 lobes.
- A canvas `createRadialGradient` was built BEFORE `translate`/`scale`, so it
  landed nowhere near the shape it filled. Build gradients after the transform,
  centred on the origin.
- The haze band reached 7% above the horizon, which at the spawn pitch meant the
  haze — not the sky gradient — was most of the visible sky. Pulled to 2.5%.

**Three harness traps worth remembering** (each produced a confident false
failure before being understood):
1. `GeoJSONSource` does not expose `_data` in v5 — use `querySourceFeatures`.
2. After `setData`, the source **re-tiles in a worker**. Sampling 700 ms later
   returned the *previous* hour's shadows and made the test report a 43° error.
   Wait for `idle`.
3. `pitch = 90 + sunElev` is clamped by `maxPitch: 85`, so "look straight at the
   sun" does not put it at screen centre. The disc's 109 px offset was *correct*.
   The fixed assertion predicts the position from the actual pose and matches
   **pixel-exactly** (450,201 predicted, 450,201 measured).

Also: `MAX_LENGTH = 2.4` caps shadow reach on purpose, so below ~22.6° of solar
elevation shadows stop lengthening. Any test asserting "lower sun → bigger
shadows" must encode that cap or it fails on correct behaviour.

Suite: `scratchpad/verify-sky.mjs` — 12/12. Movement 14/14 and collision 8/8
still pass.

---

## 16. July 29 2026 — the movement system rewrite (FLYCAM)

`js/controls.js` was rewritten. A 5-lens audit produced 75 candidate defects; 47
survived adversarial verification. The headline ones were then reproduced and
measured in a headless harness before anything was changed — several
"obvious" readings turned out to be wrong until measured.

**The one structural change.** The camera EYE is now the state; MapLibre's
`center`/`zoom` are OUTPUTS, derived once per frame and written with a single
`map.jumpTo()`. Nothing else in the file calls setCenter/setZoom/setBearing/
setPitch. Steering `center` in degrees is what made a whole family of defects
*expressible*; steering the eye in metres makes them unrepresentable.

**Measured before → after** (headless, 800×560, timing-independent):

| | before | after |
|---|---|---|
| east/west vs north/south speed | 0.854 | **1.000** |
| diagonal (W+D) vs cardinal | 1.445 | **1.001** |
| one tap of Q at spawn | zoom 16.5 → **13.35**, then dead | 16.5 → 16.33, keeps working |
| 4 s of "descend" on E | camera at **9.8 km** | descends normally |
| drag-to-look at fixed zoom | altitude 302 → 187 m | **211 → 211 m** |
| key held while window blurs | flies away forever | released |
| WASD while a slider is focused | camera moves 6.2 m | **0.0 m** |
| assertion suite | 4/14 | **22/22** |

**The five defects that mattered most**
1. `zoomToAlt()` returned Web-Mercator **metres-per-pixel**, not altitude — 1.69
   at the spawn zoom where the camera was really 230 m up. Both Q and E clamped
   to `MIN_ALT` on the first frame and teleported to zoom 13.35; `scrollZoom` is
   off, so on desktop there was **no way back except reloading**.
2. Longitude deltas were never divided by `cos(latitude)`, so E/W ran 13% slow
   and any diagonal heading crabbed ~4° off course — 35 m of drift over 500 m.
3. The input vector was never normalised: W+D was 41% faster than W.
4. On mobile the joystick thumb was counted in `TouchEvent.touches`, so the
   canvas entered pinch-zoom the moment a second thumb landed. **Moving and
   looking at the same time was impossible** — the one scheme the UI advertises.
5. No blur/visibilitychange reset, so alt-tabbing mid-flight left the key down
   and the camera flying forever. Keys are now indexed by `e.code`, not `e.key`
   (macOS Option+W reports `∑` on keydown and `w` on keyup, which latches a
   key-indexed map permanently).

**What's new:** altitude-scaled speed (6 m/s at street level for reading signs,
~40 m/s at spawn, Shift ×2.5); acceleration and glide (τ 0.20 s / 0.45 s);
wheel-to-altitude on desktop; two-finger and double-tap-drag altitude on mobile;
look works anywhere on the canvas (the right-half-only gate is gone); R returns
home; a soft fence at the data edge; chrome that fades while flying and comes
back after 4 s.

**Collision.** A 6 m max-roof grid built from the in-memory snapshot at load
(626 KB, ~155 k cells, footprints *rasterised* not bbox-stamped). Small 6 m probe
on purpose: a large anticipatory probe lifts the camera over the buildings
flanking every West Campus street, which would make "fly down the street and
read the signs" unreachable. Verified: 528 sampled frames of randomised
low-altitude flight with a worst clearance of 18.55 m and never once inside;
a street flight starting at 24 m between 21 m buildings peaks at **24 m** (zero
unrequested lift); flying at the 98 m tower from 140 m out **brakes and stops
6 m from it** rather than entering or climbing over.

**Three traps, all of which cost real time here**
- **MapLibre uses 512-px tiles.** The `156543.03392` constant in every tutorial
  is the 256-px convention and gives exactly **2× the true altitude**. Use
  `C = 40030228.884` and `/(512 * 2^z)`. Two of the audit's own suggested fixes
  contained this error.
- **`map.getFreeCameraOptions()` does not exist in MapLibre 5.24** (that is
  Mapbox). Verified `undefined` at runtime. `map.transform.getCameraAltitude()`
  and `getCameraLngLat()` do exist and were used to check the closed forms.
- **`setPointerCapture` can throw**, and an unguarded call takes the whole
  `pointerdown` handler with it — which silently disables look. Wrap it.

**A bug this rewrite introduced and then caught:** `driving` initially included
`altFloor > 0.05`. Because the floor is a standing *response* rather than an
intent, that pinned `driving` true forever whenever the camera rested over a
building, so the controller would have owned the camera permanently and stomped
on the intro, the R reset and the diff tour. It now compares against the
*resolved* target altitude. Verified: after the 9 s intro, `driving === false`
and `tickMsAvg === 0` — the controller never wrote a frame during the cinematic.

**Also fixed:** `DT_BAIL` was 0.25 s, which was meant to swallow tab-restore gaps
but actually discarded **every frame slower than 4 fps** — measured 8.85 m/s
against a 40 m/s target on a slow renderer. Now 1.0 s, with `DT_MAX` 0.1 s and a
substepped collision walk so a longer step still cannot tunnel through a facade.

**Verification lives in the session scratchpad** (`verify-movement.mjs`,
`verify-collision.mjs`). Both drive the real `index.html`. The key trick: measure
against the camera's **own integrated time** (`window.__fly.simTime()`), never
wall-clock — headless swiftshader runs at 4–20 fps here, so wall-clock speed
measures the renderer, not the movement system. `window.__fly` also exposes
`eye()`, `roofAt()`, `indexed()` and `gridBytes()` for assertions. Seeded tests
must wait for `!driving` **before** placing the camera; the controller owns the
camera while flying and will overwrite an external `jumpTo` on the next frame.

---

## 15. July 29 2026 — the art pass that was still owed (current state)

The July 10 overhaul got the *engine* right and the *look* wrong. This pass was
purely visual, driven by a real render→pixel-sample→assert loop rather than
reasoning (see "verification" below). What changed, and why:

**Facades — buildings have windows now.** MapLibre v5's
`fill-extrusion-pattern` tiles in WORLD space, so a window grid keeps a
constant physical size as you fly. That is the single biggest upgrade available
to a fill-extrusion city, and it's what §14 assumed was impossible here.
The catch: a pattern REPLACES `fill-extrusion-color`, so per-building colour
would be lost. `js/facades.js` fixes that by quantising the 911 baked wall
colours into ~14 adaptive buckets and generating one canvas pattern per
(facade family × bucket) — 38 images in practice. Families are `lo` / `md` /
`tw` / `dk` (low-rise, walk-up, tower, parking deck) picked from height+class.
The atlas is repainted in place (`map.updateImage`) whenever the time-of-day
changes, so glass is cool-dark by day, amber at golden hour, and a varied
scatter of windows lights warm at night.
*The 14-bucket flattening is a feature, not a compromise — 14 deliberate tones
beat 911 muddy near-duplicates.*

**Ground shadows.** MapLibre has no shadow casting, and `fill-translate` isn't
data-driven, so every building would cast the same shadow regardless of height.
`js/shadows.js` builds real geometry instead: per footprint, offset a copy by
`height / tan(sun elevation)` away from the sun and take the convex hull of
both — the swept silhouette. Derived on the client from the GeoJSON that's
already downloading, so it costs zero payload and the sun swings with the
slider (debounced 140 ms).

**Label declutter.** This was the worst offence: ~70 rainbow-coloured labels
covered 60% of every frame and read as a debug overlay. Fixes: OSM names are
gated to zoom ≥16.4 and height ≥12 m, sorted so tall buildings win placement,
and **deduped against the curated signs** ("The Mark" / "The Mark Austin" both
showed). Curated signs are calm cream by day and only take their brand colour
after dark, which is when a lit sign is supposed to be what you notice.
383 named buildings → 184 eligible; visible-at-once dropped by roughly 4×.

**Atmosphere.** `js/atmosphere.js` is a horizon haze band tracking the camera
pitch. **MapLibre's `setSky` fog does not work for this** — sweeping
`fog-ground-blend` from 0 to 1 leaves every ground and building pixel
bit-identical (measured). That fog only paints the sky dome. The DOM band gives
the scene aerial perspective and buries the straight seam where the bbox ends.

**Two measured bugs worth remembering:**
- *Night was olive.* `bake_detail.py` mixes 30% of a warm "lit window" tint into
  the WALL colour (`wn = lerp(dark, night_window, 0.30)`), landing the whole
  city on mid olive-khaki (#63615b, #7b6d53) after dark. Now that windows carry
  the light, `facades.js` derives a proper dark cool wall from `wd` and ignores
  the baked `wn`. (The baked `wn` is still in the data; nothing re-baked.)
- *`setLight` intensity lifts and warms extrusion faces.* At intensity 0.3 the
  baked navy roof `#10121d` rendered `#312c1b` — an olive tarp over the night
  city. At intensity ~0 the baked colour comes through. Night now runs at 0.04.
  If a colour ever renders "wrong but plausible", suspect the light first.

**Also fixed / added:**
- `date-switcher.js` crashed on `d.match is not a function` — manifest `diffs`
  are objects now, not strings. That crash was silently killing **everything
  after it in the init sequence** (sky, shadows, signage, the intro). Init is
  now stage-isolated (`step()` in app.js) so one failure can't cascade.
- A `text-opacity` expression nesting two zoom curves inside a `case` was
  rejected outright ("Only one zoom-based step or interpolate subexpression may
  be used") — and a rejected paint property takes the whole layer with it.
  Zoom-interpolate on the outside, `case` in the outputs.
- The `2026-07-27` snapshot was dead data: no detail bake, not in the manifest.
  Baked and registered; it's now `latest`, which also lights up the date
  switcher and the 12-building diff vs `2026-07-11`.
- Sign ground-glow pools were 60 px at z16 / 380 px at z19 and merged into one
  wash; tightened to 20/150 at 0.2 opacity.
- Cinematic dolly-in on load (9 s, cancels on any input); chrome fades back
  once you take the controls; roads widened into readable ribbons with casings;
  restyled HUD; inline SVG favicon.

**Verification (this is the part to keep).** `scratchpad/shot.mjs` +
`_harness.html` drive the REAL app in headless Chrome and screenshot it.
Critical details:
- The bundled Playwright Chromium on this machine is broken ("side-by-side
  configuration is incorrect"); launch with
  `executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'`.
- `_harness.html` forces `preserveDrawingBuffer: true` so `gl.readPixels` can
  sample **our own output** — assert on hex values, don't eyeball.
- To find which layer owns a pixel, hide layers one at a time and diff. That's
  how the olive was pinned to `buildings-roof`, and how "roads are the problem"
  was disproved (paint every line layer magenta — one render settles it).
- **Data-driven paint expressions and the facade atlas do not land in the same
  frame as the call.** A screenshot taken too soon after a big time-of-day jump
  shows the PREVIOUS state — that's what produced a "black roofs" and
  "brand-coloured day labels" scare that did not reproduce in a fresh session.
  Settle ~4 s, `triggerRepaint`, then screenshot twice and trust the second.

---

## 14. Where the project went next (July 11–12, 2026)

Simeon judged the July 10 overhaul **1/10 vs expectations** — fill-extrusion
prisms can never deliver real facades (Union on 24th's checkered panels,
recessed windows, terraces). The visual ambition moved to a sibling project:
**`Projects/utx-diorama`** — Google Photorealistic 3D Tiles + Blender diorama
stage + a three.js "workbench" where hero buildings are rebuilt procedurally
from architect reference photos. Read **`utx-diorama/PROJECT_OVERVIEW.md`**
for the full journey and its lessons. This repo stays live (flyover-utx.vercel.app)
and untouched; its baked data (`buildings.detailed.geojson`, `signs.json`,
`hero_designs.json`) feeds the diorama's footprint/palette pipelines.

---

## Acer lane, overnight 2026-08-01 — branch `acer/windows-pass`, PR #27

Eleven commits. Full detail in the PR body; the four things worth carrying
forward:

1. **`fill-extrusion-pattern` is TILE-anchored and cross-fades between tile zoom
   levels.** That is the whole cause of the city-wide "glitchy whenever I move".
   Every patterned GeoJSON source must spread `window.PATTERN_TILING`
   (`js/app.js`). If you add a new patterned source and skip it, the flicker comes
   back on that source alone — which is exactly how `js/outer.js` kept it after
   everything else was fixed.

2. **Anything that drives time of day must call `window.applyTimeOfDay`, never a
   module-local copy.** Five passes wrap the window property to retint their own
   geometry. Calling the local original is why the Tower "took five minutes to
   turn orange" — it was never asked to.

3. **`scripts/verify/zfight.mjs` cannot see texture crawl.** It gates candidates
   on a flat 3x3 neighbourhood, which is right for a z-fighting surface and
   structurally blind to a shimmering window grid. Use
   `scripts/verify/shimmer.mjs` for anything that moves under camera motion.

4. **A green test on known-broken code is the only real proof a test works.**
   `retint.mjs`'s first assertion passed on the broken build, because sky and
   ground always did retint and they dominate a frame mean. Always run a new
   assertion against the bug it is meant to catch before trusting it.

Two traps recorded in the scripts themselves rather than here:
`scripts/reseat_authored_roofs.py` (deleting 274 roof facets would have flattened
Gregory Gym and the Union Building to fix a bug they did not have) and
`scripts/bake_detail.py`'s part coverage gate (scaling a part up to
`final_height` is worse than either failure).

**Non-bug, do not chase:** `js/graphics.js` does NOT call the broken
`transform.horizonLineFromTop()`. It reads `F.horizonPx` from `window.skyFrame`,
built by `js/sky.js:166-171` from the correct closed form.

### Acer overnight, part 2 — PR #33

Finished the rest of Simeon's list. Four more rules worth carrying:

5. **A DOM overlay cannot be depth-aware.** `#fx-dof`, the sun disc and the old
   haze band are all viewport rectangles composited over the finished frame, so
   any hard edge in one reads as a line drawn *over* the city. Feather them or
   accept the line; there is no z-order that fixes it.

6. **`window.__fly.eye()` does not resync after a `jumpTo`.** It is maintained by
   the flight controller's own loop. Correct in normal flight, stale in any
   scripted pose — two poses probed back to back both returned the previous
   camera even after a 4.5 s settle. `map.getFreeCameraOptions()` is worse: it is
   a MAPBOX api and MapLibre 5.24 does not have it, so inside a try/catch it
   throws every frame and the catch silently swallows the whole feature.

7. **Check the numbers before deleting geometry.** The first roof fix deleted 274
   pitched facets; 222 of them were correct and it would have flattened Gregory
   Gym and the Union Building to fix a bug they did not have.

8. **"Authored top" is the wrong anchor on anything with a mast or a peak.**
   Naively it wants to lift DKR's roof deck 81 m onto a floodlight and Moody's
   19 m onto the arena ridge. `scripts/reseat_authored_roofs.py` refuses both and
   prints why.

Also: `js/outer.js`'s low-rise half masses into a featureless brown plane above
~80 degrees of pitch and is now faded out there. That was pre-existing and was
only reachable after the pitch ceiling went to 90 — verified by reverting the
tiling change and rendering an identical frame.

---

### Acer, 2026-08-01 — payload, roofs, GL. PRs #34-#37, none merged.

Four branches, four PRs, deliberately small: `acer/cloud-proposal` (#34),
`acer/no-double-fetch` (#35), `acer/buried-roofs` (#36),
`acer/perf-hardware-gl` (#37, stacked on #34 — merge #34 first).

Also on `main`, docs-only: `MAC_QUEUE.md`, six items for the other machine with
a file-ownership table, so both lanes can run at once.

**Nine more rules, and the first four are one rule wearing different clothes.**

9. **An instrument's defaults are part of its result.** Three headlines had to be
   walked back today, all before publishing, all caught by running the thing
   rather than reasoning about it:
   - `content-length` counts a cache hit at full price, so the first payload
     measurement priced free bytes as savings;
   - a CDP session opened on the **page** target cannot see MapLibre's **worker**
     fetches, which is most of the app — it reported 7.22 MB for a 28.41 MB load;
   - `perf.mjs` throttles the CPU **4×** by default, and its output read as real
     performance. Unthrottled the app sits at the 18.0 ms vsync floor with every
     delta at 0.0.

10. **A duplicate request in flight is never cacheable.** `js/capitol.js` fetched
    `trees.geojson` and `ground.geojson` a second time to concatenate features
    for `setData`. The obvious objection is that a repeat seconds later is a free
    cache hit — GitHub Pages sends `max-age=600`. Tested against exactly that
    header: **0 from cache**, both times. MapLibre's worker starts the source
    fetch and `initCapitol` starts its own moments later, so nothing is cached
    yet to serve the second from. 9.95 MB, 25.9% of a first-time visitor's
    download. `updateData({ add })` appends a diff instead.

11. **Most-specific polygon wins.** `reseat_authored_roofs.py` matched a roof to
    whichever containing footprint the grid listed first. 131 of 2,831 roof
    centroids (4.6%) sit inside two footprints, so a roof correctly seated on a
    low wing got attributed to the tall neighbour and read as buried. Both
    reported "buried roofs" were this. Neither was a defect.

12. **Check the stated cause before fixing it.** The queue said a roof was buried
    because `final_height` changed under it. `3fb4507f` has read 24.8 in every
    snapshot back to 2026-07-10.

13. **The software rasteriser does not just make things slower, it reranks
    them.** Same scene, same 4× throttle: on SwiftShader the vignette is 51% of
    the frame and the basemap section is never even reached; on the GPU the
    vignette is 15–29% and the OpenFreeMap basemap is the largest single cost,
    more than double all our own extrusions. Every frame-time A/B in this file
    that predates PR #37 was ranked against the wrong profile.

14. **`gl:` and `args:` are orthogonal now.** `opts.args || GL_ARGS` was fixed
    once for callers passing no args; it still replaced for callers passing some.
    Four timing scripts pass an anti-throttling set and so selected no backend at
    all — ANGLE's default is hardware, but without `--force_high_performance_gpu`
    a laptop hands it the **integrated** chip. Measured: same script, own args,
    AMD Radeon; add `gl:'hardware'`, NVIDIA RTX 3050 Ti.

15. **`scripts/verify/node_modules` can be empty.** It was, today. All 187
    scripts fail with a missing `playwright-core` and it looks like a code
    regression. `cd scripts/verify && npm ci` first, always, before triaging a
    "broken" harness.

16. **Vector tiles are a project, not an evening.** `QUEUE.md` item 1 is
    re-specified with three blockers found by reading the load path:
    `quantiseFacades` elects the 14 most populous window tones across the *whole*
    city and is incoherent per-tile; `mergeCapitolScene`, `applyUnion24` and the
    label dedupe all need every feature at once; tippecanoe is not installed on
    the Acer; and `capitol.js` appends Capitol trees with `updateData`, which
    does not exist on a vector-tile source. Also: tippecanoe **simplifies
    geometry at low zoom by default** — a visual-quality change hiding inside a
    delivery change.

17. **New instruments, both with their failure modes in the header:**
    `payload.mjs` (what a visitor downloads, duplicates first),
    `capitol-merge.mjs` (guards a silent failure — if the Capitol append breaks
    you cannot tell from campus), `gl-check.mjs` (asserts each launch shape gets
    the backend it asked for, because that bug has now shipped twice).

---

### Acer, 2026-08-01 night — performance. PRs #41, #44 merged.

Two lanes running at once for the first time, both self-merging (CLAUDE.md rule 2
changed at Simeon's instruction). Acer: `acer/tiles-pipeline` (#41),
`acer/basemap-cull` (#44). Mac: roads and outer ring, in parallel.

**Where the load actually goes.** 7.1 s on localhost, hardware GL — not the 15 s
that had been repeated all day:

    0.0 - 1.6 s   page + style
    2.1 - 3.7 s   six init passes, CONCURRENT (1.6 s wall, not the 8.5 s they sum to)
    3.7 - 7.1 s   worker tiling + first render   <- the biggest slice

Trees + roads tiled: **28.41 MB -> 16.14 MB, 7.1 s -> 6.0 s.**

**Rules 18-23.**

18. **`quantiseFacades` is 14 ms.** It had been described all day, by me, as the
    expensive pass blocking tiled buildings. It is a **correctness** blocker —
    the 14 colour buckets are elected across the whole city and cannot be elected
    per tile — and not a performance one. Measure before repeating a claim about
    cost, including your own.

19. **Concurrent or stacked is the whole question, and 0.1 s precision hides it.**
    Six init passes cost 1.28-1.60 s each and sum to 8.5 s. Printed to 0.1 s they
    all read "+2.1 s". Printed to the millisecond they start within 7 ms of each
    other and end within 320 ms — 1.6 s of wall clock. The difference is seven
    seconds of imaginary optimisation.

20. **Four readiness metrics, three of them wrong, each changing the answer.**
    `once('idle')` reports 37 s because the sky canvas repaints every frame and
    the map is never idle. `areTilesLoaded()` is not comparable across builds —
    with GeoJSON the tree source has not begun fetching when first asked, so it
    answers "loaded" and the un-tiled build scores artificially fast, which
    produced a 3x difference that was entirely metric. `loaded()` never fires on
    a throttled connection. `isSourceLoaded` per source over our own sources is
    comparable by construction.

21. **The basemap cannot be culled and the cullable part is free.** Hide it all
    and the ground turns black — it *is* the surface beyond the modelled area.
    Culling the seven genuinely-invisible layers saves 0.1 ms, because occluded
    fills were already being discarded. Also `perf.mjs`'s "minus basemap" is
    inflated: its prefix test misses `wc-` and `night-`, so it hides five of our
    own layers and charges them to the basemap.

22. **`python -m http.server` cannot test this site any more.** It ignores
    `Range:`, which PMTiles needs, so every feature in a tiled layer silently
    vanishes with no console error. A treeless campus was photographed and
    briefly believed. Use `python scripts/serve.py 8123` — ranges, GitHub Pages'
    cache headers, and `NET=4g`/`NET=3g` throttling in `boot.mjs`, because on
    localhost there is no bandwidth limit and tiling looks worthless.

23. **HTTP/1.1 on a single-threaded `HTTPServer` deadlocks it.** Keep-alive means
    the first connection holds the socket and everything else queues forever;
    every script then times out at its watchdog, looking exactly like the app
    being broken. `ThreadingHTTPServer`. Self-inflicted, ten minutes.

**A vector source cannot be appended to.** `updateData`/`setData` are
GeoJSONSource methods, so the Capitol's 612 trees had nowhere to go once
`austin-trees` was tiled — silently. They now get their own source and a **clone**
of every layer drawing the base one, taken from `getStyle()` at runtime so the
two cannot drift.

---

### Acer, 2026-08-01 late — the worker queue. PR #47 merged.

**MapLibre was using ONE worker on a sixteen-core machine.** `boot.mjs` now
records when each source becomes usable — fetch *plus parse plus worker tiling*,
and only the first of those shows in a waterfall. Every one of our 22 sources
finished between 3.8 s and 6.7 s, tiny ones and huge ones alike, with
`austin-buildings` unremarkable in the middle. Sources of wildly different sizes
finishing together is a **queue**, not a size problem.

    workers=1   6747 6574 6539 6543 6358    min 6358 ms
    workers=4   5825 5507 6414 5736 6083    min 5507 ms
    workers=8   5871 6855                   worse than 4

Four won all five reps. Eight is worse — past that the scheduling costs more than
it saves. Scaled to half the cores, capped at four, so a two-core phone does not
get four workers and spend its time context-switching.

**Tonight, end to end:** 28.41 MB → 14.16 MB, 7.1 s → 5.5 s to data ready. The
loading screen lifts at 6.1–7.1 s, so it is roughly honest about the wait rather
than padding it.

24. **Sources of different sizes finishing together means a queue.** It is the
    single most useful shape to recognise in a load profile, and it is invisible
    unless you time each source rather than the whole boot.

25. **`quantiseFacades` is 14 ms** (repeated from rule 18 because I got this
    wrong all day). Tiling the buildings is blocked on **correctness** — the 14
    colour buckets are elected across the whole city — not on cost.

26. **The remaining slice is worker tiling of whatever is still GeoJSON**, and it
    shrinks with each layer the Mac lands. There is no separate trick left to
    find: 0–1.4 s is the third-party style, 1.4–2.1 s scene load and quantise,
    2.1–3.7 s six concurrent init passes, 3.7–5.5 s the worker.

---

### Acer, 2026-08-01 night — the Drag was white after dark. PR #53.

**One missing line.** `js/drag.js` built its time-of-day wrapper and never
assigned it: `window.applyTimeOfDay = wrapped` is present in arts, moody, outer,
places, tower and westcampus, and was absent in drag. So `applyDragColors` was
never called by the retint, the Drag's tiles were never re-uploaded, and the
Guadalupe streetwall rendered near-white against a black city.

    Drag tile uploads during a slider retint   0 -> 10
    pale pixels below the horizon           6206 -> 1906

27. **A flag set NEXT TO the thing it claims to describe is worth nothing.**
    `window.__dragTodHooked` was `true` for the entire period the hook did not
    exist — it is set two lines under the missing assignment. Three separate
    signals said "hooked" (the flag, the function existing, a manual call
    working) while the retint chain had never heard of the pass. **Assert the
    effect, never the intention.**

28. **I spent an hour on four wrong fixes before checking whether the function
    was called at all.** A second tile-push on rAF, on `idle`, on timers, and
    with a `setPaintProperty` write to force an atlas rebuild — all four reverted,
    all four retrying a function that was never invoked. When a fix does not move
    the number, stop tuning it and check the layer below.

29. **`scripts/verify/night-pale.mjs` is how it was found.** Counting bright
    pixels says there is a problem; it does not say where. Hiding one pass at a
    time and re-counting does. `drag-*` was 55.8% of every wrongly-bright pixel.
    `night-silhouette.mjs` exists for this class of bug and **could not run** —
    it is one of the fifteen dead scripts, which is the real reason this shipped.

30. **`grep -c 'window.applyTimeOfDay = wrapped' js/*.js` against
    `grep -c 'const wrapped = function'`** is a five-second lint that would have
    caught this. Filed as QUEUE item 10's opener and on both lanes' lists.

**Tonight, end to end:** 28.41 MB → 12.08 MB, 7.1 s → 5.6 s, trees + roads +
roof detail + props tiled, MapLibre's single tile worker scaled to four, and the
Drag dark at night. Outer ring and buildings both remain, both blocked on the
same thing: a browser-side pass stamps facade properties that tiles cannot carry.

---

# 2026-08-02, Acer lane — Part A of QUEUE.md, and the first of Part B

Six PRs, all merged. Branches deleted. Every one was found by looking at the
thing rather than by reasoning about it, and three of them turned out to be
something other than what the report said.

31. **`acer/focus-kills-movement` (PR #54) — A1, and it was never hardware.**
    "on acer when i change daylight i can't move anymore." `controls.js`
    swallowed every keystroke for any `INPUT|SELECT|TEXTAREA|BUTTON`, and this
    app's only form controls are a checkbox, the daylight slider and the play
    button — none of them a text field, none of them does anything with W. Touch
    the slider, it keeps focus, WASD is dead until you click the canvas.
    **macOS does not focus a button or a slider on click; Windows always does.**
    Same build, dead on one machine, fine on the other. `movement.mjs` had the
    defect written down as a PASSING assertion, which is why it survived.
    New `scripts/verify/focus-move.mjs` sets focus explicitly rather than
    clicking, because a click-based test would pass on the Mac with the bug live.

32. **`acer/speedway-fan` (PR #55) — A3.** A `line-width` is screen pixels and
    the same number for the whole line; 9.1 m of Speedway near the camera is many
    pixels and 9.1 m of it by Dean Keeton is a few. Measured with the new
    `road-fan.mjs`: **1.26x near → 3.33x far at pitch 60, 3.69x at pitch 86.**
    It *looks* worse as you lie the camera down not because the ratio moves —
    it barely does past 60 — but because pitching over drags the far, wrong end
    of the road into frame. Paths are buffered into polygons in the bake now;
    `ground.geojson` got SMALLER, 856 → 784 KB. **Roads still carry the identical
    defect: `node scripts/verify/road-fan.mjs ground-road`.**

33. **The first cut of `road-fan.mjs` sampled the map CENTRE and reported a flat
    1.00x at every pitch.** True, and useless — `widthExpr` is derived from the
    centre-scale relation, so it agrees there by construction. A probe that
    cannot see the defect is worse than no probe.

34. **`acer/tower-clock-night` (PR #56) — A4, half fixed and half impossible.**
    The bezel is not a ring: its five slabs are chords, so it is a solid 5.6 m
    DISC, and a previous pass took it near-white at the same time as the dial —
    two near-white surfaces one behind the other is one blob. Dark bronze bezel
    fixes the READ. It cannot be made to GLOW: MapLibre 5.24 rejects
    `fill-extrusion-emissive-strength`; `#f2ecc8`, `#ffffff` and `#ffd27a` all
    render the identical `rgb(189,180,163)`; and the bloom threshold keeps only
    inputs above luma 199 while the night light caps a lit vertical face near
    115. **The bake's stated plan — go near-white and bloom picks it up — could
    never have fired.** Also `bloom` is 0 on the `performance` preset.

35. **I built the dial as stacked slabs on a theory that horizontal top faces
    take more light, and it measured WORSE (97 vs 103).** Reverted. The bezel
    was brighter for the dull reason: its colour was. Test the theory, then keep
    the change only if the number moves the right way.

36. **`acer/diagonal-roofs` (PR #57) — A5, and it is Edgar A. Smith, not
    Blanton.** One spurious footprint vertex 2.1 m from its neighbour, edges
    0.13° apart. `clean()` tests `sin(turn) > 0.002` and sin(0.13°) is 0.0023 —
    it cleared by a hair. Then the 2.1 m edge is shorter than twice the 4.48 m
    inset, the offset crossed itself, and `valid_step` dropped **the whole 36.1 m
    north slope**. An angle threshold is scale-blind: 0.13° over 2 m is 5 mm of
    noise, over 200 m it is 45 cm of building. Now measured as a **sagitta in
    metres**. **1,050 of 2,455 footprints** carried such a vertex.

37. **A6 needed no change.** Battle Hall's roof is terracotta and always was.
    The grey roof is the **West Mall Office Building** next door, which really
    does have a flat grey membrane roof — the two labels sit side by side over
    the gap between them.

38. **`acer/art-not-boxes` (PR #58) — B1.** All 34 Landmarks pieces were one
    extrusion in one flat colour. `scripts/bake_art.py` emits 350 parts: ten
    per-piece recipes plus a rule keyed on `artwork_type`. Kelly's *Austin*
    ignores its footprint on purpose — OSM has it as a buffered node at 6 x 6 m
    and the building is 18.3 x 8.2. **The chromatic circle is on all three
    glazed walls**, because from a flying camera you do not choose your face.

39. **A2 was diagnosed and handed to the Mac rather than fixed here.**
    `TIERS.mid` in `js/lod.js` hides `buildings-roof`, `parts-roof` and
    `outer-tower-roof` — those are not detail, they are the CAP over every
    extrusion's top face, and the walls carry `fill-extrusion-pattern`, which
    MapLibre paints on the top face too. Hide the cap and the roof becomes the
    window grid. Three candidate fixes written into MAC_QUEUE M4.

40. **`scripts/verify/pose.mjs` is new and worth knowing about.** Photograph any
    pose named on the command line, one browser and one load for the whole list.
    Looking at one thing from somewhere specific no longer means editing
    `tour.mjs` and then editing it back. Note `tour.mjs` itself needs
    `VERIFY_MAX_MS=900000` — twelve poses exceed the 300 s default watchdog.

# 2026-08-02, Acer lane — second pass

41. **`acer/ground-depth` (PR #62) — B4, and the answer is yes.** A step is a
    thin extrusion at a raised base; nothing new was needed. `bake_depth.py`
    has `terrace()` and `flight()` and the generator is the point, not the
    fountain. **Everything builds UP**: buildings start at z=0 with no terrain,
    and a `fill` does not depth-test against a `fill-extrusion`, so anything
    sunk below the datum is painted over by the flat ground above it.

42. **Four render-caught mistakes in that one pass, none of which reasoning
    would have found.** (a) `pick` lives in props.js, not ground.js — it threw
    and the WHOLE ground stage silently failed to build; the screenshot merely
    looked bright. (b) Courses 140 mm apart rendered as one flat blob — what
    carries a flight from the air is light/dark BANDING, not height. (c) Tan
    steps on tan paving are tan paving. (d) The water never drew: colouring it
    magenta gave ZERO pixels even with the coping hidden, because a course
    1.15 m tall was a solid plug over water at 1.02 m.

43. **`acer/giant-hedge` (PR #63) — chasing the turtles found something
    bigger.** Turtle Pond renders as lawn. The feature is present, is returned
    by queryRenderedFeatures on `ground-areas`, has the right draw order and the
    right palette — and filtering that layer to the pond alone did not change
    the pixel, so it was never the ground layer. **Hiding one layer at a time
    named `props-line` in a single pass.** `bake_props.py` draws a tagged
    planting AREA as a raised mass and OSM tags landscape blocks
    `leisure=garden`: three slabs of 457, 2,406 and **12,569 m²**, the largest
    sitting on the pond. Median line prop is 10 m² and p90 is 29, so a 150 m²
    cap separates them with a clear gap.

44. **A full `bake_props.py` re-bake on the Acer produces 2,244 features
    against the shipped 9,022** — it needs city inventory data that is not in
    the local cache. The rule went into the bake for next time; the shipped file
    was edited surgically, three features, nothing else. **Check the feature
    count after any re-bake before committing it.**

45. **B3 was abandoned once and then reopened.** The first stop was right —
    turtles on grass is worse than no turtles — but the write-up said "draw
    order and palette are innocent, one unfollowed lead". Following that lead
    took twenty minutes and found a 1.25-hectare bug. **When a probe says "it is
    not any of the things I checked", that is a result, not a dead end.**

46. **`acer/creek` (PR #65) — B6/A7, and the pass had shipped dead code.**
    `js/ground.js` carried a `creek` and a `pond` colour in all three palettes
    plus a whole `ground-creek-bank` layer with a paragraph justifying it — and
    **nothing had ever set `s` to either**. Every water area was `s:"water"`, so
    the bank layer matched nothing and had never drawn a pixel. Classified now
    by the isoperimetric quotient Q=4πA/P²: seven creeks at Q ≤ 0.036, five
    ponds at Q ≥ 0.183, a five-fold gap. Plus a 9 m wooded band either side.

47. **`acer/turtles` (PR #66) — B3, and a theory that died in the measurement.**
    I read the pond as rendering warm grey against an authored `#7fa8bb`, wrote
    it up as the colour grade crushing blues, and changed the palette. Both
    readings sampled the wrong pixels: an oblique crop of a thin ribbon, then
    two shots at DIFFERENT ZOOMS compared pixel-for-pixel. Masking properly —
    paint it magenta, keep those 69,967 indices, read the same set back — gave
    `#7fa8bb → rgb(126,163,175)`, near-faithful. Reverted.

48. **The magenta-mask trick is the tool to reach for.** Paint the thing under
    test an impossible colour, record which pixels changed, then read that exact
    set back under each candidate. It found the buried fountain water, it named
    the 12,569 m² hedge, and it killed the pond-colour theory. Sampling a
    hand-picked box has now been wrong three times in one night.

49. **`acer/power-plant` (PR #67) — B7, and it was never construction.** North
    of the Drama Building the snapshot already had `Hal C. Weaver Power Plant`,
    its Annex, `Cooling Tower 1` and `UTM Cooling Tower 2`. It is UT's
    chilled-water plant, rendered as four boxes on a bare yard — and the
    "circular area with stuff" is the FAN DECKS on the tower roofs. Work out
    what a place is from the data before deciding what to draw there.

50. **A BOUNDING BOX IS NOT A SHAPE.** Both cooling towers are long thin
    rectangles rotated ~20 degrees. Sizing from an axis-aligned bbox drew a
    handrail visibly larger than the building it sat on and threw the fan decks
    clean off the roof into the yard. Measure along the footprint's own longest
    edge. This is the second time tonight a footprint's real geometry mattered
    and its bbox lied — see also the sagitta fix in bake_roofs.

51. **A LEVEL RUN HAS NO HEIGHT.** `beam()` spreads z0..z1 across its steps, so
    a pipe from 4.6 to 4.6 is a stack of zero-height slabs and `add()` drops
    every one. It reported `plant_pipes: 0` rather than failing.

52. **The magenta-pixel threshold has to allow for lighting.** Counting
    `r>150 && g<100 && b>150` under-reports badly, because MapLibre lights a
    fill-extrusion and the warm day light pulls magenta's blue channel under
    150. Use a mask captured once, not a per-frame threshold, or widen it.

53. **`acer/kelly-lawn` (PR #69) — B2.** The chapel sat on a 38x54 m lawn in an
    expanse of bare tan base ground. The lawn is GROWN out from the mapped one
    until it meets the walks and the buildings, so the panel is derived from the
    site rather than drawn freehand. **Ordering trap:** at that point in the bake
    paths are still LineStrings — `widen_paths` polygonises them LATER — so they
    are buffered by their own `w` here or the lawn swallows every walk.

54. **`acer/sidewalks` (PR #70) — B8.** Footways were flat fills in the SAME
    PLANE as the asphalt, so a sidewalk was a painted rectangle rather than a
    thing you step onto. Now a 0.22 m fill-extrusion. It replaces the fill
    rather than adding to it, so no extra pass, and it depth-tests against roads
    and buildings where a fill does not.

55. **C1 is SIZED, NOT STARTED, and that is deliberate.** The 114-line
    `quantiseFacades` is a straight transcription; the pipeline ORDER around it
    is the hard half — it runs after `mergeCapitolScene` appends 604 buildings
    and registers `FACADE_PROTECTED`, and after `applyUnion24` rewrites a
    footprint. Parity has to be proved across 7,625+ features. Measured prize:
    **14 ms and 1.41 MB of a 9.74 MB payload.** Do it FIRST in a session.

56. **Final sweep, 2026-08-02.** `tour.mjs` day, dusk and night all 12/12 clean.
    `night-pale.mjs`: **872 pale pixels**, against 6,206 before the Drag fix and
    1,906 after it. The only remaining contributor is `stadium-*` at 12.4%
    (154 px, all `stadium-detail`) — the Mac's file, and it has a DKR night pass
    in flight. The night scene is otherwise clean.

57. **Still visibly wrong, from the dusk frames:** the far outer ring reads as a
    flat tan band with a hard horizon line. It is the one thing in the three
    sweeps that looks unfinished, and it is `js/outer.js` — the Mac's file.
