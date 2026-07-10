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
  // Remove all layers that depend on this source (order: top → bottom)
  if (map.getLayer('buildings-labels'))     map.removeLayer('buildings-labels');
  if (map.getLayer('buildings-signs-glow')) map.removeLayer('buildings-signs-glow');
  if (map.getLayer('buildings-3d'))         map.removeLayer('buildings-3d');
  if (map.getSource('austin-buildings'))    map.removeSource('austin-buildings');

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

    // Re-apply the current time-of-day mood so the new buildings + sign glow
    // match the rest of the scene (colour ramp, sign glow, etc.). This also
    // covers the debug case: applyTimeOfDay skips the building ramp while
    // window.__debugActive is set, leaving the debug colouring in place.
    if (typeof applyTimeOfDay === 'function') {
      const p = (window.__todCurrentP != null)
        ? window.__todCurrentP
        : (window.TOD_DEFAULT_P != null ? window.TOD_DEFAULT_P : 0.30);
      applyTimeOfDay(map, p);
    }
  }
}
