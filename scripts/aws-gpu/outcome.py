#!/usr/bin/env python3
"""outcome.py - turn the workflow red when the machine's own results say a check failed.

    python3 scripts/aws-gpu/outcome.py results/        exit 0 only when every manifest says: GPU ok and every check exit 0
    python3 scripts/aws-gpu/outcome.py --self-test     proves each failing case is caught

WHY. On 2026-10-11 run 38124724400 was green although its out/manifest.json recorded a check with exit 1 (a real L4
shadow comparison). The workflow only looked for result FILES, never at what they said. A green run must mean the
checks passed. Missing, empty, null and non-zero all fail; this runs after the teardown and the artifact upload, so a
red run still returns everything.
"""
import glob, json, os, sys, tempfile


def judge(root):
    """Returns the list of reasons the run is not a pass (empty = pass)."""
    bad = []
    manifests = sorted(glob.glob(os.path.join(root, '**', 'manifest.json'), recursive=True))
    if not manifests:
        return ['no manifest.json under %s: the machine wrote no result record' % root]
    for m in manifests:
        try:
            d = json.load(open(m))
        except Exception as e:
            bad.append('%s: not readable (%s)' % (m, type(e).__name__)); continue
        if d.get('gpu_ok') is not True:
            bad.append('%s: gpu_ok is %r (the browser did not draw on the graphics card)' % (m, d.get('gpu_ok')))
        res = d.get('results')
        if not isinstance(res, list) or not res:
            bad.append('%s: no check results recorded' % m); continue
        for r in res:
            code = r.get('exit') if isinstance(r, dict) else None
            if not (isinstance(code, int) and not isinstance(code, bool) and code == 0):
                bad.append('%s: check %r ended with exit %r' % (m, (r or {}).get('name') if isinstance(r, dict) else r, code))
    return bad


def self_test():
    cases = {
        'pass': ({'gpu_ok': True, 'results': [{'name': 'a', 'exit': 0}]}, 0),
        'exit 1': ({'gpu_ok': True, 'results': [{'name': 'a', 'exit': 0}, {'name': 'b', 'exit': 1}]}, 1),
        'exit null': ({'gpu_ok': True, 'results': [{'name': 'a', 'exit': None}]}, 1),
        'exit missing': ({'gpu_ok': True, 'results': [{'name': 'a'}]}, 1),
        'exit as text': ({'gpu_ok': True, 'results': [{'name': 'a', 'exit': '0'}]}, 1),
        'no results': ({'gpu_ok': True, 'results': []}, 1),
        'gpu not ok': ({'gpu_ok': False, 'results': [{'name': 'a', 'exit': 0}]}, 1),
    }
    wrong = 0
    for name, (doc, want) in cases.items():
        with tempfile.TemporaryDirectory() as t:
            os.makedirs(os.path.join(t, 'main-i-0', 'out')); json.dump(doc, open(os.path.join(t, 'main-i-0', 'out', 'manifest.json'), 'w'))
            got = 1 if judge(t) else 0
        print(('ok  ' if got == want else 'FAIL') + ' %s: want %d, got %d' % (name, want, got)); wrong += got != want
    with tempfile.TemporaryDirectory() as t:
        got = 1 if judge(t) else 0
    print(('ok  ' if got == 1 else 'FAIL') + ' no manifest at all: want 1, got %d' % got); wrong += got != 1
    return 1 if wrong else 0


if __name__ == '__main__':
    if '--self-test' in sys.argv: sys.exit(self_test())
    reasons = judge(sys.argv[1] if len(sys.argv) > 1 else 'results')
    for r in reasons: print('::error::' + r)
    print('outcome: ' + ('FAILED, %d reason(s)' % len(reasons) if reasons else 'every check on the machine passed'))
    sys.exit(1 if reasons else 0)
