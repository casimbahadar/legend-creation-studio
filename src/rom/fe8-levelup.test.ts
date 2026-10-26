import { describe, expect, it } from 'vitest';
import { readRom } from './gba-rom';
import { FE8U_LEVEL_UP_BOX_PALETTE, FE8U_LEVEL_UP_BOX_TILEMAP, FE8U_LEVEL_UP_BOX_TILES, readLevelUpBox } from './fe8-levelup';

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
});
