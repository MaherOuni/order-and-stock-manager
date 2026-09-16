/**
 * The shape produced by the floor planner (public/floor-planner/index.html).
 *
 * Coordinates are centimetres from the top-left. The plan holds only geometry — nothing about
 * orders or covers, which would be stale the moment it was saved. The waiter view joins live
 * data on `label` at render time.
 */

export const FLOOR_PLAN_SCHEMA = 'restaurant-floor-plan';

export interface FloorPlanSegment {
  readonly id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly thickness: number;
}

export interface FloorPlanTable {
  readonly id: string;
  /** The join key: matches Order.tableNumber, which is what the QR code carries. */
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  /** Lets a waiter be shown only their own tables. */
  readonly section: string | null;
}

export interface FloorPlanLabel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface FloorPlan {
  readonly schema: typeof FLOOR_PLAN_SCHEMA;
  readonly version: number;
  readonly name: string;
  readonly units: 'cm';
  readonly grid: number;
  readonly walls: readonly FloorPlanSegment[];
  readonly doors: readonly FloorPlanSegment[];
  readonly tables: readonly FloorPlanTable[];
  readonly labels: readonly FloorPlanLabel[];
}

/**
 * Checks a pasted plan before it is saved. The planner is the usual source, but this arrives as
 * text a human pasted, so it is treated as untrusted input rather than assumed well-formed.
 */
export function parseFloorPlan(text: string): FloorPlan {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }

  const plan = parsed as Partial<FloorPlan> | null;

  if (!plan || plan.schema !== FLOOR_PLAN_SCHEMA) {
    throw new Error('That JSON is not a floor plan — generate one from the floor planner.');
  }

  if (!Array.isArray(plan.tables) || plan.tables.length === 0) {
    throw new Error('That plan has no tables in it.');
  }

  const missingLabel = plan.tables.find((table) => !table?.label?.trim());

  if (missingLabel) {
    throw new Error('Every table needs a number — that is what links it to its orders.');
  }

  // Orders carry a table number, not a table id, so two tables sharing a number would both
  // claim the same order and a waiter would be sent to the wrong one. Caught here rather than
  // rendered, because the wrong table looks entirely plausible on screen.
  const duplicates = duplicateLabels(plan.tables);

  if (duplicates.length > 0) {
    throw new Error(
      `Two tables share the same number: ${duplicates.join(', ')}. ` +
        'Numbers must be unique — they are how an order finds its table.',
    );
  }

  return {
    schema: FLOOR_PLAN_SCHEMA,
    version: plan.version ?? 1,
    name: plan.name ?? 'Floor plan',
    units: 'cm',
    grid: plan.grid ?? 25,
    walls: plan.walls ?? [],
    doors: plan.doors ?? [],
    tables: plan.tables,
    labels: plan.labels ?? [],
  };
}

/** Table numbers that appear more than once, compared the way a QR code would be typed. */
function duplicateLabels(tables: readonly FloorPlanTable[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const table of tables) {
    const key = table.label.trim().toLocaleLowerCase();

    if (seen.has(key)) repeated.add(table.label.trim());

    seen.add(key);
  }

  return [...repeated];
}

/** The bounding box of everything on the plan, for fitting it to the viewport. */
export function planBounds(plan: FloorPlan): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const segment of [...plan.walls, ...plan.doors]) {
    xs.push(segment.x1, segment.x2);
    ys.push(segment.y1, segment.y2);
  }

  for (const table of plan.tables) {
    xs.push(table.x, table.x + table.width);
    ys.push(table.y, table.y + table.height);
  }

  for (const label of plan.labels) {
    xs.push(label.x, label.x + 200);
    ys.push(label.y - 30, label.y);
  }

  if (xs.length === 0) return { x: 0, y: 0, width: 1000, height: 700 };

  const pad = 90;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(...xs) - minX + pad * 2,
    height: Math.max(...ys) - minY + pad * 2,
  };
}
