// tile-heal-source.mjs - a broken browser cache must not take a map layer with it.
//
// No browser, no server. The real js/tiles.js runs in this process against the
// real pmtiles library (the build index.html names, fetched once and kept in
// the temp folder) and the real archives in data/tiles/. Only the network is
// fake, and it models the incident: a cache that answers a NORMAL read of one
// range with a 206 of the right length and the right Content-Range whose bytes
// are all zero, while a cache-bypassing read (cache: 'reload') gets the file.
//
// Claims, each asserted:
//   0. control: with the heal off (?tileheal=0, the code path that shipped
//      before) the same poisoned cache makes the archive fail to open ("Wrong
//      magic number"), so the fake really reproduces the incident;
//   1. a zero-filled header range is read again with cache: 'reload', the
//      archive opens in the same page load, its tile is byte for byte the real
//      tile, one console line names the archive, no generation is stored;
//   2. when the cache still hands back the bad copy after the reload, the
//      archive moves to ?cg=1 for good: the generation rises, it is stored, the
//      archive opens and its tiles are read from the new URL in the same load,
//      and the NEXT page load opens straight on ?cg=1 without a bad read;
//   3. a stored generation is read strictly: only an integer written as
//      String(n) in 1..99 counts, anything else is generation 0;
//   4. when even a reload of the plain URL is bad, a new URL still heals it;
//   5. when nothing helps, the read fails with one console error naming the
//      archive, a bounded number of requests, and no generation is stored;
//   6. a zero-filled TILE range (not the header) heals the same way;
//   7. a healthy archive costs exactly the requests it cost before: no extra
//      read, no console line, nothing written to storage;
//   8. blocked storage (getItem and setItem throw) still heals, in memory;
//   9. parallel bad reads of one archive move it to a new URL once, not once
//      each.
//
// --break loads js/tiles.js with ?tileheal=0 for every scenario (the old code
// path) and must exit 1. --tiles <file> runs the same scenarios against another
// copy of tiles.js (for example `git show origin/main~N:js/tiles.js`).
// PMTILES_JS=<file> uses a local copy of the library instead of fetching it.
//
// Exit 0 pass, 1 an assertion failed, 2 could not run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPO = new URL('../../', import.meta.url);
const BREAK = process.argv.includes('--break');
const ti = process.argv.indexOf('--tiles');
const TILES_JS = ti > 0 ? path.resolve(process.argv[ti + 1]) : fileURLToPath(new URL('js/tiles.js', REPO));
const die = (code, msg) => { console.error(msg); process.exit(code); };

// ---- the library: the exact build the page loads ----------------------------
async function libSource() {
  if (process.env.PMTILES_JS) return fs.readFileSync(process.env.PMTILES_JS, 'utf8');
  const html = fs.readFileSync(new URL('index.html', REPO), 'utf8');
  const url = html.match(/https:\/\/unpkg\.com\/pmtiles@[\d.]+\/dist\/pmtiles\.js/)?.[0];
  if (!url) die(2, 'index.html no longer loads a pmtiles build from unpkg');
  const cached = path.join(os.tmpdir(), 'a3d-verify', url.replace(/[^\w.@-]+/g, '_'));
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) {
        const text = await r.text();
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, text);
        return text;
      }
    } catch (e) { /* try again */ }
  }
  die(2, 'could not fetch ' + url + ' (set PMTILES_JS to a local copy)');
}

const realFetch = globalThis.fetch;
const out = console.log.bind(console);      // tiles.js logs through console.log too: that one is muted, this one is ours
vm.runInThisContext(await libSource(), { filename: 'pmtiles.js' });   // defines global `pmtiles`
const tilesSource = fs.readFileSync(TILES_JS, 'utf8');

const FILE = 'data/tiles/props.pmtiles';
const buffers = { [FILE]: fs.readFileSync(new URL(FILE, REPO)) };
const HEADER_RANGE = [0, 16383];

