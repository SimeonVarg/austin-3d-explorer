# -*- coding: utf-8 -*-
"""Storey bands for the Forty Acres — the campus half of QUEUE Y5.

WHY THIS EXISTS. `docs/camera/facades-at-two-metres.md` and
`docs/camera/facades-measured.md` established that the facade atlas is
SCREEN-locked: one `fill-extrusion-pattern` repeat covers `displaySize x
mpp(floor(cameraZoom))` metres of wall, so at walking height campus is on
TIER_CSS 32 == **2.06 m of wall per repeat** — half the Drag's 4.12 — and the
dominant family `mh` puts eight window rows in that 2.06 m. A 0.258 m storey
with a full-height vertical every 0.121 m. Simeon called the Drag's version of
this a barcode; campus wears the same barcode at twice the collapse, and campus
is what the video shows most.

A horizontal event CANNOT come from the tile, for exactly that reason: a line
drawn into the atlas lands at a different height at every zoom. It has to be
GEOMETRY whose height is in METRES, which is also the only form that survives
Y4 raising ZOOM_MAX (see facades-at-two-metres.md's sequencing note). So this
bake emits proud rings — base course, floor line, cornice, parapet cap — offset
OUTWARD from each footprint so they contain the wall's own face over their
height. Proud stone, and the underside is what casts the line of shadow a
barcode does not have.

This header used to say "nothing coplanar, nothing for the depth buffer to
argue about" and that was NOT TRUE, for a whole pass. Offsetting outward clears
the SIDE faces; it says nothing about the HORIZONTAL ones, and every `cap` and
`cornice` ring ended exactly at its host's `final_height` — 55 of 640, at
0.0000 m. HOST_LIFT is the fix and `check_host_clearance()` is the assertion
that keeps it fixed: it runs on every bake, before the file is written, and
prints its count — because the tie is cross-document and
`scripts/verify/coplanar.mjs` structurally cannot see it. QUEUE N5b.

THE RECIPE IS HARVESTED, NOT REINVENTED. `scripts/bake_drag.py`'s storey-band
block (PR #167, judged blind against the live site and merged) is the source of
the technique: `storeys_of()`'s split, `detail_feature()`'s dbase/dh schema,
`offset()`/`to_ll8()`'s 8-decimal rings, `wall_ramp()`'s day/golden/night trio,
`fill-extrusion-vertical-gradient: false`. What differs here is the
ARCHITECTURE, not the technique — see ERA_SPEC.

WHAT THIS BAKE DELIBERATELY DOES NOT DO, and the reasoning is
`docs/camera/walls-campus.md` §6:

  * It does not put a cornice on everything. A base course + string course +
    cornice is a MASONRY vocabulary. It is true of Battle, Sutton, Garrison,
    Waggener, Rainey and the Cret group and it is false of the 1950-89
    concrete-frame bulk and a visible lie on the post-1990 glass. Era decides.
  * It does not guess an era. 190 of 253 campus buildings have no measured
    year, and `docs/entrances/eras.md` §5.2 rule 8 is explicit that the default
    must be NULL, "because that is exactly how a wrong entrance gets onto 80
    buildings at once". So a NULL building gets FLOOR LINES ONLY — every
    building has floors, and a floor line asserts nothing else. A building
    earns its cornice by having a measured year.
  * It does not touch family `tg` (curtain wall). Its mullion grid IS the
    structure and `js/facades.js` already exempts it from MIN_PIER/MIN_SPANDREL;
    a proud ring on a curtain wall reads as a shelf. `st` (stadium) is excluded
    outright — DKR has its own bake and its own vocabulary. `lo` is excluded
    because a 4 m shed has one storey and a floor line on it is a lie.
  * It does not attempt the day/night tile swap PR #167 used on the Drag. That
    fix lives in `js/drag.js`'s own tile; `js/facades.js`'s night lit-pane
    scatter is baked into `drawTile` for every family in the city and cannot be
    flipped per district without changing downtown, the outer ring and the
    Capitol. walls-campus.md §6.5. The geometry ships over the existing tile and
    the night is MEASURED not to be darker than live.

SOURCES OF A STOREY COUNT, in the order they are trusted:
  1. `data/facade_grids.json` -- counted on a licensed photograph of that exact
     elevation, sixteen buildings, each with its photo URL and licence beside
     it. Skips the PITCH_MIN/MAX gate; still has to clear STOREY_MIN_M.
  2. the snapshot's own `num_floors`, gated to a 2.60-5.20 m implied pitch.
  3. STOREY_M, the nominal 3.46 m read off a rectified elevation of the Tower.

OWNERSHIP (CLAUDE.md rule 1). This script writes exactly one file,
`data/campus_storeys.geojson`, and nothing else writes it. It claims NO building
ids — `replacedBuildingIds` is absent on purpose: six passes already claim ids,
and a pass that claims none can never collide with any of them in either order
(the proud-geometry rule, eras.md §2.1-2.2). West Campus is a separate bake and
is NOT in this file; the box below is Main Campus only.

Usage:  python scripts/bake_campus_storeys.py [--check]
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "campus_storeys.geojson")
SNAP_SOURCE = "buildings.detailed.geojson"
CHECK = "--check" in sys.argv

# `familyFor` is transcribed once, in scripts/bake_facades.py, and checked
# against the REAL browser function by scripts/verify/facade-parity.mjs. A
# second transcription here would be a second thing to keep in step, so this
# imports it rather than copying it. bake_facades.py guards its main() and does
# no work on import.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_facades  # noqa: E402

M_LAT = 111320.0

# ══════════════════════════════════════════════════════════════════════
#  TASTE. Every value below is named and overridable in one line
#  (CLAUDE.md rule 11). Provenance is given for each; nothing here is a
#  guess unless it says so.
# ══════════════════════════════════════════════════════════════════════

# `scripts/bake_entrances.py:118`'s own CAMPUS box (s, w, n, e). Reused rather
# than re-authored so the two passes cannot disagree about where campus is.
CAMPUS = (30.2795, -97.7420, 30.2930, -97.7255)

# The datum the modelled ground floor already reaches: the entrances pass's
# canopy line. 69.7 % of campus wall area sits above it (walls-campus.md §2),
# and that is exactly the territory the atlas owns and this bake takes back.
# Bands never start below it, so nothing here can fight a door, a canopy or a
# shopfront.
DATUM_M = 4.30

# Nothing shorter than this gets bands at all. Most of what it refuses is a 4-7 m
# shed or garage.
MIN_HEIGHT_M = 8.0

# Floor-to-floor. 3.46 is MEASURED, not nominal: `scripts/bake_tower.py:106`
# FLOOR = 3.46, "window-row pitch, from the gold spandrels in the photo", i.e. a
# rectified elevation photograph of the UT Tower. `docs/entrances/eras.md` §4
# already adopts it as the campus storey reference.
STOREY_M = 3.46
STOREY_MIN_M = 2.00      # under this a "storey" is a parapet and gets no lines

# A parking deck is not a storey and must not take STOREY_M. Sourced to
# `bake_westcampus.py`'s own nine-level podium spec (9, 2.80); the measured
# final_height/num_floors on campus family `dk` is 2.47 m over n=6, which is
# thin evidence, hence one constant rather than a derivation.
DECK_M = 2.80

# THE PHOTOGRAPHED COUNT OUTRANKS BOTH, and it is the only source here that was
# read off the building rather than inferred from it. `data/facade_grids.json`
# carries a storey count counted on a licensed photograph for sixteen campus
# buildings, with the elevation and the photo URL beside each one. Those sixteen
# skip the num_floors path and the PITCH_MIN/MAX gate entirely -- that gate
# exists to catch an OSM `building:levels` that is describing mezzanines or
# parking decks, and a count somebody counted on a wall is not that.
#
# WHY IT MATTERS MORE HERE THAN IN THE ATLAS. js/facades.js's window grid is
# SCREEN-locked: one pattern repeat is 1.03 m of wall by z21, so no tile can
# draw a 10.75 m Battle Hall storey there however it is redrawn. These bands are
# GEOMETRY, in metres, so they are the same storeys at every zoom -- which makes
# them the only thing on that wall that is still right when you walk up to it.
# Battle Hall went from five floor lines to one grand storey between a base
# course and a cornice, which is what the photograph shows.
#
# The pitch a measurement implies is still checked against STOREY_MIN_M, and
# three buildings fail it -- Burdine, PCL and the Jackson School all have a
# measured storey count that does not fit the height the app extrudes them at
# (Burdine's eight floors are extruded into 12.8 m). Those fall back to the
# nominal and are counted as `pitch_photo_rejected`, exactly as
# scripts/verify/facadegrid.mjs reports them as HEIGHT-LIMITED rather than
# grid-wrong. It is the height bake's defect, and it is named rather than
# absorbed.
MEASURED_GRIDS_FILE = os.path.join(DATA, "facade_grids.json")


def load_measured_storeys():
    """id -> storeys counted on a photograph, from data/facade_grids.json."""
    if not os.path.exists(MEASURED_GRIDS_FILE):
        return {}
    doc = json.load(open(MEASURED_GRIDS_FILE, encoding="utf-8"))
    out = {}
    for m in doc.get("buildings", []):
        if m.get("id") and isinstance(m.get("storeys"), int) and m["storeys"] >= 1:
            out[m["id"]] = m["storeys"]
    return out


MEASURED_STOREYS = load_measured_storeys()

# When a building carries a real floor count we FIT the storeys to it instead of
# dividing by STOREY_M — 75 of 668 campus buildings do, and they are 36.9 % of
# the district's wall area. But `final_height` is a LiDAR HIGH POINT (it includes
# parapet and mechanical, which is why bake_westcampus.py cuts `mech` OUT of it),
# so h/levels is an UPPER BOUND on floor-to-floor and not a measurement. These
# two bounds are the sanity gate: a count that implies a pitch outside them is
# describing something other than storeys and the nominal is used instead.
PITCH_MIN_M = 2.60
PITCH_MAX_M = 5.20
LEVELS_MIN = 2           # "usable" per walls-campus.md §4

# ── THE ERA VOCABULARY ────────────────────────────────────────────────
#
# `_PROUD` is metres the ring is offset outward; `_H` is metres of ring height.
# The Drag's shipped numbers (0.17/0.42 base, 0.11/0.26 course, 0.34/0.55
# cornice, 0.17 lift) are the starting point and every deviation has a source in
# this repo:
#
#   A/B cornice 0.45 / 0.75 — `docs/entrances/eras.md` §4 describes family B's
#       surround as "a cornice shelf 0.30 m thick projecting 0.45 m". The 0.45
#       is that number.
#   C   slab edge 0.30 thick — eras.md's canopy (0.25) rounded to the 0.30 that
#       `BALC_THICK` (0.34) in the West Campus bake says still reads at range.
#   D   reveal 0.18 — eras.md's own family-D canopy thickness, whose THINNESS
#       against C's 0.25 is stated there as the family read.
#
# The NULL row is authored HERE and is the one judgement call in this table, so
# it says so. A floor line asserts only "this building has floors", which is
# true of everything; its DEPTH is a material claim, which is not. D's 0.06 m
# reveal would be invisible over 68 % of the district and the pass would do
# nothing where it matters most; C's 0.12 m slab edge would assert concrete
# frame on 190 buildings nobody has dated. 0.09 / 0.24 sits between them: it
# reads at 2 m and claims no material. One line to overrule.
ERA_SPEC = {
    "A": dict(base=(0.20, 0.55), course=(0.14, 0.30), cornice=(0.45, 0.75),
              cap=None, lift=0.17),
    "B": dict(base=(0.20, 0.55), course=(0.14, 0.30), cornice=(0.45, 0.75),
              cap=None, lift=0.17),
    "C": dict(base=(0.12, 0.35), course=(0.12, 0.30), cornice=None,
              cap=(0.20, 0.45), lift=0.10),
    "D": dict(base=None,         course=(0.06, 0.18), cornice=None,
              cap=(0.15, 0.35), lift=0.06),
    None: dict(base=None,        course=(0.09, 0.24), cornice=None,
               cap=None,         lift=0.08),
}

# A parking deck's horizontal is a deck edge every DECK_M and nothing else. Era
# does not apply — a 1965 garage and a 2015 garage are the same object.
DECK_SPEC = dict(base=None, course=(0.10, 0.25), cornice=None, cap=None, lift=0.10)

# HOST_LIFT is the clearance the TOP face of a cornice or a parapet cap is
# raised above the host building's own `final_height`. The trim is what moves,
# never the host: a cornice caps a wall and a coping caps a parapet, so in both
# cases the stone sits ON the head of the thing below it. Precedent and size
# both come from `scripts/bake_depth.py`'s STEP_LIFT — "two coplanar top faces
# z-fight; 30 mm settles it and is far too small to read as a second step" —
# and the same 30 mm was applied to the Drag's cornices in bake_drag.py.
#
# WHY IT WAS MISSED FOR A WHOLE PASS. `scripts/verify/coplanar.mjs` pairs
# surfaces WITHIN one document; the host here is a basemap building extruded by
# js/app.js from the snapshot, so the tie is cross-document and no tool in the
# repo could see it. All 40 `cap` and all 15 `cornice` rings — 55 of 640 — came
# out with `dh` exactly equal to their host's final_height, to 0.0000 m, while
# the other 585 cleared by 0.2 m or more. It was found by hand. HOST_EPS below
# is the tolerance at which check_host_clearance() calls a ring coplanar with
# its host, and it matches coplanar.mjs's own eps so the two agree on the word.
HOST_LIFT = 0.03
HOST_EPS = 0.01

# Families this bake draws on, and the ones it refuses. See the header.
FAMILIES = ("mh", "mr", "tr")
FAMILY_DECK = "dk"
FAMILIES_REFUSED = ("tg", "st", "lo")

# `docs/entrances/eras.md` §5.2 rule 6, boundaries verbatim, same as
# bake_entrances.py's ERA_BOUNDS. Each pair is (last year of the family, family).
ERA_BOUNDS = ((1925, "A"), (1949, "B"), (1989, "C"))
ERA_AFTER = "D"

# The passes that already own a footprint. Read from their own outputs rather
# than listed here, so a bake that starts or stops claiming a building cannot
# leave this one stamping trim onto a wall somebody else replaced.
CLAIMING_BAKES = ("drag", "westcampus", "heroes", "arts", "moody", "tower", "stadium")


# ── geometry helpers ──────────────────────────────────────────────────
# The same primitives bake_drag.py and bake_stadium.py use, copied rather than
# imported: that is this repo's established shape for them (bake_drag.py's own
# comment says "same primitives as bake_stadium.py"), and a shared module would
# be a fourth file with no owner.
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
    """Offset a closed ring by d metres; POSITIVE grows it. None if degenerate."""
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
    return ring


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll8(pts, lat0):
    """8 decimals, not 7. A 0.09 m proud ring against 7 decimals (~1 cm of
    longitude here) is quantised to a ninth of its own offset; 8 gives a
    millimetre. Same reason as bake_drag.py's to_ll8."""
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 8), round(y / M_LAT, 8)] for (x, y) in ring]


