# QR Ordering — web app

Angular 18, standalone components, signals. Two audiences in one build: the customer's phone,
and the manager's laptop behind the counter.

## Routes

| Route | View |
| --- | --- |
| `/:tenantSlug/table/:tableNumber` | The menu for that table. |
| `/:tenantSlug/order-success/:orderId` | The receipt and live status of a placed order. |
| `/admin/:tenantSlug/menu` | Product and category manager. |
| `/admin/:tenantSlug/inventory` | Ingredients, plus the recipe editor. |
| `/admin/:tenantSlug/stock` | Low-stock dashboard and restocking. |
| `/admin/:tenantSlug/orders` | Live order board. |
| `/` | "Scan the code on your table" — there is no useful menu without both parameters. |

The admin area is a lazy-loaded child route, so the customer bundle never contains it.

Parameters are read straight off the URL: `withComponentInputBinding()` in `app.config.ts` hands
each segment to a signal input (`tenantSlug = input.required<string>()`), and
`paramsInheritanceStrategy: 'always'` lets an admin child route see `:tenantSlug` from its parent
without repeating it in every path.

There is no session and no login — the printed QR link is the entire context, which is also why
`POST /api/v1/orders` on the API is a public endpoint that names its tenant by slug in the body.

## Structure

```
src/app/
  core/
    api.models.ts        Wire shapes of the API (camelCase mirrors of the C# DTOs).
    load-state.ts        loadResource(): the signal state handler every view uses.
    menu-api.service.ts  Tenant + categories + products in one forkJoin.
    order-api.service.ts Place an order, read one back.
    cart.store.ts        cart = signal<CartItem[]>([]) plus its derived totals.
    money.pipe.ts        Intl currency formatting in the phone's own locale.
  features/              Customer: menu, order status, bare-origin prompt.
  admin/
    admin-shell.component.ts  Sidebar + outlet.
    admin.routes.ts
    data/                     AdminApiService and its request shapes.
    ui/modal.component.ts
    pages/                    Product manager, inventory + recipe editor, stock, orders.
```

State is signals; RxJS appears only where HTTP does.

### `loadResource`

Every view that reads from the API holds one of these:

```ts
protected readonly stock = loadResource(
  computed(() => ({ slug: this.tenantSlug(), lowOnly: this.lowOnly() })),
  ({ slug, lowOnly }) => this.api.getIngredients(slug, lowOnly),
);
```

It re-fetches whenever the params signal changes and exposes `loading` / `data` / `error` as
narrow computed signals, so templates never unwrap a union. Two extras earn their keep:

- `reload({ silent: true })` refetches **without** dropping back to the loading state. The order
  board polls every ten seconds; blanking the table under someone's finger is worse than the
  staleness it fixes.
- `patch(fn)` rewrites the loaded value in place. Completing an order or logging a restock folds
  the server's own response into the row instead of refetching the list.

## The cart

`CartStore.cart` is the signal the spec asked for, with `itemCount`, `totalPrice` and `isEmpty`
computed off it. Two behaviours worth knowing:

- **Scoped to a tenant *and* a table.** Moving to another table starts a fresh basket instead of
  inheriting the last one.
- **Survives a reload**, in `localStorage` under `qr-cart:{slug}::{table}`. Phones discard
  background tabs freely and losing a half-built order to that is infuriating. On load the
  basket is reconciled against the live menu, so a line whose product was deactivated
  disappears rather than being rejected at checkout.

Prices are never sent to the server. The basket shows menu prices; the API re-reads them and
snapshots its own onto the order.

## The admin area

Four views, one sidebar (a scrolling strip of tabs below 60rem):

- **Menu** — products and categories, created and edited in a modal. Hidden products stay in
  history but leave the customer menu.
- **Ingredients & recipes** — the stock items, and a recipe editor that reads as the sentence it
  is: *1 Espresso needs `0.018` kg of Coffee beans*. Saving POSTs the whole recipe, matching the
  API's replace-everything semantics, and refuses a zero quantity or a repeated ingredient before
  the round trip.
- **Low stock** — every ingredient with a red badge when `currentStock <= minimumStockAlert`,
  filterable to just those, with quick restock and write-off. Stock is never edited directly:
  both go through `POST /ingredients/{id}/adjust`, which is what writes the ledger line.
- **Orders** — the live board, polling every ten seconds (pausable), filterable by status, with
  *Mark completed* on each pending ticket.

Every admin request carries `X-Tenant-Id: <slug>` as an explicit argument rather than through an
interceptor — the customer's checkout POST on the same origin must *not* send that header, and an
argument makes that impossible to get wrong.

**There is no authentication.** Anyone who reaches `/admin/{slug}` can rewrite that restaurant's
menu and stock.

## Demo mode

The whole app runs with no backend at all when `DEMO_MODE` is set. An HTTP interceptor answers
every `/api/` call from an in-memory store seeded with a Tunisian cafe — menu, ingredients,
recipes and two orders — held in `localStorage` and reset from the banner at the top.

