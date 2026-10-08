import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { environment } from '../../../environments/environment';
import { ProductDto } from '../../core/api.models';
import { MenuPageComponent } from './menu-page.component';

const BASE = environment.apiBaseUrl;

const LATTE: ProductDto = {
  id: 'p-latte',
  categoryId: 'c-drinks',
  categoryName: 'Drinks',
  name: 'Latte',
  description: 'Espresso and steamed milk.',
  imageUrl: null,
  price: 4.5,
  isActive: true,
  recipeItemCount: 2,
};

const SALAD: ProductDto = {
  id: 'p-salad',
  categoryId: 'c-food',
  categoryName: 'Food',
  name: 'Salade tunisienne',
  description: null,
  imageUrl: null,
  price: 7,
  isActive: true,
  recipeItemCount: 0,
};

/**
 * What `/customizations` returns: ingredient names only. The full recipe — quantities, stock,
 * producible units — is staff-only, and the customer menu never sees it.
 */
const CUSTOMIZATIONS = {
  productId: 'p-latte',
  productName: 'Latte',
  items: [
    { ingredientId: 'i-milk', ingredientName: 'Milk' },
    { ingredientId: 'i-coffee', ingredientName: 'Coffee' },
  ],
};

describe('MenuPageComponent', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          routes,
          withComponentInputBinding(),
          withRouterConfig({ paramsInheritanceStrategy: 'always' }),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideLocationMocks(),
      ],
    });

    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  function flushMenu(products: ProductDto[] = [LATTE, SALAD]): void {
    http
      .expectOne(`${BASE}/api/v1/tenants/by-slug/demo-resto`)
      .flush({ id: 't-1', name: 'Café Sidi Bou', slug: 'demo-resto', currency: 'TND' });

    http.expectOne(`${BASE}/api/v1/categories`).flush([
      { id: 'c-drinks', name: 'Drinks', sortOrder: 1, productCount: 1 },
      { id: 'c-food', name: 'Food', sortOrder: 2, productCount: 1 },
    ]);

    http.expectOne((c) => c.url === `${BASE}/api/v1/products`).flush(products);

    harness.detectChanges();
  }

  function el(): HTMLElement {
    return harness.routeNativeElement!;
  }

  function text(): string {
    return el().textContent ?? '';
  }

  /** Matches on contained text: buttons here wrap badges and prices around their label. */
  function buttonWith(label: string, scope: ParentNode = el()): HTMLButtonElement {
    const match = Array.from(scope.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    );

    if (!match) throw new Error(`No button labelled "${label}"`);

    return match;
  }

  async function openMenu(): Promise<void> {
    await harness.navigateByUrl('/demo-resto/table/12', MenuPageComponent);
  }

  /** Opens a product's sheet and answers the customizations request it fires. */
  function openProduct(name: string): void {
    // The whole card is the tap target, and it leads with the image tile, so match on content.
    const card = Array.from(el().querySelectorAll('button.card')).find((button) =>
      button.textContent?.includes(name),
    ) as HTMLButtonElement | undefined;

    if (!card) throw new Error(`No product card for "${name}"`);

    card.click();
    harness.detectChanges();

    http.expectOne(`${BASE}/api/v1/products/p-latte/customizations`).flush(CUSTOMIZATIONS);
    harness.detectChanges();
  }

  it('reads the tenant and table straight off the route', async () => {
    await openMenu();
    flushMenu();

    expect(text()).toContain('Table 12');
    expect(text()).toContain('Café Sidi Bou');
    expect(text()).toContain('Latte');

    http.verify();
  });

  it('filters the menu by search as well as category', async () => {
    await openMenu();
    flushMenu();

    const search = el().querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'salade';
    search.dispatchEvent(new Event('input'));
    harness.detectChanges();

    expect(text()).toContain('Salade tunisienne');
    expect(text()).not.toContain('Espresso and steamed milk');
  });

  it('offers the product’s own ingredients to change, and sends them with the order', async () => {
    await openMenu();
    flushMenu();

    openProduct('Latte');

    // The options come from the recipe, so only what is actually in it can be changed.
    expect(text()).toContain('Milk');
    expect(text()).toContain('Coffee');

    // "None" on the milk, and a preference note.
    const milkRow = Array.from(el().querySelectorAll('.option')).find((row) =>
      row.textContent?.includes('Milk'),
    )!;
    buttonWith('None', milkRow).click();

    const note = el().querySelector('.note') as HTMLInputElement;
    note.value = 'Extra hot';
    note.dispatchEvent(new Event('input'));
    harness.detectChanges();

    buttonWith('Add').click();
    harness.detectChanges();

    expect(text()).toContain('View basket');

    buttonWith('View basket').click();
    harness.detectChanges();

    // The basket shows the change back to the customer before they commit.
    expect(text()).toContain('− Milk');
    expect(text()).toContain('Extra hot');

    buttonWith('Place order').click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/orders`);
    expect(posted.request.body).toEqual({
      tenantSlug: 'demo-resto',
      items: [
        {
          productId: 'p-latte',
          quantity: 1,
          notes: 'Extra hot',
          customizations: [{ ingredientId: 'i-milk', kind: 'Removed' }],
        },
      ],
      orderType: 'DineIn',
      tableNumber: '12',
      customerName: null,
      customerPhone: null,
      deliveryAddress: null,
      allergyNotes: null,
      // Dine-in asks how many are eating; the floor plan only knows capacity.
      covers: 2,
      paymentMethod: 'Cash',
    });

    posted.flush({ id: 'o-9' });
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/demo-resto/order-status/o-9');

    http.match(() => true).forEach((c) => c.flush({}, { status: 500, statusText: 'x' }));
  });

  it('asks for an address before it will send a delivery order', async () => {
    await openMenu();
    flushMenu();

    openProduct('Latte');
    buttonWith('Add').click();
    harness.detectChanges();

    buttonWith('View basket').click();
    harness.detectChanges();

    buttonWith('Delivery').click();
    harness.detectChanges();

    // Refused locally rather than after a round trip. The CTA follows the payment method,
    // which is still Cash here.
    expect(text()).toContain('We need an address to deliver to');
    expect(buttonWith('Place order').disabled).toBe(true);

    const inputs = Array.from(el().querySelectorAll('.input')) as HTMLInputElement[];
    const address = inputs.find((i) => i.placeholder.includes('Street'))!;
    const phone = inputs.find((i) => i.type === 'tel')!;

    address.value = 'Rue de Marseille 14';
    address.dispatchEvent(new Event('input'));
    phone.value = '+216 20 111 222';
    phone.dispatchEvent(new Event('input'));
    harness.detectChanges();

    expect(buttonWith('Place order').disabled).toBe(false);
  });

  it('names the unavailable dish when the kitchen is out of stock', async () => {
    await openMenu();
    flushMenu([LATTE]);

    openProduct('Latte');
    buttonWith('Add').click();
    harness.detectChanges();

    buttonWith('View basket').click();
    harness.detectChanges();

    buttonWith('Place order').click();
    harness.detectChanges();

    http.expectOne(`${BASE}/api/v1/orders`).flush(
      {
        title: 'Insufficient stock',
        status: 400,
        shortages: [
          {
            ingredientId: 'i-milk',
            ingredientName: 'Milk',
            unit: 'L',
            requiredQuantity: 0.2,
            availableQuantity: 0,
            missingQuantity: 0.2,
            blockedProductIds: ['p-latte'],
          },
        ],
      },
      { status: 400, statusText: 'Bad Request' },
    );

    harness.detectChanges();

    // "Milk" means nothing at a table; the blocked dish does.
    expect(text()).toContain('Latte');
    expect(text()).not.toContain('short 0.2');
  });

  it('calls a waiter from the menu', async () => {
    await openMenu();
    flushMenu();

    buttonWith('Help').click();
    harness.detectChanges();

    buttonWith('Ask for the bill').click();
    buttonWith('Send').click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/service-requests`);
    expect(posted.request.body).toEqual({
      tenantSlug: 'demo-resto',
      tableNumber: '12',
      kind: 'RequestBill',
      note: null,
    });

    posted.flush({
      id: 's-1',
      tableNumber: '12',
      kind: 'RequestBill',
      note: null,
      orderId: null,
      status: 'Open',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    });

    harness.detectChanges();

    expect(text()).toContain('Someone is on their way');
  });
});
