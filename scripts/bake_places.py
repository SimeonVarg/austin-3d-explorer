# -*- coding: utf-8 -*-
"""Storefronts: every restaurant, cafe, bar and shop OSM knows about, given a
real shopfront on its host building's ground floor, in its real sign colour.

WHY THIS EXISTS
---------------
The complaint was "all restaurants on the campus and in West Campus and Guad and
around campus should look like the actual restaurant and have their logos and
fronts". js/drag.js already fixed the *shape* of that problem for Guadalupe
between 21st and 24th: it stopped painting apartment windows on the ground floor
of a bookstore and gave the streetwall a shopfront vocabulary — a tall glass band
with a bulkhead under it and a sign band over it. But every one of those sign
bands is generic. Chipotle, Starbucks, Wendy's, the University Co-op and Torchy's
all wear the same #4a4038 fascia with a random scatter of coloured blocks on it.
And everything outside that four-block run — West Campus, the Speedway edge,
26th Street, the Dobie frontage — has no shopfront at all.

So this pass does two things and only two things:

  1. It sources 153 named places from OSM inside the detailed bbox and works out,
     geometrically, which slice of which building each one actually fronts.
  2. It paints that slice in the brand's REAL sign colour, and carries the
     business NAME as a label.

WHAT IT DELIBERATELY DOES NOT DO: download or embed brand logo artwork. Putting
a company's logo in a published site is a trademark question and this project is
going out on AWS Kiro's channels. It is also pointless: from the 200-900 m the
camera actually flies at, one pixel of wall is about half a metre, so a logo is
three or four pixels and unreadable, while the SIGN COLOUR is a 12 m x 1 m band
that reads clearly and is the thing a person actually recognises a block away.
Colour, band position, awning and name; no artwork.

HOW THIS EXTENDS js/drag.js RATHER THAN DISAGREEING WITH IT
-----------------------------------------------------------
drag.js's datum is SHOP_DATUM = 4.3 m of glass with a 1.05 m sign band over it,
clamped to 0.72/0.88 of the building's own height on the short ones. This file
uses THE SAME numbers, imported as constants below rather than re-derived, so a
brand fascia lands exactly on the generic fascia it is replacing. What it adds is
depth: these are not bands of the building's own wall, they are a thin slab
standing 0.30 m PROUD of it, plus an awning that projects 1.30 m.

THE PROUD SLAB IS THE WHOLE STRUCTURAL IDEA, and it is what makes this pass
composable. It claims NO building ids — `replacedBuildingIds` is empty, on
purpose. Six passes are landing on this repo and every one of them that replaces
a building has to be checked against every other one; a pass that only ever adds
geometry in front of a wall can never collide with any of them. It also means
this file works whether or not drag.js has already rebuilt the wall behind it.

WHY THERE IS AN AWNING, and it is not decoration
------------------------------------------------
The camera is 200-900 m up at 60-75 degrees of pitch. At 70 degrees a vertical
sign band is foreshortened to about a third of its true height while a horizontal
surface is seen at nearly full size. So the surface that actually delivers "that
is a Chipotle" from the flying camera is not the fascia, it is the awning's TOP
face. That is why the awning exists, why it projects 1.3 m, and why its colour
gets the cool pre-correction below.

THE VERTICAL-ANCHOR TRAP, which is why none of this is a wall pattern
---------------------------------------------------------------------
`fill-extrusion-pattern` is tile-locked and has no idea where a building's bottom
is, so a shopfront painted into a wall tile repeats every ~40 m up the building.
Every band here is therefore its own feature with its own `base` and `h` — the
BANDS list in scripts/bake_stadium.py, applied per tenant. The one pattern this
pass uses (the glazing's mullions) is stationary in y, exactly as js/drag.js's
tiles are, for the same reason.

GROUND-FLOOR DEPTH (second pass, 2026-08-04) — docs/entrances/shopfronts.md
---------------------------------------------------------------------------
The first cut of this file gave every tenant a flat proud slab: bulkhead, glass,
fascia, awning. Four rectangles and no way in. This pass gives it an ENTRY —
a recessed bay flanked by piers, a lintel, door leaves with their own lights,
and the thing that actually changes the street after dark: a LIT INTERIOR PLANE
at the back of the notch plus a warm pool of spill on the sidewalk in front of
it, drawn only for the tenants that are still open at 22:00.

Four decisions in this pass are worth knowing before reading the code.

1. THE NOTCH IS REAL, AND IT IS ONLY 0.32 m DEEP, BECAUSE THAT IS ALL THERE IS.
   docs/entrances/shopfronts.md §5.1 derives a 1.00-1.50 m recess from Austin
   Building Code §3202.2 (a door may not swing over the right-of-way). We cannot
   have it: this pass owns no building, so there is nothing behind the wall to
   recess INTO — the host's own extrusion is at offset 0.00 and would swallow
   anything pushed past it. So the depth we can actually spend is the 0.38 m the
   free-plane ladder in docs/entrances/groundfloor-existing.md §5b allows minus
   the 0.06 m the back plane sits at. The entry piers stand at 0.38 (in the free
   0.32-0.41 band), the back plane at 0.06, and the step between them is a
   genuine 0.32 m of geometry — the piers' inward faces ARE the jamb returns, so
   one box does the pilaster and the return both. §9.3(b) of the spec says value
   beats geometry ~8:1 at flying altitude anyway; this gets both.

2. THE SIDE RETURNS ARE THE GLOW, NOT THE DOOR. A single leaf is 0.91 m and a
   1.00 m opening is 0.91 m of door, so a lit plane directly behind it is a lit
   plane nobody sees. The bay is therefore open_w + 2 x SF_RETURN_W wide and the
   leaves are centred in it, which leaves two strips of lit interior standing
   either side of the door — exactly what a recessed shopfront entry is.

3. NO LOD GATE EXISTS AND THE GEOMETRY IS CHOSEN TO NOT NEED ONE. The spec asks
   for SF_PORTAL_MIN_ZOOM / SF_DETAIL_MIN_ZOOM tiers. js/places.js puts every
   non-glass feature into ONE layer at minzoom 15 and this lane may not edit it,
   so a per-feature zoom gate is not available from the bake. The response is to
   emit only what §9.2 says survives at or above the spawn altitude (230 m):
   the bay panel (1 px to 854 m), the leaves (682 m tall / 325 m wide), the
   piers, the lintel. Everything the spec puts in the DETAIL tier — the sill,
   the water table, the transom line, the door's bottom rail as its own feature,
   and the 13 mm threshold — is NOT EMITTED. A 0.051 m mullion never reaches one
   pixel at any camera position this app allows (ALT_MIN is 18 m, the mullion
   needs 18.2), which is why the mullion grid stays a pattern in the existing
   pl-glass tile and this pass adds ZERO atlas images.

4. OPEN OR CLOSED IS SOURCED, NOT INVENTED. data/osm_cache/places.json carries
   `opening_hours` on half the corpus. One regex takes the latest closing hour
   of the week out of every one of those strings; the rest fall back to the
   category habit table OPEN_AT_22, labelled `G` in the output exactly as the
   sign colours are. A closed shop gets security lighting, not a dark hole, and
   gets no pool on the pavement — which is the whole point of drawing one.

Usage:  python scripts/bake_places.py
"""
import json
import math
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
PLACES = os.path.join(ROOT, "data", "osm_cache", "places.json")
ROADS = os.path.join(ROOT, "data", "osm_cache", "surfaces.json")
OUT = os.path.join(ROOT, "data", "places.geojson")

M_LAT = 111320.0
# ONE reference latitude for the whole bbox, not per-feature. bake_drag.py
# projects each building about its own centroid, which is fine when every
# distance you measure is inside one footprint. This file measures footprint-to-
# ROAD distances across a 2.9 km bbox, and a per-feature projection makes those
# disagree by metres. So: one origin, one scale, everywhere.
LAT0 = 30.286
KX = math.cos(math.radians(LAT0)) * M_LAT

# ── Taste block. Every value here is a one-line override. ─────────────

