import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NEVER } from 'rxjs';

import { AuthService } from '../core/auth/auth.service';
import { loadResource } from '../core/load-state';
import { IconComponent } from '../shared/icon.component';
import { ThemeToggleComponent } from '../shared/theme-toggle.component';
import { AdminApiService } from './data/admin-api.service';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
  /** 'orders' shows the pending-ticket count; 'stock' shows how many items are low. */
  readonly badge?: 'orders' | 'stock' | 'service';
}

const NAV: readonly NavItem[] = [
  { path: 'overview', label: 'Overview', icon: 'overview' },
  { path: 'floor', label: 'Floor', icon: 'dineIn' },
  { path: 'orders', label: 'Orders', icon: 'orders', badge: 'orders' },
  { path: 'menu', label: 'Menu', icon: 'menu' },
  { path: 'inventory', label: 'Ingredients & recipes', icon: 'inventory' },
  { path: 'stock', label: 'Low stock', icon: 'stock', badge: 'stock' },
  { path: 'service-desk', label: 'Service desk', icon: 'alert', badge: 'service' },
];

/**
 * Admin chrome: a sidebar, a top bar, and the routed view.
 *
 * The counts on Orders and Low stock are the point of the sidebar — a manager should see there
 * is something to deal with without opening the page, which is why both references put a badge
 * there. Sidebar on a desktop, a scrolling strip of tabs on anything narrow.
 */
