/**
 * schedimg.js — a photograph of a class schedule becomes classes, on this device.
 *
 * NOTHING HERE TOUCHES THE NETWORK EXCEPT TO FETCH ITS OWN ENGINE AND THE APP'S
 * OWN BUILDING LIST, BOTH SAME-ORIGIN. The image is decoded into a canvas, every
 * stage below runs on that canvas, and the OCR engine is a WebAssembly module
 * running in a Worker on this machine. No upload, no cloud OCR, no analytics
 * event ever carries a pixel or a course code. A class schedule is personal data
 * and a picture of one is that plus a picture of the student's screen.
 *
 * IT IS LAZY BY CONSTRUCTION. This file is not referenced from index.html. It is
 * reached by a dynamic import() at the moment the student picks an image, and it
 * does not fetch the ~5 MB engine until extract() is actually called. The app's
 * cold load is a measured, defended number and this feature adds zero bytes to
 * it. `scripts/verify/schedimg.mjs` asserts exactly that against the real page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY GEOMETRY IS THE WHOLE POINT
 *
 * A schedule is a TABLE. Which column a time sits in *is* the day. An extractor
 * that returns a flat bag of words has thrown away the only thing that makes the
 * rest of the problem solvable — and the measured bar for this round proves it:
 * Tesseract's plain text scored 0/49 on every Google-Calendar week grid in the
 * corpus and 0/34 on every phone card stack, not because it misread the glyphs
 * (on the card stack it read every field perfectly) but because a line-based
 * parser cannot put a word back in its column. So this file keeps word boxes
 * from the engine and rebuilds the surface from them:
 *
 *   words -> rows (y-bands) -> layout (table | week grid | card stack | flow)
 *         -> records anchored on a TIME RANGE, with the day taken from the
 *            column the record sits in
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PIPELINE, AND WHICH FAILURE EACH STAGE EXISTS FOR
 *
 *   1 decode        any File/Blob/URL/ImageBitmap -> RGBA
 *   2 findDocQuad   a phone photo is a small bright document inside a big dark
 *                   room. Find the document by EDGE DENSITY, not brightness, so
 *                   the same detector works on a dark-mode screen photographed
 *                   in a dark room (corpus image 11) as on a white one.
 *   3 rectify       invert the perspective the camera applied, and upscale.
 *                   Angled photos were the corpus's total loss (0/49) and this
 *                   is the stage that exists for them.
 *   4 photometry    inversion is DETECTED, never assumed — dark mode is a
 *                   different sign, not a different threshold. Then glare and
 *                   shading are divided out by a LOCAL background estimate,
 *                   because a global threshold cannot be right in two places at
 *                   once on image 08.
 *   5 ocr           Tesseract.js in a Worker, word boxes requested.
 *   6 geometry      rows, columns, layout, records (above).
 *   7 judgement     every field is checked against what the app already knows
 *                   (198 UT building codes). Anything truncated by the edge of
 *                   the frame, or repaired by more than one character, is
 *                   RETURNED MARKED UNSURE rather than asserted. "Unsure" costs
 *                   one tap. "Confidently wrong" costs a missed class.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY TASTE AND THRESHOLD VALUE IS IN `TUNE` BELOW, ONE EDIT EACH.
 */

/* ════════════════════════════════════════════════════════════════════════════
   TUNE — every constant this file leans on, in one place.
   ════════════════════════════════════════════════════════════════════════════ */
export const TUNE = {
  /* ── where the engine lives (same-origin, vendored, never a CDN) ────────── */
  enginePath: '../vendor/tesseract/',   // resolved against THIS module's URL
  lang: 'eng',
  // ONE named core file, not a directory for the library to pick from.
  // Tesseract.js's own auto-select reaches for the single-file builds
  // (`*-relaxedsimd-lstm.wasm.js`, 3.9 MB each, and it would need two of them
  // vendored to cover browsers with and without relaxed SIMD). Naming the
  // split build instead ships ONE core: 89 KB of glue plus a 2.86 MB .wasm it
  // fetches beside itself. Plain WebAssembly SIMD has been in every major
  // browser since 2021 and `hasSimd()` below checks for it by feature test
  // rather than assuming.
  coreFile: 'tesseract-core-simd-lstm.js',

  /* ── stage 2: finding the document inside a photograph ──────────────────── */
  quad: {
    analysisMax: 520,      // longest side of the image the detector reasons on
    blurRadius: 0.010,     // edge-density smoothing, as a fraction of that side
    threshRel: 0.13,       // keep cells above this fraction of the 98th pct
    closeRadius: 0.030,    // merge separate text blocks into one region
    keepCompFrac: 0.04,    // keep every blob this big a share of the biggest
    // THE PHOTO TEST. A photograph of a screen has the screen INSIDE the frame,
    // with an unlit surround on all four sides. A screenshot's content runs to
    // the edge — that is what a screenshot is. So: content standing clear of
    // every edge by this much means there is a mat, and a mat means a camera.
    matMarginFrac: 0.05,
    squareTol: 0.014,      // corners this close to axis-aligned -> no warp
    marginFrac: 0.020,     // grow the quad outward, so nothing is clipped
  },

  /* ── stage 3: how big to make the rectified page ────────────────────────── */
  // SIZE THE PAGE BY ITS TEXT, NOT BY ITS WIDTH. Tesseract wants a line about
  // this tall and gets worse below roughly 20 px; a phone screenshot already
  // arrives with 30 px lines, and blowing it up to a fixed 2200 px costs eight
  // times the work for nothing. A photographed table arrives at 11 px and needs
  // every bit of the upscale.
  targetLinePx: 30,
  targetWidth: 3200,       // ceiling, not a target
  maxUpscale: 3.2,
  maxPixels: 9e6,

  /* ── stage 4: turning colour into readable ink ──────────────────────────── */
  photo: {
    grayMode: 'min',       // 'min' | 'luma'. min(R,G,B) keeps white text legible
                           // on a saturated calendar block, where luma does not.
    normalize: 'divide',   // 'divide' | 'deviation' — see photometry()
    invertBelow: 118,      // median gray under this -> the page is dark mode
    bgRadiusFrac: 0.012,   // local-background window, fraction of page width
    bgRadiusMin: 9,
    // A FLOOR UNDER THE LOCAL BACKGROUND, as a fraction of the page's own
    // bright level. Without it, the empty right-hand half of a coloured
    // calendar block — where no white caption falls inside the window — has a
    // local maximum equal to the block's own colour, divides to 1, and comes
    // out WHITE: a bright slab abutting the caption that cost the third line
    // of every green and purple event on corpus image 02. The floor is low
    // enough that a genuinely under-lit corner of a photograph still gets its
    // own local correction.
    bgFloorFrac: 0.32,
    stretchLo: 0.55,       // after dividing by the local background, map this
    stretchHi: 0.97,       // ..to 0 and this to 255
    devGain: 0.55,         // 'deviation' mode: what fraction of the strongest
                           // edge in the page counts as full black
    denoise: 0,            // median-filter window on PHOTOS only; 0 disables
    sharpen: 0.55,         // unsharp amount; 0 disables
  },

  /* ── stage 5: the engine ────────────────────────────────────────────────── */
  ocr: {
    psm: '6',              // SINGLE_BLOCK. 3 (AUTO) re-orders a table into
                           // column-major garbage; 6 keeps rows as rows.
    // A SECOND LOOK IS A DIFFERENT SHAPE OF PICTURE, SO IT GETS A DIFFERENT
    // MODE. A whole page is a block; one table cell, one hour label and one
    // row of day headings are each a LINE. Measured on corpus image 05: the
    // cell holding "MWF" returns nothing at all under mode 6 at every
    // magnification from 2x to 5x — the layout analyser will not commit to a
    // block from one short word — and reads first time under mode 7.
    linePsm: '7',          // SINGLE_LINE, for a strip that is one line of type
    dpi: '300',
    minWordConf: 26,       // below this a word is noise, not a reading
  },

  /* ── stage 6: geometry ──────────────────────────────────────────────────── */
  geom: {
    rowOverlap: 0.42,      // share of height two words must overlap to be a row
    colSnapFrac: 0.5,      // a word joins a day column if within this * pitch
    edgeTouchPx: 3,        // a box this close to the crop edge is truncated
    maxLinesToLocation: 3, // how far below a time range a room may sit
  },

  /* ── stage 7: judgement ─────────────────────────────────────────────────── */
  judge: {
    repairMaxEdits: 1,     // a building code may be repaired by one character
    dayFirstHour: 7,       // a bare "3:30" on a schedule is not 3:30 in the
    dayLastHour: 22,       // ..morning. Used ONLY when no am/pm is printed, and
                           // the result is always marked unsure.
    // A CLASS IS A CLASS-SHAPED LENGTH. This is the single cheapest guard in
    // the file: an OCR slip that turns "11:00 am - 12:30 pm" into "1:00 am -
    // 12:30 pm" produces a 690-minute class, and a schedule has none. Refusing
    // it costs one tap; believing it walks the student to the wrong hour.
    minClassMin: 20,
    maxClassMin: 240,
  },

  /* ── a week grid's own coordinate system ────────────────────────────────── */
  // On a week grid the TIME IS THE POSITION. The hour labels down the left edge
  // are an axis, an event block's top and bottom are its start and end, and
  // none of that depends on reading four tiny digits correctly. This is the
  // single biggest thing keeping the geometry buys: text OCR of the block
  // captions on this corpus's grids parses about one range in ten.
  grid: {
    useBlockGeometry: true,
    analysisMax: 900,      // longest side the block finder reasons on
    colourJoin: 42,        // neighbouring pixels within this RGB distance are
                           // the same block — what separates a green event
                           // sitting directly on top of a blue one
    bgDistance: 58,        // this far from the page colour and it is a block
    minAreaFrac: 0.0022,   // of the page
    minFill: 0.72,         // of its own bounding box — a block is a rectangle
    minWidthOfPitch: 0.34, // and it is about as wide as its day column
    axisMinLabels: 3,
    axisMaxResidPx: 9,     // a worse fit than this is not an axis
    // A CALENDAR DRAWS A GAP BETWEEN TOUCHING EVENTS, so a block's painted
    // bottom is a few minutes short of the hour it actually ends on: measured,
    // a 9:30-11:00 class comes off the ruler at 10:55. Class times land on the
    // quarter hour, so snapping there absorbs the seam instead of reporting a
    // class that ends at five to.
    snapMin: 15,
    reOcrBlocks: true,     // read a block on its own when the page pass could
                           // not get a room out of it — see ocrCrop()
    agreeMin: 16,          // axis and caption agreeing within this is confident
    // Blocks of one colour at one time of day are one class drawn on several
    // days, so their rooms are made to agree — see agreeOnRooms().
    agreeAcrossDays: true,
    // How many event rectangles have to be on a picture before an otherwise
    // empty result says "I can see classes here and could not read them".
    minBlocksToMention: 2,
  },
};

/* ════════════════════════════════════════════════════════════════════════════
   1. DECODE
   ════════════════════════════════════════════════════════════════════════════ */

function makeCanvas(w, h) {
  // A real <canvas>, not an OffscreenCanvas: the OCR engine's image loader
  // accepts the DOM element on every browser and the offscreen one on some.
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** Anything a file input, a paste or a drag can produce -> { data, w, h }. */
export async function decode(src) {
  let bitmap = null;
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) {
    bitmap = src;
  } else if (typeof Blob !== 'undefined' && src instanceof Blob) {
    bitmap = await createImageBitmap(src);
  } else if (typeof src === 'string') {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('this file could not be read as an image'));
      img.src = src;
    });
    bitmap = await createImageBitmap(img);
  } else if (src && src.width && src.height) {
    bitmap = await createImageBitmap(src);
  } else {
    throw new Error('schedimg: unsupported image source');
  }
  const c = makeCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  if (bitmap.close) bitmap.close();
  return { data: id.data, w: id.width, h: id.height };
}

/* ════════════════════════════════════════════════════════════════════════════
   SMALL IMAGE PRIMITIVES
   ════════════════════════════════════════════════════════════════════════════ */

/** Downsample RGBA to a grey Float32Array with the longest side <= max. */
function grayDownsample(img, max) {
  const s = Math.max(1, Math.max(img.w, img.h) / max);
  const w = Math.max(1, Math.round(img.w / s));
  const h = Math.max(1, Math.round(img.h / s));
  const out = new Float32Array(w * h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * s), sy1 = Math.min(img.h, Math.floor((y + 1) * s) || sy0 + 1);
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * s), sx1 = Math.min(img.w, Math.floor((x + 1) * s) || sx0 + 1);
      let acc = 0, n = 0;
      for (let yy = sy0; yy < Math.max(sy1, sy0 + 1); yy++) {
        for (let xx = sx0; xx < Math.max(sx1, sx0 + 1); xx++) {
          const i = (yy * img.w + xx) * 4;
          acc += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          n++;
        }
      }
      out[y * w + x] = n ? acc / n : 0;
    }
  }
  return { g: out, w, h, scale: s };
}

