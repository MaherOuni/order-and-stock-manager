import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Guards the admin area.
 *
 * Two refusals, not one. Not signed in sends you to the sign-in screen with somewhere to come
 * back to. Signed in as another restaurant's staff is a different thing entirely: the API would
 * answer that with a 403, and bouncing to a login form would be a lie — the fix is not better
 * credentials, it is a different URL.
 */
export const adminGuard: CanActivateFn = (route, state): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isSignedIn()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  // :tenantSlug is on the parent of every admin child route.
  const slug = route.paramMap.get('tenantSlug') ?? route.parent?.paramMap.get('tenantSlug');
  const session = auth.current();

  if (slug && session && session.tenantSlug && session.tenantSlug !== slug) {
    return router.createUrlTree(['/no-access'], { queryParams: { restaurant: slug } });
  }

  return true;
};
