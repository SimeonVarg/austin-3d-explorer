# v2 tiles, step 2: ONE Blender building -> two plain .glb files (near and far) + a stats .json. Shapes and plain colours only.
#   ~/Projects/flyover-blender/scripts/brender.sh -b <build>.blend -P scripts/v2/blender_export_v2.py -- NEAR.glb FAR.glb STATS.json
#
# What goes in: every object Blender would render (mesh, curve, text, instances), EVALUATED (modifiers, geometry nodes, instancing applied),
# in world space, with its corner normals (so flat and smooth shading stay as the builder made them). The ground plane, cameras and lights
# stay out. No UVs, no images, no textures: a material is one plain PBR colour (base colour, roughness, metallic, alpha).
# Frame: the build's own (metres, the footprint file's origin, z up in Blender) written as glTF's (x east, y up, z south).
#
# MATERIALS (glTF has no words for the builders' glass, so each kind is mapped by one rule; `extras.v2_kind` says which):
#   plain     Principled BSDF: base colour, roughness, metallic, emission. A base colour wired to a pattern node keeps the socket's own
#             value (the light rig's wall() writes the pattern's AVERAGE there). Painted per face (a colour attribute into Base Color):
#             each distinct face colour becomes its own plain material.
#   glass     the rig's standard glass (name glass*, IOR 3, a dark pane): mirror strength F0 = ((3-1)/(3+1))^2 = 0.25 with the pane's dark
#             as its diffuse part. In metal/rough PBR that is metallic GLASS_METALLIC and base = dark / (1 - metallic) (clamped), roughness
#             as built. An older glass node graph (diffuse + glossy) maps the same way with the glossy colour as the mirror colour.
#   darkpane  the toolkit's dark windows (darkpane_*): a dark, nearly mirror-free dielectric, roughness DARKPANE_ROUGH.
#   stained   coloured glass (stained_*, or any Transmission): its own colour, alpha = 1 - transmission (the only see-through glass).
# NEAR keeps every triangle. FAR (lod1) drops every PIECE (a connected island of one object, welded at 1 mm) that is small or thin at the
# distance the far file is used from (FAR_* below), and every material whose name says it is lettering, a sign or a rail; its glass is opaque.
import bpy, sys, os, json, math, re, struct
import numpy as np

# ── PARAMETERS ──────────────────────────────────────────────────────────
SKIP_NAME = re.compile(r'(^|_)ground$|^ground|^wl_ground|^camera|^cam_|^proof|^helper|^ref[_-]|^measure|^ctx_|^context_', re.I)
# the builders keep the street, neighbours and trees they framed the photograph with in a collection named so ('context_not_model')
SKIP_COLLECTION = re.compile(r'context|^ctx', re.I)
GLASS_METALLIC = 0.975        # metal/rough stand-in for IOR-3 glass (F0 0.25): F0 = 0.04 (1 - m) + base * m
GLASS_BASE = (0.18, 1.0)      # clamp of the glass base colour (so the mirror stays between F0 ~0.18 and ~1)
DARKPANE_ROUGH = 0.05
STAINED_ALPHA_MIN = 0.35
PAINT_LEVELS = 64             # painted face colours are rounded to this many steps (on a square-root scale) per channel
FAR_SMALL_M = 2.5             # FAR drops a piece whose longest side is shorter than this (panes, frames, lamps, letters)...
FAR_THIN_M = 1.2              # ...or whose middle side is shorter than this (mullions, rails, fins, posts, wires)
FAR_KEEP_MIN_AREA_M2 = 40.0   # ...unless the piece's surface is at least this (a big ribbed or perforated part keeps its mass)
FAR_DROP_MAT = re.compile(r'letter|sign|text|logo|rail|baluster|mullion|wire|cable|antenna|flag', re.I)
WELD_M = 0.001
# street, pavement and lawn the builder laid at the foot of the building: the app lays its own ground there, and two surfaces in one plane
# flicker. Triangles of these materials lying wholly below GROUND_DROP_BELOW_M are left out (a raised deck or planter stays).
GROUND_DROP_MAT = re.compile(r'street|sidewalk|pavement|road|kerb|curb|asphalt|crosswalk|lawn|grass|turf|ground|gutter|driveway', re.I)
GROUND_DROP_BELOW_M = 0.35
# the light rig's ground (a lit plane, sometimes sloped, under the model) is left out whatever its height: by object OR material name
# a builder's SITE work round the building (paving, plaza, courtyard floor) follows the lot's slope in its own frame; the app lays its own
# ground, on which such a slab floats or sinks and covers the street. An object so named whose top is lower than SITE_DROP_TOP_M is left out.
SITE_NAME = re.compile(r'^site[_-]|^plaza|paving|courtyard_(floor|ground|paving)|^lot[_-]|^sidewalk|^street', re.I)
SITE_DROP_TOP_M = 3.5
GROUND_MAT = re.compile(r'^(rig_|wl_)?ground(_|$)', re.I)

