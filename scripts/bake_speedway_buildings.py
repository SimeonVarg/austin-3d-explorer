"""Source-informed Powers and Patton envelopes. Owns data/speedway_buildings.json."""
import copy
import json
from pathlib import Path
from shapely.geometry import Polygon, box
from shapely.geometry.polygon import orient
from neighborhood_geometry import local_frame, band, ll, uv, validate

ROOT = Path(__file__).resolve().parents[1]


def build():
    config = json.loads((ROOT/'data/speedway_profiles.json').read_text())
    features = json.loads((ROOT/f"data/snapshots/{config['snapshot']}/buildings.detailed.geojson").read_text(encoding='utf-8'))['features']
    by_id = {f['properties']['id']: f for f in features}
    result = []
    for p in config['buildings']:
        frame, plan, footprint = local_frame(by_id[p['id']]['geometry'], config['angle'])
        outline = Polygon(plan['ring'], plan['holes'])
        colours = copy.deepcopy(config['colours'])
        colours.update({k:dict(hex=v) for k,v in p.get('colours',{}).items()})
        skins = {k:dict(kind='flat',field=k) for k in colours}
        skins.update(copy.deepcopy(p['skins']))
        blocks = []
        for part in p['parts']:
            g = outline.intersection(box(*part['bounds'])) if part.get('bounds') else outline
            if part.get('inset'): g = g.buffer(-part['inset'], join_style=2)
            pieces = [g] if g.geom_type=='Polygon' else list(g.geoms)
            for i, piece in enumerate(pieces):
                if piece.area < .1: continue
                piece = orient(piece,sign=1)
                ring = [[round(x,3),round(y,3)] for x,y in list(piece.exterior.coords)[:-1]]
                block = dict(id=part['name']+str(i),plan=dict(ring=ring,holes=[list(r.coords)[:-1] for r in piece.interiors]),
                             z0=part['z0'],z1=part['z1'],bands=copy.deepcopy(part['bands']),roofTone=part.get('roofTone','roof'))
                if part.get('parapet'): block.update(parapet=part['parapet'],parapetTone='stone')
                if part.get('soffitTone'): block['soffitTone']=part['soffitTone']
                # Photographed atrium is the connector, not a window grid over
                # every wall. Blank stone ends stay solid on the wing masses.
                if part.get('blankShortEnds'):
                    block['faces']={str(j):dict(bands=[band(part['z0'],part['z1'],'stone')]) for j,(a,b) in enumerate(zip(ring,ring[1:]+ring[:1])) if ((b[0]-a[0])**2+(b[1]-a[1])**2)**.5<part['blankShortEnds']}
                blocks.append(block)
                if part.get('eave'):
                    e=part['eave'];cap=piece.buffer(e['over'],join_style=2)
                    blocks.append(dict(id=part['name']+'-eave'+str(i),plan=list(cap.exterior.coords)[:-1],z0=part['z1'],z1=part['z1']+e['thick'],bands=[band(part['z1'],part['z1']+e['thick'],e['tone'])],roofTone=e['top'],soffitTone=e['tone']))
        for screen in p.get('screens',[]):
            a,b=screen['along'];start,end=screen['across'];s=a;i=0
            while s < b:
                bounds=[start,end,s,min(b,s+screen['width'])] if screen['axis']=='v' else [s,min(b,s+screen['width']),start,end]
                blocks.append(dict(id='roof-screen-'+str(len(blocks)),plan=bounds,z0=screen['z'],z1=screen['z']+screen['height'],bands=[band(screen['z'],screen['z']+screen['height'],'metal')],roofTone='metal',soffitTone='metal'))
                s+=screen['pitch'];i+=1
        result.append(dict(id=p['id'],name=p['name'],code=p['code'],category='campus',
                           footprint=footprint,frame=dict(obb=frame),levels=dict(floors=p['floors']),
                           colours=colours,skins=skins,blocks=blocks,
                           sources=dict(reference=p['source'],observations=p['observations'],footprint=f"data/snapshots/{config['snapshot']}/buildings.detailed.geojson",dimensions=config['accuracy']),open=p.get('open',[])))
    wcp,rlp=result
    bridge=config['bridge'];a=bridge['from'];b=uv(wcp['frame']['obb'],ll(rlp['frame']['obb'],bridge['to']))
    dx,dy=b[0]-a[0],b[1]-a[1];length=(dx*dx+dy*dy)**.5;nx,ny=-dy/length*bridge['width']/2,dx/length*bridge['width']/2
    bridge_plan=[[a[0]-nx,a[1]-ny],[b[0]-nx,b[1]-ny],[b[0]+nx,b[1]+ny],[a[0]+nx,a[1]+ny]]
    wcp['blocks'].append(dict(id='patton-bridge',plan=bridge_plan,z0=bridge['base'],z1=bridge['top'],bands=[band(bridge['base'],bridge['base']+bridge['bottomBand'],'metal'),band(bridge['base']+bridge['bottomBand'],bridge['top']-bridge['topBand'],'atrium'),band(bridge['top']-bridge['topBand'],bridge['top'],'metal')],roofTone='roof',soffitTone='metal'))
    validate(result)
    return dict(version=1,buildings=result)


if __name__=='__main__':
    result=build()
    (ROOT/'data/speedway_buildings.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    print('Speedway:',len(result['buildings']),'buildings')
