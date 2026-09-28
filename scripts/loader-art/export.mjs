// Print the loading-screen drawing's layers for js/loader.js (ART_LAYERS and ART_BOX).
//   node scripts/loader-art/export.mjs > parts.json
// island-gen.mjs draws every layer through one isometric projection; its TOKENS,
// GEO and FLOAT match ART, the geometry and FLOAT in js/loader.js. Paste each layer
// string into ART_LAYERS. The loader builds the halo gradient itself, so the
// halo layer's <defs> is dropped here.
import { heroArt, TOKENS, GEO, FLOAT } from './island-gen.mjs';
const { layers, BOX } = heroArt(TOKENS, GEO, FLOAT, true);
layers.halo = layers.halo.replace(/<defs>.*?<\/defs>/, '');
console.log(JSON.stringify({ layers, BOX }));
