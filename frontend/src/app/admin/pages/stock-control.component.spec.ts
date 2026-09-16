import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { environment } from '../../../environments/environment';
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
  currentStock: 1.5,
  minimumStockAlert: 5,
  isBelowMinimum: true,
};

describe('StockControlComponent', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
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

    // The harness reports the top-level routed component, which for a child route is the shell.
    await harness.navigateByUrl('/admin/demo-resto/stock', AdminShellComponent);

    flushTenant();
    // The shell's badge queries only start once its tenant resolves, which is one change
    // detection later than the flush above.
    harness.detectChanges();
    flushShellBadges();
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

  function flushTenant(): void {
    http
      .match(`${BASE}/api/v1/tenants/by-slug/demo-resto`)
      .forEach((request) =>
        request.flush({ id: 't-1', name: 'Chez Maher', slug: 'demo-resto', currency: 'TND' }),
      );
  }

  function flushIngredients(ingredients: IngredientDto[], lowOnly = false): void {
    const request = http.expectOne(
      (candidate) =>
        candidate.url === `${BASE}/api/v1/ingredients` &&
        candidate.params.get('lowStockOnly') === String(lowOnly),
    );

    // Every admin call is tenant-scoped by the header, never by a body field.
    expect(request.request.headers.get('X-Tenant-Id')).toBe('demo-resto');

    request.flush(ingredients);
    harness.detectChanges();
  }

  function el(): HTMLElement {
    return harness.routeNativeElement!;
  }

  function rows(): HTMLTableRowElement[] {
    return Array.from(el().querySelectorAll('tbody tr'));
  }

  function buttonWith(label: string, scope: ParentNode = el()): HTMLButtonElement {
    const match = Array.from(scope.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().startsWith(label),
    );

    if (!match) throw new Error(`No button labelled "${label}"`);

    return match;
  }

  it('flags every ingredient at or below its alert threshold', () => {
    flushIngredients([COFFEE, MILK]);

    expect(el().textContent).toContain('1 ingredient is at or below the alert threshold');

    const [coffeeRow, milkRow] = rows();

    expect(coffeeRow.textContent).toContain('OK');
    expect(coffeeRow.classList).not.toContain('a-row--alert');

    // The red badge is the whole point of this page.
    expect(milkRow.querySelector('.a-badge--danger')!.textContent!.trim()).toBe('Low');
    expect(milkRow.classList).toContain('a-row--alert');

    http.verify();
  });

  it('logs a restock and updates the row from the response', () => {
    flushIngredients([COFFEE, MILK]);

    buttonWith('Restock', rows()[1]).click();
    harness.detectChanges();

    const quantity = el().querySelector('input[type="number"]') as HTMLInputElement;
    quantity.value = '10';
    quantity.dispatchEvent(new Event('input'));
    harness.detectChanges();

    // The projection tells the manager what the shelf will read afterwards.
    expect(el().textContent).toContain('11.5 L');

    buttonWith('Log movement').click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/ingredients/i-milk/adjust`);
    expect(posted.request.method).toBe('POST');
    expect(posted.request.body).toEqual({
      changeAmount: 10,
      reason: 'Delivery',
      note: null,
    });

    posted.flush({
      ingredientId: 'i-milk',
      ingredientName: 'Milk',
      unit: 'L',
      currentStock: 11.5,
      minimumStockAlert: 5,
      isBelowMinimum: false,
    });

    harness.detectChanges();

    const milkRow = rows()[1];
    expect(milkRow.textContent).toContain('11.5 L');
    expect(milkRow.querySelector('.a-badge--danger')).toBeNull();
    expect(el().textContent).toContain('Everything is above its alert threshold');

    // Patched in place: no second GET, so the table never blinked.
    http.verify();
  });

  it('sends a negative change amount when writing stock off', () => {
    flushIngredients([COFFEE, MILK]);

    buttonWith('Write off', rows()[0]).click();
    harness.detectChanges();

    const quantity = el().querySelector('input[type="number"]') as HTMLInputElement;
    quantity.value = '0.75';
    quantity.dispatchEvent(new Event('input'));
    harness.detectChanges();

    buttonWith('Log movement').click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/ingredients/i-coffee/adjust`);
    expect(posted.request.body).toEqual({
      changeAmount: -0.75,
      reason: 'Waste',
      note: null,
    });

    posted.flush({
      ingredientId: 'i-coffee',
      ingredientName: 'Coffee beans',
      unit: 'kg',
      currentStock: 11.25,
      minimumStockAlert: 2,
      isBelowMinimum: false,
    });

    harness.detectChanges();

    expect(rows()[0].textContent).toContain('11.25 kg');
    http.verify();
  });

  it('refuses to send a write-off larger than the stock on hand', () => {
    flushIngredients([MILK]);

    buttonWith('Write off', rows()[0]).click();
    harness.detectChanges();

    const quantity = el().querySelector('input[type="number"]') as HTMLInputElement;
    quantity.value = '99';
    quantity.dispatchEvent(new Event('input'));
    harness.detectChanges();

    // The API would refuse this with a 409; saying so before the round trip is kinder.
    expect(el().textContent).toContain('You cannot remove more than there is');
    expect(buttonWith('Log movement').disabled).toBe(true);

    http.verify();
  });

  it('re-queries the API when the low-stock filter is switched on', () => {
    flushIngredients([COFFEE, MILK]);

    buttonWith('Show low only').click();
    harness.detectChanges();

    // A different filter is a different question, so this one goes back to the server.
    flushIngredients([MILK], true);

    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain('Milk');

    http.verify();
  });

  it('shows the API error rather than an empty table', () => {
    http
      .expectOne((candidate) => candidate.url === `${BASE}/api/v1/ingredients`)
      .flush({ title: 'Tenant not found', detail: 'No tenant matches that slug.' }, {
        status: 404,
        statusText: 'Not Found',
      });

    harness.detectChanges();

    expect(el().textContent).toContain('No tenant matches that slug.');
  });
});
