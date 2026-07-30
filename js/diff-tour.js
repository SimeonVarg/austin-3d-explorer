/**
 * diff-tour.js — "What changed" flythrough for Austin 3D Explorer
 *
 * Loads a diff GeoJSON (from data/diffs/<from>_to_<to>.geojson),
 * flies the camera to each changed building in sequence, and animates
 * the extrusion height from old_height → new_height using a tween.
 *
 * The diff GeoJSON schema (written by scripts/diff_snapshots.py):
 *   Feature properties:
 *     id            — Overture building id (stable across snapshots)
 *     name          — building name (may be null)
 *     change_type   — "added" | "removed" | "height_changed"
 *     old_height    — number | null  (null for "added")
 *     new_height    — number | null  (null for "removed")
 *   Geometry: the building FOOTPRINT (Polygon / MultiPolygon), not a point —
 *   a centroid is derived here.
 *
 * Public API (called from app.js):
 *   initDiffTour(map, manifest, fromDate, toDate)
 *     Loads the right diff file and starts the tour.
 *   stopDiffTour()
 *     Stops the active tour and cleans up.
 */

(function () {
  'use strict';

  const TWEEN_DURATION_MS = 1400;  // height animation duration
  const FLY_DURATION_MS   = 1800;  // camera fly duration
  const PAUSE_MS          = 600;   // pause between fly end and height tween start

  let _map          = null;
  let _features     = [];
  let _idx          = 0;
  let _tweenRaf     = null;
  let _active       = false;

  // Exposed globally so app.js can wire the date picker
  window.initDiffTour  = initDiffTour;
  window.stopDiffTour  = stopDiffTour;

  // ── Entry point ───────────────────────────────────────────────────
  async function initDiffTour(map, manifest, fromDate, toDate) {
    stopDiffTour(); // clean up any running tour first
    _map = map;

    // Find the right diff file in the manifest
    const diffs = manifest.diffs || [];
    const fileOf = d => (d && typeof d === 'object') ? (d.file || '') : String(d);
    const match = diffs.find(d => {
      const f = fileOf(d);
      return f.includes(`${fromDate}_to_${toDate}`) || f.includes(`${toDate}_to_${fromDate}`);
    });
    // manifest paths already include the "diffs/" prefix; strip it so the fetch
    // below does not end up requesting data/diffs/diffs/...
    const diffFile = match ? fileOf(match).replace(/^diffs\//, '') : null;

    if (!diffFile) {
      showBanner(`No diff found between ${fromDate} and ${toDate}.`, true);
      return;
    }

    let geojson;
    try {
      const res = await fetch(`data/diffs/${diffFile}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      geojson = await res.json();
    } catch (err) {
      showBanner(`Could not load diff: ${err.message}`, true);
      return;
    }

    // scripts/diff_snapshots.py writes POLYGON footprints, not points. This
    // used to filter for `geometry.type === 'Point'`, so every feature was
    // discarded and the tour always reported "No changed buildings found" —
    // it had never once run. Accept whatever geometry the diff carries and
    // derive a centroid.
    _features = (geojson.features || [])
      .filter(f => f.properties && f.geometry && f.properties.change_type)
      .map(f => Object.assign({}, f, { _centre: centroidOf(f.geometry) }))
      .filter(f => f._centre);

    if (_features.length === 0) {
      showBanner('No changed buildings found in this diff.', true);
      return;
    }

    _idx    = 0;
    _active = true;

    wireBannerButtons();
    goToBuilding(_idx);
  }

  function stopDiffTour() {
    _active = false;
    _features = [];
    if (_tweenRaf) cancelAnimationFrame(_tweenRaf);
    _tweenRaf = null;
    hideBanner();
    restoreHeights();
  }

  /** Put the wall and roof-cap height expressions back the way app.js set them. */
  function restoreHeights() {
    if (!_map) return;
    if (_map.getLayer('buildings-3d')) {
      _map.setPaintProperty('buildings-3d', 'fill-extrusion-height', ['get', 'final_height']);
    }
    if (_map.getLayer('buildings-roof')) {
      _map.setPaintProperty('buildings-roof', 'fill-extrusion-height', ['+', ['get', 'final_height'], 0.4]);
      _map.setPaintProperty('buildings-roof', 'fill-extrusion-base',   ['-', ['get', 'final_height'], 1.2]);
    }
  }

  // ── Geometry ──────────────────────────────────────────────────────
  /** Mean of a footprint's outer ring. Good enough to fly a camera to. */
  function centroidOf(geom) {
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
                : geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0])
                : [];
    let x = 0, y = 0, n = 0;
    for (const ring of rings) for (const c of (ring || [])) { x += c[0]; y += c[1]; n++; }
    return n ? [x / n, y / n] : null;
  }

  // ── Navigation ────────────────────────────────────────────────────
  function goToBuilding(idx) {
    if (!_active || idx < 0 || idx >= _features.length) return;
    _idx = idx;

    const feat  = _features[idx];
    const props = feat.properties;
    const [lon, lat] = feat._centre;

    updateBanner(props, idx);

    // Fly to this building
    _map.flyTo({
      center:   [lon, lat],
      zoom:     18,
      pitch:    65,
      bearing:  _map.getBearing(),
      duration: FLY_DURATION_MS,
      essential: true,
    });

    // After fly lands, animate the height change
    _map.once('moveend', () => {
      if (!_active) return;
      setTimeout(() => {
        if (!_active) return;
        animateHeight(props.old_height, props.new_height, props.change_type);
      }, PAUSE_MS);
    });
  }

  // ── Height tween ──────────────────────────────────────────────────
  /**
   * Temporarily override the fill-extrusion-height for the focused building
   * by setting a global override that only affects its id, tweening over time.
   *
   * We use a simple approach: set the height expression to a 'case' that
   * matches the building's id and uses a JS-driven value for it, while all
   * other buildings keep ['get', 'final_height'].
   *
   * Since MapLibre expressions don't accept a live JS variable, we drive
   * the tween by calling setPaintProperty on each RAF frame — this is the
   * standard pattern for MapLibre height animations.
   */
  function animateHeight(oldH, newH, changeType) {
    if (!_map || !_map.getLayer('buildings-3d')) return;

    // Normalise: "added" means 0 → newH; "removed" means oldH → 0
    const from = (changeType === 'added')   ? 0   : (oldH  ?? 0);
    const to   = (changeType === 'removed') ? 0   : (newH  ?? 0);

    const feat   = _features[_idx];
    const bid    = feat.properties.id;
    const startTs = performance.now();

    if (_tweenRaf) cancelAnimationFrame(_tweenRaf);

    function frame(ts) {
      if (!_active) return;
      const t    = Math.min((ts - startTs) / TWEEN_DURATION_MS, 1);
      const ease = easeInOutCubic(t);
      const h    = from + (to - from) * ease;

      // Drive height for this specific building, keep others on data. The roof
      // cap has to follow, or a growing building leaves its parapet hanging in
      // mid-air at the old height.
      _map.setPaintProperty('buildings-3d', 'fill-extrusion-height', [
        'case', ['==', ['get', 'id'], bid], h, ['get', 'final_height'],
      ]);
      if (_map.getLayer('buildings-roof')) {
        _map.setPaintProperty('buildings-roof', 'fill-extrusion-height', [
          'case', ['==', ['get', 'id'], bid], h + 0.4, ['+', ['get', 'final_height'], 0.4],
        ]);
        _map.setPaintProperty('buildings-roof', 'fill-extrusion-base', [
          'case', ['==', ['get', 'id'], bid], Math.max(0, h - 1.2), ['-', ['get', 'final_height'], 1.2],
        ]);
      }

      if (t < 1) {
        _tweenRaf = requestAnimationFrame(frame);
      } else {
        _tweenRaf = null;
        restoreHeights();
      }
    }

    _tweenRaf = requestAnimationFrame(frame);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ── Banner ────────────────────────────────────────────────────────
  function wireBannerButtons() {
    const prev = document.getElementById('diff-prev');
    const next = document.getElementById('diff-next');
    const exit = document.getElementById('diff-exit');
    if (prev) prev.onclick = () => goToBuilding(_idx - 1);
    if (next) next.onclick = () => goToBuilding(_idx + 1);
    if (exit) exit.onclick = stopDiffTour;
  }

  function updateBanner(props, idx) {
    const banner  = document.getElementById('diff-banner');
    const info    = document.getElementById('diff-info');
    const counter = document.getElementById('diff-counter');
    if (!banner) return;

    const name  = props.name || 'Unnamed building';
    const type  = props.change_type;
    const oldH  = props.old_height != null ? `${Math.round(props.old_height)} m` : '—';
    const newH  = props.new_height != null ? `${Math.round(props.new_height)} m` : '—';

    let desc;
    if (type === 'added')          desc = `New building`;
    else if (type === 'removed')   desc = `Building removed`;
    else                           desc = `Height: ${oldH} → ${newH}`;

    if (info) info.textContent = `${name}\n${desc}`;
    if (counter) counter.textContent = `${idx + 1} / ${_features.length}`;

    // Update prev/next enabled state
    const prev = document.getElementById('diff-prev');
    const next = document.getElementById('diff-next');
    if (prev) prev.disabled = idx === 0;
    if (next) next.disabled = idx === _features.length - 1;

    banner.classList.remove('hidden');
  }

  function showBanner(msg, autoHide) {
    const banner = document.getElementById('diff-banner');
    const info   = document.getElementById('diff-info');
    const ctrl   = document.getElementById('diff-controls');
    if (!banner) return;
    if (info)  info.textContent = msg;
    if (ctrl)  ctrl.style.display = 'none';
    banner.classList.remove('hidden');
    if (autoHide) setTimeout(hideBanner, 3500);
  }

  function hideBanner() {
    const banner = document.getElementById('diff-banner');
    const ctrl   = document.getElementById('diff-controls');
    if (banner) banner.classList.add('hidden');
    if (ctrl)   ctrl.style.display = '';
  }
})();
