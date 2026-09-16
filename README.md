# Order & Stock

Multi-tenant QR ordering and recipe-based inventory: a .NET 8 Web API (Clean Architecture) on
PostgreSQL 16 via EF Core, and the Angular 18 app a customer's phone opens.

## Layout

```
src/
  Core/
    Domain/          Entities + value objects. No EF Core, no ASP.NET Core.
    Application/     Interfaces, DTOs, business services (vertical slices under Features/).
  Infrastructure/    EF Core DbContext, Fluent API configs, migrations, tenant middleware.
  Api/               Controllers, exception middleware, Program.cs, Dockerfile.
tests/
  Api.IntegrationTests/   The API against a throwaway PostgreSQL container.
frontend/          Angular 18 app — customer menu and admin dashboard.
k8s/               Kubernetes manifests for the API and PostgreSQL.
```

Dependencies point inwards: `Api → Infrastructure → Application → Domain`.

## Multi-tenancy

Every table except `tenants` carries a `tenant_id` column, enforced by three cooperating pieces:

1. **`TenantMiddleware`** (`src/Infrastructure/Multitenancy`) resolves the tenant per request from
   the `X-Tenant-Id` header — which accepts either the tenant **Guid** or its **slug** — or from a
   `/api/t/{slug}/...` route. Unresolved requests get `400`/`404` and never reach a controller.
   `/swagger`, `/health` and `/api/v1/tenants` are bypassed, and `/api/v1/orders` is
   *tenant-optional*: it still honours the header, but those endpoints name their own tenant
   (a slug in the body, a tenant id in the route) and bind it themselves via `ITenantBinder`.
2. **`CurrentTenant`** is the scoped holder the middleware writes to.
3. **`ApplicationDbContext`** installs `HasQueryFilter(e => e.TenantId == CurrentTenantId)` on every
   `ITenantEntity` and stamps `TenantId` on insert. Clients never send a `TenantId`; an unresolved
   tenant filters to `Guid.Empty`, i.e. no rows.

Because the filter reads a *property of the context*, EF re-evaluates it per query, so the compiled
model stays shared across requests while each request still sees only its own tenant.

## Entities

| Entity | Table | Notes |
| --- | --- | --- |
| Tenant | `tenants` | System-wide (no query filter). Unique `slug`. |
| Category | `categories` | Unique `(tenant_id, name)`. |
| Product | `products` | `price numeric(10,2)`, optional `image_url`, FK to category is `RESTRICT`. |
| Ingredient | `ingredients` | `current_stock`/`minimum_stock_alert` `numeric(18,4)`, unit value object. |
| RecipeItem | `recipe_items` | Unique `(product_id, ingredient_id)`; ingredient FK is `RESTRICT`. |
| StockLog | `stock_logs` | Append-only ledger; one line per stock movement, `order_id` when an order caused it. |
| Order | `orders` | `total_amount numeric(10,2)`, `status` stored as text. |
| OrderItem | `order_items` | `unit_price numeric(10,2)` snapshotted at order time. |

`RecipeItem`, `OrderItem` and `StockLog` each carry their own `tenant_id` (denormalised from
their parent) so they are covered by the same global filter as every other tenant table.

Naming is snake_case throughout via `EFCore.NamingConventions`.

## Running

### Everything in Docker

```bash
cp .env.example .env
docker compose up --build
```

- PostgreSQL 16 → `localhost:5432`
- API → <http://localhost:5080/swagger>

`docker-compose.yml` is the production shape; `docker-compose.override.yml` is merged on top
automatically and is what makes the local run convenient — it publishes the database port, runs
migrations, seeds the `demo-resto` tenant and turns on Swagger. For the production shape, skip
the override explicitly:

```bash
docker compose -f docker-compose.yml up -d --build
```

### Database in Docker, API on the host

```bash
docker compose up -d postgres
dotnet run --project src/Api/Api.csproj
```

The `Development` profile also migrates and seeds on startup.

