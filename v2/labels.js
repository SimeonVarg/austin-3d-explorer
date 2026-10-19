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
  // One building, one name (2026-10-19 demo walk: "Rowling Hall" over "Robert B. Rowling Hall", "Will C. Hogg Bldg." over "Will
  // C. Hogg Building", "AT&T Executive Educ & Conf Center" printed on "AT&T Executive Education and Conference Center"). Two names
  // within SAME_M of each other are one building when every word of the shorter one is in the longer one (a word may be cut
  // short, "Educ" for "Education", or be the longer one's initials, "DKR"). The name added first is kept (the Blender models'
  // names come first, then the apartments, then the UT buildings); the other one gives it its code and address.
  SAME_M: 150, SAME_MIN_WORDS: 2,
  SAME_ABBR: { bldg: 'building', ctr: 'center', cntr: 'center', educ: 'education', conf: 'conference', univ: 'university', lab: 'laboratory', labs: 'laboratories', st: 'street', ave: 'avenue', tx: 'texas' },
  SAME_SKIP: ['the', 'and', 'of', 'at', 'for'],
  // A name shows only when its point can be seen: a building between the camera and the name hides it (names of buildings behind
  // the Tower were drawn on its shaft). Tested on the camera's collision outlines and tops (flycam.js CollisionField), not on the
  // GPU: a march along the ray (about STEPS samples, each STEP_MIN_M to STEP_MAX_M apart), only where the ray is lower than the
  // tallest top in that 32 m square, and only in the throttled layout. The name's own building (its map outlines, or any outline
  // within OWN_M of its point) never hides it; an outline must stand MARGIN_M above the ray.
  OCCLUDE: { ON: true, STEPS: 120, STEP_MIN_M: 3, STEP_MAX_M: 12, OWN_M: 30, MARGIN_M: 1, MODEL_TOP_M: 255, REUSE: 0.02, BUDGET_MS: 3 },
  // A number pin of the finder (maplite.js MarkerLayer) on a name: the name moves up above the pin if there is room, else it hides
  // until the pin moves off it.
  OBSTACLE_GAP_PX: 2,
  LIFT_ABOVE_M: 4, TOP_BAND_PX: 56, LANDMARK_SLIDE_MIN: 0.35,
                                       // (a landmark's name slides down to stay on screen: below the title band, at least this share of its height up)
                    // a name lifted onto a Blender model's top sits this far above it (as the models' own names)
};

// words of a name, for "is this the same building": lower case, & = and, abbreviations spelt out, initials joined ("T. S." = "ts")
function words(name) {
  const w = String(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < w.length; i++) {
    if (/^[a-z]$/.test(w[i])) {
      let j = i, s = '';
      while (j < w.length && /^[a-z]$/.test(w[j])) s += w[j++];
      if (s.length > 1) { out.push(s); i = j - 1; continue; }
    }
    out.push(LABELS.SAME_ABBR[w[i]] || w[i]);
  }
  return out.filter((x) => !LABELS.SAME_SKIP.includes(x));
}
export function sameBuilding(a, b) {
  if (Math.hypot(a.x - b.x, a.z - b.z) > LABELS.SAME_M) return false;
  let A = words(a.name), B = words(b.name);
  if (A.join(' ') === B.join(' ')) return true;
  if (A.length > B.length) [A, B] = [B, A];
  if (A.length < LABELS.SAME_MIN_WORDS) return false;
  const initials = B.map((x) => x[0]).join('');
  return A.every((x) => B.some((y) => y === x || (x.length >= 3 && y.startsWith(x))) || (x.length >= 3 && !/[aeiou]/.test(x) && initials.includes(x)));
}

