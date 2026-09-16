import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { environment } from '../../../environments/environment';

interface DemoLink {
  readonly title: string;
  readonly hint: string;
  /** A router path, or a path served outside the app when {@link external} is set. */
  readonly path: string;
  /** Served outside the Angular app, so it needs a plain href and a new tab. */
  readonly external?: boolean;
  readonly primary?: boolean;
}

interface DemoGroup {
  readonly title: string;
  readonly hint: string;
  readonly links: readonly DemoLink[];
}

/** The tenant every demo link points at; the demo backend resolves any slug to it anyway. */
const SLUG = 'demo-resto';

/**
 * A dine-in ticket from the seed, so the customer's order-status screen — cancel, call a
 * waiter, leave a review — has an entry point without placing an order first. The id is part
 * of `seedDemoState()`, so it survives "Reset data".
 */
const SEEDED_ORDER_ID = '55555555-0000-4000-8000-000000000001';

/**
 * Every workflow the product has, one click from the front door. A demo nobody can find their
 * way around only proves the pages compile, so this lists all of them rather than a highlights
 * reel — the admin sidebar is the second way in, not the only one.
 */
const DEMO_GROUPS: readonly DemoGroup[] = [
  {
    title: 'Order as a customer',
    hint: 'What the QR code on a table opens.',
    links: [
      {
        title: 'Order from table 12',
        hint: 'Browse, customise a dish against its recipe, pay and send it to the kitchen',
        path: `/${SLUG}/table/12`,
        primary: true,
      },
      {
        title: 'Follow an order',
        hint: "Table 4's live ticket — cancel it, call a waiter, leave a review",
        path: `/${SLUG}/order-status/${SEEDED_ORDER_ID}`,
      },
    ],
  },
  {
    title: 'Run the restaurant',
    hint: 'The manager dashboard, at /admin.',
    links: [
      {
        title: 'Overview',
        hint: "Today's orders, revenue, open tickets and what is running out",
        path: `/admin/${SLUG}/overview`,
      },
      {
        title: 'Floor',
        hint: 'The room as drawn, each table coloured by what it owes',
        path: `/admin/${SLUG}/floor`,
      },
      {
        title: 'Orders',
        hint: 'Live tickets across dine-in, takeaway and delivery; mark them served',
        path: `/admin/${SLUG}/orders`,
      },
      {
        title: 'Menu',
        hint: 'Products and categories — prices, photos, what customers may see',
        path: `/admin/${SLUG}/menu`,
      },
      {
        title: 'Ingredients & recipes',
        hint: 'Map a dish to what it consumes, so selling it moves stock',
        path: `/admin/${SLUG}/inventory`,
      },
      {
        title: 'Low stock',
        hint: 'Lait and menthe fraîche are already under threshold — restock or write off',
        path: `/admin/${SLUG}/stock`,
      },
      {
        title: 'Service desk',
        hint: 'Tables asking for a hand, and the reviews they left afterwards',
        path: `/admin/${SLUG}/service-desk`,
      },
    ],
  },
  {
    title: 'Tools',
    hint: 'Standalone, with no backend of its own.',
    links: [
      {
        title: 'Floor planner',
        hint: 'Draw the room, then load the plan into the Floor page',
        path: '/floor-planner/',
        external: true,
      },
    ],
  },
];

/**
 * What you get by opening the app's bare origin. Normally there is nothing useful to show
 * without a restaurant and a table, so it says so — but in demo mode this is the front door of
 * a deployed link, and it becomes the index of what there is to look at.
 */
@Component({
  selector: 'app-scan-prompt',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      @if (demo) {
        <header class="head">
          <div class="glyph" aria-hidden="true">▦</div>
          <h1>Café Sidi Bou</h1>
          <p class="lede">
            A running demo of the whole product, with no backend behind it. Everything you
            change is kept in this browser and nowhere else — <strong>Reset data</strong> in the
            bar above puts it all back.
          </p>
        </header>

        @for (group of groups; track group.title) {
          <section class="group">
            <h2 class="group__title">{{ group.title }}</h2>
            <p class="group__hint">{{ group.hint }}</p>

            <nav class="links" [attr.aria-label]="group.title">
              @for (link of group.links; track link.path) {
                @if (link.external) {
                  <a class="link" [href]="link.path" target="_blank" rel="noopener">
                    <span class="link__title">
                      {{ link.title }}<span class="link__out" aria-hidden="true">↗</span>
                    </span>
                    <span class="link__hint">{{ link.hint }}</span>
                  </a>
                } @else {
                  <a class="link" [class.link--primary]="link.primary" [routerLink]="link.path">
                    <span class="link__title">{{ link.title }}</span>
                    <span class="link__hint">{{ link.hint }}</span>
                  </a>
                }
              }
            </nav>
          </section>
        }

        <p class="tip">
          Try ordering seven Cafés Crème — only 1.2 L of milk is left, so the order is refused
          whole rather than half-served.
        </p>
      } @else {
        <div class="scan">
          <div class="glyph" aria-hidden="true">▦</div>
          <h1>Scan the code on your table</h1>
          <p>
            Each table has its own QR code. Scanning it opens that table's menu, so your order
            reaches the right place.
          </p>
        </div>
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100dvh;
        background: var(--surface-2);
      }

      .page {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        min-height: 100dvh;
        padding: 2.5rem var(--gutter) 3rem;
        text-align: center;
      }

      /* Without the demo index there is only the one short message, and it belongs in the
         middle of the screen rather than pinned under the top edge. */
      .scan {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
      }

      .head {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
      }

      .glyph {
        font-size: 3rem;
        line-height: 1;
        color: var(--accent);
      }

      h1 {
        margin: 0;
        font-size: 1.375rem;
        font-weight: 700;
      }

      p {
        margin: 0;
        max-width: 24rem;
        color: var(--text-muted);
        line-height: 1.5;
      }

      .lede {
        max-width: 30rem;
      }

      .group {
        width: 100%;
        max-width: 44rem;
      }

      .group__title {
        margin: 0;
        color: var(--text-faint);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .group__hint {
        margin: 0.1875rem auto 0;
        font-size: 0.8125rem;
      }

      .links {
        display: grid;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }

      @media (min-width: 40rem) {
        .links {
          grid-template-columns: 1fr 1fr;
        }
      }

      .link {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text);
        text-align: left;
        text-decoration: none;
      }

      .link:hover {
        border-color: var(--accent);
      }

      .link--primary {
        border-color: transparent;
        background: var(--accent);
        color: var(--accent-contrast);
      }

      .link__title {
        font-weight: 650;
      }

      .link__out {
        margin-left: 0.3125rem;
        font-size: 0.8125rem;
        opacity: 0.6;
      }

      .link__hint {
        font-size: 0.8125rem;
        opacity: 0.75;
      }

      .tip {
        max-width: 30rem;
        font-size: 0.8125rem;
      }
    `,
  ],
})
export class ScanPromptComponent {
  protected readonly demo = environment.demoMode;
  protected readonly groups = DEMO_GROUPS;
}
