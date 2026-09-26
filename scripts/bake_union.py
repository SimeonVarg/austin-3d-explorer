"""Own the Texas Union authored asset; derive only the south tower details.

The snapshot fixes footprint/frame. Facade depths and proportions remain
exterior-reference estimates. Running this file writes no other building.
"""
import json,math,copy
from pathlib import Path
from shapely.geometry import shape
ROOT=Path(__file__).resolve().parents[1]
SNAP='2026-09-12'
features=json.loads((ROOT/f'data/snapshots/{SNAP}/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']
OUT=ROOT/'data/apartments'
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
def cornice(s,id,plan,z,width=.4,tone='trim'):
 a,b,c,d=plan;s['skins'][tone]=flat(tone);s['blocks'].append(block(id,[a-width,b+width,c-width,d+width],z,z+.28,tone))
def roof(s,b,pitch=25,kind='hip',**kw):b['roof']={'kind':kind,'pitch':pitch,'over':.55,'tone':'roof','lipTone':'trim','soffitTone':'wood',**kw};b['roofTone']='roof'

def build_base():
 s,F,uv=base('Union Building','docs/campus-truth/UNB.md; https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/UNB/');L,W=F['L'],F['W'];s['levels']['floors']=[0,4.4,9.5,13,18.3];s['preserveRoof']=True
 s['skins']['arcade']=bays('stone',5.3,2.3,3.6,.6);s['skins']['arcade']['window']['arch']={'rise':1.15,'tone':'trim','trim':.18};s['skins']['arcade']['window']['mullion']={'cols':[.5],'rows':[.55],'w':.10};s['skins']['arcade']['reveal']=.5
 s['skins']['paired']=bays('wall',5.3,1.1,2.6,.6);s['skins']['paired']['window']['offsets']=[[-.9,1.1],[.9,1.1]]
 s['skins']['slits']=bays('stone',4.36,1.4,2.4,1.2)
 s['skins']['towerdoor']=bays('stone',13.1,3.7,7.2,1.7);s['skins']['towerdoor']['window']['arch']={'rise':1.85,'tone':'trim','trim':.45};s['skins']['towerdoor']['window']['mullion']={'cols':[.33,.66],'rows':[.35,.7],'w':.12};s['skins']['towerdoor']['window']['cols']=[.5];s['skins']['towerdoor']['reveal']=.85
 s['blocks']=[block('main-wings',{'ring':uv},0,12.80,'paired')];s['blocks'][0]['bands']=[band(0,4.4,'paired'),band(4.4,9.5,'arcade'),band(9.5,12.80,'paired')]
 b=block('entrance-tower',[20.3,33.4,0,13.5],0,18.3,'stone');b['bands']=[band(0,9.5,'towerdoor'),band(9.5,13,'paired'),band(13,18.3,'slits')];roof(s,b,18,over=.85);s['blocks'].append(b);cornice(s,'tower-eave',[20.3,33.4,0,13.5],18.05,.75)
 for b in s['blocks']: b.setdefault('_src','reference; dimensions are derived, see sources.dimensions')
 return s


def build():
 from campus_union import refine
 return refine(build_base())


def main():
 s=build()
 (OUT/'texas-union.json').write_text(json.dumps(s,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
 print('texas-union',len(s['blocks']),'blocks')
 return s


if __name__=='__main__':
 main()
