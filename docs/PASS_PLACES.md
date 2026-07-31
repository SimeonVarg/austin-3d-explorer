# Pass: Storefronts

Written 2026-07-31. Read `docs/PASS_COMMON.md` first. This pass owns
`js/places.js`, `scripts/bake_places.py`, `data/places.geojson`,
`scripts/verify/places-*.mjs` and `shots/places-*.png`.

## The complaint

> "i also want all restaurants on the campus and in wampus and guad and around
> campus to look like the actual restaurant and have their logos and fronts."

## What was actually wrong

`js/drag.js` had already fixed the *shape* of this for Guadalupe between 21st and
24th. It stopped painting apartment windows on the ground floor of a bookstore
and gave that run a shopfront vocabulary — a tall glass band, a bulkhead under
it, a sign band over it, upper floors above. Two things were still missing:

1. **Every one of those sign bands is generic.** Chipotle, Starbucks, the
   University Co-op, Wingstop and Torchy's all wore the same `#4a4038` fascia
   with a random scatter of coloured blocks on it. A shopfront existed; the
   *business* did not.
2. **Everything outside those four blocks had no shopfront at all** — West
   Campus, the Speedway edge, 26th Street, Dobie, MLK. About 90 businesses.

## The logo question, answered up front

**No brand artwork is downloaded, embedded or drawn.** Not a logo, not a
wordmark, not a mascot.

That is partly a trademark call — reproducing a company's logo as an image asset
in a published site is a real question and this project is going out on AWS
Kiro's channels. It is also, independently, the right rendering decision. The
camera flies 200–900 m up; one pixel of wall is about half a metre; a logo is
three or four pixels of mush. What a person actually recognises from a block away
is **the sign colour, the sign band's position and proportion, the awning, and
the name** — and all four of those are drawn here.

If a specific case genuinely needs artwork, that is a question for Simeon, not a
decision to be taken quietly in a bake script.

## What is drawn

Per business, a thin slab standing **0.30 m proud** of the host building's
ground-floor wall, in four stacked bands:

| band | base → top | what it is |
|---|---|---|
| bulkhead | 0.00 → 0.55 m | solid kickplate, `#39332e`, unbranded |
| glazing | 0.55 → 4.30 m | mullioned shopfront glass, one pattern image |
| fascia | 4.30 → 5.35 m | **the brand's real sign colour**, flat fill |
| awning | 3.84 → 4.20 m | cantilevers 1.30 m, brand colour, cooled |

plus one **label point** carrying the business name.

`SHOP_DATUM = 4.3` and `SIGN_H = 1.05` are taken from `js/drag.js`, not
re-derived, so a brand fascia lands exactly on the generic fascia it replaces.
Bands are clamped to 0.72 / 0.88 of the host's height on buildings too short to
carry the datum — again drag.js's rule.

### Why there is an awning, and it is not decoration

At 60–75° of pitch a vertical fascia is foreshortened to roughly a third of its
true height, while a horizontal surface is seen at nearly full size. The surface
that actually delivers "that is a Whataburger" from altitude is the **awning's
top face**, not the sign band. That is why it projects 1.3 m and why its colour
is pre-corrected cool — see the sun-tint measurement below.

### Why it is stacked geometry and not a wall pattern