### Migrations

Four migrations are committed: `20260816090000_InitialCreate`, `20260816120000_AddStockLog`,
`20260817090000_AddOrders` and `20260818090000_AddProductImageUrl`. Apply them explicitly with:

```bash
dotnet ef database update \
  --project src/Infrastructure/Infrastructure.csproj \
  --startup-project src/Api/Api.csproj
```

Add another:

```bash
dotnet ef migrations add <Name> \
  --project src/Infrastructure/Infrastructure.csproj \
  --startup-project src/Api/Api.csproj
```

`ApplicationDbContextFactory` lets `dotnet ef` run without booting the API; override the target
database with `ConnectionStrings__Default`.

## Inventory & recipes

All routes are under `/api/v1`.

### Stock only moves through the ledger

Every change to `current_stock` writes exactly one `stock_logs` row carrying the signed
`change_amount`, the `previous_stock`/`new_stock` either side of it, a reason and an optional note.
That includes opening stock at creation time, so `SUM(change_amount)` always equals
`current_stock`. `UpdateIngredientRequest` deliberately has no stock field — the only ways in are:

| Endpoint | Use |
| --- | --- |
| `POST /api/v1/ingredients/{id}/adjust` | Signed movement: `+12` delivery, `-0.75` waste. |
| `POST /api/v1/ingredients/{id}/recount` | Absolute figure after a physical count; the delta is derived. |
| `POST /api/v1/stock/deduct` | Order consumption, via recipes. |

Reasons: `Delivery`, `Waste`, `Spoilage`, `InventoryCount`, `OrderConsumption`,
`OrderCancellation`, `Manual` (serialised as names).

Read the ledger at `GET /api/v1/stock/logs` (tenant-wide) or
`GET /api/v1/ingredients/{id}/stock-logs`.

### Recipe mapping

`POST /api/v1/products/{productId}/recipe` maps several ingredients at once and is a **full
replacement** — lines missing from the body are removed, an empty list clears the recipe. The
single-line endpoints (`POST|PUT|DELETE …/recipe/items`) are still there for incremental edits.

### Availability and deduction

`CheckStockAvailabilityAsync(items)` expands each order line through its recipe, aggregates the
requirement per ingredient (the same product on two lines is charged once, for the total), and
compares it with stock. It reports; it never reserves:

```jsonc
// POST /api/v1/stock/availability   [{ "productId": "…", "quantity": 3 }]
{
  "isAvailable": false,
  "shortages": [{
    "ingredientName": "Lait", "unit": "L",
    "requiredQuantity": 0.6, "availableQuantity": 0.1, "missingQuantity": 0.5,
    "blockedProductIds": ["…"]
  }]
}
```

`POST /api/v1/stock/deduct` commits it. It opens a `ReadCommitted` transaction, locks the
ingredient rows with `SELECT … FOR UPDATE` **before** re-checking them, then deducts and logs.
The locking is the point: without it two concurrent orders both read the last portion, both find
it sufficient, and both deduct. Insufficient stock returns `409` with a `shortages` extension on
the problem document and changes nothing — a half-deducted order would corrupt the ledger.

Products with no recipe consume nothing and deduct successfully.

## The QR order engine

`POST /api/v1/orders` is the customer-facing endpoint. It is **public**: a phone that just
scanned a QR code has no tenant header, so the restaurant is named by slug in the body.

```jsonc
// POST /api/v1/orders          (no X-Tenant-Id header)
{
  "tenantSlug": "demo-resto",
  "tableNumber": "12",
  "items": [{ "productId": "0f8d…", "quantity": 3 }]
}
```

Prices are never accepted from the client — the server reads them off the menu and snapshots
them onto the line, so re-pricing the menu tomorrow cannot rewrite tonight's bill. Repeated
products fold into one line: two taps on "add" is a quantity of 2.

### One transaction, all of it

`CreateOrderCommandHandler` owns the boundary. In a single `ReadCommitted` transaction it:

1. binds the tenant from the slug (which is what switches the global query filter on);
2. reads the products through that filter — unknown ones 404, inactive ones 400;
3. builds the order, priced from the menu, and flushes it so ledger lines have an `order_id`;
4. calls `IStockService.DeductForOrderAsync(items, orderId)`, which **joins** the open
   transaction rather than starting its own: it locks the ingredient rows with
   `SELECT … FOR UPDATE`, re-checks them under the lock, deducts, and writes one
   `stock_logs` line per ingredient stamped with the order;
5. commits.

A shortage throws, the transaction is disposed un-committed, and *nothing* remains: no order
row, no lines, no stock movement. The response is `400` with the shortages on the problem
document:

```jsonc
{
  "title": "Insufficient stock",
  "status": 400,
  "shortages": [{
    "ingredientName": "Milk", "unit": "L",
    "requiredQuantity": 0.6, "availableQuantity": 0.1, "missingQuantity": 0.5,
    "blockedProductIds": ["…"]
  }]
}
```

That `400` is deliberate and local to this endpoint — `POST /api/v1/stock/deduct` still answers
`409` for the same condition. To an admin draining stock it is a conflict to retry; to a
customer at a table the basket is simply not orderable.

### Reading orders

| Endpoint | Use |
| --- | --- |
| `GET /api/v1/orders/tenant/{tenantId}?status=Pending&take=100` | The kitchen/admin board, newest first. |
| `GET /api/v1/orders/{id}?tenantSlug=demo-resto` | One order; the `tenantSlug` stands in for the header so a customer can follow the `Location` they were given. |
| `POST /api/v1/orders/{id}/complete` | Marks a pending order served. Staff action, so it needs the `X-Tenant-Id` header. |

Completing an order moves no stock — the ingredients went when it was placed — so it needs
neither a transaction nor a ledger line. A second attempt gets `422` rather than silently
reopening anything.

`status` is `Pending`, `Completed` or `Cancelled`. If a header *and* a route/body tenant are both
present and disagree, the request is refused with `400` rather than one silently winning.

## The Angular app

`frontend/` holds both faces of the product — standalone components and signals throughout,
with every route carrying its own context in the URL:

| Route | View |
| --- | --- |
| `/:tenantSlug/table/:tableNumber` | Customer menu, category tabs, floating cart drawer. |
| `/:tenantSlug/order-success/:orderId` | Customer receipt and order status. |
| `/admin/:tenantSlug/menu` | Products and categories. |
| `/admin/:tenantSlug/inventory` | Ingredients, and the recipe editor that maps them to products. |
| `/admin/:tenantSlug/stock` | Low-stock dashboard and restocking. |
| `/admin/:tenantSlug/orders` | The live order board. |

The admin area is lazy-loaded, so a customer's phone never downloads it.

```bash
cd frontend
npm install
npm start        # http://localhost:4200/demo-resto/table/12  (needs the API running)
npm run start:demo   # ...or run the whole UI with no backend at all
```

**Demo mode** is the quickest way to see the product: `DEMO_MODE=true` (or `npm run start:demo`)
swaps the network for an in-memory backend seeded with a Tunisian cafe. Every workflow runs
against it — both customer screens, all seven admin pages and the floor planner — with nothing
else running; open `/` for an index of all of them. It says it is a demo in a banner on every
page and in each tab title. It is the one configuration that is deployable today — see
`frontend/README.md`.

It talks to this API directly: tenant-scoped calls send `X-Tenant-Id: <slug>` (the header takes
a slug as happily as a Guid), and checkout posts to the public `POST /api/v1/orders`. The API
already allows `http://localhost:4200`; add any deployed origin to `Cors:AllowedOrigins`.

**The admin area is unauthenticated.** Anyone who can reach `/admin/{slug}` can rewrite that
restaurant's menu and stock. It is behind nothing at all — see "Not yet built".

`frontend/README.md` covers the cart store, environment configuration and Vercel deployment.

