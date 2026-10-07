"""Gearing's rear court upper window band and connected bracketed eave.

Facade dimensions are editable exterior-view interpretations, not a survey.
The mapped footprint and main roof rig remain authoritative. The companion
court helper completes the lower architecture around the retained access ramp.
"""
import copy
import math


T = dict(
    faces=[3, 4], bays=8, upperStart=9.1,
    windowWidth=1.80, windowBottom=11.38, windowTop=12.96,
    windowDepth=.34, windowLit=False, frameWidth=.11, frameDepth=.095,
    glassClearance=.015, mullionWidth=.065, cols=[1/3, 2/3], rows=[.5],
    panelBottom=10.28, panelTop=11.20, panelProud=.055,
    panelBorder=.12, panelInset=.025,
    courseBottom=10.04, courseHeight=.18, courseDepth=.26,
    sillHeight=.12, sillDepth=.19, surroundWidth=.13, surroundDepth=.1,
    wallEmbed=.025, eaveOut=.95, eaveUnderside=13.56,
    eaveFrontTop=14.28, tileThickness=.13,
    # Existing full-hip front edge in the building metre frame, including
    # its skew relative to the two court wall segments. Check these against
    # the roof rig if that separately owned bake changes.
    roofEdge=[[13.885, 16.448], [47.912, 18.079]],
    roofLip=14.25, roofPitch=.42, roofJoinRun=.85, roofEmbed=.045,
    bracketWidth=.17, bracketDrop=.53, bracketOut=.83,
    bracketKnee=.40, bracketTipDrop=.13, bracketBack=.025,
    maxDetailTriangles=5000,
)
COLOURS = dict(geaStone='#d4c9b4', geaPale='#e2d9c4',
    geaPanel='#d8d0b8', geaSash='#403b33', geaGlass='#3d4c4b',
    geaTimber='#65503a',
    # Continue the existing Gearing roof's day/golden/night tile palette.
    geaTile=['#a04b2f', '#b96139', '#11111c'], geaSoffit='#a8987b')
# The upper band is smooth rendered infill, unlike the coursed lower walls.
MATERIALS = dict(geaStone='plain', geaPale='plain', geaPanel='plain',
    geaSash='plain', geaGlass='glass', geaTimber='plain',
    geaTile='plain', geaSoffit='plain')


