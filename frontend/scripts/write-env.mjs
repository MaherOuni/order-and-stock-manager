/**
 * Turns build-time environment variables into the runtime config the app reads.
 *
 * `ng build` does not put `process.env` into the bundle, so a Vercel environment variable
 * cannot reach Angular on its own. This writes `public/env.js`, which index.html loads before
 * the bundle and the environment files read off `window`.
 *
 *   API_BASE_URL   absolute http(s) origin of the Order & Stock API
 *   DEMO_MODE      "true" to answer every API call from seeded in-memory data instead
 *
 * Runs automatically as the npm `prebuild` script. With neither variable set it leaves the
 * checked-in inert file alone, so a local `npm run build` behaves exactly as before.
 */
import { writeFileSync } from 'node:fs';

const target = new URL('../public/env.js', import.meta.url);

const apiBaseUrl = process.env.API_BASE_URL?.trim();

// `--demo` as well as the environment variable: `DEMO_MODE=true npm start` is not portable to
// a Windows shell, and the npm scripts have to work everywhere.
const demoMode =
  process.argv.includes('--demo') || /^(1|true|yes|on)$/i.test(process.env.DEMO_MODE?.trim() ?? '');

if (!apiBaseUrl && !demoMode) {
  console.log('[write-env] Neither API_BASE_URL nor DEMO_MODE set — keeping public/env.js as is.');
  process.exit(0);
}

if (apiBaseUrl && !/^https?:\/\//i.test(apiBaseUrl)) {
  console.error(`[write-env] API_BASE_URL must be an absolute http(s) URL, got "${apiBaseUrl}".`);
  process.exit(1);
}

const lines = [
  '// Generated at build time by scripts/write-env.mjs. Do not edit.',
];

if (apiBaseUrl) {
  // Trailing slashes are stripped by the app too, but a normalised value is easier to read in
  // a deployment's build log when something is wrong.
  const normalised = apiBaseUrl.replace(/\/+$/, '');
  lines.push(`window.__ORDER_API_BASE_URL__ = ${JSON.stringify(normalised)};`);
  console.log(`[write-env] API base URL set to ${normalised}`);
}

if (demoMode) {
  lines.push('window.__ORDER_DEMO_MODE__ = true;');
  console.log('[write-env] DEMO MODE ON — the build will not talk to a backend.');
}

writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
