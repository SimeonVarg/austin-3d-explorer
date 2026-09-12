"""Photo-informed everyday halls. Owns only data/campus_buildings.json.

Profiles are editable in data/campus_profiles.json. Existing footprint holes and
roof rigs survive; photograph-derived facade dimensions are not survey claims.
"""
import json, math, copy
from pathlib import Path
from shapely.geometry import shape

ROOT=Path(__file__).resolve().parents[1]
PROFILES=json.loads((ROOT/'data/campus_profiles.json').read_text())
SNAP=PROFILES['snapshot']
FEATURES=json.loads((ROOT/f'data/snapshots/{SNAP}/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']
ROOFS=json.loads((ROOT/'data/roofs.geojson').read_text())['rig']['roofs']
T=PROFILES['detail']

def frame(ring):
 lat=sum(p[1] for p in ring[:-1])/(len(ring)-1);mx=111320*math.cos(math.radians(lat));my=111320
 ax=math.cos(math.radians(5));ay=-math.sin(math.radians(5));p0=ring[0]
 uv=[((p[0]-p0[0])*mx*ax+(p[1]-p0[1])*my*ay,-(p[0]-p0[0])*mx*ay+(p[1]-p0[1])*my*ax)for p in ring[:-1]]
 u=min(p[0]for p in uv);v=min(p[1]for p in uv)
 F=dict(o=[p0[0]+(u*ax-v*ay)/mx,p0[1]+(u*ay+v*ax)/my],ax=ax,ay=ay,mx=mx,my=my,L=max(p[0]for p in uv)-u,W=max(p[1]for p in uv)-v)
 return F,[[round(p[0]-u,3),round(p[1]-v,3)]for p in uv]

def uv(F,p):
 x=(p[0]-F['o'][0])*F['mx'];y=(p[1]-F['o'][1])*F['my']
 return [round(x*F['ax']+y*F['ay'],3),round(-x*F['ay']+y*F['ax'],3)]

def band(a,b,skin):return dict(z0=round(a,3),z1=round(b,3),skin=skin)

def bake(p):
 f=next(f for f in FEATURES if f['properties'].get('name')==p['name'])
 g=shape(f['geometry']);g=g if g.geom_type=='Polygon' else max(g.geoms,key=lambda p:p.area)
 ring=list(map(list,g.exterior.coords));holes=[list(map(list,r.coords))for r in g.interiors]
 F,outline=frame(ring);plan=dict(ring=outline,holes=[[uv(F,x)for x in r[:-1]]for r in holes])
 id=f['properties']['id'];rigs=[v for k,v in ROOFS.items()if k.startswith(id+'/')]
 h=p.get('height') or (min(r['base']for r in rigs)-T['roofClearance'] if rigs else f['properties']['final_height'])
 h=round(h,3);n=p['rows'];ground=p.get('ground',h/n);pitch=(h-ground)/(n-1) if n>1 else h
 floors=[0]+[round(ground+i*pitch,3)for i in range(n)] if n>1 else [0,h]
 palette=copy.deepcopy(PROFILES['colours']);palette['wall']={'hex':p['colour']}
 skins={k:dict(kind='flat',field=k)for k in ['wall','stone','trim','roofFlat','dark']}
 def window(field,bay,w,height,sill,arch=None):
  win=dict(w=w,h=height,sill=sill,frame=dict(w=T['frame'],tone='trim'),mullion=dict(cols=p.get('columns',[.5]),rows=p.get('sash',[.5]),w=T['mullion'],tone='trim'))
  if arch:win['arch']=dict(rise=arch,trim=T['archTrim'],tone=field,segments=T['archSegments'])
  return dict(kind='bays',field=field,bay=bay,window=win,glass='glass',frame='stone',reveal=p.get('reveal',T['reveal']))
 skins['upper']=window('wall',p['bay'],p['window'],min(p.get('windowHeight',pitch*.60),pitch-T['headRoom']),T['sill'],p.get('arch'))
 skins['lower']=window(p.get('base','stone'),p['bay'],p.get('groundWindow',p['window']),min(p.get('groundWindowHeight',ground*.63),ground-T['headRoom']),T['sill'],p.get('groundArch'))
 bands=[band(0,ground,'lower'),band(ground,h-T['cornice'],'upper'),band(h-T['cornice'],h,'trim')]if n>1 else [band(0,h-T['cornice'],'lower'),band(h-T['cornice'],h,'trim')]
 b=dict(id=p['code'].lower()+'-walls',plan=plan,z0=0,z1=h,bands=bands,roofTone='roofFlat',cap=not bool(rigs))
 # Blank theater/art/stair volumes are recorded explicitly, not wallpapered
 # with the ordinary office-window treatment.
 if p.get('blankFaces'):
  b['faces']={str(i):dict(bands=[band(0,h-T['cornice'],'wall'),band(h-T['cornice'],h,'trim')])for i in p['blankFaces']}
 if p.get('onlyWindowFaces') is not None:
  b['faces']={str(i):dict(bands=bands if i in p['onlyWindowFaces'] else [band(0,h,'wall')])for i in range(len(outline))}
 # Some elevations have a deep screen of narrow openings, not sash windows.
 if p.get('screen'):
  skins['upper']=dict(kind='bays',field='wall',bay=p['bay'],window=dict(w=p['window'],h=p['windowHeight'],sill=T['sill']),glass='dark',frame='stone',reveal=p['reveal'],pier=dict(w=p['pier'],d=p['pierDepth'],tone='stone'))
 blocks=[b]
 if p.get('roofWings'):
  b['cap']=False;palette['roof']={'hex':p['roofColour']}
  for i,r in enumerate(p['roofWings']):
   blocks.append(dict(id=p['code'].lower()+'-roof-'+str(i),plan=r,z0=h-T['cornice'],z1=h,bands=[band(h-T['cornice'],h,'trim')],roofTone='roof',roof=dict(kind='hip',pitch=p['roofPitch'],over=p['roofOver'],tone='roof',lipTone='trim',soffitTone='stone')))
 # Thin real courses follow the complete footprint, including courtyard walls.
 # They replace a slice of the facade instead of overlapping it.
 for z in p.get('courses',[]):
  new=[]
  for old in b['bands']:
   if old['z0']<z<old['z1']:
    new.extend([band(old['z0'],z,old['skin']),band(z,min(z+T['courseHeight'],old['z1']),'trim')])
    if z+T['courseHeight']<old['z1']:new.append(band(z+T['courseHeight'],old['z1'],old['skin']))
   else:new.append(old)
  b['bands']=new
 # Entries are placed only on the profile's selected wall edge. Proportions
 # come from UT exterior views; a framed door and projecting lintel give a
 # readable arrival without inventing a tower or extending a footprint.
 if 'entryEdge' in p:
  edge=p['entryEdge'];a,c=outline[edge],outline[(edge+1)%len(outline)];length=math.dist(a,c)
  bw=min(p.get('entryWidth',T['entryWidth']),length*.72)
  skins['entry']=window('stone',length,bw,min(T['entryHeight'],ground-T['headRoom']),T['entrySill'],p.get('entryArch'))
  skins['entry']['window']['cols']=[p.get('entryAt',.5)]
  skins['entry']['window']['mullion']={'cols':[.5],'rows':[.8],'w':T['mullion'],'tone':'dark'}
  face=copy.deepcopy(b['faces'].get(str(edge),dict(bands=b['bands']))) if 'faces'in b else dict(bands=copy.deepcopy(b['bands']))
  face['bands']=[band(0,ground,'entry')]+[x for x in face['bands']if x['z0']>=ground]
  b.setdefault('faces',{})[str(edge)]=face
 source=f"https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/{p['code']}/"
 return dict(name=p['name'],id=id,code=p['code'],sources={'reference':source,'footprint':f'data/snapshots/{SNAP}/buildings.detailed.geojson','dimensions':'Existing footprint and roof alignment retained. Window spacing, wall colours, trim and unphotographed sides are photo-derived approximations. Goldsmith roof subdivided around its mapped open courtyard.','observations':p['observations']},footprint=dict(ring=ring,holes=holes),frame={'obb':F},levels={'floors':floors},colours=palette,skins=skins,blocks=blocks,preserveRoof=bool(rigs) and not bool(p.get('roofWings')),open=['Small carved ornament and unphotographed elevation details remain simplified.'])

buildings=[bake(p)for p in PROFILES['buildings']]
assert len({b['id']for b in buildings})==len(buildings)
for b in buildings:
 assert b['blocks'][0]['z1']>0
 assert shape({'type':'Polygon','coordinates':[b['footprint']['ring']]+b['footprint']['holes']}).is_valid,b['name']
(ROOT/'data/campus_buildings.json').write_text(json.dumps(dict(version=1,buildings=buildings),separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
print('Campus halls:',len(buildings),'preserved roof rigs:',sum(b['preserveRoof']for b in buildings))