// ---- reference: what the real archive says, read without any cache ----------
const refReads = [];
const refSource = {
  getKey: () => FILE,
  async getBytes(offset, length) {
    refReads.push([offset, offset + length - 1]);
    const b = buffers[FILE].subarray(offset, offset + length);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  },
};
const ref = new pmtiles.PMTiles(refSource);
const refHeader = await ref.getHeader();
// Tiles that exist, with the byte range each one is read from.
const tiles = [];
{
  const z = 14, n = 2 ** z;
  const x0 = Math.floor((refHeader.minLon + 180) / 360 * n), x1 = Math.floor((refHeader.maxLon + 180) / 360 * n);
  const ty = lat => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const y0 = ty(refHeader.maxLat), y1 = ty(refHeader.minLat);
  for (let x = x0; x <= x1 && tiles.length < 4; x++) for (let y = y0; y <= y1 && tiles.length < 4; y++) {
    refReads.length = 0;
    const t = await ref.getZxy(z, x, y);
    if (t && t.data.byteLength > 200) tiles.push({ z, x, y, range: refReads.at(-1), bytes: Buffer.from(t.data) });
  }
}
if (tiles.length < 3) die(2, 'found only ' + tiles.length + ' tiles in ' + FILE);

// ---- the fake network and storage -------------------------------------------
function makeNet({ poison = [], reloadRepairs = true, serverBad = () => false } = {}) {
  // Poisoned cache entries: exact URL + range -> what a normal read of it gets.
  const cache = new Map(poison.map(([url, [a, b], corrupt = real => Buffer.alloc(real.length)]) => [`${url}|${a}-${b}`, corrupt]));
  const reads = [];
  const fake = async (url, init = {}) => {
    if (init.method === 'HEAD') return new Response(null, { status: 200 });
    const m = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get('range') || '');
    if (!m) throw new Error('fake net: a read without a Range header: ' + url);
    const a = +m[1], b = +m[2], mode = init.cache || 'default';
    const file = buffers[url.split('?')[0]];
    if (!file) return new Response(null, { status: 404 });
    let body = file.subarray(a, b + 1);
    const key = `${url}|${a}-${b}`;
    reads.push({ url, a, b, mode });
    if (cache.has(key)) {
      if (mode === 'reload' || mode === 'no-store') { if (reloadRepairs) cache.delete(key); }
      else body = cache.get(key)(body);
    }
    if (serverBad(url, mode)) body = Buffer.alloc(body.length);
    return new Response(body, { status: 206, headers: {
      'Content-Range': `bytes ${a}-${a + body.length - 1}/${file.length}`,
      'Content-Length': String(body.length), Etag: '"v1"' } });
  };
  return { fake, reads };
}

function makeStorage(initial = {}, { blocked = false } = {}) {
  const store = new Map(Object.entries(initial));
  const s = { store, sets: 0,
    getItem(k) { if (blocked) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (blocked) throw new Error('blocked'); s.sets++; store.set(k, String(v)); },
    removeItem(k) { store.delete(k); } };
  return s;
}

/** One page load of tiles.js: fresh globals, fresh closure, same fake world. */
function pageLoad({ net, storage, off = BREAK }) {
  const lines = [];
  const real = { warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = (...a) => lines.push(['warn', a.join(' ')]);
  console.error = (...a) => lines.push(['error', a.join(' ')]);
  const protocols = {};
  Object.assign(globalThis, {
    window: globalThis,
    location: { search: off ? '?tileheal=0' : '' },
    maplibregl: { setWorkerCount() {}, getVersion: () => 'stub', addProtocol(n, f) { protocols[n] = f; } },
    fetch: net.fake,
  });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  delete globalThis.TILES;
  vm.runInThisContext(tilesSource, { filename: 'tiles.js' });
  const handler = protocols.pmtiles;
  return {
    lines, TILES: globalThis.TILES, handler,
    restore() { Object.assign(console, real); },
    json: () => handler({ type: 'json', url: 'pmtiles://' + FILE }, new AbortController()),
    tile: t => handler({ type: 'arrayBuffer', url: `pmtiles://${FILE}/${t.z}/${t.x}/${t.y}` }, new AbortController()),
  };
}

// ---- assertions --------------------------------------------------------------
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond }); out((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : (detail ? '   ' + detail : ''))); };
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const bad = lines => lines.filter(([k]) => k === 'warn' || k === 'error');
// The hooks the shipped file exposes; an older tiles.js has none, and that must read as a failure, not a crash.
const heals = p => p.TILES.heals || [];
const arch = p => p.TILES.archives?.props || {};
const rangeReads = (net, f) => net.reads.filter(f);
const isHeader = r => r.a === HEADER_RANGE[0] && r.b === HEADER_RANGE[1];
async function opens(p, tile = tiles[0]) {
  try {
    const j = await p.json();
    const t = await p.tile(tile);
    return { json: j.data, tile: t.data, err: null };
  } catch (e) { return { err: e }; }
}

