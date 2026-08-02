# QUEUE — Acer lane

Rewritten 2026-08-02 morning, from Simeon's second list. Everything above this in
git history is superseded. The night's first list is closed — see `HANDOFF.md`
items 31–57 for what landed and, more usefully, for the four or five reports that
turned out not to be what they said.

Work top to bottom. One PR per item. Merge your own verified work, resolve your
own conflicts, **never merge red**. If an item cannot be finished, write down why
in the item and move to the next — do not stop.

**The Mac owns `js/outer.js`, `js/stadium.js`, `js/lod.js`, `js/facades.js`,
`scripts/tile.sh` and `.github/workflows/`.** Stay out of those.

---

## Read the tone before reading the list

> "not the bare minimum" · "I don't even want to check out the other landmarks"
> · "this is not a fix trees in roads pass its a more general pas"

Three separate times he is saying the same thing: **the last pass stopped at the
first thing that worked.** Depth beats breadth here. One landmark that is
genuinely right is worth more than ten that are schematic.

## The traps that keep costing hours

1. **`python -m http.server` cannot test this site.** It ignores `Range:`, so
   every feature in a tiled layer vanishes with no console error. Use
   `python scripts/serve.py 8123`.
2. **A missing layer makes every metric look BETTER.** Verify with a picture.
3. **Assert the effect, never the intention.**
4. **A bounding box is not a shape** (HANDOFF §50). **A level run has no height**
   (§51). **Sample the pixels you mean** — the magenta-mask trick, §48, which
   caught four things last night that eyeballing missed.
5. `tour.mjs` needs `VERIFY_MAX_MS=900000`. `pose.mjs --extra "&tiles=0"` forces
   the GeoJSON fallback when you have changed a tiled layer.
6. Tiles rebuild with `gh workflow run build-tiles.yml --ref BRANCH` — about
   20 seconds, and it commits the archives back to that branch.

---

# PART A — THINGS THAT ARE WRONG ON SCREEN

## A1. At least THREE diagonal roofs remain

PR #57 fixed the sagitta rule and cleared the Edgar A. Smith Building. He says
there are **at least three** more. The rule fix was right and incomplete.

**Do not hunt by eye.** Write `scripts/verify/roof-diagonal.mjs` that finds them
mechanically: for every building with pitched facets, check the facet azimuths
cover all of the footprint's edges. A roof missing a slope has a gap in its
azimuth set — exactly what Smith had, three of four. Report every failure, then
fix the *rule* that produced them.

Causes not yet ruled out: `valid_step`'s 0.9 clearance factor, `fold_free_run`
capping, and footprints whose longest edge is not their principal axis.

## A2. Speedway and 24th glitch on motion, combine when still

*"speedway and 24th keep glitching on motion and combine on still, find out
other areas like this and fix"*

