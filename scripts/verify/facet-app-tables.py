import json,sys,os,re,subprocess,shutil
res=sys.argv[1]; label=sys.argv[2]; docdir='docs/graphics-basics-study-2026-10-10'
app=json.load(open(res+'/app/result.json')); f0=app['flags']['0']; f1=app['flags']['1']
def mb(x): return f"{x/1048576:.1f} MB"
rows=['| | flag off | flag on | change |','|---|---:|---:|---:|']
def row(name,a,b,fmt=lambda x:f"{x:,}"):
    d=b-a; rows.append(f"| {name} | {fmt(a)} | {fmt(b)} | {('-' if d<0 else '+')+fmt(abs(d))} ({d/a*100:+.1f}%) |")
row('triangles in the authored apartment mesh (the generator\'s count)',f0['page']['triangles'],f1['page']['triangles'])
q=f1['page']['facetStats']['quads']; rows.append(f"| quads the flag adds | 0 | {q:,} ({2*q:,} triangles) | |")
row('CPU arrays of the apartment meshes at ready',sum(m['bytes'] for m in f0['page']['meshes']),sum(m['bytes'] for m in f1['page']['meshes']),mb)
fb=f1['page']['facetStats']['bytes']; rows.append(f"| of which the flag's own arrays and three data textures (piece records, window table, tones) | 0 | {mb(fb['geometry'])} geometry, {mb(fb['fd']+fb['wt']+fb['ft'])} textures | |")
for lab,k in (('GL buffer bytes held after the six shots','buf'),('GL texture bytes held after the six shots','tex')):
    a=sum(f0['after']['glLive'][k].values()); b=sum(f1['after']['glLive'][k].values()); row(lab,a,b,mb)
row('JavaScript the page downloads',f0['page']['jsBytes'],f1['page']['jsBytes']); row('everything the page downloads',f0['page']['allBytes'],f1['page']['allBytes'])
rows.append(f"| GL programs used | {f0['after']['programs']} | {f1['after']['programs']} | |")
bytes_tab='\n'.join(rows)
pics=['| camera and hour | pixels moved more than 12/255 | mean absolute difference (0-255, whole frame) |','|---|---:|---:|']
for p in app['pairs']: pics.append(f"| {p['name']} | {p['movedPct']}% | {p['meanAbsDiff']} |")
pics='\n'.join(pics)
def meter(m):
    j=json.load(open(f'{res}/meter{m}.json')); return {r['name']:r for r in j['rows']}
m0,m1=meter(0),meter(1)
mt=['| view | authored-building pixels | err off / on | band off / on | flicker off / on | p99 err off / on |','|---|---:|---|---|---|---|']
for v in m0:
    a,b=m0[v]['apt'],m1[v]['apt']; mt.append(f"| {v} | {100*m0[v]['authored']:.0f}% / {100*m1[v]['authored']:.0f}% of the frame | {a['err']:.2f} / {b['err']:.2f} | {a['band']:.2f} / {b['band']:.2f} | {a['flick']:.2f} / {b['flick']:.2f} | {a['p99']:.1f} / {b['p99']:.1f} |")
mt='\n'.join(mt)
cross=subprocess.run(['python3','scripts/verify/facet-meter-cross.py',res],capture_output=True,text=True).stdout.strip()
ct=['| view | geometry 1x vs geometry truth | **shader 1x vs geometry truth** | shader truth vs geometry truth | shader 1x vs its own truth | mean level: geometry truth / shader 1x |','|---|---:|---:|---:|---:|---|']
for line in cross.split('\n'):
    m=re.match(r"(\S+)\s+px\s+\d+ \| geometry 1x vs geometry truth\s+([\d.]+) \| shader 1x vs geometry truth\s+([\d.]+) \| shader truth vs geometry truth\s+([\d.]+) \| shader 1x vs shader truth\s+([\d.]+) \| mean level: geometry truth ([\d.]+), shader truth ([\d.]+), shader 1x ([\d.]+)",line)
    if m: ct.append(f"| {m[1]} | {m[2]} | **{m[3]}** | {m[4]} | {m[5]} | {m[6]} / {m[8]} |")
ct='\n'.join(ct)
# copy pictures into the docs dir
dst=f'{docdir}/facet-app-{label}'; os.makedirs(dst,exist_ok=True)
for fn in ('app-result.json',): shutil.copy(f'{res}/app/result.json',f'{dst}/{fn}')
for m in (0,1): shutil.copy(f'{res}/meter{m}.json',f'{dst}/meter{m}.json')
open(f'{dst}/cross.txt','w').write(cross)
json.dump({'bytes':bytes_tab,'pics':pics,'meter':mt,'cross':ct},open(f'/tmp/mkdoc-{label}.json','w'))
print(bytes_tab); print(); print(pics); print(); print(mt); print(); print(ct)
