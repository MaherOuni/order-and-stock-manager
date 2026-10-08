import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, defer, delay, of, throwError } from 'rxjs';

import {
  CategoryDto,
  CustomizationKind,
  OrderDto,
  OrderReviewDto,
  OrderStatus,
  OrderType,
  ProductDto,
  ServiceRequestDto,
  ServiceRequestKind,
  ServiceRequestStatus,
} from '../core/api.models';
import { IngredientDto } from '../admin/data/admin.models';
import { DEMO_STATE_VERSION, DemoState, seedDemoState } from './demo-data';

/**
 * An in-memory stand-in for the .NET API, good enough to drive the whole UI.
 *
 * It is not a mock in the testing sense — it keeps state, deducts stock through recipes, and
 * refuses an order it cannot fulfil, because those are the behaviours worth showing. What it
 * deliberately does not do is enforce tenancy: there is one restaurant, and any slug resolves
 * to it, so a demo link never 404s on a typo.
 */

const STORAGE_KEY = 'orderstock-demo-state';

/** Enough latency for spinners and disabled buttons to be visible, not enough to annoy. */
const LATENCY_MS = 220;

let state: DemoState = load();

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as DemoState) : null;

    // A stale snapshot from an older seed would be more confusing than a fresh start.
    if (parsed?.version === DEMO_STATE_VERSION) return parsed;
  } catch {
    // Private mode, or something else wrote nonsense under our key.
  }

  return seedDemoState();
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is a convenience; the in-memory copy is the real one.
  }
}

/** Throws away everything the visitor did and re-seeds. Wired to the demo banner's button. */
export function resetDemoState(): void {
  state = seedDemoState();
  save();
}

// --------------------------------------------------------------------------- routing --

interface Route {
  readonly method: string;
  /** Matched against the path only, with {param} placeholders. */
  readonly path: string;
  readonly handle: (ctx: RequestContext) => unknown;
}

interface RequestContext {
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly body: any;
  readonly request: HttpRequest<unknown>;
}

