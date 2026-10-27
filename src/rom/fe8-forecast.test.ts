import { describe, expect, it } from 'vitest';
import { FE8U_FORECAST_MULTIPLIER_PALETTE, FE8U_FORECAST_MULTIPLIERS, forecastHits, multiplierAt, readForecastMultipliers } from './fe8-forecast';
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

describe('FE8 battle forecast marks', () => {
  it('reads "x2" from the left two columns of its 4 x 2 tiles and "x4" from the right two', () => {
    const bytes = new Uint8Array(FE8U_FORECAST_MULTIPLIER_PALETTE + 0x20);
    // Tile n all colour n + 1: the top row tiles 0-3, the bottom row 4-7.
    const tiles = new Uint8Array(8 * 32);
    for (let t = 0; t < 8; t++) tiles.fill((t + 1) * 0x11, t * 32, t * 32 + 32);
    bytes.set(lz77(tiles), FE8U_FORECAST_MULTIPLIERS);
    const view = new DataView(bytes.buffer);
    for (let c = 1; c <= 8; c++) view.setUint16(FE8U_FORECAST_MULTIPLIER_PALETTE + c * 2, c, true);
    const m = readForecastMultipliers(readRom(bytes))!;
    const red = (img: { rgba: Uint8ClampedArray }, x: number, y: number) => img.rgba[(y * 16 + x) * 4]! / 8;
    expect([red(m.x2, 0, 0), red(m.x2, 8, 0), red(m.x2, 0, 8), red(m.x2, 8, 8)]).toEqual([1, 2, 5, 6]);
    expect([red(m.x4, 0, 0), red(m.x4, 8, 8)]).toEqual([3, 8]);
    expect(readForecastMultipliers(readRom(new Uint8Array(0x100)))).toBeNull();
  });

  it('puts them beside each damage, circling by up to 4 across and 2 down', () => {
    expect(multiplierAt('attacker', 0)).toEqual({ x: 69, y: 42 });
    expect(multiplierAt('target', 0)).toEqual({ x: 21, y: 42 });
    expect(multiplierAt('attacker', 16)).toEqual({ x: 73, y: 40 }); // a quarter turn
  });

  it('counts the hits: twice for a follow-up, never past the uses left', () => {
    expect([forecastHits(false, null), forecastHits(true, null), forecastHits(true, 1), forecastHits(true, 5)]).toEqual([1, 2, 1, 2]);
  });
});
