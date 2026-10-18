# v2 tiles: run blender_export_v2.py with the objects named by a regex left out.
#   brender.sh -b BUILD.blend -P scripts/v2/blender_export_skip.py -- REGEX NEAR.glb FAR.glb STATS.json
# The objects are hidden from the render (the exporter skips those), then the exporter runs unchanged.
import bpy, sys, os, re, runpy
i = sys.argv.index('--'); a = sys.argv[i + 1:]
rx = re.compile(a[0]); hidden = 0
for ob in bpy.data.objects:
    if rx.search(ob.name): ob.hide_render = True; hidden += 1
print('EXPORTSKIP hid', hidden, 'objects for', a[0])
sys.argv = sys.argv[:i + 1] + a[1:]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'blender_export_v2.py'), run_name='__main__')
