"""DKR mesh specification. Sole writer of data/stadium.mesh.json.

Read-only use of the legacy bake's field registration; no legacy outputs change.
All dimensions are metres in a field-aligned frame (+x east, +y north, z up).
Rows/deck elevations are derived approximations, not a claim of a full survey.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/stadium.mesh.json'

# Editable architectural choices, with provenance attached to the output.
LOWER = dict(rows=54, run=40.5, base=1.2, rise=21.6)
WEST = dict(rows=55, run=43.0, base=28.0, rise=28.6)
WRAP = dict(rows=35, run=27.3, base=25.0, rise=15.4)
PALETTE = {
    'concrete': ['#bcb7aa', '#c2af92', '#34363b'],
    'riser': ['#77776e', '#80796b', '#252b32'],
    'bench': ['#aeb7b7', '#beb9a9', '#656c72'],
    'orangeSeat': ['#a7532d', '#b76639', '#4b4140'],
    'orange': ['#b65122', '#c36630', '#573c32'],
    'brick': ['#b18958', '#c49460', '#302d2c'],
    'stone': ['#ddd4bb', '#e1cb9e', '#464747'],
    'glass': ['#43555b', '#647376', '#303e46'],
    'steel': ['#5e6264', '#71695c', '#30363e'],
    'black': ['#202a30', '#303337', '#151c25'],
    'light': ['#d5d4bb', '#f7e6b3', '#fff1c7'],
    'endzone': ['#b65122', '#c36630', '#b85c30'],
    'screenOrange': ['#b65122', '#c36630', '#e97438'],
    'turf': ['#315c38', '#475e34', '#668653'],
    'turfAlt': ['#355e3c', '#4a6438', '#6c8c59'],
    'paint': ['#eee9da', '#f3dfb6', '#e8e4d2'],
}

def main():
    legacy = json.loads((ROOT / 'data/stadium.geojson').read_text())
    corners = legacy['fieldCorners']
    lon = sum(p[0] for p in corners) / 4
    lat = sum(p[1] for p in corners) / 4
    mx = 111320 * math.cos(math.radians(lat))
    dx = (corners[1][0] - corners[0][0]) * mx
    dy = (corners[1][1] - corners[0][1]) * 111320
    norm = math.hypot(dx, dy)
    east = [dx / norm, dy / norm]
    north = [-east[1], east[0]]
    sections = []

    def straight(name, a, b, normal, depth0, profile, count, orange=()):
        for k in range(count):
            def at(t, d):
                return [a[j] + (b[j] - a[j]) * t + normal[j] * d for j in range(2)]
            sections.append(dict(name=f'{name}-{k+1}', inner=[at(k/count, depth0), at((k+1)/count, depth0)],
                                 outer=[at(k/count, depth0+profile['run']), at((k+1)/count, depth0+profile['run'])],
                                 **profile, orange=k in orange, tier=name))

    def corner(name, centre, start, end, d0, profile, count):
        for k in range(count):
            def at(t, d):
                a = math.radians(start + (end-start)*t)
                return [centre[0]+d*math.cos(a), centre[1]+d*math.sin(a)]
            sections.append(dict(name=f'{name}-{k+1}', arc=dict(centre=centre, a0=start+(end-start)*k/count,
                                a1=start+(end-start)*(k+1)/count, r0=d0, r1=d0+profile['run']),
                                 **profile, orange=False, tier=name))

    straight('west-lower', [-34.2,-61.6], [-34.2,61.6], [-1,0], 0, LOWER, 12, (4,5,6,7))
    corner('northwest-lower', [-34.2,61.6], 90,180, 0, LOWER, 4)
    straight('north-lower', [-34.2,61.6], [34.2,61.6], [0,1], 0, LOWER, 6)
    corner('northeast-lower', [34.2,61.6], 0,90, 0, LOWER, 4)
    straight('east-lower', [34.2,61.6], [34.2,-61.6], [1,0], 0, LOWER, 12, (4,5,6,7))
    straight('west-upper', [-34.2,-79], [-34.2,79], [-1,0], 39.0, WEST, 16)
    straight('east-upper', [34.2,61.6], [34.2,-65], [1,0], 40.5, WRAP, 12)
    corner('northeast-upper', [34.2,61.6], 0,90, 40.5, WRAP, 6)
    straight('north-upper', [-34.2,61.6], [34.2,61.6], [0,1], 40.5, WRAP, 6)
    corner('northwest-upper', [-34.2,61.6], 90,150, 40.5, WRAP, 4)
    # South: flanking student seating and central low chairback sections.
    for sign in [-1,1]:
        sections.append(dict(name=f'south-flank-{sign}', inner=[[sign*13,-62],[sign*34,-62]],
                             outer=[[sign*24,-88],[sign*63,-73]], rows=30, run=26, base=1.2, rise=13.5,
                             orange=False, tier='south'))
    straight('south-chairback', [-13,-62], [13,-62], [0,-1], 0,
             dict(rows=14, run=10.5, base=1.2, rise=5.6), 4, (0,1,2,3))

    model = dict(version=1, name='Darrell K Royal–Texas Memorial Stadium',
        origin=[lon,lat], east=east, north=north, replacedBuildingIds=legacy['replacedBuildingIds'],
        sources={
            'registration': 'Legacy fieldCorners, aligned to the existing field; NCAA field length 120 yd and width 53 1/3 yd used as scale.',
            'athletics': 'https://texaslonghorns.com/facilities/dkr-texas-memorial-stadium/1',
            'architect': 'https://populous.com/projects/university-of-texas-south-end-zone-project',
            'aerial': 'UT Athletics DJI_0226.jpg, August 2022: empty bowl, north/east wrap, distinct west upper deck, south Longhorn assembly. Viewed 2026-09-09.',
            'south': 'Populous 20211007_DIG_2395_MAS.jpg: glazed towers with rust framing, stepped club terraces and Longhorn balcony. Viewed 2026-09-09.',
            'board': 'UT Athletics facility page specifies 160 by 44 feet for the 2021 south board; 48.768 by 13.4112 m. Retrieved 2026-09-09.',
            'derived': 'Deck rows, elevations, facade bays and supports are reference-led approximations within the registered footprint. Vertical dimensions carry roughly 3 m uncertainty; detailed section boundaries and seat-colour allocation are not surveyed. No claim of a current 2026 aerial survey.'},
        palette=PALETTE, sections=sections,
        field=dict(width=48.768, length=109.728, apronWidth=68.4, apronLength=123.2),
        board=dict(width=48.768,height=13.4112,base=22.5,y=-93.5,curve=0.002),
        south=dict(towerX=34,towerY=-94,towerWidth=12,towerDepth=13,towerHeight=39,
                   balcony=[[-33,-77],[-28,-81],[-14,-79],[-10,-85],[10,-85],[14,-79],[28,-81],[33,-77],
                            [23,-76],[15,-73],[9,-72],[7,-66],[-7,-66],[-9,-72],[-15,-73],[-23,-76]],
                   balconyBase=11.5, balconyTop=13.1),
        details=dict(aisleWidth=1.7, slabThickness=0.65, benchDepth=0.3, benchHeight=0.38,
                     railHeight=1.0, railThickness=0.045, portalWidth=3.3, portalHeight=2.5,
                     facadeBay=6.2, facadeFloor=4.6, beamWidth=0.55, trim=0.32,
                     rowGeometryDistance=430, railDistance=210, minZoom=14),
        towers=[dict(x=x,y=y,radius=6.3,height=h,kind='office') for x,y,h in
                [(-97,105,30),(-48,133,30),(48,133,30),(97,105,30)]] +
               [dict(x=-116,y=y,radius=6.8,height=25,kind='ramp') for y in [-80,83]],
        bounds=[-129,-103,113,141])
    OUT.write_text(json.dumps(model,indent=2)+'\n',encoding='utf-8')
    print(f'{len(sections)} seating sections -> {OUT.name}')

if __name__ == '__main__':
    main()
