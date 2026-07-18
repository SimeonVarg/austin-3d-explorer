#!/usr/bin/env python3
"""Download reference imagery for the Union-on-24th surroundings research.

Runs in GitHub Actions (full network access; the agent sandbox is allowlisted
and cannot reach these hosts). Fills research/union24th-area/imagery/ with:

  aerial/     top-down (nadir) Esri World Imagery: area mosaics at z17/z19 and a
              per-building crop at max zoom for every entry in buildings.json
  web/<slug>/ exterior photos scraped from each building's marketing/press/
              architect pages listed in buildings.json (og:image + <img> tags)
  wikimedia/  geotagged Commons photos within 500 m (license + camera heading
              recorded when present)
  kartaview/  open street-level photos near each priority building, if KartaView
              has coverage here (tolerates zero coverage)

Everything fetched is recorded in imagery/INDEX.json with source URL, license
note, and (when known) camera angle, so the desktop image-analysis system can
consume it. Reference use only - marketing/press photos must never ship in the
app itself.
"""
import io, json, math, os, re, sys, time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
AREA = ROOT / "research" / "union24th-area"
OUT = AREA / "imagery"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
# Area bbox (a touch wider than the 300 m research radius)
BBOX = (-97.7492, 30.2845, -97.7412, 30.2910)  # w, s, e, n
MAX_PER_PAGE = 12
MAX_PER_BUILDING = 18
MAX_IMG_PX = 2000
MIN_BYTES = 15_000
INDEX = []


def log(*a):
    print(*a, flush=True)


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lr = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lr)) / math.pi) / 2.0 * n
    return x, y


def fetch_tile(z, xt, yt, sess):
    try:
        r = sess.get(ESRI.format(z=z, y=yt, x=xt), timeout=30, headers=UA)
        if r.status_code == 200 and len(r.content) > 500:
            return Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception as e:
        log(f"  tile {z}/{yt}/{xt} failed: {e}")
    return None


def stitch(bbox, z, sess):
    w, s, e, n = bbox
    x0, y0 = tile_xy(w, n, z)
    x1, y1 = tile_xy(e, s, z)
    xa, xb = int(x0), int(x1)
    ya, yb = int(y0), int(y1)
    if (xb - xa + 1) * (yb - ya + 1) > 400:
        raise ValueError("tile range too large")
    mosaic = Image.new("RGB", ((xb - xa + 1) * 256, (yb - ya + 1) * 256), (20, 20, 20))
    ok = 0
    for xt in range(xa, xb + 1):
        for yt in range(ya, yb + 1):
            t = fetch_tile(z, xt, yt, sess)
            if t:
                mosaic.paste(t, ((xt - xa) * 256, (yt - ya) * 256))
                ok += 1
    # crop mosaic to exact bbox
    px0 = int((x0 - xa) * 256); py0 = int((y0 - ya) * 256)
    px1 = int((x1 - xa) * 256); py1 = int((y1 - ya) * 256)
    return mosaic.crop((px0, py0, px1, py1)), ok


def save_jpg(img, path, quality=88):
    path.parent.mkdir(parents=True, exist_ok=True)
    if max(img.size) > MAX_IMG_PX:
        img.thumbnail((MAX_IMG_PX, MAX_IMG_PX))
    img.save(path, "JPEG", quality=quality)


def all_buildings():
    data = json.loads((AREA / "buildings.json").read_text())
    out = [data["subject"]]
    out += data.get("tier1_adjacent", [])
    out += data.get("tier2_nearby", [])
    out += data.get("tier3_skyline_context", [])
    return out


def aerial(sess):
    log("== Aerial (Esri World Imagery, nadir) ==")
    for z in (17, 19):
        try:
            img, ok = stitch(BBOX, z, sess)
            save_jpg(img, OUT / "aerial" / f"area_z{z}.jpg")
            INDEX.append({"file": f"aerial/area_z{z}.jpg", "building": "AREA", "angle": "nadir",
                          "source": "Esri World Imagery (Esri, Maxar, Earthstar Geographics)", "zoom": z, "tiles_ok": ok})
            log(f"  area z{z}: {ok} tiles")
        except Exception as e:
            log(f"  area z{z} FAILED: {e}")
    # per-building crops at z20 (fallback z19)
    for b in all_buildings():
        lon, lat = b["centroid"]
        m = 60 if (b.get("true_height_m") or 0) > 40 else 45  # margin metres
        dlat = m / 111320.0
        dlon = m / (111320.0 * math.cos(math.radians(lat)))
        bb = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
        for z in (20, 19):
            try:
                img, ok = stitch(bb, z, sess)
                if ok == 0:
                    continue
                f = f"aerial/{b['slug']}_nadir_z{z}.jpg"
                save_jpg(img, OUT / f, quality=92)
                INDEX.append({"file": f, "building": b["slug"], "angle": "nadir",
                              "source": "Esri World Imagery", "zoom": z})
                log(f"  {b['slug']} z{z} ok")
                break
            except Exception as e:
                log(f"  {b['slug']} z{z} failed: {e}")


IMG_RE = re.compile(r"""(?:src|href|content|data-src|data-lazy-src|data-bg|data-original)\s*=\s*["']([^"']+?\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']""", re.I)
SRCSET_RE = re.compile(r"""(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']""", re.I)
SKIP_RE = re.compile(r"logo|icon|favicon|sprite|badge|avatar|arrow|placeholder|blank|pixel|tracking|\bmap\b", re.I)


