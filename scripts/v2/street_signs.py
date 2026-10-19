#!/usr/bin/env python3
"""Build only identified sign legends; never display a guessed legend or a blank face.

python3 street_signs.py CITY_CACHE --font OFL_FONT.ttf
Writes sign_faces.json. Uses the SAME grouping and panel order as street_near.py;
checks source coordinates and kind lists before joining. Font outlines are a shared glyph library.
"""
import argparse,collections,hashlib,json,re,math
from pathlib import Path
from street_graph import loc,r5
ROOT=Path(__file__).resolve().parents[2]

def kind(code):
    c=code.upper()
    if c.startswith('R1-1'):return 1
    if c.startswith('D3'):return 2
    if c.startswith('R1-2'):return 3
    if c.startswith('W') or c.startswith('S1'):return 4
    if c.startswith('R2'):return 5
    return 0

def legend(p):
    code=(p.get('mutcd_code') or '').upper();msg=(p.get('sign_message') or '').strip().upper()
    if code=='R1-1':return ['STOP']
    if code=='R1-2':return ['YIELD']
    if code=='D3-1' and re.fullmatch(r'[A-Z0-9 .\-]{2,24}',msg):return [msg]
    m=re.fullmatch(r'SPEED LIMIT (\d{2})',msg)
    if code=='R2-1' and m:return ['SPEED','LIMIT',m[1]]
    if code in ('R7-2','R7-2a') and msg.startswith('NO PARKING'):return ['NO','PARKING']
    if code in ('R6-1L','R6-1R') and msg.startswith('ONE WAY'):return ['ONE WAY', '<' if code.endswith('L') else '>']
    return None