/** Box blur by integral image. Radius in pixels. */
function boxBlur(src, w, h, r) {
  if (r < 1) return src.slice();
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      ii[(y + 1) * (w + 1) + (x + 1)] = ii[y * (w + 1) + (x + 1)] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const a = ii[y0 * (w + 1) + x0], b = ii[y0 * (w + 1) + (x1 + 1)];
      const c = ii[(y1 + 1) * (w + 1) + x0], dd = ii[(y1 + 1) * (w + 1) + (x1 + 1)];
      out[y * w + x] = (dd - b - c + a) / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

/**
 * Separable sliding-window MAXIMUM, O(n) by monotonic deque.
 *
 * A local maximum — not a local mean — is the right background estimate for
 * dark ink on a lit page: the brightest thing in a neighbourhood of text IS the
 * paper. That is what makes the glare on corpus image 08 divide out instead of
 * swallowing a row of classes.
 */
function maxFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const idx = new Int32Array(Math.max(w, h) + 1);
  const run = (get, set, n) => {
    let head = 0, tail = 0;
    for (let i = 0; i < n + r; i++) {
      if (i < n) {
        const v = get(i);
        while (tail > head && get(idx[tail - 1]) <= v) tail--;
        idx[tail++] = i;
      }
      const o = i - r;
      if (o >= 0) {
        while (idx[head] < o - r) head++;
        set(o, get(idx[head]));
      }
    }
  };
  for (let y = 0; y < h; y++) {
    const b = y * w;
    run(i => src[b + i], (i, v) => { tmp[b + i] = v; }, w);
  }
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    run(i => tmp[i * w + x], (i, v) => { out[i * w + x] = v; }, h);
  }
  return out;
}

/** In-place 3x3 median. Kills speckle and moire without softening an edge. */
function medianFilter3(g, w, h) {
  const src = g.slice();
  const v = new Float32Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const b = (y + dy) * w + x;
        v[n++] = src[b - 1]; v[n++] = src[b]; v[n++] = src[b + 1];
      }
      // Nine elements: a partial selection sort to the middle is enough.
      for (let i = 0; i <= 4; i++) {
        let m = i;
        for (let j = i + 1; j < 9; j++) if (v[j] < v[m]) m = j;
        const t = v[i]; v[i] = v[m]; v[m] = t;
      }
      g[y * w + x] = v[4];
    }
  }
}

function percentile(arr, p) {
  const n = arr.length;
  const hist = new Float64Array(1024);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return lo;
  const k = 1023 / (hi - lo);
  for (let i = 0; i < n; i++) hist[Math.round((arr[i] - lo) * k)]++;
  let want = p * n, acc = 0;
  for (let b = 0; b < 1024; b++) { acc += hist[b]; if (acc >= want) return lo + b / k; }
  return hi;
}

/* ════════════════════════════════════════════════════════════════════════════
   2. FIND THE DOCUMENT INSIDE A PHOTOGRAPH

   By EDGE DENSITY, deliberately. A brightness rule finds a white page on a dark
   desk and then fails on the one case the corpus was built to include: a
   dark-mode calendar photographed in a dark room, where the document is barely
   brighter than what surrounds it. Text and rules are structure; a desk, a mat
   and an unlit wall are not, whatever their brightness.
   ════════════════════════════════════════════════════════════════════════════ */

function edgeDensity(g, w, h) {
  const e = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      e[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
    }
  }
  return e;
}

/**
 * Label 4-connected components; keep every one at least `keepFrac` of the
 * largest. A document is not one blob — a title, a table and a footer are three
 * — and taking only the biggest picks the table and throws the page away.
 */
function contentPixels(mask, w, h, keepFrac) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const cur = new Int32Array(w * h);
  const comps = [];
  let biggest = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, n = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp];
      cur[n++] = i;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    comps.push(cur.slice(0, n));
    if (n > biggest) biggest = n;
  }
  const keep = comps.filter(c => c.length >= keepFrac * biggest);
  return { keep, total: keep.reduce((a, c) => a + c.length, 0), biggest };
}

/**
 * -> { quad: [TL,TR,BR,BL] in ORIGINAL pixels, warped, box } or null.
 *
 * TWO QUESTIONS, ASKED IN THIS ORDER.
 *
 * 1. WHERE IS THE CONTENT? Edge density, blurred and closed, so a page of text
 *    becomes one region. Deliberately not brightness: a brightness rule finds a
 *    white page on a dark desk and then gets the one case this corpus was built
 *    to include exactly backwards — a dark-mode calendar photographed in a dark
 *    room, where the document is barely brighter than the room.
 *
 * 2. IS THIS A PHOTOGRAPH? Only if the content stands clear of all four edges.
 *    A screenshot's content runs to the edge of the file; a photograph of a
 *    screen has an unlit surround. That test is what stops a perfectly square
 *    screenshot from being "corrected" into a trapezoid, which is what the
 *    first version of this function did to two thirds of the corpus.
 *
 * `warped: false` therefore means "leave the pixels alone", and it also means
 * the border of this bitmap is a CROP: a word touching it is half a word.
 */
export function findDocQuad(img, tune = TUNE) {
  const T = tune.quad;
  const small = grayDownsample(img, T.analysisMax);
  const { w, h } = small;
  const long = Math.max(w, h);
  const e = edgeDensity(small.g, w, h);
  const s = boxBlur(e, w, h, Math.max(2, Math.round(T.blurRadius * long)));
  const t = percentile(s, 0.98) * T.threshRel;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = s[i] > t ? 1 : 0;

  // Morphological close: blur the binary mask and re-threshold, which welds
  // neighbouring lines of text into a paragraph and paragraphs into a page.
  const cr = Math.max(2, Math.round(T.closeRadius * long));
  const f = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i];
  const closed = boxBlur(f, w, h, cr);
  const mask2 = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask2[i] = (mask[i] || closed[i] > 0.22) ? 1 : 0;

  const { keep, total } = contentPixels(mask2, w, h, T.keepCompFrac);
  if (!keep.length || total < 0.02 * w * h) return null;

  let minSum = Infinity, maxSum = -Infinity, minDif = Infinity, maxDif = -Infinity;
  let tl = 0, br = 0, bl = 0, tr = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const comp of keep) {
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i / w) | 0;
      const sum = x + y, dif = x - y;
      if (sum < minSum) { minSum = sum; tl = i; }
      if (sum > maxSum) { maxSum = sum; br = i; }
      if (dif < minDif) { minDif = dif; bl = i; }
      if (dif > maxDif) { maxDif = dif; tr = i; }
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }

  const mm = T.matMarginFrac;
  const hasMat = x0 >= mm * w && y0 >= mm * h && (w - 1 - x1) >= mm * w && (h - 1 - y1) >= mm * h;

  const k = small.scale;
  const box = [x0 * k, y0 * k, x1 * k, y1 * k];
  if (!hasMat) return { quad: null, warped: false, box, hasMat };

  const pt = i => [(i % w), ((i / w) | 0)];
  let quad = [pt(tl), pt(tr), pt(br), pt(bl)];
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const m = 1 + T.marginFrac;
  quad = quad.map(([x, y]) => [cx + (x - cx) * m, cy + (y - cy) * m]);

  // How far the quad is from an axis-aligned rectangle, relative to its size.
  const dev = Math.max(
    Math.abs(quad[0][0] - quad[3][0]), Math.abs(quad[1][0] - quad[2][0]),
    Math.abs(quad[0][1] - quad[1][1]), Math.abs(quad[3][1] - quad[2][1]),
  ) / long;

  const toFull = ([x, y]) => [
    Math.max(0, Math.min(img.w - 1, x * k)),
    Math.max(0, Math.min(img.h - 1, y * k)),
  ];
  return { quad: quad.map(toFull), warped: dev >= T.squareTol, box, hasMat, dev };
}

/**
 * Median height of a run of rows containing ink, in ORIGINAL pixels — a proxy
 * for one line of type. This is what decides the upscale, so that the engine
 * always sees glyphs at about the size it was trained on.
 *
 * Polarity-free on purpose: "ink" is anything far from the page's own median,
 * so it reads a dark-mode page and a light one the same way.
 */
export function estimateLineHeight(img, box) {
  const x0 = Math.max(0, Math.round(box ? box[0] : 0));
  const y0 = Math.max(0, Math.round(box ? box[1] : 0));
  const x1 = Math.min(img.w - 1, Math.round(box ? box[2] : img.w - 1));
  const y1 = Math.min(img.h - 1, Math.round(box ? box[3] : img.h - 1));
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  if (W < 8 || H < 8) return null;
  const g = new Float32Array(W * H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = ((y + y0) * img.w + (x + x0)) * 4;
      g[y * W + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
  }
  // EDGES, NOT FILL. A calendar's solid colour block is 60 px of "not the page
  // colour" and would be read as a 60 px line of type; it has no internal
  // gradient, so counting horizontal edges per row measures only the lettering.
  const dx = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      dx[y * W + x] = Math.abs(g[y * W + x + 1] - g[y * W + x - 1]);
    }
  }
  const gth = Math.max(18, percentile(dx, 0.995) * 0.3);
  const runs = [];
  let run = 0;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 1; x < W - 1; x++) if (dx[y * W + x] > gth) n++;
    if (n > 0.008 * W) run++;
    else { if (run > 1) runs.push(run); run = 0; }
  }
  if (run > 1) runs.push(run);
  if (runs.length < 3) return null;
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1];
}

/* ════════════════════════════════════════════════════════════════════════════
   3. RECTIFY — undo the camera's perspective, and make the glyphs big enough
   ════════════════════════════════════════════════════════════════════════════ */

/** Solve for the homography taking src[i] -> dst[i] (4 points, 8 unknowns). */
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gauss-Jordan with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r2 = c + 1; r2 < 8; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[p][c])) p = r2;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const pv = A[c][c];
    for (let j = c; j < 8; j++) A[c][j] /= pv;
    b[c] /= pv;
    for (let r2 = 0; r2 < 8; r2++) {
      if (r2 === c) continue;
      const f = A[r2][c];
      if (!f) continue;
      for (let j = c; j < 8; j++) A[r2][j] -= f * A[c][j];
      b[r2] -= f * b[c];
    }
  }
  return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], 1];
}

function bilinear(img, x, y, out) {
  const w = img.w, h = img.h, d = img.data;
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
    const b2 = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
    out[c] = a + (b2 - a) * fy;
  }
}

/**
 * -> { data, w, h, source: 'photo'|'screenshot', scale }
 *
 * `source` decides, later, whether the edge of this bitmap is the edge of the
 * document (a photo — nothing is cut off) or the edge of a CROP (a screenshot —
 * a word touching it may be half a word).
 */
export function rectify(img, det, tune = TUNE) {
  const px = tune.maxPixels;
  const line = estimateLineHeight(img, det ? det.box : null);
  // Upscale until one line of type is about `targetLinePx` tall, and no further.
  const byLine = line ? tune.targetLinePx / line : tune.maxUpscale;

  if (!det || !det.warped || !det.quad) {
    let scale = Math.max(1, Math.min(tune.maxUpscale, byLine, tune.targetWidth / img.w));
    if (img.w * img.h * scale * scale > px) scale = Math.sqrt(px / (img.w * img.h));
    scale = Math.max(1, scale);
    return {
      ...resample(img, img.w * scale, img.h * scale, null),
      source: 'screenshot', scale, line,
    };
  }
  const q = det.quad;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w0 = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  const h0 = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  let scale = Math.max(1, Math.min(tune.maxUpscale, byLine, tune.targetWidth / w0));
  if (w0 * h0 * scale * scale > px) scale = Math.sqrt(px / (w0 * h0));
  scale = Math.max(0.5, scale);
  const W = Math.max(16, Math.round(w0 * scale)), H = Math.max(16, Math.round(h0 * scale));
  const M = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
  if (!M) return rectify(img, null, tune);
  return { ...resample(img, W, H, M), source: 'photo', scale, line };
}

/** Resample with an optional homography (output -> input); else a plain scale. */
function resample(img, W, H, M) {
  W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
  const out = new Uint8ClampedArray(W * H * 4);
  const px = [0, 0, 0];
  const sx = img.w / W, sy = img.h / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ix, iy;
      if (M) {
        const u = x + 0.5, v = y + 0.5;
        const den = M[6] * u + M[7] * v + 1;
        ix = (M[0] * u + M[1] * v + M[2]) / den;
        iy = (M[3] * u + M[4] * v + M[5]) / den;
      } else {
        ix = (x + 0.5) * sx - 0.5; iy = (y + 0.5) * sy - 0.5;
      }
      bilinear(img, ix, iy, px);
      const o = (y * W + x) * 4;
      out[o] = px[0]; out[o + 1] = px[1]; out[o + 2] = px[2]; out[o + 3] = 255;
    }
  }
  return { data: out, w: W, h: H };
}

