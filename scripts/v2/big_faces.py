# Every flat face of a Blender build larger than MIN m2, for photo-audit check 9n (no big blank face the photographs do not show).
#   ~/Projects/flyover-blender/scripts/brender.sh -b <build>.blend -P scripts/v2/big_faces.py -- OUT.json [MIN_M2=50]
# One row per polygon (rendered mesh objects, evaluated; the builder's site_* ground left out), biggest first: object, material, area,
# centre, height range, normal. If the build's params.json (next to the .blend) has a stadium-style 'frame' (theta_deg, centre_xy), the
# centre and normal are also given in that frame (u across, v along), as the build script uses them. Then: a wall-like row (|normal z| < 0.5)
# needs a photograph that shows a plain wall there; every other one is a closing face to rebuild as what the photographs show.
import bpy, json, math, os, sys
argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]; MIN = float(argv[1]) if len(argv) > 1 else 50.0
FR = None
pp = bpy.path.abspath('//params.json')
if os.path.exists(pp):
    FR = json.load(open(pp)).get('frame')
if FR and 'theta_deg' in FR:
    TH = math.radians(FR['theta_deg']); CT, ST = math.cos(TH), math.sin(TH); CX, CY = FR['centre_xy']
    def uv(x, y): return ((x - CX)*CT - (y - CY)*ST, (x - CX)*ST + (y - CY)*CT)
else:
    def uv(x, y): return (x, y)
dg = bpy.context.evaluated_depsgraph_get(); rows = []
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH' or ob.hide_render or ob.name.startswith('site_'): continue
    e = ob.evaluated_get(dg); me = e.to_mesh(); mw = ob.matrix_world
    for p in me.polygons:
        if p.area < MIN: continue
        c = mw @ p.center; n = (mw.to_3x3() @ p.normal).normalized(); zs = [(mw @ me.vertices[i].co).z for i in p.vertices]
        u, v = uv(c.x, c.y); o = uv(0.0, 0.0); q = uv(n.x, n.y); nu, nv = q[0] - o[0], q[1] - o[1]     # the normal turned into the frame
        mat = me.materials[p.material_index].name if me.materials else ''
        rows.append(dict(obj=ob.name, mat=mat, area=round(p.area, 1), u=round(u, 1), v=round(v, 1), z=round(c.z, 1), zmin=round(min(zs), 1),
                         zmax=round(max(zs), 1), n=[round(nu, 2), round(nv, 2), round(n.z, 2)], wall=abs(n.z) < 0.5))
    e.to_mesh_clear()
rows.sort(key=lambda r: -r['area'])
json.dump(rows, open(OUT, 'w'), indent=0)
print('BIGFACES', len(rows), 'wall-like', sum(r['wall'] for r in rows))
