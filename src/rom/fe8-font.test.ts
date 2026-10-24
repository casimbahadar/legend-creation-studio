import { describe, expect, it } from 'vitest';
import { drawText, readFont, textWidth } from './fe8-font';
import { readRom, ROM_BASE } from './gba-rom';

// A font table with 'A' (3 wide: a body pixel at x 0 and an outline pixel at x 1 on row 4), 'a' and '?'.
function rom() {
  const bytes = new Uint8Array(0x1000);
  const view = new DataView(bytes.buffer);
  const TABLE = 0x100;
  const glyph = (c: number, at: number, width: number, rows: Record<number, number>) => {
    view.setUint32(TABLE + c * 4, ROM_BASE + at, true);
    bytes[at + 5] = width;
    for (const [y, row] of Object.entries(rows)) view.setUint32(at + 8 + Number(y) * 4, row, true);
  };
  glyph(0x41, 0x600, 3, { 4: 0b1110 }); // x 0 = 2 (body), x 1 = 3 (outline)
  glyph(0x61, 0x700, 2, { 5: 0b01 });
  glyph(0x3f, 0x800, 4, {});
  return { r: readRom(bytes), TABLE };
}

describe('the FE8 font', () => {
  const { r, TABLE } = rom();
  const font = readFont(r, TABLE)!;
  // Colours 1 to 3 of the white set, by index.
  const palette = Array.from({ length: 16 }, (_, i) => [i * 10, i * 10, i * 10] as const);

  it('reads glyph widths and 2-bit pixels from the lowest bits up', () => {
    expect(font.get(0x41)!.width).toBe(3);
    expect(Array.from(font.get(0x41)!.pixels.subarray(4 * 16, 4 * 16 + 3))).toEqual([2, 3, 0]);
    expect(readFont(readRom(new Uint8Array(0x1000)), TABLE)).toBeNull();
  });

  it('lays glyphs out by width, unknown characters as "?"', () => {
    expect(textWidth(font, 'Aa')).toBe(5);
    expect(textWidth(font, 'A~')).toBe(7);
    const img = drawText(font, palette, 'aA');
    expect(img.width).toBe(5);
    const px = (x: number, y: number) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    expect(px(0, 5)).toEqual([10, 10, 10, 255]); // 'a': value 1, colour 1
    expect(px(2, 4)).toEqual([20, 20, 20, 255]); // 'A' at x 2: value 2, colour 2
    expect(px(3, 4)).toEqual([30, 30, 30, 255]);
    expect(px(4, 4)[3]).toBe(0);
  });
});
