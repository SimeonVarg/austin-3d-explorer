/**
 * tiles.js — teach MapLibre to read the PMTiles archives, and say so out loud.
 *
 * WHY ANY OF THIS. A first-time visitor downloads ~28 MB across 26 files before
 * the city appears, and every file is the WHOLE city — fetched whether or not
 * the camera can see it. That is the ceiling on how much detail this project can
 * ever have: a nicer roofscape makes the site slower for everyone. Tiles remove
 * the trade, because the browser fetches only the tiles under the camera. Detail
 * stops costing load time.
 *
 * The five big layers (trees, roads, outer ring, roof detail, props — 20 MB of
 * the 28) are built by scripts/tile.sh into data/tiles/*.pmtiles. Buildings stay
 * GeoJSON on purpose; see the header of tile.sh for why, and note they are only
 * 1.41 MB of the payload.
 *
 * REGISTRATION IS A SIDE EFFECT AND ORDER MATTERS. `maplibregl.addProtocol` has
 * to be called before any map is constructed, so this file is a script tag in
 * index.html between the two libraries and everything else, not something app.js
 * calls. If it runs late the source silently 404s and the layer is simply
 * absent — no error, no missing-texture checkerboard, just no trees.
 *
 * IT FALLS BACK, AND THAT IS THE POINT OF THE FLAG BELOW. The tiles are built by
 * CI and committed; a fresh clone or a branch where the build has not run yet has
 * no data/tiles/ at all. Rather than render a city with no trees and no roads,
 * `window.TILES.on` goes false and every caller keeps its existing GeoJSON URL.
 * Slower, correct, and obvious — a blank city that looks deliberate is the worst
 * outcome available here.
 */
