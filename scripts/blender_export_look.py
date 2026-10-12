# A Blender scene as glTF WITH its materials, for proto/blender-look.html (the standalone test page of the new renderer).
#   ~/Projects/flyover-blender/scripts/brender.sh -b <scene>.blend -P scripts/blender_export_look.py -- OUT.glb [SKY.png]
# With SKY.png it also bakes a sky-light map (see the parameters) and gives every face its place in it (the file's first UV set).
# What goes in: every mesh object with its material and flat face normals, metres, Z up in Blender (the file is Y up, as glTF is).
# A plain material (one Principled BSDF) is exported as it is: base colour, roughness, metal, and "no mirror part" where the scene says so.
# A glass material here is a node graph (a dark diffuse part plus a mirror part of a set colour, sometimes mixed with a see-through
# part), which glTF has no words for. It is exported as a plain dark material that carries the graph's own numbers as `extras`:
#   look_kind "glass", look_glossy [r, g, b] (the mirror part's colour, linear), look_rough, look_transparent (0..1: the share of
#   see-through), look_transmit [r, g, b] (the colour what is behind is seen through)
# The page builds its glass from those. What stays out: the ground plane, cameras, lights, images, anything that names a file or folder.
import bpy, sys, os, json, struct, math, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# ── PARAMETERS ──────────────────────────────────────────────────────────
SKIP_OBJECTS = ('wl_ground',)          # the page lays its own ground (any object whose name ends in `ground` is left out too)
# Sky-light map ("ambient occlusion"): how much of the sky each part of each face sees, found by casting rays in this scene. Every face
# gets its own small patch of one image; the page multiplies the SKY light by it (not the sun: the page's own shadow map does the sun).
AO_TEXEL_M = 1.0       # one sample of the map, metres along a face
AO_RAYS = 64           # rays a sample, spread by the cosine of their angle to the face
AO_REACH_M = 80.0      # a ray that travels this far without a hit has left the building
AO_OFF_M = 0.06        # rays start this far in front of the face (clear of the thin quads that lie on a wall)
AO_GROUND = 0.13       # what a ray below the level line brings, against 1 for the sky (the lit ground against the sky in this scene)
AO_BOUNCE = 0.5        # a ray that hits the building brings back this times the colour of what it hit (a white wall hands light on, a dark one does not)
AO_WIDTH = 1024        # width of the image, pixels (its height is what the patches need, a power of two)
AO_SEED = 7

args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]; ao_out = args[1] if len(args) > 1 else None
for o in list(bpy.context.scene.objects):
    if o.type not in ('MESH', 'FONT', 'CURVE') or o.name in SKIP_OBJECTS or o.name.endswith('ground'): bpy.data.objects.remove(o, do_unlink=True)
# lettering made as a text object becomes a mesh; every object's place, turn and size go into its points (the page reads plain meshes)
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH':
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target='MESH')
for o in bpy.context.scene.objects:
    if o.data.users > 1: o.data = o.data.copy()
    o.data.transform(o.matrix_world); o.matrix_world.identity()
# One mesh per material, whatever the scene has (a builder may make every window pane its own object, or give one object several
# materials): everything is joined, then cut apart by material.
allm = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons) and o.data.materials]
if any(len([m for m in o.data.materials if m]) != 1 for o in allm) or len(allm) != len({o.data.materials[0].name for o in allm}):
    for o in list(bpy.context.scene.objects):
        if o not in allm: bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in allm: o.select_set(True)
    bpy.context.view_layer.objects.active = allm[0]; bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or not len(o.data.polygons): continue
        used = o.data.materials[o.data.polygons[0].material_index]
        if len(o.data.materials) != 1:
            for p_ in o.data.polygons: p_.material_index = 0
            o.data.materials.clear(); o.data.materials.append(used)
