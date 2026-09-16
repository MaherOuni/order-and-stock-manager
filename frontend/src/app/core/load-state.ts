import { HttpErrorResponse } from '@angular/common/http';
import { Signal, computed, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { ApiProblem } from './api.models';

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly message: string };

export interface LoadedResource<T> {
  readonly status: Signal<LoadState<T>['status']>;
  readonly loading: Signal<boolean>;
  /** The loaded value, or null while loading and after a failure. */
  readonly data: Signal<T | null>;
  readonly error: Signal<string | null>;

  /**
   * Re-runs the fetch.
   *
   * `silent` keeps the current data on screen while the request is in flight, which is what a
   * polling board wants — blanking the table every ten seconds is worse than the staleness it
   * fixes. A change of params always shows the loading state regardless.
   */
  reload(options?: { readonly silent?: boolean }): void;

  /** Rewrites the loaded value in place, for folding a mutation's response back into a list. */
  patch(update: (current: T) => T): void;
}

/**
 * A signal-shaped view of one HTTP GET, re-fetched whenever `params` changes.
 *
 * Must be called from an injection context (a field initializer or a constructor): it ties
 * itself to the owner's lifetime and unsubscribes when that is destroyed.
 */
export function loadResource<P, T>(
  params: Signal<P>,
  load: (params: P) => Observable<T>,
  options?: { readonly describeError?: (error: unknown) => string },
): LoadedResource<T> {
  const describeError = options?.describeError ?? describeHttpError;
  const request = signal({ version: 0, silent: false });
  const state = signal<LoadState<T>>({ status: 'loading' });

  // `params` is expected to be a computed, so its reference only changes when its inputs do —
  // which is exactly how a genuine parameter change is told apart from a manual reload.
  let previousParams: P | symbol = Symbol('unset');

  toObservable(computed(() => ({ value: params(), request: request() })))
    .pipe(
      switchMap(({ value, request: { silent } }) => {
        const paramsChanged = !Object.is(value, previousParams);
        previousParams = value;

        if (paramsChanged || !silent || state().status !== 'ready') {
          state.set({ status: 'loading' });
        }

        return load(value).pipe(
          map((data) => ({ status: 'ready', data }) as LoadState<T>),
          catchError((error: unknown) =>
            of({ status: 'error', message: describeError(error) } as LoadState<T>),
          ),
        );
      }),
      takeUntilDestroyed(),
    )
    .subscribe((next) => state.set(next));

  return {
    status: computed(() => state().status),
    loading: computed(() => state().status === 'loading'),
    data: computed(() => {
      const current = state();

      return current.status === 'ready' ? current.data : null;
    }),
    error: computed(() => {
      const current = state();

      return current.status === 'error' ? current.message : null;
    }),
    reload: (reloadOptions) =>
      request.update(({ version }) => ({
        version: version + 1,
        silent: reloadOptions?.silent ?? false,
      })),
    patch: (update) => {
      const current = state();

      if (current.status === 'ready') state.set({ status: 'ready', data: update(current.data) });
    },
  };
}

/**
 * Turns a failed request into a sentence worth showing. The API answers every non-2xx with an
 * RFC 7807 document whose `detail` is already written for a human, so it wins when present.
 */
export function describeHttpError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Something went wrong. Try again in a moment.';

  if (error.status === 0) {
    return 'Cannot reach the API. Check that it is running and that CORS allows this origin.';
  }

  const problem: ApiProblem | null =
    error.error && typeof error.error === 'object' ? (error.error as ApiProblem) : null;

  const fieldErrors = Object.values(problem?.errors ?? {}).flat();

  if (fieldErrors.length > 0) return fieldErrors.join(' ');
  if (problem?.detail) return problem.detail;

  return `Request failed (${error.status}).`;
}
