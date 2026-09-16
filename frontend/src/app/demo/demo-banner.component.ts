import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { environment } from '../../environments/environment';

/**
 * Says, permanently and unmissably, that nothing here is real. A demo that looks like
 * production is how someone ends up believing an order reached a kitchen.
 */
@Component({
  selector: 'app-demo-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled) {
      <aside class="bar" role="note">
        <span class="dot" aria-hidden="true"></span>
        <span class="text">
          <strong>Demo</strong> — no backend. Data is seeded and lives in this browser only.
        </span>
        <button type="button" class="reset" (click)="reset()" [disabled]="resetting()">
          {{ resetting() ? 'Resetting…' : 'Reset data' }}
        </button>
      </aside>
    }
  `,
  styles: [
    `
      .bar {
        position: sticky;
        top: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.4375rem var(--gutter);
        padding-top: calc(env(safe-area-inset-top, 0) + 0.4375rem);
        background: var(--warning-surface);
        color: var(--warning-text);
        font-size: 0.75rem;
        line-height: 1.3;
      }

      .dot {
        flex: 0 0 auto;
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: currentColor;
      }

      .text {
        flex: 1;
        min-width: 0;
      }

      .reset {
        flex: 0 0 auto;
        padding: 0.1875rem 0.625rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 0.6875rem;
        font-weight: 700;
        cursor: pointer;
      }

      .reset:disabled {
        opacity: 0.6;
      }
    `,
  ],
})
export class DemoBannerComponent {
  protected readonly enabled = environment.demoMode;
  protected readonly resetting = signal(false);

  protected async reset(): Promise<void> {
    this.resetting.set(true);

    const backend = await import('./demo-backend');
    backend.resetDemoState();

    // A full reload is the honest way to clear every signal and cached list at once.
    location.reload();
  }
}
