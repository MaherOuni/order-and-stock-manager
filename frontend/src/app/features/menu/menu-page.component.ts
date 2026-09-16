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
import { Router } from '@angular/router';

import { ProductDto } from '../../core/api.models';
import { CartStore } from '../../core/cart.store';
import { loadResource } from '../../core/load-state';
import { MenuApiService } from '../../core/menu-api.service';
import { MoneyPipe } from '../../core/money.pipe';
import { OrderApiService, problemOf } from '../../core/order-api.service';
import { IconComponent } from '../../shared/icon.component';
import { CheckoutDetails, CheckoutSheetComponent } from './checkout-sheet.component';
import { CategoryTabsComponent } from './category-tabs.component';
import { HelpRequest, HelpSheetComponent } from './help-sheet.component';
import { ProductCardComponent } from './product-card.component';
import { ProductSelection, ProductSheetComponent } from './product-sheet.component';

/**
 * The menu a customer sees after scanning. Everything they can do lives here or one sheet away:
 * browse, configure an item, call a waiter, and check out.
 */
@Component({
  selector: 'app-menu-page',
  standalone: true,
  imports: [
    CategoryTabsComponent,
    ProductCardComponent,
    ProductSheetComponent,
    CheckoutSheetComponent,
    HelpSheetComponent,
    IconComponent,
    MoneyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      <div class="header__row">
        <div>
          <p class="header__eyebrow">
            <app-icon name="dineIn" [size]="14" />
            Table {{ tableNumber() }}
          </p>
          <h1 class="header__name">{{ tenant()?.name ?? 'Menu' }}</h1>
        </div>

        <button type="button" class="help" (click)="helpOpen.set(true)">
          <app-icon name="alert" [size]="16" />
          <span>Help</span>
        </button>
      </div>

      <input
        class="search"
        type="search"
        [value]="search()"
        (input)="search.set(text($event))"
        placeholder="Search the menu…"
        aria-label="Search the menu"
      />
    </header>

    @if (menu.loading()) {
      <div class="state" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <p>Loading the menu…</p>
      </div>
    } @else if (menu.error()) {
      <div class="state state--error" role="alert">
        <p>{{ menu.error() }}</p>
        <button type="button" class="retry" (click)="menu.reload()">Try again</button>
      </div>
    } @else {
      <app-category-tabs
        [categories]="categories()"
        [selectedId]="selectedCategoryId()"
        (select)="selectedCategoryId.set($event)"
      />

      <main class="list" [class.list--with-bar]="!cart.isEmpty()">
        @for (product of visibleProducts(); track product.id) {
          <app-product-card
            [product]="product"
            [currency]="currency()"
            [quantity]="cart.quantityOf(product.id)"
            (open)="selectedProduct.set($event)"
          />
        } @empty {
          <p class="empty">Nothing matches. Try another section.</p>
        }
      </main>
    }

    @if (!cart.isEmpty() && !checkoutOpen()) {
      <button type="button" class="bar" (click)="checkoutOpen.set(true)">
        <span class="bar__count">{{ cart.itemCount() }}</span>
        <span class="bar__text">View basket</span>
        <span class="bar__total">{{ cart.totalPrice() | money: currency() }}</span>
      </button>
    }

    @if (selectedProduct(); as product) {
      <app-product-sheet
        [tenantSlug]="tenantSlug()"
        [product]="product"
        [currency]="currency()"
        (dismiss)="selectedProduct.set(null)"
        (add)="addToCart($event)"
      />
    }

    @if (checkoutOpen()) {
      <app-checkout-sheet
        [items]="cart.cart()"
        [total]="cart.totalPrice()"
        [currency]="currency()"
        [defaultTable]="tableNumber()"
        [submitting]="submitting()"
        [errorMessage]="submitError()"
        (dismiss)="checkoutOpen.set(false)"
        (quantityChange)="cart.setQuantity($event.lineId, $event.quantity)"
        (submit)="placeOrder($event)"
      />
    }

    @if (helpOpen()) {
      <app-help-sheet
        [tableNumber]="tableNumber()"
        [sending]="helpSending()"
        [sent]="helpSent()"
        [errorMessage]="helpError()"
        (dismiss)="closeHelp()"
        (send_)="callForHelp($event)"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--bg);
      }

      .header {
        padding: calc(env(safe-area-inset-top, 0) + 1.25rem) var(--gutter) 0.875rem;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .header__row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .header__eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.3125rem;
        margin: 0;
        padding: 0.1875rem 0.5625rem;
        border-radius: var(--radius-pill);
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
      }

      .header__name {
        margin: 0.375rem 0 0;
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.02em;
      }

      .help {
        display: inline-flex;
        align-items: center;
        gap: 0.3125rem;
        padding: 0.4375rem 0.8125rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--text-muted);
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 650;
        cursor: pointer;
      }

      .search {
        width: 100%;
        margin-top: 0.875rem;
        padding: 0.6875rem 0.875rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--surface-2);
        color: var(--text);
        font: inherit;
        font-size: 0.9375rem;
      }

      .search:focus {
        outline: none;
        border-color: var(--accent);
        background: var(--surface);
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.875rem var(--gutter);
      }

      /* Room for the floating bar, so the last item is never trapped underneath it. */
      .list--with-bar {
        padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0));
      }

      .empty {
        margin: 2rem 0;
        text-align: center;
        color: var(--text-muted);
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

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .retry {
        padding: 0.5rem 1.125rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .bar {
        position: fixed;
        left: var(--gutter);
        right: var(--gutter);
        bottom: calc(env(safe-area-inset-bottom, 0) + 0.875rem);
        z-index: 30;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.8125rem 1rem;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--accent);
        color: var(--accent-contrast);
        font: inherit;
        box-shadow: var(--shadow-lg);
        cursor: pointer;
      }

      .bar__count {
        display: grid;
        place-items: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 50%;
        background: rgb(255 255 255 / 22%);
        font-size: 0.8125rem;
        font-weight: 700;
      }

      .bar__text {
        flex: 1;
        text-align: left;
        font-weight: 700;
      }

      .bar__total {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class MenuPageComponent {
  /** Bound from the route by `withComponentInputBinding()`. */
  readonly tenantSlug = input.required<string>();
  readonly tableNumber = input.required<string>();

  protected readonly cart = inject(CartStore);

  private readonly menuApi = inject(MenuApiService);
  private readonly orderApi = inject(OrderApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly menu = loadResource(
    computed(() => this.tenantSlug()),
    (slug) => this.menuApi.loadMenu(slug),
  );

  protected readonly tenant = computed(() => this.menu.data()?.tenant ?? null);
  protected readonly currency = computed(() => this.tenant()?.currency ?? 'TND');
  protected readonly categories = computed(() => this.menu.data()?.categories ?? []);
  protected readonly products = computed(() => this.menu.data()?.products ?? []);

  protected readonly selectedCategoryId = signal<string | null>(null);
  protected readonly search = signal('');

  protected readonly visibleProducts = computed(() => {
    const categoryId = this.selectedCategoryId();
    const term = this.search().trim().toLowerCase();

    return this.products()
      .filter((product) => categoryId === null || product.categoryId === categoryId)
      .filter(
        (product) =>
          !term ||
          product.name.toLowerCase().includes(term) ||
          (product.description ?? '').toLowerCase().includes(term),
      );
  });

  protected readonly selectedProduct = signal<ProductDto | null>(null);
  protected readonly checkoutOpen = signal(false);
  protected readonly helpOpen = signal(false);

  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected readonly helpSending = signal(false);
  protected readonly helpSent = signal(false);
  protected readonly helpError = signal<string | null>(null);

  constructor() {
    // allowSignalWrites: these move state *into* the store in response to route and menu
    // changes, which is the case the flag is meant for.
    effect(
      () => {
        this.cart.bindTo(this.tenantSlug(), this.tableNumber());
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const products = this.products();

        // A basket restored from storage may name something the kitchen has since pulled.
        if (products.length > 0) this.cart.reconcileWith(products);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const selected = this.selectedCategoryId();
        const categories = this.categories();

        if (selected !== null && !categories.some((category) => category.id === selected)) {
          this.selectedCategoryId.set(null);
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected addToCart(selection: ProductSelection): void {
    this.cart.add(
      selection.product,
      selection.quantity,
      selection.notes,
      selection.customizations,
    );

    this.selectedProduct.set(null);
  }

  protected closeHelp(): void {
    this.helpOpen.set(false);
    this.helpSent.set(false);
    this.helpError.set(null);
  }

  protected callForHelp(request: HelpRequest): void {
    if (this.helpSending()) return;

    this.helpSending.set(true);
    this.helpError.set(null);

    this.orderApi
      .callForHelp({
        tenantSlug: this.tenantSlug(),
        tableNumber: this.tableNumber(),
        kind: request.kind,
        note: request.note,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.helpSending.set(false);
          this.helpSent.set(true);
        },
        error: (error: unknown) => {
          this.helpSending.set(false);
          this.helpError.set(describe(error));
        },
      });
  }

  protected placeOrder(details: CheckoutDetails): void {
    if (this.cart.isEmpty() || this.submitting()) return;

    this.submitting.set(true);
    this.submitError.set(null);

    this.orderApi
      .placeOrder({
        tenantSlug: this.tenantSlug(),
        items: this.cart.toOrderLines(),
        orderType: details.orderType,
        tableNumber: details.tableNumber,
        customerName: details.customerName,
        customerPhone: details.customerPhone,
        deliveryAddress: details.deliveryAddress,
        allergyNotes: details.allergyNotes,
        covers: details.covers,
        paymentMethod: details.paymentMethod,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          // Cleared only once the server has the order, so a failure keeps the basket intact.
          this.cart.clear();
          this.checkoutOpen.set(false);
          void this.router.navigate(['/', this.tenantSlug(), 'order-status', order.id]);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.submitError.set(this.describeOrderFailure(error));
        },
      });
  }

  /**
   * Turns the API's problem document into something a customer can act on. A stock shortage
   * comes back naming *ingredients*, which mean nothing at a table — so the products they
   * block get named instead.
   */
  private describeOrderFailure(error: unknown): string {
    const problem = problemOf(error);
    const shortages = problem?.shortages ?? [];

    if (shortages.length > 0) {
      const blockedIds = new Set(shortages.flatMap((shortage) => shortage.blockedProductIds));
      const names = this.products()
        .filter((product) => blockedIds.has(product.id))
        .map((product) => product.name);

      return names.length > 0
        ? `Sorry — the kitchen just ran out. Unavailable right now: ${names.join(', ')}. Remove it to order the rest.`
        : 'Sorry — the kitchen just ran out of something in your basket.';
    }

    if (error instanceof HttpErrorResponse && error.status === 404) {
      return 'Something in your basket is no longer on the menu. Refresh and try again.';
    }

    return problem?.detail ?? describe(error);
  }
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Cannot reach the restaurant. Check your connection and try again.';
    if (error.status === 404) return 'This restaurant does not exist. Check the QR code and try again.';
  }

  return 'Something went wrong. Try again in a moment.';
}
