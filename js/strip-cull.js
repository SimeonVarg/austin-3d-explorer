/* Culling only: the raster camera is unchanged. Each sample strip uses a
 * narrower conservative frustum for Three and the existing building culler. */
(function(){
  'use strict';
  let attached=false,on=true;
  const stats={narrowed:0,unmatched:0};
  function attach(){
    if(attached)return;const T=window.THREE;if(!T)throw Error('Three not ready');
    const native=T.Frustum.prototype.setFromProjectionMatrix,temp=new T.Matrix4();
    T.Frustum.prototype.setFromProjectionMatrix=function(matrix,...args){
      const band=on&&window.SampleLattice?.currentBand,scene=window.slopes?.camera?.projectionMatrix;
      if(!band||!scene)return native.call(this,matrix,...args);
      // Only the application's camera; shadow and unrelated frusta retain
      // their complete coverage. No camera or shared input is changed.
      const a=matrix.elements,b=scene.elements;
      for(let i=0;i<16;i++)if(a[i]!==b[i]){stats.unmatched++;return native.call(this,matrix,...args);}
      temp.copy(matrix);const e=temp.elements,s=2/(band.high-band.low),t=-(band.high+band.low)/(band.high-band.low);
      for(let c=0;c<4;c++)e[c*4+1]=a[c*4+1]*s+a[c*4+3]*t;
      stats.narrowed++;return native.call(this,temp,...args);
    };
    attached=true;
  }
  window.StripCull={attach,set(value){on=!!value;},stats};
})();
