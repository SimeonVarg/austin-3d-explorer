# -*- coding: utf-8 -*-
"""Compare the Python tower bucketing against what the browser actually did.

Reads scripts/verify/out/outer-facade-browser.json, written by
scripts/verify/outer-facade-parity.mjs from a live run of
`window.quantiseOuterFacades`.

THE TEST IS THE PARTITION. The two sides cannot agree on the bucket NAME — the
browser's `tg<n>` counts from the end of the campus palette, which is the whole
reason the assignment is being moved into the bake — so what is checked is:

  1. every tower the browser stamped, Python also stamps;
  2. two towers share a bucket in Python if and only if they share one in the
     browser (a bijection between the two labellings, checked both ways, so a
     Python bucket that merges two browser buckets fails and so does the split);
  3. the centroid colours agree to within a rounding step.

Point 2 both ways is the part worth having. A one-way check passes happily when
Python collapses ten buckets into three.

Usage:  python scripts/verify/outer_facade_parity.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from bake_outer_facades import (  # noqa: E402
    cluster_colours, bucket_of, hex_to_rgb, to_hex, TOWER_BUCKETS)

BROWSER = os.path.join(HERE, "out", "outer-facade-browser.json")


def main():
    if not os.path.exists(BROWSER):
        print("*FAIL — %s is missing. Run outer-facade-parity.mjs first."
              % os.path.relpath(BROWSER, ROOT))
        return 1
    b = json.load(open(BROWSER, encoding="utf-8"))
    wd, browser_wp = b["wd"], b["wp"]
    if len(wd) != len(browser_wp):
        print("*FAIL — malformed capture")
        return 1

    cent = cluster_colours(wd, TOWER_BUCKETS)
    py_wp = ["tb%02d" % bucket_of(h, cent) for h in wd]

    fails = []
    if any(x is None for x in browser_wp):
        fails.append("browser left %d towers unstamped"
                     % sum(1 for x in browser_wp if x is None))

    # A bijection between the two labellings, checked in both directions.
    fwd, rev = {}, {}
    for i, (p, q) in enumerate(zip(py_wp, browser_wp)):
        if q is None:
            continue
        if fwd.setdefault(p, q) != q:
            fails.append("python %s maps to both %s and %s (tower %d)"
                         % (p, fwd[p], q, i))
        if rev.setdefault(q, p) != p:
            fails.append("browser %s maps to both %s and %s (tower %d)"
                         % (q, rev[q], p, i))

    # Centroids: group means on each side, matched through the bijection.
    def means(labels):
        acc = {}
        for lab, h in zip(labels, wd):
            r, g, bl = hex_to_rgb(h)
            a = acc.setdefault(lab, [0, 0, 0, 0])
            a[0] += r; a[1] += g; a[2] += bl; a[3] += 1
        return {k: to_hex([v[0] / v[3], v[1] / v[3], v[2] / v[3]])
                for k, v in acc.items()}

    pm, bm = means(py_wp), means(browser_wp)
    for p, q in fwd.items():
        if pm[p] != bm[q]:
            fails.append("centroid mismatch %s %s vs %s %s" % (p, pm[p], q, bm[q]))

    sizes = {}
    for p in py_wp:
        sizes[p] = sizes.get(p, 0) + 1

    print("towers                 %d" % len(wd))
    print("python buckets         %d" % len(sizes))
    print("browser buckets        %d" % len(rev))
    print("sizes                  " + "  ".join(
        "%s=%d" % (k, sizes[k]) for k in sorted(sizes)))
    print("bucket map             " + "  ".join(
        "%s->%s" % (k, fwd[k]) for k in sorted(fwd)))
    print("")
    if fails:
        print("*FAIL — %d finding(s)" % len(fails))
        for f in fails[:20]:
            print("   " + f)
        return 1
    print("PASS — the bake partitions the towers exactly as the browser does, "
          "and the group centroids agree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