def page_images(url, sess):
    r = sess.get(url, timeout=30, headers=UA, allow_redirects=True)
    r.raise_for_status()
    html = r.text
    urls = []
    for m in IMG_RE.finditer(html):
        urls.append(m.group(1))
    for m in SRCSET_RE.finditer(html):
        cands = [c.strip().split(" ")[0] for c in m.group(1).split(",")]
        urls += [c for c in cands if re.search(r"\.(jpe?g|png|webp)", c, re.I)]
    seen, out = set(), []
    for u in urls:
        u = urljoin(url, u)
        if u in seen or SKIP_RE.search(u):
            continue
        seen.add(u)
        out.append(u)
    return out


def scrape_web(sess):
    log("== Web pages (marketing/press/architect photos) ==")
    for b in all_buildings():
        pages = b.get("image_pages") or []
        if not pages:
            continue
        count = 0
        for page in pages:
            if count >= MAX_PER_BUILDING:
                break
            host = urlparse(page).netloc.replace("www.", "")
            try:
                imgs = page_images(page, sess)
            except Exception as e:
                log(f"  {b['slug']}: {host} FAILED ({e})")
                continue
            got = 0
            for iu in imgs:
                if got >= MAX_PER_PAGE or count >= MAX_PER_BUILDING:
                    break
                try:
                    r = sess.get(iu, timeout=30, headers={**UA, "Referer": page})
                    if r.status_code != 200 or len(r.content) < MIN_BYTES:
                        continue
                    img = Image.open(io.BytesIO(r.content)).convert("RGB")
                    if img.width < 400 or img.height < 300:
                        continue
                    f = f"web/{b['slug']}/{host.split('.')[0]}_{got:02d}.jpg"
                    save_jpg(img, OUT / f)
                    INDEX.append({"file": f, "building": b["slug"], "angle": "unknown (analyze)",
                                  "source": iu, "source_page": page,
                                  "license": "copyrighted - private modeling reference only"})
                    got += 1; count += 1
                except Exception:
                    continue
            log(f"  {b['slug']}: {host} -> {got} images")
            time.sleep(0.8)


def wikimedia(sess):
    log("== Wikimedia Commons geosearch ==")
    api = "https://commons.wikimedia.org/w/api.php"
    try:
        r = sess.get(api, params={
            "action": "query", "generator": "geosearch", "ggscoord": "30.28768|-97.74516",
            "ggsradius": 500, "ggslimit": 40, "ggsnamespace": 6,
            "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 1600,
            "format": "json"}, timeout=30, headers=UA)
        pages = (r.json().get("query") or {}).get("pages") or {}
    except Exception as e:
        log(f"  geosearch failed: {e}")
        return
    n = 0
    for p in pages.values():
        try:
            ii = p["imageinfo"][0]
            meta = ii.get("extmetadata", {})
            lic = (meta.get("LicenseShortName") or {}).get("value", "?")
            url = ii.get("thumburl") or ii["url"]
            r2 = sess.get(url, timeout=30, headers=UA)
            if r2.status_code != 200 or len(r2.content) < MIN_BYTES:
                continue
            img = Image.open(io.BytesIO(r2.content)).convert("RGB")
            f = f"wikimedia/commons_{n:02d}.jpg"
            save_jpg(img, OUT / f)
            INDEX.append({"file": f, "building": "AREA", "angle": "street-level (see title)",
                          "title": p.get("title"), "source": ii["url"], "license": lic,
                          "artist": re.sub("<[^>]+>", "", (meta.get("Artist") or {}).get("value", "?"))[:120]})
            n += 1
        except Exception:
            continue
    log(f"  {n} Commons images")


def kartaview(sess):
    log("== KartaView street-level (best effort) ==")
    got = 0
    try:
        r = sess.get("https://api.openstreetcam.org/2.0/photo/",
                     params={"lat": 30.28768, "lng": -97.74516, "radius": 300, "itemsPerPage": 100},
                     timeout=30, headers=UA)
        items = (r.json().get("result") or {}).get("data") or []
    except Exception as e:
        log(f"  API failed: {e}")
        return
    for it in items[:80]:
        try:
            url = it.get("fileurlProc") or it.get("fileurlLTh") or it.get("fileurl")
            if not url:
                continue
            r2 = sess.get(url, timeout=30, headers=UA)
            if r2.status_code != 200 or len(r2.content) < MIN_BYTES:
                continue
            img = Image.open(io.BytesIO(r2.content)).convert("RGB")
            f = f"kartaview/kv_{got:03d}.jpg"
            save_jpg(img, OUT / f)
            INDEX.append({"file": f, "building": "AREA", "angle": f"street-level heading={it.get('heading')}",
                          "lat": it.get("lat"), "lon": it.get("lng"), "source": url,
                          "license": "CC BY-SA 4.0 (KartaView)"})
            got += 1
        except Exception:
            continue
    log(f"  {got} KartaView photos")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sess = requests.Session()
    aerial(sess)
    scrape_web(sess)
    wikimedia(sess)
    kartaview(sess)
    (OUT / "INDEX.json").write_text(json.dumps(INDEX, indent=1))
    by = {}
    for e in INDEX:
        by[e["building"]] = by.get(e["building"], 0) + 1
    lines = ["# Fetched reference imagery summary", "",
             f"Total images: {len(INDEX)}", ""]
    for k in sorted(by):
        lines.append(f"- {k}: {by[k]}")
    (OUT / "SUMMARY.md").write_text("\n".join(lines) + "\n")
    log(f"DONE: {len(INDEX)} images")


if __name__ == "__main__":
    sys.exit(main())
