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
height. Proud stone. Nothing coplanar, nothing for the depth buffer to argue
about, and the underside is what casts the line of shadow a barcode does not
have.

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
    c = (y1 - th, y1) if top else None
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


def main():
    from collections import Counter
    stats = Counter()

    date = bake_facades.snapshot_date()
    snap = os.path.join(DATA, "snapshots", date, "buildings.detailed.geojson")
    feats = json.load(open(snap, encoding="utf-8"))["features"]
    years = load_years()
    claimed = claimed_ids()

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

    gj = {"type": "FeatureCollection", "features": out}
    if CHECK:
        print(json.dumps({"snapshot": date, "considered": considered,
                          "features": len(out), "stats": dict(sorted(stats.items()))},
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
        "storeys": stats["storeys_total"],
        "dated_buildings": stats["dated"],
        "pitch": {"measured": stats["pitch_measured"], "nominal": stats["pitch_nominal"],
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
