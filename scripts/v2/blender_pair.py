# v2 pair sheets, the Blender half: render a build's .blend from the poses in scripts/v2/pair_views.json.
#   ~/Projects/flyover-blender/scripts/brender.sh -b BUILD.blend -P scripts/v2/blender_pair.py -- SLUG OUT_DIR [SAMPLES] [W] [H]
# The scene's own light rig and materials are used as built; only a camera is added (vertical field of view = the app's 40 degrees).
import bpy, sys, os, json, math, mathutils

slug, out_dir = sys.argv[sys.argv.index('--') + 1: sys.argv.index('--') + 3]
rest = sys.argv[sys.argv.index('--') + 3:]
samples = int(rest[0]) if rest else 32; W = int(rest[1]) if len(rest) > 1 else 1920; H = int(rest[2]) if len(rest) > 2 else 1200
views = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pair_views.json')))
fov = views.get('fov_deg', 40)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.render.resolution_x = W; sc.render.resolution_y = H; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
# objects the app draws itself (neighbours, scripts/v2/export_skip.json) are left out of the render too, as they are of the tile
import re
_skip = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'export_skip.json'))).get(slug)
if _skip:
    for ob in bpy.data.objects:
        if re.search(_skip, ob.name): ob.hide_render = True
cam_data = bpy.data.cameras.new('pair_cam'); cam = bpy.data.objects.new('pair_cam', cam_data); sc.collection.objects.link(cam)
cam_data.sensor_fit = 'VERTICAL'; cam_data.angle_y = math.radians(fov); cam_data.clip_start = 0.3; cam_data.clip_end = 6000
sc.camera = cam
os.makedirs(out_dir, exist_ok=True)
for v in views[slug]:
    pos = mathutils.Vector(v['pos']); tgt = mathutils.Vector(v['target'])
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out_dir, v['name'] + '.blender.png')
    bpy.ops.render.render(write_still=True)
    print('PAIRRENDER', v['name'])
