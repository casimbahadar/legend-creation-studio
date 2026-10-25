import { describe, expect, it } from 'vitest';
import { cursorSpread, FE8U_MISC_UI_GRAPHICS, FE8U_MISC_UI_PALETTE, handOffset, readMapCursor, readMenuHand } from './fe8-cursor';
import { readRom } from './gba-rom';

/** LZ77 with literal blocks only, which the GBA's decompressor reads like any other. */
function lz77(data: Uint8Array): Uint8Array {
  const out = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, data.length >> 16];
  for (let i = 0; i < data.length; i += 8) out.push(0, ...data.subarray(i, i + 8));
  return Uint8Array.from(out);
}

describe('FE8 map cursor', () => {
  it('reads sprite tile 2 in palette 0, colour 0 transparent', () => {
    const bytes = new Uint8Array(FE8U_MISC_UI_PALETTE + 0x40);
    const view = new DataView(bytes.buffer);
    const tiles = new Uint8Array(4 * 32);
    tiles.fill(0x11, 32, 64); // tile 1: colour 1 everywhere, not the cursor
    tiles[2 * 32] = 0x02; // tile 2: its top left pixel colour 2, the next colour 0
    bytes.set(lz77(tiles), FE8U_MISC_UI_GRAPHICS);
    view.setUint16(FE8U_MISC_UI_PALETTE + 4, 31, true); // colour 2: red
    const img = readMapCursor(readRom(bytes))!;
    expect([img.width, img.height]).toEqual([8, 8]);
    expect(Array.from(img.rgba.subarray(0, 8))).toEqual([248, 0, 0, 255, 0, 0, 0, 0]);
    expect(readMapCursor(readRom(new Uint8Array(0x100)))).toBeNull();
  });

  it('reads the hand from tiles 0 and 1 and, a stored row below, 18 and 19', () => {
    const bytes = new Uint8Array(FE8U_MISC_UI_PALETTE + 0x40);
    const view = new DataView(bytes.buffer);
    const tiles = new Uint8Array(20 * 32);
    for (const [t, c] of [[0, 1], [1, 2], [18, 3], [19, 4]]) tiles.fill(c! * 0x11, t! * 32, t! * 32 + 32);
    bytes.set(lz77(tiles), FE8U_MISC_UI_GRAPHICS);
    for (let c = 1; c <= 4; c++) view.setUint16(FE8U_MISC_UI_PALETTE + c * 2, c, true);
    const img = readMenuHand(readRom(bytes))!;
    const red = (x: number, y: number) => img.rgba[(y * 16 + x) * 4];
    expect([red(0, 0), red(8, 0), red(0, 8), red(8, 8)]).toEqual([8, 16, 24, 32]);
  });

  it('puts the hand 14 pixels left of the text, bobbing up to 4 back over 32 ticks', () => {
    const tick = 1000 / 60;
    expect(handOffset(0)).toEqual({ x: -14, y: 2 });
    expect(handOffset(18.5 * tick)).toEqual({ x: -10, y: 2 });
    expect(handOffset(32.5 * tick)).toEqual({ x: -14, y: 2 });
  });

  it('breathes as sMapCursorSpriteLut does: wide for 10 frames, then in to tight and out again', () => {
    const frame = 2000 / 60;
    const spreads = Array.from({ length: 17 }, (_, i) => cursorSpread((i + 0.5) * frame).left);
    expect(spreads).toEqual([-2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -1, 0, 0, 0, 0, -1, -2]);
    expect(cursorSpread(0)).toEqual({ left: -2, right: 10, top: -4, bottom: 9 });
  });
});
