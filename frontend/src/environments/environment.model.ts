export interface Environment {
  readonly production: boolean;

  /** Origin of the Order & Stock API, without a trailing slash. Ignored in demo mode. */
  readonly apiBaseUrl: string;

  /**
   * Serve every API call from an in-memory fake backend instead of the network.
   *
   * The whole app runs unchanged — same components, same services, same HTTP calls — with an
   * interceptor answering them from seeded data held in localStorage. It exists so the UI can
   * be deployed and reviewed on its own.
   */
  readonly demoMode: boolean;
}

declare global {
  interface Window {
    /**
     * Optional runtime override for {@link Environment.apiBaseUrl}. Set it from
     * `public/env.js` (or any script that runs before the bundle) to point one built
     * artefact at a different backend without rebuilding — which is what makes a single
     * Vercel preview deployment usable against staging.
     */
    __ORDER_API_BASE_URL__?: string;

    /** Runtime override for {@link Environment.demoMode}; see public/env.js. */
    __ORDER_DEMO_MODE__?: boolean;
  }
}
