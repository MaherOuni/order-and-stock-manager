import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import {
  CategoryDto,
  OrderDto,
  OrderReviewDto,
  OrderStatus,
  OrderType,
  ProductDto,
  ServiceRequestDto,
  TenantDto,
} from '../../core/api.models';
import { FloorPlan } from '../../core/floor-plan.models';
import {
  CreateIngredientPayload,
  IngredientDto,
  ProductPayload,
  ProductRecipeDto,
  SetRecipePayload,
  StockAdjustmentPayload,
  StockMovementResult,
  UpdateIngredientPayload,
} from './admin.models';

/**
 * Every admin call against the tenant-scoped API.
 *
 * Each method takes the slug and sends it as `X-Tenant-Id` rather than relying on an
 * interceptor: the customer's checkout POST on the same origin must *not* carry that header,
 * and an explicit argument makes that impossible to get wrong.
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/+$/, '');

  private headers(tenantSlug: string): HttpHeaders {
    return new HttpHeaders({ 'X-Tenant-Id': tenantSlug });
  }

  // ------------------------------------------------------------------ tenant --

  getTenant(tenantSlug: string): Observable<TenantDto> {
    return this.http.get<TenantDto>(
      `${this.baseUrl}/api/v1/tenants/by-slug/${encodeURIComponent(tenantSlug)}`,
    );
  }

  // ---------------------------------------------------------------- the menu --

  /** Products and their categories together; the product table shows both. */
  getMenu(tenantSlug: string): Observable<{
    tenant: TenantDto;
    categories: CategoryDto[];
    products: ProductDto[];
  }> {
    const headers = this.headers(tenantSlug);

    return forkJoin({
      tenant: this.getTenant(tenantSlug),
      categories: this.http.get<CategoryDto[]>(`${this.baseUrl}/api/v1/categories`, { headers }),
      // Admins manage what customers cannot see, so inactive products are included here.
      products: this.http.get<ProductDto[]>(`${this.baseUrl}/api/v1/products`, {
        headers,
        params: { includeInactive: true },
      }),
    });
  }

  createCategory(tenantSlug: string, name: string, sortOrder: number): Observable<CategoryDto> {
    return this.http.post<CategoryDto>(
      `${this.baseUrl}/api/v1/categories`,
      { name, sortOrder },
      { headers: this.headers(tenantSlug) },
    );
  }

  createProduct(tenantSlug: string, payload: ProductPayload): Observable<ProductDto> {
    return this.http.post<ProductDto>(`${this.baseUrl}/api/v1/products`, payload, {
      headers: this.headers(tenantSlug),
    });
  }

  updateProduct(tenantSlug: string, id: string, payload: ProductPayload): Observable<ProductDto> {
    return this.http.put<ProductDto>(`${this.baseUrl}/api/v1/products/${id}`, payload, {
      headers: this.headers(tenantSlug),
    });
  }

  deleteProduct(tenantSlug: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/v1/products/${id}`, {
      headers: this.headers(tenantSlug),
    });
  }

  // ------------------------------------------------------------- ingredients --

  getIngredients(tenantSlug: string, lowStockOnly = false): Observable<IngredientDto[]> {
    return this.http.get<IngredientDto[]>(`${this.baseUrl}/api/v1/ingredients`, {
      headers: this.headers(tenantSlug),
      params: { lowStockOnly },
    });
  }

  createIngredient(tenantSlug: string, payload: CreateIngredientPayload): Observable<IngredientDto> {
    return this.http.post<IngredientDto>(`${this.baseUrl}/api/v1/ingredients`, payload, {
      headers: this.headers(tenantSlug),
    });
  }

  updateIngredient(
    tenantSlug: string,
    id: string,
    payload: UpdateIngredientPayload,
  ): Observable<IngredientDto> {
    return this.http.put<IngredientDto>(`${this.baseUrl}/api/v1/ingredients/${id}`, payload, {
      headers: this.headers(tenantSlug),
    });
  }

  deleteIngredient(tenantSlug: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/api/v1/ingredients/${id}`, {
      headers: this.headers(tenantSlug),
    });
  }

  /** Signed stock movement. The API writes a ledger line for it; there is no other way in. */
  adjustStock(
    tenantSlug: string,
    id: string,
    payload: StockAdjustmentPayload,
  ): Observable<StockMovementResult> {
    return this.http.post<StockMovementResult>(
      `${this.baseUrl}/api/v1/ingredients/${id}/adjust`,
      payload,
      { headers: this.headers(tenantSlug) },
    );
  }

  // ----------------------------------------------------------------- recipes --

  getRecipe(tenantSlug: string, productId: string): Observable<ProductRecipeDto> {
    return this.http.get<ProductRecipeDto>(
      `${this.baseUrl}/api/v1/products/${productId}/recipe`,
      { headers: this.headers(tenantSlug) },
    );
  }

  setRecipe(
    tenantSlug: string,
    productId: string,
    payload: SetRecipePayload,
  ): Observable<ProductRecipeDto> {
    return this.http.post<ProductRecipeDto>(
      `${this.baseUrl}/api/v1/products/${productId}/recipe`,
      payload,
      { headers: this.headers(tenantSlug) },
    );
  }

  // ------------------------------------------------------------------ orders --

  getOrders(
    tenantSlug: string,
    tenantId: string,
    status: OrderStatus | null,
    orderType: OrderType | null = null,
  ): Observable<OrderDto[]> {
    const params: Record<string, string> = {};

    if (status) params['status'] = status;
    if (orderType) params['orderType'] = orderType;

    return this.http.get<OrderDto[]>(`${this.baseUrl}/api/v1/orders/tenant/${tenantId}`, {
      headers: this.headers(tenantSlug),
      params,
    });
  }

  // -------------------------------------------------------------- floor plan --

  /**
   * The saved plan for this restaurant, or null when nobody has drawn one yet — which is a
   * normal state, not an error, so a 404 becomes null.
   */
  getFloorPlan(tenantSlug: string): Observable<FloorPlan | null> {
    return this.http
      .get<FloorPlan>(`${this.baseUrl}/api/v1/floor-plan`, { headers: this.headers(tenantSlug) })
      .pipe(
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) return of(null);

          throw error;
        }),
      );
  }

  saveFloorPlan(tenantSlug: string, plan: FloorPlan): Observable<FloorPlan> {
    return this.http.put<FloorPlan>(`${this.baseUrl}/api/v1/floor-plan`, plan, {
      headers: this.headers(tenantSlug),
    });
  }

  // ------------------------------------------------------------ service desk --

  /** The floor queue and the reviews together; the desk shows both at once. */
  getServiceDesk(tenantSlug: string): Observable<{
    requests: ServiceRequestDto[];
    reviews: OrderReviewDto[];
  }> {
    const headers = this.headers(tenantSlug);

    return forkJoin({
      requests: this.http.get<ServiceRequestDto[]>(`${this.baseUrl}/api/v1/service-requests`, {
        headers,
      }),
      reviews: this.http.get<OrderReviewDto[]>(`${this.baseUrl}/api/v1/reviews`, { headers }),
    });
  }

  acknowledgeRequest(tenantSlug: string, id: string): Observable<ServiceRequestDto> {
    return this.http.post<ServiceRequestDto>(
      `${this.baseUrl}/api/v1/service-requests/${id}/acknowledge`,
      null,
      { headers: this.headers(tenantSlug) },
    );
  }

  resolveRequest(tenantSlug: string, id: string): Observable<ServiceRequestDto> {
    return this.http.post<ServiceRequestDto>(
      `${this.baseUrl}/api/v1/service-requests/${id}/resolve`,
      null,
      { headers: this.headers(tenantSlug) },
    );
  }

  completeOrder(tenantSlug: string, orderId: string): Observable<OrderDto> {
    return this.http.post<OrderDto>(
      `${this.baseUrl}/api/v1/orders/${orderId}/complete`,
      null,
      { headers: this.headers(tenantSlug) },
    );
  }
}
