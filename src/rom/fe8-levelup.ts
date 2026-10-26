// FE8 US's level-up screen on the map (decision 35), from the fireemblem8u decompilation
// (src/mapanim_lvup.c, src/mapanim_lvupfx.c, data/data-banimmisc.s): a box (Img_LevelUpBoxFrame, LZ77
// tiles, and Tsa_LevelUpBoxFrame, an LZ77 tilemap of 32 x 28 entries row by row from the top, in
// Pal_LevelUpBoxFrame) that scrolls up from the bottom of the screen with the class name, the level and
// the stats written on it, the portrait at its right, and a label for each gain.

import { drawTilemap } from './fe8-windows';
import { readPalettes, type Image } from './gba-graphics';
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
  if (!tiles.length || map.length < MAP_WIDTH * MAP_HEIGHT * 2) return null;
  const entries = new Uint16Array(LEVEL_UP_BOX_WIDTH / 8 * MAP_HEIGHT);
  const w = LEVEL_UP_BOX_WIDTH / 8;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < w; x++) entries[y * w + x] = map[(y * MAP_WIDTH + x) * 2]! | (map[(y * MAP_WIDTH + x) * 2 + 1]! << 8);
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
