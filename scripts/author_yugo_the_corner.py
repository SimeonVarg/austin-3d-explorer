#!/usr/bin/env python3
"""Yugo The Corner: mapped shell and photo-observed southeast elevations.
Writes only its dedicated recipe; dimensions and hidden elevations remain inferred.
"""
import json
import math
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'data/apartments/yugo-the-corner.json'
ID = '3de7a448-64eb-450d-94ad-76489525c634'
TOP, LOWER = 24.0, 17.267  # retain existing authored metric envelope, not old Overture 7.6 m
FLOORS = [0, 3.8, 7.167, 10.533, 13.9, 17.267, 20.633, TOP]
RING = [[.4,0],[27.4,.3],[27.24,14.26],[38.36,14.38],[38.06,38.9],[2.42,38.56],[2.46,34.79],[0,34.76]]
HOLE = [[21.275,13.604],[16.944,13.582],[16.886,25.601],[21.217,25.622]]
PALETTE = {'white':'#cbd0cf','slate':'#92a5b0','dark':'#586875','shaft':'#adc0cd','shaftAlt':'#a9bdca',
 'sidingJoint':'#aab5b9','slateJoint':'#8195a0','panelJoint':'#8da4b3','roof':'#c9c7bb',
 'coping':'#3f494b','frame':'#4c595b','glass':'#3e5956','metal':'#879294','fan':'#424f53',
 'stone':'#b8b5a7','sign':'#e9ece8','rail':'#596362'}
SOUTH_ROWS = [
 [(2.6,2.1),(6.4,.8),(14.2,2.0),(19.3,2.0),(24.1,.85)],
 [(2.6,2.1),(6.4,.8),(14.2,2.0),(19.3,.85),(24.1,2.0)],
 [(2.6,2.1),(6.4,.8),(14.2,2.0),(19.3,2.0),(24.1,2.0)],
 [(2.6,2.1),(6.4,.8),(14.2,2.0),(19.3,2.0),(24.1,2.0)],
 [(2.6,2.1),(6.4,.8),(14.2,2.0),(19.3,2.0),(24.1,.85)],
 [(2.6,2.1),(6.4,.8),(14.2,2.0),(19.3,2.0),(24.1,.85)]]
EAST_ROWS = [[(2.2,.8),(5.0,1.8),(9.2,.8),(13.0,1.8),(18.0,.85),(21.6,1.5)] for _ in range(6)]
# Nine visible equipment banks; within-bank depths/spacing inferred from the roof image.
EQUIPMENT = [(4,4,4,2),(13,3,4,2),(3,12,4,2),(5,25,4,2),(11,32,4,2),
             (24,30,4,2),(29,20,3,2),(32,31,4,2),(22,8,4,2)]


def band(a,b,skin='white',**kw): return {'z0':round(a,4),'z1':round(b,4),'skin':skin,**kw}
def block(name,plan,a,b,skin='white',**kw):
    return {'id':name,'plan':plan,'z0':round(a,4),'z1':round(b,4),'bands':[band(a,b,skin)],'roofTone':'roof',**kw}
def opening(c,w,z,h=1.75):
    return {'s0':round(c-w/2,4),'s1':round(c+w/2,4),'z0':round(z+.72,4),'z1':round(z+.72+h,4),
      'd':.12,'glass':'glass','lit':'room','tone':'frame','mullion':{'cols':[.5] if w>1.25 else [],'rows':[.28],'w':.035,'tone':'frame'}}
def window_bands(layouts,length,upper_white=True):
    result=[band(0,3.8,'lobby')]
    for i,z in enumerate(FLOORS[1:-1]):
        skin='white' if upper_white and z>=LOWER else 'slate'
        ops=[opening(c,w,z) for c,w in layouts[i] if c-w/2>.12 and c+w/2<length-.12]
        result.append(band(z,FLOORS[i+2],skin,openings=ops))
    return result