keep = [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons) and o.data.materials]
painted = False
for o in keep:
    m = o.data.materials[0]; nt = m.node_tree; name = m.name
    # a material whose base colour is painted per face (a colour attribute wired into Base Color): the colours go into the file as vertex colours
    pb0 = nt.nodes.get('Principled BSDF')
    if pb0 is not None and pb0.inputs['Base Color'].is_linked and o.data.color_attributes:
        pb0.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0); o.data.color_attributes.render_color_index = 0; o.data.color_attributes.active_color_index = 0
        m['look_painted'] = 1; painted = True
    if nt.nodes.get('Principled BSDF') is None:
        d = next(n for n in nt.nodes if n.type == 'BSDF_DIFFUSE'); g = next(n for n in nt.nodes if n.type == 'BSDF_GLOSSY')
        diffuse = list(d.inputs['Color'].default_value[:3]); glossy = [float(v) for v in g.inputs['Color'].default_value[:3]]
        rough = float(g.inputs['Roughness'].default_value)
        mix = [n for n in nt.nodes if n.type == 'MIX_SHADER']; see = [n for n in nt.nodes if n.type == 'BSDF_TRANSPARENT']
        transparent = float(mix[0].inputs[0].default_value) if mix and see else 0.0
        transmit = [float(v) for v in see[0].inputs['Color'].default_value[:3]] if mix and see else [1.0, 1.0, 1.0]
        o.data.materials.clear(); bpy.data.materials.remove(m)
        m = bpy.data.materials.new(name); m.use_nodes = True
        p = m.node_tree.nodes['Principled BSDF']
        p.inputs['Base Color'].default_value = (*diffuse, 1.0); p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = 0.0
        m['look_kind'] = 'glass'; m['look_glossy'] = glossy; m['look_rough'] = rough; m['look_transparent'] = transparent; m['look_transmit'] = transmit
        o.data.materials.append(m)
    else:
        p = nt.nodes['Principled BSDF']; spec = p.inputs['Specular IOR Level'].default_value if 'Specular IOR Level' in p.inputs else 0.5
        m['look_kind'] = 'plain'; m['look_specular'] = float(spec)
    o.data.name = 'm_' + name; o.name = 'n_' + name

