import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the renderer's actual emitted filter polygons against the baked
// roof features. No browser, camera metadata or owner references are needed.
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fs.readFileSync(new URL('../../js/slopes-stadium.js', import.meta.url), 'utf8');
const data = JSON.parse(fs.readFileSync(new URL('../../data/stadium.mesh.json', import.meta.url), 'utf8'));
const slice = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing renderer boundary: ${start}`);
  return source.slice(a, b);
};
const original = ['==', ['get', 'other-owner'], true];
const filters = new Map();
let writes = 0;
const map = {
  style: {}, getLayer: id => filters.has(id), getFilter: id => filters.get(id),
  setFilter(id, value) { filters.set(id, value); writes++; },
};
const context = vm.createContext({ data, map, saved: new Map(), filtered: false,
  window: {}, location: { search: '' }, URLSearchParams });
vm.runInContext(slice('  const TUNE =', '  let data,') +
  slice('  const LEGACY =', '  const up =') +
  slice('  function ll(', '  function uv(') +
  slice('  function replacementPolygon(', '  function updateLOD() {') +
  '\nglobalThis.api={TUNE,LEGACY,VOLUMES,filter,replacementPolygon,ll};', context);
const { api } = context;
if (process.argv.includes('--break')) api.TUNE.roofscapeNorthMargin = 0;
for (const id of [...api.LEGACY, ...api.VOLUMES]) filters.set(id, structuredClone(original));
api.filter(true);
const applied = writes;
api.filter(true);
assert.equal(writes, applied, 'repeated enable must not stack exclusion clauses');
const polygonFor = id => JSON.parse(JSON.stringify(filters.get(id)[2][1][1]));
const base = JSON.parse(JSON.stringify(api.replacementPolygon(false)));
const roofs = polygonFor('roofscape-minor');
for (const id of api.VOLUMES) {
  assert.deepEqual(polygonFor(id), id.startsWith('roofscape-') ? roofs : base,
    `${id}: only roofscape layers may use the expanded replacement extent`);
}
const [a,b,c,d] = data.bounds;
assert.deepEqual(base.coordinates[0], [[a,b],[c,b],[c,d],[a,d],[a,b]].map(p => Array.from(api.ll(...p))),
  'building and parts replacement bounds must remain unchanged');

const probe = spawnSync(process.env.PYTHON || 'python', ['-c', String.raw`
import json,sys,pathlib
from shapely.geometry import shape
payload=json.load(sys.stdin)
old,new=shape(payload['base']),shape(payload['roofs'])
# Independent affine lon/lat conversion rounds formerly collinear side edges
# differently. Allow 1e-10 degree (about 0.01 mm) ONLY for this containment check;
# the actual feature-intersection comparisons below retain exact polygons.
assert new.buffer(1e-10).covers(old), 'expanded mask must preserve all old exclusions'
out={}
for filename in ['roofscape.geojson','roofscape.detail.geojson']:
    features=json.loads((pathlib.Path(payload['root'])/'data'/filename).read_text())['features']
    before={i for i,f in enumerate(features) if old.intersects(shape(f['geometry']))}
    after={i for i,f in enumerate(features) if new.intersects(shape(f['geometry']))}
    out[filename]={'added':sorted(after-before),'lost':sorted(before-after)}
print(json.dumps(out))
`], { input: JSON.stringify({ root, base, roofs }), encoding: 'utf8' });
assert.equal(probe.status, 0, probe.stderr || 'Python/Shapely geometry probe failed');
const changed = JSON.parse(probe.stdout);
assert.deepEqual(changed, {
  'roofscape.geojson': { added: [], lost: [] },
  'roofscape.detail.geojson': { added: [2559,2563], lost: [] },
}, 'hide exactly the two detached roof units, preserving every other roof feature decision');

// Another owner may modify a filter while DKR is active. Disable must remove
// only the DKR clause, even after context loss temporarily prevents cleanup.
const later = ['==', ['get', 'later-owner'], true];
for (const [id, filter] of filters) filters.set(id, ['all', filter, later]);
map.style = null;
api.filter(false);
assert.equal(context.saved.size, filters.size, 'absent style must retain pending exclusions');
map.style = {};
api.filter(false);
assert.equal(context.saved.size, 0);
for (const [id, filter] of filters) assert.deepEqual(JSON.parse(JSON.stringify(filter)),
  ['all', original, later], `${id}: disabling must preserve other owners and restore fallback`);
console.log('PASS: DKR roof exclusion removes only detached detail features 2559/2563; ordinary volume bounds, other roofs, coexisting filters and fallback restoration are preserved');
