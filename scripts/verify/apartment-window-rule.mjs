// Exercise the production window generator, including split material bands.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../../js/slopes-apartments.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  function windowsFromBays('), source.indexOf('\n  /**', source.indexOf('  function windowsFromBays(')));
const windows = new Function('APTS', 'h01', body + '\nreturn windowsFromBays;')({nightLit: 0.5}, () => 0.25);
const spec = {bay: 1.575, windowRule: 'checker', window: {w: 1, h: 1.65, sill: 0.7, frame: {w: 0.35, h: 0, tone: 'glass'}}};
const ctx = {len: 12.6, z0: 0, z1: 11.2, floors: [0, 2.8, 5.6, 8.4], allFloors: [0, 2.8, 5.6, 8.4]};
const generate = (s, c) => windows(s, c, {}, 'test');
const whole = generate(spec, ctx);
assert.equal(whole.length, 16);
const rows = ctx.floors.map(z => whole.filter(w => Math.abs(w.z0 - z - 0.7) < 1e-8));
for (const row of rows) {
  assert.equal(row.length, 4);
  for (let i = 1; i < row.length; i++) assert.ok(Math.abs(row[i].s0 - row[i-1].s0 - 3.15) < 1e-8);
}
assert.ok(Math.abs(rows[1][0].s0 - rows[0][0].s0 - 1.575) < 1e-8);
assert.equal(rows[2][0].s0, rows[0][0].s0);
assert.deepEqual(generate(spec, {...ctx, z0: 2.8, floors: ctx.floors.slice(1)}), whole.slice(4));
assert.deepEqual(generate(spec, {...ctx, z0: 3, floors: ctx.floors.slice(2), floorBelow: 2.8}), whole.slice(4));
assert.ok(whole.every(w => w.lit && w.frame.w === 0.35 && Math.abs(w.z1-w.z0-1.65) < 1e-8));
assert.equal(generate({...spec, windowRule: undefined}, ctx).length, 32);
assert.equal(generate({...spec, window: null}, ctx).length, 0);
console.log('PASS: half-bay stagger, floor pitch, split bands, retained floor below, frames/night flags, opt-out and blank walls');
