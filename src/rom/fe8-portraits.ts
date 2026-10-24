// FE8 US portraits: the 32 x 32 "chibi" face the game shows in its map windows (decision 35). From the
// fireemblem8u decompilation (src/portrait_data.c, src/face.c, include/types.h FaceData): a table of
// 0x1C-byte records at 0x8ACBE0, one per portrait id from 1 (GetPortraitData(fid) is entry fid - 1),
// each pointing at its chibi image (LZ77, 16 4bpp tiles laid out 4 x 4 in order) and its 16-colour
// palette. A character's portrait id is at +0x06 of its record.

import { createImage, drawTile4bpp, readPalettes, type Image } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_PORTRAIT_TABLE = 0x8acbe0;
export const PORTRAIT_STRIDE = 0x1c;
const CHIBI_POINTER = 0x04;
const PALETTE_POINTER = 0x08;
const CHIBI_TILES = 4;
const CHIBI_BYTES = CHIBI_TILES * CHIBI_TILES * 32;
/** The highest portrait id the table has (the decompilation lists 172 entries, ids 1 to 0xAC). */
const LAST_PORTRAIT = 0xac;

/** Portrait `id`'s chibi face, colour 0 transparent, or null if it has none or isn't readable. */
export function readChibi(rom: GbaRom, id: number): Image | null {
  if (id < 1 || id > LAST_PORTRAIT) return null;
  const record = FE8U_PORTRAIT_TABLE + (id - 1) * PORTRAIT_STRIDE;
  const chibi = rom.u32(record + CHIBI_POINTER);
  const palette = rom.u32(record + PALETTE_POINTER);
  if (!rom.isPointer(chibi) || !rom.isPointer(palette)) return null;
  let tiles: Uint8Array;
  try {
    tiles = decompressLz77(rom.bytes, rom.offsetOf(chibi));
  } catch {
    return null;
  }
  if (tiles.length < CHIBI_BYTES) return null;
  const [colours] = readPalettes(rom, rom.offsetOf(palette), 1);
  const image = createImage(CHIBI_TILES * 8, CHIBI_TILES * 8);
  for (let t = 0; t < CHIBI_TILES * CHIBI_TILES; t++) {
    drawTile4bpp(image, tiles, t, colours!, (t % CHIBI_TILES) * 8, Math.floor(t / CHIBI_TILES) * 8, false, false, true);
  }
  return image;
}
