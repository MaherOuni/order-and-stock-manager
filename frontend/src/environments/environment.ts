import { Environment } from './environment.model';

/**
 * Development settings. `ng build --configuration production` swaps this file for
 * `environment.prod.ts` (see the `fileReplacements` entry in angular.json).
 */
export const environment: Environment = {
  production: false,
  // The API as `docker compose up` exposes it. Its CORS policy already allows
  // http://localhost:4200, which is where `npm start` serves this app.
  apiBaseUrl: 'http://localhost:5080',
  // `npm run start:demo` flips this at runtime via public/env.js; the checked-in default is
  // the real backend, so nothing about ordinary development changes.
  demoMode: globalThis.window?.__ORDER_DEMO_MODE__ ?? false,
};
