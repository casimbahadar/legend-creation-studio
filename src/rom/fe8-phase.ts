// FE8 US's phase intro ("Player Phase" and the rest), for drawing play's phase banners as the game does
// (decision 35). From the fireemblem8u decompilation (src/phasechangefx.c, data/data_59E8E0.s):
// - a band 240 x 32 pixels (Img_PhaseChangeUnk, LZ77, sprite tiles 32 to a row) put at y 68, its height
//   growing from nothing, held, and shrinking again, in the phase's palette;
// - the phase's name (Img_PhaseChangePlayer, Enemy or Other, LZ77, 32 x 3 tiles in order) on a
//   background layer at y 72, sliding right as it fades in, held, and sliding on as it fades out.
// - squares sweeping across the map (Img_PhaseChangeSquares, LZ77, 32 tiles to a row, each size of
//   square 2 x 2 tiles), seen only above and below a window that closes in on the band and opens
//   again, blended over the map at up to 7/16.

import { createImage, drawTile4bpp, readPalettes, type Image } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';
import type { Team } from './fe8-windows';

export const FE8U_PHASE_BAND = 0x59f020;
export const FE8U_PHASE_SQUARES = 0x5a06d8;
export const FE8U_PHASE_NAMES: Readonly<Record<Team, number>> = { player: 0x59f3f8, enemy: 0x59fa4c, ally: 0x5a0088 };
export const FE8U_PHASE_PALETTES: Readonly<Record<Team, number>> = { player: 0x59fa2c, enemy: 0x5a0068, ally: 0x5a0698 };

export const BAND_WIDTH = 240;
export const BAND_HEIGHT = 32;
export const BAND_Y = 0x44;
export const NAME_WIDTH = 256;
export const NAME_HEIGHT = 24;
export const NAME_Y = 9 * 8;

export interface PhaseBanner {
  readonly band: Image;
  readonly name: Image;
  /** The squares' 9 sizes, 16 x 16 each, by tile offset / 2 (0 to 16 in twos). */
  readonly squares: readonly Image[];
}

/** `team`'s phase banner, colour 0 transparent, or null if it isn't readable. */
export function readPhaseBanner(rom: GbaRom, team: Team): PhaseBanner | null {
  let bandTiles: Uint8Array;
  let nameTiles: Uint8Array;
  let squareTiles: Uint8Array;
  try {
    bandTiles = decompressLz77(rom.bytes, FE8U_PHASE_BAND);
    nameTiles = decompressLz77(rom.bytes, FE8U_PHASE_NAMES[team]);
    squareTiles = decompressLz77(rom.bytes, FE8U_PHASE_SQUARES);
  } catch {
    return null;
  }
  if (bandTiles.length === 0 || nameTiles.length === 0 || squareTiles.length === 0) return null;
  const [palette] = readPalettes(rom, FE8U_PHASE_PALETTES[team], 1);
  // The band is five sprites side by side (obj_0859AEC8) whose tiles sit in a grid 32 tiles wide.
  const band = createImage(BAND_WIDTH, BAND_HEIGHT);
  for (let r = 0; r < BAND_HEIGHT / 8; r++) {
    for (let c = 0; c < BAND_WIDTH / 8; c++) drawTile4bpp(band, bandTiles, r * 32 + c, palette!, c * 8, r * 8, false, false, true);
  }
  const name = createImage(NAME_WIDTH, NAME_HEIGHT);
  for (let t = 0; t < (NAME_WIDTH / 8) * (NAME_HEIGHT / 8); t++) {
    drawTile4bpp(name, nameTiles, t, palette!, (t % 32) * 8, Math.floor(t / 32) * 8, false, false, true);
  }
  // PhaseIntroSquares: a square is tiles val and val + 1 over val + 0x20 and val + 0x21.
  const squares = Array.from({ length: SQUARE_SIZES }, (_, i) => {
    const img = createImage(16, 16);
    for (const [dt, x, y] of [
      [0, 0, 0],
      [1, 8, 0],
      [0x20, 0, 8],
      [0x21, 8, 8],
    ] as const) {
      drawTile4bpp(img, squareTiles, i * 2 + dt, palette!, x, y, false, false, true);
    }
    return img;
  });
  return { band, name, squares };
}

const SQUARE_SIZES = 9;