Two symptoms of one cause: **coincident surfaces z-fighting.** Speedway is a
`patharea` polygon lifted to 0.22 m (PR #70); 24th is a road still at 0. Where
they cross, the depth test flips per frame — that is the motion glitch — and when
still it resolves to whichever won, which is the "combine".

**Find the general class, not the two streets.** Walk every pair of ground
polygons and report overlaps within a few centimetres of the same height. Then
pick one rule: a deliberate height ordering (roads < paths < plazas), or clip the
overlap out in the bake. Roads are the half that has not moved.

## A3. Trees standing in roads — the general pass

*"this is not a fix trees in roads pass its a more general pas"*

`shape_trees.py` drops trees whose centre falls inside a **building**. It checks
nothing else. Extend it to every surface a trunk cannot be in — road, path,
plaza, parking, water — report the count per class, and keep the check in the
bake so it cannot regress.

A crown OVERHANGING a road is correct and common. Only the trunk position is the
test. Do not over-delete.

## A4. Big trees in the lawn in front of the Tower

*"get rid of big trees in the lawn in front of tower"*

The South Mall lawn panels are open grass; the canopy belongs on the flanking
walks. Drop the trees inside the Main Mall / South Mall lawn polygons. Same
mechanism as A3 — a surface a tree does not belong in — so generalise once and
apply twice.

## A5. The fountain steps look like a yoga mat

*"stairs next to foundtain looks like a yoga mat. If this needs a broader depth
fix do that - but make them accurate"*

He is right, and the reason is written in PR #62: the courses are wide flat bands
of alternating colour. That is a stripe, not a stair. What a real flight reads as
is a **riser face in shadow** under each tread.

**Fix the generator, not the fountain.** `terrace()` emits one slab per course;
it should emit a **tread and a riser** — the riser a thin darker band at the
step's outer edge standing the full step height — so the profile has an edge to
catch light. Then re-measure the Littlefield Fountain against a photograph:
tread depth, riser height, how many, and whether the flights are straight or
**curved. They are curved.**

## A6. Turtle Pond: fewer turtles, and that garden is bland

*"turtle pond too many turtiles, fix this lawn in general its really bland"*

Twelve is too many for 218 m² of water — five or six, with more size spread.
Then the harder half: the Memorial Garden block is a flat green rectangle. It is
a *garden* — beds, a path loop, benches, specimen planting, a built pond edge.
PR #63 only removed the slab that was hiding it; nothing has been drawn there.

## A7. Waller Creek is not a bit of green

*"you added a bit of green around the creeky water when i asked for more than
just that ... the creek behind patton and alumni is a very vibrant in depth
creek, samd with the area behind san jacinto and the rec center and the track
that area also very lush ... not the bare minimum"*

PR #65 gave every creek a 9 m band of `u:'wood'`. That is the bare minimum and
he has said so.

What it needs:
- **Depth.** The channel should read as cut below grade. PR #62 records that
  sinking ground needs a HOLE in the ground polygon first — do that here: punch
  the creek out of the surrounding areas, then run `terrace()` inward and down.
- **Real planting, not a colour.** Trees along both banks at real density,
  understorey, bank scrub.
- **The stretches he named, each with its own picture:** behind Patton Hall and
  the Etter-Harbin Alumni Center; behind San Jacinto, the Rec Center and the
  track.
- Look at what is mapped before inventing — OSM has the creek path, the bridges
  and some planting.

## A8. The landmarks are not accurate — the biggest item here

*"make monochrome for austin look better not like a silver tree. clock not looks
like a fireplace and not big enough. I don't even want to check out the other
landmarks PLEASE make them accurate to size and architecture."*

`bake_art.py` has ten recipes and 24 generic forms, and the recipes are schematic
where they need to be specific. **Every one needs a reference photograph read
properly before it is redrawn** — the `VISUAL_REFERENCE_PLAYBOOK` rules apply in
full: derive the rule, sample real dimensions, never guess.

**Get SIZE right first — he said size before architecture.**

- **Monochrome for Austin** (Nancy Rubins): a cascade of aluminium canoes and
  small boats bolted into a lopsided mass cantilevered off a mast — wider than
  tall, asymmetric. The bake draws a symmetrical radial burst, which is exactly
  why it reads as "a silver tree". About 9 m across.
- **Clock Knot** (Mark di Suvero): 26 ft of orange-red steel I-beams; a tangle
  meeting at an acute angle high up with legs splaying wide. The bake is squat
  and symmetrical = "a fireplace". **Check the height against the real 7.9 m** —
  he says it is not big enough and the data carries 5.5.
- Then the other eight, each against a photograph: The West, Diana the Huntress,
  Austin, Sea Turtle, Mustangs, Circle with Towers, The Torchbearers, Lone Star.

## A9. Does the Kelly glass match the real building?

*"check if the glass u added to the ellsworth building matches it irl"*

**Probably not, and here is the specific doubt.** Kelly's *Austin* has three
coloured-glass windows:

| wall | the real window | what PR #58 drew |
|---|---|---|
| south | **colour grid** — a grid of squares | roughly right |
| west | **starburst** — radiating coloured panels | close |
| east | **tumbling squares** — a diagonal cascade | six tall spectrum lights — **a different window entirely** |

Get a reference image, confirm all three, fix the east wall. Also check the
massing: it is a stone volume with a **double** barrel vault and the bake draws
one.

---

# PART B — GO WIDER, AND KEEP IT HONEST

## B1. Build the landmark contact sheet FIRST

Before redrawing ten sculptures by hand twice: a `pose.mjs`-driven contact sheet
that photographs every authored artwork at a fixed distance and lays them out in
a grid beside their recorded height. One command, one image, and the wrong ones
are obvious. Same argument as the render→sample→assert harness in the playbook —
build it as step one, not last.

## B2. The South Mall terraces

The mall rises ~6 m from the fountain to the Main Building and is currently flat.
`terrace()` and `flight()` exist. The PR #62 constraint still holds — building
bases are at z=0 — so this is steps and retaining walls at the level changes, not
a raised mall.

## B3. Ground that is not bare

The commonest defect in every wide shot is large expanses of base tan where
nothing is mapped. PR #69 grows a lawn out to the walks that bound it and is
written as a `PRECINCTS` table keyed by a point. **Add the other obvious ones:**
the Blanton block, the East Mall, the Drama/art precinct, the power-plant yard,
West Campus interiors.

## B4. Street furniture that is not a box

2,635 furniture features are drawn as small boxes. Give the common ones a real
form — a bench is a seat, two ends and a back — and check the density reads as a
campus rather than as scatter.

## B5. Night: the last 872 pale pixels

`night-pale.mjs` is at 872, from 6,206. The remaining 12.4% is `stadium-detail`,
the Mac's. Re-run after their DKR night pass lands and **confirm** rather than
assume.

## B6. A regression net for the ground bakes

Four bakes now write `data/ground.geojson` and each has silently changed
another's output at least once. Feature counts per `k` and per `u`, plus file
size, asserted against a recorded baseline. That would have caught the props
re-bake producing 2,244 features against a shipped 9,022 (HANDOFF §44).

## B7. Dusk: the far ring is a flat tan band

From the dusk sweep — the outer ring reads as a solid tan wall with a hard
horizon line. The most unfinished thing in the three sweeps. `js/outer.js` is the
Mac's, so it is written into MAC_QUEUE rather than fixed here.

---

# PART C — the tiling work

## C1. Buildings on vector tiles

**Started, parked UNMERGED on `acer/facade-bake`. Do not merge until the harness
passes.**

`scripts/bake_facades.py` transcribes `quantiseFacades` and reproduces the whole
assembly it runs after — `capitol_overrides.json` patching 12 buildings,
`capitol.geojson` appending 604, `FACADE_PROTECTED`, and `applyUnion24` rewriting
one building's height AND its `wd`/`wg`/`wn`. It agrees with the browser's own
console line on the assembly (12 / 604 / 1) and elects 14 buckets over 20 groups
across 3,057 features.

`scripts/verify/facade-parity.mjs` is written and **has never been run.** That is
the next command. It runs the REAL `mergeCapitolScene`, `applyUnion24` and
`quantiseFacades` on their own fetched copy and dumps every feature's bucket.
`scripts/verify/facade_parity.py` — the comparator — **is not written yet.**

It stamps an inert ordinal, never `wp`: `wp` is read by the renderer through
`['coalesce', ['get','wp'], 'mh00']`, so a baked `wp` naming an unregistered
atlas image paints that building **transparent**.

**Sequencing.** The render switch needs `js/facades.js`, which the Mac is editing
for `registerOuterTowerBuckets` (MAC_QUEUE M2). Land theirs first, then copy its
shape. Do not both edit that file.

---

## Not negotiable

1. **Never register a self-hosted GitHub runner.** Public repo.
2. **Never remove the watchdog or reaper in `scripts/verify/chrome.mjs`.**
3. **Never leave a browser or a server running.** `reap.mjs` and kill your server
   before finishing every pass.
4. **Record every pass in `HANDOFF.md`** with the branch name.
