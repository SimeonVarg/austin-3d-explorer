#!/usr/bin/env python3
"""far_coat_all.py [--only id,id] [--jobs 3]: the far copy of every tile -> v2/tiles/<id>.coat.glb and v2/tiles/coats.json (read by v2/tiles.js FAR).
Run it after every tile build. Each entry records the size of the tile it was made from (tile_bytes); the app does not draw a far copy
whose tile has changed since (it draws the full model there), so a forgotten run costs speed, never a wrong picture.
PY = the python that has open3d, scikit-image, scipy, xatlas, pillow (env PY; default: this interpreter)."""
import json, os, subprocess, sys, hashlib, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(HERE, '../..'))
PY = os.environ.get('PY', sys.executable)
arg = lambda k, d=None: (sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d)
only = set(filter(None, (arg('--only') or '').split(','))); jobs = int(arg('--jobs', 3))
man = json.load(open(os.path.join(REPO, 'v2/tiles/manifest.json')))
idx_path = os.path.join(REPO, 'v2/tiles/coats.json')
index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
env = {**os.environ, 'PATH': os.path.expanduser('~/miniforge3/envs/utx/bin') + ':' + os.environ['PATH']}
def one(t):
    tid = t['id']; raw = f'/tmp/far_coat_{os.getpid()}_{tid}.glb'; out = os.path.join(REPO, 'v2/tiles', tid + '.coat.glb')
    src = os.path.join(REPO, 'v2', t['lod0']); sha = hashlib.sha256(open(src, 'rb').read() + open(os.path.join(HERE, 'far_coat.py'), 'rb').read()).hexdigest()[:16]
    if index.get(tid, {}).get('of') == sha and os.path.exists(out) and '--force' not in sys.argv: return tid, {**index[tid], 'tile_bytes': os.path.getsize(src)}, 'kept'
    r = subprocess.run([PY, os.path.join(HERE, 'far_coat.py'), REPO, tid, raw], capture_output=True, text=True, env=env)
    res = [l for l in r.stdout.splitlines() if l.startswith('RESULT ')]
    if r.returncode or not res: return tid, None, (r.stderr or r.stdout)[-600:]
    res = json.loads(res[-1][7:])
    p = subprocess.run(['node', os.path.join(HERE, 'far_coat_pack.mjs'), raw, out], capture_output=True, text=True, env=env, cwd=REPO)
    os.remove(raw)
    if p.returncode: return tid, None, p.stderr[-600:]
    return tid, dict(file=f'tiles/{tid}.coat.glb', texel_m=float(os.environ.get('TEXEL', 0.6)), triangles=res['far'], full=res['full'], atlas=[res['w'], res['h']], bytes=os.path.getsize(out), tile_bytes=os.path.getsize(src), model=res.get('model', 0), of=sha), 'built'
todo = [t for t in man['tiles'] if t.get('lod0') and (not only or t['id'] in only)]
with cf.ThreadPoolExecutor(jobs) as ex:
    for tid, entry, note in ex.map(one, todo):
        if entry: index[tid] = entry; print(tid, note, entry['full'], '->', entry['triangles'], 'triangles,', entry['atlas'], round(entry['bytes'] / 1e6, 3), 'MB', flush=True)
        else: print(tid, 'FAILED', note, flush=True)
        json.dump(dict(sorted(index.items())), open(idx_path + '.tmp', 'w'), indent=0); os.replace(idx_path + '.tmp', idx_path)
tot = [v for v in index.values()]
print('TOTAL', len(tot), 'tiles,', sum(v['full'] for v in tot), '->', sum(v['triangles'] for v in tot), 'triangles,', round(sum(v['bytes'] for v in tot) / 1e6, 2), 'MB,', round(sum(v['atlas'][0] * v['atlas'][1] for v in tot) / 1e6, 1), 'M texels')
