"""Small, cached vector sign shapes. Bakes need only the checked-in JSON.

To regenerate from locally licensed installed fonts, use --font-dir DIRECTORY.
Only the rendered words' outlines are saved, never font files or image sources.
"""
import copy
import json
from pathlib import Path

ASSET = Path(__file__).resolve().parents[1] / 'data/sign_outlines.json'


def load_sign(name):
    return copy.deepcopy(json.loads(ASSET.read_text(encoding='utf-8'))['outlines'][name])


def public_logo():
    """Contour the official public mark, keeping curved outlines and counters.

    Scanline union avoids treating every image pixel as a 3D box. The final
    simplified polygons are solid extrusion paths; the source is not a facade
    texture and contains no owner photograph.
    """
    from PIL import Image
    from shapely.geometry import box, Polygon
    from shapely.ops import unary_union
    from shapely.affinity import translate, scale
    from shapely import concave_hull
    im=Image.open(ASSET.parent/'sign_sources/barefoot-logo.png').convert('RGB').crop((0,0,729,478))
    runs=[]
    for y in range(im.height):
        start=None
        for x in range(im.width+1):
            filled=x<im.width and sum(im.getpixel((x,y)))<450
            if filled and start is None:start=x
            if not filled and start is not None:
                runs.append(box(start,im.height-y-1,x,im.height-y));start=None
    shape=unary_union(runs).buffer(.7).buffer(-.7).simplify(.6,preserve_topology=True)
    parts=list(shape.geoms) if shape.geom_type=='MultiPolygon' else [shape]
    shape=unary_union([Polygon(p.exterior,[r for r in p.interiors if Polygon(r).area>8]) for p in parts if p.area>5])
    plaque=concave_hull(shape,ratio=.32,allow_holes=False).buffer(9,quad_segs=5)
    x0,y0,x1,y1=shape.bounds
    def pack(geometry):
        g=scale(translate(geometry,-x0,-y0),xfact=1/(x1-x0),yfact=1/(y1-y0),origin=(0,0))
        coords=lambda r:[[round(x,6),round(y,6)] for x,y in list(r.coords)[:-1]]
        ps=list(g.geoms) if g.geom_type=='MultiPolygon' else [g]
        return {'polygons':[{'outer':coords(p.exterior),'holes':[coords(r) for r in p.interiors]} for p in ps]}
    return {'barefoot-logo':pack(shape),'barefoot-plaque':pack(plaque)}


