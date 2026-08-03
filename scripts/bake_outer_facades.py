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
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


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


def derive(cent, kind):
    """A bucket's (wd, wg, wn) triple, golden derived per MATERIAL."""
    lift = GOLDEN[kind]
    mul, add, anchor = NIGHT_MIX
    return [{
        "fb": i,
        "wd": to_hex(c),
        "wg": to_hex([v * lift[j] for j, v in enumerate(c)]),
        "wn": to_hex([v * mul + n * add for v, n in zip(c, anchor)]),
    } for i, c in enumerate(cent)]


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
    palette = derive(cent, "tower" if k == 1 else "midrise")
    counts = [0] * len(cent)
    changed = 0
    for f in mine:
        p = f["properties"]
        b = bucket_of(p["wd"], cent)
        counts[b] += 1
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

    report = {
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
