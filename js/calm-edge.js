/* One-pass directional edge integration (FXAA). This is a bounded spatial
 * filter, not a temporal/zero-moire claim. Enabled only by the calm runtime. */
(function(){
 'use strict';
 const tune={span:8,reduceMul:1/8,reduceMin:1/128,boxMix:.5,radius:.5};
 function create(gl,bind,dirty){
  let p=null,vao=null,tex=null,w=0,h=0,size=null,filter=null;
  const stats={frames:0,bytes:0};
  const vs='#version 300 es\nvoid main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0.,1.);}';
  const fs=`#version 300 es
precision highp float;uniform sampler2D source;uniform vec2 pixel,kernel;out vec4 color;
void main(){
 vec2 uv=gl_FragCoord.xy*pixel;vec3 c=texture(source,uv).rgb;
 vec3 nw=texture(source,uv+vec2(-1,1)*pixel*kernel.y).rgb,ne=texture(source,uv+vec2(1,1)*pixel*kernel.y).rgb;
 vec3 sw=texture(source,uv+vec2(-1,-1)*pixel*kernel.y).rgb,se=texture(source,uv+vec2(1,-1)*pixel*kernel.y).rgb;
 const vec3 l=vec3(.299,.587,.114);float m=dot(c,l),a=dot(nw,l),b=dot(ne,l),d=dot(sw,l),e=dot(se,l);
 float lo=min(m,min(min(a,b),min(d,e))),hi=max(m,max(max(a,b),max(d,e)));
 // Flat regions return the original sample, including exact solid colours.
 if(hi-lo<1.0/255.0){color=vec4(c,1);return;}
 vec2 dir=vec2(-((a+b)-(d+e)),(a+d)-(b+e));
 float reduce=max((a+b+d+e)*(.25*${tune.reduceMul}),${tune.reduceMin});
 dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+reduce),vec2(-${tune.span}.0),vec2(${tune.span}.0))*pixel;
 vec3 A=.5*(texture(source,uv-dir/6.).rgb+texture(source,uv+dir/6.).rgb);
 vec3 B=A*.5+.25*(texture(source,uv-dir*.5).rgb+texture(source,uv+dir*.5).rgb);
 float lb=dot(B,l);color=vec4(mix(lb<lo||lb>hi?A:B,.25*(nw+ne+sw+se),kernel.x),1);
}`;
  function ensure(W,H){
   if(!p){
    p=gl.createProgram();for(const [type,code] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
     const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);gl.attachShader(p,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('calm edge shader: '+gl.getProgramInfoLog(p));
    vao=gl.createVertexArray();size=gl.getUniformLocation(p,'pixel');filter=gl.getUniformLocation(p,'kernel');
   }
   if(w!==W||h!==H||!tex){
    if(tex)gl.deleteTexture(tex);tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,null);w=W;h=H;stats.bytes=w*h*4;
   }
  }
  return {stats,draw(W,H){
   gl.activeTexture(gl.TEXTURE0);ensure(W,H);bind.call(gl,gl.FRAMEBUFFER,null);
   gl.bindTexture(gl.TEXTURE_2D,tex);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,W,H);
   gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);
   gl.viewport(0,0,W,H);gl.useProgram(p);gl.bindVertexArray(vao);gl.uniform2f(size,1/W,1/H);gl.uniform2f(filter,tune.boxMix,tune.radius);
   gl.drawArrays(gl.TRIANGLES,0,3);gl.bindVertexArray(null);gl.bindTexture(gl.TEXTURE_2D,null);dirty();stats.frames++;
  },lost(){p=vao=tex=null;w=h=0;stats.bytes=0;}};
 }
 window.CalmEdge={tune,create};
})();
