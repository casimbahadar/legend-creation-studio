// FE8 US's battle forecast extras (decision 35), from the fireemblem8u decompilation (src/bksel.c,
// data/data_59E8E0.s): the "x2" and "x4" marks (gBattleForecast_x2x4Gfx, LZ77, 4 x 2 tiles copied into
// sprite memory at tile 0x2E8, in gBattleForecast_x2x4Pal), shown beside a side's damage when it hits
// more than once, bobbing as PutBattleForecastMultipliers moves them; and the weapon triangle arrows.

import { drawApFrame, oamPiece, type DrawnFrame } from './fe8-ap';
import type { StatusIconArt } from './fe8-status-icons';
import { createImage, drawTile4bpp, readPalettes, type Image } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_FORECAST_MULTIPLIERS = 0x5a0c80;
export const FE8U_FORECAST_MULTIPLIER_PALETTE = 0x5a0d2c;

/** The "x2" and "x4" marks, 16 x 16 each (sprite tiles 0x2E8 and 0x2EA: a hit count of 2 or 4 plus 0x2E6). */
export interface ForecastMultipliers {
  readonly x2: Image;
  readonly x4: Image;
}

export function readForecastMultipliers(rom: GbaRom): ForecastMultipliers | null {
  let tiles: Uint8Array;
  try {
    tiles = decompressLz77(rom.bytes, FE8U_FORECAST_MULTIPLIERS);
  } catch {
    return null;
  }
  if (tiles.length < 8 * 32) return null;
  const [palette] = readPalettes(rom, FE8U_FORECAST_MULTIPLIER_PALETTE, 1);
  if (!palette) return null;
  // Copy2dChr(4 x 2): the first 4 tiles are the top row, the next 4 the row below.
  const mark = (col: number) => {
    const image = createImage(16, 16);
    for (let t = 0; t < 4; t++) drawTile4bpp(image, tiles, (t >> 1) * 4 + col + (t & 1), palette, (t & 1) * 8, (t >> 1) * 8, false, false, true);
    return image;
  };
  return { x2: mark(0), x4: mark(2) };
}

/**
 * Where a mark goes in the window, in pixels from its top left, `frame` frames after it opened: the
 * attacker's beside its damage on the right, the target's on the left, each circling by up to 4 pixels
 * across and 2 down (SIN and COS of 4 steps a frame on a circle of 256).
 */
export function multiplierAt(side: 'attacker' | 'target', frame: number): { x: number; y: number } {
  const angle = ((frame * 4) & 0xff) * ((2 * Math.PI) / 256);
  const dx = (Math.round(Math.sin(angle) * 4096) * 4) >> 12;
  const dy = (Math.round(Math.cos(angle) * 4096) * 2) >> 12;
  return { x: (side === 'attacker' ? 72 : 24) - 3 + dx, y: 40 + dy };
}

/** How many times a side hits (BattleForecastHitCountUpdate): once, twice if it follows up, never more than its uses left. */
export function forecastHits(doubles: boolean, uses: number | null): number {
  const hits = doubles ? 2 : 1;
  return uses === null ? hits : Math.min(hits, uses);
}

/**
 * The weapon triangle arrows (UpdateStatArrowSprites, gSysUpArrowSpriteLut, gSysDownArrowSpriteLut): an
 * 8 x 16 sprite from the map's sprite graphics (the sheet the status icons use) in palette 0, up for
 * an advantage and down for a disadvantage, stepping through 3 frames of 8 game frames; each frame with
 * its offset down from where the arrow goes.
 */
export function triangleArrowFrames(art: StatusIconArt): { readonly up: readonly { drawn: DrawnFrame; y: number }[]; readonly down: readonly { drawn: DrawnFrame; y: number }[] } {
  const frame = (tile: number, y: number) => ({ drawn: drawApFrame([oamPiece(0x8000 | (y & 0xff), 0, tile)], art.sheet, 0, 0, (n) => art.palettes[n]), y });
  return { up: [frame(0x4c, 0), frame(0x4d, 0), frame(0x4d, -1)], down: [frame(0x4e, 0), frame(0x4f, 0), frame(0x4f, 1)] };
}

/** Where each side's triangle arrow goes in the window (PutBattleForecastWeaponTriangleArrows). */
export const TRIANGLE_ARROW_AT = { attacker: { x: 19, y: 8 }, target: { x: 67, y: 88 } } as const;
