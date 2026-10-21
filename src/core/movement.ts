// Movement range and routes: where a unit can go this turn and how it gets there.
// The search ports Endless Chronicle (index.html, reach()): Dijkstra over per-terrain move costs;
// foes block, friends can be passed through but not stopped on. Routes and the arrow are new.

export interface TerrainGrid {
  readonly width: number;
  readonly height: number;
  /** Terrain id per cell, row by row. */
  readonly terrain: ArrayLike<number>;
}

/** Move cost of a terrain id for this unit; Infinity (or 255 from the ROM) for impassable. */
export type CostOf = (terrain: number) => number;

export type Occupant = 'friend' | 'foe' | null;

export const IMPASSABLE = 255;

export interface MoveSearch {
  readonly width: number;
  readonly mov: number;
  /** Cell index (y * width + x) of the unit. */
  readonly start: number;
  /** Every cell the unit can pass through within its movement, with the cheapest cost to get there. */
  readonly reached: ReadonlyMap<number, number>;
  /** For each reached cell but the start, the cell it is entered from on a cheapest route. */
  readonly prev: ReadonlyMap<number, number>;
  /** Cells the unit can end its move on (reached minus occupied squares), with their cost. */
  readonly stops: ReadonlyMap<number, number>;
  /** Cost of entering a cell. */
  stepCost(cell: number): number;
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function searchMoves(
  grid: TerrainGrid,
  costOf: CostOf,
  mov: number,
  start: readonly [number, number],
  occupantAt: (x: number, y: number) => Occupant,
): MoveSearch {
  const { width, height } = grid;
  const startCell = start[1] * width + start[0];
  const stepCost = (k: number) => {
    const c = costOf(grid.terrain[k] ?? -1);
    return c < IMPASSABLE ? c : Infinity;
  };
  const reached = new Map<number, number>();
  const prev = new Map<number, number>();
  const open: [number, number, number][] = [[0, startCell, -1]];
  while (open.length) {
    // Maps are at most 64x64, so a sorted array is plenty.
    open.sort((a, b) => a[0] - b[0]);
    const [c, k, from] = open.shift()!;
    if (reached.has(k)) continue;
    reached.set(k, c);
    if (from >= 0) prev.set(k, from);
    const x = k % width;
    const y = (k - x) / width;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = ny * width + nx;
      if (reached.has(nk) || occupantAt(nx, ny) === 'foe') continue;
      const nc = c + stepCost(nk);
      if (nc <= mov) open.push([nc, nk, k]);
    }
  }
  const stops = new Map<number, number>();
  for (const [k, c] of reached) {
    const x = k % width;
    if (k === startCell || occupantAt(x, (k - x) / width) === null) stops.set(k, c);
  }
  return { width, mov, start: startCell, reached, prev, stops, stepCost };
}

/** Cells the unit can end its move on, as cell index to cost. Includes its own cell. */
export function moveRange(
  grid: TerrainGrid,
  costOf: CostOf,
  mov: number,
  start: readonly [number, number],
  occupantAt: (x: number, y: number) => Occupant,
): ReadonlyMap<number, number> {
  return searchMoves(grid, costOf, mov, start, occupantAt).stops;
}

/** A cheapest route from the unit to `goal`, start first, or null if it can't get there. */
export function shortestRoute(search: MoveSearch, goal: number): number[] | null {
  if (!search.reached.has(goal)) return null;
  const route = [goal];
  while (route[0] !== search.start) route.unshift(search.prev.get(route[0]!)!);
  return route;
}

const routeCost = (search: MoveSearch, route: readonly number[]) => route.slice(1).reduce((sum, k) => sum + search.stepCost(k), 0);

function adjacent(width: number, a: number, b: number): boolean {
  const ax = a % width;
  const bx = b % width;
  return (Math.abs(ax - bx) === 1 && Math.floor(a / width) === Math.floor(b / width)) || (ax === bx && Math.abs(a - b) === width);
}

/**
 * The movement arrow after the cursor moves to `to`, the way FE draws it: moving back over the arrow
 * shortens it, a step next to its end extends it while the unit has the movement left, and anything
 * else redraws it as a cheapest route. Null when the unit can't reach `to` at all.
 */
export function followCursor(search: MoveSearch, route: readonly number[], to: number): number[] | null {
  if (!search.reached.has(to)) return null;
  const back = route.indexOf(to);
  if (back >= 0) return route.slice(0, back + 1);
  const end = route[route.length - 1];
  if (end !== undefined && route[0] === search.start && adjacent(search.width, end, to) && routeCost(search, route) + search.stepCost(to) <= search.mov) {
    return [...route, to];
  }
  return shortestRoute(search, to);
}
