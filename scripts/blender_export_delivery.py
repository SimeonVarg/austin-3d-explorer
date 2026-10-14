# Delivery .glb for js/gltf-layer.js: a Blender scene as plain coloured meshes, metres, building-local origin, no images.
#   /Applications/Blender.app/Contents/MacOS/Blender -b <scene>.blend -P scripts/blender_export_delivery.py -- OUT.glb ORIGIN_X
# The scene's frame (Z up): X along the street face, Y into the building, Z = 0 at the ground. ORIGIN_X is the X that becomes 0
# (the middle of the slab's lettering for the Waterloo tower, so the table row's lng/lat can name that point).
# Every mesh object becomes ONE mesh named after its material; vertices closer than 0.1 mm are welded; quads become triangles;
# no normals, no UVs, no vertex colours, no cameras, no lights. The material's Base Color becomes the glTF baseColorFactor.
# A material built from a node graph (glass: diffuse + glossy) has no Base Color, so its stand-in comes from GLASS below.
import bpy, sys, os, bmesh

# ── PARAMETERS (linear RGB) ──────────────────────────────────────────────
GLASS = {'glass': (0.03, 0.045, 0.04), 'glass_b': (0.055, 0.088, 0.095), 'glass_rail': (0.03, 0.045, 0.04),
         'glass_rail_c': (0.03, 0.045, 0.04), 'glass_south': (0.04, 0.07, 0.08)}
SKIP_OBJECTS = ('wl_ground',)          # a ground plane under the model is not part of the building
WELD_M = 1e-4

a = sys.argv[sys.argv.index('--') + 1:]
out, ox = a[0], float(a[1])
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH' or o.name in SKIP_OBJECTS: bpy.data.objects.remove(o, do_unlink=True)
keep = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in keep:
    mname = o.data.materials[0].name
    base = GLASS.get(mname)
    if base is None: base = tuple(o.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3])
    old = o.data.materials[0]; o.data.materials.clear(); bpy.data.materials.remove(old)
    m = bpy.data.materials.new(mname); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*base, 1.0); p.inputs['Roughness'].default_value = 1.0; p.inputs['Metallic'].default_value = 0.0
    o.data.materials.append(m)
    me = o.data
    for v in me.vertices: v.co.x -= ox
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD_M)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    me.name = 'm_' + mname; o.name = 'n_' + mname
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.select_set(True)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
kw = dict(filepath=out, export_format='GLB', use_selection=True)
for k, v in (('export_apply', True), ('export_yup', True), ('export_normals', False), ('export_texcoords', False), ('export_vertex_color', 'NONE'),
             ('export_cameras', False), ('export_lights', False), ('export_image_format', 'NONE'), ('export_materials', 'EXPORT'),
             ('export_extras', False), ('export_attributes', False), ('export_tangents', False), ('export_animations', False), ('export_skins', False),
             ('export_morph', False), ('use_active_scene', True), ('export_draco_mesh_compression_enable', False)):
    if k in props: kw[k] = v
bpy.ops.export_scene.gltf(**kw)
print('EXPORTED', os.path.getsize(out), 'bytes,', len(keep), 'meshes ->', out)
