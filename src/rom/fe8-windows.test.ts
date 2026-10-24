import { describe, expect, it } from 'vitest';
import { readRom } from './gba-rom';
import {
  contentBounds,
  drawFrame,
  drawGoalWindow,
  drawTilemap,
  drawUnitWindow,
  FE8U_GOAL_ONE_LINE_TILEMAP,
  FE8U_GOAL_TWO_LINES_TILEMAP,
  FE8U_INTERFACE_PALETTES,
  FE8U_INTERFACE_TILES,
  FE8U_UI_FRAME_IMAGE,
  FE8U_UI_FRAME_PALETTE,
  FE8U_UNIT_WINDOW_TILEMAP,
  clipTilemap,
  frameTilemap,
  readTilemap,
  readWindowArt,
} from './fe8-windows';

/** LZ77 with literal blocks only, which the GBA's decompressor reads like any other. */
function lz77(data: Uint8Array): Uint8Array {
  const out = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, data.length >> 16];
  for (let i = 0; i < data.length; i += 8) out.push(0, ...data.subarray(i, i + 8));
  return Uint8Array.from(out);
}

/** `count` tiles, tile n filled with colour n % 16. */
function solidTiles(count: number): Uint8Array {
  const tiles = new Uint8Array(count * 32);
  for (let t = 0; t < count; t++) tiles.fill((t % 16) * 0x11, t * 32, t * 32 + 32);
  return tiles;
}

/** A palette where colour c is (c, 0, 0) in BGR555, which reads back as red c * 8. */
function setPalette(view: DataView, at: number, blue = 0) {
  for (let c = 0; c < 16; c++) view.setUint16(at + c * 2, c | (blue << 10), true);
}

function writeTilemap(view: DataView, at: number, width: number, height: number, rows: number[][]) {
  view.setUint8(at, width - 1);
  view.setUint8(at + 1, height - 1);
  // Stored from the bottom row up.
  let o = at + 2;
  for (let y = height - 1; y >= 0; y--) for (let x = 0; x < width; x++, o += 2) view.setUint16(o, rows[y]![x]!, true);
}