// 0. control: the old code path against the poisoned cache
{
  const net = makeNet({ poison: [[FILE, HEADER_RANGE]] });
  const p = pageLoad({ net, storage: makeStorage(), off: true });
  const r = await opens(p); p.restore();
  ok('0. control: with the heal off, a zero-filled header range makes the archive fail to open',
    r.err && /magic/i.test(r.err.message), r.err ? r.err.message : 'it opened');
}

// 1. the reload heals it, in the same page load
{
  const net = makeNet({ poison: [[FILE, HEADER_RANGE]], reloadRepairs: true });
  const storage = makeStorage();
  const p = pageLoad({ net, storage });
  const r = await opens(p); p.restore();
  ok('1. a zero-filled header range: the archive opens in the same load', !r.err, r.err && r.err.message);
  ok('1. ...and its tile is byte for byte the real tile', r.tile && same(r.tile, tiles[0].bytes));
  ok('1. ...and its tile json says the real zoom range', r.json && r.json.minzoom === refHeader.minZoom && r.json.maxzoom === refHeader.maxZoom);
  ok('1. the heal read past the cache (a cache: reload read of the plain URL)',
    rangeReads(net, x => isHeader(x) && x.mode === 'reload' && x.url === FILE).length === 1);
  ok('1. one console line, and it names the archive', bad(p.lines).length === 1 && /props\.pmtiles/.test(bad(p.lines)[0][1]), JSON.stringify(p.lines));
  ok('1. the record says what was wrong: zero bytes',
    heals(p)[0]?.why === 'zero bytes' && heals(p)[0]?.offset === 0 && heals(p)[0]?.length === 16384, JSON.stringify(heals(p)));
  ok('1. the record says it healed by reload and stored no generation',
    heals(p).length === 1 && heals(p)[0].how === 'reload' && heals(p)[0].archive === 'props' && storage.sets === 0,
    JSON.stringify(heals(p)));
}

// 2. the reload does not stick: the generation rises, and the next load starts there
{
  const net = makeNet({ poison: [[FILE, HEADER_RANGE]], reloadRepairs: false });
  const storage = makeStorage();
  const p = pageLoad({ net, storage });
  const r = await opens(p); p.restore();
  ok('2. the cache keeps the bad copy after a reload: the archive still opens in the same load', !r.err, r.err && r.err.message);
  ok('2. ...with the real tile', r.tile && same(r.tile, tiles[0].bytes));
  ok('2. the generation rose to 1, was stored, and the archive is on ?cg=1',
    heals(p)[0]?.how === 'generation' && heals(p)[0]?.gen === 1
    && storage.store.get('tiles.cachegen.props') === '1' && arch(p).url === FILE + '?cg=1',
    JSON.stringify([heals(p), [...storage.store]]));
  ok('2. its tile was read from the new URL', rangeReads(net, x => x.url === FILE + '?cg=1' && x.a === tiles[0].range[0]).length >= 1);
  ok('2. the key the protocol finds it by did not change', arch(p).getKey?.() === FILE);
  ok('2. one console line, naming the archive and the generation',
    bad(p.lines).length === 1 && /props\.pmtiles/.test(bad(p.lines)[0][1]) && /cg=1/.test(bad(p.lines)[0][1]), JSON.stringify(p.lines));

  // the next page load: same storage, the plain URL's cache entry still poisoned
  const net2 = makeNet({ poison: [[FILE, HEADER_RANGE]], reloadRepairs: false });
  const p2 = pageLoad({ net: net2, storage });
  const r2 = await opens(p2); p2.restore();
  ok('2. the next load opens straight on ?cg=1: no bad read, no heal, no console line',
    !r2.err && heals(p2).length === 0 && bad(p2.lines).length === 0
    && net2.reads.every(x => x.url === FILE + '?cg=1' && x.mode === 'default'), JSON.stringify(net2.reads.slice(0, 3)));
}

// 3. a stored generation is read strictly
{
  const want = { 'abc': 0, '-1': 0, '5.5': 0, '100': 0, '07': 0, '0': 0, '': 0, '1e1': 0, ' 2': 0, '99.0': 0,
    '0x10': 0, '1': 1, '2': 2, '99': 99 };
  const wrong = [];
  for (const [stored, gen] of Object.entries(want)) {
    const p = pageLoad({ net: makeNet(), storage: makeStorage({ 'tiles.cachegen.props': stored }) });
    p.restore();
    const url = arch(p).url;
    if (url !== (gen ? FILE + '?cg=' + gen : FILE)) wrong.push(JSON.stringify(stored) + ' -> ' + url);
  }
  ok('3. only an integer written as String(n) in 1..99 is a generation', wrong.length === 0, wrong.join('; '));
}

