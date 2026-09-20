#!/usr/bin/env python3
"""Measure the night reference PHOTOGRAPHS the same way night-compare.mjs measures our frames.

Why this exists
---------------
docs/night-reference-package.md §7 said, in its own words, "Nobody measured the web
photos"  — and docs/night-implementation-plan.md §7.2 then gated A1 on a number
("unlit wall / horizon sky <= 0.5 at blue hour; water <= 1") that came from looking
at those same unmeasured, graded photographs. A threshold our renders are failed
against every round should be a measurement of something, so this measures it.

What it measures, and what it cannot
------------------------------------
For each photograph in night-ref-regions.json it takes the MEDIAN LINEAR relative
luminance (sRGB decoded, Rec.709 weights) inside each named rectangle and divides
them -- exactly the quantity scripts/verify/night-compare.mjs calls `wall/sky`,
so the two sides of A1 are the same unit.

A RATIO inside one frame is the only thing a web photograph can honestly give.
The camera chose an exposure to make the scene legible; the two regions moved
together under that choice, so their ratio survives it. The ABSOLUTE level did
not survive it, and no absolute sRGB code from a web photograph may be quoted --
that is what §5's luminance ladder is for, and §5's ladder comes off the owner's
phone frames at known settings, not off these.

--sun: what regime a photograph ACTUALLY is
-------------------------------------------
Every regime tag in this corpus was a word somebody wrote down -- "blue hour",
"twilight", "full night" -- and the routes file then binds a photograph to a row
defined by a SUN ELEVATION. Those are not the same kind of thing, and on
2026-09-20 they disagreed by up to 24 degrees. `--sun` computes the solar
elevation at Austin from each photograph's own stated capture time (NOAA's
algorithm, US DST, +/- 0.5 deg against a known sunset) and prints it beside the
word and beside the row it is bound to. A photograph with no stated time is
printed as such and stays a judgement call; a photograph WITH one is no longer
a matter of opinion.

Usage
-----
  python scripts/verify/night-refmeasure.py                 # measure, print a table
  python scripts/verify/night-refmeasure.py --sun           # sun elevation vs tag vs binding
  python scripts/verify/night-refmeasure.py --overlay DIR   # ALSO write <id>.jpg with the
                                                            # rectangles drawn, so the next
                                                            # rectangle is read off the frame
  python scripts/verify/night-refmeasure.py --json OUT.json

Needs Pillow and numpy. The photographs are NOT in this repo: they live in
austin-reference-images/_night/ (git-ignored, third party, never committed).
"""
import argparse
import datetime
import json
import math
import os
import re
import sys

try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError:                                            # pragma: no cover
    sys.exit("night-refmeasure needs Pillow and numpy: pip install pillow numpy")

HERE = os.path.dirname(os.path.abspath(__file__))          # scripts/verify
REPO = os.path.dirname(os.path.dirname(HERE))              # the worktree root
REGIONS = os.path.join(HERE, "night-ref-regions.json")
# The ratios A1 is written as. Anything else named in a photo's regions is
# measured and printed but not divided (same rule as night-compare.mjs).
RATIOS = [("wall", "sky"), ("water", "sky"), ("wall", "ground")]


# ── Sun elevation at Austin, from a photograph's own stated capture time ─────
LAT, LON = 30.2672, -97.7431            # Congress Ave at the river; the corpus is all within 3 km
SOURCES = ["downtown", "landmarks-street", "westcampus-campus"]


def _us_dst(dt):
    """US rule since 2007: 2nd Sunday March 02:00 to 1st Sunday November 02:00."""
    d = datetime.date(dt.year, 3, 1)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7)
    start = datetime.datetime.combine(d + datetime.timedelta(days=7), datetime.time(2))
    d = datetime.date(dt.year, 11, 1)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7)
    return start <= dt < datetime.datetime.combine(d, datetime.time(2))


def sun_elevation(dt_local, lat=LAT, lon=LON):
    """NOAA solar position. Checked against Austin sunset 2012-07-31 20:27 CDT: -1.23 deg
    here against the -0.83 deg of refracted-upper-limb sunset, i.e. right to ~0.4 deg."""
    ut = dt_local + datetime.timedelta(hours=5 if _us_dst(dt_local) else 6)
    y, m = ut.year, ut.month
    if m <= 2:
        y -= 1
        m += 12
    A = y // 100
    B = 2 - A + A // 4
    jd = (math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + ut.day + B - 1524.5
          + (ut.hour + ut.minute / 60 + ut.second / 3600) / 24.0)
    T = (jd - 2451545.0) / 36525.0
    L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = math.radians(M)
    C = (math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
         + math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + math.sin(3 * Mr) * 0.000289)
    omega = 125.04 - 1934.136 * T
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(math.radians(omega))
    eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
           + 0.00256 * math.cos(math.radians(omega)))
    epsr, lamr = math.radians(eps), math.radians(lam)
    decl = math.asin(math.sin(epsr) * math.sin(lamr))
    y2 = math.tan(epsr / 2) ** 2
    L0r = math.radians(L0)
    eq = 4 * math.degrees(y2 * math.sin(2 * L0r) - 2 * e * math.sin(Mr)
                          + 4 * e * y2 * math.sin(Mr) * math.cos(2 * L0r)
                          - 0.5 * y2 * y2 * math.sin(4 * L0r) - 1.25 * e * e * math.sin(2 * Mr))
    ha = ((ut.hour * 60 + ut.minute + ut.second / 60) + eq + 4 * lon) / 4 - 180
    if ha < -180:
        ha += 360
    zen = math.acos(math.sin(math.radians(lat)) * math.sin(decl)
                    + math.cos(math.radians(lat)) * math.cos(decl) * math.cos(math.radians(ha)))
    return 90 - math.degrees(zen)


