// Runtime configuration, overwritten at build time by scripts/write-env.mjs when API_BASE_URL
// or DEMO_MODE is set. Inert on purpose: with nothing set, the app falls back to the values in
// src/environments, so a plain `npm run build` produces a normal build that talks to the API.