def outer_ring(geom):
    return geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]


def centroid_ll(ring):
    return (sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring))


def hex_mix(hex_col, other, t):
    a = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(a[i] + (b[i] - a[i]) * t))))
                         for i in range(3))


def wall_ramp(hex_col):
    """day -> (golden, night). Transcribed from bake_drag.py, which took it from
    bake_stadium.py. Carried per feature so js/facades.js rides the city's own
    day/golden/night ramp instead of inventing a second dusk."""
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ── the register join ─────────────────────────────────────────────────
_ABBREV = ((" BLDG", " BUILDING"), (" CTR", " CENTER"), (" ENGR", " ENGINEERING"),
           (" LAB", " LABORATORY"), (" AUD", " AUDITORIUM"), (" RES", " RESIDENCE"))


def norm_name(s):
    s = (s or "").upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for a, b in _ABBREV:
        s = s.replace(a, b)
    return s


def load_years():
    """name -> year, from UT's own register (198 entries, a year on all 198).

    Joined on the NORMALISED official name because the Overture snapshot carries
    no `ref`. That is the whole join: no fuzzy matching, no substring guessing.
    A building this cannot match gets era NULL and floor lines only, which is
    the designed behaviour and not a failure.
    """
    p = os.path.join(DATA, "ut_buildings.json")
    out = {}
    for e in json.load(open(p, encoding="utf-8"))["buildings"]:
        if isinstance(e.get("occupied"), int) and e.get("name"):
            out.setdefault(norm_name(e["name"]), e["occupied"])
    return out


