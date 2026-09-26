"""Check the structural classification against an accepted landscape baseline.
Run: python scripts/verify/campus-structural-data.py <baseline-ref>
Geometry, planting and legacy retirement must be unchanged by this split.
"""
import copy
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
current = json.loads((ROOT/'data/campus_landscape.json').read_text(encoding='utf-8'))
baseline = json.loads(subprocess.check_output(
    ['git', 'show', sys.argv[1]+':data/campus_landscape.json'], cwd=ROOT))

def geometry(value):
    if isinstance(value, dict):
        return {k: geometry(v) for k, v in value.items()
                if k not in ('structural', 'requiresAuthored', 'retiredCanopyKeys')}
    if isinstance(value, list):
        return [geometry(v) for v in value]
    return value

def check(data):
    assert geometry(data) == baseline, 'Existing geometry, planting and seed order must be exact'
    floors = data['walkableGround']
    assert len(floors) == 35 and all(f.get('structural') is True for f in floors)
    halls = json.loads((ROOT/'data/campus_buildings.json').read_text(encoding='utf-8'))['buildings']
    gearing = next(b for b in halls if b['code'] == 'GEA')
    dependent = [f for f in floors if f.get('requiresAuthored')]
    assert len(dependent) == 10 and all(f['requiresAuthored'] == gearing['id'] for f in dependent)
    features = [f for p in data['gardens']['places'] for f in p['features'] if f.get('structural')]
    assert len(features) == 7, 'Two terraces, shoulder, two rails and two Union solid meshes'
    assert all(f['kind'] in ('pave', 'detailMesh', 'raisedRail') and not f.get('plants') for f in features)
    assert [r['eid'] for r in data['ramps'] if r.get('structural')] == [239]
    retired = data['retiredCanopyKeys']
    assert len(retired) == 1 and retired[0] in data['canopyKeys'], 'Only the already rejected crown'

check(current)
for mutate in (
    lambda d: d['walkableGround'][0].pop('structural'),
    lambda d: next(f for f in d['walkableGround'] if f.get('requiresAuthored')).update(requiresAuthored='missing-model'),
    lambda d: d['trees'].reverse(),
    lambda d: d['retiredCanopyKeys'].append('unrelated-tree'),
):
    damaged = copy.deepcopy(current)
    mutate(damaged)
    try:
        check(damaged)
    except AssertionError:
        pass
    else:
        raise AssertionError('Damaged classification or preservation must fail')
print('PASS: exact landscape geometry/planting, 35 explicit floors, 10 model dependencies, bounded canopy retirement and negative controls.')