/* ════════════════════════════════════════════════════════════════════════════
   4. PHOTOMETRY — colour to ink

   Three separate problems, three separate answers:
   grayMode 'min'   white text on a saturated calendar block. min(R,G,B) sends
                    every saturated colour toward black and leaves white at 255;
                    luminance leaves white-on-yellow at 255-vs-195 and unreadable.
   inversion        DETECTED from the page's own median, because dark mode is a
                    different SIGN, and a fixed threshold gets it exactly
                    backwards on a third of this corpus.
   local background glare and screen shading are LOCAL, so the correction has to
                    be. Divide by a local maximum, then stretch.
   ════════════════════════════════════════════════════════════════════════════ */
export function photometry(rect, tune = TUNE) {
  const P = tune.photo;
  const { data, w, h } = rect;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const r = data[p], gg = data[p + 1], b = data[p + 2];
    g[i] = P.grayMode === 'luma'
      ? 0.299 * r + 0.587 * gg + 0.114 * b
      : Math.min(r, Math.min(gg, b));
  }
  const median = percentile(g, 0.5);
  const inverted = median < P.invertBelow;
  if (inverted) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];

  // A photograph carries sensor noise and, off a screen, a pixel-grid moire.
  // Both survive every later stage as speckle the engine reads as punctuation.
  // A 3x3 median removes them and leaves an edge where it found one.
  if (P.denoise >= 3 && rect.source === 'photo') medianFilter3(g, w, h);

  const r = Math.max(P.bgRadiusMin, Math.round(P.bgRadiusFrac * w));
  const out = new Uint8ClampedArray(w * h);
  if (P.normalize === 'deviation') {
    // EVERY POLARITY AT ONCE. A week grid is dark text on white AND white text
    // on a saturated block in the same picture, and no single threshold is
    // right for both. Distance from the LOCAL MEAN does not care which way
    // round the contrast runs: whatever differs from its surroundings becomes
    // ink, and the page comes out uniformly dark-on-light.
    const mean = boxBlur(g, w, h, r);
    const dev = new Float32Array(w * h);
    for (let i = 0; i < g.length; i++) dev[i] = Math.abs(g[i] - mean[i]);
    const scale = 255 / Math.max(12, percentile(dev, 0.995) * P.devGain);
    for (let i = 0; i < g.length; i++) out[i] = 255 - dev[i] * scale;
  } else {
    const bgRaw = maxFilter(g, w, h, r);
    const bg = boxBlur(bgRaw, w, h, Math.max(2, r >> 1));
    const floor = Math.max(8, percentile(g, 0.9) * P.bgFloorFrac);
    const lo = P.stretchLo, hi = P.stretchHi, span = Math.max(1e-3, hi - lo);
    for (let i = 0; i < g.length; i++) {
      const b = Math.max(floor, bg[i]);
      out[i] = ((g[i] / b - lo) / span) * 255;
    }
  }
  if (P.sharpen > 0) {
    const f = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) f[i] = out[i];
    const blur = boxBlur(f, w, h, 1);
    for (let i = 0; i < out.length; i++) out[i] = f[i] + (f[i] - blur[i]) * P.sharpen;
  }
  return { gray: out, w, h, inverted, median };
}

/** Grey plane -> a canvas Tesseract will accept. */
export function grayCanvas(pm) {
  const c = makeCanvas(pm.w, pm.h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const id = ctx.createImageData(pm.w, pm.h);
  for (let i = 0, p = 0; i < pm.gray.length; i++, p += 4) {
    const v = pm.gray[i];
    id.data[p] = v; id.data[p + 1] = v; id.data[p + 2] = v; id.data[p + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

/* ════════════════════════════════════════════════════════════════════════════
   5. THE ENGINE — chosen on evidence, loaded lazily, run on this device
   ════════════════════════════════════════════════════════════════════════════ */

let enginePromise = null;
export const engineInfo = { name: null, why: null, bytes: 0, loadedAt: null };

function base() {
  // Resolve the vendor directory against THIS module, so the same file works
  // from / and from a project sub-path without configuration.
  return new URL(TUNE.enginePath, import.meta.url).href;
}

async function hasSimd() {
  try {
    // The 8-byte header plus a single v128 const — the smallest module that
    // fails to validate without SIMD.
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (e) { return false; }
}

/**
 * Chrome's built-in TextDetector is checked FIRST and by feature test, never by
 * user-agent: it costs zero bytes and runs at native speed when it is there.
 * It is not there in any Chrome this project has been able to reach — the Shape
 * Detection API shipped FaceDetector and BarcodeDetector and never shipped text
 * broadly — so the fallback is the one that actually runs, and the fallback is
 * the one that is measured. If it ever appears, this returns it and the bench
 * will say so out loud rather than silently changing engines.
 */
export async function pickEngine() {
  if (typeof TextDetector === 'function') {
    try {
      const det = new TextDetector();
      if (det && typeof det.detect === 'function') {
        return { kind: 'textdetector', detector: det };
      }
    } catch (e) { /* present but unusable — fall through */ }
  }
  return { kind: 'tesseract' };
}

async function loadScript(url) {
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = res;
    s.onerror = () => rej(new Error('could not load the on-device reader from ' + url));
    document.head.appendChild(s);
  });
}

/** Lazily bring up Tesseract.js in a Worker. Nothing is fetched before this. */
async function tesseractWorker() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const b = base();
    if (!(await hasSimd())) {
      throw new Error('this browser cannot run the on-device reader (no WebAssembly SIMD)');
    }
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (typeof Tesseract === 'undefined') await loadScript(b + 'tesseract.min.js');
    const worker = await Tesseract.createWorker(TUNE.lang, 1, {
      workerPath: b + 'worker.min.js',
      corePath: b + TUNE.coreFile,
      langPath: b,
      gzip: true,
      workerBlobURL: false,
      logger: () => {},
      errorHandler: () => {},
    });
    await worker.setParameters({
      tessedit_pageseg_mode: TUNE.ocr.psm,
      user_defined_dpi: TUNE.ocr.dpi,
      preserve_interword_spaces: '1',
      // KEEP THE ENGINE'S DEBUG CHATTER OFF THE PAGE'S CONSOLE. In single-line
      // mode Tesseract prints its row-fitting statistics ("Bottom=0, top=195,
      // base=0, x=0", "Total count=0") through emscripten's stderr, which
      // lands as console.error in the host page — indistinguishable, to
      // anything watching, from the app having thrown. Pointing its debug file
      // at the null device in the WebAssembly filesystem silences it at the
      // source rather than teaching the gate to ignore errors.
      debug_file: '/dev/null',
    });
    engineInfo.name = 'tesseract.js 7 (LSTM, SIMD core, vendored)';
    engineInfo.why = 'TextDetector absent; everything runs in a Worker on this device';
    engineInfo.loadedAt =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return worker;
  })();
  return enginePromise;
}

/**
 * -> [{ text, x0, y0, x1, y1, conf }] in the coordinates of the given canvas.
 *
 * `psm` overrides the page-segmentation mode for this one call and is put back
 * afterwards, so a crop that is one line can say so without changing how the
 * page is read. TextDetector has no such setting and ignores it.
 */
export async function ocrWords(canvas, tune = TUNE, psm = null) {
  const eng = await pickEngine();
  if (eng.kind === 'textdetector') {
    const found = await eng.detector.detect(canvas);
    engineInfo.name = 'TextDetector (built in, zero bytes)';
    engineInfo.why = 'present in this browser, so nothing was downloaded';
    const out = [];
    for (const r of found) {
      const bb = r.boundingBox;
      // TextDetector returns a line; split it on spaces and apportion the box,
      // which is coarse but keeps the column information that matters.
      const parts = String(r.rawValue || '').split(/\s+/).filter(Boolean);
      const total = parts.reduce((a, p) => a + p.length, 0) || 1;
      let cur = 0;
      for (const p of parts) {
        const x0 = bb.x + (bb.width * cur) / total;
        cur += p.length;
        const x1 = bb.x + (bb.width * cur) / total;
        out.push({ text: p, x0, y0: bb.y, x1, y1: bb.y + bb.height, conf: 90 });
      }
    }
    return out;
  }
  const worker = await tesseractWorker();
  const swap = psm && psm !== tune.ocr.psm;
  if (swap) await worker.setParameters({ tessedit_pageseg_mode: psm });
  let res;
  try {
    res = await worker.recognize(canvas, {}, { blocks: true, text: false });
  } finally {
    if (swap) await worker.setParameters({ tessedit_pageseg_mode: tune.ocr.psm });
  }
  const words = [];
  const blocks = (res && res.data && res.data.blocks) || [];
  for (const blk of blocks) {
    for (const par of (blk.paragraphs || [])) {
      for (const line of (par.lines || [])) {
        for (const wd of (line.words || [])) {
          const t = String(wd.text || '').trim();
          if (!t) continue;
          if ((wd.confidence || 0) < tune.ocr.minWordConf) continue;
          words.push({
            text: t, conf: wd.confidence || 0,
            x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1,
          });
        }
      }
    }
  }
  return words;
}

/**
 * Read ONE rectangle of the page on its own, and hand the words back in page
 * coordinates.
 *
 * WHY A SECOND LOOK IS WORTH IT. A coloured event block is white type on a
 * saturated ground sitting in a page of black type on white. After the page
 * pass the block is a small island of reversed contrast, and the third line of
 * it — always the room — is what the engine drops. Cropped out and turned the
 * right way up, it is an ordinary two-word line and reads first time.
 *
 * Polarity is decided from the crop's own median, so the same call works for a
 * light block on a dark calendar as for the reverse.
 */
export async function ocrCrop(pm, box, tune = TUNE, scale = 2, opts = {}) {
  // A MARGIN IS PART OF THE PICTURE. Tesseract's layout analyser wants some
  // quiet space around the type; a cell cut exactly to its own ink reads worse
  // than the same cell with a few pixels of page around it.
  const pad = opts.pad == null ? 3 : opts.pad;
  const x0 = Math.max(0, Math.floor(box.x0) - pad), y0 = Math.max(0, Math.floor(box.y0) - pad);
  const x1 = Math.min(pm.w, Math.ceil(box.x1) + pad), y1 = Math.min(pm.h, Math.ceil(box.y1) + pad);
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 12 || ch < 12) return [];
  const buf = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) buf[y * cw + x] = pm.gray[(y + y0) * pm.w + (x + x0)];
  }
  const med = percentile(buf, 0.5);
  const flip = med < 128;
  const W = Math.max(1, Math.round(cw * scale)), H = Math.max(1, Math.round(ch * scale));
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const id = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(ch - 1, (y / scale) | 0);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(cw - 1, (x / scale) | 0);
      let v = buf[sy * cw + sx];
      if (flip) v = 255 - v;
      const p = (y * W + x) * 4;
      id.data[p] = v; id.data[p + 1] = v; id.data[p + 2] = v; id.data[p + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  const words = await ocrWords(c, tune, opts.psm || null);
  return words.map(w => ({
    ...w,
    x0: x0 + w.x0 / scale, x1: x0 + w.x1 / scale,
    y0: y0 + w.y0 / scale, y1: y0 + w.y1 / scale,
  }));
}