# Shared with js/drag.js. Do NOT drift from these: a brand fascia is supposed to
# land exactly where the generic fascia it replaces already is.
SHOP_DATUM = 4.3         # top of the glass, metres above grade
SIGN_H = 1.05            # the fascia band over it
SHOP_MAX_FRAC = 0.72     # ... unless the building is too short to carry it
SIGN_MAX_FRAC = 0.88
BULKHEAD = 0.55          # the solid kickplate under the glass

# The slab. `OUT` is what keeps every face of this pass clear of the wall behind
# it — the building's own extrusion, or drag.js's band, or nothing at all.
PROUD = 0.30             # m the shopfront stands out from the wall
INSET = 0.15             # ... and how far it bites back into it
AWN_PROJ = 1.30          # how far the awning cantilevers
AWN_T = 0.36             # its thickness
AWN_DROP = 0.10          # its top sits this far under the glass head

# Frontage selection.
ROAD_CLASSES = ("primary", "secondary", "tertiary", "residential",
                "unclassified", "living_street", "pedestrian",
                "primary_link", "secondary_link", "tertiary_link")
FRONT_MAX = 26.0         # m from a wall to a road centreline to count as frontage
STEP = 2.0               # m; how finely an edge is tested for street-facing
MIN_RUN = 3.5            # m; a frontage piece shorter than this is not a shopfront
HOST_SNAP = 26.0         # m; how far a POI may sit outside its host footprint
POI_FRONT_MAX = 42.0     # m; a POI further than this from the frontage it would
                         # be given is not a street tenant at all — a food court
                         # in the middle of a dining hall, not a shopfront. These
                         # are DROPPED and counted, not drawn wrong.
MIN_W = 5.0              # m of frontage a tenant needs
MAX_W = 15.0             # ... and the most it may take
GAP = 1.2                # m of plain wall between neighbours

# ── Brand sign colours ────────────────────────────────────────────────
# `S` = sourced. Either a published brand-guide value (Pantone-backed where the
# note says so) or a hex sampled out of the brand's OWN site stylesheets, which
# is the company publishing its own colour rather than me remembering it.
# `G` = generative: I could not source this one, and it is a category tone. Every
# `G` place is listed by name in the bake summary and in docs/PASS_PLACES.md.
#
# ENTERED AS THE SIGN READS IN DAYLIGHT. The renderer's sun tint lands on every
# surface and lands hardest on the horizontal ones — js/app.js measured an input
# of R/B 1.18 rendering at 1.85 on the stadium decks, and bake_drag.py had to
# enter PCL's limestone well cool of its sample for the same reason. The awning
# top face is the worst case here, so AWN_COOL below takes the awning (and only
# the awning) back toward neutral. The fascia is near-vertical and needs no such
# correction; that asymmetry is measured in scripts/verify/places-check.mjs, not
# assumed.
BRANDS = {
    # ---- national chains, published brand-guide values -----------------
    "Starbucks":            ("#006241", "S", "brand guide, Pantone 3425 C"),
    "Chick-fil-A":          ("#e51636", "S", "brand guide, Pantone 199 C"),
    "Chipotle":             ("#ac2318", "S", "brand guide red"),
    "Wendy's":              ("#bb252d", "S", "brand guide red"),
    "Subway":               ("#028940", "S", "brand guide green"),
    "Whataburger":          ("#ff770f", "S", "brand guide, Pantone 1585 C"),
    "Raising Cane's":       ("#e71a2a", "S", "brand guide red"),
    "In-N-Out Burger":      ("#e02a27", "S", "brand guide red"),
    "Jimmy John's":         ("#e4002b", "S", "brand guide red"),
    "Domino's":             ("#0b648f", "S", "brand guide blue"),
    "Potbelly":             ("#fcb116", "S", "brand guide yellow"),
    "Wingstop":             ("#006938", "S", "brand guide, Pantone 349 C"),
    "Target":               ("#cc0000", "S", "brand guide, Pantone 186 C"),
    "CVS Pharmacy":         ("#cc0000", "S", "CVS Health brand guide red"),
    "7-Eleven":             ("#f4811f", "S", "brand guide orange"),
    "AT&T":                 ("#067ab4", "S", "brand guide, Pantone 2995 C"),
    "The UPS Store":        ("#fab80a", "S", "UPS brand guide yellow"),
    "United States Postal Service": ("#004b87", "S", "USPS brand guide blue"),
    "Denny's":              ("#ce363b", "S", "brand guide, Pantone 1797 C"),
    "Einstein Bros. Bagels": ("#f2b826", "S", "brand guide yellow"),
    "Urban Outfitters":     ("#1a1a1a", "S", "brand guide black, lifted off pure 0 so it is not a hole"),
    "P. Terry's":           ("#da291c", "S", "brand palette red"),
    # ---- sampled out of the company's own stylesheets ------------------
    "Torchy's Tacos":       ("#e33f3d", "S", "sampled from torchystacos.com CSS"),
    "Sweetgreen":           ("#00473c", "S", "sampled from sweetgreen.com CSS"),
    "JuiceLand":            ("#144635", "S", "sampled from juiceland.com CSS"),
    "Pluckers Wing Bar":    ("#ffe525", "S", "sampled from pluckers.com CSS"),
    "Kerbey Lane Cafe":     ("#f0523d", "S", "sampled from kerbeylanecafe.com CSS"),
    "Amy's Ice Creams":     ("#ff64bf", "S", "sampled from amysicecreams.com CSS"),
    "Thundercloud Subs":    ("#ff4d00", "S", "sampled from thundercloud.com CSS"),
    "Rally House":          ("#d42e12", "S", "sampled from rallyhouse.com CSS"),
    "Shoe Palace":          ("#cb2229", "S", "sampled from shoepalace.com CSS"),
    "Dirty Martin's":       ("#cf5300", "S", "sampled from dirtymartins.com CSS"),
    "Scholz Garten":        ("#a88541", "S", "sampled from scholzgarten.com CSS"),
    "Trudy's Texas Star":   ("#e43e24", "S", "sampled from trudys.com CSS"),
    "Cabo Bob's":           ("#00b6de", "S", "sampled from cabobobs.com CSS"),
    # ---- the one that is genuinely institutional -----------------------
    "The Co-op":            ("#bf5700", "S", "UT Austin UMAC brand centre, Pantone 159"),
}
# Sampled and REJECTED. Every one of these sites paints itself in a framework's
# stock palette — Bootstrap's #dc3545, Material's #e53935, Wix's #3898ec, the
# WordPress editor's #0693e3 — and the frequency ranking cannot tell a theme
# default from a brand decision. Taking those hexes would have shipped Bootstrap
# red as "Texas Chili Parlor's sign, sourced". They are left generative and named
# here so the next person does not re-run the same dead end.
SAMPLED_AND_REJECTED = {
    "Texas Chili Parlor": "site is stock Bootstrap; no brand hex survives the filter",
    "Twin Liquors": "#e53935 / #b71c1c are Material Design red 600/900",
    "Hole in the Wall": "#0693e3 is the WordPress editor default blue",
    "Playa Bowls": "#3898ec is the Wix default",
    "Snarf's Sandwiches": "every candidate is a Bootstrap contextual colour",
    "Waterloo Records": "one hit per hex; nothing dominant",
    "Pizza Press": "no hex in the served CSS at all",
    "Buffalo Exchange": "#5eead4 / #334aff are Tailwind palette stops",
    "CAVA": "brand guide names its colours (Jonquil, Vivid Tangerine) and publishes no hex",
    "Gong Cha": "site served no stylesheet the sampler could read",
}