/** Signals a non-2xx answer with an RFC 7807 body, exactly as the real API replies. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail);
  }
}

const ROUTES: Route[] = [
  // Demo sign-in. The real API checks a password hash and signs a JWT; there is nothing to
  // secure here, so this accepts the published demo credentials and hands back a fake token.
  // It exists so the demo exercises the same guard, interceptor and sign-out as production
  // rather than quietly skipping the part where staff have to log in.
  { method: 'POST', path: '/api/v1/auth/login', handle: (c) => signIn(c.body) },
  { method: 'POST', path: '/api/v1/auth/refresh', handle: (c) => refreshSession(c.body) },
  { method: 'POST', path: '/api/v1/auth/logout', handle: () => null },

  { method: 'GET', path: '/api/v1/tenants/by-slug/{slug}', handle: (c) => tenantFor(c.params['slug']) },

  { method: 'GET', path: '/api/v1/categories', handle: () => categoriesWithCounts() },
  { method: 'POST', path: '/api/v1/categories', handle: (c) => createCategory(c.body) },

  { method: 'GET', path: '/api/v1/products', handle: (c) => listProducts(c.query) },
  { method: 'POST', path: '/api/v1/products', handle: (c) => createProduct(c.body) },
  { method: 'PUT', path: '/api/v1/products/{id}', handle: (c) => updateProduct(c.params['id'], c.body) },
  { method: 'DELETE', path: '/api/v1/products/{id}', handle: (c) => deleteProduct(c.params['id']) },

  { method: 'GET', path: '/api/v1/products/{id}/recipe', handle: (c) => recipeFor(c.params['id']) },
  // The customer-facing projection: ingredient names only, no quantities or stock.
  {
    method: 'GET',
    path: '/api/v1/products/{id}/customizations',
    handle: (c) => customizationsFor(c.params['id']),
  },
  { method: 'POST', path: '/api/v1/products/{id}/recipe', handle: (c) => setRecipe(c.params['id'], c.body) },

  { method: 'GET', path: '/api/v1/ingredients', handle: (c) => listIngredients(c.query) },
  { method: 'POST', path: '/api/v1/ingredients', handle: (c) => createIngredient(c.body) },
  { method: 'PUT', path: '/api/v1/ingredients/{id}', handle: (c) => updateIngredient(c.params['id'], c.body) },
  { method: 'DELETE', path: '/api/v1/ingredients/{id}', handle: (c) => deleteIngredient(c.params['id']) },
  { method: 'POST', path: '/api/v1/ingredients/{id}/adjust', handle: (c) => adjustStock(c.params['id'], c.body) },

  { method: 'POST', path: '/api/v1/orders', handle: (c) => placeOrder(c.body) },
  { method: 'GET', path: '/api/v1/orders/tenant/{tenantId}', handle: (c) => listOrders(c.query) },
  { method: 'POST', path: '/api/v1/orders/{id}/complete', handle: (c) => completeOrder(c.params['id']) },
  { method: 'POST', path: '/api/v1/orders/{id}/cancel', handle: (c) => cancelOrder(c.params['id'], c.body) },
  { method: 'POST', path: '/api/v1/orders/{id}/review', handle: (c) => submitReview(c.params['id'], c.body) },
  { method: 'GET', path: '/api/v1/orders/{id}/review', handle: (c) => reviewFor(c.params['id']) },
  { method: 'GET', path: '/api/v1/orders/{id}', handle: (c) => orderById(c.params['id']) },

  { method: 'POST', path: '/api/v1/service-requests', handle: (c) => raiseServiceRequest(c.body) },
  { method: 'GET', path: '/api/v1/service-requests', handle: (c) => listServiceRequests(c.query) },
  { method: 'POST', path: '/api/v1/service-requests/{id}/acknowledge', handle: (c) => transitionRequest(c.params['id'], 'Acknowledged') },
  { method: 'POST', path: '/api/v1/service-requests/{id}/resolve', handle: (c) => transitionRequest(c.params['id'], 'Resolved') },

  { method: 'GET', path: '/api/v1/reviews', handle: () => [...state.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },

  { method: 'GET', path: '/api/v1/floor-plan', handle: () => floorPlan() },
  { method: 'PUT', path: '/api/v1/floor-plan', handle: (c) => saveFloorPlan(c.body) },
];

/** The one account the demo knows about. Published on the sign-in screen itself. */
const DEMO_EMAIL = 'owner@demo-resto.test';
const DEMO_PASSWORD = 'demo-owner-password';

function demoSession() {
  const hour = 60 * 60 * 1000;

  return {
    // Not a JWT and not signed. Nothing in demo mode validates it; it only has to be a
    // non-empty string so the interceptor sends an Authorization header like the real app.
    accessToken: `demo-access-${Date.now()}`,
    accessTokenExpiresAt: new Date(Date.now() + hour).toISOString(),
    refreshToken: `demo-refresh-${Date.now()}`,
    refreshTokenExpiresAt: new Date(Date.now() + 14 * 24 * hour).toISOString(),
    tenantId: state.tenant.id,
    tenantSlug: state.tenant.slug,
    displayName: 'Demo Owner',
    roles: ['Owner'],
  };
}

function signIn(body: any) {
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');

  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD)
    throw new ApiError(401, 'Sign-in failed', 'Those credentials did not match an active account.');

  return demoSession();
}

function refreshSession(body: any) {
  if (!body?.refreshToken)
    throw new ApiError(401, 'Sign-in failed', 'That session has expired.');

  return demoSession();
}

function floorPlan() {
  // A restaurant that has never drawn one is a normal state, not an error — but the route has
  // to say 404 for the client's "null means none" to work.
  if (!state.floorPlan) throw new ApiError(404, 'Resource not found', 'No floor plan has been saved yet.');

  return state.floorPlan;
}

function saveFloorPlan(body: any) {
  if (!body || body.schema !== 'restaurant-floor-plan')
    throw new ApiError(400, 'Invalid request', 'That JSON is not a floor plan.');

  state.floorPlan = body;

  return body;
}

