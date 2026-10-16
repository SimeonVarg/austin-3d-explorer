"""THE STANDARD LIGHT for every building made in Blender for Austin 3D Explorer.

The app lights every building with one light: the sky and the sun that `js/city-sky.js` makes for the hour. A colour chosen in
Blender only means something under that same light. This file puts that light into a Blender scene, so that what you see in your
render is what the app will draw. Run it BEFORE you choose any colour.

THE THREE CALLS A BUILDER NEEDS (inside Blender; `sys.path.insert(0, os.path.expanduser('~/Projects/flyover-blender/scripts'))`):

    import light_rig
    light_rig.apply()                                   # 1. the sky, the sun, the ground and the view transform of the app at noon
    light_rig.sun_from_photo(azimuth_deg, elevation_deg) # 2. turn the sun to where it stood in YOUR photograph (compass bearing the
                                                        #    light comes FROM, and its height); the sky does not change
    light_rig.check()                                   # 3. before every final render: returns [] when the scene is under the rig,
                                                        #    else the list of what is not (another light, another world, a look, ...)

WHEN THE PHOTOGRAPH HAS NO SUN IN IT (overcast, dawn, dusk: no cast shadow anywhere), there is nothing to turn the sun to. Then:

    k = light_rig.exposure_from(pixel, normal, surface='white_paint')   # 1. how far the camera lifted that grey day, from ONE surface whose
                                                                         #    colour is known (white paint, bare concrete; see REFERENCE)
    light_rig.apply(weather='overcast', exposure=k)                      # 2. a grey sky with no sun, and the view exposed like the photograph
    result = light_rig.base_colour(samples, weather='overcast', exposure=k)   # 3. every colour = pixel / (that grey light x k)
    ok, rows = light_rig.gate(pairs, by_material=True)                   # 4. the gate for a no-sun photograph: each MATERIAL's places, pooled

The base colours come out on the same scale as from a sunlit photograph (that is what the known surface is for), so the app lights
both buildings alike. Never call sun_from_photo() for such a photograph, and never put a sun where you would like one.

For colours (plain Python, works without Blender too; MATERIALS.md says how to use them):

    light_rig.light_on(normal, sun_to, in_sun)          # the light that reaches a face under the rig (red, green, blue)
    light_rig.base_colour(samples)                      # a material's own colour from sun and shade samples of the photograph
    light_rig.gate(pairs)                               # photograph against render at the same places: worst channel, pass under 8 %

What `apply()` sets, and nothing else: the world (the sky by height above the level line; it LIGHTS with the app's gain and shows to
the camera and to mirrors without it), one sun (any other light is switched off for rendering), the ground (every object with
"ground" in its name gets the ground colour; a plane is made when there is none), and the view transform (Standard, no look,
exposure 0, gamma 1). It does not touch your model, your camera or your render size.

TWO LIGHTS (2026-10-15): RIG is light A (the default), RIG_B is light B, the owner's choice (more sky light, a brighter sky in
mirrors). FLYOVER_RIG=B or light_rig.use('B') before apply() builds under B; see "which light" below.

The numbers in RIG are written by `scripts/city-sky-rig.mjs` from `js/city-sky.js` and checked by `scripts/verify/gltf-layer.mjs`.
Do not edit them here: change the app's light, then run that script.
"""
import math