def era_for(year):
    if year is None:
        return None
    for last, fam in ERA_BOUNDS:
        if year <= last:
            return fam
    return ERA_AFTER


def claimed_ids():
    ids = set()
    for n in CLAIMING_BAKES:
        p = os.path.join(DATA, n + ".geojson")
        if not os.path.exists(p):
            continue
        ids |= set(json.load(open(p, encoding="utf-8")).get("replacedBuildingIds") or [])
    return ids


# ── the split ─────────────────────────────────────────────────────────
def split_ends(y0, y1, spec):
    """Take the base course and the top piece off the wall, if this era has them.

    Returns (base_span|None, lo, hi, top_span|None, top_part|None) or None if the
    wall cannot carry them plus one storey. Separated from the storey split
    because the measured pitch has to be fitted to the span that is ACTUALLY
    banded (lo..hi), not to the whole wall — on a family-C wall the base course
    and parapet cap take 0.80 m out of it, and dividing the wrong span by the
    floor count is how a "measured" number stops being one.
    """
    bh = spec["base"][1] if spec["base"] else 0.0
    top = spec["cornice"] or spec["cap"]
    th = top[1] if top else 0.0
    if y1 - y0 < bh + th + STOREY_MIN_M:
        return None
    b = (y0, y0 + bh) if spec["base"] else None
    # The top piece STARTS th below the host's head and ENDS HOST_LIFT above it.
    # Only the top moves: the storey span below is still divided at y1 - th, so
    # the floor lines and the pitch fitted to them are untouched by the lift.
    c = (y1 - th, y1 + HOST_LIFT) if top else None
    part = "cornice" if spec["cornice"] else ("cap" if spec["cap"] else None)
    return b, (b[1] if b else y0), (c[0] if c else y1), c, part


