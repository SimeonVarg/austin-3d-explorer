"""Check the authored Gearing courtyard and preserved campus context.

Pass a pre-change Git revision (the courtyard baseline is 5bd19d9) to compare
all other halls, original roof data and the protected main-wall faces. This is
a CPU geometry/data gate; it does not establish appearance or walking support.
"""
import collections
import json
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
data = json.loads((ROOT / 'data/campus_buildings.json').read_text(encoding='utf-8'))
model = next(b for b in data['buildings'] if b['code'] == 'GEA')


def closed(mesh):
    vertices, triangles = mesh['vertices'], mesh['triangles']
    assert vertices and triangles, 'Detail solids cannot be empty'
    assert all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in vertices)
    edges = collections.defaultdict(list)
    adjacency = collections.defaultdict(set)
    volumes = []
    for tri in triangles:
        assert len(tri) == len(set(tri)) == 3 and all(isinstance(i, int) and 0 <= i < len(vertices) for i in tri)
        a, b, c = [vertices[i] for i in tri]
        u, v = [[q[k]-a[k] for k in range(3)] for q in (b, c)]
        n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        assert sum(x*x for x in n) > 1e-16
        volumes.append(sum(a[k] * (b[(k+1)%3]*c[(k+2)%3]-b[(k+2)%3]*c[(k+1)%3]) for k in range(3))/6)
        for a, b in zip(tri, tri[1:]+tri[:1]):
            edges[tuple(sorted((a, b)))].append((a, b))
            adjacency[a].add(b)
            adjacency[b].add(a)
    assert all(len(v) == 2 and v[0] == v[1][::-1] for v in edges.values()), 'Every edge closes with opposite winding'
    assert set(adjacency) == set(range(len(vertices))), 'No unused vertices'
    unseen = set(adjacency)
    components = []
    while unseen:
        seed = unseen.pop()
        component, todo = {seed}, [seed]
        while todo:
            for vertex in adjacency[todo.pop()] - component:
                component.add(vertex)
                unseen.discard(vertex)
                todo.append(vertex)
        assert sum(volume for tri, volume in zip(triangles, volumes) if tri[0] in component) > 0, 'Each closed solid faces outward'
        components.append(component)
    return components


meshes = [m for m in model['detailMeshes'] if m['id'].startswith('gea-')]
assert len({m['id'] for m in meshes}) == len(meshes), 'Unique detail ownership'
solid_count = 0
solid_vertices = []
for mesh in meshes:
    components = closed(mesh)
    solid_count += len(components)
    solid_vertices.extend((mesh['tone'], [mesh['vertices'][i] for i in component]) for component in components)
    assert mesh['tone'] in model['colours'] and mesh['tone'] in model['materials']

# Both controls use real generated geometry, not an artificial valid fixture.
for label, triangles in (
    ('removed face', meshes[0]['triangles'][1:]),
    ('inward solid', [t[::-1] for t in meshes[0]['triangles']]),
):
    try:
        closed({**meshes[0], 'triangles': triangles})
    except AssertionError:
        pass
    else:
        raise AssertionError('The gate must detect a ' + label)

wall = next(b for b in model['blocks'] if b['id'] == 'gea-walls')
ring = wall['plan']['ring']
upper_t, court_t = model['gearingParameters'], model['gearingCourtParameters']
assert len(ring) == 10 and wall['cap'] is False and model['preserveRoof'] is True
assert upper_t['maxDetailTriangles'] <= 5000 and court_t['maxDetailTriangles'] <= 22000
upper_meshes = [m for m in meshes if not m['id'].startswith('gea-court-')]
court_meshes = [m for m in meshes if m['id'].startswith('gea-court-')]
triangle_counts = {}
for name, subset, limit in (
    ('upper', upper_meshes, upper_t['maxDetailTriangles']),
    ('courtyard', court_meshes, court_t['maxDetailTriangles']),
):
    triangle_counts[name] = sum(len(m['triangles']) for m in subset)
    assert subset and triangle_counts[name] <= limit, name + ' named triangle budget'


