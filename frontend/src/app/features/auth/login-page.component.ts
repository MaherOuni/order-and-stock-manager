import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Staff sign-in.
 *
 * Deliberately plain. It is opened on a counter tablet at the start of a shift, usually once a
 * day, and the only thing that matters is that it is quick and says clearly when it has failed.
 */
@Component({
  selector: 'app-login-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <form class="card" (submit)="submit($event)">
        <h1 class="title">Staff sign-in</h1>
        <p class="hint">Use the account your manager set up for you.</p>

        @if (demo) {
          <p class="demo" role="note">
            Demo: the fields are already filled in. Press <strong>Sign in</strong>.
          </p>
        }

        <label class="field">
          <span class="field__label">Email</span>
          <input
            class="input"
            type="email"
            name="email"
            autocomplete="username"
            [value]="email()"
            (input)="email.set(text($event))"
            required
          />
        </label>

        <label class="field">
          <span class="field__label">Password</span>
          <input
            class="input"
            type="password"
            name="password"
            autocomplete="current-password"
            [value]="password()"
            (input)="password.set(text($event))"
            required
          />
        </label>

        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }

        <button class="submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
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
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        width: min(24rem, 100%);
        padding: 1.75rem;
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-md);
      }

      .title {
        margin: 0;
        font-size: 1.375rem;
        font-weight: 700;
      }

      .hint,
      .demo {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.8125rem;
        line-height: 1.5;
      }

      .demo {
        padding: 0.625rem 0.75rem;
        border-radius: var(--radius-sm);
        background: var(--warning-surface);
        color: var(--warning-text);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin-top: 0.25rem;
      }

      .field__label {
        color: var(--text-muted);
        font-size: 0.75rem;
        font-weight: 650;
      }

      .input {
        width: 100%;
        padding: 0.75rem 0.875rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text);
        font: inherit;
      }

      .input:focus {
        outline: none;
        border-color: var(--accent);
      }

      .error {
        margin: 0;
        padding: 0.625rem 0.75rem;
        border-radius: var(--radius-sm);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.8125rem;
      }

      .submit {
        margin-top: 0.5rem;
        padding: 0.8125rem 1rem;
        border: 0;
        border-radius: var(--radius-sm);
        background: var(--accent);
        color: var(--accent-contrast);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .submit:disabled {
        opacity: 0.6;
        cursor: progress;
      }
    `,
  ],
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly demo = environment.demoMode;

  // Pre-filled in demo mode so a visitor is not asked to guess credentials that are published
  // two lines above the form anyway.
  protected readonly email = signal(this.demo ? 'owner@demo-resto.test' : '');
  protected readonly password = signal(this.demo ? 'demo-owner-password' : '');

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected submit(event: Event): void {
    event.preventDefault();

    if (this.busy()) return;

    this.busy.set(true);
    this.error.set(null);

    this.auth.login(this.email().trim(), this.password()).subscribe({
      next: (session) => {
        this.busy.set(false);

        // Back where they were headed, or their own restaurant's dashboard.
        const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');

        void this.router.navigateByUrl(returnUrl ?? `/admin/${session.tenantSlug}/overview`);
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(messageFor(failure));
      },
    });
  }
}

function messageFor(failure: unknown): string {
  if (failure instanceof HttpErrorResponse) {
    if (failure.status === 401) return 'That email and password did not match an active account.';
    if (failure.status === 400) return 'Enter both an email address and a password.';
    if (failure.status === 0) return 'Could not reach the server. Check the connection.';
  }

  return 'Something went wrong signing in. Try again.';
}
