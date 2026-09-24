"""bake_finder_homes.py -- every home the apartment finder can rank.

Sole writer of data/finder/homes.json (CLAUDE.md rule 1). Read by js/finder.js
and by scripts/bake_finder_transit.py (which times the bus from the homes this
file marks `bus`).

WHERE THE HOMES COME FROM (three lists, joined here and nowhere else)
  1. The authored 3D models, data/apartments/index.json + one JSON each. The
     position is the area centroid of the model's own `footprint.ring`; name
     and address are the model's. Models that are not homes (libraries, halls
     of classrooms, the arena, a hotel) are listed in NOT_HOMES below.
  2. The walking router's homes, the `wc` table in data/walk_graph.json
     (scripts/bake_walk.py, from data/westcampus.geojson names and
     data/apartment-approaches.json). A home in this table is routed from its
     own mapped doors, so the finder keeps the router's name for it in `wc`.
     Its position is the mean of its doors ('main' doors when it has any).
  3. RIVERSIDE below: the four East Riverside student complexes researched on
     2026-09-23 (OSM landuse polygon centroids, Overpass base 2026-09-22;
     addresses from OSM; student evidence: UT's off-campus housing listings,
     by-the-bed leasing -- see docs/finder.md). They are outside the walking
     graph, so they are marked `bus` and timed by bake_finder_transit.py.

DEDUPE. Two rows are one home when their normalised names (or an alias) are
equal, or when they share a street address or stand within DEDUPE_M of each
other AND one normalised name contains the other ("26 West" / "26 West
Courtyard"). "Block on 25th East" and "Block on 25th West" stay two homes.
Every merge is printed so a wrong one is visible in the bake log.

AREA. The first rule in AREAS that matches wins. Every threshold is a line
there; the Guadalupe line is two points on the street's centreline.

Re-run (no network, no arguments):
    python scripts/bake_finder_homes.py
"""
import json
import math
import os
import re
import unicodedata

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "data", "finder", "homes.json")

# ── parameters ────────────────────────────────────────────────────────────────
DEDUPE_M = 40            # two rows this close with contained names are one home
COORD_DP = 6             # decimals kept on positions (~0.1 m)

# Authored models that are not somewhere a student lives (by file stem).
NOT_HOMES = {
    "battle-hall", "batts-hall", "benedict-hall", "mezes-hall", "welch-hall",
    "pcl", "texas-union", "moody-center", "the-otis-hotel",
}
# UT residence halls among the authored models: kept, labelled as dorms.
DORMS = {"kinsolving-dormitory", "jester-west-hall", "jester-east-hall", "san-jacinto-hall"}

# Guadalupe St centreline, two (lat, lon) points; linear between them.
GUADALUPE = ((30.2780, -97.74155), (30.2990, -97.74265))
MLK_LAT = 30.2818          # Martin Luther King Jr Blvd, the campus's south edge
DEAN_KEETON_LAT = 30.2895  # Dean Keeton St (26th), where North Campus starts
WEST_CAMPUS_NORTH_LAT = 30.2990   # 29th St and a little beyond


def west_of_guadalupe(lat, lon):
    (a_lat, a_lon), (b_lat, b_lon) = GUADALUPE
    t = (lat - a_lat) / (b_lat - a_lat)
    return lon < a_lon + t * (b_lon - a_lon)


AREAS = [
    ("East Riverside", lambda h: h["lat"] < 30.2560 and h["lon"] > -97.7400),
    ("Campus", lambda h: h["kind"] == "dorm"),
    ("West Campus", lambda h: west_of_guadalupe(h["lat"], h["lon"]) and MLK_LAT <= h["lat"] < WEST_CAMPUS_NORTH_LAT),
    ("Downtown", lambda h: h["lat"] < MLK_LAT),
    ("North Campus", lambda h: h["lat"] >= DEAN_KEETON_LAT),
    ("Campus", lambda h: True),
]
BUS_AREAS = {"East Riverside"}   # outside the walking graph: timed by transit

RIVERSIDE = [
    # (name, address, lat, lon, evidence) -- research/domain-riverside.md table 1
    ("Village at East Riverside", "1301 Crossing Pl", 30.23814, -97.71066,
     "listed as student housing on UT's off-campus housing site"),
    ("Estates at East Riverside", "1300 Crossing Pl", 30.23901, -97.71272,
     "UT off-campus housing listing mentions the UT shuttle"),
    ("Town Lake Student Apartments", "1109 S Pleasant Valley Rd", 30.24104, -97.71637,
     "leased by the room"),
    ("The Element Austin", "1500 Royal Crest Dr", 30.24033, -97.73069,
     "by-the-bed pricing"),
]


# ── helpers ───────────────────────────────────────────────────────────────────
def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return json.load(fh)


def dist_m(a, b):
    x = math.radians(b["lon"] - a["lon"]) * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    y = math.radians(b["lat"] - a["lat"])
    return 6371000 * math.hypot(x, y)


def norm(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"^\s*the\s+", "", s)
    s = re.sub(r"\s+(austin|apartments?)\s*$", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


def street(addr):
    """'715 W 23rd St, Austin, TX 78705' -> '715 w 23rd'. None when missing."""
    if not addr:
        return None
    first = addr.split(",")[0].lower()
    first = re.sub(r"\b(street|st|avenue|ave|drive|dr|road|rd|place|pl|boulevard|blvd)\b\.?", "", first)
    first = first.replace("west", "w").replace("east", "e")
    return re.sub(r"\s+", " ", first).strip() or None


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()).strip("-")