const div = (a: number, b: number) => Math.trunc(a / b);
// Interpolate in src/bmlib.c.
const cubic = (lo: number, hi: number, x: number, max: number) => lo + div(x * x * x * (hi - lo), max * max * max);
const rcubic = (lo: number, hi: number, x: number, max: number) => lo + (hi - lo) - div((max - x) ** 3 * (hi - lo), max * max * max);
const rsquare = (lo: number, hi: number, x: number, max: number) => lo + (hi - lo) - div((max - x) ** 2 * (hi - lo), max * max);

/** What the intro shows on one frame: the band's height as a share of its own, the name's x and opacity. */
export interface PhaseIntroFrame {
  readonly bandScale: number;
  readonly nameX: number | null;
  readonly nameOpacity: number;
}

/** The text and band start 6 frames in (PROC_SLEEP(0x06)) and the band is the last to finish. */
const START = 6;
export const PHASE_INTRO_FRAMES = START + 16 + 31 + 16;

/** The intro on `frame` (60 a second) from its start, or null once it's over. */
export function phaseIntroAt(frame: number): PhaseIntroFrame | null {
  const f = Math.floor(frame);
  if (f < START) return { bandScale: 0, nameX: null, nameOpacity: 0 };
  if (f >= PHASE_INTRO_FRAMES) return null;
  const k = f - START;
  // gProcScr_PhaseIntroUnk: 16 frames growing, 31 held, 16 shrinking; the sprite's height is scaled by val / 0x100.
  const val = k < 16 ? rsquare(0x10, 0x100, k, 15) : k < 47 ? 0x100 : cubic(0x100, 0x10, k - 47, 15);
  // gProcScr_PhaseIntroText: 16 frames in, 30 held, 16 out. The layer's x offset is the negative of
  // where the name shows, and its blend rises (and falls) by a sixteenth each frame.
  let nameX: number | null = null;
  let nameOpacity = 0;
  if (k < 16) {
    nameX = -rcubic(-0x1c, -8, 15 - k, 0x10);
    nameOpacity = (k + 1) / 16;
  } else if (k < 46) {
    nameX = 0x1c;
    nameOpacity = 1;
  } else if (k < 62) {
    nameX = -cubic(-0x38, -0x1c, 15 - (k - 46), 0x10);
    nameOpacity = (15 - (k - 46)) / 16;
  }
  return { bandScale: val / 0x100, nameX, nameOpacity };
}

/** The squares on one frame: each cell's size (index into PhaseBanner.squares) by row, and how they show. */
export interface PhaseSquaresFrame {
  /** 15 x 10 cells of 16 pixels, row by row. */
  readonly cells: Uint8Array;
  /** On the way out the squares are mirrored. */
  readonly mirrored: boolean;
  /** Their blend over the map, 0 to 7/16. */
  readonly opacity: number;
  /** The rows from `windowTop` up to `windowBottom` (pixels) don't show them. */
  readonly windowTop: number;
  readonly windowBottom: number;
}

const clamp16 = (v: number) => Math.max(0, Math.min(0x10, v));

/** The squares on `frame` from the intro's start, or null once they no longer show. They start with it. */
export function phaseSquaresAt(frame: number): PhaseSquaresFrame | null {
  const f = Math.floor(frame);
  // gProcScr_PhaseIntroBlendBox: in for 28 frames (timer 4 to 31), out for 33 (timer 32 down to 0),
  // its blend reaching 0 as it ends, before the squares do.
  if (f < 0 || f >= BLEND_IN + BLEND_OUT) return null;
  const blendTimer = f < BLEND_IN ? 4 + f : 0x20 - (f - BLEND_IN);
  const yoff = f < BLEND_IN ? rcubic(16, 60, blendTimer, 0x20) : rcubic(0, 60, blendTimer, 0x20);
  const blend = div(7 * blendTimer, 0x20);
  // gProcScr_PhaseIntroSquares: in for 30 frames (timer 4 to 33), out for 36 (timer 0 to 35), mirrored.
  const out = f >= SQUARES_IN;
  const timer = out ? f - SQUARES_IN : 4 + f;
  const cells = new Uint8Array(15 * 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 15; x++) {
      const val = out ? clamp16(1 - timer + (10 + x) + (10 - y)) & 0xfe : (0x10 - clamp16(x - timer + (0x15 - y))) & 0xfe;
      cells[y * 15 + x] = val / 2;
    }
  }
  return { cells, mirrored: out, opacity: blend / 16, windowTop: 8 + yoff, windowBottom: 160 - yoff };
}

const SQUARES_IN = 0x22 - 4;
const SQUARES_OUT = 0x24;
const BLEND_IN = 0x20 - 4;
const BLEND_OUT = 0x21;
