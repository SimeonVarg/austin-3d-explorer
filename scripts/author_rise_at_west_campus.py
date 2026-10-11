#!/usr/bin/env python3
"""RISE: authored north/west tower, crown and east parking screen.
Run from any directory; writes only data/apartments/rise-at-west-campus.json.
Observed appearance is separate from inferred dimensions; see feature _src.
"""
import json
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/apartments/rise-at-west-campus.json'
ID = '65e5a9ce-377b-4eac-928e-c9634ce2c4da'
# Existing map footprint/frame and 86.4 m inferred height retained, not phone altitude.
PLAN = [1.0, 34.0, 3.0, 59.0]
PODIUM = 20.5
TOP = 86.4
ROWS = 19
PITCH = (TOP - PODIUM) / ROWS
FLOORS = [round(PODIUM + i * PITCH, 4) for i in range(ROWS + 1)]
NORTH_TOP = FLOORS[-2]
CROWN_START = FLOORS[-4]
WIN_H, SILL, REVEAL = 2.12, .64, .13
# Positions read as fractions of the visible wall, converted with the map outline.
# North: ten columns, widths differ; from EAST end, in metres on the 33 m wall.
NORTH = [(1.9, .85), (4.5, .85), (8.8, 1.35), (11.8, 1.45),
         (14.6, 1.45), (17.5, 1.45), (20.5, 1.45),
         (27.0, .85), (30.0, 1.45), (32.0, .85)]
# West: north white five, central gray four + a slit, south white five, two end columns.
# Fractions/counts from the upper reference view; dimensions remain approximate.
WEST = [(x, 1.50) for x in (2.2, 5.4, 8.6, 11.8, 15.0)] + [
        (21.1, 1.30), (24.5, 1.30), (27.9, 1.30), (31.3, 1.30), (34.0, .68)] + [
        (x, 1.35) for x in (37.0, 40.0, 43.0, 46.0, 49.0)] + [(52.2, 1.15), (54.7, .85)]
PALETTE = {'white': '#dedfdb', 'gray': '#a9b0b3', 'dark': '#505b65',
           'frame': '#626c70', 'pane': '#263236', 'roof': '#90918c',
           'coping': '#c8cbc7', 'screen': '#586b73', 'screenLight': '#76878e',
           'metal': '#858d8f', 'deck': '#c2beb2', 'pool': '#418d95'}


def band(a, b, skin='white', **kw):
    return {'z0': round(a, 4), 'z1': round(b, 4), 'skin': skin, **kw}


def window(s, width, z, height=WIN_H):
    return {'s0': round(s - width / 2, 4), 's1': round(s + width / 2, 4),
            'z0': round(z + SILL, 4), 'z1': round(z + SILL + height, 4),
            'd': REVEAL, 'glass': 'pane', 'lit': 'room', 'tone': 'frame',
            'mullion': {'cols': [.66], 'rows': [.24], 'w': .035, 'tone': 'frame'}}


def wall(layout, length, a, b, skin='white', floors=None):
    ops = []
    for z in (FLOORS[:-1] if floors is None else floors):
        if z < a - .01 or z >= b - .01:
            continue
        for c, width in layout:
            # Fixed columns; no pseudorandom occupied-window omission.
            ops.append(window(length - c, width, z, min(WIN_H, b-z-SILL-.15)))
    return band(a, b, skin, openings=ops)


def block(name, plan, a, b, skin='white', **kw):
    return {'id': name, 'plan': plan, 'z0': round(a, 4), 'z1': round(b, 4),
            'bands': [band(a, b, skin)], 'roofTone': 'roof', **kw}


def override(region, a, b, skin, layout, length):
    # A region's openings are local to its clipped wall; convert the chosen columns.
    return {'region': region, 'bands': [wall(layout, length, a, b, skin)]}


