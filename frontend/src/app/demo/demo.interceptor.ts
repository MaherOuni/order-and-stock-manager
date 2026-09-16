import { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * In demo mode, answers every API call from the in-memory backend instead of the network.
 *
 * An interceptor rather than a flag threaded through the services: the components, stores and
 * HTTP services then run byte-for-byte the same code they run against the real API, so the
 * demo cannot drift away from the product.
 *
 * The demo backend is imported lazily, so a normal production build never ships the seed data.
 */
export const demoBackendInterceptor: HttpInterceptorFn = (request, next) => {
  if (!environment.demoMode) return next(request);

  // Anything that is not an API call — a font, an image — still goes to the network.
  if (!request.url.includes('/api/')) return next(request);

  return from(import('./demo-backend')).pipe(
    switchMap((backend) => backend.handleDemoRequest(request)),
  );
};
