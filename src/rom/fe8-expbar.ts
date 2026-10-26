// FE8 US's experience bar on the map (decision 35), from the fireemblem8u decompilation
// (src/mapanim_expbar.c, src/mapanim_infobox.c, data/data-banimmisc.s): a box of 17 x 3 tiles at
// tile (6, 8) of the screen, the experience in the bar's own digits, and a bar of 13 tiles that each
// show how far they are filled. Its tiles sit one after another as the game loads them to tile 512:
// the box (Img_EkrExpBar, 13 tiles), the bar's fill levels (Img_EkrExpBarChange, 24) and the digits
// (Img_BarNumfx, 11, the last blank), all uncompressed, in one palette (Pal_ExpBar).

import { drawTilemap, readTilemap, type Tilemap } from './fe8-windows';
import { readPalettes, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';

export const FE8U_EXP_BAR_TILES = 0x802d44;
export const FE8U_EXP_BAR_FILL_TILES = 0x8030c4;
export const FE8U_BAR_DIGITS = 0x8033c4;
export const FE8U_EXP_BAR_PALETTE = 0x803590;
/** The box's tilemap (gUnknown_089AD498), 17 x 3 tiles. */
export const FE8U_EXP_BAR_BOX = 0x9ad498;

const TILE_BYTES = 32;
const BOX_TILES = 13;
const FILL_TILES = 24;
const DIGIT_TILES = 11;
/** Where the bar's fill levels and digits start among the tiles. */
const FILL = BOX_TILES;
const DIGITS = BOX_TILES + FILL_TILES;
const BLANK_DIGIT = DIGITS + 10;

/** Where the box sits on the 240 x 160 screen, in pixels (tile 6, 8). */
export const EXP_BAR_X = 48;
export const EXP_BAR_Y = 64;

export interface ExpBarArt {
  readonly tiles: Uint8Array;
  readonly palette: Palette;
  readonly box: Tilemap;
}

/** The experience bar's art, or null if it isn't readable. */
export function readExpBarArt(rom: GbaRom): ExpBarArt | null {
  const box = readTilemap(rom, FE8U_EXP_BAR_BOX);
  if (!box || box.width !== 17 || box.height !== 3) return null;
  const tiles = new Uint8Array((BOX_TILES + FILL_TILES + DIGIT_TILES) * TILE_BYTES);
  for (const [at, count, to] of [
    [FE8U_EXP_BAR_TILES, BOX_TILES, 0],
    [FE8U_EXP_BAR_FILL_TILES, FILL_TILES, FILL],
    [FE8U_BAR_DIGITS, DIGIT_TILES, DIGITS],
  ] as const) {
    if (at + count * TILE_BYTES > rom.size) return null;
    tiles.set(rom.bytes.subarray(at, at + count * TILE_BYTES), to * TILE_BYTES);
  }
  const [palette] = readPalettes(rom, FE8U_EXP_BAR_PALETTE, 1);
  return palette ? { tiles, palette, box } : null;
}

/**
 * The bar's tiles (gUnknown_089A36C0): a left end filling over 6 pixels (fill tiles 0 to 6), 11
 * middles over 9 (7 to 16) and a right end over 6 (17 to 23), each sharing a pixel with the next.
 */
const BAR: readonly (readonly [number, number])[] = [[6, 0], ...Array.from({ length: 11 }, () => [9, 7] as const), [6, 17]];

/** Each bar tile's fill level for `exp` out of 99 (sub_807BB40, sub_807BB10). */
export function barLevels(exp: number, max = 99): number[] {
  const count = BAR.reduce((n, [steps]) => n + steps - 1, 0) + 1;
  let left = exp === max ? count : (Math.trunc((count << 8) / max) * exp) >> 8;
  if (left === 0 && exp > 0) left = 1;
  return BAR.map(([steps]) => {
    const level = Math.min(left, steps);
    left = Math.max(0, left + 1 - steps);
    return level;
  });
}

/** The box's tilemap for `exp` (DrawMAExpBar): the number ending at column 2 of row 1, the bar from column 3. */
export function expBarTilemap(art: ExpBarArt, exp: number): Tilemap {
  const entries = art.box.entries.slice();
  const w = art.box.width;
  const n = Math.max(0, Math.min(99, Math.trunc(exp)));
  entries[w + 2] = DIGITS + (n % 10);
  entries[w + 1] = n >= 10 ? DIGITS + Math.trunc(n / 10) : BLANK_DIGIT;
  barLevels(n).forEach((level, i) => (entries[w + 3 + i] = FILL + BAR[i]![1] + level));
  return { width: w, height: art.box.height, entries };
}

/** The box as it shows `exp`, 136 x 24 pixels. */
export function drawExpBar(art: ExpBarArt, exp: number): Image {
  return drawTilemap(art.tiles, expBarTilemap(art, exp), () => art.palette);
}

/**
 * How much of the box's height shows `frame` frames into the display: drawn on frame 1, it opens from
 * its middle row out, 4 pixels a frame, until whole on frame 7 (ProcMAExpBar_FrameAdvance).
 */
export function expBarOpening(frame: number): number {
  return Math.min(1, Math.max(0, ((Math.floor(frame) - 1) * 4) / 24));
}
