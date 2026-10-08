import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, switchMap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AuthService } from './auth.service';

/** Sign-in and refresh must not carry the token they are trying to obtain or replace. */
const ANONYMOUS_PATHS = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout'];

/**
 * Attaches the staff token, and recovers from an expired one.
 *
 * Access tokens last fifteen minutes, so a tablet left open across a shift will hit 401s
 * constantly. Rather than making the user sign in again, the first 401 triggers a refresh and
 * the request is retried once. If that fails the session is genuinely over.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (ANONYMOUS_PATHS.some((path) => request.url.includes(path))) return next(request);

  const token = auth.accessToken();
  const authorised = token ? withToken(request, token) : request;

  return next(authorised).pipe(
    catchError((error: unknown) => {
      // Only a 401 is worth refreshing for. A 403 means the token is valid and the answer is
      // still no — refreshing it would return the same roles and the same refusal.
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !token) {
        return throwError(() => error);
      }

      return auth.refresh().pipe(
        switchMap((fresh) => {
          if (!fresh) {
            auth.clear();
            void router.navigate(['/login'], {
              queryParams: { returnUrl: router.url },
            });

            return throwError(() => error);
          }

          return next(withToken(request, fresh));
        }),
      );
    }),
  );
};

function withToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/** Typed so the interceptor can be unit-tested without the HTTP plumbing. */
export type Forward = (request: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>;
export type { HttpHandlerFn };
