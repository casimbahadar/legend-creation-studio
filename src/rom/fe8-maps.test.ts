import { describe, expect, it } from 'vitest';
import { renderMap } from './fe8-maps';

describe('renderMap', () => {
  it('draws a metatile from its four tile entries', () => {
    // Tile 0 is solid colour 1, tile 1 solid colour 2. Metatile 0 uses tile 0 (palette 0) top-left
    // and tile 1 h-flipped with palette 1 for the other three quarters.
    const tiles = new Uint8Array(64);
    tiles.fill(0x11, 0, 32);
    tiles.fill(0x22, 32, 64);
    const config = new Uint8Array(0x2400);
    const entries = [0x0000, 0x1401, 0x1401, 0x1401];
    entries.forEach((e, q) => {
      config[q * 2] = e & 0xff;
      config[q * 2 + 1] = e >> 8;
    });
    const red = Array.from({ length: 16 }, () => [200, 0, 0] as const);
    const blue = Array.from({ length: 16 }, () => [0, 0, 200] as const);
    const img = renderMap({ width: 1, height: 1, cells: Uint16Array.of(0), tileset: { tiles, config, palettes: [red, blue] } });
    expect(img.width).toBe(16);
    expect(Array.from(img.rgba.subarray(0, 4))).toEqual([200, 0, 0, 255]);
    const bottomRight = (15 * 16 + 15) * 4;
    expect(Array.from(img.rgba.subarray(bottomRight, bottomRight + 4))).toEqual([0, 0, 200, 255]);
  });

  it('skips metatile ids outside the config', () => {
    const img = renderMap({
      width: 1,
      height: 1,
      cells: Uint16Array.of(2000),
      tileset: { tiles: new Uint8Array(32), config: new Uint8Array(0x2400), palettes: [] },
    });
    expect(img.rgba.every((v) => v === 0)).toBe(true);
  });
});
