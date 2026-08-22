/**
 * coplanar.mjs — the static half of the z-fighting hunt.
 *
 * Two extrusions whose TOP faces are at the same height and whose footprints
 * overlap have no defined draw order. Which one wins is decided by depth-buffer
 * rounding, so it changes as the camera moves and the shared area breaks into a
 * comb of scanlines along the boundary. That is what "the roof is glitching"
 * looks like, and it is invisible in a still frame taken at one pose.
 *
 * zfight.mjs finds it by rendering. This finds it by arithmetic, which is
 * cheaper, exhaustive, and does not depend on the camera happening to be
 * pointed at it. Run both: this one cannot see a z-fight BETWEEN two different
 * sources with different height fields, and the renderer one cannot see a
 * z-fight that is off screen.
 *
 * Reports pairs of features that
 *   - come from the same document,
 *   - have top heights within `--eps` metres (default 0.01), and
 *   - whose footprints overlap by more than `--frac` of the smaller (0.30).
 *
 * Overlap is estimated by sampling points of the smaller polygon against the
 * larger — exact polygon clipping is not worth it to answer "do these two
 * substantially cover each other".
 *
 *   node scripts/verify/coplanar.mjs [file.geojson ...] [--eps 0.01] [--frac 0.3]
 *   node scripts/verify/coplanar.mjs --selftest        # prove the guard can fail
 *   node scripts/verify/coplanar.mjs --gate            # red only on NEW pairs
 *   node scripts/verify/coplanar.mjs --write-baseline  # after a deliberate fix
 *
 * Exit codes: 0 clean, 1 coplanar pairs (or, under `--gate`, MORE pairs than
 * the baseline), 2 something could not be read — which is always a failure and
 * never a skip.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SELECTION LOOKS THE WAY IT DOES (Aug 16 2026 — QUEUE N5)
 *
 * Until this rewrite the file it examined was a HARDCODED LIST of eight names
 * and the property pair it read was a HARDCODED `h`/`height` with an optional
 * `base`. Both went stale the moment a bake invented a name, and both failed
 * SILENTLY — a skipped feature and a clean feature print exactly the same
 * thing, which is "no coplanar overlaps".
 *
 * On the night the campus and West Campus storey trim merged, that cost the
 * project 882 unchecked extrusion rings:
 *
 *     data/campus_storeys.geojson    640   not in the TARGETS list at all
 *     data/westcampus.geojson        219   `dbase`/`dh`, so `p.h` was undefined
 *     data/drag.geojson               23   same
 *
 * and it reported "1144 features, no coplanar overlaps" on a file holding
 * 1363. This is the fourth guard in this repo found to pass because it could
 * not see the thing it was guarding (see HANDOFF §131). So:
 *
 *   1. TARGETS defaults to EVERY `data/*.geojson`, read off the directory.
 *      A new bake's output is in scope the moment it lands on disk.
 *   2. Every feature is accounted for. The report always prints
 *      `examined / flat / unreadable` against the file's own feature count, so
 *      the gap that started this is on the face of every run.
 *   3. A feature this file cannot INTERPRET is a hard failure (exit 2), never a
 *      skip. Unknown elevation schema, non-finite numbers, absolute tops below
 *      their own base — all of them stop the run and name the feature.
 *   4. The vocabulary is audited against the STYLESHEET, not maintained by
 *      hand. `auditStylesheet()` reads every `fill-extrusion-height` and
 *      `fill-extrusion-base` expression in `js/*.js`, pulls the `['get','x']`
 *      names out of them, and fails if the app reads a property as an
 *      extrusion height that SCHEMAS below has never heard of. That is the
 *      closed loop: a bake can only cause a z-fight through a paint
 *      expression, so a name that reaches the renderer cannot get past here.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i < 0 ? dflt : Number(argv[i + 1]);
};
const has = flag => argv.includes(flag);
const EPS = num('--eps', 0.01);
const FRAC = num('--frac', 0.30);
const SELFTEST = has('--selftest');
const QUIET = has('--quiet');
const GATE = has('--gate');
const WRITE_BASELINE = has('--write-baseline');
/* `--dump-pairs <path>` writes EVERY hit as JSON, carrying both features' ids
 * (`eid` where the schema has one) instead of the worst twelve by area.
 *
 * It exists because the count alone cannot be reasoned about. QUEUE Y24 turned
 * on WHICH pairs the +28 were — 26 of them were two different buildings' front
 * doors in one doorway and 2 were a door against its own step — and answering
 * that needed a throwaway pair dumper written from scratch, which then had to
 * be argued back into agreement with this file's eps, frac and sampling before
 * anyone could trust it. This is that dumper, inside the instrument, sharing
 * its pairing loop by construction. It is READ-ONLY: it changes no count, no
 * exit code and no baseline. */
