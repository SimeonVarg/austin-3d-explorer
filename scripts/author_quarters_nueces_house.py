#!/usr/bin/env python3
"""Nueces House: eight-level west elevation and laser-supported stepped roof.
One owned recipe; no original photos or camera positions in public output.
"""
import json,math
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'data/apartments/quarters-nueces-house.json'
ID='5e94c2db-4245-4db3-b5c0-9ed631bcd658'
TOP,LOWER=26.0,19.5
FLOORS=[0,3.8,6.94,10.08,13.22,16.36,19.5,22.75,26.0]
# Original perimeter differs from these orthogonal face planes by at most0.2m.
RING=[[19.1,97.66],[35.5,97.66],[35.5,117.2],[0,117.2],[0,0],[35.5,0],[35.5,19.75],[19.1,19.75],[19.1,30.5],[35.5,30.5],[35.5,50.3],[20.4,50.3],[20.4,66.8],[35.5,66.8],[35.5,86.2],[19.1,86.2]]
PALETTE={'tan':'#b4a89b','pale':'#cdd0c9','brick':'#8e6961','brickAlt':'#a37c70','red':'#775047','mortar':'#aaa293',
 'trim':'#dadbd2','glass':'#4e6669','darkGlass':'#263b3e','frame':'#c3cbc4','roof':'#d1d3c8','metal':'#788883','fan':'#3d4c49',
 'base':'#b0a392','dark':'#283337','pipe':'#a3aaa0','blue':'#366375'}
# South-to-north coordinates: visible lower southern half alternates modest bay gaps.
SOUTH_CENTRES=[2.0,5.3,8.7,12.1,16.6,20.0,23.7,27.0,31.4,34.9,39.2,42.6,46.6,50.1,54.0,57.3,61.7,65.2]
CENTRES=SOUTH_CENTRES+[69.0,72.5,76.4,79.7,84.1,87.6,91.5,94.9,99.2,102.7,106.6,110.0,114.1]
# Eight visible banks in the photographed southern roof; other northern banks inferred.
BANKS=[(3.5,9,4,4),(4,26,3,2),(3.5,41,3,5),(3.5,57,4,6),(23,8,4,4),(23,14,5,3),(23,35,2,6),(24.7,43,5,3),
       (4,77,3,5),(4,98,3,5),(24,73,4,3),(24,103,4,3)]

def clip(ring,axis,value,keep):
 result=[]
 for p,q in zip(ring,ring[1:]+ring[:1]):
  ip=(p[axis]-value)*keep>=-1e-7;iq=(q[axis]-value)*keep>=-1e-7
  if ip:result.append(p)
  if ip!=iq:
   t=(value-p[axis])/(q[axis]-p[axis]);result.append([round(p[j]+t*(q[j]-p[j]),4) for j in range(2)])
 return result

