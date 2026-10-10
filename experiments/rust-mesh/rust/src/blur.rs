//! blur_wrap: js/pattern-lowpass.js `blurWrap` (the wrap-safe separable box blur that band-limits every facade pattern tile;
//! the single hottest function in the speed lane's cold-load profile) as a Wasm kernel. Same arithmetic, exactly:
//!
//!  * window sums are integers, so they are exact in the JS's Float32 `tmp` and Float64 `sums` and exact here in i32;
//!  * the blend is done in f64 in the JS's order, `d + ((sum / area - d) * a)`, then stored the way a Uint8ClampedArray
//!    stores a number: NaN to 0, clamp to 0..255, round half to even (`round_ties_even` = wasm `f64.nearest`).
//!
//! Build with `-C target-feature=+simd128` for the SIMD version (see ../build.sh); the same source builds without.

use std::cell::UnsafeCell;

struct Scratch { buf: Vec<u8>, tmp: Vec<i32>, sums: Vec<i32>, enter: Vec<u32>, leave: Vec<u32> }
struct G(UnsafeCell<Option<Scratch>>);
unsafe impl Sync for G {}
static S: G = G(UnsafeCell::new(None));
#[allow(clippy::mut_from_ref)]
fn s() -> &'static mut Scratch {
    unsafe { (*S.0.get()).get_or_insert_with(|| Scratch { buf: Vec::new(), tmp: Vec::new(), sums: Vec::new(), enter: Vec::new(), leave: Vec::new() }) }
}

/// Make room for `len` bytes of tile and return its address. The caller copies the RGBA bytes in, calls `blur_wrap`, copies out.
#[no_mangle]
pub extern "C" fn blur_buf(len: u32) -> *mut u8 {
    let b = s();
    if b.buf.len() < len as usize { b.buf.resize(len as usize, 0); }
    b.buf.as_mut_ptr()
}

#[inline(always)]
fn clamp_u8(v: f64) -> u8 {
    if v.is_nan() { 0 } else { v.clamp(0.0, 255.0).round_ties_even() as u8 }
}

/// Blur the `res` x `res` RGBA tile at `blur_buf`'s address in place. `r` = box radius in texels, `a` = 0..1 blend. Same contract as the JS.
#[no_mangle]
pub extern "C" fn blur_wrap(res: u32, r: u32, a: f64) {
    if r == 0 || a <= 0.0 { return; }
    let (res, r) = (res as usize, r as usize);
    let n = res * res;
    let st = s();
    let (win, stride) = (2 * r + 1, res * 4);
    let area = (win * win) as f64;
    if st.tmp.len() < n * 4 { st.tmp.resize(n * 4, 0); }
    if st.sums.len() < stride { st.sums.resize(stride, 0); }
    st.enter.clear(); st.leave.clear();
    let wrap = |i: isize| -> usize { (((i % res as isize) + res as isize) % res as isize) as usize };
    for i in 0..res as isize { st.enter.push((wrap(i + r as isize + 1) * 4) as u32); st.leave.push((wrap(i - r as isize) * 4) as u32); }
    let (d, tmp, sums, enter, leave) = (&mut st.buf[..n * 4], &mut st.tmp[..n * 4], &mut st.sums[..stride], &st.enter, &st.leave);
    // horizontal: tmp keeps the window SUM
    for y in 0..res {
        let row = y * res;
        let mut sv = [0i32; 4];
        for k in -(r as isize)..=(r as isize) {
            let i = (row + wrap(k)) * 4;
            for c in 0..4 { sv[c] += d[i + c] as i32; }
        }
        for x in 0..res {
            let o = (row + x) * 4;
            tmp[o..o + 4].copy_from_slice(&sv);
            let (ia, is) = (row * 4 + enter[x] as usize, row * 4 + leave[x] as usize);
            for c in 0..4 { sv[c] += d[ia + c] as i32 - d[is + c] as i32; }
        }
    }
    // vertical: one running sum per column lane, visiting whole contiguous rows
    sums.fill(0);
    for k in -(r as isize)..=(r as isize) {
        let row = wrap(k) * stride;
        for x in 0..stride { sums[x] += tmp[row + x]; }
    }
    for y in 0..res {
        let (row, en, lv) = (y * stride, enter[y] as usize * res, leave[y] as usize * res);
        let (drow, trow_in, trow_out) = (&mut d[row..row + stride], &tmp[en..en + stride], &tmp[lv..lv + stride]);
        let mut x = 0;
        #[cfg(target_feature = "simd128")]
        {
            // two lanes of f64 at a time, the same IEEE operations in the same order as the scalar path (so the same bytes)
            use core::arch::wasm32::*;
            let (va, vk) = (f64x2_splat(area), f64x2_splat(a));
            let (lo, hi) = (f64x2_splat(0.0), f64x2_splat(255.0));
            while x + 2 <= stride {
                let sv = f64x2(sums[x] as f64, sums[x + 1] as f64);
                let dv = f64x2(drow[x] as f64, drow[x + 1] as f64);
                let v = f64x2_add(dv, f64x2_mul(f64x2_sub(f64x2_div(sv, va), dv), vk));
                let v = f64x2_nearest(f64x2_pmin(f64x2_pmax(v, lo), hi));
                drow[x] = f64x2_extract_lane::<0>(v) as u8;
                drow[x + 1] = f64x2_extract_lane::<1>(v) as u8;
                sums[x] += trow_in[x] - trow_out[x];
                sums[x + 1] += trow_in[x + 1] - trow_out[x + 1];
                x += 2;
            }
        }
        while x < stride {
            let di = drow[x] as f64;
            drow[x] = clamp_u8(di + (sums[x] as f64 / area - di) * a);
            sums[x] += trow_in[x] - trow_out[x];
            x += 1;
        }
    }
}