const DUMP_PAIRS = (() => {
  const i = argv.indexOf('--dump-pairs');
  return i < 0 ? null : argv[i + 1];
})();
const dumped = [];

/* The recorded per-file pair counts, so a NEW coplanar pair is visible against
 * a repo that already carries some. Without this the tool is permanently red
 * (roofs alone has had 85 since it was written) and a guard that is always red
 * is a guard nobody reads. `--gate` compares against it; `--write-baseline`
 * rewrites it, and the diff is the record of what was accepted and when. */
const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'coplanar-baseline.json');

/* ── the elevation schemas ────────────────────────────────────────────────────
 *
 * A feature is classified by the SET of vocabulary properties on it that hold
 * a finite number — its signature. `b` on data/arts.geojson holds the string
 * `"lbj"` (a building id), so "is it a number" is part of the key, not an
 * afterthought.
 *
 * Each schema lists the top faces the feature contributes. `base: null` means
 * the extrusion starts at 0. `mode: 'rel'` means the paint expression is
 * `['+', base, h]`, so the property is a THICKNESS and the top is base + h.
 *
 * `files` is not a filter — a schema applies wherever its signature appears.
 * It is a per-file OVERRIDE hook, and it exists for exactly one reason: two
 * different bakes use `base`+`h` to mean two different things, and no amount
 * of looking at the data can tell them apart. Everything else is signature
 * driven.
 */
const SCHEMAS = [
  {
    sig: 'dbase+dh',
    tops: [{ base: 'dbase', top: 'dh', mode: 'abs', role: 'trim' }],
    why: "storey trim. js/facades.js campus-storeys, js/drag.js drag-detail, " +
         "js/westcampus.js wc-detail all paint height ['get','dh'] base " +
         "['get','dbase']. A separate name on purpose: trim OVERLAPS the wall " +
         "band it sits on, so it cannot carry the band schema's contract.",
  },
  {
    sig: 'base+h',
    file: 'entrances.geojson',
    tops: [{ base: 'base', top: 'h', mode: 'rel', role: 'entrance' }],
    why: "js/entrances.js paints height ['+',['get','base'],['get','h']] on all " +
         "four of its layers — `h` is the THICKNESS of the band, not its top. " +
         "Reading it as an absolute top is what made this file report pairs at " +
         "top=0.06 and top=0.14, i.e. pairs of thicknesses.",
  },
  {
    sig: 'base+h',
    tops: [{ base: 'base', top: 'h', mode: 'abs', role: 'band' }],
    why: "the ordinary wall/band schema. js/drag.js, js/westcampus.js, " +
         "js/tower.js, js/moody.js, js/places.js, js/capitol.js, js/arts.js, " +
         "js/heroes.js and js/app.js all paint height ['get','h'] base " +
         "['get','base'].",
  },
  {
    sig: 'b+h',
    tops: [{ base: 'b', top: 'h', mode: 'abs', role: 'band' }],
    why: "the same thing under the short name. js/roofs.js, js/ground.js, " +
         "js/props.js and js/app.js paint base ['get','b'] height ['get','h'].",
  },
  {
    sig: 'h',
    tops: [{ base: null, top: 'h', mode: 'abs', role: 'ground-up' }],
    why: "extruded from zero. js/props.js and js/outer.js paint base as a " +
         "constant with height ['get','h'].",
  },
  {
    sig: 'final_height',
    tops: [{ base: null, top: 'final_height', mode: 'abs', role: 'replacement' }],
    why: "a footprint that REPLACES a basemap building. js/app.js paints " +
         "capHeight(['get','final_height']) / capBase(['get','final_height']).",
  },
  {
    sig: 'base+final_height+h',
    tops: [{ base: 'base', top: 'h', mode: 'abs', role: 'band' },
           { base: null, top: 'final_height', mode: 'abs', role: 'replacement' }],
    why: "data/stadium.geojson's twelve footprint features carry both: they are " +
         "drawn as a band by js/app.js's stadium layers AND handed to the " +
         "basemap replacement. Two top faces, so two entries — a feature is " +
         "never paired against itself.",
  },
];

