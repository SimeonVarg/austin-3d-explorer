# -*- coding: utf-8 -*-
"""Pull reference imagery for the arts/presidential precinct pass.

Five buildings whose ARCHITECTURE is the subject, four of them nearly windowless.
Guessing their colour is the failure mode PASS_COMMON section 1 exists to stop, so
this fetches actual photographs and an actual nadir aerial and writes them to
research/arts-precinct/ for pixel sampling. Reference use only — nothing here
ships in the app.

Two sources, both open:
  Wikimedia Commons  — exterior photographs, title + geosearch, license recorded
  Esri World Imagery — nadir tiles at z19/z20 around each footprint

Usage:  python scripts/fetch_arts_reference.py
"""
import io
import json
import math
import os
import time
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "research", "arts-precinct")
UA = {"User-Agent": "austin-3d-explorer research (simeonvarghese@utexas.edu)"}
COMMONS = "https://commons.wikimedia.org/w/api.php"
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

# lon, lat, and the Commons search string that actually returns the building
SITES = [
    ("lbj",     -97.72929, 30.28590, 'Lyndon Baines Johnson Library exterior'),
    ("kelly",   -97.73782, 30.28168, 'Ellsworth Kelly Austin Blanton'),
    ("blanton", -97.73742, 30.28098, 'Blanton Museum of Art building'),
    ("ransom",  -97.74123, 30.28434, 'Harry Ransom Center'),
    ("bass",    -97.73103, 30.28630, 'Bass Concert Hall Austin'),
]
INDEX = []


def get(url, tries=3):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
        except Exception as e:
            if i == tries - 1:
                print("   ! %s  %s" % (type(e).__name__, url[:90]))
                return None
            time.sleep(1.5)


def api(params):
    params = dict(params)
    params.update({"format": "json", "action": "query"})
    b = get(COMMONS + "?" + urllib.parse.urlencode(params))
    return json.loads(b) if b else {}


def imageinfo(titles):
    """url + license + description for a batch of File: titles."""
    if not titles:
        return {}
    j = api({"titles": "|".join(titles[:40]), "prop": "imageinfo",
             "iiprop": "url|extmetadata|size", "iiurlwidth": 1600})
    out = {}
    for pg in (j.get("query", {}).get("pages") or {}).values():
        ii = (pg.get("imageinfo") or [None])[0]
        if not ii:
            continue
        em = ii.get("extmetadata") or {}
        out[pg["title"]] = {
            "url": ii.get("thumburl") or ii.get("url"),
            "w": ii.get("thumbwidth") or ii.get("width"),
            "h": ii.get("thumbheight") or ii.get("height"),
            "license": (em.get("LicenseShortName") or {}).get("value", "?"),
            "artist": (em.get("Artist") or {}).get("value", "?")[:120],
        }
    return out


def candidates(slug, lon, lat, query):
    """Title search first (precise), then geosearch (catches untitled photos)."""
    titles = []
    j = api({"list": "search", "srsearch": query, "srnamespace": 6, "srlimit": 24})
    titles += [r["title"] for r in j.get("query", {}).get("search", [])]
    j = api({"list": "geosearch", "gscoord": "%f|%f" % (lat, lon), "gsradius": 160,
             "gsnamespace": 6, "gslimit": 40})
    titles += [r["title"] for r in j.get("query", {}).get("geosearch", [])]
    seen, uniq = set(), []
    for t in titles:
        if t.lower().endswith((".jpg", ".jpeg", ".png")) and t not in seen:
            seen.add(t)
            uniq.append(t)
    return uniq


def save_photos(slug, lon, lat, query, limit=14):
    d = os.path.join(OUT, slug)
    os.makedirs(d, exist_ok=True)
    info = imageinfo(candidates(slug, lon, lat, query))
    n = 0
    for title, meta in info.items():
        if n >= limit or not meta["url"]:
            continue
        raw = get(meta["url"])
        if not raw or len(raw) < 25_000:
            continue
        try:
            im = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            continue
        if min(im.size) < 320:
            continue
        fn = "%02d_%s.jpg" % (n, "".join(c if c.isalnum() else "_" for c in title[5:])[:60])
        im.save(os.path.join(d, fn), quality=92)
        INDEX.append({"site": slug, "file": "%s/%s" % (slug, fn), "commons": title,
                      "license": meta["license"], "credit": meta["artist"], "src": meta["url"]})
        n += 1
    print("  %-8s %2d photos" % (slug, n))


def tile_xy(lon, lat, z):
    n = 2 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def save_aerial(slug, lon, lat, z=20, span=2):
    """A (2*span+1)^2 tile mosaic centred on the footprint. z20 ~ 0.15 m/px here."""
    x, y = tile_xy(lon, lat, z)
    xi, yi = int(x), int(y)
    W = (2 * span + 1) * 256
    mos = Image.new("RGB", (W, W))
    got = 0
    for dx in range(-span, span + 1):
        for dy in range(-span, span + 1):
            raw = get(ESRI.format(z=z, x=xi + dx, y=yi + dy))
            if not raw:
                continue
            try:
                mos.paste(Image.open(io.BytesIO(raw)).convert("RGB"),
                          ((dx + span) * 256, (dy + span) * 256))
                got += 1
            except Exception:
                pass
    if got:
        os.makedirs(OUT, exist_ok=True)
        mos.save(os.path.join(OUT, "aerial_%s_z%d.jpg" % (slug, z)), quality=94)
        INDEX.append({"site": slug, "file": "aerial_%s_z%d.jpg" % (slug, z),
                      "src": "Esri World Imagery", "z": z, "tiles": got,
                      "centre_tile": [xi, yi], "centre_frac": [x - xi, y - yi]})
    print("  %-8s aerial z%d: %d/%d tiles" % (slug, z, got, (2 * span + 1) ** 2))


def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, lon, lat, q in SITES:
        save_photos(slug, lon, lat, q)
        save_aerial(slug, lon, lat, 20, 2)
    with open(os.path.join(OUT, "INDEX.json"), "w", encoding="utf-8") as fh:
        json.dump(INDEX, fh, indent=1)
    print("wrote", len(INDEX), "entries to", OUT)


if __name__ == "__main__":
    main()
