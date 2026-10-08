import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import {
  ApiProblem,
  CancelOrderRequest,
  CreateServiceRequestCommand,
  OrderDto,
  OrderReviewDto,
  PlaceOrderRequest,
  ProductCustomizationsDto,
  ServiceRequestDto,
  SubmitReviewCommand,
} from './api.models';

/**
 * Everything the customer's phone does beyond reading the menu.
 *
 * The public endpoints name the restaurant by slug in the body or query, because a phone that
 * scanned a sticker has no tenant header and no session — the printed link is the whole context.
 */
@Injectable({ providedIn: 'root' })
export class OrderApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/+$/, '');

  /** Prices are deliberately not sent — the server reads them off the menu. */
  placeOrder(request: PlaceOrderRequest): Observable<OrderDto> {
    return this.http.post<OrderDto>(`${this.baseUrl}/api/v1/orders`, request);
  }

  getOrder(tenantSlug: string, orderId: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(`${this.baseUrl}/api/v1/orders/${encodeURIComponent(orderId)}`, {
      params: { tenantSlug },
    });
  }

  /** Calls the order off. The API returns any deducted ingredients to stock. */
  cancelOrder(
    tenantSlug: string,
    orderId: string,
    request: CancelOrderRequest = {},
  ): Observable<OrderDto> {
    return this.http.post<OrderDto>(
      `${this.baseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/cancel`,
      request,
      { params: { tenantSlug } },
    );
  }

  /**
   * What the customer may change about a dish.
   *
   * Not `/recipe`, which is staff-only: that one carries the quantities and the current stock
   * level of every ingredient, and a scanned QR code does not entitle anyone to the
   * restaurant's formulation or its inventory.
   */
  getCustomizations(tenantSlug: string, productId: string): Observable<ProductCustomizationsDto> {
    return this.http.get<ProductCustomizationsDto>(
      `${this.baseUrl}/api/v1/products/${encodeURIComponent(productId)}/customizations`,
      { headers: new HttpHeaders({ 'X-Tenant-Id': tenantSlug }) },
    );
  }

  callForHelp(command: CreateServiceRequestCommand): Observable<ServiceRequestDto> {
    return this.http.post<ServiceRequestDto>(
      `${this.baseUrl}/api/v1/service-requests`,
      command,
    );
  }

  submitReview(orderId: string, command: SubmitReviewCommand): Observable<OrderReviewDto> {
    return this.http.post<OrderReviewDto>(
      `${this.baseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/review`,
      command,
    );
  }

  /** Null rather than an error when nobody has reviewed yet — 404 is the normal answer. */
  getReview(tenantSlug: string, orderId: string): Observable<OrderReviewDto | null> {
    return this.http
      .get<OrderReviewDto>(`${this.baseUrl}/api/v1/orders/${encodeURIComponent(orderId)}/review`, {
        params: { tenantSlug },
      })
      .pipe(
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) return of(null);

          throw error;
        }),
      );
  }
}

/** The RFC 7807 body, when the failure carried one. */
export function problemOf(error: unknown): ApiProblem | null {
  if (!(error instanceof HttpErrorResponse)) return null;

  const body = error.error;

  return body && typeof body === 'object' ? (body as ApiProblem) : null;
}
