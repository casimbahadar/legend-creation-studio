// The game screen's view of the map: FE shows 15 x 10 squares of it (the GBA's 240 x 160 pixels) and
// scrolls to keep the cursor, or a unit on the move, a couple of squares away from the edges.

export const VIEW_WIDTH = 15;
export const VIEW_HEIGHT = 10;
/** Squares kept between the followed square and the edge of the view, where the map allows. */
const MARGIN = 2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The view's top-left square after following `target` from `from`: it moves only as far as needed to
 * keep the target MARGIN squares inside, and never past the map's edges. Maps smaller than the view
 * stay at 0.
 */
export function followCamera(from: readonly [number, number], target: readonly [number, number], mapWidth: number, mapHeight: number): [number, number] {
  const axis = (pos: number, t: number, view: number, size: number) => {
    const max = Math.max(0, size - view);
    let p = pos;
    if (t < p + MARGIN) p = t - MARGIN;
    if (t > p + view - 1 - MARGIN) p = t - (view - 1 - MARGIN);
    return clamp(p, 0, max);
  };
  return [axis(from[0], target[0], VIEW_WIDTH, mapWidth), axis(from[1], target[1], VIEW_HEIGHT, mapHeight)];
}