# RIG-BEGIN (generated: node scripts/city-sky-rig.mjs)
RIG = {'version':'2026-10-12','noon':{'p':0.315,'sunAzEl':[181.35,51],'sunDir':[-0.01486,-0.62914,0.77715],'sunStrength':[23.65,21.64,18.95],'pts':[[-0.02,[0.14996,0.21586,0.25415]],[0.004,[0.14996,0.21586,0.25415]],[0.006,[0.51492,0.64448,0.76052]],[0.045,[0.46208,0.5972,0.73046]],[0.153,[0.18447,0.40198,0.7454]],[0.26,[0.09759,0.25818,0.59062]],[0.6,[0.0382,0.12744,0.45641]]],'gain':[6.22638,4.00238,2.44917],'ground':[0.99243,0.95979,0.94171],'groundColour':[0.16,0.16,0.16],'groundEdge':-0.01,'treeShift':-0.003,'light':[[3.11791,3.01533,2.95831],[3.25995,3.17265,3.1026],[3.27557,3.23966,3.21533],[3.24743,3.268,3.30982],[3.19214,3.27151,3.39221],[3.11688,3.25659,3.46558],[3.02526,3.22653,3.53151],[2.91927,3.18316,3.59093],[2.80118,3.12897,3.64646],[2.66684,3.05878,3.6911],[2.52042,2.97776,3.73186],[2.35962,2.88343,3.7661],[2.18245,2.77396,3.79291],[1.98532,2.64606,3.81069],[1.76105,2.49334,3.81637],[1.493,2.30194,3.80382],[1.09854,2.02023,3.7597]]},'morning':{'p':0.05,'sunAzEl':[108.4,56],'sunDir':[0.5306,-0.17651,0.82904],'sunStrength':[23.65,21.64,18.95],'pts':[[-0.02,[0.14996,0.21586,0.25415]],[0.004,[0.14996,0.21586,0.25415]],[0.006,[0.51492,0.64448,0.76052]],[0.045,[0.46208,0.5972,0.73046]],[0.153,[0.18447,0.40198,0.7454]],[0.26,[0.09759,0.25818,0.59062]],[0.6,[0.0382,0.12744,0.45641]]],'gain':[6.22638,4.00238,2.44917],'ground':[1.05493,1.01698,0.99179],'groundColour':[0.16,0.16,0.16],'groundEdge':-0.01,'treeShift':-0.003,'light':[[3.31422,3.19495,3.1156],[3.44296,3.34011,3.24924],[3.44593,3.39553,3.35183],[3.40525,3.41241,3.43627],[3.33751,3.40452,3.50869],[3.24985,3.37826,3.57212],[3.14587,3.33688,3.62815],[3.02755,3.28224,3.67769],[2.89725,3.21687,3.72343],[2.75059,3.1354,3.7582],[2.59195,3.04321,3.78917],[2.41897,2.93774,3.81365],[2.22967,2.81716,3.83074],[2.02045,2.67821,3.83884],[1.78417,2.51449,3.8349],[1.50424,2.31223,3.81283],[1.09854,2.02023,3.7597]]},'afternoon':{'p':0.4,'sunAzEl':[222.35,34],'sunDir':[-0.55852,-0.61267,0.55919],'sunStrength':[23.65,21.64,18.95],'pts':[[-0.02,[0.14996,0.21586,0.25415]],[0.004,[0.14996,0.21586,0.25415]],[0.006,[0.51492,0.64448,0.76052]],[0.045,[0.46208,0.5972,0.73046]],[0.153,[0.18447,0.40198,0.7454]],[0.26,[0.09759,0.25818,0.59062]],[0.6,[0.0382,0.12744,0.45641]]],'gain':[6.22638,4.00238,2.44917],'ground':[0.72991,0.71958,0.73136],'groundColour':[0.16,0.16,0.16],'groundEdge':-0.01,'treeShift':-0.003,'light':[[2.29339,2.26088,2.29764],[2.49128,2.46931,2.48669],[2.56007,2.58496,2.64201],[2.58455,2.66145,2.77867],[2.58158,2.71284,2.90298],[2.55841,2.74559,3.01809],[2.51871,2.76302,3.12562],[2.46446,2.76701,3.2265],[2.39769,2.75977,3.32315],[2.3151,2.73693,3.40926],[2.21999,2.70286,3.49114],[2.11035,2.65535,3.56637],[1.98416,2.59252,3.63402],[1.83777,2.51105,3.69246],[1.66393,2.40448,3.73856],[1.44579,2.25875,3.76599],[1.09854,2.02023,3.7597]]},'golden':{'p':0.49,'sunAzEl':[253,9],'sunDir':[-0.94453,-0.28877,0.15643],'sunStrength':[23.65,15.86933,9.56524],'pts':[[-0.02,[0.11725,0.10944,0.12806]],[0.004,[0.11725,0.10944,0.12806]],[0.006,[0.8845,0.48423,0.29988]],[0.045,[0.79928,0.44846,0.31702]],[0.153,[0.35019,0.32808,0.48375]],[0.26,[0.11236,0.18492,0.43896]],[0.6,[0.02829,0.0694,0.27313]]],'gain':[6.22638,4.00238,2.44917],'ground':[0.24812,0.19012,0.19593],'groundColour':[0.16,0.16,0.16],'groundEdge':-0.01,'treeShift':-0.003,'light':[[0.78,0.59753,0.61569],[1.31676,0.82938,0.77001],[1.60654,0.98324,0.92068],[1.81327,1.10318,1.06011],[1.9691,1.20132,1.19129],[2.08759,1.28324,1.31614],[2.17565,1.35187,1.43569],[2.23688,1.40879,1.55062],[2.27349,1.45531,1.66219],[2.28403,1.48957,1.76716],[2.26996,1.51341,1.86878],[2.22905,1.52556,1.96578],[2.15772,1.52441,2.05748],[2.04904,1.50704,2.14285],[1.88947,1.46788,2.21997],[1.64683,1.39478,2.28584],[1.15723,1.24371,2.34807]]},'night':{'p':0.9,'sunAzEl':[295.75,-31],'sunDir':[0.88356,-0.33664,0.32557],'sunStrength':[0.035,0.045,0.07],'pts':[[-0.02,[0.00304,0.00402,0.007]],[0.004,[0.00304,0.00402,0.007]],[0.006,[0.00605,0.00913,0.02122]],[0.045,[0.00478,0.007,0.01764]],[0.153,[0.00304,0.00439,0.01161]],[0.26,[0.00212,0.00304,0.00802]],[0.6,[0.00121,0.00182,0.00439]]],'gain':[18.67915,12.00713,7.3475],'ground':[0.00492,0.00487,0.00742],'groundColour':[0.16,0.16,0.16],'groundEdge':-0.01,'treeShift':-0.003,'light':[[0.0155,0.01534,0.02335],[0.02855,0.02748,0.04182],[0.03769,0.03595,0.05498],[0.04537,0.04309,0.06604],[0.05213,0.04938,0.07577],[0.05821,0.05505,0.0845],[0.06373,0.06022,0.09242],[0.06875,0.06493,0.09963],[0.07335,0.06926,0.10621],[0.07743,0.07311,0.11201],[0.08107,0.07656,0.1172],[0.08422,0.07957,0.12167],[0.08681,0.08207,0.12532],[0.08872,0.08395,0.12799],[0.08971,0.08498,0.12931],[0.08925,0.08469,0.12854],[0.08487,0.08072,0.12245]]}}
# RIG-END
# RIG-B-BEGIN (generated: node scripts/city-sky-rig.mjs)
RIG_B = {'version':'2026-10-15-B','mirrorSky':1.6,'noon':{'p':0.315,'sunAzEl':[181.35,51],'sunDir':[-0.01486,-0.62914,0.77715],'sunStrength':[19.866,18.1776,15.918],'pts':[[-0.02,[0.14996,0.21586,0.25415]],[0.004,[0.14996,0.21586,0.25415]],[0.006,[0.51492,0.64448,0.76052]],[0.045,[0.46208,0.5972,0.73046]],[0.153,[0.18447,0.40198,0.7454]],[0.26,[0.09759,0.25818,0.59062]],[0.6,[0.0382,0.12744,0.45641]]],'gain':[9.33958,6.00356,3.67375],'ground':[1.74169,1.74878,1.83508],'groundColour':[0.32,0.32,0.32],'groundEdge':-0.01,'treeShift':-0.003,'light':[[5.47164,5.4938,5.76449],[5.63085,5.66402,5.89103],[5.60305,5.70194,5.97457],[5.5101,5.68248,6.0316],[5.37673,5.62615,6.07098],[5.21363,5.54244,6.09719],[5.02617,5.43622,6.11254],[4.81729,5.31024,6.11838],[4.59071,5.16853,6.11909],[4.33931,5.00231,6.10277],[4.07021,4.82036,6.08131],[3.7797,4.61864,6.05034],[3.46482,4.39443,6.00851],[3.12021,4.14283,5.95351],[2.73518,3.85435,5.88086],[2.285,3.5085,5.78171],[1.64781,3.03035,5.63956]]},'morning':{'p':0.05,'sunAzEl':[108.4,56],'sunDir':[0.5306,-0.17651,0.82904],'sunStrength':[19.866,18.1776,15.918],'pts':[[-0.02,[0.14996,0.21586,0.25415]],[0.004,[0.14996,0.21586,0.25415]],[0.006,[0.51492,0.64448,0.76052]],[0.045,[0.46208,0.5972,0.73046]],[0.153,[0.18447,0.40198,0.7454]],[0.26,[0.09759,0.25818,0.59062]],[0.6,[0.0382,0.12744,0.45641]]],'gain':[9.33958,6.00356,3.67375],'ground':[1.8467,1.84486,1.91921],'groundColour':[0.32,0.32,0.32],'groundEdge':-0.01,'treeShift':-0.003,'light':[[5.80144,5.79557,6.02875],[5.9383,5.94534,6.13739],[5.88924,5.96381,6.20388],[5.77525,5.92509,6.24405],[5.62095,5.84961,6.26666],[5.43701,5.74683,6.27618],[5.22879,5.62162,6.27489],[4.99921,5.4767,6.26415],[4.7521,5.31621,6.24841],[4.48001,5.13105,6.2155],[4.19038,4.93031,6.1776],[3.87941,4.70988,6.13023],[3.54414,4.467,6.07206],[3.17923,4.19683,6.0008],[2.77402,3.88989,5.91199],[2.30388,3.52578,5.79684],[1.64781,3.03035,5.63956]]},'afternoon':{'p':0.4,'sunAzEl':[222.35,34],'sunDir':[-0.55852,-0.61267,0.55919],'sunStrength':[19.866,18.1776,15.918],'pts':[[-0.02,[0.14996,0.21586,0.25415]],[0.004,[0.14996,0.21586,0.25415]],[0.006,[0.51492,0.64448,0.76052]],[0.045,[0.46208,0.5972,0.73046]],[0.153,[0.18447,0.40198,0.7454]],[0.26,[0.09759,0.25818,0.59062]],[0.6,[0.0382,0.12744,0.45641]]],'gain':[9.33958,6.00356,3.67375],'ground':[1.30066,1.34523,1.48169],'groundColour':[0.32,0.32,0.32],'groundEdge':-0.01,'treeShift':-0.003,'light':[[4.08644,4.22632,4.65458],[4.33949,4.48241,4.85631],[4.40099,4.60205,5.0114],[4.39646,4.66349,5.13927],[4.35099,4.68759,5.24908],[4.27541,4.68395,5.34542],[4.17515,4.65753,5.43065],[4.05321,4.6111,5.50615],[3.91284,4.54828,5.57594],[3.74838,4.4616,5.62927],[3.5655,4.35854,5.6769],[3.36092,4.23546,5.71479],[3.13168,4.0896,5.74157],[2.87232,3.91601,5.75489],[2.57203,3.70507,5.75013],[2.20569,3.43593,5.71816],[1.64781,3.03035,5.63956]]},'golden':{'p':0.49,'sunAzEl':[253,9],'sunDir':[-0.94453,-0.28877,0.15643],'sunStrength':[19.866,13.33024,8.0348],'pts':[[-0.02,[0.11725,0.10944,0.12806]],[0.004,[0.11725,0.10944,0.12806]],[0.006,[0.8845,0.48423,0.29988]],[0.045,[0.79928,0.44846,0.31702]],[0.153,[0.35019,0.32808,0.48375]],[0.26,[0.11236,0.18492,0.43896]],[0.6,[0.02829,0.0694,0.27313]]],'gain':[9.33958,6.00356,3.67375],'ground':[0.49564,0.40345,0.48721],'groundColour':[0.32,0.32,0.32],'groundEdge':-0.01,'treeShift':-0.003,'light':[[1.55777,1.26779,1.53068],[2.33664,1.59039,1.72102],[2.74632,1.79724,1.90789],[3.03166,1.95343,2.07828],[3.2408,2.07707,2.23653],[3.39403,2.17648,2.38543],[3.50171,2.25604,2.52654],[3.56922,2.31811,2.66082],[3.6,2.36477,2.7904],[3.59147,2.39283,2.90975],[3.54622,2.40548,3.02439],[3.4608,2.40065,3.13222],[3.32983,2.37596,3.23224],[3.14296,2.32704,3.32293],[2.87987,2.24557,3.40147],[2.49245,2.11345,3.46352],[1.73584,1.86557,3.52211]]},'night':{'p':0.9,'sunAzEl':[295.75,-31],'sunDir':[0.88356,-0.33664,0.32557],'sunStrength':[0.035,0.045,0.07],'pts':[[-0.02,[0.00304,0.00402,0.007]],[0.004,[0.00304,0.00402,0.007]],[0.006,[0.00605,0.00913,0.02122]],[0.045,[0.00478,0.007,0.01764]],[0.153,[0.00304,0.00439,0.01161]],[0.26,[0.00212,0.00304,0.00802]],[0.6,[0.00121,0.00182,0.00439]]],'gain':[28.01873,18.01069,11.02125],'ground':[0.01417,0.01386,0.02109],'groundColour':[0.32,0.32,0.32],'groundEdge':-0.01,'treeShift':-0.003,'light':[[0.04458,0.04361,0.06632],[0.06272,0.06043,0.09191],[0.07505,0.0718,0.10963],[0.08521,0.08119,0.12423],[0.09399,0.08932,0.13683],[0.10176,0.09653,0.14796],[0.1087,0.10298,0.15786],[0.1149,0.10876,0.16671],[0.12047,0.11397,0.17463],[0.12524,0.11844,0.18138],[0.12938,0.12235,0.1872],[0.13278,0.12558,0.19197],[0.13535,0.12806,0.19551],[0.13691,0.1296,0.19758],[0.13709,0.1299,0.19766],[0.1351,0.12821,0.19461],[0.1273,0.12108,0.18368]]}}
# RIG-B-END

