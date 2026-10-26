import { describe, expect, it } from 'vitest';
import { readRom } from './gba-rom';
import { FE8U_LEVEL_UP_BOX_PALETTE, FE8U_LEVEL_UP_BOX_TILEMAP, FE8U_LEVEL_UP_BOX_TILES, readLevelUpBox, statGainPalettes, statGainTiles, type LevelUpSprites } from './fe8-levelup';

/** LZ77 whose only back-references repeat the byte before (runs), small enough for the real slots. */
function lz77(data: Uint8Array): Uint8Array {
  const out = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, data.length >> 16];
  let i = 0;
  while (i < data.length) {
    const flagsAt = out.push(0) - 1;
    for (let bit = 0; bit < 8 && i < data.length; bit++) {
      let run = 0;
      while (i > 0 && run < 18 && i + run < data.length && data[i + run] === data[i - 1]) run++;
      if (run >= 3) {
        out[flagsAt]! |= 0x80 >> bit;
        out.push((run - 3) << 4, 0); // distance 1
        i += run;
      } else out.push(data[i++]!);
    }
  }
  return Uint8Array.from(out);
}

describe('FE8 level-up box', () => {
  it('draws the 30 tile columns the screen shows of its 32 x 28 tilemap, top row first', () => {
    const bytes = new Uint8Array(0x1000000);
    // Tile 0 empty, tile 1 all colour 1.
    bytes.set(lz77(Uint8Array.from([...new Array(32).fill(0), ...new Array(32).fill(0x11)])), FE8U_LEVEL_UP_BOX_TILES);
    // Only the top left tile and the tile in column 30 of row 0 (off the screen) are tile 1.
    const map = new Uint8Array(32 * 28 * 2);
    map[0] = 1;
    map[30 * 2] = 1;
    const packed = lz77(map);
    expect(packed.length).toBeLessThanOrEqual(FE8U_LEVEL_UP_BOX_PALETTE - FE8U_LEVEL_UP_BOX_TILEMAP);
    bytes.set(packed, FE8U_LEVEL_UP_BOX_TILEMAP);
    new DataView(bytes.buffer).setUint16(FE8U_LEVEL_UP_BOX_PALETTE + 2, 0x001f, true);
    const box = readLevelUpBox(readRom(bytes))!;
    expect([box.width, box.height]).toEqual([240, 224]);
    const px = (x: number, y: number) => Array.from(box.rgba.subarray((y * box.width + x) * 4, (y * box.width + x) * 4 + 4));
    expect(px(0, 0)).toEqual([248, 0, 0, 255]);
    expect(px(8, 0)[3]).toBe(0);
    expect(px(239, 0)[3]).toBe(0);
  });

  // Gain tiles: 96 tiles of 0; digits: tile n filled with n + 1 (so a digit's halves differ).
  const sprites: LevelUpSprites = {
    text: new Uint8Array(0),
    gain: new Uint8Array(96 * 32),
    digits: Uint8Array.from({ length: 64 * 32 }, (_, i) => Math.floor(i / 32) + 1),
    palettes: [Array.from({ length: 16 }, (_, i) => [i, 0, 0] as const)],
    cycling: Array.from({ length: 228 }, (_, i) => [0, i, 0] as const),
  };

  it("copies the gain's digit into the stat's own two tiles", () => {
    // Stat 3 (Skl) gaining 2: tiles 4 + 0x2D and 4 + 0x4D get digit tiles 2 and 0x22.
    const tiles = statGainTiles(sprites, 3, 2);
    expect(tiles[(4 + 0x2d) * 32]).toBe(3);
    expect(tiles[(4 + 0x4d) * 32]).toBe(0x23);
    expect(tiles[(2 + 0x2d) * 32]).toBe(0);
  });

  it('cycles colours 9 to 15 of palettes 3 and 4 every 4 frames', () => {
    expect(statGainPalettes(sprites, 3)(3)![9]).toEqual([9, 0, 0]);
    expect(statGainPalettes(sprites, 4)(3)![9]).toEqual([0, 1, 0]);
    expect(statGainPalettes(sprites, 9)(4)![15]).toEqual([0, 0x20 + 2 + 6, 0]);
    expect(statGainPalettes(sprites, 4 * 17)(3)![9]).toEqual([0, 1, 0]); // 16 steps around
    expect(statGainPalettes(sprites, 8)(5)).toBeUndefined();
  });
});

