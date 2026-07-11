# -*- coding: utf-8 -*-
"""Fetch OSM building:part detail + coloured/material-tagged buildings for the
UT Austin / West Campus bbox and emit parts.geojson + building_tags.geojson."""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BBOX = "30.276,-97.752,30.296,-97.726"  # south,west,north,east
PRIMARY = "https://overpass-api.de/api/interpreter"
FALLBACK = "https://overpass.kumi.systems/api/interpreter"
DATA_DIR = "C:/Users/simip/Projects/austin-3d-explorer/data"

warnings = []


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    attempts = [PRIMARY, PRIMARY, FALLBACK]
    last_err = None
    for i, ep in enumerate(attempts):
        try:
            req = urllib.request.Request(
                ep, data=body,
                headers={"User-Agent": "austin-3d-explorer/0.1 (contact: local dev)"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.load(resp)
        except Exception as e:  # noqa: BLE001
            last_err = e
            sys.stderr.write("attempt %d on %s failed: %s\n" % (i + 1, ep, e))
            if i < len(attempts) - 1:
                time.sleep(5)
    raise last_err


# ---------------------------------------------------------------- colours ---
CSS_COLOURS = {
    # CSS named colours (subset covering all standard names likely in OSM)
    "aliceblue": "#f0f8ff", "antiquewhite": "#faebd7", "aqua": "#00ffff",
    "aquamarine": "#7fffd4", "azure": "#f0ffff", "beige": "#f5f5dc",
    "bisque": "#ffe4c4", "black": "#000000", "blanchedalmond": "#ffebcd",
    "blue": "#0000ff", "blueviolet": "#8a2be2", "brown": "#a52a2a",
    "burlywood": "#deb887", "cadetblue": "#5f9ea0", "chartreuse": "#7fff00",
    "chocolate": "#d2691e", "coral": "#ff7f50", "cornflowerblue": "#6495ed",
    "cornsilk": "#fff8dc", "crimson": "#dc143c", "cyan": "#00ffff",
    "darkblue": "#00008b", "darkcyan": "#008b8b", "darkgoldenrod": "#b8860b",
    "darkgray": "#a9a9a9", "darkgrey": "#a9a9a9", "darkgreen": "#006400",
    "darkkhaki": "#bdb76b", "darkmagenta": "#8b008b", "darkolivegreen": "#556b2f",
    "darkorange": "#ff8c00", "darkorchid": "#9932cc", "darkred": "#8b0000",
    "darksalmon": "#e9967a", "darkseagreen": "#8fbc8f", "darkslateblue": "#483d8b",
    "darkslategray": "#2f4f4f", "darkslategrey": "#2f4f4f",
    "darkturquoise": "#00ced1", "darkviolet": "#9400d3", "deeppink": "#ff1493",
    "deepskyblue": "#00bfff", "dimgray": "#696969", "dimgrey": "#696969",
    "dodgerblue": "#1e90ff", "firebrick": "#b22222", "floralwhite": "#fffaf0",
    "forestgreen": "#228b22", "fuchsia": "#ff00ff", "gainsboro": "#dcdcdc",
    "ghostwhite": "#f8f8ff", "gold": "#ffd700", "goldenrod": "#daa520",
    "gray": "#808080", "grey": "#808080", "green": "#008000",
    "greenyellow": "#adff2f", "honeydew": "#f0fff0", "hotpink": "#ff69b4",
    "indianred": "#cd5c5c", "indigo": "#4b0082", "ivory": "#fffff0",
    "khaki": "#f0e68c", "lavender": "#e6e6fa", "lavenderblush": "#fff0f5",
    "lawngreen": "#7cfc00", "lemonchiffon": "#fffacd", "lightblue": "#add8e6",
    "lightcoral": "#f08080", "lightcyan": "#e0ffff",
    "lightgoldenrodyellow": "#fafad2", "lightgray": "#d3d3d3",
    "lightgrey": "#d3d3d3", "lightgreen": "#90ee90", "lightpink": "#ffb6c1",
    "lightsalmon": "#ffa07a", "lightseagreen": "#20b2aa",
    "lightskyblue": "#87cefa", "lightslategray": "#778899",
    "lightslategrey": "#778899", "lightsteelblue": "#b0c4de",
    "lightyellow": "#ffffe0", "lime": "#00ff00", "limegreen": "#32cd32",
    "linen": "#faf0e6", "magenta": "#ff00ff", "maroon": "#800000",
    "mediumaquamarine": "#66cdaa", "mediumblue": "#0000cd",
    "mediumorchid": "#ba55d3", "mediumpurple": "#9370db",
    "mediumseagreen": "#3cb371", "mediumslateblue": "#7b68ee",
    "mediumspringgreen": "#00fa9a", "mediumturquoise": "#48d1cc",
    "mediumvioletred": "#c71585", "midnightblue": "#191970",
    "mintcream": "#f5fffa", "mistyrose": "#ffe4e1", "moccasin": "#ffe4b5",
    "navajowhite": "#ffdead", "navy": "#000080", "oldlace": "#fdf5e6",
    "olive": "#808000", "olivedrab": "#6b8e23", "orange": "#ffa500",
    "orangered": "#ff4500", "orchid": "#da70d6", "palegoldenrod": "#eee8aa",
    "palegreen": "#98fb98", "paleturquoise": "#afeeee",
    "palevioletred": "#db7093", "papayawhip": "#ffefd5", "peachpuff": "#ffdab9",
    "peru": "#cd853f", "pink": "#ffc0cb", "plum": "#dda0dd",
    "powderblue": "#b0e0e6", "purple": "#800080", "rebeccapurple": "#663399",
    "red": "#ff0000", "rosybrown": "#bc8f8f", "royalblue": "#4169e1",
    "saddlebrown": "#8b4513", "salmon": "#fa8072", "sandybrown": "#f4a460",
    "seagreen": "#2e8b57", "seashell": "#fff5ee", "sienna": "#a0522d",
    "silver": "#c0c0c0", "skyblue": "#87ceeb", "slateblue": "#6a5acd",
    "slategray": "#708090", "slategrey": "#708090", "snow": "#fffafa",
    "springgreen": "#00ff7f", "steelblue": "#4682b4", "tan": "#d2b48c",
    "teal": "#008080", "thistle": "#d8bfd8", "tomato": "#ff6347",
    "turquoise": "#40e0d0", "violet": "#ee82ee", "wheat": "#f5deb3",
    "white": "#ffffff", "whitesmoke": "#f5f5f5", "yellow": "#ffff00",
    "yellowgreen": "#9acd32",
    # Common OSM-ism colours not in CSS
    "cream": "#fffdd0", "lightbrown": "#c8a165", "darkbrown": "#5c4033",
    "brick": "#b35141", "brickred": "#b35141", "terracotta": "#e2725b",
    "sandstone": "#d9c49e", "sand": "#e3cf9e", "limestone": "#e0d8c0",
    "concrete": "#b0aca4", "stone": "#c0b8a8", "buff": "#dab88b",
    "offwhite": "#f8f4e8", "eggshell": "#f0ead6", "charcoal": "#36454f",
    "rust": "#b7410e", "copper": "#b87333", "bronze": "#cd7f32",
    "slate": "#708090", "taupe": "#b9a281", "mustard": "#e1ad01",
    "peach": "#ffdab9", "apricot": "#fbceb1", "burgundy": "#800020",
    "navyblue": "#000080", "skintone": "#e8beac", "creamwhite": "#f7f3e8",
    "warmgray": "#a89f91", "warmgrey": "#a89f91",
}

unmapped_colours = set()


def norm_colour(val):
    """Normalize an OSM colour value to #rrggbb, or None."""
    if val is None:
        return None
    v = val.strip().lower()
    if not v:
        return None
    m = re.match(r"^#?([0-9a-f]{6})$", v)
    if m:
        return "#" + m.group(1)
    m = re.match(r"^#?([0-9a-f]{3})$", v)
    if m:
        return "#" + "".join(c * 2 for c in m.group(1))
    key = re.sub(r"[\s_\-]+", "", v)
    if key in CSS_COLOURS:
        return CSS_COLOURS[key]
    unmapped_colours.add(val.strip())
    return None


# ----------------------------------------------------------------- lengths --
def parse_length_m(val):
    """Parse an OSM length tag ('12', '12 m', '12m', "40'", '40 ft') to metres."""
    if val is None:
        return None
    v = val.strip().lower().replace(",", ".")
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres)?$", v)
    if m:
        return float(m.group(1))
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*(ft|feet|')$", v)
    if m:
        return round(float(m.group(1)) * 0.3048, 2)
    m = re.match(r"^(\d+)'\s*(\d+(?:\.\d+)?)\"?$", v)
    if m:
        return round(float(m.group(1)) * 0.3048 + float(m.group(2)) * 0.0254, 2)
    return None


def parse_num(val):
    if val is None:
        return None
    try:
        return float(str(val).strip().replace(",", "."))
    except ValueError:
        return None


# ---------------------------------------------------------------- geometry --
def way_ring(geom):
    """Overpass way geometry -> closed [lon,lat] ring."""
    ring = [[pt["lon"], pt["lat"]] for pt in geom]
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    return ring


def assemble_rings(members, role):
    """Stitch relation member way segments with the given role into closed rings."""
    segs = []
    for m in members:
        if m.get("type") == "way" and m.get("role") == role and m.get("geometry"):
            segs.append([[pt["lon"], pt["lat"]] for pt in m["geometry"]])
    rings = []
    while segs:
        ring = segs.pop(0)
        progressed = True
        while progressed and ring[0] != ring[-1]:
            progressed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[-2::-1]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                progressed = True
                break
        if ring[0] != ring[-1]:
            ring.append(list(ring[0]))  # force closure
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def ring_centroid(ring):
    """Shoelace centroid of a closed [lon,lat] ring; mean fallback."""
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-14:
        xs = [p[0] for p in ring[:-1]]
        ys = [p[1] for p in ring[:-1]]
        return [sum(xs) / len(xs), sum(ys) / len(ys)]
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]


def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


def element_geometry(el):
    """Return (geom_type, coordinates) for a way or relation element, outers only."""
    if el["type"] == "way":
        if not el.get("geometry"):
            return None, None
        ring = way_ring(el["geometry"])
        if len(ring) < 4:
            return None, None
        return "Polygon", [ring]
    if el["type"] == "relation":
        outers = assemble_rings(el.get("members", []), "outer")
        if not outers:
            return None, None
        if len(outers) == 1:
            return "Polygon", [outers[0]]
        return "MultiPolygon", [[r] for r in outers]
    return None, None


def geometry_centroid(gtype, coords, el):
    if gtype == "Polygon":
        return ring_centroid(coords[0])
    if gtype == "MultiPolygon":
        # centroid of the largest outer ring
        best = max((poly[0] for poly in coords), key=ring_area)
        return ring_centroid(best)
    b = el.get("bounds")
    if b:
        return [(b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2]
    return None


# ------------------------------------------------------------------ task 1 --
def build_parts():
    q = """
[out:json][timeout:180];
(
  way["building:part"]({bbox});
  relation["building:part"]({bbox});
);
out body geom;
""".format(bbox=BBOX)
    data = overpass(q)
    feats = []
    skipped_flat = 0
    skipped_geom = 0
    n_min = 0
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if tags.get("building:part") in (None, "no"):
            continue
        gtype, coords = element_geometry(el)
        if gtype is None:
            skipped_geom += 1
            continue

        height = parse_length_m(tags.get("height"))
        if height is None:
            levels = parse_num(tags.get("building:levels"))
            if levels is not None:
                height = levels * 3.2
                if tags.get("roof:levels") is not None:
                    height += 1.5

        min_h = parse_length_m(tags.get("min_height"))
        if min_h is None:
            min_level = parse_num(tags.get("building:min_level"))
            min_h = min_level * 3.2 if min_level is not None else 0

        if height is None and min_h == 0:
            skipped_flat += 1
            continue
        if height is None and min_h > 0:
            height = min_h + 3.2

        if min_h > 0:
            n_min += 1

        feats.append({
            "type": "Feature",
            "geometry": {"type": gtype, "coordinates": coords},
            "properties": {
                "osm_id": "%s/%d" % (el["type"], el["id"]),
                "height_m": round(height, 2) if height is not None else None,
                "min_height_m": round(min_h, 2),
                "colour": norm_colour(tags.get("building:colour")),
                "roof_colour": norm_colour(tags.get("roof:colour")),
                "material": tags.get("building:material"),
            },
        })
    if skipped_flat:
        warnings.append("parts: skipped %d parts with no height and min_height 0" % skipped_flat)
    if skipped_geom:
        warnings.append("parts: skipped %d elements with unusable geometry" % skipped_geom)
    fc = {"type": "FeatureCollection", "features": feats}
    with open(DATA_DIR + "/parts.geojson", "w") as f:
        json.dump(fc, f)
    return len(feats), n_min


# ------------------------------------------------------------------ task 2 --
def build_building_tags():
    q = """
[out:json][timeout:180];
(
  way["building"]["building:colour"]({bbox});
  way["building"]["building:material"]({bbox});
  way["building"]["roof:colour"]({bbox});
  way["building"]["roof:shape"]({bbox});
  relation["building"]["building:colour"]({bbox});
  relation["building"]["building:material"]({bbox});
  relation["building"]["roof:colour"]({bbox});
  relation["building"]["roof:shape"]({bbox});
);
out body geom;
""".format(bbox=BBOX)
    data = overpass(q)
    feats = []
    skipped = 0
    n_coloured = 0
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        gtype, coords = element_geometry(el)
        pt = geometry_centroid(gtype, coords, el) if gtype else geometry_centroid(None, None, el)
        if pt is None:
            skipped += 1
            continue
        colour = norm_colour(tags.get("building:colour"))
        if colour is not None:
            n_coloured += 1
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(pt[0], 7), round(pt[1], 7)]},
            "properties": {
                "osm_id": "%s/%d" % (el["type"], el["id"]),
                "colour": colour,
                "roof_colour": norm_colour(tags.get("roof:colour")),
                "material": tags.get("building:material"),
                "roof_shape": tags.get("roof:shape"),
                "name": tags.get("name"),
            },
        })
    if skipped:
        warnings.append("building_tags: skipped %d elements with no derivable centroid" % skipped)
    fc = {"type": "FeatureCollection", "features": feats}
    with open(DATA_DIR + "/building_tags.geojson", "w") as f:
        json.dump(fc, f)
    return len(feats), n_coloured


def main():
    n_parts, n_min = build_parts()
    n_tagged, n_coloured = build_building_tags()
    if unmapped_colours:
        warnings.append("unmapped colour names left null: %s" % ", ".join(sorted(unmapped_colours)))
    report = {
        "parts": n_parts,
        "parts_with_min_height": n_min,
        "tagged_buildings": n_tagged,
        "coloured_buildings": n_coloured,
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