def validate_openings(block, edge):
    """The renderer clips openings to bands; reject accidental clipping here."""
    r = block['plan']['ring']
    length = math.dist(r[edge], r[(edge+1) % len(r)])
    bands = block.get('faces', {}).get(str(edge), {}).get('bands', block['bands'])
    last = block['z0']
    for band in bands:
        assert abs(band['z0'] - last) < 1e-7, 'No missing/overlapping wall bands'
        last = band['z1']
        openings = band.get('openings', [])
        assert band['skin'] in model['skins']
        for opening in openings:
            assert 0 <= opening['s0'] < opening['s1'] <= length + 1e-7
            assert band['z0'] <= opening['z0'] < opening['z1'] <= band['z1']
            assert opening['d'] > 0
            for key in ('tone', 'glass'):
                if opening.get(key):
                    assert opening[key] in model['colours'] and opening[key] in model['materials']
            if opening.get('arch'):
                arch = opening['arch']
                assert 0 < arch['rise'] < opening['z1'] - opening['z0']
                assert 8 <= arch['segments'] <= 48 and arch['trim'] > 0
            if opening.get('mullion'):
                m = opening['mullion']
                assert m['w'] > 0 and m['tone'] in model['materials']
                assert all(0 < f < 1 for f in m['cols'] + m['rows'])
        for i, a in enumerate(openings):
            for b in openings[i+1:]:
                assert min(a['s1'], b['s1']) <= max(a['s0'], b['s0']) or min(a['z1'], b['z1']) <= max(a['z0'], b['z0']), 'Overlapping opening rectangles'
    assert abs(last - block['z1']) < 1e-7


length = math.dist(ring[3], ring[5])
axis = [(ring[5][k]-ring[3][k])/length for k in range(2)]
upper, lower, doors = [], [], []
for edge in (3, 4):
    validate_openings(wall, edge)
    offset = sum((ring[edge][k]-ring[3][k])*axis[k] for k in range(2))
    bands = wall['faces'][str(edge)]['bands']
    assert len(bands) == 2 and bands[0]['z1'] == court_t['lowerBandTop']
    for band in bands:
        for opening in band.get('openings', []):
            item = (offset + (opening['s0']+opening['s1'])/2, opening)
            if opening.get('glass') == 'geaGlass':
                upper.append(item)
            elif opening.get('glass') == 'geaCourtGlass':
                lower.append(item)
            else:
                doors.append((offset, opening))
assert len(upper) == upper_t['bays'] == 8
assert all(abs(c-(i+.5)*length/8) < .001 for i, (c, _) in enumerate(sorted(upper))), 'Continuous upper bays across wall split'
assert all(o['z0'] == upper_t['windowBottom'] and o['z1'] == upper_t['windowTop'] and o['mullion']['tone'] == 'geaSash' for _, o in upper)
assert len(lower) == 24 and court_t['groups'] == [2, 3, 2, 3, 2]
row_centres = []
for z0, z1 in court_t['lowerRows']:
    row = sorted((c, o) for c, o in lower if o['z0'] == z0 and o['z1'] == z1)
    assert len(row) == 12
    centres = [c for c, _ in row]
    assert abs(centres[0]+centres[-1]-length) < .001, 'Centered lower window groups'
    group_ends = {sum(court_t['groups'][:i])-1 for i in range(1, len(court_t['groups']))}
    for i, (a, b) in enumerate(zip(centres, centres[1:])):
        gap = court_t['groupGap'] if i in group_ends else court_t['withinGap']
        assert abs(b-a-court_t['sashWidth']-gap) < .001, 'Continuous paired/tripartite group spacing'
    assert all('arch' not in o and abs(o['s1']-o['s0']-court_t['sashWidth']) < 1e-7 for _, o in row)
    row_centres.append(centres)