def main():
 old=next(b for b in json.loads((ROOT/'data/neighborhood_apartments.json').read_text())['buildings'] if b['id']==ID)
 d={k:old[k] for k in ['id','name','footprint','frame']}
 d.update({'sources':{
  'MAP':{'type':'map','source':'Retained neighborhood apartment footprint and explicit oriented frame; mapped three east courts,35.5m width and117.2m length','confidence':'high','date':'2026-10-11','supports':'Identity, plan scale and courtyard locations'},
  'PHOTO':{'type':'site photograph','confidence':'high','supports':'Visible west facade: brick ground row, five tan rows, two pale top rows, red six-level south end, paired four-pane windows, roof banks and pale membrane. Original joins private.'},
  'LASER':{'type':'survey/LiDAR','source':'TxGIO Bexar and Travis Counties2021 building-class height-above-ground raster,0.5m; direct inward wall/roof-strip samples','date':'2021-01-26/2021-03-07','confidence':'medium','supports':'Main roof strip medians25.47–26.13m; lower ends18.94–19.73m.26.0/19.5m representative levels account approximately for terrain variation. Shape of upper setback independently present in scan.'},
  'INFER':{'type':'inference','derivedFrom':['PHOTO','MAP','LASER'],'confidence':'low','supports':'Unseen north/east elevations and northern roof equipment; complete bay count and lower obstructed openings; individual window widths/depths; upper0.65m parapet; material albedo; horizontal coordinate placement'},
  'SUPERSEDED':{'type':'inference','source':'Prior generic uniform27.5m eight-level body','status':'Superseded by direct laser sampling plus photographed two-level upper setback; old estimate retained here as conflicting evidence'}},
  'levels':{'floors':FLOORS,'roof':TOP,'lowerRoof':LOWER,'_src':'LASER main and lower roof; PHOTO8 main levels,6 at south red end. Interior floor spacing inferred.'},
  'colours':{k:{'hex':v,'_src':'PHOTO relative pale/tan/brick contrast; INFER daylight albedo'} for k,v in PALETTE.items()},
  'skins':{k:{'kind':'flat','field':k} for k in PALETTE},'materials':{},'preserveRoof':False,'preserveRoofscape':False,
  'open':['Photo shows west southern portion and roof; north part is outside frame and east/courts hidden. Their repeated architecture is inferred.',
          'Representative scan height above ground does not flatten away actual0.8m ground variation; main26.0m/lower19.5m are approximations within measured strips.',
          'No independent second image confirmed this facade; nearby campus zooms omit it. Camera remains provisional.',
          'Roof bank counts/locations are approximate where units overlap; northern banks are inferred. Ground doors behind trees are unknown.']})
 for key,joint,scale in [('brick','mortar',[.24,.075]),('red','mortar',[.24,.075])]:
  d['materials'][key]={'scale':scale,'pattern':{'version':1,'tones':[[key,.8],['brickAlt',.2]],'joint':{'tone':joint,'width':.008},'seed':23,'filter':[.3,1.1]}}
 d['materials']['glass']={'type':'glass','strength':.10};d['materials']['darkGlass']={'type':'glass','strength':.05}
 d['skins']['hidden']={'kind':'bays','field':'tan','bay':3.65,'windowRule':'all','glass':'glass','frame':'frame','reveal':.15,'window':{'w':1.75,'h':1.8,'sill':.7,'mullion':{'cols':[.5],'rows':[.5],'w':.05,'tone':'frame'}},'_src':'INFER repeated visible window family on hidden faces'}
 def op(c,z,h=1.8,w=1.75,dark=False,ground=False):
  return {'s0':round(c-w/2,4),'s1':round(c+w/2,4),'z0':round(z+.65,4),'z1':round(z+.65+h,4),'d':.16,'tone':'trim','glass':'darkGlass' if dark else 'glass','mullion':{'cols':[.25,.5,.75] if ground else [.5],'rows':[.5],'w':.055,'tone':'frame'}}
 def westbands(start,end,offset=0,limit=117.2,red=False):
  out=[]
  for j,z in enumerate(FLOORS[:-1]):
   z1=FLOORS[j+1]
   if z<start-.001 or z1>end+.001:continue
   skin='brick' if j==0 or (red and j==1) else 'red' if red else 'pale' if j>=6 else 'tan'
   centres=[(117.2-v)-offset for v in CENTRES if .1<(117.2-v)-offset<limit-.1]
   ops=[op(c,z,2.03 if j>=6 else 1.8,1.8,dark=(i in [3,7,12] and j in [2,6]),ground=(j==0)) for i,c in enumerate(centres) if c>.95 and c<limit-.95]
   if j==0:
    # Two photographed dark vehicle/service mouths; concealed northern frontage inferred.
    garages=[117.2-48.5-offset,117.2-55.8-offset]
    ops=[o for o in ops if not any(abs((o['s0']+o['s1'])/2-g)<2 for g in garages)]
    for g in garages:
     if 1.4<g<limit-1.4:ops.append({'s0':g-1.25,'s1':g+1.25,'z0':.08,'z1':2.75,'d':.6,'tone':'dark'})
   out.append({'z0':z,'z1':z1,'skin':skin,'openings':ops})
  return out
 lower={'id':'six-level-body','plan':{'ring':RING},'z0':0,'z1':LOWER,'bands':[{'z0':0,'z1':3.8,'skin':'brick'},{'z0':3.8,'z1':LOWER,'skin':'hidden'}],
  'faces':{'3':{'bands':westbands(0,LOWER)}},'roofTone':'roof','parapet':.13,'parapetTone':'red',
  'overrides':[{'region':[-.2,.2,0,14.6],'bands':westbands(0,LOWER,offset=117.2-14.6,limit=14.6,red=True)}],
  '_src':{'plan':'MAP retained footprint; drawing planes orthogonalized within0.2m','height':'LASER lower end roofs around19.5m','westWindows':'PHOTO1 ground row +5 tan/red rows; partial northern completion INFER','redSouthEnd':'PHOTO4 red upper rows above2 brick levels; width inferred','otherFaces':'INFER unobserved'}}
 upper=RING
 for axis,value,keep in [(0,.35,1),(0,32,-1),(1,5.3,1),(1,111.7,-1)]:upper=clip(upper,axis,value,keep)
 faces={}
 for i,(a,b) in enumerate(zip(upper,upper[1:]+upper[:1])):
  if abs(a[0]-.35)<.01 and abs(b[0]-.35)<.01:
   # Upper west edge runs north-to-south; translate the observed columns into its local s.
   faces[str(i)]={'bands':westbands(LOWER,TOP,offset=117.2-a[1],limit=math.dist(a,b))}
 d['skins']['upperHidden']={**d['skins']['hidden'],'field':'pale','window':{'w':1.8,'h':2.03,'sill':.65,'mullion':{'cols':[.5],'rows':[.5],'w':.055,'tone':'frame'}}}
 top={'id':'two-level-upper','plan':{'ring':upper},'z0':LOWER,'z1':TOP,'bands':[{'z0':LOWER,'z1':TOP,'skin':'upperHidden'}],
      'faces':faces,'roofTone':'roof','parapet':.65,'parapetTone':'pale','_src':{'setback':'LASER main high roof inset at north/south/east, PHOTO two upper pale rows setback over south red end','westWindows':'PHOTO2 rows of taller paired sash, one vertical and one middle horizontal bar','unseen':'INFER east/north/court window counts','parapet':'PHOTO pale inner wall;0.65m inferred'}}
 d['blocks']=[lower,top]
 meshes={}
 def tri(t,pts):
  m=meshes.setdefault(t,{'id':'nueces-'+t,'tone':t,'vertices':[],'triangles':[],'_src':'PHOTO visible roof/windows fixtures; dimensions inferred; northern roof fixtures INFER'});i=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in pts];m['triangles'].append([i,i+1,i+2])
 def quad(t,a,b,c,d):tri(t,[a,b,c]);tri(t,[a,c,d])
 def box(t,x0,x1,y0,y1,z0,z1):
  p=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]
  for a,b,c,e in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:quad(t,p[a],p[b],p[c],p[e])
 def cyl(t,x,y,z,r,h,n=10,cap='fan'):
  for k in range(n):
   a=math.tau*k/n;b=math.tau*(k+1)/n;p=[x+r*math.cos(a),y+r*math.sin(a),z];q=[x+r*math.cos(b),y+r*math.sin(b),z]
   quad(t,p,q,[q[0],q[1],z+h],[p[0],p[1],z+h]);tri(cap,[[x,y,z+h],[p[0],p[1],z+h],[q[0],q[1],z+h]])
 # Bright window surrounds are distinct from the dark glass, including intermediate sills.
 for v in CENTRES:
  for j,z in enumerate(FLOORS[1:-1],1):
   if j>=6 and not 6.3<v<110.7:continue
   x=.35 if j>=6 else 0;h=2.03 if j>=6 else 1.8
   box('trim',x-.06,x+.015,v-.98,v+.98,z+.56,z+.66)
   # Photo shows a complete proud pale surround, not just a recessed jamb/sill.
   box('trim',x-.055,x+.015,v-.98,v-.90,z+.65,z+.65+h+.08)
   box('trim',x-.055,x+.015,v+.90,v+.98,z+.65,z+.65+h+.08)
   box('trim',x-.055,x+.015,v-.98,v+.98,z+.65+h,z+.65+h+.08)
 # Broad pale ledges at the two real facade material transitions.
 for z in [3.8,19.5]:box('trim',-.10,.06,0,117.2,z-.10,z+.04)
 # Pipework/riser silhouettes and condenser banks, no guessed decorative rooftop pool.
 total=0
 for n,(x,y,nx,ny) in enumerate(BANKS):
  for i in range(nx):
   for j in range(ny):cyl('metal',x+i*.86,y+j*.96,TOP+.06,.32,.82+.12*(i%2));total+=1
  box('pipe',x-.6,x-.28,y-.2,y+ny*.96,TOP+.08,TOP+.35)
  box('metal',x-.7,x-.3,y-.3,y+.3,TOP+.06,TOP+1.10)
  if n<8:
   box('pipe',x+nx*.86+.4,x+nx*.86+1.4,y+.4,y+.48,TOP+.07,TOP+.16)
 for x,y in [(11,18),(11,48),(11,83),(25,108)]:
  box('metal',x,x+1.8,y,y+1.0,TOP,TOP+.45)
  cyl('pipe',x+2.4,y+.4,TOP,.17,1.2,10,'pipe')
 # Ventilation grilles visible along upper west wall, simplified low-frequency fixtures.
 for v in [14,27.5,40.8,54.4,68.1,81.8,95.5,108]:
  for z in [20.6,23.8]:
   for dv in [0,.28]:box('pale',.23,.30,v+dv,v+dv+.14,z,z+.14)
 # Retain separate broad roof zones, all units located on the scan-supported high roof.
 for m in meshes.values():
  verts=[];lookup={};remap=[]
  for p in m['vertices']:
   k=tuple(p)
   if k not in lookup:lookup[k]=len(verts);verts.append(p)
   remap.append(lookup[k])
  m['vertices']=verts;m['triangles']=[[remap[i] for i in t] for t in m['triangles']]
 d['detailMeshes']=list(meshes.values());d['_roofEquipment']={'visibleBanksModeled':8,'inferredNorthernBanks':4,'units':total,'_src':'PHOTO eight distinct groups visible on southern roof; counts approximate where overlap; INFER four northern groups'}
 for b in d['blocks']:
  ring=b['plan']['ring'];lengths=[math.dist(a,c) for a,c in zip(ring,ring[1:]+ring[:1])]
  for k,f in b.get('faces',{}).items():
   for bd in f['bands']:
    for o in bd.get('openings',[]):assert 0<=o['s0']<o['s1']<=lengths[int(k)]+.001 and bd['z0']<=o['z0']<o['z1']<=bd['z1']
 for m in d['detailMeshes']:
  assert all(math.isfinite(c) for p in m['vertices'] for c in p)
  assert all(0<=i<len(m['vertices']) for t in m['triangles'] for i in t)
 assert d['footprint']==old['footprint'] and d['frame']==old['frame']
 deduplicate_detail_meshes(d)
 OUT.write_text(json.dumps(d,separators=(',',':'),ensure_ascii=False));print(json.dumps({'bytes':OUT.stat().st_size,'blocks':len(d['blocks']),'condensers':total,'triangles':sum(len(m['triangles']) for m in d['detailMeshes'])}))
if __name__=='__main__':main()
