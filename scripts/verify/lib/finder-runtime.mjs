import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export async function finderRuntime(options = {}) {
  const reads = [];
  const storage = new Map();
  const allowed = new Set(['data/walk_graph.json', 'data/ut_buildings.json']);
  const location = {
    search: '?livehere=1',
    href: 'http://synthetic.invalid/index.html?livehere=1',
    origin: 'http://synthetic.invalid',
  };
  const sandbox = {
    URL, URLSearchParams, performance, console, TextEncoder, TextDecoder, Intl,
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    location, navigator: {},
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} },
    addEventListener: () => {}, dispatchEvent: () => {},
    CustomEvent: class {
      constructor(type, event) { this.type = type; this.detail = event?.detail; }
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    fetch: async input => {
      const target = new URL(String(input), location.origin + '/');
      const relative = target.pathname.slice(1);
      if (target.origin !== location.origin || !allowed.has(relative)) {
        throw new Error('Finder verification forbids network or private fixture reads: ' + relative);
      }
      reads.push(relative);
      const text = relative === 'data/walk_graph.json' && options.graph
        ? JSON.stringify(options.graph) : await fs.readFile(path.join(ROOT, relative), 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
    },
  };
  sandbox.window = sandbox;
  const source = await fs.readFile(path.join(ROOT, 'js/wayfind.js'), 'utf8');
  const seam = `
  window.__finderVerify = { loadGraph, decode, buildIndex, resolve, computeRoute,
    measure, timeRange, doorSet, anchors, dijkstra, legBetween, schedCodes, impRowFromRead,
    impRowFromEvent, impResultFrom, impStoreDoc, normaliseSchedule, schedulePublished, calls: [] };
  const originalComputeRoute = computeRoute;
  computeRoute = function (...args) {
    const answer = originalComputeRoute(...args);
    window.__finderVerify.calls.push({ from: args[1], to: args[2], opts: args[3], answer });
    return answer;
  };
`;
  if (!/\}\)\(\);\s*$/.test(source)) throw new Error('Finder VM seam no longer matches the IIFE');
  const context = vm.createContext(sandbox);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, seam + '})();'), context,
    { filename: 'js/wayfind.js', timeout: 10000 });
  vm.runInContext(await fs.readFile(path.join(ROOT, 'js/live-here-core.js'), 'utf8'), context,
    { filename: 'js/live-here-core.js', timeout: 10000 });
  const graph = await sandbox.__finderVerify.loadGraph();
  return { app: sandbox, core: sandbox.LiveHereCore, graph, seam: sandbox.__finderVerify, reads };
}

export function syntheticGraph() {
  return {
    q: 0.000001,
    n: { x: [-97740000, 1000], y: [30280000, 0] },
    e: { a: [0], b: [1], w: [9606], f: [0], s: [-1] },
    d: [
      [-97740000, 30279910, [0], [1000], 'main', 'synthetic', 'SYN', 'Synthetic Hall'],
      [-97739000, 30280090, [1], [1000], 'main', 'synthetic', 'TST', 'Test Hall'],
    ],
    code: { SYN: [0], TST: [1] },
    name: { 'synthetic hall': 'SYN', 'test hall': 'TST' }, wc: {}, poi: [],
    tune: { WALK_SPEED_LOW_MS: 1.1, WALK_SPEED_HIGH_MS: 1.4, STAIR_SPEED_MPS: 0.5,
      STAIR_FIXED_S: 4, STAIR_UP_MULT: 1.35, SIGNAL_WAIT_LOW_S: 0, SIGNAL_WAIT_HIGH_S: 45,
      CROSSING_PENALTY_M: 8, DOOR_LINK_MAX_M: 30 },
    meta: {}, as_of: 'synthetic',
  };
}