assert all(abs(a-b) < 1e-7 for a, b in zip(*row_centres)), 'Lower registers align vertically'
assert len(doors) == 2, 'One rear door split at the mapped wall vertex'
door_ranges = sorted((offset+o['s0'], offset+o['s1']) for offset, o in doors)
assert abs(door_ranges[0][1]-door_ranges[1][0]) < .001
assert abs(door_ranges[0][0]-(court_t['rearDoorCentre']-court_t['rearDoorWidth']/2)) < .001
assert abs(door_ranges[1][1]-(court_t['rearDoorCentre']+court_t['rearDoorWidth']/2)) < .001
assert all(o['z0'] == court_t['grade'] and o['z1'] > court_t['rearDoorCrown'] and o['d'] == court_t['rearDoorDepth'] for _, o in doors)
assert abs(court_t['rearDoorCentre']-math.dist(ring[3], ring[4])) < .001, 'Door stile must cover the renderer split jambs'
normal = [axis[1], -axis[0]]
stiles = []
for tone, points in solid_vertices:
    if tone != 'geaDoor':
        continue
    local = [[sum((p[k]-ring[3][k])*v[k] for k in range(2)) for v in (axis, normal)] + [p[2]] for p in points]
    lo, hi = [[fn(p[k] for p in local) for k in range(3)] for fn in (min, max)]
    c = court_t['rearDoorCentre']
    if lo[0] < c < hi[0] and abs(hi[0]-lo[0]-court_t['doorStile']) < 1e-5:
        assert lo[1] <= -court_t['rearDoorDepth'] + 1e-5 and hi[1] > 0
        assert lo[2] <= court_t['grade'] and hi[2] >= court_t['rearDoorCrown']
        stiles.append(points)
assert len(stiles) == 1, 'One closed full-depth central door stile'

for edge in (2, 5):
    validate_openings(wall, edge)
    openings = wall['faces'][str(edge)]['bands'][0]['openings']
    assert len(openings) == 18 and all(o.get('glass') == 'geaCourtGlass' and 'arch' not in o for o in openings)
    assert sum([o['z0'], o['z1']] == court_t['sideUpperRow'] for o in openings) == 6
    assert sum([o['z0'], o['z1']] == court_t['lowerRows'][0] for o in openings) == 6
    assert sum([o['z0'], o['z1']] == court_t['lowerRows'][1] for o in openings) == 4
    balcony_doors = [o for o in openings if o['z0'] == court_t['balconyBase']+court_t['balconySlab'] and o['z1'] == court_t['balconyDoorTop']]
    assert len(balcony_doors) == 2, 'Both balcony doors start at the slab top'
    edge_length = math.dist(ring[edge], ring[edge+1])
    for opening in balcony_doors:
        span = [opening['s0'], opening['s1']] if edge == 2 else [edge_length-opening['s1'], edge_length-opening['s0']]
        assert court_t['balconyV'][0] <= span[0] < span[1] <= court_t['balconyV'][1]

towers = [b for b in model['blocks'] if b['id'].startswith('gea-court-tower-')]
assert len(towers) == 2 and len({b['id'] for b in towers}) == 2
for i, tower in enumerate(towers):
    u0, u1, v0, v1 = court_t['towerRects'][i]
    assert tower['plan'] == {'ring': [[u0,v0],[u1,v0],[u1,v1],[u0,v1]], 'holes': []}
    assert tower['cap'] is True and tower['roofTone'] == 'geaTile'
    assert tower['z0'] == court_t['towerBottom'] < wall['z1'] < tower['z1'] == court_t['towerTop']
    assert set(tower['faces']) == {'0'}, 'Tower opening faces the court'
    for edge in range(4):
        validate_openings(tower, edge)
    opening, = tower['faces']['0']['bands'][0]['openings']
    assert opening['z0'] == court_t['towerOpeningBottom'] and opening['z1'] == court_t['towerOpeningTop']
    assert opening['arch']['rise'] == court_t['towerOpeningRise']
    assert abs((opening['s0']+opening['s1'])/2-(u1-u0)/2) < 1e-7

# Clear passage and canopy height constraints, including tile + soffit thickness.
assert court_t['rearDoorSpring'] > court_t['grade'] and court_t['sideArchSpring'] > court_t['grade']
assert court_t['rearDoorCrown'] > court_t['rearDoorSpring']
assert court_t['sideArchHead'] > court_t['sideArchCrown'] > court_t['sideArchSpring']
assert court_t['arcadeHigh']-court_t['arcadeTile']-.09 > court_t['rearDoorCrown']
assert court_t['gateOpening']-2*court_t['gateLeafWidth'] > 2
assert court_t['gateHeight']-court_t['gateFrieze'] > 2, 'Open gate has standing headroom'


