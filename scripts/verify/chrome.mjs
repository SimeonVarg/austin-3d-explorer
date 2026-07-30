/**
 * chrome.mjs — find a Chrome that actually launches.
 *
 * Do NOT reach for Playwright's own bundled Chromium without checking it: on the
 * machine this suite was written on it fails with "the application has failed to
 * start because its side-by-side configuration is incorrect" (a missing VC++
 * redistributable), and the failure surfaces as an opaque `spawn UNKNOWN`.
 * A real installed Chrome works fine, so prefer that.
 *
 * Override with CHROME_PATH if your install is somewhere unusual.
 */
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  // Windows
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

export function chromePath() {
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  throw new Error(
    'No Chrome found. Set CHROME_PATH to a Chrome/Edge binary.\nTried:\n  ' +
    CANDIDATES.join('\n  ')
  );
}

/** Headless flags that make WebGL work without a GPU. */
export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
];

export const BASE = process.env.VERIFY_URL || 'http://127.0.0.1:8099';