def parse_when(s):
    """'2012-10-10 03:42', '2009-01-23, 22:59', '2019-08-11, ~06:06 (...)' -> datetime.
    A bare date carries no hour and returns None: the tag stays a judgement call."""
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T,]+~?(\d{1,2}):(\d{2})(?::(\d{2}))?", str(s).strip())
    if not m:
        return None
    g = [int(x) if x else 0 for x in m.groups()]
    return datetime.datetime(g[0], g[1], g[2], g[3], g[4], g[5])


# What sun elevation each regime NAME actually means, as a band. A photograph's word
# ("blue hour") and a routes-file row (sun -5.8 deg) are different kinds of thing; this
# is the only place they are made comparable. Bands follow §3 and the §5 ladder of
# docs/night-reference-package.md; `night` is open-ended downward because every sky past
# about -19 deg is the same sky and the row's -40 deg is a stand-in, not a requirement.
BANDS = {"day": (10, 90), "golden": (-2, 10), "blue": (-9, -2),
         "twilight": (-14, -9), "early": (-19, -13), "night": (-90, -19)}
# The words the corpus uses, mapped to the band each one claims.
TAG_BAND = [("deep night", "night"), ("full night", "night"), ("early night", "early"),
            ("predawn", "night"), ("twilight", "twilight"), ("blue hour", "blue"),
            ("dusk", "blue"), ("golden", "golden"), ("day", "day")]


def band_of(elev):
    for g, (lo, hi) in BANDS.items():
        if lo <= elev < hi:
            return g
    return "day" if elev >= 10 else "night"


def claimed_band(tag):
    """The FIRST regime word in a free-text tag. 'blue hour / early night' claims blue."""
    t = (tag or "").lower()
    hits = [(t.find(w), g) for w, g in TAG_BAND if t.find(w) >= 0]
    return min(hits)[1] if hits else None


def sun_report(root, routes_file):
    """Every photograph's stated time -> sun elevation, beside its word and its binding."""
    bound = {}                                    # file -> [(route, regime, regimeSunElev)]
    try:
        cfg = json.load(open(routes_file, encoding="utf-8"))
        regs = cfg.get("regimes", {})
        for rt in cfg.get("routes", []):
            for g, f in (rt.get("refs") or {}).items():
                bound.setdefault(f.lstrip("/"), []).append(
                    (rt["id"], g, (regs.get(g) or {}).get("sunElev")))
    except Exception as e:
        print("  (could not read %s: %s)" % (routes_file, e))
    rows = []
    for sub in SOURCES:
        p = os.path.join(root, "_night", sub, "sources.json")
        if not os.path.exists(p):
            continue
        for it in json.load(open(p, encoding="utf-8")):
            dt = parse_when(it.get("date"))
            elev = round(sun_elevation(dt), 1) if dt else None
            key = "_night/%s/%s" % (sub, it.get("file"))
            rows.append({"file": key, "date": it.get("date"), "sunElev": elev,
                         "taggedRegime": it.get("regime"), "boundTo": bound.get(key, [])})
    return rows