/* Property names that reach a fill-extrusion paint expression but never appear
 * on a local geojson feature, with the reason. auditStylesheet() will not fail
 * on these. Anything NOT here and not in a schema stops the run. */
const VOCAB_EXEMPT = {
  height: 'openmaptiles basemap vector property, not a repo geojson field',
  min_height: 'openmaptiles basemap vector property, not a repo geojson field',
};

const VOCAB = new Set(Object.keys(VOCAB_EXEMPT));
for (const s of SCHEMAS) for (const t of s.tops) {
  if (t.base) VOCAB.add(t.base);
  VOCAB.add(t.top);
}
/* The signature alphabet: only these names are looked at when classifying, so
 * a feature carrying `d` (trunk diameter) or `n` (door count) is not confused
 * for an elevation. Derived from the schemas, never typed twice. */
const SIG_KEYS = [...VOCAB].filter(k => !VOCAB_EXEMPT[k]).sort();

const schemaFor = (sig, file) =>
  SCHEMAS.find(s => s.sig === sig && s.file === file) ||
  SCHEMAS.find(s => s.sig === sig && !s.file);

/* ── the stylesheet audit ──────────────────────────────────────────────────── */

/** Read a balanced `[...]` or a bare token starting at `i` in `src`. */
function readExpr(src, i) {
  while (i < src.length && /[\s:,']/.test(src[i])) i++;
  if (src[i] !== '[') return src.slice(i, src.indexOf('\n', i) + 1 || src.length);
  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') d++;
    else if (src[j] === ']' && --d === 0) return src.slice(i, j + 1);
  }
  return src.slice(i, i + 400);
}

/**
 * Every property name `js/*.js` reads as a fill-extrusion base or height.
 * Over-matching here is safe: it can only demand a schema entry, never hide
 * one. Under-matching is the bug this whole file is about, so the extraction
 * is a balanced read from the paint key, not a line-scoped regex.
 */
function auditStylesheet(inject) {
  const found = new Map(); // name -> "js/x.js:12"
  let files = [];
  if (inject) files = Object.keys(inject);
  else try { files = readdirSync(join(ROOT, 'js')).filter(f => f.endsWith('.js')); } catch { }
  for (const f of files) {
    const src = inject ? inject[f] : readFileSync(join(ROOT, 'js', f), 'utf8');
    const re = /fill-extrusion-(?:height|base)'?/g;
    let m;
    while ((m = re.exec(src))) {
      const expr = readExpr(src, m.index + m[0].length);
      for (const g of expr.matchAll(/\[\s*'get'\s*,\s*'([A-Za-z_][\w]*)'\s*\]/g)) {
        if (!found.has(g[1])) {
          const line = src.slice(0, m.index).split('\n').length;
          found.set(g[1], `js/${f}:${line}`);
        }
      }
    }
  }
  const unknown = [...found].filter(([n]) => !VOCAB.has(n));
  return { found, unknown, files: files.length };
}

/* ── geometry ─────────────────────────────────────────────────────────────── */

const M_LAT = 110574;
const mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

const ringsOf = g => !g ? [] : g.type === 'Polygon' ? g.coordinates
  : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];

function inRing(x, y, r) {
  let h = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) h = !h;
  }
  return h;
}
const inPoly = (x, y, rings) => {
  let s = false;
  for (const r of rings) if (inRing(x, y, r)) s = !s;
  return s;
};