// 4. a reload of the plain URL is bad as well: a new URL heals it
{
  const net = makeNet({ serverBad: url => !url.includes('?cg=') });
  const storage = makeStorage();
  const p = pageLoad({ net, storage });
  const r = await opens(p); p.restore();
  ok('4. a bad reload too: the new URL opens the archive, with the real tile',
    !r.err && r.tile && same(r.tile, tiles[0].bytes) && heals(p)[0]?.how === 'generation'
    && storage.store.get('tiles.cachegen.props') === '1', r.err && r.err.message);
}

// 5. nothing helps
{
  const net = makeNet({ serverBad: () => true });
  const storage = makeStorage();
  const p = pageLoad({ net, storage });
  const r = await opens(p); p.restore();
  ok('5. nothing helps: it fails, and says why', r.err && /props\.pmtiles/.test(r.err.message), r.err ? r.err.message : 'it opened');
  ok('5. one console error, naming the archive', bad(p.lines).length === 1 && bad(p.lines)[0][0] === 'error', JSON.stringify(p.lines));
  ok('5. a bounded number of requests, and no generation stored',
    net.reads.length <= 4 && storage.sets === 0, `${net.reads.length} reads, ${storage.sets} stores`);
}

// 6. a zero-filled tile range heals the same way
{
  const net = makeNet({ poison: [[FILE, tiles[0].range]], reloadRepairs: true });
  const p = pageLoad({ net, storage: makeStorage() });
  const r = await opens(p); p.restore();
  ok('6. a zero-filled tile range: the tile arrives, byte for byte', !r.err && r.tile && same(r.tile, tiles[0].bytes), r.err && r.err.message);
  ok('6. ...healed by reload, with the tile range recorded',
    heals(p).length === 1 && heals(p)[0].how === 'reload' && heals(p)[0].offset === tiles[0].range[0]
    && /zero/.test(heals(p)[0].why), JSON.stringify(heals(p)));
}

// 7. a healthy archive costs what it cost before
{
  const run = off => {
    const net = makeNet(), storage = makeStorage();
    const p = pageLoad({ net, storage, off });
    return opens(p).then(r => { p.restore(); return { net, storage, p, r }; });
  };
  const base = await run(true), healed = await run(false);
  const sig = x => JSON.stringify(x.net.reads.map(({ url, a, b, mode }) => [url, a, b, mode]));
  ok('7. a healthy archive: the same requests as the old path, in the same order', sig(base) === sig(healed), sig(healed));
  ok('7. ...and the same tile, no console line, nothing stored',
    same(healed.r.tile, base.r.tile) && bad(healed.p.lines).length === 0 && healed.storage.sets === 0 && heals(healed.p).length === 0);
}

// 8. blocked storage
{
  const net = makeNet({ poison: [[FILE, HEADER_RANGE]], reloadRepairs: false });
  const p = pageLoad({ net, storage: makeStorage({}, { blocked: true }) });
  const r = await opens(p); p.restore();
  ok('8. blocked storage: it still heals, in memory, on ?cg=1',
    !r.err && r.tile && same(r.tile, tiles[0].bytes) && arch(p).url === FILE + '?cg=1', r.err && r.err.message);
}

// 9. parallel bad reads move the archive once
{
  const net = makeNet({ poison: tiles.slice(0, 3).map(t => [FILE, t.range]), reloadRepairs: false });
  const storage = makeStorage();
  const p = pageLoad({ net, storage });
  await p.json();
  const got = await Promise.all(tiles.slice(0, 3).map(t => p.tile(t).then(r => r.data, e => e)));
  p.restore();
  ok('9. three bad reads at once: every tile arrives, byte for byte',
    got.every((d, i) => !(d instanceof Error) && same(d, tiles[i].bytes)), got.map(d => d instanceof Error ? d.message : 'ok').join(','));
  ok('9. ...and the archive moved to generation 1 once, not three times',
    arch(p).gen === 1 && storage.store.get('tiles.cachegen.props') === '1', 'gen ' + arch(p).gen);
}

