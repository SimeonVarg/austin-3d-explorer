#!/usr/bin/env python3
"""Twenty Two 15: retain mapped open courtyard; author photographed roof banks.
Only this recipe is written. Private measurement sheet holds source joins and
photo-to-roof correspondence; no source pixels or camera position are published.
"""
import copy
import json
import math
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'data/apartments/twenty-two-15.json'
ID = '7a5984d8-919c-405c-afe5-cd31ba969b63'
ROOF, PARAPET = 27.3, .55  # roof inherited, not independently surveyed
UNIT = {'radius': .40, 'h': .90, 'pitchU': 1.18, 'pitchV': 1.24, 'fanRadius': .205, 'segments': 10}
# Bank centres measured in the existing metric roof frame from site imagery.
# Counts approximate where overlapping pipes hide unit boundaries.
BANKS = [(30.57,6.75,4,4),(30.44,26.79,4,3),(28.48,19.94,3,2),
 (20.12,26.51,5,5),(19.91,20.51,4,2),(17.94,9.92,4,3),
 (7.93,10.50,4,3),(5.36,18.20,4,2),(28.77,55.75,5,3),
 (24.04,47.47,5,3),(27.87,44.62,4,2),(20.94,41.57,4,3),
 (18.03,55.56,4,3),(12.58,53.45,3,2),(4.07,50.67,4,2),(2.93,60.64,4,3)]
PALETTE = {'wall':'#d7d8cd','accent':'#414d58','base':'#a9a394',
 'roof':'#b5b7b0','patch':'#a0a59e','coping':'#d2d5cc',
 'pane':'#26383e','frame':'#828c8c','unit':'#8b9494',
 'unitTop':'#c5ccca','fan':'#343c3f','pipe':'#8b9490'}


def inside(p, ring):
    x,y=p; hit=False
    for i,a in enumerate(ring):
        b=ring[(i+1)%len(ring)]
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit


def mesh(name,tone):return {'id':name,'tone':tone,'vertices':[],'triangles':[]}


def quad(m,pts):
    i=len(m['vertices']);m['vertices'] += [[round(t,4) for t in p] for p in pts]
    m['triangles'] += [[i,i+1,i+2],[i,i+2,i+3]]


def disk(m,u,v,z,r):
    i=len(m['vertices']);n=UNIT['segments']
    m['vertices'].append([round(u,4),round(v,4),round(z,4)])
    for j in range(n):
        a=2*math.pi*j/n;m['vertices'].append([round(u+r*math.cos(a),4),round(v+r*math.sin(a),4),round(z,4)])
    m['triangles'] += [[i,i+1+j,i+1+(j+1)%n] for j in range(n)]


