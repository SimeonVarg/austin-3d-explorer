#!/usr/bin/env python3
"""Build bounded, parameterized photo-detail trials in the existing recipe format."""
import argparse
import copy
import json
import math
from pathlib import Path
import sys

from accept import Rejected, asset, preserve_inputs, private_path, write_json
from pose_check import check as check_pose

# Reuse the scene author's tested closed-box, cylinder and wall coordinate primitives.
SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import author_welch_courtyard as geometry


def positive(value, label):
    if type(value) not in (int,float) or not math.isfinite(value) or value <= 0:
        raise Rejected(label+' must be a positive finite number')
    return value


def prism(tone, ring, z, thickness):
    n=len(ring)
    geometry.polyhedron(tone,[(x,y,h) for h in (z,z+thickness) for x,y in ring],
                        [tuple(reversed(range(n))),tuple(range(n,2*n))] +
                        [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])


def clipped_rectangle(x,y,width,depth,clip):
    if not 0 < clip < min(width,depth)/2:
        raise Rejected('corner clip must fit inside the rectangle')
    w,d=width/2,depth/2
    return [(x+a,y+b) for a,b in [(-w+clip,-d),(w-clip,-d),(w,-d+clip),(w,d-clip),
                                 (w-clip,d),(-w+clip,d),(-w,d-clip),(-w,-d+clip)]]


def picnic_table(feature):
    x,y,z=feature['at'];p=feature['parameters'];tone=feature['tone']
    for key in ['width','depth','clip','topHeight','topThickness','seatHeight','seatThickness',
                'seatLength','seatWidth','seatOffset','tubeRadius','bendRadius','postRadius','postSpacing']:
        positive(p[key],key)
    if p['seatHeight']+p['seatThickness'] >= p['topHeight'] or p['seatOffset']-p['seatWidth']/2 <= max(p['width'],p['depth'])/2:
        raise Rejected('table seats must clear the tabletop and sit below it')
    if p['bendRadius'] >= min(p['seatOffset'],p['seatHeight']-p['tubeRadius']):
        raise Rejected('support bend must fit under the seat')
    if p['postSpacing']+p['postRadius'] >= min(p['width'],p['depth'])/2:
        raise Rejected('table posts must fit under the tabletop')
    prism(tone,clipped_rectangle(x,y,p['width'],p['depth'],p['clip']),z+p['topHeight'],p['topThickness'])
    for dx in (-p['postSpacing'],p['postSpacing']):
        for dy in (-p['postSpacing'],p['postSpacing']):
            geometry.rod(tone,[x+dx,y+dy,z+p['tubeRadius']],[x+dx,y+dy,z+p['topHeight']],p['postRadius'],8)
    segments=p['bendSegments']
    if type(segments) is not int or segments < 2 or segments > 16:
        raise Rejected('bendSegments must be an integer from 2 to 16')
    for direction in range(4):
        angle=direction*math.pi/2;u=(math.cos(angle),math.sin(angle));v=(-u[1],u[0])
        cx,cy=x+u[0]*p['seatOffset'],y+u[1]*p['seatOffset']
        local=clipped_rectangle(0,0,p['seatWidth'],p['seatLength'],p['clip']/2)
        ring=[(cx+u[0]*a+v[0]*b,cy+u[1]*a+v[1]*b) for a,b in local]
        prism(tone,ring,z+p['seatHeight'],p['seatThickness'])
        # Paired continuous support paths connect each seat to the central frame.
        for side in (-1,1):
            transverse=side*p['seatLength']*.28
            r=p['bendRadius'];bottom=z+p['tubeRadius']
            pts=[(0,bottom),(p['seatOffset']-r,bottom)]
            pts += [(p['seatOffset']-r+r*math.sin(i*math.pi/(2*segments)),
                     bottom+r-r*math.cos(i*math.pi/(2*segments))) for i in range(1,segments+1)]
            pts += [(p['seatOffset'],z+p['seatHeight'])]
            world=[(x+u[0]*a+v[0]*transverse,y+u[1]*a+v[1]*transverse,h) for a,h in pts]
            for a,b in zip(world,world[1:]): geometry.rod(tone,a,b,p['tubeRadius'],8)
            geometry.rod(tone,[x,y,bottom],world[0],p['tubeRadius'],8)


def diamond(feature):
    p=feature['parameters'];a,b=feature['wall'];mid,z=feature['centre']
    for key in ['width','height','stroke','projection']: positive(p[key],key)
    length=math.dist(a,b)
    if length <= 0 or p['stroke'] >= min(p['width'],p['height'])/2:
        raise Rejected('invalid diamond wall or stroke')
    t=((b[0]-a[0])/length,(b[1]-a[1])/length)
    points=[(mid,z+p['height']/2),(mid+p['width']/2,z),(mid,z-p['height']/2),(mid-p['width']/2,z)]
    world=[(a[0]+t[0]*s+t[1]*p['projection']/2,a[1]+t[1]*s-t[0]*p['projection']/2,h) for s,h in points]
    normal=[t[1],-t[0],0]
    for v,w in zip(world,world[1:]+world[:1]):
        edge=geometry.unit(geometry.sub(w,v));across=geometry.cross(edge,normal)
        vertices=[[end[k]+i*normal[k]*p['projection']/2+j*across[k]*p['stroke']/2 for k in range(3)]
                  for end in (v,w) for i,j in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        geometry.polyhedron(feature['tone'],vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])