# GENERATIVE fallback, and labelled as such. A hundred of these places are
# independent Austin businesses with no published palette, and inventing a
# specific hex for each one would be fiction dressed as research. What IS true
# and observable is the class habit: coffee reads dark and warm, taquerias read
# red/orange, dive bars read near-black with a neon, convenience reads saturated
# primary. So the fallback is by CATEGORY, with a stable per-name pick inside
# each category so a street is varied and does not reshuffle between bakes.
# Same honesty as bake_drag.py's r0..r3 upper-floor tones.
CAT_TONES = {
    "cafe":         ["#4a3b30", "#6b4a33", "#3d3a34", "#7a5c3c"],
    "restaurant":   ["#8c2f24", "#2f4a3c", "#6b4a33", "#3a3f4a", "#7a4a2c"],
    "fast_food":    ["#a83a24", "#c25a1e", "#8c2f24", "#b0761c"],
    "bar":          ["#241f24", "#3a2028", "#1f2630"],
    "pub":          ["#2b2018", "#3a2822", "#22282b"],
    "ice_cream":    ["#d8659a"],
    "food_court":   ["#4a4038"],
    "convenience":  ["#20488c", "#1f6b4a", "#8c2f24"],
    "supermarket":  ["#20488c"],
    "clothes":      ["#2a2a2e", "#4a3a3a", "#3a3a2a"],
    "second_hand":  ["#3a4a3a", "#4a3a4a"],
    "alcohol":      ["#3a2020", "#22303a"],
    "bakery":       ["#8c5a2c", "#b07a3c"],
    "chemist":      ["#20488c"],
    "beauty":       ["#5a2a4a"],
    "hairdresser":  ["#3a2a3a"],
    "copyshop":     ["#20488c"],
    "books":        ["#3a2f28"],
    "music":        ["#2a2a30"],
    "sports":       ["#20304a"],
    "bicycle":      ["#2a3a30"],
    "laundry":      ["#2a3a4a"],
    "pet":          ["#3a4a2a"],
    "optician":     ["#22303a"],
    "florist":      ["#3a4a30"],
    "gift":         ["#5a3a4a"],
    "tattoo":       ["#241f24"],
    "cannabis":     ["#2a3a2a"],
    "e-cigarette":  ["#2a2a3a"],
    "beverages":    ["#8c4a2c"],
    "telecommunication": ["#20488c"],
    "department_store": ["#8c2f24"],
    "variety_store": ["#8c2f24"],
    "frame":        ["#3a3228"],
    "yes":          ["#4a4038"],
}
DEFAULT_TONE = ["#4a4038"]      # drag.js's generic fascia — the honest "unknown"

BULK_COL = "#39332e"            # the solid kickplate. Neutral, dark, unbranded.
GLASS_COL = "#6e7a84"           # base tone the mullion tile is drawn over

# Fascias entered darker than this get their lettering assumed light and vice
# versa; used only by the label layer's halo choice in js/places.js.
LIGHT_TEXT_MAX_LUMA = 140.0

# The awning's top face takes the full sun tint. Measured, not guessed: see
# scripts/verify/places-check.mjs, which renders one awning and reports the
# input-to-rendered R/B ratio. This is the correction that lands it neutral.
AWN_COOL = 0.86          # value multiplier on the awning vs the fascia
AWN_BLUE = 0.10          # ... and how far it is pulled toward the cool end


# ══ Taste block 2: the entry. docs/entrances/shopfronts.md §3, §5, §7, §9. ══
# Every value below is a one-line override (CLAUDE.md rule 11). Tags follow the
# spec's own confidence scheme: [C] code/standard, [D] derived, [A] assumption.

SF_ENTRY_ON    = True    # the whole entry vocabulary, off in one edit
SF_DOOR_HEAD   = 2.30    # [D] leaf 2.134 + 0.166 of frame head
SF_LEAF_H      = 2.134   # [C] COMM_DOOR_H, 7 ft
SF_HEAD_T      = 0.16    # [D] the lintel band that closes the top of the bay
SF_PIER_W      = 0.28    # [A] entry pier along the wall. Its inward face is the
                         #     jamb return, so this one box is both.
SF_RETURN_W    = 0.55    # [A] lit side return between the pier and the leaf.
                         #     This, not the door, is what glows at night.
SF_EDGE_MIN    = 1.20    # [M] = GAP. Never put a door this near a slot edge.
SF_BIAS_LEN    = 9.00    # [A] a slot longer than this puts its door off-centre
SF_DOOR_BIAS   = 0.30    # [A] ... at this fraction along the slot
SF_LEAF_T      = 0.06    # [C] leaf thickness
SF_LEAF_GAP    = 0.02    # [A] meeting-stile gap between a pair
SF_LEAF_STILE  = 0.09    # [C] narrow-stile aluminium: frame beside the light
SF_LEAF_BOT    = 0.26    # [C] bottom rail — the light starts here
SF_LEAF_TOPR   = 0.11    # [C] top rail
SF_MIN_GLASS_TOP = 2.70  # [D] a host whose clamped glass head is under this
                         #     cannot carry a 2.30 m door; it gets none.

# The proud ladder. groundfloor-existing.md §4 measured every occupied plane in
# West Campus; the two intervals with NO wall face in them are 0.32-0.41 and
# 0.46-1.29. The entry frame lives in the first. Nothing here may exceed 0.41
# without checking that file again.
SF_PIER_PROUD  = 0.38    # [D] pier / lintel face — top of the free 0.32-0.41 band
SF_FLUSH_PROUD = 0.26    # [D] a sliding door does not swing, so it sits at the
                         #     glass line (§5.3) — 0.04 behind the slab face
SF_LEAF_PROUD  = 0.14    # [D] a swinging leaf, back inside the notch
SF_LITE_PROUD  = 0.03    # [D] the leaf's light stands this far proud of the leaf.
                         #     bake_entrances.py's rule verbatim: a light recessed
                         #     inside a solid leaf is a light nobody can see.
SF_BACK_PROUD  = 0.06    # [D] the lit interior plane — the deepest surface, and
                         #     0.06 clear of the host wall at 0.00
SF_BACK_T      = 0.06    # [A] its thickness; it is a plane, not a room

# Colours. Day values are neutral so the notch reads as shadow; night values are
# the whole point of the pass. spec §7.4: assert channel SPREAD >= 24 on every
# night value, NOT the luma bimodality js/entrances.js uses — the pale-neutral
# defect is a spread failure, and a dim warm security light is legitimate.
SF_PIER_COL    = "#5c554b"   # [D] BULK_COL lifted 40% toward daylight concrete
SF_LEAF_COL    = "#8e8a83"   # [D] ALUMINIUM. A shop door is a mill-finish frame.
SF_BACK_DAY    = "#332d26"   # [D] BULK_COL x 0.85 — the notch in daylight is the
                             #     darkest thing on the elevation
SF_LITE_DAY    = "#5f6a73"   # [D] GLASS_COL x 0.87; door glass is darker than
                             #     shop glass because there is no sky in it
SF_GLOW_OPEN   = "#ffbe5e"   # [D] spec §7.4. After the repo's measured night
                             #     transfer (R .53 / G .56 / B .72) this lands at
                             #     (135,106,68), R:B 1.99 — inside the 1.75-2.35
                             #     band js/entrances.js measured on lit doorways.
SF_GLOW_CLOSED = "#553f27"   # [D] spec §7.4. Security lighting only. Input luma
                             #     66, spread 46 — dim but unmistakably warm.
SF_NIGHT_HOUR  = 22.0        # [A] the hour "night" is evaluated at

# The pool of spill on the pavement. js/entrances.js does this with a `circle`
# layer on the lamp schedule; this lane cannot add a layer, so it is a 2 cm slab
# lying on the sidewalk in the existing places-solid layer. Its day and golden
# colours are js/ground.js's `paving` values EXACTLY, so by day it is pavement.
SF_POOL_ON     = True
SF_POOL_NEAR   = 0.30    # [A] m from the wall the apron starts
SF_POOL_FAR    = 2.60    # [D] under the 3.66 m minimum sidewalk (UNO §25-2-760)
SF_POOL_FLARE  = 1.30    # [A] how far past the entry frame the light reaches
SF_POOL_Z0     = 0.25    # [M] js/ground.js pathRaise 0.22 + pathTexLift 0.02,
SF_POOL_Z1     = 0.27    #     so this sits 0.01 above the paving texture
# THE DAY VALUE IS MEASURED OFF THE SCREEN, NOT COPIED OFF ground.js, AND THAT
# COST A ROUND. The first cut used js/ground.js's own SURF.paving day hex
# #e6ddc9 on the reasoning that pavement is pavement. It rendered at (241,211,
# 162) against a sidewalk rendering at (185,168,145) — the brightest object in
# the daytime frame, a white slab at every open shop. The two do not match
# because ground-paths is a fill under its own shading and this is a
# fill-extrusion under map.setLight, and no amount of reading the two files
# would have said so. Measured transfer at p=0.14 on shots/after-drag-close-day
# .png: input (230,221,201) -> (241,211,162), i.e. R 1.048 / G 0.955 / B 0.806.
# Inverting that for a target of 0.88 x the sidewalk gives the value below.
SF_POOL_DAY    = "#9b9b9f"   # [M] renders at ~(163,148,128): a soft shade under
                             #     the awning, which is what is really there
