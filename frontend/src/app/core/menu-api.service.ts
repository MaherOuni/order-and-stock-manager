import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { environment } from '../../environments/environment';
import { CategoryDto, ProductDto, TenantDto } from './api.models';

/** Everything one table needs to render a menu, fetched in one round trip. */
export interface Menu {
  readonly tenant: TenantDto;
  readonly categories: readonly CategoryDto[];
  readonly products: readonly ProductDto[];
}

@Injectable({ providedIn: 'root' })
export class MenuApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/+$/, '');

  /**
   * Loads the tenant, its categories and its active products.
   *
   * The API's tenant header takes a slug as happily as a Guid, which is the whole reason a QR
   * link can carry `demo-resto` and nothing else. `/api/v1/tenants/by-slug` needs no header at
   * all — the middleware bypasses that path.
   */
  loadMenu(tenantSlug: string): Observable<Menu> {
    const headers = new HttpHeaders({ 'X-Tenant-Id': tenantSlug });

    return forkJoin({
      tenant: this.http.get<TenantDto>(
        `${this.baseUrl}/api/v1/tenants/by-slug/${encodeURIComponent(tenantSlug)}`,
      ),
      categories: this.http.get<CategoryDto[]>(`${this.baseUrl}/api/v1/categories`, { headers }),
      products: this.http.get<ProductDto[]>(`${this.baseUrl}/api/v1/products`, { headers }),
    }).pipe(
      map(({ tenant, categories, products }) => ({
        tenant,
        // Empty categories would render a tab that filters to nothing.
        categories: [...categories]
          .filter((category) => category.productCount > 0)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        // `includeInactive` is off by default, so this is already the sellable menu.
        products,
      })),
    );
  }
}