# ───────────────────────────── which light: A or B ─────────────────────────────
# LIGHT B (owner, 2026-10-15: "B definitely"): more sky light. Sky x1.5, ground bounce colour 0.16 -> 0.32, sun x0.84, and a MIRROR sees
# the sky x1.6 (RIG_B['mirrorSky']); sunlit walls stay where they were, shade, undersides and sky-mirroring glass come up toward the
# photographs. A is the light before that day and stays the DEFAULT until the main lane switches every builder at once, because builds
# that are running import this file live. To build under B:  FLYOVER_RIG=B in the environment before Blender starts, or
# light_rig.use('B') BEFORE apply(), light_on(), base_colour() (the colour division must be under the same light as the render).
# Colours derived under A are wrong under B: re-derive them (flyover-blender/scripts/rederive_rig_b.py does it for a finished build).
import os as _os
RIG_A = RIG
LIGHTS = {'A': RIG_A, 'B': RIG_B}
LIGHT = 'A'
MIRROR_SKY = 1.0


def use(name):
    """Switch this module to light `name` ('A' or 'B'). Returns the name. Call it before apply() and before any colour division."""
    global RIG, LIGHT, MIRROR_SKY
    n = str(name).strip().upper()
    if n not in LIGHTS: raise ValueError('light %r: one of %s' % (name, sorted(LIGHTS)))
    RIG = LIGHTS[n]; LIGHT = n; MIRROR_SKY = float(RIG.get('mirrorSky', 1.0))
    return LIGHT