// 10. every other way a range can be wrong is caught by its own rule, and healed by a reload
{
  const rootLen = Number(buffers[FILE].readBigUInt64LE(16));
  const cases = [
    ['a header full of other bytes', HEADER_RANGE, real => Buffer.alloc(real.length, 0xaa), /not a PMTiles header/],
    ['a header of another spec version', HEADER_RANGE, real => { const c = Buffer.from(real); c[7] = 2; return c; }, /spec version 2/],
    ['a good header over a zero-filled root directory', HEADER_RANGE, real => { const c = Buffer.from(real); c.fill(0, 127, 127 + rootLen); return c; }, /root directory without the gzip magic/],
    ['a tile range full of other bytes', tiles[0].range, real => Buffer.alloc(real.length, 0xaa), /without the gzip magic/],
    ['a good header over a root directory whose end is zeros', HEADER_RANGE, real => { const c = Buffer.from(real); c.fill(0, 127 + rootLen - 8, 127 + rootLen); return c; }, /root directory with a zeroed end/],
    ['a tile range whose second half is zeros', tiles[0].range, real => { const c = Buffer.from(real); c.fill(0, c.length >> 1); return c; }, /with a zeroed end/],
    ['a tile range cut short', tiles[0].range, real => real.subarray(0, real.length - 7), /bytes where/],
  ];
  for (const [what, range, corrupt, why] of cases) {
    const net = makeNet({ poison: [[FILE, range, corrupt]], reloadRepairs: true });
    const p = pageLoad({ net, storage: makeStorage() });
    const r = await opens(p); p.restore();
    ok(`10. ${what}: healed, with the real tile and the right reason`,
      !r.err && r.tile && same(r.tile, tiles[0].bytes) && why.test(heals(p)[0]?.why || ''),
      r.err ? r.err.message : JSON.stringify(heals(p)));
  }
}

// 11. no false positive: every directory, metadata block and tile of every real archive passes the check
{
  const names = Object.keys(pageLoad({ net: makeNet(), storage: makeStorage() }).TILES.layers);
  const miss = [];
  let ranges = 0;
  for (const name of names) {
    const file = `data/tiles/${name}.pmtiles`;
    const buf = fs.existsSync(new URL(file, REPO)) ? fs.readFileSync(new URL(file, REPO)) : null;
    if (!buf) { miss.push(name + ' (no file)'); continue; }
    buffers[file] = buf;
    const net = makeNet(), p = pageLoad({ net, storage: makeStorage() });
    p.restore();
    const src = p.TILES.archives?.[name];
    if (!src) { miss.push(name + ' (no healing source)'); continue; }
    const u64 = o => Number(buf.readBigUInt64LE(o));
    const range = (what, at, len) => {
      ranges++;
      const why = src.check(at, len, buf.subarray(at, at + len));
      if (why) miss.push(`${name} ${what} ${at}+${len}: ${why}`);
    };
    range('header', 0, Math.min(16384, buf.length));
    range('metadata', u64(24), u64(32));
    const dir = (at, len) => {            // a v3 directory: count, tile ids, run lengths, lengths, offsets
      const d = zlib.gunzipSync(buf.subarray(at, at + len));
      let q = 0;
      const varint = () => { let v = 0, m = 1, b; do { b = d[q++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
      const n = varint(), run = [], size = [], off = [];
      for (let i = 0; i < n; i++) varint();
      for (let i = 0; i < n; i++) run.push(varint());
      for (let i = 0; i < n; i++) size.push(varint());
      for (let i = 0; i < n; i++) { const o = varint(); off.push(o === 0 && i > 0 ? off[i - 1] + size[i - 1] : o - 1); }
      for (let i = 0; i < n; i++) {
        if (run[i] > 0) range('tile', u64(56) + off[i], size[i]);
        else { range('leaf directory', u64(40) + off[i], size[i]); dir(u64(40) + off[i], size[i]); }
      }
    };
    dir(u64(8), u64(16));
  }
  ok(`11. every directory, metadata block and tile of all ${names.length} real archives passes the check (${ranges} ranges): no false positive`,
    miss.length === 0 && ranges > 1000, miss.slice(0, 3).join('; ') + (ranges <= 1000 ? ` only ${ranges} ranges` : ''));
}

const failed = results.filter(r => !r.pass);
out(`${results.length - failed.length}/${results.length} passed` + (BREAK ? ' (--break: the heal is off)' : ''));
process.exit(failed.length ? 1 : 0);