/** Fraction of A's area that also lies inside B, by grid sampling A's bbox. */
function overlapFrac(A, B) {
  const [alo, ahi] = A.bb;
  const N = 22;
  let inA = 0, inBoth = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = alo[0] + (ahi[0] - alo[0]) * (i + 0.5) / N;
    const y = alo[1] + (ahi[1] - alo[1]) * (j + 0.5) / N;
    if (!inPoly(x, y, A.rings)) continue;
    inA++;
    if (inPoly(x, y, B.rings)) inBoth++;
  }
  return inA ? inBoth / inA : 0;
}

/* ── classification ───────────────────────────────────────────────────────── */

/**
 * Turn one feature into zero or more top faces, or into a complaint.
 *
 * Returns `{ items }`, `{ flat: true }` (no geometry, or no elevation property
 * at all, so nothing is extruded) or `{ bad: 'reason' }`. It NEVER returns a
 * silent skip — that distinction is the entire point of the rewrite.
 */
function classify(f, idx, file) {
  const rings = ringsOf(f.geometry);
  const p = f.properties || {};
  const present = SIG_KEYS.filter(k => k in p);
  const numeric = present.filter(k => typeof p[k] === 'number' && Number.isFinite(p[k]));
  // A vocabulary name that is PRESENT but holds neither a finite number nor a
  // string is a broken bake, not a flat feature. (A string is fine: `b` on
  // data/arts.geojson holds a building id, "lbj", and is not an elevation.)
  const junk = present.filter(k => !numeric.includes(k) && typeof p[k] !== 'string');
  if (junk.length) {
    return { bad: `${junk.map(k => `${k}=${JSON.stringify(p[k])}`).join(' ')} ` +
                  `is not a finite number` };
  }
  const sig = numeric.join('+');

  if (!sig) return { flat: true, rings: rings.length };
  if (!rings.length) return { flat: true, rings: 0 };

  const schema = schemaFor(sig, basename(file));
  if (!schema) {
    return { bad: `no schema for elevation signature {${sig}} — if a bake has ` +
                  `invented a name, add it to SCHEMAS with the paint expression ` +
                  `that reads it; do not delete this check` };
  }

  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const r of rings) for (const q of r) {
    lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
    hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
  }
  const lat0 = (lo[1] + hi[1]) / 2;
  const area = (hi[0] - lo[0]) * mLon(lat0) * (hi[1] - lo[1]) * M_LAT;

  const items = [];
  for (const t of schema.tops) {
    const base = t.base ? p[t.base] : 0;
    const raw = p[t.top];
    if (!Number.isFinite(base) || !Number.isFinite(raw)) {
      return { bad: `schema {${sig}} wants ${t.base || '0'}/${t.top}, got ` +
                    `${JSON.stringify(base)}/${JSON.stringify(raw)}` };
    }
    const top = t.mode === 'rel' ? base + raw : raw;
    // An ABSOLUTE top below its own base is the tell that the file is really
    // relative and the schema is wrong. This is the assertion that would have
    // caught the entrances misreading from the data alone.
    if (t.mode === 'abs' && top < base - 1e-9) {
      return { bad: `absolute top ${top} is BELOW base ${base} — schema {${sig}} ` +
                    `may be reading a thickness as a height (see the 'rel' mode)` };
    }
    items.push({ idx, key: `${idx}:${t.role}`, p, rings, bb: [lo, hi], top, base,
                 area, role: t.role, sig });
  }
  return { items };
}

/* ── the check ────────────────────────────────────────────────────────────── */