use(_os.environ.get('FLYOVER_RIG', 'A') or 'A')

SUN_DISK_RAD = 0.00925          # the sun's angular size (0.53 degrees)
GROUND_SIZE_M = 6000.0          # the ground plane made when a scene has none
GATE = 0.08                     # a place passes when its worst channel is within 8 % of the photograph
PAINT_MAX = 0.35                # under this rig a white wall comes out near 0.15 to 0.20; nothing photographed in sunlight comes out above this
# A photograph with no sun in it (weather='overcast'): the CIE overcast sky, grey, three times as bright overhead as at the level line.
# Its level is set so that a level roof gets exactly 1 unit (light / pi); an open wall then gets 0.45 with the ground's bounce.
NOSUN_ZENITH = 9.0 / 7.0
NOSUN_GROUND = 0.108            # the ground under it: the rig's own ground colour, made grey
# Surfaces whose own colour is about the same everywhere, in this rig's numbers (linear, the mean of red, green, blue). Measured on the
# buildings photographed in full sun: white wall paint 0.16 to 0.19, bare concrete 0.07. They set the exposure of a no-sun photograph.
REFERENCE = {'white_paint': 0.17, 'concrete': 0.07}


# ───────────────────────────── colours and light (no Blender needed) ─────────────────────────────
def srgb_to_linear(c):
    """sRGB 0..255 -> linear 0..1"""
    out = []
    for v in c[:3]:
        v = v / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return out


def linear_to_srgb(c):
    """linear 0..1 -> sRGB 0..255 (what the Standard view transform shows)"""
    out = []
    for v in c[:3]:
        v = max(0.0, min(1.0, v))
        out.append(round(255 * (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055), 1))
    return out


def sun_dir(azimuth_deg, elevation_deg):
    """the direction TO the sun (east, north, up) from a compass bearing and a height in degrees"""
    a, e = math.radians(azimuth_deg), math.radians(elevation_deg)
    return [math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)]


def wall_normal(facing_deg):
    """the outward normal of an upright wall that looks toward compass bearing `facing_deg`"""
    a = math.radians(facing_deg)
    return [math.sin(a), math.cos(a), 0.0]


def sky_light(normal, hour='noon'):
    """light from the whole sky and the ground's bounce on a face with this normal (irradiance; red, green, blue)"""
    L = RIG[hour]['light']
    n = math.sqrt(sum(v * v for v in normal)) or 1.0
    t = (max(-1.0, min(1.0, normal[2] / n)) + 1) / 2 * (len(L) - 1)
    i = min(len(L) - 2, int(t)); f = t - i
    return [L[i][k] + (L[i + 1][k] - L[i][k]) * f for k in range(3)]