def main():
    generic = json.loads((ROOT/'data/neighborhood_apartments.json').read_text())
    old = next(x for x in generic['buildings'] if x['id'] == ID)
    u0, u1, v0, v1 = PLAN
    L, W = u1-u0, v1-v0
    data = {k: old[k] for k in ('id', 'name', 'footprint', 'frame')}
    data.update({'address': '2206 Nueces Street, Austin, TX',
      'sources': {
        'MAP': {'type': 'map', 'source': 'Existing neighborhood apartment footprint and explicit local frame',
                'date': '2026-10-11', 'confidence': 'medium', 'supports': 'footprint and plan scale'},
        'ARCH': {'type': 'online photo', 'source': 'https://www.nilesbolton.com/rise-at-west-campus',
                 'accessDate': '2026-10-11', 'date': None, 'confidence': 'high',
                 'supports': '24-storey identity; faceted east parking screen, entrance and tower materials'},
        'PHOTO': {'type': 'site photograph', 'confidence': 'high',
                  'supports': 'North and west window columns, white/gray divisions and visible roof skyline; source joins held privately'},
        'INFER': {'type': 'inference', 'derivedFrom': ['MAP', 'ARCH', 'PHOTO'], 'confidence': 'low',
                  'supports': 'Retained 86.4 m height, podium elevation, concealed faces and roof plan depths'}},
      'levels': {'floors': [0,5] + FLOORS, 'ground':5, 'roof': TOP, 'crown': TOP+1.8,
                 '_src': {'floors': 'ARCH:24 storeys. INFER:five podium levels plus nineteen residential rows; 86.4 m retained, not surveyed.',
                          'northTop': 'PHOTO: north parapet below the west crown; difference inferred as one floor.'}},
      'colours': {k: {'hex': v, '_src': 'PHOTO appearance / ARCH complementary view; daylight albedo inferred, not raw photograph RGB'} for k,v in PALETTE.items()},
      'materials': {'white': {'type':'concrete','strength':.12}, 'gray': {'type':'concrete','strength':.08}, 'pane': {'type':'glass','strength':.28}},
      'skins': {k: {'kind':'flat','field':k} for k in PALETTE},
      'preserveRoof': False, 'preserveRoofscape': False,
      '_review': 'First photo-led candidate; appearance awaiting appearance acceptance. Metric height not independently surveyed.',
      '_open': ['Precise height and podium elevation retained/inferred; no phone altitude used.',
                'East/south residential columns and concealed podium walls inferred from the observed family.',
                'Roof equipment type and silhouette observed, detailed plan positions inferred.',
                'Private source camera is provisional; exact shape must not be certified from camera fit alone.']})
    data['skins']['lobby'] = {'kind':'storefront','glass':'pane','frame':'frame', 'mullion':2.4,'mullionW':.09,'horizontalPitch':10,'fascia':.25,'plinth':.15,'reveal':.25}
    data['skins']['inferredRooms'] = {'kind':'bays','field':'white','windowRule':'all','bay':3.3,
        'window':{'w':1.5,'h':WIN_H,'sill':SILL},'glass':'pane','frame':'frame','reveal':REVEAL}
    blocks = []
    blocks.append(block('podium', [0,36.0,0,60.4], 0,PODIUM, faces={
        'u1': {'bands':[band(0,5,'lobby'),band(5,PODIUM,'white')]},
        'u0': {'bands':[band(0,5,'dark'),band(5,PODIUM,'gray')]},
        'v0': {'bands':[band(0,5,'lobby'),band(5,PODIUM,'gray')]},
        'v1': {'bands':[band(0,5,'dark'),band(5,PODIUM-2*PITCH,'gray'),
            wall([(c+2,w) for c,w in NORTH if c>9],36.0,PODIUM-2*PITCH,PODIUM,'gray',
                 floors=[PODIUM-2*PITCH,PODIUM-PITCH])]},},
        overrides=[{'region':[24,36.01,60.39,60.41], 'bands':[band(0,PODIUM,'white')]}],
        _src='ARCH: broad parking podium with a tall glazed ground level. INFER: elevations and concealed walls.'))
    # Rectangular main body. North is v1; west is u0 in the retained east/north frame.
    body = block('residential', PLAN, PODIUM, NORTH_TOP, cap=True,
        faces={'u0': {'bands':[wall(WEST,W,PODIUM,NORTH_TOP)]},
               'v1': {'bands':[wall(NORTH,L,PODIUM,NORTH_TOP)]},
               'u1': {'bands':[band(PODIUM,NORTH_TOP,'inferredRooms')]},
               'v0': {'bands':[band(PODIUM,NORTH_TOP,'inferredRooms')]}},
        _src='PHOTO: north ten unequal columns; west 5 + 4/slit + 5 + 2. MAP plan scale; individual metres approximate. East/south inferred.')
    # Main center strips: openings local to the region, preserved without an overlaid wall sheet.
    north_start, north_end = 10.0, 16.8
    north_columns=[(north_end-(L-c), w) for c,w in NORTH if north_start < L-c < north_end]
    west_a,west_b = 19.0,35.1
    west_v0,west_v1=v1-west_b,v1-west_a
    west_columns=[(west_v1-(v1-c),w) for c,w in WEST if west_a<c<west_b]
    body['overrides'] = [
       override([u0+north_start,u0+north_end,v1-.01,v1+.01],PODIUM,NORTH_TOP,'gray',north_columns,north_end-north_start),
       override([u0-.01,u0+.01,west_v0,west_v1],PODIUM,NORTH_TOP,'gray',west_columns,west_v1-west_v0)]
    blocks.append(body)
    # Long slots at the tops of the two west white fields. Gray spandrels join
    # successive windows while white piers remain continuous through three storeys.
    for label, na, nb in [('north',0,18.2), ('south',35.1,51.1)]:
        va,vb=v1-nb,v1-na
        local=[(vb-(v1-c),w) for c,w in WEST if na<c<nb]
        ops=[]
        for c,w in local:
            for z in FLOORS[-4:-1]:
                ops.append(window((vb-va)-c,w,z,min(WIN_H,TOP-z-SILL-.15)))
        # Proud .18m plane avoids coplanar duplicate surfaces on the main body.
        crown=block('west-'+label+'-crown',[u0-.18,u0-.02,va,vb],CROWN_START,TOP,
                    faces={'u0':{'bands':[band(CROWN_START,TOP,'white',openings=ops)]},'u1':None},
                    _src='PHOTO: continuous tall white piers with three glazing/spandrel levels at the west crown. Depth inferred.')
        # Vertical dark fields behind each slot, used as broad spandrels.
        crown['overrides']=[]
        for c,w in local:
            s=(vb-va)-c
            oc=[window(w/2,w-.10,z,min(WIN_H,TOP-z-SILL-.15)) for z in FLOORS[-4:-1]]
            crown['overrides'].append({'region':[u0-.19,u0-.17,va+s-w/2,va+s+w/2],
                'bands':[band(CROWN_START+.55,TOP-.45,'gray',openings=oc)]})
        blocks.append(crown)
    for label,va,vb in [('north',36,54),('south',9,29)]:
        blocks.append(block('roof-plant-screen-'+label,[7,30,va,vb],NORTH_TOP,TOP+1.8,'dark',
            _src='PHOTO: separated dark roof service volumes with visible mechanical plant between them. Footprint depths inferred.'))
    blocks.append(block('west-roof-glazing',[u0+.45,7.0,v1-35.1,v1-18.2],NORTH_TOP,TOP+1.0,'dark',
        faces={'u0': {'bands':[band(NORTH_TOP,TOP+1.0,'lobby')]}},
        _src='PHOTO: central crown glazing behind the white top piers. Approximate depth.'))
    for i,(u,v,w,d,h) in enumerate([(12,52,4,3,1.9),(21,50,3,3,1.3),(10,31,4,5,1.5),(25,18,3,6,1.2)]):
        base = NORTH_TOP+.2 if i==2 else TOP+1.8
        unit_h = 4.4 if i==2 else h
        blocks.append(block('roof-equipment-'+str(i),[u,u+w,v,v+d],base,base+unit_h,'metal',
             _src='PHOTO equipment silhouettes; dimensions and roof positions inferred, not a surveyed equipment inventory.'))
    # Broad facets, not hundreds of high-frequency thin louvres: the architect
    # photograph shows one folded panel per roughly 1.2 x 2.5 m module.
    screen = {'id': 'folded-parking-screen', 'tone': 'screen', 'minDetail': 2,
        'vertices': [], 'triangles': [], '_src': 'ARCH: folded panel parking screen on east frontage. Module count/depth inferred from visible ratios.'}
    for row in range(5):
        for col in range(43):
            a=3.5+col*1.22
            z=5.7+row*2.6
            if a+1.1>57 or z+2.45>PODIUM-.8:continue
            # The alternating folded seam makes broad lit and shaded facets.
            crease = a + (.36 if row % 2 else .72)
            points = [[36.03,a,z], [36.38,crease,z], [36.03,a+1.08,z],
                      [36.03,a,z+2.43], [36.20,crease,z+2.43], [36.03,a+1.08,z+2.43]]
            i=len(screen['vertices'])
            screen['vertices'] += [[round(t,4) for t in point] for point in points]
            screen['triangles'] += [[i+j for j in tri] for tri in [(0,1,4),(0,4,3),(1,2,5),(1,5,4)]]
    data['detailMeshes']=[screen]
    data['blocks']=blocks
    # The amenity layout cannot be placed reliably from the available eye-level
    # shots; do not label a guessed pool rectangle as an observed roof plan.
    data['deck']={'z':NORTH_TOP,'items':[],'_src':'Amenity existence observed online; plan location withheld pending top-down evidence.'}
    # Checks catch window bounds and missing tones before publishing a candidate.
    assert len(NORTH)==10 and len(WEST)==17
    assert len(set(b['id'] for b in blocks))==len(blocks)
    assert max(b['z1'] for b in blocks)<92
    assert all(len(t)==3 and max(t)<len(screen['vertices']) for t in screen['triangles'])
    for b in blocks:
        assert b['z1']>b['z0'] and b['plan'][1]>b['plan'][0] and b['plan'][3]>b['plan'][2]
        for f in b.get('faces',{}).values():
            for bd in (f or {}).get('bands',[]):
                for o in bd.get('openings',[]):assert o['s1']>o['s0'] and o['z1']>o['z0']
    deduplicate_detail_meshes(data)
    OUT.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
    print(f'Wrote {OUT.name}: {len(blocks)} blocks, {ROWS} tower rows, north 10 / west 17 columns')


if __name__=='__main__':main()