## Tests

`tests/Api.IntegrationTests` runs the real API against a throwaway PostgreSQL 16 container
(Testcontainers), because the behaviour under test — `FOR UPDATE` locking, check constraints,
transaction rollback — is exactly what an in-memory provider fakes away. **Docker must be
running.**

```bash
dotnet test
```

Each test provisions its own tenant, so they share the container without sharing data. Covered:
stock deduction and its ledger lines, all-or-nothing rollback on a shortage, concurrent
deductions not overselling (8 parallel orders against 5 portions → exactly 5 succeed),
availability reporting, adjust/recount/opening-stock logging, low-stock filtering, recipe
replacement, and tenant isolation on every one of those paths.

The Angular app has its own suite (`cd frontend && npm test`, needs a Chromium — set
`CHROME_BIN` to use Edge). On the customer side: route parameters reaching signal inputs,
category filtering, cart totals, the exact body posted at checkout, the shortage message naming
the blocked dish, and stale basket lines being dropped. On the admin side: the low-stock badge,
restock and write-off request bodies, the recipe editor's full-replacement POST, and the order
board completing a ticket and patching the row in place.

`OrderEngineTests` also covers completion: a served order moves no stock, a second attempt is
refused, and neither another restaurant nor a caller without a tenant header can close a ticket.

`OrderEngineTests` covers the order engine over the same container: pricing from the menu,
ledger lines carrying the order id, a shortage leaving neither order nor movement behind,
eight concurrent orders against five portions (exactly five orders exist afterwards), merged
duplicate lines, ordering without a tenant header, an inactive or foreign product being
refused, and the admin board's status filter and tenant scoping.

## Deployment

Backend and database run on your own infrastructure; the Angular app is served by Vercel. They
sit on different domains, which is why the API keeps an explicit CORS allow-list — misconfigure
it and the frontend loads but every request fails in the browser console.

### Docker image

```bash
docker build -f src/Api/Dockerfile -t ghcr.io/OWNER/orderstock-api:1.0.0 .
docker push ghcr.io/OWNER/orderstock-api:1.0.0
```

Multi-stage: the SDK image compiles, the `mcr.microsoft.com/dotnet/aspnet:8.0` runtime image
ships. It runs as the image's non-root user and publishes port 8080. There is no `HEALTHCHECK`
instruction because the runtime image contains neither curl nor wget — probe `/health/ready`
from outside instead, which is what compose and Kubernetes both do.

The same image also applies migrations: `dotnet Api.dll --migrate` runs them and exits, so
production never needs the SDK or `dotnet-ef` on the box.

### Kubernetes

```bash
kubectl create namespace orderstock
kubectl config set-context --current --namespace=orderstock

kubectl apply -f k8s/
```

Four things must be edited first — the Secret's password, the image tag in
`backend-deployment.yaml` and `migrate-job.yaml`, the CORS origin, and the Ingress host.
`k8s/README.md` has the details, the staged apply order, and how to run the migration Job.

The API pods run with `Database__MigrateOnStartup=false`: with two replicas, both would race
each other through EF Core's migration history on boot. `k8s/migrate-job.yaml` does it once.

Probes are split for a reason. `/health/live` checks nothing but the process, so a database blip
does not restart every pod and turn a degraded service into no service. `/health/ready` includes
the database, so a pod that cannot reach PostgreSQL leaves the Service's endpoints until it can.

### Vercel

Point Vercel's **Root Directory** at `frontend`; `frontend/vercel.json` supplies the rest
(`npm ci`, `npm run build`, output `dist/frontend/browser`, and the catch-all rewrite that makes
`/demo-resto/table/12` survive a hard refresh).

Set one environment variable in **Project Settings → Environment Variables**:

| Name | Example | Scope |
| --- | --- | --- |
| `API_BASE_URL` | `https://api.example.com` | Production, Preview, Development |

