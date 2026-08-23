# K7 — the "floating blob/cuboid family", identified object by object

Branch `acer/k7-floater`, 2026-08-22/23, port 8651, `harness-drift.mjs` PASS
before any pixel work, one browser at a time. Evidence: `shots/k7/floater/`.
Every claim below was proven by hide-and-diff (HANDOFF §48's discipline) at a
reproduced pose, not by reading paint expressions. **No code or data was
changed in this lane** — the mask put every member outside this lane's
write-set; the owners and the exact fixes are named per member.

The "family" is not one defect. It is four different objects in three
different subsystems that all read as "a small thing hanging where nothing
should be".

## 1. THE PHOTOGRAPHED ONE — the sky teardrop left of downtown in phone Shot A

`shots/f/ship/phone-autopilot-10s.png`, on production. Zoom:
`crop-phone-blob.png`, `floater-x6.png` — a patterned tower top (stepped
crown + mast) with a smooth, curved, tapering cut below it, hanging in
empty sky.

**It is the top of the Sixth & Guadalupe supertall** (outer ring's tallest
stack, at −97.74669, 30.26956: podium 0–18.7 m, patterned shaft 18.7–196.5,
blocks to 225.5, `k='c'` crown 225.5–237.5, mast 237.5–267).

- `compare-ship-vs-repro.png` — LEFT: the ship lane's committed frame with
  the teardrop. RIGHT: the same Shot A pose reproduced and left to settle —
  the full tower stands exactly under the teardrop's position, same crown,
  same mast. Independently reproduced twice (`repro-10s.png` +
  `zoom-repro10s.png` vs `zoom-committed10s.png`, this session, lift+10 s at
  390×844 with touch).
- `frz-f5-towerdiff-x4.png` — at a frozen mid-stream pose the teardrop's own
  pixels diff with the outer tower family and nothing else.
- The archive is NOT missing the shaft at any level: rendering downtown from
  the z13/z14 parent tiles (`lowz-frame.png`) and querying the rendered tiles
  returns the complete contiguous stack 0→267 m. So this is not a bake hole.

**Mechanism**: a MapLibre streaming transient. While `austin-outer` children
stream in, the parent-tile copy of the tower is masked per-pixel against
already-loaded child tiles; the shaft's pixels (which project over loaded
ground) are clipped away, the top (which projects over sky) survives, and the
cut follows the mask edge — hence the curved taper, impossible for a real
`fill-extrusion` base. It heals the moment the covering tiles finish, which
is why every settled repro shows the whole tower. It is on camera because
Shot A records DURING streaming — the same window QUEUE Z1 documented as the
"slide-in". **Owner**: engine behaviour + Shot A's veil/prewarm timing in
`js/app.js` (Z1 territory; the prewarm PR already narrows the window; the
full fix is the same lever Z1 names — do not lift until `austin-outer` has
its route, ceiling permitting — plus accepting it cannot be closed to zero on
a slow network with a 24 s ceiling).

## 2. THE PERSISTENT ONE — a slab + mast floating over downtown at Shot A's own final pose

At the AP_TOUR end pose (−97.7424, 30.2766, z16.05, pitch 69, bearing 194,
phone aspect) with EVERY tile loaded, cinematic, `outerDensity` 1:
`park-cin.png` / `zoom-park-cin.png` / `zoom-huntb-05s.png` — a flat-coloured
slab with a mast hangs over the skyline. Hiding ONLY `outer-detail` removes
exactly it (`park-nodetail.png`, `zoom-park-nodetail.png`).

**It is a baked data defect in `data/outer_ring.geojson`** (written by
`scripts/bake_outer.py`, PASS D; streamed to the app as
`data/tiles/outer.pmtiles`): a support-scan of all 9,149 features (does any
feature under an elevated piece reach its base?) finds **exactly two** `k='c'`
crown stacks that start above their shaft's top, out of 464 elevated pieces:

| tower | shaft top | crown stack | gap |
|---|---|---|---|
| −97.74602, 30.26868 | 168.0 m | 179.0→188.2→205.7 | **11.0 m** — the visible slab+mast |
| −97.74321, 30.26860 | 102.5 m | 106.3→111.8→122.2 | 3.8 m — a thin dark seam, barely visible |