def regenerate(font_dir, add_only=False):
    from fontTools.ttLib import TTFont
    from fontTools.pens.basePen import BasePen
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from shapely.affinity import translate, scale

    class FlattenPen(BasePen):
        def __init__(self, glyphs):
            super().__init__(glyphs)
            self.rings, self.points = [], []
        def _moveTo(self, p): self.points = [p]
        def _lineTo(self, p): self.points.append(p)
        def _qCurveToOne(self, c, end):
            start = self._getCurrentPoint()
            for i in range(1, 17):
                t = i / 16; u = 1-t
                self.points.append(tuple(u*u*start[k]+2*u*t*c[k]+t*t*end[k] for k in (0,1)))
        def _curveToOne(self, a, b, end):
            start = self._getCurrentPoint()
            for i in range(1, 25):
                t = i / 24; u = 1-t
                self.points.append(tuple(u**3*start[k]+3*u*u*t*a[k]+3*u*t*t*b[k]+t**3*end[k] for k in (0,1)))
        def _closePath(self):
            if len(self.points) > 2: self.rings.append(self.points)
            self.points = []
        def _endPath(self): self._closePath()

    words = {'co-op':('CO-OP','timesbd.ttf'), 'the':('THE','timesbd.ttf'),
             'barefoot':('Barefoot','MISTRAL.TTF'), 'campus':('CAMPUS','ARIALN.TTF'),
             'outfitter':('OUTFITTER','ARIALN.TTF'), 'wukasch':('WUKASCH','times.ttf'),
             'shop-like-it-matters':('SHOP LIKE IT MATTERS','ARIALNB.TTF'),
             'only-at-the-co-op':('Only at the Co-op','timesbi.ttf'),
             'potbelly':('POTBELLY','BERNHC.TTF'),
             'sandwich-works':('SANDWICH WORKS','ARIALNB.TTF'),
             'wingstop':('WING\u00b7STOP','timesbd.ttf'),
             'miss-behavin':('MISS BEHAVIN','ARIALNB.TTF')}
    new_keys={'potbelly','sandwich-works','wingstop','miss-behavin'}
    result = json.loads(ASSET.read_text(encoding='utf-8'))['outlines'] if add_only else {}
    for key, (word, filename) in words.items():
        if add_only and key not in new_keys:continue
        font = TTFont(Path(font_dir)/filename); glyphs=font.getGlyphSet(); cmap=font.getBestCmap()
        pieces=[]; cursor=0
        for letter in word:
            name=cmap[ord(letter)]; pen=FlattenPen(glyphs); glyphs[name].draw(pen)
            rings=[Polygon(r).buffer(0) for r in pen.rings]
            rings=sorted([r for r in rings if r.area>0], key=lambda p:-p.area)
            outer=[]
            for i, ring in enumerate(rings):
                parents=[j for j in range(i) if rings[j].contains(ring.representative_point())]
                if len(parents)%2==0:
                    holes=[rings[j] for j in range(i+1,len(rings)) if ring.contains(rings[j].representative_point())
                           and sum(rings[k].contains(rings[j].representative_point()) for k in range(j))==len(parents)+1]
                    outer.append(ring.difference(unary_union(holes)))
            if key=='potbelly' and letter in ['P','Y']:
                # Original smooth reconstruction of the classic oversized,
                # curled end letters. Interior capitals use a condensed serif;
                # this is not the brand's newer rounded sans-serif wordmark.
                from fontTools.svgLib.path import parse_path
                paths={
                    'P':'M .10 .02 L .62 .02 L .62 .085 C .43 .09 .39 .14 .41 .32 L .45 .71 C .66 .66 .84 .77 .80 .98 C .77 1.15 .59 1.25 .39 1.18 C .20 1.25 .01 1.12 .015 .95 C .015 .79 .17 .74 .29 .84 C .26 .93 .19 .98 .15 .89 C .09 .99 .22 1.08 .31 1.03 L .28 .29 C .27 .15 .25 .10 .10 .085 Z M .47 .81 L .49 1.08 C .65 1.075 .69 .91 .60 .83 C .56 .80 .50 .79 .47 .81 Z',
                    'Y':'M .025 1.05 L .39 1.05 L .39 .99 C .30 .975 .32 .93 .345 .865 L .48 .56 L .61 .88 C .645 .97 .62 .99 .545 .99 L .545 1.05 L .86 1.05 L .86 .99 C .77 .975 .75 .92 .715 .84 L .46 .29 C .40 .15 .40 .09 .48 .07 C .56 .045 .61 .11 .57 .165 C .66 .185 .725 .11 .68 .025 C .61 -.10 .41 -.12 .31 -.02 C .23 .065 .28 .18 .315 .28 L .18 .78 C .13 .94 .10 .975 .025 .99 Z'}
                pen=FlattenPen(None);parse_path(paths[letter],pen)
                contours=[Polygon(r).buffer(0) for r in pen.rings]
                custom=contours[0]
                for hole in contours[1:]:custom=custom.difference(hole)
                cap=font['OS/2'].sCapHeight if hasattr(font['OS/2'],'sCapHeight') else font['head'].unitsPerEm*.72
                custom=scale(custom,xfact=cap,yfact=cap,origin=(0,0))
                pieces.append(translate(custom,xoff=cursor))
            else:pieces.extend(translate(p,xoff=cursor) for p in outer)
            cursor += font['hmtx'][name][0]
        shape=unary_union(pieces); x0,y0,x1,y1=shape.bounds
        shape=scale(translate(shape,-x0,-y0),xfact=1/(x1-x0),yfact=1/(y1-y0),origin=(0,0)).simplify(.0002,preserve_topology=True)
        polygons=list(shape.geoms) if shape.geom_type=='MultiPolygon' else [shape]
        coords=lambda r:[[round(x,6),round(y,6)] for x,y in list(r.coords)[:-1]]
        result[key]={'polygons':[{'outer':coords(p.exterior),'holes':[coords(r) for r in p.interiors]} for p in polygons]}
    if not add_only:result.update(public_logo())
    ASSET.write_text(json.dumps({'version':1,'outlines':result},separators=(',',':'))+'\n',encoding='utf-8')


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--font-dir',required=True)
    p.add_argument('--add-only',action='store_true',help='Add the four current storefront words without regenerating existing outlines.')
    args=p.parse_args();regenerate(args.font_dir,args.add_only)