/** Release the Worker. The UI calls this when the import screen closes. */
export async function releaseEngine() {
  if (!enginePromise) return;
  const p = enginePromise;
  enginePromise = null;
  try { const w = await p; if (w && w.terminate) await w.terminate(); } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   6. GEOMETRY — words back into the surface they came from
   ════════════════════════════════════════════════════════════════════════════ */

/** Words -> rows: groups whose vertical extents overlap. Reading order kept. */
export function buildRows(words, tune = TUNE) {
  const ws = words.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows = [];
  for (const w of ws) {
    const hw = w.y1 - w.y0;
    let placed = null;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 4; i--) {
      const r = rows[i];
      const ov = Math.min(r.y1, w.y1) - Math.max(r.y0, w.y0);
      if (ov > tune.geom.rowOverlap * Math.min(hw, r.y1 - r.y0)) { placed = r; break; }
    }
    if (!placed) {
      placed = { y0: w.y0, y1: w.y1, words: [] };
      rows.push(placed);
    }
    placed.words.push(w);
    placed.y0 = Math.min(placed.y0, w.y0);
    placed.y1 = Math.max(placed.y1, w.y1);
  }
  for (const r of rows) {
    r.words.sort((a, b) => a.x0 - b.x0);
    r.text = r.words.map(w => w.text).join(' ');
    r.x0 = Math.min(...r.words.map(w => w.x0));
    r.x1 = Math.max(...r.words.map(w => w.x1));
  }
  rows.sort((a, b) => a.y0 - b.y0);
  return rows;
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_HEADER = /^(MON|TUE|TUES|WED|THU|THUR|THURS|FRI|SAT|SUN)(DAY)?$/i;
const HEADER_WORDS = /^(UNIQUE|COURSE|TITLE|INSTRUCTOR|DAYS|DAY|HOUR|HOURS|TIME|TIMES|ROOM|BLDG|BUILDING|LOCATION|STATUS|SECTION)$/i;
const HEADER_DAY = { MON: 'Mon', TUE: 'Tue', TUES: 'Tue', WED: 'Wed', THU: 'Thu', THUR: 'Thu', THURS: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

/**
 * A weekday heading, allowing ONE wrong letter.
 *
 * WHY THIS EXISTS. On a photograph of a calendar the headings are the smallest
 * type on the page and one of them comes back wrong: corpus image 06 reads
 * "rut WED THY FRI" where the calendar says TUE WED THU FRI. Two exact
 * weekdays is not three, so the grid reader was never entered on that image at
 * all — not the block finder, not the hour axis, none of it. Every angled week
 * grid in the corpus failed at this one line.
 *
 * The repair is deliberately narrow. Exactly three letters, and exactly one
 * weekday within one substitution: "THY" is Thursday and nothing else, and
 * "RUT" — two letters away from Tuesday and two from Saturday — is refused
 * rather than guessed. The length rule is what keeps an instructor's surname
 * out of it ("SITZ" is four letters, so it is never a Saturday).
 */
export function headerDay(text) {
  const s = String(text).replace(/[^A-Za-z]/g, '').toUpperCase();
  if (s.length < 3) return null;
  if (DAY_HEADER.test(s)) {
    const day = HEADER_DAY[s] || HEADER_DAY[s.slice(0, 3)];
    return day ? { day, repaired: false } : null;
  }
  if (s.length !== 3) return null;
  const hits = [];
  for (const day of DAY_ORDER) {
    const abbr = day.toUpperCase();
    let d = 0;
    for (let i = 0; i < 3; i++) if (s[i] !== abbr[i]) d++;
    if (d <= 1) hits.push(day);
  }
  return hits.length === 1 ? { day: hits[0], repaired: true } : null;
}

/**
 * Day headings -> the whole week of columns, by fitting x to the day index.
 *
 * A CALENDAR'S COLUMNS ARE EVENLY SPACED — that is what makes it a calendar —
 * so the headings that DID read give the pitch and the phase of the ones that
 * did not. Corpus image 06 reads Wednesday, Thursday and Friday and has event
 * blocks in the Monday and Tuesday columns; without this they would be dropped
 * for having no column to belong to.
 *
 * The fit is checked before it is used: the days must run left to right in
 * calendar order, the pitch must be a plausible column width, and every
 * heading that read must sit within a third of a column of where the fit puts
 * it. A fit that does not explain the headings is no fit, and the caller falls
 * back to reading the page in flow.
 */
function fitDayColumns(hits, pageW) {
  const uniq = [];
  for (const h of hits.slice().sort((a, b) => a.cx - b.cx)) {
    if (!uniq.some(u => u.idx === h.idx)) uniq.push(h);
  }
  if (uniq.length < 2) return null;
  for (let i = 1; i < uniq.length; i++) if (uniq[i].idx <= uniq[i - 1].idx) return null;
  const n = uniq.length;
  const si = uniq.reduce((a, h) => a + h.idx, 0);
  const sx = uniq.reduce((a, h) => a + h.cx, 0);
  const sii = uniq.reduce((a, h) => a + h.idx * h.idx, 0);
  const six = uniq.reduce((a, h) => a + h.idx * h.cx, 0);
  const den = n * sii - si * si;
  if (!den) return null;
  const pitch = (n * six - si * sx) / den;
  const at0 = (sx - pitch * si) / n;
  if (!(pitch > pageW * 0.06) || pitch > pageW) return null;
  for (const h of uniq) if (Math.abs(at0 + pitch * h.idx - h.cx) > pitch * 0.34) return null;
  const cols = [];
  for (let i = 0; i < DAY_ORDER.length; i++) {
    const cx = at0 + pitch * i;
    if (cx < pitch * 0.15 || cx > pageW - pitch * 0.15) continue;
    cols.push({ day: DAY_ORDER[i], cx, y1: Math.max(...uniq.map(h => h.y1)) });
  }
  return cols.length >= uniq.length ? cols : null;
}

/**
 * -> { kind: 'grid'|'table'|'cards', dayCols?, headers? }
 *
 * Decided from geometry, never from the file name and never from a condition
 * label — the extractor is not told what it is looking at, by contract.
 */
export function classifyLayout(rows, page = null) {
  const pageW = (page && page.w) || Math.max(1, ...rows.map(r => r.x1 || 0));
  // A week grid announces itself: three or more weekday names on one row.
  for (const r of rows) {
    const days = r.words.filter(w => DAY_HEADER.test(w.text.replace(/[^A-Za-z]/g, '')));
    const uniq = new Set(days.map(w => HEADER_DAY[w.text.replace(/[^A-Za-z]/g, '').toUpperCase()]));
    if (uniq.size >= 3) {
      const cols = days.map(w => ({
        day: HEADER_DAY[w.text.replace(/[^A-Za-z]/g, '').toUpperCase()],
        cx: (w.x0 + w.x1) / 2, y1: w.y1,
      })).sort((a, b) => a.cx - b.cx);
      // Collapse duplicate readings of the same header.
      const out = [];
      for (const c of cols) if (!out.length || c.day !== out[out.length - 1].day) out.push(c);
      return { kind: 'grid', dayCols: out, headerY: Math.max(...days.map(w => w.y1)) };
    }
  }
  // THE SAME QUESTION ASKED OF A PHOTOGRAPH. Three headings that all read
  // perfectly is a screenshot's standard; a photograph gets two that read and
  // one that is a letter out, and the columns in between come from the fit.
  for (const r of rows) {
    const hits = [];
    for (const w of r.words) {
      const d = headerDay(w.text);
      if (d) hits.push({ ...d, idx: DAY_ORDER.indexOf(d.day), cx: (w.x0 + w.x1) / 2, y1: w.y1 });
    }
    if (hits.length < 2) continue;
    const cols = fitDayColumns(hits, pageW);
    if (cols) {
      return {
        kind: 'grid', dayCols: cols, fitted: true,
        headerY: Math.max(...hits.map(h => h.y1)),
      };
    }
  }
  // A registrar table announces itself with a header row.
  for (const r of rows) {
    const hs = r.words.filter(w => HEADER_WORDS.test(w.text.replace(/[^A-Za-z]/g, '')));
    if (hs.length >= 3) {
      return {
        kind: 'table',
        headers: hs.map(w => ({
          key: w.text.replace(/[^A-Za-z]/g, '').toUpperCase(),
          x0: w.x0, x1: w.x1, cx: (w.x0 + w.x1) / 2,
        })).sort((a, b) => a.cx - b.cx),
        headerY: r.y1,
      };
    }
  }
  return { kind: 'cards' };
}

/* ── field readers ──────────────────────────────────────────────────────────
   Shared by every layout, because "what a time range looks like" does not
   depend on whether it was printed in a table or on a card.
   ────────────────────────────────────────────────────────────────────────── */

const TIME = '(\\d{1,2})\\s*[:.;]\\s*(\\d{2})\\s*([ap])?\\s*\\.?\\s*[mn]?\\.?';
const TIME_LOOSE = '(\\d{1,2})(?:\\s*[:.;]\\s*(\\d{2}))?\\s*([ap])\\s*\\.?\\s*[mn]\\.?';
// The dash is OPTIONAL because OCR loses it constantly ("11:00 am - 12:30 pm"
// comes back as "1:00am 12:30 pm"). What replaces it as the guard is the
// class-length check below, which is a much better test anyway.
const DASH = '\\s*[-–—~=]*\\s*';
const RANGE_RE = new RegExp(TIME + DASH + TIME, 'i');
const RANGE_LOOSE_RE = new RegExp(TIME_LOOSE + DASH + TIME_LOOSE, 'i');

function toMinutes(h, m, ap, unsure) {
  h = Number(h); m = m == null ? 0 : Number(m);
  if (!(h >= 0 && h <= 23) || !(m >= 0 && m <= 59)) return null;
  if (ap) {
    const a = String(ap).toLowerCase();
    h = h % 12;
    if (a === 'p') h += 12;
  } else if (unsure) {
    // NEVER SILENTLY INVENT A TIME. When no am/pm is printed anywhere in the
    // range, the reading is flagged; the caller marks the whole record unsure.
    if (h >= 1 && h < TUNE.judge.dayFirstHour) h += 12;
  }
  return h * 60 + m;
}
const hhmm = v => v == null ? null
  : String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');

/**
 * A LOST COLON IS A LOST CLASS, AND OCR LOSES COLONS.
 *
 * Measured on corpus image 05, where two whole rows scored zero on this alone:
 * the hour cell "4:00 pm-5:30 pm" comes back as "400 pm-5.30 pm" and
 * "10:00 am-11:00 am" as "10:00 am-11 00 am". Three or four digits run
 * together, or split by a space, are a clock — but ONLY where a meridiem
 * follows them, which is what makes this safe to do everywhere. A unique
 * number ("54010"), a room ("1.906") and a course number ("340L") are never
 * followed by "am" or "pm", so none of them is ever touched.
 */
export function normalizeClockText(text) {
  const AP = '(\\s*[ap]\\s*\\.?\\s*[mn])';
  return String(text)
    .replace(new RegExp('\\b(\\d{1,2})\\s+(\\d{2})' + AP, 'gi'), '$1:$2$3')
    .replace(new RegExp('\\b(\\d{1,2})(\\d{2})' + AP, 'gi'), '$1:$2$3');
}

/** "9:30 am-11:00 am" / "11:00 am - 12:30 pm" -> { start, end, unsure }. */
export function parseRange(text) {
  const s = normalizeClockText(String(text).replace(/–|—|−/g, '-'));
  let m = RANGE_RE.exec(s);
  let loose = false;
  if (!m) { m = RANGE_LOOSE_RE.exec(s); loose = true; }
  if (!m) return null;
  const [, h1, m1, ap1, h2, m2, ap2] = m;
  // A range prints the meridiem on at least one end; carry it to the other, and
  // if the carry would make the class end before it starts, step the end on.
  let a1 = ap1 || null, a2 = ap2 || null;
  const noMeridiem = !a1 && !a2;
  if (!a1 && a2) a1 = a2;
  if (!a2 && a1) a2 = a1;
  let start = toMinutes(h1, loose && m1 == null ? 0 : m1, a1, noMeridiem);
  let end = toMinutes(h2, loose && m2 == null ? 0 : m2, a2, noMeridiem);
  if (start == null || end == null) return null;
  if (end <= start && a1 === 'a' && ap2 == null) { end += 12 * 60; a2 = 'p'; }
  const len = end - start;
  if (len < TUNE.judge.minClassMin || len > TUNE.judge.maxClassMin) {
    return { start, end, unsure: true, bad: true, len };
  }
  return { start, end, unsure: noMeridiem, len };
}

const DAY_LETTER = { M: 'Mon', T: 'Tue', W: 'Wed', H: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };

/** "TTh" / "MWF" / "MTWTh" -> ['Tue','Thu'] ... or null if it is not a day run. */
export function parseDayLetters(tok) {
  const s = String(tok).toUpperCase().replace(/[^A-Z]/g, '');
  if (!s || s.length > 7) return null;
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('TH', i)) { out.push('Thu'); i += 2; continue; }
    if (s.startsWith('SU', i)) { out.push('Sun'); i += 2; continue; }
    if (s.startsWith('SA', i)) { out.push('Sat'); i += 2; continue; }
    const d = DAY_LETTER[s[i]];
    if (!d) return null;
    out.push(d); i += 1;
  }
  // OCR DOUBLES LETTERS. "TTh" comes back as "TTth" often enough that rejecting
  // a repeat outright — which the first version did — threw away a correctly
  // read Tuesday/Thursday row and then took the instructor's initial "W"
  // instead, reporting a Wednesday class that does not exist. So: dedupe, and
  // refuse only a token where one day appears three times or more, which is a
  // word rather than a day run.
  const seen = new Map();
  for (const d of out) seen.set(d, (seen.get(d) || 0) + 1);
  for (const n of seen.values()) if (n >= 3) return null;
  return [...seen.keys()];
}

