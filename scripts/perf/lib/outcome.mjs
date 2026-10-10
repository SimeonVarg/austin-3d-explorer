/**
 * outcome.mjs — what a perf run owes the caller: an exit code that means something, and a refusal to point at the live site by accident.
 * Pure functions (no browser, no files), so scripts/verify/perf-outcome.mjs can hold them with the real scripts' own logic.
 *
 * WHY. load-profile.mjs, frame-profile.mjs and apartment-buffers.mjs ended with `process.exit(0)` however the run went: a page that
 * never became ready, a repetition that threw, a browser read that failed all became a line in a report and exit 0, so anything built on
 * the exit code (the suite wrapper, the AWS runner) could never go red. And all three default to a local server but accept any --url,
 * so one mistyped flag spends 48 MB of Vercel bandwidth per cold load.
 */

/** hosts a perf run may hit without being told it is allowed to: this machine. */
export function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.localhost');
}

/**
 * Throw unless `url` is on this machine, or the caller said so with --allow-live (or PERF_ALLOW_LIVE=1). A cold load of the city is
 * about 48 MB; the suite repeats it. Returns { local, host }.
 */
export function checkTarget(url, argv = process.argv.slice(2), env = process.env) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { throw new Error(`--url "${url}" is not a URL`); }
  const local = isLocalHost(host);
  if (!local && !argv.includes('--allow-live') && env.PERF_ALLOW_LIVE !== '1') {
    throw new Error(`refusing to run against ${host}: not this machine. A cold load fetches about 48 MB and these tools repeat it. Serve the repo locally (python3 scripts/serve.py PORT) and pass --url http://127.0.0.1:PORT/, or add --allow-live (or PERF_ALLOW_LIVE=1) if you mean it.`);
  }
  return { local, host };
}

/** Calls checkTarget and, on refusal, prints the reason and exits 2 (a usage error, not a measurement failure). */
export function refuseLive(url, argv, env) {
  try { return checkTarget(url, argv, env); } catch (e) { console.error(e.message); process.exit(2); }
}

/** Is the city ready? The same test every wait loop uses: the intro reveal and the authored apartments both marked. */
export function readiness(marks) {
  const missing = ['introReveal', 'apartmentsDone'].filter(k => !(marks && marks[k]));
  return { ready: missing.length === 0, missing };
}

/**
 * load-profile / frame-profile: 0 only if every planned repetition produced a result AND every result was ready.
 * `failures` = repetitions that threw. `from` = a report rebuilt from saved files (no browser): needs at least one result.
 */
export function repsExitCode({ planned, results, failures = 0, from = false }) {
  const problems = [];
  if (!results.length) problems.push(from ? 'no saved repetition files matched' : 'no repetition produced a result');
  if (failures) problems.push(`${failures} repetition${failures === 1 ? '' : 's'} threw`);
  if (!from && results.length + failures < planned) problems.push(`only ${results.length + failures} of ${planned} planned repetitions ran`);
  const notReady = results.filter(r => r.ready === false || (r.marks && !readiness(r.marks).ready));
  if (notReady.length) problems.push(`${notReady.length} repetition${notReady.length === 1 ? '' : 's'} never became ready (${[...new Set(notReady.flatMap(r => readiness(r.marks).missing))].join(', ') || 'timed out'}): ${notReady.map(r => r.label || r.rep).join(', ')}`);
  return { code: problems.length ? 1 : 0, problems };
}

/** apartment-buffers: the page read must have produced meshes; an `{error}` is a failure, not a result. */
export function buffersExitCode(res) {
  const problems = [];
  if (!res) problems.push('the page read returned nothing');
  else if (res.error) problems.push('the page read failed: ' + res.error);
  else if (!res.meshes || !res.meshes.length) problems.push('the page read found no apartment meshes');
  return { code: problems.length ? 1 : 0, problems };
}
