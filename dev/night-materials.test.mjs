// Run the actual ground palette and its independent detail/texture consumers.
// The former mismatch left an orange lake after the buildings reached night.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={window:{},location:{search:''},URLSearchParams,console};
context.window.location=context.location;
for(const name of ['sky','city-night'])vm.runInNewContext(readFileSync(new URL(`../js/${name}.js`,import.meta.url),'utf8'),context);
const source=readFileSync(new URL('../js/ground.js',import.meta.url),'utf8');
const end=source.lastIndexOf('})();');
assert.ok(end>0);
vm.runInNewContext(source.slice(0,end)+'window.groundProbe={paletteAt,nightAmt,trioAt};\n'+source.slice(end),context);
const {groundProbe:g,CityNight:n}=context.window;
for(const p of [0,.3,.5,.56]){
 n.tune.on=false;const before=JSON.stringify(g.paletteAt(p));
 n.tune.on=true;assert.equal(JSON.stringify(g.paletteAt(p)),before,`day/sunset ground at ${p}`);
}
const night=g.paletteAt(1),twilight=g.paletteAt(.69);
assert.equal(twilight.water,night.water,'lake must reach its night material with buildings');
assert.equal(twilight.paving,night.paving,'raised paving must follow the shared night clock');
assert.equal(g.nightAmt(.69),1,'ground texture fades must follow the same clock');
assert.equal(g.trioAt(['#ffffff','#ffbb55','#111827'],.69),'#111827','bank/depth palette must follow the same clock');
// Switching only the new schedule off reproduces the original mismatch.
n.tune.on=false;
assert.notEqual(g.paletteAt(.69).water,night.water);
assert.ok(g.nightAmt(.69)<.5);
console.log('PASS unchanged day/sunset, aligned lake/paving/detail/texture dusk, and old-clock regression detected');
