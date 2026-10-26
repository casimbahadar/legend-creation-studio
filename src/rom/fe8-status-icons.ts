// FE8 US's status icons over units on the map (decision 35), from the fireemblem8u decompilation
// (src/bmudisp.c PutUnitSpriteIconsOam, sSleepIconSprites, sSilenceIconSprites, sBerserkIconSprites):
// one sprite piece a frame, with tiles from the map's sprite graphics (gGfx_MiscUiGraphics, as the
// cursor; fe8-cursor.ts) in its second palette. Each status steps through its frames on the game clock
// and sits at its own offset from the unit's square.

import { drawApFrame, oamPiece, type DrawnFrame } from './fe8-ap';
import { FE8U_MISC_UI_GRAPHICS, FE8U_MISC_UI_PALETTE } from './fe8-cursor';
import { readPalettes, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export type StatusIcon = 'sleep' | 'silence' | 'berserk';

/** The OAM attributes of each frame, how many game frames each shows, and where it goes from the square's top left. */
const ICONS: Record<StatusIcon, { readonly frames: readonly (readonly [number, number, number] | null)[]; readonly ticks: number; readonly x: number; readonly y: number }> = {
  sleep: {
    frames: [
      [0x0000, 0x0000, 0x1864],
      [0x00ff, 0x0000, 0x1864],
      [0x00fe, 0x01ff, 0x1864],
      [0x00fd, 0x41ff, 0x184a],
      [0x00fc, 0x41fe, 0x184a],
      [0x00fb, 0x41fe, 0x184a],
      [0x00fa, 0x41fd, 0x184a],
    ],
    ticks: 16,
    x: 2,
    y: 0,
  },
  silence: {
    // A, B, then C nine times, B, A, and five frames of nothing.
    frames: [[0x4000, 0x0000, 0x1866], [0x40ff, 0x0000, 0x1846], ...Array<readonly [number, number, number]>(9).fill([0x00fe, 0x4000, 0x1848]), [0x40ff, 0x0000, 0x1846], [0x4000, 0x0000, 0x1866], null, null, null, null, null],
    ticks: 4,
    x: -2,
    y: -4,
  },
  berserk: {
    frames: [
      [0x4000, 0x0000, 0x1842],
      [0x4001, 0x0001, 0x1862],
      [0x4001, 0x0000, 0x1844],
      [0x4000, 0x0001, 0x1842],
      [0x4000, 0x0002, 0x1862],
      [0x4001, 0x0000, 0x1844],
      [0x4000, 0x01ff, 0x1842],
      [0x4001, 0x0001, 0x1862],
      [0x4001, 0x0002, 0x1844],
    ],
    ticks: 8,
    x: 1,
    y: -5,
  },
};

/** Tiles in a row of the graphics as stored, and in sprite memory (LoadObjUIGfx's Copy2dChr). */
const ROW_TILES = 18;
const ROWS = 4;

export interface StatusIconArt {
  /** The graphics as laid out in sprite memory from tile 0, 32 tiles to a row. */
  readonly sheet: Uint8Array;
  /** gPal_MiscUiGraphics' two palettes, sprite palettes 0 and 1. */
  readonly palettes: readonly Palette[];
}

/** The status icons' graphics, or null if they aren't readable. */
export function readStatusIcons(rom: GbaRom): StatusIconArt | null {
  let tiles: Uint8Array;
  try {
    tiles = decompressLz77(rom.bytes, FE8U_MISC_UI_GRAPHICS);
  } catch {
    return null;
  }
  if (tiles.length < ROW_TILES * ROWS * 32) return null;
  const sheet = new Uint8Array(32 * ROWS * 32);
  for (let r = 0; r < ROWS; r++) sheet.set(tiles.subarray(r * ROW_TILES * 32, (r + 1) * ROW_TILES * 32), r * 32 * 32);
  return { sheet, palettes: readPalettes(rom, FE8U_MISC_UI_PALETTE, 2) };
}

/** One frame of an icon: its image, and where its top left goes in pixels from the unit's square's top left. */
export interface StatusIconFrame {
  readonly drawn: DrawnFrame;
  readonly x: number;
  readonly y: number;
}

/** Each frame of `status`'s icon (null for one showing nothing), and how many game frames each shows. */
export function statusIconFrames(art: StatusIconArt, status: StatusIcon): { readonly frames: readonly (StatusIconFrame | null)[]; readonly ticks: number } {
  const icon = ICONS[status];
  const frames = icon.frames.map((oam) => {
    if (!oam) return null;
    const piece = oamPiece(...oam);
    return { drawn: drawApFrame([piece], art.sheet, 0, 0, (n) => art.palettes[n]), x: icon.x + piece.x, y: icon.y + piece.y };
  });
  return { frames, ticks: icon.ticks };
}