def glyph(char):
    # Normalized solid vector contours, not a dot font. Round C/O use smooth polygons.
    if char in 'CO':
        start,end=(42,318) if char=='C' else (0,360)
        outer=[[.5+.48*math.cos(math.radians(t)),.5+.5*math.sin(math.radians(t))] for t in range(start,end+1,6)]
        inner=[[.5+.27*math.cos(math.radians(t)),.5+.30*math.sin(math.radians(t))] for t in range(start,end+1,6)]
        if char=='C':return [{'outer':outer+inner[::-1]}]
        return [{'outer':outer,'holes':[inner[::-1]]}]
    polys={
      'R':[[[0,0],[.22,0],[.22,.40],[.40,.40],[.75,0],[1,0],[.61,.46],[.83,.57],[.93,.78],[.84,.94],[.65,1],[0,1]],
           [[.22,.60],[.62,.60],[.72,.67],[.72,.81],[.62,.88],[.22,.88]]],
      'N':[[[0,0],[.22,0],[.22,.64],[.78,0],[1,0],[1,1],[.78,1],[.78,.36],[.22,1],[0,1]]],
      'E':[[[0,0],[1,0],[1,.2],[.23,.2],[.23,.42],[.87,.42],[.87,.61],[.23,.61],[.23,.8],[1,.8],[1,1],[0,1]]],
      'T':[[[0,1],[1,1],[1,.79],[.61,.79],[.61,0],[.39,0],[.39,.79],[0,.79]]],
      'H':[[[0,0],[.22,0],[.22,.41],[.78,.41],[.78,0],[1,0],[1,1],[.78,1],[.78,.62],[.22,.62],[.22,1],[0,1]]]}
    q=polys[char];return [{'outer':q[0],**({'holes':[q[1]]} if len(q)>1 else {})}]

