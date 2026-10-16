#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bake_look_trees.py - the street and park trees as one record each.

    data/trees.geojson, data/campus_landscape.json   ->   data/look_trees.bin

THE ONE WRITER of data/look_trees.bin, which js/look-trees.js turns into round crowns
when the page is opened with ?look=photo (js/look-photo.js).

WHY. data/trees.geojson draws a tree as two to five stacked octagons, one feature a tier
(59,869 tiers for 27,038 trees). From the air a stack of flat octagons reads as a pile of
discs. A tree is one record: where it stands, how wide and how tall its crown is, which
species, and its two stable random numbers. The browser draws a lobed ball from that, with
no more triangles than the tiers took (see js/look-trees.js for the count).

WHAT IS LEFT OUT. The trees js/campus-landscape.js already draws as rounded crowns (the
`canopyKeys` of data/campus_landscape.json): drawing them twice would double the crowns.

FILE, little endian:
    0   4  'LKT1'
    4   4  u32 number of trees
 
   16  ..  one 10-byte record a tree
            u16 east   (longitude - origin) x 1e5 degrees
            u16 north  (latitude  - origin) x 1e5 degrees
            u8  widest radius of the crown, 0.1 m
            u8  crown base height, 0.25 m
            u8  top height, 0.25 m
            u8  species index (SPECIES below)
            u8  j  (the tree's colour number, 0..255)
            u8  d  (its keep-order, 0..255)
   Position uses u16 at 1e-5 degree (1.1 m north-south): a crown is metres wide, so that is
   below what is visible, and it keeps the record at 10 bytes. The box is 0.65 degrees wide.
   Origin: header i32 pair, in 1e-6 degrees (ORIGIN below).

    python scripts/bake_look_trees.py
"""
import gzip
import json
import math
import os
import struct
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIES = ['other', 'liveoak', 'oak', 'elm', 'pecan', 'crape', 'magnolia', 'cedar', 'cypress', 'pine', 'palm']
ORIGIN = (-97.95, 30.05)       # degrees; every Austin tree is within 0.65 degrees east and north of it
QUANT = 1e5                    # u16 steps per degree


def js_num(x):
    """The text JavaScript gives a number, which data/campus_landscape.json's keys were made with."""
    if x is None:
        return '0'
    if float(x).is_integer():
        return str(int(x))
    return repr(float(x))


def main():
    gj = json.load(open(os.path.join(ROOT, 'data/trees.geojson')))
    campus = json.load(open(os.path.join(ROOT, 'data/campus_landscape.json')))
    skip = set(campus['canopyKeys'])
    trees = defaultdict(list)
    for f in gj['features']:
        p = f['properties']
        if p.get('kind') != 'canopy':
            continue
        trees[(p['d'], p.get('sp') or 'other', p.get('r0') or 0, p.get('j') or 0)].append(f)
    rows, dropped = [], 0
    for (d, sp, r0, j), tiers in trees.items():
        if '|'.join([js_num(d), sp, js_num(r0), js_num(j)]) in skip:
            dropped += 1
            continue
        ring0 = tiers[0]['geometry']['coordinates'][0][:-1]
        cx = sum(p[0] for p in ring0) / len(ring0)
        cy = sum(p[1] for p in ring0) / len(ring0)
        mx = 111320 * math.cos(math.radians(cy))
        widest = 0.0
        for t in tiers:
            ring = t['geometry']['coordinates'][0][:-1]
            widest = max(widest, sum(math.hypot((p[0] - cx) * mx, (p[1] - cy) * 110540) for p in ring) / len(ring))
        base = min(t['properties']['base'] for t in tiers)
        top = max(t['properties']['h'] for t in tiers)
        rows.append((cx, cy, widest, base, top, SPECIES.index(sp) if sp in SPECIES else 0, j, d))
    rows.sort(key=lambda r: (round(r[1] * 200), r[0]))          # neighbours together: gzip likes it
    out = bytearray(b'LKT1' + struct.pack('<Iii', len(rows), round(ORIGIN[0] * 1e6), round(ORIGIN[1] * 1e6)))
    clamp = lambda v, hi: max(0, min(hi, int(round(v))))
    for cx, cy, w, base, top, sp, j, d in rows:
        out += struct.pack('<HHBBBBBB', clamp((cx - ORIGIN[0]) * QUANT, 65535), clamp((cy - ORIGIN[1]) * QUANT, 65535),
                           clamp(w * 10, 255), clamp(base * 4, 255), clamp(top * 4, 255), sp, clamp(j * 255, 255), clamp(d * 255, 255))
    path = os.path.join(ROOT, 'data/look_trees.bin')
    open(path, 'wb').write(out)
    gz = len(gzip.compress(bytes(out), 9))
    print(f'{len(rows)} trees ({dropped} left to campus-landscape): {len(out)} bytes, {gz} gzip -> {path}')


if __name__ == '__main__':
    sys.exit(main())
