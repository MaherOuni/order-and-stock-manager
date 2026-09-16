import { Environment } from './environment.model';

/**
 * Production settings, swapped in by the `fileReplacements` entry in angular.json.
 *
 * Two ways to point this at your API, in order of precedence:
 *
 * 1. **Runtime** — set `window.__ORDER_API_BASE_URL__` from `public/env.js`. One build then
 *    works against several backends, which is what you want for Vercel previews.
 * 2. **Build time** — edit `DEFAULT_API_BASE_URL` below.
 *
 * Whatever you pick, add the deployed origin to `Cors:AllowedOrigins` in the API's appsettings,
 * or the browser will block every request.
 *
 * Setting `DEMO_MODE=true` instead skips all of that: the app answers its own API calls from
 * seeded data and needs no backend at all.
 */
const DEFAULT_API_BASE_URL = 'https://api.your-restaurant.example';

export const environment: Environment = {
  production: true,
  apiBaseUrl: (globalThis.window?.__ORDER_API_BASE_URL__ ?? DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
  demoMode: globalThis.window?.__ORDER_DEMO_MODE__ ?? false,
};