def main():
    old=next(b for b in json.loads((ROOT/'data/neighborhood_apartments.json').read_text())['buildings'] if b['id']==ID)
    d={k:old[k] for k in ['id','name','footprint','frame']}
    d.update({'sources':{
      'MAP':{'type':'map','source':'Retained neighborhood apartment footprint, explicit local frame, and existing 24 m authored envelope','date':'2026-10-11','confidence':'medium','supports':'plan scale and unchanged metric envelope'},
      'PHOTO':{'type':'site photograph','confidence':'high','supports':'Visible south/east window families, split pale/slate cladding, two paneled shafts, recessed terraces, glazed corner, roof equipment and THE CORNER sign; original joins private'},
      'INFER':{'type':'inference','derivedFrom':['MAP','PHOTO'],'confidence':'low','supports':'Retained metric elevations, concealed north/west walls, courtyard, window counts behind vegetation, small feature depths and roof equipment positions'},
      'SUPERSEDED':{'type':'map','source':'Snapshot Overture height 7.6 m','supports':'Historical conflicting height only','status':'Not used: existing authored building already24m. No surveyed replacement supplied.'}},
      'levels':{'floors':FLOORS,'roof':TOP,'_src':'MAP retained seven levels and24m height. PHOTO supports visible level rhythm; not an independent metric survey.'},
      'colours':{k:{'hex':v,'_src':'PHOTO visible appearance; daylight albedo inferred'} for k,v in PALETTE.items()},
      'skins':{k:{'kind':'flat','field':k} for k in PALETTE},
      'materials':{},'preserveRoof':False,'preserveRoofscape':False,
      'open':['Ground facade and lower sign are partly occluded; repeated lower CORNER letters inferred from visible name and mapped identity.',
              'North/west and courtyard faces are inferred, not photo-observed.',
              'Height24m retained, not measured. Roof positions and projected glass-corner depth are inferred.',
              'Private rooftop camera has residual alignment/terrain uncertainty. No exact likeness claim.']})
    # Existing compact filtered patterns preserve siding while avoiding geometric line grids.
    for key,tone,joint,scale in [('white','white','sidingJoint',[5,.22]),('slate','slate','slateJoint',[5,.22]),('shaft','shaft','panelJoint',[1.25,1.15])]:
        d['materials'][key]={'scale':scale,'pattern':{'version':1,'tones':[[tone,1]],'joint':{'width':.012,'tone':joint},'seed':7,'filter':[.30,1.1]}}
    d['materials']['glass']={'type':'glass','strength':.15}
    d['skins']['lobby']={'kind':'storefront','glass':'glass','frame':'frame','mullion':2.3,'mullionW':.09,'fascia':.2,'reveal':.15}
    d['skins']['hidden']={'kind':'bays','field':'white','windowRule':'all','bay':3.6,'window':{'w':1.35,'h':1.8,'sill':.72},'glass':'glass','frame':'frame','reveal':.12}
    d['skins']['atrium']={'kind':'storefront','glass':'glass','frame':'shaft','mullion':1.45,'mullionW':.11,'horizontalPitch':3.367,'fascia':.16,'plinth':.12,'reveal':.12}
    lengths=[math.dist(RING[i],RING[(i+1)%len(RING)]) for i in range(len(RING))]
    faces={'0':{'bands':window_bands(SOUTH_ROWS,lengths[0])},
      '1':{'bands':window_bands([[(1.4,.7),(3.6,.9),(6.6,.9),(8.8,.75)] for _ in range(6)],lengths[1],False)},
      '2':{'bands':window_bands([[(2.4,1.75),(5.1,.8),(7.4,1.75)] for _ in range(6)],lengths[2],False)},
      '3':{'bands':window_bands(EAST_ROWS,lengths[3])},
      '*':{'bands':[band(0,3.8,'lobby'),band(3.8,TOP,'hidden')]}}
    # Site photograph shows real setbacks and projecting slabs, not painted white strips.
    # Face0 photo canopy span about180px of350px visible facade: 0.51 of mapped27m.
    # Existing seven-storey height and full plan remain unchanged; recess metres inferred.
    for face,depth in [('0',1.6),('2',.75),('3',.85)]:
        for bd in faces[face]['bands']:
            if bd['z0']>=LOWER:bd['inset']={'d':depth,'tone':'white'}
    def hood(face,z,s0,s1,depth,thick=.25):
        # Attach to the actual receiving band. The renderer offsets fixtures with
        # its wall inset, so depth includes that recess where the slab crosses it.
        bd=next(b for b in faces[face]['bands'] if b['z0']<=z<=b['z1'])
        bd.setdefault('canopies',[]).append({'s0':s0,'s1':s1,'z':z,'d':depth,'t':thick,'tone':'roof','soffitTone':'dark'})
    # Main terrace spans left windows/shaft, not the entire facade; two steps flank it.
    hood('0',LOWER,.45,14.1,2.15,.28)
    hood('0',LOWER-1.0,14.1,26.7,.85,.24)
    # Broad window hoods: source width~1.5x the paired opening and ~0.17 of wall.
    hood('0',23.25,.65,4.65,2.05,.25)
    hood('0',20.10,17.65,20.95,2.15,.25)
    # The return beside the glazed bay has a lower terrace and paired-window cap.
    hood('2',LOWER-.35,.15,4.1,1.35,.26)
    hood('2',13.33,.5,4.25,.85,.23)
    # Second visible wing: top hood next to shaft and stepped terrace beneath it.
    hood('3',23.28,.35,6.75,1.95,.27)
    hood('3',LOWER,.3,8.0,1.50,.27)
    hood('3',LOWER-.9,8.0,15.0,.80,.24)
    body=block('residence',{'ring':RING,'holes':[HOLE]},0,TOP,faces=faces,parapet=.35,parapetTone='coping',
       _src={'plan':'MAP preserved footprint with sub-metre wall articulation simplification', 'southUpperWindows':'PHOTO directly visible two upper white rows; widths and spacing inferred against map scale', 'southLowerWindows':'INFER repeated photographed family into vegetation/neighbor-occluded lower rows', 'eastWindows':'PHOTO visible upper paired/slit family; INFER lower rows', 'northWestAndCourtyard':'INFER unseen elevations, not photo-observed', 'terraces':'PHOTO visible stepped white upper planes behind slate lower walls; south1.6m/east0.85m/return0.75m recess inferred, not surveyed', 'hoods':'PHOTO visible paired-window hoods and stepped terrace caps; 0.25-0.28m slab thickness and 0.8-2.15m depth inferred from photo ratios' })
    blocks=[body]
    # Two distinctly paneled upper shafts, interrupted by small square punched windows.
    for name,plan,face,start in [('south',[7.7,12.2,-.5,1.1],'v0',16.5),('east',[33.1,37.1,13.7,15.2],'v0',15.1)]:
        L=plan[1]-plan[0];ops=[{'s0':L*.5-.29,'s1':L*.5+.29,'z0':z,'z1':z+.52,'d':.14,'glass':'glass','lit':'room','tone':'frame'} for z in [18.3,21.8]]
        blocks.append(block(name+'-paneled-shaft',plan,start,24.75,'shaft',faces={face:{'bands':[band(start,24.75,'shaft',openings=ops)]}},parapet=.13,parapetTone='coping',_src='PHOTO: two pale-blue gridded shafts and small punched squares; depths and exact metres inferred.'))
    # Glazed corner projects into the mapped southeast re-entrant notch.
    blocks.append(block('glazed-corner',[27.0,31.0,10.2,14.65],3.8,22.95,'atrium',faces={'u0':None,'v1':None},
       _src='PHOTO: exposed full-height two-face glazed corner with broad floor crossbars; notch projection depth inferred.'))
    blocks.append(block('glazed-corner-canopy',[26.7,31.7,9.5,14.7],22.95,23.22,'dark',_src='PHOTO: projecting light cap over glazing. Depth inferred.'))
    # Source shows THE CORNER, not the operator brand YUGO. Upper letters directly observed.
    signs=[]
    for i,ch in enumerate('CORNER'):
        signs.append({'outline':{'polygons':glyph(ch)},'s':.75,'w':.78,'h':1.16,'z0':13.8-i*1.34,'depth':.075,'off':.035,'tone':'sign'})
    for i,ch in enumerate('THE'):
        signs.append({'outline':{'polygons':glyph(ch)},'s':.39+i*.33,'w':.27,'h':.35,'z0':15.10,'depth':.05,'off':.035,'tone':'sign'})
    blocks.append(block('corner-name',[25.5,27.0,-.14,.06],5.1,15.65,'dark',faces={'v0':{'bands':[band(5.1,15.65,'dark',signs=signs)]},'v1':None},
       _src='PHOTO visible small the and vertical COR; obscured NER inferred from known building name. Solid vector contours; no dot font.'))
    # Rooftop membrane, low service hatches and ordered condenser banks.
    for i,(u,v,L,W) in enumerate([(2,35,6,2),(12,35,6,2),(22,35,6,2),(31,35,5,2)]):
        blocks.append(block('roof-service-'+str(i),[u,u+L,v,v+W],TOP,TOP+1.05,'white',roof={'kind':'gable','pitch':8,'tone':'metal','over':.1},_src='PHOTO: four raised low service housings with pale metal roofs; exact footprint inferred.'))
    meshes={t:{'id':'roof-'+t,'tone':t,'vertices':[],'triangles':[],'_src':'PHOTO ordered condenser banks; individual roof positions/metres inferred'} for t in ['metal','fan']}
    def tri(m,pts):
        i=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in pts];m['triangles'].append([i,i+1,i+2])
    count=0
    for gu,gv,nu,nv in EQUIPMENT:
        for j in range(nv):
            for i in range(nu):
                u,v=gu+i*.95,gv+j*1.15;radius=.33;z=TOP+.1;h=.85+(i%3)*.12;count+=1
                for k in range(10):
                    a=2*math.pi*k/10;b=2*math.pi*(k+1)/10
                    p0=[u+radius*math.cos(a),v+radius*math.sin(a),z];p1=[u+radius*math.cos(b),v+radius*math.sin(b),z]
                    p2=[p1[0],p1[1],z+h];p3=[p0[0],p0[1],z+h]
                    tri(meshes['metal'],[p0,p1,p2]);tri(meshes['metal'],[p0,p2,p3]);tri(meshes['fan'],[[u,v,z+h],p3,p2])
    d['blocks']=blocks;d['detailMeshes']=list(meshes.values());d['_observedEquipment']={'banks':len(EQUIPMENT),'modeledUnits':count,'_src':'PHOTO approximately70–80 distinguishable condensers; rows/groups visible, precise plan coordinates inferred.'}
    # Bounds guard applies to both numbered polygon walls and named rectangular ones.
    for b in blocks:
        assert b['z1']>b['z0'];plan=b['plan'];Ls=lengths if isinstance(plan,dict) else {'v0':plan[1]-plan[0],'v1':plan[1]-plan[0],'u0':plan[3]-plan[2],'u1':plan[3]-plan[2]}
        for key,f in b.get('faces',{}).items():
            for bd in (f or {}).get('bands',[]):
                assert b['z0']-.001<=bd['z0']<bd['z1']<=b['z1']+.001
                for o in bd.get('openings',[]):
                    L=Ls[int(key)] if isinstance(Ls,list) else Ls[key]
                    assert 0<=o['s0']<o['s1']<=L and bd['z0']<=o['z0']<o['z1']<=bd['z1']
    assert old['footprint']==d['footprint'] and old['frame']==d['frame']
    assert len({b['id'] for b in blocks})==len(blocks)
    deduplicate_detail_meshes(d)
    OUT.write_text(json.dumps(d,separators=(',',':'),ensure_ascii=False))
    print(f'Wrote {OUT.name}: {len(blocks)} blocks, {count} condensers in9 banks, 2 shafts, vector THE CORNER sign, retained24m roof')

if __name__=='__main__':main()
