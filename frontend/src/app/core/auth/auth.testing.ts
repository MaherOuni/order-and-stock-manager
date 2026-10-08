import { AuthSession } from './auth.service';

const STORAGE_KEY = 'orderstock-session';

/**
 * Puts a signed-in Owner in storage so the admin guard lets a test through.
 *
 * AuthService restores from localStorage when it is first injected, which the guard does during
 * navigation — so this has to run before `navigateByUrl`, not after.
 */
export function signInForTests(tenantSlug = 'demo-resto', roles: readonly string[] = ['Owner']): void {
  const session: AuthSession = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    tenantId: 't-1',
    tenantSlug,
    displayName: 'Test Owner',
    roles,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/** Leaves storage as the suite found it, so one spec cannot sign another one in. */
export function signOutForTests(): void {
  localStorage.removeItem(STORAGE_KEY);
}
