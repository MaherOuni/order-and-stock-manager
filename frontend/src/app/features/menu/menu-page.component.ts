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
        <div class="header__where">
          <p class="header__eyebrow">
            <app-icon name="dineIn" [size]="12" />
            Ordering for
          </p>
          <p class="header__table">Table {{ tableNumber() }}</p>
        </div>

        <button type="button" class="c-round c-round--ink help" (click)="helpOpen.set(true)">
          <app-icon name="alert" [size]="18" />
          <span class="visually-hidden">Help</span>
        </button>
      </div>

      <h1 class="header__name">{{ tenant()?.name ?? 'Menu' }}</h1>

      <input
        class="c-field search"
        type="search"
        [value]="search()"
        (input)="search.set(text($event))"
        placeholder="Search dishes…"
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

      <main class="main" [class.main--with-bar]="!cart.isEmpty()">
        <div class="c-section">
          <h2 class="c-section__title">{{ sectionTitle() }}</h2>
          <span class="count">{{ visibleProducts().length }} items</span>
        </div>

        <div class="grid">
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
        </div>
      </main>
    }

    @if (!cart.isEmpty() && !checkoutOpen()) {
      <div class="bar">
        <button type="button" class="c-cta bar__cta" (click)="checkoutOpen.set(true)">
          <span class="bar__count">{{ cart.itemCount() }}</span>
          <span class="bar__text">View basket</span>
          <span class="bar__total">{{ cart.totalPrice() | money: currency() }}</span>
        </button>
      </div>
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
      /* A phone column, centred. These screens are drawn for a 375px frame, and letting them
         stretch across a laptop strands the add button a hand's width from its dish. */
      :host {
        display: block;
        max-width: 28rem;
        margin-inline: auto;
        min-height: 100dvh;
        background: var(--bg);
      }

      .header {
        padding: calc(env(safe-area-inset-top, 0) + 1.5rem) var(--gutter) 1rem;
        background: var(--bg);
      }

      .header__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .header__where {
        min-width: 0;
      }

      .header__eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.3125rem;
        margin: 0;
        color: var(--accent);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .header__table {
        margin: 0.25rem 0 0;
        color: var(--text);
        font-size: 0.875rem;
        font-weight: 700;
      }

      /* Regular rather than bold: the design leads with the place name at a light weight and
         saves the heavy weight for prices and buttons. */
      .header__name {
        margin: 1.25rem 0 0;
        color: var(--text);
        font-size: 1.5rem;
        font-weight: 400;
        line-height: 1.25;
        letter-spacing: -0.01em;
      }

      .search {
        margin-top: 1rem;
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .main {
        padding: 1.5rem var(--gutter) 2rem;
      }

      /* Room for the floating bar, so the last tile is never trapped underneath it. */
      .main--with-bar {
        padding-bottom: calc(7.5rem + env(safe-area-inset-bottom, 0));
      }

      .count {
        flex: 0 0 auto;
        color: var(--text-muted);
        font-size: 0.8125rem;
      }

      /* Two tiles across, the way the menu is drawn. Stretching them is what lets each card
         push its price row to the bottom and stay level with its neighbour. */
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
        gap: 1.25rem 1rem;
      }

      .empty {
        grid-column: 1 / -1;
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
        border: 3px solid var(--surface-2);
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
        padding: 0.625rem 1.25rem;
        border: 0;
        border-radius: var(--radius);
        background: var(--accent);
        color: var(--accent-contrast);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      /* The cart bar rides on its own shelf against the bottom edge, the way the design seats
         the order summary: an upward shadow rather than a rule, and no gap underneath. */
      .bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 30;
        max-width: 28rem;
        margin-inline: auto;
        padding: 1rem var(--gutter) calc(1rem + env(safe-area-inset-bottom, 0));
        background: var(--surface);
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        box-shadow: var(--shadow-lg);
        animation: bar-in 260ms var(--press-ease);
      }

      @keyframes bar-in {
        from {
          transform: translateY(100%);
        }
      }

      .bar__cta {
        justify-content: space-between;
      }

      .bar__count {
        display: grid;
        place-items: center;
        width: 1.625rem;
        height: 1.625rem;
        border-radius: 50%;
        background: rgb(255 255 255 / 25%);
        font-size: 0.8125rem;
        font-weight: 700;
      }

      .bar__text {
        flex: 1;
        text-align: left;
      }

      .bar__total {
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
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

  /**
   * What the grid is currently showing. The design gives the list a heading, and repeating
   * "Menu" over a filtered set would be a heading that tells the reader nothing.
   */
  protected readonly sectionTitle = computed(() => {
    if (this.search().trim()) return 'Results';

    const id = this.selectedCategoryId();

    return this.categories().find((category) => category.id === id)?.name ?? 'All dishes';
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
