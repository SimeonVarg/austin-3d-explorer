// MapLibre half of a compiled GDC. The caller owns decoding, the Three
// underside group, GPU upload and disposal. This adapter owns only its source
// and cloned hero layers; the original source/undersides remain as fallback.
const GDC_ID = '44e418d6-dd3a-48da-8e9d-c29e59593299';
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const abortError = message => Object.assign(new Error(message), { name: 'AbortError' });

export function validateHeroFeatureCollection(input, id) {
  const bad = detail => { throw new Error('Invalid compiled hero: ' + detail); };
  if (id !== GDC_ID) bad('unsupported building ID');
  if (!plain(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features) ||
      !input.features.length || input.features.length > 100000) bad('feature collection');
  for (const key of ['replacedBuildingIds', 'authoredRoofIds']) {
    if (!Array.isArray(input[key]) || input[key].length !== 1 || input[key][0] !== id) bad('building identity');
  }
  if (!plain(input.heroHeights) || Object.keys(input.heroHeights).length !== 1 ||
      !Number.isFinite(input.heroHeights[id]) || input.heroHeights[id] <= 0) bad('building height');
  for (const f of input.features) {
    const p = f?.properties, g = f?.geometry;
    if (f?.type !== 'Feature' || !plain(p) || p.b !== 'gdc' ||
        !['solid', 'gdc-glass', 'brick', 'glassb'].includes(p.lyr) || ![0, 1].includes(p.cap) ||
        !Number.isFinite(p.base) || !Number.isFinite(p.h) || p.base < 0 || p.h < p.base || p.h > 1000) bad('feature properties');
    for (const key of p.cap === 1 ? ['wd', 'wg', 'wn', 'rd', 'rg', 'rn'] : ['wd', 'wg', 'wn']) {
      if (typeof p[key] !== 'string' || !/^#[a-f0-9]{6}$/i.test(p[key])) bad('feature colour');
    }
    if (!plain(g) || g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !g.coordinates.length) bad('polygon');
    for (const ring of g.coordinates) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 100000) bad('polygon ring');
      for (const ll of ring) if (!Array.isArray(ll) || ll.length !== 2 || !ll.every(Number.isFinite) ||
          Math.abs(ll[0]) > 180 || Math.abs(ll[1]) > 85.06) bad('coordinate');
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) bad('unclosed ring');
      const [x, y] = ring[0];
      let area = 0;
      for (let i = 1; i < ring.length; i++) area += (ring[i - 1][0] - x) * (ring[i][1] - y) - (ring[i][0] - x) * (ring[i - 1][1] - y);
      if (!Number.isFinite(area) || Math.abs(area) < 1e-16) bad('degenerate ring');
    }
  }
  // Clone before touching MapLibre so caller mutation cannot silently change
  // a prepared transaction. Serialization errors are also pre-mutation errors.
  const json = JSON.stringify(input);
  return { data: JSON.parse(json), serializedGeoJsonBytes: new TextEncoder().encode(json).byteLength };
}

export class BuildingHeroAdapter {
  constructor({ map, id, onState, host = globalThis.HeroesAssetHost?.get(map) } = {}) {
    if (!map || id !== GDC_ID || !host || host.id !== id || host.map !== map) throw new Error('GDC hero host is not initialized');
    this.map = map; this.id = id; this.host = host; this.onState = onState;
    this.state = 'idle'; this.record = null; this.callbacks = null; this.pending = null;
    this.payloadBytes = 0; this.contentSeen = false; this.renderedReady = false;
    this.disposed = false; this.lastError = null;
    this.onSource = event => {
      if (event.sourceId === this.record?.sourceId && event.sourceDataType === 'content') this.contentSeen = true;
    };
    this.onRender = () => {
      if (this.state !== 'preparing' || !this.contentSeen || !this.sourceLoaded()) return;
      this.renderedReady = true;
      const pending = this.pending;
      this.pending = null;
      if (pending) clearTimeout(pending.timer);
      this.setState('ready');
      pending?.resolve(this);
    };
    this.onError = event => {
      if (event.sourceId !== this.record?.sourceId) return;
      const error = event.error || new Error('Compiled hero source failed');
      this.fail(error, 'source-error');
    };
    this.unobserve = host.observe(reason => {
      if (reason === 'remove') { this.dispose({ mapRemoved: true }); return; }
      if (reason === 'context-lost' || reason === 'style-reset') this.interrupt(reason);
      else if (reason?.type === 'error' && this.record) this.fail(reason.error, 'style-error');
    });
    map.on('sourcedata', this.onSource); map.on('render', this.onRender); map.on('error', this.onError);
  }

