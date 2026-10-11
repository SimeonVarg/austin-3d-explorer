import assert from 'node:assert/strict';
import {placement} from './camera-placement.mjs';
const r=Math.PI/180,lat=30,scale=1/(40075016.686*Math.cos(lat*r));
const eye={x:.25,y:.4},h=1.4,pitch=88,fs=830;
for(const yaw of [0,5,90,185,325]){
  const got=placement({eye,scale,h,yaw,pitch,fs});
  const range=fs/(512*2**got.zoom),ground=range*Math.sin(pitch*r);
  assert(Math.abs((got.center.x-Math.sin(yaw*r)*ground-eye.x)/scale)<1e-6);
  assert(Math.abs((got.center.y+Math.cos(yaw*r)*ground-eye.y)/scale)<1e-6);
  assert(Math.abs(range*Math.cos(pitch*r)/scale-h)<1e-10);
}
// The previous degree approximation moves the eye more than 20 cm at pitch 88.
const intendedGround=h*Math.tan(pitch*r),oldGround=intendedGround/110540*(40075016.686/360);
assert(oldGround-intendedGround>.2);
assert.throws(()=>placement({eye,scale,h,yaw:0,pitch:90,fs}));
console.log('Mercator camera placement: five yaw round-trips pass; old degree approximation fails');
