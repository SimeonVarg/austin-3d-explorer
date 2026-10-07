"""Battle's east reading-hall elevation, interpreted from exterior views.

Seven arches, six lower windows and the central rectangular doorway are
source-backed. Heights and depths are approximate; fine carving, mosaics and
heraldic figures are deliberately not fabricated. The original roof is retained.
"""
import copy
import math

from campus_gearing import Details


T = dict(
    plan=[14.9, 34.45, 0, 43.1], wallTop=17.7, bays=7,
    upperBottom=7.30, spring=13.15, glassWidth=3.65,
    decorativeWidth=.35, upperDepth=.68, archSegments=16,
    ringWidths=[.22, .14, .12], ringProud=[.14, .23, .17],
    ringTones=['battlePale', 'battleStone', 'battlePale'],
    decorativeBands=[.07, .21, .07],
    decorativeTones=['battleGold', 'battleBlue', 'battleTeal'],
    decorativeBack=-.60, decorativeFront=-.48,
    sashBack=-.635, sashFront=-.54, sashWidth=.085,
    sashBar=.045, sashTransom=.095, sashCols=[.25, .5, .75],
    sashRows=[.25, .5, .75], fanInnerRatio=.51,
    fanAngles=[math.pi/4, math.pi/2, 3*math.pi/4],
    windowLit=False, wallEmbed=.025,
    lowerWidth=2.55, lowerBottom=1.55, lowerTop=5.85,
    lowerDepth=.42, lowerSurround=.18, lowerProud=.16,
    lowerHead=.24, lowerSill=.16, lowerSillProud=.26,
    doorWidth=2.80, doorBottom=.05, doorTop=5.85, doorDepth=.72,
    doorFrame=.13, doorColumns=4, doorRows=7,
    doorPanelInset=.055, doorPanelGap=.13,
    doorSurround=.31, doorSurroundProud=.23, doorHead=.38,
    doorNotchClearance=.025,
    guardWidth=4.55, guardDepth=.59, guardSlabBottom=7.28,
    guardSlabTop=7.42, guardHeight=1.13, guardBar=.032,
    guardBars=19, guardRail=.055, guardReturnBars=3,
    guardBracketOffsets=[-1.65, -.56, .56, 1.65],
    guardBracketWidth=.14, guardBracketDrop=.59,
    guardBracketKnee=.20, guardBracketTip=.14,
    lanternOffset=2.15, lanternBottom=3.55, lanternTop=4.80,
    lanternWidth=.43, lanternDepth=.37, lanternBack=.23,
    lanternBar=.045, lanternCapHeight=.19,
    lanternArmWidth=.065, lanternArmOut=.35,
    eaveBottom=16.48, eaveTop=17.50, eaveFieldBack=.32,
    eaveFieldFront=.355, eaveOut=.53, eaveSoffitThickness=.055,
    eaveBracketCount=36, eaveBracketWidth=.17,
    eaveBracketDrop=.81, eaveBracketTip=.16,
    eaveBracketKnee=.35, eaveRail=.075,
    eavePanelInset=.16, eavePanelBorder=.043,
    maxDetailTriangles=20000,
)
COLOURS = dict(battleStone='#d6cbb3', battlePale='#e4dcc9',
    battleGlass='#40545b', battleSash='#c5c8b7', battleBlue='#345b75',
    battleTeal='#36756c', battleGold='#ad945d', battleIron='#455351',
    battleDoor='#3c8177', battleDoorPanel='#327269',
    battleLanternGlass='#748778')
MATERIALS = {k: ('stone' if k in ('battleStone', 'battlePale') else
                 'glass' if k == 'battleGlass' else 'plain') for k in COLOURS}


