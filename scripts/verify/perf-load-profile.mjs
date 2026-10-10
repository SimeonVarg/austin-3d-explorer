/**
 * perf-load-profile.mjs — a one-line wrapper so the AWS GPU runner (scripts/aws-gpu, which runs files in this
 * directory) and the laptop can start scripts/perf/load-profile.mjs. It measures timing; see that file's header
 * for what it measures and the settings. Not a check: it has no verdict and is listed under laptop_only.
 */
import '../perf/load-profile.mjs';