export function handleDemoRequest(request: HttpRequest<unknown>): Observable<HttpResponse<unknown>> {
  // `defer` so the handler runs on subscribe, which keeps the mutation and the latency in the
  // same order a real request would have them.
  return defer(() => {
    const url = new URL(request.urlWithParams, 'http://demo.local');

    for (const route of ROUTES) {
      if (route.method !== request.method) continue;

      const params = match(route.path, url.pathname);
      if (!params) continue;

      try {
        const body = route.handle({ params, query: url.searchParams, body: request.body, request });

        save();

        const created =
          request.method === 'POST' &&
          (route.path === '/api/v1/orders' || route.path === '/api/v1/service-requests');

        const status = created ? 201 : 200;

        return of(new HttpResponse({ status, body: body ?? null, url: request.url }));
      } catch (error) {
        return throwError(() => toHttpError(error, request.url));
      }
    }

    return throwError(
      () =>
        new HttpErrorResponse({
          status: 404,
          statusText: 'Not Found',
          url: request.url,
          error: {
            title: 'Not handled in demo mode',
            status: 404,
            detail: `The demo backend has no route for ${request.method} ${url.pathname}.`,
          },
        }),
    );
  }).pipe(delay(LATENCY_MS));
}

function toHttpError(error: unknown, url: string): HttpErrorResponse {
  const api =
    error instanceof ApiError
      ? error
      : new ApiError(500, 'Demo backend error', (error as Error)?.message ?? 'Unknown failure.');

  return new HttpErrorResponse({
    status: api.status,
    statusText: api.title,
    url,
    error: { title: api.title, status: api.status, detail: api.detail, ...api.extensions },
  });
}

/** `/api/v1/products/{id}/recipe` against a real path, returning the captured segments. */
function match(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = path.split('/');

  if (expected.length !== actual.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < expected.length; i++) {
    const part = expected[i];

    if (part.startsWith('{') && part.endsWith('}')) {
      params[part.slice(1, -1)] = decodeURIComponent(actual[i]);
      continue;
    }

    if (part !== actual[i]) return null;
  }

  return params;
}

// ---------------------------------------------------------------------------- tenant --

function tenantFor(slug: string) {
  // Any slug resolves to the one demo restaurant, echoing what was asked for so links stay
  // stable. A demo that 404s because someone mistyped the slug is a bad demo.
  return { ...state.tenant, slug };
}

// -------------------------------------------------------------------------- catalogue --