def storeys_of(lo, hi, pitch):
    """Divide the banded span into whole storeys at the nearest count to `pitch`.

    Same shape as bake_drag.py's storeys_of; the pitch is supplied rather than
    global so a measured floor count can drive it.
    """
    n = max(1, int(round((hi - lo) / pitch)))
    s = (hi - lo) / n
    if s < STOREY_MIN_M:
        return None
    return [(lo + i * s, lo + (i + 1) * s) for i in range(n)]


def detail_feature(ring_ll, host, part, era, base, top, trio):
    """One piece of proud trim.

    DELIBERATELY `dbase`/`dh`, never `base`/`h`, and NO `bid`. In every band
    file in this repo `base`/`h` mean "a band in a stack that must tile the
    building's height with no gap and no overlap" and a checker asserts exactly
    that per bid. Trim is not a band: it OVERLAPS the wall on purpose (a proud
    ring containing the wall's own face). Different name, different contract.
    `host` is inert bookkeeping for the audit print and nothing reads it as a
    claim.
    """
    wd, wg, wn = trio
    return {"type": "Feature",
            "properties": {"kind": "detail", "part": part, "era": era or "",
                           "host": host, "wd": wd, "wg": wg, "wn": wn,
                           "dbase": round(base, 3), "dh": round(top, 3)},
            "geometry": {"type": "Polygon", "coordinates": [ring_ll]}}


