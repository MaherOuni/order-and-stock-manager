import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, of, shareReplay, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../../environments/environment';

/** What the API returns from /auth/login and /auth/refresh. */
export interface AuthResponse {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

/** The signed-in staff member, as the UI needs them. */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tenantId: string;
  /** Which restaurant they work for; the admin guard compares it with the URL. */
  readonly tenantSlug: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

const STORAGE_KEY = 'orderstock-session';

/** Mirrors the server's roles. A typo here silently hides a control, so they are constants. */
export const Roles = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
} as const;

/**
 * Holds the staff session and keeps it alive.
 *
 * The session lives in localStorage rather than memory because this runs on a tablet behind a
 * counter for a whole shift, and losing the session on every page refresh would be unusable.
 * That does expose the refresh token to XSS; moving it to an httpOnly cookie is the hardening
 * step, and it needs the API to set cookies rather than return tokens in the body.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/+$/, '');

  private readonly session = signal<AuthSession | null>(restore());

  /** In flight refresh, shared so a burst of 401s triggers one call, not one each. */
  private refreshing: Observable<string | null> | null = null;

  readonly current = this.session.asReadonly();
  readonly isSignedIn = computed(() => this.session() !== null);
  readonly displayName = computed(() => this.session()?.displayName ?? '');
  readonly tenantId = computed(() => this.session()?.tenantId ?? null);

  /** Access token for the interceptor; null when signed out. */
  accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  hasRole(...roles: readonly string[]): boolean {
    const mine = this.session()?.roles ?? [];

    return roles.some((role) => mine.includes(role));
  }

  /** Menu, recipes and prices: managers and owners. */
  readonly canManageRestaurant = computed(() =>
    this.hasRoleIn(this.session()?.roles ?? [], [Roles.owner, Roles.manager]),
  );

  login(email: string, password: string): Observable<AuthSession> {
    return this.http
      .post<AuthResponse>(`${this.baseUrl}/api/v1/auth/login`, { email, password })
      .pipe(
        map(toSession),
        tap((session) => this.store(session)),
      );
  }

  /**
   * Swaps the refresh token for a new pair. Shared between concurrent callers: several requests
   * failing at once must not each spend the refresh token, since rotation means only the first
   * would succeed and the rest would look like a replay and kill the session.
   */
  refresh(): Observable<string | null> {
    if (this.refreshing) return this.refreshing;

    const token = this.session()?.refreshToken;

    if (!token) return of(null);

    this.refreshing = this.http
      .post<AuthResponse>(`${this.baseUrl}/api/v1/auth/refresh`, { refreshToken: token })
      .pipe(
        map((response) => {
          const session = toSession(response);
          this.store(session);

          return session.accessToken;
        }),
        catchError(() => {
          // The refresh token is spent or revoked; there is nothing left to try.
          this.clear();

          return of(null);
        }),
        tap({ finalize: () => (this.refreshing = null) }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.refreshing;
  }

  /** Revokes this session's refresh token server-side, then forgets it locally either way. */
  logout(): void {
    const token = this.session()?.refreshToken;

    this.clear();

    if (!token) return;

    this.http
      .post(`${this.baseUrl}/api/v1/auth/logout`, { refreshToken: token })
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  /** Drops the session without calling the server — for a 401 that refresh could not fix. */
  clear(): void {
    this.session.set(null);

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode. The in-memory signal is the one that matters.
    }
  }

  private store(session: AuthSession): void {
    this.session.set(session);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Persistence is a convenience; the session still works for this tab.
    }
  }

  private hasRoleIn(mine: readonly string[], wanted: readonly string[]): boolean {
    return wanted.some((role) => mine.includes(role));
  }
}

function toSession(response: AuthResponse): AuthSession {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    tenantId: response.tenantId,
    tenantSlug: response.tenantSlug,
    displayName: response.displayName,
    roles: response.roles,
  };
}

function restore(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AuthSession>;

    // A half-written or stale shape is worse than no session: it would send a malformed
    // Authorization header on every request.
    return parsed?.accessToken && parsed?.refreshToken ? (parsed as AuthSession) : null;
  } catch {
    return null;
  }
}