/**
 * "RLP 0.106", "BUR 106", "JES A121A". A room is at least two characters:
 * without that rule the words "10:00 am-11:00 am" hand back a building called
 * "AM" in a room called "4", which is exactly the confidently-wrong answer this
 * whole feature exists to refuse.
 */
const LOC_RE = /^([A-Z][A-Z0-9]{1,3})\s+([0-9][0-9A-Z.\-]{1,7}|[A-Z][0-9][0-9A-Z.\-]{0,6})$/;
/** Words that look like a building code and never are. */
const NOT_A_CODE = /^(AM|PM|TO|AT|ON|IN|OF|MW|TT|TH|MWF|TTH|THE|AND|ROOM|BLDG|DAYS|HOUR|TIME|UNIT)$/;

/* ════════════════════════════════════════════════════════════════════════════
   7. JUDGEMENT — check every field against what the app already knows
   ════════════════════════════════════════════════════════════════════════════ */

let codesPromise = null;

/**
 * Codes the app resolves that UT's own register snapshot does not list.
 *
 * COPIED FROM `js/wayfind.js` (CAMPUS_EXTRA and OFF_MAP) AND IT HAS TO STAY IN
 * STEP WITH IT. They live inside that file's closure with no public accessor,
 * and this lane does not write that file. Eleven strings duplicated beats
 * either reaching into another lane's internals or telling a student that MER
 * — which the corpus contains on purpose, because a schedule really can name a
 * building this map cannot walk you to — is not a building.
 */
const EXTRA_CODES = ['SSW', 'BE1', 'BEG', 'EME', 'FS1', 'FSL', 'MER', 'PX3',
  'ROC', 'SV1', 'TCB'];

/** The 198 real UT codes, from the app's own data file. Same-origin, cached. */
export async function buildingCodes() {
  if (codesPromise) return codesPromise;
  codesPromise = (async () => {
    const set = new Set(EXTRA_CODES);
    try {
      const url = new URL('../data/ut_buildings.json', import.meta.url).href;
      const r = await fetch(url);
      const j = await r.json();
      for (const b of (j.buildings || [])) if (b && b.ref) set.add(String(b.ref).toUpperCase());
    } catch (e) { /* no list -> nothing is repaired, nothing is invented */ }
    return set;
  })();
  return codesPromise;
}

// Glyphs Tesseract genuinely confuses at these sizes. Used ONLY to repair a
// building code back onto the list of real ones, never to invent one.
const CONFUSE = {
  O: '0Q', 0: 'OQD', I: '1LT', 1: 'IL', L: 'I1', S: '5', 5: 'S', B: '8', 8: 'B',
  G: '6C', 6: 'G', Z: '2', 2: 'Z', D: 'O0', C: 'G', U: 'V', V: 'U', R: 'P', P: 'R',
  E: 'F', F: 'E', M: 'N', N: 'M',
};

/**
 * -> { code, repaired } | null.
 *
 * A code that is on the list is taken. A code one confusable character away
 * from EXACTLY ONE code on the list is repaired and flagged. Two candidates, or
 * a distance of two, and the answer is "I am not sure" — which costs one tap.
 * Silently inventing a building sends a student to the wrong side of campus.
 */
export function repairCode(raw, codes, tune = TUNE) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (!codes || !codes.size) return { code: s, repaired: false };
  if (codes.has(s)) return { code: s, repaired: false };
  if (tune.judge.repairMaxEdits < 1) return null;
  const hits = new Set();
  for (let i = 0; i < s.length; i++) {
    const alts = CONFUSE[s[i]];
    if (!alts) continue;
    for (const a of alts) {
      const cand = s.slice(0, i) + a + s.slice(i + 1);
      if (codes.has(cand)) hits.add(cand);
    }
  }
  if (hits.size === 1) return { code: [...hits][0], repaired: true };
  return null;
}

/**
 * EVERY real code one confusable character from `raw`, not only the unique one.
 *
 * `repairCode` above answers "may I write this down myself?" and its answer has
 * to be no whenever there are two candidates — silently picking one of GDC and
 * GDF sends a student to the wrong side of the plaza. But "I cannot write this
 * down" and "I have nothing to show you" are different sentences, and the
 * second one is not true: the reader knows the two buildings it might be, and
 * a student who took the photograph can tell them apart in one look.
 *
 * So this returns the whole candidate set, for the confirm screen to make into
 * taps. It is deliberately a SEPARATE function rather than a mode of
 * repairCode: nothing that writes an answer down may ever reach this list.
 */
export function codeCandidates(raw, codes, tune = TUNE) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s || !codes || !codes.size) return [];
  if (codes.has(s)) return [s];
  if (tune.judge.repairMaxEdits < 1) return [];
  const hits = new Set();
  for (let i = 0; i < s.length; i++) {
    for (const a of (CONFUSE[s[i]] || '')) {
      const cand = s.slice(0, i) + a + s.slice(i + 1);
      if (codes.has(cand)) hits.add(cand);
    }
  }
  return [...hits].sort();
}

/**
 * A day run repaired by ONE confusable letter — and ONLY where the table's own
 * heading says this column holds days.
 *
 * "MWF" printed in 9 pt and photographed at an angle comes back as "MWE" on
 * corpus image 05, because E and F differ by one stroke. Substituting one
 * confusable letter gives exactly one run that is a run of real days, so the
 * answer is not a guess between alternatives.
 *
 * THIS IS NOT USED ON A ROW SCANNED IN FLOW, only on a cell under a DAYS
 * heading. Loosened everywhere it would start turning instructors' initials
 * into weekdays, which is the mistake that once put a Wednesday class on this
 * corpus that does not exist.
 */
export function repairDayRun(tok) {
  const s = String(tok).toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length < 2 || s.length > 7) return null;
  const direct = parseDayLetters(s);
  if (direct) return direct;
  const hits = new Map();
  for (let i = 0; i < s.length; i++) {
    for (const a of (CONFUSE[s[i]] || '')) {
      if (!/[A-Z]/.test(a)) continue;
      const d = parseDayLetters(s.slice(0, i) + a + s.slice(i + 1));
      if (d) hits.set(d.join('|'), d);
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/* ════════════════════════════════════════════════════════════════════════════
   RECORD ASSEMBLY

   Every layout is anchored on the same thing: a TIME RANGE. What differs is
   only where the day comes from and how far the room is allowed to be.
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * A COURSE NUMBER AND A ROOM NUMBER LOOK IDENTICAL. "BUR 106" is a room and
 * "C S 429" is a course, and no amount of pattern-matching separates them,
 * because there is no pattern — there is only the list of real UT buildings.
 * So a plain-digit room is accepted only behind a code the app actually knows.
 * A dotted room ("2.216") is UT's own room syntax and stands on its own.
 */
function plausibleLoc(code, room, codes) {
  if (NOT_A_CODE.test(code)) return false;
  if (codes && codes.has(code)) return true;
  return /\./.test(room);
}

function locFromWords(ws, codes) {
  // "RLP 0.106" is two words; "BUR 106" is two; a stray "#54780" is not part of
  // either. Try adjacent pairs left to right.
  for (let i = 0; i + 1 < ws.length; i++) {
    const a = ws[i].text.replace(/[^A-Za-z0-9.\-]/g, '').toUpperCase();
    const b = ws[i + 1].text.replace(/[^A-Za-z0-9.\-]/g, '').toUpperCase();
    const m = LOC_RE.exec(a + ' ' + b);
    if (m && plausibleLoc(m[1], m[2], codes)) {
      return { code: m[1], room: m[2], words: [ws[i], ws[i + 1]] };
    }
  }
  // Or one word that already carries both, which is how OCR sometimes joins it.
  for (const w of ws) {
    const t = w.text.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    const m = /^([A-Z]{2,4})([0-9][0-9A-Z.\-]{1,7})$/.exec(t);
    if (m && plausibleLoc(m[1], m[2], codes)) {
      return { code: m[1], room: m[2], words: [w], joined: true };
    }
  }
  return null;
}

function courseFromRow(row) {
  const t = row.words.map(w => w.text).join(' ').toUpperCase();
  const m = /\b([A-Z]{1,3}(?: [A-Z])?) (\d{3}[A-Z]?)\b/.exec(t);
  return m ? m[1] + ' ' + m[2] : null;
}

function touchesEdge(ws, page, tune) {
  const e = tune.geom.edgeTouchPx;
  return ws.some(w => w.x0 <= e || w.y0 <= e || w.x1 >= page.w - e || w.y1 >= page.h - e);
}

/**
 * The day token nearest to the LEFT of the time on this line.
 *
 * "Nearest to the left" and not "the first token" because a registrar row opens
 * with a unique number and closes with an instructor's initial — and "BANERJEE,
 * S" contains a perfectly valid day letter. The token that means the days is
 * the one printed just before the hours, on every surface this reads.
 */
function daysInRow(row) {
  const timeIdx = row.words.findIndex(w =>
    /\d{1,2}\s*[:.;]\s*\d{2}/.test(w.text) || /^\d{1,2}\s*[ap]\.?m/i.test(w.text));
  const limitX = timeIdx >= 0 ? row.words[timeIdx].x0 : Infinity;
  const hits = [];
  for (const w of row.words) {
    if (w.x1 > limitX) break;
    const d = parseDayLetters(w.text);
    if (d) hits.push({ days: d, dayW: w, len: w.text.replace(/[^A-Za-z]/g, '').length });
  }
  if (!hits.length) return { days: null, dayW: null };
  // "MWF" beats "S". A one-letter token IS a valid day run and is also every
  // instructor's surname initial, so a longer token anywhere on the line wins
  // over it, and only then does nearest-to-the-time decide.
  const multi = hits.filter(h => h.len >= 2);
  const pool = multi.length ? multi : hits;
  return pool[pool.length - 1];
}

/* ── a week grid's own coordinate system ────────────────────────────────── */

/**
 * The hour labels down the left edge, fitted to a line: y pixels -> minutes.
 *
 * Theil-Sen (the median of every pairwise slope) rather than least squares,
 * because one label read as "3" when it says "8" would drag a least-squares fit
 * across the whole afternoon, and a median ignores it. The residual is then
 * checked against every label, so a fit that does not explain the axis is
 * reported as no axis at all rather than as a confident wrong clock.
 */
export function hourAxis(rows, leftEdge) {
  const pts = [];
  for (const r of rows) {
    const ws = r.words.filter(w => w.x1 <= leftEdge);
    if (!ws.length) continue;
    const t = ws.map(w => w.text).join(' ').toUpperCase().replace(/[^0-9APM]/g, '');
    const m = /^(\d{1,2})([AP])?M$/.exec(t);
    if (!m) continue;
    let h = Number(m[1]);
    if (!(h >= 1 && h <= 12)) continue;
    h = h % 12;
    if (m[2] === 'P') h += 12;
    pts.push({ y: (r.y0 + r.y1) / 2, min: h * 60, hasAp: !!m[2] });
  }
  if (pts.length < TUNE.grid.axisMinLabels) return null;
  pts.sort((a, b) => a.y - b.y);

  // A bare "12" between an AM run and a PM run is noon; a bare hour after noon
  // is the afternoon. Walk down the axis keeping it monotonic — and DROP a
  // label that cannot be made to fit rather than abandoning the axis, because
  // one hour misread as another is exactly what a photograph does and it used
  // to cost the whole clock.
  const keep = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], prev = keep[keep.length - 1];
    while (p.min <= prev.min) p.min += 720;
    if (p.min > 24 * 60) continue;
    keep.push(p);
  }
  const fit = (ps) => {
    const slopes = [];
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const dy = ps[j].y - ps[i].y;
        if (Math.abs(dy) < 1) continue;
        slopes.push((ps[j].min - ps[i].min) / dy);
      }
    }
    if (!slopes.length) return null;
    slopes.sort((a, b) => a - b);
    const k = slopes[slopes.length >> 1];
    if (!(k > 0)) return null;
    const offs = ps.map(p => p.min - k * p.y).sort((a, b) => a - b);
    return { k, b: offs[offs.length >> 1] };
  };
  let ps = keep;
  for (let pass = 0; pass < 3; pass++) {
    if (ps.length < TUNE.grid.axisMinLabels) return null;
    const f = fit(ps);
    if (!f) return null;
    const resid = ps.map(p => Math.abs((f.k * p.y + f.b) - p.min) / f.k);
    const worst = Math.max(...resid);
    if (worst <= TUNE.grid.axisMaxResidPx) {
      return {
        minutesAt: (y) => f.k * y + f.b, pxPerMin: 1 / f.k,
        labels: ps.length, residPx: worst,
      };
    }
    // Throw away the single worst label and try again. An axis with one bad
    // reading is still an axis; an axis with three is not.
    const bad = resid.indexOf(worst);
    ps = ps.filter((_, i) => i !== bad);
  }
  return null;
}

