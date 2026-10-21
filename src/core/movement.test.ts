import { describe, expect, it } from 'vitest';
import { followCursor, moveRange, searchMoves, shortestRoute, type Occupant } from './movement';

// Terrain: '.' plain (cost 1), 'f' forest (cost 2), '#' wall (255, impassable).
const COST: Record<number, number> = { 0: 1, 1: 2, 2: 255 };
const costOf = (t: number) => COST[t] ?? 255;
function grid(rows: string[]) {
  return {
    width: rows[0]!.length,
    height: rows.length,
    terrain: rows.join('').split('').map((c) => ({ '.': 0, f: 1, '#': 2 })[c] ?? 2),
  };
}
const none = (): Occupant => null;
/** Reachable cells as "x,y=cost", sorted, for readable expectations. */
const show = (r: ReadonlyMap<number, number>, width: number) =>
  [...r.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k % width},${Math.floor(k / width)}=${c}`);

describe('moveRange', () => {
  it('spends movement on terrain cost and never enters walls', () => {
    const g = grid(['..f..', '.#...']);
    expect(show(moveRange(g, costOf, 2, [0, 0], none), 5)).toEqual(['0,0=0', '1,0=1', '0,1=1']);
    expect(show(moveRange(g, costOf, 3, [0, 0], none), 5)).toEqual(['0,0=0', '1,0=1', '2,0=3', '0,1=1']);
  });

  it('takes the cheapest path', () => {
    // To (2,0): through the forest costs 2 + 1 = 3; around it costs 4.
    const g = grid(['.f.', '...']);
    expect(moveRange(g, costOf, 3, [0, 0], none).get(2)).toBe(3);
  });

  it('lets units pass through friends but not stop on them, and foes block', () => {
    const g = grid(['....']);
    const friendAt1 = (x: number): Occupant => (x === 1 ? 'friend' : null);
    expect(show(moveRange(g, costOf, 3, [0, 0], friendAt1), 4)).toEqual(['0,0=0', '2,0=2', '3,0=3']);
    const foeAt1 = (x: number): Occupant => (x === 1 ? 'foe' : null);
    expect(show(moveRange(g, costOf, 3, [0, 0], foeAt1), 4)).toEqual(['0,0=0']);
  });

  it('treats unknown terrain as impassable', () => {
    const g = { width: 2, height: 1, terrain: [0, 9] };
    expect(show(moveRange(g, costOf, 5, [0, 0], none), 2)).toEqual(['0,0=0']);
  });
});

describe('routes and the movement arrow', () => {
  // 5x3 open field, cost 1 everywhere, Mov 4, unit at (0,1).
  const g = grid(['.....', '.....', '.....']);
  const search = searchMoves(g, costOf, 4, [0, 1], none);
  const at = (x: number, y: number) => y * 5 + x;

  it('finds a cheapest route', () => {
    const route = shortestRoute(search, at(3, 1))!;
    expect(route[0]).toBe(at(0, 1));
    expect(route.at(-1)).toBe(at(3, 1));
    expect(route).toHaveLength(4);
    expect(shortestRoute(search, at(4, 2))).toBeNull();
  });

  it('extends along the cursor, shortens when it backs up, and redraws when too long', () => {
    let r = [at(0, 1)];
    for (const k of [at(0, 0), at(1, 0), at(2, 0), at(2, 1)]) r = followCursor(search, r, k)!;
    expect(r).toEqual([at(0, 1), at(0, 0), at(1, 0), at(2, 0), at(2, 1)]);
    expect(followCursor(search, r, at(1, 0))).toEqual([at(0, 1), at(0, 0), at(1, 0)]);
    // One more step would cost 5 > Mov 4, so the arrow takes a cheapest route to (3,1) instead.
    const redrawn = followCursor(search, r, at(3, 1))!;
    expect(redrawn).toHaveLength(4);
    expect(redrawn.at(-1)).toBe(at(3, 1));
  });

  it('jumps to a cheapest route when the cursor is not next to the arrow, and has none out of reach', () => {
    expect(followCursor(search, [at(0, 1)], at(2, 2))).toHaveLength(4);
    expect(followCursor(search, [at(0, 1)], at(4, 2))).toBeNull();
  });

  it('routes through friends but never through foes', () => {
    const friend = (x: number, y: number): Occupant => (x === 1 && y === 1 ? 'friend' : null);
    const s = searchMoves(grid(['...']), costOf, 2, [0, 0], (x) => friend(x, 1));
    expect(shortestRoute(s, 2)).toEqual([0, 1, 2]);
    const foe = searchMoves(grid(['...']), costOf, 2, [0, 0], (x) => (x === 1 ? 'foe' : null));
    expect(shortestRoute(foe, 2)).toBeNull();
  });
});