/// APPROXIMATE variant, for the "how fast could it go if exact bytes were not required" question only: f32 lanes, one multiply by
/// 1/area instead of a divide, round half up. Not byte-identical to the JS (see ../blur/compare-and-bench.mjs `approx`).
#[no_mangle]
pub extern "C" fn blur_wrap_approx(res: u32, r: u32, a: f64) {
    if r == 0 || a <= 0.0 { return; }
    let (res, r) = (res as usize, r as usize);
    let n = res * res;
    let st = s();
    let stride = res * 4;
    let inv = (1.0 / (((2 * r + 1) * (2 * r + 1)) as f64)) as f32;
    let a32 = a as f32;
    if st.tmp.len() < n * 4 { st.tmp.resize(n * 4, 0); }
    if st.sums.len() < stride { st.sums.resize(stride, 0); }
    st.enter.clear(); st.leave.clear();
    let wrap = |i: isize| -> usize { (((i % res as isize) + res as isize) % res as isize) as usize };
    for i in 0..res as isize { st.enter.push((wrap(i + r as isize + 1) * 4) as u32); st.leave.push((wrap(i - r as isize) * 4) as u32); }
    let (d, tmp, sums, enter, leave) = (&mut st.buf[..n * 4], &mut st.tmp[..n * 4], &mut st.sums[..stride], &st.enter, &st.leave);
    for y in 0..res {
        let row = y * res;
        let mut sv = [0i32; 4];
        for k in -(r as isize)..=(r as isize) { let i = (row + wrap(k)) * 4; for c in 0..4 { sv[c] += d[i + c] as i32; } }
        for x in 0..res {
            let o = (row + x) * 4;
            tmp[o..o + 4].copy_from_slice(&sv);
            let (ia, is) = (row * 4 + enter[x] as usize, row * 4 + leave[x] as usize);
            for c in 0..4 { sv[c] += d[ia + c] as i32 - d[is + c] as i32; }
        }
    }
    sums.fill(0);
    for k in -(r as isize)..=(r as isize) { let row = wrap(k) * stride; for x in 0..stride { sums[x] += tmp[row + x]; } }
    for y in 0..res {
        let (row, en, lv) = (y * stride, enter[y] as usize * res, leave[y] as usize * res);
        let (drow, tin, tout) = (&mut d[row..row + stride], &tmp[en..en + stride], &tmp[lv..lv + stride]);
        for x in 0..stride {
            let di = drow[x] as f32;
            let v = di + (sums[x] as f32 * inv - di) * a32;
            drow[x] = (v + 0.5).clamp(0.0, 255.0) as u8;
            sums[x] += tin[x] - tout[x];
        }
    }
}