args = sys.argv[sys.argv.index('--') + 1:]
OUT_NEAR, OUT_FAR, OUT_JSON = args[0], args[1], args[2]

sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()


def principled(m):
    if not (m and m.use_nodes and m.node_tree): return None
    return next((n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)


def inp(p, k, d=None):
    s = p.inputs.get(k)
    return s.default_value if s is not None else d


def upstream_attr(sock):
    """the colour attribute name feeding a socket (directly or through a reroute/mix), or None"""
    seen = 0; stack = [sock]
    while stack and seen < 20:
        s = stack.pop(); seen += 1
        for l in s.links:
            n = l.from_node
            if n.bl_idname in ('ShaderNodeVertexColor',): return n.layer_name or ''
            if n.bl_idname == 'ShaderNodeAttribute': return n.attribute_name or ''
            stack += [i for i in n.inputs if i.is_linked]
    return None


MAT = {}
NOTES = []


def mat_props(m):
    key = m.name if m else '__none__'
    if key in MAT: return MAT[key]
    r = {'name': key, 'kind': 'plain', 'base': [0.5, 0.5, 0.5], 'rough': 0.9, 'metal': 0.0, 'alpha': 1.0, 'emis': [0, 0, 0], 'paint': None}
    if m is None: MAT[key] = r; return r
    low = m.name.lower(); p = principled(m)
    if p is None:
        nodes = m.node_tree.nodes if (m.use_nodes and m.node_tree) else []
        d = next((n for n in nodes if n.type == 'BSDF_DIFFUSE'), None); g = next((n for n in nodes if n.type == 'BSDF_GLOSSY'), None)
        e = next((n for n in nodes if n.type == 'EMISSION'), None)
        if g is not None:
            gl = list(g.inputs['Color'].default_value[:3])
            r.update(kind='glass', base=[min(max(c, GLASS_BASE[0]), GLASS_BASE[1]) for c in gl], metal=GLASS_METALLIC, rough=float(g.inputs['Roughness'].default_value))
            see = [n for n in nodes if n.type == 'BSDF_TRANSPARENT']; mix = [n for n in nodes if n.type == 'MIX_SHADER']
            if see and mix: r['alpha'] = max(STAINED_ALPHA_MIN, 1.0 - float(mix[0].inputs[0].default_value))
        elif d is not None: r['base'] = list(d.inputs['Color'].default_value[:3])
        elif e is not None:
            c = list(e.inputs['Color'].default_value[:3]); s = float(e.inputs['Strength'].default_value); r.update(base=c, emis=[min(1, x * s) for x in c])
        else: r['base'] = list(m.diffuse_color[:3]); NOTES.append('material %s: no BSDF found, viewport colour used' % m.name)
        MAT[key] = r; return r
    bc = p.inputs['Base Color']
    base = list(bc.default_value[:3])
    if bc.is_linked:
        a = upstream_attr(bc)
        if a is not None: r['paint'] = a
        elif m.get('wall_colour') is not None: base = list(m['wall_colour'])[:3]
    rough = float(inp(p, 'Roughness', 0.5)); metal = float(inp(p, 'Metallic', 0.0)); alpha = float(inp(p, 'Alpha', 1.0))
    trans = float(inp(p, 'Transmission Weight', inp(p, 'Transmission', 0.0)) or 0.0)
    es = float(inp(p, 'Emission Strength', 0.0) or 0.0); ec = inp(p, 'Emission Color', None)
    if es > 0 and ec is not None and max(ec[:3]) > 1e-4: r['emis'] = [min(1.0, c * es) for c in ec[:3]]
    if low.startswith('glass') or m.get('light_rig_glass'):
        r.update(kind='glass', metal=GLASS_METALLIC, rough=rough, base=[min(max(c / (1 - GLASS_METALLIC), GLASS_BASE[0]), GLASS_BASE[1]) for c in base])
    elif low.startswith('darkpane') or m.get('fb_dark_window'):
        r.update(kind='darkpane', base=base, rough=DARKPANE_ROUGH, metal=0.0)
    elif low.startswith('stained') or trans > 0.01:
        r.update(kind='stained', base=base, rough=rough, metal=0.0, alpha=max(STAINED_ALPHA_MIN, 1.0 - trans) * alpha)
    else:
        r.update(base=base, rough=rough, metal=metal, alpha=alpha)
    MAT[key] = r; return r


def paint_key(c):
    q = np.round(np.sqrt(np.clip(c, 0, 1)) * (PAINT_LEVELS - 1)).astype(int)
    return q


def islands(tri_v, nverts):
    """connected pieces of one mesh: label per triangle (vertices already welded)"""
    lab = np.arange(nverts)
    for _ in range(10000):
        m = lab[tri_v].min(1)
        new = lab.copy(); np.minimum.at(new, tri_v[:, 0], m); np.minimum.at(new, tri_v[:, 1], m); np.minimum.at(new, tri_v[:, 2], m)
        new = new[new]
        if np.array_equal(new, lab): break
        lab = new
    return lab[tri_v[:, 0]]


def piece_extents(P, tri_lab):
    """per piece: its three side lengths along its own main axes (longest first), and its surface"""
    u, inv = np.unique(tri_lab, return_inverse=True); K = len(u)
    pts = P.reshape(-1, 3); lab3 = np.repeat(inv, 3)
    cnt = np.bincount(lab3, minlength=K).astype(float)
    mean = np.stack([np.bincount(lab3, pts[:, i], K) for i in range(3)], 1) / cnt[:, None]
    d = pts - mean[lab3]
    cov = np.zeros((K, 3, 3))
    for i in range(3):
        for j in range(i, 3):
            v = np.bincount(lab3, d[:, i] * d[:, j], K) / cnt; cov[:, i, j] = v; cov[:, j, i] = v
    _, vec = np.linalg.eigh(cov + np.eye(3) * 1e-12)
    pr = np.einsum('nk,nkj->nj', d, vec[lab3])
    lo = np.full((K, 3), np.inf); hi = np.full((K, 3), -np.inf)
    for i in range(3): np.minimum.at(lo[:, i], lab3, pr[:, i]); np.maximum.at(hi[:, i], lab3, pr[:, i])
    ext = np.sort(hi - lo, 1)[:, ::-1]
    area = np.bincount(inv, 0.5 * np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1), K)
    return ext[inv], area[inv]


