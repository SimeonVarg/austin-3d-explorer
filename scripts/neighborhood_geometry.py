"""Shared, side-effect-free geometry for the neighborhood's independent bakes."""
import math
from shapely.geometry import Polygon, shape
from shapely.geometry.polygon import orient

METRES_LAT = 111320


def local_frame(geometry, angle=5):
    g = shape(geometry)
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda p: p.area)
    g = orient(g, sign=1)
    ring = [list(p) for p in g.exterior.coords]
    holes = [[list(p) for p in r.coords] for r in g.interiors]
    mx = METRES_LAT * math.cos(math.radians(g.centroid.y))
    ax, ay = math.cos(math.radians(angle)), -math.sin(math.radians(angle))
    origin = ring[0]
    points = [((p[0]-origin[0])*mx*ax + (p[1]-origin[1])*METRES_LAT*ay,
               -(p[0]-origin[0])*mx*ay + (p[1]-origin[1])*METRES_LAT*ax) for p in ring[:-1]]
    u, v = min(p[0] for p in points), min(p[1] for p in points)
    f = dict(o=[origin[0]+(u*ax-v*ay)/mx, origin[1]+(u*ay+v*ax)/METRES_LAT],
             ax=ax, ay=ay, mx=mx, my=METRES_LAT,
             L=max(p[0] for p in points)-u, W=max(p[1] for p in points)-v)
    plan = dict(ring=[uv(f, p) for p in ring[:-1]], holes=[[uv(f, p) for p in r[:-1]] for r in holes])
    return f, plan, dict(ring=ring, holes=holes)


def uv(f, p):
    x, y = (p[0]-f['o'][0])*f['mx'], (p[1]-f['o'][1])*f['my']
    return [round(x*f['ax']+y*f['ay'], 3), round(-x*f['ay']+y*f['ax'], 3)]


def ll(f, p):
    return [f['o'][0]+(p[0]*f['ax']-p[1]*f['ay'])/f['mx'],
            f['o'][1]+(p[0]*f['ay']+p[1]*f['ax'])/f['my']]


def normalized_plan(f, points):
    return [[round(u*f['L'], 3), round(v*f['W'], 3)] for u, v in points]


def rect(f, bounds):
    u0, u1, v0, v1 = bounds
    return [round(u0*f['L'], 3), round(u1*f['L'], 3), round(v0*f['W'], 3), round(v1*f['W'], 3)]


def band(z0, z1, skin, **kwargs):
    return dict(z0=round(z0, 3), z1=round(z1, 3), skin=skin, **kwargs)


def street_edges(plan, toward=(1, 0), minimum=2):
    """Outward-facing real outline edges; no storefronts on rear/party walls."""
    ring = plan['ring']
    out = []
    for i, (a, b) in enumerate(zip(ring, ring[1:]+ring[:1])):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        if length >= minimum and (dy*toward[0]-dx*toward[1])/length > .7:
            out.append((str(i), length))
    return out


def validate(buildings):
    assert len({b['id'] for b in buildings}) == len(buildings), 'Duplicate building identity'
    for b in buildings:
        footprint = b['footprint']
        g = Polygon(footprint['ring'], footprint.get('holes', []))
        assert g.is_valid and not g.is_empty, b['name']
        for block in b['blocks']:
            assert block['z1'] > block['z0'], (b['name'], block['id'])