SF_POOL_GOLD   = "#8f8472"   # [D] SF_POOL_DAY x js/ground.js's own paving
                             #     day->golden ratio (0.92, 0.85, 0.72)
SF_POOL_NIGHT  = "#ffc166"   # [M] started at #ffc27a (ENT.pool.colorMain #ffc98a
                             #     pulled 8% warmer) and was measured on screen at
                             #     R:B 1.53 while the lit doorway two metres away
                             #     measured 2.06 — the pool is a HORIZONTAL face
                             #     and takes more of the night sky, which no
                             #     amount of copying the door's number fixes.
                             #     js/entrances.js's own pool is a `circle` layer
                             #     and never passes through map.setLight at all,
                             #     so its hex is not comparable. Blue pulled back
                             #     until the rendered ratio joins the 1.75-2.35
                             #     band. Magenta-masked, HANDOFF section 48.

# ── Door type by category. docs/entrances/shopfronts.md §5.3, which counted the
# shares off the 789 shipped front slabs. (kind, leaves, opening m, recessed,
# glazing fraction of the leaf).
#
# `recessed=False` is not a shortcut, it is the finding: an automatic slider does
# not swing, so Building Code §3202.2 does not force it back off the property
# line. That is why a 7-Eleven front is flat and a cafe front is not.
DOOR_SINGLE = ("hinged", 1, 1.00, True, 0.88)
DOOR_PAIR   = ("hinged", 2, 1.90, True, 0.88)
DOOR_SLIDE  = ("slide", 2, 2.00, False, 0.92)
DOOR_NULL   = ("hinged", 1, 0.95, False, 0.88)   # the deliberately dull default
DOORS = {
    "restaurant":       DOOR_PAIR,
    "fast_food":        DOOR_PAIR,
    "cafe":             DOOR_SINGLE,
    "convenience":      DOOR_SLIDE,
    "pub":              ("hinged", 2, 1.80, True, 0.45),
    "clothes":          DOOR_PAIR,
    "bar":              ("hinged", 1, 1.00, True, 0.10),
    "hairdresser":      DOOR_NULL,
    "bakery":           DOOR_SINGLE,
    "second_hand":      DOOR_SINGLE,
    "food_court":       ("hinged", 4, 3.60, True, 0.88),
    "copyshop":         DOOR_NULL,
    "supermarket":      ("slide", 2, 2.40, False, 0.92),
    "department_store": ("slide", 2, 2.40, False, 0.92),
    "ice_cream":        DOOR_SINGLE,
}

# ── Open at 22:00, for the half of the corpus OSM gives no hours for. Same
# "class habit" honesty CAT_TONES uses, and checked against the sourced half in
# docs/entrances/shopfronts.md §7.3: it agrees with the real opening_hours for
# Twin Liquors, Rally House, Urban Outfitters, Dive, 7-Eleven, Domino's and
# Dooby's, and is wrong for roughly one tenant in six.
OPEN_AT_22 = {
    "bar": 1, "pub": 1, "convenience": 1, "fast_food": 1, "restaurant": 1,
    "cannabis": 1, "e-cigarette": 1, "ice_cream": 1, "supermarket": 1,
}


def hex_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def rgb_hex(c):
    return "#" + "".join("%02x" % max(0, min(255, int(round(v)))) for v in c)


def mixc(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def luma(c):
    return 0.30 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def wall_ramp(hex_col):
    """day -> (golden, night) for an UNLIT surface. bake_drag.py's relationship,
    reproduced exactly so this pass and the streetwall behind it go dark
    together instead of inventing a second dusk."""
    c = hex_rgb(hex_col)
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    return rgb_hex(golden), rgb_hex(night)


def sign_ramp(hex_col):
    """day -> (golden, night) for a LIT surface, and this is the one ramp in the
    repo that goes UP at night.

    A shop fascia is not a wall. Channel letters and lightboxes are the brightest
    thing on a two-storey building after dark — it is the entire reason the Drag
    reads at night — so running a sign through wall_ramp would take Chipotle's
    red to #29181f and delete the pass at exactly the hour it matters most. So
    the night value is the brand hue pushed to near-full chroma and lifted, which
    is what an internally-lit sign of that colour actually looks like.
    """
    c = hex_rgb(hex_col)
    golden = mixc(c, [255, 190, 130], 0.14)
    mx = max(c) or 1
    mn = min(c)
    # Push to full chroma (a lit sign saturates), then lift toward its own hue at
    # high value rather than toward white — a sign that goes white at night is a
    # streetlight, not a sign.
    lit = mixc([min(255, v * (238.0 / mx)) for v in c], [255, 244, 226], 0.20)
    # ... but ONLY to the extent the fascia has a hue to saturate.
    #
    # THIS GUARD IS NOT DEFENSIVE, IT IS A BUG THE CHECK CAUGHT. `238/mx` on
    # Urban Outfitters' #1a1a1a is a 9.2x multiplier, so the first cut took a
    # black fascia from luma 26 by day to luma 239 at night — the darkest
    # storefront on Guadalupe rendering as the brightest object in the frame.
    # scripts/verify/places-check.mjs printed "day 26 -> night 239" next to six
    # sensible rows and that is the only reason it was noticed; every daytime
    # screenshot was perfect. A black or white shopfront at night is lit white
    # LETTERING on a fascia that stays dark, which at 0.5 m per pixel nets out
    # as a modest lift, not a lightbox.
    chroma = (mx - mn) / float(mx)
    neutral = mixc(c, [210, 205, 195], 0.35)
    night = mixc(neutral, lit, max(0.0, min(1.0, chroma * 1.6)))
    return rgb_hex(golden), rgb_hex(night)


def awning_col(hex_col):
    """The fascia colour, pre-corrected for a horizontal face in full sun."""
    c = hex_rgb(hex_col)
    c = [v * AWN_COOL for v in c]
    c = mixc(c, [90, 120, 160], AWN_BLUE)
    return rgb_hex(c)


def spread(hex_col):
    """max channel - min channel. The pale-neutral defect this repo has now
    recorded three times (Capitol bands, entrance glass, DKR videoboard) is a
    SPREAD failure, not a luma one: channels within ~14 of each other at any
    real brightness is a colour nobody chose. Asserted on every night value."""
    c = hex_rgb(hex_col)
    return max(c) - min(c)


HOURS_RE = re.compile(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})")


def latest_close(s):
    """The latest hour this place shuts, any day of the week, or None.

    NOT an opening_hours parser, deliberately — the syntax has month ranges,
    comma lists, `off`, and `J2 Dining` in this very cache carries
    `Jun-Jul: Mo-Fr 07:00-14:00, 16:30-20:00; ...`. Writing an interpreter for a
    3D city is the wrong job. This extracts the one number the renderer needs
    and reads every one of the 78 strings in the cache that carry hours.

    A close that is <= its own open has wrapped past midnight, so `15:00-02:00`
    is 26:00 and a dive bar is correctly open at 22:00.
    """
    if not s:
        return None
    if "24/7" in s:
        return 24.0
    best = None
    for m in HOURS_RE.finditer(s):
        o = int(m.group(1)) + int(m.group(2)) / 60.0
        c = int(m.group(3)) + int(m.group(4)) / 60.0
        if c <= o:
            c += 24.0
        best = c if best is None else max(best, c)
    return best


