# -*- coding: utf-8 -*-
"""The modern east precinct: Moody Center and the two Dell Med blocks.

WHY THESE THREE BUILDINGS NEED GEOMETRY AND NOT JUST A TEXTURE.

A `fill-extrusion-pattern` has no vertical anchor. It repeats from the extrusion
base with no idea where the top or the bottom of the building is, so anything
keyed to a level -- a ground floor, a mechanical crown, the underside of a roof
that oversails the wall -- appears every repeat all the way up. Measured, that
repeat is 30 m at tile zoom 17 and 59 m at 16, which is most of these buildings.
So each one is emitted as STACKED BANDS: several features, each with its own
base, height, plan inset and pattern. That is the same device `bake_stadium.py`
uses for DKR and it is the only one available here.

WHAT THE REFERENCE ACTUALLY SAID, because two of the three briefs were wrong.

  MOODY CENTER (Gensler, 2022, 15,000 seats). Not a bowl -- an arena, closed
  roof. Its envelope is layered, not gridded: a dark bronze metal-composite
  plinth, a band of vertical bronze airfoil fins, a glazed concourse ribbon, and
  then a very deep roof that OVERSAILS the wall on every side with a wood
  soffit underneath. The oversail is what this bake buys up there. It is NOT a
  brightness fix, and that correction is worth carrying: the snapshot paints the
  roof #434347 while roof_survey.json measures the real membrane at
  [255,255,253], which made "we are fixing a dark lid" look obvious. Matched
  before/after frames say otherwise -- luma 200.6 -> 192.6 against a control
  that moved 0.6. Top faces in this scene are already lifted hard.

  DELL MED (ZGF with Page, 2018). The brief for this pass expected a unitised
  curtain wall with spandrel panels and sunshade fins. The photographs show the
  opposite and the photograph wins: a stone rainscreen with DEEPLY RECESSED
  PUNCHED WINDOWS, no fins, and shading done by the reveal depth itself. The
  glazing ratio is measured, not asserted -- clustering 1.86 Mpx of pure
  elevation off the architect's own photograph puts vision glass at 19.8% of the
  wall, against the 51% a curtain-wall family would draw. The signature is the
  copper-coloured window reveal: 5.6% of the elevation at #cda080, and it is
  what makes the block read warm from a distance rather than grey.

  NEURAL MOLECULAR SCIENCE was in the brief for this pass and is NOT here. Its
  footprint in the snapshot sits on a red clay-tile hipped-roof block -- see
  docs/PASS_MOODY.md for the overlay. data/roofs.geojson already gives it 49
  pitched terracotta facets. Cladding it in curtain wall would have replaced a
  correct heritage roof with a wrong modern one and collided with another pass.

HEIGHTS ARE NOT INVENTED UPWARD. Every band is a fraction of the `final_height`
already in the data and the topmost band ends exactly there, so the parapet cap,
the roofscape deck and its rooftop plant all land where the rest of the app
already expects them. The one thing that rises above `final_height` is the plant
screen, and it starts at the deck datum (`final_height + capLift`) rather than
floating -- which is where a real mechanical enclosure sits, on the roof.

Usage:  python scripts/bake_moody.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "moody.geojson")
M_LAT = 111320.0

# ── Taste block. Every value here is a one-line override. ─────────────
#
# Fractions of each building's own final_height, so nothing here depends on a
# height being right in absolute terms. `inset` is metres: POSITIVE shrinks the
# ring inward, NEGATIVE grows it outward (that is how the Moody oversail is
# expressed). `tile` names an image registered by js/moody.js.
#
# MOODY_OVERSAIL is measured off the nadir crop: the smooth apron outside the
# Overture footprint runs 4.7 m on the west edge and 5.8 m on the south.
MOODY_OVERSAIL = 5.0

# THE TOPMOST ELEMENT OF EVERY BUILDING HERE IS AT THE FULL FOOTPRINT AND ENDS
# AT final_height, AND THAT IS A CONSTRAINT, NOT A STYLE CHOICE. js/roofs.js
# draws a measured roof deck for every core building at final_height + capLift,
# covering the whole footprint. The first cut of this file raised a white
# membrane on a 14 m inset and stopped at final_height, which left that deck
# with nothing under it for 3.2 m over the whole ring outside the inset -- a
# pale lid hanging in the air above the apron, and it would have read as a
# broken layer rather than as the layer working exactly as written. So the
# stepped roof is expressed BELOW the deck datum: the oversailing apron is a
# thin slab at the grown ring, and the membrane closes the top at the real
# footprint.
BANDS = {
    "Moody Center": [
        # name       f0      f1      inset            kind    tile
        ("plinth",   0.000,  0.300,  0.0,             "wall", "moody-plinth"),
        ("fins",     0.300,  0.640,  0.0,             "wall", "moody-fins"),
        ("glass",    0.640,  0.800,  0.0,             "wall", "moody-glass"),
        ("fascia",   0.800,  0.940, -MOODY_OVERSAIL,  "wall", "moody-fascia"),
        ("apron",    0.940,  0.955, -MOODY_OVERSAIL,  "roof", None),
        ("membrane", 0.955,  1.000,  0.0,             "roof", None),
    ],
    # 10 storeys over a 2-storey podium, clinical. 46.1 m.
    "Health Transformation Building": [
        ("podium",   0.000, 0.195, 0.0, "wall", "health-podium"),
        ("body",     0.195, 0.835, 0.0, "wall", "health-body-cream"),
        ("attic",    0.835, 1.000, 0.0, "wall", "health-attic-cream"),
        ("plant",    1.000, 1.076, 12.0, "plant", None),
    ],
    # 7 storeys of wet lab over the same podium. 44.8 m, and the roof is a solid
    # field of exposed ductwork in the nadir crop -- the plant screen is bigger
    # and taller here for that reason, not for variety.
    "Health Discovery Building": [
        ("podium",   0.000, 0.201, 0.0, "wall", "health-podium"),
        ("body",     0.201, 0.804, 0.0, "wall", "health-body-grey"),
        ("attic",    0.804, 1.000, 0.0, "wall", "health-attic-grey"),
        ("plant",    1.000, 1.100, 9.0, "plant", None),
    ],
}

# ── Colours. Every hex below is SAMPLED unless the comment says authored. ──
#
# Sampled means: k-means over a rectangle of pure elevation in a named
# photograph, taking a cluster centre rather than a box mean. A box mean across
# a material boundary is a colour that exists nowhere on the building, and the
# first pass at this sampled the reveal three times and got grey stone twice.
# Provenance per value is in docs/PASS_MOODY.md.
#
# These are DAY values, and day here means "sunlit albedo" -- the same thing the
# snapshot's own `wd` means and the same convention bake_stadium.py's SIDE_MID
# uses.
WALL_DAY = {
    "moody-plinth":       "#5a5147",   # ALPOLIC dark bronze MCM, sunlit
    "moody-fins":         "#493c34",   # fin screen, area-weighted distant read
    "moody-glass":        "#8fa3ad",   # Solarban 70, reflecting sky
    "moody-fascia":       "#4a423a",   # roof edge, authored between MCM sun/shade
    "health-podium":      "#efe5d8",   # pale ribbed ground-floor band
    "health-body-cream":  "#cfc4b2",   # cream limestone (HTB)
    "health-body-grey":   "#9e918b",   # grey stone rainscreen (HDB)
    # The mechanical level is DERIVED FROM ITS OWN BUILDING'S STONE, not shared.
    # A single authored tone for both is a stronger claim than the references
    # support: it lands as a 10% step on the grey block and a 30% one on the
    # cream, so the cream building would wear a dark hat that no photograph
    # shows. Same stone, louvred instead of punched, and a little in its own
    # shade is the conservative reading, and the louvre texture is what actually
    # says "this is the plant level" at 400 m.
    "health-attic-cream": None,        # filled below
    "health-attic-grey":  None,
}
ATTIC_SHADE = 0.88   # how far the attic sits below its body's value


def _shade(hex_col, k):
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(v * k)))) for v in c)


WALL_DAY["health-attic-cream"] = _shade(WALL_DAY["health-body-cream"], ATTIC_SHADE)
WALL_DAY["health-attic-grey"] = _shade(WALL_DAY["health-body-grey"], ATTIC_SHADE)

# Roof and plant top faces. ENTERED COOL ON PURPOSE. An extrusion's top face
# picks up the sun tint, and the measured value here is the problem case: the
# membrane photographs at [255,255,253], so any warm entry saturates. DKR's bake
# hit the same wall and solved it the same way -- its seating tones are entered
# at R/B 0.85-0.89 to land neutral. #dbe6f2 is R/B 0.897, the same ratio.
ROOF_DAY = {
    "apron":    "#c2cddb",   # the light grey walk-on apron outside the membrane
    "membrane": "#dbe6f2",   # white TPO, measured [255,255,253], entered cool
    "plant":    "#8e9298",   # louvred mechanical screen, authored
}


def ramp(hex_col, warm=0.16, night_mix=0.42):
    """day -> (golden, night), the relationship every other bake here uses.

    Checked against DKR's own baked trio (#b7b1a6 -> #c3b19c / #1e2029). Carried
    in this file rather than taken from the city palette for the reason
    bake_stadium.py documents: nearest-RGB against fourteen mostly-tan buckets
    quietly turns any distinctive material back into tan, and the entire point
    of this pass is the three materials that are not tan.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], warm)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], night_mix)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ── geometry helpers (same shape as bake_stadium.py's, deliberately) ──
def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    return p


def offset(pts, d):
    """Offset a closed ring by d metres. POSITIVE d grows the ring OUTWARD.

    Edge offset plus consecutive-line intersection. Returns None when the result
    degenerates, which is the right answer for an inset larger than the shape --
    a 12 m inset on a 20 m wide wing has no meaningful answer and the caller
    drops the band rather than emitting a bow tie.
    """
    p = ccw(pts)
    n = len(p)
    if n < 3:
        return None
    lines = []
    for i in range(n):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        nx, ny = dy / L, -dx / L
        lines.append((x0 + nx * d, y0 + ny * d, dx, dy))
    out = []
    for i in range(n):
        ax, ay, adx, ady = lines[i - 1]
        bx, by, bdx, bdy = lines[i]
        den = adx * bdy - ady * bdx
        if abs(den) < 1e-9:
            return None
        t = ((bx - ax) * bdy - (by - ay) * bdx) / den
        out.append((ax + adx * t, ay + ady * t))
    ring = out + [out[0]]
    if signed_area(ring) <= 1.0:
        return None
    # A self-intersecting offset still has positive area, so area alone does not
    # catch a bow tie. Reject any offset that grew the perimeter, which is what
    # an inward offset that has folded through itself always does.
    per0 = sum(math.dist(p[i], p[(i + 1) % n]) for i in range(n))
    per1 = sum(math.dist(out[i], out[(i + 1) % n]) for i in range(n))
    if d < 0 and per1 > per0:
        return None
    return ring


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in ring]