```bash
npm run start:demo     # http://localhost:4200
npm run build:demo     # production bundle with demo mode baked in
```

It is an interceptor rather than a flag threaded through the services, so the components,
stores and HTTP services run exactly the code they run against the real API — the demo cannot
quietly drift away from the product. The demo backend keeps state and enforces the rules worth
showing: recipes deduct stock on every order, and an order it cannot fulfil is refused whole,
with the shortage naming the ingredient. What it does not do is enforce tenancy — there is one
restaurant, and any slug resolves to it, so a demo link never 404s on a typo.

`demo-backend.ts` is imported lazily, so a normal build never ships the seed data (it is a
separate ~4 kB chunk).

### Everything is reachable

Every route the product has is served by the demo backend — all 28 endpoints the app calls,
across both customer screens, all seven admin pages and the floor planner. Opening `/` in demo
mode gives an index of all of them, grouped by who uses them, so none is reachable only by
guessing a URL. The seed is arranged so each one has something to show on arrival: orders
spanning dine-in, takeaway and delivery, two ingredients already under threshold, an open
service request, a review, and a saved floor plan.

Two entry points worth knowing about, because neither is reachable by clicking around:

- **Follow an order** opens the customer's order-status screen against a seeded ticket, so
  cancel / call a waiter / leave a review can be tried without placing an order first.
- **Floor planner** is a single static page at `/floor-planner/`, outside the Angular app.

### Saying so

A demo that looks like production is how someone ends up believing an order reached a kitchen,
so it says otherwise in three places:

- a sticky banner on every page of the app, with the **Reset data** button on it;
- the same banner on the floor planner, which sits outside the app and reads the flag from
  `env.js` (opened straight off disk that script just fails to load, and the planner works as
  before — it has never needed a backend);
- `Demo ·` in front of every tab title, via `DemoTitleStrategy`. The banner only reaches
  someone already looking at the page; the title reaches the tab strip, a bookmark and the
  preview of a pasted link, which is where a shared demo is most likely to be mistaken for
  the real thing.

All three are off unless `DEMO_MODE` is set, and the title strategy then behaves exactly like
Angular's default.

## Configuration

`src/environments/environment.ts` is development (`http://localhost:5080`). The production build
swaps in `environment.prod.ts` through the `fileReplacements` entry in `angular.json`.

Above that sits a runtime override: `window.__ORDER_API_BASE_URL__`, assigned in
`public/env.js`, which `index.html` loads before the bundle. It exists because `ng build` does
not read `process.env`, so a deployment platform's environment variable has no other way in.
`scripts/write-env.mjs` runs as the npm `prebuild` step and generates that file from
`API_BASE_URL`:

```bash
API_BASE_URL=https://api.example.com npm run build
```

With `API_BASE_URL` unset it leaves the checked-in inert file alone, so a plain local build
behaves exactly as it did before.

Whichever you use, add the deployed origin to `Cors:AllowedOrigins` in the API's configuration,
or the browser blocks every request.

## Commands

```bash
npm start          # http://localhost:4200, proxied at nothing — talks to the API directly
npm run build      # production build into dist/frontend/browser
npm test           # unit tests (needs a Chromium; CHROME_BIN works for Edge)
```

Try it against the seeded demo tenant at
<http://localhost:4200/demo-resto/table/12>.

## Deploying to Vercel

`vercel.json` lives here rather than at the repository root, because the repo also holds a .NET
backend: point Vercel's **Root Directory** at `frontend` and it will pick this up.

```jsonc
{
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "dist/frontend/browser",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

The catch-all rewrite is what makes `/demo-resto/table/12` and `/admin/demo-resto/stock` survive
a hard refresh: Vercel serves a real file when one exists and falls back to `index.html`
otherwise, so the Angular router sees the deep link instead of a 404.

### Environment variables

**Project Settings → Environment Variables**:

| Name | Example | Environments |
| --- | --- | --- |
| `API_BASE_URL` | `https://api.example.com` | Production, Preview, Development |
| `DEMO_MODE` | `true` | whichever should run without a backend |

Vercel exposes them to the build, `prebuild` writes them into `public/env.js`, and the app reads
them at runtime. Give Preview a staging API and Production the real one — the same source
produces both, with no `environment.*.ts` edits.

Setting `DEMO_MODE=true` is all a deployment needs: with no backend reachable, and no
`API_BASE_URL` required, the site is fully usable on its own. That is the fastest way to put
this in front of someone.

`env.js` is served with `Cache-Control: no-store`, so changing the variable and redeploying takes
effect immediately rather than after a CDN cache expires.

### After the first deploy

Add the Vercel domain to the API's CORS allow-list (`Cors__AllowedOrigins__0` in
`k8s/backend-deployment.yaml`, or `CORS_ORIGIN_0` in the repository's `.env` for compose) and
restart the API. Until you do, the site loads and every request fails — the only visible sign is
a CORS error in the browser console.