def glyphs(font_path,chars):
    from fontTools.ttLib import TTFont
    from fontTools.pens.basePen import BasePen
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    font=TTFont(font_path);gs=font.getGlyphSet();cmap=font.getBestCmap();cap=font['OS/2'].sCapHeight
    class Pen(BasePen):
        def __init__(self):super().__init__(gs);self.rings=[];self.pts=[]
        def _moveTo(self,p):self.pts=[p]
        def _lineTo(self,p):self.pts.append(p)
        def _qCurveToOne(self,c,e):
            a=self._getCurrentPoint()
            for i in range(1,9):
                t=i/8;u=1-t;self.pts.append(tuple(u*u*a[k]+2*u*t*c[k]+t*t*e[k] for k in (0,1)))
        def _curveToOne(self,b,c,e):
            a=self._getCurrentPoint()
            for i in range(1,13):
                t=i/12;u=1-t;self.pts.append(tuple(u**3*a[k]+3*u*u*t*b[k]+3*u*t*t*c[k]+t**3*e[k] for k in (0,1)))
        def _closePath(self):
            if len(self.pts)>2:self.rings.append(self.pts)
            self.pts=[]
        def _endPath(self):self._closePath()
    out={}
    for c in sorted(chars):
        name=cmap[ord(c)];pen=Pen();gs[name].draw(pen);parts=[Polygon(r).buffer(0) for r in pen.rings];g=Polygon()
        # Even/odd contours preserve the holes in O, P, R, 0, etc.
        for p in parts:g=g.symmetric_difference(p)
        g=g.simplify(cap*.002,preserve_topology=True);parts=[g] if g.geom_type=='Polygon' else list(g.geoms)
        coords=lambda ring:[[round(x/cap,4),round(y/cap,4)] for x,y in list(ring.coords)[:-1]]
        out[c]={'advance':round(font['hmtx'][name][0]/cap,4),'polygons':[{'outer':coords(p.exterior),'holes':[coords(r) for r in p.interiors]} for p in parts if not p.is_empty]}
    # Shared signed-distance glyph atlas: crisp derivative-based edges, one quad per letter.
    # Pixels are generated from the OFL glyph contours, not from a source photograph.
    from PIL import Image,ImageDraw
    from scipy.ndimage import distance_transform_edt
    import numpy as np
    cell,cols,unit,pad,baseline,ss=64,8,34,12,46,4
    atlas=Image.new('L',(cols*cell,math.ceil(len(out)/cols)*cell),0)
    for i,(c,g) in enumerate(out.items()):
        mask=Image.new('L',(cell*ss,cell*ss),0);draw=ImageDraw.Draw(mask)
        xy=lambda r:[((pad+x*unit)*ss,(baseline-y*unit)*ss) for x,y in r]
        for poly in g['polygons']:
            draw.polygon(xy(poly['outer']),fill=255)
            for ring in poly['holes']:draw.polygon(xy(ring),fill=0)
        inside=np.asarray(mask)>127
        sdf=(distance_transform_edt(inside)-distance_transform_edt(~inside))/ss
        tile=Image.fromarray(np.uint8(np.clip(128+sdf*16,0,255))).resize((cell,cell),Image.Resampling.BOX)
        x,y=(i%cols)*cell,(i//cols)*cell;atlas.paste(tile,(x,y))
        # Texture.flipY is false. UV zero is the top of this generated atlas.
        g['uv']=[x/atlas.width,y/atlas.height,(x+cell)/atlas.width,(y+cell)/atlas.height]
        g['bounds']=[-pad/unit,(baseline-cell)/unit,(cell-pad)/unit,baseline/unit]
        del g['polygons']
    atlas.convert('RGB').save(ROOT/'v2/data/street/sign_glyphs.png')
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('city',type=Path);ap.add_argument('--font',type=Path,required=True);a=ap.parse_args()
    data=ROOT/'v2/data/street';near=json.loads((data/'near.json').read_text());safe=json.loads((data/'safe.json').read_text())
    posts=collections.defaultdict(list)
    for f in json.loads((a.city/'signs.geojson').read_text())['features']:
        p=f['properties'];g=f.get('geometry')
        if not g or p.get('asset_status')!='1':continue
        x,z=loc(*g['coordinates'][:2]);posts[p.get('asset_location_id') or (round(x,1),round(z,1))].append((x,z,p))
    groups={}
    for lst in posts.values():
        x=r5(sum(q[0] for q in lst)/len(lst));z=r5(sum(q[1] for q in lst)/len(lst))
        selected=sorted(lst,key=lambda q:(kind(q[2].get('mutcd_code') or '')!=2,kind(q[2].get('mutcd_code') or '')!=1))[:3]
        groups.setdefault((x,z),[]).append(selected)
    faces=[];chars=set(' BUS');omitted=0
    for s,index in zip(safe['signs'],safe['sign_sources']):
        raw=near['signs'][index];candidates=[g for g in groups.get(tuple(raw[:2]),[]) if [kind(q[2].get('mutcd_code') or '') for q in g]==raw[3::2]]
        row=[]
        for i in range(s[2]):
            record=candidates[0][i][2] if len(candidates)==1 else {};text=legend(record)
            if not text:omitted+=1;row.append(None);continue
            row.append(text);chars.update(''.join(text))
        faces.append(row)
    result={'source':'City of Austin Roadway Sign Assets ggnk-3ykn; named legends only; symbols/styles are schematic, not surveyed artwork.',
            '_src':{'legends':{'source':'City of Austin ggnk-3ykn','kind':'public-inventory','confidence':'recorded message, current appearance unverified','sha256':hashlib.sha256((a.city/'signs.geojson').read_bytes()).hexdigest()},'geometry':{'kind':'inference','supports':'generic sign forms and font; dimensions are schematic'},'compiled':'2026-10-19'},
            'inputs':{'safe':hashlib.sha256((data/'safe.json').read_bytes()).hexdigest(),'near':hashlib.sha256((data/'near.json').read_bytes()).hexdigest()},
            'font':'Roboto (SIL OFL 1.1); glyph subset; see sign-font-OFL.txt','records':safe['signs'],'faces':faces,'glyphs':glyphs(a.font,chars),
            'counts':{'panels_before':sum(s[2] for s in safe['signs']),'legends':sum(bool(x) for row in faces for x in row),'unknown_panels_omitted':omitted,'blank_faces_after':0}}
    (data/'sign_faces.json').write_text(json.dumps(result,separators=(',',':')));print(json.dumps(result['counts'],indent=2))
if __name__=='__main__':main()
