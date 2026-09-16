# Floor planner

A single, dependency-free HTML file for drawing a restaurant from above — walls, doors, tables
and zone labels — and generating the plan the waiter view will render.

Open it either way:

- **Double-click `index.html`.** No build, no server, no network.
- **`/floor-planner/`** on the running app (it ships in `public/`), including the deployed demo.

Work autosaves to `localStorage`, so closing the tab does not lose the plan.

## Drawing

| Tool | Key | What it does |
| --- | --- | --- |
| Select / move | `V` | Click to select, drag to move, `Delete` to remove. |
| Wall | `W` | Drag from one point to another. Snaps to the grid. |
| Door | `D` | Same, drawn as a dashed gap in the accent colour. |
| Table | `T` | Click to drop an 80 × 80 cm, 4-seat square. |
| Zone label | `L` | Free text such as "Terrasse". |

`Ctrl+Z` undoes. The wheel zooms, and ⤢ fits the plan to the window.

Everything is in **centimetres from the top-left**, which is why a real 4-seat square comes out
at 80 cm and the default grid is 25 cm. Keeping real units means a plan drawn here stays
meaningful if it is ever printed or measured against the actual room.

## The two fields that matter

- **Table number** — this is the join key. It must match the number printed on that table's QR
  code, because that is what an order carries in `Order.tableNumber`. Get this wrong and the
  waiter view will render a table with no orders attached to it.
- **Section** — optional, e.g. "Terrasse" or "Salle". It exists so a waiter can be shown only
  the tables they are managing.

## Generating the code

**Generate code** produces the plan in two forms:

- **JSON** — store it per tenant (a column, a file, or a config endpoint) and load it at runtime.
  Best when floor plans change without a deploy, which they do.
- **TypeScript** — a typed `FLOOR_PLAN` constant plus its interfaces, to paste straight into the
  Angular app. Best for getting something on screen quickly.

**Import** takes a previously generated JSON back, so a plan can be edited later. The round trip
is lossless.

### Shape

```jsonc
{
  "schema": "restaurant-floor-plan",
  "version": 1,
  "name": "Ground floor",
  "units": "cm",
  "grid": 25,
  "walls":  [{ "id": "…", "x1": 0, "y1": 0, "x2": 900, "y2": 0, "thickness": 12 }],
  "doors":  [{ "id": "…", "x1": 350, "y1": 640, "x2": 550, "y2": 640, "thickness": 10 }],
  "tables": [
    { "id": "…", "label": "12", "x": 125, "y": 400,
      "width": 80, "height": 80, "seats": 4, "section": "Terrasse" }
  ],
  "labels": [{ "id": "…", "x": 620, "y": 430, "text": "Terrasse" }]
}
```

The plan holds **only geometry**. It deliberately contains nothing about orders, covers or
payment — that would be stale the moment it was exported. The waiter view joins live data on
`label` at render time:

```ts
const byTable = new Map(orders.map((o) => [o.tableNumber, o]));

for (const table of plan.tables) {
  const order = byTable.get(table.label);   // undefined ⇒ the table is free
  // order.status, order.paymentStatus, order.items, order.allergyNotes …
}
```

Everything the brief asks a waiter to see already exists on `OrderDto`: what was ordered
(`items`, with per-line customisations and notes), the payment state (`paymentStatus`,
`paymentMethod`), the order state (`status`), and covers — which you can take from the seat
count, or from the order's line quantities if you would rather count what was actually served.

**Preview as waiter** in the toolbar shows the idea with stand-in data, so the layout can be
judged before any of that is wired up. Those colours are fake; the geometry is not.

## Not built here

The waiter view itself. This tool produces the plan and proves the format carries what the view
needs; rendering it against live orders is a job for the Angular app.
