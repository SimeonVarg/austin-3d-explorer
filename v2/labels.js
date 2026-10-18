// Building and apartment names over the city, and the card a click on a building opens.
//   - every Blender model by its name (v2/tiles/manifest.json), every apartment the finder knows (data/finder/homes.json), every
//     UT building the walking graph knows by its code;
//   - placed over the roof, nearest first, never two on top of each other, at most LABELS.MAX on screen;
//   - a click on a building (or its name) opens a small card: what it is, how tall, and for an apartment its walks to class
//     (the finder) or, for a UT building, a walk to it.
// Every look is a token here or in v2.css (.v2-label, #card).
import * as THREE from 'three';
import { toLocal } from './geo.js';

export const LABELS = {
  MAX: 26, MAX_PHONE: 12,              // names on screen at once
  NEAR_M: 60, FAR_M: 2600,             // camera distance range a name shows in
  FAR_LANDMARK_M: 4200,                // tall landmarks (over LANDMARK_TOP_M) show further out
  LANDMARK_TOP_M: 60,
  PAD_PX: 6,                           // free space kept round each name
  CHAR_PX: 7.2, LINE_PX: 16,           // size estimate of a name, before it is measured
  UPDATE_MS: 120,                      // at most this often while the camera moves
  PICK_RADIUS_M: 45,                   // a click picks the nearest named building within this of the point hit
  CAMPUS_LABEL_Y_M: 18,                // a UT building has no height in the graph: its name sits this high
  HOME_LABEL_Y_M: 24,
  KIND: { blender: 'Building', home: 'Apartment', campus: 'UT building' },
  // At street level (the street lane, 2026-10-18; owner: names "crowd the whole view"): below LOW_CAMERA_M of camera height the
  // names thin out hard: only what is near (LOW_FAR_MIN_M, or LOW_FAR_PER_M per metre of height) or a landmark within
  // LOW_LANDMARK_M, at most LOW_MAX of them, and near names are allowed (LOW_NEAR_M) since that is what a walker reads.
  LOW_CAMERA_M: 40, LOW_FAR_MIN_M: 130, LOW_FAR_PER_M: 6, LOW_LANDMARK_M: 700, LOW_MAX: 5, LOW_MAX_PHONE: 3, LOW_NEAR_M: 12,
};