def _nosun_table():
    """light / pi on a face under the no-sun sky, by the up part of its normal (17 steps, -1 .. 1): the sum over the sky and the ground"""
    out = []; RINGS, SEG = 90, 48
    for k in range(17):
        nz = -1 + 2 * k / 16.0; nx = math.sqrt(max(0.0, 1 - nz * nz)); e = 0.0
        for r in range(RINGS):
            th = (r + 0.5) / RINGS * math.pi; z = math.cos(th); sx = math.sin(th)
            L = NOSUN_ZENITH * (1 + 2 * z) / 3 if z >= 0 else NOSUN_GROUND
            c = sum(max(0.0, nx * sx * math.cos((q + 0.5) / SEG * 2 * math.pi) + nz * z) for q in range(SEG))
            e += L * c * sx * (math.pi / RINGS) * (2 * math.pi / SEG)
        out.append(e / math.pi)
    return out


NOSUN_LIGHT = _nosun_table()


def nosun_light(normal, sky_open=1.0):
    """light / pi on a face under the no-sun sky (one number: that sky is grey)"""
    n = math.sqrt(sum(v * v for v in normal)) or 1.0
    t = (max(-1.0, min(1.0, normal[2] / n)) + 1) / 2 * 16; i = min(15, int(t)); f = t - i
    return (NOSUN_LIGHT[i] + (NOSUN_LIGHT[i + 1] - NOSUN_LIGHT[i]) * f) * sky_open


def exposure_from(pixel, normal, surface='white_paint', value=None, sky_open=1.0):
    """For a photograph with NO SUN: the camera's exposure against this rig, from one surface whose own colour is known.
    pixel    the median of that surface in the photograph (r, g, b), sRGB 0..255
    normal   which way it faces (east, north, up); wall_normal(bearing) for a wall, (0, 0, 1) for paving
    surface  'white_paint' or 'concrete' (REFERENCE), or give `value` (its base colour in this rig's numbers) yourself and say why
    Use the result in apply(weather='overcast', exposure=k) and base_colour(..., weather='overcast', exposure=k)."""
    ref = float(value) if value is not None else REFERENCE[surface]
    p = srgb_to_linear(pixel)
    return round(sum(p) / 3 / (ref * nosun_light(normal, sky_open)), 3)


def light_on(normal, sun_to=None, in_sun=True, sky_open=1.0, hour='noon', sun_scale=1.0, weather='clear'):
    """The light a face returns per unit of its own colour, under the rig: (sky + sun) / pi, red green blue.
    weather='overcast': the no-sun sky instead (grey; `sun_to`, `in_sun` and `sun_scale` are ignored).
    normal    the face's outward normal (east, north, up); `wall_normal(bearing)` for a wall, [0, 0, 1] for a flat roof
    sun_to    the direction to the sun (`sun_dir(azimuth, elevation)`); None = the rig's own sun for that hour
    in_sun    True when the sun reaches the place, False in shadow (or a share 0..1)
    sky_open  the share of its sky the place sees (1 on an open wall, less in a recess or under a balcony)
    sun_scale how strong the sun was against the rig's sun (a property of the photograph's day, see base_colour)"""
    if weather == 'overcast':
        v = nosun_light(normal, sky_open); return [v, v, v]
    R = RIG[hour]; s = sun_to or R['sunDir']
    n = math.sqrt(sum(v * v for v in normal)) or 1.0
    cos = max(0.0, sum(a * b for a, b in zip(normal, s)) / n) * float(in_sun) * sun_scale
    sky = sky_light(normal, hour)
    return [(sky[k] * sky_open + R['sunStrength'][k] * cos) / math.pi for k in range(3)]


