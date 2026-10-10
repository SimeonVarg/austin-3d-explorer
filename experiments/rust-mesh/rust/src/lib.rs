//! meshkernel: the shared mesh builder of js/slopes.js `build()` (tri / quad / triN / facet, flat shading,
//! welded planar quads, byte colours, per-vertex surface), as a WebAssembly module with a flat C ABI.
//!
//! WHY A FLAT C ABI AND NO wasm-bindgen: the whole job is "bytes in, bytes out". The generator writes
//! records into a staging buffer that lives in wasm memory, calls `process(n)` once per batch, and at
//! the end reads the finished vertex/index arrays as typed-array views of the same memory (zero copy).
//! No strings, no objects, no per-vertex calls cross the boundary, so there is nothing for glue code to do.
//!
//! BYTE-IDENTICAL TO THE JS. Every float operation is done in f64 in the same order as slopes.js, `hypot`
//! reproduces V8's Kahan-summed Math.hypot, and the f64 -> f32 store is the same round-to-nearest-even as a
//! Float32Array store. The compare harness (../compare.mjs) holds this to a sha256 match against the real
//! builder on the full 3.1 M triangle catalog.
//!
//! PACKED OUTPUT (?packverts=1, `init_packed`). Instead of normal / three colour triples / facet / surface per vertex, `push` stores the
//! exact f32 position and ONE u32 word, and keeps the two tables the vertex shader reads: tones (16 f32 each: day.rgb,0 golden.rgb,0
//! night.rgb,0 surface.xyzw, colour = byte / 255) and flat normals (4 f32 each). Ids are handed out in first-encounter order of the
//! vertices, exactly as `vertexTables()` in js/slopes.js does it: a normal is interned by the exact bit pattern of its three f32s (so -0
//! and +0 stay two normals), a tone by the CLASS the JS side gives its palette entry (the same text key `toneKey()` uses, so two entries
//! the JS packed store would call one tone are one here, and two it would call two stay two). The word is
//!   lo = tone | facet << toneBits | (nid % nlow) << (toneBits + 1)      hi = floor(nid / nlow)      nlow = 2^(15 - toneBits)
//! stored as lo | hi << 16 (little endian: JS reads it as two uint16, low first). Running out of tones (2^toneBits) or normals
//! (2^(31 - toneBits)) sets `overflow()` and stops interning; the JS side throws its packOverflow error and the build is redone unpacked.
//!
//! Record layout (28 f64 = 224 bytes; see profile/record-stream.mjs):
//!   [0] op: 0 tri(a,b,c,want) | 1 quad(a,b,c,d,want) | 2 triN(a,b,c,na,nb,nc) | 3 facet(flag in [27])
//!   [1] colour id   [2] has_want   [3..6] want   [6..9] a  [9..12] b  [12..15] c  [15..18] d
//!   [18..21] na  [21..24] nb  [24..27] nc  [27] facet flag

pub mod blur;

use std::cell::UnsafeCell;

const REC: usize = 28;

type V3 = [f64; 3];

#[derive(Clone, Copy, Default)]
struct Tone {
    class: u32,
    cd: [u8; 3],
    cg: [u8; 3],
    cn: [u8; 3],
    surf: [f32; 4],
}

const NONE: u32 = u32::MAX;

/// The packed-vertex state: the word per vertex and the two tables (js/slopes.js `vertexTables()`, in Rust).
struct Packer {
    tone_bits: u32,
    max_tones: u32,
    max_normals: u32,
    nlow: u32,
    words: Vec<u32>,
    tones: Vec<f32>,        // 16 per tone
    tone_class: Vec<u32>,   // the class of each tone, in id order
    class_tone: Vec<u32>,   // class -> tone id, or NONE
    normals: Vec<f32>,      // 4 per normal: x, y, z, 0
    hash: Vec<i32>,         // open addressing over the normal bits: normal id, or -1
    n_normals: u32,
    overflow: u32,          // bit 0: out of tones, bit 1: out of normals
    // the word of the previous vertex: the corners of a primitive share normal, tone and facet
    l_n: [u64; 3],
    l_col: usize,
    l_fac: u8,
    l_word: u32,
}

const HASH0: usize = 1 << 14;

#[inline(always)]
fn hash_of(a: u32, b: u32, c: u32) -> u32 {
    let mut h = (a ^ 0x9e3779b9).wrapping_mul(0x85ebca6b) ^ b.wrapping_add(0x7f4a7c15).wrapping_mul(0xc2b2ae35) ^ (c ^ 0x165667b1).wrapping_mul(0x27d4eb2f);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b3c6d);
    h ^ (h >> 12)
}