`fill-extrusion-pattern` is tile-locked and has no vertical anchor: it repeats
from the extrusion base with no idea where the building's bottom is. A
ground-floor shopfront painted into a wall tile reappears every ~40 m up the
building. So every band is its own feature with its own `base`/`h` — the `BANDS`
list in `scripts/bake_stadium.py`, applied per tenant. The one pattern this pass
registers (the glazing's mullions) is **stationary in y**, exactly as drag.js's
tiles are: vertical mullions survive a moving slice, a transom bar would not, so
there is no transom bar.

### Why it replaces nothing

`replacedBuildingIds` is **empty on purpose** and the module writes no filter on
`buildings-3d`. Because the slab stands proud of the wall it can never z-fight
with the building behind it, it works whether or not drag.js has already rebuilt
that wall, and — the reason that matters — this pass cannot collide with any of
the six others landing on this repo, because it never claims a building any of
them might also claim. `places-check.mjs` asserts this rather than trusting it.

## How a business is placed on a building

All geometric, no hand-placed coordinates:

1. **Host** — point-in-polygon of the OSM node against the snapshot's own
   footprints; failing that, the nearest footprint within 26 m.
2. **Frontage** — every wall edge is walked in 2 m steps and each step asks two
   questions: is there a road centreline within 26 m, *and does it lie on the
   outward side of this wall?* The second question is the one that matters.
   Distance alone puts a shopfront on the **back** wall of any narrow building,
   which is most of the Drag — Guadalupe is 20 m from the front of those shops
   and 45 m from the back, and 45 m is inside any generous radius. Testing the
   normal is what makes the shopfronts face the street rather than the alley.
3. **Allocation** — tenants of one building are sorted along the frontage arc and
   given contiguous slots of 5–15 m with a 1.2 m gap. Over capacity, the ones
   with a sourced colour are kept first.
4. **Depth rejection** — a business whose OSM node sits more than 42 m behind the
   frontage it would be given is **dropped**, not drawn. A dining-hall counter in
   the middle of Jester is not a shopfront.

## Counts

| | |
|---|---|
| named places in OSM inside the detailed bbox | 153 |
| matched to a host building | 149 |
| **shopfronts drawn** | **133** |
| extrusion features added | **1,052** |
| label points added | 133 |
| total features | 1,185 (430 KB) |
| atlas images added | **1** |
| buildings replaced | **0** |

1,052 extrusions is the whole cost, against a scene that already carries ~12,000
trees, ~6,000 props, 12,058 roof features and a 7,625-building outer ring. It is
a rounding error, which is why all 133 are drawn rather than only the ones
fronting Guadalupe. The measured frame cost is in the PR body.

## Sign colours — the reference table

`S` = sourced. `G` = generative (a category tone, no per-business hex available).

### Sourced from published brand guides

| business | hex | source |
|---|---|---|
| Starbucks ×4 | `#006241` | brand guide, Pantone 3425 C |
| Chick-fil-A | `#e51636` | brand guide, Pantone 199 C |
| Chipotle | `#ac2318` | brand guide red |
| Wendy's | `#bb252d` | brand guide red |
| Subway | `#028940` | brand guide green |
| Whataburger | `#ff770f` | brand guide, Pantone 1585 C |
| Raising Cane's | `#e71a2a` | brand guide red |
| In-N-Out Burger | `#e02a27` | brand guide red |
| Jimmy John's | `#e4002b` | brand guide red |
| Domino's | `#0b648f` | brand guide blue |
| Potbelly | `#fcb116` | brand guide yellow |
| Wingstop | `#006938` | brand guide, Pantone 349 C |
| Target ×2 | `#cc0000` | brand guide, Pantone 186 C |
| CVS Pharmacy | `#cc0000` | CVS Health brand guide red |
| 7-Eleven ×4 | `#f4811f` | brand guide orange |
| AT&T | `#067ab4` | brand guide, Pantone 2995 C |
| The UPS Store | `#fab80a` | UPS brand guide yellow |
| United States Postal Service | `#004b87` | USPS brand guide blue |
| Denny's | `#ce363b` | brand guide, Pantone 1797 C |
| Einstein Bros. Bagels | `#f2b826` | brand guide yellow |
| Urban Outfitters | `#1a1a1a` | brand guide black, lifted off pure 0 |
| P. Terry's | `#da291c` | brand palette red |
| **The Co-op** | `#bf5700` | **UT Austin UMAC brand centre, Pantone 159** |

### Sampled out of the company's own site stylesheets

Not remembered, and not an aggregator's guess: the page HTML and every
same-origin stylesheet were fetched and the hexes ranked by frequency, with
framework palettes filtered out. This is the company publishing its own colour.

| business | hex | source |
|---|---|---|
| Torchy's Tacos | `#e33f3d` | torchystacos.com |
| Sweetgreen | `#00473c` | sweetgreen.com |
| JuiceLand | `#144635` | juiceland.com |
| Pluckers Wing Bar | `#ffe525` | pluckers.com |
| Kerbey Lane Cafe | `#f0523d` | kerbeylanecafe.com |
| Amy's Ice Creams | `#ff64bf` | amysicecreams.com |
| Thundercloud Subs | `#ff4d00` | thundercloud.com |
| Rally House | `#d42e12` | rallyhouse.com |
| Shoe Palace | `#cb2229` | shoepalace.com |
| Dirty Martin's | `#cf5300` | dirtymartins.com |
| Scholz Garten | `#a88541` | scholzgarten.com |
| Trudy's Texas Star | `#e43e24` | trudys.com |
| Cabo Bob's | `#00b6de` | cabobobs.com |

**42 storefronts carry a sourced colour. 91 do not.**

### Sampled and REJECTED

Every one of these sites paints itself in a framework's stock palette, and the
frequency ranking cannot tell a theme default from a brand decision. Taking the
hex would have shipped Bootstrap red as "Texas Chili Parlor's sign, sourced".
Recorded so the next person does not re-run the same dead end.

| business | why rejected |
|---|---|
| Texas Chili Parlor | stock Bootstrap; nothing survives the filter |
| Twin Liquors | `#e53935` / `#b71c1c` are Material Design red 600/900 |
| Hole in the Wall | `#0693e3` is the WordPress editor default blue |
| Playa Bowls | `#3898ec` is the Wix default |
| Snarf's Sandwiches | every candidate is a Bootstrap contextual colour |
| Waterloo Records | one hit per hex; nothing dominant |
| Pizza Press | no hex in the served CSS at all |
| Buffalo Exchange | `#5eead4` / `#334aff` are Tailwind palette stops |
| CAVA | brand guide names its colours (Jonquil, Vivid Tangerine), publishes no hex |
| Gong Cha | served no stylesheet the sampler could read |

### The 91 with no sourced colour

They get a **category tone** — coffee dark and warm, taquerias red/orange, dive
bars near-black, convenience saturated primary — with a stable per-name pick
inside the category. This is the same honesty `bake_drag.py` applies to its
`r0..r3` upper-floor tones: the *range* is observed, the *per-business pick* is
not. They are labelled `src: "G"` in the data and ranked below sourced brands
for both frontage and label placement.

## The night inversion

This is the one colour ramp in the repo that goes **up** at night.

Every other surface rides a ramp ending dark. A shop fascia is the opposite:
channel letters and lightboxes are the brightest thing on a two-storey building
after dark, and it is the entire reason a retail street reads at night. Run a
sign through the ordinary wall ramp and Chipotle's red lands at `#29181f`, which
deletes the pass at exactly the hour it matters most.

Measured, at `p = 0.14` → `p = 0.86`:

| | day luma | night luma |
|---|---|---|
| Chipotle | 75 | 132 |
| Starbucks | 65 | 175 |
| Wingstop | 68 | 172 |
| The Co-op | 109 | 157 |
| Urban Outfitters | 26 | **89** |
| bulkhead (not a sign) | 52 | **15** |
| awning (fabric, lit not luminous) | 130 | **24** |

Urban Outfitters is the interesting row and it is a **bug the check caught**. The
chroma push divides by the channel maximum, and `238 / 26` is 9.2× — so the first
cut took a black fascia to luma **239**, the brightest object in the frame. Every
daytime screenshot was perfect. `places-check.mjs` printed `day 26 -> night 239`
next to six sensible rows and that is the only reason it was noticed. An
achromatic fascia now gets a bounded lift; a saturated one does not.

## Measurements

- **Sun tint on a horizontal face:** a `#808080` (R/B 1.00) awning renders at
  **R/B 1.20–1.28**. `AWN_COOL = 0.86` / `AWN_BLUE = 0.10` is the correction that
  lands it neutral. Measured by `places-check.mjs`, not assumed.
- **Glazing tile luma:** day 106.9 / golden 128.2 / night 153.0. The first cut sat
  at **80** against a ~145 wall and rendered as a black ribbed void under every
  shopfront — a hole, not a window. `drag.js` records the identical failure one
  step further along the same axis, at 0.66. The check now asserts a floor of 95.
- **Label collision:** labels placed at zoom 16.4 went **0 → many** once the layer
  was anchored before `buildings-labels`. See below.

## Three traps this pass added to the list

**Label collision priority is layer ORDER.** MapLibre resolves symbol collisions
in style order — earlier wins the box, later is dropped. `places-label` was added
with no anchor, which puts it last, which is the lowest priority in the entire
style. It measured exactly that: **0 labels placed at zoom 15.5, 0 at 16.4, 18 at
17.2.** Every shop name was losing its box to `buildings-labels`' apartment-block
names, and it read as a minzoom bug when it was a priority bug.

**`querySourceFeatures` is as unreliable as `queryRenderedFeatures` here.** It
returned 1,720 features on one run and **0** on the next from an almost identical
pose, while the pass was demonstrably rendering both times. An assertion built on
it would have failed a correct build about half the time. Static facts about the
baked file are now checked against the file; whether a colour reaches the screen
is checked with pixels.

**A whole-frame pixel diff measures the tone mapper, not your layer.** Hiding the
fascia bands — a layer of 1 m strips — "changed" **289,963 of 1,024,000 pixels**,
because the scene runs an auto-exposure stage and removing anything re-grades
every pixel. The working technique is the one `ground-luma.mjs` already uses: two
renders of identical geometry, one keyed to a mask colour, read the second at the
first's positions. And when you do that, **neutralise `applyPlacesColors` first** —
it is wrapped onto `applyTimeOfDay` and will quietly rewrite your key colour back
to the real ramp, which makes the "keyed" frame silently the real frame.

## Honest list of what is not done

- **91 of 133 storefronts have no sourced sign colour.** They are plausible, not
  true. Every one is named in the bake summary and in this file.
- **No brand artwork of any kind**, by design — see above.
- **Awnings are on every shopfront.** The real street is patchier; some of these
  businesses have no awning. Generative, and flagged as such in the bake's
  provenance block.
- **20 places are dropped**: 4 with no host building, 10 whose host has no street
  frontage at all, 6 whose OSM node sits too deep inside the building to be a
  street tenant. All named in the bake summary. The last group is a deliberate
  rejection, not a failure.
- **Frontage is split evenly** between a building's tenants. Real tenancies are
  not equal width, and OSM does not carry the widths.
- **The upper floors are untouched.** Above 5.35 m every building still wears
  whatever `js/facades.js` or `js/drag.js` gave it.
- **Below about zoom 16.5 (≈500 m) the geometry stops reading** — a 1 m fascia is
  under two pixels — and the pass is carried by the labels alone. That is the
  honest working range, and it is why the flyover shots in the PR are taken at
  350–500 m rather than 900.