def open_state(pl):
    """(is_open, provenance). `S` where OSM published the hours, `G` where the
    category habit table had to answer."""
    c = latest_close(pl.get("hours"))
    if c is not None:
        return (c > SF_NIGHT_HOUR), "S"
    return bool(OPEN_AT_22.get(pl["cat"], 0)), "G"


# ── geometry ──────────────────────────────────────────────────────────
def to_m(lon, lat):
    return (lon * KX, lat * M_LAT)


def to_ll(x, y):
    return [round(x / KX, 7), round(y / M_LAT, 7)]


def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    p = pts[:-1] if pts and pts[0] == pts[-1] else list(pts)
    return p if signed_area(p) >= 0 else p[::-1]


def outer_ring(geom):
    return geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]


def pt_in_poly(x, y, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                inside = not inside
    return inside


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 < 1e-12:
        return math.hypot(px - ax, py - ay), (ax, ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy), (qx, qy)


class Grid(object):
    """Uniform bucket index. 2,169 road ways and 2,453 footprints against 153
    places is small, but the frontage test samples every wall edge every 2 m,
    which is ~90,000 nearest-road queries — linear scan there is minutes."""

    def __init__(self, cell):
        self.cell = cell
        self.b = defaultdict(list)

    def key(self, x, y):
        return (int(math.floor(x / self.cell)), int(math.floor(y / self.cell)))

    def add_seg(self, item, ax, ay, bx, by):
        n = max(1, int(math.hypot(bx - ax, by - ay) / self.cell) + 1)
        for i in range(n + 1):
            t = i / float(n)
            self.b[self.key(ax + (bx - ax) * t, ay + (by - ay) * t)].append(item)

    def add_box(self, item, x0, y0, x1, y1):
        for cx in range(self.key(x0, y0)[0], self.key(x1, y1)[0] + 1):
            for cy in range(self.key(x0, y0)[1], self.key(x1, y1)[1] + 1):
                self.b[(cx, cy)].append(item)

    def near(self, x, y, r=1):
        cx, cy = self.key(x, y)
        seen, out = set(), []
        for i in range(-r, r + 1):
            for j in range(-r, r + 1):
                for it in self.b.get((cx + i, cy + j), ()):
                    if id(it) in seen:
                        continue
                    seen.add(id(it))
                    out.append(it)
        return out


# ── loading ───────────────────────────────────────────────────────────
def load_roads():
    els = json.load(open(ROADS, encoding="utf-8"))["elements"]
    segs, g = [], Grid(40.0)
    for e in els:
        t = e.get("tags") or {}
        if t.get("highway") not in ROAD_CLASSES or not e.get("geometry"):
            continue
        pts = [to_m(p["lon"], p["lat"]) for p in e["geometry"]]
        for a, b in zip(pts, pts[1:]):
            if a == b:
                continue
            segs.append((a, b))
            g.add_seg(segs[-1], a[0], a[1], b[0], b[1])
    return segs, g


def load_buildings():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    out, g = [], Grid(60.0)
    for f in feats:
        p = f["properties"]
        gm = f["geometry"]
        if gm["type"] not in ("Polygon", "MultiPolygon"):
            continue
        ring = ccw([to_m(q[0], q[1]) for q in outer_ring(gm)])
        if len(ring) < 3:
            continue
        xs = [q[0] for q in ring]
        ys = [q[1] for q in ring]
        b = {"id": p.get("id"), "name": p.get("name"), "ring": ring,
             "h": p.get("final_height") or 0.0,
             "cls": (p.get("building_class") or "").lower(),
             "bbox": (min(xs), min(ys), max(xs), max(ys))}
        out.append(b)
        g.add_box(b, *b["bbox"])
    return out, g


def load_places():
    els = json.load(open(PLACES, encoding="utf-8"))["elements"]
    out = []
    for e in els:
        t = e.get("tags") or {}
        name = t.get("name")
        if not name:
            continue
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        cat = t.get("shop") or t.get("amenity") or "yes"
        out.append({"name": name, "cat": cat, "brand": t.get("brand"),
                    "cuisine": t.get("cuisine"), "osm": "%s/%s" % (e["type"], e["id"]),
                    "hours": t.get("opening_hours"),
                    "pt": to_m(lon, lat), "ll": (lon, lat)})
    return out


# ── frontage ──────────────────────────────────────────────────────────
def frontage(b, rgrid):
    """The pieces of this footprint that actually face a street.

    Every wall edge is walked in STEP-metre steps and each step point is asked
    two questions: is there a road centreline within FRONT_MAX, and does it lie
    on the OUTWARD side of this wall? The second question is the one that
    matters. Distance alone puts a shopfront on the back wall of any building
    that happens to be narrow, which is most of the Drag — Guadalupe is 20 m from
    the front of those shops and 45 m from the back, and 45 is inside a generous
    FRONT_MAX. Testing the normal instead of the distance is what makes the
    shopfronts face the street rather than the alley.

    Returns [(a, b, normal, length)] in ring order.
    """
    ring = b["ring"]
    n = len(ring)
    pieces = []
    for i in range(n):
        ax, ay = ring[i]
        bx, by = ring[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        if L < 1.0:
            continue
        ux, uy = dx / L, dy / L
        nx, ny = uy, -ux          # outward for a CCW ring
        steps = max(2, int(L / STEP) + 1)
        ok = []
        for s in range(steps + 1):
            t = s / float(steps)
            px, py = ax + dx * t, ay + dy * t
            best = FRONT_MAX + 1.0
            bq = None
            for (sa, sb) in rgrid.near(px, py, 1):
                d, q = seg_dist(px, py, sa[0], sa[1], sb[0], sb[1])
                if d < best:
                    best, bq = d, q
            good = (bq is not None and best <= FRONT_MAX
                    and ((bq[0] - px) * nx + (bq[1] - py) * ny) > 0.0)
            ok.append(good)
        # maximal runs of consecutive good steps
        s = 0
        while s <= steps:
            if not ok[s]:
                s += 1
                continue
            e = s
            while e + 1 <= steps and ok[e + 1]:
                e += 1
            t0, t1 = s / float(steps), e / float(steps)
            run = (t1 - t0) * L
            if run >= MIN_RUN:
                pieces.append(((ax + dx * t0, ay + dy * t0),
                               (ax + dx * t1, ay + dy * t1),
                               (nx, ny), run))
            s = e + 1
    return pieces


def arc_point(pieces, s):
    """(point, normal) at arc-length s along the frontage."""
    for (a, b, nrm, L) in pieces:
        if s <= L:
            t = (s / L) if L else 0.0
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), nrm
        s -= L
    a, b, nrm, L = pieces[-1]
    return b, nrm


def arc_slice(pieces, s0, s1):
    """The straight sub-segments of the frontage between two arc-lengths."""
    out, acc = [], 0.0
    for (a, b, nrm, L) in pieces:
        lo, hi = max(s0, acc), min(s1, acc + L)
        if hi - lo > 0.25:
            t0, t1 = (lo - acc) / L, (hi - acc) / L
            out.append(((a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                        (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1),
                        nrm))
        acc += L
    return out


def project_s(pieces, pt):
    """Arc-length of the frontage point nearest pt, and that distance."""
    best, bs, acc = 1e18, 0.0, 0.0
    for (a, b, nrm, L) in pieces:
        d, q = seg_dist(pt[0], pt[1], a[0], a[1], b[0], b[1])
        if d < best:
            best = d
            bs = acc + math.hypot(q[0] - a[0], q[1] - a[1])
        acc += L
    return bs, best


# ── colours per place ─────────────────────────────────────────────────
def stable_hash(s):
    hv = 0
    for ch in s:
        hv = (hv * 131 + ord(ch)) & 0xFFFFFFFF
    return hv


def sign_for(pl):
    """(hex, provenance, note). Brand first, then the labelled category tone."""
    for key in (pl["name"], pl.get("brand") or ""):
        if key in BRANDS:
            h, prov, note = BRANDS[key]
            return h, prov, note
    tones = CAT_TONES.get(pl["cat"], DEFAULT_TONE)
    return tones[stable_hash(pl["name"]) % len(tones)], "G", "category tone (" + pl["cat"] + ")"


def priority(pl):
    """Who gets the frontage when a building has more tenants than wall.

    A sourced brand outranks an unsourced one — not because chains matter more,
    but because a Chipotle-red band is information and a generative category tone
    is a guess, so when something has to be dropped the guess should go first.
    """
    _, prov, _ = sign_for(pl)
    rank = 0 if prov == "S" else 1
    food = 0 if pl["cat"] in ("restaurant", "cafe", "fast_food", "bar", "pub",
                              "ice_cream", "bakery", "food_court") else 1
    return (rank, food, pl["name"])


# ── emission ──────────────────────────────────────────────────────────
def quad(a, b, nrm, out_d, in_d):
    """A slab along a→b: out_d in front of the wall, in_d behind it."""
    nx, ny = nrm
    return [to_ll(a[0] + nx * out_d, a[1] + ny * out_d),
            to_ll(b[0] + nx * out_d, b[1] + ny * out_d),
            to_ll(b[0] - nx * in_d, b[1] - ny * in_d),
            to_ll(a[0] - nx * in_d, a[1] - ny * in_d),
            to_ll(a[0] + nx * out_d, a[1] + ny * out_d)]


def feat(ring_ll, props):
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "Polygon", "coordinates": [ring_ll]}}


