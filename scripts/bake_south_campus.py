"""UTC, GSB, CBA and Sanchez. Owns only data/south_campus.json.

The editable profiles separate photographed elevations from blank walls. The
mapped footprint remains authoritative; facade dimensions are approximations.
"""
import copy
import json
from pathlib import Path
from shapely.geometry import shape
from neighborhood_geometry import local_frame, uv, band, validate

ROOT = Path(__file__).resolve().parents[1]


def build():
    config = json.loads((ROOT/'data/south_campus_profiles.json').read_text())
    snapshot = config['snapshot']
    features = json.loads((ROOT/f'data/snapshots/{snapshot}/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']
    by_id = {f['properties']['id']: f for f in features}
    equipment = json.loads((ROOT/'data/roofscape.geojson').read_text())['features']
    result = []
    for p in config['buildings']:
        feature = by_id[p['id']]
        frame, plan, footprint = local_frame(feature['geometry'], config['angle'])
        colours = copy.deepcopy(config['colours'])
        colours.update({k: dict(hex=v) for k, v in p.get('colours', {}).items()})
        skins = {k: dict(kind='flat', field=k) for k in colours}
        skins.update(copy.deepcopy(p['skins']))
        block = dict(id='main', plan=plan, z0=0, z1=p['height'],
                     bands=copy.deepcopy(p['bands']), roofTone='roof',
                     parapet=config['parapet'], parapetTone='stone', faces={})
        for faces in p['elevations']:
            for edge in faces['edges']:
                block['faces'][str(edge)] = dict(bands=copy.deepcopy(faces['bands']))
        blocks = [block] + copy.deepcopy(p.get('blocks', []))
        # Retain the surveyed major plant's location, translated with the new
        # wall. Generic old decks and detail tiers are masked by the renderer.
        g = shape(feature['geometry'])
        deck = next((f for f in equipment if f['properties']['k']=='deck' and g.contains(shape(f['geometry']))), None)
        if deck:
            for f in equipment:
                prop = f['properties']
                if prop['k']=='deck' or not g.contains(shape(f['geometry'])):
                    continue
                z0 = round(p['height'] + prop['b'] - deck['properties']['b'], 3)
                z1 = round(z0 + prop['h'] - prop['b'], 3)
                blocks.append(dict(id='plant-'+str(len(blocks)), plan=[uv(frame, x) for x in f['geometry']['coordinates'][0][:-1]],
                                   z0=z0, z1=z1, bands=[band(z0,z1,'plant')], roofTone='plant'))
        result.append(dict(id=p['id'], name=p['name'], code=p['code'], category='campus',
                           footprint=footprint, frame=dict(obb=frame), levels=dict(floors=p['floors']),
                           colours=colours, skins=skins, blocks=blocks,
                           sources=dict(reference=p['source'], observations=p['observations'],
                                        footprint=f'data/snapshots/{snapshot}/buildings.detailed.geojson',
                                        dimensions='Footprints retained. Visible storeys, facade rhythm and material relationships follow UT exterior photos; heights and unphotographed elevations remain approximate.'),
                           open=p.get('open', [])))
    validate(result)
    return dict(version=1, buildings=result)


if __name__ == '__main__':
    result = build()
    (ROOT/'data/south_campus.json').write_text(json.dumps(result, separators=(',', ':'))+'\n')
    print('South campus:', len(result['buildings']), 'buildings')
