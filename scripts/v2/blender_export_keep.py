# v2 tiles: run blender_export_v2.py with named objects KEPT that its ground rules would leave out (a street storey called street_storey_*,
# a podium called plaza_*, a terrace called site_*: real building parts that only share a word with the lot). One build at a time, from
# scripts/v2/export_keep.json; the exporter itself and every other build's export stay exactly as they were.
#   brender.sh -b BUILD.blend -P scripts/v2/blender_export_keep.py -- KEEP_JSON SKIP_REGEX NEAR.glb FAR.glb STATS.json
# KEEP_JSON is the build's entry: a list of object-name regexes, or {"objects": [...], "materials": {"old": "new"}}. SKIP_REGEX is the build's
# export_skip.json entry, or '' (the objects it names are hidden from the render, as blender_export_skip.py does).
#
# What "kept" means, for an object whose name (or its instancer's name) matches:
#   - it is renamed so that no name rule of the exporter matches it (a 'kept__' prefix; the words 'paving' and a trailing 'ground' are
#     shortened, because those two rules match anywhere in a name), so the name rule and the site rule (top < 3.5 m) pass it;
#   - a material on it that the exporter drops WHOLE (rig_ground, ground, ground_*: the light rig's ground name) is replaced, on this object
#     only, by the material the entry maps it to ("materials"), else by a copy of itself under a name without the ground word (same colour);
#   - the exporter's low-triangle rule still applies to it (street/lawn/... materials: triangles lying wholly below 0.35 m are left out).
#     Those lie in the app's own ground plane and would flicker there; a wall or step that rises above it keeps all its faces.
import bpy, sys, os, re, json, runpy
GROUND_MAT = re.compile(r'^(rig_|wl_)?ground(_|$)', re.I)      # the exporter's whole-material ground rule (blender_export_v2.py)
i = sys.argv.index('--'); a = sys.argv[i + 1:]
spec = json.loads(a[0]); skip = a[1]
if isinstance(spec, list): spec = {'objects': spec}
rx = re.compile('|'.join('(?:%s)' % p for p in spec['objects']))
mat_map = spec.get('materials', {})


def safe(name):
    return 'kept__' + re.sub(r'ground$', 'grnd', re.sub(r'paving', 'pavng', name, flags=re.I), flags=re.I)


def safe_mat(m):
    to = mat_map.get(m.name)
    if to is not None:
        if to not in bpy.data.materials: raise SystemExit('EXPORTKEEP: material %s (for %s) is not in this build' % (to, m.name))
        return bpy.data.materials[to]
    nm = re.sub(r'^(rig_|wl_)?ground_?', '', m.name, flags=re.I) or 'surface'
    nm = 'kept_' + nm
    if nm not in bpy.data.materials:
        c = m.copy(); c.name = nm
    return bpy.data.materials[nm]


kept = []; remat = []
for ob in list(bpy.data.objects):
    if not rx.search(ob.name): continue
    old = ob.name; ob.name = safe(old); kept.append(old)
    for s in ob.material_slots:
        if s.material is not None and GROUND_MAT.search(s.material.name):
            new = safe_mat(s.material); remat.append('%s:%s->%s' % (old, s.material.name, new.name))
            s.link = 'OBJECT'; s.material = new
hidden = 0
if skip:
    sx = re.compile(skip)
    for ob in bpy.data.objects:
        if sx.search(ob.name): ob.hide_render = True; hidden += 1
print('EXPORTKEEP kept %d objects: %s' % (len(kept), ', '.join(sorted(kept))[:2000]))
print('EXPORTKEEP materials: %s' % (', '.join(remat) or 'none'), '| skip hid', hidden)
sys.argv = sys.argv[:i + 1] + a[2:]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'blender_export_v2.py'), run_name='__main__')
