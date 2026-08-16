# -*- coding: utf-8 -*-
"""The CAMPUS facade palette, computed in the bake instead of the browser.

WHY THIS EXISTS. `js/facades.js`'s `quantiseFacades` elects the fourteen most
populous window tones across the WHOLE city and stamps a pattern id on every
building at runtime. A vector tile cannot be mutated after it is built, so
buildings cannot move onto tiles until that election happens offline. It is the
last thing standing between this scene and `data/tiles/buildings.pmtiles`, and
it also blocks the 7,511 low-rise outer-ring features, which snap to this same
campus palette (see scripts/bake_outer_facades.py, which ported the TOWER half).

Measured, the JS pass costs 14 ms and buildings are 1.41 MB of a 9.74 MB
payload, so this is not a speed job. It is the thing that makes detail cheap
later.

THE HARD PART IS NOT THE ALGORITHM, IT IS THE INPUT. `quantiseFacades` runs in
js/app.js's loadScene AFTER two passes that change what it sees, so this has to
reproduce the whole assembly or the election is computed over a different city:

  1. `data/snapshots/<date>/buildings.detailed.geojson`
  2. `mergeCapitolScene()` patches 12 existing buildings from
     `data/capitol_overrides.json` -- every key except `was_height`, so it can
     rewrite `wd`, `final_height` and `building_class` -- then appends the 604
     features of `data/capitol.geojson`, then registers FACADE_PROTECTED from
     `data/capitol_parts.geojson`'s `facade_protect`.
  3. `applyUnion24()` rewrites 'Union on 24th': not only its footprint but its
     `final_height` AND its `wd`/`wg`/`wn`. It is one building out of 3,000 and
     it changes both a colour going into the election and a family coming out.

STAMPED AS `fb`, AN INERT ORDINAL, NOT AS `wp`. This is the trap the outer-ring
port hit first and documented, and it is a live hazard rather than a style
point: `wp` IS READ BY THE RENDERER through
`['coalesce', ['get','wp'], 'mh00']`, so a baked `wp` naming an atlas image that
nothing has registered makes MapLibre paint that building TRANSPARENT. A
scheduled data build could re-tile from this within the hour. Nothing reads
`fb`, so this stamp changes not one pixel until the browser side deliberately
picks it up.

EVERY ARITHMETIC DETAIL IS TRANSCRIBED, not reimplemented, including:
  - the coarse key's exact floor() boundaries
  - that the group means used for the nearest-survivor fold are FLOATS, while
    only the palette output is rounded to hex
  - that `sort` and the tie-break in the fold both take the FIRST minimum, which
    Python's stable `sorted` and a strict `<` reproduce
  - that group order is first-seen order, which a JS Map and a Python dict share

`scripts/verify/facade-parity.mjs` checks this against the REAL browser function
on a live page rather than against a second reading of the source. That is the
whole point of the exercise; a port that agrees with my own understanding of the
algorithm proves nothing.

Idempotent: recomputes from `wd` every run.

Usage:  python scripts/bake_facades.py [--check]
"""
import copy
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT_PALETTE = os.path.join(DATA, "facade_palette.json")

TARGET_BUCKETS = 14        # js/facades.js:31
CHECK = "--check" in sys.argv

# js/union24.js — the one building whose colours are rewritten before the
# election. Kept here rather than read from the JS because this is a bake and
# the JS is not importable; if U24 changes there it must change here, which is
# what the parity harness is for.
U24_MATCH = "Union on 24th"
U24 = {"wd": "#6f7172", "wg": "#7c7a74", "wn": "#23262e", "final_height": 94.4}

