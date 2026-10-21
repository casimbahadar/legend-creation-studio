// Movement range: where a unit can go this turn. Ported from Endless Chronicle (index.html, reach()).
// Dijkstra over per-terrain move costs; foes block, friends can be passed through but not stopped on.

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

/** Cells the unit can end its move on, as cell index (y * width + x) to cost. Includes its own cell. */
export function moveRange(
  grid: TerrainGrid,
  costOf: CostOf,
  mov: number,
  start: readonly [number, number],
  occupantAt: (x: number, y: number) => Occupant,
): Map<number, number> {
  const { width, height } = grid;
  const best = new Map<number, number>();
  const open: [number, number][] = [[0, start[1] * width + start[0]]];
  while (open.length) {
    // Maps are at most 64x64, so a sorted array is plenty.
    open.sort((a, b) => a[0] - b[0]);
    const [c, k] = open.shift()!;
    if (best.has(k)) continue;
    best.set(k, c);
    const x = k % width;
    const y = (k - x) / width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = ny * width + nx;
      if (best.has(nk) || occupantAt(nx, ny) === 'foe') continue;
      const step = costOf(grid.terrain[nk] ?? -1);
      if (!(step < IMPASSABLE)) continue;
      const nc = c + step;
      if (nc <= mov) open.push([nc, nk]);
    }
  }
  for (const k of [...best.keys()]) {
    const x = k % width;
    if (k !== start[1] * width + start[0] && occupantAt(x, (k - x) / width) !== null) best.delete(k);
  }
  return best;
}
