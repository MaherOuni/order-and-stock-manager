import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NEVER, forkJoin, map, switchMap } from 'rxjs';

import { ORDER_TYPE_ICONS, ORDER_TYPE_LABELS, OrderDto } from '../../core/api.models';
import { loadResource } from '../../core/load-state';
import { MoneyPipe } from '../../core/money.pipe';
import { IconComponent } from '../../shared/icon.component';
import { AdminApiService } from '../data/admin-api.service';
import { IngredientDto } from '../data/admin.models';

interface Overview {
  readonly orders: readonly OrderDto[];
  readonly lowStock: readonly IngredientDto[];
  readonly currency: string;
}

/**
 * The dashboard home: the four numbers a manager checks before anything else, then the two
 * lists those numbers come from. Everything here is a read — the actions live on their own
 * pages, one click away.
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [DatePipe, RouterLink, MoneyPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Overview</h1>
          <p class="a-page__hint">{{ today() }}</p>
        </div>

        <button type="button" class="a-btn" [disabled]="data.loading()" (click)="data.reload()">
          Refresh
        </button>
      </div>

      @if (data.error(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (data.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else {
        <div class="a-stats">
          <div class="a-stat">
            <span class="a-stat__icon"><app-icon name="orders" [size]="20" /></span>
            <div>
              <p class="a-stat__label">Orders today</p>
              <p class="a-stat__value">{{ todayOrders().length }}</p>
              <p class="a-stat__meta">{{ pending().length }} still in the kitchen</p>
            </div>
          </div>

          <div class="a-stat">
            <span class="a-stat__icon"><app-icon name="cash" [size]="20" /></span>
            <div>
              <p class="a-stat__label">Revenue today</p>
              <p class="a-stat__value">{{ revenue() | money: currency() }}</p>
              <p class="a-stat__meta">{{ averageTicket() | money: currency() }} average ticket</p>
            </div>
          </div>

          <div class="a-stat">
            <span class="a-stat__icon"><app-icon name="clock" [size]="20" /></span>
            <div>
              <p class="a-stat__label">Open tickets</p>
              <p class="a-stat__value">{{ pending().length }}</p>
              <p class="a-stat__meta">{{ typeSummary() }}</p>
            </div>
          </div>

          <div class="a-stat">
            <span class="a-stat__icon"><app-icon name="alert" [size]="20" /></span>
            <div>
              <p class="a-stat__label">Running low</p>
              <p class="a-stat__value">{{ lowStock().length }}</p>
              <p class="a-stat__meta">
                {{ lowStock().length === 0 ? 'Everything above threshold' : 'Needs restocking' }}
              </p>
            </div>
          </div>
        </div>

        <div class="split">
          <div class="a-card">
            <div class="a-card__head">
              <h2 class="a-card__title">Open tickets</h2>
              <a class="a-btn a-btn--sm" routerLink="../orders">Open board</a>
            </div>

            <div class="a-table-wrap">
              <table class="a-table">
                <tbody>
                  @for (order of pending().slice(0, 6); track order.id) {
                    <tr>
                      <td>
                        <div class="a-media">
                          <span class="type" [attr.title]="label(order)">
                            <app-icon [name]="icon(order)" [size]="16" />
                          </span>
                          <div>
                            <strong>{{ order.tableNumber }}</strong>
                            <div class="a-muted">{{ label(order) }}</div>
                          </div>
                        </div>
                      </td>
                      <td class="a-wrap a-muted">{{ summarise(order) }}</td>
                      <td class="a-num">{{ order.totalAmount | money: currency() }}</td>
                      <td class="a-num a-muted">{{ order.createdAt | date: 'shortTime' }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td><p class="a-empty">Nothing waiting. Quiet moment.</p></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="a-card">
            <div class="a-card__head">
              <h2 class="a-card__title">Running low</h2>
              <a class="a-btn a-btn--sm" routerLink="../stock">Restock</a>
            </div>

            <div class="a-table-wrap">
              <table class="a-table">
                <tbody>
                  @for (ingredient of lowStock(); track ingredient.id) {
                    <tr>
                      <td>
                        <strong>{{ ingredient.name }}</strong>
                        <div class="a-muted">
                          alert below {{ ingredient.minimumStockAlert }} {{ ingredient.unit }}
                        </div>
                      </td>
                      <td class="a-num">
                        <span class="a-badge a-badge--danger">
                          {{ ingredient.currentStock }} {{ ingredient.unit }}
                        </span>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td><p class="a-empty">Every ingredient is above its threshold.</p></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .split {
        display: grid;
        gap: 1rem;
      }

      @media (min-width: 68rem) {
        .split {
          grid-template-columns: 1.4fr 1fr;
          align-items: start;
        }
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
})
export class OverviewComponent {
  readonly tenantSlug = input.required<string>();

  private readonly api = inject(AdminApiService);

  private readonly tenant = loadResource(this.tenantSlug, (slug) => this.api.getTenant(slug));

  protected readonly data = loadResource(
    computed(() => ({ slug: this.tenantSlug(), tenantId: this.tenant.data()?.id ?? null })),
    ({ slug, tenantId }) =>
      tenantId === null
        ? NEVER
        : forkJoin({
            orders: this.api.getOrders(slug, tenantId, null),
            lowStock: this.api.getIngredients(slug, true),
          }).pipe(
            map(
              ({ orders, lowStock }): Overview => ({
                orders,
                lowStock,
                currency: this.tenant.data()?.currency ?? 'TND',
              }),
            ),
          ),
  );

  protected readonly currency = computed(() => this.tenant.data()?.currency ?? 'TND');

  private readonly orders = computed<readonly OrderDto[]>(() => this.data.data()?.orders ?? []);

  protected readonly lowStock = computed<readonly IngredientDto[]>(
    () => this.data.data()?.lowStock ?? [],
  );

  protected readonly todayOrders = computed(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return this.orders().filter((order) => new Date(order.createdAt) >= start);
  });

  protected readonly pending = computed(() =>
    this.orders().filter((order) => order.status === 'Pending'),
  );

  /** Cancelled orders were never collected, so they do not count as takings. */
  protected readonly revenue = computed(() =>
    this.todayOrders()
      .filter((order) => order.status !== 'Cancelled')
      .reduce((total, order) => total + order.totalAmount, 0),
  );

  protected readonly averageTicket = computed(() => {
    const counted = this.todayOrders().filter((order) => order.status !== 'Cancelled');

    return counted.length === 0 ? 0 : this.revenue() / counted.length;
  });

  protected readonly typeSummary = computed(() => {
    const pending = this.pending();

    if (pending.length === 0) return 'Nothing waiting';

    return (['DineIn', 'Takeaway', 'Delivery'] as const)
      .map((type) => ({ type, count: pending.filter((o) => o.orderType === type).length }))
      .filter(({ count }) => count > 0)
      .map(({ type, count }) => `${count} ${ORDER_TYPE_LABELS[type].toLowerCase()}`)
      .join(' · ');
  });

  protected readonly today = computed(() =>
    new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );

  protected label(order: OrderDto): string {
    return ORDER_TYPE_LABELS[order.orderType] ?? 'Dine-in';
  }

  protected icon(order: OrderDto): string {
    return ORDER_TYPE_ICONS[order.orderType] ?? 'dineIn';
  }

  protected summarise(order: OrderDto): string {
    return order.items.map((line) => `${line.quantity}× ${line.productName}`).join(', ') || '—';
  }
}