def vertical_hits(point, tones):
    """Intersect the baked triangles, independently of the canopy generator."""
    hits = []
    for mesh in court_meshes:
        if mesh['tone'] not in tones:
            continue
        for tri in mesh['triangles']:
            a, b, c = [mesh['vertices'][i] for i in tri]
            u, v = [[p[k]-a[k] for k in range(2)] for p in (b, c)]
            w = [point[k]-a[k] for k in range(2)]
            determinant = u[0]*v[1]-u[1]*v[0]
            if abs(determinant) < 1e-10:
                continue
            s = (w[0]*v[1]-w[1]*v[0])/determinant
            t = (u[0]*w[1]-u[1]*w[0])/determinant
            if s >= -1e-7 and t >= -1e-7 and s+t <= 1+1e-7:
                hits.append(a[2]+s*(b[2]-a[2])+t*(c[2]-a[2]))
    return sorted(hits)


for u in (ring[2][0]+court_t['arcadeDepth']/2, ring[6][0]-court_t['arcadeDepth']/2):
    point = [u, court_t['sideArchV']]
    stone = vertical_hits(point, {'geaAshlar'})
    canopy = vertical_hits(point, {'geaTile', 'geaSoffit', 'geaTimber'})
    assert stone and canopy and abs(stone[0]-court_t['sideArchCrown']) < 1e-5
    assert canopy[0] > stone[0]+.03, 'Side canopy must not close the arch crown'
for offset in (-.5, .5):
    # Avoid the intentional central stile; both door leaves retain clear heads.
    point = [ring[3][k]+(court_t['rearDoorCentre']+offset)*axis[k] for k in range(2)]
    stone = vertical_hits(point, {'geaAshlar'})
    canopy = vertical_hits(point, {'geaTile', 'geaSoffit', 'geaTimber'})
    assert stone and canopy and stone[0] > court_t['rearDoorSpring']
    assert canopy[0] > stone[-1]+.02, 'Rear canopy must clear the arch spandrel'

if len(sys.argv) > 1:
    base = json.loads(subprocess.check_output(['git', 'show', sys.argv[1]+':data/campus_buildings.json'], cwd=ROOT))
    old = next(b for b in base['buildings'] if b['code'] == 'GEA')
    others = [b for b in data['buildings'] if b['code'] != 'GEA']
    assert [b for b in base['buildings'] if b['code'] != 'GEA'] == others
    assert {k:v for k,v in base.items() if k != 'buildings'} == {k:v for k,v in data.items() if k != 'buildings'}
    for key in ('name', 'id', 'code', 'footprint', 'frame', 'levels', 'preserveRoof', 'replaceFrontage'):
        assert old[key] == model[key], key
    before, after = old['blocks'][0], wall
    for key in before.keys() | after.keys():
        if key != 'faces':
            assert before.get(key) == after.get(key), key
    for edge in set(before.get('faces', {})) | set(after.get('faces', {})):
        if int(edge) not in (2, 3, 4, 5):
            assert before.get('faces', {}).get(edge) == after.get('faces', {}).get(edge), 'Protected exterior face ' + edge
    assert [b for b in model['blocks'] if b['id'] != wall['id'] and not b['id'].startswith('gea-court-tower-')] == [b for b in old['blocks'] if b['id'] != wall['id']]
    # The upper sash/panel proportions and casing material intentionally
    # change in this pass. Its already joined roof, soffit and brackets do not.
    for key, value in old['gearingParameters'].items():
        if key.startswith(('eave', 'roof', 'bracket')) or key == 'tileThickness':
            assert model['gearingParameters'][key] == value, 'Protected upper roof parameter ' + key
    for tone in ('geaTile', 'geaSoffit', 'geaTimber'):
        assert [m for m in old['detailMeshes'] if m['id'] == 'gea-'+tone] == [m for m in model['detailMeshes'] if m['id'] == 'gea-'+tone], 'Protected eave mesh ' + tone
    for roof_file in ('data/roofs.geojson', 'data/roof_runs.json'):
        prior = json.loads(subprocess.check_output(['git', 'show', sys.argv[1]+':'+roof_file], cwd=ROOT))
        assert prior == json.loads((ROOT / roof_file).read_text(encoding='utf-8')), roof_file + ' unchanged'
print(f'PASS {solid_count} closed outward solids; missing-face/inward controls; 8 upper + 24 rear rectangular + 36 side openings (4 balcony doors); split rear door and closed stile; two capped towers; triangles {triangle_counts}' + (f'; {len(others)} other halls, exterior faces and original roof data unchanged vs {sys.argv[1]}' if len(sys.argv) > 1 else '; baseline comparison not requested'))