function categoriesWithCounts(): CategoryDto[] {
  return state.categories
    .map((category) => ({
      ...category,
      productCount: state.products.filter((p) => p.categoryId === category.id && p.isActive).length,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function createCategory(body: { name: string; sortOrder: number }): CategoryDto {
  requireText(body?.name, 'name', 'A category name is required.');

  if (state.categories.some((c) => c.name.toLowerCase() === body.name.trim().toLowerCase()))
    throw new ApiError(409, 'Conflict', `A category named '${body.name}' already exists.`);

  const category: CategoryDto = {
    id: newId(),
    name: body.name.trim(),
    sortOrder: body.sortOrder ?? state.categories.length + 1,
    productCount: 0,
  };

  state.categories = [...state.categories, category];

  return category;
}

function listProducts(query: URLSearchParams): ProductDto[] {
  const includeInactive = query.get('includeInactive') === 'true';
  const categoryId = query.get('categoryId');

  return state.products
    .filter((p) => includeInactive || p.isActive)
    .filter((p) => !categoryId || p.categoryId === categoryId)
    .map(withRecipeCount)
    .sort((a, b) => sortOrderOf(a) - sortOrderOf(b) || a.name.localeCompare(b.name));
}

function sortOrderOf(product: ProductDto): number {
  return state.categories.find((c) => c.id === product.categoryId)?.sortOrder ?? 0;
}

function withRecipeCount(product: ProductDto): ProductDto {
  return {
    ...product,
    recipeItemCount: state.recipes.filter((r) => r.productId === product.id).length,
  };
}

function createProduct(body: any): ProductDto {
  requireText(body?.name, 'name', 'A product name is required.');

  const category = state.categories.find((c) => c.id === body.categoryId);
  if (!category) throw new ApiError(404, 'Resource not found', 'That category does not exist.');

  if (state.products.some((p) => p.name.toLowerCase() === body.name.trim().toLowerCase()))
    throw new ApiError(409, 'Conflict', `A product named '${body.name}' already exists.`);

  const product: ProductDto = {
    id: newId(),
    categoryId: category.id,
    categoryName: category.name,
    name: body.name.trim(),
    description: body.description || null,
    imageUrl: body.imageUrl || null,
    price: Number(body.price) || 0,
    isActive: body.isActive ?? true,
    recipeItemCount: 0,
  };

  state.products = [...state.products, product];

  return product;
}

function updateProduct(id: string, body: any): ProductDto {
  const existing = requireProduct(id);
  const category = state.categories.find((c) => c.id === body.categoryId);

  if (!category) throw new ApiError(404, 'Resource not found', 'That category does not exist.');

  const updated: ProductDto = {
    ...existing,
    categoryId: category.id,
    categoryName: category.name,
    name: String(body.name ?? existing.name).trim(),
    description: body.description || null,
    imageUrl: body.imageUrl || null,
    price: Number(body.price) || 0,
    isActive: body.isActive ?? existing.isActive,
  };

  state.products = state.products.map((p) => (p.id === id ? updated : p));

  return withRecipeCount(updated);
}

function deleteProduct(id: string): null {
  requireProduct(id);

  state.products = state.products.filter((p) => p.id !== id);
  state.recipes = state.recipes.filter((r) => r.productId !== id);

  return null;
}

// --------------------------------------------------------------------------- recipes --

/**
 * What the customer menu asks for. Mirrors the real API's split: this shape carries ingredient
 * names only, while {@link recipeFor} carries quantities and stock and is staff-only.
 */
function customizationsFor(productId: string) {
  const product = requireProduct(productId);

  return {
    productId: product.id,
    productName: product.name,
    items: state.recipes
      .filter((r) => r.productId === productId)
      .map((line) => {
        const ingredient = requireIngredient(line.ingredientId);

        return { ingredientId: ingredient.id, ingredientName: ingredient.name };
      })
      .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName)),
  };
}

function recipeFor(productId: string) {
  const product = requireProduct(productId);
  const lines = state.recipes.filter((r) => r.productId === productId);

  return {
    productId: product.id,
    productName: product.name,
    items: lines
      .map((line) => {
        const ingredient = requireIngredient(line.ingredientId);

        return {
          id: line.id,
          productId,
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          unit: ingredient.unit,
          quantityRequired: line.quantityRequired,
          ingredientCurrentStock: ingredient.currentStock,
        };
      })
      .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName)),
    // The real API returns int.MaxValue for a product that consumes nothing.
    maxProducibleUnits:
      lines.length === 0
        ? 2_147_483_647
        : Math.min(
            ...lines.map((l) =>
              Math.floor(requireIngredient(l.ingredientId).currentStock / l.quantityRequired),
            ),
          ),
  };
}

function setRecipe(productId: string, body: { items?: { ingredientId: string; quantityRequired: number }[] }) {
  requireProduct(productId);

  const items = body?.items ?? [];
  const ids = items.map((i) => i.ingredientId);

  if (new Set(ids).size !== ids.length)
    throw new ApiError(400, 'Invalid request', 'An ingredient can only appear once in a recipe.');

  if (items.some((i) => i.quantityRequired <= 0))
    throw new ApiError(422, 'Business rule violated', 'Required quantity must be greater than zero.');

  for (const id of ids) requireIngredient(id);

  // A full replacement, exactly like POST /api/v1/products/{id}/recipe.
  state.recipes = [
    ...state.recipes.filter((r) => r.productId !== productId),
    ...items.map((item) => ({
      id: newId(),
      productId,
      ingredientId: item.ingredientId,
      quantityRequired: item.quantityRequired,
    })),
  ];

  return recipeFor(productId);
}

// ----------------------------------------------------------------------- ingredients --

