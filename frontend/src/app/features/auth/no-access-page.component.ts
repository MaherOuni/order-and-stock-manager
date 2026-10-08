import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

/**
 * Signed in, but at the wrong restaurant's URL.
 *
 * Separate from the sign-in screen on purpose: sending someone back to a login form implies
 * better credentials would help, and they would not. Their account is fine; the address is not.
 */
@Component({
  selector: 'app-no-access-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <div class="card">
        <h1 class="title">Not your restaurant</h1>
        <p class="body">
          You are signed in as <strong>{{ auth.displayName() }}</strong
          >, who works at <strong>{{ auth.current()?.tenantSlug }}</strong
          >. That dashboard belongs to someone else.
        </p>

        <div class="actions">
          <button type="button" class="primary" (click)="goHome()">Go to my dashboard</button>
          <button type="button" class="ghost" (click)="signOut()">Sign out</button>
        </div>
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--surface-2);
      }

      .page {
        display: grid;
        place-items: center;
        min-height: 100dvh;
        padding: 1.5rem;
      }

      .card {
        width: min(26rem, 100%);
        padding: 1.75rem;
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-md);
      }

      .title {
        margin: 0 0 0.5rem;
        font-size: 1.25rem;
        font-weight: 700;
      }

      .body {
        margin: 0;
        color: var(--text-muted);
        line-height: 1.55;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1.25rem;
      }

      .primary,
      .ghost {
        flex: 1 1 10rem;
        padding: 0.75rem 1rem;
        border-radius: var(--radius-sm);
        font: inherit;
        font-weight: 650;
        cursor: pointer;
      }

      .primary {
        border: 0;
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .ghost {
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
      }
    `,
  ],
})
export class NoAccessPageComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);

  protected goHome(): void {
    const slug = this.auth.current()?.tenantSlug;

    void this.router.navigateByUrl(slug ? `/admin/${slug}/overview` : '/login');
  }

  protected signOut(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
