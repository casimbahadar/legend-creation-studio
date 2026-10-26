import { describe, expect, it } from 'vitest';
import { readRom } from './gba-rom';
import {
  barLevels,
  drawExpBar,
  expBarOpening,
  expBarTilemap,
  FE8U_BAR_DIGITS,
  FE8U_EXP_BAR_BOX,
  FE8U_EXP_BAR_FILL_TILES,
  FE8U_EXP_BAR_PALETTE,
  FE8U_EXP_BAR_TILES,
  readExpBarArt,
} from './fe8-expbar';

/** A stand-in ROM with the bar's tiles (each tile filled with its own number % 15 + 1) and a box of tile 0. */
function fakeRom(): Uint8Array {
  const bytes = new Uint8Array(0x1000000);
  const view = new DataView(bytes.buffer);
  for (const [at, count] of [
    [FE8U_EXP_BAR_TILES, 13],
    [FE8U_EXP_BAR_FILL_TILES, 24],
    [FE8U_BAR_DIGITS, 11],
  ] as const) {
    for (let t = 0; t < count; t++) bytes.fill(((t % 15) + 1) * 0x11, at + t * 32, at + t * 32 + 32);
  }
  for (let c = 0; c < 16; c++) view.setUint16(FE8U_EXP_BAR_PALETTE + c * 2, c, true);
  bytes[FE8U_EXP_BAR_BOX] = 16;
  bytes[FE8U_EXP_BAR_BOX + 1] = 2;
  return bytes;
}

describe('FE8 experience bar', () => {
  it('fills its 13 tiles as the game does, each sharing a pixel with the next', () => {
    expect(barLevels(0)).toEqual(new Array(13).fill(0));
    expect(barLevels(99)).toEqual([6, ...new Array(11).fill(9), 6]);
    // 99 * 256 / 99 * 50 >> 8 = 50: 6 in the left end, 8 more in each middle, 5 left for the sixth.
    expect(barLevels(50)).toEqual([6, 9, 9, 9, 9, 9, 5, 0, 0, 0, 0, 0, 0]);
    expect(barLevels(1)).toEqual([1, ...new Array(12).fill(0)]);
  });

  it("puts the experience in the bar's digits and the fill tiles after them", () => {
    const art = readExpBarArt(readRom(fakeRom()))!;
    expect(art).not.toBeNull();
    const row = (exp: number) => Array.from(expBarTilemap(art, exp).entries.subarray(17, 34));
    // Columns 1 and 2: a blank (digit tile 10) and 7; then the bar: left end 0..6 from fill tile 0 (13),
    // middles from fill tile 7 (20), right end from 17 (30).
    expect(row(7).slice(1, 5)).toEqual([37 + 10, 37 + 7, 13 + 6, 20 + 2]); // 7 = 6 in the end, then 2 sharing its last pixel
    expect(row(42).slice(1, 3)).toEqual([37 + 4, 37 + 2]);
    expect(row(99).slice(15)).toEqual([30 + 6, 0]);
    expect(drawExpBar(art, 7).width).toBe(136);
  });

  it('opens from the middle over 6 frames after the first', () => {
    expect([0, 1, 2, 4, 7, 9].map(expBarOpening)).toEqual([0, 0, 4 / 24, 12 / 24, 1, 1]);
  });
});
