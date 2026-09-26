"""Union exterior geometry and scope gate; browser appearance remains separate."""
import collections, copy, json, math, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from bake_union import build, build_base
from campus_union import refine
baseline=json.loads(subprocess.check_output(['git','show',sys.argv[1]+':data/apartments/texas-union.json'],cwd=ROOT))
model=json.loads((ROOT/'data/apartments/texas-union.json').read_text(encoding='utf-8'))
assert build_base()==baseline, 'Dedicated bake must reproduce the original asset exactly'
original=copy.deepcopy(baseline)
assert refine(baseline)==model==build()==build(), 'Deterministic baked output'
assert baseline==original, 'Input cannot be mutated'
for key in ('footprint','frame','levels','preserveRoof'):
    assert model[key]==baseline[key], key
old={b['id']:b for b in baseline['blocks']}
for b in model['blocks']:
    prior=old[b['id']]
    for key in ('plan','z0','z1','roof','cap','roofTone'):
        assert b.get(key)==prior.get(key), (b['id'],key)
wing=model['blocks'][0]; original_wing=baseline['blocks'][0]
for key,value in original_wing.items():
    if key!='faces':assert wing[key]==value, key
covered=model['unionEntrance']['coveredWingFaces']
for i in range(len(wing['plan']['ring'])):
    if i in covered:assert wing['faces'][str(i)] is None
    else:assert wing['faces'].get(str(i))==original_wing.get('faces',{}).get(str(i))

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

tower=next(b for b in model['blocks'] if b['id']=='entrance-tower')
assert set(tower['faces'])=={'v0'}
openings=tower['faces']['v0']['bands'][0]['openings'];assert len(openings)==8
for i,a in enumerate(openings):
    assert 0<=a['s0']<a['s1']<=13.1 and 0<=a['z0']<a['z1']<=18.3 and 0<a['d']<1.5
    for b in openings[i+1:]:
        assert min(a['s1'],b['s1'])<=max(a['s0'],b['s0']) or min(a['z1'],b['z1'])<=max(a['z0'],b['z0']), 'Openings cannot intersect'
assert openings[0]['arch']['tone']=='unionPale' and openings[0]['tone']=='unionVault'
assert all(not a['lit'] for a in openings)
meshes=[m for m in model['detailMeshes'] if m['id'].startswith('union-entrance-')]
assert len({m['id'] for m in meshes})==len(meshes)
solids=sum(len(closed(m)) for m in meshes)
assert solids==len(model['unionEntrance']['detailSolids'])
for m in meshes:
    assert m['tone'] in model['colours'] and m['tone'] in model['materials']
for triangles in (meshes[0]['triangles'][1:],[t[::-1] for t in meshes[0]['triangles']]):
    try:closed({**meshes[0],'triangles':triangles})
    except AssertionError:pass
    else:raise AssertionError('Damaged or inward geometry must fail')
assert sum(len(m['triangles']) for m in meshes)==model['unionEntrance']['detailTriangles']<=12000
land=json.loads((ROOT/'data/campus_landscape.json').read_text(encoding='utf-8'))
oldland=json.loads(subprocess.check_output(['git','show',sys.argv[1]+':data/campus_landscape.json'],cwd=ROOT))
for key in oldland:
    if key not in ('trees','treeRepairs','gardens','walkableGround'):assert land[key]==oldland[key], key
assert len(land['trees'])==len(oldland['trees']), 'Keep tree array indices: they seed geometry'
changed=[(a,b) for a,b in zip(oldland['trees'],land['trees']) if a!=b]
assert len(changed)==1
prior,suppressed=changed[0]
assert prior[8]=='imagery' and prior[:2]==[-97.7412652,30.2859702]
assert suppressed==prior[:6]+[2]+prior[7:]
assert land['treeRepairs']=={**oldland['treeRepairs'],'unionApproach':1}
for density in (.2,.52,.675,1):
    old_visible=[(i,t) for i,t in enumerate(oldland['trees']) if t[6]<=density and t!=prior]
    new_visible=[(i,t) for i,t in enumerate(land['trees']) if t[6]<=density]
    assert old_visible==new_visible, 'Every retained visible tree keeps its seed and record'

print(f'PASS: {solids} closed outward solids, {model["unionEntrance"]["detailTriangles"]} triangles; baseline shell/roofs and retained landscape exact; damaged geometry rejected.')

assert land['gardens']['places'][:-1]==oldland['gardens']['places']
assert {k:v for k,v in land['gardens'].items() if k!='places'}=={k:v for k,v in oldland['gardens'].items() if k!='places'}
assert land['walkableGround'][:-22]==oldland['walkableGround']
approach=land['gardens']['places'][-1];assert approach['name']=='Union south tower approach'
from campus_union_ground import T as ground_t, apply_union_ground
assert ground_t['grade']==model['unionEntrance']['parameters']['portalBottom']
F=model['frame']['obb']
def uv(p):
    x=(p[0]-F['o'][0])*F['mx'];y=(p[1]-F['o'][1])*F['my']
    return [x*F['ax']+y*F['ay'],-x*F['ay']+y*F['ax']]+p[2:]
count=0
for m in approach['features']:
    if m['kind']=='detailMesh':
        local={**m,'vertices':[uv(p) for p in m['vertices']]};count+=len(closed(local))
        assert all(20.2998<=p[0]<=33.4002 and -6.6002<=p[1]<=.0002 and 0<=p[2]<=2.15 for p in local['vertices'])
for i in range(10):
    for flight in range(2):
        f=land['walkableGround'][-22:][1+flight*10+i]
        assert abs(f['height']-.15*(i+1))<1e-12
        points=[uv(p) for p in f['rings'][0]]
        assert abs(min(p[1] for p in points)-(-6.6+.32*i))<.0002
        assert abs(max(p[1] for p in points)-(-6.6+.32*(i+1)))<.0002
from shapely.geometry import Point, Polygon
floors=[(Polygon([uv(p)[:2] for p in f['rings'][0]]),f['height']) for f in land['walkableGround'][-22:]]
height=lambda u,v:max([z for poly,z in floors if poly.covers(Point(u,v))]+[0])
for u in (21.9,26.85,31.8):assert abs(height(u,-2.2)-1.5)<.001
assert height(26.85,-3.6)==2.15 and height(21.9,-8)==0
baseline_ground=copy.deepcopy(oldland)
apply_union_ground(baseline_ground,model)
assert baseline_ground['gardens']==land['gardens'] and baseline_ground['walkableGround']==land['walkableGround']
print(f'PASS: approach {count} closed solids, two ten-step flights, cross-landing and obstacle height; existing gardens and ground unchanged.')
