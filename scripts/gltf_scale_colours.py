"""Scale every colour of a look file (see docs/gltf-layer.md) by one factor: base colours and the glass's mirror colours.
    python3 scripts/gltf_scale_colours.py IN.glb OUT.glb FACTOR
Used once: the tower's Blender colours were chosen under a veiled sun and a cloud-bright sky, where its white wall is 0.75. Under the
standard clear-day light every other building's white is near 0.17, so its clear-day file is the same file times 1 / 4.4. Shapes, normals,
UVs and what the glass lets through are untouched."""
import json, struct, sys
src, dst, k = sys.argv[1], sys.argv[2], float(sys.argv[3])
b = open(src, 'rb').read()
assert b[:4] == b'glTF'
n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); rest = b[20 + n:]
for m in j['materials']:
    p = m.setdefault('pbrMetallicRoughness', {}); c = p.get('baseColorFactor', [1, 1, 1, 1])
    p['baseColorFactor'] = [c[0] * k, c[1] * k, c[2] * k, c[3]]
    e = m.get('extras') or {}
    if isinstance(e.get('look_glossy'), list): e['look_glossy'] = [v * k for v in e['look_glossy']]
t = json.dumps(j, separators=(',', ':')).encode(); t += b' ' * ((4 - len(t) % 4) % 4)
out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(t) + len(rest)) + struct.pack('<I', len(t)) + b'JSON' + t + rest
open(dst, 'wb').write(out); print(dst, len(out), 'bytes,', len(j['materials']), 'materials x', k)
