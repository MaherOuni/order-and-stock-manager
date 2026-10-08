import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { signInForTests, signOutForTests } from '../../core/auth/auth.testing';
import { environment } from '../../../environments/environment';
import { OrderDto } from '../../core/api.models';
import { AdminShellComponent } from '../admin-shell.component';

const BASE = environment.apiBaseUrl;

function order(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 'o-1',
    tenantId: 't-1',
    orderType: 'DineIn',
    tableNumber: '12',
    customerName: null,
    customerPhone: null,
    deliveryAddress: null,
    allergyNotes: null,
    covers: 2,
    fulfilmentLabel: '12',
    paymentStatus: 'Unpaid',
    paymentMethod: 'Cash',
    totalAmountMillimes: 13500,
    cancellationReason: null,
    status: 'Pending',
    totalAmount: 13.5,
    createdAt: '2026-08-18T10:15:00Z',
    items: [
      {
        id: 'l-1',
        productId: 'p-latte',
        productName: 'Latte',
        quantity: 3,
        unitPrice: 4.5,
        lineTotal: 13.5,
        notes: null,
        customizations: [],
      },
    ],
    ...overrides,
  };
}

describe('OrderListComponent', () => {
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

    await harness.navigateByUrl('/admin/demo-resto/orders', AdminShellComponent);

    // The shell and the board each resolve the tenant; the board needs its id for the route.
    http
      .match(`${BASE}/api/v1/tenants/by-slug/demo-resto`)
      .forEach((request) =>
        request.flush({ id: 't-1', name: 'Chez Maher', slug: 'demo-resto', currency: 'TND' }),
      );

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

  function flushOrders(
    orders: OrderDto[],
    status: string | null = null,
    orderType: string | null = null,
  ): void {
    const request = http.expectOne(
      (candidate) =>
        candidate.url === `${BASE}/api/v1/orders/tenant/t-1` &&
        candidate.params.get('status') === status &&
        candidate.params.get('orderType') === orderType,
    );

    expect(request.request.headers.get('X-Tenant-Id')).toBe('demo-resto');

    request.flush(orders);
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

  // Otherwise one suite's session would sign the next one in.
  afterEach(() => signOutForTests());

  it('lists incoming orders with their table numbers and contents', () => {
    flushOrders([order(), order({ id: 'o-2', tableNumber: 'T4', status: 'Completed' })]);

    expect(rows().length).toBe(2);
    expect(rows()[0].textContent).toContain('12');
    expect(rows()[0].textContent).toContain('3× Latte');
    expect(rows()[1].textContent).toContain('T4');

    // Only a pending ticket can be closed.
    expect(rows()[0].querySelector('button')).not.toBeNull();
    expect(rows()[1].querySelector('button')).toBeNull();

    http.verify();
  });

  it('completes an order and folds the server response back into the row', () => {
    flushOrders([order()]);

    expect(rows()[0].textContent).toContain('Pending');

    buttonWith('Mark completed', rows()[0]).click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/orders/o-1/complete`);
    expect(posted.request.method).toBe('POST');
    expect(posted.request.headers.get('X-Tenant-Id')).toBe('demo-resto');

    posted.flush(order({ status: 'Completed' }));
    harness.detectChanges();

    expect(rows()[0].textContent).toContain('Completed');
    expect(rows()[0].querySelector('button')).toBeNull();

    // Patched, not refetched — the board does not blink while someone is reading it.
    http.verify();
  });

  it('re-queries when a status filter is active, so the row leaves the view', () => {
    flushOrders([order()]);

    buttonWith('Pending').click();
    harness.detectChanges();

    flushOrders([order()], 'Pending');

    buttonWith('Mark completed', rows()[0]).click();
    harness.detectChanges();

    http.expectOne(`${BASE}/api/v1/orders/o-1/complete`).flush(order({ status: 'Completed' }));
    harness.detectChanges();

    // A completed order no longer belongs in the Pending view, so this one does go back.
    flushOrders([], 'Pending');

    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain('No pending orders yet');

    http.verify();
  });

  it('surfaces the API refusal when an order is already served', () => {
    flushOrders([order()]);

    buttonWith('Mark completed', rows()[0]).click();
    harness.detectChanges();

    http.expectOne(`${BASE}/api/v1/orders/o-1/complete`).flush(
      {
        title: 'Business rule violated',
        detail: 'Only a pending order can be completed; this one is Completed.',
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    harness.detectChanges();

    expect(el().textContent).toContain('Only a pending order can be completed');
    // The row is untouched, so the board still reflects what the server believes.
    expect(rows()[0].textContent).toContain('Pending');

    http.verify();
  });

  it('can pause the live polling', () => {
    flushOrders([order()]);

    expect(buttonWith('Live')).toBeTruthy();

    buttonWith('Live').click();
    harness.detectChanges();

    expect(buttonWith('Paused')).toBeTruthy();

    http.verify();
  });
});