# js/facades.js familyFor() -- COPIED FROM THE REGEXES, character for character.
#
# The first cut of this file paraphrased them into two tuples of substrings and
# lower-cased the class before testing, and the parity harness convicted every
# one of those liberties:
#   * `apartments` does not match a class of `apartment`, which is the string
#     that is actually in the data -- the JS pattern is `apartment`, matching
#     both.  `house` and `religious` are in no JS list at all; `condo`,
#     `kindergarten`, `chapel`, `cathedral`, `synagogue`, `mosque`, `temple`,
#     `clinic`, `public`, `train_station`, `transportation`, `industrial`,
#     `manufacture`, `warehouse`, `utility` and `service` were all missing.
#   * AND THE LOWER-CASING WAS A DIVERGENCE OF ITS OWN.  `familyFor` tests the
#     RAW `building_class`, so a capitalised class does not match in the
#     browser -- and a port that helpfully lower-cases it would classify a
#     building the renderer classifies differently.  Faithful beats correct
#     here: if the case-sensitivity is wrong it is wrong in js/facades.js, and
#     fixing it there is a separate, visible change.
GARAGE = re.compile(r"parking|garage|carport")
STADIUM = re.compile(r"stadium|arena|sports_centre|grandstand")
RESIDENTIAL = re.compile(r"apartment|dormitory|residential|hotel|condo")
PUNCHED = re.compile("|".join([
    "university", "college", "school", "kindergarten",
    "church", "chapel", "cathedral", "synagogue", "mosque", "temple",
    "hospital", "clinic", "civic", "public", "government",
    "library", "museum", "train_station", "transportation",
    "industrial", "manufacture", "warehouse", "utility", "service",
]))


def hex_to_rgb(h):
    h = h.replace("#", "")
    return [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]


def rgb_to_hex(r, g, b):
    c = lambda n: "%02x" % max(0, min(255, int(_js_round(n))))
    return "#" + c(r) + c(g) + c(b)


def _js_round(n):
    """JavaScript Math.round: halves go UP, including negative halves.

    Python's round() is banker's rounding and would disagree on any mean that
    lands exactly on .5 — which over 3,000 buildings averaged into 14 buckets is
    not a hypothetical.
    """
    return math.floor(n + 0.5)


def rgb_to_hsl(r, g, b):
    r /= 255.0
    g /= 255.0
    b /= 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, l
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d) + (6 if g < b else 0)
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h / 6, s, l


def dist2(a, b):
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db


def coarse_key(rgb):
    h, s, l = rgb_to_hsl(rgb[0], rgb[1], rgb[2])
    if s < 0.10:
        return "n%d" % math.floor(l * 5)
    return "%d-%d-%d" % (math.floor(h * 12), math.floor(l * 5), 0 if s < 0.22 else 1)


def family_for(p):
    cls = p.get("building_class") or ""
    if GARAGE.search(cls):
        return "dk"
    if STADIUM.search(cls):
        return "st"
    h = p.get("final_height") or 0
    if h < 5:
        return "lo"
    if h < 12:
        return "mr"
    if h < 26:
        return "mh"
    # ORDER MATTERS: a university dormitory matches both lists and is a
    # dormitory first. Same as the JS.
    if RESIDENTIAL.search(cls):
        return "tr"
    if PUNCHED.search(cls):
        return "mh" if h < 45 else "tr"
    return "tg"


# ---------------------------------------------------------------- assembly --
def snapshot_date():
    """`manifest.latest`, which is what js/app.js:209 loads.

    Reading the directory and taking the last name sorted is NOT the same
    question and only happens to agree today. `data/snapshots/` keeps seven
    dated directories and the manifest is what decides which of them is the
    city; a snapshot dropped in out of order, or a `latest` deliberately
    pinned behind the newest build, and the bake would elect a palette for a
    city nobody is looking at. The directory listing stays as the fallback for
    a checkout with no manifest.
    """
    mf = os.path.join(DATA, "manifest.json")
    if os.path.exists(mf):
        m = json.load(open(mf, encoding="utf-8"))
        if m.get("latest"):
            return m["latest"]
        if m.get("snapshots"):
            return m["snapshots"][-1]
    snaps = sorted(d for d in os.listdir(os.path.join(DATA, "snapshots"))
                   if os.path.isdir(os.path.join(DATA, "snapshots", d)))
    return snaps[-1]


FLOODWALL_RE = re.compile(r"floodWall\s*:\s*'(#[0-9a-fA-F]{6})'")