export class Labels {
  constructor({ camera, canvas, container, scene, pickRoots, onCard, phone }) {
    Object.assign(this, { camera, canvas, container, scene, pickRoots, onCard, phone });
    this.items = []; this.pool = []; this.last = 0; this.v = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.layer = document.createElement('div'); this.layer.id = 'labels'; container.append(this.layer);
    this.card = document.getElementById('card');
  }
  // [{ id, name, sub, kind, x, z, y, top, home, code }]
  add(list) {
    const seen = new Set(this.items.map((i) => i.name.toLowerCase()));
    for (const it of list) { const k = it.name.toLowerCase(); if (seen.has(k)) { const o = this.items.find((i) => i.name.toLowerCase() === k); if (o) { o.home ||= it.home; o.code ||= it.code; o.sub ||= it.sub; } continue; } seen.add(k); this.items.push(it); }
    this.dirty = true;
  }
  update(now, force = false) {
    // called every frame: works only when the camera or the list changed, and at most every UPDATE_MS
    const key = this.camera.matrixWorld.elements.join(',') + this.canvas.clientWidth + 'x' + this.canvas.clientHeight;
    if (!force && !this.dirty && key === this.key) return;
    if (!force && now - this.last < LABELS.UPDATE_MS) return;
    this.last = now; this.dirty = false; this.key = key;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight, cam = this.camera.position;
    const low = cam.y < LABELS.LOW_CAMERA_M;
    const lowFar = Math.max(LABELS.LOW_FAR_MIN_M, cam.y * LABELS.LOW_FAR_PER_M);
    const cand = [];
    for (const it of this.items) {
      const d = Math.hypot(it.x - cam.x, it.y - cam.y, it.z - cam.z);
      const landmark = (it.top || 0) >= LABELS.LANDMARK_TOP_M;
      const far = low ? (landmark ? LABELS.LOW_LANDMARK_M : lowFar) : (landmark ? LABELS.FAR_LANDMARK_M : LABELS.FAR_M);
      if (d < (low ? LABELS.LOW_NEAR_M : LABELS.NEAR_M) || d > far) continue;
      this.v.set(it.x, it.y, it.z).project(this.camera);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      // nearer first; tall ones a little earlier; a selected one first of all
      cand.push({ it, d, x: (this.v.x + 1) / 2 * W, y: (1 - this.v.y) / 2 * H, score: d / (1 + (it.top || 0) / 80) - (it === this.selected ? 1e9 : 0) });
    }
    cand.sort((a, b) => a.score - b.score);
    const placed = [], P = LABELS.PAD_PX;
    const max = low ? (this.phone ? LABELS.LOW_MAX_PHONE : LABELS.LOW_MAX) : (this.phone ? LABELS.MAX_PHONE : LABELS.MAX);
    for (const c of cand) {
      if (placed.length >= max) break;
      const w = (c.it.w || c.it.name.length * LABELS.CHAR_PX) + P * 2, h = (c.it.h || LABELS.LINE_PX) + P * 2;
      const r = [c.x - w / 2, c.y - h, c.x + w / 2, c.y];
      if (r[0] < 0 || r[2] > W || r[1] < 56) continue;            // keep clear of the edges and the title bar
      if (placed.some((q) => r[0] < q.r[2] && r[2] > q.r[0] && r[1] < q.r[3] && r[3] > q.r[1])) continue;
      placed.push({ ...c, r });
    }
    while (this.pool.length < placed.length) {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'v2-label'; el.tabIndex = -1;
      el.addEventListener('click', (e) => { e.stopPropagation(); if (el._it) this.open(el._it); });
      this.layer.append(el); this.pool.push(el);
    }
    this.pool.forEach((el, i) => {
      const p = placed[i];
      if (!p) { el.hidden = true; el._it = null; return; }
      el.hidden = false;
      if (el._it !== p.it) {
        el._it = p.it; el.textContent = p.it.name; el.dataset.kind = p.it.home ? 'home' : p.it.kind;
        if (p.it.sub) { const s = document.createElement('small'); s.textContent = p.it.sub; el.append(s); }
        const b = el.getBoundingClientRect(); p.it.w = b.width; p.it.h = b.height;
      }
      el.classList.toggle('far', p.d > LABELS.FAR_M * 0.6);
      el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-100%)`;
    });
    this.shown = placed.length;
  }
  // a click on the canvas: the named building nearest the point the ray hits
  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(this.pickRoots(), true).filter((h) => h.object.visible && !h.object.isInstancedMesh);
    let p;
    if (hits.length) p = hits[0].point;
    else { const o = this.ray.ray.origin, d = this.ray.ray.direction; if (d.y >= 0) return this.close(); const t = -o.y / d.y; p = o.clone().addScaledVector(d, t); }
    let best = null, bd = LABELS.PICK_RADIUS_M;
    for (const it of this.items) { const d = Math.hypot(it.x - p.x, it.z - p.z); if (d < bd) { bd = d; best = it; } }
    if (best) this.open(best); else this.close();
  }
  open(it) { this.selected = it; this.dirty = true; this.onCard(it); }
  close() { this.selected = null; this.dirty = true; this.onCard(null); }
}

// the label list from what v2 already loads
export function blenderItems(manifest) {
  // A name that ends in the map outline's id, "Gabled walk-up (07ebbe8f)", is the builders' description of a building nobody has
  // named: it is not a name, so it gets no label.
  const working = (n) => /\(?\b[0-9a-f]{8}\b\)?\s*$/i.test(String(n)) && /[0-9]/.test(String(n).slice(-8));
  return Object.entries(manifest?.buildings || {}).filter(([, b]) => b.name && !working(b.name))
    .map(([slug, b]) => ({ id: slug, name: b.name, kind: 'blender', x: b.x, z: b.z, y: (b.top || 20) + 4, top: b.top || 0 }));
}
export function homeItems(homes, manifest) {
  return homes.map((h) => {
    const m = h.model && manifest?.buildings?.[h.model];
    const [x, z] = m ? [m.x, m.z] : toLocal(h.p[0], h.p[1]);
    return { id: h.id, name: h.name, kind: 'home', sub: h.addr || '', x, z, y: (m?.top || LABELS.HOME_LABEL_Y_M) + 4, top: m?.top || 0, home: h };
  });
}
export function campusItems(buildings, doors) {
  return buildings.filter((b) => b.doors.length).map((b) => {
    let x = 0, z = 0; for (const d of b.doors) { x += doors[d][0]; z += doors[d][1]; }
    x /= b.doors.length; z /= b.doors.length;
    return { id: b.code, name: b.name, sub: b.code, kind: 'campus', code: b.code, x, z, y: LABELS.CAMPUS_LABEL_Y_M, top: 0 };
  });
}
