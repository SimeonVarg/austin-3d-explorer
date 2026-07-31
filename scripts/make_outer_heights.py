#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build scripts/outer_heights.json — the height corrections for the skyline.

HEIGHTS MATTER MOST AT DISTANCE. At flyover altitude a facade texture is
sub-pixel and a colour is a suggestion, but a wrong height is a wrong skyline,
and a wrong skyline is the one error a stranger scrolling past can actually see.

Overture's LiDAR heights are good for most of the box and BADLY wrong for a
specific, predictable class of building: recent downtown towers, where the
return is the podium rather than the roof. Measured against the 2026-07-22.0
extract:

    Sixth and Guadalupe   Overture  18.7 m   actual 267.0 m   (tallest in Austin)
    Fairmont Austin       Overture  20.6 m   actual 180.0 m
    The Northshore        Overture  19.9 m   actual 129.3 m
    One American Center   Overture  24.1 m   actual 122.2 m
    The Waller            Overture  12.3 m   actual 113.0 m
    Icon                  Overture  31.5 m   actual  93.6 m
    360 Condominiums      Overture 148.8 m   actual 177.1 m

TWO SOURCES, and they have to agree before a number is written:
  OSM      data/osm_cache/outer_tags.json — an explicit `height` tag, plus the
           exact centroid, which is what the match is done on. Matching by NAME
           was tried first and is a trap: loose containment matched "W Austin"
           into a dozen unrelated names and pinned nine towers onto one
           footprint. Position is unambiguous, names are not.
  WIKIPEDIA the List of tallest buildings in Austin table (completed only),
           which is the authority where OSM records only `building:levels` —
           levels x a guessed storey height is exactly how Sixth and Guadalupe
           lands at 201 m instead of 267.

Where both exist and agree within 8%, OSM's is kept and the entry is marked
`agree`. Where they disagree the Wikipedia figure wins for anything on that
list, because it is a published height rather than a derived one, and the
disagreement is recorded in the entry so it can be argued with later.

The output is plain data, in the same spirit as scripts/hero_overrides.json:
a name, a position and a number. Re-running this script regenerates it; editing
a number in it by hand is also fine and is not undone by a re-bake.