def ring_centroid(ring):
    """Area centroid of a lon/lat ring (planar; fine at building scale)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-15:
        n = len(ring) - 1
        return sum(p[0] for p in ring[:n]) / n, sum(p[1] for p in ring[:n]) / n
    return cx / (3 * a), cy / (3 * a)


def contained(a, b):
    return bool(a and b) and (a in b or b in a)


def main():
    rows = []

    # 1. authored models
    index = load("data/apartments/index.json")
    for fn in index["buildings"]:
        stem = fn[:-5]
        if stem in NOT_HOMES:
            continue
        d = load("data/apartments/" + fn)
        lon, lat = ring_centroid(d["footprint"]["ring"])
        rows.append({"name": d["name"], "addr": d.get("address"), "lat": lat, "lon": lon,
                     "kind": "dorm" if stem in DORMS else "apartment",
                     "aliases": [a for a in (d.get("aliases") or [])], "model": stem,
                     "wc": None, "src": ["model"]})

    # 2. the walking router's homes
    g = load("data/walk_graph.json")
    for name, doors in g["wc"].items():
        ds = [g["d"][i] for i in doors]
        main_ds = [x for x in ds if x[4] == "main"] or ds
        lon = sum(x[0] for x in main_ds) / len(main_ds) / 1e6
        lat = sum(x[1] for x in main_ds) / len(main_ds) / 1e6
        rows.append({"name": name, "addr": None, "lat": lat, "lon": lon, "kind": "apartment",
                     "aliases": [], "model": None, "wc": name, "src": ["walk"]})

    # 3. Riverside
    for name, addr, lat, lon, why in RIVERSIDE:
        rows.append({"name": name, "addr": addr, "lat": lat, "lon": lon, "kind": "apartment",
                     "aliases": [], "model": None, "wc": None, "src": ["riverside"], "why": why})

    # dedupe: fold each row into the first earlier home it matches
    homes = []
    for r in rows:
        keys = {norm(r["name"])} | {norm(a) for a in r["aliases"]}
        hit = None
        for h in homes:
            hkeys = {norm(h["name"])} | {norm(a) for a in h["aliases"]}
            same_name = bool(keys & hkeys)
            same_street = street(r["addr"]) and street(r["addr"]) == street(h["addr"])
            near = dist_m(r, h) < DEDUPE_M
            if same_name or ((same_street or near) and contained(norm(r["name"]), norm(h["name"]))):
                hit = h
                break
        if hit is None:
            homes.append(r)
            continue
        print(f"merge  {r['name']!r:36s} into {hit['name']!r:36s} ({dist_m(r, hit):.0f} m)")
        hit["src"] = sorted(set(hit["src"]) | set(r["src"]))
        hit["wc"] = hit["wc"] or r["wc"]
        hit["model"] = hit["model"] or r["model"]
        hit["addr"] = hit["addr"] or r["addr"]
        hit["aliases"] = hit["aliases"] + [r["name"]] + r["aliases"]

    out_homes = []
    seen_ids = set()
    for h in homes:
        area = next(label for label, rule in AREAS if rule(h))
        hid = slug(h["name"])
        while hid in seen_ids:
            hid += "-2"
        seen_ids.add(hid)
        rec = {"id": hid, "name": h["name"], "area": area, "kind": h["kind"],
               "p": [round(h["lon"], COORD_DP), round(h["lat"], COORD_DP)]}
        if h["addr"]:
            rec["addr"] = h["addr"].split(",")[0].strip()
        if h["wc"]:
            rec["wc"] = h["wc"]
        if h["model"]:
            rec["model"] = h["model"]
        if area in BUS_AREAS:
            rec["bus"] = True
        if h.get("why"):
            rec["why"] = h["why"]
        rec["src"] = h["src"]
        out_homes.append(rec)
    out_homes.sort(key=lambda r: (r["area"], r["name"].lower()))

    doc = {
        "v": 1,
        "_about": "Every home the apartment finder ranks: the authored 3D apartment models, the walking "
                  "graph's homes and four East Riverside student complexes, deduplicated. p = [lon, lat]. "
                  "wc = the walking router's name for the home (routed from its mapped doors); homes without "
                  "wc are routed from p. bus = outside the walking graph, timed by data/finder/transit.json.",
        "_script": "scripts/bake_finder_homes.py",
        "_sources": {
            "model": "data/apartments/ (footprint ring area centroid)",
            "walk": "data/walk_graph.json wc table (mean of main doors)",
            "riverside": "OpenStreetMap landuse polygon centroids, Overpass base 2026-09-22 (research 2026-09-23)",
        },
        "walk_graph_as_of": g.get("as_of"),
        "homes": out_homes,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        head = {k: v for k, v in doc.items() if k != "homes"}
        text = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1]
        fh.write(text + ',"homes":[\n')
        fh.write(",\n".join(json.dumps(h, ensure_ascii=False, separators=(",", ":")) for h in out_homes))
        fh.write("\n]}\n")

    by_area = {}
    for h in out_homes:
        by_area[h["area"]] = by_area.get(h["area"], 0) + 1
    print(f"{len(out_homes)} homes from {len(rows)} rows -> {os.path.relpath(OUT, ROOT)} "
          f"({os.path.getsize(OUT)} bytes)")
    print("by area:", by_area)
    print("routed by name (wc):", sum(1 for h in out_homes if "wc" in h),
          " bus:", sum(1 for h in out_homes if h.get("bus")))


if __name__ == "__main__":
    main()