  setState(state, detail = {}) {
    this.state = state;
    try { this.onState?.(state, detail); } catch (error) { this.lastError = error.message; }
  }
  sourceLoaded() {
    if (!this.record || !this.host.usable) return false;
    try { return !!this.map.getSource(this.record.sourceId) && this.map.isSourceLoaded(this.record.sourceId); }
    catch { return false; }
  }
  get ready() { return ['ready', 'active'].includes(this.state) && this.renderedReady && this.sourceLoaded(); }
  get stats() {
    return { state: this.state, ready: this.ready, sourceLoaded: this.sourceLoaded(),
      sourceContentSeen: this.contentSeen, renderedAfterSourceReady: this.renderedReady,
      sourceId: this.record?.sourceId || null, layerIds: this.record?.layers.map(l => l.id) || [],
      sources: this.record ? 1 : 0, layers: this.record?.layers.length || 0,
      features: this.record?.data.features.length || 0, serializedGeoJsonBytes: this.payloadBytes,
      maplibreGpuBytes: null, fallback: this.host.fallbackStats, lastError: this.lastError };
  }

  async prepare(featureCollection, { signal, timeoutMs = 45000 } = {}) {
    // Invalid data never cancels a good resident or changes any map resource.
    const validated = validateHeroFeatureCollection(featureCollection, this.id);
    if (this.disposed) throw new Error('Hero adapter is disposed');
    if (signal?.aborted) throw signal.reason || abortError('Hero preparation cancelled');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid hero preparation timeout');
    if (this.state === 'active') throw new Error('Restore the active hero before preparing another asset');
    if (!this.host.usable) throw new Error('Hero style is unavailable');
    this.restore({ notify: false });
    this.contentSeen = this.renderedReady = false;
    this.payloadBytes = validated.serializedGeoJsonBytes;
    this.setState('preparing');
    try { this.record = this.host.createSource(validated.data); this.record.adapter = this; }
    catch (error) {
      this.payloadBytes = 0; this.lastError = error.message;
      this.setState('error', { reason: 'prepare-error', error }); throw error;
    }
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Compiled hero source readiness timed out'), 'timeout'), timeoutMs);
      this.pending = { resolve, reject, timer };
    });
    if (signal) {
      const cancel = () => this.fail(signal.reason || abortError('Hero preparation cancelled'), 'cancelled');
      signal.addEventListener('abort', cancel, { once: true });
      this.clearAbort = () => signal.removeEventListener('abort', cancel);
      if (signal.aborted) cancel();
    }
    this.map.triggerRepaint();
    return result;
  }

  // All commit operations finish on this stack, before MapLibre or Three can
  // draw another frame. Zero opacity transitions prevent a cross-fade overlap.
  commit({ attach, detach } = {}) {
    if (this.disposed || this.state !== 'ready' || !this.ready) throw new Error('Compiled hero is not ready to commit');
    if (typeof attach !== 'function' || typeof detach !== 'function') throw new Error('Hero commit requires attach and detach callbacks');
    const previous = this.host.current, previousAdapter = previous?.adapter;
    const rollback = [];
    try {
      attach();
      this.host.select(this.record);
      previousAdapter?.callbacks?.detach();
    } catch (error) {
      for (const undo of [() => detach(), () => previousAdapter?.callbacks?.attach(), () => this.host.select(previous)]) {
        try { undo(); } catch (failure) { rollback.push(failure); }
      }
      if (rollback.length) { this.setState('error'); throw new AggregateError([error, ...rollback], 'Hero commit and rollback failed'); }
      throw error;
    }
    this.callbacks = { attach, detach };
    if (previousAdapter) {
      // A superseded adapter owns only its now-hidden source. Its later
      // disposal must neither restore the original nor detach the new group.
      previousAdapter.callbacks = null;
      previousAdapter.setState('superseded');
    }
    this.clearAbort?.(); this.clearAbort = null;
    this.setState('active'); this.map.triggerRepaint();
    return this;
  }

  restore({ notify = true } = {}) {
    if (this.disposed) return this;
    const pending = this.pending;
    this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(abortError('Hero preparation restored')); }
    this.clearAbort?.(); this.clearAbort = null;
    if (this.record && this.host.current === this.record) {
      const rollback = [];
      try {
        this.host.select(null);
        this.callbacks?.detach();
      } catch (error) {
        for (const undo of [() => this.callbacks?.attach(), () => this.host.select(this.record)]) {
          try { undo(); } catch (failure) { rollback.push(failure); }
        }
        if (rollback.length) { this.setState('error'); throw new AggregateError([error, ...rollback], 'Hero restoration and rollback failed'); }
        throw error;
      }
    }
    if (this.record) this.host.removeSource(this.record);
    this.record = this.callbacks = null;
    this.payloadBytes = 0; this.contentSeen = this.renderedReady = false;
    if (this.state !== 'idle' && notify) this.setState('restored', { reason: 'restore' });
    if (this.host.usable) this.map.triggerRepaint();
    return this;
  }

  // Context loss and a replacement style invalidate the previous render fence.
  // Downgrade to the retained original; a controller may prepare again after
  // the host is usable. Source removal is deferred by the host if style is null.
  interrupt(reason) {
    if (this.disposed || !this.record) return;
    const pending = this.pending;
    this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(abortError('Hero preparation interrupted: ' + reason)); }
    this.clearAbort?.(); this.clearAbort = null;
    const errors = [];
    for (const action of [() => { if (this.host.current === this.record) this.host.select(null); },
      () => this.callbacks?.detach(), () => this.host.removeSource(this.record)]) {
      try { action(); } catch (error) { errors.push(error); }
    }
    this.record = this.callbacks = null;
    this.payloadBytes = 0; this.contentSeen = this.renderedReady = false;
    if (errors.length) this.lastError = errors.map(e => e.message).join('; ');
    this.setState('restored', { reason, errors });
  }

  fail(error, reason) {
    if (this.disposed) return;
    const pending = this.pending;
    if (pending) { this.pending = null; clearTimeout(pending.timer); }
    this.lastError = error.message;
    this.interrupt(reason);
    pending?.reject(error);
    if (!this.disposed) this.setState(reason === 'cancelled' ? 'restored' : 'error', { reason, error });
  }

  dispose({ mapRemoved = false } = {}) {
    if (this.disposed) return;
    if (mapRemoved || this.map._removed === true) {
      // MapLibre deletes its style before firing remove. The caller can run
      // before the host's own remove listener, so restoring even a hidden
      // source here would touch a destroyed style. The host clears its source
      // records on removal; release only this adapter's ownership and waiters.
      this.disposed = true;
      const pending = this.pending;
      this.pending = null;
      if (pending) { clearTimeout(pending.timer); pending.reject(abortError('Hero map removed')); }
      this.clearAbort?.(); this.clearAbort = null;
      try { this.callbacks?.detach(); } catch (error) { this.lastError = error.message; }
      this.record = this.callbacks = null;
      this.payloadBytes = 0; this.contentSeen = this.renderedReady = false;
    } else {
      this.restore();
    }
    this.disposed = true;
    this.unobserve?.(); this.unobserve = null;
    this.map.off('sourcedata', this.onSource); this.map.off('render', this.onRender); this.map.off('error', this.onError);
    this.setState('disposed');
  }
}

if (typeof window !== 'undefined') window.BuildingHeroAdapter = BuildingHeroAdapter;
