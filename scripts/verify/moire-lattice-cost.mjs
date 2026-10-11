/** Moving-camera costs in one page, interleaved arms; no screenshot readback while timing. */
import {chromium} from 'playwright-core';
import {BASE,launch,HW_ARGS} from './chrome.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const out=opt('--out','out/moire-cost'),phone=args.includes('--phone');
fs.mkdirSync(out,{recursive:true});
const browser=await launch(chromium,{gl:'hardware',headless:true,maxMs:300000,
  args:[...HW_ARGS,'--disable-gpu-vsync','--disable-frame-rate-limit']});
const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:960,height:600},deviceScaleFactor:phone?3:1});
if(args.includes('--prefer-discrete'))await page.addInitScript(()=>{
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,attrs){return get.call(this,type,/^webgl/.test(type)?{...attrs,powerPreference:'high-performance'}:attrs);};
});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(glInit);
await page.addInitScript(()=>{
 localStorage.setItem('austin3d.gfx.v1',JSON.stringify({autoDetected:true,autoExposure:false}));
 const t=setInterval(()=>{if(window.cancelGraphicsAutoDetect){window.cancelGraphicsAutoDetect();clearInterval(t);}},20);
});
const cdp=await page.context().newCDPSession(page);
await page.goto(BASE+'/index.html?intro=0&drift=0&namelabels=0&facadepace=0&timeofdaypace=0&samplelattice=1&smooth=0'+(phone?'&lite=1':''),{waitUntil:'domcontentloaded',timeout:180000});
await page.waitForFunction(()=>!document.getElementById('veil')&&window.slopesApartments?.count.done&&window.slopesApartments?.group,null,{timeout:180000});
console.error('[cost] ready');
await page.evaluate(async()=>{
 window.cancelGraphicsAutoDetect();window.GFX.autoExposure=false;
 const m=window.__map;window.SampleLattice.set(false);
 window.applyTimeOfDay(m,.2,true);
 for(const id of m.getLayersOrder())if(m.getLayer(id).type==='symbol')m.setLayoutProperty(id,'visibility','none');
 m.jumpTo({center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4});
 await new Promise(r=>setTimeout(r,2000));
});
const snap=()=>os.cpus().reduce((a,c)=>{const t=c.times;a.busy+=t.user+t.nice+t.sys+t.irq;a.total+=t.user+t.nice+t.sys+t.irq+t.idle;return a;},{busy:0,total:0});
const reps=[];
for(let rep=0;rep<3;rep++)for(const on of rep%2?[true,false]:[false,true]){
 const begin=snap(),load=os.loadavg();
 const r=await page.evaluate(async({on,frames})=>{
   const m=window.__map;window.SampleLattice.set(on);
   const base={center:[-97.7393,30.2874],zoom:16.85,pitch:74,bearing:197.4};
   const times=[];let prev=0,n=0;
   await new Promise(done=>{
     const tick=()=>{
       const now=performance.now();if(n>8)times.push(now-prev);prev=now;
       if(n++>=frames+8){m.off('render',tick);done();return;}
       m.jumpTo({...base,bearing:base.bearing+(n-8)*.03});
       m.triggerRepaint();
     };
     m.on('render',tick);m.jumpTo(base);m.triggerRepaint();
   });
   const g=m.painter.context.gl,e=g.getExtension('WEBGL_debug_renderer_info');
   const M=window.__mm;
   return {on,times,canvas:[g.drawingBufferWidth,g.drawingBufferHeight],
     renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',
     gpu:{textures:M.tex,buffers:M.buf,renderbuffers:M.rb,total:M.tex+M.buf+M.rb,peak:M.peak},
     draw:window.slopes?.stats?.(),lattice:JSON.parse(JSON.stringify(window.SampleLattice.stats))};
 },{on,frames:+opt('--frames','32')});
 await cdp.send('HeapProfiler.collectGarbage');r.heap=await cdp.send('Runtime.getHeapUsage');
 const end=snap();r.cpuBusy=(end.busy-begin.busy)/(end.total-begin.total);r.load=load;r.rep=rep;
 const s=[...r.times].sort((a,b)=>a-b);r.p50=s[Math.floor(s.length*.5)];r.p90=s[Math.floor(s.length*.9)];
 reps.push(r);console.error('[cost] '+JSON.stringify({rep,on,renderer:r.renderer,p50:r.p50,p90:r.p90,gpu:r.gpu.total,heap:r.heap,load,cpu:r.cpuBusy}));
 fs.writeFileSync(path.join(out,'cost.json'),JSON.stringify({phone,errors,reps,vsync:false,cpuThrottle:1},null,2));
}
await browser.__done();
function glInit() {
  if (window.__mm) return;
  const M = window.__mm = { tex: 0, buf: 0, rb: 0, peak: 0, own: {} };
  const TB = new WeakMap(), BB = new WeakMap(), RB = new WeakMap(), LIVE = M.live = new Set();
  const SIZED = { 0x8058: 4, 0x8051: 4, 0x881A: 8, 0x881B: 8, 0x8814: 16, 0x8815: 16, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822E: 4,
    0x822F: 4, 0x8230: 8, 0x81A5: 2, 0x81A6: 4, 0x88F0: 4, 0x8CAC: 4, 0x8CAD: 8, 0x8C43: 4, 0x8C41: 4, 0x8D62: 2, 0x8056: 2,
    0x8057: 2, 0x8D48: 1, 0x8C3A: 4, 0x8C3D: 4, 0x8059: 4 };
  const CH = { 0x1908: 4, 0x1907: 3, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1, 0x8227: 2, 0x1902: 1, 0x84F9: 1, 0x8D94: 1, 0x8228: 2, 0x8D98: 4, 0x8D99: 4 };
  const TY = { 0x1401: 1, 0x1400: 1, 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x84FA: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8368: 4, 0x8C3B: 4, 0x8DAD: 8 };
  const bpp = (ifmt, fmt, type) => {
    if (SIZED[ifmt]) return SIZED[ifmt];
    const c = CH[fmt] || CH[ifmt] || 4, t = TY[type] || 1;
    if ([0x8033, 0x8034, 0x8363, 0x84FA, 0x8368, 0x8C3B].includes(type)) return t;
    return Math.max(1, (c === 3 ? 4 : c) * t);
  };
  const texBind = t => t === 0x0DE1 ? 0x8069 : (t >= 0x8515 && t <= 0x851A) || t === 0x8513 ? 0x8514 : t === 0x8C1A ? 0x8C1D : t === 0x806F ? 0x806A : null;
  const bufBind = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8A11: 0x8A28, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x8C8E: 0x8C8F };
  const who = (kind) => {
    try {
      const st = new Error().stack.split('\n');
      for (const l of st) { const m = l.match(/\/(js\/[\w.-]+\.js):\d+/); if (m) return kind + ' ' + m[1]; }
      for (const l of st) { const m = l.match(/(maplibre-gl|three)[^/]*\.js/); if (m) return kind + ' ' + m[1]; }
    } catch (e) {}
    return kind + ' ?';
  };
  const add = (o, d) => { if (o && d) M.own[o] = (M.own[o] || 0) + d; const t = M.tex + M.buf + M.rb; if (t > M.peak) M.peak = t; };
  function setTex(gl, target, key, bytes) {
    const b = texBind(target); if (!b) return;
    const tex = gl.getParameter(b); if (!tex) return;
    let m = TB.get(tex); if (!m) { m = new Map(); m.owner = who('tex'); TB.set(tex, m); LIVE.add(m); }
    const old = m.get(key) || 0; m.set(key, bytes); M.tex += bytes - old; add(m.owner, bytes - old);
  }
  function patch(P) {
    if (!P || P.__mmPatched) return; P.__mmPatched = true;
    const w = (name, fn) => { const o = P[name]; if (typeof o !== 'function') return; P[name] = function () { try { fn.call(this, arguments); } catch (e) {} return o.apply(this, arguments); }; };
    w('texImage2D', function (a) {
      let wd, ht, fmt, type; const ifmt = a[2];
      if (a.length >= 8) { wd = a[3]; ht = a[4]; fmt = a[6]; type = a[7]; }
      else { const s = a[5]; wd = s && (s.videoWidth || s.naturalWidth || s.width) || 0; ht = s && (s.videoHeight || s.naturalHeight || s.height) || 0; fmt = a[3]; type = a[4]; }
      setTex(this, a[0], a[0] + ':' + a[1], wd * ht * bpp(ifmt, fmt, type));
      try { const b = texBind(a[0]); const t = b && this.getParameter(b); const m = t && TB.get(t); if (m && a[1] === 0) m.wh = wd + 'x' + ht; } catch (e) {}
    });
    w('texImage3D', function (a) { setTex(this, a[0], a[0] + ':' + a[1], a[3] * a[4] * a[5] * bpp(a[2], a[7], a[8])); });
    w('texStorage2D', function (a) { let s = 0; for (let l = 0; l < a[1]; l++) s += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * bpp(a[2]); if (a[0] === 0x8513) s *= 6; setTex(this, a[0], 'st', s); });
    w('texStorage3D', function (a) { let s = 0; for (let l = 0; l < a[1]; l++) s += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * a[5] * bpp(a[2]); setTex(this, a[0], 'st', s); });
    w('compressedTexImage2D', function (a) { const d = a[a.length - 1]; setTex(this, a[0], a[0] + ':' + a[1], d && d.byteLength || 0); });
    w('generateMipmap', function (a) {
      const b = texBind(a[0]); if (!b) return; const tex = this.getParameter(b); const m = tex && TB.get(tex); if (!m) return;
      const l0 = m.get(a[0] + ':0') || 0; const old = m.get('mip') || 0; m.set('mip', l0 / 3); M.tex += l0 / 3 - old; add(m.owner, l0 / 3 - old);
    });
    w('deleteTexture', function (a) { const m = a[0] && TB.get(a[0]); if (!m) return; let s = 0; for (const v of m.values()) s += v; M.tex -= s; add(m.owner, -s); TB.delete(a[0]); LIVE.delete(m); });
    w('bufferData', function (a) {
      const b = bufBind[a[0]]; if (!b) return; const buf = this.getParameter(b); if (!buf) return;
      const bytes = typeof a[1] === 'number' ? a[1] : (a.length >= 5 && a[4] ? a[4] * (a[1].BYTES_PER_ELEMENT || 1) : (a[1] ? a[1].byteLength : 0));
      let o = BB.get(buf); if (!o) { o = { b: 0, owner: who('buf') }; BB.set(buf, o); }
      M.buf += bytes - o.b; add(o.owner, bytes - o.b); o.b = bytes;
    });
    w('deleteBuffer', function (a) { const o = a[0] && BB.get(a[0]); if (!o) return; M.buf -= o.b; add(o.owner, -o.b); BB.delete(a[0]); });
    const rbs = (gl, ifmt, wd, ht, samples) => {
      const rb = gl.getParameter(0x8CA7); if (!rb) return;
      const bytes = wd * ht * bpp(ifmt) * Math.max(1, samples);
      let o = RB.get(rb); if (!o) { o = { b: 0, owner: who('rb') }; RB.set(rb, o); }
      M.rb += bytes - o.b; add(o.owner, bytes - o.b); o.b = bytes;
    };
    w('renderbufferStorage', function (a) { rbs(this, a[1], a[2], a[3], 1); });
    w('renderbufferStorageMultisample', function (a) { rbs(this, a[2], a[3], a[4], a[1]); });
    w('deleteRenderbuffer', function (a) { const o = a[0] && RB.get(a[0]); if (!o) return; M.rb -= o.b; add(o.owner, -o.b); RB.delete(a[0]); });
  }
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);

}
