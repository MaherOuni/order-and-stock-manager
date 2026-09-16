import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NEVER, forkJoin, interval, map } from 'rxjs';

import { ORDER_TYPE_LABELS, OrderDto } from '../../core/api.models';
import { FloorPlan, FloorPlanTable, parseFloorPlan, planBounds } from '../../core/floor-plan.models';
import { describeHttpError, loadResource } from '../../core/load-state';
import { MoneyPipe } from '../../core/money.pipe';
import { AdminApiService } from '../data/admin-api.service';

/**
 * Average character width as a fraction of the font size, measured off the rendered labels at
 * this weight and family (~0.46em) with headroom for a name made of wide characters.
 */
const GLYPH_ADVANCE = 0.58;

/** How much of a table's width a label may occupy, leaving it visibly inside its edges. */
const LABEL_INSET = 0.86;

/** Below this a label stops being readable on a phone, so it is truncated instead. */
const MIN_LABEL_PX = 9;

const POLL_MS = 8000;

/** What a table looks like right now, once the plan and the live orders are joined. */
type TableState = 'free' | 'ordered' | 'paid' | 'served' | 'attention';

interface TableView {
  readonly table: FloorPlanTable;
  readonly order: OrderDto | null;
  readonly state: TableState;
  readonly covers: number | null;
}

interface FloorData {
  readonly plan: FloorPlan | null;
  readonly orders: readonly OrderDto[];
  readonly currency: string;
}

const STATE_FILL: Record<TableState, string> = {
  free: 'var(--surface)',
  ordered: 'var(--warning-surface)',
  paid: 'var(--info-surface)',
  served: 'var(--success-surface)',
  attention: 'var(--danger-surface)',
};

const STATE_STROKE: Record<TableState, string> = {
  free: 'var(--border-strong)',
  ordered: 'var(--warning-text)',
  paid: 'var(--info-text)',
  served: 'var(--success-text)',
  attention: 'var(--danger-text)',
};

const STATE_LABEL: Record<TableState, string> = {
  free: 'Free',
  ordered: 'Ordered',
  paid: 'Paid',
  served: 'Served',
  attention: 'Needs attention',
};

/**
 * The room from above, with live orders on it.
 *
 * The plan is only geometry; everything moving comes from the orders, joined on the table
 * number the QR code carries. A waiter picks their section and sees just those tables.
 */
