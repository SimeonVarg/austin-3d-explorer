
    uniform float u_rtOn;
    uniform sampler2D u_roofReliefAtlas;
    uniform vec4 u_rtFootprint;
    uniform vec4 u_rtTones[5];
    uniform vec4 u_rtCell,u_rtFilter,u_rtShape,u_rtLip,u_rtPale,u_rtWeather,u_rtHour,u_rtEdges,u_rtEave;
    uniform vec3 u_rtPhoto[3];
    float rtWeatherNoise(vec2 p) {
      vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(wpHash(i,u_rtCell.w+5.),wpHash(i+vec2(1,0),u_rtCell.w+5.),f.x),
        mix(wpHash(i+vec2(0,1),u_rtCell.w+5.),wpHash(i+vec2(1,1),u_rtCell.w+5.),f.x),f.y)*2.-1.;
    }
    vec3 rtTone(vec2 cell) {
      // A column chooses short groups. Some decisions stay independent, so
      // cream includes singles as well as runs. Its marginal share is fixed.
      float run=floor(mix(u_rtPale.x,u_rtPale.y+1.,wpHash(vec2(cell.x,0.),u_rtCell.w)));
      float group=floor((cell.y+floor(wpHash(vec2(cell.x,1.),u_rtCell.w)*run))/run);
      bool grouped=wpHash(vec2(cell.x,group),u_rtCell.w+1.)<u_rtPale.z;
      float pale=wpHash(grouped?vec2(cell.x,group):cell,u_rtCell.w+2.);
      float choice=wpHash(cell,u_rtCell.w+3.)*(1.-u_rtPale.w);
      int index=0;
      for(int i=0;i<4;i++){if(choice>u_rtTones[i].w)index=i+1;}
      if(pale<u_rtPale.w)index=4;
      vec3 tone=vec3(1);
      for(int i=0;i<5;i++){if(i==index)tone=u_rtTones[i].rgb;}
      return tone;
    }
    float rtStrip(float x,float width,float footprint) {
      float phase=fract(x),lo=phase-footprint*.5,hi=phase+footprint*.5;
      return clamp((floor(hi)*width+min(fract(hi),width)
        -floor(lo)*width-min(fract(lo),width))/footprint,0.,1.);
    }
    vec3 rtFactor(vec3 p,vec3 n,vec4 surface,vec3 day,vec3 dark) {
      float h=length(n.xy);
      vec2 across=vec2(-n.y,n.x)/h;
      vec3 down=vec3(n.xy*n.z/h,-h);
      vec2 uv=vec2(dot(p.xy,across),dot(p,down))/u_rtCell.xy;
      vec2 fw=fwidth(uv);
      vec2 reliefUV=uv,reliefDx=dFdx(uv),reliefDy=dFdy(uv);
      // Fades use cells per SCREEN pixel: a tile must be large enough to see,
      // not only to sample. Edge smoothing below keeps device pixels.
      vec2 fv=fw*u_rtWeather.w;
      vec2 resolvedAxes=1.-smoothstep(vec2(u_rtFilter.x),vec2(u_rtFilter.y),fv);
      float resolved=1.-smoothstep(u_rtFootprint.z,u_rtFootprint.w,fv.x*fv.y);
      resolved*=1.-smoothstep(u_rtFootprint.x,u_rtFootprint.y,max(fv.x,fv.y));
      vec3 mean=vec3(1);
      if(u_rtHour.w>.5) {
        vec3 target=u_materialP<=.5?mix(u_rtPhoto[0],u_rtPhoto[1],u_materialP*2.):mix(u_rtPhoto[1],u_rtPhoto[2],(u_materialP-.5)*2.);
        vec3 source=mix(day,dark,max(0.,u_materialP*2.-1.));
        mean=target/max(source,vec3(.0001));
      }
      if(max(resolved,max(resolvedAxes.x,resolvedAxes.y))<=0.)return mean;
      float u=fract(uv.x),aa=max(fw.x,.00001);
      float sinc=sin(3.14159265359*aa)/(3.14159265359*aa);
      float cover=.5-.5*cos(u*6.28318530718)*sinc;
      float warp=u_rtShape.w*resolvedAxes.x;
      uv.y+=warp*cover;
      // Filter the scalloped course position too. A neighbour derivative of
      // its sinusoid can vanish at one period per pixel. The chain rule plus
      // the discarded displacement amplitude gives a conservative footprint,
      // without a derivative after the non-uniform early return above.
      float ay=max(fw.y+abs(warp*3.14159265359*sin(u*6.28318530718)*sinc)*fw.x
        +abs(warp)*(1.-abs(sinc)),.00001);
      vec2 coverage=vec2(aa,ay),clayPixels=coverage*u_rtWeather.w;
      resolved=1.-smoothstep(u_rtFootprint.z,u_rtFootprint.w,clayPixels.x*clayPixels.y);
      // Include device pixels even when the screen-pixel factor is below one.
      // The four-cell integral is only valid below one cell along each axis.
      resolved*=1.-smoothstep(u_rtFootprint.x,min(u_rtFootprint.y,1.),
        max(max(clayPixels.x,clayPixels.y),max(coverage.x,coverage.y)));
      vec2 cell=floor(uv);
      vec3 tone=vec3(0);
      // Integrate the piecewise-constant clay field over the pixel footprint.
      // The colour resolves only below one cell per axis. Such a box
      // intersects at most four cells; start at its lower corner, not at
      // the centre cell. No image, mip allocation or extra geometry.
      vec2 footprint=min(coverage,vec2(1.));
      vec2 first=floor(uv-footprint*.5);
      for(int y=0;y<2;y++)for(int x=0;x<2;x++){
        vec2 q=first+vec2(float(x),float(y));
        vec2 overlap=max(vec2(0),min(uv+footprint*.5,q+1.)-max(uv-footprint*.5,q));
        float weight=overlap.x*overlap.y/(footprint.x*footprint.y);
        if(weight>0.)tone+=rtTone(q)*weight;
      }
      // Integrate periodic relief instead of smoothing the nearest edge.
      // This conserves the narrow lip/valley coverage at grazing angles.
      vec4 reliefSample=textureGrad(u_roofReliefAtlas,reliefUV,reliefDx,reliefDy);
      float valley=reliefSample.g,lip=reliefSample.b,highlight=reliefSample.a;
      // Each relief term has zero area mean. Distant pixels return exactly 1.
      float relief=1.+u_rtShape.z*(reliefSample.r-.5)-u_rtShape.y*(valley-u_rtShape.x)
        -u_rtLip.y*(lip-u_rtLip.x)+u_rtLip.z*(highlight-u_rtLip.x);
      if(wpHash(cell,u_rtCell.w+4.)<u_rtWeather.x) {
        float stain=rtWeatherNoise(uv*u_rtWeather.yz);
        relief+=stain*u_rtLip.w;
      }
      float contrast=u_materialP<=.5?mix(u_rtHour.x,u_rtHour.y,u_materialP*2.):mix(u_rtHour.y,u_rtHour.z,(u_materialP-.5)*2.);
      // Course foreshortening must not erase a still-resolved column field.
      // Integrated clay uses tile area; relief uses its own axis.
      // All terms converge to the same mean.
      float columnRelief=u_rtShape.z*(reliefSample.r-.5)-u_rtShape.y*(valley-u_rtShape.x);
      float courseRelief=-u_rtLip.y*(lip-u_rtLip.x)+u_rtLip.z*(highlight-u_rtLip.x);
      float weatherResolved=1.-smoothstep(.2,1.,max(coverage.x*u_rtWeather.y,coverage.y*u_rtWeather.z));
      float weatherRelief=(relief-1.-columnRelief-courseRelief)*weatherResolved;
      vec3 detail=((tone-1.)*resolved+vec3(columnRelief)*resolvedAxes.x
        +vec3(courseRelief)*resolvedAxes.y+vec3(weatherRelief)*min(resolvedAxes.x,resolvedAxes.y))*contrast;
      if(u_rtEdges.x>.5) {
        float crest=1.-smoothstep(0.,u_rtEdges.y,(surface.z-p.z)/h);
        detail=mix(detail,vec3(u_rtEdges.z*cos(uv.x*6.28318530718)),crest);
      }
      if(u_rtEdges.w>.5) {
        float eave=1.-smoothstep(0.,u_rtEave.x,(p.z-surface.y)/h);
        detail-=eave*u_rtEave.y*(1.-cover);
      }
      return mean*(1.+detail*u_rtCell.z);
    }
  