def band_props(kind, fam, day, base, top, extra, lit):
    wg, wn = (sign_ramp(day) if lit else wall_ramp(day))
    p = {"kind": kind, "fam": fam, "wd": day, "wg": wg, "wn": wn,
         "base": round(base, 2), "h": round(top, 2)}
    p.update(extra)
    return p


def glow_props(kind, fam, day, night, base, top, extra, golden=None):
    """A surface whose night value is CHOSEN, not derived from its day value.

    wall_ramp and sign_ramp both compute the night colour from the day colour,
    which is right for a wall and for a fascia and wrong for the inside of a
    shop: the interior is dark grey by day because it is unlit and behind glass,
    and warm at 108 luma at night because someone turned the lights on. There is
    no function of #332d26 that produces #ffbe5e, and pretending there is would
    be the same class of error as running a sign through the wall ramp.
    """
    g = golden or rgb_hex(mixc(hex_rgb(day), [255, 190, 130], 0.14))
    p = {"kind": kind, "fam": fam, "wd": day, "wg": g, "wn": night,
         "base": round(base, 2), "h": round(top, 2)}
    p.update(extra)
    return p


def frame(a, b, nrm):
    """(origin, along-unit, normal, length) for one straight frontage run.

    Everything the entry emits is a plan rectangle in (s, d): s metres along the
    wall from a, d metres out from it. One helper instead of six bespoke quads,
    which is the only reason the pier is allowed to be a box with real depth
    rather than a zero-thickness face plus a separate return.
    """
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L) if L > 1e-9 else (1.0, 0.0)
    return (a, u, nrm, L)


def box(fr, s0, s1, d0, d1):
    (a, u, n, _L) = fr

    def P(s, d):
        return to_ll(a[0] + u[0] * s + n[0] * d, a[1] + u[1] * s + n[1] * d)
    return [P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1), P(s0, d0)]


def door_layout(L, spec, name):
    """Where the entry bay sits on a frontage run of length L, or None.

    Placement follows docs/entrances/placement.md's discipline rather than
    scatter: the door goes at the tenant's own frontage midpoint — the same arc
    position the label already uses — nudged to one end on a long slot because
    a real shopfront puts the door at one end and the display window at the
    other. Which end is a stable hash of the name, so a street is varied and
    does not reshuffle between bakes.

    Three trials, widest first. A 5 m slot cannot carry a pair door with side
    returns AND 1.2 m of plain wall at each end, so it drops the returns, then
    the piers, then gives up and is counted.
    """
    dt, leaves, open_w, recessed, glaz = spec
    trials = ([(SF_RETURN_W, SF_PIER_W), (0.0, SF_PIER_W), (0.0, 0.0)]
              if recessed else [(0.0, 0.0)])
    for ret, pier in trials:
        bay = open_w + 2 * ret
        half = bay * 0.5 + pier + SF_EDGE_MIN
        if 2 * half > L:
            continue
        c = L * 0.5
        if L > SF_BIAS_LEN:
            c = L * (SF_DOOR_BIAS if (stable_hash(name) & 1) else 1.0 - SF_DOOR_BIAS)
        c = max(half, min(L - half, c))
        return {"dt": dt, "leaves": leaves, "open_w": open_w, "glaz": glaz,
                "pier": pier, "b0": c - bay * 0.5, "b1": c + bay * 0.5}
    return None


def build_entry(fr, lay, glass_top, meta, is_open):
    """The entry itself: lit back plane, piers, lintel, leaves, lights, pool.

    Emitted deepest-first so the draw order is the physical order even where two
    planes are 0.02 m apart.
    """
    out = []
    pier = lay["pier"]
    b0, b1 = lay["b0"], lay["b1"]
    p0, p1 = b0 - pier, b1 + pier          # outer face of the entry frame
    head_top = min(SF_DOOR_HEAD + SF_HEAD_T, glass_top)
    lit = SF_GLOW_OPEN if is_open else SF_GLOW_CLOSED
    d_face = SF_PIER_PROUD if pier > 0 else PROUD
    d_leaf = SF_LEAF_PROUD if pier > 0 else SF_FLUSH_PROUD

    # 1. THE LIT INTERIOR. The one surface in this pass that carries the night.
    #    UNO §25-2-753(H)(5) puts at least 5.49 m of occupant space behind it by
    #    ordinance, so a shopfront after dark is a lit ROOM seen through a pane,
    #    not a lit pane — and the two do not look the same.
    out.append(feat(box(fr, b0, b1, SF_BACK_PROUD, SF_BACK_PROUD + SF_BACK_T),
                    glow_props("entry", "plBack", SF_BACK_DAY, lit,
                               0.0, SF_DOOR_HEAD, meta)))

    # 2. The piers. Plan depth 0.06 -> 0.38, so the box IS the jamb return.
    if pier > 0:
        for s0, s1 in ((p0, b0), (b1, p1)):
            out.append(feat(box(fr, s0, s1, SF_BACK_PROUD, SF_PIER_PROUD),
                            band_props("entry", "plPier", SF_PIER_COL,
                                       0.0, head_top, meta, False)))

    # 3. The lintel that closes the top of the bay.
    if head_top > SF_DOOR_HEAD + 0.02:
        out.append(feat(box(fr, p0, p1, SF_BACK_PROUD, d_face),
                        band_props("entry", "plHead", SF_PIER_COL,
                                   SF_DOOR_HEAD, head_top, meta, False)))

    # 4. The leaves, and the light in each. glaz_frac shrinks the light from the
    #    top rail down, so a bar's near-solid leaf keeps a vision panel and a
    #    cafe's narrow-stile leaf is almost all glass.
    n = max(1, lay["leaves"])
    o0 = (b0 + b1) * 0.5 - lay["open_w"] * 0.5
    lw = lay["open_w"] / n
    for i in range(n):
        s0 = o0 + i * lw + SF_LEAF_GAP * 0.5
        s1 = o0 + (i + 1) * lw - SF_LEAF_GAP * 0.5
        out.append(feat(box(fr, s0, s1, d_leaf, d_leaf + SF_LEAF_T),
                        band_props("entry", "plLeaf", SF_LEAF_COL,
                                   0.0, SF_LEAF_H, meta, False)))
        g0, g1 = s0 + SF_LEAF_STILE, s1 - SF_LEAF_STILE
        z1 = SF_LEAF_H - SF_LEAF_TOPR
        z0 = z1 - (z1 - SF_LEAF_BOT) * min(1.0, lay["glaz"] / 0.88)
        if g1 - g0 > 0.12 and z1 - z0 > 0.20:
            out.append(feat(box(fr, g0, g1, d_leaf + SF_LEAF_T,
                                d_leaf + SF_LEAF_T + SF_LITE_PROUD),
                            glow_props("entry", "plLite", SF_LITE_DAY, lit,
                                       z0, z1, meta)))

    # 5. The pool of spill, open tenants only. A closed shop's non-pool is the
    #    entire reason for working out which shops are closed.
    if is_open and SF_POOL_ON:
        out.append(feat(box(fr, p0 - SF_POOL_FLARE, p1 + SF_POOL_FLARE,
                            SF_POOL_NEAR, SF_POOL_FAR),
                        glow_props("pool", "plPool", SF_POOL_DAY, SF_POOL_NIGHT,
                                   SF_POOL_Z0, SF_POOL_Z1, meta,
                                   golden=SF_POOL_GOLD)))
    return out, (p0, p1)


