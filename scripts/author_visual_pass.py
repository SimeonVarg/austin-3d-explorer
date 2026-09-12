"""Author the September campus/apartment pass; writes only the named JSON specs.
Numbers marked 'derived' are photo proportions, not surveyed dimensions.
The fetched snapshot supplies footprints, not reliable architectural heights.
"""
import json,math,copy
from pathlib import Path
from shapely.geometry import shape
ROOT=Path(__file__).resolve().parents[1]
SNAP='2026-09-12'
features=json.loads((ROOT/f'data/snapshots/{SNAP}/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']
OUT=ROOT/'data/apartments'
NEW=[]
def feature(name):
 return next(f for f in features if (f['properties'].get('name') or '')==name)
def frame(ring):
 lat=sum(p[1] for p in ring[:-1])/(len(ring)-1);mx=111320*math.cos(math.radians(lat));my=111320;ax=math.cos(math.radians(5));ay=-math.sin(math.radians(5));p0=ring[0]
 uv=[((p[0]-p0[0])*mx*ax+(p[1]-p0[1])*my*ay,-(p[0]-p0[0])*mx*ay+(p[1]-p0[1])*my*ax) for p in ring[:-1]]
 u=min(p[0]for p in uv);v=min(p[1]for p in uv)
 obb=dict(o=[p0[0]+(u*ax-v*ay)/mx,p0[1]+(u*ay+v*ax)/my],ax=ax,ay=ay,mx=mx,my=my,L=max(p[0]for p in uv)-u,W=max(p[1]for p in uv)-v)
 return obb,[[round(p[0]-u,3),round(p[1]-v,3)]for p in uv]
def palette():
 return {k:{'hex':v} for k,v in dict(wall='#c5b597',stone='#ded8c9',trim='#dfdbcf',glass='#506b78',frame='#807b70',roof='#965a42',roofFlat='#787b77',metal='#596264',white='#e0e5e3',dark='#353c3e',brick='#9b6e57',wood='#885041',water='#458c95',plant='#526447',pave='#aea58f',rail='#566165').items()}
def flat(tone):return dict(kind='flat',field=tone)
def bays(field='wall',bay=3.5,w=1.5,h=2,sill=.7,**kw):return dict(kind='bays',field=field,bay=bay,window=dict(w=w,h=h,sill=sill),glass='glass',frame='frame',reveal=.24,**kw)
def band(a,b,s,**kw):return dict(z0=a,z1=b,skin=s,**kw)
def block(id,plan,a,b,skin,**kw):return dict(id=id,plan=plan,z0=a,z1=b,bands=[band(a,b,skin)],roofTone='roofFlat',**kw)
def base(name,source,f=None):
 f=f or feature(name);g=shape(f['geometry']);g=g if g.geom_type=='Polygon' else max(g.geoms,key=lambda p:p.area);ring=[list(p)for p in g.exterior.coords];F,uv=frame(ring)
 s=dict(name=name,id=f['properties']['id'],sources={'footprint':f'data/snapshots/{SNAP}/buildings.detailed.geojson, feature '+f['properties']['id'],'reference':source,'dimensions':'Footprint from snapshot. Facade widths, setbacks, reveals, roof subdivisions and floor spacing are derived from the cited exterior views; these are not survey measurements.'},footprint={'ring':ring},frame={'obb':F},levels={'floors':[0]},colours=palette(),skins={'wall':flat('wall'),'stone':flat('stone'),'trim':flat('trim'),'metal':flat('metal'),'brick':flat('brick'),'roof':flat('roof'),'glass':dict(kind='storefront',glass='glass',frame='dark',fasciaTone='trim',fascia=.2,mullion=1.5,mullionW=.08,reveal=.35),'window':bays()},blocks=[],open=['Unphotographed elevations and small dimensions remain approximate.'])
 return s,F,uv
def save(slug,s):
 for b in s['blocks']: b.setdefault('_src','reference; dimensions are derived, see sources.dimensions')
 (OUT/(slug+'.json')).write_text(json.dumps(s,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');NEW.append((slug,s));print(slug,len(s['blocks']))
def cornice(s,id,plan,z,width=.4,tone='trim'):
 a,b,c,d=plan;s['skins'][tone]=flat(tone);s['blocks'].append(block(id,[a-width,b+width,c-width,d+width],z,z+.28,tone))
def roof(s,b,pitch=25,kind='hip',**kw):b['roof']={'kind':kind,'pitch':pitch,'over':.55,'tone':'roof','lipTone':'trim','soffitTone':'wood',**kw};b['roofTone']='roof'
def floors(s,n,z0,pitch):s['levels']['floors']=[0]+[round(z0+i*pitch,3)for i in range(n+1)]
def topdeck(s,L,W,z):
 s['deck']={'z':z,'items':[dict(id='pool',plan=[L*.57,L*.89,W*.16,W*.50],h=.12,tone='water'),dict(id='planter',plan=[L*.09,L*.15,W*.15,W*.82],h=.65,tone='plant')]}
# Villas: 30 above-ground stories and the glass amenity crown are described by Rhode.
s,F,uv=base('Villas on 24th','https://www.rhodepartners.com/villas-on-24th');L,W=F['L'],F['W'];floors(s,25,14.4,3.05)
s['colours']['metal']={'hex':'#786d54'};s['skins']['panel']=bays('white',3.05,1.65,2.45,.27,pier={'w':.35,'d':.35,'tone':'white'});s['skins']['panel']['window']['frame']={'w':.10,'tone':'trim'};s['skins']['panel']['window']['mullion']={'cols':[],'rows':[.24],'w':.07,'tone':'frame'}
s['colours'].update(bronzeLight={'hex':'#afa487'},bronzeDark={'hex':'#5c584a'},bronzeMid={'hex':'#8b8067'});s['skins']['garage']=dict(kind='flat',field='metal',facets={'w':3.1,'h':3.2,'depth':.42,'tone':'metal','tones':['bronzeLight','metal','bronzeDark','bronzeMid']})
s['blocks']=[block('glazed-lobby','footprint',0,4.8,'glass'),block('parking-podium','footprint',4.8,14.4,'garage'),block('residential',[1,L-1,1,W-1],14.4,90.65,'panel',parapet=.5,parapetTone='white'),block('amenity-pavilion',[2,L*.50,2,W-2],90.65,97.2,'glass')]
# Projecting floor ledges create the deep alternating panel bays visible in the reference.
for i,z in enumerate(s['levels']['floors'][2:-1]):
 if i%3==0:cornice(s,'panel-course-'+str(i),[1,L-1,1,W-1],z,.10,'white')
topdeck(s,L,W,90.65);save('villas-on-24th',s)
# Icon replaces the former Intervarsity site, verified against official street address
# and ArcGIS address geocode (-97.7430846,30.2852945). The old 15x13m church
# footprint is not the tower footprint; define the parcel-aligned derived tower envelope.
f=copy.deepcopy(feature('Intervarsity Christian Church'));x,y=-97.743258,30.285310;mx=111320*math.cos(math.radians(y));ax=math.cos(math.radians(5));ay=-math.sin(math.radians(5));ring=[]
for u,v in [(-14,-15),(14,-15),(14,15),(-14,15),(-14,-15)]:ring.append([x+(u*ax-v*ay)/mx,y+(u*ay+v*ax)/111320])
f['geometry']={'type':'Polygon','coordinates':[ring]};s,F,uv=base('Icon','https://www.rhodepartners.com/icon',f);s['sources']['placement']='https://www.iconataustin.com/; 2200 San Antonio Street. ArcGIS World GeocodeServer address match score 100 at -97.743084597282,30.285294489137. 28x30m envelope derived from facade bay counts and neighbor spacing; former Intervarsity footprint is retired, not reused as tower plan.';L,W=F['L'],F['W'];floors(s,28,4.8,2.94)
s['skins']['icon']=bays('white',2.65,1.65,2.25,.3,pier={'w':.24,'d':.20,'tone':'trim'});s['skins']['icon']['floorLine']={'h':.18,'tone':'trim'};s['skins']['icon']['window']['mullion']={'cols':[],'rows':[.33],'w':.06,'tone':'frame'}
s['blocks']=[block('lobby',[0,L,0,W],0,4.8,'glass'),block('lower-grid',[0,L,0,W],4.8,16.56,'icon'),block('tower',[1,L-1,1,W-1],16.56,87.12,'icon',parapet=.6,parapetTone='white'),block('crown',[L*.36,L-1,3,W-3],87.12,93.6,'glass',chamfer=2)]
cornice(s,'podium-ledge',[0,L,0,W],16.3,.4);topdeck(s,L,W,87.12);s['labelOverride']=True
save('icon',s)
# Inspire: 18 stories, four small-window podium levels under vertical panel tower.
s,F,uv=base('Inspire on 22nd','https://www.rhodepartners.com/inspire-on-22nd');L,W=F['L'],F['W'];floors(s,17,5.7,3.05)
s['colours']['metal']={'hex':'#acb5b6'};s['skins']['small']=bays('metal',2.4,.85,1.55,.7);s['skins']['small']['strip']={'w':.05,'tone':'frame','at':'joints'};s['skins']['silver']=bays('white',3,1.25,2.5,.25,pier={'w':.18,'d':.16,'tone':'trim'});s['skins']['silver']['fields']=['white','metal','white','white','metal'];s['skins']['silver']['window']['mullion']={'cols':[],'rows':[.22],'w':.06,'tone':'frame'};s['skins']['screen']=dict(kind='flat',field='dark',fins={'pitch':.7,'w':.12,'d':.15,'tone':'metal'})
s['blocks']=[block('lobby','footprint',0,5.7,'glass'),block('podium','footprint',5.7,17.9,'small'),block('tower',[2,L-2,2,W-2],17.9,57.55,'silver',parapet=.45,parapetTone='metal')]
# The open crown is drawn as beams, not a solid roof box.
for i in range(9):
 u=3+i*(L-6)/8;s['blocks'].append(block('crown-post-'+str(i),[u,u+.14,3,3.14],57.55,61.1,'trim'))
for i in range(9):
 u=3+i*(L-6)/8;s['blocks'].append(block('crown-post-n-'+str(i),[u,u+.14,W-3,W-2.86],57.55,61.1,'trim'))
for v in [3,W-3]:s['blocks'].append(block('crown-beam-'+str(v),[3,L-3,v,v+.16],60.94,61.1,'trim'))
s['blocks'].append(block('crown-return',[3,3.16,3,W-3],60.94,61.1,'trim'))
save('inspire-on-22nd',s)
# Pointe: two courts are described by the architect. Their dimensions are derived.
s,F,uv=base('Pointe on Rio','https://www.rhodepartners.com/the-pointe-on-rio');L,W=F['L'],F['W'];floors(s,5,4.2,3.1);s['sources']['alias']='https://www.rhodepartners.com/west-campus-student-housing lists Tradition of Rio (formerly Pointe on Rio).';s['skins']['doors']=bays('white',3.3,1.8,2.44,.12,strip={'w':.5,'tone':'wood','at':'joints'});s['skins']['doors']['window']['frame']={'w':.08,'tone':'trim'}
holes=[[[12,17],[25,17],[25,39],[12,39]],[[12,51],[25,51],[25,72],[12,72]]]
s['blocks']=[block('ground','footprint',0,4.2,'glass'),block('residential',{'ring':uv,'holes':holes},4.2,19.7,'doors',parapet=.65,parapetTone='white')];s['deck']={'z':4.2,'items':[dict(id='pool',plan=[14,23,21,35],h=.08,tone='water'),dict(id='garden',plan=[14,23,54,68],h=.2,tone='plant')]};
# The architect's southwest aerial shows red-brown rooftop rooms and open Juliet guards.
s['balcony']={'proj':.18,'slabT':.10,'railH':1.05,'railT':.025,'railPitch':.16,'railPost':.018,'slabTone':'trim','railTone':'rail'}
res=s['blocks'][1]
for i in range(len(uv)):
 a,b=uv[i],uv[(i+1)%len(uv)];le=math.dist(a,b);n=max(1,round(le/3.3));mod=le/n
 if le>5:res.setdefault('faces',{})[str(i)]={'bands':[band(4.2,19.7,'doors',balconies=[dict(s0=(j+.5)*mod-.9,s1=(j+.5)*mod+.9)for j in range(n)])]}
s['skins']['roofroom']=bays('wood',4.5,2.8,1.2,.3)
for i,(u,v)in enumerate([(3,6),(L-10,6),(3,32),(L-10,43),(3,65),(L-10,76)]):
 s['blocks'].append(block('roof-room-'+str(i),[u,u+7,v,v+6],19.7,22.1,'roofroom'))
s['sources']['roof']='https://www.rhodepartners.com/the-pointe-on-rio, Pointe on Rio 024-aerial.jpg; room dimensions and unphotographed courtyard depths are derived.'
save('pointe-on-rio',s)
# Rambler's existing authored proportions are preserved; convert its filled
# perimeter to a holed building with recessed panes and a real open courtyard.
s,F,uv=base('Rambler','https://lvcollective.com/case-study/rendering-to-reality-rambler-atx/; js/westcampus.js TIER4.RAM');L,W=F['L'],F['W'];floors(s,6,7.0,3.05)
s['colours'].update(metal={'hex':'#345f69'},panelMid={'hex':'#c1c4bd'},panelShade={'hex':'#a8aaa4'},brick={'hex':'#b87e62'})
s['skins']['checker']=dict(kind='pixel',course=1.525,plank=1.5,macro=[1,1],tones=['white','panelMid','panelShade'],weights=[7,2,1],runMax=1,bay=3.0,window=dict(w=1.1,h=2.1,sill=.5,mullion={'cols':[],'rows':[.35],'w':.08,'tone':'frame'}),glass='glass',frame='frame',reveal=.2)
s['skins']['brickwin']=bays('brick',3,1.35,2.1,.5)
s['skins']['crown']=dict(kind='bays',field='metal',bay=.55,strip={'w':.03,'tone':'dark','at':'joints'})
plan={'ring':uv,'holes':[[[14,29],[42,29],[42,69],[14,69]]]}
s['blocks']=[block('base',plan,0,7,'glass'),block('residential',plan,7,25.3,'checker'),block('teal-crown',plan,25.3,28.4,'crown')]
# Broad brick bays on the photographed street fronts, not teal vertical stripes.
for bi in [0,1]:
 b=s['blocks'][bi];b['overrides']=[]
 for u in [12,37]:b['overrides'].append(dict(region=[u,u+5,-1,W+1],bands=[band(b['z0'],b['z1'],'brickwin')]))
 for v in [25,57,76]:
  for u0,u1 in [(-1,8),(L-8,L+1)]:b['overrides'].append(dict(region=[u0,u1,v,v+5],bands=[band(b['z0'],b['z1'],'brickwin')]))
# The crest is a continuous raised edge around the northeast corner.
path=[[L,W-17,28.4],[L,W-10,29.1],[L,W-4,30.2]]
for i in range(1,13):
 a=math.pi/2*i/12;path.append([L-4+4*math.cos(a),W-4+4*math.sin(a),30.2+.6*math.sin(math.pi*i/12)])
path += [[L-10,W,29.1],[L-17,W,28.4]]
s['blocks'][2]['crest']={'path':path,'width':.45,'tone':'metal'}
s['blocks'][2]['plan']=copy.deepcopy(plan);s['blocks'][2]['plan']['ring']=[[L,W-4]]+[p[:2]for p in path[3:15]]+uv[1:]
# A deep brick portal on Seton, modeled as receding reveals above the entrance.
for i in range(6):
 s['blocks'].append(block('entry-lintel-'+str(i),[L-.1-i*.3,L+.35,32-i*.5,40+i*.5],3.2+i*.58,3.45+i*.58,'brick'))
s['blocks'][0].setdefault('overrides',[]).append(dict(region=[L-1,L+1,32,40],bands=[band(0,3.2,'glass',inset=1.6),band(3.2,7,'brick')]))
s['deck']={'z':0,'items':[dict(id='court-paving',plan=[14,42,29,69],h=.08,tone='pave'),dict(id='pool',plan=[19,29,37,61],h=.14,tone='water')]}
s['open'].append('Courtyard plan and entrance extents are derived; crown curve follows the exterior photograph, not a measured elevation.')
save('rambler',s)
# Campus: photographed elevations take precedence over generic floor grids.
s,F,uv=base('Battle Hall','docs/campus-truth/BTL.md; docs/shots/verdict-battle-vs-photo.jpg');L,W=F['L'],F['W'];s['levels']['floors']=[0,1.2,7.2,17.7];s['skins']['lower']=bays('stone',4.3,1.5,3.4,1.2);s['skins']['arches']=bays('stone',8.5,3.15,7.2,.55);s['skins']['arches']['window']['arch']={'rise':1.6,'segments':24,'tone':'trim','trim':.35};s['skins']['arches']['window']['mullion']={'w':.11,'cols':[.25,.5,.75],'rows':[.22,.45,.68,.83],'tone':'trim'};s['skins']['lower']['window']['mullion']={'w':.09,'cols':[.5],'rows':[.45],'tone':'trim'};s['skins']['arches']['reveal']=.6
b=block('reading-hall',[14.9,34.45,0,43.1],0,17.7,'lower');b['bands']=[band(0,1.2,'stone'),band(1.2,7.2,'lower'),band(7.2,16.2,'arches'),band(16.2,17.7,'trim')];roof(s,b,25);s['blocks']=[b,block('west-stack-wing',[0,14.9,7.8,35],0,16,'lower')];roof(s,s['blocks'][1],25)
for z in [1.1,7,16.2,17.5]:cornice(s,'cornice-'+str(z),[14.9,34.45,0,43.1],z,.32)
# Five iron Juliet rails on the photographed east face.
s['balcony']={'proj':.65,'slabT':.16,'railH':1,'railT':.045,'railPitch':.2,'railPost':.035,'slabTone':'trim','railTone':'dark'}
b['faces']={'u1':{'bands':copy.deepcopy(b['bands'])}}
b['faces']['u1']['bands'][2]['balconies']=[{'s0':i*8.62+2.65,'s1':i*8.62+5.97} for i in range(5)]
save('battle-hall',s)
s,F,uv=base('Union Building','docs/campus-truth/UNB.md; https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/UNB/');L,W=F['L'],F['W'];s['levels']['floors']=[0,4.4,9.5,13,18.3];s['preserveRoof']=True
s['skins']['arcade']=bays('stone',5.3,2.3,3.6,.6);s['skins']['arcade']['window']['arch']={'rise':1.15,'tone':'trim','trim':.18};s['skins']['arcade']['window']['mullion']={'cols':[.5],'rows':[.55],'w':.10};s['skins']['arcade']['reveal']=.5
s['skins']['paired']=bays('wall',5.3,1.1,2.6,.6);s['skins']['paired']['window']['offsets']=[[-.9,1.1],[.9,1.1]]
s['skins']['slits']=bays('stone',4.36,1.4,2.4,1.2)
s['skins']['towerdoor']=bays('stone',13.1,3.7,7.2,1.7);s['skins']['towerdoor']['window']['arch']={'rise':1.85,'tone':'trim','trim':.45};s['skins']['towerdoor']['window']['mullion']={'cols':[.33,.66],'rows':[.35,.7],'w':.12};s['skins']['towerdoor']['window']['cols']=[.5];s['skins']['towerdoor']['reveal']=.85
s['blocks']=[block('main-wings',{'ring':uv},0,12.80,'paired')];s['blocks'][0]['bands']=[band(0,4.4,'paired'),band(4.4,9.5,'arcade'),band(9.5,12.80,'paired')]
b=block('entrance-tower',[20.3,33.4,0,13.5],0,18.3,'stone');b['bands']=[band(0,9.5,'towerdoor'),band(9.5,13,'paired'),band(13,18.3,'slits')];roof(s,b,18,over=.85);s['blocks'].append(b);cornice(s,'tower-eave',[20.3,33.4,0,13.5],18.05,.75)
save('texas-union',s)
s,F,uv=base(feature(next(f['properties']['name'] for f in features if 'Perry' in (f['properties'].get('name') or '') ))['properties']['name'],'docs/campus-truth/PCL.md')
s['name']='Perry-Castañeda Library';s['levels']['floors']=[0,4.8,9.6,14.4,19.2,24];s['skins']['slots']=bays('stone',2.5,.72,3.8,.5);s['skins']['slots']['reveal']=.85;s['skins']['slots']['pier']={'w':.48,'d':.22,'tone':'stone'}
b=block('library',{'ring':uv},0,28.4,'stone',parapet=.5,parapetTone='stone');b['faces']={}
# Only the short west and north-facing window stretches, not an all-wall grid.
for i in [1,5,10]:b['faces'][str(i)]={'bands':[band(0,4.8,'stone'),band(4.8,24,'slots'),band(24,28.4,'stone')]}
s['blocks']=[b];s['open'].append('The source maximum of 36.1m is not assigned to a guessed roof box. Main roof 28.4m and slot-band extents are derived pending full elevation measurement.');save('pcl',s)
# Preserve the surveyed roof rigs while replacing the blurry repeated facades.
def to_uv(F,p):
 dx=(p[0]-F['o'][0])*F['mx'];dy=(p[1]-F['o'][1])*F['my']
 return [round(dx*F['ax']+dy*F['ay'],3),round(-dx*F['ay']+dy*F['ax'],3)]
s,F,uv=base('Robert A. Welch Hall','https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/WEL/');s['preserveRoof']=True
s['colours']['brick']={'hex':'#b58f76'};s['levels']['floors']=[0,3.1,7.8,12.5,18.2]
s['skins']['welch']=bays('brick',3.3,1.35,3.1,.8);s['skins']['welch']['window'].update(frame={'w':.13,'tone':'trim'},mullion={'cols':[.5],'rows':[.33,.66],'w':.07,'tone':'trim'})
s['skins']['basement']=bays('stone',3.3,1.35,1.65,.6);s['skins']['basement']['window']['mullion']={'cols':[.5],'rows':[.5],'w':.07,'tone':'trim'}
f=feature('Robert A. Welch Hall');holes=f['geometry']['coordinates'][1:];s['footprint']['holes']=holes
s['blocks']=[block('welch-wings',{'ring':uv,'holes':[[to_uv(F,p)for p in ring[:-1]]for ring in holes]},0,18.2,'welch')]
s['blocks'][0]['bands']=[band(0,3.1,'basement'),band(3.1,17.55,'welch'),band(17.55,18.2,'trim')]
s['open'].append('Historic and laboratory wing window modules are photo-derived; original pitched roof positions are retained. Sculpted portal ornament remains simplified.')
save('welch-hall',s)
for slug,name,code,height,bay in [('benedict-hall','Benedict Hall','BEN',21,4.8),('mezes-hall','Mezes Hall','MEZ',21.5,4.8),('batts-hall','Batts Hall','BAT',21.5,4.8)]:
 s,F,uv=base(name,f'https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/{code}/');s['preserveRoof']=True;s['levels']['floors']=[0,7.2,15.5,height]
 s['skins']['lower']=bays('stone',bay,1.75,3.5,1.5);s['skins']['upper']=bays('stone',bay,1.9,4.7,1.1);s['skins']['attic']=bays('stone',bay,1.8,2.1,1.1)
 for skin in ['lower','upper','attic']:s['skins'][skin]['window'].update(frame={'w':.18,'tone':'trim'},mullion={'cols':[.33,.66],'rows':[.25,.5,.75],'w':.065,'tone':'trim'})
 s['skins']['quoin']=dict(kind='bays',field='stone',bay=2,louvre={'pitch':.75,'w':.045,'tone':'frame'})
 b=block('hall',{'ring':uv},0,height,'upper');b['bands']=[band(0,7.2,'lower'),band(7.2,15.5,'upper'),band(15.5,height,'attic')];b['overrides']=[]
 # The stone corner joints are confined to the corner strips visible in UT's images.
 for u,v in uv:
  b['overrides'].append(dict(region=[u-.7,u+.7,v-.7,v+.7],bands=[band(0,height,'quoin')]))
 s['blocks']=[b]
 # Stringcourses follow the footprint; narrow bands do not close its re-entrant courts.
 for z in [7.05,15.2]:s['blocks'].append(block('stringcourse-'+str(z),{'ring':uv},z,z+.22,'trim',cap=False))
 s['open'].append('Wall subdivisions and window spacing are derived from UT photographs. Existing door approaches and roof geometry are retained; sculpted medallions are not yet modeled.')
 save(slug,s)
index=json.loads((OUT/'index.json').read_text(encoding='utf-8'))
for slug,s in NEW:
 if slug+'.json' not in index['buildings']:index['buildings'].append(slug+'.json')
 if s['id'] not in index['replacedBuildingIds']:index['replacedBuildingIds'].append(s['id'])
 for n in [s['name']]+(['Intervarsity Christian Church']if slug=='icon'else[]):
  if n not in index['replacedNames']:index['replacedNames'].append(n)
(OUT/'index.json').write_text(json.dumps(index,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