Usage:  python scripts/make_outer_heights.py
"""
import json
import math
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM = os.path.join(ROOT, "data", "osm_cache", "outer_tags.json")
OUT = os.path.join(ROOT, "scripts", "outer_heights.json")

# Anything at or above this gets an entry; below it Overture is trusted.
MIN_H = 45.0
# Storey height used ONLY to decide whether an OSM levels count implies a tower
# worth listing. It is never the published number.
M_PER_LEVEL = 3.35

# en.wikipedia.org/wiki/List_of_tallest_buildings_in_Austin, completed
# buildings, read 2026-07-30. Metres as published.
WIKI = {
    "sixth and guadalupe": 267.0, "the republic": 216.0, "the independent": 211.4,
    "the austonian": 208.2, "atx tower": 205.7, "modern austin residences": 199.6,
    "415 colorado": 193.1, "fairmont austin": 180.0, "360 condominiums": 177.1,
    "block 185": 175.9, "44 east": 174.7, "paseo": 172.8, "the travis": 171.3,
    "indeed tower": 165.2, "hanover republic square": 157.3,
    "frost bank tower": 157.2, "hanover brazos street": 156.4, "700 river": 151.4,
    "w austin": 145.3, "fifth & west residences": 139.9, "vesper": 138.7,
    "300 colorado": 135.8, "spring": 132.3, "the northshore": 129.3,
    "northshore": 129.3, "the bowie": 128.9, "70 rainey": 127.7,
    "the ashton": 125.5, "jw marriott austin": 124.4,
    "four seasons residences austin": 122.3, "one american center": 122.2,
    "500 west 2nd street": 121.9, "one eleven congress": 121.3,
    "111 congress": 121.3, "colorado tower": 121.0, "austin proper": 121.0,
    "third + shoal": 118.0, "austin marriott downtown": 117.7,
    "austin hilton convention center hotel": 114.9, "the waller": 113.0,
    "405 colorado": 111.6, "natiivo": 109.1, "5th and brazos": 108.8,
    "the quincy": 108.0, "alexan waterloo": 106.7,
    "hyatt centric congress avenue austin": 105.2, "seaholm residences": 103.9,
    "windsor on the lake": 103.3, "bank of america center": 102.4,
    "300 west 6th street": 100.0, "aloft austin downtown": 100.0,
    "element austin downtown": 100.0, "procore tower": 99.1, "the monarch": 98.5,
    "100 congress": 97.5, "yugo austin waterloo": 97.5,
    "san jacinto center": 94.5, "icon": 93.6, "301 congress": 93.3,
    "hotel zaza": 93.0, "waterline": 312.4, "norwood tower": 100.0,
}


# Towers OSM does not tag with a height or a level count, so they never reach
# the loop below, and whose Overture height is materially wrong. Positions are
# the centroid of the matching Overture footprint, read out of the raw extract
# by an EXACT name match; the height is the Wikipedia figure. Six entries, each
# of which is a visible tower in the downtown silhouette from campus.
MANUAL = [
    # name,                     lon,        lat,       true m, overture m
    ("360 Condominiums",       -97.74968, 30.26742, 177.1, 148.8),
    ("The Travis",             -97.74029, 30.26010, 171.3, None),
    ("Fifth & West Residence", -97.75050, 30.26951, 139.9, 19.2),
    ("Vesper ATX",             -97.73761, 30.25967, 138.7, 7.9),
    ("Austin Marriott Downtown", -97.74146, 30.26286, 117.7, 11.6),
]


def norm(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9& +]", " ", s)
    return " ".join(s.split())


def main():
    with open(OSM, encoding="utf-8") as f:
        rows = json.load(f)

    out, agree, wiki_wins, osm_only = [], 0, 0, 0
    for r in rows:
        h_osm = r.get("h")
        lv = r.get("lv")
        name = r.get("n")
        implied = h_osm if h_osm else (lv * M_PER_LEVEL if lv else None)
        if not implied or implied < MIN_H:
            continue

        w = WIKI.get(norm(name)) if name else None
        if w is None and name:
            # One controlled fuzzy step: an exact match on the name with a
            # leading "the " stripped. No containment - see the docstring.
            w = WIKI.get(norm(name).removeprefix("the "))

        if w is not None and h_osm is not None:
            if abs(w - h_osm) <= 0.08 * w:
                h, src = h_osm, "osm+wikipedia agree"
                agree += 1
            else:
                h, src = w, f"wikipedia (osm height {h_osm})"
                wiki_wins += 1
        elif w is not None:
            h, src = w, f"wikipedia (osm had levels={lv} only)"
            wiki_wins += 1
        elif h_osm is not None:
            h, src = h_osm, "osm height tag"
            osm_only += 1
        else:
            h, src = lv * M_PER_LEVEL, f"osm levels={lv} x {M_PER_LEVEL}"
            osm_only += 1

        out.append({"name": name, "lon": r["x"], "lat": r["y"],
                    "height": round(float(h), 1), "source": src})

    for name, lon, lat, h, oh in MANUAL:
        out.append({"name": name, "lon": lon, "lat": lat, "height": h,
                    "source": f"wikipedia; not in osm (overture had {oh})"})

    out.sort(key=lambda e: -e["height"])
    doc = {
        "_readme": ("Height corrections for the outer ring only. Matched by "
                    "POSITION (within OUTER_HEIGHT_MATCH_M in bake_outer.py), "
                    "never by name. Regenerate with make_outer_heights.py; "
                    "hand edits survive a re-bake."),
        "_generated": "scripts/make_outer_heights.py",
        "_min_height_m": MIN_H,
        "by_point": out,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)

    print(f"{len(out)} height entries >= {MIN_H} m -> {OUT}")
    print(f"  osm+wikipedia agree: {agree}   wikipedia corrected osm: {wiki_wins}"
          f"   osm only: {osm_only}")
    for e in out[:14]:
        print(f"   {e['height']:7.1f}  {str(e['name'])[:38]:38s}  {e['source']}")


if __name__ == "__main__":
    main()
