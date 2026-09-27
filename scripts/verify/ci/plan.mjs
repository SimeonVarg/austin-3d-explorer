/**
 * ci/plan.mjs — which verify scripts CI runs, and how they are split into shards.
 * Shared by run-checks.mjs (each shard) and summary.mjs (the report), so the two
 * can never disagree about what was supposed to run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CI_DIR = path.dirname(fileURLToPath(import.meta.url));
export const VERIFY = path.resolve(CI_DIR, '..');
export const REPO = path.resolve(VERIFY, '..', '..');
export const BUCKETS = ['quarantine', 'laptop_only', 'tools', 'harness'];

/**
 * Extra environment for a child verify script: when PW_DEFAULT_TIMEOUT_MS is
 * set (the workflow sets it), preload slow-machine.mjs so Playwright's own
 * default waits match a 4-core software renderer. See that file for why.
 */
export function slowMachineEnv(env = process.env) {
  if (!env.PW_DEFAULT_TIMEOUT_MS) return {};
  const pre = `--import=${pathToFileURL(path.join(CI_DIR, 'slow-machine.mjs')).href}`;
  return { NODE_OPTIONS: `${env.NODE_OPTIONS || ''} ${pre}`.trim() };
}

export function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(CI_DIR, 'checks.json'), 'utf8'));
}

/**
 * Every top-level scripts/verify/*.mjs runs unless checks.json names it in one
 * of BUCKETS. Returns what runs (with args/ceiling/estimate), what is excluded
 * and why, and any name in checks.json that no longer exists on disk.
 */
export function plan(config = loadConfig()) {
  const all = fs.readdirSync(VERIFY).filter(f => f.endsWith('.mjs')).sort();
  const excluded = {};
  for (const bucket of BUCKETS) {
    for (const [f, why] of Object.entries(config[bucket] || {})) {
      if (!f.endsWith('.mjs')) continue;   // '_what' etc. are comments
      excluded[f] = { bucket, why };
    }
  }
  const run = all.filter(f => !excluded[f]).map(f => entry(config, f));
  const listed = new Set([...Object.keys(excluded), ...Object.keys(config.run || {})]);
  const missing = [...listed].filter(f => f.endsWith('.mjs') && !all.includes(f));
  return { run, excluded, missing, shards: config.shards || 1 };
}

export function entry(config, f) {
  const o = config.run?.[f] || {};
  return {
    script: f,
    args: o.args || [],
    timeout_s: o.timeout_s || config.default_timeout_s || 1200,
    est_s: o.est_s || config.default_est_s || 180,
  };
}

/**
 * Longest-processing-time first: the biggest estimate goes to the emptiest
 * shard. Deterministic (ties broken by name), so every shard computes the same
 * split independently.
 */
export function shardOf(run, k, n) {
  const bins = Array.from({ length: n }, () => ({ load: 0, items: [] }));
  const sorted = [...run].sort((a, b) => b.est_s - a.est_s || a.script.localeCompare(b.script));
  for (const r of sorted) {
    let best = 0;
    for (let i = 1; i < n; i++) if (bins[i].load < bins[best].load) best = i;
    bins[best].load += r.est_s;
    bins[best].items.push(r);
  }
  return bins[k].items;
}
