# -*- coding: utf-8 -*-
"""bake_facade_grids.py -> data/facade_grids.json

WHAT THIS IS.  `js/facades.js` picks one of seven window grids by height class,
so every 4-to-7 storey campus hall gets the identical `mh` 8-rows-by-5-columns
tile.  Welch, Painter, Burdine and Mezes are different buildings wearing the
same wall.  This bake writes the ONE file that makes the grid a per-building
property instead: for each building somebody has actually measured off a
photograph, the storey count, the bay count and the window ASPECT it really
has.  Everything not in this file keeps the seven templates, which is what they
are for.

WHAT IS MEASURED, AND WHAT IS DELIBERATELY NOT.  Three numbers per building,
and the list is short because a number nobody measured is worse than no number:

  storeys   How many window rows the photographed elevation really has.
            Countable in every one of the sixteen photographs, and cross-checked
            against UT Direct's own facilities register (which counts basements
            and mezzanines, so where the two disagree the PHOTOGRAPH wins and
            the register's figure is recorded beside it).  This is the axis the
            template gets catastrophically wrong -- 8 rows on Battle Hall, which
            is two storeys tall.

  aspect    height / width of ONE opening, measured in pixels off the
            photograph.  A ratio of two lengths in the same facade plane, so it
            survives an oblique camera far better than an absolute width does.
            The finding this file exists to record: EVERY template window is
            wider than it is tall (mh is 5x4, mr is 6x4) and EVERY real window
            on this campus is 1.4x to 5.5x taller than wide.

  bays      Only where the photograph can carry the count: both corners of the
            wall visible, near-orthogonal, and the wall's length known from the
            app's own footprint.  Exactly ONE of the sixteen clears that bar
            (Battle Hall -- seven arches, symmetric about the centre door, both
            quoined corners in frame).  Everywhere else `bays` is null and the
            building inherits its template's column rhythm.  Guessing a bay
            count off a foreshortened, tree-occluded wing is how you ship a
            number that looks measured and is not.

WHAT IS NOT IN HERE AND WHY.  Glazing FRACTION.  It is measurable off these
photographs and it was not measured this round, so every building keeps its
template family's `want` and the shape work redistributes that area rather than
inventing more or less of it.  Marked here rather than fudged.

WALL LENGTHS are not typed in: they are computed from the minimum-area
rectangle of the building's own footprint in the snapshot the app actually
loads (`data/manifest.json`'s `latest`), so they cannot drift from the geometry
being painted.  Same for the Overture feature `id` -- matched by exact name
against that snapshot and written out, never hand-copied.

SOURCES.  Every photograph is a Wikimedia Commons file with its licence checked
per file through the API; the URL, licence and the elevation photographed are
recorded on each entry.  The per-building writeups they were counted against
live in docs/campus-truth/<CODE>.md, assembled the same round.

Run:  python scripts/bake_facade_grids.py
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

# ---------------------------------------------------------------------------
# THE MEASUREMENTS.  One row per building.  `storeys` and `aspect` come off the
# photograph named in `photo`; `bays` is null unless the photograph can carry
# the count against a wall whose length the footprint knows.
#
# `wall` names WHICH side of the footprint's minimum-area rectangle the
# photographed elevation is, so the bay pitch is divided by the right length:
#   'long'  the longer side of the rectangle, 'short' the shorter.
# ---------------------------------------------------------------------------
MEASURED = [
    dict(ref="MAI", name="UT Tower", base="tr",
         storeys=27,
         storeys_src="photo: the tower shaft's 4-column window band, one row per floor, runs the full height above the 3-storey base; UT Direct's register says 37 floors, counting the base, plinth and cupola levels",
         aspect=1.4, aspect_src="photo: tower-shaft window ~10 px wide x 14 px tall",
         bays=None, wall=None,
         note="THE PART NO TILE CAN FIX, said plainly: the app extrudes Main Building as ONE 94 m prism over the whole 82 x 73 m footprint, so the 3-storey limestone base and the set-back tower shaft are the same surface. The real elevation is three stacked 1x7 bands (arcade / piano nobile / attic) under a narrower 4-column shaft. What IS fixed here is the shaft's rhythm, which is what 94 m of wall actually shows.",
         photo="https://commons.wikimedia.org/wiki/File:Main_Building_(University_of_Texas_at_Austin)_-_DSC08595.jpg",
         licence="CC0", elevation="south portico"),

    dict(ref="BTL", name="Battle Hall", base="mh",
         storeys=2,
         storeys_src="photo: a rusticated ground floor of double-hung windows and one floor of tall round-arched Palladian bays, under the eave. UT Direct says 7 floors; those are the internal book-stack tiers of the old library, not storeys on the wall",
         aspect=2.8, aspect_src="photo: upper arched bay ~48 px wide x 135 px tall",
         bays=7, wall="long",
         bays_src="photo: SEVEN arched bays, derived rather than eyeballed -- the composition is symmetric about the centre door, which sits at the measured mid-point of the wall, and three full bays are countable on each side of it with a corner pier beyond. The four inter-bay pitches clear of the tree measure 92.5 / 82.0 / 88.5 / 88.5 px, a spread consistent with one pitch under perspective, and that pitch continues to both quoined corners.",
         note="The clearest 'wrong number of floors' case on campus: two storeys wearing an eight-row template.",
         photo="https://commons.wikimedia.org/wiki/File:Battle_Hall_-_UT_Austin_(54983869707).jpg",
         licence="CC BY 4.0", elevation="east (South Mall)"),

    dict(ref="SUT", name="Sutton Hall", base="mh",
         storeys=3,
         storeys_src="photo: limestone arcade at grade + two brick floors",
         aspect=1.9, aspect_src="photo: brick-floor window ~1:1.9; oblique view, so read as a ratio only",
         bays=None, wall=None,
         note="CONTROL CASE, and it comes out green: 3 storeys on the app's own 13.0 m wall derives 8 rows -- exactly the `mh` template. The template is not wrong everywhere, and Sutton is where it is right.",
         photo="https://commons.wikimedia.org/wiki/File:Sutton_Hall_(University_of_Texas_at_Austin)_-_DSC08578.jpg",
         licence="CC0", elevation="north + west corner"),

    dict(ref="GAR", name="Garrison Hall", base="mh",
         storeys=4,
         storeys_src="photo: limestone arcade + two brick window floors + the attic frieze band of small openings between the cattle-brand medallions",
         aspect=2.0, aspect_src="photo: brick-floor window ~1:2",
         bays=None, wall=None,
         note="Bays not counted: the live-oak canopy covers most of the elevation and both corners.",
         photo="https://commons.wikimedia.org/wiki/File:Garrison_hall_2014.jpg",
         licence="CC BY 4.0", elevation="arcaded (west, mall-facing)"),

    dict(ref="WAG", name="Waggener Hall", base="mh",
         storeys=5,
         storeys_src="photo: raised limestone ground floor, 3 brick floors, attic band -- and the snapshot's own num_floors agrees at 5",
         aspect=2.0, aspect_src="photo: brick-floor window ~27 px wide x 55 px tall",
         bays=None, wall=None,
         note="Bays NOT claimed. The pitch is clean (~49 px between window centres on floor 3) but both ends of the wall are behind trees, so the pitch cannot be anchored to the footprint's long side without assuming where the wall ends.",
         photo="https://commons.wikimedia.org/wiki/File:Waggener_Hall_-_UT_Austin_(54984752686).jpg",
         licence="CC BY 4.0", elevation="west (South Mall)"),

    dict(ref="CAL", name="Calhoun Hall", base="mh",
         storeys=4,
         storeys_src="photo: ground arcade + 3 upper floors including the attic band",
         aspect=1.8, aspect_src="photo: stone-surround window ~1:1.8",
         bays=None, wall=None,
         note="One of the 'Six Pack' trio (with BAT and HRH) built as a deliberately matched set, so these three legitimately share a vocabulary -- they differ here only where their storey counts and their heights differ.",
         photo="https://commons.wikimedia.org/wiki/File:Calhoun_hall_2014.jpg",
         licence="CC BY 4.0", elevation="west (arcade, entrance)"),

    dict(ref="BAT", name="Batts Hall", base="mh",
         storeys=3,
         storeys_src="photo: entrance pavilion shows ground + 2; the wings are behind canopy and are not claimed",
         aspect=1.9, aspect_src="photo: twelve-light window ~1:1.9",
         bays=None, wall=None,
         note="Six Pack, with CAL and HRH.",
         photo="https://commons.wikimedia.org/wiki/File:Batts_hall_2014.jpg",
         licence="CC BY 4.0", elevation="west entrance pavilion"),

    dict(ref="HRH", name="Homer Rainey Hall", base="mh",
         storeys=2,
         storeys_src="photo: two storeys under a red tile hip roof with dormers",
         aspect=1.9, aspect_src="photo: multi-pane window ~1:1.9",
         bays=None, wall=None,
         note="Six Pack, with CAL and BAT.",
         photo="https://commons.wikimedia.org/wiki/File:Homer_rainey_hall.jpg",
         licence="CC BY 4.0", elevation="south"),

    dict(ref="GOL", name="Goldsmith Hall", base="mr",
         storeys=3,
         storeys_src="photo: three floors of multi-light double-hung windows on the west wing",
         aspect=2.1, aspect_src="photo: double-hung window ~1:2.1",
         bays=None, wall=None,
         note="",
         photo="https://commons.wikimedia.org/wiki/File:Goldsmith_Hall.JPG",
         licence="CC BY-SA 3.0", elevation="east (Inner Campus Drive)"),

    dict(ref="BUR", name="Burdine Hall", base="mh",
         storeys=8,
         storeys_src="UT Direct's register: 8 floors. FIVE are countable above the tree line in the photograph; the rest are occluded, so the register carries it and that is recorded rather than the photo's partial count",
         aspect=5.5, aspect_src="photo: a recessed slot ~10 px wide x 55 px tall -- the narrowest opening in the set",
         bays=None, wall=None,
         note="The other control case, and it disagrees with Sutton's: Burdine's real wall genuinely IS a uniform repeating grid, so it needs no bespoke geometry -- only the right numbers. Its openings are 1:5.5 slots, not the template's 5x4 landscape punch. Bays not claimed: the near wing is countable (~11-12) but the corner-on view will not anchor that count to a footprint side.",
         photo="https://commons.wikimedia.org/wiki/File:Burdine_Hall_UT_Austin_2018.jpg",
         licence="CC BY 4.0", elevation="upper north-east corner"),

    dict(ref="LFH", name="Littlefield House", base="mr",
         storeys=2,
         storeys_src="photo: two storeys under the wraparound two-tier gallery, plus mansard attic dormers",
         aspect=2.2, aspect_src="photo: paired double-hung ~1:2.2",
         bays=None, wall=None,
         note="HONEST RESULT, recorded because it is not the one the brief expected: Littlefield's ROW pitch was already right -- 2 storeys on the app's 10.8 m wall derives 6 rows, which is exactly the `mr` template it already had. What is wrong with Littlefield in this app is not its grid, it is its GEOMETRY: a round corner tower, an octagonal bay, a square mansard tower and a two-tier wraparound gallery, none of which a repeating wall tile can express at any parameterisation. The window aspect is the only part of it this file can fix.",
         photo="https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_10_(Littlefield_House).jpg",
         licence="CC BY-SA 4.0", elevation="south / south-west corner"),

    dict(ref="PCL", name="Perry-Castañeda Library", base="mh",
         storeys=7,
         storeys_src="UT Direct's register: 7 floors. The photograph cannot count them -- which is the point of this entry",
         aspect=5.0, aspect_src="photo: one recessed strip in the single glazed band, ~8 px wide x 40 px tall",
         bays=None, wall=None,
         note="THE WORST OFFENDER, and the photograph settles it: the near elevation is a COMPLETELY BLANK precast wall, corner to corner, roof to plinth. The whole building carries one recessed band of narrow vertical strips. A 20%-glazed punched grid is not slightly wrong here, it is the wrong category of wall. The strip count in that band (13) is not claimed as a bay count because the band is one storey of one elevation, not the wall's rhythm.",
         photo="https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_26_(Perry–Castañeda_Library).jpg",
         licence="CC BY-SA 4.0", elevation="west / south-west plaza"),

    dict(ref="UNB", name="Union Building", base="mr",
         storeys=3,
         storeys_src="photo: ground arcade + one floor on both wings, and a third band on the tower",
         aspect=1.7, aspect_src="photo: upper-wing window ~1:1.7",
         bays=None, wall=None,
         note="",
         photo="https://commons.wikimedia.org/wiki/File:Union_Building_-_UT_Austin_(54984999764).jpg",
         licence="CC BY 4.0", elevation="west (entrance, tower)"),

    dict(ref="WEL", name="Robert A. Welch Hall", base="mh",
         storeys=4,
         storeys_src="photo: four floors countable on the flanking brick wings above the limestone base; UT Direct's register says 7, which the photographed elevation does not show",
         aspect=2.2, aspect_src="photo: wing window ~60 px wide x 130 px tall",
         bays=None, wall=None,
         note="",
         photo="https://commons.wikimedia.org/wiki/File:Welch_Hall_UT_Austin_Texas_2024.jpg",
         licence="CC BY 4.0", elevation="entrance tower + flanking wings"),

    dict(ref="JGB", name="Jackson Geological Sciences Building", base="mh",
         storeys=7,
         storeys_src="UT Direct's register: 7 floors, and the snapshot's own num_floors agrees at 7; five bands are countable in the photograph before the crop",
         aspect=1.5, aspect_src="photo: window ~48 px wide x 70 px tall -- the squarest opening in the set, and the only one close to the template's shape",
         bays=None, wall=None,
         note="The near-match of the set: a plain modern brick grid, which is the one thing the template was built to draw. Its rows were still wrong (7 real floors on a 16.7 m wall does not derive 8 rows) and its windows were still landscape.",
         photo="https://commons.wikimedia.org/wiki/File:Jackson_School_of_Geosciences_UT_Austin_2019.jpg",
         licence="CC BY 4.0", elevation="north-west entrance"),

    dict(ref="GRE", name="Gregory Gym", base="mh",
         storeys=2,
         storeys_src="photo: this is ONE volume, not a stack of floors -- the gable end carries a tier of three big entrance arches and, above the balcony, tiers of small round-arched clerestory windows. Two window rows, not seven floors",
         aspect=1.8, aspect_src="photo: clerestory arch ~22 px wide x 40 px tall",
         bays=None, wall=None,
         note="A raked Romanesque gable rendered as a flat rectangular 8x5 grid. The rake itself is roof geometry and lives in data/roofs.geojson, not here; what this fixes is that the wall under it is not a seven-storey office building.",
         photo="https://commons.wikimedia.org/wiki/File:University_of_Texas_at_Austin_August_2019_24_(Gregory_Gymnasium).jpg",
         licence="CC BY-SA 4.0", elevation="west (entrance) gable"),
]


# ------------------------------------------------------------------ geometry --
def snapshot_date():
    """`manifest.latest` -- what js/app.js actually loads. Same rule as
    bake_facades.py:snapshot_date(), and for the same reason: reading the
    directory and taking the last name sorted is a different question."""
    mf = os.path.join(DATA, "manifest.json")
    if os.path.exists(mf):
        m = json.load(open(mf, encoding="utf-8"))
        if m.get("latest"):
            return m["latest"]
        if m.get("snapshots"):
            return m["snapshots"][-1]
    snaps = sorted(d for d in os.listdir(os.path.join(DATA, "snapshots"))
                   if os.path.isdir(os.path.join(DATA, "snapshots", d)))
    return snaps[-1]


def rings(geom):
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    out = []
    for poly in geom["coordinates"]:
        out.extend(poly)
    return out


def min_area_rect(pts):
    """(long_side_m, short_side_m) of the minimum-area rectangle.

    A min-area rect, not an axis-aligned bounding box: the campus grid runs
    about 5 degrees off north, so an AABB over-reads every wall on it and by a
    lot on the buildings that are turned further."""
    best = None
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy)
        if L < 1e-9:
            continue
        ux, uy = dx / L, dy / L
        us = [p[0] * ux + p[1] * uy for p in pts]
        vs = [-p[0] * uy + p[1] * ux for p in pts]
        w = max(us) - min(us)
        h = max(vs) - min(vs)
        if best is None or w * h < best[0]:
            best = (w * h, w, h)
    return (max(best[1], best[2]), min(best[1], best[2]))


def main():
    date = snapshot_date()
    src = os.path.join(DATA, "snapshots", date, "buildings.detailed.geojson")
    gj = json.load(open(src, encoding="utf-8"))
    by_name = {}
    for f in gj["features"]:
        nm = (f["properties"] or {}).get("name")
        if nm:
            by_name[nm] = f

    out = []
    missing = []
    for m in MEASURED:
        f = by_name.get(m["name"])
        if f is None:
            missing.append(m["name"])
            continue
        p = f["properties"]
        # metres, locally flat, about the footprint's own mean vertex
        r0 = rings(f["geometry"])[0]
        lat0 = sum(y for _, y in r0) / len(r0)
        lon0 = sum(x for x, _ in r0) / len(r0)
        kx = 111320.0 * math.cos(math.radians(lat0))
        pts = []
        for r in rings(f["geometry"]):
            pts.extend([((x - lon0) * kx, (y - lat0) * 111320.0) for x, y in r])
        long_m, short_m = min_area_rect(pts)

        wall_m = None
        if m["bays"]:
            if m["wall"] not in ("long", "short"):
                raise SystemExit("%s: bays given without a wall side" % m["ref"])
            wall_m = long_m if m["wall"] == "long" else short_m

        out.append({
            "ref": m["ref"],
            "id": p["id"],
            "name": m["name"],
            "base": m["base"],
            "storeys": m["storeys"],
            "storeys_src": m["storeys_src"],
            "aspect": m["aspect"],
            "aspect_src": m["aspect_src"],
            "bays": m["bays"],
            "bay_wall_m": None if wall_m is None else round(wall_m, 1),
            "bays_src": m.get("bays_src"),
            "footprint_long_m": round(long_m, 1),
            "footprint_short_m": round(short_m, 1),
            "app_height_m": p.get("final_height"),
            "app_num_floors": p.get("num_floors"),
            "app_building_class": p.get("building_class"),
            "note": m["note"],
            "photo": m["photo"],
            "licence": m["licence"],
            "elevation": m["elevation"],
        })

    if missing:
        raise SystemExit("not found by exact name in %s: %s" % (src, missing))

    doc = {
        "_what": "Per-building measured window grids. js/facades.js reads this and "
                 "derives rows/cols/opening size from it; anything not listed here "
                 "keeps the seven height-class templates.",
        "_snapshot": date,
        "_generated_by": "scripts/bake_facade_grids.py",
        "_measured": "storeys and aspect off a licensed photograph per building; "
                     "bays only where both corners of the wall are in frame and "
                     "the wall length is known from the footprint (1 of 16). "
                     "Wall lengths and feature ids come from the snapshot, not "
                     "from this file's source.",
        "_not_measured": "glazing FRACTION -- every building keeps its template "
                         "family's `want`, so the shape work redistributes that "
                         "area rather than inventing more or less of it.",
        "buildings": out,
    }
    dst = os.path.join(DATA, "facade_grids.json")
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print("wrote %s -- %d buildings from snapshot %s" % (dst, len(out), date))
    for b in out:
        print("  %-4s %-38s h=%5.1f  storeys=%2d  aspect=%.1f  bays=%s" % (
            b["ref"], b["name"][:38], b["app_height_m"], b["storeys"], b["aspect"],
            ("%d over %.1f m" % (b["bays"], b["bay_wall_m"])) if b["bays"] else "-"))


if __name__ == "__main__":
    main()
