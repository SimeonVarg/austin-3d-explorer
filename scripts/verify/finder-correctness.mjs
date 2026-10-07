import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { finderRuntime, ROOT, syntheticGraph } from './lib/finder-runtime.mjs';
import { decodeWalkGraph, routeBetween, walkProbe, releaseWalkGraph, WALKG } from '../../js/walkgraph.js';
import { locFromWords } from '../../js/schedimg.js';
import { review, prepare, apply as applyConfirmed } from '../../js/schedconfirm.js';

const SETTINGS = {
  codes: ['MAI', 'WEL', 'PCL', 'GDC', 'UTC', 'CBA', 'RLP', 'GRE', 'ECJ', 'DMC', 'ART',
    'BUR', 'BIO', 'PAT', 'SAC', 'SSW', 'HLB', 'NUR', 'JES', 'KIN', 'SMC', 'BEG'],
  profiles: [false, true],
  ratioLow: 1, ratioHigh: 3, distanceToleranceM: 0.02, timeToleranceS: 0.02, geometryToleranceM: 1,
  quiet: process.env.FINDER_QUIET_PATH || null,
  nonHousing: ['moody-center.json', 'battle-hall.json', 'texas-union.json', 'pcl.json',
    'welch-hall.json', 'benedict-hall.json', 'mezes-hall.json', 'batts-hall.json',
    'the-otis-hotel.json', '26-west-courtyard.json'],
  unindexedProperties: [
    { file: 'estates-at-east-riverside.json', name: 'Estates at East Riverside' },
    { file: 'the-element-austin.json', name: 'The Element Austin' },
    { file: 'town-lake-student-apartments.json', name: 'Town Lake Student Apartments' },
    { file: 'village-at-east-riverside.json', name: 'Village at East Riverside' },
  ],
  oracleSeed: 420930, oracleGraphs: 40, oracleNodes: 7, oracleQueriesPerProfile: 6,
};
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const output = outputIndex < 0 ? null : path.resolve(args[outputIndex + 1]);
const report = { method: 'Node-only production VM; synthetic schedules; public local data only; no network/browser',
  settings: SETTINGS, snapshot: {}, coverage: {}, findings: {}, regressions: [], routes: [] };
