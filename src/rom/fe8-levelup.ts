// FE8 US's level-up screen on the map (decision 35), from the fireemblem8u decompilation
// (src/mapanim_lvup.c, src/mapanim_lvupfx.c, data/data-banimmisc.s): a box (Img_LevelUpBoxFrame, LZ77
// tiles, and Tsa_LevelUpBoxFrame, an LZ77 tilemap of entries 32 to a row from the top, laid out as 32 x 28, in
// Pal_LevelUpBoxFrame) that scrolls up from the bottom of the screen with the class name, the level and
// the stats written on it, the portrait at its right, and a label for each gain.

import { drawTilemap } from './fe8-windows';
import { readPalettes, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_LEVEL_UP_BOX_TILES = 0x8035b0;
export const FE8U_LEVEL_UP_BOX_TILEMAP = 0x8039e8;
export const FE8U_LEVEL_UP_BOX_PALETTE = 0x803b10;

const MAP_WIDTH = 32;
const MAP_HEIGHT = 28;
/** The screen shows 30 of the box's 32 tile columns. */
export const LEVEL_UP_BOX_WIDTH = 240;
export const LEVEL_UP_BOX_HEIGHT = MAP_HEIGHT * 8;

/** The level-up box as the screen shows it, 240 x 224 pixels, or null if it isn't readable. */
export function readLevelUpBox(rom: GbaRom): Image | null {
  let tiles: Uint8Array;
  let map: Uint8Array;
  try {
    tiles = decompressLz77(rom.bytes, FE8U_LEVEL_UP_BOX_TILES);
    map = decompressLz77(rom.bytes, FE8U_LEVEL_UP_BOX_TILEMAP);
  } catch {
    return null;
  }
  // PutTmLinear copies 32 x 28 entries, but the tilemap holds fewer (15 rows on the clean ROM): the rest
  // is what the buffer held, here entry 0, the box's first tile.
  if (!tiles.length || map.length < MAP_WIDTH * 2) return null;
  const entries = new Uint16Array(LEVEL_UP_BOX_WIDTH / 8 * MAP_HEIGHT);
  const w = LEVEL_UP_BOX_WIDTH / 8;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < w; x++) entries[y * w + x] = (map[(y * MAP_WIDTH + x) * 2] ?? 0) | ((map[(y * MAP_WIDTH + x) * 2 + 1] ?? 0) << 8);
  }
  const [palette] = readPalettes(rom, FE8U_LEVEL_UP_BOX_PALETTE, 1);
  // PutTmLinear adds the tiles' place in VRAM (tile 0x200) and the palette; the entries count from 0.
  return palette ? drawTilemap(tiles, { width: w, height: MAP_HEIGHT, entries }, () => palette) : null;
}

export type LevelUpStat = 'level' | 'hp' | 'str' | 'skl' | 'spd' | 'lck' | 'def' | 'res' | 'con';

/**
 * Where each stat sits on the box (gManimLevelUpLabelInfoList), in tiles from the box's (1, 1): its
 * label, centred in 3 tiles, in gold; its value in blue, the last digit 4 tiles on. In FE8's order,
 * which is also the order the gain labels appear in.
 */
export const LEVEL_UP_LAYOUT: readonly { readonly stat: LevelUpStat; readonly x: number; readonly y: number; readonly label: string; readonly magic?: string }[] = [
  { stat: 'level', x: 9, y: 0, label: 'Lv' },
  { stat: 'hp', x: 1, y: 4, label: 'HP' },
  { stat: 'str', x: 1, y: 6, label: 'Str', magic: 'Mag' },
  { stat: 'skl', x: 1, y: 8, label: 'Skl' },
  { stat: 'spd', x: 1, y: 10, label: 'Spd' },
  { stat: 'lck', x: 9, y: 4, label: 'Lck' },
  { stat: 'def', x: 9, y: 6, label: 'Def' },
  { stat: 'res', x: 9, y: 8, label: 'Res' },
  { stat: 'con', x: 9, y: 10, label: 'Con' },
];

