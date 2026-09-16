import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { OrderDto, ProductDto } from '../core/api.models';
import { IngredientDto } from '../admin/data/admin.models';
import { handleDemoRequest, resetDemoState } from './demo-backend';

const BASE = 'http://localhost:5080';

async function call<T>(method: string, url: string, body: unknown = null): Promise<T> {
  const request = new HttpRequest(method as 'GET', `${BASE}${url}`, body, {});
  const response = (await firstValueFrom(handleDemoRequest(request))) as HttpResponse<T>;

  return response.body as T;
}

async function failure(method: string, url: string, body: unknown = null): Promise<HttpErrorResponse> {
  try {
    await call(method, url, body);
    throw new Error(`Expected ${method} ${url} to fail.`);
  } catch (error) {
    if (!(error instanceof HttpErrorResponse)) throw error;

    return error;
  }
}

describe('demo backend', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDemoState();
  });

  it('resolves any slug to the one demo restaurant, so a demo link never 404s', async () => {
    const tenant = await call<{ name: string; slug: string; currency: string }>(
      'GET',
      '/api/v1/tenants/by-slug/whatever-they-typed',
    );

    expect(tenant.name).toBe('Café Sidi Bou');
    expect(tenant.currency).toBe('TND');
    // Echoed back, so links built from it stay on the same URL.
    expect(tenant.slug).toBe('whatever-they-typed');
  });

  it('hides inactive products from the customer menu but shows them to the admin', async () => {
    const menu = await call<ProductDto[]>('GET', '/api/v1/products');
    const admin = await call<ProductDto[]>('GET', '/api/v1/products?includeInactive=true');

    expect(menu.some((p) => p.name === 'Makroudh aux dattes')).toBe(false);
    expect(admin.some((p) => p.name === 'Makroudh aux dattes')).toBe(true);

    // Recipe counts are derived, the way the real API computes them.
    expect(menu.find((p) => p.name === 'Express')!.recipeItemCount).toBe(3);
    expect(menu.find((p) => p.name === 'Eau minérale 50cl')!.recipeItemCount).toBe(0);
  });

  it('seeds ingredients already below their alert threshold', async () => {
    const low = await call<IngredientDto[]>('GET', '/api/v1/ingredients?lowStockOnly=true');

    // Milk is nearly out (1.2 L against a 4 L threshold) and mint is short, so the low-stock
    // dashboard has something to show the moment it is opened.
    expect(low.map((i) => i.name)).toEqual(['Lait', 'Menthe fraîche']);
    expect(low.every((i) => i.isBelowMinimum)).toBe(true);
  });

  it('places an order and deducts what its recipes consume', async () => {
    const products = await call<ProductDto[]>('GET', '/api/v1/products');
    const espresso = products.find((p) => p.name === 'Express')!;

    const order = await call<OrderDto>('POST', '/api/v1/orders', {
      tenantSlug: 'demo-resto',
      tableNumber: '12',
      items: [{ productId: espresso.id, quantity: 2 }],
    });

    expect(order.status).toBe('Pending');
    expect(order.totalAmount).toBe(4.4);
    expect(order.items[0].quantity).toBe(2);

    const ingredients = await call<IngredientDto[]>('GET', '/api/v1/ingredients');

    // 8.4 kg − 2 × 0.018, and 640 cups − 2.
    expect(ingredients.find((i) => i.name === 'Café en grains')!.currentStock).toBe(8.364);
    expect(ingredients.find((i) => i.name === 'Gobelets')!.currentStock).toBe(638);
  });

  it('refuses the whole order when one ingredient falls short, and deducts nothing', async () => {
    const products = await call<ProductDto[]>('GET', '/api/v1/products');
    const creme = products.find((p) => p.name === 'Café Crème')!;

    // Only 1.2 L of milk is seeded, and a Crème takes 0.2 L.
    const error = await failure('POST', '/api/v1/orders', {
      tenantSlug: 'demo-resto',
      tableNumber: '12',
      items: [{ productId: creme.id, quantity: 7 }],
    });

    expect(error.status).toBe(400);
    expect(error.error.shortages.length).toBe(1);
    expect(error.error.shortages[0].ingredientName).toBe('Lait');
    expect(error.error.shortages[0].missingQuantity).toBe(0.2);
    expect(error.error.shortages[0].blockedProductIds).toContain(creme.id);

    // All-or-nothing: the coffee that *was* sufficient is untouched, and no order exists.
    const ingredients = await call<IngredientDto[]>('GET', '/api/v1/ingredients');
    expect(ingredients.find((i) => i.name === 'Café en grains')!.currentStock).toBe(8.4);

    const orders = await call<OrderDto[]>('GET', '/api/v1/orders/tenant/anything');
    expect(orders.every((o) => o.tableNumber !== '12')).toBe(true);
  });

  it('restocks an ingredient and clears its low-stock flag', async () => {
    const ingredients = await call<IngredientDto[]>('GET', '/api/v1/ingredients');
    const mint = ingredients.find((i) => i.name === 'Menthe fraîche')!;

    const result = await call<IngredientDto>('POST', `/api/v1/ingredients/${mint.id}/adjust`, {
      changeAmount: 10,
      reason: 'Delivery',
      note: null,
    });

    expect(result.currentStock).toBe(13);
    expect(result.isBelowMinimum).toBe(false);

    // Mint is clear; milk is still low, which is the point of a per-ingredient threshold.
    const low = await call<IngredientDto[]>('GET', '/api/v1/ingredients?lowStockOnly=true');
    expect(low.map((i) => i.name)).toEqual(['Lait']);
  });

  it('refuses to write off more stock than exists', async () => {
    const ingredients = await call<IngredientDto[]>('GET', '/api/v1/ingredients');
    const milk = ingredients.find((i) => i.name === 'Lait')!;

    const error = await failure('POST', `/api/v1/ingredients/${milk.id}/adjust`, {
      changeAmount: -99,
      reason: 'Waste',
      note: null,
    });

    expect(error.status).toBe(409);
  });

  it('completes a pending order once, and refuses the second attempt', async () => {
    const orders = await call<OrderDto[]>('GET', '/api/v1/orders/tenant/anything?status=Pending');
    const pending = orders[0];

    const completed = await call<OrderDto>('POST', `/api/v1/orders/${pending.id}/complete`);
    expect(completed.status).toBe('Completed');

    const error = await failure('POST', `/api/v1/orders/${pending.id}/complete`);
    expect(error.status).toBe(422);
  });

  it('replaces a whole recipe, as the real endpoint does', async () => {
    const products = await call<ProductDto[]>('GET', '/api/v1/products');
    const water = products.find((p) => p.name === 'Eau minérale 50cl')!;
    const ingredients = await call<IngredientDto[]>('GET', '/api/v1/ingredients');
    const cups = ingredients.find((i) => i.name === 'Gobelets')!;

    const recipe = await call<{ items: unknown[]; maxProducibleUnits: number }>(
      'POST',
      `/api/v1/products/${water.id}/recipe`,
      { items: [{ ingredientId: cups.id, quantityRequired: 1 }] },
    );

    expect(recipe.items.length).toBe(1);
    expect(recipe.maxProducibleUnits).toBe(640);

    const cleared = await call<{ items: unknown[] }>('POST', `/api/v1/products/${water.id}/recipe`, {
      items: [],
    });

    expect(cleared.items).toEqual([]);
  });

  it('reports an unimplemented route rather than hanging', async () => {
    const error = await failure('GET', '/api/v1/stock/logs');

    expect(error.status).toBe(404);
    expect(error.error.detail).toContain('no route for');
  });
});