describe('FE8 window art', () => {
  it("lays out a frame as DrawUiFrame does", () => {
    const t = frameTilemap(6, 6);
    const grid = Array.from({ length: 6 }, (_, y) => Array.from(t.entries.subarray(y * 6, y * 6 + 6), (e) => e & 0x3ff));
    expect(grid).toEqual([
      [0x01, 0x02, 0x03, 0x03, 0x03, 0x05],
      [0x07, 0x08, 0x09, 0x09, 0x09, 0x0a],
      [0x06, 0x09, 0x09, 0x09, 0x09, 0x0a],
      [0x06, 0x09, 0x09, 0x09, 0x09, 0x0a],
      [0x06, 0x09, 0x09, 0x09, 0x09, 0x0a],
      [0x1a, 0x1b, 0x1b, 0x1b, 0x1b, 0x21],
    ]);
    expect(t.entries.every((e) => e >> 12 === 1)).toBe(true);
    // Odd sizes are covered too.
    expect(frameTilemap(5, 3).entries.every((e) => e !== 0)).toBe(true);
  });

  it('reads tilemaps from the bottom row up', () => {
    const bytes = new Uint8Array(0x100);
    writeTilemap(new DataView(bytes.buffer), 0x10, 3, 2, [
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const t = readTilemap(readRom(bytes), 0x10)!;
    expect([t.width, t.height, ...t.entries]).toEqual([3, 2, 1, 2, 3, 4, 5, 6]);
    expect(readTilemap(readRom(bytes), 0xfe)).toBeNull();
    const c = clipTilemap(t, 2, 5);
    expect([c.width, c.height, ...c.entries]).toEqual([2, 2, 1, 2, 4, 5]);
  });

  it('draws entries with flips and the palette base, colour 0 and unknown palettes transparent', () => {
    // Tile 1: left half colour 1, right half colour 2.
    const tiles = new Uint8Array(2 * 32);
    for (let r = 0; r < 8; r++) tiles.set([0x11, 0x11, 0x22, 0x22], 32 + r * 4);
    const pal = Array.from({ length: 16 }, (_, c) => [c * 10, 0, 0] as const);
    const map = { width: 3, height: 1, entries: Uint16Array.from([1, 1 | 0x400, 0x1001]) };
    const img = drawTilemap(tiles, map, (n) => (n === 2 ? pal : undefined), 2);
    const px = (x: number) => Array.from(img.rgba.subarray(x * 4, x * 4 + 4));
    expect(px(0)).toEqual([10, 0, 0, 255]);
    expect(px(7)).toEqual([20, 0, 0, 255]);
    expect(px(8)).toEqual([20, 0, 0, 255]); // flipped
    expect(px(16)[3]).toBe(0); // palette 1 + 2 = 3, not given
    expect(contentBounds(img)).toEqual({ x: 0, y: 0, width: 16, height: 8 });
  });

  describe('from a ROM', () => {
    const bytes = new Uint8Array(0xb00000);
    const view = new DataView(bytes.buffer);
    // Tiles 0 to 0x21, all model 0 uses; compressed, they fit before the palette as the real image does.
    bytes.set(lz77(solidTiles(0x22)), FE8U_UI_FRAME_IMAGE);
    bytes.set(lz77(solidTiles(0x10)), FE8U_INTERFACE_TILES);
    setPalette(view, FE8U_UI_FRAME_PALETTE);
    setPalette(view, FE8U_INTERFACE_PALETTES, 1);
    setPalette(view, FE8U_INTERFACE_PALETTES + 0x20, 2);
    setPalette(view, FE8U_INTERFACE_PALETTES + 0x40, 3);
    // Unit window: a frame tile, then interface tile 0x105 (colour 5); the second row blank.
    writeTilemap(view, FE8U_UNIT_WINDOW_TILEMAP, 2, 2, [
      [0x0003, 0x0105],
      [0, 0],
    ]);
    // Goal windows: a blank top row, then tile 4 (colour 4).
    writeTilemap(view, FE8U_GOAL_ONE_LINE_TILEMAP, 1, 2, [[0], [0x0004]]);
    writeTilemap(view, FE8U_GOAL_TWO_LINES_TILEMAP, 1, 1, [[0x0004]]);
    const art = readWindowArt(readRom(bytes))!;
    const at = (img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) =>
      Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

    it('reads the tiles, palettes and tilemaps', () => {
      expect(art).not.toBeNull();
      expect(art.tiles.length).toBe(0x110 * 32);
      expect([art.unitWindow.width, art.unitWindow.height]).toEqual([2, 2]);
    });

    it('draws a frame in the frame palette', () => {
      const img = drawFrame(art, 4, 4);
      expect([img.width, img.height]).toEqual([32, 32]);
      expect(at(img, 0, 0)).toEqual([8, 0, 0, 255]); // tile 1, colour 1
      expect(at(img, 12, 12)).toEqual([64, 0, 0, 255]); // tile 8, the top left block's last
      expect(at(img, 16, 16)).toEqual([72, 0, 0, 255]); // tile 9, the inside
    });

    it("draws the unit window in its team's palette, interface tiles included", () => {
      const red = drawUnitWindow(art, 'enemy');
      expect(at(red, 0, 0)).toEqual([24, 0, 16, 255]);
      expect(at(red, 8, 0)).toEqual([40, 0, 16, 255]);
      expect(at(drawUnitWindow(art, 'ally'), 0, 0)).toEqual([24, 0, 24, 255]);
      expect(contentBounds(red)).toEqual({ x: 0, y: 0, width: 16, height: 8 });
    });

    it('draws the goal windows', () => {
      const one = drawGoalWindow(art, 1);
      expect(contentBounds(one)).toEqual({ x: 0, y: 8, width: 8, height: 8 });
      expect(at(one, 0, 8)).toEqual([32, 0, 0, 255]);
      expect(drawGoalWindow(art, 2).height).toBe(8);
    });

    it('has nothing for a ROM without the art', () => {
      expect(readWindowArt(readRom(new Uint8Array(0x100)))).toBeNull();
    });
  });
});