function listIngredients(query: URLSearchParams): IngredientDto[] {
  const lowOnly = query.get('lowStockOnly') === 'true';

  return state.ingredients
    .filter((i) => !lowOnly || i.isBelowMinimum)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createIngredient(body: any): IngredientDto {
  requireText(body?.name, 'name', 'An ingredient name is required.');

  if (state.ingredients.some((i) => i.name.toLowerCase() === body.name.trim().toLowerCase()))
    throw new ApiError(409, 'Conflict', `An ingredient named '${body.name}' already exists.`);

  const ingredient = normalise({
    id: newId(),
    name: body.name.trim(),
    unit: body.unit || 'kg',
    currentStock: Number(body.currentStock) || 0,
    minimumStockAlert: Number(body.minimumStockAlert) || 0,
    isBelowMinimum: false,
  });

  state.ingredients = [...state.ingredients, ingredient];

  return ingredient;
}

function updateIngredient(id: string, body: any): IngredientDto {
  const existing = requireIngredient(id);

  const updated = normalise({
    ...existing,
    name: String(body.name ?? existing.name).trim(),
    unit: body.unit ?? existing.unit,
    minimumStockAlert: Number(body.minimumStockAlert) || 0,
  });

  state.ingredients = state.ingredients.map((i) => (i.id === id ? updated : i));

  return updated;
}

function deleteIngredient(id: string): null {
  requireIngredient(id);

  if (state.recipes.some((r) => r.ingredientId === id))
    throw new ApiError(409, 'Conflict', 'Cannot delete an ingredient that is still used by a recipe.');

  state.ingredients = state.ingredients.filter((i) => i.id !== id);

  return null;
}

function adjustStock(id: string, body: { changeAmount: number; reason: string; note: string | null }) {
  const ingredient = requireIngredient(id);
  const change = round4(Number(body?.changeAmount) || 0);

  if (change === 0)
    throw new ApiError(400, 'Invalid request', 'Change amount cannot be zero.');

  if (ingredient.currentStock + change < 0)
    throw new ApiError(
      409,
      'Insufficient stock',
      `Cannot remove ${Math.abs(change)} ${ingredient.unit} — only ${ingredient.currentStock} in stock.`,
    );

  const updated = normalise({ ...ingredient, currentStock: round4(ingredient.currentStock + change) });

  state.ingredients = state.ingredients.map((i) => (i.id === id ? updated : i));

  return {
    ingredientId: updated.id,
    ingredientName: updated.name,
    unit: updated.unit,
    currentStock: updated.currentStock,
    minimumStockAlert: updated.minimumStockAlert,
    isBelowMinimum: updated.isBelowMinimum,
  };
}

// ---------------------------------------------------------------------------- orders --

function placeOrder(body: any): OrderDto {
  const orderType: OrderType = body?.orderType ?? 'DineIn';
  const tableNumber = trimmed(body?.tableNumber);
  const customerName = trimmed(body?.customerName);
  const customerPhone = trimmed(body?.customerPhone);
  const deliveryAddress = trimmed(body?.deliveryAddress);

  // The same three rules the API enforces, so the demo fails in the same places.
  if (orderType === 'DineIn' && !tableNumber)
    throw new ApiError(400, 'Invalid request', 'A dine-in order needs a table number.');
  if (orderType === 'Delivery' && !deliveryAddress)
    throw new ApiError(400, 'Invalid request', 'A delivery order needs an address.');
  if (orderType === 'Delivery' && !customerPhone)
    throw new ApiError(400, 'Invalid request', 'A delivery order needs a phone number.');

  const rawLines: any[] = body?.items ?? [];

  if (rawLines.length === 0)
    throw new ApiError(400, 'Invalid request', 'An order must contain at least one item.');
  if (rawLines.some((l) => (l?.quantity ?? 0) <= 0))
    throw new ApiError(400, 'Invalid request', 'Quantity must be greater than zero.');

  // Lines only merge when they are indistinguishable on a ticket.
  const merged = new Map<string, any>();

  for (const line of rawLines) {
    const changes = (line.customizations ?? [])
      .map((c: any) => `${c.kind}:${c.ingredientId}`)
      .sort()
      .join(',');
    const key = `${line.productId}|${(line.notes ?? '').trim()}|${changes}`;
    const existing = merged.get(key);

    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { ...line, quantity: line.quantity });
  }

  const lines = [...merged.values()];
  const products = lines.map((l) => requireProduct(l.productId));

  const inactive = products.filter((p) => !p.isActive);
  if (inactive.length > 0)
    throw new ApiError(
      400,
      'Invalid request',
      `Not on the menu right now: ${inactive.map((p) => p.name).join(', ')}.`,
    );

  const required = requirementsFor(lines);
  const shortages = shortagesFor(required);

  // All-or-nothing, like the transaction it stands in for.
  if (shortages.length > 0)
    throw new ApiError(
      400,
      'Insufficient stock',
      `Insufficient stock: ${shortages.map((s) => `${s.ingredientName} (short ${s.missingQuantity} ${s.unit})`).join(', ')}.`,
      { shortages },
    );

  const paymentMethod = body?.paymentMethod ?? 'Cash';

  // Cash starts the kitchen immediately, so it deducts now. A gateway order waits for its
  // webhook — which the demo simulates a moment after the customer "pays".
  const deductNow = paymentMethod === 'Cash';

  if (deductNow) applyStock(required, -1);

  const items = lines.map((line, index) => {
    const product = products[index];
    const names = new Map(state.ingredients.map((i) => [i.id, i.name]));

    return {
      id: newId(),
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      unitPrice: product.price,
      lineTotal: round2(product.price * line.quantity),
      notes: trimmed(line.notes),
      customizations: (line.customizations ?? []).map((c: any) => ({
        ingredientId: c.ingredientId,
        ingredientName: names.get(c.ingredientId) ?? '',
        kind: c.kind as CustomizationKind,
      })),
    };
  });

  const total = round2(items.reduce((sum, line) => sum + line.lineTotal, 0));

  const order: OrderDto = {
    id: newId(),
    tenantId: state.tenant.id,
    orderType,
    tableNumber: orderType === 'DineIn' ? tableNumber : null,
    customerName,
    customerPhone,
    deliveryAddress: orderType === 'Delivery' ? deliveryAddress : null,
    allergyNotes: trimmed(body?.allergyNotes),
    covers: orderType === 'DineIn' && Number(body?.covers) > 0 ? Math.floor(Number(body.covers)) : null,
    fulfilmentLabel:
      orderType === 'DineIn'
        ? (tableNumber ?? 'Table')
        : orderType === 'Takeaway'
          ? (customerName ?? 'Takeaway')
          : (deliveryAddress ?? 'Delivery'),
    status: 'Pending',
    paymentStatus: 'Unpaid',
    paymentMethod,
    totalAmountMillimes: Math.round(total * 1000),
    totalAmount: total,
    cancellationReason: null,
    createdAt: new Date().toISOString(),
    items: items.sort((a, b) => a.productName.localeCompare(b.productName)),
  };

  state.orders = [order, ...state.orders];

  // Stand-in for the gateway webhook: a few seconds after checkout the money lands, the
  // ingredients leave stock, and the customer's status page — which is polling — updates.
  if (!deductNow) scheduleGatewayConfirmation(order.id);

  return order;
}

