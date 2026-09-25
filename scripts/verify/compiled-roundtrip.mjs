// Real-city, exact-attribute Welch round trip. Output must stay outside the repo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launch, HW_ARGS } from './chrome.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), out = argv[argv.indexOf('--out') + 1];
if (!argv.includes('--out') || !out || !process.env.VERIFY_URL) throw Error('--out and VERIFY_URL required');
const OUT = path.resolve(out);
if (OUT.startsWith(ROOT + path.sep)) throw Error('Use an external evidence directory');
fs.mkdirSync(OUT, { recursive: true });
const id = 'ca0207d3-bbf8-408d-a319-9407d7bd0dd2';
let source = fs.readFileSync(path.join(ROOT, 'js/slopes-apartments.js'), 'utf8').replace(/\r\n/g, '\n');
function patch(a, b) { if (source.split(a).length !== 2) throw Error('Instrumentation drift: ' + a); source = source.replace(a, b); }
patch('    for (const spec of _data.buildings) {\n      const pendingStart=',
  '    window.__roundtripRanges=[];\n    for (const spec of _data.buildings) {\n      const rangeStart=B.triangles*3;\n      const pendingStart=');
patch('      await pause();\n    }\n    count.buildSlices',
  '      window.__roundtripRanges.push({id:spec.id,start:rangeStart,end:B.triangles*3});\n      await pause();\n    }\n    count.buildSlices');