export class Labels {
  constructor({ camera, canvas, container, scene, pickRoots, onCard, phone, field, obstacles, liftOf, modelHeightAt, outlineHidden }) {
    Object.assign(this, { camera, canvas, container, scene, pickRoots, onCard, phone, field, obstacles, liftOf, modelHeightAt, outlineHidden });
    this.items = []; this.pool = []; this.last = 0; this.v = new THREE.Vector3();
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.layer = document.createElement('div'); this.layer.id = 'labels'; container.append(this.layer);
    this.card = document.getElementById('card');
  }
  // [{ id, name, sub, kind, x, z, y, top, home, code }]
  add(list) {
    this.merged ||= 0;
    for (const it of list) {
      const o = this.items.find((i) => i.name.toLowerCase() === it.name.toLowerCase() || sameBuilding(i, it));
      if (o) { o.home ||= it.home; o.code ||= it.code; o.sub ||= it.sub; if (!o.ids?.length) o.ids = it.ids; this.merged++; continue; }
      this.items.push(it);
    }
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
      // a building a Blender model stands over (main.js coverLift: Bellmont Hall under the DKR stands) has its name on the model's top
      it.y0 ??= it.y;
      if (this.liftOf) { const t = this.liftOf(it.x, it.z); it.y = t ? Math.max(it.y0, t + LABELS.LIFT_ABOVE_M) : it.y0; } else it.y = it.y0;
      // a tall landmark seen close (the Tower from 150 m): its point over the roof is above the screen, so the name slides down
      // the building to just under the top edge, never lower than LANDMARK_SLIDE_MIN of its height
      if ((it.top || 0) >= LABELS.LANDMARK_TOP_M) this.slideDown(it, W, H);
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
    const obst = this.obstacles ? this.obstacles() : [];
    const hits = (r, list) => list.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const placedR = [];
    this.occludedN = 0; this.occGen ||= 0;
    const budgetEnd = performance.now() + LABELS.OCCLUDE.BUDGET_MS;
    for (const c of cand) {
      if (placed.length >= max) break;
      // the name's real size BEFORE the overlap test (a name measured only after it was placed could sit on another one until the
      // camera next moved: the stacked names of the demo walk)
      if (!c.it.w) this.measure(c.it);
      const w = c.it.w + P * 2, h = c.it.h + P * 2;
      let r = [c.x - w / 2, c.y - h, c.x + w / 2, c.y], dy = 0;
      if (r[0] < 0 || r[2] > W || r[1] < 56) continue;            // keep clear of the edges and the title bar
      if (hits(r, placedR)) continue;
      if (obst.length && hits(r, obst)) {
        // a pin is on it: up above the pins it touches, if that place is free; else not shown
        const top = Math.min(...obst.filter((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]).map((q) => q[1]));
        dy = top - LABELS.OBSTACLE_GAP_PX - r[3];
        r = [r[0], r[1] + dy, r[2], r[3] + dy];
        if (r[1] < 56 || hits(r, obst) || hits(r, placedR)) continue;
      }
      if (this.hidden(c.it, budgetEnd)) { this.occludedN++; continue; }
      placed.push({ ...c, r, dy }); placedR.push(r);
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
        this.live.set(p.it, el);
        el._fresh = true;
      }
      el._d = p.d; el._dy = p.dy || 0;
      if (!el._on) { el._on = true; el._offAt = 0; }
    }
    this.shown = placed.length;
    this.placedNow = true;
  }

  slideDown(it, W, H) {
    const minY = LABELS.TOP_BAND_PX + (it.h || LABELS.LINE_PX * 2) + LABELS.PAD_PX * 2;
    const at = (y) => { const s = it.y; it.y = y; const p = this.screenOf(it, W, H); it.y = s; return p; };
    const p = at(it.y);
    if (p && p.y >= minY) return;                           // on screen already
    let lo = it.top * LABELS.LANDMARK_SLIDE_MIN, hi = it.y;
    const q = at(lo);
    if (!q || q.y < minY || q.y > H || q.x < 0 || q.x > W) return;   // even its lower part is off screen: leave it
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2, r = at(m); if (r && r.y >= minY) lo = m; else hi = m; }
    it.y = lo;
  }

  // a name's size on screen, once (a hidden copy of the name element; the size is kept on the item)
  measure(it) {
    if (!this.ruler) {
      this.ruler = document.createElement('div'); this.ruler.className = 'v2-label'; this.ruler.setAttribute('aria-hidden', 'true');
      this.ruler.style.visibility = 'hidden'; this.layer.append(this.ruler);
    }
    const el = this.ruler;
    el.textContent = it.name; el.dataset.kind = it.home ? 'home' : it.kind;
    if (it.sub) { const s = document.createElement('small'); s.textContent = it.sub; el.append(s); }
    const b = el.getBoundingClientRect();
    it.w = b.width || it.name.length * LABELS.CHAR_PX; it.h = b.height || LABELS.LINE_PX;
  }

  // hiddenFrom, kept for a name until the camera has moved REUSE of its distance (or the city's shapes changed: occGen), and
  // never more than BUDGET_MS of new marches in one layout (past it a name keeps its last answer)
  hidden(it, budgetEnd) {
    const O = LABELS.OCCLUDE, c = this.camera.position, C = it.occ;
    const d = Math.hypot(it.x - c.x, it.y - c.y, it.z - c.z);
    if (C && C.gen === this.occGen && C.y0 === it.y && (Math.hypot(c.x - C.x, c.y - C.y, c.z - C.z) < O.REUSE * d || performance.now() > budgetEnd)) return C.v;
    const v = this.hiddenFrom(it);
    it.occ = { x: c.x, y: c.y, z: c.z, y0: it.y, gen: this.occGen, v };
    return v;
  }

  // true when a building stands between the camera and the name's point (LABELS.OCCLUDE)
  hiddenFrom(it) {
    const F = this.field, O = LABELS.OCCLUDE;
    if (!O.ON || !F || !F.ready) return false;
    const B = F.constructor.B || 32;
    if (F.bucketTopFor !== F.polys) {                // the tallest top in every 32 m square, once per set of outlines
      F.bucketMax = new Map();
      for (const [k, list] of F.buckets) { let m = 0; for (const e of list) if (e.top > m) m = e.top; F.bucketMax.set(k, m); }
      F.topsAt = F.polys.reduce((m, e) => Math.max(m, e.top), 0); F.bucketTopFor = F.polys;
    }
    if (it.ownFor !== F.polys) {                     // the name's own outlines: its map ids, and every outline within OWN_M of its point
      it.own = new Set(); it.ownFor = F.polys;
      for (const id of it.ids || []) for (const e of F.byId.get(id) || []) it.own.add(e);
      if (it.ids?.some((id) => !F.byId.has(id))) for (const [k, list] of F.byId) if (it.ids.some((id) => k.startsWith(id + '-'))) for (const e of list) it.own.add(e);
      for (let i = Math.floor((it.x - O.OWN_M) / B); i <= Math.floor((it.x + O.OWN_M) / B); i++) for (let j = Math.floor((it.z - O.OWN_M) / B); j <= Math.floor((it.z + O.OWN_M) / B); j++) {
        for (const e of F.buckets.get(i * 65536 + j) || []) if (F.touches(e, it.x, it.z, O.OWN_M)) it.own.add(e);
      }
    }
    const o = this.camera.position, dx = it.x - o.x, dy = it.y - o.y, dz = it.z - o.z, L = Math.hypot(dx, dz);
    if (L < 1) return false;
    const step = Math.min(O.STEP_MAX_M, Math.max(O.STEP_MIN_M, L / O.STEPS));
    const ownAt = (x, z) => { for (const e of it.own) if (F.touches(e, x, z, 0)) return true; return false; };
    for (let s = step; s < L; s += step) {
      const t = s / L, h = o.y + dy * t;
      if (h + O.MARGIN_M >= Math.max(F.topsAt, O.MODEL_TOP_M)) continue;      // above every outline and every model
      const x = o.x + dx * t, z = o.z + dz * t, k = Math.floor(x / B) * 65536 + Math.floor(z / B);
      // a Blender model's real shape (main.js modelHeightAt), unless it is the name's own building
      if (this.modelHeightAt && this.modelHeightAt(x, z, h + O.MARGIN_M) > h + O.MARGIN_M && !ownAt(x, z)) return true;
      if (!(F.bucketMax.get(k) > h + O.MARGIN_M)) continue;
      for (const e of F.buckets.get(k)) {
        if (e.top <= h + O.MARGIN_M || it.own.has(e) || x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
        if (this.outlineHidden && this.outlineHidden(e)) continue;   // a plain outline a model replaces: the model decides (above)
        if (F.touches(e, x, z, 0)) return true;
      }
    }
    return false;
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
      el.style.transform = `translate(${p.x.toFixed(1)}px,${(p.y + (el._dy || 0)).toFixed(1)}px) translate(-50%,-100%)`;
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
    .map(([slug, b]) => ({ id: slug, name: b.name, kind: 'blender', x: b.x, z: b.z, y: (b.top || 20) + 4, top: b.top || 0, ids: (b.map_ids || []).map(String) }));
}
export function homeItems(homes, manifest) {
  return homes.map((h) => {
    const m = h.model && manifest?.buildings?.[h.model];
    const [x, z] = m ? [m.x, m.z] : toLocal(h.p[0], h.p[1]);
    return { id: h.id, name: h.name, kind: 'home', sub: h.addr || '', x, z, y: (m?.top || LABELS.HOME_LABEL_Y_M) + 4, top: m?.top || 0, home: h, ids: (m?.map_ids || []).map(String) };
  });
}
export function campusItems(buildings, doors) {
  return buildings.filter((b) => b.doors.length).map((b) => {
    let x = 0, z = 0; for (const d of b.doors) { x += doors[d][0]; z += doors[d][1]; }
    x /= b.doors.length; z /= b.doors.length;
    return { id: b.code, name: b.name, sub: b.code, kind: 'campus', code: b.code, x, z, y: LABELS.CAMPUS_LABEL_Y_M, top: 0 };
  });
}
