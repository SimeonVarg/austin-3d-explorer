"""Battle east architecture/ownership regression. Visual acceptance is separate."""
import collections, copy, json, math, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
revision=sys.argv[1]
def old(path):return json.loads(subprocess.check_output(['git','show',revision+':'+path],cwd=ROOT))
def current(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
from bake_entrances import (BATTLE_EAST_ENTRIES, BATTLE_EAST_MARKER,
                           retire_battle_east_entries, ARCHES)
prior=old('data/entrances.geojson');new=current('data/entrances.geojson')
ids=set(BATTLE_EAST_ENTRIES)
assert new['features']==[f for f in prior['features'] if f['properties']['eid'] not in ids]
assert new['arches']=={k:v for k,v in prior['arches'].items() if int(k) not in ids}
assert len(prior['features'])-len(new['features'])==94
for key,value in prior.items():
    if key not in ('features','arches'):assert new[key]==value, key
fs=copy.deepcopy(prior['features'])
ARCHES.clear();ARCHES.update({int(k):v for k,v in prior['arches'].items()})
assert retire_battle_east_entries(fs)==new[BATTLE_EAST_MARKER] and fs==new['features']
for defect in ('identity','composition','position'):
    damaged=copy.deepcopy(prior['features']);target=next(f for f in damaged if f['properties']['eid']==94)
    if defect=='identity':target['properties']['bid']='wrong-building'
    elif defect=='composition':damaged.remove(target)
    else:
        for f in damaged:
            if f['properties']['eid']==94 and f['properties']['k']=='door':
                for p in f['geometry']['coordinates'][0]:p[0]+=.001
    ARCHES.clear();ARCHES.update({int(k):v for k,v in prior['arches'].items()})
    try:retire_battle_east_entries(damaged)
    except AssertionError:pass
    else:raise AssertionError('Retirement must reject '+defect+' drift')
assert current('data/campus_landscape.json')==old('data/campus_landscape.json')
truth=current('data/campus_truth.json');oldtruth=old('data/campus_truth.json')
truth['buildings'].pop('BTL');oldtruth['buildings'].pop('BTL');assert truth==oldtruth
print('PASS: exact 94-piece retirement, other entries/arches/ramps/landscape/truth preserved; three drift controls rejected.')

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


from bake_battle import build, build_base
from campus_battle import refine
base=old('data/apartments/battle-hall.json');model=current('data/apartments/battle-hall.json')
assert build_base()==base, 'Original Battle asset reproduced exactly'
original=copy.deepcopy(base);assert refine(base)==model==build()==build() and base==original
for key,value in base.items():
    if key not in ('blocks','colours','materials','skins','detailMeshes'):assert model[key]==value, key
for key in ('colours','materials','skins'):
    assert all(model[key][k]==v for k,v in base.get(key,{}).items())
for a,b in zip(base['blocks'],model['blocks']):
    if a['id']=='reading-hall':
        assert {k:v for k,v in a.items() if k!='faces'}=={k:v for k,v in b.items() if k!='faces'}
        assert {k:v for k,v in a['faces'].items() if k!='u1'}=={k:v for k,v in b['faces'].items() if k!='u1'}
    elif a['id']=='cornice-1.1':
        assert {k:v for k,v in a.items() if k!='plan'}=={k:v for k,v in b.items() if k!='plan'}
        from shapely.geometry import Polygon,box
        r=model['battleEast']['doorCourseNotch'];u0,u1,v0,v1=a['plan']
        intended=box(u0,v0,u1,v1).difference(box(r['back'],r['s0'],u1,r['s1']))
        assert Polygon(b['plan']['ring']).symmetric_difference(intended).area<1e-10
    else:assert a==b
meta=model['battleEast'];assert (meta['arches'],meta['lowerWindows'],meta['doors'],meta['julietGuards'])==(7,6,1,7)
hall=next(b for b in model['blocks'] if b['id']=='reading-hall');op=hall['faces']['u1']['bands'][0]['openings']
assert len(op)==14 and sum('arch' in a for a in op)==7
for i,a in enumerate(op):
    assert 0<=a['s0']<a['s1']<=43.1 and 0<=a['z0']<a['z1']<=17.7 and 0<a['d']<1.5
    for b in op[i+1:]:assert min(a['s1'],b['s1'])<=max(a['s0'],b['s0']) or min(a['z1'],b['z1'])<=max(a['z0'],b['z0'])
meshes=[m for m in model['detailMeshes'] if m['id'] in meta['meshIds']]
assert len({m['id'] for m in meshes})==len(meshes)==len(meta['meshIds'])
assert sum(len(closed(m)) for m in meshes)==meta['solidCount']
assert sum(len(m['triangles']) for m in meshes)==meta['triangles']<=20000
for m in meshes:assert m['tone'] in model['colours'] and m['tone'] in model['materials']
for triangles in (meshes[0]['triangles'][1:],[t[::-1] for t in meshes[0]['triangles']]):
    try:closed({**meshes[0],'triangles':triangles})
    except AssertionError:pass
    else:raise AssertionError('Broken or inward geometry accepted')
print(f"PASS: {meta['solidCount']} closed outward solids, {meta['triangles']} triangles, seven arches/six lower sash/one door; exact shell/roof preservation apart from checked door-course notch.")