def build_slot(segs, H, sign_hex, meta, spec=None, is_open=False, stats=None):
    """One tenant's shopfront: bulkhead, glazing, awning, fascia — and, on the
    longest of its straight runs, one entry.

    Emitted per straight sub-segment, because a corner shop's frontage turns and
    a single quad cannot. THE ENTRY GOES ON EXACTLY ONE RUN: a tenant with a
    corner gets one door, not one per elevation. Subchapter E §3.x's 75 ft rule
    would allow a second on a frontage over 22.9 m and MAX_W caps a tenant at
    15 m, so a second door is unreachable here and is not implemented.

    The bulkhead and the glazing are SPLIT around the bay rather than drawn
    through it. That is what makes the notch a notch: the storefront plane is
    genuinely absent for the width of the entry, and the surfaces inside it
    stand 0.32 m further back than the piers that frame them. Drawing the glass
    straight through and putting a dark rectangle in front of it would be the
    "darker rectangle" this pass exists to stop being.
    """
    # Same clamp js/drag.js's retail_bands uses, so a fascia lands on a fascia.
    glass_top = min(SHOP_DATUM, SHOP_MAX_FRAC * H)
    sign_top = min(glass_top + SIGN_H, SIGN_MAX_FRAC * H)
    bulk_top = min(BULKHEAD, glass_top * 0.30)
    awn_top = glass_top - AWN_DROP
    awn_base = awn_top - AWN_T

    # Which run carries the door: the longest one. Short returns round a corner
    # get plain glass, which is what they are.
    door_i = -1
    if SF_ENTRY_ON and spec is not None and glass_top >= SF_MIN_GLASS_TOP:
        door_i = max(range(len(segs)),
                     key=lambda i: math.hypot(segs[i][1][0] - segs[i][0][0],
                                              segs[i][1][1] - segs[i][0][1]))
    elif spec is not None and stats is not None:
        stats["door_host_too_short"] += 1

    out = []
    for i, (a, b, nrm) in enumerate(segs):
        fr = frame(a, b, nrm)
        L = fr[3]
        lay = door_layout(L, spec, meta["nm"]) if i == door_i else None
        if i == door_i and lay is None and stats is not None:
            stats["door_run_too_narrow"] += 1

        # Spans of the storefront plane that survive the bay.
        if lay:
            ent, (p0, p1) = build_entry(fr, lay, glass_top, meta, is_open)
            out.extend(ent)
            spans = [(0.0, p0), (p1, L)]
            if stats is not None:
                stats["doors"] += 1
                stats["door_" + lay["dt"]] += 1
                stats["door_recessed" if lay["pier"] > 0 else "door_flush"] += 1
        else:
            spans = [(0.0, L)]

        for s0, s1 in spans:
            if s1 - s0 < 0.30:
                continue
            wall = box(fr, s0, s1, -INSET, PROUD)
            out.append(feat(wall, band_props("front", "plBulk", BULK_COL,
                                             0.0, bulk_top, meta, False)))
            out.append(feat(wall, band_props("front", "plGlass", GLASS_COL,
                                             bulk_top, glass_top, meta, False)))
        # Glass over the entry, so the glazing line runs unbroken across the
        # elevation the way a real storefront's does. Same pattern, same layer,
        # no new atlas image.
        if lay:
            head_top = min(SF_DOOR_HEAD + SF_HEAD_T, glass_top)
            if glass_top - head_top > 0.15:
                out.append(feat(box(fr, p0, p1, -INSET, PROUD),
                                band_props("front", "plGlass", GLASS_COL,
                                           head_top, glass_top, meta, False)))
        # The fascia is NOT split: a shop sign runs over its own door.
        out.append(feat(box(fr, 0.0, L, -INSET, PROUD),
                        band_props("front", "plSign", sign_hex,
                                   glass_top, sign_top, meta, True)))
        # The awning. Its own quad because it cantilevers past the slab, and its
        # own colour because its top face is the one surface here that the sun
        # tint hits square on.
        if awn_base > bulk_top + 0.4:
            awn = quad(a, b, nrm, AWN_PROJ, -PROUD * 0.5)
            out.append(feat(awn, band_props("awning", "plAwn", awning_col(sign_hex),
                                            awn_base, awn_top, meta, False)))
    return out