def pitch_for(props, fam, lo, hi, stats):
    """Floor-to-floor for this building: measured where a count exists, nominal
    where it does not, and the nominal wherever the count implies something that
    is not a storey."""
    if fam == FAMILY_DECK:
        return DECK_M
    # Photographed first. `storeys` counts the whole wall including the ground
    # floor, and the ground floor sits below DATUM_M, so the banded span carries
    # (storeys - 1) floor joins -- the same arithmetic the num_floors branch
    # uses, for the same reason. A two-storey building therefore asks for ONE
    # span and gets no interior floor line at all, which is the point.
    ph = MEASURED_STOREYS.get(props.get("id"))
    if ph:
        n = max(1, int(ph) - 1)
        p = (hi - lo) / n
        if p >= STOREY_MIN_M:
            stats["pitch_photo"] += 1
            return p
        stats["pitch_photo_rejected"] += 1
    lv = props.get("num_floors")
    if isinstance(lv, (int, float)) and lv >= LEVELS_MIN:
        # The ground floor is below DATUM_M, so the wall this bake bands carries
        # (levels - 1) of them.
        n = int(lv) - 1
        if n >= 1:
            p = (hi - lo) / n
            if PITCH_MIN_M <= p <= PITCH_MAX_M:
                stats["pitch_measured"] += 1
                return p
            stats["pitch_levels_rejected"] += 1
    stats["pitch_nominal"] += 1
    return STOREY_M


