/**
 * light-probe.mjs — the auto-detect probe must be a good citizen.
 *
 * 1. It must DEFER while a camera ease is in flight (the long intro is an
 *    ~11.5 s easeTo; the probe's bearing nudge/snapshot-restore cancels an
 *    ease mid-tween and strands the camera off-pose). A scripted ease across
 *    the probe window must complete to its EXACT target.
 * 2. After the ease lands, the probe must still run (weak phones need their
 *    downgrade) — deferred, not skipped.
 * 3. When the probe changes nothing it must say nothing; only a downgrade may
 *    toast, and briefly. cancelGraphicsAutoDetect must still work.
 */
import { chromium } from 'playwright-core';
import { chromePath, BASE, launch } from './chrome.mjs';

// HEADED on purpose: this is a TIMING test. Headless swiftshader renders a
// nudged frame in ~400 ms, which starves the probe below its 4-frame minimum
// and the "probe ran after the ease" claim becomes untestable.
const browser = await launch(chromium, { headless: false });
const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: String(d) });
const wrapDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ── 1+2: ease across the probe window ─────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const logs = [];
  page.on('console', m => logs.push({ t: Date.now(), text: m.text() }));
  // Fresh context: no saved settings, so the first-run probe arms itself.
  // domcontentloaded, NOT networkidle: the probe timer arms at graphics init,
  // and a slow networkidle wait can eat the whole 11 s window before the test
  // even starts its ease (measured: the probe fired 14 s before the ease).
  await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  const armed = await page.evaluate(() => !window.GFX.autoDetected);
  check('first run: probe is armed (autoDetected false)', armed, 'autoDetected=' + !armed);

  // Start the ease NOW and size it to safely span the 11 s probe slot.
  const tNow = await page.evaluate(() => performance.now());
  const priorProbe = logs.filter(l => l.text.includes('auto-detect')).length;
  // THIS USED TO BE `tNow < 9500 && priorProbe === 0` AND WAS A STOPWATCH ON THE
  // MACHINE WEARING A PRECONDITION'S NAME.
  //
  // `tNow` is `performance.now()` when `isStyleLoaded()` first returns true, so
  // the clause asserted "this computer finished loading 28 MB of city in under
  // 9.5 seconds". That is a fact about the Acer, not about the auto-detect
  // probe — and this suite has measured an identical page at 11 s and at 65 s.
  // Worse, when it failed the three assertions that ARE about probe behaviour
  // were still evaluated against a window that had already closed, so a slow
  // load produced one red and three meaningless greens.
  //
  // Split in two. The part that is genuinely about the subject — has the probe
  // already fired before we start? — stays a hard assertion, because if it has,
  // everything after it is measuring nothing. The load time is REPORTED, and
  // the ease below already sizes itself to span whatever is left of the window
  // (`Math.max(12000, 11000 - tNow + 9000)`), which is the real handling of a
  // slow start.
  check('the auto-detect probe has NOT fired yet (the window is still open)',
    priorProbe === 0,
    `prior probe logs ${priorProbe}` +
    `   [page reached style-load at t=${(tNow / 1000).toFixed(1)}s — reported, not asserted: ` +
    `that is this machine's load time, and the ease below is sized around it]`);
  if (tNow >= 9500)
    console.log(`  note  slow load (${(tNow / 1000).toFixed(1)}s). The ease is being lengthened to ` +
                `cover the rest of the probe window; this is not a defect and no longer a red.`);
  const duration = Math.max(12000, 11000 - tNow + 9000);
  await page.evaluate((duration) => {
    window.__easeDone = false;
    window.__map.easeTo({
      center: [-97.7404, 30.2837], bearing: 250, pitch: 70, zoom: 16.2,
      duration, easing: t => t,
    });
    window.__map.once('moveend', () => { window.__easeDone = true; });
  }, duration);
  await page.waitForFunction(() => window.__easeDone, null, { timeout: 40000 });
  const easeEndAt = Date.now();
  const pose = await page.evaluate(() => ({
    bearing: window.__map.getBearing(), pitch: window.__map.getPitch(),
    lng: window.__map.getCenter().lng, lat: window.__map.getCenter().lat,
  }));
  // MapLibre normalises bearing to (-180,180], so 250 comes back as -110 —
  // compare wrapped.
  check('ease completes to its exact target (probe deferred, no stomp)',
    wrapDiff(pose.bearing, 250) < 0.01 && Math.abs(pose.pitch - 70) < 0.01 &&
    Math.abs(pose.lng - -97.7404) < 1e-4 && Math.abs(pose.lat - 30.2837) < 1e-4,
    `bearing ${pose.bearing.toFixed(3)} (want 250 mod 360), pitch ${pose.pitch.toFixed(2)}, ` +
    `center ${pose.lng.toFixed(5)},${pose.lat.toFixed(5)}`);

  // The deferred probe should land within one retry interval + probe length.
  await page.waitForFunction(() => window.GFX.autoDetected, null, { timeout: 12000 })
    .catch(() => {});
  const after = await page.evaluate(() => ({
    detected: window.GFX.autoDetected, preset: window.GFX.preset,
    bearing: window.__map.getBearing(),
  }));
  const probeLogs = logs.filter(l => l.text.includes('auto-detect'));
  const lastLog = probeLogs.slice(-1)[0];
  check('probe still ran after the ease (deferred, not skipped)',
    after.detected && !!lastLog && lastLog.t > easeEndAt - 500,
    `autoDetected=${after.detected}, preset=${after.preset}, probe log ` +
    (lastLog ? `${((lastLog.t - easeEndAt) / 1000).toFixed(1)}s after ease end: ${lastLog.text}` : 'none'));
  check('probe restored the eased bearing afterwards',
    wrapDiff(after.bearing, 250) < 0.05, `bearing ${after.bearing.toFixed(3)} (want 250 mod 360)`);
  await page.close();
}