def base_colour(samples, sun_to=None, hour='noon', sun_scale=1.0, exposure=1.0, weather='clear'):
    """A material's OWN colour from samples of the photograph.

    samples   a list of dicts, each one place: {'material': name, 'pixel': (r, g, b) median of the photograph there, sRGB 0..255,
              'normal': (east, north, up), 'in_sun': True / False, 'sky_open': 1.0}
    sun_to    where the sun stood in the photograph (`sun_dir(azimuth, elevation)`)
    sun_scale how strong that day's sun was against the rig's: 1.0 for a clear day (the rig's sun is measured on clear-day photographs).
              None = found from the samples: the one value that makes each material's sun samples and shade samples give the same
              colour (needs one material sampled in both). It belongs to the photograph, not to the building: use the same value
              for the check render (`sun_from_photo(..., strength=sun_scale)`).
    exposure  the photograph's exposure against the rig's (1 for a photograph in full sun)
    weather   'overcast' for a photograph with no sun in it: every sample is divided by the grey no-sun light times `exposure`
              (get that from exposure_from(), with one surface whose colour is known). `in_sun`, `sun_to` and `sun_scale` are ignored.

    A material's colour is taken from its sun samples when it has any; its shade samples are then the check (`spread`).
    Returns {'sun_scale', 'materials': {name: {'linear': [r, g, b], 'srgb': [r, g, b], 'spread': worst disagreement between its samples}},
    'warnings': [...]}. The linear value is what goes into the Principled BSDF's Base Color."""
    if weather == 'overcast':
        samples = [dict(s, in_sun=False) for s in samples]; sun_scale = 1.0

    def colours(scale):
        out = {}
        for s in samples:
            L = light_on(s['normal'], sun_to, s.get('in_sun', True), s.get('sky_open', 1.0), hour, scale, weather)
            p = srgb_to_linear(s['pixel'])
            out.setdefault(s['material'], []).append(([math.log(max(p[k], 1e-4) / exposure / max(L[k], 1e-6)) for k in range(3)], bool(s.get('in_sun', True))))
        return out

    def cost(scale):
        c = 0.0; n = 0
        for rows in colours(scale).values():
            sun = [r for r, lit in rows if lit]; shade = [r for r, lit in rows if not lit]
            if sun and shade:
                for k in range(3):
                    c += (sum(r[k] for r in sun) / len(sun) - sum(r[k] for r in shade) / len(shade)) ** 2
                n += 1
        return c, n
    warnings = []
    if sun_scale is None:
        if cost(1.0)[1] == 0:
            sun_scale = 1.0; warnings.append('no material has both a sun and a shade sample: the sun strength of that day cannot be found, 1.0 used')
        else:
            best = min((cost(0.2 * 1.04 ** i)[0], 0.2 * 1.04 ** i) for i in range(120))
            sun_scale = round(best[1], 3)
    mats = {}
    for name, rows in colours(sun_scale).items():
        # the colour comes from the sun samples when there are any (a phone lifts its shadows: the sunlit pixel is the truer one);
        # the shade samples then only say how far the photograph's shade is from the rig's (`spread`)
        use = [r for r, lit in rows if lit] or [r for r, _ in rows]
        mean = [math.exp(sum(r[k] for r in use) / len(use)) for k in range(3)]
        spread = max(abs(math.exp(r[k]) / mean[k] - 1) for r, _ in rows for k in range(3))
        if max(mean) > PAINT_MAX:
            warnings.append('%s comes out at %.2f, lighter than a white wall under this rig: the photograph is exposed for shade (or the place is not where you think); a white wall should come out near 0.19' % (name, max(mean)))
        mats[name] = {'linear': [round(v, 4) for v in mean], 'srgb': linear_to_srgb(mean), 'spread': round(spread, 3), 'samples': len(rows)}
    return {'sun_scale': sun_scale, 'exposure': exposure, 'materials': mats, 'warnings': warnings}