const report = { started: new Date().toISOString(), id, checks: [], shots: [], errors: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'roundtrip.json'), JSON.stringify(report, null, 2));
const browser = await launch(chromium, { gl: 'hardware', maxMs: 360000, args: [...HW_ARGS,
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  await page.route('**/js/slopes-apartments.js*', route => route.fulfill({ contentType: 'application/javascript', body: source }));
  await page.addInitScript(() => { const t = setInterval(() => { if (window.cancelGraphicsAutoDetect) { window.cancelGraphicsAutoDetect(); clearInterval(t); } }, 10); });
  await page.goto(process.env.VERIFY_URL.replace(/\/$/, '') + '/index.html?intro=0&drift=0&preset=balanced&clip=1&buildings=legacy', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.slopesApartments?.readyToReveal() && window.slopesApartments?.group && !document.getElementById('veil') && !window.__fly?.eye().driving, null, { timeout: 180000 });
  report.roundtrip = await page.evaluate(async id => {
    const T = window.THREE, S = window.slopes, A = window.slopesApartments, map = window.__map;
    window.cancelGraphicsAutoDetect(); window.GFX.autoExposure = false; window.GFX.stars = 0; window.GFX.grain = 0; window.applyGraphics();
    if (window.WAYFIND) window.WAYFIND.on = false;
    if (A.count.buildings !== 196 || A.data.buildings.length !== 196) throw Error('Full city did not load');
    const runtime = await import('/js/building-asset-runtime.js');
    const baseURL = new URL('/data/compiled-buildings/', location.href).href;
    const manifest = await (await fetch(baseURL + 'manifest.json')).json();
    const entry = manifest.buildings.find(b => b.id === id);
    if (!entry) throw Error('Welch asset is missing');
    const events = [], loader = new runtime.BuildingAssetLoader({ onEvent: e => events.push(e) });
    const loaded = await loader.load(entry, baseURL);
    const object = runtime.createBuildingObject(loaded.asset, { THREE: T, slopes: S, pickId: 1 });
    const legacy = A.group.children.find(m => m.name === 'apartments'), g = legacy.geometry;
    const range = window.__roundtripRanges.find(r => r.id === id);
    if (!range) throw Error('Welch legacy range is missing');
    let first = Infinity, last = -1;
    for (let i = range.start; i < range.end; i++) { first = Math.min(first, g.index.array[i]); last = Math.max(last, g.index.array[i]); }
    const compared = {};
    for (const [name, attr] of Object.entries(g.attributes)) {
      const expected = attr.array.subarray(first * attr.itemSize, (last + 1) * attr.itemSize);
      const actual = new attr.array.constructor(expected.length);
      let offset = 0;
      for (const mesh of object.group.children) {
        const a = mesh.geometry.attributes[name];
        if (!a || a.itemSize !== attr.itemSize || a.normalized !== attr.normalized || a.array.constructor !== attr.array.constructor) throw Error('Attribute descriptor changed: ' + name);
        actual.set(a.array, offset); offset += a.array.length;
      }
      if (offset !== expected.length) throw Error('Attribute length changed: ' + name);
      const a = new Uint8Array(actual.buffer), b = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
      let changedBytes=0, changedValues=0, maxDelta=0; const samples=[];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changedBytes++;
      for (let i = 0; i < actual.length; i++) if (!Object.is(actual[i], expected[i])) {
        changedValues++; maxDelta=Math.max(maxDelta,Math.abs(actual[i]-expected[i]));
        if(samples.length<8) samples.push({index:i,actual:actual[i],expected:expected[i],vertex:Math.floor(i/attr.itemSize),
          position:Array.from(g.attributes.position.array.subarray((first+Math.floor(i/attr.itemSize))*3,(first+Math.floor(i/attr.itemSize))*3+3))});
      }
      compared[name] = {bytes:expected.byteLength,changedBytes,changedValues,maxDelta,samples};
    }
    let at = range.start, vertex = first;
    for (const mesh of object.group.children) {
      for (const index of mesh.geometry.index.array) if (index + vertex !== g.index.array[at++]) throw Error('Triangle index changed');
      vertex += mesh.geometry.attributes.position.count;
      if (mesh.material.vertexShader !== legacy.material.vertexShader || mesh.material.fragmentShader !== legacy.material.fragmentShader || mesh.material.uniforms !== S.uniforms() || mesh.material.side !== legacy.material.side) throw Error('Production material changed');
    }
    if (at !== range.end) throw Error('Triangle count changed');
    const gl = map.getCanvas().getContext('webgl2'), bufferData = gl.bufferData;
    const arrays = new Set();
    for (const mesh of object.group.children) for (const attr of [...Object.values(mesh.geometry.attributes), mesh.geometry.index]) arrays.add(attr.array);
    const uploads = [];
    gl.bufferData = function(target, data, ...rest) { if (arrays.has(data)) uploads.push({ target, bytes: data.byteLength }); return bufferData.call(this, target, data, ...rest); };
    try { await runtime.uploadBuildingObject(object, { THREE: T, slopes: S, map, onEvent: e => events.push(e) }); }
    finally { gl.bufferData = bufferData; }
    const uploaded = uploads.reduce((n, x) => n + x.bytes, 0);
    if (uploaded !== loaded.asset.stats.geometryBytes) throw Error('Upload did not stage every attribute/index byte: ' + uploaded);
    window.__roundtrip = { object, loader, legacy, range, material: legacy.material, events,
      set(mode) {
        A.group.remove(object.group); g.clearGroups(); legacy.material = this.material;
        if (mode !== 'legacy') { g.addGroup(0, range.start, 0); g.addGroup(range.end, g.index.count - range.end, 0); legacy.material = [this.material]; }
        if (mode === 'compiled') A.group.add(object.group);
        A.group.uuid = T.MathUtils.generateUUID(); map.triggerRepaint();
      } };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { triangles: (range.end - range.start) / 3, compared, uploaded, parts: object.group.children.length,
      bounds: loaded.asset.building.bounds, worker: loaded.timing, events,
      mercator:{units:window.maplibregl.MercatorCoordinate.prototype.meterInMercatorCoordinateUnits.toString(),
        fromLngLat:window.maplibregl.MercatorCoordinate.fromLngLat.toString()},
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
  }, id);
  console.log('Attribute comparison and paced GL uploads', JSON.stringify(report.roundtrip)); save();
  const poses = [
    { name: 'welch-day', center: [-97.73785, 30.2867], zoom: 18.5, pitch: 57, bearing: 22, p: .3 },
    { name: 'welch-night', center: [-97.73785, 30.2867], zoom: 18.5, pitch: 57, bearing: 22, p: .82 },
    { name: 'welch-grazing', center: [-97.73785, 30.2867], zoom: 18.1, pitch: 68, bearing: 78, p: .3 },
  ];
  for (const pose of poses) for (const mode of ['legacy', 'compiled']) {
    await page.evaluate(({ pose, mode }) => { window.__map.jumpTo(pose); window.applyTimeOfDay(window.__map, pose.p, true); window.__roundtrip.set(mode); }, { pose, mode });
    await page.waitForFunction(() => window.__map.areTilesLoaded() && window.slopesApartments.readyToReveal(), null, { timeout: 60000 });
    await page.waitForTimeout(2500); await page.screenshot(); await page.waitForTimeout(750);
    const file = pose.name + '-' + mode + '.png'; await page.screenshot({ path: path.join(OUT, file) });
    report.shots.push({ file, pose, mode, state: await page.evaluate(() => ({ shadow: window.slopes.sunlightStats(), p: window.__todCurrentP, tiles: window.__map.areTilesLoaded() })) }); save();
  }
  await page.evaluate(pose => { window.__map.jumpTo(pose); window.applyTimeOfDay(window.__map, pose.p, true); window.__roundtrip.set('missing'); }, poses[0]);
  await page.waitForTimeout(3000); await page.screenshot(); await page.waitForTimeout(750); await page.screenshot({ path: path.join(OUT, 'welch-day-missing.png') });
  report.checks.push('Rebased triangle indices match', 'All geometry GPU bytes uploaded before visibility', 'Original material/shader/shared uniforms preserved', '196-building city present');
  await page.evaluate(() => { window.__roundtrip.set('legacy'); window.__roundtrip.object.dispose(); window.__roundtrip.loader.close(); });
  if (report.errors.length) throw Error('Page errors: ' + report.errors.join('; '));
  if (Object.values(report.roundtrip.compared).some(a=>a.changedBytes)) throw Error('Attribute bytes differ; see roundtrip.compared diagnostics');
  report.checks.push('Every production attribute byte matches');
  report.finished = new Date().toISOString(); report.pass = true; save();
} catch (error) { report.fatal = String(error.stack || error); report.pass = false; save(); console.error(error); process.exitCode = 1; }
finally { await browser.close(); browser.__done?.(); save(); }