def main():
    old=next(b for b in json.loads((ROOT/'data/neighborhood_apartments.json').read_text())['buildings'] if b['id']==ID)
    d={k:copy.deepcopy(old[k]) for k in ('id','name','footprint','frame','levels')}
    ring=copy.deepcopy(old['blocks'][0]['plan']['ring'])
    assert len(ring)==14
    d.update({'address':'2215 Rio Grande Street, Austin, TX',
      'sources':{'MAP':{'type':'map','source':'Existing snapshot footprint; OpenStreetMap address checked 2026-10-11','confidence':'high','supports':'Identity, open C-shaped plan and metric roof span'},
                 'PHOTO':{'type':'site photograph','confidence':'high','supports':'Visible roof equipment banks, parapets, utility rooms, upper facade and courtyard; private source join'},
                 'INFER':{'type':'inference','derivedFrom':['MAP','PHOTO'],'confidence':'medium','supports':'Equipment dimensions, occluded units and unseen facades; retained 27.3 m height unverified'}},
      'colours':{k:{'hex':v,'_src':'PHOTO appearance; daylight albedo inferred, not a raw pixel match'} for k,v in PALETTE.items()},
      'materials':{'wall':{'type':'concrete','strength':.12},'pane':{'type':'glass','strength':.22}},
      'skins':{k:{'kind':'flat','field':k} for k in PALETTE},
      'preserveRoof':False,'preserveRoofscape':False,
      '_open':['Roof height 27.3 m inherited from generic model, not independently measured.',
               'Sixteen photographed equipment groups; some overlapping condenser counts and their dimensions are inferred.',
               'North roof corner is outside the photograph; its edge-line intersection constrains equipment placement approximately.',
               'Unseen lower walls and entrance remain inferred.'],
      '_review':'Photo-led first candidate, awaiting actual app camera comparison.'})
    for key,field in [('rooms','wall'),('accentRooms','accent'),('baseRooms','base')]:
        d['skins'][key]={'kind':'bays','field':field,'windowRule':'all','bay':3.5,
          'window':{'w':1.65,'h':1.8,'sill':.75,'mullion':{'cols':[.5],'rows':[.45],'w':.045,'tone':'frame'}},
          'glass':'pane','frame':'frame','reveal':.14,
          '_src':'PHOTO upper windows: near-square dark openings. Spacing/lower and hidden faces inferred.'}
    upper=d['levels']['floors'][-3]
    bands=[{'z0':0,'z1':3.8,'skin':'baseRooms'}, {'z0':3.8,'z1':ROOF-.30,'skin':'rooms'}, {'z0':ROOF-.30,'z1':ROOF,'skin':'wall'}]
    residence={'id':'residence','plan':{'ring':ring,'holes':[]},'z0':0,'z1':ROOF,'bands':bands,
        'roofTone':'roof','parapet':PARAPET,'parapetTone':'coping',
        'faces':{'7':{'bands':[{'z0':0,'z1':3.8,'skin':'baseRooms'},{'z0':3.8,'z1':upper,'skin':'accentRooms'}, {'z0':upper,'z1':ROOF-.30,'skin':'rooms'},{'z0':ROOF-.30,'z1':ROOF,'skin':'wall'}]}},
        '_src':'MAP open courtyard preserved verbatim. PHOTO pale two upper rows and dark west accent zone; lower elevations inferred.'}
    utility={'id':'roof-utility-room','plan':[30.1,34.25,34.5,40.5], 'z0':ROOF,'z1':ROOF+1.9,
       'bands':[{'z0':ROOF,'z1':ROOF+1.9,'skin':'wall'}], 'roofTone':'coping',
       'faces':{'u0':{'bands':[{'z0':ROOF,'z1':ROOF+1.9,'skin':'wall','openings':[
          {'s0':1,'s1':1.9,'z0':ROOF+.55,'z1':ROOF+1.3,'d':.1,'tone':'pane'},
          {'s0':3.7,'s1':4.6,'z0':ROOF+.55,'z1':ROOF+1.3,'d':.1,'tone':'pane'}]}]}},
       '_src':'PHOTO small pale utility room with two dark panels beside east roof edge; plan/height inferred from ratios.'}
    d['blocks']=[residence,utility]
    body,top,fan,pipes,patch=[mesh(n,t) for n,t in [('condenser-bodies','unit'),('condenser-tops','unitTop'),('condenser-fans','fan'),('equipment-pipes','pipe'),('weathered-roof-patches','patch')]]
    all_centres=[];counts=[];r=UNIT['radius'];z=ROOF+.06;h=UNIT['h']
    for gi,(u,v,cols,rows) in enumerate(BANKS):
        centres=[]
        for a in range(cols):
            for b in range(rows):
                x=u+(a-(cols-1)/2)*UNIT['pitchU'];y=v+(b-(rows-1)/2)*UNIT['pitchV']
                # A clipped bank never leaks condensers into the open courtyard.
                if not all(inside((x+dx,y+dy),ring) for dx,dy in [(-r,-r),(-r,r),(r,-r),(r,r)]):continue
                if 29.7<x<34.6 and 34<y<41:continue
                centres.append((x,y));all_centres.append((x,y))
                for j in range(UNIT['segments']):
                    a0=2*math.pi*j/UNIT['segments'];a1=2*math.pi*(j+1)/UNIT['segments']
                    edge_a=(x+r*math.cos(a0),y+r*math.sin(a0));b0=(x+r*math.cos(a1),y+r*math.sin(a1))
                    quad(body,[(edge_a[0],edge_a[1],z),(b0[0],b0[1],z),(b0[0],b0[1],z+h),(edge_a[0],edge_a[1],z+h)])
                disk(top,x,y,z+h,r);disk(fan,x,y,z+h+.018,UNIT['fanRadius'])
        counts.append(len(centres))
        # Low horizontal pipe header ties each bank together. Broad enough to
        # remain a coherent line without a high-frequency grille texture.
        if centres:
            x0=min(x for x,y in centres)-.35;x1=max(x for x,y in centres)+.35
            yy=v+.2
            if all(inside((xx,yy),ring) for xx in [x0,x1]):
                quad(pipes,[(x0,yy-.035,z+.20),(x1,yy-.035,z+.20),(x1,yy+.035,z+.20),(x0,yy+.035,z+.20)])
    # Low-contrast repair patches, placed away from the court and equipment room.
    for u,v,w,l in [(23,7,4.0,4),(26,32,3,2.5),(30,49,2.5,3),(8,6,3,2),(14,47,3,4),(26,58,3,2),(6,20,2,1.5),(22,14,2.5,2)]:
        pts=[(u,v),(u+w,v),(u+w,v+l),(u,v+l)]
        if all(inside(p,ring) for p in pts):quad(patch,[(x,y,ROOF+.016) for x,y in pts])
    d['detailMeshes']=[body,top,fan,pipes,patch]
    for m in d['detailMeshes']:m['_src']='PHOTO visible feature type and bank location. Shape dimensions and hidden portions inferred.'
    # Three separate rectangular packaged units are not substitutes for condenser banks.
    d['deck']={'z':ROOF,'items':[
        {'plan':[8.0,11.2,55,57.0],'z0':.08,'h':1.3,'tone':'coping'},
        {'plan':[23.5,26.7,40.7,42.7],'z0':.08,'h':1.3,'tone':'coping'},
        {'plan':[8.2,11.3,11.3,13.3],'z0':.08,'h':1.3,'tone':'coping'}],
        '_src':'PHOTO three pale rectangular equipment cases; sizes/locations approximate in existing roof frame.'}
    d['_equipment']={'bankCounts':counts,'visibleUnitsAuthored':len(all_centres),'_src':'Counted approximately where source overlaps; clipped to measured courtyard roof, no hidden-unit inventory claimed.'}
    # Sanity checks guard the actual defect class: do not fill the court or put
    # plant off the roof, and do not retain the old generic rooftop box as well.
    assert not inside((13,30),ring) and inside((25,30),ring)
    assert all(inside(p,ring) for p in all_centres)
    assert len(all_centres)>150 and len(all_centres)<220
    assert all(max(t)<len(m['vertices']) for m in d['detailMeshes'] for t in m['triangles'])
    deduplicate_detail_meshes(d)
    OUT.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
    print(f'Wrote {OUT.name}: {len(all_centres)} condensers / {len(BANKS)} banks, open court retained')


if __name__=='__main__':main()
