"""Guadalupe's continuous frontage. Owns only data/guadalupe.json.

The older Drag experiment and its output are intentionally not inputs to the
authoring process. Real footprint edges determine shopfronts, never rear walls.
"""
import copy
import json
from pathlib import Path
from neighborhood_geometry import local_frame, band, rect, validate

ROOT=Path(__file__).resolve().parents[1]


def lettering(text, width, s, z, tone, config, serif=False):
    rows=config['bitmaps'][('serif:' if serif else '')+text]
    return dict(bitmap=rows,bitmapRuns=True,dot=width/len(rows[0]),s=s,z0=z,tone=tone)


def make_building(p, feature, config, roofs):
    t=config['detail'];f,plan,footprint=local_frame(feature['geometry'],p.get('angle',t['angle']))
    colours=copy.deepcopy(config['colours']);colours.update({k:dict(hex=v) for k,v in p.get('colours',{}).items()})
    skins={k:dict(kind='flat',field=k) for k in colours}
    h,ground=p['height'],p.get('ground',t['shopHeight'])
    floors=[0,ground]+[ground+(h-ground)*i/(p['floors']-1) for i in range(1,p['floors'])] if p['floors']>1 else [0,h]
    skins['shop']=dict(kind='storefront',glass='glass',frame='metal',reveal=t['reveal'],mullion=p.get('shopBay',t['shopBay']),mullionW=t['mullion'],transom=t['transom'],fascia=t['fascia'],fasciaTone='signboard')
    skins['upper']=dict(kind='bays',windowRule=t['windowRule'],field='wall',bay=p.get('bay',t['upperBay']),glass='glass',frame='trim',reveal=t['upperReveal'],window=dict(w=t['upperWindow'],h=t['upperWindowHeight'],sill=t['upperSill'],frame=dict(w=t['upperFrame'],tone='trim')))
    base=dict(id='street-building',plan=plan,z0=0,z1=h,bands=[band(0,h,'wall')],roofTone='roof',parapet=t['parapet'],parapetTone='trim',faces={})
    fronts=p['frontEdges']
    for edge in fronts:
        a,b=plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])];length=((b[0]-a[0])**2+(b[1]-a[1])**2)**.5
        shopTop=min(ground,h-t['cornice']-t['signHeight'])
        bands=[band(0,t['bulkhead'],'dark'),band(t['bulkhead'],shopTop,'shop'),band(shopTop,min(h-t['cornice'],shopTop+t['signHeight']),'signboard')]
        if shopTop+t['signHeight']<h-t['cornice']:bands.append(band(shopTop+t['signHeight'],h-t['cornice'],'upper' if p['floors']>1 else 'wall'))
        bands.append(band(h-t['cornice'],h,'trim'))
        bands[1]['openings']=[dict(s0=max(t['doorMargin'],length*p.get('doorAt',t['doorAt'])-t['doorWidth']/2),s1=min(length-t['doorMargin'],length*p.get('doorAt',t['doorAt'])+t['doorWidth']/2),z0=t['doorSill'],z1=min(t['doorHeight'],shopTop-t['doorHead']),d=t['doorRecess'],glass='glass',tone='metal')]
        if p.get('sign') and length>t['signMinFront']:
            textWidth=min(length*t['signWidthRatio'],p.get('signWidth',t['signMaxWidth']))
            bands[2]['signs']=[lettering(p['sign'],textWidth,length/2,shopTop+t['signBaseline'],'letters',config['lettering'])]
        if p.get('canopy'):
            bands[1]['canopies']=[dict(s0=t['awningEnd'],s1=max(t['awningEnd']+t['awningMinimum'],length-t['awningEnd']),z=t['awningHeight'],d=p['canopy'],t=t['awningThickness'],tone='awning',soffitTone='dark')]
        base['faces'][str(edge)]=dict(bands=bands)
    blocks=[base]
    aligned=abs(h-feature['properties']['final_height'])<0.05 and not p.get('special')
    keep_roof=p.get('preserveRoof',t['retainSurveyedRoofs'] and aligned)
    if keep_roof:
        rigs=[r for k,r in roofs.items()if k.startswith(p['id']+'/')]
        if rigs:
            # These selected small roofs are kept only at their existing height.
            base['cap']=False
    if p.get('special')=='coop':
        c=p['detail']
        # Main east elevation: black shop base, cream upper fascia, raised
        # central entry bay. The irregular west service plan stays intact.
        base['z1']=p['wingHeight'];base['bands']=[band(0,p['wingHeight'],'wall')]
        base['parapet']=0
        for edge in fronts:
            length=((plan['ring'][(edge+1)%len(plan['ring'])][0]-plan['ring'][edge][0])**2+(plan['ring'][(edge+1)%len(plan['ring'])][1]-plan['ring'][edge][1])**2)**.5
            base['faces'][str(edge)]=dict(bands=[band(0,c['bulkhead'],'dark'),band(c['bulkhead'],c['shopTop'],'shop',canopies=[dict(s0=c['awningEnd'],s1=length-c['awningEnd'],z=c['awningHeight'],d=c['awningDepth'],t=c['awningThickness'],tone='dark')]),band(c['shopTop'],p['wingHeight']-c['wingCornice'],'wall'),band(p['wingHeight']-c['wingCornice'],p['wingHeight'],'trim')])
        center=rect(f,p['centerPlan']);u0,u1,v0,v1=center;span=v1-v0
        skins['coop-entry']=dict(kind='bays',windowRule=t['windowRule'],field='dark',bay=span,window=dict(w=span*c['entryWindowRatio'],h=c['entryWindowHeight'],sill=c['entryWindowSill'],mullion=dict(cols=c['mullionCols'],rows=c['mullionRows'],w=c['mullionWidth'],tone='metal')),glass='glass',frame='dark',reveal=c['entryReveal'])
        central=dict(id='raised-entry',plan=center,z0=0,z1=h,bands=[band(0,h,'wall')],roofTone='roof',faces={'u1':dict(bands=[band(0,c['entryTop'],'coop-entry'),band(c['entryTop'],c['entryUpperTop'],'coop-entry'),band(c['entryUpperTop'],h-c['centerCornice'],'wall',signs=[lettering('CO-OP',span*c['coopWidthRatio'],span/2,c['coopBaseline'],'dark',config['lettering'],True),lettering('THE',span*c['theWidthRatio'],span/2,c['theBaseline'],'dark',config['lettering'],True)]),band(h-c['centerCornice'],h,'trim')])})
        blocks.append(central)
    if p.get('special')=='hole':
        c=p['detail'];u=f['L']*p['marqueeAt'][0];v=f['W']*p['marqueeAt'][1]
        for key,width,low,high,lines,tone in p['panels']:
            panel=[u,u+width,v,v+c['panelThickness']]
            signs=[lettering(text,width*ratio,width/2,z,t,config['lettering'],serif)for text,ratio,z,t,serif in lines]
            faces={k:dict(bands=[band(low,high,tone,signs=signs)])for k in ['v0','v1']}
            blocks.append(dict(id=key,plan=panel,z0=low,z1=high,bands=[band(low,high,tone)],roofTone='metal',faces=faces,parapet=c['frameWidth'],parapetTone='metal'))
        # Two timber-framed display bays under deep green awnings.
        skins['bar-window']=dict(kind='bays',windowRule=t['windowRule'],field='wall',bay=c['frontBay'],glass='glass',frame='timber',reveal=c['windowReveal'],window=dict(w=c['windowWidth'],h=c['windowHeight'],sill=c['windowSill'],frame=dict(w=c['windowFrame'],tone='timber')))
        for edge in fronts:
            a,b=plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])];length=((b[0]-a[0])**2+(b[1]-a[1])**2)**.5
            base['faces'][str(edge)]=dict(bands=[band(0,h,'bar-window',canopies=[dict(s0=c['awningEnd'],s1=length-c['awningEnd'],z=c['awningHeight'],d=c['awningDepth'],t=c['awningThickness'],tone='awning')])])
    return dict(id=p['id'],name=p['name'],category='guadalupe',replaceFrontage=True,aliases=p.get('aliases',[]),labelOverride=p.get('labelOverride',False),
                sources=dict(reference=p['source'],observations=p['observations'],footprint='data/snapshots/'+config['snapshot']+'/buildings.detailed.geojson',dimensions='Footprints retained. Heights, facade subdivisions, sign sizing and unphotographed elevations are approximate unless explicitly measured in the source.'),
                footprint=footprint,frame=dict(obb=f),levels=dict(floors=floors),colours=colours,skins=skins,blocks=blocks,preserveRoof=keep_roof,preserveRoofscape=t['retainSurveyedRoofs'] and aligned)


def main():
    config=json.loads((ROOT/'data/guadalupe_profiles.json').read_text(encoding='utf-8'))
    features={f['properties']['id']:f for f in json.loads((ROOT/f"data/snapshots/{config['snapshot']}/buildings.detailed.geojson").read_text(encoding='utf-8'))['features']}
    roofs=json.loads((ROOT/'data/roofs.geojson').read_text())['rig']['roofs']
    buildings=[make_building(p,features[p['id']],config,roofs) for p in config['buildings']]
    validate(buildings)
    (ROOT/'data/guadalupe.json').write_text(json.dumps(dict(version=1,buildings=buildings),separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
    print('Guadalupe buildings:',len(buildings))


if __name__=='__main__':main()
