import { Routes } from '@angular/router';

/**
 * Everything under /admin/:tenantSlug. The slug reaches each page as a signal input via
 * `paramsInheritanceStrategy: 'always'` (see app.config.ts), so a child route does not have to
 * repeat it in its own path.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./admin-shell.component').then((m) => m.AdminShellComponent),
    children: [
      {
        path: 'overview',
        title: 'Overview · Admin',
        loadComponent: () => import('./pages/overview.component').then((m) => m.OverviewComponent),
      },
      {
        path: 'menu',
        title: 'Menu · Admin',
        loadComponent: () =>
          import('./pages/product-manager.component').then((m) => m.ProductManagerComponent),
      },
      {
        path: 'inventory',
        title: 'Ingredients & recipes · Admin',
        loadComponent: () =>
          import('./pages/inventory-manager.component').then((m) => m.InventoryManagerComponent),
      },
      {
        path: 'service-desk',
        title: 'Service desk · Admin',
        loadComponent: () =>
          import('./pages/service-desk.component').then((m) => m.ServiceDeskComponent),
      },
      {
        path: 'stock',
        title: 'Low stock · Admin',
        loadComponent: () =>
          import('./pages/stock-control.component').then((m) => m.StockControlComponent),
      },
      {
        path: 'floor',
        title: 'Floor · Admin',
        loadComponent: () =>
          import('./pages/floor-view.component').then((m) => m.FloorViewComponent),
      },
      {
        path: 'orders',
        title: 'Orders · Admin',
        loadComponent: () =>
          import('./pages/order-list.component').then((m) => m.OrderListComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
    ],
  },
];
