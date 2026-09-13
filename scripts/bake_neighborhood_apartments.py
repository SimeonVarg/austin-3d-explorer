"""Missing West Campus homes. Owns only data/neighborhood_apartments.json.

All design choices are in neighborhood_apartment_profiles.json. Source footprints
are retained except explicitly recorded courtyard/envelope repairs. This module
does not import an authoring script or mutate the existing apartment files.
"""
import copy
import json
from pathlib import Path
from shapely.geometry import Polygon, mapping
from neighborhood_geometry import local_frame, ll, rect, normalized_plan, band, validate

ROOT = Path(__file__).resolve().parents[1]


def bake(profile, feature, config, roofs):
    t = config['detail']
    f, plan, footprint = local_frame(feature['geometry'], profile.get('angle', t['angle']))
    if profile.get('envelope'):
        plan = dict(ring=normalized_plan(f, profile['envelope']), holes=[])
        footprint = dict(ring=[ll(f, p) for p in plan['ring']+[plan['ring'][0]]], holes=[])
    for hole in profile.get('courtyards', []):
        r = normalized_plan(f, hole)
        plan['holes'].append(r)
        footprint['holes'].append([ll(f, p) for p in r+[r[0]]])
    n, h = profile['floors'], profile['height']
    ground = profile.get('ground', t['ground'])
    pitch = (h-ground)/(n-1) if n > 1 else h
    floors = [0]+[round(ground+i*pitch, 3) for i in range(n)] if n > 1 else [0,h]
    colours = copy.deepcopy(config['colours'])
    colours.update({k:dict(hex=v) for k,v in profile['colours'].items()})
    skins = {k:dict(kind='flat', field=k) for k in colours}
    def windows(field, width, bay=None, height=None):
        return dict(kind='bays', field=field, windowRule=profile.get('windowRule',t['windowRule']), bay=bay or profile.get('bay', t['bay']),
                    glass='glass', frame='trim', reveal=t['reveal'],
                    window=dict(w=width, h=height or pitch*t['windowHeightRatio'], sill=t['sill'],
                                frame=dict(w=t['frame'], tone='trim'),
                                mullion=dict(cols=profile.get('mullions', t['mullionCols']), rows=profile.get('sash', []), w=t['mullion'], tone='metal')))
    skins['rooms'] = windows('wall', profile.get('window', t['window']))
    skins['accentRooms'] = windows('accent', profile.get('window', t['window']))
    skins['stoneRooms'] = windows('stone', profile.get('window', t['window']))
    skins['lobby'] = dict(kind='storefront', glass='glass', frame='metal', reveal=t['lobbyReveal'],
                          mullion=t['lobbyBay'], mullionW=t['lobbyMullion'], transom=t['transom'], fascia=t['fascia'], fasciaTone='stone')
    skins['screen'] = dict(kind='bays', field='dark', bay=t['screenBay'], louvre=dict(pitch=t['screenPitch'],w=t['screenWidth'],tone='metal'))
    skins['curtain'] = dict(kind='storefront', glass='curtainGlass', frame='metal', reveal=t['curtainReveal'], mullion=t['curtainBay'], mullionW=t['curtainMullion'], transom=t['curtainTransom'], fascia=t['curtainFascia'],fasciaTone='metal')
    ident = feature['properties']['id']
    rig = [r for k,r in roofs.items() if k.startswith(ident+'/')]
    preserve = bool(rig) and profile.get('preserveRoof', False)
    if preserve:
        # Preserved hips remain on the same eave. Upper row count is profile-led.
        h = min(r['base'] for r in rig)-t['roofClearance']
        pitch = (h-ground)/(n-1)
        floors = [0]+[round(ground+i*pitch,3) for i in range(n)]
        for k in ['rooms','accentRooms','stoneRooms']: skins[k]['window']['h'] = pitch*t['windowHeightRatio']
    def block(key, p, z0, z1, skin='rooms', bands=None, **kwargs):
        return dict(id=key, plan=p, z0=z0, z1=z1, bands=bands or [band(z0,z1,skin)], roofTone='roof', **kwargs)
    bands = [band(0, ground, 'stoneRooms'),band(ground,h-t['cornice'],'rooms'),band(h-t['cornice'],h,'trim')]
    base = block('residence',plan,0,h,bands=bands,cap=not preserve)
    for edge in profile.get('accentEdges',[]): base.setdefault('faces',{})[str(edge)] = dict(bands=[band(0,ground,'stoneRooms'),band(ground,h-t['cornice'],'accentRooms'),band(h-t['cornice'],h,'trim')])
    for edge in profile.get('blankEdges',[]): base.setdefault('faces',{})[str(edge)] = dict(bands=[band(0,h,'wall')])
    for edge in profile.get('entryEdges',[]):
        upper=base.get('faces',{}).get(str(edge),{}).get('bands',bands)[1:]
        base.setdefault('faces',{})[str(edge)] = dict(bands=[band(0,ground,'lobby')]+upper)
    blocks = [base]
    for edge in profile.get('balconyEdges',[]):
        a,b = plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])]
        length=((b[0]-a[0])**2+(b[1]-a[1])**2)**.5
        stacks=[dict(s0=round(s,3),s1=round(min(s+t['balconyWidth'],length-t['balconyEnd']),3),lift=0) for s in frange(t['balconyEnd'],length-t['balconyWidth'],profile.get('balconyPitch',t['balconyPitch']))]
        previous=base.get('faces',{}).get(str(edge),{}).get('bands',bands)
        base.setdefault('faces',{})[str(edge)] = dict(bands=[previous[0],band(ground,h-t['cornice'],previous[1]['skin'],balconies=stacks),previous[-1]])
    # A tower profile replaces the whole mass with independently shaped podium,
    # shaft and roof pavilion; it cannot accidentally turn a leasing office tall.
    if 'tower' in profile:
        tower=profile['tower'];podium=tower['podium'];shaft=rect(f,tower['plan'])
        base=block('podium',plan,0,podium,bands=[band(0,ground,'lobby',inset=tower.get('inset',t['podiumInset'])),band(ground,podium-t['cornice'],'screen'),band(podium-t['cornice'],podium,'trim')])
        shaftBands=[band(podium,h-t['cornice'],'rooms'),band(h-t['cornice'],h,'trim')]
        body=block('tower',shaft,podium,h,bands=shaftBands,parapet=t['parapet'],parapetTone='trim')
        for face in tower.get('darkFaces',[]):body.setdefault('faces',{})[face]=dict(bands=[band(podium,h,'accentRooms')])
        def curtain_bands(lo,hi):
            # Storefront skins span one band, not one floor. Give curtain
            # walls a real transom/spandrel at every residential floor.
            zs=sorted(set([lo,hi]+[z for z in floors if lo<z<hi]))
            return [band(a,b,'curtain')for a,b in zip(zs,zs[1:])]
        for face in tower.get('glassFaces',[]):body.setdefault('faces',{})[face]=dict(bands=curtain_bands(podium,h))
        for face in tower.get('glassBeltFaces',[]):
            lo,hi=tower['glassBelt'];body.setdefault('faces',{})[face]=dict(bands=[band(podium,lo,'rooms')]+curtain_bands(lo,hi)+[band(hi,h,'rooms')])
        blocks=[base,body]
        if tower.get('wing'):
            blocks.append(block('lower-wing',rect(f,tower['wing']),podium,tower['wingHeight'],'accentRooms',parapet=t['parapet'],parapetTone='trim'))
        if tower.get('blade'):
            blocks.append(block('crown-blade',rect(f,tower['blade']),podium,tower['bladeHeight'],'stoneRooms'))
        if tower.get('pavilion'):
            blocks.append(block('roof-pavilion',rect(f,tower['pavilion']),h,h+tower['pavilionHeight'],'curtain',parapet=t['parapet'],parapetTone='metal'))
        if tower.get('screenFins'):
            skins['screen']['fins']=dict(pitch=tower['screenFins']['pitch'],w=tower['screenFins']['width'],d=tower['screenFins']['depth'],tone='metal')
    # Authored roof volumes are used only where the profile documents them.
    for roof in profile.get('roofWings',[]):
        blocks.append(block('roof-wing-'+str(len(blocks)),rect(f,roof),h-t['cornice'],h,'trim',roof=dict(kind='hip',pitch=profile['roofPitch'],over=t['roofOver'],tone='roof',lipTone='trim')))
    if profile.get('roofWings'):blocks[0]['cap']=False
    for piece in profile.get('pieces',[]):
        blocks.append(block(piece['id'],rect(f,piece['plan']),piece['z0'],piece['z1'],piece['skin'],**piece.get('options',{})))
    deckItems=[]
    for item in profile.get('deck',[]):
        deckItems.append(dict(plan=rect(f,item['plan']),z0=item['z'],h=item['h'],tone=item['tone']))
    return dict(id=ident,name=profile['name'],category='apartment',labelOverride=profile.get('labelOverride',False),
                aliases=profile.get('aliases',[]),sources=dict(reference=profile['source'],observations=profile['observations'],
                footprint='data/snapshots/'+config['snapshot']+'/buildings.detailed.geojson',dimensions=profile.get('dimensions','Footprint retained; facade spacing, heights without explicit source measurements and unseen elevations are approximate.')),
                footprint=footprint,frame=dict(obb=f),levels=dict(floors=floors),colours=colours,skins=skins,
                blocks=blocks,preserveRoof=preserve,
                preserveRoofscape=t['retainSurveyedRoofs'] and len(blocks)==1 and not deckItems and not profile.get('envelope') and not profile.get('courtyards') and abs(h-feature['properties']['final_height'])<0.05,
                balcony=copy.deepcopy(config['balcony']),deck=dict(z=0,items=deckItems))


def frange(start,stop,step):
    while start<stop:
        yield start
        start+=step


def main():
    config=json.loads((ROOT/'data/neighborhood_apartment_profiles.json').read_text(encoding='utf-8'))
    features={f['properties']['id']:f for f in json.loads((ROOT/f"data/snapshots/{config['snapshot']}/buildings.detailed.geojson").read_text(encoding='utf-8'))['features']}
    roofs=json.loads((ROOT/'data/roofs.geojson').read_text())['rig']['roofs']
    buildings=[bake(p,features[p['id']],config,roofs) for p in config['buildings']]
    validate(buildings)
    (ROOT/'data/neighborhood_apartments.json').write_text(json.dumps(dict(version=1,buildings=buildings),separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
    print('Neighborhood apartments:',len(buildings))


if __name__=='__main__':main()
