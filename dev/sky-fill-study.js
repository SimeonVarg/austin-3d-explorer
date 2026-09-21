// The actual application, two balances at the same camera and hour.
const header=document.querySelector('header');
for(const [name,fill] of [['Previous fill',[0,0]],['Sky fill',[.12,.08]]]){
 const b=document.createElement('button');b.textContent=name;header.append(b);
 b.onclick=()=>{const w=win();Object.assign(w.CityLighting.balance,{skyFill:fill[0],roofFill:fill[1]});w.__map.triggerRepaint();status.textContent=name;};
}
const campus=document.createElement('button');campus.textContent='Campus';header.append(campus);
campus.onclick=()=>{win().__map.stop();win().__map.jumpTo({center:[-97.7394,30.2855],zoom:16.4,pitch:55,bearing:202});};