# ── gather ───────────────────────────────────────────────────────────────
groups = {}                      # material key -> lists of (P (n,3,3) blender world, N (n,3,3), keep_far (n,))
skipped = []; objs = []; dropped_ground = [0]
for inst in dg.object_instances:
    ob = inst.object
    if ob.type not in ('MESH', 'CURVE', 'FONT', 'SURFACE', 'META'): continue
    src = inst.parent.original if inst.is_instance and inst.parent else ob.original
    nm = ob.original.name
    if src.hide_render or (not inst.is_instance and ob.original.hide_render) or SKIP_NAME.search(nm) or SKIP_NAME.search(src.name) \
            or any(SKIP_COLLECTION.search(c.name) for c in list(src.users_collection) + list(ob.original.users_collection)):
        skipped.append(nm); continue
    try: me = ob.to_mesh()
    except Exception: continue
    if me is None or not len(me.polygons): ob.to_mesh_clear(); continue
    me.calc_loop_triangles()
    nt = len(me.loop_triangles); nv = len(me.vertices); nl = len(me.loops)
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)
    lv = np.empty(nl, np.int32); me.loops.foreach_get('vertex_index', lv)
    tl = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    tm = np.empty(nt, np.int32); me.loop_triangles.foreach_get('material_index', tm)
    tp = np.empty(nt, np.int32); me.loop_triangles.foreach_get('polygon_index', tp)
    cn = np.empty(nl * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3).astype(np.float64)
    M = np.array(inst.matrix_world, dtype=np.float64)
    W = co @ M[:3, :3].T + M[:3, 3]
    if SITE_NAME.search(nm) and W[:, 2].max() < SITE_DROP_TOP_M:
        skipped.append('site:' + nm); ob.to_mesh_clear(); continue
    Ninv = np.linalg.inv(M[:3, :3]).T
    Nw = cn @ Ninv.T; Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-12)
    if np.linalg.det(M[:3, :3]) < 0: tl = tl[:, ::-1]
    tv = lv[tl]                                  # triangle -> vertex ids
    P = W[tv]; N = Nw[tl]
    # pieces for FAR: weld by position, label connected islands
    q = np.round(W / WELD_M).astype(np.int64)
    _, wid = np.unique(q, axis=0, return_inverse=True); wid = wid.reshape(-1)
    tri_lab = islands(wid[tv], wid.max() + 1)
    ext, area = piece_extents(P, tri_lab)
    keep = ((ext[:, 0] >= FAR_SMALL_M) & (ext[:, 1] >= FAR_THIN_M)) | (area >= FAR_KEEP_MIN_AREA_M2)
    slots = [s.material for s in ob.material_slots] or [None]
    # painted colours (one colour per face corner, averaged per triangle)
    for mi in np.unique(tm):
        mat = slots[mi] if mi < len(slots) else None
        mp = mat_props(mat); sel = tm == mi
        if GROUND_MAT.search(mp['name']):
            dropped_ground[0] += int(sel.sum()); continue
        if GROUND_DROP_MAT.search(mp['name']):
            low_ = P[:, :, 2].max(1) < GROUND_DROP_BELOW_M
            dropped_ground[0] += int((sel & low_).sum()); sel = sel & ~low_
            if not sel.any(): continue
        if mp['paint'] is not None:
            ca = me.color_attributes.get(mp['paint']) if mp['paint'] else me.color_attributes.active_color
            if ca is None and len(me.color_attributes): ca = me.color_attributes[0]
            if ca is None: NOTES.append('material %s: painted but no colour attribute on %s' % (mp['name'], nm)); groups.setdefault(mp['name'], []).append((P[sel], N[sel], keep[sel])); continue
            buf = np.empty(len(ca.data) * 4, np.float32); ca.data.foreach_get('color', buf); buf = buf.reshape(-1, 4)[:, :3].astype(np.float64)
            per_corner = buf[tl] if ca.domain == 'CORNER' else buf[tv]
            tc = per_corner.mean(1)[sel]; k = paint_key(tc)
            kk = k[:, 0] * PAINT_LEVELS * PAINT_LEVELS + k[:, 1] * PAINT_LEVELS + k[:, 2]
            for val in np.unique(kk):
                s2 = kk == val; c = (np.array([val // (PAINT_LEVELS ** 2), (val // PAINT_LEVELS) % PAINT_LEVELS, val % PAINT_LEVELS]) / (PAINT_LEVELS - 1)) ** 2
                c = c * np.array(mp['base'])          # base colour socket is white (or a tint) when the paint drives it
                name = '%s~%d' % (mp['name'], val)
                MAT[name] = dict(mp, name=name, base=[float(x) for x in c], paint=None)
                groups.setdefault(name, []).append((P[sel][s2], N[sel][s2], keep[sel][s2]))
        else:
            groups.setdefault(mp['name'], []).append((P[sel], N[sel], keep[sel]))
    lo_, hi_ = W.min(0), W.max(0)
    objs.append((nm, nt, round(float((hi_[0] - lo_[0]) * (hi_[1] - lo_[1]))), [round(float(v), 1) for v in (lo_[0], lo_[1], hi_[0], hi_[1], hi_[2])]))
    ob.to_mesh_clear()


# ── write ───────────────────────────────────────────────────────────────
def to_gltf(a):                       # blender (x, y, z) z-up -> glTF (x, z, -y)
    return np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)


def gl_material(mp, far):
    kind = mp['kind']; alpha = 1.0 if far else float(mp['alpha'])
    m = {'name': mp['name'] + ('' if not far or kind == 'plain' else '_far'),
         'pbrMetallicRoughness': {'baseColorFactor': [round(float(c), 5) for c in mp['base']] + [round(alpha, 4)],
                                  'metallicFactor': round(float(mp['metal']), 4), 'roughnessFactor': round(float(min(max(mp['rough'], 0.0), 1.0)), 4)},
         'extras': {'v2_kind': kind}}
    if max(mp['emis']) > 0: m['emissiveFactor'] = [round(float(c), 5) for c in mp['emis']]
    if alpha < 0.999: m['alphaMode'] = 'BLEND'
    return m


def write_glb(path, far):
    js = {'asset': {'version': '2.0', 'generator': 'flyover scripts/v2/blender_export_v2.py'}, 'scenes': [{'nodes': [0]}], 'scene': 0,
          'nodes': [{'mesh': 0, 'name': 'building'}], 'meshes': [{'primitives': [], 'name': 'building'}], 'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
    blob = bytearray(); tris = 0; lo = np.full(3, np.inf); hi = np.full(3, -np.inf)

    def add(arr, target, comp, typ, mm=False):
        nonlocal blob
        b = arr.tobytes(); off = len(blob); blob += b; blob += b'\0' * ((4 - len(blob) % 4) % 4)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b), 'target': target})
        acc = {'bufferView': len(js['bufferViews']) - 1, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
        if mm: acc['min'] = [float(v) for v in arr.min(0)]; acc['max'] = [float(v) for v in arr.max(0)]
        js['accessors'].append(acc); return len(js['accessors']) - 1
    for name in sorted(groups):
        parts = groups[name]; mp = MAT[name]
        if far and (FAR_DROP_MAT.search(name)): continue
        P = np.concatenate([p[0] for p in parts]); N = np.concatenate([p[1] for p in parts])
        if far:
            k = np.concatenate([p[2] for p in parts]); P = P[k]; N = N[k]
        if not len(P): continue
        P = to_gltf(P).reshape(-1, 3); N = to_gltf(N).reshape(-1, 3)
        key = np.concatenate([np.round(P / 1e-4), np.round(N * 1000)], 1).astype(np.int64)
        _, first, idx = np.unique(key, axis=0, return_index=True, return_inverse=True)
        V = P[first].astype(np.float32); VN = N[first].astype(np.float32); I = idx.reshape(-1).astype(np.uint32)
        lo = np.minimum(lo, V.min(0)); hi = np.maximum(hi, V.max(0)); tris += len(I) // 3
        js['materials'].append(gl_material(mp, far))
        a_p = add(V, 34962, 5126, 'VEC3', True); a_n = add(VN, 34962, 5126, 'VEC3'); a_i = add(I, 34963, 5125, 'SCALAR')
        js['meshes'][0]['primitives'].append({'attributes': {'POSITION': a_p, 'NORMAL': a_n}, 'indices': a_i, 'material': len(js['materials']) - 1})
    js['buffers'].append({'byteLength': len(blob)})
    t = json.dumps(js, separators=(',', ':')).encode(); t += b' ' * ((4 - len(t) % 4) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(t) + 8 + len(blob)) + struct.pack('<I', len(t)) + b'JSON' + t + struct.pack('<I', len(blob)) + b'BIN\0' + bytes(blob)
    tmp = path + '.tmp'; open(tmp, 'wb').write(out); os.replace(tmp, path)
    return {'triangles': int(tris), 'bytes': len(out), 'min': [round(float(v), 3) for v in lo], 'max': [round(float(v), 3) for v in hi], 'primitives': len(js['meshes'][0]['primitives'])}


near = write_glb(OUT_NEAR, False); far = write_glb(OUT_FAR, True)
kinds = {}
for n in groups:
    kinds[MAT[n]['kind']] = kinds.get(MAT[n]['kind'], 0) + 1
stats = {'near': near, 'far': far, 'materials': len(groups), 'kinds': kinds, 'objects': len(objs),
         'biggest_objects': [o[:2] for o in sorted(objs, key=lambda o: -o[1])[:12]],
         'widest_objects': [[o[0], o[2], o[3]] for o in sorted(objs, key=lambda o: -o[2])[:10]],   # name, plan bbox m2, [x0 y0 x1 y1 top]
         'skipped_objects': sorted(set(skipped))[:40], 'notes': NOTES, 'ground_triangles_dropped': dropped_ground[0],
         'blender': bpy.app.version_string, 'unit_scale': sc.unit_settings.scale_length, 'unit_system': sc.unit_settings.system}
json.dump(stats, open(OUT_JSON, 'w'), indent=1)
print('V2EXPORT', json.dumps({'near': near['triangles'], 'far': far['triangles'], 'bytes': near['bytes'], 'materials': len(groups), 'kinds': kinds}))
