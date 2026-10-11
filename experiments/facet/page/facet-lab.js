/**
 * facet-lab.js - arm F: the tower drawn by the shader Facet GENERATED from its recipe (dist/*.vert.glsl, *.frag.glsl, *.walls.bin),
 * registered into the facade-shader lab beside A (the app's geometry), B (the hand-written shader) and A4 (geometry, 4x MSAA).
 * Everything the scoring does (the moire meter's method, the overdraw count, the timers) is the lab's.
 */
await import('../../facade-shader/page/lab.js');
const L = window.__lab, I = L.internals, gl = I.gl;
const DIST = new URL('../dist/dobie-twenty21', import.meta.url).href;
const [vs, fs, pkgMeta, bin] = await Promise.all([fetch(DIST + '.vert.glsl').then(r => r.text()), fetch(DIST + '.frag.glsl').then(r => r.text()), fetch(DIST + '.walls.json').then(r => r.json()), fetch(DIST + '.walls.bin').then(r => r.arrayBuffer())]);
const prog = I.program(gl, vs, fs);
const V = new Float32Array(bin, 0, pkgMeta.vertexCount * pkgMeta.vertexFloats), IDX = new Uint16Array(bin.slice(pkgMeta.vertexBytes, pkgMeta.vertexBytes + pkgMeta.indexCount * 2));
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
const at = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 48, off); };
at(0, 3, 0); at(1, 3, 12); at(2, 2, 24); at(3, 4, 32);
const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IDX, gl.STATIC_DRAW);
gl.bindVertexArray(null);
const f3 = a => new Float32Array(a.map(x => x / 255));

I.customArms.F = ({ cam, shiftNdc }) => {
  const U = prog.U, st = I.state, Lt = st.light;
  gl.useProgram(prog.p); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, I.instBuf); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(4, 1);
  gl.uniformMatrix4fv(U.u_matrix, false, cam.M); gl.uniform2f(U.u_shift, shiftNdc[0], shiftNdc[1]);
  gl.uniform3fv(U.u_lightpos, Lt.lightpos); gl.uniform3fv(U.u_lightcolor, Lt.lightcolor); gl.uniform1f(U.u_lightintensity, Lt.lightintensity); gl.uniform1f(U.u_materialP, Lt.materialP); gl.uniform1f(U.u_opacity, Lt.opacity);
  for (const t of pkgMeta.tones) { gl.uniform3fv(U['u_' + t.id + 'Day'], f3(t.day)); gl.uniform3fv(U['u_' + t.id + 'Gold'], f3(t.gold)); gl.uniform3fv(U['u_' + t.id + 'Nit'], f3(t.night)); }
  gl.uniform3fv(U.u_cam, cam.eye); gl.uniform1f(U.u_aa, st.aa); gl.uniform1f(U.u_parallax, st.parallax); gl.uniform1f(U.u_alpha, 1.0); gl.uniform1f(U.u_count, st.count);
  gl.drawElementsInstanced(gl.TRIANGLES, IDX.length, gl.UNSIGNED_SHORT, 0, I.getInstCount());
};
L.facet = { shaderBytes: vs.length + fs.length, wallPackageBytes: V.byteLength + IDX.byteLength, triangles: IDX.length / 3, walls: pkgMeta.faces.length };
window.__facetReady = true;