impl Packer {
    fn new(tone_bits: u32) -> Packer {
        Packer {
            tone_bits, max_tones: 1u32 << tone_bits, max_normals: 1u32 << (31 - tone_bits), nlow: 1u32 << (15 - tone_bits),
            words: Vec::new(), tones: Vec::new(), tone_class: Vec::new(), class_tone: Vec::new(),
            normals: Vec::new(), hash: Vec::new(), n_normals: 0, overflow: 0,
            l_n: [0; 3], l_col: usize::MAX, l_fac: 255, l_word: 0,
        }
    }
    /// the id of the normal with exactly these f32 bits, interning it on first sight
    fn normal(&mut self, x: f32, y: f32, z: f32) -> u32 {
        let (a, b, c) = (x.to_bits(), y.to_bits(), z.to_bits());
        let mask = self.hash.len() - 1;
        let mut i = hash_of(a, b, c) as usize & mask;
        loop {
            let id = self.hash[i];
            if id < 0 { break; }
            let o = id as usize * 4;
            if self.normals[o].to_bits() == a && self.normals[o + 1].to_bits() == b && self.normals[o + 2].to_bits() == c { return id as u32; }
            i = (i + 1) & mask;
        }
        if self.n_normals >= self.max_normals { self.overflow |= 2; return 0; }
        let id = self.n_normals;
        self.n_normals += 1;
        self.normals.extend_from_slice(&[x, y, z, 0.0]);
        self.hash[i] = id as i32;
        if self.n_normals as usize * 2 > self.hash.len() {   // keep the table at most half full
            let mut nh = vec![-1i32; self.hash.len() * 2];
            let m2 = nh.len() - 1;
            for id2 in 0..self.n_normals as usize {
                let o = id2 * 4;
                let mut j = hash_of(self.normals[o].to_bits(), self.normals[o + 1].to_bits(), self.normals[o + 2].to_bits()) as usize & m2;
                while nh[j] >= 0 { j = (j + 1) & m2; }
                nh[j] = id2 as i32;
            }
            self.hash = nh;
        }
        id
    }
    fn class_slot(&mut self, class: u32) -> &mut u32 {
        let c = class as usize;
        if self.class_tone.len() <= c { self.class_tone.resize(c + 1, NONE); }
        &mut self.class_tone[c]
    }
    /// the id of the tone of class `t.class`, adding it (from this palette entry) on first sight
    fn tone(&mut self, t: &Tone) -> u32 {
        let have = *self.class_slot(t.class);
        if have != NONE { return have; }
        if self.tone_class.len() as u32 >= self.max_tones { self.overflow |= 1; return 0; }
        let id = self.tone_class.len() as u32;
        let f = |b: u8| (b as f64 / 255.0) as f32;   // byte / 255 in f64, then to f32: what the JS table holds
        self.tones.extend_from_slice(&[f(t.cd[0]), f(t.cd[1]), f(t.cd[2]), 0.0, f(t.cg[0]), f(t.cg[1]), f(t.cg[2]), 0.0, f(t.cn[0]), f(t.cn[1]), f(t.cn[2]), 0.0, t.surf[0], t.surf[1], t.surf[2], t.surf[3]]);
        self.tone_class.push(t.class);
        *self.class_slot(t.class) = id;
        id
    }
    /// the 32-bit word of a vertex with normal `n`, palette entry `col` (= `t`) and facet flag
    #[inline(always)]
    fn word(&mut self, n: V3, col: usize, t: &Tone, facet: u8) -> u32 {
        let nb = [n[0].to_bits(), n[1].to_bits(), n[2].to_bits()];
        if col != self.l_col || facet != self.l_fac || nb != self.l_n {
            let nid = self.normal(n[0] as f32, n[1] as f32, n[2] as f32);
            let tid = self.tone(t);
            let lo = tid | ((facet as u32) << self.tone_bits) | ((nid % self.nlow) << (self.tone_bits + 1));
            self.l_word = lo | ((nid / self.nlow) << 16);
            self.l_n = nb; self.l_col = col; self.l_fac = facet;
        }
        self.l_word
    }
}

struct Builder {
    pack: bool,
    pk: Packer,
    nv: u32,
    seed: Vec<f32>,         // staging for seed_normals
    pos: Vec<f32>,
    nrm: Vec<f32>,
    cd: Vec<u8>,
    cg: Vec<u8>,
    cn: Vec<u8>,
    fc: Vec<u8>,
    sf: Vec<f32>,
    idx: Vec<u32>,
    tris: u32,
    facet: u8,
    palette: Vec<Tone>,
    stage: Vec<f64>,
}

