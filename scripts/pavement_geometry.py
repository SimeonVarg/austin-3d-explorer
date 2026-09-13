"""Final pavement boundaries against the carriageways actually rendered."""
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, clip_by_rect
from shapely.strtree import STRtree

# Geometric tolerance, not an artistic road-width change. Discard only dust.
MIN_AREA_DEGREES = 1e-13


def is_pavement(properties):
    return (properties.get('k') in ('patharea', 'pathslab') or
            (properties.get('k') == 'bank' and properties.get('u') == 'kerb'))


def trim_rendered_pavement(features, stats):
    roads = [shape(f['geometry']).buffer(0) for f in features
             if f['properties'].get('k') == 'roadarea']
    tree = STRtree(roads)
    result = []
    for f in features:
        # Both the physical slab and its scoring must use the same cut. The
        # final road polygons already contain the pedestrian-mall exclusions.
        if not is_pavement(f['properties']):
            result.append(f)
            continue
        g = shape(f['geometry']).buffer(0)
        # A connected arterial can contain thousands of vertices kilometres
        # outside this walk. Crop those cutters before the overlay, preserving
        # a margin so the crop edge cannot touch the polygon being resolved.
        x0, y0, x1, y1 = g.bounds
        margin = 1e-7
        nearby = [clip_by_rect(roads[int(i)], x0-margin, y0-margin,
                              x1+margin, y1+margin).buffer(0) for i in tree.query(g)]
        if not nearby:
            result.append(f)
            continue
        road = unary_union(nearby)
        if g.intersection(road).area <= MIN_AREA_DEGREES:
            result.append(f)
            continue
        clipped = g.difference(road)
        kind = 'kerb' if f['properties']['k']=='bank' else f['properties']['k']
        stats['pavement_trimmed_'+kind] += 1
        parts = [clipped] if clipped.geom_type == 'Polygon' else list(getattr(clipped, 'geoms', []))
        for part in parts:
            if part.geom_type != 'Polygon' or part.area <= MIN_AREA_DEGREES:
                continue
            # Retain intersection precision. Re-rounding to the old six decimal
            # places can put a 10cm strip back over the neighbouring road.
            result.append(dict(f, geometry=mapping(part)))
    return result
