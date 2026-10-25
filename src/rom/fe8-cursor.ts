// FE8 US's map cursor and menu hand, for drawing play's cursors as the game does (decision 35). From
// the fireemblem8u decompilation (src/bm.c LoadObjUIGfx, PutMapCursor, sSprite_MapCursorA to C;
// src/uiutils.c DisplayUiHand, sSprite_Hand; data/data_59E8E0.s): the map's sprite graphics
// gGfx_MiscUiGraphics (LZ77, 4bpp, 18 x 4 tiles copied row by row into sprite memory, 32 tiles to a
// row there) and their palette gPal_MiscUiGraphics. The cursor is sprite tile 2 in palette 0, put four
// times, flipped into each corner of the square, and it breathes in and out over 16 frames of 2 ticks
// each. The hand is the 16 x 16 sprite at tile 0, palette 0.

import { createImage, drawTile4bpp, readPalettes, type Image } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_MISC_UI_GRAPHICS = 0x59e8e0;
export const FE8U_MISC_UI_PALETTE = 0x59ed70;

const CURSOR_TILE = 2;
/** Tiles in a row of the graphics as stored; in sprite memory a row is 32 tiles. */
const ROW_TILES = 18;

/** The graphics' tiles (rows of ROW_TILES) and palette 0, or null if they aren't readable. */
function readMiscUi(rom: GbaRom, tilesNeeded: number) {
  let tiles: Uint8Array;
  try {
    tiles = decompressLz77(rom.bytes, FE8U_MISC_UI_GRAPHICS);
  } catch {
    return null;
  }
  if (tiles.length < tilesNeeded * 32) return null;
  const [palette] = readPalettes(rom, FE8U_MISC_UI_PALETTE, 1);
  return { tiles, palette: palette! };
}

/** The cursor's corner, the top left one, as an 8 x 8 image; colour 0 transparent. Null if it isn't readable. */
export function readMapCursor(rom: GbaRom): Image | null {
  const ui = readMiscUi(rom, CURSOR_TILE + 1);
  if (!ui) return null;
  const image = createImage(8, 8);
  drawTile4bpp(image, ui.tiles, CURSOR_TILE, ui.palette, 0, 0, false, false, true);
  return image;
}

/** The menu hand, 16 x 16; colour 0 transparent. Null if it isn't readable. */
export function readMenuHand(rom: GbaRom): Image | null {
  const ui = readMiscUi(rom, ROW_TILES + 2);
  if (!ui) return null;
  const image = createImage(16, 16);
  for (const [t, x, y] of [
    [0, 0, 0],
    [1, 8, 0],
    [ROW_TILES, 0, 8],
    [ROW_TILES + 1, 8, 8],
  ] as const) {
    drawTile4bpp(image, ui.tiles, t, ui.palette, x, y, false, false, true);
  }
  return image;
}

/**
 * Where DisplayUiHand puts the hand, relative to the top left of the chosen line's text: 14 pixels to
 * its left and 2 down, bobbing right by up to 4 pixels over 32 ticks (sHandHOffsetLookup).
 */
const HAND_BOB = [0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
export function handOffset(now: number): { x: number; y: number } {
  return { x: HAND_BOB[Math.floor((now * 60) / 1000) % HAND_BOB.length]! - 14, y: 2 };
}

/**
 * Where the four corners go in each spread, relative to the square's top left in pixels: the left and
 * right corners' x, the top and bottom corners' y (sSprite_MapCursorA, B and C).
 */
const SPREADS = {
  a: { left: -2, right: 10, top: -4, bottom: 9 },
  b: { left: -1, right: 9, top: -3, bottom: 8 },
  c: { left: 0, right: 8, top: -2, bottom: 7 },
} as const;
export type CursorSpread = (typeof SPREADS)[keyof typeof SPREADS];

/** sMapCursorSpriteLut: wide for 10 frames, then in, tight for 4 frames, and out again. */
const FRAMES = ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'c', 'c', 'c', 'c', 'b'] as const;

/** The game runs at about 60 ticks a second; a frame lasts 2 of them. */
const FRAME_MS = 2000 / 60;

/** The cursor's spread at `now` milliseconds. */
export function cursorSpread(now: number): CursorSpread {
  return SPREADS[FRAMES[Math.floor(now / FRAME_MS) % FRAMES.length]!];
}
