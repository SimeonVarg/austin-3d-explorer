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

Usage:  python scripts/bake_places.py
"""
import json
import math
import os
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


def build_slot(segs, H, sign_hex, meta):
    """One tenant's shopfront: bulkhead, glazing, awning, fascia.

    Emitted per straight sub-segment, because a corner shop's frontage turns and
    a single quad cannot. Four features per sub-segment, and a tenant is one
    sub-segment in the overwhelming majority of cases.
    """
    # Same clamp js/drag.js's retail_bands uses, so a fascia lands on a fascia.
    glass_top = min(SHOP_DATUM, SHOP_MAX_FRAC * H)
    sign_top = min(glass_top + SIGN_H, SIGN_MAX_FRAC * H)
    bulk_top = min(BULKHEAD, glass_top * 0.30)
    awn_top = glass_top - AWN_DROP
    awn_base = awn_top - AWN_T
    out = []
    for (a, b, nrm) in segs:
        wall = quad(a, b, nrm, PROUD, INSET)
        out.append(feat(wall, band_props("front", "plBulk", BULK_COL,
                                         0.0, bulk_top, meta, False)))
        out.append(feat(wall, band_props("front", "plGlass", GLASS_COL,
                                         bulk_top, glass_top, meta, False)))
        out.append(feat(wall, band_props("front", "plSign", sign_hex,
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
            meta = {"nm": t["name"], "cat": t["cat"], "src": prov, "bid": hid}
            feats.extend(build_slot(segs, host["h"], sign_hex, meta))
            stats["slots"] += 1
            stats["prov_" + prov] += 1

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
    print(json.dumps({
        "places_named_in_osm": len(places),
        "hosted_to_a_building": stats["hosted"],
        "shopfronts_drawn": stats["slots"],
        "features": len(feats),
        "extrusion_features": sum(1 for f in feats if f["properties"]["kind"] != "label"),
        "labels": sum(1 for f in feats if f["properties"]["kind"] == "label"),
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
        },
    }, indent=2))
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
