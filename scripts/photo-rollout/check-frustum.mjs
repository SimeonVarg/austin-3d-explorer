#!/usr/bin/env node
// Check an existing photo-camera helper; never accept a non-clipped frame that loses ground pixels.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const file=process.argv[2];
if(!file)throw Error('usage: node check-frustum.mjs /private/renderer/camera.mjs');
const {plan,toEngine}=await import(pathToFileURL(path.resolve(file)).href);
const results=[];
for(const pitch of [-35,-20,0,23,40])for(const roll of [0,10]){
  const pose={pitch,roll,hfov:60},p=plan(pose,900,1200);
  assert(p.W>0&&p.H>0&&Number.isFinite(p.fs),'invalid planned frame');
  let outside=0;
  for(let x=0;x<900;x+=30)for(let y=0;y<1200;y+=30){
    const [tx,ty]=toEngine(pose,x+.5,y+.5,900,1200),px=p.cx+p.fs*tx,py=p.cy-p.fs*ty;
    if(!Number.isFinite(px)||!Number.isFinite(py)||px<-.01||py<-.01||px>p.W||py>p.H)outside++;
  }
  results.push({pitch,roll,clipped:p.clipped,outside});
  assert(p.clipped||outside===0,`unreported frustum clipping at pitch=${pitch}, roll=${roll}: ${outside} samples`);
}
console.log(JSON.stringify({ok:true,cases:results},null,2));
