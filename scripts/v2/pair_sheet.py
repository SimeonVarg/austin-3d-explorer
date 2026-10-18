#!/usr/bin/env python3
"""v2 pair sheets: NAME.blender.png | NAME.app.png side by side with a label strip.   python3 scripts/v2/pair_sheet.py DIR [name ...]"""
import sys, os, glob
from PIL import Image, ImageDraw
d = sys.argv[1]; only = sys.argv[2:]
for b in sorted(glob.glob(d + '/*.blender.png')):
    n = os.path.basename(b)[:-len('.blender.png')]
    a = d + '/' + n + '.app.png'
    if (only and n not in only) or not os.path.exists(a): continue
    L = Image.open(b).convert('RGB'); R = Image.open(a).convert('RGB').resize(L.size)
    S = Image.new('RGB', (L.width * 2 + 8, L.height + 34), (20, 20, 20)); S.paste(L, (0, 34)); S.paste(R, (L.width + 8, 34))
    g = ImageDraw.Draw(S); g.text((12, 10), n + '   LEFT: Blender render of the .blend   RIGHT: the v2 app, same camera (light differs)', fill=(255, 255, 255))
    S.save(d + '/' + n + '.pair.png'); print('SHEET', d + '/' + n + '.pair.png')