/**
 * Event blocks in the rectified picture, found as flat rectangles of one colour
 * that is not the page colour.
 *
 * Connectivity is COLOUR-limited, not just "not the background": on a week grid
 * an 11:00 class starts on the pixel the 9:30 class ends, and a mask that only
 * knows "coloured" welds the two into one four-hour event. Joining only
 * near-equal colours cuts them apart exactly where the calendar drew the seam.
 */
export function findBlocks(rect, tune = TUNE) {
  const G = tune.grid;
  const s = Math.max(1, Math.max(rect.w, rect.h) / G.analysisMax);
  const w = Math.max(1, Math.round(rect.w / s)), h = Math.max(1, Math.round(rect.h / s));
  const px = new Int32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(rect.w - 1, Math.round(x * s));
      const sy = Math.min(rect.h - 1, Math.round(y * s));
      const i = (sy * rect.w + sx) * 4, o = (y * w + x) * 3;
      px[o] = rect.data[i]; px[o + 1] = rect.data[i + 1]; px[o + 2] = rect.data[i + 2];
    }
  }
  const chan = c => {
    const a = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = px[i * 3 + c];
    return percentile(a, 0.5);
  };
  const bg = [chan(0), chan(1), chan(2)];
  const dist = (i, j) => Math.abs(px[i * 3] - px[j * 3]) +
    Math.abs(px[i * 3 + 1] - px[j * 3 + 1]) + Math.abs(px[i * 3 + 2] - px[j * 3 + 2]);
  const fromBg = (i) => Math.abs(px[i * 3] - bg[0]) +
    Math.abs(px[i * 3 + 1] - bg[1]) + Math.abs(px[i * 3 + 2] - bg[2]);

  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = fromBg(i) > G.bgDistance ? 1 : 0;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  const minArea = G.minAreaFrac * w * h;
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue;
    let sp = 0, n = 0;
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    let sr = 0, sg = 0, sb = 0;
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const i = stack[--sp];
      n++;
      sr += px[i * 3]; sg += px[i * 3 + 1]; sb += px[i * 3 + 2];
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const push = (j) => {
        if (!on[j] || seen[j] || dist(i, j) > G.colourJoin) return;
        seen[j] = 1; stack[sp++] = j;
      };
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    if (n < minArea) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (n / (bw * bh) < G.minFill) continue;
    // THE COLOUR IS PART OF THE ANSWER. A calendar draws one course in one
    // colour on every day it meets, so the colour is how two rectangles are
    // recognised as the same class — see `agreeOnRooms()`.
    out.push({
      x0: x0 * s, y0: y0 * s, x1: (x1 + 1) * s, y1: (y1 + 1) * s, area: n * s * s,
      colour: [sr / n, sg / n, sb / n],
    });
  }
  return out;
}

/**
 * A WEEK GRID SAYS THE SAME THING SEVERAL TIMES, SO READ IT WHERE IT IS LEGIBLE.
 *
 * A calendar draws one course in one colour, at the same hours, on every day it
 * meets. Two rectangles with the same colour and the same start and end are the
 * same class, and the room printed inside them is the same room — whatever the
 * engine made of each copy. So the copies vote:
 *
 *   - a reading supported by more of the copies wins ("WEL 2.224" twice beats
 *     "WEL 2224" once, which is corpus image 10's only loss);
 *   - a tie goes to the copy the engine was more confident about (image 04
 *     reads one block "GDC 2.216" and its twin "GDC 2.236", once each);
 *   - a copy whose caption gave NO room at all takes the group's room and is
 *     flagged, because "the same class, drawn on Wednesday" is a thing this
 *     file can see on the picture rather than a thing it is assuming.
 *
 * What it will not do is invent: a group where nothing read stays empty.
 */
function agreeOnRooms(recs, tune) {
  const near = (a, b) => a && b &&
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tune.grid.colourJoin;
  const groups = [];
  for (const r of recs) {
    if (!r.block || !r.block.colour) continue;
    const g = groups.find(q =>
      near(q.colour, r.block.colour) && q.start === r.range.start && q.end === r.range.end);
    if (g) g.recs.push(r);
    else groups.push({ colour: r.block.colour, start: r.range.start, end: r.range.end, recs: [r] });
  }
  for (const g of groups) {
    if (g.recs.length < 2) continue;
    const votes = new Map();
    for (const r of g.recs) {
      if (!r.loc) continue;
      const key = String(r.loc.code).toUpperCase() + ' ' + String(r.loc.room).toUpperCase();
      const conf = (r.loc.words || []).reduce((a, w) => a + (w.conf || 0), 0);
      const v = votes.get(key) || { n: 0, conf: 0, loc: r.loc };
      v.n++; v.conf += conf;
      votes.set(key, v);
    }
    if (!votes.size) continue;
    const best = [...votes.values()].sort((a, b) => (b.n - a.n) || (b.conf - a.conf))[0];
    const bestKey = String(best.loc.code).toUpperCase() + ' ' + String(best.loc.room).toUpperCase();
    for (const r of g.recs) {
      const key = r.loc && String(r.loc.code).toUpperCase() + ' ' + String(r.loc.room).toUpperCase();
      if (key === bestKey) continue;
      const was = key;
      r.loc = { ...best.loc, borrowed: true };
      r.why = (r.why || []).concat(was
        ? 'this class is drawn ' + g.recs.length + ' times and the others read "' + was + '"'
        : 'the room here was unreadable; it is taken from the same class on another day');
    }
  }
  return recs;
}

/** A grid: the day is the column, and nothing else is. */
async function fromGrid(rows, layout, page, tune, codes, ctx) {
  const cols = layout.dayCols;
  const pitch = cols.length > 1
    ? (cols[cols.length - 1].cx - cols[0].cx) / (cols.length - 1)
    : page.w;
  const colOf = (x) => {
    let best = null, bd = Infinity;
    for (const c of cols) {
      const d = Math.abs(c.cx - x);
      if (d < bd) { bd = d; best = c; }
    }
    return bd <= pitch * tune.geom.colSnapFrac ? best : null;
  };

  // ── the geometric reading, when the grid gives us one ──────────────────
  if (tune.grid.useBlockGeometry && ctx && ctx.rect) {
    // The axis is allowed to be missing. The BLOCKS are what this branch is
    // for; the axis only upgrades where their times come from.
    const axis = hourAxis(rows, cols[0].cx - pitch * 0.5);
    const blocks = findBlocks(ctx.rect, tune)
      .filter(b => (b.x1 - b.x0) >= pitch * tune.grid.minWidthOfPitch)
      .filter(b => colOf((b.x0 + b.x1) / 2) || colOf(b.x0 + pitch * 0.25));
    const snap = (v) => Math.round(v / tune.grid.snapMin) * tune.grid.snapMin;
    const recs = [];
    // WHAT WAS SEEN AND NOT READ IS AN ANSWER TOO. A block that is plainly a
    // class and whose caption will not come apart used to fall out of this
    // loop and out of the result, so a student photographing their calendar at
    // an angle got an empty screen and no reason. Every such block is recorded
    // here with whatever IS known about it — which day it is on, and its time
    // when the ruler gave one — and the caller puts it in front of the student
    // as something seen but not read.
    const seenNotRead = (ctx && ctx.seenNotRead) || [];
    if (ctx) ctx.seenNotRead = seenNotRead;
    const noteBlock = (col, start, end, why, b) => seenNotRead.push({
      day: col ? col.day : null,
      start: start == null ? null : hhmm(start),
      end: end == null ? null : hhmm(end),
      why,
      // The rectangle it was seen as, so the confirm screen can show the
      // student the very block it could not read.
      block: b ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null,
    });
    for (const b of blocks) {
      const col = colOf((b.x0 + b.x1) / 2) || colOf(b.x0 + pitch * 0.25);
      let start = axis ? snap(axis.minutesAt(b.y0)) : null;
      let end = axis ? snap(axis.minutesAt(b.y1)) : null;
      if (axis && (!(end > start) || end - start > tune.judge.maxClassMin)) {
        noteBlock(col, null, null, 'this looks like a class but its hours did not add up', b);
        continue;
      }
      const within = (ws) => ws.filter(w =>
        (w.x0 + w.x1) / 2 > b.x0 && (w.x0 + w.x1) / 2 < b.x1 &&
        (w.y0 + w.y1) / 2 > b.y0 && (w.y0 + w.y1) / 2 < b.y1);
      const inOrder = (ws) => ws.slice().sort((p, q) => (p.y0 - q.y0) || (p.x0 - q.x0));
      let inside = within(ctx.words);
      let loc = inside.length ? locFromWords(inOrder(inside), codes) : null;
      if (!loc && tune.grid.reOcrBlocks && ctx.pm) {
        const again = within(await ocrCrop(ctx.pm, b, tune));
        if (again.length) {
          const l2 = locFromWords(inOrder(again), codes);
          if (l2 || !inside.length) { inside = again; loc = l2; }
        }
      }
      if (!inside.length) {
        noteBlock(col, start, end, axis
          ? 'a class is drawn here but none of its writing could be read'
          : 'a class is drawn here but neither its writing nor the hour scale could be read', b);
        continue;
      }
      const caption = parseRange(inOrder(inside).map(w => w.text).join(' '));
      const why = [];
      // TWO WITNESSES AGREEING IS THE STRONGEST EVIDENCE ON THE PAGE, and the
      // confirm screen prices it, so the verdict is recorded rather than only
      // its failure: null = only one witness spoke, true = they agree, false =
      // they do not. (js/schedconfirm.js CONF.time reads exactly this.)
      let axisAgrees = null;
      // The caption is a second witness, not the witness. When both are
      // there and they agree, that is as sure as this file gets; when they
      // disagree the axis wins and the disagreement is shown, because four
      // tiny digits inside a coloured block are the least reliable thing on
      // the page and the calendar's own ruler is the most.
      if (axis && caption && !caption.bad) {
        const off = Math.abs(caption.start - start) + Math.abs(caption.end - end);
        axisAgrees = off <= tune.grid.agreeMin;
        if (off > tune.grid.agreeMin) {
          why.push('the caption reads ' + hhmm(caption.start) + '-' + hhmm(caption.end) +
            ' but it is drawn at ' + hhmm(start) + '-' + hhmm(end));
        }
      }
      // NO AXIS IS NOT NO GRID. When the hour labels are unreadable the
      // blocks still say which day a class is on and which lines belong to
      // it — which is most of what the layout was hiding — so the caption
      // supplies the clock and the geometry supplies everything else.
      if (!axis) {
        if (!caption || caption.bad) {
          noteBlock(col, null, null,
            'a class is drawn here, but the hour scale down the side did not read ' +
            'and neither did its own times', b);
          continue;
        }
        start = caption.start; end = caption.end;
        if (caption.unsure) why.push('no am/pm was printed, so the time is a guess');
      }
      recs.push({
        days: [col.day], range: { start, end, unsure: false },
        loc, course: courseFromRow({ words: inside }), ws: inside, why,
        fromGeometry: true, block: b,
        // PROVENANCE, NOT JUST THE ANSWER. Which witness supplied the clock is
        // the single biggest thing separating a trustworthy time from a
        // guessed one, and only this function knows it.
        timeFrom: axis ? 'axis' : 'caption', dayFrom: 'column', axisAgrees,
      });
    }
    if (recs.length) return tune.grid.agreeAcrossDays ? agreeOnRooms(recs, tune) : recs;
  }

  const body = rows.filter(r => r.y0 > layout.headerY);
  const recs = [];
  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    // Inside a grid a single visual row can hold several days' blocks, so
    // segment the row into runs of words that share a column.
    const runs = new Map();
    for (const w of row.words) {
      const c = colOf((w.x0 + w.x1) / 2);
      if (!c) continue;
      if (!runs.has(c.day)) runs.set(c.day, []);
      runs.get(c.day).push(w);
    }
    for (const [day, ws] of runs) {
      const rg = parseRange(ws.map(w => w.text).join(' '));
      if (!rg) continue;
      // The room is in the same column, one or two rows down.
      let loc = null, locWs = null;
      for (let k = 1; k <= tune.geom.maxLinesToLocation && i + k < body.length; k++) {
        const cand = body[i + k].words.filter(w => {
          const c = colOf((w.x0 + w.x1) / 2);
          return c && c.day === day;
        });
        if (!cand.length) continue;
        const l = locFromWords(cand, codes);
        if (l) { loc = l; locWs = l.words; break; }
        if (parseRange(cand.map(w => w.text).join(' '))) break;  // next event
      }
      let course = null;
      for (let k = 1; k <= 2 && i - k >= 0; k++) {
        const cand = body[i - k].words.filter(w => {
          const c = colOf((w.x0 + w.x1) / 2);
          return c && c.day === day;
        });
        if (!cand.length) continue;
        const cs = courseFromRow({ words: cand });
        if (cs) { course = cs; break; }
      }
      recs.push({ days: [day], range: rg, loc, course,
        ws: ws.concat(locWs || []) });
    }
  }
  return recs;
}

