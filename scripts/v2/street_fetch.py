#!/usr/bin/env python3
"""v2 street layers, step 1: fetch the City of Austin's open street data for the v2 area into a cache folder OUTSIDE the repo.

    python3 scripts/v2/street_fetch.py CACHE_DIR

Every source is City of Austin open data (Open Data Terms of Use: "free and without restriction", credit requested; several sets are
marked Public Domain). Nothing here signs in; every request is anonymous and read-only. The bake (street_bake.py) reads CACHE_DIR.

  markings   9hak-anfp  TRANSPORTATION.markings_short_line (crosswalks, stop lines, yield lines)
  sidewalks  vchz-d9ng  Sidewalks (lines with width and back-of-curb)
  bike       23hw-a95n  TRANSPORTATION_bicycle_facilities
  signals    p53x-x73x  Traffic Signals and Pedestrian Signals (Public Domain)
  trees      wrik-xasw  Tree Inventory (Public Domain; species, trunk diameter)
  trees_dt   7aq7-a66u  Downtown Tree Inventory 2013 (Public Domain; species, dbh, height)
  ramps      AGOL TRANSPORTATION_curb_ramps (FeatureServer, the City's own ArcGIS Online)
  arrows     AGOL Markings_Specialty_Point_Read_Only (lane-use arrows, words, symbols; the portal's 53jy-y8pj)
  signs      ggnk-3ykn Roadway Sign Assets (Public Domain; MUTCD code, facing)
"""
import json, os, sys, time, urllib.parse, urllib.request

# ── PARAMETERS ──────────────────────────────────────────────────────────
BOX = {'n': 30.305, 's': 30.248, 'w': -97.767, 'e': -97.712}   # a little more than the v2 camera's reach (main.js VIEW.BOUNDS)
SOCRATA = 'https://datahub.austintexas.gov/resource/{id}.geojson'
SETS = {
    'markings': ('9hak-anfp', 'the_geom'),
    'sidewalks': ('vchz-d9ng', 'the_geom'),
    'bike': ('23hw-a95n', 'the_geom'),
    'signals': ('p53x-x73x', 'location'),
    'trees': ('wrik-xasw', 'geometry'),
    'trees_dt': ('7aq7-a66u', 'the_geom'),
}
AGOL = {
    'ramps': 'https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/TRANSPORTATION_curb_ramps/FeatureServer/0/query',
    'arrows': 'https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/Markings_Specialty_Point_Read_Only/FeatureServer/0/query',
}
SOCRATA_POINTS = {'signs': ('ggnk-3ykn', 'latitude', 'longitude')}   # a table with lat/lon text columns, no geometry column
UA = 'flyover-v2-bake/1 (City of Austin open data; github.com/SimeonVarg/austin-3d-explorer)'
PAGE = 20000


def get(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120) as r:
                return json.load(r)
        except Exception as e:
            print('  retry', e, file=sys.stderr)
            time.sleep(3 * (a + 1))
    raise SystemExit('failed ' + url)


def socrata(id, geom):
    where = f"within_box({geom}, {BOX['n']}, {BOX['w']}, {BOX['s']}, {BOX['e']})"
    feats, off = [], 0
    while True:
        q = urllib.parse.urlencode({'$where': where, '$limit': PAGE, '$offset': off, '$order': ':id'})
        page = get(SOCRATA.format(id=id) + '?' + q)['features']
        feats += page
        if len(page) < PAGE:
            return feats
        off += PAGE


def agol(url):
    feats, off = [], 0
    while True:
        q = urllib.parse.urlencode({'where': '1=1', 'geometry': f"{BOX['w']},{BOX['s']},{BOX['e']},{BOX['n']}", 'geometryType': 'esriGeometryEnvelope',
                                    'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'outSR': 4326, 'f': 'geojson',
                                    'resultOffset': off, 'resultRecordCount': 2000})
        j = get(url + '?' + q)
        page = j.get('features', [])
        feats += page
        if not j.get('properties', {}).get('exceededTransferLimit') and not j.get('exceededTransferLimit') and len(page) < 2000:
            return feats
        off += len(page)


def socrata_points(id, latc, lonc):
    """A table with text lat/lon columns -> GeoJSON points in the box."""
    where = f"{latc} between '{BOX['s']}' and '{BOX['n']}'"
    rows, off = [], 0
    while True:
        q = urllib.parse.urlencode({'$where': where, '$limit': PAGE, '$offset': off, '$order': ':id'})
        page = get(SOCRATA.format(id=id).replace('.geojson', '.json') + '?' + q)
        rows += page
        if len(page) < PAGE:
            break
        off += PAGE
    feats = []
    for r in rows:
        try:
            lat, lon = float(r[latc]), float(r[lonc])
        except (KeyError, TypeError, ValueError):
            continue
        if BOX['s'] <= lat <= BOX['n'] and BOX['w'] <= lon <= BOX['e']:
            feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]}, 'properties': r})
    return feats


def main():
    out = sys.argv[1]
    only = set(sys.argv[2:])
    os.makedirs(out, exist_ok=True)
    for name, (id, latc, lonc) in SOCRATA_POINTS.items():
        if only and name not in only:
            continue
        f = socrata_points(id, latc, lonc)
        json.dump({'type': 'FeatureCollection', 'source': id, 'fetched': time.strftime('%Y-%m-%d'), 'features': f}, open(os.path.join(out, name + '.geojson'), 'w'))
        print(name, id, len(f))
    for name, url in AGOL.items():
        if only and name not in only:
            continue
        f = agol(url)
        json.dump({'type': 'FeatureCollection', 'source': url, 'fetched': time.strftime('%Y-%m-%d'), 'features': f}, open(os.path.join(out, name + '.geojson'), 'w'))
        print(name, len(f))
    for name, (id, geom) in SETS.items():
        if only and name not in only:
            continue
        f = socrata(id, geom)
        json.dump({'type': 'FeatureCollection', 'source': id, 'fetched': time.strftime('%Y-%m-%d'), 'features': f}, open(os.path.join(out, name + '.geojson'), 'w'))
        print(name, id, len(f))


if __name__ == '__main__':
    main()
