function geometryMemoryCodec() {
  'use strict';

  const constructors = {
    Float32Array,
    Float64Array,
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array
  };
  const maximumRunLength = 0xffffffff;
  const defaultMinimumSavingsRatio = 0.25;

  function constructorName(array) {
    if (!ArrayBuffer.isView(array)) return null;
    const name = Object.prototype.toString.call(array).slice(8, -1);
    return Object.prototype.hasOwnProperty.call(constructors, name) ? name : null;
  }

  function validateItemSize(itemSize) {
    if (!Number.isInteger(itemSize) || itemSize < 1 || itemSize > 4) {
      throw new RangeError('itemSize must be an integer from 1 to 4');
    }
  }

  function identicalTuple(bytes, firstOffset, secondOffset, tupleBytes) {
    for (let byteIndex = 0; byteIndex < tupleBytes; byteIndex++) {
      if (bytes[firstOffset + byteIndex] !== bytes[secondOffset + byteIndex]) return false;
    }
    return true;
  }

  function encode(array, itemSize, options) {
    const ctor = constructorName(array);
    if (!ctor) throw new TypeError('array must be a supported typed array');
    validateItemSize(itemSize);
    if (array.length % itemSize !== 0) {
      throw new RangeError('array length must be a multiple of itemSize');
    }
    const settings = options === undefined ? {} : options;
    if (settings === null || typeof settings !== 'object') {
      throw new TypeError('options must be an object');
    }
    const minimumSavingsRatio = settings.minimumSavingsRatio === undefined
      ? defaultMinimumSavingsRatio : settings.minimumSavingsRatio;
    if (!Number.isFinite(minimumSavingsRatio) || minimumSavingsRatio < 0 || minimumSavingsRatio > 1) {
      throw new RangeError('minimumSavingsRatio must be a number from 0 to 1');
    }
    const maxRuns = settings.maxRuns === undefined ? maximumRunLength : settings.maxRuns;
    if (!Number.isInteger(maxRuns) || maxRuns < 0 || maxRuns > maximumRunLength) {
      throw new RangeError('maxRuns must be a nonnegative Uint32 integer');
    }
    const Constructor = constructors[ctor];
    const tupleBytes = Constructor.BYTES_PER_ELEMENT * itemSize;
    const byteBudget = array.byteLength * (1 - minimumSavingsRatio);
    const allowedRuns = Math.min(maxRuns, Math.floor(byteBudget / (tupleBytes + 4)));
    if (array.length === 0 || allowedRuns === 0) return null;

    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    let runCount = 1;
    let runLength = 1;
    for (let byteOffset = tupleBytes; byteOffset < bytes.length; byteOffset += tupleBytes) {
      if (runLength === maximumRunLength || !identicalTuple(bytes, byteOffset - tupleBytes, byteOffset, tupleBytes)) {
        runCount++;
        if (runCount > allowedRuns) return null;
        runLength = 1;
      } else {
        runLength++;
      }
    }

    const values = new Constructor(runCount * itemSize);
    const runs = new Uint32Array(runCount);
    const valueBytes = new Uint8Array(values.buffer);
    let runIndex = 0;
    let runOffset = 0;
    runLength = 1;
    for (let byteOffset = tupleBytes; byteOffset < bytes.length; byteOffset += tupleBytes) {
      if (runLength === maximumRunLength || !identicalTuple(bytes, byteOffset - tupleBytes, byteOffset, tupleBytes)) {
        valueBytes.set(bytes.subarray(runOffset, runOffset + tupleBytes), runIndex * tupleBytes);
        runs[runIndex] = runLength;
        runIndex++;
        runOffset = byteOffset;
        runLength = 1;
      } else {
        runLength++;
      }
    }
    valueBytes.set(bytes.subarray(runOffset, runOffset + tupleBytes), runIndex * tupleBytes);
    runs[runIndex] = runLength;
    return { values, runs, ctor, length: array.length, itemSize };
  }

  function decode(record) {
    if (record === null || typeof record !== 'object') {
      throw new TypeError('record must be an object');
    }
    const { values, runs, ctor, length, itemSize } = record;
    if (!Object.prototype.hasOwnProperty.call(constructors, ctor)) {
      throw new TypeError('record ctor must name a supported typed array');
    }
    validateItemSize(itemSize);
    if (!Number.isSafeInteger(length) || length < 0 || length % itemSize !== 0) {
      throw new RangeError('record length must be a nonnegative multiple of itemSize');
    }
    if (constructorName(values) !== ctor || constructorName(runs) !== 'Uint32Array') {
      throw new TypeError('record values and runs must have the declared typed array types');
    }
    if (values.length !== runs.length * itemSize) {
      throw new RangeError('record must contain one value tuple per run');
    }
    const tupleCount = length / itemSize;
    let decodedTuples = 0;
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const runLength = runs[runIndex];
      decodedTuples += runLength;
      if (runLength === 0 || decodedTuples > tupleCount) {
        throw new RangeError('record runs must be positive and fit the declared length');
      }
    }
    if (decodedTuples !== tupleCount) {
      throw new RangeError('record runs must sum to the declared length');
    }

    const Constructor = constructors[ctor];
    const array = new Constructor(length);
    const bytes = new Uint8Array(array.buffer);
    const valueBytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const tupleBytes = Constructor.BYTES_PER_ELEMENT * itemSize;
    let byteOffset = 0;
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const valueOffset = runIndex * tupleBytes;
      const runBytes = runs[runIndex] * tupleBytes;
      bytes.set(valueBytes.subarray(valueOffset, valueOffset + tupleBytes), byteOffset);
      let filledBytes = tupleBytes;
      while (filledBytes < runBytes) {
        const copyBytes = Math.min(filledBytes, runBytes - filledBytes);
        bytes.copyWithin(byteOffset + filledBytes, byteOffset, byteOffset + copyBytes);
        filledBytes += copyBytes;
      }
      byteOffset += runBytes;
    }
    return array;
  }

  return { encode, decode };
}

window.createGeometryMemoryCodec = geometryMemoryCodec;
window.GeometryMemoryCodec = geometryMemoryCodec();
