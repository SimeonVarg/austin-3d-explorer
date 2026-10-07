"""Inferred exterior approach for the existing Union south entrance tower.

Only the owning landscape bake calls this helper. Dimensions assume the scene's
flat plaza datum; they are neither survey data nor proof of accessible access.
"""
from copy import deepcopy
import math


T = dict(
    landing=[20.3, 33.4, -3.4, 0.0], grade=1.5,
    flights=[[20.3, 23.5], [30.2, 33.4]], stairFront=-6.6,
    stairBack=-3.4, stairCount=10,
    wall=[23.8, 29.9, -3.9, -3.35], wallTop=2.0,
    copingOverhang=.08, copingHeight=.15,
    bed=[23.8, 29.9, -4.9, -3.9], bedHeight=.14,
    bedEdge=.09, bedEdgeHeight=.18,
    flowerInset=.22, flowerRows=2, flowerPitch=.29,
    foliageRadius=.15, foliageHeight=.20, flowerRadius=.085,
    flowerHeight=.095, flowerLift=.13,
    stone=['#d8d0bc', '#e0d2b5', '#393930'],
    coping=['#e0d8c5', '#e8d7b8', '#414038'],
    foliage=['#52773c', '#7a8744', '#1b3021'],
    flowers=['#df7825', '#efa633', '#663a20'],
)


def apply_union_ground(output, model):
    """Append one place and its ground support without changing existing data."""
    assert model['id'] == '8a2648f5-9994-4d01-9b12-5c589b863c5a'
    name = 'Union south tower approach'
    places = output['gardens']['places']
    assert not any(p.get('name') == name for p in places), 'Compile the approach once'
    frame = model['frame']['obb']
    t = deepcopy(T)
    tower = next(b for b in model['blocks'] if b['id'] == 'entrance-tower')
    assert tower['plan'][:2] == t['landing'][:2]
    if model.get('unionEntrance'):
        assert model['unionEntrance']['parameters']['portalBottom'] == t['grade']

    def ll(u, v):
        return [round(frame['o'][0]+(u*frame['ax']-v*frame['ay'])/frame['mx'], 9),
                round(frame['o'][1]+(u*frame['ay']+v*frame['ax'])/frame['my'], 9)]

    def ring(rect):
        a,b,c,d = rect
        return [ll(u,v) for u,v in [(a,c),(b,c),(b,d),(a,d),(a,c)]]

    meshes = {key: dict(kind='detailMesh', colour=t[key], vertices=[], triangles=[])
              for key in ('stone', 'coping', 'foliage', 'flowers')}
    for key in ('stone', 'coping'):
        meshes[key]['structural'] = True
    floors = []

    def solid(key, vertices, faces):
        mesh = meshes[key]
        n = len(mesh['vertices'])
        mesh['vertices'].extend([*ll(u,v), z] for u,v,z in vertices)
        for face in faces:
            mesh['triangles'].extend([n+face[0], n+face[i], n+face[i+1]]
                                     for i in range(1,len(face)-1))

    def box(key, rect, bottom, top, support=False):
        a,b,c,d = rect
        assert a < b and c < d and bottom < top
        # Closed, outward-wound solids, including the hidden underside.
        solid(key, [[u,v,z] for z in (bottom,top)
                    for u,v in ((a,c),(b,c),(b,d),(a,d))],
              [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),
               (2,3,7,6),(3,0,4,7)])
        if support:
            floors.append(dict(rings=[ring(rect)], height=top, structural=True))

    box('stone', t['landing'], 0, t['grade'], support=True)
    for left,right in t['flights']:
        for i in range(t['stairCount']):
            front = t['stairFront']+(t['stairBack']-t['stairFront'])*i/t['stairCount']
            back = t['stairFront']+(t['stairBack']-t['stairFront'])*(i+1)/t['stairCount']
            box('stone', [left,right,front,back], 0,
                t['grade']*(i+1)/t['stairCount'], support=True)

    # The central monument is left unlettered. Its cap is ground geometry too:
    # the upstand must block a walker rather than admit them through the wall.
    box('stone', t['wall'], 0, t['wallTop'])
    a,b,c,d = t['wall']; e = t['copingOverhang']
    box('coping', [a-e,b+e,c-e,d+e], t['wallTop'],
        t['wallTop']+t['copingHeight'], support=True)

    a,b,c,d = t['bed']; e = t['bedEdge']
    bed = dict(kind='bed', height=t['bedHeight'], rings=[ring(t['bed'])], plants=True)
    for rect in ([a-e,b+e,c-e,c], [a-e,a,c,d], [b,b+e,c,d]):
        box('stone', rect, 0, t['bedEdgeHeight'])

    # Small low flower clumps complement the existing renderer's sparse shrubs.
    # All planting remains inside the bounded central bed, clear of both flights.
    def clump(key, u, v, bottom, radius, height):
        solid(key, [[u,v,bottom], [u+radius,v,bottom+height/2],
                    [u,v+radius,bottom+height/2], [u-radius,v,bottom+height/2],
                    [u,v-radius,bottom+height/2], [u,v,bottom+height]],
              [(0,2,1),(0,3,2),(0,4,3),(0,1,4),
               (5,1,2),(5,2,3),(5,3,4),(5,4,1)])
    count = max(1, math.floor((b-a-2*t['flowerInset'])/t['flowerPitch'])+1)
    for row in range(t['flowerRows']):
        v = c+t['flowerInset']+row*t['flowerPitch']
        for i in range(count):
            u = a+t['flowerInset']+i*t['flowerPitch']
            clump('foliage',u,v,t['bedHeight'],t['foliageRadius'],t['foliageHeight'])
            clump('flowers',u,v,t['bedHeight']+t['flowerLift'],t['flowerRadius'],t['flowerHeight'])

    places.append(dict(name=name, features=[*meshes.values(),bed],
        note='Inferred exterior landing, two flanking stair flights and central planted monument wall; dimensions and the flat plaza datum are approximate, not surveyed or an accessibility certification. No lettering or interior access is inferred.'))
    output.setdefault('walkableGround', []).extend(floors)