struct Global(UnsafeCell<Option<Builder>>);
// wasm32-unknown-unknown here is single threaded (no atomics feature), so a plain cell is sound.
unsafe impl Sync for Global {}
static G: Global = Global(UnsafeCell::new(None));

#[allow(clippy::mut_from_ref)]
fn g() -> &'static mut Builder {
    unsafe { (*G.0.get()).as_mut().expect("init() first") }
}

#[inline(always)]
fn sub(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
#[inline(always)]
fn cross(a: V3, b: V3) -> V3 { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
#[inline(always)]
fn dot(a: V3, b: V3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

/// V8's Math.hypot(x, y, z): scale by the largest magnitude, Kahan-sum the squares, sqrt, rescale.
/// (builtins/math.tq MathHypot). Plain sqrt(x*x+y*y+z*z) differs in the last bit for some inputs, which
/// would flip an f32 rounding in the stored normal now and then.
#[inline(always)]
fn hypot3(v: V3) -> f64 {
    let (x, y, z) = (v[0].abs(), v[1].abs(), v[2].abs());
    let max = x.max(y).max(z);
    if max == 0.0 { return 0.0; }
    let mut sum = 0.0f64;
    let mut comp = 0.0f64;
    for t in [x, y, z] {
        let n = t / max;
        let summand = n * n - comp;
        let prelim = sum + summand;
        comp = (prelim - sum) - summand;
        sum = prelim;
    }
    sum.sqrt() * max
}

/// The unit normal of triangle (a, b, c), or None when degenerate (slopes.js faceN).
#[inline(always)]
fn face_n(a: V3, b: V3, c: V3) -> Option<V3> {
    let n = cross(sub(b, a), sub(c, a));
    let l = hypot3(n);
    if l < 1e-9 { return None; }
    Some([n[0] / l, n[1] / l, n[2] / l])
}

impl Builder {
    #[inline(always)]
    fn push(&mut self, p: V3, n: V3, col: usize) -> u32 {
        let t = self.palette[col];
        let id = self.nv;
        self.nv += 1;
        self.pos.extend_from_slice(&[p[0] as f32, p[1] as f32, p[2] as f32]);
        if self.pack {
            let w = self.pk.word(n, col, &t, self.facet);
            self.pk.words.push(w);
            return id;
        }
        self.nrm.extend_from_slice(&[n[0] as f32, n[1] as f32, n[2] as f32]);
        self.cd.extend_from_slice(&t.cd);
        self.cg.extend_from_slice(&t.cg);
        self.cn.extend_from_slice(&t.cn);
        self.fc.push(self.facet);
        self.sf.extend_from_slice(&t.surf);
        id
    }
    #[inline(always)]
    fn emit(&mut self, a: u32, b: u32, c: u32) {
        self.idx.extend_from_slice(&[a, b, c]);
        self.tris += 1;
    }
    fn tri(&mut self, a: V3, mut b: V3, mut c: V3, col: usize, want: Option<V3>) {
        let Some(mut n) = face_n(a, b, c) else { return };
        if let Some(w) = want {
            if dot(n, w) < 0.0 { std::mem::swap(&mut b, &mut c); n = [-n[0], -n[1], -n[2]]; }
        }
        let (ia, ib, ic) = (self.push(a, n, col), self.push(b, n, col), self.push(c, n, col));
        self.emit(ia, ib, ic);
    }
    fn quad(&mut self, a: V3, b: V3, c: V3, d: V3, col: usize, want: Option<V3>) {
        let (n1, n2) = (face_n(a, b, c), face_n(a, c, d));
        let (Some(n1), Some(n2)) = (n1, n2) else { self.tri(a, b, c, col, want); self.tri(a, c, d, col, want); return };
        if dot(n1, n2) < 1.0 - 1e-12 { self.tri(a, b, c, col, want); self.tri(a, c, d, col, want); return; }
        let mut n = n1;
        let mut flip = false;
        if let Some(w) = want {
            if dot(n, w) < 0.0 { n = [-n[0], -n[1], -n[2]]; flip = true; }
        }
        let (ia, ib, ic, id) = (self.push(a, n, col), self.push(b, n, col), self.push(c, n, col), self.push(d, n, col));
        if flip { self.emit(ia, ic, ib); self.emit(ia, id, ic); } else { self.emit(ia, ib, ic); self.emit(ia, ic, id); }
    }
    fn tri_n(&mut self, a: V3, mut b: V3, mut c: V3, na: V3, mut nb: V3, mut nc: V3, col: usize) {
        let mut n = cross(sub(b, a), sub(c, a));
        let l = hypot3(n);
        if l < 1e-9 { return; }
        n = [n[0] / l, n[1] / l, n[2] / l];
        let avg = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
        if dot(n, avg) < 0.0 { std::mem::swap(&mut b, &mut c); std::mem::swap(&mut nb, &mut nc); }
        let (ia, ib, ic) = (self.push(a, na, col), self.push(b, nb, col), self.push(c, nc, col));
        self.emit(ia, ib, ic);
    }
}

#[inline(always)]
fn v3(r: &[f64], o: usize) -> V3 { [r[o], r[o + 1], r[o + 2]] }

// ───────────────────────────── C ABI ─────────────────────────────

/// Start a fresh build. `reserve_vertices` is a capacity hint only (0 = none).
#[no_mangle]
pub extern "C" fn init(reserve_vertices: u32) {
    let n = reserve_vertices as usize;
    let b = Builder {
        pack: false, pk: Packer::new(14), nv: 0, seed: Vec::new(),
        pos: Vec::with_capacity(n * 3), nrm: Vec::with_capacity(n * 3),
        cd: Vec::with_capacity(n * 3), cg: Vec::with_capacity(n * 3), cn: Vec::with_capacity(n * 3),
        fc: Vec::with_capacity(n), sf: Vec::with_capacity(n * 4),
        idx: Vec::with_capacity(n * 3 / 2), tris: 0, facet: 0, palette: Vec::new(), stage: Vec::new(),
    };
    unsafe { *G.0.get() = Some(b); }
}

/// Start a fresh PACKED build (see the header): position + one u32 word per vertex, plus the tone and normal tables.
/// `tone_bits` is js/slopes.js PACK.toneBits (14). `reserve_vertices` is a capacity hint only.
#[no_mangle]
pub extern "C" fn init_packed(reserve_vertices: u32, tone_bits: u32) {
    let n = reserve_vertices as usize;
    let mut pk = Packer::new(tone_bits);
    pk.words = Vec::with_capacity(n);
    pk.hash = vec![-1; HASH0];
    let b = Builder {
        pack: true, pk, nv: 0, seed: Vec::new(),
        pos: Vec::with_capacity(n * 3), nrm: Vec::new(), cd: Vec::new(), cg: Vec::new(), cn: Vec::new(), fc: Vec::new(), sf: Vec::new(),
        idx: Vec::with_capacity(n * 3 / 2), tris: 0, facet: 0, palette: Vec::new(), stage: Vec::new(),
    };
    unsafe { *G.0.get() = Some(b); }
}

/// Add a tone: three RGB byte triples (day, golden, night) and the surface quad. Returns its id.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn palette_add(d0: u32, d1: u32, d2: u32, g0: u32, g1: u32, g2: u32, n0: u32, n1: u32, n2: u32, s0: f32, s1: f32, s2: f32, s3: f32) -> u32 {
    let b = g();
    b.palette.push(Tone { class: NONE, cd: [d0 as u8, d1 as u8, d2 as u8], cg: [g0 as u8, g1 as u8, g2 as u8], cn: [n0 as u8, n1 as u8, n2 as u8], surf: [s0, s1, s2, s3] });
    (b.palette.len() - 1) as u32
}

/// palette_add for a packed build: `class` says which palette entries are ONE tone (equal js/slopes.js toneKey text). Returns the id.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn palette_add_class(class: u32, d0: u32, d1: u32, d2: u32, g0: u32, g1: u32, g2: u32, n0: u32, n1: u32, n2: u32, s0: f32, s1: f32, s2: f32, s3: f32) -> u32 {
    let b = g();
    b.palette.push(Tone { class, cd: [d0 as u8, d1 as u8, d2 as u8], cg: [g0 as u8, g1 as u8, g2 as u8], cn: [n0 as u8, n1 as u8, n2 as u8], surf: [s0, s1, s2, s3] });
    (b.palette.len() - 1) as u32
}

/// Packed builds that continue the tables of an earlier chunk (js/slopes.js buildChunked: every chunk shares one set of tables).
/// Call before any geometry: `seed_tone` once per tone already assigned, in id order, then `seed_normals_stage(n)` / write n x 4 f32 /
/// `seed_normals(n)` for the normals already assigned. The seeded tones' table rows stay zero here (the JS side already holds them).
#[no_mangle]
pub extern "C" fn seed_tone(class: u32) {
    let pk = &mut g().pk;
    let id = pk.tone_class.len() as u32;
    pk.tones.extend_from_slice(&[0.0; 16]);
    pk.tone_class.push(class);
    *pk.class_slot(class) = id;
}
#[no_mangle]
pub extern "C" fn seed_normals_stage(count: u32) -> *mut f32 {
    let b = g();
    b.seed.resize(count as usize * 4, 0.0);
    b.seed.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn seed_normals(count: u32) {
    let b = g();
    let seed = std::mem::take(&mut b.seed);
    for r in seed.chunks_exact(4).take(count as usize) { b.pk.normal(r[0], r[1], r[2]); }
}

/// Make room for `records` staged records and return the address of the first. The caller writes
/// f64s there (a Float64Array view of wasm memory) and then calls `process`. Re-take the view after
/// any call that can grow memory: growth detaches old ArrayBuffers.
#[no_mangle]
pub extern "C" fn stage(records: u32) -> *mut f64 {
    let b = g();
    let need = records as usize * REC;
    if b.stage.len() < need { b.stage.resize(need, 0.0); }
    b.stage.as_mut_ptr()
}

/// Build geometry from the first `records` staged records, in order.
#[no_mangle]
pub extern "C" fn process(records: u32) {
    let b = g();
    let stage = std::mem::take(&mut b.stage);
    for r in stage.chunks_exact(REC).take(records as usize) {
        let col = r[1] as usize;
        let want = if r[2] != 0.0 { Some(v3(r, 3)) } else { None };
        match r[0] as u32 {
            0 => b.tri(v3(r, 6), v3(r, 9), v3(r, 12), col, want),
            1 => b.quad(v3(r, 6), v3(r, 9), v3(r, 12), v3(r, 15), col, want),
            2 => b.tri_n(v3(r, 6), v3(r, 9), v3(r, 12), v3(r, 18), v3(r, 21), v3(r, 24), col),
            _ => b.facet = if r[27] != 0.0 { 1 } else { 0 },
        }
    }
    b.stage = stage;
}

#[no_mangle] pub extern "C" fn vertex_count() -> u32 { g().nv }
#[no_mangle] pub extern "C" fn index_count() -> u32 { g().idx.len() as u32 }
#[no_mangle] pub extern "C" fn triangle_count() -> u32 { g().tris }
#[no_mangle] pub extern "C" fn position_ptr() -> *const f32 { g().pos.as_ptr() }
#[no_mangle] pub extern "C" fn normal_ptr() -> *const f32 { g().nrm.as_ptr() }
#[no_mangle] pub extern "C" fn day_ptr() -> *const u8 { g().cd.as_ptr() }
#[no_mangle] pub extern "C" fn golden_ptr() -> *const u8 { g().cg.as_ptr() }
#[no_mangle] pub extern "C" fn night_ptr() -> *const u8 { g().cn.as_ptr() }
#[no_mangle] pub extern "C" fn facet_ptr() -> *const u8 { g().fc.as_ptr() }
#[no_mangle] pub extern "C" fn surface_ptr() -> *const f32 { g().sf.as_ptr() }
// packed output (init_packed): one u32 word per vertex; the tone table (16 f32 a tone) and the normal table (4 f32 a normal)
#[no_mangle] pub extern "C" fn word_ptr() -> *const u32 { g().pk.words.as_ptr() }
#[no_mangle] pub extern "C" fn tone_count() -> u32 { g().pk.tone_class.len() as u32 }
#[no_mangle] pub extern "C" fn tone_table_ptr() -> *const f32 { g().pk.tones.as_ptr() }
#[no_mangle] pub extern "C" fn tone_class_ptr() -> *const u32 { g().pk.tone_class.as_ptr() }
#[no_mangle] pub extern "C" fn normal_count() -> u32 { g().pk.n_normals }
#[no_mangle] pub extern "C" fn normal_table_ptr() -> *const f32 { g().pk.normals.as_ptr() }
/// 0 = fine; bit 0 = more than 2^toneBits tones, bit 1 = more than 2^(31 - toneBits) normals (the output is then unusable)
#[no_mangle] pub extern "C" fn overflow() -> u32 { g().pk.overflow }
#[no_mangle] pub extern "C" fn index_ptr() -> *const u32 { g().idx.as_ptr() }

/// Drop the staging buffer (after the last `process`) so the output is all that remains.
#[no_mangle]
pub extern "C" fn release_stage() { let b = g(); b.stage = Vec::new(); }