def ground_inset(feature):
    x,y,z=feature['at'];p=feature['parameters']
    positive(p['thickness'],'thickness')
    if 'ring' in p:
        from shapely.geometry import Polygon
        ring=p['ring']
        if len(ring)<3 or any(len(v)!=2 or any(not math.isfinite(c) for c in v) for v in ring):
            raise Rejected('ground ring must have finite two-dimensional points')
        polygon=Polygon(ring)
        if not polygon.is_valid or polygon.area<=0:
            raise Rejected('ground ring must be a simple polygon with positive area')
        for a,b in zip(ring,ring[1:]+ring[:1]):
            if a==b or any((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) < -1e-10 for c in ring):
                raise Rejected('ground ring must be convex and counter-clockwise')
        # Fan caps need strict corners: remove redundant straight boundary vertices.
        ring=[b for a,b,c in zip(ring[-1:]+ring[:-1],ring,ring[1:]+ring[:1])
              if abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1e-10]
        if len(ring)<3:raise Rejected('ground ring collapses after collinear points are removed')
        ring=[(x+a,y+b) for a,b in ring]
    else:
        for key in ['width','depth','clip']: positive(p[key],key)
        ring=clipped_rectangle(x,y,p['width'],p['depth'],p['clip'])
    prism(feature['tone'],ring,z,p['thickness'])


BUILDERS={'picnic_table':picnic_table,'wall_diamond':diamond,'ground_inset':ground_inset}


def build(recipe_path,spec_path,output):
    output=private_path(output)
    if output == Path(recipe_path).resolve(): raise Rejected('preserve the source recipe')
    recipe=json.loads(Path(recipe_path).read_text());spec=json.loads(Path(spec_path).read_text())
    if not spec.get('pose_evidence'):
        raise Rejected('photo detail trials require pose_evidence; unknown ground remains CHECK')
    receipt_path=private_path(output.with_suffix('.receipt.json'))
    preserve_inputs([recipe_path,spec_path,spec['pose_evidence']],[output,receipt_path])
    input_records={key:asset(path) for key,path in [('baseline',recipe_path),('spec',spec_path)]}
    pose_record=asset(spec['pose_evidence'])
    pose_result=check_pose(json.loads(Path(spec['pose_evidence']).read_text()))
    if pose_result['status']=='REJECT':raise Rejected('camera preflight rejected: '+ '; '.join(pose_result['reasons']))
    for field, additions in [('colours',spec['tones']),('materials',spec['materials'])]:
        for key,value in additions.items():
            if key in recipe.get(field,{}) and recipe[field][key] != value:
                raise Rejected('trial must not change existing '+field+' key: '+key)
    prefix=spec['prefix']
    if not isinstance(prefix,str) or not prefix or not prefix.endswith('-'): raise Rejected('prefix must end with a dash')
    result=copy.deepcopy(recipe);existing={m['id'] for m in recipe.get('detailMeshes',[])}
    generated=[];names=set()
    for f in spec['features']:
        if f['id'] in names: raise Rejected('duplicate feature id')
        names.add(f['id'])
        if f['kind'] not in BUILDERS or f['tone'] not in spec['tones']:
            raise Rejected('unknown feature kind or tone')
        if not isinstance(f.get('_src'),dict) or not f['_src'].get('type'):
            raise Rejected('each feature needs field-level evidence')
        geometry.M.clear();BUILDERS[f['kind']](f)
        for n,mesh in enumerate(geometry.M.values()):
            mesh['id']=prefix+f['id']+'-'+str(n)
            if mesh['id'] in existing: raise Rejected('feature id already exists in baseline; choose an unmodified baseline')
            mesh['_src']=copy.deepcopy(f['_src'])
            for point in mesh['vertices']:
                if len(point)!=3 or any(not math.isfinite(x) for x in point): raise Rejected('invalid geometry coordinate')
            for triangle in mesh['triangles']:
                a,b,c=[mesh['vertices'][i] for i in triangle]
                cross=geometry.cross(geometry.sub(b,a),geometry.sub(c,a))
                if sum(v*v for v in cross)<=1e-24:raise Rejected('generated triangle collapses after coordinate rounding')
            generated.append(copy.deepcopy(mesh))
    result.setdefault('colours',{}).update(spec['tones'])
    result.setdefault('materials',{}).update(spec['materials'])
    result.setdefault('detailMeshes',[]).extend(generated)
    write_json(output,result)
    receipt=dict(schema=1,kind='additive-detail-trial',**input_records,candidate=asset(output),
                 pose_evidence=pose_record,pose_check=pose_result,
                 features=len(spec['features']),added_triangles=sum(len(m['triangles']) for m in generated),
                 retained_meshes=len(recipe.get('detailMeshes',[])),
                 limitation='Metric dimensions and placement remain as specified in each feature evidence record.')
    write_json(receipt_path,receipt)
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe',required=True);parser.add_argument('--spec',required=True);parser.add_argument('--out',required=True)
    a=parser.parse_args();r=build(a.recipe,a.spec,a.out)
    print(json.dumps({k:r[k] for k in ('features','added_triangles','retained_meshes')}))