def linear_Y(rgb8):
    """sRGB 8-bit -> linear relative luminance, per pixel. The unit every ratio uses."""
    c = rgb8.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def measure(img, regions):
    # Crop FIRST. One of these photographs is a 13045x5767 panorama and decoding the
    # whole thing to float64 wants 1.7 GB; the rectangle wants a few MB.
    img = img.convert("RGB")
    W, H = img.size
    out = {}
    for name, box in regions.items():
        x0, y0, x1, y1 = box
        cx0, cy0 = int(x0 * W), int(y0 * H)
        cx1, cy1 = max(cx0 + 1, int(x1 * W)), max(cy0 + 1, int(y1 * H))
        srgb = np.asarray(img.crop((cx0, cy0, cx1, cy1))).reshape(-1, 3)
        y = linear_Y(srgb)
        out[name] = {
            "Ymedian": float(np.median(y)),
            "Ymean": float(y.mean()),
            "srgbMedian": [int(v) for v in np.median(srgb, axis=0)],
            "px": int(y.size),
            "frac": float(y.size) / (H * W),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", default=REGIONS)
    ap.add_argument("--overlay", default=None, help="write <id>.jpg with the rectangles drawn")
    ap.add_argument("--json", default=None)
    ap.add_argument("--sun", action="store_true", help="sun elevation from each photo's stated time")
    ap.add_argument("--routes", default=os.path.join(HERE, "night-routes.json"))
    args = ap.parse_args()

    cfg = json.load(open(args.regions, encoding="utf-8"))
    root = os.path.abspath(os.path.join(REPO, cfg.get("refRoot", "../austin-reference-images")))

    if args.sun:
        rows = sun_report(root, args.routes)
        print("sun elevation at Austin from each photograph's OWN stated capture time")
        print("(no time stated = the tag is still a judgement call; see the file's notes)\n")
        print("%-8s  %-16s  %-34s  %s" % ("sun", "stated", "tagged", "bound to"))
        for r in sorted(rows, key=lambda r: (r["sunElev"] is None, -(r["sunElev"] or 0))):
            b = ", ".join("%s/%s (%s deg)" % (x[0], x[1], x[2]) for x in r["boundTo"]) or "-"
            print("%-8s  %-16s  %-34s  %s" % (
                ("%+.1f" % r["sunElev"]) if r["sunElev"] is not None else "  -",
                r["date"] or "-", str(r["taggedRegime"])[:34], b))
            print("          %s" % r["file"])
        misbound, mistagged = [], []
        for r in rows:
            if r["sunElev"] is None:
                continue
            r["actualBand"] = band_of(r["sunElev"])
            for rt, g, _e in r["boundTo"]:
                if g in BANDS and g != r["actualBand"]:
                    misbound.append((r, rt, g))
            cb = claimed_band(r["taggedRegime"])
            if cb and cb != r["actualBand"]:
                mistagged.append((r, cb))
        if misbound:
            print("\nBOUND TO A ROW ITS OWN CLOCK PUTS IT OUTSIDE OF:")
            for r, rt, g in misbound:
                print("  %+.1f deg (%s)  %s\n      -> %s/%s, which is the %s band %s"
                      % (r["sunElev"], r["actualBand"], r["file"], rt, g, g, BANDS[g]))
        if mistagged:
            print("\nTHE WORD AND THE CLOCK DISAGREE (one of the two is wrong; say which):")
            for r, cb in mistagged:
                print("  %+.1f deg = %-8s but tagged %-10s  %s"
                      % (r["sunElev"], r["actualBand"], cb, r["file"]))
        notime = [r for r in rows if r["sunElev"] is None]
        print("\n%d of %d photographs state no capture time; their regime is a judgement call."
              % (len(notime), len(rows)))
        if args.json:
            json.dump(rows, open(args.json, "w", encoding="utf-8"), indent=1)
            print("\nwrote " + args.json)
        return
    rows, results, missing = [], [], []
    for p in cfg["photos"]:
        path = os.path.join(root, p["file"].lstrip("/"))
        if not os.path.exists(path):
            missing.append(p["file"])
            continue
        img = Image.open(path)
        m = measure(img, p["regions"])
        ratios = {}
        for num, den in RATIOS:
            if num in m and den in m and m[den]["Ymedian"] > 0:
                ratios[f"{num}/{den}"] = round(m[num]["Ymedian"] / m[den]["Ymedian"], 3)
        results.append({"id": p["id"], "file": p["file"], "regime": p.get("regime"),
                        "license": p.get("license"), "size": list(img.size),
                        "regions": m, "ratios": ratios, "note": p.get("note")})
        rows.append((p["id"], p.get("regime", ""),
                     " ".join(f"{k} {v}" for k, v in ratios.items()) or "-",
                     " ".join(f"{k} Y {m[k]['Ymedian']:.4f}" for k in sorted(m))))
        if args.overlay:
            os.makedirs(args.overlay, exist_ok=True)
            W, H = img.size
            sc = 1100.0 / W
            o = img.convert("RGB").resize((1100, int(H * sc)))
            d = ImageDraw.Draw(o)
            for name, (x0, y0, x1, y1) in p["regions"].items():
                d.rectangle([x0 * o.width, y0 * o.height, x1 * o.width, y1 * o.height],
                            outline=(255, 0, 0), width=3)
                d.text((x0 * o.width + 6, y0 * o.height + 4), name, fill=(255, 255, 0))
            o.save(os.path.join(args.overlay, p["id"] + ".jpg"), quality=82)

    w = max([len(r[0]) for r in rows] + [8])
    print(f"{'id'.ljust(w)}  {'regime'.ljust(22)}  ratios (median linear Y)")
    for r in rows:
        print(f"{r[0].ljust(w)}  {str(r[1])[:22].ljust(22)}  {r[2]}")
    print()
    for r in rows:
        print(f"  {r[0].ljust(w)}  {r[3]}")
    if missing:
        print("\nNOT ON DISK (austin-reference-images is local and git-ignored):")
        for f in missing:
            print("  " + f)
    if args.json:
        json.dump({"refRoot": root, "photos": results, "missing": missing},
                  open(args.json, "w", encoding="utf-8"), indent=1)
        print("\nwrote " + args.json)


if __name__ == "__main__":
    main()
