#!/usr/bin/env python3
"""Skyloft Austin (507 W 23rd St): re-massed and re-windowed from a square-on elevation and an elevated oblique.

Writes only data/apartments/skyloft-austin.json (or --out PATH). It keeps the file's own footprint, frame, levels,
sources and the garage / storefront / lounge / stair skins, and rewrites colours, window modules, massing along the
long axis, the core spine on the west face, the crown and the roof plant. Re-running it gives the same file.

What the photographs say (all numbers are from pixels; every taste value is in PARAMS):
  * square-on west elevation: 8 window columns across the tall slab, a row every storey (3.06 m by the row pitch),
    window 0.78 m wide x 1.40 m tall, i.e. 0.46 of the storey high and 0.21 of the bay wide. The old module was
    1.6 x 1.95 m on a 3.26 m bay (0.65 of the storey), which is why the tower read as a dense grey grid.
  * long axis, measured along the elevation at 16.95 px per metre (62.54 m = the whole base):
        slab 18 storeys   u  0.0 - 31.4
        core spine        u 31.4 - 43.7  (ribbed dark metal wall u 31.4-38.3, glazed stair 38.3-40.7, concrete pier 40.7-43.7)
        15-storey block   u 43.7 - 49.6
        10-storey block   u 49.6 - 55.5
         9-storey block   u 55.5 - 57.8
         6-storey corner  u 57.8 - 62.54
    the old file had the 18-storey mass to u 49.6 and steps of 3.3 m each.
  * crown: a dark box on the core, 4.6 m above the slab roof, overhanging to the north.
INFERRED (no photograph shows it): the east and south faces, light-well walls, v extent of the stepped blocks, the
second grey pinstripe columns are NOT drawn.
"""
import copy, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/apartments/skyloft-austin.json'
if '--out' in sys.argv: OUT = Path(sys.argv[sys.argv.index('--out') + 1])
SRC = ROOT / 'data/apartments/skyloft-austin.json'

# ---- taste values: change one here and re-run -------------------------------------------------------------
PARAMS = dict(
    bay=3.7,                    # window column pitch on the tall faces (8 columns across the 29.6 m slab)
    win_w=0.78, win_h=1.40, win_sill=0.95,          # one window, measured on the square-on elevation
    panel='#ece9e2',            # the white field (reference notes: true body colour ~ #EFEDE6)
    podium='#6c7076',           # grey base and accent panels (~ #6A6E74)
    metal='#52585f',            # ribbed metal wall of the core: reads dark charcoal in the daylight photographs
    concrete='#c9c4ba',         # board-marked concrete pier
    crown='#3c4249',            # crown box
    stairGlass=['#46535d', '#5b6770', '#d9e6ee'],
    slot_w=0.26, slot_h=1.5,    # slim slots in the metal wall
    window_frame='#7f858a',
    crown_h=4.6, crown_overhang=2.0,
    stripe_u=(7.0, 22.4),       # centres of the two grey pinstripe columns along the long axis
)
U_CORE = (31.4, 43.7)       # core spine along the long axis
U_SPLIT = [0.0, 17.15, 27.69, 31.4, 39.05, 43.7, 49.58, 55.5, 57.8, 62.54]
V_W, V_E = 35.79, 0.0
WELL_A = (17.15, 27.69, 14.59, 20.68)    # u0,u1,v0,v1 of the two mapped light wells (footprint's interior rings)
WELL_B = (39.05, 49.58, 14.6, 20.7)
# (u0, u1, top storey index): index into levels.floors (18 = roof 56.85)
MASSING = [(0.0, 31.4, 18), (31.4, 43.7, 18), (43.7, 49.58, 15), (49.58, 55.5, 10), (55.5, 57.8, 9), (57.8, 62.54, 6)]
# which edges of each piece carry the parapet / terrace guard: its outer edges and the well's, never the line it shares with an equal neighbour
PARAPET_SIDES = {'slab': ['v0', 'v1', 'u0', 'h0.0', 'h0.1', 'h0.2', 'h0.3'], 'core': ['v0', 'v1'], 'coreNE': ['v0', 'v1', 'u1'], 'coreNW': ['v0', 'v1', 'u1']}
# ------------------------------------------------------------------------------------------------------------


