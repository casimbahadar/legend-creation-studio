import { describe, expect, it } from 'vitest';
import { FE8U_MISC_UI_GRAPHICS, FE8U_MISC_UI_PALETTE } from './fe8-cursor';
import { readStatusIcons, statusIconFrames } from './fe8-status-icons';
import { readRom } from './gba-rom';

/** LZ77 copying runs of a repeated byte (distance 1), small enough for the space before the palette. */
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
        out.push((run - 3) << 4, 0);
        i += run;
      } else out.push(data[i++]!);
    }
  }
  return Uint8Array.from(out);
}

describe('FE8 status icons', () => {
  // The graphics are stored 18 tiles to a row; sprite tile 0x64 (row 3, column 4) is stored tile 58,
  // and 0x4A's 16 x 16 block (row 2, columns 10 and 11, and the row below) stored tiles 46, 47, 64, 65.
  const bytes = new Uint8Array(FE8U_MISC_UI_PALETTE + 0x40);
  const view = new DataView(bytes.buffer);
  const tiles = new Uint8Array(18 * 4 * 32);
  tiles.fill(0x11, 58 * 32, 59 * 32);
  for (const t of [46, 47, 64, 65]) tiles.fill(0x22, t * 32, t * 32 + 32);
  bytes.set(lz77(tiles), FE8U_MISC_UI_GRAPHICS);
  view.setUint16(FE8U_MISC_UI_PALETTE + 0x20 + 2, 31, true); // palette 1, colour 1: red
  view.setUint16(FE8U_MISC_UI_PALETTE + 0x20 + 4, 31 << 10, true); // colour 2: blue
  const art = readStatusIcons(readRom(bytes))!;

  it("draws sleep's frames in the second palette, each 16 game frames, from 2 right of the square", () => {
    const { frames, ticks } = statusIconFrames(art, 'sleep');
    expect([frames.length, ticks]).toEqual([7, 16]);
    const first = frames[0]!;
    expect([first.drawn.image.width, first.drawn.image.height, first.x, first.y]).toEqual([8, 8, 2, 0]);
    expect(Array.from(first.drawn.image.rgba.subarray(0, 4))).toEqual([248, 0, 0, 255]);
    // Frame D: the 16 x 16 "Z", one left and three up of that.
    const d = frames[3]!;
    expect([d.drawn.image.width, d.drawn.image.height, d.x, d.y]).toEqual([16, 16, 1, -3]);
    expect(Array.from(d.drawn.image.rgba.subarray((15 * 16 + 15) * 4, (15 * 16 + 15) * 4 + 4))).toEqual([0, 0, 248, 255]);
  });

  it('leaves silence blank for its last five frames', () => {
    const { frames, ticks } = statusIconFrames(art, 'silence');
    expect([frames.length, ticks]).toEqual([18, 4]);
    expect(frames.slice(13).every((f) => f === null)).toBe(true);
    expect(frames[2]).toMatchObject({ x: -2, y: -6 }); // C: (0, -2) from the icon's (-2, -4)
  });

  it("isn't read from a ROM without the graphics", () => {
    expect(readStatusIcons(readRom(new Uint8Array(0x100)))).toBeNull();
  });
});
