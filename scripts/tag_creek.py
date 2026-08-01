#!/usr/bin/env python3
"""
tag_creek.py — tell a creek from a lake from a pond.

"Behind the Alumni Center and between Patton and Gregory runs a creek (verify -
likely Waller Creek). Make that area read as a green creek with actual depth...
If it falls out cheaply, see what other areas like Turtle Pond can be
implemented."

VERIFIED, and it is Waller Creek. data/ground.geojson tags every water body `s:
water`, so a 7 m wooded channel is painted the same pale blue as open lake. The
reach past the Etter-Harbin Alumni Center matches OSM way/1021522298
(natural=water, water=river) on bbox to four decimals; none of the reaches carries
a `name` tag, so the identification is geographic — unambiguous, because it is the
only watercourse of this shape on campus and the reaches are contiguous.

CLASSIFIED BY SHAPE, not by a hardcoded index or bbox. The first version of this
script listed three bboxes read off the OSM cache and matched ONE of them: the
baked polygons are wider than the source ways, and there are seven reaches rather
than three. A shape rule cannot go stale that way.

The measure is isoperimetric: perimeter^2 / (4*pi*area), which is 1.0 for a circle
and grows without bound as a shape gets long and thin. Measured over every water
feature in the file:

    idx    area m2   thinness
      6      40754      121.3     creek
     11      16758       91.1     creek
     16      12178       80.3     creek   <- the Alumni Center reach
     29       8472       58.5     creek
     43       6055       63.2     creek
     45       6029       32.1     creek
    124       1928       28.0     creek
    151       1352        5.0     pond
    269        578        1.0     pond    <- circular; Turtle Pond
    270        573        1.5     pond
    412        218        5.5     pond
    467        107        3.2     pond
    538         19        1.3     pond

The gap between 28.0 and 5.0 is wide enough that the threshold is not a judgement
call.

    python scripts/tag_creek.py [--dry]
"""
import json
import math
import os
import sys

from shapely.geometry import shape
from shapely.ops import transform

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry" in sys.argv

# Long and thin above this, a basin below it. The data splits 28.0 / 5.0.
THIN_MIN = 15.0
KX = 111320 * math.cos(math.radians(30.286))


def main():
    path = os.path.join(DATA, "ground.geojson")
    gj = json.load(open(path, encoding="utf-8"))
    creeks = ponds = 0
    for f in gj["features"]:
        p = f["properties"]
        if p.get("s") not in ("water", "creek", "pond"):
            continue
        g = transform(lambda x, y, z=None: (x * KX, y * 111320), shape(f["geometry"]))
        if not g.is_valid:
            g = g.buffer(0)
        if g.area <= 0:
            continue
        thin = g.length ** 2 / (4 * math.pi * g.area)
        if thin >= THIN_MIN:
            p["s"] = "creek"
            creeks += 1
        else:
            # A pond keeps reading as still water; it just stops being lake-blue.
            p["s"] = "pond"
            ponds += 1
    print("creek reaches: %d   ponds: %d" % (creeks, ponds))
    if not DRY:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(gj, fh, separators=(",", ":"))
        print("  written")


main()
