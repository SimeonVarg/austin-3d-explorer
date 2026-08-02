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
# js/facades.js: for (let iter = 0; iter < 12; iter++)
LLOYD_ITERS = 12


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


def main():
    check_only = "--check" in sys.argv
    gj = json.load(open(RING, encoding="utf-8"))
    feats = gj["features"]
    towers = [f for f in feats
              if f["properties"].get("t") == 1 and f["properties"].get("wd")]
    if not towers:
        print("no towers in %s — nothing to do" % RING)
        return

    cent = cluster_colours([f["properties"]["wd"] for f in towers], TOWER_BUCKETS)

    # The golden and night derivations are the browser's, so a baked tower rides
    # the same day->golden->night ramp as one stamped at runtime did.
    palette = [{
        "fb": i,
        "wd": to_hex(c),
        "wg": to_hex([v * (0.92 if j == 2 else 1.06) for j, v in enumerate(c)]),
        "wn": to_hex([v * 0.34 + n * 0.30
                      for v, n in zip(c, (17, 22, 42))]),
    } for i, c in enumerate(cent)]

    counts = [0] * TOWER_BUCKETS
    changed = 0
    for f in towers:
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

    report = {
        "towers": len(towers),
        "features": len(feats),
        "buckets": TOWER_BUCKETS,
        "per_bucket": counts,
        "changed": changed,
        "palette": [{"fb": p["fb"], "wd": p["wd"]} for p in palette],
    }
    if check_only:
        print(json.dumps(report, indent=2))
        return

    with open(RING, "w", encoding="utf-8") as fh:
        json.dump(gj, fh, separators=(",", ":"))
    with open(PALETTE, "w", encoding="utf-8") as fh:
        json.dump({
            "note": ("Facade buckets for the downtown towers, computed by "
                     "scripts/bake_outer_facades.py from the towers' own baked "
                     "wall colours. Each tower carries its bucket ORDINAL as "
                     "`fb`; the browser maps that ordinal to a palette index it "
                     "allocates at boot and registers one atlas tile per bucket. "
                     "Do not stamp `wp` directly — the renderer reads it, and an "
                     "unregistered pattern id paints the wall transparent. "
                     "Regenerate whenever outer_ring.geojson is re-baked."),
            "buckets": palette,
        }, fh, indent=2)
    print(json.dumps(report, indent=2))
    print("wrote %s and %s" % (os.path.relpath(RING, ROOT),
                               os.path.relpath(PALETTE, ROOT)))


if __name__ == "__main__":
    main()
