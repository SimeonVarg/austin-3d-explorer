/**
 * layer.js — everything the race draws in 3D: the rings, the craft, the ghost,
 * a trail of dots to the next ring, a few wind streaks. One three.js scene in
 * one MapLibre custom layer, built the way js/slopes.js builds its layer (read
 * its header, "THE CONTRACT": mainMatrix, one local origin, the single
 * reflection in the camera matrix, three's renderer built inside the first
 * render() and never sized, autoClear off, resetState before every render).
 *
 * UNLIT on purpose. A ring has to read against sky, glass and shadow, by day
 * and by night, from 600 m at 90 m/s, and a lit material changes with the hour.
 * Colours are written straight (setRGB, linear working space, linear output) so
 * a ring is the colour AIR.look says it is.
 *
 * Positions go through MapLibre's own MercatorCoordinate from lng/lat, so a
 * ring lands on the pixel the map itself would put that point on.
 */
(function (root, factory) {
  root.AirLayer = factory(root.AIR, root.AirGeo);
})(typeof self !== 'undefined' ? self : this, function (AIR, G) {
  'use strict';
  const RAD = G.RAD;
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  function create(map, opts) {
    opts = opts || {};
    const LOOK = AIR.look;
    let T = null, renderer = null, scene = null, camera = null, rings = [], craft = null, ghost = null, trail = null, streaks = null;
    let originMerc = null, originScale = 0, _mat = null, _loc = null, _s3 = null;
    let gates = [], frame = null, added = false, lastDraw = 0;
    const toLocal = (x, y, z) => {            // game-local metres -> layer-local metres (east, north, up of the origin)
      const ll = G.toLngLat(x, y), m = maplibregl.MercatorCoordinate.fromLngLat(ll, 0);
      return [(m.x - originMerc.x) / originScale, -(m.y - originMerc.y) / originScale, z];
    };
    const mk = (geo, col, o) => { o = Object.assign({}, o || {}); const add = !!o.additive; delete o.additive;
      const m = new T.MeshBasicMaterial(Object.assign({ side: T.DoubleSide, transparent: o.opacity < 1, opacity: 1, depthWrite: !add }, o));
      m.color.setRGB(col[0], col[1], col[2]); return new T.Mesh(geo, m); };

    function craftGeometry() {
      // a small delta glider, +Y forward, +X right, +Z up, ~7 m long
      const v = [
        [0, 4.2, 0], [-3.3, -2.6, 0.15], [0, -1.4, 0.35],        // left wing
        [0, 4.2, 0], [0, -1.4, 0.35], [3.3, -2.6, 0.15],         // right wing
        [0, 4.2, 0], [0, -1.4, 0.35], [0, -2.4, 1.9],            // fin
        [0, 4.2, 0], [0.0, -1.4, -0.5], [-1.3, -1.9, -0.1],      // belly (left)
        [0, 4.2, 0], [1.3, -1.9, -0.1], [0.0, -1.4, -0.5],       // belly (right)
      ];
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(v.flat(), 3));
      g.setIndex([...Array(v.length).keys()]);
      return g;
    }
    function ringGeometry(r, tube, tubular) { return new T.TorusGeometry(r, tube, 8, tubular || 56); }
    function basis(g) {                        // ring plane vertical, normal = the axis. X = -perp so X x Y = normal (right-handed: no winding flip)
      const m = new T.Matrix4(), s = Math.sin(g.yaw * RAD), c = Math.cos(g.yaw * RAD);
      m.makeBasis(new T.Vector3(-c, s, 0), new T.Vector3(0, 0, 1), new T.Vector3(s, c, 0));
      return m;
    }

    function build() {
      T = window.THREE;
      scene = new T.Scene(); camera = new T.Camera();
      originMerc = maplibregl.MercatorCoordinate.fromLngLat({ lng: AIR.origin.lng, lat: AIR.origin.lat }, 0);
      originScale = originMerc.meterInMercatorCoordinateUnits();
      _mat = new T.Matrix4(); _loc = new T.Matrix4(); _s3 = new T.Vector3(originScale, -originScale, originScale);
      // craft + ghost
      const cg = craftGeometry();
      craft = new T.Group(); craft.add(mk(cg, hex('#ffd36b'))); const tl = mk(new T.SphereGeometry(0.55, 6, 4), hex('#ff5a3c')); tl.position.set(0, -2.7, 0.6); craft.add(tl);
      craft.scale.setScalar(1.7); scene.add(craft);
      ghost = new T.Group(); ghost.add(mk(cg, hex(LOOK.ghostColour), { opacity: 0.62 })); ghost.scale.setScalar(1.7); ghost.visible = false; scene.add(ghost);
      // guide trail: dots from the craft toward the next ring
      const N = 14, pos = new Float32Array(N * 3), tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pm = new T.PointsMaterial({ size: 7, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }); pm.color.setRGB(...hex(LOOK.gateNextColour));
      trail = new T.Points(tg, pm); trail.frustumCulled = false; trail.userData.n = N; scene.add(trail);
      // wind streaks
      const SN = LOOK.streakCount, sp = new Float32Array(SN * 6), sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
      const sm = new T.LineBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false }); sm.color.setRGB(1, 1, 1);
      streaks = new T.LineSegments(sg, sm); streaks.frustumCulled = false; streaks.userData.n = SN; streaks.userData.seed = Array.from({ length: SN }, (_, i) => [Math.sin(i * 12.9898) * 43758.5453 % 1, Math.sin(i * 78.233) * 12345.678 % 1, Math.sin(i * 39.346) * 9876.54 % 1, (i * 0.37) % 1]);
      scene.add(streaks);
      if (gates.length) buildRings();
    }
    function buildRings() {
      for (const r of rings) scene.remove(r.group);
      rings = gates.map((g, i) => {
        const group = new T.Group(), last = i === gates.length - 1;
        const tube = AIR.gates.tubeRadius * (last ? 1.4 : 1) * Math.max(1, g.r / 20);
        const body = mk(ringGeometry(g.r, tube), hex(LOOK.gateColour)), halo = mk(ringGeometry(g.r, tube * 3.2), hex(LOOK.gateColour), { opacity: 0.16, additive: true, blending: T.AdditiveBlending });
        group.add(body); group.add(halo);
        if (last) { const inner = mk(ringGeometry(g.r * 0.82, tube * 0.7), hex('#ffffff')); group.add(inner); }
        const p = toLocal(g.x, g.y, g.z); group.position.set(p[0], p[1], p[2]);
        group.quaternion.setFromRotationMatrix(basis(g));
        group.matrixAutoUpdate = true; scene.add(group);
        return { group, body, halo, g, state: '', base: 1 };
      });
    }

    const layer = {
      id: 'air-race', type: 'custom', renderingMode: '3d',
      onAdd() {}, onRemove() { try { if (renderer) renderer.dispose(); } catch (e) {} renderer = null; },
      render(gl, args) {
        if (!window.THREE || !frame || gl.isContextLost()) return;
        if (!scene) build();
        if (!renderer) { renderer = new T.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: false }); renderer.autoClear = false; if ('outputColorSpace' in renderer) renderer.outputColorSpace = T.LinearSRGBColorSpace; }
        const M = args.defaultProjectionData && args.defaultProjectionData.mainMatrix; if (!M) return;
        apply(frame);
        _mat.fromArray(M); _loc.makeTranslation(originMerc.x, originMerc.y, originMerc.z).scale(_s3);
        camera.projectionMatrix.copy(_mat.multiply(_loc)); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        renderer.resetState(); renderer.render(scene, camera);
      },
    };

    const _q = null;
    function poseTo(obj, x, y, z, yaw, pitch, roll) {
      const p = toLocal(x, y, z); obj.position.set(p[0], p[1], p[2]);
      const qz = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -yaw * RAD);
      const qx = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), pitch * RAD);
      const qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), roll * RAD);
      obj.quaternion.copy(qz.multiply(qx).multiply(qy));
    }
    const col = { gate: hex(LOOK.gateColour), next: hex(LOOK.gateNextColour), done: hex(LOOK.gateDoneColour), miss: hex(LOOK.gateMissColour), finish: hex('#fff3b0') };
    /** Push one frame's state into the scene (called inside render so it is always current). */
    function apply(f) {
      const c = f.craft;
      craft.visible = f.showCraft !== false;
      poseTo(craft, c.x, c.y, c.z, c.yaw, c.pitch, c.roll);
      if (f.ghost) { ghost.visible = true; poseTo(ghost, f.ghost.x, f.ghost.y, f.ghost.z, f.ghost.yaw, f.ghost.pitch, f.ghost.roll || 0); } else ghost.visible = false;
      const pulse = 1 + 0.05 * Math.sin(f.clock * 5);
      rings.forEach((r, i) => {
        const st = f.states[i] || 'todo';
        let key = st === 'hit' ? 'done' : st === 'miss' ? 'miss' : i === f.next ? 'next' : (i === gates.length - 1 ? 'finish' : 'gate');
        if (key !== r.state) { r.state = key; const c3 = col[key]; r.body.material.color.setRGB(c3[0], c3[1], c3[2]); r.halo.material.color.setRGB(c3[0], c3[1], c3[2]); r.halo.material.opacity = key === 'done' ? 0.05 : key === 'next' ? 0.30 : 0.16; }
        const near = i === f.next, ahead = i - f.next;
        r.group.scale.setScalar(near ? pulse : 1);
        r.group.visible = !(st === 'hit' && i < f.next - 2) && ahead < 8;
      });
      // trail
      const nx = rings[Math.min(f.next, rings.length - 1)];
      if (nx && f.showTrail) {
        const g = nx.g, dx = g.x - c.x, dy = g.y - c.y, dz = g.z - c.z, d = Math.hypot(dx, dy, dz), n = trail.userData.n, span = Math.min(d, 420), arr = trail.geometry.attributes.position.array;
        for (let k = 0; k < n; k++) { const u = (36 + (k + (f.clock * 1.6 % 1)) * (span - 36) / n) / (d || 1); const p = toLocal(c.x + dx * u, c.y + dy * u, c.z + dz * u); arr[k * 3] = p[0]; arr[k * 3 + 1] = p[1]; arr[k * 3 + 2] = p[2]; }
        trail.geometry.attributes.position.needsUpdate = true; trail.visible = d > 60;
      } else trail.visible = false;
      // streaks
      const s = f.speedFrac;
      streaks.visible = !!f.showStreaks && s > 0.2; streaks.material.opacity = Math.min(0.5, (s - 0.2) * 0.9);
      if (streaks.visible) {
        const arr = streaks.geometry.attributes.position.array, SN = streaks.userData.n, sd = streaks.userData.seed;
        const fx = Math.sin(c.yaw * RAD) * Math.cos(c.pitch * RAD), fy = Math.cos(c.yaw * RAD) * Math.cos(c.pitch * RAD), fz = Math.sin(c.pitch * RAD);
        const len = 6 + 22 * s;
        for (let k = 0; k < SN; k++) {
          const a = sd[k]; const lat = (a[0] * 2 - 1) * 26, up = (a[1] * 2 - 1) * 14, ph = ((a[3] + f.clock * (0.6 + 0.5 * s) * 1.3) % 1);
          const along = 30 - ph * 80;                // streaks slide from ahead to behind the craft
          const rx = fy, ry = -fx;                    // right vector (horizontal)
          const X = c.x + fx * along + rx * lat, Y = c.y + fy * along + ry * lat, Z = c.z + fz * along + up;
          const p0 = toLocal(X, Y, Z), p1 = toLocal(X - fx * len, Y - fy * len, Z - fz * len);
          arr[k * 6] = p0[0]; arr[k * 6 + 1] = p0[1]; arr[k * 6 + 2] = p0[2]; arr[k * 6 + 3] = p1[0]; arr[k * 6 + 4] = p1[1]; arr[k * 6 + 5] = p1[2];
        }
        streaks.geometry.attributes.position.needsUpdate = true;
      }
    }

    return {
      /** Add the layer (once the map has a style) and remember the gates; rings are built on the first render. */
      setCourse(g) { gates = g; if (scene) buildRings(); },
      add() { if (added) return; added = true; try { map.addLayer(layer); } catch (e) { console.warn('[air] layer add failed', e); added = false; } },
      /** Everything the next frame draws. */
      frame(f) { frame = f; },
      remove() { try { if (map.getLayer('air-race')) map.removeLayer('air-race'); } catch (e) {} added = false; },
      layer,
    };
  }
  return { create };
});