class Details:
    """Closed convex solids, with winding checked in final local coordinates."""
    def __init__(self, origin, axis):
        self.origin, self.axis = origin, axis
        self.normal = [axis[1], -axis[0]]
        self.meshes = {}

    def solid(self, tone, points, faces):
        pts = [[self.origin[k] + s*self.axis[k] + d*self.normal[k]
                for k in range(2)] + [z] for s, d, z in points]
        center = [sum(p[k] for p in pts)/len(pts) for k in range(3)]
        mesh = self.meshes.setdefault(tone, dict(id='gea-'+tone, tone=tone,
                                                 vertices=[], triangles=[]))
        off = len(mesh['vertices'])
        mesh['vertices'].extend([[round(v, 6) for v in p] for p in pts])
        for face in faces:
            # Orient the whole face using its area-weighted normal. A roof
            # quad can be gently twisted by the skewed rear edge; testing
            # each triangle against the solid centre separately can reverse
            # only half of a thin tile face and break its closed winding.
            normal = [0., 0., 0.]
            for j, index in enumerate(face):
                p, q = pts[index], pts[face[(j+1) % len(face)]]
                normal[0] += (p[1]-q[1])*(p[2]+q[2])
                normal[1] += (p[2]-q[2])*(p[0]+q[0])
                normal[2] += (p[0]-q[0])*(p[1]+q[1])
            middle = [sum(pts[i][k] for i in face)/len(face) for k in range(3)]
            reverse = sum(normal[k]*(middle[k]-center[k]) for k in range(3)) < 0
            for j in range(1, len(face)-1):
                tri = [face[0], face[j], face[j+1]]
                a, b, c = [pts[i] for i in tri]
                u = [b[k]-a[k] for k in range(3)]
                v = [c[k]-a[k] for k in range(3)]
                n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2],
                     u[0]*v[1]-u[1]*v[0]]
                assert sum(x*x for x in n) > 1e-16, 'Degenerate Gearing detail'
                if reverse:
                    tri[1], tri[2] = tri[2], tri[1]
                mesh['triangles'].append([off+i for i in tri])

    def box(self, tone, s0, s1, d0, d1, z0, z1):
        assert s1 > s0 and d1 > d0 and z1 > z0
        self.solid(tone, [[s, d, z] for z in (z0, z1)
                         for s, d in ((s0, d0), (s1, d0), (s1, d1), (s0, d1))],
                   [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
                    (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])


def refine(model, profile):
    if model.get('code') != 'GEA':
        return model
    t = copy.deepcopy({**T, **profile.get('gearingDetail', {})})
    colours = {**COLOURS, **profile.get('gearingColours', {})}
    result = copy.deepcopy(model)
    wall = result['blocks'][0]
    ring = wall['plan']['ring']
    edges = t['faces']
    assert len(ring) == 10 and edges == [3, 4], 'Recheck Gearing court topology'
    assert wall['z0'] <= t['upperStart'] < t['windowBottom'] < t['windowTop'] < wall['z1']
    a, b = ring[edges[0]], ring[edges[-1]+1]
    length = math.dist(a, b)
    axis = [(b[k]-a[k])/length for k in range(2)]
    area = sum(p[0]*ring[(i+1)%len(ring)][1]-ring[(i+1)%len(ring)][0]*p[1]
               for i, p in enumerate(ring))
    assert area > 0, 'Gearing detail requires the existing CCW outline'
    assert abs((ring[4][0]-a[0])*axis[1]-(ring[4][1]-a[1])*axis[0]) < .01
    centres = [(i+.5)*length/t['bays'] for i in range(t['bays'])]
    result['colours'].update({k: dict(hex=v) for k, v in colours.items()})
    result.setdefault('materials', {}).update({**MATERIALS, **profile.get('gearingMaterials', {})})
    result['skins']['geaCourtUpper'] = dict(kind='flat', field='geaStone')
    faces = wall.setdefault('faces', {})
    assigned = 0
    # Use one global pitch; only convert to each edge's local s at the final
    # opening assignment. No bay is recentered at the middle ring vertex.
    for edge in edges:
        p, q = ring[edge], ring[edge+1]
        edge_length = math.dist(p, q)
        start = sum((p[k]-a[k])*axis[k] for k in range(2))
        old = copy.deepcopy(faces.get(str(edge), {}).get('bands', wall['bands']))
        lower = []
        for band in old:
            if band['z0'] < t['upperStart']:
                band['z1'] = min(band['z1'], t['upperStart'])
                lower.append(band)
        openings = []
        for c in centres:
            s = c-start
            if 0 <= s < edge_length:
                half = t['windowWidth']/2
                assert s-half > 0 and s+half < edge_length, 'Window crosses face split'
                openings.append(dict(s0=s-half, s1=s+half,
                    z0=t['windowBottom'], z1=t['windowTop'], d=t['windowDepth'],
                    glass='geaGlass', tone='geaStone', lit=t['windowLit'],
                    mullion=dict(cols=t['cols'], rows=t['rows'],
                                 w=t['mullionWidth'], tone='geaSash')))
        assigned += len(openings)
        face = faces.setdefault(str(edge), {})
        face['bands'] = lower + [dict(z0=t['upperStart'], z1=wall['z1'],
                                      skin='geaCourtUpper', openings=openings)]
    assert assigned == t['bays']
    m = Details(a, axis)
    back = -t['windowDepth'] + t['glassClearance']
    for c in centres:
        lo, hi = c-t['windowWidth']/2, c+t['windowWidth']/2
        z0, z1 = t['windowBottom'], t['windowTop']
        fw = t['frameWidth']
        # Sash sits inside the genuine cut-out, ahead of its glass plane.
        for x in (lo, hi-fw):
            m.box('geaSash', x, x+fw, back, back+t['frameDepth'], z0, z1)
        for z in (z0, z1-fw):
            m.box('geaSash', lo+fw, hi-fw, back, back+t['frameDepth'], z, z+fw)
        sw = t['surroundWidth']
        for x0, x1 in ((lo-sw, lo), (hi, hi+sw)):
            m.box('geaSash', x0, x1, -t['wallEmbed'], t['surroundDepth'], z0, z1)
        m.box('geaSash', lo-sw, hi+sw, -t['wallEmbed'], t['surroundDepth'], z1, z1+sw)
        m.box('geaPale', lo-sw, hi+sw, -t['wallEmbed'], t['sillDepth'], z0-t['sillHeight'], z0)
        # Raised border with recessed pale infill, closed solid through wall.
        pb, pt, bw = t['panelBottom'], t['panelTop'], t['panelBorder']
        m.box('geaPanel', lo, hi, -t['wallEmbed'], t['panelProud']-t['panelInset'], pb, pt)
        for x0, x1 in ((lo-bw, lo), (hi, hi+bw)):
            m.box('geaPale', x0, x1, -t['wallEmbed'], t['panelProud'], pb-bw, pt+bw)
        for z0, z1 in ((pb-bw, pb), (pt, pt+bw)):
            m.box('geaPale', lo, hi, -t['wallEmbed'], t['panelProud'], z0, z1)
    m.box('geaPale', 0, length, -t['wallEmbed'], t['courseDepth'],
          t['courseBottom'], t['courseBottom']+t['courseHeight'])

    # Intersect facade-normal rays with the unchanged roof's skewed front
    # edge. Extend beneath its rising slope and bury the rear tile seam.
    r0, r1 = t['roofEdge']
    rx, ry = r1[0]-r0[0], r1[1]-r0[1]
    nx, ny = m.normal
    cross = nx*ry-ny*rx
    assert abs(cross) > 1e-6
    joins = []
    for s in (0, length):
        p = [a[k]+s*axis[k] for k in range(2)]
        depth = ((r0[0]-p[0])*ry-(r0[1]-p[1])*rx)/cross
        assert -1.5 < depth < .1, 'Roof edge moved; recheck the eave join'
        joins.append(depth-t['roofJoinRun'])
    rear_top = t['roofLip']+t['roofPitch']*t['roofJoinRun']-t['roofEmbed']
    corners = [(0, t['eaveOut']), (length, t['eaveOut']),
               (length, joins[1]), (0, joins[0])]
    top = [t['eaveFrontTop'], t['eaveFrontTop'], rear_top, rear_top]
    fs = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
          (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    lower = [[s, d, t['eaveUnderside']] for s, d in corners]
    join = [[s, d, z-t['tileThickness']] for (s, d), z in zip(corners, top)]
    m.solid('geaSoffit', lower+join, fs)
    m.solid('geaTile', join+[[s, d, z] for (s, d), z in zip(corners, top)], fs)
    # Nine brackets line up with the eight bay boundaries. Convex five-point
    # sections make every closed side triangulable without a concave fan.
    for i in range(t['bays']+1):
        c = i*length/t['bays']
        c = max(t['bracketWidth']/2, min(length-t['bracketWidth']/2, c))
        z = t['eaveUnderside']
        section = [(-t['bracketBack'], z), (t['bracketOut'], z),
                   (t['bracketOut'], z-t['bracketTipDrop']),
                   (t['bracketKnee'], z-t['bracketDrop']),
                   (-t['bracketBack'], z-t['bracketDrop'])]
        n = len(section)
        pts = [[s, d, zz] for s in (c-t['bracketWidth']/2, c+t['bracketWidth']/2)
               for d, zz in section]
        m.solid('geaTimber', pts, [tuple(range(n)), tuple(range(n, 2*n))] +
                [(j, (j+1)%n, (j+1)%n+n, j+n) for j in range(n)])
    meshes = list(m.meshes.values())
    assert sum(len(x['triangles']) for x in meshes) <= t['maxDetailTriangles']
    assert all(math.isfinite(v) for x in meshes for p in x['vertices'] for v in p)
    result['detailMeshes'] = [x for x in result.get('detailMeshes', [])
                              if not x['id'].startswith('gea-')] + meshes
    result['gearingParameters'] = t
    result['sources']['gearingDetail'] = (
        'Exterior views inform the rear court upper paired/tripartite window band, '
        'pale panels, sillcourse and bracketed eave. Dimensions are approximate. '
        'The mapped footprint, wall height, floors and main roof rig are retained.')
    from campus_gearing_court import refine_court
    return refine_court(result, profile, Details)
