// Canvas drawing for the map in play: range squares, the movement arrow and the cursor, all at the
// GBA's own scale of 16 pixels per square.

/** Range square colours from Endless Chronicle: blue where a unit can move, red where it can attack, as in FE. */
export const MOVE_COLOURS = { fill: 'rgba(48, 110, 255, 0.45)', edge: 'rgba(170, 200, 255, 0.8)' };
export const ATTACK_COLOURS = { fill: 'rgba(255, 60, 48, 0.42)', edge: 'rgba(255, 170, 160, 0.75)' };

/**
 * One range square, as Endless Chronicle draws them: inset by a pixel with a lighter edge, so the map
 * shows through between squares as grid lines. Drawn at the GBA's own scale (16 pixels per square).
 */
export function drawRangeSquare(g: CanvasRenderingContext2D, x: number, y: number, colours: { fill: string; edge: string }) {
  g.fillStyle = colours.fill;
  g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  g.strokeStyle = colours.edge;
  g.lineWidth = 1;
  g.strokeRect(x * 16 + 1.5, y * 16 + 1.5, 13, 13);
}

/**
 * The movement arrow: a light line with a dark outline from the unit to the cursor, ending in an
 * arrowhead, drawn at the GBA's own scale. Colours approximate FE's; they are not taken from the ROM.
 */
export function drawArrow(g: CanvasRenderingContext2D, route: readonly number[], width: number) {
  const pts = route.map((k) => [(k % width) * 16 + 8, Math.floor(k / width) * 16 + 8] as const);
  const [ex, ey] = pts[pts.length - 1]!;
  const [px, py] = pts[pts.length - 2]!;
  const dx = Math.sign(ex - px);
  const dy = Math.sign(ey - py);
  // The shaft stops short of the last square's centre so the head can sit there.
  const shaft = [...pts.slice(0, -1), [ex - dx * 2, ey - dy * 2] as const];
  const line = () => {
    g.beginPath();
    shaft.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = '#183078';
  g.lineWidth = 7;
  line();
  g.stroke();
  g.strokeStyle = '#a8dcff';
  g.lineWidth = 4;
  line();
  g.stroke();
  // Head: tip 6 pixels past the centre, base 2 pixels before it, 12 wide.
  g.beginPath();
  g.moveTo(ex + dx * 6, ey + dy * 6);
  g.lineTo(ex - dx * 2 - dy * 6, ey - dy * 2 + dx * 6);
  g.lineTo(ex - dx * 2 + dy * 6, ey - dy * 2 - dx * 6);
  g.closePath();
  g.fillStyle = '#a8dcff';
  g.fill();
  g.strokeStyle = '#183078';
  g.lineWidth = 1.5;
  g.lineJoin = 'miter';
  g.stroke();
}

/** Endless Chronicle's cursor: four yellow corner brackets that step outward and back every 250 ms. */
export function drawCursor(g: CanvasRenderingContext2D, x: number, y: number, now: number) {
  const out = Math.floor(now / 250) % 2;
  const arm = 5;
  const thick = 2;
  g.fillStyle = '#ffe680';
  for (const [cx, cy, dx, dy] of [
    [0, 0, 1, 1],
    [1, 0, -1, 1],
    [0, 1, 1, -1],
    [1, 1, -1, -1],
  ] as const) {
    // Corner point, pushed outward on the "out" beat.
    const ox = (x + cx) * 16 - dx * out;
    const oy = (y + cy) * 16 - dy * out;
    g.fillRect(dx > 0 ? ox : ox - thick, dy > 0 ? oy : oy - arm, thick, arm);
    g.fillRect(dx > 0 ? ox : ox - arm, dy > 0 ? oy : oy - thick, arm, thick);
  }
}