/** What one ingredient is needed for, and by which products. */
interface Requirement {
  quantity: number;
  /** Carried so a shortage can name the dish rather than the ingredient. */
  productIds: Set<string>;
}

/** Expands basket lines through their recipes, honouring removals and extras. */
function requirementsFor(lines: any[]): Map<string, Requirement> {
  const required = new Map<string, Requirement>();

  for (const line of lines) {
    const removed = new Set<string>(
      (line.customizations ?? []).filter((c: any) => c.kind === 'Removed').map((c: any) => c.ingredientId),
    );
    const added = new Set<string>(
      (line.customizations ?? []).filter((c: any) => c.kind === 'Added').map((c: any) => c.ingredientId),
    );

    for (const recipe of state.recipes.filter((r) => r.productId === line.productId)) {
      if (removed.has(recipe.ingredientId)) continue;

      const helpings = added.has(recipe.ingredientId) ? 2 : 1;
      const amount = recipe.quantityRequired * line.quantity * helpings;
      const entry = required.get(recipe.ingredientId) ?? { quantity: 0, productIds: new Set<string>() };

      entry.quantity = round4(entry.quantity + amount);
      entry.productIds.add(line.productId);
      required.set(recipe.ingredientId, entry);
    }
  }

  return required;
}

function shortagesFor(required: Map<string, Requirement>) {
  return [...required.entries()]
    .map(([ingredientId, entry]) => ({ ingredient: requireIngredient(ingredientId), entry }))
    .filter(({ ingredient, entry }) => entry.quantity > ingredient.currentStock)
    .map(({ ingredient, entry }) => ({
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      unit: ingredient.unit,
      requiredQuantity: entry.quantity,
      availableQuantity: ingredient.currentStock,
      missingQuantity: round4(entry.quantity - ingredient.currentStock),
      blockedProductIds: [...entry.productIds],
    }));
}