function check(label, features, file) {
  const items = [], bad = [];
  let flat = 0;
  features.forEach((f, idx) => {
    const r = classify(f, idx, file);
    if (r.bad) { bad.push({ idx, why: r.bad }); return; }
    if (r.flat) { flat++; return; }
    items.push(...r.items);
  });

  // Bucket by rounded top height, so only plausible pairs are ever compared.
  //
  // Each item lives in exactly ONE bucket (its own rounded key) and candidate
  // pairs are drawn within a bucket and against the buckets at +1 and +2 —
  // the same candidate set as the old "each item in three buckets" layout
  // (two keys share a bucket there iff they differ by <= 2), but each
  // unordered pair is visited exactly once BY CONSTRUCTION. The old layout
  // visited a pair up to three times and deduped with a `seen` Set of string
  // keys, and that Set is O(eps-close pairs): data/trees.geojson alone put
  // 6.4M entries in it (2026-08-22 bake — canopy tops are quantised, e.g. a
  // spike at exactly 17.00), and V8 throws `RangeError: Set maximum size
  // exceeded` at 2^24 = 16.7M entries, which a denser tree bake or a wider
  // --eps reaches. Reproduced: `--eps 0.05 data/trees.geojson` kills the old
  // code and completes here. Constructive dedup needs no memory at all.
  const bucket = new Map();
  for (const it of items) {
    const k = Math.round(it.top / Math.max(EPS, 1e-6));
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(it);
  }

  const hits = [];
  const consider = (A, B) => {
    if (A.idx === B.idx) return;              // never a feature against itself
    if (Math.abs(A.top - B.top) > EPS) return;
    if (A.bb[1][0] < B.bb[0][0] || A.bb[0][0] > B.bb[1][0] ||
        A.bb[1][1] < B.bb[0][1] || A.bb[0][1] > B.bb[1][1]) return;
    const [S, L] = A.area <= B.area ? [A, B] : [B, A];
    const f = overlapFrac(S, L);
    if (f < FRAC) return;
    hits.push({ S, L, f });
    if (DUMP_PAIRS) {
      const id = it => (it.p.eid !== undefined ? it.p.eid : null);
      dumped.push({
        file: label,
        a: id(S), b: id(L),
        ia: S.idx, ib: L.idx,
        ka: S.p.k || S.p.kind || S.p.part || null,
        kb: L.p.k || L.p.kind || L.p.part || null,
        top: +S.top.toFixed(3),
        area: +S.area.toFixed(2),
        shared: +(f * 100).toFixed(1),
        at: [+S.bb[0][0].toFixed(6), +S.bb[0][1].toFixed(6)],
      });
    }
  };
  for (const [k, list] of bucket) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) consider(list[i], list[j]);
      for (const d of [1, 2]) {
        const other = bucket.get(k + d);
        if (other) for (const B of other) consider(list[i], B);
      }
    }
  }

  // THE ACCOUNTING LINE. Printed on every file, pass or fail, because a
  // number that is smaller than the file is the shape this bug takes.
  const total = features.length;
  const acc = `${String(total).padStart(6)} feats  ` +
              `${String(items.length).padStart(6)} tops  ` +
              `${String(flat).padStart(5)} flat  ` +
              `${String(bad.length).padStart(4)} unreadable`;
  console.log(`${label.padEnd(26)} ${acc}  ${
    bad.length ? 'UNREADABLE — SEE BELOW'
    : hits.length ? `${hits.length} COPLANAR OVERLAP(S) at the same top height`
    : 'no coplanar overlaps'}`);

  for (const b of bad.slice(0, 20)) console.log(`    !! feature #${b.idx}: ${b.why}`);
  if (bad.length > 20) console.log(`    !! ...and ${bad.length - 20} more`);

  if (hits.length && !QUIET) {
    const byKind = new Map();
    for (const h of hits) {
      const nm = it => `${it.role}:${it.p.k || it.p.kind || it.p.part || '?'}`;
      const k = `${nm(h.S)} / ${nm(h.L)}`;
      byKind.set(k, (byKind.get(k) || 0) + 1);
    }
    for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
      console.log(`    ${String(n).padStart(5)}  ${k}`);
    }
    console.log('    worst by shared area:');
    for (const h of hits.sort((a, b) => b.S.area * b.f - a.S.area * a.f).slice(0, 12)) {
      const c = h.S.bb[0];
      console.log(
        `      #${String(h.S.idx).padEnd(6)} + #${String(h.L.idx).padEnd(6)} ` +
        `${(h.S.p.k || h.S.p.kind || '?').padEnd(7)} top=${h.S.top.toFixed(2)}  ` +
        `${(h.S.area).toFixed(0).padStart(6)} m^2 x ${(h.f * 100).toFixed(0)}% shared   @ ${c[0].toFixed(5)},${c[1].toFixed(5)}`
      );
    }
  }
  return { hits: hits.length, bad: bad.length, tops: items.length, flat, total };
}

