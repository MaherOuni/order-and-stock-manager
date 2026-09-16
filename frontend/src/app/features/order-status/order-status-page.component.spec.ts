import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { environment } from '../../../environments/environment';
import { OrderDto } from '../../core/api.models';
import { OrderStatusPageComponent } from './order-status-page.component';

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
    status: 'Pending',
    paymentStatus: 'Unpaid',
    paymentMethod: 'Cash',
    totalAmountMillimes: 13500,
    totalAmount: 13.5,
    cancellationReason: null,
    createdAt: '2026-09-01T10:15:00Z',
    items: [
      {
        id: 'l-1',
        productId: 'p-latte',
        productName: 'Latte',
        quantity: 3,
        unitPrice: 4.5,
        lineTotal: 13.5,
        notes: 'Extra hot',
        customizations: [
          { ingredientId: 'i-milk', ingredientName: 'Milk', kind: 'Removed' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('OrderStatusPageComponent', () => {
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
  });

  async function open(id = 'o-1'): Promise<void> {
    await harness.navigateByUrl(`/demo-resto/order-status/${id}`, OrderStatusPageComponent);
  }

  /** The page loads the order, its review and the tenant (for the currency) together. */
  function flush(placed: OrderDto | null, review: unknown = null): void {
    const request = http.expectOne((c) => c.url === `${BASE}/api/v1/orders/${placed?.id ?? 'nope'}`);

    if (placed) request.flush(placed);
    else request.flush({ title: 'Resource not found' }, { status: 404, statusText: 'Not Found' });

    http
      .match((c) => c.url.endsWith('/review'))
      .filter((c) => !c.cancelled)
      .forEach((c) =>
        review
          ? c.flush(review)
          : c.flush({ title: 'not found' }, { status: 404, statusText: 'Not Found' }),
      );

    http
      .match(`${BASE}/api/v1/tenants/by-slug/demo-resto`)
      .filter((c) => !c.cancelled)
      .forEach((c) => c.flush({ id: 't-1', name: 'Café Sidi Bou', slug: 'demo-resto', currency: 'TND' }));
    http.match(`${BASE}/api/v1/categories`).filter((c) => !c.cancelled).forEach((c) => c.flush([]));
    http
      .match((c) => c.url === `${BASE}/api/v1/products`)
      .filter((c) => !c.cancelled)
      .forEach((c) => c.flush([]));

    harness.detectChanges();
  }

  function el(): HTMLElement {
    return harness.routeNativeElement!;
  }

  function buttonWith(label: string): HTMLButtonElement {
    const match = Array.from(el().querySelectorAll('button')).find((button) =>
      button.textContent?.trim().startsWith(label),
    );

    if (!match) throw new Error(`No button labelled "${label}"`);

    return match;
  }

  it('shows the receipt with customisations and the kitchen note', async () => {
    await open();
    flush(order({ allergyNotes: 'Nut allergy.' }));

    const text = el().textContent ?? '';

    expect(text).toContain('Latte');
    expect(text).toContain('3×');
    // Customisations and preferences are the customer's own words back to them.
    expect(text).toContain('Milk');
    expect(text).toContain('Extra hot');
    expect(text).toContain('Nut allergy.');
    expect(text).toContain('Dine-in');

    // Cash: nothing to wait for, so no payment spinner.
    expect(text).toContain('Pay at the counter');
    expect(text).not.toContain('Awaiting payment');
  });

  it('says it is waiting while a gateway payment is outstanding', async () => {
    await open();
    flush(order({ paymentMethod: 'Konnect' }));

    // The confirmation reaches the server as a webhook, so the page says it will keep looking.
    // (The 3s poll itself is a timer, exercised in the browser rather than here.)
    expect(el().textContent).toContain('Awaiting payment');
    expect(el().textContent).toContain('updates itself');
  });

  it('shows the kitchen has started once the payment has landed', async () => {
    await open();
    flush(order({ paymentMethod: 'Konnect', paymentStatus: 'Paid' }));

    expect(el().textContent).toContain('Payment received');
    expect(el().textContent).toContain('kitchen is preparing');
    expect(el().textContent).not.toContain('Awaiting payment');
  });

  it('cancels the order and shows what the API says about it', async () => {
    await open();
    flush(order());

    buttonWith('Cancel order').click();
    harness.detectChanges();

    buttonWith('Yes, cancel it').click();
    harness.detectChanges();

    const posted = http.expectOne((c) => c.url === `${BASE}/api/v1/orders/o-1/cancel`);
    expect(posted.request.method).toBe('POST');
    expect(posted.request.params.get('tenantSlug')).toBe('demo-resto');

    posted.flush(
      order({ status: 'Cancelled', cancellationReason: 'Changed our minds.' }),
    );
    harness.detectChanges();

    expect(el().textContent).toContain('Order cancelled');
    expect(el().textContent).toContain('Changed our minds.');
    // A cancelled order cannot be reviewed, and cannot be cancelled twice.
    expect(el().textContent).not.toContain('How was it?');
    expect(() => buttonWith('Cancel order')).toThrow();
  });

  it('sends a review and keeps it on screen', async () => {
    await open();
    flush(order({ status: 'Completed' }));

    const stars = Array.from(el().querySelectorAll('.star')) as HTMLButtonElement[];
    expect(stars.length).toBe(5);

    stars[3].click();
    harness.detectChanges();

    buttonWith('Send review').click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/orders/o-1/review`);
    expect(posted.request.body).toEqual({
      tenantSlug: 'demo-resto',
      rating: 4,
      comment: null,
    });

    posted.flush({
      id: 'r-1',
      orderId: 'o-1',
      rating: 4,
      comment: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    });

    harness.detectChanges();

    expect(el().textContent).toContain('Thanks for the feedback');
    expect(buttonWith('Update review')).toBeTruthy();
  });

  it('calls a waiter for the table the order was placed from', async () => {
    await open();
    flush(order());

    buttonWith('Call a waiter').click();
    harness.detectChanges();

    const posted = http.expectOne(`${BASE}/api/v1/service-requests`);
    expect(posted.request.body).toEqual({
      tenantSlug: 'demo-resto',
      tableNumber: '12',
      kind: 'CallWaiter',
      orderId: 'o-1',
    });

    posted.flush({
      id: 's-1',
      tableNumber: '12',
      kind: 'CallWaiter',
      note: null,
      orderId: 'o-1',
      status: 'Open',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    });

    harness.detectChanges();

    expect(el().textContent).toContain('Waiter on the way');
  });

  it('explains a missing order instead of showing an empty receipt', async () => {
    await open('nope');
    flush(null);

    // forkJoin cancels its siblings the moment one fails.
    http
      .match(() => true)
      .filter((c) => !c.cancelled)
      .forEach((c) => c.flush(null, { status: 404, statusText: 'x' }));

    harness.detectChanges();

    expect(el().textContent).toContain('cannot find that order');
  });
});
