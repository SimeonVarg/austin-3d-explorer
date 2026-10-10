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
    cd: [u8; 3],
    cg: [u8; 3],
    cn: [u8; 3],
    surf: [f32; 4],
}

struct Builder {
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
        let id = self.fc.len() as u32;
        self.pos.extend_from_slice(&[p[0] as f32, p[1] as f32, p[2] as f32]);
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
        pos: Vec::with_capacity(n * 3), nrm: Vec::with_capacity(n * 3),
        cd: Vec::with_capacity(n * 3), cg: Vec::with_capacity(n * 3), cn: Vec::with_capacity(n * 3),
        fc: Vec::with_capacity(n), sf: Vec::with_capacity(n * 4),
        idx: Vec::with_capacity(n * 3 / 2), tris: 0, facet: 0, palette: Vec::new(), stage: Vec::new(),
    };
    unsafe { *G.0.get() = Some(b); }
}

/// Add a tone: three RGB byte triples (day, golden, night) and the surface quad. Returns its id.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn palette_add(d0: u32, d1: u32, d2: u32, g0: u32, g1: u32, g2: u32, n0: u32, n1: u32, n2: u32, s0: f32, s1: f32, s2: f32, s3: f32) -> u32 {
    let b = g();
    b.palette.push(Tone { cd: [d0 as u8, d1 as u8, d2 as u8], cg: [g0 as u8, g1 as u8, g2 as u8], cn: [n0 as u8, n1 as u8, n2 as u8], surf: [s0, s1, s2, s3] });
    (b.palette.len() - 1) as u32
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

#[no_mangle] pub extern "C" fn vertex_count() -> u32 { g().fc.len() as u32 }
#[no_mangle] pub extern "C" fn index_count() -> u32 { g().idx.len() as u32 }
#[no_mangle] pub extern "C" fn triangle_count() -> u32 { g().tris }
#[no_mangle] pub extern "C" fn position_ptr() -> *const f32 { g().pos.as_ptr() }
#[no_mangle] pub extern "C" fn normal_ptr() -> *const f32 { g().nrm.as_ptr() }
#[no_mangle] pub extern "C" fn day_ptr() -> *const u8 { g().cd.as_ptr() }
#[no_mangle] pub extern "C" fn golden_ptr() -> *const u8 { g().cg.as_ptr() }
#[no_mangle] pub extern "C" fn night_ptr() -> *const u8 { g().cn.as_ptr() }
#[no_mangle] pub extern "C" fn facet_ptr() -> *const u8 { g().fc.as_ptr() }
#[no_mangle] pub extern "C" fn surface_ptr() -> *const f32 { g().sf.as_ptr() }
#[no_mangle] pub extern "C" fn index_ptr() -> *const u32 { g().idx.as_ptr() }

/// Drop the staging buffer (after the last `process`) so the output is all that remains.
#[no_mangle]
pub extern "C" fn release_stage() { let b = g(); b.stage = Vec::new(); }