/** `sign` is -1 to consume and +1 to give back. */
function applyStock(required: Map<string, Requirement>, sign: -1 | 1): void {
  for (const [ingredientId, { quantity }] of required) {
    const ingredient = requireIngredient(ingredientId);
    const updated = normalise({
      ...ingredient,
      currentStock: round4(ingredient.currentStock + sign * quantity),
    });

    state.ingredients = state.ingredients.map((i) => (i.id === ingredientId ? updated : i));
  }
}

/** The lines of a placed order, back in the shape requirementsFor understands. */
function linesOf(order: OrderDto): any[] {
  return order.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    customizations: item.customizations,
  }));
}

const GATEWAY_DELAY_MS = 4000;

function scheduleGatewayConfirmation(orderId: string): void {
  setTimeout(() => {
    const order = state.orders.find((o) => o.id === orderId);

    if (!order || order.paymentStatus !== 'Unpaid' || order.status === 'Cancelled') return;

    const required = requirementsFor(linesOf(order));

    // The webhook checks stock again before deducting: between checkout and payment somebody
    // else may have taken the last of something.
    if (shortagesFor(required).length > 0) {
      // Paid but unfulfillable: the money is real, so the order is cancelled for a refund
      // rather than silently recorded as served.
      state.orders = state.orders.map((o) =>
        o.id === orderId
          ? {
              ...o,
              paymentStatus: 'Paid' as const,
              status: 'Cancelled' as const,
              cancellationReason: 'Sold out before payment cleared. Refund owed.',
            }
          : o,
      );
      save();
      return;
    }

    applyStock(required, -1);

    state.orders = state.orders.map((o) =>
      o.id === orderId ? { ...o, paymentStatus: 'Paid' as const } : o,
    );

    save();
  }, GATEWAY_DELAY_MS);
}

function cancelOrder(id: string, body: any): OrderDto {
  const order = orderById(id);

  if (order.status === 'Cancelled') return order;
  if (order.status !== 'Pending')
    throw new ApiError(
      422,
      'Business rule violated',
      `Only a pending order can be cancelled; this one is ${order.status}.`,
    );

  // Stock only goes back if it ever left: an unpaid gateway order never took any.
  const deducted = order.paymentMethod === 'Cash' || order.paymentStatus === 'Paid';

  if (deducted) applyStock(requirementsFor(linesOf(order)), 1);

  const reason = trimmed(body?.reason);
  const refund = order.paymentStatus === 'Paid' ? 'Refund owed: this order was already paid for.' : null;

  const cancelled: OrderDto = {
    ...order,
    status: 'Cancelled',
    cancellationReason: [reason, refund].filter(Boolean).join(' — ') || null,
  };

  state.orders = state.orders.map((o) => (o.id === id ? cancelled : o));

  return cancelled;
}

// ---------------------------------------------------------------- reviews --

function submitReview(orderId: string, body: any): OrderReviewDto {
  const order = orderById(orderId);

  if (order.status === 'Cancelled')
    throw new ApiError(400, 'Invalid request', 'A cancelled order cannot be reviewed.');

  const rating = Number(body?.rating);

  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ApiError(422, 'Business rule violated', 'A rating must be between 1 and 5.');

  const existing = state.reviews.find((r) => r.orderId === orderId);
  const comment = trimmed(body?.comment);

  if (existing) {
    // One review per order: changing your mind edits it rather than stacking a second.
    const updated = { ...existing, rating, comment, updatedAt: new Date().toISOString() };
    state.reviews = state.reviews.map((r) => (r.orderId === orderId ? updated : r));

    return updated;
  }

  const review: OrderReviewDto = {
    id: newId(),
    orderId,
    rating,
    comment,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };

  state.reviews = [review, ...state.reviews];

  return review;
}