# app.js's parapet rule, carried here so the deck datum this bake reasons about
# is the same one the rest of the app computes. window.CAP_GEOM.liftFor.
def cap_lift(h):
    return max(1.0, 0.015 * h)


def build(feature, stats):
    p = feature["properties"]
    g = feature["geometry"]
    name = p["name"]
    h = p.get("final_height") or 0
    spec = BANDS[name]

    rings_ll = g["coordinates"] if g["type"] == "Polygon" else max(
        g["coordinates"], key=lambda poly: abs(signed_area(ccw(poly[0]) + [ccw(poly[0])[0]])))
    outer_ll = rings_ll[0]
    lat0 = sum(q[1] for q in outer_ll) / len(outer_ll)
    base_ring = ccw(to_m(outer_ll, lat0))

    out = []
    for bname, f0, f1, inset, kind, tile in spec:
        ring = base_ring
        used_inset = inset
        if abs(inset) > 1e-6:
            # Retry smaller rather than dropping the band. HTB's footprint has a
            # narrow wing, so its 12 m plant inset degenerates while a 7 m one is
            # fine -- and losing the plant screen entirely on the one building
            # whose brief calls the penthouse "the most-missing feature" is a
            # much worse answer than a slightly larger screen.
            r = None
            for frac in (1.0, 0.75, 0.55, 0.4, 0.28):
                used_inset = inset * frac
                r = offset(base_ring + [base_ring[0]], -used_inset)
                if r is not None:
                    break
            if r is None:
                stats["offset_failed_%s" % bname] += 1
                continue
            if used_inset != inset:
                stats["offset_reduced_%s" % bname] += 1
            ring = ccw(r)
        base_m = h * f0
        top_m = h * f1
        if kind == "plant":
            # Sits ON the roof deck, not floating above the wall: the deck is at
            # final_height + capLift and roofscape.geojson already puts its own
            # measured clutter on that same datum. Starting anywhere else is how
            # you get a pale slab hanging in mid air.
            base_m = h + cap_lift(h)
            top_m = base_m + (f1 - 1.0) * h
        if top_m - base_m < 0.2:
            stats["band_too_thin"] += 1
            continue

        if kind == "wall":
            day = WALL_DAY[tile]
        else:
            day = ROOF_DAY["plant" if kind == "plant" else bname]
        wg, wn = ramp(day)

        props = {
            "kind": kind, "band": bname, "tile": tile,
            "wd": day, "wg": wg, "wn": wn,
            "h": round(top_m, 2), "base": round(base_m, 2),
            "name": name, "bid": p.get("id"),
        }
        out.append({"type": "Feature", "properties": props,
                    "geometry": {"type": "Polygon", "coordinates": [to_ll(ring, lat0)]}})
        stats["bands"] += 1

        # A parapet on the band that reaches final_height, and on nothing else.
        # Capping every band would put a lip at every boundary -- three ledges up
        # a blank wall, which is the mistake stadium-wall-roof exists to avoid.
        # Uses app.js's own capLift rule so the roofscape deck lands on it
        # exactly instead of hovering a metre clear of it.
        if kind in ("wall", "roof") and abs(f1 - 1.0) < 1e-6:
            # A parapet is the wall turned up past the roof, so it takes the wall
            # tone -- except over a membrane, where it is the roof edge and takes
            # the roof's. Reusing the building's baked `rd` here is what put a
            # chocolate band around DKR's rim; see app.js RIM_COL.
            cap_day = day if kind == "roof" else WALL_DAY[tile]
            cg, cn = ramp(cap_day)
            out.append({"type": "Feature", "geometry": {"type": "Polygon",
                        "coordinates": [to_ll(ring, lat0)]},
                        "properties": {"kind": "cap", "band": bname, "name": name,
                                       "bid": p.get("id"),
                                       "wd": cap_day, "wg": cg, "wn": cn,
                                       "base": round(top_m, 2),
                                       "h": round(top_m + cap_lift(h), 2)}})
            stats["caps"] += 1
    return out


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    by_name = {}
    for f in feats:
        n = (f["properties"].get("name") or "")
        if n in BANDS:
            by_name[n] = f

    out, replaced = [], []
    stats = Counter()
    for name in BANDS:
        f = by_name.get(name)
        if f is None:
            print("  MISSING from the snapshot: %s" % name)
            stats["missing"] += 1
            continue
        made = build(f, stats)
        if not made:
            continue
        out.extend(made)
        # The generic extrusion has to stop being drawn or its flat lid buries
        # every band underneath it. js/moody.js filters these ids out of
        # buildings-3d and buildings-roof, the same way app.js does for DKR.
        replaced.append(f["properties"]["id"])
        print("  %-34s h=%5.1f  ->  %2d features" % (name[:34],
              f["properties"].get("final_height") or 0, len(made)))

    fc = {"type": "FeatureCollection", "features": out, "replacedBuildingIds": replaced}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))

    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": replaced,
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "provenance": {
            "footprints": "factual - the snapshot's own polygons, offset for the "
                          "Moody oversail and the plant screens only",
            "heights": "factual - every band is a fraction of the final_height "
                       "already in the data; the topmost wall band ends exactly "
                       "there so the parapet and roofscape datum are unchanged",
            "band_splits": "GENERATIVE - storey counts are sourced (Moody 2022 "
                           "Gensler; HTB 10 storeys / HDB 7 storeys, ZGF) but "
                           "where each band starts is derived from photographs, "
                           "not from drawings",
            "moody_oversail_5m": "measured off the z20 nadir crop (4.7 m west "
                                 "edge, 5.8 m south edge, beyond the footprint)",
            "membrane_colour": "measured - data/roof_survey.json deck [255,255,253]; "
                               "entered cool because extrusion top faces take the sun tint",
            "wall_colours": "measured by k-means on architect/manufacturer "
                            "photographs, except health-attic and moody-fascia "
                            "which are authored (noted in docs/PASS_MOODY.md)",
            "plant_screens": "GENERATIVE in size - their PRESENCE is measured "
                             "(the nadir crop shows a solid duct field on HDB), "
                             "their extent and height are authored",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
