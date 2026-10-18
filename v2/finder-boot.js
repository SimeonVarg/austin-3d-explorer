// The old app's apartment finder ("Where should I live?", js/finder.js), unchanged, in v2. It talks to window.__map, which in v2
// is maplite.js; its layers are drawn by map-layers.js. Its data paths ("data/...") are relative to the old app's page: the small
// fetch shim at the top of v2/index.html re-points them one folder up.
import '../js/finder.js';