function reviewFor(orderId: string): OrderReviewDto {
  const review = state.reviews.find((r) => r.orderId === orderId);

  if (!review) throw new ApiError(404, 'Resource not found', 'No review for that order yet.');

  return review;
}

// -------------------------------------------------------- service requests --

/** Repeated taps within this window are the same shout, not three tables. */
const DUPLICATE_WINDOW_MS = 3 * 60_000;

function raiseServiceRequest(body: any): ServiceRequestDto {
  const tableNumber = trimmed(body?.tableNumber);

  if (!tableNumber)
    throw new ApiError(400, 'Invalid request', 'A service request needs to say which table it came from.');

  const kind: ServiceRequestKind = body?.kind ?? 'CallWaiter';
  const since = Date.now() - DUPLICATE_WINDOW_MS;

  const existing = state.serviceRequests.find(
    (r) =>
      r.tableNumber === tableNumber &&
      r.kind === kind &&
      r.status !== 'Resolved' &&
      Date.parse(r.createdAt) >= since,
  );

  if (existing) return existing;

  const request: ServiceRequestDto = {
    id: newId(),
    tableNumber,
    kind,
    note: trimmed(body?.note),
    orderId: body?.orderId ?? null,
    status: 'Open',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };

  state.serviceRequests = [request, ...state.serviceRequests];

  return request;
}

function listServiceRequests(query: URLSearchParams): ServiceRequestDto[] {
  const status = query.get('status') as ServiceRequestStatus | null;

  return state.serviceRequests
    .filter((r) => !status || r.status === status)
    .slice()
    // Oldest unresolved first: the table waiting longest is the one to go to.
    .sort(
      (a, b) =>
        Number(a.status === 'Resolved') - Number(b.status === 'Resolved') ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

function transitionRequest(id: string, status: ServiceRequestStatus): ServiceRequestDto {
  const request = state.serviceRequests.find((r) => r.id === id);

  if (!request) throw new ApiError(404, 'Resource not found', `Service request '${id}' was not found.`);

  const updated: ServiceRequestDto = {
    ...request,
    status,
    resolvedAt: status === 'Resolved' ? new Date().toISOString() : request.resolvedAt,
  };

  state.serviceRequests = state.serviceRequests.map((r) => (r.id === id ? updated : r));

  return updated;
}

function listOrders(query: URLSearchParams): OrderDto[] {
  const status = query.get('status') as OrderStatus | null;
  const type = query.get('orderType') as OrderType | null;

  return state.orders
    .filter((o) => !status || o.status === status)
    .filter((o) => !type || o.orderType === type)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function orderById(id: string): OrderDto {
  const order = state.orders.find((o) => o.id === id);

  if (!order) throw new ApiError(404, 'Resource not found', `Order '${id}' was not found.`);

  return order;
}

function completeOrder(id: string): OrderDto {
  const order = orderById(id);

  if (order.status !== 'Pending')
    throw new ApiError(
      422,
      'Business rule violated',
      `Only a pending order can be completed; this one is ${order.status}.`,
    );

  const completed: OrderDto = { ...order, status: 'Completed' };

  state.orders = state.orders.map((o) => (o.id === id ? completed : o));

  return completed;
}

// --------------------------------------------------------------------------- helpers --

function requireProduct(id: string): ProductDto {
  const product = state.products.find((p) => p.id === id);

  if (!product) throw new ApiError(404, 'Resource not found', `Product '${id}' was not found.`);

  return product;
}

function requireIngredient(id: string): IngredientDto {
  const ingredient = state.ingredients.find((i) => i.id === id);

  if (!ingredient) throw new ApiError(404, 'Resource not found', `Ingredient '${id}' was not found.`);

  return ingredient;
}

function requireText(value: unknown, field: string, message: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new ApiError(400, 'Invalid request', message, { errors: { [field]: [message] } });
}

/** Keeps `isBelowMinimum` a derived fact rather than something a caller can set wrong. */
function normalise(ingredient: IngredientDto): IngredientDto {
  return {
    ...ingredient,
    currentStock: round4(ingredient.currentStock),
    minimumStockAlert: round4(ingredient.minimumStockAlert),
    isBelowMinimum: round4(ingredient.currentStock) <= round4(ingredient.minimumStockAlert),
  };
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function newId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
