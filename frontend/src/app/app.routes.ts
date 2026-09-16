import { Routes } from '@angular/router';

/**
 * Both customer routes carry their whole context in the URL, because that URL *is* the QR
 * code printed on the table — there is no session to fall back on. `withComponentInputBinding`
 * (see app.config.ts) hands each segment straight to a signal input on the component.
 */
export const routes: Routes = [
  {
    // Ahead of the customer routes: /admin/... has a literal first segment, and reading the
    // routing table top-down should make that obvious.
    path: 'admin/:tenantSlug',
    loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: ':tenantSlug/table/:tableNumber',
    title: 'Menu',
    loadComponent: () =>
      import('./features/menu/menu-page.component').then((m) => m.MenuPageComponent),
  },
  {
    path: ':tenantSlug/order-status/:orderId',
    title: 'Your order',
    loadComponent: () =>
      import('./features/order-status/order-status-page.component').then(
        (m) => m.OrderStatusPageComponent,
      ),
  },
  {
    // The old path, kept alive: links to it were handed to customers as a Location header.
    path: ':tenantSlug/order-success/:orderId',
    redirectTo: ':tenantSlug/order-status/:orderId',
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Scan to order',
    loadComponent: () =>
      import('./features/shell/scan-prompt.component').then((m) => m.ScanPromptComponent),
  },
  { path: '**', redirectTo: '' },
];
