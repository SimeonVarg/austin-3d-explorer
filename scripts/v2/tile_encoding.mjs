// How a v2 tile is encoded (shared by build_tiles.mjs and ao_bake.mjs, so a bake into built tiles writes them exactly as a build would).
export const MESHOPT_LEVEL = 'high';     // filter mode (octahedral normals etc.): about a fifth smaller than 'medium', keeps the dense West Campus tile under the phone line
// 14 bits over a ~260 m tile = 1.6 cm; 16 bits = 0.4 cm. At 1.6 cm the builders' layered surfaces (field markings, painted aisles, seat blocks laid
// 1-3 cm over each other) land on the same step and fight for the pixel: the end zones, lettering and aisle bands were lost that way (2026-10-18).
export const QUANT = { quantizePosition: +(process.env.V2_QUANT_BITS || 16), quantizeNormal: 10, quantizeTexcoord: 12 };