/** A registrar table: columns are named in the header; read the named cells. */
async function fromTable(rows, layout, page, tune, codes, ctx) {
  const hs = layout.headers;
  const bounds = hs.map((h, i) => ({
    key: h.key,
    x0: i === 0 ? -Infinity : (hs[i - 1].x1 + h.x0) / 2,
    x1: i === hs.length - 1 ? Infinity : (h.x1 + hs[i + 1].x0) / 2,
  }));
  const span = (keys) => {
    const b = bounds.filter(x => keys.includes(x.key));
    if (!b.length) return null;
    return {
      x0: Math.max(0, Math.min(...b.map(z => z.x0 === -Infinity ? 0 : z.x0))),
      x1: Math.min(page.w, Math.max(...b.map(z => z.x1 === Infinity ? page.w : z.x1))),
    };
  };
  const inSpan = (ws, s) => ws.filter(w => {
    const cx = (w.x0 + w.x1) / 2;
    return cx >= s.x0 && cx < s.x1;
  });
  const cell = (row, keys) => {
    const s = span(keys);
    if (!s) return null;
    const ws = inSpan(row.words, s);
    return ws.length ? ws : null;
  };

  /**
   * READ ONE CELL AGAIN, ON ITS OWN, WHEN THE PAGE PASS LOST IT.
   *
   * The page pass reads a whole registrar table as one block, and on a
   * photograph it drops individual cells: corpus image 12's "10:00 am-11:00 am"
   * comes back as "am-11:00 am", and image 01 loses one row's day letters
   * entirely. A cell is four square centimetres of the page; cropped out and
   * magnified it is an easy read. Only cells that actually came back empty are
   * re-read, so a clean table costs nothing.
   */
  const reread = async (row, keys, want) => {
    if (!ctx || !ctx.pm || !tune.grid.reOcrBlocks) return null;
    const s = span(keys);
    if (!s || !(s.x1 > s.x0)) return null;
    const pad = Math.max(4, (row.y1 - row.y0) * 0.3);
    const box = { x0: s.x0, y0: row.y0 - pad, x1: s.x1, y1: row.y1 + pad };
    // A CELL IS A LINE, NOT A BLOCK — and it is worth asking twice.
    // Mode 7 reads one short word that mode 6 refuses to commit to at all
    // (image 05's "MWF"); mode 6 still wins on a cell holding two runs of type
    // that the line finder splits. Neither dominates, so this tries the line
    // mode first and keeps the block mode as the fallback, stopping the moment
    // the caller says it has what it wanted.
    // A THIRD ATTEMPT WITH A GENEROUS MARGIN. Measured on image 05's "MWF":
    // nothing comes back at a 6 px margin under either mode, and the same cell
    // reads at a 40 px one — the layout analyser wants white space around the
    // type more than it wants magnification. The margin reaches into the rows
    // above and below, so what comes back is filtered by THIS row's own y band
    // as well as by the column, or the row below's day letters would be read
    // as this row's.
    const h = Math.max(1, row.y1 - row.y0);
    const keep = (got) => got.filter(w => {
      const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
      return cx >= s.x0 && cx < s.x1 && cy > row.y0 - h * 0.3 && cy < row.y1 + h * 0.3;
    });
    for (const t of [
      { psm: tune.ocr.linePsm, pad: 6 },
      { psm: tune.ocr.psm, pad: 6 },
      { psm: tune.ocr.psm, pad: Math.round(h * 1.2) },
    ]) {
      const ws = keep(await ocrCrop(ctx.pm, box, tune, 3, t));
      if (!ws.length) continue;
      if (!want || want(ws)) return ws;
    }
    return null;
  };

  const recs = [];
  for (const row of rows) {
    if (row.y1 <= layout.headerY) continue;
    let hourWs = cell(row, ['HOUR', 'HOURS', 'TIME', 'TIMES']);
    let rg = hourWs && parseRange(hourWs.map(w => w.text).join(' '));
    if ((!rg || rg.bad) && row.words.length >= 3) {
      const isRange = (ws) => {
        const r = parseRange(ws.map(w => w.text).join(' '));
        return !!(r && !r.bad);
      };
      const again = await reread(row, ['HOUR', 'HOURS', 'TIME', 'TIMES'], isRange);
      const rg2 = again && parseRange(again.map(w => w.text).join(' '));
      if (rg2 && !rg2.bad) { rg = rg2; hourWs = again; }
    }
    if (!rg) continue;
    const dayWs = cell(row, ['DAYS', 'DAY']);
    let days = null;
    if (dayWs) {
      for (const w of dayWs) {
        const d = parseDayLetters(w.text);
        if (d) { days = d; break; }
      }
    }
    if (!days) days = daysInRow(row).days;
    if (!days) {
      // Under a DAYS heading — and only there — a run may be repaired by one
      // confusable letter, which is what turns image 05's "MWE" back into MWF.
      const hasDay = (ws) => ws.some(w => repairDayRun(w.text));
      const again = await reread(row, ['DAYS', 'DAY'], hasDay);
      if (again) for (const w of again) { const d = repairDayRun(w.text); if (d) { days = d; break; } }
    }
    // A COLUMN'S CONTENT IS WIDER THAN ITS HEADING. "12:30 pm" reaches past the
    // midpoint into BLDG, and a cell read as raw text hands back a building
    // called "PMCMA". So each named cell keeps only the words that could be the
    // thing that column holds.
    const codeLike = w => /^[A-Za-z]{2,4}$/.test(w.text.replace(/[^A-Za-z]/g, '')) &&
      !NOT_A_CODE.test(w.text.replace(/[^A-Za-z]/g, '').toUpperCase());
    const roomLike = w => /\d/.test(w.text) && /^[#]?[0-9A-Za-z][0-9A-Za-z.\-]*$/.test(w.text);
    const bldgWs = (cell(row, ['BLDG', 'BUILDING']) || []).filter(codeLike);
    const roomWs = (cell(row, ['ROOM', 'LOCATION']) || []).filter(w => codeLike(w) || roomLike(w));
    let loc = null, locWs = [];
    if (bldgWs.length && roomWs.length) {
      const code = bldgWs.map(w => w.text).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = roomWs.map(w => w.text).join('').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
      if (code && room) { loc = { code, room }; locWs = bldgWs.concat(roomWs); }
    } else if (roomWs.length) {
      const l = locFromWords(roomWs, codes);
      if (l) { loc = l; locWs = l.words; }
    }
    // NOT EVERY TABLE'S HEADER SURVIVES THE PHOTOGRAPH. On corpus image 05 the
    // word ROOM itself is the one heading OCR loses, and without this fallback
    // a table whose every room is legible reports six classes with no rooms.
    if (!loc) {
      const l = locFromWords(row.words, codes);
      if (l) { loc = l; locWs = l.words; }
    }
    if (!loc) {
      const hasLoc = (ws) => !!locFromWords(ws, codes);
      const again = await reread(row, ['ROOM', 'LOCATION', 'BLDG', 'BUILDING'], hasLoc);
      const l = again && locFromWords(again, codes);
      if (l) { loc = l; locWs = l.words; }
    }
    const courseWs = cell(row, ['COURSE']);
    const course = courseWs ? courseFromRow({ words: courseWs }) : courseFromRow(row);
    recs.push({ days, range: rg, loc, course,
      ws: (dayWs || []).concat(hourWs, locWs) });
  }
  return recs;
}

/** A card stack, or anything else: read in flow, day letters beside the time. */
function fromCards(rows, page, tune, codes) {
  const recs = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rg = parseRange(row.text);
    if (!rg) continue;
    let { days, dayW } = daysInRow(row);
    if (!days) {
      for (let k = 1; k <= 2 && i - k >= 0; k++) {
        const d = daysInRow(rows[i - k]);
        if (d.days) { days = d.days; dayW = d.dayW; break; }
      }
    }
    let loc = null, locWs = [];
    for (let k = 0; k <= tune.geom.maxLinesToLocation && i + k < rows.length; k++) {
      const cand = k === 0
        ? row.words.filter(w => !dayW || w.x0 > dayW.x1)
        : rows[i + k].words;
      const l = locFromWords(cand, codes);
      if (l) { loc = l; locWs = l.words; break; }
      if (k > 0 && parseRange(rows[i + k].text)) break;
    }
    // The course is on this line in a table row and above it on a card, so
    // look here first — otherwise a table's rows get labelled with the course
    // one row up, which reads as a wrong answer even when every scored field
    // is right.
    let course = courseFromRow({ words: row.words.filter(w => !dayW || w.x1 <= dayW.x0) });
    for (let k = 1; !course && k <= 3 && i - k >= 0; k++) course = courseFromRow(rows[i - k]);
    recs.push({ days, range: rg, loc, course,
      ws: (dayW ? [dayW] : []).concat(row.words.filter(w => /\d/.test(w.text)), locWs) });
  }
  return recs;
}

/* ════════════════════════════════════════════════════════════════════════════
   EVIDENCE — what the confirm screen needs and the answer alone cannot carry

   THIS FILE READS. IT DOES NOT DECIDE HOW SURE TO BE. Everything below packages
   what was actually observed about each field — which words produced it, what
   the engine's own confidence in those words was, which witness supplied it,
   and where on the page it is — and hands it over. `js/schedconfirm.js` turns
   that into a number and a question. Keeping the judgement out of here is what
   lets the threshold be re-argued and re-measured without touching a reader.

   The boxes are in RECTIFIED page coordinates, which is the same space `words`
   and `page` are already in, so a crop taken with them is upright even when the
   student photographed their screen at an angle.
   ════════════════════════════════════════════════════════════════════════════ */

const LETTERS = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
const CLOCKISH = /^(\d{1,2}[:.]\d{2}|\d{1,2}|[AP]\.?M\.?|[-–—]|to)$/i;

/** Union bounding box of a word list, or null. */
function unionBox(ws) {
  const list = (ws || []).filter(Boolean);
  if (!list.length) return null;
  return {
    x0: Math.min(...list.map(w => w.x0)), y0: Math.min(...list.map(w => w.y0)),
    x1: Math.max(...list.map(w => w.x1)), y1: Math.max(...list.map(w => w.y1)),
  };
}

/**
 * THE WORST WORD, NOT THE AVERAGE ONE. A field is a phrase, and a phrase with
 * one unreadable word in it is an unreadable phrase — averaging lets three
 * confident words carry a fourth that the engine itself did not believe.
 */
function worstConf(ws) {
  const list = (ws || []).filter(w => w && typeof w.conf === 'number');
  if (!list.length) return null;
  return Math.min(...list.map(w => w.conf));
}

/**
 * Split a record's own words into the four fields, geometrically rather than by
 * asking the readers to thread provenance through three different code paths.
 * The readers already put exactly the words they used into `ws`, so this is a
 * classification of a short list, not a re-parse of the page.
 */
function fieldWords(r) {
  const all = (r.ws || []).filter(Boolean);
  const locWs = (r.loc && r.loc.words) || [];
  const isLoc = (w) => locWs.indexOf(w) >= 0;
  const rest = all.filter(w => !isLoc(w));
  const dayWs = rest.filter(w => {
    const t = LETTERS(w.text);
    return t.length >= 1 && t.length <= 7 && !!parseDayLetters(t);
  });
  const timeWs = rest.filter(w => CLOCKISH.test(String(w.text).trim()) && /\d|[ap]/i.test(w.text));
  // A joined "WEL2.224" is one word and both fields come off it; two words are
  // code then room, in that order, which is the only order locFromWords emits.
  const codeWs = locWs.length ? [locWs[0]] : [];
  const roomWs = locWs.length > 1 ? [locWs[1]] : locWs.slice();
  return { codeWs, roomWs, dayWs, timeWs, all };
}

/**
 * -> the evidence bundle attached to every class and every unsure item.
 * `codes` is the building lexicon; `rep` is repairCode's verdict, already made.
 */