(function () {
  'use strict';

  /**
   * MAPLIBRE USES ONE WORKER, ON A SIXTEEN-CORE MACHINE.
   *
   * This is here rather than in a file of its own because `setWorkerCount` has
   * the same hard constraint as `addProtocol`: it must run before any Map is
   * constructed, and this file is already the thing that runs there.
   *
   * HOW IT WAS FOUND. boot.mjs now records when each source becomes usable.
   * Every one of our 22 sources finished between 3.8 s and 6.7 s — tiny ones
   * and huge ones alike, `austin-buildings` sitting unremarkably in the middle.
   * Sources of wildly different sizes finishing together is not a size problem,
   * it is a QUEUE, and `maplibregl.getWorkerCount()` returned **1**.
   *
   * MEASURED, five interleaved reps, hardware GL, localhost:
   *
   *     workers=1   6747 6574 6539 6543 6358    min 6358 ms
   *     workers=4   5825 5507 6414 5736 6083    min 5507 ms
   *     workers=8   5871 6855                   worse than 4
   *
   * Four won all five reps. ~0.85 s at the minimum, ~0.7 s at the median. Eight
   * is worse than four — past the point where more threads help, the scheduling
   * costs more than it saves.
   *
   * SCALED, NOT FIXED AT FOUR. A phone with two cores handed four tile workers
   * spends its time context-switching, and the whole point of the load work is
   * the person on a phone. Half the cores, capped at four because four is where
   * the measurement stopped improving.
   */
  const MAP_WORKERS = {
    on: true,
    max: 4,                                   // measured ceiling; 8 was worse
    perCores: 2,                              // one worker per this many cores
  };
  window.MAP_WORKERS = MAP_WORKERS;

  if (MAP_WORKERS.on && typeof maplibregl !== 'undefined'
      && typeof maplibregl.setWorkerCount === 'function') {
    const cores = navigator.hardwareConcurrency || 2;
    const n = Math.max(1, Math.min(MAP_WORKERS.max,
                                   Math.floor(cores / MAP_WORKERS.perCores)));
    try {
      maplibregl.setWorkerCount(n);
      console.log('[tiles] tile workers: ' + n + ' (' + cores + ' cores)');
    } catch (e) {
      console.warn('[tiles] setWorkerCount failed:', e.message);
    }
  }

  // MapLibre repeats its variable-zoom calculation for the same tile distance
  // across dozens of sources. Cache exact inputs, never rounded camera values
  // or tile IDs: this saves trig/log work without changing tile selection.
  const TILE_LOD_CACHE = { on: true, maxDistances: 4096, maxZooms: 8,
    stats: { calls: 0, hits: 0, sources: 0 } };
  window.TILE_LOD_CACHE = TILE_LOD_CACHE;
  function memoTileZoom(original, tune = TILE_LOD_CACHE) {
    let lastG, lastV, lastFov;
    let tables = new Map();
    return function (zoom, distance, g, v, fov) {
      tune.stats.calls++;
      if (!tune.on) return original(zoom, distance, g, v, fov);
      if (g !== lastG || v !== lastV || fov !== lastFov) {
        tables.clear(); lastG = g; lastV = v; lastFov = fov;
      }
      let table = tables.get(zoom);
      if (!table) {
        if (tables.size >= tune.maxZooms) tables.clear();
        table = new Map(); tables.set(zoom, table);
      }
      if (table.has(distance)) { tune.stats.hits++; return table.get(distance); }
      const result = original(zoom, distance, g, v, fov);
      if (table.size >= tune.maxDistances) table.clear();
      table.set(distance, result);
      return result;
    };
  }
  window.initTileLodCache = function initTileLodCache(map) {
    if (map.__tileLodCache || !TILE_LOD_CACHE.on) return;
    // The public API supplies the exact default function, not our own copy of
    // its math. Guard the version whose defaults and source contract we checked.
    if (maplibregl.getVersion?.() !== '5.24.0' || !map.setSourceTileLodParams) return;
    map.__tileLodCache = true;
    const seen = new WeakSet();
    let shared;
    function attach(id) {
      // Do not mark a source seen while MapLibre has detached its style.
      // A later sourcedata event retries the same id after restoration.
      if (!map.style) return;
      const source = map.getSource(id);
      if (!source || seen.has(source)) return;
      seen.add(source);
      if (source.calculateTileZoom) return; // preserve deliberate custom LOD
      if (!shared) {
        // MapLibre 5.24.0's defaults: Te(9.314, 3). This sets the same function
        // through the supported setter so later library changes fail closed.
        map.setSourceTileLodParams(9.314, 3, id);
        shared = memoTileZoom(source.calculateTileZoom);
      }
      source.calculateTileZoom = shared;
      TILE_LOD_CACHE.stats.sources++;
    }
    if (map.style) for (const id of Object.keys(map.getStyle().sources)) attach(id);
    const onData = e => { if (e.sourceId) attach(e.sourceId); };
    map.on('sourcedata', onData);
    map.once('remove', () => map.off('sourcedata', onData));
  };

  // Taste/behaviour block — one edit to turn the whole thing off.
  const TILES = {
    // Master switch. `?tiles=0` forces it off for an A/B without editing code.
    on: new URLSearchParams(location.search).get('tiles') !== '0',
    dir: 'data/tiles',
    // Layer name inside each archive, set by --layer= in scripts/tile.sh. If
    // these two ever disagree the source loads and draws nothing, so they are
    // written down together rather than being spelled out at each call site.
    layers: {
      trees:      { file: 'trees.pmtiles',      layer: 'trees' },
      roads:      { file: 'roads.pmtiles',      layer: 'roads' },
      outer:      { file: 'outer.pmtiles',      layer: 'outer' },
      roofdetail: { file: 'roofdetail.pmtiles', layer: 'roofdetail' },
      props:      { file: 'props.pmtiles',      layer: 'props' },
    },
    // Must match --maximum-zoom in scripts/tile.sh. MapLibre needs to be told,
    // or it requests z17+ tiles that do not exist and the layer disappears when
    // you fly close — the exact failure that looks like "the trees vanish".
    maxzoom: 16,
  };
  window.TILES = TILES;

  if (!TILES.on) { console.log('[tiles] disabled by ?tiles=0'); return; }

  if (typeof pmtiles === 'undefined' || typeof maplibregl === 'undefined') {
    console.warn('[tiles] pmtiles or maplibre not loaded - falling back to GeoJSON');
    TILES.on = false;
    return;
  }

  /**
   * A BROKEN BROWSER CACHE MUST NOT TAKE A WHOLE LAYER WITH IT.
   *
   * MEASURED 2026-10-04 in a desktop browser on the live site: a plain fetch of
   * bytes 0-16383 of outer, roads and props came back from the HTTP cache as a
   * 206 with the right length and the right Content-Range, and every byte was
   * ZERO. The same fetch with `cache: 'no-store'` returned the real file. Later
   * ranges, and the other two archives, were fine; there was no service worker
   * and no Cache Storage. That range holds the PMTiles header and the root
   * directory, so the archive could not open, the library kept the failed header
   * promise for the rest of the page, and the layer was simply absent: downtown
   * with its name labels floating over bare ground, no road detail. No error
   * anyone would see, and a hard refresh did not help (it revalidates the page,
   * not a range entry). The likely cause is a cache entry zero-filled by a hard
   * crash.
   *
   * THE HEAL. Every read an archive makes goes through HealingSource, which
   * checks what came back: the header must be PMTiles spec 3 with its root
   * directory in the first read, and every other read must be the length asked
   * for and, when the header says the archive is gzip, start with the gzip magic.
   * A bad read is read again past the cache (`cache: 'reload'`, which also
   * rewrites the bad entry). Then a NORMAL read of the same range is checked
   * once more; if the cache still hands back the bad copy, the archive moves to
   * a new URL for good (`?cg=N`, N kept in localStorage per archive), which has
   * no cache entry at all. The read that failed is answered in the same page
   * load; nothing reloads. One console line per archive says what was wrong and
   * which way it healed; `TILES.heals` keeps the same facts for a bug report.
   *
   * WHAT IT DOES NOT CATCH: bytes that are wrong in the middle of a range, or a
   * range that has the right start and a zeroed tail. Those fail to decode in
   * the library and cost one tile, not a layer. `?tileheal=0` is the old code
   * path (stock sources, no check), for an A/B and for the verify script's
   * --break.
   */
  const TILE_HEAL = {
    on: new URLSearchParams(location.search).get('tileheal') !== '0',
    version: 3,          // the PMTiles spec version scripts/tile.sh writes
    gzip: 2,             // the header's compression code for gzip
    headerBytes: 127,    // the fixed v3 header
    zeroProbe: 16,       // a read whose first this-many bytes are all zero is bad
    maxGen: 99,          // a stored generation outside 1..maxGen is garbage: 0
    param: 'cg',         // the query parameter that names a generation
    key: name => 'tiles.cachegen.' + name,
  };
  TILES.heals = [];       // one record per archive that healed, for diagnosis
  TILES.archives = {};    // name -> HealingSource, when healing is on

  /** A stored generation is an integer in 1..maxGen written exactly as String(n). */
  function readGeneration(name) {
    let v = null;
    try { v = localStorage.getItem(TILE_HEAL.key(name)); } catch (e) { /* storage blocked */ }
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n <= TILE_HEAL.maxGen && String(n) === v ? n : 0;
  }

  /**
   * The stock FetchSource does the ranges, the etag check and the error cases;
   * this adds the check on what it returns and the way out when the check fails.
   */
  function makeHealingSource() {
    return class HealingSource extends pmtiles.FetchSource {
      constructor(name, file) {
        super(file);
        this.name = name;
        this.file = file;
        this.gzip = false;       // learned from a good header: are dirs and tiles gzip?
        this.said = {};          // what this archive has already said in the console: heal, fail
        this.setGeneration(readGeneration(name), false);
      }

      /** Protocol finds the archive by the URL in `pmtiles://`, which never changes. */
      getKey() { return this.file; }

      setGeneration(gen, save = true) {
        this.gen = gen;
        this.url = gen ? this.file + '?' + TILE_HEAL.param + '=' + gen : this.file;
        if (!save) return;
        try { localStorage.setItem(TILE_HEAL.key(this.name), String(gen)); } catch (e) { /* kept in memory */ }
      }

      /** Why these bytes cannot be what was asked for, or '' when they can. */
      check(offset, length, data) {
        const b = new Uint8Array(data);
        const zero = b.subarray(0, TILE_HEAL.zeroProbe).every(v => v === 0);
        if (offset === 0) {
          if (zero) return 'zero bytes';
          if (b.length < TILE_HEAL.headerBytes
              || String.fromCharCode(...b.subarray(0, 7)) !== 'PMTiles') return 'bytes that are not a PMTiles header';
          if (b[7] !== TILE_HEAL.version) return 'PMTiles spec version ' + b[7];
          const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
          const rootAt = v.getUint32(8, true), rootLen = v.getUint32(16, true);   // low words: a few KB
          if (rootAt + rootLen > b.length) return 'a root directory outside the first read';
          this.gzip = b[97] === TILE_HEAL.gzip && b[98] === TILE_HEAL.gzip;       // directories, tiles
          return this.gzip && !(b[rootAt] === 0x1f && b[rootAt + 1] === 0x8b) ? 'a root directory that is not gzip' : '';
        }
        if (length && b.length !== length) return b.length + ' bytes where ' + length + ' were asked for';
        if (zero) return 'zero bytes';
        return this.gzip && !(b[0] === 0x1f && b[1] === 0x8b) ? 'bytes that are not gzip' : '';
      }

      async getBytes(offset, length, signal, etag) {
        const got = await super.getBytes(offset, length, signal, etag);
        const why = this.check(offset, length, got.data);
        return why ? this.heal(offset, length, signal, etag, why) : got;
      }

      async heal(offset, length, signal, etag, why) {
        const startGen = this.gen;
        const good = r => !this.check(offset, length, r.data);
        const normal = () => super.getBytes(offset, length, signal, etag);
        const fresh = () => {      // one read that skips the cache; the stock source reloads when told to
          const s = new pmtiles.FetchSource(this.url, this.customHeaders);
          s.mustReload = true;
          return s.getBytes(offset, length, signal, etag);
        };
        // A new URL, unless another heal of this archive already moved it. It is
        // only written to storage once a read on it has worked.
        const move = () => {
          if (this.gen === startGen) this.setGeneration(Math.min(startGen + 1, TILE_HEAL.maxGen), false);
          return this.gen;
        };

        let got = await fresh(), how = 'reload', gen = startGen;
        if (good(got)) {
          const again = await normal();            // did the reload rewrite the bad entry?
          if (good(again)) got = again; else { gen = move(); how = 'generation'; }
        } else {                                   // even a reload came back bad: try an URL the cache has never seen
          gen = move(); how = 'generation';
          got = await normal();
        }
        const where = this.file + ' bytes ' + offset + '-' + (offset + length - 1);
        if (!good(got)) {
          if (this.gen !== startGen) this.setGeneration(startGen, false);
          const msg = '[tiles] ' + where + ': ' + why + ', and still bad after a fresh read and a new URL; this layer will not draw';
          if (!this.said.fail) { this.said.fail = true; console.error(msg); }
          throw new Error(msg);
        }
        if (how === 'generation') this.setGeneration(gen);
        TILES.heals.push({ archive: this.name, offset, length, why, how, gen });
        if (!this.said.heal) {
          this.said.heal = true;
          console.warn('[tiles] ' + where + ': the browser cache held ' + why + '; ' + (how === 'reload'
            ? 'read it fresh and the cache entry is repaired'
            : 'read it fresh, and this archive now loads from ?' + TILE_HEAL.param + '=' + gen));
        }
        return got;
      }
    };
  }

  try {
    const protocol = new pmtiles.Protocol();
    if (TILE_HEAL.on) {
      // A broken healing setup must never cost the tiles themselves: the stock
      // protocol below is still the fallback, exactly as before this existed.
      try {
        const HealingSource = makeHealingSource();
        for (const [name, spec] of Object.entries(TILES.layers)) {
          TILES.archives[name] = new HealingSource(name, TILES.dir + '/' + spec.file);
          protocol.add(new pmtiles.PMTiles(TILES.archives[name]));
        }
      } catch (e) {
        console.warn('[tiles] cache healing unavailable:', e.message);
      }
    }
    maplibregl.addProtocol('pmtiles', protocol.tile);
  } catch (e) {
    console.warn('[tiles] addProtocol failed:', e.message, '- falling back to GeoJSON');
    TILES.on = false;
    return;
  }

  /**
   * Probe once, up front, so a missing archive degrades on purpose instead of
   * per-layer at random. A HEAD is enough — pmtiles serves range requests off a
   * static host, so if the file is there at all it works.
   */
  TILES.ready = (async () => {
    try {
      const r = await fetch(TILES.dir + '/' + TILES.layers.trees.file, {
        method: 'HEAD',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      console.log('[tiles] pmtiles available');
      return true;
    } catch (e) {
      console.warn('[tiles] no archives at ' + TILES.dir + ' (' + e.message +
                   ') - every layer stays on GeoJSON');
      TILES.on = false;
      return false;
    }
  })();

  /**
   * The one call sites make. Returns either a vector-source spec plus the
   * `source-layer` its layers need, or null — and null means "use your GeoJSON
   * URL exactly as before".
   *
   *   const t = window.tileSource('trees');
   *   map.addSource('austin-trees', t ? t.source
   *                                   : { type:'geojson', data:'data/trees.geojson' });
   *   ...and spread t.layerProps into every layer on it.
   */
  window.tileSource = function tileSource(name) {
    if (!TILES.on) return null;
    const spec = TILES.layers[name];
    if (!spec) { console.warn('[tiles] unknown layer', name); return null; }
    return {
      source: {
        type: 'vector',
        url: 'pmtiles://' + TILES.dir + '/' + spec.file,
        // Belt and braces alongside the archive's own metadata.
        maxzoom: TILES.maxzoom,
      },
      layerProps: { 'source-layer': spec.layer },
    };
  };
})();