def bake_sky_light():
    """per face a patch of samples in one image; per face corner its place in that image (a UV map named 'sky')"""
    random.seed(AO_SEED)
    verts, tris, tri_alb = [], [], []
    for o in keep:
        me = o.data; base = len(verts); verts.extend(v.co.copy() for v in me.vertices)
        col = o.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value; alb = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]
        if o.data.materials[0].get('look_kind') == 'glass': alb = 0.1
        for p in me.polygons:
            v = [base + i for i in p.vertices]
            for k in range(1, len(v) - 1): tris.append((v[0], v[k], v[k + 1])); tri_alb.append(alb)
    bvh = BVHTree.FromPolygons(verts, tris, all_triangles=True)
    dirs = []
    for i in range(AO_RAYS):
        r1, r2 = (i + random.random()) / AO_RAYS, random.random(); r = math.sqrt(r1); th = 2 * math.pi * r2
        dirs.append((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - r1))))
    patches = []                                   # (object, polygon index, nu, nv, origin, edge u, edge v, normal)
    for o in keep:
        for p in o.data.polygons:
            c = [o.data.vertices[i].co for i in p.vertices]
            if len(c) != 4: eu, ev, nu, nv, org = c[1] - c[0], c[-1] - c[0], 1, 1, sum(c, Vector()) / len(c)
            else:
                eu, ev, org = c[1] - c[0], c[3] - c[0], c[0]
                nu = max(1, round(eu.length / AO_TEXEL_M)) + 1; nv = max(1, round(ev.length / AO_TEXEL_M)) + 1
                if eu.length < 0.3: nu = 1
                if ev.length < 0.3: nv = 1
            patches.append((o, p.index, nu, nv, org, eu, ev, p.normal.copy(), len(c) == 4))
    # shelves: tallest patches first
    order = sorted(range(len(patches)), key=lambda i: -patches[i][3]); place = {}; x = y = shelf = 0
    for i in order:
        nu, nv = patches[i][2], patches[i][3]
        if nu > AO_WIDTH: raise RuntimeError('a face is wider than the image')
        if x + nu > AO_WIDTH: x = 0; y += shelf; shelf = 0
        place[i] = (x, y); x += nu; shelf = max(shelf, nv)
    H = 1
    while H < y + shelf: H *= 2
    px = [1.0] * (AO_WIDTH * H); lo = 1.0
    for i, (o, pi, nu, nv, org, eu, ev, n, quad) in enumerate(patches):
        x0, y0 = place[i]
        t = eu.normalized() if eu.length > 1e-9 else Vector((1, 0, 0)); b = n.cross(t)
        wd = [(t * d[0] + b * d[1] + n * d[2]).normalized() for d in dirs]
        open_sum = sum(1.0 if d.z >= 0 else AO_GROUND for d in wd)
        for j in range(nv):
            for k in range(nu):
                fu = 0.5 if nu == 1 else k / (nu - 1); fv = 0.5 if nv == 1 else j / (nv - 1)
                # samples at the very edge of a face are pulled a little inward, so a neighbour face at the edge does not swallow them
                fu = min(max(fu, 0.02), 0.98); fv = min(max(fv, 0.02), 0.98)
                pt = (org + eu * fu + ev * fv if quad else org) + n * AO_OFF_M
                got = 0.0
                for d in wd:
                    hit = bvh.ray_cast(pt, d, AO_REACH_M)
                    got += (1.0 if d.z >= 0 else AO_GROUND) if hit[0] is None else AO_BOUNCE * tri_alb[hit[2]]
                v = max(0.0, min(1.0, got / open_sum)); lo = min(lo, v)
                px[(y0 + j) * AO_WIDTH + x0 + k] = v
        me = o.data; uv = me.uv_layers.get('sky') or me.uv_layers.new(name='sky')     # (a mesh made from text keeps its own UV set first: the page reads the last set)
        poly = me.polygons[pi]
        for li, vi in zip(poly.loop_indices, range(len(poly.vertices))):
            cu, cv = ((0, 0), (1, 0), (1, 1), (0, 1))[vi] if quad else (0.5, 0.5)
            uu = x0 + 0.5 + (cu * (nu - 1) if nu > 1 else 0); vv = y0 + 0.5 + (cv * (nv - 1) if nv > 1 else 0)
            uv.data[li].uv = (uu / AO_WIDTH, vv / H)
    img = bpy.data.images.new('sky_light', AO_WIDTH, H, alpha=False); img.colorspace_settings.name = 'Non-Color'
    flat = []
    for v in px: flat.extend((v, v, v, 1.0))
    img.pixels = flat; img.filepath_raw = ao_out; img.file_format = 'PNG'; img.save()
    print('SKY LIGHT', len(patches), 'faces,', sum(p[2] * p[3] for p in patches), 'samples, image', AO_WIDTH, 'x', H, 'darkest %.2f ->' % lo, ao_out)

if ao_out: bake_sky_light()
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.select_set(True)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
kw = dict(filepath=out, export_format='GLB', use_selection=True)
for k, v in (('export_apply', True), ('export_yup', True), ('export_normals', True), ('export_texcoords', bool(ao_out)), ('export_vertex_color', 'ACTIVE' if painted else 'NONE'),
             ('export_active_vertex_color_when_no_material', True), ('export_all_vertex_colors', False),
             ('export_cameras', False), ('export_lights', False), ('export_image_format', 'NONE'), ('export_materials', 'EXPORT'),
             ('export_extras', True), ('export_attributes', False), ('export_tangents', False), ('export_animations', False), ('export_skins', False),
             ('export_morph', False), ('use_active_scene', True), ('export_draco_mesh_compression_enable', False)):
    if k in props: kw[k] = v
bpy.ops.export_scene.gltf(**kw)
print('EXPORTED', os.path.getsize(out), 'bytes,', len(keep), 'meshes ->', out)
