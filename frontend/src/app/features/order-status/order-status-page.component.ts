import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin, interval, map } from 'rxjs';

import { ORDER_TYPE_LABELS, OrderDto, OrderReviewDto } from '../../core/api.models';
import { loadResource } from '../../core/load-state';
import { MenuApiService } from '../../core/menu-api.service';
import { MoneyPipe } from '../../core/money.pipe';
import { OrderApiService } from '../../core/order-api.service';
import { IconComponent } from '../../shared/icon.component';

/** How often the page asks whether a gateway payment has landed. */
const POLL_MS = 3000;

interface StatusView {
  readonly order: OrderDto;
  readonly review: OrderReviewDto | null;
  readonly currency: string;
}

/**
 * What happens after "order". It answers the three questions a customer actually has: has my
 * money gone through, is the kitchen making it, and can I still change my mind.
 *
 * While a gateway payment is outstanding the page polls every few seconds — the confirmation
 * arrives at the server as a webhook, so the phone has no other way to hear about it.
 */
@Component({
  selector: 'app-order-status-page',
  standalone: true,
  imports: [DatePipe, RouterLink, MoneyPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.loading()) {
      <div class="state" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <p>Fetching your order…</p>
      </div>
    } @else if (state.error()) {
      <div class="state state--error" role="alert">
        <p>{{ state.error() }}</p>
        <button type="button" class="ghost" (click)="state.reload()">Try again</button>
      </div>
    } @else {
      @if (order(); as placed) {
      <main class="page">
        <div class="hero" [class]="'hero--' + tone()">
          <div class="hero__badge" aria-hidden="true">{{ glyph() }}</div>
          <h1>{{ headline() }}</h1>
          <p class="hero__sub">{{ subline() }}</p>

          <div class="hero__meta">
            <span class="pill">
              <app-icon [name]="typeIcon()" [size]="14" />
              {{ typeLabel() }}
            </span>
            <span class="pill">{{ placed.fulfilmentLabel }}</span>
            <span class="pill">{{ placed.createdAt | date: 'shortTime' }}</span>
          </div>
        </div>

        @if (awaitingPayment()) {
          <p class="waiting" role="status">
            <span class="spinner spinner--sm" aria-hidden="true"></span>
            Waiting for {{ placed.paymentMethod }} to confirm. This page updates itself.
          </p>
        }

        @if (placed.allergyNotes) {
          <p class="allergy">
            <strong>Kitchen note:</strong>
            {{ placed.allergyNotes }}
          </p>
        }

        @if (placed.cancellationReason) {
          <p class="allergy allergy--danger">{{ placed.cancellationReason }}</p>
        }

        <section class="receipt" aria-label="Order summary">
          @for (line of placed.items; track line.id) {
            <div class="line">
              <span class="line__qty">{{ line.quantity }}×</span>
              <span class="line__text">
                <span>{{ line.productName }}</span>

                @if (line.customizations.length > 0) {
                  <span class="chips">
                    @for (change of line.customizations; track change.ingredientId) {
                      <span class="chip" [class.chip--add]="change.kind === 'Added'">
                        {{ change.kind === 'Added' ? '+' : '−' }} {{ change.ingredientName }}
                      </span>
                    }
                  </span>
                }

                @if (line.notes) {
                  <span class="note">“{{ line.notes }}”</span>
                }
              </span>
              <span class="line__total">{{ line.lineTotal | money: currency() }}</span>
            </div>
          }

          <div class="line line--total">
            <span class="line__text">Total · {{ paymentLabel() }}</span>
            <span class="line__total">{{ placed.totalAmount | money: currency() }}</span>
          </div>
        </section>

        @if (actionError(); as message) {
          <p class="allergy allergy--danger">{{ message }}</p>
        }

        <div class="actions">
          @if (canCancel()) {
            @if (confirmingCancel()) {
              <button type="button" class="danger" [disabled]="busy()" (click)="cancel()">
                {{ busy() ? 'Cancelling…' : 'Yes, cancel it' }}
              </button>
              <button type="button" class="ghost" (click)="confirmingCancel.set(false)">Keep it</button>
            } @else {
              <button type="button" class="ghost" (click)="confirmingCancel.set(true)">
                Cancel order
              </button>
            }
          }

          <button type="button" class="ghost" [disabled]="helpSent()" (click)="callWaiter()">
            {{ helpSent() ? 'Waiter on the way' : 'Call a waiter' }}
          </button>

          <a class="primary" [routerLink]="['/', tenantSlug(), 'table', backToTable()]">
            Order more
          </a>
        </div>

        @if (canReview()) {
          <section class="review">
            <h2>{{ review() ? 'Thanks for the feedback' : 'How was it?' }}</h2>

            <div class="stars" role="group" aria-label="Rating">
              @for (star of stars; track star) {
                <button
                  type="button"
                  class="star"
                  [class.star--on]="star <= rating()"
                  [attr.aria-label]="star + ' star' + (star === 1 ? '' : 's')"
                  (click)="rating.set(star)"
                >
                  ★
                </button>
              }
            </div>

            <input
              class="input"
              [value]="comment()"
              (input)="comment.set(text($event))"
              placeholder="Anything you want to tell them? (optional)"
              maxlength="1000"
            />

            <button
              type="button"
              class="primary"
              [disabled]="busy() || rating() === 0"
              (click)="submitReview()"
            >
              {{ review() ? 'Update review' : 'Send review' }}
            </button>
          </section>
        }

        <p class="reference">Reference <code>{{ placed.id }}</code></p>
      </main>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--bg);
      }

      .page {
        max-width: 32rem;
        margin: 0 auto;
        padding: calc(env(safe-area-inset-top, 0) + 1.5rem) var(--gutter)
          calc(env(safe-area-inset-bottom, 0) + 2rem);
      }

      .hero {
        padding: 1.5rem 1.25rem;
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-xl);
        box-shadow: var(--shadow-sm);
        text-align: center;
      }

      .hero__badge {
        display: grid;
        place-items: center;
        width: 3.25rem;
        height: 3.25rem;
        margin: 0 auto 0.875rem;
        border-radius: 50%;
        font-size: 1.5rem;
        font-weight: 700;
        background: var(--surface-3);
        color: var(--text-muted);
      }

      .hero--ok .hero__badge {
        background: var(--success-surface);
        color: var(--success-text);
      }

      .hero--wait .hero__badge {
        background: var(--warning-surface);
        color: var(--warning-text);
      }

      .hero--bad .hero__badge {
        background: var(--danger-surface);
        color: var(--danger-text);
      }

      h1 {
        margin: 0;
        font-size: 1.375rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .hero__sub {
        margin: 0.3125rem 0 0.875rem;
        color: var(--text-muted);
        font-size: 0.875rem;
      }

      .hero__meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.375rem;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1875rem 0.5625rem;
        border-radius: var(--radius-pill);
        background: var(--surface-3);
        color: var(--text-muted);
        font-size: 0.75rem;
        font-weight: 650;
      }

      .waiting {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.875rem 0 0;
        padding: 0.6875rem 0.875rem;
        border-radius: var(--radius);
        background: var(--warning-surface);
        color: var(--warning-text);
        font-size: 0.8125rem;
      }

      .allergy {
        margin: 0.875rem 0 0;
        padding: 0.6875rem 0.875rem;
        border-radius: var(--radius);
        background: var(--surface-3);
        color: var(--text-muted);
        font-size: 0.8125rem;
      }

      .allergy--danger {
        background: var(--danger-surface);
        color: var(--danger-text);
      }

      .receipt {
        margin-top: 1rem;
        padding: 1rem;
        background: var(--surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xl);
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .line {
        display: grid;
        grid-template-columns: 2rem 1fr auto;
        gap: 0.5rem;
        align-items: start;
        font-size: 0.9375rem;
      }

      .line--total {
        grid-template-columns: 1fr auto;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
        font-weight: 700;
      }

      .line__qty {
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
      }

      .line__text {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      .chip {
        padding: 0.0625rem 0.4375rem;
        border-radius: var(--radius-pill);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.6875rem;
        font-weight: 650;
      }

      .chip--add {
        background: var(--success-surface);
        color: var(--success-text);
      }

      .note {
        color: var(--text-muted);
        font-size: 0.75rem;
      }

      .line__total {
        font-variant-numeric: tabular-nums;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1.25rem;
      }

      .ghost,
      .primary,
      .danger {
        flex: 1 1 8rem;
        min-height: 3rem;
        padding: 0.8125rem 1rem;
        border: 0;
        border-radius: var(--radius);
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-align: center;
        text-transform: uppercase;
        text-decoration: none;
        cursor: pointer;
        transition: transform var(--press-dur) var(--press-ease);
      }

      .ghost:active:not(:disabled),
      .primary:active:not(:disabled),
      .danger:active:not(:disabled) {
        transform: scale(var(--press-scale));
      }

      .ghost {
        background: var(--surface-2);
        color: var(--text);
      }

      .ghost:disabled {
        color: var(--text-faint);
      }

      .primary {
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .primary:disabled {
        opacity: 0.55;
      }

      .danger {
        background: var(--danger-surface);
        color: var(--danger-text);
      }

      .review {
        margin-top: 1.5rem;
        padding: 1.125rem;
        background: var(--surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xl);
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .review h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }

      .stars {
        display: flex;
        gap: 0.25rem;
      }

      .star {
        border: 0;
        background: transparent;
        color: var(--border-strong);
        font-size: 1.75rem;
        line-height: 1;
        padding: 0;
        cursor: pointer;
      }

      .star--on {
        color: #f5a524;
      }

      .input {
        width: 100%;
        padding: 0.875rem 1.125rem;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        background: var(--surface-2);
        color: var(--text);
        font: inherit;
        font-size: 0.875rem;
      }

      .reference {
        margin: 1.25rem 0 0;
        color: var(--text-faint);
        font-size: 0.75rem;
        text-align: center;
        word-break: break-all;
      }

      .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.875rem;
        padding: 4rem var(--gutter);
        color: var(--text-muted);
        text-align: center;
      }

      .state--error {
        color: var(--danger-text);
      }

      .spinner {
        width: 1.75rem;
        height: 1.75rem;
        border: 3px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      .spinner--sm {
        width: 0.875rem;
        height: 0.875rem;
        border-width: 2px;
        border-top-color: currentColor;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class OrderStatusPageComponent {
  /** Bound from the route by `withComponentInputBinding()`. */
  readonly tenantSlug = input.required<string>();
  readonly orderId = input.required<string>();

  private readonly orderApi = inject(OrderApiService);
  private readonly menuApi = inject(MenuApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly stars = [1, 2, 3, 4, 5];

  protected readonly state = loadResource(
    computed(() => ({ slug: this.tenantSlug(), id: this.orderId() })),
    ({ slug, id }) =>
      // The order carries no currency of its own, and the review may not exist yet.
      forkJoin({
        order: this.orderApi.getOrder(slug, id),
        review: this.orderApi.getReview(slug, id),
        menu: this.menuApi.loadMenu(slug),
      }).pipe(
        map(
          ({ order, review, menu }): StatusView => ({
            order,
            review,
            currency: menu.tenant.currency,
          }),
        ),
      ),
    // "Request failed (404)" is not something to show a customer holding a phone.
    { describeError: describe },
  );

  protected readonly order = computed(() => this.state.data()?.order ?? null);
  protected readonly review = computed(() => this.state.data()?.review ?? null);
  protected readonly currency = computed(() => this.state.data()?.currency ?? 'TND');

  protected readonly awaitingPayment = computed(() => {
    const order = this.order();

    return (
      !!order &&
      order.paymentMethod !== 'Cash' &&
      order.paymentStatus === 'Unpaid' &&
      order.status === 'Pending'
    );
  });

  protected readonly canCancel = computed(() => this.order()?.status === 'Pending');

  protected readonly canReview = computed(() => {
    const order = this.order();

    return !!order && order.status !== 'Cancelled';
  });

  protected readonly tone = computed(() => {
    const order = this.order();

    if (!order) return 'wait';
    if (order.status === 'Cancelled') return 'bad';
    if (order.paymentStatus === 'Failed') return 'bad';
    if (this.awaitingPayment()) return 'wait';

    return 'ok';
  });

  protected readonly glyph = computed(() =>
    this.tone() === 'bad' ? '!' : this.tone() === 'wait' ? '…' : '✓',
  );

  protected readonly headline = computed(() => {
    const order = this.order();

    if (!order) return '';
    if (order.status === 'Cancelled') return 'Order cancelled';
    if (order.status === 'Completed') return 'Served — enjoy';
    if (order.paymentStatus === 'Failed') return 'Payment failed';
    if (this.awaitingPayment()) return 'Awaiting payment…';

    return 'Payment received';
  });

  protected readonly subline = computed(() => {
    const order = this.order();

    if (!order) return '';
    if (order.status === 'Cancelled') return 'Nothing will be prepared.';
    if (order.status === 'Completed') return 'Thanks for coming in.';
    if (order.paymentStatus === 'Failed') return 'Nothing was charged. Try another method.';
    if (this.awaitingPayment()) return 'Finish the payment on your phone to start the order.';
    if (order.paymentMethod === 'Cash') return 'The kitchen is preparing your order. Pay at the counter.';

    return 'The kitchen is preparing your order!';
  });

  protected readonly typeLabel = computed(() =>
    this.order() ? ORDER_TYPE_LABELS[this.order()!.orderType] : '',
  );

  protected readonly typeIcon = computed(() => {
    const type = this.order()?.orderType;

    return type === 'Takeaway' ? 'takeaway' : type === 'Delivery' ? 'delivery' : 'dineIn';
  });

  protected readonly paymentLabel = computed(() => {
    const order = this.order();

    if (!order) return '';

    return order.paymentStatus === 'Paid'
      ? `paid by ${order.paymentMethod}`
      : order.paymentMethod === 'Cash'
        ? 'to pay at the counter'
        : 'not yet paid';
  });

  /** A takeaway or delivery has no table, so "order more" goes back to a sensible default. */
  protected readonly backToTable = computed(() => this.order()?.tableNumber ?? '1');

  protected readonly rating = signal(0);
  protected readonly comment = signal('');
  protected readonly confirmingCancel = signal(false);
  protected readonly busy = signal(false);
  protected readonly helpSent = signal(false);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    // Seeds the form from an existing review, once, without clobbering later typing.
    effect(
      () => {
        const review = this.review();

        if (review && this.rating() === 0) {
          this.rating.set(review.rating);
          this.comment.set(review.comment ?? '');
        }
      },
      { allowSignalWrites: true },
    );

    // The confirmation reaches the server as a webhook, so the phone has to ask.
    effect((onCleanup) => {
      if (!this.awaitingPayment()) return;

      const subscription = interval(POLL_MS).subscribe(() =>
        this.state.reload({ silent: true }),
      );

      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected cancel(): void {
    if (this.busy()) return;

    this.busy.set(true);
    this.actionError.set(null);

    this.orderApi
      .cancelOrder(this.tenantSlug(), this.orderId(), {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.busy.set(false);
          this.confirmingCancel.set(false);
          this.state.patch((view) => ({ ...view, order }));
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.actionError.set(describe(error));
        },
      });
  }

  protected callWaiter(): void {
    const order = this.order();

    if (!order || this.busy()) return;

    this.actionError.set(null);

    this.orderApi
      .callForHelp({
        tenantSlug: this.tenantSlug(),
        // A takeaway has no table; the counter is where someone will look.
        tableNumber: order.tableNumber ?? order.fulfilmentLabel,
        kind: 'CallWaiter',
        orderId: order.id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.helpSent.set(true),
        error: (error: unknown) => this.actionError.set(describe(error)),
      });
  }

  protected submitReview(): void {
    if (this.busy() || this.rating() === 0) return;

    this.busy.set(true);
    this.actionError.set(null);

    this.orderApi
      .submitReview(this.orderId(), {
        tenantSlug: this.tenantSlug(),
        rating: this.rating(),
        comment: this.comment().trim() || null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (review) => {
          this.busy.set(false);
          this.state.patch((view) => ({ ...view, review }));
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.actionError.set(describe(error));
        },
      });
  }
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the restaurant. Check your connection.';
    if (error.status === 404) return 'We cannot find that order.';

    const detail = (error.error as { detail?: string } | null)?.detail;

    if (detail) return detail;
  }

  return 'Something went wrong. Try again in a moment.';
}
