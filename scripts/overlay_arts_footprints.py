# -*- coding: utf-8 -*-
"""Draw each target footprint ON its own nadir aerial, plus a metre scale.

Playbook rule 6: disambiguate "where does this go" with ONE labelled render
before tiling a decision across hundreds of features. Every band inset in
bake_arts.py is a distance in metres from this outline, so the outline had
better be where the building is. This also catches the failure the ground pass
hit - measuring against a basemap instead of against your own data.

Usage:  python scripts/overlay_arts_footprints.py
Writes: research/arts-precinct/overlay_<slug>.png
"""
import json
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "research", "arts-precinct")
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")

SITES = {
    "lbj":     ["d997136f"],
    "kelly":   ["a5ec01b5"],
    "blanton": ["8a27170d", "8ceb5fdd", "f6fbb1e7", "8dcd88b6", "4a7b9425", "b8d14732",
                "bab781de", "15499cfe", "476da41f", "fe5816e6", "6939670a", "44e5078e"],
    "ransom":  ["4f12c48f"],
    "bass":    ["31901788", "dced0185"],
}
COL = {0: (255, 0, 255), 1: (0, 255, 255)}
SPAN = 2


def main():
    idx = json.load(open(os.path.join(REF, "INDEX.json"), encoding="utf-8"))
    aerials = {e["site"]: e for e in idx if e.get("file", "").startswith("aerial_")}
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    byid = {f["properties"]["id"][:8]: f for f in feats}

    for slug, ids in SITES.items():
        e = aerials.get(slug)
        if not e:
            continue
        im = Image.open(os.path.join(REF, e["file"])).convert("RGB")
        d = ImageDraw.Draw(im)
        z, (xi, yi) = e["z"], e["centre_tile"]
        n = 2 ** z

        def ll2px(lon, lat):
            tx = (lon + 180.0) / 360.0 * n
            ty = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
            return ((tx - (xi - SPAN)) * 256, (ty - (yi - SPAN)) * 256)

        for k, i8 in enumerate(ids):
            f = byid.get(i8)
            if not f:
                print("  ?", slug, i8)
                continue
            p = f["properties"]
            rings = f["geometry"]["coordinates"]
            if f["geometry"]["type"] == "MultiPolygon":
                rings = [r for poly in rings for r in poly]
            for ring in rings:
                pts = [ll2px(*q[:2]) for q in ring]
                d.line(pts, fill=COL[1 if k else 0], width=3)
            c = ll2px(*ring[0][:2])
            d.text((c[0] + 4, c[1] + 4), "%s h=%.1f" % ((p.get("name") or i8)[:26],
                                                        p.get("final_height") or 0),
                   fill=COL[1 if k else 0])

        # a 20 m bar, so every inset below can be eyeballed against it
        lat0 = 30.2830
        mpp = 156543.03392 * math.cos(math.radians(lat0)) / n
        bar = 20.0 / mpp
        y = im.size[1] - 40
        d.line([(40, y), (40 + bar, y)], fill=(255, 255, 0), width=5)
        d.text((40, y - 18), "20 m", fill=(255, 255, 0))
        im.save(os.path.join(REF, "overlay_%s.png" % slug))
        print("  overlay_%s.png  (%.4f m/px)" % (slug, mpp))


if __name__ == "__main__":
    main()
