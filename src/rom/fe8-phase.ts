// FE8 US's phase intro ("Player Phase" and the rest), for drawing play's phase banners as the game does
// (decision 35). From the fireemblem8u decompilation (src/phasechangefx.c, data/data_59E8E0.s):
// - a band 240 x 32 pixels (Img_PhaseChangeUnk, LZ77, sprite tiles 32 to a row) put at y 68, its height
//   growing from nothing, held, and shrinking again, in the phase's palette;
// - the phase's name (Img_PhaseChangePlayer, Enemy or Other, LZ77, 32 x 3 tiles in order) on a
//   background layer at y 72, sliding right as it fades in, held, and sliding on as it fades out.
// The squares that sweep across the map behind them aren't drawn here.

import { createImage, drawTile4bpp, readPalettes, type Image } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';
import type { Team } from './fe8-windows';

export const FE8U_PHASE_BAND = 0x59f020;
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
}

/** `team`'s phase banner, colour 0 transparent, or null if it isn't readable. */
export function readPhaseBanner(rom: GbaRom, team: Team): PhaseBanner | null {
  let bandTiles: Uint8Array;
  let nameTiles: Uint8Array;
  try {
    bandTiles = decompressLz77(rom.bytes, FE8U_PHASE_BAND);
    nameTiles = decompressLz77(rom.bytes, FE8U_PHASE_NAMES[team]);
  } catch {
    return null;
  }
  if (bandTiles.length === 0 || nameTiles.length === 0) return null;
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
  return { band, name };
}

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