def capitol_flood_wall():
    """`CAPITOL.floodWall` from js/capitol.js, or die.

    A default here would be the whole defect wearing a helmet: the value would
    drift out of the JS and this bake would keep producing a palette that
    matched nothing, silently, which is how the shipped file came to disagree
    with the browser in the first place.
    """
    js = open(os.path.join(ROOT, "js", "capitol.js"), encoding="utf-8").read()
    m = FLOODWALL_RE.search(js)
    if not m:
        raise SystemExit(
            "bake_facades: could not find `floodWall: '#rrggbb'` in js/capitol.js. "
            "The Capitol's floodlit night wall is applied over the protected "
            "facade tone at js/capitol.js:180-182 and this bake must transcribe "
            "it. If the constant was renamed or moved, update FLOODWALL_RE.")
    return m.group(1)


def load_scene():
    """Rebuild exactly the feature list quantiseFacades is handed in the browser."""
    date = snapshot_date()
    path = os.path.join(DATA, "snapshots", date, "buildings.detailed.geojson")
    buildings = json.load(open(path, encoding="utf-8"))["features"]

    # 2a. capitol overrides, applied by id, every key but was_height
    ov = json.load(open(os.path.join(DATA, "capitol_overrides.json"), encoding="utf-8"))
    patched = 0
    for f in buildings:
        o = ov.get((f.get("properties") or {}).get("id"))
        if not o:
            continue
        for k, v in o.items():
            if k != "was_height":
                f["properties"][k] = v
        patched += 1

    # 2b. the Capitol Complex, appended
    cap = json.load(open(os.path.join(DATA, "capitol.geojson"), encoding="utf-8"))
    buildings.extend(cap.get("features", []))

    # 2c. the protected tones, AND THE FLOODLIGHT THE BROWSER PAINTS OVER THEM.
    #
    # THIS IS THE BUG NB6 WAS REALLY ABOUT, and it is worth spelling out because
    # reading either file alone makes the other one look correct.
    # `data/capitol_parts.geojson` says the protected wall tone's night colour is
    # `#1f1b23` -- unlit granite. `js/capitol.js:180-182` then OVERWRITES that on
    # every one of those specs with `CAPITOL.floodWall` (`#d38e5e`, the floodlit
    # granite) BEFORE it registers them as `window.FACADE_PROTECTED`, and that
    # override is deliberate and argued for at js/capitol.js:107-121: the
    # floodlit Capitol is "the only lit thing in Austin that actually looks lit".
    # So the list `quantiseFacades` actually elects over is the file's list with
    # `wn` replaced. Reading `facade_protect` raw, as this bake did until now,
    # transcribes a scene the browser never sees, and the one palette entry that
    # comes out wrong is the Texas Capitol's walls at night.
    #
    # Parsed out of the JS rather than copied, so a taste edit to `floodWall`
    # cannot leave this file silently one shade behind -- and it FAILS LOUDLY if
    # the constant moves, because a bake that quietly falls back to the dark
    # value is exactly the failure being fixed.
    capparts = json.load(open(os.path.join(DATA, "capitol_parts.geojson"), encoding="utf-8"))
    protected = copy.deepcopy(capparts.get("facade_protect") or [])
    flood = capitol_flood_wall()
    for spec in protected:
        spec["wn"] = flood

    # 3. Union on 24th
    u24 = 0
    for f in buildings:
        if (f.get("properties") or {}).get("name") == U24_MATCH:
            f["properties"].update(U24)
            u24 += 1
            break

    return date, buildings, protected, {"patched": patched, "capitol": len(cap.get("features", [])),
                                        "union24": u24}


