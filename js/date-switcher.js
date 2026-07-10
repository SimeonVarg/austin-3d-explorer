/**
 * date-switcher.js — Snapshot date picker for Austin 3D Explorer
 */

function initDateSwitcher(map, manifest, currentSnapshot, onDateChange) {
  const panel  = document.getElementById('date-panel');
  const select = document.getElementById('date-select');
  if (!panel || !select) return;

  const snapshots = manifest.snapshots || [];
  const datesWithDiff = new Set();
  for (const d of (manifest.diffs || [])) {
    const m = d.match(/\d{4}-\d{2}-\d{2}_to_(\d{4}-\d{2}-\d{2})/);
    if (m) datesWithDiff.add(m[1]);
  }

  select.innerHTML = '';
  for (const date of snapshots) {
    const opt = document.createElement('option');
    opt.value = date;
    opt.textContent = date + (datesWithDiff.has(date) ? ' ↔' : '');
    opt.selected = date === currentSnapshot;
    select.appendChild(opt);
  }

  if (snapshots.length <= 1) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  select.addEventListener('change', () => {
    const newDate = select.value;
    if (newDate === currentSnapshot) return;
    swapBuildingSource(map, `pmtiles://data/snapshots/${newDate}/austin.pmtiles`);
    if (typeof onDateChange === 'function') onDateChange(newDate);
  });
}

function swapBuildingSource(map, newUrl) {
  if (map.getLayer('buildings-labels'))     map.removeLayer('buildings-labels');
  if (map.getLayer('buildings-signs-glow')) map.removeLayer('buildings-signs-glow');
  if (map.getLayer('buildings-3d'))         map.removeLayer('buildings-3d');
  if (map.getSource('austin-buildings'))    map.removeSource('austin-buildings');
  map.addSource('austin-buildings', { type:'vector', url:newUrl, minzoom:12, maxzoom:16 });
  if (typeof addBuildingLayers === 'function') {
    addBuildingLayers(newUrl);
    if (typeof applyTimeOfDay === 'function') {
      const p = window.__todCurrentP != null ? window.__todCurrentP
              : (window.TOD_DEFAULT_P != null ? window.TOD_DEFAULT_P : 0.30);
      applyTimeOfDay(map, p);
    }
  }
}