/** "LEVEL UP" over the unit (ManimLevelUp_StartLevelUpText): its AP, its tiles (LZ77) and 3 palettes. */
export const FE8U_LEVEL_UP_TEXT_AP = 0x9a5a6c;
export const FE8U_LEVEL_UP_TEXT_TILES = 0x9ac794;
export const FE8U_LEVEL_UP_PALETTES = 0x9ac9a8;
/** The gain labels (StartManimLevelUpStatGainLabelAnim): AP, tiles (LZ77), digits and cycling colours. */
export const FE8U_STAT_GAIN_AP = 0x9a5314;
export const FE8U_STAT_GAIN_TILES = 0x9aca08;
export const FE8U_STAT_GAIN_DIGITS = 0x9acc98;
export const FE8U_STAT_GAIN_CYCLING = 0x9ac5cc;

/** Where the game loads them in sprite memory, and the palette it puts them in. */
export const LEVEL_UP_TEXT_TILE = 0x1c0;
export const STAT_GAIN_TILE = 0x200;
export const LEVEL_UP_SPRITE_PALETTE = 3;

const DIGIT_TILES = 64;
const CYCLING_COLOURS = 0x1c8 / 2;

export interface LevelUpSprites {
  /** "LEVEL UP"'s tiles, from sprite tile LEVEL_UP_TEXT_TILE. */
  readonly text: Uint8Array;
  /** The gain labels' tiles, from sprite tile STAT_GAIN_TILE. */
  readonly gain: Uint8Array;
  /** The gain digits, 32 tiles to a row: a digit's top half in the first row, its bottom in the second. */
  readonly digits: Uint8Array;
  /** Pal_ManimLevelUp's 3 palettes, for sprite palettes 3 to 5. */
  readonly palettes: readonly Palette[];
  /** The colours the gain labels cycle through (Pal_ManimLevelUpStatGainCycling). */
  readonly cycling: Palette;
}

/** The level-up's sprites, or null if they aren't readable. */
export function readLevelUpSprites(rom: GbaRom): LevelUpSprites | null {
  let text: Uint8Array;
  let gain: Uint8Array;
  try {
    text = decompressLz77(rom.bytes, FE8U_LEVEL_UP_TEXT_TILES);
    gain = decompressLz77(rom.bytes, FE8U_STAT_GAIN_TILES);
  } catch {
    return null;
  }
  if (!text.length || !gain.length || FE8U_STAT_GAIN_DIGITS + DIGIT_TILES * 32 > rom.size) return null;
  const digits = rom.bytes.slice(FE8U_STAT_GAIN_DIGITS, FE8U_STAT_GAIN_DIGITS + DIGIT_TILES * 32);
  const palettes = readPalettes(rom, FE8U_LEVEL_UP_PALETTES, 3);
  const cycling = readPalettes(rom, FE8U_STAT_GAIN_CYCLING, Math.ceil(CYCLING_COLOURS / 16)).flat().slice(0, CYCLING_COLOURS);
  return { text, gain, digits, palettes, cycling };
}

/**
 * The gain labels' tiles for the stat `stat` (1 to 8 in LEVEL_UP_LAYOUT's order) gaining `gain`: the
 * gain's digit copied into that stat's two tiles, as StartManimLevelUpStatGainLabelAnim copies it.
 */
export function statGainTiles(sprites: LevelUpSprites, stat: number, gain: number): Uint8Array {
  const tiles = sprites.gain.slice();
  const own = (stat - 1) * 2;
  const n = Math.min(9, Math.abs(gain));
  for (const [from, to] of [
    [n, own + 0x2d],
    [n + 0x20, own + 0x4d],
  ] as const) {
    if ((to + 1) * 32 <= tiles.length) tiles.set(sprites.digits.subarray(from * 32, from * 32 + 32), to * 32);
  }
  return tiles;
}

/**
 * The gain labels' palettes `clock` frames after the labels began (ManimLevelUpLabelColor_Loop): every
 * 4 frames colours 9 to 15 of palettes 3 and 4 move on through the cycling colours, 16 steps around.
 */
export function statGainPalettes(sprites: LevelUpSprites, clock: number): (n: number) => Palette | undefined {
  const base = sprites.palettes[0];
  if (!base) return () => undefined;
  const step = Math.floor(clock / 4);
  const cycled = (from: number): Palette =>
    step < 1 ? base : base.map((c, i) => (i >= 9 ? (sprites.cycling[from + (step & 15) + i - 9] ?? c) : c));
  const p3 = cycled(0);
  const p4 = cycled(0x20);
  return (n) => (n === LEVEL_UP_SPRITE_PALETTE ? p3 : n === LEVEL_UP_SPRITE_PALETTE + 1 ? p4 : undefined);
}