/* ── self test: the guard must be seen to fail ────────────────────────────── */

function selftest() {
  const sq = (x, y, w) => [[[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]]];
  const F = (props, geom) => ({ type: 'Feature', properties: props,
                                geometry: { type: 'Polygon', coordinates: geom } });
  let fails = 0;
  const expect = (name, cond, got) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   got ${got}`}`);
    if (!cond) fails++;
  };

  console.log('\n--- selftest 1: a deliberately coplanar dbase/dh pair MUST be caught');
  let r = check('SELFTEST coplanar-trim', [
    F({ kind: 'detail', part: 'course', dbase: 7.28, dh: 7.52 }, sq(-97.7400, 30.2840, 0.0004)),
    F({ kind: 'detail', part: 'cornice', dbase: 7.20, dh: 7.52 }, sq(-97.7400, 30.2840, 0.0004)),
  ], 'selftest.geojson');
  expect('caught the trim/trim pair the old code could not see', r.hits === 1, r.hits);
  expect('both rings were examined', r.tops === 2, r.tops);

  console.log('\n--- selftest 2: an elevation signature with no schema MUST fail loudly');
  r = check('SELFTEST unknown-schema', [
    // `dh` with no `dbase`: half a known pair, which is what a bake looks like
    // mid-rename. There is no schema for {dh} and there must not be a guess.
    F({ kind: 'detail', dh: 4.0 }, sq(-97.74, 30.284, 0.0004)),
  ], 'selftest.geojson');
  expect('unknown signature {dh} reported as unreadable', r.bad === 1, r.bad);

  console.log('\n--- selftest 3: a non-numeric height MUST be unreadable, not skipped');
  r = check('SELFTEST junk-height', [
    F({ kind: 'detail', base: 0, h: null }, sq(-97.74, 30.284, 0.0004)),
  ], 'selftest.geojson');
  expect('null height reported as unreadable', r.bad === 1, r.bad);

  console.log('\n--- selftest 4: an absolute top below its own base MUST fail');
  r = check('SELFTEST inverted', [
    F({ kind: 'detail', base: 5.0, h: 2.0 }, sq(-97.74, 30.284, 0.0004)),
  ], 'selftest.geojson');
  expect('inverted extrusion reported as unreadable', r.bad === 1, r.bad);

  console.log('\n--- selftest 5: the old blindness MUST NOT come back');
  // Exactly the shape that slipped through: a file whose features carry
  // dbase/dh only. The old code read `p.h`, got undefined, and returned before
  // pushing anything — 0 tops, "no coplanar overlaps".
  r = check('SELFTEST wall-trim-file', [
    F({ kind: 'detail', dbase: 1.0, dh: 1.24 }, sq(-97.74, 30.284, 0.0004)),
    F({ kind: 'detail', dbase: 2.0, dh: 2.24 }, sq(-97.74, 30.285, 0.0004)),
    F({ kind: 'detail', dbase: 3.0, dh: 3.24 }, sq(-97.74, 30.286, 0.0004)),
  ], 'selftest.geojson');
  expect('all three dbase/dh rings examined (old code examined 0)', r.tops === 3, r.tops);

  console.log('\n--- selftest 6: the stylesheet audit');
  const a = auditStylesheet();
  expect(`read ${a.files} js files and found ${a.found.size} extrusion property names`,
         a.found.size > 0 && a.files > 0, `${a.found.size}/${a.files}`);
  expect('every name the app extrudes on has a schema', a.unknown.length === 0,
         a.unknown.map(([n, w]) => `${n} @ ${w}`).join(', '));

  console.log('\n--- selftest 7: a bake that invents a name and wires it into a paint');
  console.log('               expression MUST be caught by the audit — this is the');
  console.log('               loop that makes a silent skip impossible.');
  const fake = auditStylesheet({
    'invented.js': `map.addLayer({ id:'x', type:'fill-extrusion', paint:{
        'fill-extrusion-color': ['get','wd'],
        'fill-extrusion-height': ['get', 'sh'],
        'fill-extrusion-base': ['get', 'sbase'] } });`,
  });
  expect("the audit rejects an unknown extrusion height 'sh'",
         fake.unknown.some(([n]) => n === 'sh'), JSON.stringify(fake.unknown));
  expect("the audit rejects an unknown extrusion base 'sbase'",
         fake.unknown.some(([n]) => n === 'sbase'), JSON.stringify(fake.unknown));
  expect('the audit does NOT drag in the colour expression',
         !fake.unknown.some(([n]) => n === 'wd'), JSON.stringify(fake.unknown));

  console.log('\n--- selftest 8: the multi-line paint form is read too');
  // js/ground.js writes some of these via setPaintProperty with the expression
  // on the FOLLOWING line. A line-scoped regex misses it; the balanced read
  // must not.
  const multi = auditStylesheet({
    'wrapped.js': `map.setPaintProperty(L, 'fill-extrusion-height',\n` +
                  `        ['*', ['get', 'sh'], 2]);`,
  });
  expect("wrapped expression's 'sh' still found",
         multi.unknown.some(([n]) => n === 'sh'), JSON.stringify(multi.unknown));

  console.log('\n--- selftest 9: the pairing layout finds every pair ONCE — including');
  console.log('               pairs that straddle a bucket boundary. Guards the 2026-08-22');
  console.log('               rewrite (constructive dedup, no `seen` Set) and any future');
  console.log('               edit to the bucket walk, against BOTH failure modes:');
  console.log('               a missed boundary pair and a double-counted same-bucket pair.');
  // Keys are round(top/EPS), EPS = 0.01 here.
  //   P1: same key (1000/1000)            -> 1 hit
  //   P2: adjacent keys (1000/1001), tops 0.0011 apart, well inside eps -> 1 hit
  //   P3: keys two apart (1001/1003), tops 0.012 apart, OUTSIDE eps -> 0 hits
  //       (exercises the +2 bucket walk without producing a pair)
  //   T:  three identical footprints at one top -> exactly 3 hits. The old
  //       triple-bucket layout visited each of these pairs 3x and relied on
  //       the `seen` Set to report 3 rather than 9; here 3 must fall out of
  //       the walk itself.
  r = check('SELFTEST pair-once', [
    F({ kind: 'p1', base: 0, h: 10.000 }, sq(-97.7400, 30.2840, 0.0004)),
    F({ kind: 'p1', base: 0, h: 10.000 }, sq(-97.7400, 30.2840, 0.0004)),
    F({ kind: 'p2', base: 0, h: 10.0040 }, sq(-97.7300, 30.2840, 0.0004)),
    F({ kind: 'p2', base: 0, h: 10.0051 }, sq(-97.7300, 30.2840, 0.0004)),
    F({ kind: 'p3', base: 0, h: 10.014 }, sq(-97.7200, 30.2840, 0.0004)),
    F({ kind: 'p3', base: 0, h: 10.026 }, sq(-97.7200, 30.2840, 0.0004)),
    F({ kind: 't', base: 0, h: 20.00 }, sq(-97.7100, 30.2840, 0.0004)),
    F({ kind: 't', base: 0, h: 20.00 }, sq(-97.7100, 30.2840, 0.0004)),
    F({ kind: 't', base: 0, h: 20.00 }, sq(-97.7100, 30.2840, 0.0004)),
  ], 'selftest.geojson');
  expect('exactly 5 pairs: 1 same-key + 1 boundary + 0 beyond-eps + 3 from the trio',
         r.hits === 5, r.hits);
  expect('all nine rings were examined', r.tops === 9, r.tops);

  console.log(`\nselftest: ${fails ? `${fails} FAILED` : 'all passed'}\n`);
  return fails;
}