@Component({
  selector: 'app-floor-view',
  standalone: true,
  imports: [DatePipe, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="a-page">
      <div class="a-page__head">
        <div>
          <h1 class="a-page__title">Floor</h1>
          <p class="a-page__hint">
            {{ plan()?.name ?? 'No plan yet' }} — tap a table for its order.
          </p>
        </div>

        <div class="a-toolbar">
          <button
            type="button"
            class="a-btn"
            [class.a-btn--primary]="live()"
            [attr.aria-pressed]="live()"
            (click)="live.set(!live())"
          >
            {{ live() ? 'Live' : 'Paused' }}
          </button>
          <button type="button" class="a-btn" (click)="importOpen.set(true)">Load plan</button>
        </div>
      </div>

      @if (data.error(); as message) {
        <p class="a-error">{{ message }}</p>
      }

      @if (data.loading()) {
        <div class="a-empty"><span class="a-spinner"></span></div>
      } @else if (!plan()) {
        <div class="a-card">
          <p class="a-empty">
            No floor plan yet. Draw one in the
            <a href="/floor-planner/" target="_blank" rel="noopener">floor planner</a>, press
            <strong>Generate code</strong>, then <strong>Load plan</strong> here.
          </p>
        </div>
      } @else {
        <div class="a-toolbar">
          <div class="a-pills" role="group" aria-label="Section">
            <button
              type="button"
              class="a-pill"
              [class.a-pill--active]="section() === null"
              (click)="section.set(null)"
            >
              Whole floor
            </button>
            @for (name of sections(); track name) {
              <button
                type="button"
                class="a-pill"
                [class.a-pill--active]="section() === name"
                (click)="section.set(name)"
              >
                {{ name }}
              </button>
            }
          </div>

          <span class="a-badge a-badge--accent">{{ mine().length }} tables</span>
          <span class="a-badge">{{ totalCovers() }} covers seated</span>
        </div>

        <div class="board">
          <div class="a-card plan">
            <svg [attr.viewBox]="viewBox()" role="img" aria-label="Floor plan">
              @for (wall of plan()!.walls; track wall.id) {
                <line
                  [attr.x1]="wall.x1" [attr.y1]="wall.y1"
                  [attr.x2]="wall.x2" [attr.y2]="wall.y2"
                  [attr.stroke-width]="wall.thickness"
                  class="wall"
                />
              }

              @for (door of plan()!.doors; track door.id) {
                <line
                  [attr.x1]="door.x1" [attr.y1]="door.y1"
                  [attr.x2]="door.x2" [attr.y2]="door.y2"
                  [attr.stroke-width]="door.thickness"
                  class="door"
                />
              }

              @for (label of plan()!.labels; track label.id) {
                <text [attr.x]="label.x" [attr.y]="label.y" class="zone">{{ label.text }}</text>
              }

              @for (view of visible(); track view.table.id) {
                <g
                  class="table"
                  [class.table--dimmed]="dimmed(view)"
                  [class.table--selected]="selected()?.table?.id === view.table.id"
                  (click)="select(view)"
                  role="button"
                  [attr.tabindex]="0"
                  [attr.aria-label]="'Table ' + view.table.label + ', ' + stateLabel(view.state)"
                  (keydown.enter)="select(view)"
                >
                  <rect
                    [attr.x]="view.table.x" [attr.y]="view.table.y"
                    [attr.width]="view.table.width" [attr.height]="view.table.height"
                    rx="8"
                    [style.fill]="fill(view.state)"
                    [style.stroke]="stroke(view.state)"
                  />
                  <text
                    class="num"
                    [attr.x]="view.table.x + view.table.width / 2"
                    [attr.y]="view.table.y + view.table.height / 2 + 2"
                    [style.font-size.px]="labelSize(view.table)"
                  >{{ labelText(view.table) }}</text>
                  <text
                    class="sub"
                    [attr.x]="view.table.x + view.table.width / 2"
                    [attr.y]="view.table.y + view.table.height / 2 + 24"
                  >{{ caption(view) }}</text>
                </g>
              }
            </svg>

            <div class="legend">
              @for (state of states; track state) {
                <span class="key">
                  <span class="swatch" [style.background]="fill(state)" [style.borderColor]="stroke(state)"></span>
                  {{ stateLabel(state) }}
                </span>
              }
            </div>
          </div>

          <aside class="a-card detail">
            @if (selected(); as view) {
              <div class="a-card__head">
                <h2 class="a-card__title">Table {{ view.table.label }}</h2>
                <span class="a-badge" [style.background]="fill(view.state)" [style.color]="stroke(view.state)">
                  {{ stateLabel(view.state) }}
                </span>
              </div>

              <div class="detail__body">
                <p class="meta">
                  Seats {{ view.table.seats }}
                  @if (view.covers !== null) { · {{ view.covers }} seated }
                  @if (view.table.section) { · {{ view.table.section }} }
                </p>

                @if (view.order; as order) {
                  <p class="meta">
                    {{ typeLabel(order) }} · {{ order.createdAt | date: 'shortTime' }} ·
                    {{ order.paymentStatus === 'Paid' ? 'paid by ' + order.paymentMethod : 'unpaid' }}
                  </p>

                  @if (order.allergyNotes) {
                    <p class="allergy"><strong>Allergies:</strong> {{ order.allergyNotes }}</p>
                  }

                  <ul class="lines">
                    @for (line of order.items; track line.id) {
                      <li>
                        <span class="qty">{{ line.quantity }}×</span>
                        <span>
                          {{ line.productName }}
                          @if (line.customizations.length > 0) {
                            <span class="chips">
                              @for (change of line.customizations; track change.ingredientId) {
                                <span class="chip" [class.chip--add]="change.kind === 'Added'">
                                  {{ change.kind === 'Added' ? '+' : '−' }} {{ change.ingredientName }}
                                </span>
                              }
                            </span>
                          }
                          @if (line.notes) {
                            <span class="note">“{{ line.notes }}”</span>
                          }
                        </span>
                        <span class="amount">{{ line.lineTotal | money: currency() }}</span>
                      </li>
                    }
                  </ul>

                  <p class="total">
                    <span>Total</span>
                    <strong>{{ order.totalAmount | money: currency() }}</strong>
                  </p>

                  @if (actionError(); as message) {
                    <p class="a-error">{{ message }}</p>
                  }

                  @if (order.status === 'Pending') {
                    <button
                      type="button"
                      class="a-btn a-btn--primary"
                      style="width:100%"
                      [disabled]="busy()"
                      (click)="complete(order)"
                    >
                      {{ busy() ? 'Saving…' : 'Mark served' }}
                    </button>
                  }
                } @else {
                  <p class="a-empty">Nothing ordered from this table.</p>
                }
              </div>
            } @else {
              <p class="a-empty">Pick a table.</p>
            }
          </aside>
        </div>
      }
    </section>

    @if (importOpen()) {
      <div class="modal">
        <div class="modal__backdrop" (click)="importOpen.set(false)"></div>
        <div class="a-card modal__panel" role="dialog" aria-modal="true" aria-label="Load a floor plan">
          <div class="a-card__head">
            <h2 class="a-card__title">Load a floor plan</h2>
          </div>
          <div class="detail__body">
            <p class="a-note">
              Paste the JSON from the floor planner. Table numbers must match the numbers on the
              QR codes, or their orders will not show up here.
            </p>
            <textarea
              class="a-input"
              rows="10"
              [value]="planText()"
              (input)="planText.set(text($event))"
              placeholder='{ "schema": "restaurant-floor-plan", … }'
            ></textarea>
            @if (importError(); as message) {
              <p class="a-error">{{ message }}</p>
            }
          </div>
          <div class="modal__foot">
            <button type="button" class="a-btn" (click)="importOpen.set(false)">Cancel</button>
            <button type="button" class="a-btn a-btn--primary" [disabled]="busy()" (click)="loadPlan()">
              {{ busy() ? 'Saving…' : 'Save plan' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .board {
        display: grid;
        gap: 1rem;
      }

      @media (min-width: 68rem) {
        .board { grid-template-columns: 1.6fr 1fr; align-items: start; }
      }

      .plan { padding: 0.875rem; }
      .plan svg { width: 100%; height: auto; max-height: 62dvh; display: block; }

      .wall { stroke: var(--text); stroke-linecap: square; }
      .door { stroke: var(--accent); stroke-linecap: round; stroke-dasharray: 2 10; }
      .zone { fill: var(--text-faint); font-size: 22px; font-weight: 650; }

      .table { cursor: pointer; }
      .table rect { stroke-width: 2.5; transition: opacity 0.15s ease; }
      .table--dimmed { opacity: 0.25; pointer-events: none; }
      .table--selected rect { stroke-width: 5; }
      /* Size is bound per table (see labelSize); a rule here would override it. */
      .num { font-weight: 700; text-anchor: middle; fill: var(--text); }
      .sub { font-size: 15px; text-anchor: middle; fill: var(--text-muted); }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.625rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border);
        margin-top: 0.5rem;
      }

      .key {
        display: inline-flex;
        align-items: center;
        gap: 0.3125rem;
        color: var(--text-muted);
        font-size: 0.75rem;
        font-weight: 650;
      }

      .swatch {
        width: 0.875rem;
        height: 0.875rem;
        border: 2px solid;
        border-radius: 4px;
      }

      .detail__body { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }

      .meta { margin: 0; color: var(--text-muted); font-size: 0.8125rem; }

      .allergy {
        margin: 0;
        padding: 0.5rem 0.6875rem;
        border-radius: var(--radius-sm);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.8125rem;
      }

      .lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }

      .lines li {
        display: grid;
        grid-template-columns: 1.75rem 1fr auto;
        gap: 0.5rem;
        font-size: 0.875rem;
        align-items: start;
      }

      .qty { color: var(--text-muted); font-variant-numeric: tabular-nums; }
      .amount { font-variant-numeric: tabular-nums; }

      .chips { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.1875rem; }

      .chip {
        padding: 0.0625rem 0.4375rem;
        border-radius: var(--radius-pill);
        background: var(--danger-surface);
        color: var(--danger-text);
        font-size: 0.6875rem;
        font-weight: 650;
      }

      .chip--add { background: var(--success-surface); color: var(--success-text); }

      .note { display: block; color: var(--text-muted); font-size: 0.75rem; }

      .total {
        display: flex;
        justify-content: space-between;
        margin: 0;
        padding-top: 0.625rem;
        border-top: 1px solid var(--border);
        font-size: 0.9375rem;
      }

      .modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; }
      .modal__backdrop { position: absolute; inset: 0; background: rgb(28 25 23 / 45%); }
      .modal__panel { position: relative; width: min(40rem, 92vw); }
      .modal__foot {
        display: flex; justify-content: flex-end; gap: 0.5rem;
        padding: 0.875rem 1rem; border-top: 1px solid var(--border);
      }

      textarea.a-input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; }
    `,
  ],
})
export class FloorViewComponent {
  readonly tenantSlug = input.required<string>();

  protected readonly states: readonly TableState[] = ['free', 'ordered', 'paid', 'served', 'attention'];

  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly live = signal(true);
  protected readonly section = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);

  private readonly tenant = loadResource(this.tenantSlug, (slug) => this.api.getTenant(slug));

  protected readonly data = loadResource(
    computed(() => ({ slug: this.tenantSlug(), tenantId: this.tenant.data()?.id ?? null })),
    ({ slug, tenantId }) =>
      tenantId === null
        ? NEVER
        : forkJoin({
            plan: this.api.getFloorPlan(slug),
            orders: this.api.getOrders(slug, tenantId, null),
          }).pipe(
            map(
              ({ plan, orders }): FloorData => ({
                plan,
                orders,
                currency: this.tenant.data()?.currency ?? 'TND',
              }),
            ),
          ),
  );

  protected readonly plan = computed(() => this.data.data()?.plan ?? null);
  protected readonly currency = computed(() => this.tenant.data()?.currency ?? 'TND');

  protected readonly viewBox = computed(() => {
    const plan = this.plan();

    if (!plan) return '0 0 1000 700';

    const box = planBounds(plan);

    return `${box.x} ${box.y} ${box.width} ${box.height}`;
  });

  /**
   * The join. One live order per table — the newest one that is still open, because a table
   * that ate earlier and paid is free again as far as the floor is concerned.
   */
  private readonly byTable = computed(() => {
    const map = new Map<string, OrderDto>();

    const open = (this.data.data()?.orders ?? [])
      .filter((order) => order.status !== 'Cancelled')
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const order of open) {
      if (!order.tableNumber) continue;

      const existing = map.get(order.tableNumber);

      // A still-open ticket always beats an older completed one.
      if (!existing || existing.status === 'Completed' || order.status === 'Pending') {
        map.set(order.tableNumber, order);
      }
    }

    return map;
  });

  protected readonly views = computed<TableView[]>(() => {
    const plan = this.plan();

    if (!plan) return [];

    const byTable = this.byTable();

    return plan.tables.map((table) => {
      const order = byTable.get(table.label) ?? null;

      return {
        table,
        order,
        state: stateOf(order),
        covers: order?.covers ?? null,
      };
    });
  });

  protected readonly sections = computed(() => {
    const names = new Set<string>();

    for (const table of this.plan()?.tables ?? []) {
      if (table.section) names.add(table.section);
    }

    return [...names].sort();
  });

  /** The tables this waiter is managing — the whole floor unless a section is picked. */
  protected readonly mine = computed(() => {
    const section = this.section();

    return this.views().filter((view) => section === null || view.table.section === section);
  });

  protected readonly visible = computed(() => this.views());

  protected readonly totalCovers = computed(() =>
    this.mine().reduce((total, view) => total + (view.covers ?? 0), 0),
  );

  protected readonly selected = computed(
    () => this.views().find((view) => view.table.id === this.selectedId()) ?? null,
  );

  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly importOpen = signal(false);
  protected readonly importError = signal<string | null>(null);
  protected readonly planText = signal('');

  constructor() {
    effect((onCleanup) => {
      if (!this.live()) return;

      const subscription = interval(POLL_MS).subscribe(() =>
        this.data.reload({ silent: true }),
      );

      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected fill(state: TableState): string {
    return STATE_FILL[state];
  }

  protected stroke(state: TableState): string {
    return STATE_STROKE[state];
  }

  protected stateLabel(state: TableState): string {
    return STATE_LABEL[state];
  }

  protected typeLabel(order: OrderDto): string {
    return ORDER_TYPE_LABELS[order.orderType];
  }

  /** Tables outside the chosen section stay on the plan but recede — the room is still the room. */
  protected dimmed(view: TableView): boolean {
    const section = this.section();

    return section !== null && view.table.section !== section;
  }

  /**
   * Table names are free text — "12" and "Terrasse 2" both happen — so the number shrinks to
   * fit rather than spilling over the edge of the table it belongs to.
   *
   * SVG text cannot wrap or ellipsize itself, so the width is estimated from GLYPH_ADVANCE. The
   * size must be bound as an inline style: a CSS rule would beat a font-size attribute.
   */
  protected labelSize(table: FloorPlanTable): number {
    const text = this.labelText(table);
    const perCharacter = (table.width * LABEL_INSET) / (text.length * GLYPH_ADVANCE);

    return Math.max(MIN_LABEL_PX, Math.min(26, perCharacter));
  }

  /**
   * A name too long to fit even at the smallest size is cut rather than allowed to run over the
   * neighbouring tables. The detail panel always shows it in full, so nothing is lost.
   */
  protected labelText(table: FloorPlanTable): string {
    const fits = Math.floor((table.width * LABEL_INSET) / (MIN_LABEL_PX * GLYPH_ADVANCE));

    return table.label.length <= fits
      ? table.label
      : `${table.label.slice(0, Math.max(1, fits - 1)).trimEnd()}…`;
  }

  protected caption(view: TableView): string {
    if (!view.order) return `${view.table.seats} seats`;

    const covers = view.covers !== null ? `${view.covers}` : `${view.table.seats}`;

    return `${covers} · ${view.order.items.length} items`;
  }

  protected select(view: TableView): void {
    this.actionError.set(null);
    this.selectedId.set(view.table.id);
  }

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected complete(order: OrderDto): void {
    if (this.busy()) return;

    this.busy.set(true);
    this.actionError.set(null);

    this.api
      .completeOrder(this.tenantSlug(), order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.data.patch((data) => ({
            ...data,
            orders: data.orders.map((o) => (o.id === updated.id ? updated : o)),
          }));
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.actionError.set(describeHttpError(error));
        },
      });
  }

  protected loadPlan(): void {
    if (this.busy()) return;

    let plan: FloorPlan;

    try {
      plan = parseFloorPlan(this.planText());
    } catch (failure) {
      this.importError.set((failure as Error).message);
      return;
    }

    this.busy.set(true);
    this.importError.set(null);

    this.api
      .saveFloorPlan(this.tenantSlug(), plan)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.busy.set(false);
          this.importOpen.set(false);
          this.planText.set('');
          this.data.patch((data) => ({ ...data, plan: saved }));
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.importError.set(describeHttpError(error));
        },
      });
  }
}

/**
 * One table, one colour. "Attention" is the case a waiter should walk towards: served food that
 * has not been paid for, or a ticket that has been sitting too long.
 */
function stateOf(order: OrderDto | null): TableState {
  if (!order) return 'free';

  const ageMinutes = (Date.now() - Date.parse(order.createdAt)) / 60_000;

  if (order.status === 'Completed') {
    return order.paymentStatus === 'Paid' ? 'served' : 'attention';
  }

  if (ageMinutes > 25) return 'attention';

  return order.paymentStatus === 'Paid' ? 'paid' : 'ordered';
}
