// Building and apartment names over the city, and the card a click on a building opens.
//   - every Blender model by its name (v2/tiles/manifest.json), every apartment the finder knows (data/finder/homes.json), every
//     UT building the walking graph knows by its code;
//   - placed over the roof, nearest first, never two on top of each other, at most LABELS.MAX on screen;
//   - a name moves WITH its building: every name on screen is projected again on every frame the camera moves (cheap: a few
//     dozen points). Only the choice of WHICH names show (the declutter) runs at most every LAYOUT_MS; a name that leaves that
//     choice, or comes into it, fades (FADE_MS) instead of popping. (Owner, 2026-10-18: "the names for buildings update every
//     like 200 miliseconds fix that".)
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
  LAYOUT_MS: 120,                      // which names show is decided again at most this often while the camera moves
  FADE_MS: 220,                        // a name fades in or out over this (v2.css .v2-label transition: keep them equal)
  EDGE_PX: 2,                          // a shown name whose point leaves the screen by more than this is hidden at once (no fade)
  PICK_RADIUS_M: 45,                   // a click picks the nearest named building within this of the point hit
  CAMPUS_LABEL_Y_M: 18,                // a UT building has no height in the graph: its name sits this high
  HOME_LABEL_Y_M: 24,
  KIND: { blender: 'Building', home: 'Apartment', campus: 'UT building' },
  // At street level (the street lane, 2026-10-18; owner: names "crowd the whole view"): below LOW_CAMERA_M of camera height the
  // names thin out hard: only what is near (LOW_FAR_MIN_M, or LOW_FAR_PER_M per metre of height) or a landmark within
  // LOW_LANDMARK_M, at most LOW_MAX of them, and near names are allowed (LOW_NEAR_M) since that is what a walker reads.
  LOW_CAMERA_M: 40, LOW_FAR_MIN_M: 130, LOW_FAR_PER_M: 6, LOW_LANDMARK_M: 700, LOW_MAX: 5, LOW_MAX_PHONE: 3, LOW_NEAR_M: 12, LOW_ABOVE_EYE_M: 2,
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
    // called every frame, before the frame is drawn. The camera's matrices are brought up to date first: the frame loop moves
    // the camera after the last draw, and projecting with last frame's matrix is exactly a name lagging one frame behind.
    const cam = this.camera;
    cam.updateMatrixWorld();
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const key = cam.matrixWorld.elements.join(',') + cam.projectionMatrix.elements[0] + W + 'x' + H;
    const moved = key !== this.key;
    this.key = key;
    if (force || this.dirty || (moved && now - this.last >= LABELS.LAYOUT_MS) || (this.pendingLayout && now - this.last >= LABELS.LAYOUT_MS)) {
      this.layout(now, W, H);
      this.pendingLayout = false;
    } else if (moved) this.pendingLayout = true;     // the last move before a stop gets its layout too
    if (moved || this.placedNow) this.place(W, H);
    this.placedNow = false;
    this.reap(now);
  }

  // project one item; null when it is behind the camera
  screenOf(it, W, H) {
    const cam = this.camera.position;
    this.v.set(it.x - cam.x, it.y - cam.y, it.z - cam.z);
    if (this.v.dot(this.fwd) <= 0) return null;
    this.v.set(it.x, it.y, it.z).project(this.camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return { x: (this.v.x + 1) / 2 * W, y: (1 - this.v.y) / 2 * H, ndcX: this.v.x, ndcY: this.v.y };
  }

  // which names show: nearest and tallest first, decluttered (the expensive half; throttled)
  layout(now, W, H) {
    this.last = now; this.dirty = false;
    const cam = this.camera.position;
    const low = cam.y < LABELS.LOW_CAMERA_M;
    const lowFar = Math.max(LABELS.LOW_FAR_MIN_M, cam.y * LABELS.LOW_FAR_PER_M);
    this.fwd = this.camera.getWorldDirection(this.fwd || (this.fwd = new THREE.Vector3()));
    const cand = [];
    for (const it of this.items) {
      const d = Math.hypot(it.x - cam.x, it.y - cam.y, it.z - cam.z);
      const landmark = (it.top || 0) >= LABELS.LANDMARK_TOP_M;
      const far = low ? (landmark ? LABELS.LOW_LANDMARK_M : lowFar) : (landmark ? LABELS.FAR_LANDMARK_M : LABELS.FAR_M);
      if (d < (low ? LABELS.LOW_NEAR_M : LABELS.NEAR_M) || d > far) continue;
      // a name sits over a roof: at street level one whose point is not above the eye lies on the road (some items carry no height)
      if (low && it.y < cam.y + LABELS.LOW_ABOVE_EYE_M) continue;
      // behind the camera? (with v2's reversed depth buffer a point behind the eye can project to a z inside [-1, 1] and show
      // mirrored on the screen: seen at street level on Guadalupe, 2026-10-18, with names of buildings 600 m behind)
      const p = this.screenOf(it, W, H);
      if (!p || Math.abs(p.ndcX) > 1.05 || Math.abs(p.ndcY) > 1.05) continue;
      // nearer first; tall ones a little earlier; a selected one first of all
      cand.push({ it, d, x: p.x, y: p.y, score: d / (1 + (it.top || 0) / 80) - (it === this.selected ? 1e9 : 0) });
    }
    cand.sort((a, b) => a.score - b.score);
    const placed = [], P = LABELS.PAD_PX;
    const max = low ? (this.phone ? LABELS.LOW_MAX_PHONE : LABELS.LOW_MAX) : (this.phone ? LABELS.MAX_PHONE : LABELS.MAX);
    // a name already showing keeps its place against a newcomer of nearly the same rank (no flicker between two names)
    const showing = new Set(this.live ? [...this.live.keys()] : []);
    cand.forEach((c) => { if (showing.has(c.it)) c.score -= Math.abs(c.score) * 0.15 + 1; });
    cand.sort((a, b) => a.score - b.score);
    for (const c of cand) {
      if (placed.length >= max) break;
      const w = (c.it.w || c.it.name.length * LABELS.CHAR_PX) + P * 2, h = (c.it.h || LABELS.LINE_PX) + P * 2;
      const r = [c.x - w / 2, c.y - h, c.x + w / 2, c.y];
      if (r[0] < 0 || r[2] > W || r[1] < 56) continue;            // keep clear of the edges and the title bar
      if (placed.some((q) => r[0] < q.r[2] && r[2] > q.r[0] && r[1] < q.r[3] && r[3] > q.r[1])) continue;
      placed.push({ ...c, r });
    }
    // the live set: item -> element. New ones get an element and fade in; ones that left fade out (reap() returns them).
    this.live ||= new Map();
    const want = new Set(placed.map((p) => p.it));
    for (const [it, el] of this.live) if (!want.has(it) && el._on) { el._on = false; el._offAt = now; el.classList.remove('on'); }
    for (const p of placed) {
      let el = this.live.get(p.it);
      if (!el) {
        el = this.pool.pop() || this.makeEl();
        el._it = p.it; el.textContent = p.it.name; el.dataset.kind = p.it.home ? 'home' : p.it.kind;
        if (p.it.sub) { const s = document.createElement('small'); s.textContent = p.it.sub; el.append(s); }
        el.hidden = false; el.classList.remove('on');
        if (!p.it.w) { const b = el.getBoundingClientRect(); p.it.w = b.width; p.it.h = b.height; }
        this.live.set(p.it, el);
        el._fresh = true;
      }
      el._d = p.d;
      if (!el._on) { el._on = true; el._offAt = 0; }
    }
    this.shown = placed.length;
    this.placedNow = true;
  }

  makeEl() {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'v2-label'; el.tabIndex = -1;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (el._it) this.open(el._it); });
    this.layer.append(el);
    return el;
  }

  // every frame the camera moved: each live name to its building's point on screen (the cheap half)
  place(W, H) {
    if (!this.live) return;
    this.fwd = this.camera.getWorldDirection(this.fwd || (this.fwd = new THREE.Vector3()));
    const E = LABELS.EDGE_PX;
    for (const [it, el] of this.live) {
      const p = this.screenOf(it, W, H);
      const off = !p || p.x < -E || p.x > W + E || p.y < -E || p.y > H + E;
      if (off) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = '';
      el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-100%)`;
      el.classList.toggle('far', (el._d || 0) > LABELS.FAR_M * 0.6);
      if (el._fresh) {
        // first placement: the element starts transparent where it belongs, then fades in on the next style pass
        el._fresh = false; void el.offsetWidth;
      }
      if (el._on) el.classList.add('on');
    }
  }

  // names that faded out go back to the pool
  reap(now) {
    if (!this.live) return;
    for (const [it, el] of this.live) {
      if (el._on || !el._offAt || now - el._offAt < LABELS.FADE_MS + 40) continue;
      this.live.delete(it);
      el.hidden = true; el._it = null; el._offAt = 0; el.textContent = ''; el.style.visibility = '';
      this.pool.push(el);
    }
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