def main():
    d = json.loads(SRC.read_text())
    P = PARAMS
    fl = d['levels']['floors']
    ROOF = d['levels']['roof'] if 'roof' in d['levels'] else 56.85
    PODIUM, GROUND = d['levels'].get('podiumTop', 20.68), d['levels'].get('ground', 5.6)

    def z_of(k): return round(fl[k], 3) if k < len(fl) else ROOF
    # colours
    col = d['colours']
    for k, hx in dict(panel=P['panel'], panelGrey=P['podium'], podium=P['podium'], concrete=P['concrete'], metalWall=P['metal'], crown=P['crown'], frame=P['window_frame']).items():
        col[k] = {'hex': hx, '_src': 'site photograph and architect notes: body colour estimated, lighting removed; see author_skyloft_austin.py PARAMS'}
    col['stairGlass'] = P['stairGlass']
    col['capBlue'] = {'hex': P['crown'], '_src': 'unused; kept so older readers do not fail'}
    # skins: windows at the measured module
    win = {'w': P['win_w'], 'h': P['win_h'], 'sill': P['win_sill']}
    sk = d['skins']
    for name, field in (('field', 'panel'), ('fieldGrey', 'podium'), ('court', 'panel')):
        sk[name].update({'bay': P['bay'], 'field': field, 'window': dict(win), 'frame': 'frame',
                         '_src': 'square-on west elevation: 8 columns across 29.6 m (3.7 m bay), a row per storey, window 0.78 x 1.40 m'})
    sk['slot'] = {'kind': 'bays', 'bay': 2.3, 'field': 'metalWall', 'windowRule': 'checker', 'glass': 'glass', 'frame': 'frame',
                  'window': {'w': P['slot_w'], 'h': P['slot_h'], 'sill': 0.9},
                  '_src': 'slim vertical slots in the ribbed metal wall, three loose columns, about every second storey'}
    sk['slotB'] = copy.deepcopy(sk['slot']); sk['slotB']['window']['sill'] = 1.4
    sk['metal'] = {'kind': 'flat', 'field': 'metalWall'}
    sk['crown'] = {'kind': 'flat', 'field': 'crown'}
    sk['stair'].update({'mullion': 1.7, 'mullionW': 0.12, 'transom': 0.55, 'fasciaTone': 'concrete', 'glass': 'stairGlass'})

    def bands(top, base='storefront', podium_skin='fieldGrey', k0=None):
        """Standard face: ground band, 5 storeys of base, then the field to `top`."""
        out = [{'z0': 0.0, 'z1': min(GROUND, top), 'skin': base}]
        if top > GROUND: out.append({'z0': GROUND, 'z1': min(PODIUM, top), 'skin': podium_skin})
        if top > PODIUM: out.append({'z0': PODIUM, 'z1': top, 'skin': 'field'})
        return [b for b in out if b['z1'] > b['z0']]

    def face_set(top, lower_neighbour=None, to_well=False):
        """Faces of a piece; base 'garage' on the alley/south faces, 'storefront' on Nueces (west, v1)."""
        f = {'v0': {'bands': bands(top, 'garage')}, 'v1': {'bands': bands(top, 'storefront')},
             'u0': {'bands': bands(top, 'garage')}, 'u1': {'bands': bands(top, 'storefront')}}
        return f

    blocks = []
    # ---- the main masses -------------------------------------------------------------------------------
    for (u0, u1, k) in MASSING:
        top = z_of(k) if k < 18 else ROOF
        # the pieces: split across a light well where the span overlaps one
        vsegs = [(V_E, V_W)]
        for w in (WELL_B,):
            if u0 >= w[0] - 1e-6 and u1 <= w[1] + 1e-6: vsegs = [(V_E, w[2]), (w[3], V_W)]
        slab_holes = []
        if u0 == 0.0:
            slab_holes = [list(WELL_A)]
        if u0 == 31.4 and 39.05 < u1:    # the core spine: split at well B start
            pass
        parts = [(u0, u1)]
        if (u0, u1) == (31.4, 43.7): parts = [(31.4, 39.05), (39.05, 43.7)]
        for (a, b) in parts:
            segs = [(V_E, V_W)]
            if a >= WELL_B[0] - 1e-6 and b <= WELL_B[1] + 1e-6: segs = [(V_E, WELL_B[2]), (WELL_B[3], V_W)]
            for (v0, v1) in segs:
                tag = {0.0: 'slab', 31.4: 'core', 39.05: 'coreN', 43.7: 'n15', 49.58: 'n10', 55.5: 'n9', 57.8: 'n6'}[a]
                if len(segs) == 2: tag += 'E' if v0 == V_E else 'W'
                blk = {'id': tag, 'plan': [a, b, v0, v1], 'z0': 0.0, 'z1': top, 'roofTone': 'roof' if top >= ROOF - 0.1 else 'terrace',
                       'parapet': 1.05, 'parapetTone': 'coping' if top >= ROOF - 0.1 else 'rail',
                       'parapetSides': PARAPET_SIDES.get(tag, ['v0', 'v1', 'u1']),
                       'bands': bands(top), 'faces': face_set(top)}
                if a == 0.0 and not slab_holes == []:
                    blk['plan'] = {'ring': [a, b, v0, v1], 'holes': [list(WELL_A)]}
                    for i in range(4): blk['faces']['h0.%d' % i] = {'bands': [{'z0': 0.0, 'z1': top, 'skin': 'court'}]}
                blocks.append(blk)
    # ---- faces against another piece are not drawn; against a LOWER one they start where it ends ------
    def top_of(b): return b['z1']
    by = {}
    for b in blocks:
        by.setdefault(b['id'], b)
    def rect(b):
        p = b['plan']; p = p['ring'] if isinstance(p, dict) else p; return p
    def touch(a, b):
        """which face of a touches b (axis-parallel), and the overlap length"""
        A, B = rect(a), rect(b)
        if abs(A[1] - B[0]) < 1e-6 and min(A[3], B[3]) - max(A[2], B[2]) > 1e-6: return 'u1'
        if abs(A[0] - B[1]) < 1e-6 and min(A[3], B[3]) - max(A[2], B[2]) > 1e-6: return 'u0'
        if abs(A[3] - B[2]) < 1e-6 and min(A[1], B[1]) - max(A[0], B[0]) > 1e-6: return 'v1'
        if abs(A[2] - B[3]) < 1e-6 and min(A[1], B[1]) - max(A[0], B[0]) > 1e-6: return 'v0'
        return None
    for a in blocks:
        for b in blocks:
            if a is b: continue
            f = touch(a, b)
            if not f: continue
            ta, tb = a['z1'], b['z1']
            if False: pass
            elif tb >= ta - 1e-6: a['faces'][f] = None
            else: a['faces'][f] = {'z0': tb, 'bands': [x for x in bands(ta, 'garage') if x['z1'] > tb]}
    # light well B (u 39.05-49.58, v 14.6-20.7): its walls are the faces of the pieces around it
    for b in blocks:
        full = lambda top: {'bands': [{'z0': 0.0, 'z1': top, 'skin': 'court'}]}
        if b['id'] == 'core': b['faces']['u1'] = full(b['z1'])
        if b['id'] == 'n10': b['faces']['u0'] = full(b['z1'])
        if b['id'].endswith('E') and b['id'][:-1] in ('coreN', 'n15'): b['faces']['v1'] = full(b['z1'])
        if b['id'].endswith('W') and b['id'][:-1] in ('coreN', 'n15'): b['faces']['v0'] = full(b['z1'])
    # ---- the core spine on the west face (v1) ------------------------------------------------------------
    spine = [  # (u0, u1, bands)
        (31.4, 38.3, [{'z0': 0.0, 'z1': ROOF, 'skin': 'slot'}]),
        (38.3, 40.7, [{'z0': 0.0, 'z1': ROOF, 'skin': 'stair'}]),
        (40.7, 43.7, [{'z0': 0.0, 'z1': ROOF, 'skin': 'concrete'}])]
    for b in blocks:
        if b['id'] == 'core':
            b['overrides'] = [{'region': [31.4, 36.0, V_W, V_W], 'bands': [{'z0': 0.0, 'z1': ROOF, 'skin': 'slotB'}]},
                              {'region': [36.0, 38.3, V_W, V_W], 'bands': [{'z0': 0.0, 'z1': ROOF, 'skin': 'slot'}]},
                              {'region': [38.3, 39.05, V_W, V_W], 'bands': spine[1][2]}]
        if b['id'] == 'coreNW':
            b['overrides'] = [{'region': [39.05, 40.7, V_W, V_W], 'bands': spine[1][2]},
                              {'region': [40.7, 43.7, V_W, V_W], 'bands': spine[2][2]}]
    # ---- west face: white podium segment, glazed corner bays ------------------------------------------------
    for b in blocks:
        if b['id'] == 'slab':
            b['overrides'] = [{'region': [1.2, 3.8, V_W, V_W], 'bands': [{'z0': 0.0, 'z1': GROUND, 'skin': 'storefront'}, {'z0': GROUND, 'z1': PODIUM, 'skin': 'lounge'}]},
                              {'region': [3.8, 14.5, V_W, V_W], 'bands': [{'z0': 0.0, 'z1': GROUND, 'skin': 'storefront'}, {'z0': GROUND, 'z1': PODIUM, 'skin': 'field'}, {'z0': PODIUM, 'z1': ROOF, 'skin': 'field'}]}]
        if b['id'] == 'n6':
            # north (23rd St) face seen from the north-west: glazed corner bay at the west end, a white stretch, then the dark grey end
            lounge_bands = [{'z0': 0.0, 'z1': GROUND, 'skin': 'storefront'}] + [{'z0': z_of(k), 'z1': z_of(k + 1), 'skin': 'lounge'} for k in range(1, 6)]
            white = [{'z0': 0.0, 'z1': GROUND, 'skin': 'storefront'}, {'z0': GROUND, 'z1': PODIUM, 'skin': 'field'}]
            b['overrides'] = [{'region': [62.54, 62.54, 23.1, V_W], 'bands': lounge_bands},
                              {'region': [62.54, 62.54, 17.1, 23.1], 'bands': white},
                              {'region': [58.5, 62.54, V_W, V_W], 'bands': lounge_bands}]
            continue
        if b['id'] == 'n6_old':
            b['overrides'] = [{'region': [58.5, 62.54, V_W, V_W], 'bands': [{'z0': 0.0, 'z1': GROUND, 'skin': 'storefront'}] + [{'z0': z_of(k), 'z1': z_of(k + 1), 'skin': 'lounge'} for k in range(1, 6)]},
                              {'region': [62.54, 62.54, 31.59, V_W], 'bands': [{'z0': 0.0, 'z1': GROUND, 'skin': 'storefront'}] + [{'z0': z_of(k), 'z1': z_of(k + 1), 'skin': 'lounge'} for k in range(1, 6)]}]
    # ---- roof plant (kept from the file where it fits the new pieces) -----------------------------------------
    for b in blocks:
        if b['id'] == 'slab':
            b['roofItems'] = [{'plan': [9.5, 14.5, 12.3, 19.3], 'grid': [3, 4], 'size': [1.2, 1.9], 'h': 1.0, 'tone': 'mech', '_src': 'nadir roof plan: condenser rows'},
                              {'plan': [9.0, 14.0, 1.8, 6.8], 'grid': [3, 3], 'size': [1.2, 1.9], 'h': 1.0, 'tone': 'mech', '_src': 'nadir roof plan'},
                              {'plan': [20.5, 27.0, 21.3, 29.3], 'grid': [3, 5], 'size': [1.2, 1.9], 'h': 1.0, 'tone': 'mech', '_src': 'nadir roof plan'}]
        if b['id'] == 'core':
            b['roofItems'] = [{'plan': [34.5, 39.0, 22.0, 34.0], 'h': 3.0, 'tone': 'mech', '_src': 'nadir roof plan: raised plant, height derived'}]
    # ---- two grey pinstripe columns on the slab's west face, each with a wider two-light window (square-on elevation) --------
    sk['stripe'] = {'kind': 'bays', 'bay': 1.4, 'field': 'panelGrey', 'windowRule': 'all', 'window': {'w': 1.15, 'h': P['win_h'], 'sill': P['win_sill'], 'mullion': {'cols': [0.5], 'rows': [], 'w': 0.05, 'tone': 'frame'}},
                    'glass': 'glass', 'frame': 'frame', '_src': 'square-on west elevation: two full-height grey columns one bay wide at u 7.0 and 22.4, windows wider than the field windows, two lights'}
    for i, uc in enumerate(P['stripe_u']):
        blocks.append({'id': 'stripe%d' % i, 'plan': [round(uc - 0.7, 3), round(uc + 0.7, 3), V_W, V_W + 0.2], 'z0': PODIUM, 'z1': ROOF, 'roofTone': 'coping',
                       'bands': [{'z0': PODIUM, 'z1': ROOF, 'skin': 'stripe'}], 'faces': {'v0': None, 'u0': None, 'u1': None, 'v1': {'bands': [{'z0': PODIUM, 'z1': ROOF, 'skin': 'stripe'}]}},
                       '_src': 'square-on west elevation (INFERRED to stand 0.2 m proud of the slab)'})
    # ---- crown: the dark box on the core, overhanging north ---------------------------------------------------
    blocks.append({'id': 'crown', 'plan': [U_CORE[0], U_CORE[1] + P['crown_overhang'], 21.5, V_W + 0.4], 'z0': ROOF, 'z1': round(ROOF + P['crown_h'], 3),
                   'bands': [{'z0': ROOF, 'z1': round(ROOF + P['crown_h'], 3), 'skin': 'crown'}], 'roofTone': 'crown', 'parapet': 0.0,
                   '_src': 'site photograph: dark crown box on the core, about 4.6 m above the slab roof; overhang to the north about 2 m (INFERRED depth)'})
    d['blocks'] = blocks
    d['_readme'] = d['_readme'] + ' Re-massed from a square-on west elevation and an elevated oblique (see scripts/author_skyloft_austin.py).'
    d['open'] = [
        'East, south and north faces and the v extent of the stepped blocks are INFERRED from the west elevation.',
        'The two grey pinstripe columns with two-light windows on the slab are not drawn.',
        'The glazed corner bay and the terrace lounges on the steps use the old lounge skin; their depth is inferred.',
        'Heights of the 10- and 9-storey steps are counts from one elevation (+-1 storey).',
        'No SKYLOFT blade sign yet (needs outline lettering).']
    for k in ('todo', '_balcony_src'): d.pop(k, None)
    d['_balcony_src'] = 'no balconies on any face of the photographs'
    OUT.write_text(json.dumps(d, separators=(',', ':'), ensure_ascii=False))
    print('wrote', OUT, len(blocks), 'blocks')


if __name__ == '__main__': main()