/* ── main ─────────────────────────────────────────────────────────────────── */

if (SELFTEST) process.exit(selftest() ? 2 : 0);

const audit = auditStylesheet();
if (audit.unknown.length) {
  console.log('STYLESHEET AUDIT FAILED — the app extrudes on a property this checker');
  console.log('does not understand, so features carrying it would be misread:');
  for (const [n, where] of audit.unknown) console.log(`    '${n}'  read at ${where}`);
  console.log('Add a schema to SCHEMAS (or an entry to VOCAB_EXEMPT with a reason).\n');
  process.exit(2);
}

const explicit = argv.filter(a => a.endsWith('.geojson'));
const TARGETS = explicit.length ? explicit
  : readdirSync(join(ROOT, 'data')).filter(f => f.endsWith('.geojson')).sort()
      .map(f => join(ROOT, 'data', f));

console.log(`stylesheet audit ok — ${audit.found.size} extrusion property names in ` +
            `js/*.js, all with a schema`);
console.log(`scanning ${TARGETS.length} file(s), eps=${EPS} m, frac=${FRAC}\n`);

let totalPairs = 0, totalBad = 0, totalTops = 0, totalFeats = 0;
const missing = [];
const counts = {};

for (const path of TARGETS) {
  let gj;
  try { gj = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { missing.push(`${basename(path)}: ${e.message}`); continue; }
  if (!Array.isArray(gj.features)) { missing.push(`${basename(path)}: no feature array`); continue; }
  const r = check(basename(path), gj.features, path);
  counts[basename(path)] = r.hits;
  totalPairs += r.hits; totalBad += r.bad; totalTops += r.tops; totalFeats += r.total;
}

console.log('');
console.log(`TOTAL  ${totalFeats} features, ${totalTops} top faces examined, ` +
            `${totalPairs} coplanar pair(s), ${totalBad} unreadable`);
if (DUMP_PAIRS) {
  writeFileSync(DUMP_PAIRS, JSON.stringify(dumped, null, 1) + '\n');
  console.log(`dumped ${dumped.length} pair(s) to ${DUMP_PAIRS}`);
}
if (missing.length) {
  console.log('FILES THAT COULD NOT BE READ (this is a failure, not a skip):');
  for (const m of missing) console.log(`    ${m}`);
}

let regressed = 0;
if (WRITE_BASELINE) {
  if (explicit.length) {
    console.log('\nrefusing to write a baseline from a partial run — omit the file arguments');
    process.exit(2);
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(
    { eps: EPS, frac: FRAC, recorded: new Date().toISOString().slice(0, 10), counts },
    null, 2) + '\n');
  console.log(`\nbaseline written to ${basename(BASELINE_PATH)}`);
} else if (GATE) {
  if (!existsSync(BASELINE_PATH)) {
    console.log('\n--gate needs a baseline; run --write-baseline first');
    process.exit(2);
  }
  const b = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (b.eps !== EPS || b.frac !== FRAC) {
    console.log(`\nbaseline was recorded at eps=${b.eps} frac=${b.frac}, this run is ` +
                `eps=${EPS} frac=${FRAC} — not comparable`);
    process.exit(2);
  }
  console.log(`\ngate against baseline of ${b.recorded} (eps=${b.eps}, frac=${b.frac}):`);
  for (const [f, n] of Object.entries(counts)) {
    const was = b.counts[f];
    if (was === undefined) {
      console.log(`    NEW FILE   ${f.padEnd(26)} ${n} pair(s) — not in the baseline`);
      if (n) regressed++;
    } else if (n > was) {
      console.log(`    REGRESSED  ${f.padEnd(26)} ${was} -> ${n}`);
      regressed++;
    } else if (n < was) {
      console.log(`    improved   ${f.padEnd(26)} ${was} -> ${n} (rerun --write-baseline)`);
    }
  }
  if (!regressed) console.log('    no file gained a coplanar pair');
}
console.log('');
process.exit(totalBad || missing.length ? 2
             : GATE ? (regressed ? 1 : 0)
             : totalPairs ? 1 : 0);