def bands_for(feature, era, stats):
    ring = outer_ring(feature["geometry"])
    props = feature["properties"]
    fam = bake_facades.family_for(props)
    if fam in FAMILIES_REFUSED:
        stats["refused_family_" + fam] += 1
        return []
    spec = DECK_SPEC if fam == FAMILY_DECK else ERA_SPEC[era]
    H = props.get("final_height") or 0
    if H < MIN_HEIGHT_M:
        stats["refused_short"] += 1
        return []
    y0, y1 = DATUM_M, H
    ends = split_ends(y0, y1, spec)
    if ends is None:
        stats["refused_no_room"] += 1
        return []
    base, lo_y, hi_y, top, top_part = ends
    sts = storeys_of(lo_y, hi_y, pitch_for(props, fam, lo_y, hi_y, stats))
    if sts is None:
        stats["refused_no_room"] += 1
        return []

    lat0 = centroid_ll(ring)[1]
    m = ccw(to_m(ring, lat0))
    closed = m + [m[0]]
    trim = hex_mix(props.get("wd") or "#b7a98f", "#ffffff", spec["lift"])
    trio = (trim,) + wall_ramp(trim)

    rows = []
    if base:
        rows.append((base[0], base[1], spec["base"][0], "base"))
    ch, cp = spec["course"][1], spec["course"][0]
    # A floor line sits ON the join between two storeys, so it straddles it —
    # the first storey's floor is the base course (or the datum) and gets none.
    for (a, _) in sts[1:]:
        rows.append((a - ch * 0.5, a + ch * 0.5, cp, "course"))
    if top:
        t = spec["cornice"] or spec["cap"]
        rows.append((top[0], top[1], t[0], top_part))

    out = []
    for (lo, hi, d, part) in rows:
        r = offset(closed, d)
        if r is None:
            stats["offset_failed"] += 1
            continue
        out.append(detail_feature(to_ll8(ccw(r), lat0), props.get("id"), part,
                                  era, lo, hi, trio))
        stats["details"] += 1
    # "nothing to draw" is not a failure and must not be counted as one: a NULL
    # -era building with a single storey above the datum has no INTERMEDIATE
    # floor to line, and no base course or cap is owed to it either. That is the
    # rule doing its job, so it gets its own name.
    stats["banded" if out else "one_storey_nothing_owed"] += 1
    if out:
        stats["storeys_total"] += len(sts)
        stats["era_" + (era or "null")] += 1
        stats["fam_" + fam] += 1
    return out


def check_host_clearance(feats, heights):
    """Assert no emitted ring shares a horizontal plane with its host building.

    THIS IS THE CHECK NO OTHER TOOL IN THE REPO CAN DO. `coplanar.mjs` pairs
    surfaces within one document; the host is a basemap building extruded by
    js/app.js straight from the snapshot this bake reads, so the tie between a
    ring's `dh` and the host's `final_height` is CROSS-DOCUMENT and invisible to
    it. It stayed invisible through a whole pass and was eventually measured by
    hand: 55 of 640 rings at exactly 0.0000 m. The point of putting it here is
    that it now re-runs on every bake, so it cannot come back the next time the
    snapshot rolls or a new era spec is added.

    Raises on any ring within HOST_EPS of its own host's top or bottom, and
    returns (rings_checked, worst_clearance_m) so the run can print both.
    """
    worst, offenders = float("inf"), []
    for f in feats:
        p = f["properties"]
        h = heights.get(p.get("host"))
        if h is None:
            raise AssertionError(
                "host clearance: ring on host %r has no final_height in the "
                "snapshot. Every emitted ring must be checkable." % (p.get("host"),))
        for name in ("dbase", "dh"):
            for plane in (0.0, h):
                gap = abs(p[name] - plane)
                worst = min(worst, gap)
                if gap < HOST_EPS:
                    offenders.append((p.get("host"), p.get("part"), name,
                                      p[name], plane))
    if offenders:
        raise AssertionError(
            "host clearance: %d ring face(s) within %.3f m of the host's own "
            "ground or final_height — that is the N5b defect. First five: %r"
            % (len(offenders), HOST_EPS, offenders[:5]))
    return len(feats), (0.0 if worst == float("inf") else worst)


