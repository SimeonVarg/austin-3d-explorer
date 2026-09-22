"""Refine Icon's existing crown; owns only data/apartments/icon.json.

Retains the original footprint, tower height, roof height and crown plan.
Re-running replaces only the generated crown guard details.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data/apartments/icon.json'
DEFAULTS = {
    'clerestoryHeight': 1.05, 'finPitch': 1.10, 'finWidth': .145,
    'finDepth': .18, 'curbHeight': .16, 'guardHeight': 1.10,
    'guardInset': .12, 'postPitch': 1.45, 'postWidth': .045,
    'edgeWidth': .022, 'mountHeight': .045, 'glassStrength': .35,
    'lowerGlass': '#34494d', 'clerestory': '#ccd7cc',
    'guardMetal': '#b0b8b1', 'glassEdge': '#b9ceca',
}


def main():
    model = json.loads(OUTPUT.read_text(encoding='utf-8'))
    c = model.setdefault('crownDetail', DEFAULTS.copy())
    crown = next(b for b in model['blocks'] if b['id'] == 'crown')
    tower = next(b for b in model['blocks'] if b['id'] == 'tower')
    z0, z1 = crown['z0'], crown['z1']
    split = round(z1-c['clerestoryHeight'], 3)
    model['colours'].update({
        'crownGlass': {'hex': c['lowerGlass']},
        'crownClerestory': {'hex': c['clerestory']},
        'guardMetal': {'hex': c['guardMetal']},
        'glassEdge': {'hex': c['glassEdge']},
    })
    model.setdefault('materials', {}).update({
        'crownGlass': {'type': 'glass', 'strength': c['glassStrength']},
        'crownClerestory': 'plain', 'crownFrame': 'plain',
        'guardMetal': 'plain', 'glassEdge': 'plain',
    })
    # Same pitch on both bands keeps the fins continuous through the infill.
    fins = dict(pitch=c['finPitch'], w=c['finWidth'], d=c['finDepth'], tone='crownFrame')
    model['skins']['crownRoom'] = dict(kind='flat', field='crownGlass', fins=fins)
    model['skins']['crownClerestory'] = dict(kind='flat', field='crownClerestory', fins=fins)
    for tone in ['guardMetal', 'glassEdge']:
        model['skins'][tone] = dict(kind='flat', field=tone)
    crown['bands'] = [dict(z0=z0, z1=split, skin='crownRoom'),
                       dict(z0=split, z1=z1, skin='crownClerestory')]
    crown['_src'] = 'Faceted crown retained at its existing size and height. Dark lower glazing and pale upper infill share continuous projecting vertical fins; minor dimensions are approximate.'
    tower['parapet'] = c['curbHeight']
    model['blocks'] = [b for b in model['blocks'] if not b['id'].startswith('crown-guard-')]
    x0, x1, y0, y1 = tower['plan']
    inset = c['guardInset']
    ring = [(x0+inset,y0+inset),(x1-inset,y0+inset),
            (x1-inset,y1-inset),(x0+inset,y1-inset)]
    serial = 0

    def box(plan, low, high, tone):
        nonlocal serial
        serial += 1
        low, high = round(low, 3), round(high, 3)
        model['blocks'].append(dict(id=f'crown-guard-{serial}', plan=[round(v,4) for v in plan],
            z0=low,z1=high,bands=[dict(z0=low,z1=high,skin=tone)],roofTone=tone))

    import math
    for a,b in zip(ring,ring[1:]+ring[:1]):
        dx,dy=b[0]-a[0],b[1]-a[1]
        length=math.hypot(dx,dy);n=max(1,round(length/c['postPitch']))
        # The shared solid renderer cannot draw transparent panels. Keep the
        # visible fixing posts and glass edges, leaving clear space between.
        for i in range(n+1):
            x,y=a[0]+dx*i/n,a[1]+dy*i/n;r=c['postWidth']/2
            box([x-r,x+r,y-r,y+r],z0+c['curbHeight'],z0+c['guardHeight'],'guardMetal')
        r=c['edgeWidth']/2
        plan=[min(a[0],b[0])-r,max(a[0],b[0])+r,min(a[1],b[1])-r,max(a[1],b[1])+r]
        box(plan,z0+c['guardHeight']-c['edgeWidth'],z0+c['guardHeight'],'glassEdge')
        box(plan,z0+c['curbHeight'],z0+c['curbHeight']+c['mountHeight'],'guardMetal')
    assert crown['z0'] == z0 and crown['z1'] == z1
    OUTPUT.write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Icon crown: {z0:g}-{z1:g} m retained; {serial} guard components')


if __name__ == '__main__':
    main()