def main():
    roads, rgrid = load_roads()
    builds, bgrid = load_buildings()
    places = load_places()

    stats = Counter()
    unmatched, no_front, too_deep, over_cap = [], [], [], []
    hours_guessed = []

    # The night values are the claim most likely to be wrong in this pass, so
    # assert their shape before anything is drawn rather than after a screenshot
    # looks plausible. docs/entrances/shopfronts.md §7.4: SPREAD, not luma.
    for nm, hx in (("SF_GLOW_OPEN", SF_GLOW_OPEN),
                   ("SF_GLOW_CLOSED", SF_GLOW_CLOSED),
                   ("SF_POOL_NIGHT", SF_POOL_NIGHT)):
        assert spread(hx) >= 24, "%s is a pale neutral (spread %d)" % (nm, spread(hx))
    assert SF_PIER_PROUD <= 0.41 and SF_PIER_PROUD >= 0.32, "pier is out of the free plane band"
    assert SF_BACK_PROUD > 0.0, "the back plane cannot go inside the host wall"

    # 1. host building per place -----------------------------------------
    by_host = defaultdict(list)
    for pl in places:
        x, y = pl["pt"]
        host = None
        for b in bgrid.near(x, y, 1):
            if pt_in_poly(x, y, b["ring"]):
                host = b
                break
        if host is None:
            best = HOST_SNAP
            for b in bgrid.near(x, y, 1):
                ring = b["ring"]
                for i in range(len(ring)):
                    d, _ = seg_dist(x, y, ring[i][0], ring[i][1],
                                    ring[(i + 1) % len(ring)][0], ring[(i + 1) % len(ring)][1])
                    if d < best:
                        best, host = d, b
        if host is None or not host["id"] or host["h"] < 2.5:
            unmatched.append(pl["name"])
            continue
        pl["host"] = host
        by_host[host["id"]].append(pl)
    stats["hosted"] = sum(len(v) for v in by_host.values())

    # 2. frontage, allocation, emission ----------------------------------
    feats, drawn = [], []
    _fcache = {}
    for hid, tenants in sorted(by_host.items()):
        host = tenants[0]["host"]
        pieces = _fcache.get(hid) or frontage(host, rgrid)
        _fcache[hid] = pieces
        if not pieces:
            no_front.extend(t["name"] for t in tenants)
            continue
        L = sum(p[3] for p in pieces)

        # Drop tenants that sit far behind the frontage they would be given: a
        # dining hall counter 60 m inside Jester is not a shopfront, and drawing
        # one on the street face would be inventing a business that is not there.
        keep = []
        for t in tenants:
            s, d = project_s(pieces, t["pt"])
            if d > POI_FRONT_MAX:
                too_deep.append("%s (%.0f m deep)" % (t["name"], d))
                continue
            t["_s"] = s
            keep.append(t)
        if not keep:
            continue

        cap = max(1, int(L // (MIN_W + GAP)))
        if len(keep) > cap:
            keep.sort(key=priority)
            over_cap.extend(t["name"] for t in keep[cap:])
            keep = keep[:cap]
        keep.sort(key=lambda t: t["_s"])

        n = len(keep)
        share = L / n
        w = max(MIN_W, min(MAX_W, share - GAP))
        for i, t in enumerate(keep):
            s0 = i * share + (share - w) * 0.5
            segs = arc_slice(pieces, max(0.0, s0), min(L, s0 + w))
            if not segs:
                continue
            sign_hex, prov, note = sign_for(t)
            is_open, hprov = open_state(t)
            spec = DOORS.get(t["cat"], DOOR_NULL)
            meta = {"nm": t["name"], "cat": t["cat"], "src": prov, "bid": hid,
                    "open": 1 if is_open else 0, "hsrc": hprov}
            feats.extend(build_slot(segs, host["h"], sign_hex, meta,
                                    spec=spec, is_open=is_open, stats=stats))
            stats["slots"] += 1
            stats["prov_" + prov] += 1
            stats["open" if is_open else "closed"] += 1
            stats["hours_" + hprov] += 1
            if hprov == "G":
                hours_guessed.append("%s (%s -> %s)" % (t["name"], t["cat"],
                                                        "open" if is_open else "closed"))

            # The label. Placed at the middle of the tenant's own frontage and
            # pushed clear of the building so it is not buried in the wall, and
            # carrying the fascia colour so js/places.js can pick a halo that
            # actually contrasts rather than assuming dark-on-light.
            mid = arc_slice(pieces, max(0.0, s0 + w * 0.5 - 0.5),
                            min(L, s0 + w * 0.5 + 0.5))
            if mid:
                (pa, pb, nrm) = mid[0]
                cx = (pa[0] + pb[0]) * 0.5 + nrm[0] * (AWN_PROJ + 1.0)
                cy = (pa[1] + pb[1]) * 0.5 + nrm[1] * (AWN_PROJ + 1.0)
                feats.append({
                    "type": "Feature",
                    "properties": {"kind": "label", "nm": t["name"], "cat": t["cat"],
                                   "src": prov, "sign": sign_hex,
                                   "dark": 1 if luma(hex_rgb(sign_hex)) < LIGHT_TEXT_MAX_LUMA else 0},
                    "geometry": {"type": "Point", "coordinates": to_ll(cx, cy)}})
            drawn.append((t["name"], t["cat"], sign_hex, prov, note))

    # 3. collision check. This pass replaces NOTHING, so the only way it can
    #    collide is if some future edit gives it ids; assert the invariant here
    #    rather than discovering it in a screenshot.
    replaced = []
    clash = []
    for other in ("stadium", "tower", "westcampus", "arts", "moody", "drag"):
        path = os.path.join(ROOT, "data", other + ".geojson")
        if not os.path.exists(path):
            continue
        try:
            ids = set(json.load(open(path, encoding="utf-8")).get("replacedBuildingIds") or [])
        except Exception:
            continue
        hit = sorted(ids & set(replaced))
        if hit:
            clash.append({"file": other + ".geojson", "ids": hit})

    fc = {"type": "FeatureCollection", "features": feats, "replacedBuildingIds": replaced}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))

    sourced = [d for d in drawn if d[3] == "S"]
    gen = [d for d in drawn if d[3] == "G"]
    by_fam = Counter(f["properties"].get("fam") for f in feats)
    by_kind = Counter(f["properties"]["kind"] for f in feats)
    print(json.dumps({
        "places_named_in_osm": len(places),
        "hosted_to_a_building": stats["hosted"],
        "shopfronts_drawn": stats["slots"],
        "features": len(feats),
        "extrusion_features": sum(1 for f in feats if f["properties"]["kind"] != "label"),
        "labels": sum(1 for f in feats if f["properties"]["kind"] == "label"),
        "by_kind": dict(sorted(by_kind.items(), key=lambda kv: -kv[1])),
        "by_fam": dict(sorted(by_fam.items(), key=lambda kv: -kv[1])),
        "entries": {
            "doors_drawn": stats["doors"],
            "recessed": stats["door_recessed"],
            "flush": stats["door_flush"],
            "hinged": stats["door_hinged"],
            "sliding": stats["door_slide"],
            "no_door_host_too_short": stats["door_host_too_short"],
            "no_door_run_too_narrow": stats["door_run_too_narrow"],
            "open_at_2200": stats["open"],
            "closed_at_2200": stats["closed"],
            "hours_sourced_from_osm": stats["hours_S"],
            "hours_from_category_habit": stats["hours_G"],
            "pools_on_the_pavement": by_fam.get("plPool", 0),
        },
        "atlas_images_added": 0,
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "sign_colour_sourced": len(sourced),
        "sign_colour_generative": len(gen),
        "dropped": {
            "no_host_building": sorted(set(unmatched)),
            "host_has_no_street_frontage": sorted(set(no_front)),
            "poi_too_deep_inside": sorted(set(too_deep)),
            "frontage_full": sorted(set(over_cap)),
        },
        "collisions_with_other_passes": clash,
        "provenance": {
            "place_list": "factual - OSM amenity/shop within the detailed bbox, fetched 2026-07-31",
            "host_assignment": "factual - point-in-polygon against the snapshot's own footprints",
            "frontage": "factual - geometric, wall normal vs the OSM road centreline network",
            "band_datum": "factual - SHOP_DATUM/SIGN_H taken from js/drag.js so the two passes agree",
            "sign_colours_sourced": "SOURCED - %d storefronts; published brand guides or hexes sampled from the company's own stylesheets" % len(sourced),
            "sign_colours_generative": "GENERATIVE - %d storefronts; a per-category tone, no per-business hex was available" % len(gen),
            "awning_presence": "GENERATIVE - awnings are drawn on every shopfront; the real street is patchier",
            "logos": "DELIBERATELY ABSENT - no brand artwork is downloaded or embedded",
            "door_type": "GENERATIVE - by category, docs/entrances/shopfronts.md 5.3. OSM says nothing about doors.",
            "door_position": "DERIVED - the tenant's own frontage midpoint, the arc position the label already uses",
            "open_at_2200_sourced": "SOURCED - %d tenants; the latest closing hour in OSM opening_hours" % stats["hours_S"],
            "open_at_2200_generative": "GENERATIVE - %d tenants; the category habit table OPEN_AT_22, wrong about one in six" % stats["hours_G"],
            "recess_depth": "DERIVED but CLAMPED - the spec derives 1.00-1.50 m from Building Code 3202.2; "
                            "this pass owns no building so there is nothing to recess into, and the notch is "
                            "the 0.32 m between the free plane band and the host wall.",
        },
    }, indent=2))
    print("\n-- night values (spread must be >= 24; luma bimodality does NOT apply) --")
    for nm, hx in (("SF_GLOW_OPEN", SF_GLOW_OPEN), ("SF_GLOW_CLOSED", SF_GLOW_CLOSED),
                   ("SF_POOL_NIGHT", SF_POOL_NIGHT)):
        c = hex_rgb(hx)
        print("  %-16s %s  luma %3d  spread %3d  R:B %.2f"
              % (nm, hx, luma(c), spread(hx), c[0] / max(1.0, float(c[2]))))
    print("\n-- open/closed GUESSED from the category (no OSM hours): %d --" % len(hours_guessed))
    print("  " + ", ".join(sorted(hours_guessed)))
    print("\n-- sourced sign colours --")
    seen = set()
    for nm, cat, hx, prov, note in sorted(drawn):
        if prov != "S" or nm in seen:
            continue
        seen.add(nm)
        print("  %-30s %-8s %s   %s" % (nm[:30], hx, cat, note))
    print("\n-- NO sourced colour (%d storefronts, category tone) --" % len(gen))
    print("  " + ", ".join(sorted({d[0] for d in gen})))
    print("\n-- sampled and REJECTED (framework defaults, not brand decisions) --")
    for nm, why in sorted(SAMPLED_AND_REJECTED.items()):
        print("  %-24s %s" % (nm[:24], why))


if __name__ == "__main__":
    main()
