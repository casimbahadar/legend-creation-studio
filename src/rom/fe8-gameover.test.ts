import { describe, expect, it } from 'vitest';
import {
  drawGameOver,
  FE8U_CHAPTER_INTRO_FOG,
  FE8U_GAME_OVER_PALETTE_FOG,
  FE8U_GAME_OVER_PALETTE_TEXT,
  FE8U_GAME_OVER_TEXT,
  FE8U_GAME_OVER_TILEMAP,
  gameOverFade,
  readGameOverArt,
} from './fe8-gameover';
import { readRom } from './gba-rom';

/** LZ77 copying runs of a repeated byte (distance 1). */
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

describe('FE8 Game Over screen', () => {
  // Text: tile 1 all colour 1 (red in the text palette), laid out 11 x 3, all tile 1 but a blank top left.
  // Fog: every pixel colour 1 (blue, 10 of 31) in the fog palette; the backdrop is the text palette's first colour, black.
  const bytes = new Uint8Array(FE8U_GAME_OVER_TILEMAP + 0x44);
  const view = new DataView(bytes.buffer);
  bytes.set(lz77(Uint8Array.from([...new Array(32).fill(0), ...new Array(32).fill(0x11)])), FE8U_GAME_OVER_TEXT);
  bytes.set(lz77(new Uint8Array(32 * 8 * 32).fill(0x11)), FE8U_CHAPTER_INTRO_FOG);
  view.setUint16(FE8U_GAME_OVER_PALETTE_TEXT + 2, 31, true);
  view.setUint16(FE8U_GAME_OVER_PALETTE_FOG + 2, 10 << 10, true);
  bytes[FE8U_GAME_OVER_TILEMAP] = 10;
  bytes[FE8U_GAME_OVER_TILEMAP + 1] = 2;
  for (let i = 0; i < 33; i++) view.setUint16(FE8U_GAME_OVER_TILEMAP + 2 + i * 2, 1, true);
  // Stored bottom row first: the top row's first entry is the 23rd.
  view.setUint16(FE8U_GAME_OVER_TILEMAP + 2 + 22 * 2, 0, true);
  const art = readGameOverArt(readRom(bytes))!;
  const at = (img: { rgba: Uint8ClampedArray | Uint8Array; width: number }, x: number, y: number) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

  it('puts the text at tile (7, 9) over the fog, which is blended line by line, dark at the edges', () => {
    const img = drawGameOver(art, 0, 32);
    expect(at(img, 7 * 8 + 8, 9 * 8)).toEqual([248, 0, 0]); // the text
    // The blank text tile shows the fog: both layers, each weighted 16/16 in the middle lines: 10 + 10 = 20.
    expect(at(img, 7 * 8, 9 * 8)).toEqual([0, 0, 160]);
    expect(at(img, 0, 80)).toEqual([0, 0, 160]);
    // Weight 0 on the first line; 3 lines down, 1/16 each: (10 + 10) / 16 = 1.
    expect(at(img, 0, 0)).toEqual([0, 0, 0]);
    expect(at(img, 0, 3)).toEqual([0, 0, 8]);
  });

  it('fades in from black over 32 ticks, 10 at once and one every 8 frames, and out a tick a frame', () => {
    expect(gameOverFade(0, null)).toBe(10);
    expect(gameOverFade(8, null)).toBe(11);
    expect(gameOverFade(1000, null)).toBe(32);
    expect(gameOverFade(1000, 5)).toBe(27);
    // With 10 ticks a channel shows its value less 22: red 31 shows 9.
    expect(at(drawGameOver(art, 0, 10), 7 * 8 + 8, 9 * 8)).toEqual([72, 0, 0]);
    expect(at(drawGameOver(art, 0, 0), 7 * 8 + 8, 9 * 8)).toEqual([0, 0, 0]);
  });

  it("isn't read from a ROM without it", () => {
    expect(readGameOverArt(readRom(new Uint8Array(0x100)))).toBeNull();
  });
});
