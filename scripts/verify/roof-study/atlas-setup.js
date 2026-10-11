/* Private runtime experiment; evaluate after the scene is ready. */
(() => {
  if (window.__roofMipExperiment) throw Error('Roof mip experiment already installed');
  const THREE=window.THREE,t=window.SLOPES_ROOFS?.tiles;
  if(!THREE||!t)throw Error('Roof experiment needs the actual loaded roof shader');
  const size=256,subsamples=8,anisotropyLimit=8;
  const data=new Uint8Array(size*size*4),rawMeans=[0,0,0,0],byteMeans=[0,0,0,0];
  const fract=x=>x-Math.floor(x);
  const primitive=(x,w)=>Math.floor(x)*w+Math.min(fract(x),w);
  const strip=(x,w,footprint)=>(primitive(x+footprint/2,w)-primitive(x-footprint/2,w))/footprint;
  const tau=2*Math.PI,step=1/size,sinc=Math.sin(Math.PI/size)/(Math.PI/size);
  const signature=JSON.stringify([t.valleyWidth,t.lipWidth,t.lipCurve]);
  const started=performance.now();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const u=(x+.5)/size,v=(y+.5)/size;
    // R/G are exact texel box means; B/A integrate y exactly and use eight
    // midpoint positions in x for the curved edge inside this tiny texel.
    const values=[.5-.5*Math.cos(tau*u)*sinc,
      strip(u+t.valleyWidth/2,t.valleyWidth,step),0,0];
    for(let k=0;k<subsamples;k++) {
      const subu=(x+(k+.5)/subsamples)/size;
      const warpedV=v+t.lipCurve*(.5-.5*Math.cos(tau*subu));
      values[2]+=strip(warpedV,t.lipWidth,step)/subsamples;
      values[3]+=strip(-warpedV,t.lipWidth,step)/subsamples;
    }
    const at=(y*size+x)*4;
    for(let c=0;c<4;c++) {
      const value=Math.max(0,Math.min(1,values[c]));
      data[at+c]=Math.round(value*255);
      rawMeans[c]+=value/(size*size);byteMeans[c]+=data[at+c]/(255*size*size);
    }
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);
  texture.name='roof-relief-periodic-experiment';
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.flipY=false;
  texture.anisotropy=Math.min(anisotropyLimit,window.slopes.renderer.capabilities.getMaxAnisotropy());
  if('colorSpace' in texture&&THREE.NoColorSpace!==undefined)texture.colorSpace=THREE.NoColorSpace;
  else if(THREE.LinearEncoding!==undefined)texture.encoding=THREE.LinearEncoding;
  texture.needsUpdate=true;
  const uniform={value:texture};
  const expected=[.5,t.valleyWidth,t.lipWidth,t.lipWidth];
  for(let c=0;c<4;c++)if(Math.abs(rawMeans[c]-expected[c])>1e-8)throw Error('Roof relief bake lost periodic mean');
  let bytes=0;for(let n=size;n>=1;n>>=1)bytes+=n*n*4;
  window.__roofMipExperiment={texture,uniform,size,subsamples,anisotropy:texture.anisotropy,
    bytes,sourceBytes:data.byteLength,rawMeans,byteMeans,expected,bakeMs:performance.now()-started,
    attached:new Set(),signature};
  window.__roofExperimentAttach=(material,arm)=>{
    if(JSON.stringify([t.valleyWidth,t.lipWidth,t.lipCurve])!==signature)
      throw Error('Relief shape changed: reload and rebake before comparing');
    material.uniforms.u_roofReliefAtlas=uniform;
    window.__roofMipExperiment.attached.add(material.id);
  };
})();
