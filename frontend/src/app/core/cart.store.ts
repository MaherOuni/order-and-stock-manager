import { Injectable, computed, effect, signal } from '@angular/core';

import { CustomizationKind, OrderLineRequest, ProductDto } from './api.models';

/** One ingredient the customer changed on a line, kept with its name for display. */
export interface CartCustomization {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly kind: CustomizationKind;
}

export interface CartItem {
  /** Identifies the *line*, not the product: the same drink twice, made differently. */
  readonly lineId: string;
  readonly productId: string;
  readonly name: string;
  readonly unitPrice: number;
  readonly imageUrl: string | null;
  readonly quantity: number;
  readonly notes: string | null;
  readonly customizations: readonly CartCustomization[];
}

const STORAGE_PREFIX = 'qr-cart:';

/** Nobody orders 100 of anything from a table; the cap keeps a stuck "+" button harmless. */
const MAX_QUANTITY_PER_LINE = 99;

/**
 * The basket for one table, held in a signal exactly as the UI reads it.
 *
 * A line is not a product. "Two lattes, one without milk" is two lines, because folding them
 * together would lose the customisation — and the server deducts stock per line for the same
 * reason. Lines that are genuinely identical (same product, same note, same changes) do merge.
 *
 * Scoped to a tenant *and* a table, and persisted, so a phone discarding the tab does not throw
 * away a half-built order.
 */
@Injectable({ providedIn: 'root' })
export class CartStore {
  readonly cart = signal<CartItem[]>([]);

  private readonly scope = signal<string | null>(null);

  readonly itemCount = computed(() =>
    this.cart().reduce((total, item) => total + item.quantity, 0),
  );

  readonly totalPrice = computed(() =>
    round2(this.cart().reduce((total, item) => total + item.unitPrice * item.quantity, 0)),
  );

  readonly isEmpty = computed(() => this.cart().length === 0);

  constructor() {
    effect(() => {
      const scope = this.scope();
      const items = this.cart();

      if (scope !== null) write(scope, items);
    });
  }

  /** How many of this product are in the basket, across every line of it. */
  quantityOf(productId: string): number {
    return this.cart()
      .filter((item) => item.productId === productId)
      .reduce((total, item) => total + item.quantity, 0);
  }

  /** Points the basket at one table, restoring anything left there earlier. */
  bindTo(tenantSlug: string, tableNumber: string): void {
    const next = `${tenantSlug}::${tableNumber}`;

    if (this.scope() === next) return;

    this.scope.set(next);
    this.cart.set(read(next));
  }

  /**
   * Adds a configured line. Identical lines merge, so tapping "add" twice on a plain espresso
   * is a quantity of 2 rather than two rows.
   */
  add(
    product: ProductDto,
    quantity = 1,
    notes: string | null = null,
    customizations: readonly CartCustomization[] = [],
  ): void {
    const signature = signatureOf(product.id, notes, customizations);

    this.cart.update((items) => {
      const existing = items.find(
        (item) => signatureOf(item.productId, item.notes, item.customizations) === signature,
      );

      if (existing) {
        return items.map((item) =>
          item.lineId === existing.lineId
            ? { ...item, quantity: clamp(item.quantity + quantity) }
            : item,
        );
      }

      return [
        ...items,
        {
          lineId: newLineId(),
          productId: product.id,
          name: product.name,
          unitPrice: product.price,
          imageUrl: product.imageUrl,
          quantity: clamp(quantity),
          notes: notes?.trim() || null,
          customizations: [...customizations],
        },
      ];
    });
  }

  /** Sets an absolute quantity on one line; zero or less removes it. */
  setQuantity(lineId: string, quantity: number): void {
    const clamped = Math.min(Math.floor(quantity), MAX_QUANTITY_PER_LINE);

    this.cart.update((items) =>
      clamped <= 0
        ? items.filter((item) => item.lineId !== lineId)
        : items.map((item) => (item.lineId === lineId ? { ...item, quantity: clamped } : item)),
    );
  }

  remove(lineId: string): void {
    this.setQuantity(lineId, 0);
  }

  clear(): void {
    this.cart.set([]);
  }

  /** The basket in the shape POST /api/v1/orders wants. */
  toOrderLines(): OrderLineRequest[] {
    return this.cart().map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes,
      customizations: item.customizations.map((c) => ({
        ingredientId: c.ingredientId,
        kind: c.kind,
      })),
    }));
  }

  /**
   * Drops lines whose product is no longer on the menu — a reload after the kitchen
   * deactivated something would otherwise submit an order the API refuses.
   */
  reconcileWith(products: readonly ProductDto[]): void {
    const byId = new Map(products.map((product) => [product.id, product]));

    this.cart.update((items) =>
      items
        .filter((item) => byId.has(item.productId))
        // Prices are re-read too: the basket should show what the kitchen will charge.
        .map((item) => ({ ...item, unitPrice: byId.get(item.productId)!.price })),
    );
  }
}

function signatureOf(
  productId: string,
  notes: string | null | undefined,
  customizations: readonly CartCustomization[],
): string {
  const changes = customizations
    .map((c) => `${c.kind}:${c.ingredientId}`)
    .sort()
    .join(',');

  return `${productId}|${notes?.trim() ?? ''}|${changes}`;
}

function clamp(quantity: number): number {
  return Math.max(1, Math.min(Math.floor(quantity), MAX_QUANTITY_PER_LINE));
}

function newLineId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function read(scope: string): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    return Array.isArray(parsed) ? (parsed as CartItem[]).filter(isCartItem) : [];
  } catch {
    // Private mode, a full quota, or something else wrote nonsense under our key.
    return [];
  }
}

function write(scope: string, items: readonly CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(items));
  } catch {
    // Persistence is a convenience; the basket in memory is the real one.
  }
}

function isCartItem(value: unknown): value is CartItem {
  const item = value as Partial<CartItem> | null;

  return (
    !!item &&
    typeof item.lineId === 'string' &&
    typeof item.productId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.unitPrice === 'number' &&
    typeof item.quantity === 'number' &&
    item.quantity > 0 &&
    Array.isArray(item.customizations)
  );
}
