"""Own Battle Hall's authored asset; preserve mapped shell and roof."""
import copy, json
from pathlib import Path
from bake_union import base, bays, block, band, cornice, roof
ROOT=Path(__file__).resolve().parents[1]
def build_base():
 s,F,uv=base('Battle Hall','docs/campus-truth/BTL.md; docs/shots/verdict-battle-vs-photo.jpg');L,W=F['L'],F['W'];s['levels']['floors']=[0,1.2,7.2,17.7];s['skins']['lower']=bays('stone',4.3,1.5,3.4,1.2);s['skins']['arches']=bays('stone',8.5,3.15,7.2,.55);s['skins']['arches']['window']['arch']={'rise':1.6,'segments':24,'tone':'trim','trim':.35};s['skins']['arches']['window']['mullion']={'w':.11,'cols':[.25,.5,.75],'rows':[.22,.45,.68,.83],'tone':'trim'};s['skins']['lower']['window']['mullion']={'w':.09,'cols':[.5],'rows':[.45],'tone':'trim'};s['skins']['arches']['reveal']=.6
 b=block('reading-hall',[14.9,34.45,0,43.1],0,17.7,'lower');b['bands']=[band(0,1.2,'stone'),band(1.2,7.2,'lower'),band(7.2,16.2,'arches'),band(16.2,17.7,'trim')];roof(s,b,25);s['blocks']=[b,block('west-stack-wing',[0,14.9,7.8,35],0,16,'lower')];roof(s,s['blocks'][1],25)
 for z in [1.1,7,16.2,17.5]:cornice(s,'cornice-'+str(z),[14.9,34.45,0,43.1],z,.32)
 # Five iron Juliet rails on the photographed east face.
 s['balcony']={'proj':.65,'slabT':.16,'railH':1,'railT':.045,'railPitch':.2,'railPost':.035,'slabTone':'trim','railTone':'dark'}
 b['faces']={'u1':{'bands':copy.deepcopy(b['bands'])}}
 b['faces']['u1']['bands'][2]['balconies']=[{'s0':i*8.62+2.65,'s1':i*8.62+5.97} for i in range(5)]
 for b in s['blocks']: b.setdefault('_src','reference; dimensions are derived, see sources.dimensions')
 return s
def build():
 from campus_battle import refine
 return refine(build_base())
def main():
 s=build()
 (ROOT/'data/apartments/battle-hall.json').write_text(json.dumps(s,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
 print('battle-hall',len(s['blocks']),'blocks')
 return s
if __name__=='__main__':main()
