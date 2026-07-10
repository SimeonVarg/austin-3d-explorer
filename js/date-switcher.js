/**
 * date-switcher.js — Snapshot date picker for Austin 3D Explorer
 *
 * Reads data/manifest.json (already fetched by app.js and passed in),
 * renders a <select> of all available snapshot dates, and swaps the
 * PMTiles source when the user picks a different date.
 *
 * Public API (called from app.js after map load):
 *   initDateSwitcher(map, manifest, currentSnapshot, onDateChange)
 *     map            — MapLibre map instance
 *     manifest       — parsed manifest.json object
 *     currentSnapshot — the date string already loaded (e.g. "2026-07-10")
 *     onDateChange   — callback(newDate) called when user picks a new date
 */

function initDateSwitcher(map, manifest, currentSnapshot, onDateChange) {
  const panel  = document.getElementById('date-panel');
  const select = document.getElementById('date-select');
  if (!panel || !select) return;

  const snapshots = manifest.snapshots || [];
  const diffs     = manifest.diffs     || [];

  // Build a Set of dates that have a diff leading INTO them
  // (i.e. there's a before/after we can animate)
  const datesWithDiff = new Set();
  for (const d of diffs) {
    // diff filenames: "<from>_to_<to>.geojson"
    const m = d.match(/\d{4}-\d{2}-\d{2}_to_(\d{4}-\d{2}-\d{2})/);
    if (m) datesWithDiff.add(m[1]);
  }

  // Populate the <select>
  select.innerHTML = '';
  for (const date of snapshots) {
    const opt = document.createElement('option');
    opt.value       = date;
    opt.textContent = date + (datesWithDiff.has(date) ? ' ↔' : '');
    opt.selected    = date === currentSnapshot;
    select.appendChild(opt);
  }

  // Hide the panel if there's only one snapshot — nothing to switch to
  if (snapshots.length <= 1) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  select.addEventListener('change', () => {
    const newDate = select.value;
    if (newDate === currentSnapshot) return;

    const newUrl = `pmtiles://data/snapshots/${newDate}/austin.pmtiles`;

    // Swap the PMTiles source URL
    // MapLibre doesn't have a first-class "update source URL" — we remove
    // all dependent layers, remove the source, re-add it, then re-add layers.
    swapBuildingSource(map, newUrl);

    // Let app.js know so it can track the active snapshot for diff-tour
    if (typeof onDateChange === 'function') onDateChange(newDate);
  });
}

/**
 * Swap the austin-buildings PMTiles source to a new URL.
 * Preserves the layer paint/layout by re-adding them after the source swap.
 */
function swapBuildingSource(map, newUrl) {
  // Capture current paint state before removing layers
  const extrusionColor   = map.getLayer('buildings-3d')
    ? map.getPaintProperty('buildings-3d', 'fill-extrusion-color')
    : null;
  const extrusionOpacity = map.getLayer('buildings-3d')
    ? map.getPaintProperty('buildings-3d', 'fill-extrusion-opacity')
    : null;

  // Remove layers that depend on this source
  if (map.getLayer('buildings-labels')) map.removeLayer('buildings-labels');
  if (map.getLayer('buildings-3d'))     map.removeLayer('buildings-3d');
  if (map.getSource('austin-buildings')) map.removeSource('austin-buildings');

  // Re-add the source with the new URL
  map.addSource('austin-buildings', {
    type:    'vector',
    url:     newUrl,
    minzoom: 12,
    maxzoom: 16,
  });

  // Re-add layers — app.js exposes addBuildingLayers globally for this
  if (typeof addBuildingLayers === 'function') {
    addBuildingLayers(newUrl);
    // Restore any non-default paint state (e.g. debug mode was active)
    if (extrusionColor && map.getLayer('buildings-3d')) {
      map.setPaintProperty('buildings-3d', 'fill-extrusion-color',   extrusionColor);
    }
    if (extrusionOpacity && map.getLayer('buildings-3d')) {
      map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', extrusionOpacity);
    }
  }
}