`zoom-box.png` shows the 11 m sky gap between the slab and its own shaft's
top at ~1.06 m/px. **The whole-family rule for the owner**: at bake time,
snap each tower's detail-stack base onto the top of the wall below it (or
assert support and fail the bake). It fires on exactly these 2 towers
(4 features) city-wide and deletes nothing — verified against every other
elevated feature in the file. **The bake trap applies in full**: the app
streams `outer.pmtiles`, so editing the geojson without re-running
`scripts/tile.sh` (tippecanoe — not installed on this machine) ships nothing;
that is the reason this lane did not attempt the data edit. `?tiles=0` is the
A/B for verifying a fixed geojson before the retile.

## 3. THE GREEN CUBOID near Kinsolving (`sw-introend-*`)

`iso-introend-base.png` reproduces the sweep frame; the box is at
(−97.73688, 30.29312), on Waller Creek east of Kinsolving. Hiding
`ground-creek-canopy` removes exactly it (`mask-introend-before/after.png`,
`mask-introend-sbs.png`; 29% of the bbox changed, remaining diffs are other
creek crowns city-wide).

**It is a creek-canopy crown from `bake_ground.py`'s CANOPY block** (`k='cnp'`,
`m='cypress'`, h = 23.6 m): an 8-sided prism drawn from 0.34·h to h in flat
`crownColour`. It is well-formed data — one of 465 creek crowns, 138 of them
taller than 18 m — but this one stands alone at building scale among
buildings, so it reads as a green box, where its siblings sit in the tree
corridor and read as canopy. **Owner**: `bake_ground.py` / `js/ground.js`
(taste: cap or subdivide isolated crowns, or nudge `crownColour` toward the
tree palette). Not floating, not junk-height — a taste call for its owner,
not a delete.

## 4. THE PALE NIGHT BLOB on a downtown roof (`sw-downtown-night` ~x515,y580; `sw-H5-dkr-night` ~x1135,y425 — same object, two poses)

queryRenderedFeatures at the pixel returns the **Bullock Museum dome** —
`capitol-dome` layer, parts `bullock-drum`/`bullock-dome` (baked by
`scripts/bake_capitol.py` into `data/capitol_dome.geojson`). Hiding
`capitol-dome` removes exactly the blob (`mask-dtnight-before/after.png`,
`mask-dtnight-sbs.png`).

**Mechanism**: the dome's night colour is *lighter* than its day colour
(`wn #bc9a6c` vs `wd #82756a`) — the Capitol's floodlit-at-night treatment
applied to the whole file — while the museum under it drops to `#23242a`. A
warm-lit dome on a black building reads as a detached glowing blob. **Owner**:
`scripts/bake_capitol.py` — either give the Bullock parts a dark night trio
like their building, or (if the dome is genuinely lit) also lift the drum so
it connects. One authored colour, CLAUDE.md rule 11.

## Why this lane shipped no fix

The task authorised writing "whichever ONE file the mask proves owns it
(js/props.js, js/art.js, js/places.js, js/roofs.js or a bake that writes its
data)". The masks prove none of the four owns any member: the owners are
`js/app.js`/engine (1), `bake_outer.py`+retile (2), `bake_ground.py`/
`js/ground.js` (3), `bake_capitol.py` (4). `js/outer.js` itself is the
k7-greenring lane's file this round, and the outer fix is unverifiable here
without tippecanoe (bake trap). A refusal with evidence over a fake fix.

## Not established

- Whether the transient (1) can appear at other flight moments/towers — only
  the photographed tower was reproduced; any streaming-lagged supertall
  should be capable of it.
- The exact MapLibre internals of the parent/child mask clip (named as the
  probable mechanism from the curved cut + heal-on-load; not traced in
  engine source).
- Whether the delivered reel runs long enough to show member (2)'s parked
  pose; it IS at Shot A's authored final waypoint, so any full-length take
  ends on it.
- Nothing about motion/shimmer, hardware GL, or dpr-2 — SwiftShader stills
  only (phone-aspect 390×844 with touch where stated).
- The reel shots were not re-gated: this branch changes docs and shots only,
  no code or data.
