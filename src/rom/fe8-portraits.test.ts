import { describe, expect, it } from 'vitest';
import { FE8U_PORTRAIT_TABLE, PORTRAIT_STRIDE, readChibi, readPortrait } from './fe8-portraits';
import { readRom, ROM_BASE } from './gba-rom';

/** LZ77 with literal blocks only, which the GBA's decompressor reads like any other. */
function lz77(data: Uint8Array): Uint8Array {
  const out = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, data.length >> 16];
  for (let i = 0; i < data.length; i += 8) out.push(0, ...data.subarray(i, i + 8));
  return Uint8Array.from(out);
}

describe('FE8 portraits', () => {
  // Portrait 2: tile 0 all colour 1, tile 5 (second row, second column) all colour 2; colour 0 elsewhere.
  const bytes = new Uint8Array(FE8U_PORTRAIT_TABLE + 0x1000);
  const view = new DataView(bytes.buffer);
  const tiles = new Uint8Array(16 * 32);
  tiles.fill(0x11, 0, 32);
  tiles.fill(0x22, 5 * 32, 6 * 32);
  const CHIBI = 0x1000;
  bytes.set(lz77(tiles), CHIBI);
  const PAL = 0x2000;
  view.setUint16(PAL + 2, 31, true); // colour 1: red
  view.setUint16(PAL + 4, 31 << 10, true); // colour 2: blue
  const record = FE8U_PORTRAIT_TABLE + 1 * PORTRAIT_STRIDE;
  view.setUint32(record + 4, ROM_BASE + CHIBI, true);
  view.setUint32(record + 8, ROM_BASE + PAL, true);
  const rom = readRom(bytes);

  it('draws the 16 tiles 4 x 4 in order, colour 0 transparent', () => {
    const img = readChibi(rom, 2)!;
    expect([img.width, img.height]).toEqual([32, 32]);
    const px = (x: number, y: number) => Array.from(img.rgba.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    expect(px(3, 3)).toEqual([248, 0, 0, 255]);
    expect(px(12, 12)).toEqual([0, 0, 248, 255]);
    expect(px(20, 3)[3]).toBe(0);
  });

  it('has nothing for id 0 or an empty record', () => {
    expect(readChibi(rom, 0)).toBeNull();
    expect(readChibi(rom, 1)).toBeNull();
  });

  it("puts a full face together from its sheet's six pieces", () => {
    // Portrait 3: sheet tile (row 0, col 8) colour 1, which goes to the face's second 64 x 32 piece
    // (32 pixels down); tile (row 3, col 23), the right shoulder's last, colour 2.
    const sheet = new Uint8Array(32 * 4 * 32);
    sheet.fill(0x11, 8 * 32, 9 * 32);
    sheet.fill(0x22, (3 * 32 + 23) * 32, (3 * 32 + 24) * 32);
    const b = bytes.slice();
    const v = new DataView(b.buffer);
    const FACE = 0x3000;
    b.set(lz77(sheet), FACE);
    const rec = FE8U_PORTRAIT_TABLE + 2 * PORTRAIT_STRIDE;
    v.setUint32(rec, ROM_BASE + FACE, true);
    v.setUint32(rec + 8, ROM_BASE + PAL, true);
    const face = readPortrait(readRom(b), 3)!;
    expect([face.width, face.height]).toEqual([96, 80]);
    const px = (x: number, y: number) => Array.from(face.rgba.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4));
    expect(px(16, 32)).toEqual([248, 0, 0, 255]); // 48 - 32 = 16 across
    expect(px(88, 72)).toEqual([0, 0, 248, 255]); // 48 + 32 + 8, 48 + 24
    expect(px(0, 0)[3]).toBe(0);
    expect(readPortrait(rom, 2)).toBeNull(); // no face sheet
  });
});

