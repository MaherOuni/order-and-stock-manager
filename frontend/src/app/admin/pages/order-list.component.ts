import { DatePipe } from '@angular/common';
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
import { NEVER, interval } from 'rxjs';

import {
  ORDER_TYPES,
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  OrderDto,
  OrderStatus,
  OrderType,
} from '../../core/api.models';
import { MoneyPipe } from '../../core/money.pipe';
import { describeHttpError, loadResource } from '../../core/load-state';
import { IconComponent } from '../../shared/icon.component';
import { AdminApiService } from '../data/admin-api.service';

const FILTERS: readonly (OrderStatus | null)[] = [null, 'Pending', 'Completed', 'Cancelled'];

const POLL_MS = 10_000;

/**
 * The live board. Orders arrive from phones at tables, so it polls — silently, so the table
 * does not blank under someone's finger every ten seconds.
 */
@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [DatePipe, MoneyPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .type {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: var(--radius-sm);
        background: var(--accent-soft);
        color: var(--accent);
      }
    `,
  ],
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Orders</h1>
          <p class="a-page__hint">
            Placed from the tables. Completing one closes the ticket; the stock went when it was
            ordered.
          </p>
        </div>

        <div class="a-toolbar">
          <button
            type="button"
            class="a-btn"
            [class.a-btn--primary]="autoRefresh()"
            [attr.aria-pressed]="autoRefresh()"
            (click)="autoRefresh.set(!autoRefresh())"
          >
            {{ autoRefresh() ? 'Live' : 'Paused' }}
          </button>
          <button
            type="button"
            class="a-btn"
            [disabled]="board.loading()"
            (click)="board.reload({ silent: true })"
          >
            Refresh
          </button>
        </div>
      </div>

      <div class="filters">
        <div class="a-pills" role="group" aria-label="Filter by status">
          @for (option of filters; track option) {
            <button
              type="button"
              class="a-pill"
              [class.a-pill--active]="status() === option"
              (click)="status.set(option)"
            >
              {{ option ?? 'All' }}
            </button>
          }
        </div>

        <div class="a-pills" role="group" aria-label="Filter by order type">
          <button
            type="button"
            class="a-pill"
            [class.a-pill--active]="orderType() === null"
            (click)="orderType.set(null)"
          >
            Every type
          </button>
          @for (type of orderTypes; track type) {
            <button
              type="button"
              class="a-pill"
              [class.a-pill--active]="orderType() === type"
              (click)="orderType.set(type)"
            >
              <app-icon [name]="typeIcon(type)" [size]="15" />
              {{ typeLabel(type) }}
            </button>
          }
        </div>
      </div>

      @if (errorMessage(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (rowError(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else {
        <div class="a-card a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Placed</th>
                <th class="a-wrap">Items</th>
                <th class="a-num">Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (order of orders(); track order.id) {
                <tr>
                  <td>
                    <div class="a-media">
                      <span class="type" [attr.title]="typeLabel(order.orderType)">
                        <app-icon [name]="typeIcon(order.orderType)" [size]="16" />
                      </span>
                      <div>
                        <strong>{{ order.tableNumber }}</strong>
                        <div class="a-muted">{{ typeLabel(order.orderType) }}</div>
                      </div>
                    </div>
                  </td>
                  <td>{{ order.createdAt | date: 'shortTime' }}</td>
                  <td class="a-wrap">{{ summarise(order) }}</td>
                  <td class="a-num">{{ order.totalAmount | money: currency() }}</td>
                  <td>
                    <span class="a-badge" [class]="'a-badge ' + badgeClass(order.status)">
                      {{ order.status }}
                    </span>
                  </td>
                  <td>
                    @if (order.status === 'Pending') {
                      <button
                        type="button"
                        class="a-btn a-btn--sm a-btn--primary"
                        [disabled]="completing() === order.id"
                        (click)="complete(order)"
                      >
                        {{ completing() === order.id ? 'Saving…' : 'Mark completed' }}
                      </button>
                    } @else {
                      <span class="a-muted">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6">
                    <p class="a-empty">
                      No {{ status() ? (status() ?? '').toLowerCase() : '' }} orders yet.
                    </p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class OrderListComponent {
  readonly tenantSlug = input.required<string>();

  protected readonly filters = FILTERS;

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly orderTypes = ORDER_TYPES;

  protected readonly status = signal<OrderStatus | null>(null);
  protected readonly orderType = signal<OrderType | null>(null);
  protected readonly autoRefresh = signal(true);

  /**
   * Resolved once, not per refresh: the board route is addressed by tenant *id*, and polling
   * every ten seconds should cost one request, not two.
   */
  private readonly tenant = loadResource(
    computed(() => this.tenantSlug()),
    (slug) => this.api.getTenant(slug),
  );

  protected readonly board = loadResource(
    computed(() => ({
      slug: this.tenantSlug(),
      tenantId: this.tenant.data()?.id ?? null,
      status: this.status(),
      orderType: this.orderType(),
    })),
    ({ slug, tenantId, status, orderType }) =>
      // NEVER keeps the board in its loading state until the tenant id arrives; the params
      // change then re-runs this with a real id.
      tenantId === null ? NEVER : this.api.getOrders(slug, tenantId, status, orderType),
  );

  protected readonly orders = computed<readonly OrderDto[]>(() => this.board.data() ?? []);
  protected readonly currency = computed(() => this.tenant.data()?.currency ?? 'USD');
  protected readonly loading = computed(() => this.tenant.loading() || this.board.loading());
  protected readonly errorMessage = computed(() => this.tenant.error() ?? this.board.error());

  protected readonly completing = signal<string | null>(null);
  protected readonly rowError = signal<string | null>(null);

  constructor() {
    // Polling starts and stops with the toggle, so it is an effect rather than a field.
    effect((onCleanup) => {
      if (!this.autoRefresh()) return;

      const subscription = interval(POLL_MS).subscribe(() =>
        this.board.reload({ silent: true }),
      );

      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected typeLabel(type: OrderType): string {
    return ORDER_TYPE_LABELS[type] ?? 'Dine-in';
  }

  protected typeIcon(type: OrderType): string {
    return ORDER_TYPE_ICONS[type] ?? 'dineIn';
  }

  protected summarise(order: OrderDto): string {
    if (order.items.length === 0) return '—';

    return order.items.map((line) => `${line.quantity}× ${line.productName}`).join(', ');
  }

  protected badgeClass(status: OrderStatus): string {
    switch (status) {
      case 'Completed':
        return 'a-badge--success';
      case 'Cancelled':
        return 'a-badge--danger';
      default:
        return 'a-badge--warning';
    }
  }

  protected complete(order: OrderDto): void {
    if (this.completing()) return;

    this.completing.set(order.id);
    this.rowError.set(null);

    this.api
      .completeOrder(this.tenantSlug(), order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.completing.set(null);

          // Fold the server's own version of the row back in, rather than refetching the board
          // out from under whoever is reading it.
          this.board.patch((orders) =>
            orders.map((existing) => (existing.id === updated.id ? updated : existing)),
          );

          // A filtered view has to drop the row that no longer matches.
          if (this.status() !== null) this.board.reload({ silent: true });
        },
        error: (error: unknown) => {
          this.completing.set(null);
          this.rowError.set(describeHttpError(error));
        },
      });
  }
}
