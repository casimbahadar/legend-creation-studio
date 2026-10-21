import { describe, expect, it } from 'vitest';
import { moveRange, type Occupant } from './movement';

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
const show = (r: Map<number, number>, width: number) =>
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