`ng build` does not read `process.env`, so the `prebuild` step (`frontend/scripts/write-env.mjs`)
writes it into `public/env.js`, which `index.html` loads before the bundle. Point Preview at a
staging API and Production at the real one; nothing needs rebuilding by hand.

Then add the Vercel domain to the API's CORS list — `Cors__AllowedOrigins__0` in
`k8s/backend-deployment.yaml`, or `CORS_ORIGIN_0` in `.env` for compose. Preview deployments get
generated subdomains, so add `Cors__AllowedOrigins__1` for the `*.vercel.app` origin you
actually use.

## Trying it out

```bash
# 1. Create a tenant (no tenant header — this endpoint is bypassed by the middleware)
curl -X POST http://localhost:5080/api/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name":"Chez Maher","slug":"chez-maher","currency":"TND"}'

# 2. Everything else is tenant-scoped; the header takes the id or the slug
curl http://localhost:5080/api/v1/categories -H 'X-Tenant-Id: chez-maher'

curl -X POST http://localhost:5080/api/v1/categories \
  -H 'X-Tenant-Id: chez-maher' -H 'Content-Type: application/json' \
  -d '{"name":"Boissons","sortOrder":1}'

# 3. Stock movements
curl -X POST http://localhost:5080/api/v1/ingredients/{id}/adjust \
  -H 'X-Tenant-Id: chez-maher' -H 'Content-Type: application/json' \
  -d '{"changeAmount":5.5,"reason":"Delivery","note":"Pallet #42"}'

# 4. Map a recipe, then check whether an order can be served
curl -X POST http://localhost:5080/api/v1/products/{productId}/recipe \
  -H 'X-Tenant-Id: chez-maher' -H 'Content-Type: application/json' \
  -d '{"items":[{"ingredientId":"…","quantityRequired":0.018}]}'

curl -X POST http://localhost:5080/api/v1/stock/availability \
  -H 'X-Tenant-Id: chez-maher' -H 'Content-Type: application/json' \
  -d '[{"productId":"…","quantity":3}]'
```

```bash
# 5. Order from a table — public, no tenant header
curl -X POST http://localhost:5080/api/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"chez-maher","tableNumber":"12","items":[{"productId":"…","quantity":2}]}'

# 6. The admin board
curl "http://localhost:5080/api/v1/orders/tenant/{tenantId}?status=Pending" \
  -H 'X-Tenant-Id: chez-maher'
```

`GET /api/v1/products/{id}/recipe` also returns `maxProducibleUnits` — how many units current
stock supports, capped by the scarcest ingredient.

## Not yet built

- **Order cancellation.** Completing an order is built; cancelling is not. It is the case that
  has to put the ingredients back — a `StockChangeReason.OrderCancellation` movement in reverse,
  under the same row lock — and half of that would quietly make the ledger lie. `Order.Cancel()`
  exists on the entity; nothing calls it.
- **Authentication on the admin area.** `/admin/:tenantSlug` and every write it makes are open to
  anyone who guesses a slug. `ITenantBinder` already refuses a request whose header and route
  disagree, which is the seam an auth check slots into, but there is no check yet.
- **Rate limiting on `POST /api/v1/orders`.** It is public and unauthenticated by design; today
  anyone who knows a slug can place orders and drain that restaurant's stock.
- **Image uploads.** `products.image_url` holds a URL the API never validates beyond its scheme;
  there is no upload endpoint, so pictures have to be hosted elsewhere for now. The menu falls
  back to a coloured tile per product when the field is empty.
- **An admin UI.** `frontend/` is the customer app only; menus, stock and the order board are
  still Swagger-and-curl territory.
- **Concurrency on manual adjustments.** `adjust`/`recount` do not take a row lock — two
  simultaneous manual edits to the same ingredient can interleave. Order deduction, where it
  matters, does lock.
- **AuthN/AuthZ.** `/api/v1/tenants` is unauthenticated provisioning; put it behind an admin policy
  before deploying anywhere real.