@Component({
  selector: 'app-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ThemeToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <aside class="side">
        <div class="brand">
          <span class="brand__mark" aria-hidden="true">{{ initial() }}</span>
          <span class="brand__text">
            <span class="brand__name">{{ tenantName() }}</span>
            <span class="brand__sub">POS dashboard</span>
          </span>
        </div>

        <p class="side__label">Main menu</p>

        <nav class="nav" aria-label="Admin sections">
          @for (item of nav; track item.path) {
            <a
              class="nav__link"
              [routerLink]="item.path"
              routerLinkActive="nav__link--active"
              [attr.aria-current]="rla.isActive ? 'page' : null"
              #rla="routerLinkActive"
            >
              <app-icon [name]="item.icon" [size]="18" />
              <span class="nav__label">{{ item.label }}</span>

              @if (badgeFor(item); as count) {
                <span
                  class="nav__badge"
                  [class.nav__badge--alert]="item.badge === 'stock' || item.badge === 'service'"
                >
                  {{ count }}
                </span>
              }
            </a>
          }
        </nav>

        <a class="side__exit" [routerLink]="['/', tenantSlug(), 'table', '1']">
          <app-icon name="external" [size]="15" />
          <span>Customer menu</span>
        </a>
      </aside>

      <div class="view">
        <header class="topbar">
          <div class="store">
            <span class="store__name">{{ tenantName() }}</span>
            <span class="a-badge a-badge--success">Open</span>
          </div>

          <div class="who">
            <span class="who__name">{{ auth.displayName() }}</span>
            <button type="button" class="who__out" (click)="signOut()">Sign out</button>
          </div>

          <app-theme-toggle />
        </header>

        <router-outlet />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--bg);
      }

      .shell {
        display: flex;
        flex-direction: column;
        min-height: 100dvh;
      }

      .side {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 0.625rem;
      }

      .brand__mark {
        display: grid;
        place-items: center;
        width: 2.125rem;
        height: 2.125rem;
        border-radius: var(--radius-sm);
        background: var(--accent);
        color: var(--accent-contrast);
        font-size: 1rem;
        font-weight: 800;
      }

      .brand__text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .brand__name {
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .brand__sub {
        color: var(--text-faint);
        font-size: 0.6875rem;
      }

      .side__label {
        display: none;
      }

      .nav {
        display: flex;
        gap: 0.375rem;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .nav::-webkit-scrollbar {
        display: none;
      }

      .nav__link {
        position: relative;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 0.4375rem;
        padding: 0.4375rem 0.8125rem;
        border-radius: var(--radius-pill);
        background: var(--surface-3);
        color: var(--text-muted);
        font-size: 0.8125rem;
        font-weight: 650;
        text-decoration: none;
        white-space: nowrap;
      }

      .nav__link--active {
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .nav__badge {
        display: inline-grid;
        place-items: center;
        min-width: 1.125rem;
        height: 1.125rem;
        padding: 0 0.3125rem;
        border-radius: var(--radius-pill);
        background: var(--accent);
        color: var(--accent-contrast);
        font-size: 0.6875rem;
        font-weight: 700;
      }

      .nav__link--active .nav__badge {
        background: var(--accent-contrast);
        color: var(--accent);
      }

      .nav__badge--alert {
        background: var(--danger-text);
        color: #fff;
      }

      .side__exit {
        display: none;
      }

      .view {
        flex: 1;
        min-width: 0;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.625rem 1.25rem;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .store {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.3125rem 0.3125rem 0.3125rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        font-size: 0.8125rem;
        font-weight: 650;
      }

      .who {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-left: auto;
        font-size: 0.8125rem;
      }

      .who__name {
        color: var(--text-muted);
        font-weight: 650;
        /* The name is context, not a control; it goes first to lose on a narrow screen. */
        display: none;
      }

      .who__out {
        padding: 0.375rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--surface);
        color: var(--text-muted);
        font: inherit;
        font-size: 0.75rem;
        font-weight: 650;
        cursor: pointer;
      }

      .who__out:hover {
        color: var(--text);
      }

      @media (min-width: 40rem) {
        .who__name {
          display: inline;
        }
      }

      @media (min-width: 60rem) {
        .shell {
          flex-direction: row;
        }

        .side {
          position: sticky;
          top: 0;
          align-self: flex-start;
          width: 16.5rem;
          height: 100dvh;
          padding: 1.25rem 0.875rem;
          gap: 0.375rem;
          border-bottom: 0;
          border-right: 1px solid var(--border);
        }

        .brand {
          padding: 0 0.5rem 0.75rem;
        }

        .side__label {
          display: block;
          margin: 0.5rem 0 0.375rem;
          padding: 0 0.5rem;
          color: var(--text-faint);
          font-size: 0.6875rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .nav {
          flex-direction: column;
          gap: 0.125rem;
          overflow: visible;
        }

        .nav__link {
          gap: 0.625rem;
          padding: 0.5625rem 0.75rem;
          border-radius: var(--radius-sm);
          background: transparent;
          white-space: normal;
        }

        .nav__link:hover {
          background: var(--surface-2);
          color: var(--text);
        }

        /* The active marker from both references: a tint plus a bar on the leading edge. */
        .nav__link--active,
        .nav__link--active:hover {
          background: var(--accent-soft);
          color: var(--accent);
        }

        .nav__link--active::before {
          content: '';
          position: absolute;
          left: -0.875rem;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 1.375rem;
          border-radius: 0 3px 3px 0;
          background: var(--accent);
        }

        .nav__label {
          flex: 1;
        }

        .nav__link--active .nav__badge {
          background: var(--accent);
          color: var(--accent-contrast);
        }

        .side__exit {
          display: flex;
          align-items: center;
          gap: 0.4375rem;
          margin-top: auto;
          padding: 0.5625rem 0.75rem;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          font-size: 0.8125rem;
          font-weight: 600;
          text-decoration: none;
        }

        .side__exit:hover {
          background: var(--surface-2);
          color: var(--text);
        }

        .topbar {
          padding: 0.75rem 2rem;
        }
      }
    `,
  ],
})
export class AdminShellComponent {
  /** From /admin/:tenantSlug/... */
  readonly tenantSlug = input.required<string>();

  protected readonly nav = NAV;
  protected readonly auth = inject(AuthService);

  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  protected signOut(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  private readonly tenant = loadResource(this.tenantSlug, (slug) => this.api.getTenant(slug));

  protected readonly tenantName = computed(() => this.tenant.data()?.name ?? 'Admin');

  protected readonly initial = computed(() => this.tenantName().trim().charAt(0) || 'A');

  private readonly pending = loadResource(
    computed(() => ({ slug: this.tenantSlug(), tenantId: this.tenant.data()?.id ?? null })),
    ({ slug, tenantId }) =>
      // NEVER holds the loading state until the tenant id arrives, rather than firing a
      // request that cannot work.
      tenantId === null ? NEVER : this.api.getOrders(slug, tenantId, 'Pending'),
  );

  private readonly lowStock = loadResource(this.tenantSlug, (slug) =>
    this.api.getIngredients(slug, true),
  );

  private readonly desk = loadResource(this.tenantSlug, (slug) => this.api.getServiceDesk(slug));

  protected badgeFor(item: NavItem): number | null {
    const count =
      item.badge === 'orders'
        ? (this.pending.data()?.length ?? 0)
        : item.badge === 'stock'
          ? (this.lowStock.data()?.length ?? 0)
          : item.badge === 'service'
            ? (this.desk.data()?.requests.filter((r) => r.status !== 'Resolved').length ?? 0)
            : 0;

    return count > 0 ? count : null;
  }
}