# ------------------------------------------------------------- the election --
def quantise(features, protected):
    """A transcription of window.quantiseFacades. Returns (palette, index, stamps)."""
    # 1. coarse keys -> groups, in FIRST-SEEN order (a JS Map and a dict agree)
    groups = {}
    for f in features:
        p = f.get("properties") or {}
        if not p.get("wd"):
            continue
        rgb = hex_to_rgb(p["wd"])
        key = coarse_key(rgb)
        g = groups.get(key)
        if g is None:
            g = {"n": 0, "wd": [0.0, 0.0, 0.0], "wg": [0.0, 0.0, 0.0], "wn": [0.0, 0.0, 0.0]}
            groups[key] = g
        g["n"] += 1
        for arr, hexv in (("wd", p["wd"]), ("wg", p.get("wg") or p["wd"]),
                          ("wn", p.get("wn") or p["wd"])):
            c = hex_to_rgb(hexv)
            g[arr][0] += c[0]
            g[arr][1] += c[1]
            g[arr][2] += c[2]

    # 2. mean each, most populous first. Python's sorted is stable and JS's sort
    #    has been stable since ES2019, so ties keep first-seen order in both.
    allg = [{"key": k, "n": g["n"],
             "wd": [v / g["n"] for v in g["wd"]],
             "wg": [v / g["n"] for v in g["wg"]],
             "wn": [v / g["n"] for v in g["wn"]]}
            for k, g in groups.items()]
    allg.sort(key=lambda g: -g["n"])

    # 2b. protected tones survive at their EXACT colour, not their group's mean
    prot_buckets, prot_keys = [], {}
    for spec in protected:
        if not spec or not spec.get("wd"):
            continue
        rgb = hex_to_rgb(spec["wd"])
        key = coarse_key(rgb)
        if key in prot_keys:
            continue
        prot_keys[key] = len(prot_buckets)
        prot_buckets.append({"key": key, "n": 0, "wd": rgb,
                             "wg": hex_to_rgb(spec.get("wg") or spec["wd"]),
                             "wn": hex_to_rgb(spec.get("wn") or spec["wd"])})

    kept = prot_buckets + [g for g in allg if g["key"] not in prot_keys][
        :max(0, TARGET_BUCKETS - len(prot_buckets))]
    index = {k["key"]: i for i, k in enumerate(kept)}

    # 3. fold the tail into its nearest survivor. FIRST minimum on a tie, which
    #    a strict `<` gives and `<=` would not.
    for g in allg:
        if g["key"] in index:
            continue
        best, best_d = 0, float("inf")
        for i, k in enumerate(kept):
            d = dist2(g["wd"], k["wd"])
            if d < best_d:
                best_d, best = d, i
        index[g["key"]] = best

    palette = [{"wd": rgb_to_hex(*k["wd"]), "wg": rgb_to_hex(*k["wg"]),
                "wn": rgb_to_hex(*k["wn"])} for k in kept]

    # 4. stamp. `rows` is ALIGNED WITH `features`, one entry each, None where the
    #    browser also stamps nothing (no `wd`). Position is the join key the
    #    parity harness uses for the 604 authored Capitol features, which carry
    #    no `id` at all, so a dict keyed on id could not check them — and it
    #    would silently drop one of any duplicate-id pair rather than report it.
    rows = []
    combos = []
    for f in features:
        p = f.get("properties") or {}
        if not p.get("wd"):
            rows.append(None)
            continue
        b = index.get(coarse_key(hex_to_rgb(p["wd"])), 0)
        fam = family_for(p)
        wp = fam + str(b).zfill(2)
        rows.append({"fb": b, "wf": fam, "wp": wp})
        if wp not in combos:
            combos.append(wp)
    return palette, index, rows, combos


def main():
    date, feats, protected, asm = load_scene()
    palette, index, rows, combos = quantise(feats, protected)
    stamped = sum(1 for r in rows if r)

    out = {
        "snapshot": date,
        "target_buckets": TARGET_BUCKETS,
        "protected": protected,
        "palette": palette,
        "assembly": asm,
        "features_stamped": stamped,
        "combos": sorted(combos),
    }
    if CHECK:
        print(json.dumps({k: v for k, v in out.items() if k != "palette"}, indent=2))
        print("palette:", json.dumps(palette, indent=2))
        return

    with open(OUT_PALETTE, "w", encoding="utf-8") as fh:
        json.dump({"snapshot": date, "palette": palette,
                   "buckets": {k: v for k, v in sorted(index.items())}},
                  fh, separators=(",", ":"))
    print(json.dumps({
        "snapshot": date,
        "assembly": asm,
        "groups": len(index),
        "palette_buckets": len(palette),
        "features_stamped": stamped,
        "combos": len(combos),
        "palette_kb": round(os.path.getsize(OUT_PALETTE) / 1024, 1),
        "note": "js/facades.js adopts this when its snapshot matches manifest.latest, "
                "and elects in the browser when it does not - so THIS FILE MUST BE "
                "RE-BAKED WHENEVER THE SNAPSHOT ROLLS or the switch goes quietly "
                "inert. Prove it with scripts/verify/facade-parity.mjs then "
                "scripts/verify/facade_parity.py.",
    }, indent=2))


if __name__ == "__main__":
    main()
