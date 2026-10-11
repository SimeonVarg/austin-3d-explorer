// Keep the intended eye fixed when placing MapLibre's nearly horizontal camera.
// eye: Mercator {x,y}; scale: the scene origin's Mercator units per local metre.
export function placement({eye,scale,h,yaw,pitch,fs}) {
  if (![eye?.x,eye?.y,scale,h,yaw,pitch,fs].every(Number.isFinite) || scale<=0 || h<=0 || fs<=0 || pitch<0 || pitch>=90)
    throw new Error('Invalid Mercator camera placement');
  const r=Math.PI/180, ground=h*Math.tan(pitch*r)*scale;
  return {center:{x:eye.x+Math.sin(yaw*r)*ground,y:eye.y-Math.cos(yaw*r)*ground},
    zoom:Math.log2(fs/(512*(h/Math.cos(pitch*r))*scale))};
}
