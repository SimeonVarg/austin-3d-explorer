import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/geometry-memory-codec.js', import.meta.url), 'utf8');
const page = vm.createContext({ window: {} });
vm.runInContext(source, page);
assert.equal(typeof page.window.createGeometryMemoryCodec, 'function');
assert.equal(page.window.createGeometryMemoryCodec, page.geometryMemoryCodec);
const worker = vm.runInNewContext(`(${page.window.createGeometryMemoryCodec.toString()})()`);
const inputRealm = vm.createContext({});
const constructors = [
  Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int8Array,
  Uint16Array, Int16Array, Uint32Array, Int32Array
];
let checks = 0;

function bytesOf(array) {
  return Buffer.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

function checkRoundTrip(codec, array, itemSize, expectedRuns, options) {
  const expectedBytes = bytesOf(array);
  const record = codec.encode(array, itemSize, options);
  assert.ok(record, 'compressible input must produce a record');
  assert.equal(record.ctor, Object.prototype.toString.call(array).slice(8, -1));
  assert.equal(record.length, array.length);
  assert.equal(record.itemSize, itemSize);
  assert.equal(record.values.length, record.runs.length * itemSize);
  assert.equal(Object.prototype.toString.call(record.runs), '[object Uint32Array]');
  assert.equal(record.values.byteOffset, 0);
  assert.equal(record.runs.byteOffset, 0);
  assert.equal(record.values.buffer.byteLength, record.values.byteLength);
  assert.equal(record.runs.buffer.byteLength, record.runs.byteLength);
  assert.notEqual(record.values.buffer, array.buffer);
  assert.notEqual(record.runs.buffer, array.buffer);
  assert.deepEqual(bytesOf(array), expectedBytes);
  assert.ok(record.values.byteLength + record.runs.byteLength <= array.byteLength * (1 - (options?.minimumSavingsRatio ?? 0.25)));
  if (expectedRuns) assert.deepEqual(Array.from(record.runs), expectedRuns);
  const decoded = codec.decode(record);
  assert.equal(Object.prototype.toString.call(decoded), Object.prototype.toString.call(array));
  assert.deepEqual(bytesOf(decoded), expectedBytes);
  assert.notEqual(decoded.buffer, record.values.buffer);
  assert.notEqual(decoded.buffer, array.buffer);
  new Uint8Array(decoded.buffer).fill(0xa5);
  assert.deepEqual(bytesOf(codec.decode(record)), expectedBytes);
  checks++;
  return record;
}

function tupleFixture(Constructor, itemSize, offset, tuples, runLengths) {
  const length = runLengths.reduce((total, count) => total + count, 0) * itemSize;
  const buffer = new ArrayBuffer(offset + length * Constructor.BYTES_PER_ELEMENT + 16);
  new Uint8Array(buffer).fill(0xa5);
  const array = new Constructor(buffer, offset, length);
  let destination = 0;
  for (let runIndex = 0; runIndex < runLengths.length; runIndex++) {
    for (let repeatIndex = 0; repeatIndex < runLengths[runIndex]; repeatIndex++) {
      array.set(tuples[runIndex], destination);
      destination += itemSize;
    }
  }
  return array;
}

function bitFixture(Constructor, words, runLengths, itemSize = 1) {
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const tupleBytes = Constructor.BYTES_PER_ELEMENT * itemSize;
  const length = runLengths.reduce((total, count) => total + count, 0) * itemSize;
  const byteOffset = Constructor.BYTES_PER_ELEMENT * 3;
  const buffer = new ArrayBuffer(byteOffset + length * Constructor.BYTES_PER_ELEMENT + 16);
  const array = new Constructor(buffer, byteOffset, length);
  const bytes = new Uint8Array(buffer, byteOffset, array.byteLength);
  let destination = 0;
  for (let runIndex = 0; runIndex < runLengths.length; runIndex++) {
    const tuple = new Uint8Array(tupleBytes);
    const view = new DataView(tuple.buffer);
    for (let component = 0; component < itemSize; component++) {
      const value = words[runIndex][component];
      if (Constructor === Float32Array) view.setUint32(component * 4, value, littleEndian);
      else view.setBigUint64(component * 8, value, littleEndian);
    }
    for (let repeatIndex = 0; repeatIndex < runLengths[runIndex]; repeatIndex++) {
      bytes.set(tuple, destination);
      destination += tupleBytes;
    }
  }
  return array;
}

for (const codec of [page.window.GeometryMemoryCodec, worker]) {
  for (const Constructor of constructors) {
    for (let itemSize = 1; itemSize <= 4; itemSize++) {
      const tuple = (Constructor === Float32Array || Constructor === Float64Array
        ? [4, 0.25, 0.5, 0.75] : [4, 2, 6, 8]).slice(0, itemSize);
      const changed = tuple.slice();
      changed[itemSize - 1] = 3;
      for (const offset of [0, Constructor.BYTES_PER_ELEMENT * 3]) {
        const array = tupleFixture(Constructor, itemSize, offset, [tuple, changed, tuple], [7, 11, 9]);
        const expected = bytesOf(array);
        const originalBuffer = bytesOf(new Uint8Array(array.buffer));
        const independent = checkRoundTrip(codec, array, itemSize, [7, 11, 9]);
        assert.deepEqual(bytesOf(new Uint8Array(array.buffer)), originalBuffer);
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
        assert.deepEqual(bytesOf(codec.decode(independent)), expected);
        const record = checkRoundTrip(codec, tupleFixture(Constructor, itemSize, offset, [tuple], [96]), itemSize, [96]);
        assert.deepEqual(bytesOf(record.values), bytesOf(new Constructor(tuple)));
      }
      const foreign = vm.runInContext(`new ${Constructor.name}(${JSON.stringify(Array(48).fill(tuple).flat())})`, inputRealm);
      checkRoundTrip(codec, foreign, itemSize, [48]);
      const incompressible = new Constructor(96 * itemSize);
      for (let tupleIndex = 0; tupleIndex < 96; tupleIndex++) {
        incompressible.set(tupleIndex % 2 === 0 ? tuple : changed, tupleIndex * itemSize);
      }
      assert.equal(codec.encode(incompressible, itemSize), null);
      assert.equal(codec.encode(new Constructor(0), itemSize), null);
      checks += 2;
    }
  }

  checkRoundTrip(codec, tupleFixture(Uint8Array, 3, 3, [[255, 96, 32], [16, 64, 255]], [33, 65]), 3, [33, 65]);
  checkRoundTrip(codec, tupleFixture(Float32Array, 3, 12, [[0.25, 0.5, 0.75]], [257]), 3, [257]);
  checkRoundTrip(codec, tupleFixture(Int32Array, 2, 8, [[-2147483648, 2147483647], [-1, 0]], [17, 19]), 2, [17, 19]);
  checkRoundTrip(codec, tupleFixture(Uint32Array, 2, 8, [[0xffffffff, 0x80000000]], [65]), 2, [65]);
  checkRoundTrip(codec, tupleFixture(Int8Array, 2, 2, [[-128, 127], [-1, 0]], [17, 19]), 2, [17, 19]);
  checkRoundTrip(codec, tupleFixture(Int16Array, 2, 2, [[-32768, 32767], [-1, 0]], [17, 19]), 2, [17, 19]);
  checkRoundTrip(codec, tupleFixture(Uint8ClampedArray, 3, 3, [[-20, 0.5, 300]], [65]), 3, [65]);

  const float32Bits = [[0], [0x80000000], [0x7fc00001], [0x7fc00002], [0xffc00001], [0x7f800001], [0x7f800000], [0xff800000]];
  const float64Bits = [[0n], [0x8000000000000000n], [0x7ff8000000000001n], [0x7ff8000000000002n], [0xfff8000000000001n], [0x7ff0000000000001n], [0x7ff0000000000000n], [0xfff0000000000000n]];
  for (const [Constructor, patterns] of [[Float32Array, float32Bits], [Float64Array, float64Bits]]) {
    const runLengths = [17, 19, 23, 29, 31, 37, 41, 43];
    const array = bitFixture(Constructor, patterns, runLengths);
    const record = checkRoundTrip(codec, array, 1, runLengths);
    assert.deepEqual(bytesOf(record.values), bytesOf(bitFixture(Constructor, patterns, Array(patterns.length).fill(1))));
    const expected = bytesOf(array);
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
    assert.deepEqual(bytesOf(codec.decode(record)), expected);
    const transferred = structuredClone(record, { transfer: [record.values.buffer, record.runs.buffer] });
    assert.equal(record.values.buffer.byteLength, 0);
    assert.equal(record.runs.buffer.byteLength, 0);
    assert.deepEqual(bytesOf(codec.decode(transferred)), expected);
    checks += 3;
  }

  const tupleBits = [
    [0x40800000, 0x3e800000, 0x3f000000, 0x3f400000],
    [0x40800000, 0x3e800000, 0x3f000000, 0x3f400001],
    [0x80000000, 0x7fc00001, 0x7f800001, 0xffc00002]
  ];
  checkRoundTrip(codec, bitFixture(Float32Array, tupleBits, [17, 19, 23], 4), 4, [17, 19, 23]);

  const boundary = tupleFixture(Uint8Array, 1, 0, [[1], [2], [3]], [7, 6, 7]);
  checkRoundTrip(codec, boundary, 1, [7, 6, 7]);
  assert.equal(codec.encode(boundary.subarray(0, 19), 1), null);
  checkRoundTrip(codec, boundary.subarray(0, 19), 1, [7, 6, 6], { minimumSavingsRatio: 0.2 });
  assert.equal(codec.encode(boundary, 1, { minimumSavingsRatio: 0.26 }), null);
  assert.equal(codec.encode(boundary, 1, { minimumSavingsRatio: 1 }), null);
  assert.equal(codec.encode(boundary, 1, { maxRuns: 2 }), null);
  assert.equal(codec.encode(boundary, 1, { maxRuns: 0 }), null);
  checkRoundTrip(codec, boundary, 1, [7, 6, 7], { maxRuns: 3 });
  assert.equal(codec.encode(new Uint8Array(4).fill(9), 1, { minimumSavingsRatio: 0 }), null);
  checkRoundTrip(codec, new Uint8Array(5).fill(9), 1, [5], { minimumSavingsRatio: 0 });
  checks += 6;

  const offsetValues = bitFixture(Float32Array, [[0x7fc00001], [0x80000000]], [1, 1]);
  const offsetRuns = new Uint32Array(new ArrayBuffer(20), 4, 2);
  offsetRuns.set([17, 19]);
  const offsetRecord = { ctor: 'Float32Array', values: offsetValues, runs: offsetRuns, length: 36, itemSize: 1 };
  assert.deepEqual(bytesOf(codec.decode(offsetRecord)), bytesOf(bitFixture(Float32Array, [[0x7fc00001], [0x80000000]], [17, 19])));
  assert.deepEqual(bytesOf(codec.decode({ ctor: 'Uint8Array', values: new Uint8Array(0), runs: new Uint32Array(0), length: 0, itemSize: 1 })), Buffer.alloc(0));
  checks += 2;

  for (const invalid of [[], {}, null, new DataView(new ArrayBuffer(32)), new BigInt64Array(8), new BigUint64Array(8)]) {
    assert.throws(() => codec.encode(invalid, 1), /supported typed array/);
    checks++;
  }
  for (const itemSize of [undefined, 0, -1, 5, 1.5, NaN, '3']) {
    assert.throws(() => codec.encode(new Float32Array(24), itemSize), /itemSize/);
    checks++;
  }
  assert.throws(() => codec.encode(new Float32Array(7), 4), /multiple/);
  assert.throws(() => codec.encode(boundary, 1, null), /options/);
  assert.throws(() => codec.encode(boundary, 1, 3), /options/);
  for (const minimumSavingsRatio of [-0.1, 1.1, NaN, Infinity, '0.25']) {
    assert.throws(() => codec.encode(boundary, 1, { minimumSavingsRatio }), /minimumSavingsRatio/);
    checks++;
  }
  for (const maxRuns of [-1, 1.5, NaN, Infinity, 0x100000000, '3']) {
    assert.throws(() => codec.encode(boundary, 1, { maxRuns }), /maxRuns/);
    checks++;
  }

  const valid = codec.encode(boundary, 1);
  for (const invalid of [
    null, {},
    { ...valid, ctor: 'constructor' },
    { ...valid, ctor: 'BigInt64Array' },
    { ...valid, values: new Int8Array(valid.values) },
    { ...valid, runs: new Int32Array(valid.runs) },
    { ...valid, values: valid.values.subarray(1) },
    { ...valid, runs: new Uint32Array([7, 0, 13]) },
    { ...valid, runs: new Uint32Array([7, 6, 8]) },
    { ...valid, runs: new Uint32Array([7, 6, 6]) },
    { ...valid, length: -1 },
    { ...valid, length: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, length: 19, itemSize: 2 },
    { ...valid, itemSize: 5 }
  ]) {
    assert.throws(() => codec.decode(invalid), /record|itemSize/);
    checks++;
  }
  checks += 3;
}

const allocations = [];
const instrumented = vm.createContext({ window: {} });
let lastByteRead = -1;
for (const name of ['Float32Array', 'Uint32Array', 'Uint8Array']) {
  const Constructor = vm.runInContext(name, instrumented);
  instrumented[name] = new Proxy(Constructor, {
    construct(target, argumentsList) {
      allocations.push({ name, argumentsList });
      const array = Reflect.construct(target, argumentsList);
      if (name !== 'Uint8Array') return array;
      return new Proxy(array, {
        get(targetArray, property) {
          if (typeof property === 'string' && /^\d+$/.test(property)) {
            lastByteRead = Math.max(lastByteRead, Number(property));
          }
          return Reflect.get(targetArray, property, targetArray);
        }
      });
    }
  });
}
vm.runInContext(source, instrumented);
const distinctPositions = Float32Array.from({ length: 384 }, (_, index) => index);
assert.equal(instrumented.window.GeometryMemoryCodec.encode(distinctPositions, 3), null);
assert.equal(allocations.length, 1);
assert.equal(allocations[0].name, 'Uint8Array');
assert.equal(allocations[0].argumentsList[0], distinctPositions.buffer);
assert.ok(lastByteRead < distinctPositions.byteLength - 12, 'reject before visiting the entire input');
allocations.length = 0;
lastByteRead = -1;
assert.equal(instrumented.window.GeometryMemoryCodec.encode(distinctPositions, 3, { maxRuns: 1 }), null);
assert.equal(allocations.length, 1);
assert.ok(lastByteRead < 24, 'run cap must abort on the first differing tuple');
checks += 2;

console.log(`Geometry memory codec: ${checks} checks passed (pure VM, no browser or GPU).`);
