import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';

import { routes } from './app.routes';
import { demoBackendInterceptor } from './demo/demo.interceptor';
import { DemoTitleStrategy } from './demo/demo-title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      // Binds :tenantSlug, :tableNumber and :orderId to signal inputs on the routed component.
      withComponentInputBinding(),
      // A new table starts at the top of its menu rather than wherever the last one scrolled to.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      // Lets an admin child route see :tenantSlug from its parent, so every page can take it
      // as a signal input instead of walking up the ActivatedRoute tree.
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideHttpClient(
      withFetch(),
      // A no-op unless DEMO_MODE is set; see demo/demo.interceptor.ts.
      withInterceptors([demoBackendInterceptor]),
    ),
    // Prefixes every tab title with "Demo ·" under DEMO_MODE; the default strategy otherwise.
    { provide: TitleStrategy, useClass: DemoTitleStrategy },
  ],
};
