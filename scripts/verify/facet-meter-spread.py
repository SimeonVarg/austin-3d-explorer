"""facet-meter-spread.py - the moire meter's run-to-run spread, and the flag's effect measured against it.
Reads every meter0*.json / meter1*.json in a facet-app-bench output folder (FACET_METER_REPS repeats, interleaved off|on). For each view and each number
(err, band, flicker of the authored buildings: rows[].apt) prints the value of every run, the mean, the spread (max - min) of the runs of ONE flag, and
the flag's effect (on minus off, from the means). An effect smaller than the larger of the two spreads is NOT a result.
  python3 facet-meter-spread.py <dir> [numbers...]      numbers default: err band flick"""
import sys, glob, json, os, re
d = sys.argv[1]; nums = sys.argv[2:] or ['err', 'band', 'flick']
runs = {0: [], 1: []}
for f in sorted(glob.glob(os.path.join(d, 'meter[01]*.json'))):
    m = re.match(r'meter([01])', os.path.basename(f)); runs[int(m.group(1))].append(json.load(open(f))['rows'])
if not runs[0] or not runs[1]: sys.exit('need meter0*.json and meter1*.json')
views = [r['name'] for r in runs[0][0]]
print(f'{len(runs[0])} runs off, {len(runs[1])} runs on')
for k in nums:
    print(f'\n{k}  (authored buildings; lower is better)')
    print('view          ' + 'off runs'.ljust(28) + 'on runs'.ljust(28) + 'spread off/on     effect (on-off)   verdict')
    for v in views:
        val = lambda flag: [next(r for r in rows if r['name'] == v)['apt'][k] for rows in runs[flag]]
        a, b = val(0), val(1)
        if any(x is None for x in a + b): continue
        mean = lambda x: sum(x) / len(x); spr = lambda x: max(x) - min(x)
        eff = mean(b) - mean(a); sp = max(spr(a), spr(b))
        verdict = 'inside the noise' if abs(eff) <= sp else ('better' if eff < 0 else 'WORSE')
        print(f"{v:13s} {' '.join(f'{x:5.2f}' for x in a):28s}{' '.join(f'{x:5.2f}' for x in b):28s}{spr(a):5.2f}/{spr(b):5.2f}        {eff:+6.2f}            {verdict}")
