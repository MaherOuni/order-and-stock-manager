import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { signInForTests, signOutForTests } from '../../core/auth/auth.testing';
import { environment } from '../../../environments/environment';
import { ProductDto } from '../../core/api.models';
import { AdminShellComponent } from '../admin-shell.component';
import { IngredientDto } from '../data/admin.models';

const BASE = environment.apiBaseUrl;

const COFFEE: IngredientDto = {
  id: 'i-coffee',
  name: 'Coffee beans',
  unit: 'kg',
  currentStock: 12,
  minimumStockAlert: 2,
  isBelowMinimum: false,
};

const MILK: IngredientDto = {
  id: 'i-milk',
  name: 'Milk',
  unit: 'L',
  currentStock: 20,
  minimumStockAlert: 5,
  isBelowMinimum: false,
};

const ESPRESSO: ProductDto = {
  id: 'p-espresso',
  categoryId: 'c-drinks',
  categoryName: 'Drinks',
  name: 'Espresso',
  description: null,
  imageUrl: null,
  price: 3,
  isActive: true,
  recipeItemCount: 0,
};

describe('InventoryManagerComponent', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    // The admin guard redirects to /login without a session.
    signInForTests();

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

    await harness.navigateByUrl('/admin/demo-resto/inventory', AdminShellComponent);

    // The shell resolves the tenant, and so does the menu half of this page's forkJoin.
    http
      .match(`${BASE}/api/v1/tenants/by-slug/demo-resto`)
      .forEach((request) =>
        request.flush({ id: 't-1', name: 'Chez Maher', slug: 'demo-resto', currency: 'TND' }),
      );

    // The shell's badge queries only start once its tenant resolves, which is one change
    // detection later than the flush above.
    harness.detectChanges();
    flushShellBadges();

    http.expectOne(ownIngredients).flush([COFFEE, MILK]);

    http.expectOne(`${BASE}/api/v1/categories`).flush([
      { id: 'c-drinks', name: 'Drinks', sortOrder: 1, productCount: 1 },
    ]);

    const products = http.expectOne((candidate) => candidate.url === `${BASE}/api/v1/products`);
    // The admin table has to show what customers cannot see, too.
    expect(products.request.params.get('includeInactive')).toBe('true');
    products.flush([ESPRESSO]);

    harness.detectChanges();
  });

  /**
   * The shell fetches the pending-ticket and low-stock counts for its sidebar badges. Answering
   * them here keeps each test's http.verify() about the page under test.
   */
  function flushShellBadges(): void {
    http
      .match((r) => r.url === `${BASE}/api/v1/orders/tenant/t-1` && r.params.get('status') === 'Pending')
      .forEach((r) => r.flush([]));
    http
      .match((r) => r.url === `${BASE}/api/v1/ingredients` && r.params.get('lowStockOnly') === 'true')
      .forEach((r) => r.flush([]));
    http.match(`${BASE}/api/v1/service-requests`).forEach((r) => r.flush([]));
    http.match(`${BASE}/api/v1/reviews`).forEach((r) => r.flush([]));
  }

  /** The page's own ingredient list, told apart from the shell's low-stock badge query. */
  function ownIngredients(candidate: {
    url: string;
    params: { get(key: string): string | null };
  }): boolean {
    return (
      candidate.url === `${BASE}/api/v1/ingredients` &&
      candidate.params.get('lowStockOnly') === 'false'
    );
  }

  function el(): HTMLElement {
    return harness.routeNativeElement!;
  }

  function buttonWith(label: string, scope: ParentNode = el()): HTMLButtonElement {
    const match = Array.from(scope.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().startsWith(label),
    );

    if (!match) throw new Error(`No button labelled "${label}"`);

    return match;
  }

  function setNumber(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
  }

  // Otherwise one suite's session would sign the next one in.
  afterEach(() => signOutForTests());

  it('lists ingredients and the products whose recipes consume them', () => {
    expect(el().textContent).toContain('Coffee beans');
    expect(el().textContent).toContain('Milk');
    expect(el().textContent).toContain('Espresso');

    // No recipe yet, so the call to action says so.
    expect(buttonWith('Map ingredients')).toBeTruthy();

    http.verify();
  });

  it('maps a product to an ingredient and quantity, and saves the whole recipe', () => {
    buttonWith('Map ingredients').click();
    harness.detectChanges();

    http.expectOne(`${BASE}/api/v1/products/p-espresso/recipe`).flush({
      productId: 'p-espresso',
      productName: 'Espresso',
      items: [],
      maxProducibleUnits: 2147483647,
    });

    harness.detectChanges();

    expect(el().textContent).toContain('Recipe · Espresso');
    expect(el().textContent).toContain('unlimited');

    buttonWith('Add ingredient').click();
    harness.detectChanges();

    // "1 Espresso needs [ 0.018 ] kg of Coffee beans"
    expect(el().textContent).toContain('1 Espresso needs');

    const quantity = el().querySelector('.line__qty') as HTMLInputElement;
    setNumber(quantity, '0.018');

    buttonWith('Save recipe').click();
    harness.detectChanges();

    const posted = http.expectOne(
      (candidate) =>
        candidate.method === 'POST' && candidate.url === `${BASE}/api/v1/products/p-espresso/recipe`,
    );

    expect(posted.request.body).toEqual({
      items: [{ ingredientId: 'i-coffee', quantityRequired: 0.018 }],
    });

    posted.flush({
      productId: 'p-espresso',
      productName: 'Espresso',
      items: [
        {
          id: 'r-1',
          productId: 'p-espresso',
          ingredientId: 'i-coffee',
          ingredientName: 'Coffee beans',
          unit: 'kg',
          quantityRequired: 0.018,
          ingredientCurrentStock: 12,
        },
      ],
      maxProducibleUnits: 666,
    });

    harness.detectChanges();

    // Saving closes the modal and re-reads the list, because the recipe count is server-side.
    expect(el().textContent).not.toContain('Recipe · Espresso');

    http
      .match(`${BASE}/api/v1/tenants/by-slug/demo-resto`)
      .forEach((request) =>
        request.flush({ id: 't-1', name: 'Chez Maher', slug: 'demo-resto', currency: 'TND' }),
      );
    http.expectOne(ownIngredients).flush([COFFEE, MILK]);
    http.expectOne(`${BASE}/api/v1/categories`).flush([]);
    http
      .expectOne((candidate) => candidate.url === `${BASE}/api/v1/products`)
      .flush([{ ...ESPRESSO, recipeItemCount: 1 }]);

    harness.detectChanges();

    expect(buttonWith('Edit recipe')).toBeTruthy();
    http.verify();
  });

  it('blocks a save that would send a zero quantity', () => {
    buttonWith('Map ingredients').click();
    harness.detectChanges();

    http.expectOne(`${BASE}/api/v1/products/p-espresso/recipe`).flush({
      productId: 'p-espresso',
      productName: 'Espresso',
      items: [],
      maxProducibleUnits: 2147483647,
    });
    harness.detectChanges();

    buttonWith('Add ingredient').click();
    harness.detectChanges();

    setNumber(el().querySelector('.line__qty') as HTMLInputElement, '0');

    // The API answers 422 for this; refusing locally saves the round trip.
    expect(el().textContent).toContain('Every quantity must be greater than zero');
    expect(buttonWith('Save recipe').disabled).toBe(true);

    http.verify();
  });

  it('creates an ingredient with its opening stock', () => {
    buttonWith('New ingredient').click();
    harness.detectChanges();

    const nameInput = el().querySelector('.a-input:not(.a-input--num)') as HTMLInputElement;
    nameInput.value = 'Sugar';
    nameInput.dispatchEvent(new Event('input'));
    harness.detectChanges();

    const numbers = Array.from(
      el().querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[];

    // Opening stock, then the alert threshold.
    setNumber(numbers[0], '25');
    setNumber(numbers[1], '5');

    buttonWith('Save').click();
    harness.detectChanges();

    const posted = http.expectOne(
      (candidate) => candidate.method === 'POST' && candidate.url === `${BASE}/api/v1/ingredients`,
    );

    expect(posted.request.body).toEqual({
      name: 'Sugar',
      unit: 'kg',
      currentStock: 25,
      minimumStockAlert: 5,
    });

    posted.flush({
      id: 'i-sugar',
      name: 'Sugar',
      unit: 'kg',
      currentStock: 25,
      minimumStockAlert: 5,
      isBelowMinimum: false,
    });

    harness.detectChanges();

    // Drain the silent reload the save triggers.
    http.match(() => true).forEach((request) => request.flush([]));
  });
});
