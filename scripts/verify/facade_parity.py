# -*- coding: utf-8 -*-
"""Compare the Python campus facade election against what the browser did.

Reads scripts/verify/out/facade-browser.json, written by
scripts/verify/facade-parity.mjs from a live run of the REAL
`mergeCapitolScene` / `applyUnion24` / `quantiseFacades`.

WHY THIS IS FOUR CHECKS AND NOT ONE. The outer-ring port could only compare
the PARTITION, because the browser names a tower bucket `tg<n>` where n is an
offset into the campus palette and the two sides cannot agree on the string by
construction. Here there is no offset: the campus palette IS the whole palette
and the ordinal is the palette index, so this can demand something much
stronger than a bijection -- the same ordinal, the same family, the same
fourteen hex triples, on the same feature. Anything weaker would pass a build
that renders every wall the wrong colour in a self-consistent way.

  1. ASSEMBLY COUNTS   12 patched / 604 appended / 1 Union24, and the total.
  2. ASSEMBLY VALUES   `wd` `wg` `wn` `building_class` `final_height` for all
                       3,057 features, positionally. This is the check the
                       counts cannot make: the two sides agreeing that 12
                       buildings were patched says nothing about whether they
                       were patched to the same colours, and every one of those
                       five fields is an INPUT to the election or to familyFor.
  3. PALETTE           the fourteen {wd,wg,wn} hex triples, in order, exact.
  4. STAMPS            `wp` and `wf` per feature, exact string equality, plus
                       the bijection both ways as a diagnostic so a failure
                       says whether the labelling is merely OFFSET or actually
                       DIFFERENT.

THE JOIN IS POSITIONAL, and it has to be. 604 of the 3,057 features are the
authored Capitol Complex and carry no `id`, so an id-keyed join would check
80% of the city and report a pass. Both sides build the array the same way --
snapshot order, then capitol.geojson appended -- and check 2 is what proves
that claim rather than assuming it.

Usage:  python scripts/verify/facade_parity.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from bake_facades import load_scene, quantise  # noqa: E402

BROWSER = os.path.join(HERE, "out", "facade-browser.json")
MAX_SHOWN = 12


def _num(x):
    """`final_height` crosses JSON as a float on one side and may be an int on
    the other; compare as numbers, and treat null/0 the same way `|| 0` does."""
    return float(x or 0)


def main():
    if not os.path.exists(BROWSER):
        print("*FAIL - %s is missing. Run facade-parity.mjs first."
              % os.path.relpath(BROWSER, ROOT).replace("\\", "/"))
        return 1
    b = json.load(open(BROWSER, encoding="utf-8"))
    brows = b["rows"]

    date, feats, protected, asm = load_scene()
    palette, index, rows, combos = quantise(feats, protected)

    fails = []

    # ---------------------------------------------------------- 1. assembly --
    if date != b["date"]:
        fails.append("snapshot date: python %s vs browser %s" % (date, b["date"]))
    if len(rows) != len(brows):
        fails.append("feature count: python %d vs browser %d" % (len(rows), len(brows)))
    for k in ("patched", "capitol", "union24"):
        if asm.get(k) != b["assembly"].get(k):
            fails.append("assembly.%s: python %s vs browser %s"
                         % (k, asm.get(k), b["assembly"].get(k)))

    n = min(len(rows), len(brows))

    # ---------------------------------------------- 2. the election's INPUTS --
    field_bad = {}
    for i in range(n):
        p = feats[i].get("properties") or {}
        q = brows[i]
        pairs = (
            ("id", None if p.get("id") is None else str(p["id"]), q["id"]),
            ("wd", p.get("wd") or None, q["wd"]),
            ("wg", p.get("wg") or None, q["wg"]),
            ("wn", p.get("wn") or None, q["wn"]),
            ("building_class", p.get("building_class") or None, q["bc"]),
        )
        for name, mine, theirs in pairs:
            if mine != theirs:
                field_bad.setdefault(name, []).append((i, mine, theirs))
        if _num(p.get("final_height")) != _num(q["fh"]):
            field_bad.setdefault("final_height", []).append(
                (i, p.get("final_height"), q["fh"]))
    for name, bad in sorted(field_bad.items()):
        fails.append("assembly value %s differs on %d features, e.g. %s"
                     % (name, len(bad), "; ".join(
                         "#%d python=%r browser=%r" % t for t in bad[:3])))

    # ----------------------------------------------------------- 3. palette --
    bp = b.get("palette") or []
    if len(bp) != len(palette):
        fails.append("palette length: python %d vs browser %d" % (len(palette), len(bp)))
    for i in range(min(len(bp), len(palette))):
        for k in ("wd", "wg", "wn"):
            if palette[i][k].lower() != str(bp[i].get(k, "")).lower():
                fails.append("palette[%d].%s: python %s vs browser %s"
                             % (i, k, palette[i][k], bp[i].get(k)))

    # ------------------------------------------------------------ 4. stamps --
    wp_bad, wf_bad, stamped_bad = [], [], []
    fwd, rev = {}, {}
    for i in range(n):
        mine, theirs = rows[i], brows[i]
        if (mine is None) != (theirs["wp"] is None):
            stamped_bad.append((i, mine and mine["wp"], theirs["wp"]))
            continue
        if mine is None:
            continue
        if mine["wp"] != theirs["wp"]:
            wp_bad.append((i, mine["wp"], theirs["wp"]))
        if mine["wf"] != theirs["wf"]:
            wf_bad.append((i, mine["wf"], theirs["wf"]))
        # Bucket-ordinal bijection, both directions, as a DIAGNOSTIC. If the
        # exact check above fails, this says which kind of failure it is: a
        # clean bijection means the two sides agree on the partition and
        # disagree only on the numbering (recoverable, an offset); a broken one
        # means a bucket was merged or split (a real algorithm difference).
        pb, bb = mine["wp"][2:], theirs["wp"][2:]
        if fwd.setdefault(pb, bb) != bb:
            fwd["__broken__"] = True
        if rev.setdefault(bb, pb) != pb:
            rev["__broken__"] = True

    if stamped_bad:
        fails.append("%d features where one side stamped and the other did not, e.g. %s"
                     % (len(stamped_bad), stamped_bad[:3]))
    if wf_bad:
        fails.append("family `wf` differs on %d features, e.g. %s"
                     % (len(wf_bad), "; ".join("#%d %s/%s" % t for t in wf_bad[:MAX_SHOWN])))
    if wp_bad:
        fails.append("pattern `wp` differs on %d features, e.g. %s"
                     % (len(wp_bad), "; ".join("#%d %s/%s" % t for t in wp_bad[:MAX_SHOWN])))

    py_combos = sorted(combos)
    br_combos = sorted({r["wp"] for r in brows if r["wp"]})
    if py_combos != br_combos:
        fails.append("combos differ: python-only %s  browser-only %s"
                     % (sorted(set(py_combos) - set(br_combos)),
                        sorted(set(br_combos) - set(py_combos))))

    # ------------------------------------------------------------- report ----
    stamped = sum(1 for r in rows if r)
    bij = "__broken__" not in fwd and "__broken__" not in rev
    print("snapshot               %s" % date)
    print("features               python %d   browser %d" % (len(rows), len(brows)))
    print("assembly               %s" % json.dumps(asm))
    print("stamped                python %d   browser %d"
          % (stamped, sum(1 for r in brows if r["wp"])))
    print("palette buckets        python %d   browser %d" % (len(palette), len(bp)))
    print("(family,bucket) combos python %d   browser %d" % (len(py_combos), len(br_combos)))
    print("bucket labelling       %s" % ("a bijection" if bij else "*** NOT a bijection"))
    print("wp exact matches       %d / %d" % (stamped - len(wp_bad), stamped))
    print("")
    if fails:
        print("*FAIL - %d finding(s)" % len(fails))
        for f in fails[:20]:
            print("   " + f)
        return 1
    print("PASS - the bake reproduces the browser's assembly feature-for-feature, "
          "elects the same %d buckets to the same hex, and stamps all %d buildings "
          "with the same (family, bucket)." % (len(palette), stamped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
