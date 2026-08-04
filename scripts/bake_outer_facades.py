# -*- coding: utf-8 -*-
"""Give the 114 downtown towers their facade bucket in the BAKE, not the browser.

WHY THIS EXISTS. The outer ring moved onto vector tiles (PR #43) and downtown
lost its curtain wall in the same commit. `js/facades.js`'s
`quantiseOuterFacades` clusters the towers' baked wall colours in the BROWSER
and writes `wp` onto each feature at runtime; a vector tile cannot be mutated,
so on the tile path every tower falls through
`['coalesce', ['get','wp'], 'mh00']` to one pattern. That is the field of
identical brick-red boxes in shots/tour/day-downtown-skyline.png, and it is the
most-filmed subject in the scene after campus.

THE ONE THING THAT MAKES THIS PORTABLE. The tower assignment depends only on
the TOWERS' OWN colours — `clusterColours` runs over `towers.map(f => f.wd)` and
nothing else. Only the resulting bucket's INDEX depends on the browser, because
the towers' buckets are appended after the campus palette and the id is
'tg' + that index. So the partition can be computed here, offline and exactly,
and the browser only has to register an image per bucket.

Hence a bucket ORDINAL under its own property `fb`, rather than a `wp` string.
Two reasons, and the second one is a live hazard:

  `wp` IS READ BY THE RENDERER. FACADE_PATTERN_EXPR is
  ['coalesce', ['get','wp'], 'mh00'], so a baked wp of "tb03" resolves to an
  atlas image named tb03 — which nothing registers — and MapLibre paints an
  unknown pattern TRANSPARENT. The first version of this stamped `wp`, a
  scheduled data build re-tiled outer.pmtiles from it within the hour, and that
  archive would have turned every downtown tower into a hole. Nothing reads
  `fb`, so the stamp is inert until the browser side deliberately picks it up.

  And `parseId` splits an id as fam=slice(0,2), idx=parseInt(slice(2)), so
  "tb03" would retint through family "tb" at palette index 3 — a campus colour
  and a family with no tile generator — every time the hour changed.

The browser side, when it lands, reads `fb` and maps it to whatever palette
index it allocated. Keeping the ordinal and the id separate is the point: the
ordinal belongs to the data, the id belongs to the session.

WHAT IS NOT PORTED, and why it is not a smaller job than it looks. The other
7,511 low-rise ring features are snapped to the CAMPUS palette, which
js/facades.js derives in the browser from the campus buildings snapshot. That
derivation would have to be ported too before their `wp` could be baked. They
currently fall back to `mh00` on the tile path and did so before this change as
well — this is the tower half, and it is the half you can see.

Deterministic, and it has to be: `clusterColours` seeds from a luma-sorted
quantile and runs a fixed twelve Lloyd iterations with no randomness anywhere.
Every arithmetic detail below is transcribed from it, including that argmin
takes the FIRST minimum on a tie. `scripts/verify/outer-facade-parity.mjs`
checks this against the real browser function rather than against a re-reading
of it.

Idempotent: re-stamps from `wd` every time, so running it twice changes nothing.

Usage:  python scripts/bake_outer_facades.py [--check]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RING = os.path.join(ROOT, "data", "outer_ring.geojson")
PALETTE = os.path.join(ROOT, "data", "outer_tower_palette.json")

# js/facades.js: const TOWER_BUCKETS = 10;
TOWER_BUCKETS = 10
# The downtown streetwall (`t=2`, scripts/bake_outer.py:MIDRISE_H) gets its own
# set for the same reason the towers got one: its materials are brick, stucco
# and painted concrete, and snapping them onto ten GLASS centroids would put a
# curtain wall on a two-storey shopfront. Fewer buckets than the towers because
# the range is narrower and every bucket costs an atlas repaint per hour step.
MIDRISE_BUCKETS = 6
# js/facades.js: for (let iter = 0; iter < 12; iter++)
LLOYD_ITERS = 12

# ── how a wall grades from day to golden hour, per material ───────────
#
# THE MASONRY RULE WAS BEING APPLIED TO GLASS, and downtown is 51% glass.
#
# js/facades.js derives a bucket's golden tone as `v * (1.06, 1.06, 0.92)` —
# redder, greener, LESS BLUE. That is right for brick and limestone, which
# genuinely warm in low sun. A curtain wall does not warm: it MIRRORS THE SKY,
# and while there is sky in it the reflection stays cool.
#
# Measured, because this is the whole of QUEUE E1's colour question. Two
# reference photographs of this skyline (Wikimedia Commons, "Austin Texas
# skyline, December 2023 - Day" and "Austin Skyline from Loop 360 Overlook
# 2026") put the tower cluster at B-R +1 on a hazy day and +90 on a clear one.
# Never negative. The app rendered it at -15.
#
# Every one of the ten tower buckets LEFT the palette blue (B-R +26 to +37) and
# arrived at the atlas neutral-to-warm (-1 to -7), measured directly off the
# registered images by scripts/verify/tower-atlas-tone.mjs. `drawTile` lerps
# wd->wg by `p`, and the app's default day is p=0.30 — which is 60% of the way
# to golden, so a "golden hour" tint is at 60% strength at noon.
#
# This fixes the half that lives in the data. The other half is
# js/facades.js:drawTile's `mix(glass, [255,176,96], golden * 0.45)`, which is
# a 27% orange wash on the glass at that same p=0.30 and is NOT this lane's
# file — see HANDOFF for the request and the numbers.
GOLDEN = {
    # Towers: glass. Brighter at golden hour like everything else, but the blue
    # does not come out of it.
    "tower": (1.06, 1.06, 1.00),
    # Mid-rise: brick, stucco, painted concrete. The masonry rule is correct
    # here and is transcribed from js/facades.js unchanged.
    "midrise": (1.06, 1.06, 0.92),
}
# js/facades.js: wn = v * 0.34 + [17,22,42][j] * 0.30. Shared by both sets.
NIGHT_MIX = (0.34, 0.30, (17, 22, 42))

# ══ THE ATLAS TILE IS THE THING THAT HAS TO MATCH THE PHOTOGRAPH ══════
#
# QUEUE F3: "downtown is STILL a dark grey mass ... a smudge of charcoal in a
# warm tan city". It was flagged before PR #112, fixed once, and still true.
#
# THE THREE CANDIDATE CAUSES, ANSWERED BY MEASUREMENT, NOT BY READING THE CODE.
# All of it on one build in one session with a drift check that came back 0.0
# (scripts/verify/downtown-colour.mjs, tour pose `downtown-skyline`, tod 0.30):
#
#   1. A REGRESSION FROM THE FACADE TILE SWITCH (#84/#94)?  NO.
#      Reproduced the pre-#84 frame exactly by setting outer-tower's pattern
#      back to the literal 'mh00' every tower used to fall through to. It
#      rendered at luma 125.5 / spread 7.4 against today's 119.7 / 9.0. The
#      switch cost 5.9 luma and BOUGHT 1.6 of spread. It is not the cause and
#      reverting it would make the mass worse, not better: mh00 put all 243
#      towers on one brick-red pattern at B-R -39.8.
#
#   2. THE ATMOSPHERIC FADE OVER-DARKENING AT DISTANCE?  NO — THE OPPOSITE.
#      window.HAZE_TUNE.on = false and the towers DROP to 78.3 luma. The haze
#      is worth +41.4 luma to downtown; it is the only reason downtown is
#      visible at all at that range. fill-extrusion-vertical-gradient, which
#      QUEUE F1 names as a suspect, is worth -0.3 luma on the towers (it is
#      worth 6.8 on the flat ring, where it is doing its job). Neither is it.
#
#   3. WHAT THE DATA SAYS?  THE DATA IS RIGHT. THE ATLAS THROWS IT AWAY.
#      Population-weighted over the 243 towers:
#
#          the baked palette   luma 159.2   sd 27.0   B-R +14.6
#          the ATLAS TILE      luma 131.4   sd 16.3   B-R  -9.4
#          the SCREEN pixel    luma 119.7   sd  9.0   B-R -13.6
#
#      Against a photograph — 12 individual tower facades sampled off Wikimedia
#      Commons "Aerial view of Downtown Austin" (CC BY-SA 4.0, clear midday),
#      two obvious roofs rejected after looking at the swatches:
#
#          real facades        luma 104.9   sd 28.5   B-R +20.1  (range +1..+45)
#
#      THE BAKE'S OWN SPREAD IS ALREADY RIGHT: 27.0 against the photograph's
#      28.5. So is the mean — the screen's 119.7 is within 4 of the reference
#      skyline's scale-matched 116.5. What is wrong is that only 60% of that
#      spread survives into the atlas and half of what is left survives the
#      haze, so 243 buildings arrive on screen inside a 22-luma band. A mass is
#      not a dark thing, it is an UNDIFFERENTIATED thing, and that is the word
#      he used. Every tower in the photograph is a different colour from its
#      neighbour; ours are not.
#
# WHERE IT GOES, AND WHY THE FIX IS HERE. js/facades.js:drawTile paints the
# glazed 51% of a `tg` tile as mix(wall, [46,58,74], 0.62) — so only 38% of a
# bucket's difference from its neighbours survives in half the tile — and then
# washes it with mix(glass, [255,176,96], golden*0.45). That file is NOT this
# lane's and repainting it would move every building in the city, not just the
# 243 that are wrong. HANDOFF §53 already wrote the request; nothing has come
# of it, and downtown has now been reported three times.
#
# So the compression is INVERTED HERE INSTEAD, in the file that owns the atlas
# generator's input. That is not a workaround dressed up: `outer_tower_palette`
# is not a list of wall colours anybody sees. Nothing renders it. Its only
# consumer is registerFacadeBuckets -> drawTile (checked: the tower FEATURES'
# own wd is dead at render time too — js/outer.js sends t=1 to a pattern layer
# and a roof layer that reads rd/rg/rn). Its whole job is to be the number that
# makes the TILE come out right, and the tile is what tower-atlas-tone.mjs was
# written to measure precisely because it is the step that was being guessed.
#
# THE MAP FROM `wd` TO THE TILE IS AFFINE AND WAS FITTED, NOT ASSUMED. Ten
# buckets, read off the REGISTERED ATLAS IMAGES by tower-atlas-tone.mjs at
# p=0.30, one straight line per channel, residuals under 1 level:
TILE_FIT = {"r": (0.604, 42.0), "g": (0.609, 33.5), "b": (0.568, 30.0)}
# Predicted glazing check: 1 - 0.62*want(tg=0.51) = 0.684 against a measured
# 0.604, the rest being the mottle, the streaks and the window frames. The same
# arithmetic puts the `mh` streetwall at 1 - 0.62*0.20 = 0.876 — a third of the
# compression — which is why NONE of this is applied to the mid-rise. It is
# masonry, it is 20% glass, and it is not what he is looking at.
#
# 1. SPREAD. Expand each centroid about the population-weighted mean by exactly
#    1/slope, per channel, so the atlas delivers the spread the bake decided on
#    instead of 60% of it. Expanding about the mean is the point: the mean is
#    already right and must not move.
SPREAD_ON = True
# 2. HUE, AND THE ONE PLACE IT CAN BE PUT. drawTile's amber wash is scaled by
#    `golden` = 1 - |p-0.5|/0.5. A bucket's `wg` is weighted by p/0.5 below
#    noon and by 1-(p-0.5)/0.5 above it — THE SAME RAMP, both halves of the
#    day. So a fixed cool offset carried on `wg` alone cancels a constant
#    FRACTION of the amber at every hour, and leaves p=0 and p=1 — where there
#    is no amber to cancel — completely untouched. Put it on `wd` instead and
#    midnight goes blue.
#
#    Sized from the wash itself: over 51% glazing, mix(glass,[255,176,96],0.45)
#    moves the tile by (+39.2,+17.7,-3.9) at golden. Divided by the fitted
#    slopes, that is this much of a move in palette space:
AMBER_IN_PALETTE = (64.9, 29.1, -6.9)
# Cancel half of it. Not all: a curtain wall genuinely does pick up the sky at
# sunset, and the two references disagree about how much — the clear midday
# aerial reads B-R +20 on the facades, the hazy low-sun skyline reads -0.3 to
# -12.5. Half lands the day tile at about +5, inside the range both support,
# and leaves golden hour visibly golden. TASTE KNOB (CLAUDE.md rule 11): 0
# restores the old behaviour exactly, 1 removes the amber from glass entirely.
AMBER_CANCEL = 0.5
# The cancel rotates the hue and MUST NOT dim it: the screen mean is already
# within 4 luma of the reference and the one thing worse than a warm downtown
# is a dark one. So the shifted `wg` is renormalised back to the luma it had
# before the shift. Rec.601, the same weights every measurement in this repo
# uses.
LUMA_W = (0.299, 0.587, 0.114)


def hex_to_rgb(h):
    h = h.lstrip("#")
    return [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]


def to_hex(c):
    """js/facades.js toHex: clamp, round, two digits. Round-half-up like JS."""
    out = "#"
    for v in c:
        v = int(max(0, min(255, v)) + 0.5)
        out += "%02x" % v
    return out


def dist2(a, b):
    """js/facades.js:dist2 — WEIGHTED, 2/4/3 on R/G/B, not plain Euclidean.

    THIS WAS PLAIN EUCLIDEAN AND THE PARITY CHECK PASSED ANYWAY, which is worth
    writing down: two different metrics agreed on the partition of the 243
    shipped colours by luck, and the check that exists to catch exactly this
    reported PASS every time it was run. It only fell over when ONE tower's
    colour moved — Lloyd then converged somewhere else, the browser put 47
    towers in the bucket the bake put 27 in, and `outer-facade-parity` failed
    with 38 findings on a change that had nothing to do with clustering.

    A transcription is only correct against the function it transcribes, and
    `clusterColours` does not have its own distance — it calls the module-level
    `dist2`, which is weighted because green carries the luminance. Both places
    the browser measures a colour distance (the Lloyd assignment inside
    `clusterColours`, and the bucket pick in `quantiseOuterFacades`) call this
    one function, so one definition here covers both.
    """
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db


def nearest(p, cents):
    """First minimum wins, exactly as `if (d < bd)` does in the browser."""
    bi, bd = 0, float("inf")
    for i, c in enumerate(cents):
        d = dist2(p, c)
        if d < bd:
            bd, bi = d, i
    return bi


def cluster_colours(hexes, k):
    """A transcription of js/facades.js clusterColours. Same seed, same count."""
    pts = [hex_to_rgb(h) for h in hexes]
    if len(pts) <= k:
        return [p[:] for p in pts]
    lum = lambda c: c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114
    # JS Array.prototype.sort is stable in every current engine, and Python's
    # sorted() is stable, so equal-luma colours keep their file order in both.
    sorted_pts = sorted(pts, key=lum)
    cent = [sorted_pts[int((i + 0.5) * len(sorted_pts) / k)][:] for i in range(k)]
    for _ in range(LLOYD_ITERS):
        acc = [[0.0, 0.0, 0.0, 0] for _ in cent]
        for p in pts:
            i = nearest(p, cent)
            acc[i][0] += p[0]
            acc[i][1] += p[1]
            acc[i][2] += p[2]
            acc[i][3] += 1
        cent = [[a[0] / a[3], a[1] / a[3], a[2] / a[3]] if a[3] else c[:]
                for c, a in zip(cent, acc)]
    return cent


def bucket_of(feature_wd, cent):
    return nearest(hex_to_rgb(feature_wd), cent)


def luma(c):
    return sum(v * w for v, w in zip(c, LUMA_W))


def predict_tile(wd, wg, p=0.30):
    """What drawTile makes of a bucket at time-of-day `p`, from the fit above.

    IT HAS TO TAKE `wg` TOO, and getting that wrong is a trap worth naming.
    TILE_FIT was fitted against `wd` while `wg` was still a fixed multiple of
    it, so the fit silently absorbed drawTile's own wd->wg lerp; the moment the
    amber cancel moves `wg` independently, a wd-only predictor reports the hue
    as unchanged. It did, on the first run of this, and the number looked
    plausible.

    So the fit is restated against the WALL that drawTile actually forms —
    lerpHexAt(bucket, p) = mix(wd, wg, p/0.5) — by dividing the measured slopes
    by the old wd->wall ratio (0.4 + 0.6*lift). Checked against the measured
    atlas: bucket tg25 predicts 126.5,131.0,130.5 and the real tile reads
    127,131,131.

    Only meaningful for the `tg` family — see TILE_FIT's note about `mh`.
    """
    t = min(1.0, p / 0.5)
    wall = [wd[j] + (wg[j] - wd[j]) * t for j in range(3)]
    lift = GOLDEN["tower"]
    out = []
    for j, k in enumerate(("r", "g", "b")):
        slope, inter = TILE_FIT[k]
        a = slope / (0.4 + 0.6 * lift[j])
        out.append(wall[j] * a + inter)
    return out


def expand(cent, counts):
    """Pre-expand the centroids about their population-weighted mean.

    Weighted by BUILDING COUNT, not by bucket: 243 towers are spread 6..34 to a
    bucket, so an unweighted mean is the mean of ten k-means centroids and not
    the mean of the city. Getting that wrong shifts the whole skyline instead of
    stretching it, which is the one thing this must not do.
    """
    tot = float(sum(counts)) or 1.0
    mean = [sum(c[j] * n for c, n in zip(cent, counts)) / tot for j in range(3)]
    gain = [1.0 / TILE_FIT[k][0] for k in ("r", "g", "b")]
    out, clipped = [], 0
    for c in cent:
        v = [mean[j] + gain[j] * (c[j] - mean[j]) for j in range(3)]
        if any(x < 0 or x > 255 for x in v):
            clipped += 1
        out.append([max(0.0, min(255.0, x)) for x in v])
    return out, mean, clipped


def derive(cent, kind, counts=None):
    """A bucket's (wd, wg, wn) triple, golden derived per MATERIAL.

    For the TOWERS the centroids are pre-compensated first, so that what lands
    in the atlas is the spread the clustering actually found rather than 60% of
    it. The mid-rise is left exactly as it was.
    """
    lift = GOLDEN[kind]
    mul, add, anchor = NIGHT_MIX
    cool = [0.0, 0.0, 0.0]
    clipped = 0
    # `night` STAYS ON THE ORIGINAL CENTROID, and that is not an oversight.
    #
    # TILE_FIT was fitted at p=0.30. At night drawTile does
    # mix(glass, [12,15,28], dark*0.9), which throws away 90% of the bucket
    # before the tile is drawn, so the day fit does not describe the night tile
    # and there is no measurement here that does. Deriving `wn` from the
    # expanded centroid anyway MEASURABLY MADE NIGHT WORSE: on the tour's
    # skyline crop the night luma SD fell 12.00 -> 8.59 while the mean did not
    # move (22.31 -> 22.24), i.e. the cluster of lit towers lost a quarter of
    # its contrast — the exact defect this pass exists to fix, reintroduced
    # after dark by a correction applied outside the range it was measured in.
    night_src = cent
    if kind == "tower" and SPREAD_ON and counts:
        cent, _, clipped = expand(cent, counts)
        cool = [-AMBER_CANCEL * a for a in AMBER_IN_PALETTE]

    out = []
    for i, c in enumerate(cent):
        c0 = night_src[i]
        g = [v * lift[j] for j, v in enumerate(c)]
        if any(cool):
            shifted = [g[j] + cool[j] for j in range(3)]
            # Rotate the hue, keep the brightness. A zero-luma target would be
            # a divide by zero on a black bucket; there is no such bucket, but
            # the guard costs nothing and a NaN in a hex string is silent.
            lb, la = luma(g), luma(shifted)
            if la > 1.0:
                shifted = [v * (lb / la) for v in shifted]
            g = [max(0.0, min(255.0, v)) for v in shifted]
        out.append({
            "fb": i,
            "wd": to_hex(c),
            "wg": to_hex(g),
            "wn": to_hex([v * mul + n * add for v, n in zip(c0, anchor)]),
        })
    # A clipped bucket is one whose expansion ran into 0 or 255, i.e. one the
    # pre-compensation could not fully deliver. Reported rather than silently
    # tolerated: if this ever goes above one or two, the gain is asking for
    # more range than 8 bits has and the honest move is to lower it.
    #
    # ONLY THE TOWER CALL MAY WRITE IT. main() derives the mid-rise second, so
    # an unconditional assignment here reports the mid-rise's zero as the
    # towers' answer — a report that is always reassuring is not a report.
    if kind == "tower":
        derive.clipped = clipped
    return out


def stamp(feats, k, buckets, check_only):
    """Cluster one CLASS of feature on its own colours and stamp the ordinal.

    Returns (palette, per_bucket_counts, changed). `t` selects the class, so
    the towers and the mid-rise never see each other's centroids — which is
    the entire point, and the same argument quantiseStadiumFacades makes about
    not snapping a brick end zone onto the city's tan.

    `fb` is reused as the property name across both classes on purpose: they
    are drawn by different layers with different filters (`t==1` vs `t==2`) and
    different match expressions, so an ordinal cannot be read by the wrong one.
    """
    mine = [f for f in feats
            if f["properties"].get("t") == k and f["properties"].get("wd")]
    if not mine:
        return [], [], 0, 0
    cent = cluster_colours([f["properties"]["wd"] for f in mine], buckets)
    # ASSIGN FIRST, DERIVE SECOND. The tower pre-compensation expands about the
    # population-weighted mean, so the counts have to exist before the palette
    # does. They used to be accumulated in the same loop that stamps.
    assign = [bucket_of(f["properties"]["wd"], cent) for f in mine]
    counts = [0] * len(cent)
    for b in assign:
        counts[b] += 1
    palette = derive(cent, "tower" if k == 1 else "midrise", counts)
    changed = 0
    for f, b in zip(mine, assign):
        p = f["properties"]
        if p.get("fb") != b:
            changed += 1
        if not check_only:
            p["fb"] = b
            # Undo the first version of this script, which stamped a `wp` the
            # renderer reads. Left behind it would paint towers transparent.
            p.pop("wp", None)
            p.pop("wf", None)
    return palette, counts, changed, len(mine)


def main():
    check_only = "--check" in sys.argv
    gj = json.load(open(RING, encoding="utf-8"))
    feats = gj["features"]

    tpal, tcnt, tchg, tn = stamp(feats, 1, TOWER_BUCKETS, check_only)
    mpal, mcnt, mchg, mn = stamp(feats, 2, MIDRISE_BUCKETS, check_only)
    if not tn:
        print("no towers in %s — nothing to do" % RING)
        return

    # ── what the atlas will make of it, predicted from the fitted map ──
    # Printed on every run because the whole point of the pre-compensation is
    # the TILE, and a palette that looks odd on its own is exactly what success
    # looks like here. scripts/verify/downtown-colour.mjs then reads the real
    # atlas and the real frame, which is what actually settles it.
    def stats(vals, w):
        tot = float(sum(w)) or 1.0
        m = sum(v * n for v, n in zip(vals, w)) / tot
        sd = (sum(n * (v - m) ** 2 for v, n in zip(vals, w)) / tot) ** 0.5
        return m, sd

    pal_l = [luma(hex_to_rgb(b["wd"])) for b in tpal]
    pal_br = [hex_to_rgb(b["wd"])[2] - hex_to_rgb(b["wd"])[0] for b in tpal]
    tiles = [predict_tile(hex_to_rgb(b["wd"]), hex_to_rgb(b["wg"])) for b in tpal]
    tile_l = [luma(t) for t in tiles]
    tile_br = [t[2] - t[0] for t in tiles]
    pm, ps = stats(pal_l, tcnt)
    tm, ts = stats(tile_l, tcnt)
    pbm, _ = stats(pal_br, tcnt)
    tbm, _ = stats(tile_br, tcnt)
    tone = {
        "note": ("population-weighted over the towers; `tile` is PREDICTED from "
                 "TILE_FIT, verify it against the real atlas with "
                 "scripts/verify/downtown-colour.mjs"),
        "reference_facades": {"luma": 104.9, "sd": 28.5, "b_minus_r": 20.1},
        "palette": {"luma": round(pm, 1), "sd": round(ps, 1), "b_minus_r": round(pbm, 1)},
        "tile":    {"luma": round(tm, 1), "sd": round(ts, 1), "b_minus_r": round(tbm, 1)},
        "amber_cancel": AMBER_CANCEL,
        "spread_precompensated": bool(SPREAD_ON),
        "buckets_clipped_by_expansion": getattr(derive, "clipped", 0),
    }

    report = {
        "tower_tone": tone,
        "towers": tn, "midrise": mn,
        "features": len(feats),
        "tower_buckets": len(tpal), "midrise_buckets": len(mpal),
        "tower_per_bucket": tcnt, "midrise_per_bucket": mcnt,
        "changed": tchg + mchg,
        "tower_palette": [{"fb": p["fb"], "wd": p["wd"], "wg": p["wg"]} for p in tpal],
        "midrise_palette": [{"fb": p["fb"], "wd": p["wd"]} for p in mpal],
    }
    if check_only:
        print(json.dumps(report, indent=2))
        return

    with open(RING, "w", encoding="utf-8") as fh:
        json.dump(gj, fh, separators=(",", ":"))
    with open(PALETTE, "w", encoding="utf-8") as fh:
        json.dump({
            "note": ("Facade buckets for downtown, computed by "
                     "scripts/bake_outer_facades.py from the buildings' own "
                     "baked wall colours. `buckets` is the TOWERS (t=1, glass); "
                     "`midrise` is the streetwall (t=2, masonry). Each building "
                     "carries its bucket ORDINAL as `fb`, scoped by its `t`; the "
                     "browser maps that ordinal to a palette index it allocates "
                     "at boot and registers one atlas tile per bucket. "
                     "Do not stamp `wp` directly — the renderer reads it, and an "
                     "unregistered pattern id paints the wall transparent. "
                     "Regenerate whenever outer_ring.geojson is re-baked."),
            "buckets": tpal,
            "midrise": mpal,
        }, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("wrote %s and %s" % (os.path.relpath(RING, ROOT),
                               os.path.relpath(PALETTE, ROOT)))


if __name__ == "__main__":
    main()
