// Shared by the Node and browser benches: no fs, no DOM.
export const REC = 28;
/** the same hex -> byte rounding js/slopes.js build() does (hexToRgb01 then Math.round(f * 255)) */
export const hexBytes = hex => { const h = String(hex).replace('#', ''); return [0, 2, 4].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) / 255 * 255)); };
