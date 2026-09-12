/* Landmark arrivals. Camera choices are editable in one place. */
(function () {
  'use strict';
  const tune = window.EXPLORE = {
    duration: 2400,
    places: [
      {name: 'DKR Stadium', detail: 'Inside the bowl', center: [-97.73258,30.2831], zoom: 18.35, pitch: 72, bearing: 180},
      {name: 'UT Tower', detail: 'Across the South Mall', center: [-97.73935,30.2848], zoom: 17.1, pitch: 74.5, bearing: 5},
      {name: 'Texas Capitol', detail: 'Dome and grounds', center: [-97.74035,30.2747], zoom: 16.8, pitch: 62, bearing: 0},
      {name: 'Downtown', detail: 'The Austin skyline', center: [-97.7431,30.2672], zoom: 15.4, pitch: 65, bearing: 330},
    ],
  };
  let previous = null;
  const root = document.createElement('div');
  root.id = 'explore';
  root.innerHTML = '<button id="explore-toggle" aria-expanded="false" aria-controls="explore-panel">Explore</button>' +
    '<section id="explore-panel" aria-label="Explore Austin" hidden><p class="explore-heading">Find your next view</p>' +
    '<div id="explore-places"></div><button id="explore-back" disabled>Return to previous view</button></section>' +
    '<span id="explore-status" class="explore-sr" role="status"></span>';
  document.body.appendChild(root);
  const toggle = root.querySelector('#explore-toggle'), panel = root.querySelector('#explore-panel');
  const back = root.querySelector('#explore-back'), status = root.querySelector('#explore-status');
  function close(focus = false) {
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('button').focus();
  });
  function visit(place, returning) {
    const map = window.__map;
    if (!map) { status.textContent = 'The city is still loading. Try again in a moment.'; return; }
    const c = map.getCenter();
    const current = {center: [c.lng,c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing()};
    map.stop();
    map.flyTo({...place, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : tune.duration});
    previous = returning ? null : current;
    back.disabled = !previous;
    status.textContent = returning ? 'Returning to your previous view.' : 'Exploring ' + place.name + '.';
    close(true);
  }
  for (const place of tune.places) {
    const button = document.createElement('button');
    const title = document.createElement('strong'), detail = document.createElement('span');
    title.textContent = place.name; detail.textContent = place.detail;
    button.append(title, detail);
    button.addEventListener('click', () => visit(place, false));
    root.querySelector('#explore-places').appendChild(button);
  }
  back.addEventListener('click', () => { if (previous) visit(previous, true); });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { close(true); e.preventDefault(); }
    // Buttons retain normal Tab/Enter/Space behaviour without also flying.
    if (!panel.hidden || ['Enter',' ','Escape'].includes(e.key)) e.stopPropagation();
  });
  document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(); });
  root.addEventListener('focusout', () => {
    requestAnimationFrame(() => { if (!root.contains(document.activeElement)) close(); });
  });
})();