def main():
    from collections import Counter
    stats = Counter()

    # Already resolved the right way — this bake was the reference for the
    # other four when QUEUE NB5 was fixed. What it lacked was the stamp: it
    # printed the date to a terminal nobody kept, so its own output could not
    # be checked against the manifest afterwards.
    date = bake_facades.snapshot_date()
    snap = os.path.join(DATA, "snapshots", date, SNAP_SOURCE)
    feats = json.load(open(snap, encoding="utf-8"))["features"]
    years = load_years()
    claimed = claimed_ids()

    heights = {p.get("id"): (p.get("final_height") or 0.0)
               for p in (f.get("properties") or {} for f in feats)}

    s, w, n, e = CAMPUS
    out = []
    considered = 0
    for f in feats:
        p = f.get("properties") or {}
        if p.get("id") in claimed:
            stats["skip_claimed"] += 1
            continue
        ring = outer_ring(f["geometry"])
        lon, lat = centroid_ll(ring)
        if not (s <= lat <= n and w <= lon <= e):
            continue
        considered += 1
        era = era_for(years.get(norm_name(p.get("name"))))
        if era:
            stats["dated"] += 1
        out.extend(bands_for(f, era, stats))

    # Runs BEFORE the file is written, so a bake that would reintroduce N5b
    # raises and leaves the shipped data untouched rather than overwriting it
    # with the defect.
    checked, worst = check_host_clearance(out, heights)

    gj = {"type": "FeatureCollection",
          "snapshot": date, "snapshot_source": SNAP_SOURCE,
          "features": out}
    if CHECK:
        print(json.dumps({"snapshot": date, "considered": considered,
                          "features": len(out),
                          "host_clearance": {"rings_checked": checked,
                                             "coplanar_with_host": 0,
                                             "worst_gap_m": round(worst, 4),
                                             "limit_m": HOST_EPS},
                          "stats": dict(sorted(stats.items()))},
                         indent=2))
        return

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(gj, fh, separators=(",", ":"))
    print(json.dumps({
        "snapshot": date,
        "considered_in_campus_box": considered,
        "buildings_banded": stats["banded"],
        "buildings_nothing_owed": stats["one_storey_nothing_owed"],
        "features": len(out),
        # Cross-document, so no verify script can see it. Printed every run.
        "host_clearance": {"rings_checked": checked, "coplanar_with_host": 0,
                           "worst_gap_m": round(worst, 4), "limit_m": HOST_EPS,
                           "against": "final_height in snapshots/%s" % date},
        "storeys": stats["storeys_total"],
        "dated_buildings": stats["dated"],
        "pitch": {"photographed": stats["pitch_photo"],
                  "photographed_rejected": stats["pitch_photo_rejected"],
                  "measured": stats["pitch_measured"], "nominal": stats["pitch_nominal"],
                  "levels_rejected": stats["pitch_levels_rejected"]},
        "by_era": {k[4:]: v for k, v in sorted(stats.items()) if k.startswith("era_")},
        "by_family": {k[4:]: v for k, v in sorted(stats.items()) if k.startswith("fam_")},
        "refused": {k: v for k, v in sorted(stats.items()) if k.startswith("refused")},
        "kb": round(os.path.getsize(OUT) / 1024, 1),
        "note": "Claims no building ids on purpose. Re-bake whenever "
                "manifest.latest rolls: the campus box is read against the "
                "snapshot's own footprints.",
    }, indent=2))


if __name__ == "__main__":
    main()