function evidenceFor(r, rep, codes, tune, page, source) {
  const f = fieldWords(r);
  const raw = r.loc ? String(r.loc.code).toUpperCase() : null;
  const cands = raw ? codeCandidates(raw, codes, tune) : [];
  // ONLY ON A SCREENSHOT. The edge of a photograph is the DOCUMENT'S own edge
  // and cuts nothing; the edge of a screenshot is a crop, and a word touching
  // it is half a word. Reporting "runs off the edge" on every angled photo
  // whose margins happen to carry type would put a question on the whole
  // photographed half of the corpus for no reason. Same rule extract() already
  // applies to `truncated`, and it has to be the same rule.
  const edge = (ws) => source === 'screenshot' && ws.length > 0 && touchesEdge(ws, page, tune);
  return {
    boxes: {
      building: unionBox(f.codeWs), room: unionBox(f.roomWs),
      day: unionBox(f.dayWs), time: unionBox(f.timeWs),
      // The whole record, so a question can show the student the LINE their
      // class is on and not only the four characters in doubt.
      all: unionBox(f.all), block: r.block
        ? { x0: r.block.x0, y0: r.block.y0, x1: r.block.x1, y1: r.block.y1 } : null,
    },
    conf: {
      building: worstConf(f.codeWs), room: worstConf(f.roomWs),
      day: worstConf(f.dayWs), time: worstConf(f.timeWs),
    },
    from: {
      // 'column' = the day is the column it was drawn in, which does not depend
      // on reading anything. 'letters' = somebody's "MWF" had to be read.
      day: r.dayFrom || (r.fromGeometry ? 'column' : 'letters'),
      // 'axis' = the calendar's own hour ruler. 'caption' = four small digits.
      time: r.timeFrom || (r.fromGeometry ? 'caption' : 'text'),
      room: (r.loc && r.loc.borrowed) ? 'agreed-across-days' : 'read',
      building: !rep ? 'unrepaired' : (rep.repaired ? 'repaired' : 'lexicon'),
    },
    flags: {
      rawCode: raw,
      joined: !!(r.loc && r.loc.joined),
      borrowed: !!(r.loc && r.loc.borrowed),
      repaired: !!(rep && rep.repaired),
      knownCode: !!(raw && codes && codes.has(raw)),
      noMeridiem: !!(r.range && r.range.unsure),
      badRange: !!(r.range && r.range.bad),
      axisAgrees: (r.axisAgrees === undefined ? null : r.axisAgrees),
      truncated: r.truncated === undefined ? null : !!r.truncated,
      edge: { building: edge(f.codeWs), room: edge(f.roomWs), time: edge(f.timeWs) },
      source: source || null,   // 'photo' | 'screenshot'
    },
    // THE WHOLE CANDIDATE SET, INCLUDING THE AMBIGUOUS CASE. repairCode refuses
    // two candidates and it is right to; the screen shows them both and asks.
    candidates: { building: cands },
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PUBLIC CALL
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * extract(src, opts) -> {
 *   classes: [ { course, building, room, days:[...], start, end,
 *                needsConfirm, why } ],
 *   unsure:  [ ...the same shape, with `why` filled in ],
 *   layout, engine, stages, words
 * }
 *
 * `classes` is what the import screen puts in front of the student. Everything
 * in it that is not certain carries `needsConfirm` and a plain-words `why`, and
 * the screen is expected to make the student look at those before saving.
 * `unsure` is what was seen and deliberately NOT proposed — a half-word at the
 * edge of a crop, a building code that could be two different real buildings.
 */
export async function extract(src, opts = {}) {
  const tune = opts.tune || TUNE;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const stages = {};
  const mark = (k) => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    stages[k] = Math.round(now - t0 - (stages._acc || 0));
    stages._acc = now - t0;
  };

  const img = await decode(src);                       mark('decode');
  const det = findDocQuad(img, tune);                  mark('findDoc');
  const rect = rectify(img, det, tune);                mark('rectify');
  const pm = photometry(rect, tune);                   mark('photometry');
  const canvas = grayCanvas(pm);
  const words = await ocrWords(canvas, tune);          mark('ocr');

  const codes = await buildingCodes();
  const rows = buildRows(words, tune);
  const page = { w: pm.w, h: pm.h };
  const layout = classifyLayout(rows, page);
  let recs;
  const ctx = { rect, words, pm };
  if (layout.kind === 'grid') recs = await fromGrid(rows, layout, page, tune, codes, ctx);
  else if (layout.kind === 'table') recs = await fromTable(rows, layout, page, tune, codes, ctx);
  else recs = fromCards(rows, page, tune, codes);
  // A LAYOUT GUESS THAT PRODUCES NOTHING IS A WRONG GUESS. The flow reader
  // makes no structural assumption at all, so it is the floor under the other
  // two rather than a third alternative to them.
  let usedLayout = layout.kind;
  if (!recs.length && layout.kind !== 'cards') {
    recs = fromCards(rows, page, tune, codes);
    if (recs.length) usedLayout = layout.kind + '->flow';
  }
  mark('geometry');
  const classes = [], unsure = [];
  const seen = new Set();
  // Every item that leaves this loop — proposed or refused — carries the same
  // evidence bundle, because a refusal the screen can turn into a tap is worth
  // exactly as much as a proposal and needs exactly as much to do it with.
  const evOf = (r, rep) => evidenceFor(r, rep || null, codes, tune, page, rect.source);
  for (const r of recs) {
    const why = [];
    if (!r.loc) {
      unsure.push({ course: r.course, why: 'no room was readable for this class',
        ev: evOf(r, null), reason: 'no-room' });
      continue;
    }
    if (!r.days || !r.days.length) {
      unsure.push({ course: r.course, why: 'no day was readable for this class',
        ev: evOf(r, null), reason: 'no-day' });
      continue;
    }

    // A word cut off by the edge of the frame is half a word. On a PHOTO the
    // edge is the document's own edge and cuts nothing; on a SCREENSHOT it is a
    // crop, and "WEL 2.22" is not a room, it is the left half of one.
    const truncated = rect.source === 'screenshot' && touchesEdge(r.ws || [], page, tune);
    r.truncated = truncated;
    if (truncated) {
      unsure.push({
        course: r.course, building: r.loc.code, room: r.loc.room,
        why: 'this one runs off the edge of the picture, so part of it is missing',
        days: r.days.slice(), day: r.days[0],
        start: hhmm(r.range.start), end: hhmm(r.range.end),
        ev: evOf(r, repairCode(r.loc.code, codes, tune)), reason: 'cut-off',
      });
      continue;
    }

    let rep = repairCode(r.loc.code, codes, tune);
    if (!rep) {
      // A well-formed code this build does not know is REPORTED, not deleted —
      // UT files buildings this snapshot of the register never listed, and the
      // corpus contains one on purpose. It goes in front of the student with
      // the doubt attached rather than being dropped on the floor.
      const shape = /^[A-Z]{2,4}$|^[A-Z]{2,3}[0-9]$/.test(r.loc.code);
      if (!shape) {
        unsure.push({
          course: r.course, building: r.loc.code, room: r.loc.room,
          why: '"' + r.loc.code + '" does not read like a UT building code',
          days: r.days.slice(), day: r.days[0],
          start: hhmm(r.range.start), end: hhmm(r.range.end),
          ev: evOf(r, null), reason: 'not-a-code',
        });
        continue;
      }
      rep = { code: r.loc.code, repaired: false };
      why.push('"' + r.loc.code + '" is not a building code this app knows — check it');
    }
    if (rep.repaired) why.push('read the building as "' + r.loc.code + '"; the only real code it can be is ' + rep.code);
    if (r.why && r.why.length) for (const s of r.why) why.push(s);
    if (r.range.unsure) why.push('no am/pm was printed, so the time is a guess');
    if (r.range.bad) why.push('the end time read as before the start');
    if (r.loc.joined) why.push('the building and room were run together');

    const room = String(r.loc.room).toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    const ev = evOf(r, rep);
    for (const day of r.days) {
      const key = rep.code + '|' + room + '|' + day + '|' + r.range.start + '|' + r.range.end;
      if (seen.has(key)) continue;
      seen.add(key);
      const rec = {
        course: r.course || null,
        building: rep.code, room, day, days: [day],
        start: hhmm(r.range.start), end: hhmm(r.range.end),
        needsConfirm: why.length > 0,
        why: why.join('; ') || null,
        // The same bundle on every copy of a multi-day class. It is shared by
        // reference on purpose: the copies came off ONE reading of ONE line of
        // the picture, and showing the student that crop three times would be
        // three taps for one question.
        ev,
      };
      (r.range.bad ? unsure : classes).push(rec);
    }
  }
  // A BLOCK THAT WAS SEEN AND NOT READ GOES IN FRONT OF THE STUDENT TOO.
  // Returning an empty screen for a photograph that plainly contains six
  // classes is the failure this feature was built to avoid: the student has no
  // way to tell "there is nothing here" from "I could not read it". Each one
  // carries the day it is on — which comes from the column it sits in, not
  // from its writing — and its time when the calendar's ruler supplied one.
  for (const n of (ctx.seenNotRead || [])) {
    unsure.push({
      course: null, day: n.day, start: n.start, end: n.end,
      why: n.day
        ? n.why + ' (it is in the ' + n.day + ' column)'
        : n.why,
      reason: 'seen-not-read',
      // The rectangle IS the evidence here — there is no word to point at. A
      // student shown the block they drew on their own calendar can read the
      // room off it themselves in less time than this reader spent failing to.
      ev: n.block ? {
        boxes: { building: null, room: null, day: null, time: null,
          all: { x0: n.block.x0, y0: n.block.y0, x1: n.block.x1, y1: n.block.y1 },
          block: { x0: n.block.x0, y0: n.block.y0, x1: n.block.x1, y1: n.block.y1 } },
        conf: { building: null, room: null, day: null, time: null },
        from: { day: n.day ? 'column' : 'none', time: n.start ? 'axis' : 'none',
          room: 'unread', building: 'unread' },
        flags: { source: rect.source, unread: true },
        candidates: { building: [] },
      } : null,
    });
  }
  // AND WHEN THERE IS STILL NOTHING TO SAY, COUNT WHAT IS ON THE PICTURE.
  // A calendar whose day headings never read never reaches the block finder
  // above, so this asks it directly — but only in the case where the answer
  // would otherwise be a blank screen, so a page that read normally pays
  // nothing for it.
  if (!classes.length && !unsure.length && tune.grid.useBlockGeometry) {
    const blocks = findBlocks(rect, tune);
    if (blocks.length >= tune.grid.minBlocksToMention) {
      unsure.push({
        course: null, day: null, start: null, end: null,
        // "at least", because two events of one colour that touch are found as
        // one rectangle — the count is a floor, not a claim.
        why: 'there are at least ' + blocks.length + ' classes drawn on this calendar, but the ' +
          'writing inside them is too small or too blurred to read — try again with the ' +
          'camera square on to the screen, or send the calendar as a screenshot',
      });
    }
  }
  // THE STUDENT'S OWN PICTURE, UPRIGHT, FOR THE CONFIRM SCREEN TO CUT FROM.
  //
  // It is the RECTIFIED COLOUR page and not the grey one the engine read,
  // because the point of a crop is that the student recognises it — the
  // normalised plane is what the machine saw and looks like nothing they took.
  // Rectified rather than original because on an angled photograph the original
  // crop comes out as a trapezoid of tilted type, which is harder to read than
  // the answer it is meant to be checking.
  //
  // OPT-IN, because the benchmark calls extract() fifteen times in one page and
  // has no use for it: `keepSheet` is what the import screen passes and nothing
  // else does. A canvas is also the one representation of the image that CANNOT
  // be posted anywhere by accident — it does not survive structuredClone, so it
  // cannot cross into a worker, a message or a fetch body without somebody
  // writing the conversion out by hand.
  let sheet = null;
  if (opts.keepSheet) {
    const sc = makeCanvas(rect.w, rect.h);
    const sctx = sc.getContext('2d', { willReadFrequently: false });
    const sid = sctx.createImageData(rect.w, rect.h);
    sid.data.set(rect.data);
    sctx.putImageData(sid, 0, 0);
    sheet = { canvas: sc, w: rect.w, h: rect.h };
  }
  mark('judge');
  delete stages._acc;

  return {
    classes, unsure, layout: usedLayout, words, sheet,
    seen: {
      onlySeen: (ctx.seenNotRead || []).length,
      days: [...new Set((ctx.seenNotRead || []).map(n => n.day).filter(Boolean))],
    },
    rows: rows.length,
    page,
    source: rect.source,
    inverted: pm.inverted,
    quad: det ? det.quad : null,
    engine: { ...engineInfo },
    stages,
  };
}

export default extract;

if (typeof window !== 'undefined') {
  window.wayfindImageExtract = extract;
  // Every stage is on the global, not just the answer: a defect in a pipeline
  // this long is diagnosed by looking at the stage that produced it, and a
  // verify script that can only call extract() has to guess.
  window.SCHEDIMG = {
    extract, decode, findDocQuad, estimateLineHeight, rectify, photometry,
    grayCanvas, pickEngine, ocrWords, ocrCrop, buildRows, classifyLayout,
    hourAxis, findBlocks, parseRange, parseDayLetters, repairCode,
    codeCandidates, buildingCodes, releaseEngine, engineInfo, TUNE,
  };
}