def gate(pairs, limit=GATE, by_material=False):
    """pairs: [(place name, photograph (r, g, b), render (r, g, b))], sRGB 0..255, the same places in both pictures.
    Compared as light (linear), worst channel per place. Returns (passed, rows).

    by_material=True is the gate for a photograph with NO SUN: give a fourth item per pair, the material's name. Without a sun every place
    is lit by what stands around it (a wall is darker low in a street than high above it), which is not the material's doing. So the
    places of one material are pooled: the MEDIAN of render / photograph over them, per channel, must be within the limit. Each row also
    carries `spread`, how far single places lie from that median: report it, it is the street, not the colour."""
    rows = []
    if by_material:
        groups = {}
        for p in pairs: groups.setdefault(p[3], []).append(p)
        for mat, ps in groups.items():
            ratios = []
            for name, photo, render, _ in ps:
                a, b = srgb_to_linear(photo), srgb_to_linear(render); ratios.append([b[k] / max(a[k], 0.004) for k in range(3)])
            med = [sorted(r[k] for r in ratios)[len(ratios) // 2] if len(ratios) % 2 else sum(sorted(r[k] for r in ratios)[len(ratios) // 2 - 1:len(ratios) // 2 + 1]) / 2 for k in range(3)]
            worst = max(abs(m - 1) for m in med); spread = max(abs(r[k] / med[k] - 1) for r in ratios for k in range(3))
            rows.append({'material': mat, 'places': len(ps), 'render_over_photo': [round(m, 3) for m in med], 'worst': round(worst, 3), 'spread': round(spread, 3), 'pass': worst <= limit})
        return all(r['pass'] for r in rows), rows
    for p in pairs:
        name, photo, render = p[0], p[1], p[2]
        a, b = srgb_to_linear(photo), srgb_to_linear(render)
        worst = max(abs(b[k] - a[k]) / max(a[k], 0.02) for k in range(3))
        rows.append({'place': name, 'photo': list(photo), 'render': list(render), 'worst': round(worst, 3), 'pass': worst <= limit})
    return all(r['pass'] for r in rows), rows


# ───────────────────────────── the rig in a Blender scene ─────────────────────────────
def _signature(hour):
    R = RIG[hour]
    return 'light_rig %s %s' % (RIG.get('version', '?'), hour)


def _world(scene, hour):
    import bpy
    R = RIG[hour]
    w = bpy.data.worlds.new('light_rig_world'); w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    N = lambda t, x, y: (lambda n: (setattr(n, 'location', (x, y)), n)[1])(nt.nodes.new(t))
    link = nt.links.new
    tex = N('ShaderNodeTexCoord', -1400, 0); sep = N('ShaderNodeSeparateXYZ', -1200, 0); link(tex.outputs['Generated'], sep.inputs[0])
    pts = R['pts']; z0, z1 = pts[0][0], pts[-1][0]
    shift = N('ShaderNodeMath', -1000, 0); shift.operation = 'SUBTRACT'; link(sep.outputs['Z'], shift.inputs[0]); shift.inputs[1].default_value = R['treeShift']
    mr = N('ShaderNodeMapRange', -800, 0); link(shift.outputs[0], mr.inputs['Value'])
    mr.inputs['From Min'].default_value = z0; mr.inputs['From Max'].default_value = z1; mr.inputs['To Min'].default_value = 0; mr.inputs['To Max'].default_value = 1; mr.clamp = True
    ramp = N('ShaderNodeValToRGB', -600, 0); cr = ramp.color_ramp; cr.interpolation = 'LINEAR'; cr.color_mode = 'RGB'
    while len(cr.elements) > 1: cr.elements.remove(cr.elements[-1])
    for i, (z, c) in enumerate(pts):
        e = cr.elements[0] if i == 0 else cr.elements.new((z - z0) / (z1 - z0))
        e.position = (z - z0) / (z1 - z0); e.color = (c[0], c[1], c[2], 1)
    link(mr.outputs['Result'], ramp.inputs['Fac'])
    # the sky lights with the gain; the camera and mirrors see it without
    lp = N('ShaderNodeLightPath', -600, -300); seen = N('ShaderNodeMath', -400, -300); seen.operation = 'MAXIMUM'
    link(lp.outputs['Is Camera Ray'], seen.inputs[0]); link(lp.outputs['Is Glossy Ray'], seen.inputs[1])
    gain = N('ShaderNodeMixRGB', -200, -300); gain.blend_type = 'MIX'; link(seen.outputs[0], gain.inputs['Fac'])
    gain.inputs['Color1'].default_value = (R['gain'][0], R['gain'][1], R['gain'][2], 1); gain.inputs['Color2'].default_value = (1, 1, 1, 1)
    mul = N('ShaderNodeVectorMath', 0, 0); mul.operation = 'MULTIPLY'; link(ramp.outputs['Color'], mul.inputs[0]); link(gain.outputs['Color'], mul.inputs[1])
    if MIRROR_SKY != 1.0:
        # LIGHT B: a mirror (glossy) ray sees the sky x MIRROR_SKY; camera rays and the light are untouched (the street band below
        # opposite_deg and the ground are not lifted)
        rf = N('ShaderNodeMath', 0, -200); rf.operation = 'MULTIPLY_ADD'; link(lp.outputs['Is Glossy Ray'], rf.inputs[0])
        rf.inputs[1].default_value = MIRROR_SKY - 1.0; rf.inputs[2].default_value = 1.0
        mul0 = mul; mul = N('ShaderNodeVectorMath', 100, -100); mul.operation = 'SCALE'; link(mul0.outputs[0], mul.inputs[0]); link(rf.outputs[0], mul.inputs['Scale'])
    # below the level line a ray sees the lit ground (only matters where the scene's ground plane ends)
    low = N('ShaderNodeMath', -400, 250); low.operation = 'LESS_THAN'; link(sep.outputs['Z'], low.inputs[0]); low.inputs[1].default_value = R['groundEdge']
    mix = N('ShaderNodeMixRGB', 200, 0); mix.blend_type = 'MIX'; link(low.outputs[0], mix.inputs['Fac']); link(mul.outputs[0], mix.inputs['Color1'])
    mix.inputs['Color2'].default_value = (R['ground'][0], R['ground'][1], R['ground'][2], 1)
    bg = N('ShaderNodeBackground', 400, 0); link(mix.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
    out = N('ShaderNodeOutputWorld', 600, 0); link(bg.outputs[0], out.inputs['Surface'])
    w['light_rig'] = _signature(hour)
    scene.world = w
    return w


def _sun_object(scene):
    import bpy
    suns = [o for o in scene.objects if o.type == 'LIGHT' and o.data.type == 'SUN']
    sun = next((o for o in suns if o.get('light_rig')), suns[0] if suns else None)
    if sun is None:
        sun = bpy.data.objects.new('rig_sun', bpy.data.lights.new('rig_sun', 'SUN')); scene.collection.objects.link(sun)
    for o in scene.objects:
        if o.type == 'LIGHT' and o is not sun: o.hide_render = True
    sun.hide_render = False; sun['light_rig'] = 1
    return sun


def _aim(sun, to_sun, strength_rgb):
    from mathutils import Vector
    sun.rotation_mode = 'XYZ'; sun.rotation_euler = Vector(to_sun).to_track_quat('Z', 'Y').to_euler()
    m = max(max(strength_rgb), 1e-9)
    sun.data.energy = m; sun.data.color = [v / m for v in strength_rgb]; sun.data.angle = SUN_DISK_RAD


def _world_nosun(scene):
    """the grey no-sun sky (CIE overcast), and the lit ground below the level line where the scene's ground plane ends"""
    import bpy
    w = bpy.data.worlds.new('light_rig_world_nosun'); w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear(); link = nt.links.new
    tex = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); link(tex.outputs['Generated'], sep.inputs[0])
    up = nt.nodes.new('ShaderNodeMath'); up.operation = 'MULTIPLY_ADD'; link(sep.outputs['Z'], up.inputs[0])
    up.inputs[1].default_value = 2 * NOSUN_ZENITH / 3; up.inputs[2].default_value = NOSUN_ZENITH / 3             # zenith x (1 + 2 sin h) / 3
    low = nt.nodes.new('ShaderNodeMath'); low.operation = 'LESS_THAN'; link(sep.outputs['Z'], low.inputs[0]); low.inputs[1].default_value = 0.0
    mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MIX'; link(low.outputs[0], mix.inputs['Fac']); link(up.outputs[0], mix.inputs['Color1'])
    mix.inputs['Color2'].default_value = (NOSUN_GROUND, NOSUN_GROUND, NOSUN_GROUND, 1)
    bg = nt.nodes.new('ShaderNodeBackground'); link(mix.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
    out = nt.nodes.new('ShaderNodeOutputWorld'); link(bg.outputs[0], out.inputs['Surface'])
    w['light_rig'] = 'light_rig %s overcast' % RIG.get('version', '?')
    scene.world = w
    return w


def apply(scene=None, hour='noon', weather='clear', exposure=1.0):
    """1. Put the scene under the app's light for a named hour ('noon' unless you render a time of day): world, sun, ground, view.
    weather='overcast' is for a photograph with NO SUN in it: a grey sky, no sun at all, and the view exposed `exposure` times
    (from exposure_from()), so that your render can be laid beside that photograph."""
    import bpy
    scene = scene or bpy.context.scene; R = RIG[hour]
    overcast = weather == 'overcast'
    if overcast: _world_nosun(scene)
    else: _world(scene, hour)
    sun = _sun_object(scene); _aim(sun, R['sunDir'], R['sunStrength'])
    if overcast: sun.hide_render = True
    scene['light_rig_hour'] = hour; scene['light_rig_sun'] = list(R['sunDir']) + [1.0]
    scene['light_rig_weather'] = 'overcast' if overcast else 'clear'; scene['light_rig_exposure'] = float(exposure)
    # the ground
    grounds = [o for o in scene.objects if o.type == 'MESH' and 'ground' in o.name.lower()]
    if not grounds:
        me = bpy.data.meshes.new('rig_ground'); h = GROUND_SIZE_M / 2
        me.from_pydata([(-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new('rig_ground', me); scene.collection.objects.link(g); grounds = [g]
    mat = bpy.data.materials.get('rig_ground') or bpy.data.materials.new('rig_ground')
    mat.use_nodes = True
    p = next(n for n in mat.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    gc = (NOSUN_GROUND, NOSUN_GROUND, NOSUN_GROUND) if overcast else R['groundColour']
    p.inputs['Base Color'].default_value = (gc[0], gc[1], gc[2], 1); p.inputs['Roughness'].default_value = 1.0
    if 'Specular IOR Level' in p.inputs: p.inputs['Specular IOR Level'].default_value = 0.0
    for g in grounds:
        g.data.materials.clear(); g.data.materials.append(mat)
    # the view: what the app's screen does (plain sRGB)
    vs = scene.view_settings; vs.view_transform = 'Standard'; vs.look = 'None'; vs.exposure = math.log(max(float(exposure), 1e-6), 2); vs.gamma = 1.0
    scene.display_settings.display_device = 'sRGB'; scene.render.film_transparent = False
    return scene.world['light_rig']


def sun_from_photo(azimuth_deg, elevation_deg, strength=1.0, scene=None):
    """2. Turn the rig's sun to where it stood in the photograph. azimuth = compass bearing the light comes FROM (180 = from the south),
    elevation = degrees above level. `strength` multiplies the rig's sun (leave 1 unless `base_colour` found another value for that day)."""
    import bpy
    scene = scene or bpy.context.scene; hour = scene.get('light_rig_hour', 'noon')
    if scene.get('light_rig_weather') == 'overcast': raise ValueError('this scene is under the no-sun light: a photograph with no sun has no sun to turn')
    d = sun_dir(azimuth_deg, elevation_deg)
    _aim(_sun_object(scene), d, [v * strength for v in RIG[hour]['sunStrength']])
    scene['light_rig_sun'] = d + [float(strength)]
    return d


def check(scene=None):
    """3. Returns [] when the scene is under the rig; else what is not. Call it before every final render and write the result down."""
    import bpy
    scene = scene or bpy.context.scene; bad = []
    hour = scene.get('light_rig_hour')
    if not hour or hour not in RIG: return ['light_rig.apply() was never run on this scene']
    R = RIG[hour]
    overcast = scene.get('light_rig_weather') == 'overcast'; want = ('light_rig %s overcast' % RIG.get('version', '?')) if overcast else _signature(hour)
    if not scene.world or scene.world.get('light_rig') != want: bad.append('the world is not the rig\'s (run light_rig.apply() again)')
    lights = [o for o in scene.objects if o.type == 'LIGHT' and not o.hide_render]
    if overcast:
        if lights: bad.append('lights that render: %s (the no-sun light has none)' % [o.name for o in lights])
    elif len(lights) != 1 or lights[0].data.type != 'SUN': bad.append('lights that render: %s (the rig has one sun)' % [o.name for o in lights])
    else:
        s = scene.get('light_rig_sun'); k = s[3] if s else 1.0; L = lights[0].data; m = max(R['sunStrength'])
        if abs(L.energy - m * k) > 1e-3 * m or any(abs(L.color[i] - R['sunStrength'][i] / m) > 1e-3 for i in range(3)): bad.append('the sun\'s strength or colour was changed by hand (%.3f, %s)' % (L.energy, [round(v, 3) for v in L.color]))
    vs = scene.view_settings; ex = math.log(max(float(scene.get('light_rig_exposure', 1.0)), 1e-6), 2)
    if (vs.view_transform, vs.look, round(vs.gamma, 4)) != ('Standard', 'None', 1.0) or abs(vs.exposure - ex) > 1e-3: bad.append('view transform %s, look %s, exposure %s, gamma %s (the rig: Standard, None, %.3f, 1)' % (vs.view_transform, vs.look, vs.exposure, vs.gamma, ex))
    for m in bpy.data.materials:
        if not (m.users and m.use_nodes): continue
        if any(n.bl_idname == 'ShaderNodeTexImage' for n in m.node_tree.nodes): bad.append('material %s uses an image' % m.name)
        p = next((n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        # the app draws walls and roofs without gloss; under this sun Blender's default gloss adds up to a tenth on a white wall and doubles a dark one
        if p and 'Specular IOR Level' in p.inputs and p.inputs['Specular IOR Level'].default_value > 0.01 and p.inputs['Metallic'].default_value < 0.5 \
                and not m.name.lower().startswith('glass') and 'ground' not in m.name.lower():
            bad.append('material %s has gloss (Specular IOR Level %.2f): set it to 0, the app draws it matt' % (m.name, p.inputs['Specular IOR Level'].default_value))
    return bad