def refine(model):
    """Return a deep copy; only the east facade and its door-course notch change."""
    assert model['id'] == '283f5992-bc72-411a-80ba-25d0314544d0'
    assert not model.get('battleEast'), 'Refine the original Battle baseline once'
    out = copy.deepcopy(model)
    t = copy.deepcopy(T)
    blocks = {b['id']: b for b in out['blocks']}
    hall = blocks['reading-hall']
    assert hall['plan'] == t['plan'] and hall['z0'] == 0 and hall['z1'] == t['wallTop']
    _, east, v0, v1 = hall['plan']
    length = v1-v0
    centres = [(i+.5)*length/t['bays'] for i in range(t['bays'])]
    middle = centres[t['bays']//2]
    m = Details([east, v0], [0, 1])
    solids = []

    def solid(tone, points, faces, role):
        before = len(m.meshes.get(tone, {}).get('vertices', []))
        tri_before = len(m.meshes.get(tone, {}).get('triangles', []))
        m.solid(tone, points, faces)
        solids.append(dict(tone=tone, start=before, count=len(points),
                           triangleStart=tri_before,
                           triangleCount=len(m.meshes[tone]['triangles'])-tri_before,
                           role=role))

    def box(tone, x0, x1, d0, d1, z0, z1, role):
        assert x1 > x0 and d1 > d0 and z1 > z0
        solid(tone, [[x, d, z] for z in (z0, z1)
                     for x, d in ((x0, d0), (x1, d0), (x1, d1), (x0, d1))],
              [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
               (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], role)

    def profile(tone, polygon, d0, d1, role):
        n = len(polygon)
        solid(tone, [[x, d, z] for d in (d0, d1) for x, z in polygon],
              [tuple(range(n)), tuple(range(n, 2*n))] +
              [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)], role)

    def arch_ring(tone, c, spring, inner, outer, d0, d1, role):
        # Each annular wedge is convex and independently closed. A single
        # concave annulus cap would not be safe for Details' triangle fan.
        for i in range(t['archSegments']):
            a, b = [math.pi*j/t['archSegments'] for j in (i, i+1)]
            profile(tone, [(c+r*math.cos(q), spring+r*math.sin(q))
                          for r, q in ((inner, a), (outer, a),
                                       (outer, b), (inner, b))], d0, d1, role)

    def bar(tone, a, b, width, d0, d1, role):
        dx, dz = b[0]-a[0], b[1]-a[1]
        mag = math.hypot(dx, dz)
        nx, nz = -dz/mag*width/2, dx/mag*width/2
        profile(tone, [(a[0]+nx, a[1]+nz), (b[0]+nx, b[1]+nz),
                       (b[0]-nx, b[1]-nz), (a[0]-nx, a[1]-nz)], d0, d1, role)

    def bracket(tone, c, width, bottom, top, back, front, knee, tip, role):
        section = [(back, bottom), (knee, bottom), (front, top-tip),
                   (front, top), (back, top)]
        n = len(section)
        solid(tone, [[x, d, z] for x in (c-width/2, c+width/2)
                     for d, z in section],
              [tuple(range(n)), tuple(range(n, 2*n))] +
              [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)], role)

    out['colours'].update({k: dict(hex=v) for k, v in COLOURS.items()})
    out.setdefault('materials', {}).update(MATERIALS)
    out['skins']['battleEastStone'] = dict(kind='flat', field='battleStone')
    openings = []

    def opening(c, width, low, high, depth, glass, rise=None):
        # Rectangle face u1 is traversed from v1 to v0 by the renderer.
        o = dict(s0=length-c-width/2, s1=length-c+width/2,
                 z0=low, z1=high, d=depth, tone='battleStone',
                 glass=glass, lit=t['windowLit'])
        if rise is not None:
            o['arch'] = dict(rise=rise, segments=t['archSegments'],
                             tone='battleStone', trim=0)
        openings.append(o)

    radius = t['glassWidth']/2
    cut_radius = radius+t['decorativeWidth']
    for c in centres:
        low, spring = t['upperBottom'], t['spring']
        opening(c, 2*cut_radius, low, spring+cut_radius,
                t['upperDepth'], 'battleGlass', cut_radius)
        # Nested pale outer voussoirs, with continuous matching jambs.
        r = cut_radius
        for width, proud, tone in zip(t['ringWidths'], t['ringProud'], t['ringTones']):
            arch_ring(tone, c, spring, r, r+width,
                      -t['wallEmbed'], proud, 'upper-stone-arch')
            for a, b in ((c-r-width, c-r), (c+r, c+r+width)):
                box(tone, a, b, -t['wallEmbed'], proud, low, spring, 'upper-stone-jamb')
            r += width
        r = radius
        for width, tone in zip(t['decorativeBands'], t['decorativeTones']):
            arch_ring(tone, c, spring, r, r+width, t['decorativeBack'],
                      t['decorativeFront'], 'decorative-arch-band')
            for a, b in ((c-r-width, c-r), (c+r, c+r+width)):
                box(tone, a, b, t['decorativeBack'], t['decorativeFront'],
                    low, spring, 'decorative-jamb-band')
            r += width
        fw, db, df = t['sashWidth'], t['sashBack'], t['sashFront']
        arch_ring('battleSash', c, spring, radius-fw, radius, db, df, 'upper-sash-arch')
        arch_ring('battleSash', c, spring, radius*t['fanInnerRatio']-fw/2,
                  radius*t['fanInnerRatio']+fw/2, db, df, 'fanlight-inner-arch')
        for x in (c-radius, c+radius-fw):
            box('battleSash', x, x+fw, db, df, low, spring, 'upper-sash-frame')
        for z, width in [(low, fw), (spring-fw/2, fw)] + [
                (low+(spring-low)*f-t['sashTransom']/2,
                 t['sashTransom'] if f == .5 else t['sashBar']) for f in t['sashRows']]:
            box('battleSash', c-radius, c+radius, db, df, z, z+width, 'upper-sash-rail')
        for f in t['sashCols']:
            x = c-radius+2*radius*f
            box('battleSash', x-t['sashBar']/2, x+t['sashBar']/2,
                db, df, low, spring, 'upper-sash-mullion')
        for angle in t['fanAngles']:
            bar('battleSash', (c, spring),
                (c+(radius-fw)*math.cos(angle), spring+(radius-fw)*math.sin(angle)),
                t['sashBar'], db, df, 'fanlight-radial')

        # Each shallow Juliet balcony is attached to the retained z7 course.
        half, depth = t['guardWidth']/2, t['guardDepth']
        zb, zt = t['guardSlabBottom'], t['guardSlabTop']
        box('battlePale', c-half, c+half, -t['wallEmbed'], depth, zb, zt, 'juliet-slab')
        rail, bw, top = t['guardRail'], t['guardBar'], zt+t['guardHeight']
        for z in (zt+rail, top-rail):
            box('battleIron', c-half, c+half, depth-bw, depth, z, z+rail, 'juliet-front-rail')
            for x in (c-half, c+half-bw):
                box('battleIron', x, x+bw, 0, depth, z, z+rail, 'juliet-return-rail')
        for i in range(t['guardBars']):
            x = c-half+bw/2+(2*half-bw)*i/(t['guardBars']-1)
            box('battleIron', x-bw/2, x+bw/2, depth-bw, depth, zt, top, 'juliet-bar')
        for x in (c-half, c+half-bw):
            for i in range(t['guardReturnBars']):
                d = (i+.5)*(depth-bw)/t['guardReturnBars']
                box('battleIron', x, x+bw, d, d+bw, zt, top, 'juliet-return-bar')
        for offset in t['guardBracketOffsets']:
            bracket('battleIron', c+offset, t['guardBracketWidth'],
                    zb-t['guardBracketDrop'], zb, -t['wallEmbed'], depth,
                    t['guardBracketKnee'], t['guardBracketTip'], 'juliet-bracket')

    for i, c in enumerate(centres):
        door = i == t['bays']//2
        width = t['doorWidth'] if door else t['lowerWidth']
        low = t['doorBottom'] if door else t['lowerBottom']
        high = t['doorTop'] if door else t['lowerTop']
        depth = t['doorDepth'] if door else t['lowerDepth']
        opening(c, width, low, high, depth, 'battleDoor' if door else 'battleGlass')
        half = width/2
        sw = t['doorSurround'] if door else t['lowerSurround']
        proud = t['doorSurroundProud'] if door else t['lowerProud']
        head = t['doorHead'] if door else t['lowerHead']
        for a, b in ((c-half-sw, c-half), (c+half, c+half+sw)):
            box('battlePale', a, b, -t['wallEmbed'], proud, low, high, 'door-surround' if door else 'lower-surround')
        box('battlePale', c-half-sw, c+half+sw, -t['wallEmbed'], proud,
            high, high+head, 'door-head' if door else 'lower-head')
        if not door:
            box('battlePale', c-half-sw, c+half+sw, -t['wallEmbed'],
                t['lowerSillProud'], low-t['lowerSill'], low, 'lower-sill')
        fw = t['doorFrame'] if door else t['sashWidth']
        tone = 'battleDoor' if door else 'battleSash'
        db, df = -depth+t['wallEmbed'], -depth+t['wallEmbed']+t['sashFront']-t['sashBack']
        cols = t['doorColumns'] if door else len(t['sashCols'])+1
        rows = t['doorRows'] if door else 2
        for j in range(cols+1):
            x = c-half+fw/2+(width-fw)*j/cols
            box(tone, x-fw/2, x+fw/2, db, df, low, high, 'door-stile' if door else 'lower-stile')
        for j in range(rows+1):
            z = low+fw/2+(high-low-fw)*j/rows
            box(tone, c-half, c+half, db, df, z-fw/2, z+fw/2, 'door-rail' if door else 'lower-rail')
        if door:
            # Recessed rectangular panels, not a luminous giant glass door.
            for col in range(cols):
                for row in range(rows):
                    gap = t['doorPanelGap']
                    a, b = [c-half+width*(col+j)/cols for j in (0, 1)]
                    za, zz = [low+(high-low)*(row+j)/rows for j in (0, 1)]
                    box('battleDoorPanel', a+gap, b-gap, db-t['doorPanelInset'],
                        db, za+gap, zz-gap, 'door-panel')

    for c in (middle-t['lanternOffset'], middle+t['lanternOffset']):
        half = t['lanternWidth']/2
        low, high = t['lanternBottom'], t['lanternTop']
        db, df = t['lanternBack'], t['lanternBack']+t['lanternDepth']
        barw = t['lanternBar']
        box('battleLanternGlass', c-half, c+half, db, df, low, high, 'lantern-body')
        for x in (c-half, c+half-barw):
            for d in (db, df-barw):
                box('battleIron', x, x+barw, d, d+barw, low, high, 'lantern-frame')
        for z in (low, high-barw):
            box('battleIron', c-half, c+half, db, df, z, z+barw, 'lantern-rim')
        aw = t['lanternArmWidth']
        box('battleIron', c-aw/2, c+aw/2, -t['wallEmbed'], df,
            high, high+aw, 'lantern-arm')
        # A closed hipped cap, with a small flat crest rather than a zero-area apex.
        cap = t['lanternCapHeight']
        solid('battleIron', [[c+x, d, z] for z, h, da, dz in
              ((high, half, db, df), (high+cap, barw, db+half-barw, df-half+barw))
              for x, d in ((-h, da), (h, da), (h, dz), (-h, dz))],
              [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
               (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'lantern-cap')

    # Retained stone courses end at16.48 and start at17.5. This coffered
    # colored field fills that interval and sits just ahead of their faces.
    eb, et = t['eaveBottom'], t['eaveTop']
    db, df, eo = t['eaveFieldBack'], t['eaveFieldFront'], t['eaveOut']
    box('battleTeal', 0, length, db, df, eb, et, 'eave-field')
    box('battleTeal', 0, length, -t['wallEmbed'], eo,
        et-t['eaveSoffitThickness'], et, 'eave-soffit')
    for z in (eb, et-t['eaveRail']):
        box('battleGold', 0, length, df, eo, z, z+t['eaveRail'], 'eave-rail')
    bw = t['eaveBracketWidth']
    for i in range(t['eaveBracketCount']):
        c = bw/2+(length-bw)*i/(t['eaveBracketCount']-1)
        bracket('battleGold', c, bw, et-t['eaveBracketDrop'], et,
                db, eo, t['eaveBracketKnee'], t['eaveBracketTip'], 'eave-bracket')
    pitch = (length-bw)/(t['eaveBracketCount']-1)
    for i in range(t['eaveBracketCount']-1):
        a = bw/2+pitch*i+t['eavePanelInset']
        b = bw/2+pitch*(i+1)-t['eavePanelInset']
        low, high = eb+t['eavePanelInset'], et-t['eavePanelInset']
        border = t['eavePanelBorder']
        for x in (a, b-border):
            box('battleGold', x, x+border, df, df+border, low, high, 'eave-panel-border')
        for z in (low, high-border):
            box('battleGold', a, b, df, df+border, z, z+border, 'eave-panel-border')

    hall.setdefault('faces', {})['u1'] = dict(bands=[dict(
        z0=hall['z0'], z1=hall['z1'], skin='battleEastStone', openings=openings)])
    # The original course is a solid slab, not merely a wall band. The one
    # authorized central notch prevents that slab crossing the new doorway.
    course = blocks['cornice-1.1']
    assert course['plan'] == [14.58, 34.77, -.32, 43.42]
    assert math.isclose(course['z0'], 1.1) and math.isclose(course['z1'], 1.38)
    a, b, lo, hi = course['plan']
    cut_lo = middle-t['doorWidth']/2-t['doorNotchClearance']
    cut_hi = middle+t['doorWidth']/2+t['doorNotchClearance']
    back = east-t['doorDepth']-t['doorNotchClearance']
    course['plan'] = dict(ring=[[b, lo], [a, lo], [a, hi], [b, hi],
        [b, cut_hi], [back, cut_hi], [back, cut_lo], [b, cut_lo]])
    meshes = list(m.meshes.values())
    for mesh in meshes:
        mesh['id'] = 'battle-east-'+mesh['tone']
    triangles = sum(len(x['triangles']) for x in meshes)
    assert triangles <= t['maxDetailTriangles']
    assert all(math.isfinite(v) for mesh in meshes for p in mesh['vertices'] for v in p)
    out.setdefault('detailMeshes', []).extend(meshes)
    out['battleEast'] = dict(version=1, parameters=t, arches=t['bays'],
        lowerWindows=t['bays']-1, doors=1, julietGuards=t['bays'],
        triangles=triangles, solidCount=len(solids), solids=solids,
        meshIds=[x['id'] for x in meshes], doorCourseNotch=dict(
            block='cornice-1.1', s0=cut_lo, s1=cut_hi, back=back),
        scope='East reading-hall face and narrow central doorway course notch only.',
        limits='Exterior-view proportions, not a survey. Fine carving, mosaic imagery '
               'and heraldic figures are omitted. Original roof, upper courses and '
               'other elevations remain unchanged; ground access is separately owned.')
    return out
