import { describe, expect, it } from 'vitest';
import {
  battleBoxColumns,
  battleBoxOpening,
  battleBoxRow,
  drawBattleBoxes,
  FE8U_BATTLE_BOX_BAR,
  FE8U_BATTLE_BOX_DIGIT_PALETTE,
  FE8U_BATTLE_BOX_DIGITS,
  FE8U_BATTLE_BOX_FIRST,
  FE8U_BATTLE_BOX_ONE,
  FE8U_BATTLE_BOX_PALETTES,
  FE8U_BATTLE_BOX_SECOND,
  FE8U_BATTLE_BOX_TILES,
  readBattleBoxArt,
  stepShownHp,
} from './fe8-battle-box';
import { readRom } from './gba-rom';

/** LZ77 copying repeats 1 or 2 bytes back (a run of a byte, or of 16-bit entries), small enough for the space each piece has. */
function lz77(data: Uint8Array): Uint8Array {
  const out = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, data.length >> 16];
  let i = 0;
  while (i < data.length) {
    const flagsAt = out.push(0) - 1;
    for (let bit = 0; bit < 8 && i < data.length; bit++) {
      const runAt = (back: number) => {
        let run = 0;
        while (i >= back && run < 18 && i + run < data.length && data[i + run] === data[i + run - back]) run++;
        return run;
      };
      const [run, back] = [runAt(1), runAt(2)].map((r, k) => [r, k + 1] as const).sort((a, b) => b[0] - a[0])[0]!;
      if (run >= 3) {
        out[flagsAt]! |= 0x80 >> bit;
        out.push((run - 3) << 4, back - 1);
        i += run;
      } else out.push(data[i++]!);
    }
  }
  return Uint8Array.from(out);
}

/** Tiles each filled with one colour. */
const solid = (colours: readonly number[]) => {
  const t = new Uint8Array(colours.length * 32);
  colours.forEach((c, i) => t.fill(c * 0x11, i * 32, i * 32 + 32));
  return t;
};

/** A tilemap `w` x `h` of one entry. */
const tsa = (w: number, h: number, entry: number) => {
  const t = new Uint8Array(2 + w * h * 2);
  t[0] = w - 1;
  t[1] = h - 1;
  for (let i = 0; i < w * h; i++) t[2 + i * 2] = entry;
  return t;
};

describe('FE8 map battle HP boxes', () => {
  // The box: tile 0 all colour 1, tile 1 all colour 2. The first of two boxes 12 x 4 of tile 0, the
  // second 11 x 4 of tile 1 (so it reaches the first's left column), one alone 10 x 4.
  // Digits 0-9 and the 11th tile each one colour, 1 to 11; the bar's 21 tiles 1 to 15, then 1 again.
  // The number palette's colour n is red n; the blue team's colour 1 is blue 31, the red team's 2 red 31.
  const bytes = new Uint8Array(FE8U_BATTLE_BOX_DIGIT_PALETTE + 0x20);
  const view = new DataView(bytes.buffer);
  bytes.set(lz77(solid([1, 2])), FE8U_BATTLE_BOX_TILES);
  bytes.set(lz77(tsa(10, 4, 0)), FE8U_BATTLE_BOX_ONE);
  bytes.set(lz77(tsa(12, 4, 0)), FE8U_BATTLE_BOX_FIRST);
  bytes.set(lz77(tsa(11, 4, 1)), FE8U_BATTLE_BOX_SECOND);
  bytes.set(lz77(solid(Array.from({ length: 11 }, (_, i) => i + 1))), FE8U_BATTLE_BOX_DIGITS);
  bytes.set(lz77(solid(Array.from({ length: 21 }, (_, j) => 1 + (j % 15)))), FE8U_BATTLE_BOX_BAR);
  for (let n = 0; n < 16; n++) view.setUint16(FE8U_BATTLE_BOX_DIGIT_PALETTE + n * 2, n, true);
  view.setUint16(FE8U_BATTLE_BOX_PALETTES + 2, 31 << 10, true);
  view.setUint16(FE8U_BATTLE_BOX_PALETTES + 0x20 + 4, 31, true);
  const art = readBattleBoxArt(readRom(bytes))!;
  const at = (img: { rgba: Uint8ClampedArray; width: number }, x: number, y: number) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

  it('lays the boxes out at tiles 14 and 4, the second over the first, colour 1 shaded down to half', () => {
    expect(art).not.toBeNull();
    const img = drawBattleBoxes(art, [
      { team: 'player', hp: 25, maxHp: 30 },
      { team: 'enemy', hp: 100, maxHp: 100 },
    ]);
    expect([img.width, img.height]).toEqual([240, 32]);
    expect(at(img, 14 * 8 + 8, 0)).toEqual([0, 0, 248]);
    // 16 lines down: 31 + (15 - 31) * 16 / 32 = 23; 24 lines down, 19.
    expect(at(img, 20 * 8, 16)).toEqual([0, 0, 184]);
    expect(at(img, 15 * 8, 24)).toEqual([0, 0, 152]);
    expect(at(img, 14 * 8, 0)).toEqual([248, 0, 0]);
    expect(at(img, 3 * 8, 0)).toEqual([0, 0, 0]);
  });

  it('writes the HP ending at column 3 of row 3, "--" from 100, and the bar from column 4', () => {
    const img = drawBattleBoxes(art, [
      { team: 'player', hp: 25, maxHp: 30 },
      { team: 'enemy', hp: 100, maxHp: 100 },
    ]);
    const red = (col: number) => at(img, col * 8, 24)[0]! >> 3;
    // "25": digit 5 is colour 6, digit 2 colour 3; 100 shows the 11th tile twice.
    expect([red(16), red(17)]).toEqual([3, 6]);
    expect([red(6), red(7)]).toEqual([11, 11]);
    // 25 of 30 fills 36 of the bar's 44 steps: the left end full (0x2B + 5), the fifth middle at 4 of 8, the right end empty.
    expect([red(18), red(23), red(24)]).toEqual([6, 11, 1]);
  });

  it('puts one unit\'s box at tile 10', () => {
    const img = drawBattleBoxes(art, [{ team: 'player', hp: 5, maxHp: 10 }]);
    expect(at(img, 10 * 8, 0)).toEqual([0, 0, 248]);
    expect(at(img, 9 * 8 + 7, 0)).toEqual([0, 0, 0]);
    expect(battleBoxColumns(1)).toEqual([10]);
    expect(battleBoxColumns(2)).toEqual([14, 4]);
  });

  it('chooses the row from where the units are', () => {
    expect(battleBoxRow([48])).toBe(9);
    expect(battleBoxRow([112])).toBe(9);
    expect(battleBoxRow([0, 96])).toBe(8);
    expect(battleBoxRow([16, 48])).toBe(9);
    expect(battleBoxRow([128, 96])).toBe(7);
  });

  it('runs the HP shown down a point a frame and up a quarter, and opens 2 lines a frame', () => {
    expect(stepShownHp(20 * 16, 15)).toBe(19 * 16);
    expect(stepShownHp(15 * 16, 15)).toBe(15 * 16);
    expect(stepShownHp(15 * 16, 20)).toBe(15 * 16 + 4);
    expect([0, 1, 2, 8, 9].map(battleBoxOpening)).toEqual(['hidden', 'hidden', 2, 14, 'whole']);
  });

  it("isn't read from a ROM without it", () => {
    expect(readBattleBoxArt(readRom(new Uint8Array(0x100)))).toBeNull();
  });
});
