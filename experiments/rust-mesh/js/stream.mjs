// Reads a recorded stream (see profile/record-stream.mjs) and exposes the record layout.
import fs from 'node:fs'; import path from 'node:path';
import { REC, hexBytes } from './common.mjs';
export { REC, hexBytes };
export function loadStream(dir) {
  const raw = fs.readFileSync(path.join(dir, 'stream.f64'));
  // Buffer.from(...).buffer may be a pooled slab; copy into an aligned, owned ArrayBuffer
  const ab = new ArrayBuffer(raw.byteLength); new Uint8Array(ab).set(raw);
  const stream = new Float64Array(ab);
  const palette = JSON.parse(fs.readFileSync(path.join(dir, 'palette.json'), 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  return { stream, records: stream.length / REC, palette, expected };
}