const json = value => JSON.parse(JSON.stringify(value));
const digest = text => createHash('sha256').update(text).digest('hex');
const flags = (kind, detail) => { (report.findings[kind] ||= []).push(detail); };
const test = async (name, run) => {
  try { await run(); report.regressions.push({ name, ok: true }); }
  catch (error) { report.regressions.push({ name, ok: false, error: error.message }); }
};
async function quietGate() {
  if (!SETTINGS.quiet) return;
  while (await fs.stat(SETTINGS.quiet).then(() => true, () => false)) {
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
const metres = (from, to) => Math.hypot((to[0] - from[0]) * 96061, (to[1] - from[1]) * 111195);
const normalize = name => String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const same = (actual, expected) => assert.deepEqual(json(actual), json(expected));
const row = (code, startMin = 600, endMin = 650, days = ['MO']) => ({ code, startMin, endMin, days });
function routeMeasure(graph, route) {
  const measure = { flat: route.fromLinkM + route.toLinkM, stair: 0, stairDown: 0, stairSets: 0, signals: 0 };
  const downward = new Set();
  let edgeIndex = 0;
  for (const delta of graph.raw.e.dn || []) { edgeIndex += delta; downward.add(edgeIndex); }
  for (const leg of route.legs) {
    const stairs = new Set();
    for (const [index, edge] of leg.edges.entries()) {
      const length = graph.W[edge] / 100, flags = graph.F[edge];
      const startsAtA = leg.nodes[index] === graph.A[edge];
      if (flags & 1) {
        measure.stair += length; stairs.add(graph.S[edge]);
        if (flags & 8 ? !startsAtA : downward.has(edge) && startsAtA) measure.stairDown += length;
      } else measure.flat += length;
      if (flags & 4) measure.signals++;
    }
    measure.stairSets += stairs.size;
  }
  return measure;
}

await quietGate();
const graphText = await fs.readFile(path.join(ROOT, 'data/walk_graph.json'), 'utf8');
const raw = JSON.parse(graphText);
const runtime = await finderRuntime({ graph: raw });
const { app, core, graph, seam } = runtime;
const codes = await app.wayfindScheduleCodes();
const codeSet = new Set(codes.map(entry => entry.code));
const routableCodes = new Set(codes.filter(entry => app.wayfindSearch(entry.code).some(hit => hit.code === entry.code && hit.routable)).map(entry => entry.code));
const index = JSON.parse(await fs.readFile(path.join(ROOT, 'data/apartments/index.json'), 'utf8'));
const specs = [];
for (const file of index.buildings) {
  const spec = JSON.parse(await fs.readFile(path.join(ROOT, 'data/apartments', file), 'utf8'));
  if (!SETTINGS.nonHousing.includes(file)) specs.push({ ...spec, file: 'data/apartments/' + file });
}
for (const file of index.collections || []) {
  const collection = JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8'));
  for (const spec of collection.buildings || []) if (spec.category === 'apartment') specs.push({ ...spec, file });
}
const homes = new Map(specs.map(spec => [spec.name, { name: spec.name, id: spec.id, file: spec.file }]));
for (const name of Object.keys(raw.wc)) if (!homes.has(name)) homes.set(name, { name, file: 'data/walk_graph.json:wc' });
const baselineHomes = new Set(homes.keys());
const apartmentFiles = (await fs.readdir(path.join(ROOT, 'data/apartments'))).filter(file => file.endsWith('.json') && file !== 'index.json');
const unindexedFiles = apartmentFiles.filter(file => !index.buildings.includes(file));
for (const file of unindexedFiles) {
  const collection = JSON.parse(await fs.readFile(path.join(ROOT, 'data/apartments', file), 'utf8'));
  const property = SETTINGS.unindexedProperties.find(entry => entry.file === file);
  if (property) homes.set(property.name, { name: property.name, file: 'data/apartments/' + file, unindexed: true });
  else assert.equal(file, 'riverside-site.json', 'Classify the new unindexed apartment collection: ' + file);
  assert.ok(Array.isArray(collection.buildings), file);
}
report.snapshot = { graphSHA256: digest(graphText), graphBytes: Buffer.byteLength(graphText),
  asOf: raw.as_of, nodes: raw.n.x.length, edges: raw.e.a.length, bakedDoors: raw.d.length,
  graphCodes: Object.keys(raw.code).length, tune: raw.tune };
report.coverage = { authoredHousingSpecs: specs.length, housingQueries: homes.size,
  graphHousingNames: Object.keys(raw.wc).length, scheduleCodes: codes.length,
  routableScheduleCodes: routableCodes.size, requestedSpreadCodes: SETTINGS.codes.length,
  spreadCodes: SETTINGS.codes.filter(code => codeSet.has(code)).length, profiles: SETTINGS.profiles.length };
report.coverage.publicApartmentFilesRead = apartmentFiles.length;
report.coverage.unindexedProperties = SETTINGS.unindexedProperties;

for (const entry of codes) {
  const exact = app.wayfindSearch(entry.code).find(hit => hit.code === entry.code);
  if (!exact) flags('unresolvedCodes', { code: entry.code });
  if (!exact?.routable) flags('unroutableCodes', { code: entry.code, where: entry.where });
}
for (const home of homes.values()) {
  const hits = app.wayfindSearch(home.name);
  const exact = hits.find(hit => normalize(hit.name) === normalize(home.name));
  const entry = seam.resolve(home.name);
  const doors = exact?.routable && entry ? seam.doorSet(graph, entry, false) : [];
  if (!doors.length) flags('homesWithoutExactUsableDoor', { name: home.name, suggestion: hits[0]?.name || null });
}
for (const avoidStairs of SETTINGS.profiles) {
  for (const home of homes.values()) {
    await quietGate();
    for (const code of SETTINGS.codes.filter(value => codeSet.has(value))) {
      const meetings = [row(code)];
      const actual = await core.compare(meetings, [home], async (from, to) => {
        const begin = seam.calls.length;
        const answer = await app.wayfindStairs(from, to, { geom: true, avoidStairs });
        const capture = seam.calls.slice(begin).filter(call => call.answer.ok &&
          call.from === seam.resolve(from) && call.to === seam.resolve(to) &&
          call.answer.distM === answer.distM && !!call.answer.avoidStairs === avoidStairs).at(-1);
        const detail = { from, to, avoidStairs, baselineHome: baselineHomes.has(home.name), ok: !!answer.ok, why: answer.why || null,
          distM: answer.distM ?? null, lo: answer.lo ?? null, hi: answer.hi ?? null };
        if (!answer.ok) flags('unreachablePairs', detail);
        if (answer.ok && !capture) flags('missingRouteEvidence', detail);
        if (answer.ok && capture) {
          const measured = capture.answer;
          const selectedHome = from === home.name ? measured.from : measured.to;
          if (normalize(selectedHome.display) !== normalize(home.name)) {
            flags('wrongHomeIdentity', { ...detail, answeredFor: selectedHome.display });
          }
          const straightM = metres(answer.geom.line[0], answer.geom.line.at(-1));
          const ratio = straightM > SETTINGS.geometryToleranceM ? answer.distM / straightM : null;
          detail.straightM = straightM; detail.ratio = ratio;
          detail.fromDoor = { source: graph.doors[answer.fromDoor][5], role: graph.doors[answer.fromDoor][4] };
          detail.toDoor = { source: graph.doors[answer.toDoor][5], role: graph.doors[answer.toDoor][4] };
          detail.doorLinkM = measured.fromLinkM + measured.toLinkM;
          if (ratio !== null && (ratio < SETTINGS.ratioLow - SETTINGS.distanceToleranceM / straightM || ratio > SETTINGS.ratioHigh)) {
            flags('walkStraightRatio', detail);
          }
          if (!measured.legs.length || measured.legs.some(leg => !Array.isArray(leg.edges))) flags('straightFallbacks', detail);
          const edgeMetres = measured.legs.reduce((sum, leg) => sum + leg.edges.reduce((total, edge) => total + graph.W[edge] / 100, 0), 0);
          if (Math.abs(answer.distM - edgeMetres - detail.doorLinkM) > SETTINGS.distanceToleranceM) flags('distanceUnits', detail);
          const independent = routeMeasure(graph, measured);
          if (Object.keys(independent).some(key => Math.abs(independent[key] - (measured.m[key] || 0)) > SETTINGS.distanceToleranceM)) flags('measurementUnits', detail);
          const expectedLowS = independent.flat / raw.tune.WALK_SPEED_HIGH_MS + independent.stair / raw.tune.STAIR_SPEED_MPS +
            independent.stairSets * raw.tune.STAIR_FIXED_S + independent.signals * raw.tune.SIGNAL_WAIT_LOW_S;
          const downhill = app.WAYFIND.stairDownDiscount ? independent.stairDown : 0;
          const expectedHighS = independent.flat / raw.tune.WALK_SPEED_LOW_MS +
            (downhill + (independent.stair - downhill) * raw.tune.STAIR_UP_MULT) / raw.tune.STAIR_SPEED_MPS +
            independent.stairSets * raw.tune.STAIR_FIXED_S + independent.signals * raw.tune.SIGNAL_WAIT_HIGH_S;
          const expectedLo = Math.floor(expectedLowS / 60);
          const expectedHi = expectedHighS > 0 ? Math.max(expectedLo + 1, Math.ceil(expectedHighS / 60)) : 0;
          if (answer.lo !== expectedLo || answer.hi !== expectedHi || answer.lo > answer.hi) flags('timeUnits', detail);
          if (avoidStairs && (!answer.clean || measured.legs.some(leg => leg.edges.some(edge => graph.F[edge] & 1)))) flags('stepFreeViolations', detail);
        }
        report.routes.push(detail);
        seam.calls.length = 0;
        return answer;
      }, codeSet);
      if (actual.error) flags('scheduleRejected', { name: home.name, code, error: actual.error });
      const homeAnswer = actual.apartments?.[0];
      if (homeAnswer?.ok) {
        const legs = homeAnswer.daily.flatMap(day => day.legs);
        const sum = legs.reduce((total, leg) => total + leg.route.distM, 0);
        if (Math.abs(homeAnswer.total.distM - sum) > SETTINGS.distanceToleranceM) flags('weeklyUnits', { name: home.name, code });
      } else if (homeAnswer?.total !== null && homeAnswer) flags('missingRouteCountedAsZero', { name: home.name, code });
    }
  }
}

await quietGate();
const synthetic = syntheticGraph();
const probeGraph = decodeWalkGraph(synthetic);
const tiny = await finderRuntime({ graph: synthetic });
const tinyCodes = new Set(['SYN', 'TST']);
const fakeHome = [{ name: 'Synthetic Hall' }];
const fixtureRoute = async () => ({ ok: true, lo: 1, hi: 2, distM: 100 });
await test('probe includes both door links in distance and minutes', () => {
  const result = routeBetween(probeGraph, 'SYN', 'TST');
  assert.equal(result.metres, Math.round(96.06 + 10 + 10));
  assert.equal(result.lo, Math.floor(116.06 / 1.4 / 60));
  assert.equal(result.hi, Math.ceil(116.06 / 1.1 / 60));
});
await test('confirmation fast-time floor does not falsely rule out a faster flat path', () => {
  const alternative = syntheticGraph();
  alternative.n = { x: [-97740000, 1000, 1000], y: [30280000, 0, 0] };
  alternative.e = { a: [0, 1, -1], b: [1, 1, 2], w: [1000, 2000, 8000], f: [1, 1, 0], s: [0, 0, -1] };
  alternative.d[0][2] = [0]; alternative.d[0][3] = [0];
  alternative.d[1][2] = [2]; alternative.d[1][3] = [0];
  const answer = routeBetween(decodeWalkGraph(alternative), 'SYN', 'TST');
  assert.equal(answer.lo, Math.floor(80 / 1.4 / 60));
});
await test('confirmation floor is not inflated by an unsurveyed-link selection handicap', () => {
  const alternative = syntheticGraph(); alternative.e.w[0] = 10500;
  alternative.d[0][2] = [0, 1]; alternative.d[0][3] = [0, 3000];
  alternative.d[1][2] = [1]; alternative.d[1][3] = [0];
  const answer = routeBetween(decodeWalkGraph(alternative), 'SYN', 'TST');
  assert.equal(answer.lo, Math.floor(30 / 1.4 / 60));
});
await test('crossing penalties select a path but never become walked metres', async () => {
  const crossing = syntheticGraph(); crossing.e.f[0] = 6;
  const offline = await finderRuntime({ graph: crossing });
  const answer = await offline.app.wayfindStairs('SYN', 'TST');
  assert.equal(answer.distM, 116.06);
  assert.equal(answer.lo, Math.floor(116.06 / 1.4 / 60));
  assert.equal(answer.hi, Math.ceil((116.06 / 1.1 + 45) / 60));
  const probe = routeBetween(decodeWalkGraph(crossing), 'SYN', 'TST');
  assert.equal(probe.metres, 116); assert.equal(probe.signals, 1); assert.equal(probe.hi, answer.hi);
});
await test('split staircases cost once and known downhill changes only the slow bound', async () => {
  const stairs = syntheticGraph();
  stairs.n = { x: [-97740000, 1000, 300, 300], y: [30280000, 0, 0, 0] };
  stairs.e = { a: [0, 1, 1], b: [1, 1, 1], w: [10000, 3000, 3000], f: [0, 9, 9], s: [-1, 42, 42] };
  stairs.d[1][0] = -97738400; stairs.d[1][2] = [3];
  const offline = await finderRuntime({ graph: stairs });
  const uphill = await offline.app.wayfindStairs('SYN', 'TST'), downhill = await offline.app.wayfindStairs('TST', 'SYN');
  assert.equal(uphill.distM, 180); assert.equal(uphill.sets, 1);
  assert.equal(uphill.lo, Math.floor((120 / 1.4 + 60 / 0.5 + 4) / 60));
  assert.equal(uphill.hi, Math.ceil((120 / 1.1 + 60 * 1.35 / 0.5 + 4) / 60));
  assert.equal(downhill.hi, Math.ceil((120 / 1.1 + 60 / 0.5 + 4) / 60));
  assert.equal((await offline.app.wayfindStairs('SYN', 'TST', { avoidStairs: true })).ok, false);
  const probe = routeBetween(decodeWalkGraph(stairs), 'SYN', 'TST');
  assert.equal(probe.staircases, 1); assert.equal(probe.metres, 180); assert.equal(probe.lo, uphill.lo);
});
await test('disconnected and off-main edges never become straight-line answers', async () => {
  for (const disconnect of ['empty', 'offmain']) {
    const missing = syntheticGraph();
    if (disconnect === 'empty') missing.e = { a: [], b: [], w: [], f: [], s: [] };
    else missing.e.f[0] = 128;
    const offline = await finderRuntime({ graph: missing });
    assert.equal((await offline.app.wayfindStairs('SYN', 'TST')).ok, false);
    assert.equal(routeBetween(decodeWalkGraph(missing), 'SYN', 'TST'), null);
  }
});
await test('selected multi-anchor links appear exactly once in both routers', async () => {
  const multi = syntheticGraph();
  multi.n = { x: [-97740000, 1000, 1000], y: [30280000, 0, 0] };
  multi.e = { a: [0, 1], b: [1, 1], w: [10000, 10000], f: [0, 0], s: [-1, -1] };
  multi.d[0][2] = [0, 1]; multi.d[0][3] = [100, 2000];
  multi.d[1][0] = -97738000; multi.d[1][2] = [2]; multi.d[1][3] = [300];
  const offline = await finderRuntime({ graph: multi });
  assert.equal((await offline.app.wayfindStairs('SYN', 'TST')).distM, 123);
  const probe = routeBetween(decodeWalkGraph(multi), 'SYN', 'TST');
  assert.equal(probe.metres, 123); assert.equal(probe.linkM, 23);
});
await test('seeded small-graph searches match an independent Floyd-Warshall cost oracle', async () => {
  let state = SETTINGS.oracleSeed, checked = 0, fastChecked = 0;
  const random = maximum => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
  for (let sample = 0; sample < SETTINGS.oracleGraphs; sample++) {
    await quietGate();
    const source = syntheticGraph(), size = SETTINGS.oracleNodes;
    const edges = [];
    for (let from = 0; from < size; from++) for (let to = from + 1; to < size; to++) {
      if (random(3) === 0) continue;
      const kind = random(5), flags = kind === 0 ? 1 : kind === 1 ? 6 : kind === 2 ? 128 : 0;
      edges.push({ from, to, weight: 100 + random(9900), flags, way: flags & 1 ? random(3) : -1 });
    }
    source.n = { x: Array.from({ length: size }, (_, index) => index ? 100 : -97740000),
      y: Array.from({ length: size }, (_, index) => index ? 0 : 30280000) };
    let prior = 0;
    source.e = { a: edges.map(edge => { const delta = edge.from - prior; prior = edge.from; return delta; }),
      b: edges.map(edge => edge.to - edge.from), w: edges.map(edge => edge.weight),
      f: edges.map(edge => edge.flags), s: edges.map(edge => edge.way) };
    const decoded = tiny.seam.decode(source);
    const stairCounts = new Map();
    for (const edge of edges) if (edge.way >= 0) stairCounts.set(edge.way, (stairCounts.get(edge.way) || 0) + 1);
    const fastDistances = Array.from({ length: size }, (_, from) => Array.from({ length: size }, (_, to) => from === to ? 0 : Infinity));
    for (const edge of edges) {
      if (edge.flags & 128) continue;
      const length = edge.weight / 100;
      const seconds = (edge.flags & 1
        ? length / source.tune.STAIR_SPEED_MPS + source.tune.STAIR_FIXED_S / stairCounts.get(edge.way)
        : length / source.tune.WALK_SPEED_HIGH_MS) + (edge.flags & 4 ? source.tune.SIGNAL_WAIT_LOW_S : 0);
      fastDistances[edge.from][edge.to] = Math.min(fastDistances[edge.from][edge.to], seconds);
      fastDistances[edge.to][edge.from] = Math.min(fastDistances[edge.to][edge.from], seconds);
    }
    for (let via = 0; via < size; via++) for (let from = 0; from < size; from++) for (let to = 0; to < size; to++) {
      fastDistances[from][to] = Math.min(fastDistances[from][to], fastDistances[from][via] + fastDistances[via][to]);
    }
    for (const avoidStairs of SETTINGS.profiles) {
      const distances = Array.from({ length: size }, (_, from) => Array.from({ length: size }, (_, to) => from === to ? 0 : Infinity));
      for (const edge of edges) {
        if (edge.flags & 128 || avoidStairs && edge.flags & 1) continue;
        const length = edge.weight / 100;
        const cost = edge.flags & 1
          ? length * source.tune.WALK_SPEED_LOW_MS / source.tune.STAIR_SPEED_MPS +
            source.tune.STAIR_FIXED_S * source.tune.WALK_SPEED_LOW_MS / stairCounts.get(edge.way)
          : length + (edge.flags & 2 ? source.tune.CROSSING_PENALTY_M : 0);
        distances[edge.from][edge.to] = Math.min(distances[edge.from][edge.to], cost);
        distances[edge.to][edge.from] = Math.min(distances[edge.to][edge.from], cost);
      }
      for (let via = 0; via < size; via++) for (let from = 0; from < size; from++) for (let to = 0; to < size; to++) {
        distances[from][to] = Math.min(distances[from][to], distances[from][via] + distances[via][to]);
      }
      for (let query = 0; query < SETTINGS.oracleQueriesPerProfile; query++) {
        const seeds = Array.from({ length: 2 }, () => ({ node: random(size), c: random(3000) / 100 }));
        const targets = Array.from({ length: 2 }, () => ({ node: random(size), c: random(3000) / 100 }));
        for (const anchor of [...seeds, ...targets]) anchor.pc = anchor.c * WALKG.linkCostMult;
        const expected = Math.min(...seeds.flatMap(seed => targets.map(target => seed.pc + distances[seed.node][target.node] + target.pc)));
        const answer = tiny.seam.dijkstra(decoded, seeds, targets, avoidStairs);
        if (!Number.isFinite(expected)) assert.equal(answer, null);
        else {
          assert.ok(answer, 'A reachable oracle pair needs a graph answer');
          assert.ok(Math.abs(answer.cost - expected) < SETTINGS.distanceToleranceM, JSON.stringify({ sample, avoidStairs, expected, actual: answer.cost }));
          assert.equal(answer.nodes[0], answer.seed.node); assert.equal(answer.nodes.at(-1), answer.target.node);
        }
        checked++;
        if (!avoidStairs) {
          source.d[0][2] = seeds.map(seed => seed.node); source.d[0][3] = seeds.map(seed => Math.round(seed.c * 100));
          source.d[1][2] = targets.map(target => target.node); source.d[1][3] = targets.map(target => Math.round(target.c * 100));
          const expectedFast = Math.min(...seeds.flatMap(seed => targets.map(target =>
            (seed.c + target.c) / source.tune.WALK_SPEED_HIGH_MS + fastDistances[seed.node][target.node])));
          const probe = routeBetween(decodeWalkGraph(source), 'SYN', 'TST');
          if (!Number.isFinite(expectedFast)) assert.equal(probe, null);
          else {
            assert.ok(probe, 'A reachable fast oracle pair needs a confirmation floor');
            assert.ok(Math.abs(probe.floorS - expectedFast) < SETTINGS.timeToleranceS,
              JSON.stringify({ sample, query, expectedFast, actual: probe.floorS }));
            assert.equal(probe.lo, Math.floor(expectedFast / 60));
          }
          fastChecked++;
        }
      }
    }
  }
  report.coverage.independentSearchQueries = checked;
  report.coverage.independentConfirmationFastQueries = fastChecked;
});
await test('unknown same-code probe is not a zero-distance answer', () => assert.equal(routeBetween(probeGraph, 'ZZZ', 'ZZZ'), null));
await test('no-anchor same-code probe is unavailable', () => {
  const missing = syntheticGraph(); missing.d[0][2] = []; missing.d[0][3] = [];
  assert.equal(routeBetween(decodeWalkGraph(missing), 'SYN', 'SYN'), null);
});
await test('same-building finder leg is zero distance/time', async () => {
  const answer = await tiny.app.wayfindStairs('SYN', 'SYN', { geom: true });
  assert.equal(answer.ok, true); assert.equal(answer.distM, 0); assert.equal(answer.lo, 0); assert.equal(answer.hi, 0);
});
await test('quiet routing never treats Icon as Ion Austin', async () => assert.equal((await app.wayfindStairs('Icon', 'WEL')).ok, false));
await test('quiet routing never treats Jester West as Jester East', async () => {
  const answer = await app.wayfindStairs('Jester West Hall', 'WEL');
  assert.equal(answer.ok, true);
  assert.equal(seam.resolve('Jester West Hall').display, 'Jester West Hall');
  assert.ok(answer.fromDoor != null);
  assert.equal(graph.doors[answer.fromDoor][7], 'Jester West Hall');
});
await test('explicit class identity retains its source doorway and unavailable reasons', async () => {
  const answer = await app.wayfindStairs('ACS', 'WEL');
  assert.equal(answer.ok, true);
  assert.equal(graph.doors[answer.fromDoor][7], 'Engineering Discovery Building');
  assert.equal(graph.doors[answer.fromDoor][5], 'field');
  const absent = await app.wayfindStairs('AF1', 'WEL');
  assert.equal(absent.ok, false);
  assert.ok(absent.reason);
  assert.equal(raw.availability.AF1.cause, 'outer_footprint_without_entrance');
});
await test('quiet routing accepts exact codes and names', async () => {
  const answer = await tiny.app.wayfindStairs('Synthetic Hall', 'TST');
  assert.equal(answer.ok, true); assert.equal(answer.distM, 116.06);
});
await test('interactive suggestions remain forgiving without becoming quiet answers', async () => {
  assert.ok(app.wayfindSearch('Icon').some(hit => hit.name === 'Ion Austin'));
  assert.equal((await app.wayfindStairs('Welch', 'PCL')).ok, false);
  assert.equal((await app.wayfindStairs(app.wayfindSearch('WEL')[0].name, 'PCL')).ok, true);
});
await test('finder rejects an inverted minute range', async () => {
  const answer = await tiny.core.compare([row('TST')], fakeHome, async () => ({ ok: true, lo: 8, hi: 3, distM: 100 }), tinyCodes);
  assert.equal(answer.complete, false); assert.equal(answer.apartments[0].total, null);
});
await test('invalid imported weekdays require review rather than silent deletion', () => {
  const imported = core.imported({ events: [{ ...row('WEL', 600, 650, ['MO', 'INVALID']), confidence: 1 }] });
  assert.equal(imported[0].needsReview, true);
});
await test('structured intake does not hide an invalid weekday before finder import', async () => {
  const schedule = await tiny.app.wayfindScheduleFrom([
    { location: 'TST 1.100', days: ['MO', 'INVALID'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' });
  assert.equal(tiny.core.imported(schedule)[0].needsReview, true);
});
await test('malformed imported day fields stay reviewable without throwing', () => {
  const imported = core.imported({ events: [{ ...row('WEL'), days: 'MO' }] });
  assert.equal(imported[0].needsReview, true);
});
await test('explicit imported review state is not erased', () => {
  assert.equal(core.imported({ events: [{ ...row('WEL'), needsReview: true }] })[0].needsReview, true);
});
await test('missing routes suppress totals and ranking', async () => {
  const answer = await core.compare([row('WEL')], fakeHome, async () => ({ ok: false, why: 'noroute' }), codeSet);
  assert.equal(answer.complete, false); assert.equal(answer.apartments[0].total, null);
});
await test('weekly totals count each weekday exactly once', async () => {
  const answer = await core.compare([row('WEL', 600, 650, ['MO', 'WE', 'FR'])], fakeHome, fixtureRoute, codeSet);
  assert.equal(answer.apartments[0].total.distM, 600); assert.equal(answer.apartments[0].total.lo, 6);
});
await test('schedule row and weekday order do not change answers', async () => {
  const meetings = [row('WEL', 600, 650, ['WE', 'MO']), row('PCL', 720, 770, ['MO', 'WE'])];
  const forward = await core.compare(meetings, fakeHome, fixtureRoute, codeSet);
  const reverse = await core.compare([...meetings].reverse().map(meeting => ({ ...meeting, days: [...meeting.days].reverse() })), fakeHome, fixtureRoute, codeSet);
  same(forward.apartments.map(home => home.total), reverse.apartments.map(home => home.total));
  same(forward.shared, reverse.shared);
});
await test('actual preview totals do not depend on schedule, weekday or apartment input order', async () => {
  const meetings = [row('WEL', 600, 650, ['MO', 'WE', 'FR']), row('PCL', 720, 770, ['MO', 'WE', 'FR']),
    row('GDC', 840, 890, ['TU', 'TH'])];
  const previewHomes = ['The Standard', 'Union on 24th', 'Villas on Rio'].map(name => ({ name }));
  const reversed = [...meetings].reverse().map(meeting => ({ ...meeting, days: [...meeting.days].reverse() }));
  for (const avoidStairs of SETTINGS.profiles) {
    await quietGate();
    const forwardRuntime = await finderRuntime({ graph: raw }), reverseRuntime = await finderRuntime({ graph: raw });
    const forward = await forwardRuntime.core.compare(meetings, previewHomes,
      (from, to) => forwardRuntime.app.wayfindStairs(from, to, { avoidStairs }), codeSet);
    const reverse = await reverseRuntime.core.compare(reversed, [...previewHomes].reverse(),
      (from, to) => reverseRuntime.app.wayfindStairs(from, to, { avoidStairs }), codeSet);
    const totals = result => result.apartments.map(home => [home.home.name, home.total]).sort((left, right) => left[0].localeCompare(right[0]));
    assert.equal(forward.complete, true); assert.equal(reverse.complete, true);
    same(totals(forward), totals(reverse)); same(forward.shared, reverse.shared);
  }
});
await test('synthetic picked rows and typed rows agree', async () => {
  const typed = await app.wayfindParseSchedule('WEL 2.224 MWF 10:00am-10:50am\nGDC 2.302 TTh 11:00am-12:15pm', { kind: 'rows' });
  const picked = await app.wayfindScheduleFrom([
    { location: 'WEL 2.224', days: ['MO', 'WE', 'FR'], startMin: 600, endMin: 650 },
    { location: 'GDC 2.302', days: ['TU', 'TH'], startMin: 660, endMin: 735 },
  ], { kind: 'synthetic' });
  const fields = event => ({ code: event.code, days: event.days, startMin: event.startMin, endMin: event.endMin });
  same(typed.events.map(fields), picked.events.map(fields));
});
await test('every catalog apartment answer survives reversed meeting and apartment input order', async () => {
  const meetings = [row('WEL', 600, 650, ['MO', 'WE', 'FR']),
    row('PCL', 720, 770, ['MO', 'WE', 'FR']), row('GDC', 840, 890, ['TU', 'TH'])];
  const reversed = [...meetings].reverse().map(meeting => ({ ...meeting, days: [...meeting.days].reverse() }));
  const apartments = [...homes.values()];
  const answers = result => result.apartments.map(apartment => ({
    name: apartment.home.name, ok: apartment.ok, total: apartment.total,
    daily: apartment.daily.map(day => ({ day: day.day, legs: day.legs.map(leg => ({
      from: leg.from, to: leg.to, ok: leg.route.ok, why: leg.route.why || null,
      distM: leg.route.distM, lo: leg.route.lo, hi: leg.route.hi,
    })) })),
  })).sort((left, right) => left.name.localeCompare(right.name));
  let compared = 0;
  for (const avoidStairs of SETTINGS.profiles) {
    await quietGate();
    const forwardRuntime = await finderRuntime({ graph: raw }), reverseRuntime = await finderRuntime({ graph: raw });
    const route = target => async (from, to) => {
      await quietGate();
      const answer = await target.app.wayfindStairs(from, to, { avoidStairs });
      target.seam.calls.length = 0;
      return answer;
    };
    const forward = await forwardRuntime.core.compare(meetings, apartments, route(forwardRuntime), codeSet);
    const reverse = await reverseRuntime.core.compare(reversed, [...apartments].reverse(), route(reverseRuntime), codeSet);
    same(answers(forward), answers(reverse)); same(forward.shared, reverse.shared);
    assert.equal(forward.complete, reverse.complete);
    compared += apartments.length;
  }
  report.coverage.orderComparedApartments = compared;
});
await test('invalid typed clock fields cannot become valid class times', async () => {
  for (const times of ['10:99am-12:00pm', '25:00-26:00', '0:00pm-1:00pm', '10:00am-10:99am']) {
    const parsed = await tiny.app.wayfindParseSchedule('TST 1.100 MWF ' + times, { kind: 'rows' });
    assert.notEqual(tiny.core.validate(tiny.core.imported(parsed), tinyCodes), '', times);
  }
});
await test('unknown trailing typed locations cannot be replaced by a known course-shaped code', async () => {
  for (const text of ['ART 302 ZZZ 1.100 MWF 10:00am-10:50am',
    'BIO 311C ZZZ 1.100 TTh 11:00am-12:15pm']) {
    const parsed = await app.wayfindParseSchedule(text, { kind: 'rows' });
    assert.equal(core.imported(parsed)[0].needsReview, true, text);
    assert.match(core.validate(core.imported(parsed), codeSet), /review/, text);
    const imported = seam.impResultFrom({ rows: parsed.events.map(seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = seam.schedulePublished(seam.normaliseSchedule(seam.impStoreDoc(imported)));
    assert.equal(core.imported(restored)[0].needsReview, true, text);
  }
  for (const [text, code] of [['MAI 220 TTh 2:00pm-3:30pm', 'MAI'],
    ['ART 302 WEL 2.224 MWF 10:00am-10:50am', 'WEL'],
    ['WEL 2.224 MWF 10:00am-10:50am', 'WEL']]) {
    const parsed = await app.wayfindParseSchedule(text, { kind: 'rows' });
    assert.equal(parsed.events[0].code, code);
    assert.equal(core.imported(parsed)[0].needsReview, false, text);
  }
});
await test('invalid structured and synthetic-photo minutes are not normalized into valid times', async () => {
  for (const start of ['10:99', '0:00pm', '25:00']) {
    const parsed = await tiny.app.wayfindScheduleFrom([
      { location: 'TST 1.100', days: ['MO'], start, end: '16:00' },
    ], { kind: 'synthetic' });
    assert.notEqual(tiny.core.validate(tiny.core.imported(parsed), tinyCodes), '', start);
  }
  const photo = tiny.seam.impRowFromRead({ building: 'TST', room: '1.100', day: 'Mon',
    start: '10:99', end: '12:30', needsConfirm: false }, 1);
  assert.equal(photo.startMin, null);
});
await test('structured HH:mm clocks keep their 24-hour meaning', async () => {
  for (const [start, expected] of [['00:30', 30], ['01:00', 60], ['02:00', 120], ['06:00', 360],
    ['12:30', 750], ['14:00', 840], ['2:00pm', 840]]) {
    const parsed = await tiny.app.wayfindScheduleFrom([
      { location: 'TST 1.100', days: ['MO'], start, end: '15:30' },
    ], { kind: 'synthetic' });
    assert.equal(parsed.events[0].startMin, expected, start);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, false, start);
  }
  const typed = await tiny.app.wayfindParseSchedule('TST 1.100 MWF 2:00-3:00', { kind: 'rows' });
  assert.equal(typed.events[0].startMin, 840);
});
await test('every advertised schedule code resolves unchanged from a synthetic room', async () => {
  for (const entry of codes) {
    const schedule = await app.wayfindScheduleFrom([
      { location: entry.code + ' 1.100', days: ['MO'], startMin: 600, endMin: 650 },
    ], { kind: 'synthetic' });
    assert.equal(schedule.events[0]?.code, entry.code, entry.code);
    assert.equal(schedule.events[0]?.resolved?.status, 'ok', entry.code);
  }
});
await test('the public UT building register has no missing schedule codes', async () => {
  const register = JSON.parse(await fs.readFile(path.join(ROOT, 'data/ut_buildings.json'), 'utf8'));
  assert.equal(register.buildings.filter(building => !codeSet.has(building.ref)).length, 0);
});
await test('same-building outdoor zero keeps geometry in both walking profiles', async () => {
  for (const avoidStairs of SETTINGS.profiles) {
    const answer = await tiny.app.wayfindStairs('SYN', 'SYN', { geom: true, avoidStairs });
    assert.equal(answer.distM, 0); assert.equal(answer.hi, 0);
    assert.equal(answer.geom.line.length, 1);
    assert.equal(answer.geom.startLeg, null); assert.equal(answer.geom.endLeg, null);
  }
});
await test('same-building requests without doors are unavailable, not zero', async () => {
  const missing = syntheticGraph(); missing.d[0][2] = []; missing.d[0][3] = [];
  const offline = await finderRuntime({ graph: missing });
  assert.equal((await offline.app.wayfindStairs('SYN', 'SYN')).ok, false);
});
await test('an explicit via stop is not erased by same-building zero handling', async () => {
  const via = syntheticGraph(); via.poi = [[-97739000, 30280000, 1, 'cafe', 'Synthetic stop', '']];
  const offline = await finderRuntime({ graph: via });
  const entry = offline.seam.resolve('SYN');
  const answer = offline.seam.computeRoute(offline.graph, entry, entry, { via: 0 });
  assert.equal(answer.ok, true); assert.equal(answer.distM, 2 * 96.06 + 20);
  assert.equal(answer.legs.length, 2);
});
await test('synthetic calendar timezone and room resolve correctly', async () => {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:synthetic-event',
    'DTSTART;TZID=America/Chicago:20260928T100000', 'DTEND;TZID=America/Chicago:20260928T105000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'LOCATION:WEL 2.224', 'SUMMARY:Synthetic class',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const answer = await app.wayfindParseSchedule(ics);
  same(answer.events.map(event => ({ code: event.code, room: event.room, days: event.days, startMin: event.startMin, endMin: event.endMin })),
    [{ code: 'WEL', room: '2.224', days: ['MO', 'WE', 'FR'], startMin: 600, endMin: 650 }]);
});
await test('synthetic OCR words keep course and building separate', () => {
  const word = (text, x0, y0) => ({ text, x0, x1: x0 + 35, y0, y1: y0 + 12, conf: 95 });
  const location = locFromWords([word('BIO', 0, 0), word('301', 40, 0), word('WEL', 0, 20), word('2.224', 40, 20)], codeSet);
  assert.equal(location.code, 'WEL'); assert.equal(location.room, '2.224');
});
await test('synthetic photo confirmation keeps unknown walking pairs silent', () => {
  const classes = [
    { course: 'Synthetic A', building: 'WEL', room: '2.224', day: 'Mon', start: '10:00', end: '10:50' },
    { course: 'Synthetic B', building: 'PCL', room: '1.100', day: 'Mon', start: '11:00', end: '11:50' },
  ].map(meeting => ({ ...meeting, ev: { flags: { knownCode: true },
    conf: { building: 99, room: 99, day: 99, time: 99 }, from: { day: 'column', time: 'axis' } } }));
  const silent = review({ classes }, { routeMinutes: () => null });
  const throws = review({ classes }, { routeMinutes: () => { throw new Error('synthetic outage'); } });
  const tight = review({ classes }, { routeMinutes: () => 20 });
  const tightNotes = result => result.classes.flatMap(meeting => Object.values(meeting.score.notes).flat()).filter(note => /walk|minute|gap/i.test(note));
  same(tightNotes(silent), tightNotes(throws));
  assert.ok(tightNotes(tight).length > tightNotes(silent).length);
  const accepted = applyConfirmed(silent);
  assert.equal(accepted.classes.length, 2);
});
await test('synthetic photo adapter matches picked rows and preserves unchecked fields', async () => {
  const reading = { course: 'Synthetic class', building: 'WEL', room: '2.224',
    days: ['Mon', 'Wed', 'Fri'], start: '10:00', end: '10:50', confirmed: false, needsConfirm: false };
  const clean = seam.impRowFromRead(reading, 1);
  same(clean.days, ['MO', 'WE', 'FR']); assert.equal(clean.confidence, 1);
  const schedule = await app.wayfindScheduleFrom([clean], { kind: 'synthetic' });
  same(core.imported(schedule), [{ ...row('WEL', 600, 650, ['MO', 'WE', 'FR']), needsReview: false }]);
  const unchecked = seam.impRowFromRead({ ...reading, needsConfirm: true, unconfirmedFields: ['building'] }, 1);
  const uncertain = await app.wayfindScheduleFrom([unchecked], { kind: 'synthetic' });
  assert.equal(core.imported(uncertain)[0].needsReview, true);
  assert.equal('course' in core.imported(schedule)[0], false);
});
await test('synthetic photo adapter keeps invalid weekdays marked for review', async () => {
  const reading = { building: 'WEL', room: '2.224', days: ['Mon', 'INVALID'],
    start: '10:00', end: '10:50', needsConfirm: false };
  const schedule = await app.wayfindScheduleFrom([seam.impRowFromRead(reading, 1)], { kind: 'synthetic' });
  assert.equal(core.imported(schedule)[0].needsReview, true);
});
await test('parsed schedule warnings remain reviewable after the real storage adapters', async () => {
  const schedule = await app.wayfindScheduleFrom([
    { location: 'Welch', days: ['MO'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' });
  assert.equal(core.imported(schedule)[0].needsReview, true);
  const result = seam.impResultFrom({ rows: schedule.events.map(seam.impRowFromEvent),
    events: schedule.events, parsed: schedule, decoder: 'synthetic' }, 'ut', 'text');
  const restored = seam.schedulePublished(seam.normaliseSchedule(seam.impStoreDoc(result)));
  assert.equal(core.imported(restored)[0].needsReview, true);
});
await test('explicit review state persists without copying raw text and clears after confirmation', async () => {
  const offline = await finderRuntime({ graph: syntheticGraph() });
  const store = offline.app.WAYFIND.store;
  const saved = store.save({ classes: [{ ...row('TST'), needsReview: true, raw: 'Synthetic omitted field' }] });
  assert.equal(saved.ok, true);
  const document = store.load();
  assert.equal(document.classes[0].needsReview, true);
  assert.equal('raw' in document.classes[0], false);
  const corrected = store.correct(store.keyOf(document.classes[0]), {});
  assert.equal(corrected.ok, true);
  assert.equal(core.imported(offline.app.wayfindSchedule)[0].needsReview, false);
});
await test('a corrected missing building is re-placed using the new code', async () => {
  const missing = await finderRuntime({ graph: syntheticGraph() });
  const store = missing.app.WAYFIND.store;
  store.save({ classes: [{ ...row(null), room: '1.100', unroutableWhy: 'nolocation', confidence: 0.8 }] });
  const meeting = store.load().classes[0];
  const corrected = store.correct(store.keyOf(meeting), { code: 'TST' });
  assert.equal(corrected.ok, true);
  assert.equal(corrected.status, 'ok');
  assert.equal(store.load().classes[0].unroutableWhy, null);
  assert.equal(core.imported(missing.app.wayfindSchedule)[0].needsReview, false);
});
await test('import does not erase meetings with different end times based on row order', async () => {
  const meetings = [
    { location: 'TST 1.100', days: ['MO'], startMin: 600, endMin: 650, start: '10:00', end: '10:50' },
    { location: 'TST 1.100', days: ['MO'], startMin: 600, endMin: 710, start: '10:00', end: '11:50' },
  ];
  const forward = tiny.seam.impResultFrom({ rows: meetings, decoder: 'synthetic' }, 'ut', 'text');
  const reverse = tiny.seam.impResultFrom({ rows: [...meetings].reverse(), decoder: 'synthetic' }, 'ut', 'text');
  const ends = result => result.events.map(event => event.endMin).sort((left, right) => left - right);
  same(ends(forward), [650, 710]); same(ends(reverse), [650, 710]);
  assert.match(tiny.core.validate(tiny.core.imported(forward), tinyCodes), /overlap/);
});
await test('numeric-only imports preserve distinct meetings and de-duplicate exact repeats', async () => {
  const first = { location: 'TST 1.100', days: ['MO', 'WE'], startMin: 600, endMin: 650 };
  const second = { ...first, startMin: 720, endMin: 770 };
  const result = tiny.seam.impResultFrom({ rows: [first, second, { ...first, days: ['WE', 'MO'] }], decoder: 'synthetic' }, 'ut', 'text');
  same(result.events.map(event => event.startMin), [600, 720]);
});
await test('a clean duplicate never silently overwrites an unchecked import', async () => {
  const meeting = { location: 'TST 1.100', days: ['MO'], startMin: 600, endMin: 650 };
  for (const rows of [[meeting, { ...meeting, needsReview: true }], [{ ...meeting, needsReview: true }, meeting]]) {
    const result = tiny.seam.impResultFrom({ rows, decoder: 'synthetic' }, 'ut', 'text');
    const stored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(result)));
    assert.ok(tiny.core.imported(stored).some(event => event.needsReview));
  }
});
await test('explicit review state survives live structured and fallback import adapters', async () => {
  const meeting = { location: 'TST 1.100', days: ['MO'], startMin: 600, endMin: 650, needsReview: true };
  const direct = await tiny.app.wayfindScheduleFrom([meeting], { kind: 'synthetic' });
  assert.equal(tiny.core.imported(direct)[0].needsReview, true);
  const fallback = tiny.seam.impResultFrom({ rows: [meeting], decoder: 'synthetic' }, 'ut', 'text');
  assert.equal(tiny.core.imported(fallback)[0].needsReview, true);
});
await test('invalid weekday prefixes are not silently converted into valid structured weekdays', async () => {
  const schedule = await tiny.app.wayfindScheduleFrom([
    { location: 'TST 1.100', days: ['MOON'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' });
  assert.equal(tiny.core.imported(schedule)[0].needsReview, true);
});
await test('named structured weekdays remain supported without prefix guessing', async () => {
  const schedule = await tiny.app.wayfindScheduleFrom([
    { location: 'TST 1.100', days: ['Monday', 'Wed', 'FR'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' });
  same(tiny.core.imported(schedule)[0].days, ['MO', 'WE', 'FR']);
  assert.equal(tiny.core.imported(schedule)[0].needsReview, false);
});
await test('unsupported calendar recurrence stays reviewable before weekly comparison and after reload', async () => {
  for (const rule of ['FREQ=WEEKLY;BYDAY=MO,XX', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    'FREQ=DAILY', 'FREQ=MONTHLY;BYDAY=1MO']) {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
      'DTSTART;TZID=America/Chicago:20260928T100000', 'DTEND;TZID=America/Chicago:20260928T105000',
      'RRULE:' + rule, 'LOCATION:TST 1.100', 'SUMMARY:Synthetic class', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const parsed = await tiny.app.wayfindParseSchedule(ics);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, rule);
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, rule);
  }
});
await test('a date-specific calendar event is not silently promoted to a recurring week', async () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/Chicago:20260928T100000',
    'DTEND;TZID=America/Chicago:20260928T105000', 'LOCATION:TST 1.100', 'SUMMARY:Synthetic one-off',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const parsed = await tiny.app.wayfindParseSchedule(ics);
  assert.equal(tiny.core.imported(parsed)[0].needsReview, true);
});
await test('foreign-zone wall times require review rather than being ranked as campus-local times', async () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/New_York:20260928T110000',
    'DTEND;TZID=America/New_York:20260928T115000', 'RRULE:FREQ=WEEKLY;BYDAY=MO',
    'LOCATION:TST 1.100', 'SUMMARY:Synthetic timezone class', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const parsed = await tiny.app.wayfindParseSchedule(ics);
  assert.equal(tiny.core.imported(parsed)[0].needsReview, true);
});
await test('UTC recurrence crossing a local day boundary requires weekday review', async () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20260928T003000Z', 'DTEND:20260928T012000Z',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'LOCATION:TST 1.100', 'SUMMARY:Synthetic timezone class',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const parsed = await tiny.app.wayfindParseSchedule(ics);
  assert.equal(tiny.core.imported(parsed)[0].needsReview, true);
});
await test('calendar end times in another zone or on another date require review', async () => {
  for (const end of ['DTEND;TZID=America/New_York:20260928T120000',
    'DTEND;TZID=America/Chicago:20260929T110000']) {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/Chicago:20260928T100000',
      end, 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'LOCATION:TST 1.100',
      'SUMMARY:Synthetic end boundary', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const parsed = await tiny.app.wayfindParseSchedule(ics);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, end);
    const placed = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'parser' }, 'ut', 'text');
    tiny.app.WAYFIND.store.save(tiny.seam.impStoreDoc(placed));
    assert.equal(tiny.core.imported(tiny.app.wayfindSchedule)[0].needsReview, true, end);
  }
});
await test('invalid calendar recurrence limits cannot become clean indefinite weekly classes', async () => {
  for (const limit of ['COUNT=0', 'COUNT=-2', 'COUNT=10garbage', 'UNTIL=INVALID',
    'UNTIL=20260101T000000']) {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/Chicago:20260928T100000',
      'DTEND;TZID=America/Chicago:20260928T105000', 'RRULE:FREQ=WEEKLY;BYDAY=MO;' + limit,
      'LOCATION:TST 1.100', 'SUMMARY:Synthetic recurrence limit',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const parsed = await tiny.app.wayfindParseSchedule(ics);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, limit);
  }
});
await test('malformed or contradictory recurrence tokens require review', async () => {
  for (const rule of ['FREQ=WEEKLY;BYDAY=MO;BROKEN',
    'FREQ=WEEKLY;BYDAY=MO;FREQ=DAILY;FREQ=WEEKLY',
    'FREQ=WEEKLY;BYDAY=MO;COUNT=1e2', 'FREQ=WEEKLY;BYDAY=MO;INTERVAL=0x1',
    'FREQ=WEEKLY;BYDAY=MO;WKST=BAD', 'FREQ=WEEKLY;BYDAY=MO;COUNT=10;UNTIL=20261201T000000']) {
    const parsed = await tiny.app.wayfindParseSchedule(['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
      'DTSTART;TZID=America/Chicago:20260928T100000', 'DTEND;TZID=America/Chicago:20260928T105000',
      'RRULE:' + rule, 'LOCATION:TST 1.100', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, rule);
  }
  const valid = await tiny.app.wayfindParseSchedule(['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'DTSTART;TZID=America/Chicago:20260928T100000', 'DTEND;TZID=America/Chicago:20260928T105000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=1;COUNT=12;WKST=MO', 'LOCATION:TST 1.100',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  assert.equal(tiny.core.imported(valid)[0].needsReview, false);
});
await test('calendar exceptions and cancellations cannot silently become an ordinary recurring week', async () => {
  for (const extra of ['EXDATE;TZID=America/Chicago:20261005T100000',
    'RECURRENCE-ID;TZID=America/Chicago:20260928T100000',
    'RDATE;TZID=America/Chicago:20260929T100000', 'STATUS:CANCELLED']) {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/Chicago:20260928T100000',
      'DTEND;TZID=America/Chicago:20260928T105000', 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'LOCATION:TST 1.100', 'SUMMARY:Synthetic exception', extra, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const parsed = await tiny.app.wayfindParseSchedule(ics);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, extra);
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    tiny.app.WAYFIND.store.save(tiny.seam.impStoreDoc(imported));
    assert.equal(tiny.core.imported(tiny.app.wayfindSchedule)[0].needsReview, true, extra);
  }
  const confirmed = await tiny.app.wayfindParseSchedule(['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'DTSTART;TZID=America/Chicago:20260928T100000', 'DTEND;TZID=America/Chicago:20260928T105000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'STATUS:CONFIRMED', 'LOCATION:TST 1.100',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  assert.equal(tiny.core.imported(confirmed)[0].needsReview, false);
});
await test('duplicate calendar answer fields cannot select different clean answers by property order', async () => {
  const original = ['DTSTART;TZID=America/Chicago:20260928T100000',
    'DTEND;TZID=America/Chicago:20260928T105000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'LOCATION:TST 1.100'];
  for (const extra of ['DTSTART;TZID=America/Chicago:20260928T110000',
    'DTEND;TZID=America/Chicago:20260928T115000', 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'LOCATION:SYN 1.100']) {
    for (const fields of [[...original, extra], [extra, ...original]]) {
      const parsed = await tiny.app.wayfindParseSchedule(['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
        ...fields, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
      assert.equal(tiny.core.imported(parsed)[0].needsReview, true, fields.join(';'));
      const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
        events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
      const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
      assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + extra);
    }
  }
});
await test('incomplete or mismatched calendar envelopes cannot publish a clean partial week', async () => {
  const fields = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;TZID=America/Chicago:20260928T100000',
    'DTEND;TZID=America/Chicago:20260928T105000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'LOCATION:TST 1.100', 'END:VEVENT'];
  for (const ending of [[], ['END:VALARM'], ['END:VALARM', 'END:VCALENDAR']]) {
    const parsed = await tiny.app.wayfindParseSchedule([...fields, ...ending].join('\r\n'));
    assert.ok(parsed.events.length, 'Keep usable rows visible for correction');
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, ending.join(';'));
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + ending.join(';'));
  }
  const ordinary = await tiny.app.wayfindParseSchedule([...fields, 'END:VCALENDAR'].join('\r\n'));
  assert.equal(tiny.core.imported(ordinary)[0].needsReview, false);
  const nested = await tiny.app.wayfindParseSchedule(['BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE',
    'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'END:STANDARD', 'END:VTIMEZONE',
    ...fields.slice(1, -1), 'BEGIN:VALARM', 'DESCRIPTION:Synthetic alarm', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  assert.equal(tiny.core.imported(nested)[0].needsReview, false);
  assert.equal(nested.events[0].startMin, 600);
});
await test('structured exceptions and failed source readings remain reviewable', async () => {
  for (const extra of [{ exDates: ['2026-10-05'] }, { status: 'failed' }, { status: 'cancelled' }]) {
    const parsed = await tiny.app.wayfindScheduleFrom([
      { location: 'TST 1.100', days: ['MO'], startMin: 600, endMin: 650, ...extra },
    ], { kind: 'synthetic' });
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, JSON.stringify(extra));
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    tiny.app.WAYFIND.store.save(tiny.seam.impStoreDoc(imported));
    assert.equal(tiny.core.imported(tiny.app.wayfindSchedule)[0].needsReview, true, JSON.stringify(extra));
  }
});
await test('unknown synthetic building never resolves to an existing code', async () => {
  const answer = await app.wayfindScheduleFrom([{ location: 'ZZZ 1.100', days: ['MO'], startMin: 600, endMin: 650 }]);
  assert.ok(answer.events.every(event => event.resolved?.status !== 'ok'));
});
await test('conflicting building evidence in one location cannot silently pick one identity', async () => {
  for (const location of ['TST 1.100 (SYN)', 'TST 1.100\nSYN 1.100',
    'Test Hall (TST) (SYN)', 'Test Hall (TST)\nSYN 1.100']) {
    const parsed = await tiny.app.wayfindScheduleFrom([{ location, ...row('TST') }]);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, location);
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + location);
    const calendar = await tiny.app.wayfindParseSchedule(['BEGIN:VCALENDAR', 'BEGIN:VEVENT',
      'DTSTART;TZID=America/Chicago:20260928T100000', 'DTEND;TZID=America/Chicago:20260928T105000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO', 'LOCATION:' + location.replace(/\n/g, '\\n'),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
    assert.equal(tiny.core.imported(calendar)[0].needsReview, true, 'calendar ' + location);
  }
  for (const location of ['Test Hall (TST), Austin, TX', 'Test Hall (TST)\nTST 1.100', 'TST 1.100 (TST)']) {
    const parsed = await tiny.app.wayfindScheduleFrom([{ location, ...row('TST') }]);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, false, location);
    assert.equal(parsed.events[0].code, 'TST');
  }
});
await test('invalid confidence cannot become a clean answer through intake or saved reload', async () => {
  for (const confidence of [NaN, Infinity, 'bad', -1, 2]) {
    const meeting = { location: 'TST 1.100', days: ['MO'], startMin: 600, endMin: 650, confidence };
    const parsed = await tiny.app.wayfindScheduleFrom([meeting], { kind: 'synthetic' });
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, String(confidence));
    const direct = tiny.core.imported({ events: [{ ...row('TST'), confidence }] });
    assert.equal(direct[0].needsReview, true, 'direct ' + String(confidence));
    const imported = tiny.seam.impResultFrom({ rows: [meeting], decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + String(confidence));
    const saved = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule({ classes: [{ ...row('TST'), confidence }] }));
    assert.equal(tiny.core.imported(saved)[0].needsReview, true, 'stored input ' + String(confidence));
  }
  for (const confidence of [undefined, null, 1]) {
    const parsed = await tiny.app.wayfindScheduleFrom([{ location: 'TST 1.100', ...row('TST'), confidence }]);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, false, String(confidence));
  }
});
await test('structured source problems cannot be discarded by the live reader', async () => {
  const meeting = { location: 'TST 1.100', ...row('TST'), problems: [{ level: 'warning', code: 'SYNTHETIC' }] };
  const parsed = await tiny.app.wayfindScheduleFrom([meeting], { kind: 'synthetic' });
  assert.equal(tiny.core.imported(parsed)[0].needsReview, true);
  const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
    events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
  const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
  assert.equal(tiny.core.imported(restored)[0].needsReview, true);
});
await test('multiple competing clock readings cannot silently choose the first time', async () => {
  for (const times of [{ start: '10:00 11:00', end: '12:00' },
    { start: '10:00', end: '11:00 12:00' }]) {
    const parsed = await tiny.app.wayfindScheduleFrom([{ location: 'TST 1.100', days: ['MO'], ...times }]);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, JSON.stringify(times));
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + JSON.stringify(times));
  }
  const typed = await tiny.app.wayfindParseSchedule('TST 1.100 M 10:00-10:50 11:00');
  assert.equal(tiny.core.imported(typed)[0].needsReview, true, 'typed third clock');
  const ordinary = await tiny.app.wayfindParseSchedule('TST 1.100 M 10:00-10:50');
  assert.equal(tiny.core.imported(ordinary)[0].needsReview, false);
});
await test('structured numeric minutes do not coerce malformed values into clean times', async () => {
  for (const value of ['', ' ', false, [], [600], { value: 600 }, NaN, Infinity]) {
    for (const field of ['startMin', 'endMin']) {
      const parsed = await tiny.app.wayfindScheduleFrom([{ location: 'TST 1.100',
        ...row('TST'), [field]: value }]);
      assert.equal(tiny.core.imported(parsed)[0].needsReview, true, field + ': ' + String(value));
      const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
        events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
      const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
      assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + field + ': ' + String(value));
    }
  }
  for (const startMin of [0, 600, '600']) {
    const parsed = await tiny.app.wayfindScheduleFrom([{ location: 'TST 1.100', ...row('TST'), startMin }]);
    assert.equal(parsed.events[0].startMin, Number(startMin));
    assert.equal(tiny.core.imported(parsed)[0].needsReview, false);
  }
});
await test('structured minute and clock fields cannot hide contradictory evidence', async () => {
  for (const extra of [{ start: '13:00' }, { end: '12:00' }, { start: 'bad' }, { end: '10:50 12:00' }]) {
    const parsed = await tiny.app.wayfindScheduleFrom([{ location: 'TST 1.100', ...row('TST'), ...extra }]);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, JSON.stringify(extra));
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + JSON.stringify(extra));
  }
  const consistent = await tiny.app.wayfindScheduleFrom([{ location: 'TST 1.100', ...row('TST'),
    start: '10:00', end: '10:50' }]);
  assert.equal(tiny.core.imported(consistent)[0].needsReview, false);
});
await test('typed competing weekday patterns cannot silently discard part of the week', async () => {
  for (const pattern of ['MWF TTH', 'TTH MWF', 'M TTH', 'MWF F']) {
    const parsed = await tiny.app.wayfindParseSchedule('TST 1.100 ' + pattern + ' 10:00-10:50');
    assert.equal(tiny.core.imported(parsed)[0].needsReview, true, pattern);
    const imported = tiny.seam.impResultFrom({ rows: parsed.events.map(tiny.seam.impRowFromEvent),
      events: parsed.events, parsed, decoder: 'synthetic' }, 'ut', 'text');
    const restored = tiny.seam.schedulePublished(tiny.seam.normaliseSchedule(tiny.seam.impStoreDoc(imported)));
    assert.equal(tiny.core.imported(restored)[0].needsReview, true, 'reload ' + pattern);
  }
  for (const text of ['TST 1.100 MWF MWF 10:00-10:50', 'M 340L TST 1.100 TTH 10:00-10:50',
    'C S 429 TST 1.100 MWF 10:00-10:50']) {
    const parsed = await tiny.app.wayfindParseSchedule(text);
    assert.equal(tiny.core.imported(parsed)[0].needsReview, false, text);
  }
});
await test('route exceptions never turn into successful zero-distance answers', async () => {
  const answer = await core.compare([row('WEL')], fakeHome, async () => { throw new Error('synthetic failure'); }, codeSet);
  assert.equal(answer.complete, false); assert.equal(answer.apartments[0].total, null);
});

const probeReal = decodeWalkGraph(raw);
for (const from of ['WEL', 'PCL', 'GDC', 'UTC', 'MAI', 'BUR']) for (const to of ['WEL', 'PCL', 'GDC', 'UTC', 'MAI', 'BUR']) {
  if (from === to) continue;
  const answer = routeBetween(probeReal, from, to);
  if (!answer) continue;
  const sourceLinks = raw.code[from].flatMap(door => raw.d[door][3]).map(cm => cm / 100);
  const targetLinks = raw.code[to].flatMap(door => raw.d[door][3]).map(cm => cm / 100);
  if (Math.abs(answer.metres - Math.round(answer.flat + answer.stair)) > SETTINGS.distanceToleranceM) flags('probeDistanceUnits', { from, to });
  const minimumLinks = Math.min(...sourceLinks) + Math.min(...targetLinks);
  if (!answer.linkM || answer.linkM < minimumLinks - SETTINGS.distanceToleranceM) flags('probeDoorLinksMissing', { from, to, minimumLinks });
}
await test('probe pair request order is deterministic', () => {
  const forwardGraph = decodeWalkGraph(raw), reverseGraph = decodeWalkGraph(raw);
  const forward = routeBetween(forwardGraph, 'WEL', 'PCL');
  routeBetween(reverseGraph, 'PCL', 'WEL');
  const reverse = routeBetween(reverseGraph, 'WEL', 'PCL');
  same(forward, reverse);
});
await test('confirmation includes the application survey-door anchors and stays below actual route time', async () => {
  const savedFetch = globalThis.fetch;
  releaseWalkGraph();
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => raw });
    const actualRuntime = await finderRuntime({ graph: raw });
    const probe = await walkProbe({ doorsForCode: code => actualRuntime.app.wayfindDoors(code, false),
      codes: (await actualRuntime.app.wayfindScheduleCodes()).map(entry => entry.code) });
    let checked = 0, comparable = 0;
    const failures = [];
    const campusCodes = ['WEL', 'PCL', 'GDC', 'UTC', 'MAI', 'BUR', 'HLB', 'NUR', 'JON', 'JGB'];
    for (const from of campusCodes) for (const to of campusCodes) {
      if (from === to) continue;
      const actual = await actualRuntime.app.wayfindStairs(from, to);
      const lower = probe.route(from, to);
      if (actual.ok) {
        if (!lower) failures.push({ from, to, why: 'missing' });
        else if (lower.lo > actual.lo) failures.push({ from, to, lower: lower.lo, actual: actual.lo });
        comparable++;
      }
      actualRuntime.seam.calls.length = 0;
      checked++;
    }
    report.coverage.confirmationAppPairs = checked;
    report.coverage.confirmationComparablePairs = comparable;
    report.coverage.confirmationFloorFailures = failures;
    assert.equal(failures.length, 0, JSON.stringify(failures));
  } finally { globalThis.fetch = savedFetch; releaseWalkGraph(); }
});
await test('equal-cost probe paths do not depend on first requested direction', () => {
  const tied = syntheticGraph();
  tied.n = { x: [-97740000, 1000, -1000, 1000], y: [30280000, 0, 1000, 0] };
  tied.e = { a: [0, 1, -1, 2], b: [1, 2, 2, 1], w: [1000, 19000, 18000, 1200],
    f: [0, 0, 0, 2], s: [-1, -1, -1, -1] };
  tied.d[1][2] = [3];
  const forwardGraph = decodeWalkGraph(tied), reverseGraph = decodeWalkGraph(tied);
  const forward = routeBetween(forwardGraph, 'SYN', 'TST');
  routeBetween(reverseGraph, 'TST', 'SYN');
  same(forward, routeBetween(reverseGraph, 'SYN', 'TST'));
});
await test('read-only graph stays unchanged during verification', async () => {
  assert.equal(digest(await fs.readFile(path.join(ROOT, 'data/walk_graph.json'), 'utf8')), report.snapshot.graphSHA256);
});
await test('schedule-check legs preserve the router metre and minute units', async () => {
  const schedule = await app.wayfindScheduleFrom([
    { location: 'WEL 1.100', days: ['MO'], startMin: 600, endMin: 650 },
    { location: 'PCL 1.100', days: ['MO'], startMin: 720, endMin: 770 },
  ], { kind: 'synthetic' });
  const checked = await app.wayfindScheduleCheck(schedule);
  const actual = await app.wayfindStairs('WEL', 'PCL');
  assert.equal(checked.legs.length, 1); assert.equal(checked.legs[0].ok, true);
  same([checked.legs[0].distM, checked.legs[0].lo, checked.legs[0].hi],
    [actual.distM, actual.lo, actual.hi]);
});
await test('schedule-check cached unreachable codes mark every meeting as failed', async () => {
  const parsed = await app.wayfindScheduleFrom([
    { location: 'SMC 1.100', days: ['MO'], startMin: 600, endMin: 650 },
    { location: 'SMC 2.100', days: ['TU'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' });
  const checked = await app.wayfindScheduleCheck(parsed);
  assert.equal(checked.events.filter(event => event.status === 'failed').length, 2);
  assert.equal(core.imported(checked).every(meeting => meeting.needsReview), true);
});
await test('default confirmation preparation uses runtime doors without routing the map', async () => {
  await quietGate();
  const savedFetch = globalThis.fetch, savedWindow = globalThis.window;
  releaseWalkGraph();
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => raw });
    const actualRuntime = await finderRuntime({ graph: raw });
    globalThis.window = actualRuntime.app;
    const ctx = await prepare({ neighbours: () => [], registerName: () => null, buildingName: () => null });
    assert.ok(ctx.walkProbe.has('HLB'));
    assert.equal(actualRuntime.seam.calls.length, 0);
    const actual = await actualRuntime.app.wayfindStairs('JON', 'NUR');
    assert.ok(ctx.routeMinutes('JON', 'NUR') <= actual.lo);
    const standalone = await walkProbe();
    assert.equal(standalone.has('HLB'), false);
    const injected = await prepare({ neighbours: () => [], registerName: () => null,
      buildingName: () => null, routeMinutes: () => 42 });
    assert.equal(injected.routeMinutes('HLB', 'NUR'), 42);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    releaseWalkGraph();
  }
});
await test('schedule-check summary and routable list reflect checked failures', async () => {
  const parsed = await app.wayfindScheduleFrom([
    { location: 'SMC 1.100', days: ['MO'], startMin: 600, endMin: 650 },
    { location: 'SMC 2.100', days: ['TU'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' });
  const checked = await app.wayfindScheduleCheck(parsed);
  same([checked.counts.total, checked.counts.ok, checked.counts.failed,
    checked.counts.errors, checked.routable.length], [2, 0, 2, 2, 0]);
  assert.doesNotMatch(checked.summary, /Imported all/);
  const repeated = await app.wayfindScheduleCheck(checked);
  same(repeated.counts, checked.counts);
  const mixed = await app.wayfindScheduleCheck(await app.wayfindScheduleFrom([
    { location: 'SMC 1.100', days: ['MO'], startMin: 600, endMin: 650 },
    { location: 'PCL 1.100', days: ['TU'], startMin: 600, endMin: 650 },
  ], { kind: 'synthetic' }));
  same([mixed.counts.ok, mixed.counts.failed, mixed.counts.errors, mixed.routable.length], [1, 1, 1, 1]);
  assert.equal(mixed.routable[0].code, 'PCL');
});
await test('invalid runtime anchors and failed providers do not fabricate confirmation routes', async () => {
  const savedFetch = globalThis.fetch;
  releaseWalkGraph();
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => syntheticGraph() });
    const probe = await walkProbe({ codes: ['BAD', 'FAIL'], doorsForCode: async code => {
      if (code === 'FAIL') throw new Error('Synthetic unavailable provider');
      return code === 'BAD' ? { doors: [{ nodes: [-1, 999, 0], costM: [0, 0, -10] }] } : null;
    } });
    assert.equal(probe.has('BAD'), false); assert.equal(probe.has('FAIL'), false);
    assert.equal(probe.route('BAD', 'TST'), null); assert.equal(probe.route('FAIL', 'TST'), null);
    assert.ok(probe.route('SYN', 'TST'));
  } finally { globalThis.fetch = savedFetch; releaseWalkGraph(); }
});

report.coverage.routeQueries = report.routes.length;
report.coverage.successfulQueries = report.routes.filter(route => route.ok).length;
report.coverage.unavailableQueries = report.routes.filter(route => !route.ok).length;
report.coverage.originalMatrix = {
  housingQueries: baselineHomes.size,
  routeQueries: report.routes.filter(route => route.baselineHome).length,
  successfulQueries: report.routes.filter(route => route.baselineHome && route.ok).length,
  unavailableQueries: report.routes.filter(route => route.baselineHome && !route.ok).length,
};
report.coverage.unavailableReasons = Object.fromEntries(Object.entries(Object.groupBy(report.routes.filter(route => !route.ok), route => route.why)).map(([reason, routes]) => [reason, routes.length]));
report.coverage.allowedRuntimeReads = [...new Set(runtime.reads)];
report.counts = Object.fromEntries(Object.entries(report.findings).map(([kind, findings]) => [kind, findings.length]));
report.regressionFailures = report.regressions.filter(test => !test.ok).length;
if (output) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ method: report.method, snapshot: report.snapshot, coverage: report.coverage,
  counts: report.counts, regressionFailures: report.regressionFailures, regressions: report.regressions }, null, 2));
if (report.regressionFailures || ['wrongHomeIdentity', 'straightFallbacks', 'missingRouteEvidence', 'measurementUnits', 'distanceUnits', 'timeUnits', 'stepFreeViolations', 'weeklyUnits', 'missingRouteCountedAsZero', 'probeDoorLinksMissing', 'probeDistanceUnits', 'unresolvedCodes', 'scheduleRejected'].some(kind => report.counts[kind])) process.exitCode = 1;
