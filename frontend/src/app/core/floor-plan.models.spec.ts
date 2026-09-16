import { FLOOR_PLAN_SCHEMA, parseFloorPlan, planBounds } from './floor-plan.models';

/**
 * `parseFloorPlan` is the gate between a text box a human pastes into and the floor a waiter
 * works off, so these cover the ways a plan can be wrong rather than the happy path alone.
 */
describe('parseFloorPlan', () => {
  function planWith(tables: unknown[]): string {
    return JSON.stringify({
      schema: FLOOR_PLAN_SCHEMA,
      version: 1,
      name: 'Ground floor',
      units: 'cm',
      grid: 25,
      walls: [],
      doors: [],
      tables,
      labels: [],
    });
  }

  const table = (label: string, overrides: Record<string, unknown> = {}) => ({
    id: `t-${label}`,
    label,
    x: 0,
    y: 0,
    width: 80,
    height: 80,
    seats: 4,
    section: null,
    ...overrides,
  });

  it('accepts a plan from the planner', () => {
    const plan = parseFloorPlan(planWith([table('1'), table('2')]));

    expect(plan.tables.map((t) => t.label)).toEqual(['1', '2']);
    expect(plan.name).toBe('Ground floor');
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseFloorPlan('not json')).toThrowError(/not valid JSON/);
  });

  it('rejects JSON that is not a floor plan', () => {
    expect(() => parseFloorPlan('{"hello":"world"}')).toThrowError(/not a floor plan/);
  });

  it('rejects a plan with no tables', () => {
    expect(() => parseFloorPlan(planWith([]))).toThrowError(/no tables/);
  });

  it('rejects a table with no number, since nothing could link it to an order', () => {
    expect(() => parseFloorPlan(planWith([table('1'), table('  ')]))).toThrowError(/needs a number/);
  });

  // The failure this protects against is silent: both tables render, and one of them shows an
  // order belonging to the other.
  it('rejects two tables sharing a number', () => {
    expect(() => parseFloorPlan(planWith([table('4'), table('7'), table('4')])))
      .toThrowError(/Two tables share the same number: 4/);
  });

  it('treats numbers differing only in case or padding as the same', () => {
    expect(() => parseFloorPlan(planWith([table('Terrasse 2'), table(' terrasse 2 ')])))
      .toThrowError(/Two tables share the same number/);
  });

  it('fills in what the planner may have left out', () => {
    const plan = parseFloorPlan(
      JSON.stringify({ schema: FLOOR_PLAN_SCHEMA, tables: [table('1')] }),
    );

    expect(plan.walls).toEqual([]);
    expect(plan.doors).toEqual([]);
    expect(plan.labels).toEqual([]);
    expect(plan.grid).toBe(25);
  });
});

describe('planBounds', () => {
  it('surrounds every table with padding on each side', () => {
    const plan = parseFloorPlan(
      JSON.stringify({
        schema: FLOOR_PLAN_SCHEMA,
        tables: [
          { id: 'a', label: '1', x: 100, y: 100, width: 80, height: 80, seats: 4, section: null },
          { id: 'b', label: '2', x: 300, y: 200, width: 80, height: 80, seats: 2, section: null },
        ],
      }),
    );

    const bounds = planBounds(plan);

    expect(bounds.x).toBeLessThan(100);
    expect(bounds.y).toBeLessThan(100);
    expect(bounds.x + bounds.width).toBeGreaterThan(380);
    expect(bounds.y + bounds.height).toBeGreaterThan(280);
  });
});
