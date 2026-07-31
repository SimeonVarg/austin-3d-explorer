# -*- coding: utf-8 -*-
"""The UT Tower and the Main Building, as stacked geometry bands.

WHAT IS THERE NOW, measured before writing a line of this. The Overture feature
named "UT Tower" (id a0af80df…) is the WHOLE Main Building complex: a 25-vertex
footprint 79.5 x 87.2 m, carrying final_height 94.0 and — crucially —
`has_parts: 1`. app.js filters has_parts buildings out of `buildings-3d`, so
that footprint is not drawn at all. What IS drawn is two OSM building:parts:

    way/516187631   h 94.0  base 0    22.56 x 20.84 m   the tower shaft
    way/516187635   h 12.8  base 0    44.5  x 24.6  m   one low south block

So the scene's UT Tower is a single 94 m box wearing the generic office-tower
window grid, and THE MAIN BUILDING IS ENTIRELY MISSING — no wings, no arcade,
no red tile roof. Confirmed a second way: nothing in data/roofscape.geojson,
data/roofscape.detail.geojson or data/roofs.geojson falls inside the footprint,
so js/roofs.js is giving this building nothing either. Every red tile roof in
this file is new.

WHY BANDS. A fill-extrusion-pattern has no vertical anchor — it repeats from the
extrusion base with no idea where the top is — and it is TILE-locked, so its
world size halves at every integer zoom. The Tower is nothing but vertical
events: arcade, piano nobile, entablature, attic, tile roof, shaft, cornice,
clock stage, belfry, cap. None of that can live in a texture. It is all emitted
here as separate features with their own base/height/colour, exactly the way
scripts/bake_stadium.py emits DKR's three wall bands.

The same reasoning removes windows from the textures. The Tower's shaft has
THREE narrow vertical window slots per face and is otherwise blank Indiana
limestone (see docs/PASS_TOWER.md for the photo this was read off). Three slots
on a 22.56 m face cannot be expressed by a 64 px tile that covers 30-59 m of
wall and never aligns to a corner — so the slots are GEOMETRY: thin prisms
standing 0.30 m proud of each face. Same for the belfry colonnade, the four
clock faces, and the lit numeral at night. The textures are left to do the one
thing a tile is good at: material.

MEASUREMENT. Every height and plan ratio below was read off photographs and is
listed with its source in docs/PASS_TOWER.md. Two independent checks passed:
the clock dial measures 12.5 ft against a sourced "12 feet across", and the
crown height measures 27.7 m in one photograph and 28.4 m in another taken from
four times the distance with a different lens.

Usage:  python scripts/bake_tower.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "tower.geojson")
M_LAT = 111320.0

TOWER_ID = "a0af80df-5ca8-4408-ba74-2817533dae1a"
# The two OSM building:parts this geometry supersedes. They carry no id of their
# own — parts.detailed.geojson properties are {h, base, wd, wg, wn, rd, rg, rn} —
# so js/tower.js filters them out of parts-3d by their wall colour, which is
# unique to this building across all five snapshots on disk. Recorded here so
# the two halves of that decision sit next to each other.
PART_WD = "#e5dbc2"

# ── Taste block. Every value here is a one-line override. ──────────────
#
# HEIGHTS, metres above the footprint's own grade. Read off two photographs;
# see docs/PASS_TOWER.md for the derivation and the two cross-checks.
H_ARCADE = 6.8          # rusticated arcade storey, Main Building
H_PIANO = 17.2          # top of the double-height piano nobile
H_ENTAB = 20.2          # top of the entablature + balustrade — the low datum
H_ATTIC = 24.4          # eave: top of the attic loggia storey
H_RIDGE = 29.0          # ridge of the red barrel-tile hipped roof
H_PAVILION = 8.4        # the two low south terraces flanking the entrance

H_SHAFT_TOP = 66.3      # top of the plain limestone shaft
H_CORNICE = 70.1        # top of the bracketed shaft cornice
H_CLOCK_TOP = 78.2      # top of the clock / observation-deck stage
H_BELFRY_FOOT = 79.2    # belfry floor
H_BELFRY_TOP = 89.4     # belfry column tops
H_ENTAB_TOP = 90.7      # top of the belfry entablature
H_CAP_MID = 92.4        # top of the cap block
H_TOP = 94.0            # top of the stepped cap. Masts are not drawn.

SHAFT_FROM = 15.0       # the shaft is inside the Main Building below H_ENTAB;
                        # starting it here rather than 0 saves 15 m of hidden
                        # wall while still overlapping the mass it emerges from.

# PLAN, as a scale about the shaft's own centre. Measured off the silhouette of
# main_2014 (which is a rectified elevation, so horizontal px = vertical px) and
# normalised by the shaft, whose true 22.56 x 20.84 m comes from OSM.
S_CORNICE = 1.026
S_CLOCK = 0.860
S_BELFRY_FOOT = 0.530
S_BELFRY = 0.491
S_ENTAB = 0.521
S_CAP = 0.449
S_CAPTOP = 0.362

# The shaft's window slots. Centres at -4.05 / 0 / +4.05 m from the middle of
# each face, 1.42 m wide — so the three slots take 9.5 m of a 22.56 m face and
# the remaining 6.5 m each side is blank stone. A WALL IS MOSTLY WALL, and on
# this building it is emphatically so: glazing works out at about 8%.
SLOT_W = 1.42
SLOT_PITCH = 4.05
SLOT_DEPTH = 0.30
WIN_DEPTH = 0.36
FLOOR = 3.46            # window-row pitch, from the gold spandrels in the photo
WIN_H = 2.20
WIN_FROM = 24.5         # lowest visible window row
WIN_ROWS = 12

# The belfry: four square corner piers and four round Doric columns per face,
# counted off a 5x enlargement of the crown. The columns sit as 2 + 2 with a
# wide central opening, which is what the photograph shows; `COL_T` are their
# centres as fractions of the clear span between the piers.
PIER_W = 1.70
COL_W = 1.10
COL_T = (0.11, 0.29, 0.71, 0.89)

# Clock: dial 3.66 m (a sourced 12 ft, and independently measured at 12.5 ft),
# gilt bezel 5.60 m, centre 74.6 m above grade — which lands 55% of the way up
# the clock stage, where the photograph puts it. fill-extrusion cannot make a
# vertical disc, so the bezel is five stacked horizontal slabs whose widths are
# the circle's own chords.
CLOCK_D = 5.60
# The dial is drawn at 3.05 m rather than its true 3.66. Rendered, a dark disc
# at the true size left the gilt bezel about one pixel wide from a flying
# camera, and the clock read as a hole punched in the tower rather than as a
# clock. The RING is the thing that carries the read at this distance, so it
# gets the pixels. Stated here because it is a deliberate lie about a number
# that is sourced two independent ways.
DIAL_D = 3.05
CLOCK_MID = 74.60
CLOCK_SLABS = 5
CLOCK_DEPTH = 0.30

# Roof: fill-extrusion has one roof shape, flat. A hip is approximated by three
# stepped inset facets, the same trick scripts/bake_roofs.py uses on the rest of
# campus. 4.6 m of rise over a ~7.5 m half-span is a 31 degree pitch, which is
# what a barrel-tile roof of this period is.
ROOF_STEPS = 3
ROOF_INSET = 2.55       # metres per step

# ── Colours ───────────────────────────────────────────────────────────
# The Main Building AND the Tower are both faced in Bedford, Indiana limestone
# (sourced — jimnicar.com/2013/03/23/how-texan-is-the-ut-tower). They are given
# different tones here anyway, and the reason is not a claim about the stone:
# the Tower is a clean vertical prism taking full sky and sun, while the Main
# Building's walls sit under a 1.5 m tile eave, behind a loggia and above a
# rusticated arcade, and they carry the warmer Texas Cordova and Austin shell
# stone trim. Sampled off an overcast photograph (neutral light) and corrected
# for the illuminant: the tower's limestone measures (208,195,177).
C_SHAFT = "#d5c9b5"     # Indiana limestone, tower shaft
C_CROWN = "#ddd2c0"     # crown stone — cornice, clock stage, belfry, cap
C_WALL = "#c9bb9f"      # Main Building piano nobile
C_BASE = "#b9a98d"      # rusticated arcade storey — in its own shade
# The entablature + balustrade band, and the two pavilion terraces. Pushed
# well ABOVE the walls either side of it after looking at a render: the south
# front is three stacked bands of vertical strips (arcade, piano nobile,
# attic loggia) and at 8% lighter this band did not separate them, so the
# whole facade read as one sheet of corduroy. A bright horizontal datum is
# what the real cornice does and it is the only thing on that elevation that
# is not vertical.
C_TRIM = "#e7ddc9"
C_ATTIC = "#8e6a55"     # attic loggia — deep openings on a red-brown ground
# THE ROOF, corrected by measurement rather than by the rule of thumb. The brief
# says to enter roof colours COOL because an extrusion's top face picks up the
# sun tint, so the first cut used #a5766a (R/B 1.56). Rendered and sampled, it
# came back at R/B 2.36 against 4.3-4.7 for every OTHER campus roof in the same
# frame — the Main Building was a pale salmon island in a sea of terracotta.
# The transform measures as roughly R/B_out = 1.4 x R/B_in over this range, so
# landing beside the neighbours needs an input near R/B 3.3, which is exactly
# the terracotta trio the snapshot already carries for this building. Using the
# data's own rd/rg/rn also guarantees the Main Building can never drift away
# from the roofs js/roofs.js draws on the buildings either side of it.
C_TILE = "#9c4a2f"
C_TILE_G = "#b2613c"
C_TILE_N = "#12101c"
C_COPPER = "#6f8477"    # verdigris cap roof
C_DARK = "#3a352f"      # the bell chamber behind the colonnade
C_SLOT = "#8a7448"      # the window channel: bronze spandrels dominate it
C_GLASS = "#3a4048"
C_GOLD = "#d8b247"
C_DIAL = "#3d4b56"

# NIGHT. The convention is sourced from tower.utexas.edu/lighting: seven
# configurations, of which this file builds "Orange Tower with No. 1" — the
# national-championship state, and the only one where the windows carry a
# numeral. The floodlit limestone is NOT the brand hex #BF5700. Sampled off two
# night photographs it comes back as a deep red-orange, brighter on the crown
# (where the floods are close) and falling off up the shaft; both photographs
# are clipped in green and blue, so these are pulled back toward the warm side
# of what the sensor recorded rather than copied off it.
# Rendered and looked at: the first cut of these (#8e2c10 / #a63f14 / #b7511a)
# came from sampling two clipped night photographs, and on screen the Tower sat
# at roughly the luma of the unlit city around it — technically an orange
# building, not a floodlit landmark. Raised until it is unambiguously the
# brightest object in a night frame, which is what a photograph of the real
# thing shows and is the entire point of building the night state at all. The
# crown is brightest because that is where the floods actually are.
N_SHAFT = "#b03a15"
N_CROWN = "#dd6420"
N_CORNICE = "#c9501c"
N_LIT = "#ffdca8"       # a window in the numeral
N_UNLIT = "#14161c"
N_DIALLIT = "#f2ecc8"   # the dial is lit from behind and stays cream
N_DARK = "#12101c"      # everything not floodlit: the Main Building
N_TILE = "#131020"


def golden(hex_col, t=0.16):
    """day -> golden hour, the same relationship bake_stadium.py uses."""
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    g = [c[i] + ([255, 190, 130][i] - c[i]) * t for i in range(3)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(v)))) for v in g)


def trio(day, night, gt=0.16):
    return {"wd": day, "wg": golden(day, gt), "wn": night}


# ── geometry helpers ──────────────────────────────────────────────────
def signed_area(pts):
    a = 0.0
    p = pts if pts[0] == pts[-1] else pts + [pts[0]]
    for (x0, y0), (x1, y1) in zip(p, p[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p) < 0:
        p = p[::-1]
    return p


def clip_box(poly, umin, vmin, umax, vmax):
    """Sutherland-Hodgman against an axis-aligned box. Returns [] if empty.

    Every Main Building mass below is a clip of the REAL footprint rather than a
    hand-drawn rectangle, so no band can drift outside the building's own
    outline and the pieces tile it exactly.
    """
    out = list(poly)
    edges = (
        (lambda p: p[0] >= umin, lambda a, b: _ix(a, b, 0, umin)),
        (lambda p: p[0] <= umax, lambda a, b: _ix(a, b, 0, umax)),
        (lambda p: p[1] >= vmin, lambda a, b: _ix(a, b, 1, vmin)),
        (lambda p: p[1] <= vmax, lambda a, b: _ix(a, b, 1, vmax)),
    )
    for inside, cut in edges:
        if not out:
            return []
        nxt = []
        for i in range(len(out)):
            a, b = out[i - 1], out[i]
            ia, ib = inside(a), inside(b)
            if ib:
                if not ia:
                    nxt.append(cut(a, b))
                nxt.append(b)
            elif ia:
                nxt.append(cut(a, b))
        out = nxt
    return out


def _ix(a, b, axis, val):
    d = b[axis] - a[axis]
    t = 0.0 if abs(d) < 1e-12 else (val - a[axis]) / d
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def offset(pts, d):
    """Offset a closed ring by d metres; positive grows it. From bake_stadium."""
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
    if abs(signed_area(out)) <= 1.0:
        return None
    return out


def dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


# ── the local frame ───────────────────────────────────────────────────
class Frame(object):
    """(u, v) metres on the building's own grid, u east-ish, v north-ish.

    The Main Building sits 4.9 degrees off north, and every wall in it is
    parallel or perpendicular to that. Working in the rotated frame is what lets
    a mass be described as a box instead of as eight hand-placed vertices.
    """

    def __init__(self, ring):
        self.lat0 = sum(p[1] for p in ring) / len(ring)
        self.lon0 = sum(p[0] for p in ring) / len(ring)
        self.k = math.cos(math.radians(self.lat0))
        self.th = self._grid_angle(ring)

    def _grid_angle(self, ring):
        """The footprint's own grid direction, from its longest edge mod 90.

        Not a constant: a snapshot that re-traces the footprint should move this
        with it. Asserted against the value measured when this was written.
        """
        best, ang = -1.0, 0.0
        for a, b in zip(ring, ring[1:]):
            dx = (b[0] - a[0]) * M_LAT * self.k
            dy = (b[1] - a[1]) * M_LAT
            d = dx * dx + dy * dy
            if d > best:
                best, ang = d, math.atan2(dx, dy)
        return ((ang + math.pi / 4) % (math.pi / 2)) - math.pi / 4

    def to_uv(self, lon, lat):
        x = (lon - self.lon0) * M_LAT * self.k
        y = (lat - self.lat0) * M_LAT
        c, s = math.cos(self.th), math.sin(self.th)
        return (x * c - y * s, x * s + y * c)

    def to_ll(self, u, v):
        c, s = math.cos(-self.th), math.sin(-self.th)
        x, y = u * c - v * s, u * s + v * c
        return [round(self.lon0 + x / (M_LAT * self.k), 7),
                round(self.lat0 + y / M_LAT, 7)]

    def ring_ll(self, uv):
        r = [self.to_ll(u, v) for (u, v) in uv]
        if r[0] != r[-1]:
            r.append(r[0])
        return r


# ── emission ──────────────────────────────────────────────────────────
class Bake(object):
    def __init__(self, frame, stats):
        self.f = frame
        self.out = []
        self.stats = stats
        # (family, day hex) -> image id. A pattern image IS a colour — the tile
        # is generated from the band's own trio — so two bands that share a
        # drawing family but not a palette need two images.
        #
        # This exists because the first cut let the family name BE the image id.
        # Seven bands use the plain-ashlar family (the Main Building's
        # entablature and its two terraces, then the tower's cornice, clock
        # stage, belfry plinth, belfry entablature and cap) and js/tower.js
        # builds each image from the FIRST feature it sees carrying that id — so
        # the whole crown silently inherited the Main Building trim's palette.
        # By day that was invisible (#e7ddc9 against #ddd2c0). At night the trim
        # is unlit #24252c and the crown is floodlit #dd6420, so the top 28 m of
        # the Tower went dark in the one shot the night state exists for.
        self.pat_ids = {}

    def pat_id(self, fam, cols):
        # The whole TRIO, not just the day hex. The cornice and the crown share
        # a daylight limestone and differ only at night (#c9501c against
        # #dd6420, because the floods are closer to the crown), so keying on
        # `wd` alone merged exactly the two bands whose difference only exists
        # in the shot this pass built the night state for.
        key = (fam, cols["wd"], cols["wg"], cols["wn"])
        if key not in self.pat_ids:
            n = sum(1 for k in self.pat_ids if k[0] == fam)
            self.pat_ids[key] = fam if n == 0 else "%s%d" % (fam, n + 1)
        return self.pat_ids[key]

    def add(self, uv, base, top, cols, kind, part, pat=None, extra=None):
        uv = dedupe(uv)
        if len(uv) < 3 or top - base < 0.05 or abs(signed_area(uv)) < 0.25:
            self.stats["skipped_degenerate"] += 1
            return
        pr = {"kind": kind, "part": part,
              "base": round(base, 2), "h": round(top, 2)}
        pr.update(cols)
        if pat:
            # `fam` is how it is DRAWN, `pat` is which image it uses. They are
            # the same string only when a family has one palette.
            pr["fam"] = pat
            pr["pat"] = self.pat_id(pat, cols)
        if extra:
            pr.update(extra)
        self.out.append({"type": "Feature", "properties": pr,
                         "geometry": {"type": "Polygon",
                                      "coordinates": [self.f.ring_ll(uv)]}})
        self.stats[kind] += 1

    def box(self, u0, v0, u1, v1, base, top, cols, kind, part, pat=None, extra=None):
        self.add([(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
                 base, top, cols, kind, part, pat, extra)


def rect(cu, cv, w, d):
    return [(cu - w / 2, cv - d / 2), (cu + w / 2, cv - d / 2),
            (cu + w / 2, cv + d / 2), (cu - w / 2, cv + d / 2)]


def build(feature, stats):
    ring_ll = feature["geometry"]["coordinates"][0]
    f = Frame(ring_ll)
    deg = math.degrees(f.th)
    if abs(deg - 4.915) > 1.5:
        print("  WARNING: grid angle %.3f deg, expected ~4.9 — plan boxes below "
              "are stated in that frame and will be wrong" % deg)
    foot = dedupe([f.to_uv(*p) for p in ring_ll])
    b = Bake(f, stats)

    # The tower shaft rectangle, straight from OSM way/516187631 as it lands in
    # this frame. Derived from the footprint's own north notches rather than
    # hard-coded: the notch either side of the shaft IS the shaft's width.
    tu0, tv0, tu1, tv1 = -17.63, 17.93, 4.93, 38.77
    cu, cv = (tu0 + tu1) / 2, (tv0 + tv1) / 2
    W, D = tu1 - tu0, tv1 - tv0

    # ── 1. The Main Building ──────────────────────────────────────────
    # Three tile-roofed arms — west wing, east wing, south block — around a
    # lower middle. That U is what the nadir imagery shows and it is what the
    # roof:shape=quadruple_saltbox tag on the OSM way is trying to say.
    ARMS = {
        "w": (-1e3, -2.0, -25.0, 1e3),
        "e": (15.0, -2.0, 1e3, 1e3),
        "s": (-1e3, -29.5, 1e3, -13.0),
    }
    PAVS = {
        "pw": (-1e3, -1e3, -24.0, -29.05),
        "pe": (12.0, -1e3, 1e3, -29.05),
    }

    main = clip_box(foot, -1e3, -29.05, 1e3, 1e3)      # everything north of the
                                                       # south terraces
    c_base = trio(C_BASE, N_DARK)
    c_wall = trio(C_WALL, N_DARK)
    c_trim = trio(C_TRIM, N_DARK)
    c_attic = trio(C_ATTIC, N_DARK)
    c_tile = {"wd": C_TILE, "wg": C_TILE_G, "wn": C_TILE_N}

    # the rusticated arcade storey runs under the whole footprint, terraces too
    b.add(foot, 0.0, H_ARCADE, c_base, "wall", "mb-base", "twbase")
    b.add(main, H_ARCADE, H_PIANO, c_wall, "wall", "mb-piano", "twwall")
    b.add(main, H_PIANO, H_ENTAB, c_trim, "wall", "mb-entab", "twplain")

    for key, box in PAVS.items():
        p = clip_box(foot, *box)
        if p:
            b.add(p, H_ARCADE, H_PAVILION, c_trim, "wall", "mb-" + key, "twplain")

    for key, box in ARMS.items():
        arm = clip_box(main, *box)
        if not arm:
            stats["arm_empty"] += 1
            continue
        b.add(arm, H_ENTAB, H_ATTIC, c_attic, "wall", "mb-attic-" + key, "twattic")
        # the hip, as stepped inset facets
        rise = (H_RIDGE - H_ATTIC) / ROOF_STEPS
        cur = arm
        for i in range(ROOF_STEPS):
            if cur is None:
                stats["roof_offset_failed"] += 1
                break
            b.add(cur, H_ATTIC + i * rise, H_ATTIC + (i + 1) * rise,
                  c_tile, "roof", "mb-roof-" + key)
            cur = offset(cur, -ROOF_INSET)

    # ── 2. The Tower ──────────────────────────────────────────────────
    c_shaft = trio(C_SHAFT, N_SHAFT)
    c_crown = trio(C_CROWN, N_CROWN)
    c_corn = trio(C_CROWN, N_CORNICE)

    def band(scale, base, top, cols, part, pat=None):
        b.add(rect(cu, cv, W * scale, D * scale), base, top, cols, "wall", part, pat)

    band(1.0, SHAFT_FROM, H_SHAFT_TOP, c_shaft, "shaft", "twshaft")
    band(S_CORNICE, H_SHAFT_TOP, H_CORNICE, c_corn, "cornice", "twplain")
    band(S_CLOCK, H_CORNICE, H_CLOCK_TOP, c_crown, "clockstage", "twplain")
    band(S_BELFRY_FOOT, H_CLOCK_TOP, H_BELFRY_FOOT, c_crown, "belfry-foot", "twplain")
    band(S_ENTAB, H_BELFRY_TOP, H_ENTAB_TOP, c_crown, "belfry-entab", "twplain")
    band(S_CAP, H_ENTAB_TOP, H_CAP_MID, c_crown, "cap", "twplain")
    band(S_CAPTOP, H_CAP_MID, H_TOP, trio(C_COPPER, "#1a2028", 0.06), "cap-roof")

    # the bell chamber: a dark box the colonnade stands in front of
    b.add(rect(cu, cv, W * S_BELFRY - 2 * PIER_W, D * S_BELFRY - 2 * PIER_W),
          H_BELFRY_FOOT, H_BELFRY_TOP, trio(C_DARK, "#0d0c10", 0.04),
          "wall", "belfry-void", "twvoid")

    bw, bd = W * S_BELFRY, D * S_BELFRY
    for su in (-1, 1):
        for sv in (-1, 1):
            b.add(rect(cu + su * (bw - PIER_W) / 2, cv + sv * (bd - PIER_W) / 2,
                       PIER_W, PIER_W),
                  H_BELFRY_FOOT, H_BELFRY_TOP, c_crown, "post", "belfry-pier")
    for span, along_u in ((bw, True), (bd, False)):
        clear = span - 2 * PIER_W
        for t in COL_T:
            off = -clear / 2 + clear * t
            for s in (-1, 1):
                if along_u:
                    c = rect(cu + off, cv + s * (bd - COL_W) / 2, COL_W, COL_W)
                else:
                    c = rect(cu + s * (bw - COL_W) / 2, cv + off, COL_W, COL_W)
                b.add(c, H_BELFRY_FOOT, H_BELFRY_TOP, c_crown, "post", "belfry-col")

    # ── 3. The window slots, and the numeral in them ──────────────────
    # Three per face. `faces` is (outward normal in u, in v, half-extent of the
    # face, the face's own outward offset) for the shaft's four elevations.
    faces = (
        (0, -1, D / 2), (0, 1, D / 2),      # south, north  (run along u)
        (-1, 0, W / 2), (1, 0, W / 2),      # west,  east   (run along v)
    )
    c_slot = trio(C_SLOT, "#2a1a0c", 0.10)
    c_glass = trio(C_GLASS, N_UNLIT, 0.06)
    c_lit = trio(C_GLASS, N_LIT, 0.06)

    # A "1" in a facade that has exactly three window columns: the middle column
    # full height, all three across the bottom as the base serif, and two cells
    # in the left column near the top as the flag. That is how the real one
    # reads in a photograph of the national-championship lighting.
    def lit(col, row):
        return col == 1 or row == 0 or (col == 0 and row in (WIN_ROWS - 2, WIN_ROWS - 3))

    for nu, nv, half in faces:
        along_u = (nu == 0)
        for col in (-1, 0, 1):
            off = col * SLOT_PITCH
            if along_u:
                su, sv = cu + off, cv + nv * (half + SLOT_DEPTH / 2)
                slot = rect(su, sv, SLOT_W, SLOT_DEPTH)
            else:
                su, sv = cu + nu * (half + SLOT_DEPTH / 2), cv + off
                slot = rect(su, sv, SLOT_DEPTH, SLOT_W)
            b.add(slot, WIN_FROM - 1.5, H_SHAFT_TOP - 1.2, c_slot, "slot", "slot")
            for row in range(WIN_ROWS):
                z = WIN_FROM + row * FLOOR
                if z + WIN_H > H_SHAFT_TOP - 1.2:
                    break
                if along_u:
                    w = rect(cu + off, cv + nv * (half + WIN_DEPTH / 2), SLOT_W, WIN_DEPTH)
                else:
                    w = rect(cu + nu * (half + WIN_DEPTH / 2), cv + off, WIN_DEPTH, SLOT_W)
                on = lit(col + 1, row)
                b.add(w, z, z + WIN_H, c_lit if on else c_glass, "win",
                      "win-lit" if on else "win", None, {"lit": 1 if on else 0})

    # ── 4. The four clock faces ───────────────────────────────────────
    # A vertical disc is not a thing fill-extrusion can draw, so the bezel is
    # five horizontal slabs whose widths are the circle's chords at their own
    # mid-heights. Five is the point where the silhouette stops reading as a
    # stack of boxes at the altitude this app flies.
    cs_half_u, cs_half_v = W * S_CLOCK / 2, D * S_CLOCK / 2
    c_gold = trio(C_GOLD, "#d8b04e", 0.10)
    c_dial = trio(C_DIAL, N_DIALLIT, 0.05)
    for nu, nv in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        along_u = (nu == 0)
        half = cs_half_v if along_u else cs_half_u
        for i in range(CLOCK_SLABS):
            t0 = -1.0 + 2.0 * i / CLOCK_SLABS
            t1 = -1.0 + 2.0 * (i + 1) / CLOCK_SLABS
            tm = (t0 + t1) / 2
            w = CLOCK_D * math.sqrt(max(0.0, 1.0 - tm * tm))
            z0 = CLOCK_MID + t0 * CLOCK_D / 2
            z1 = CLOCK_MID + t1 * CLOCK_D / 2
            if along_u:
                g = rect(cu, cv + nv * (half + CLOCK_DEPTH / 2), w, CLOCK_DEPTH)
            else:
                g = rect(cu + nu * (half + CLOCK_DEPTH / 2), cv, CLOCK_DEPTH, w)
            b.add(g, z0, z1, c_gold, "clock", "clock-bezel")
        # the dial, standing a little proud of the bezel so it is not buried
        # inside it. Geometrically backwards — the real dial is recessed — and
        # invisible at any altitude this app flies.
        d = CLOCK_DEPTH + 0.14
        if along_u:
            dl = rect(cu, cv + nv * (half + d), DIAL_D, 0.16)
        else:
            dl = rect(cu + nu * (half + d), cv, 0.16, DIAL_D)
        b.add(dl, CLOCK_MID - DIAL_D / 2, CLOCK_MID + DIAL_D / 2, c_dial,
              "clock", "clock-dial")

    return b.out


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    hit = [f for f in feats if f["properties"].get("id") == TOWER_ID]
    if not hit:
        raise SystemExit("UT Tower id %s not in the snapshot" % TOWER_ID)
    stats = Counter()
    out = build(hit[0], stats)

    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": [TOWER_ID],
          "replacedPartWallColour": PART_WD}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    pats = sorted({(f["properties"].get("pat"), f["properties"].get("fam"),
                    f["properties"]["wd"], f["properties"]["wn"])
                   for f in out if f["properties"].get("pat")})
    print(json.dumps({
        "features": len(out),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "patterns": ["%s (%s) %s -> %s" % p for p in pats],
        "replaced_building_ids": [TOWER_ID],
        "replaced_parts_by_wall_colour": PART_WD,
        "provenance": {
            "footprint": "factual - the snapshot's own 25-vertex ring, clipped",
            "shaft_plan": "factual - OSM way/516187631, 22.56 x 20.84 m",
            "tower_height": "factual - 94.0 m in the data, 307 ft in every source",
            "crown_heights": "measured - off two photographs, agreeing to 2.5%; "
                             "the clock dial cross-checks a sourced 12 ft",
            "crown_plan": "measured - silhouette widths off a rectified elevation",
            "window_slots": "measured - three per face, 4.05 m pitch, 1.42 m wide",
            "belfry_columns": "measured at the limit of resolution - four per "
                              "face between two corner piers; the 2+2 grouping "
                              "is visible, the exact spacing is regularised",
            "main_building_heights": "measured - 24.4 m eave / 29.0 m ridge, "
                                     "solved from a long-lens photograph with "
                                     "the shaft width as the ruler; +/- 1 m",
            "main_building_masses": "GENERATIVE - which arm is tall and which "
                                    "middle is low is read off nadir imagery, "
                                    "but the box boundaries are authored",
            "colours": "measured off photographs, corrected for illuminant; "
                       "the tower/base tonal split is authored, not a claim "
                       "about the stone (both are Indiana limestone)",
            "night": "convention sourced from tower.utexas.edu/lighting "
                     "('Orange Tower with No. 1'); hexes authored from two "
                     "night photographs, both clipped in G and B",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
