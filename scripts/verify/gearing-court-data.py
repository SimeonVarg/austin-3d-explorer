"""Check the closed eave/sash solids and unchanged campus context.

Pass a pre-change Git revision to compare the other halls and lower Gearing.
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
    assert all(math.isfinite(v) for p in vertices for v in p)
    edges = collections.defaultdict(list)
    adjacency = collections.defaultdict(set)
    volumes = []
    for tri in triangles:
        assert len(set(tri)) == 3 and all(0 <= i < len(vertices) for i in tri)
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
    unseen = set(adjacency)
    while unseen:
        seed = unseen.pop()
        component, todo = {seed}, [seed]
        while todo:
            for vertex in adjacency[todo.pop()] - component:
                component.add(vertex)
                unseen.discard(vertex)
                todo.append(vertex)
        assert sum(volume for tri, volume in zip(triangles, volumes) if tri[0] in component) > 0, 'Each closed solid faces outward'


meshes = [m for m in model['detailMeshes'] if m['id'].startswith('gea-')]
for mesh in meshes:
    closed(mesh)
broken = {**meshes[0], 'triangles': meshes[0]['triangles'][1:]}
try:
    closed(broken)
except AssertionError:
    pass
else:
    raise AssertionError('The gate must detect a removed face')

wall = model['blocks'][0]
ring = wall['plan']['ring']
windows = []
for edge in (3, 4):
    offset = math.dist(ring[3], ring[edge])
    bands = wall['faces'][str(edge)]['bands']
    for band in bands:
        for opening in band.get('openings', []):
            assert opening['s0'] > 0 and opening['s1'] < math.dist(ring[edge], ring[edge+1])
            assert band['z0'] < opening['z0'] < opening['z1'] < band['z1']
            windows.append(offset + (opening['s0']+opening['s1'])/2)
assert len(windows) == 8
pitch = math.dist(ring[3], ring[5])/8
assert all(abs(c-(i+.5)*pitch) < .001 for i, c in enumerate(windows)), 'Continuous spacing across the wall split'
assert sum(len(m['triangles']) for m in meshes) <= 5000

if len(sys.argv) > 1:
    base = json.loads(subprocess.check_output(['git', 'show', sys.argv[1]+':data/campus_buildings.json'], cwd=ROOT))
    old = next(b for b in base['buildings'] if b['code'] == 'GEA')
    assert [b for b in base['buildings'] if b['code'] != 'GEA'] == [b for b in data['buildings'] if b['code'] != 'GEA']
    for key in ('footprint', 'frame', 'levels', 'preserveRoof', 'replaceFrontage'):
        assert old[key] == model[key], key
    before, after = old['blocks'][0], wall
    for key in before.keys() | after.keys():
        if key != 'faces':
            assert before.get(key) == after.get(key), key
    for edge in range(len(ring)):
        a = before.get('faces', {}).get(str(edge), {}).get('bands', before['bands'])
        b = after.get('faces', {}).get(str(edge), {}).get('bands', after['bands'])
        def below(bands):
            return [{**v, 'z1': min(v['z1'], 9.1)} for v in bands if v['z0'] < 9.1]
        assert (below(a) == below(b)) if edge in (3, 4) else a == b
print('PASS closed Gearing details, deliberate missing-face failure, eight continuous openings and bounded triangles' + ('; baseline preservation checked' if len(sys.argv) > 1 else '; baseline comparison not requested'))
