import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const fixtures = String.raw`
import sys
sys.path.insert(0, sys.argv[1])
from scripts.compact_models import compact
sample = ' { "spaced" : " a b ", "quote" : "escaped \\" quote", "path" : "a\\\\b", "negative" : -0.0, "exponent" : 1e+30 } '
expected = '{"spaced":" a b ","quote":"escaped \\" quote","path":"a\\\\b","negative":-0.0,"exponent":1e+30}'
assert compact(sample) == expected
assert compact(expected) == expected
print('PASS token spellings, quoted whitespace, escapes and idempotence')
`;
const result = spawnSync(python, ['-c', fixtures, root], {encoding: 'utf8'});
assert.equal(result.status, 0, result.error?.message || result.stderr);
process.stdout.write(result.stdout);
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/apartments/index.json', import.meta.url), 'utf8'));
for (const name of catalog.buildings) {
  const text = fs.readFileSync(new URL('../../data/apartments/' + name, import.meta.url), 'utf8');
  JSON.parse(text);
  const compacted = text.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : '');
  assert.equal(text, compacted, name + ': run python scripts/compact_models.py after authoring');
}
console.log('PASS ' + catalog.buildings.length + ' core models contain no transport whitespace');
