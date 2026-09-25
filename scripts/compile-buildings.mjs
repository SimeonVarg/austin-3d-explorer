#!/usr/bin/env node
import path from 'node:path';
import { compileBuildings, DEFAULT_ROOT, DEFAULT_OPTIONS } from './buildings/compiler.mjs';
import { TARGETS } from './buildings/catalog.mjs';

const args = process.argv.slice(2);
const get = name => { const i = args.indexOf(name); if (i < 0) return undefined; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(name + ' requires a value'); return args[i + 1]; };
if (args.includes('--help')) {
  console.log('node scripts/compile-buildings.mjs [--only welch,painter,gdc,nueces,standard] [--out DIRECTORY] [--filter-resolution 1]\nDefault: Welch only. Uses pinned Three.js from scripts/buildings/node_modules; run npm ci there first.');
} else {
  for (let i = 0; i < args.length; i += 2) if (!['--only', '--out', '--filter-resolution'].includes(args[i])) throw new Error('Unknown option: ' + args[i]);
  const keys = (get('--only') || 'welch').split(',');
  if (keys.some(key => !TARGETS[key])) throw new Error('Available targets: ' + Object.keys(TARGETS).join(', '));
  const level = get('--filter-resolution');
  const options = { ...DEFAULT_OPTIONS, ...(level !== undefined ? { filteredResolutionLevel: Number(level) } : {}) };
  if (!Number.isInteger(options.filteredResolutionLevel) || options.filteredResolutionLevel < 0 || options.filteredResolutionLevel > 9) throw new Error('Filter resolution must be an integer from 0 to 9');
  const out = get('--out');
  const result = await compileBuildings({ rootDir: DEFAULT_ROOT, keys, options, ...(out ? { outDir: path.resolve(out) } : {}) });
  console.log(JSON.stringify(result, null, 2));
}
