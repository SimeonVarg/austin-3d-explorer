/**
 * date-switcher.js — Snapshot date picker for Austin 3D Explorer
 *
 * The picker only announces the change; app.js owns the swap, because the
 * buildings source is fed an enriched in-memory FeatureCollection (facade
 * patterns, shadow geometry, label dedup) rather than a URL. Re-pointing the
 * source at a raw URL here would silently strip all of that.
 */

function initDateSwitcher(map, manifest, currentSnapshot, onDateChange) {
  const panel  = document.getElementById('date-panel');
  const select = document.getElementById('date-select');
  if (!panel || !select) return;

  const snapshots = manifest.snapshots || [];
  // manifest.diffs entries are objects ({from, to, file, changed_count}); older
  // manifests wrote bare filename strings. Accept both.
  const datesWithDiff = new Set();
  for (const d of (manifest.diffs || [])) {
    if (d && typeof d === 'object') { if (d.to) datesWithDiff.add(d.to); continue; }
    const m = String(d).match(/\d{4}-\d{2}-\d{2}_to_(\d{4}-\d{2}-\d{2})/);
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

  let active = currentSnapshot;
  select.addEventListener('change', async () => {
    const newDate = select.value;
    if (newDate === active) return;
    active = newDate;
    if (typeof onDateChange === 'function') await onDateChange(newDate);
  });
}