// ── 3a: cancelGraphicsAutoDetect still works ─────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.cancelGraphicsAutoDetect());
  await page.waitForTimeout(10000);           // wait out the 11 s slot
  const cancelled = await page.evaluate(() => ({
    detected: window.GFX.autoDetected,
    toast: (document.getElementById('gfx-toast') || {}).className || '',
  }));
  check('cancelGraphicsAutoDetect still cancels (no probe, no toast)',
    !cancelled.detected && !cancelled.toast.includes('show'),
    JSON.stringify(cancelled));
  await page.close();
}

// ── 3b: silence on a no-op, short toast on a downgrade ───────────────
// A FRESH page: the cancel flag is sticky by design, so a direct __gfxProbe
// after cancelGraphicsAutoDetect always reports null.
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(`${BASE}/index.html?drift=0&intro=0`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__map && window.__map.isStyleLoaded(), null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const probe = await page.evaluate(async () => {
    const r = await window.__gfxProbe();      // beats the 11 s timer; runs once
    const t = document.getElementById('gfx-toast');
    return { r, shown: !!t && t.classList.contains('show'), preset: window.GFX.preset };
  });
  const downgraded = probe.r && probe.preset === 'performance';
  check('probe result obtained', !!probe.r, JSON.stringify(probe.r));
  if (downgraded) {
    check('downgrade toast is shown, then gone within ~3.2 s', probe.shown, 'shown=' + probe.shown);
    await page.waitForTimeout(3400);
    const still = await page.evaluate(() => document.getElementById('gfx-toast').classList.contains('show'));
    check('downgrade toast cleared by 3.4 s (short hold)', !still, 'still shown=' + still);
  } else {
    check('no-op probe stays SILENT (no toast over the hero frame)', !probe.shown, 'shown=' + probe.shown);
  }

  // Toast duration parameter honoured (debug hook).
  const t2 = await page.evaluate(async () => {
    window.__gfxToast('light-probe test', 700);
    const shownAt0 = document.getElementById('gfx-toast').classList.contains('show');
    await new Promise(r => setTimeout(r, 1300));
    return { shownAt0, shownLater: document.getElementById('gfx-toast').classList.contains('show') };
  });
  check('toast honours a custom duration', t2.shownAt0 && !t2.shownLater, JSON.stringify(t2));
  await page.close();
}

console.log('');
for (const r of results) console.log(`${r.pass ? ' PASS' : '*FAIL'}  ${r.name}\n         ${r.detail}`);
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
await browser.__done();
process.exit(results.every(r => r.pass) ? 0 : 1);
