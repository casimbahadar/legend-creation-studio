// FE8 US portraits: the 32 x 32 "chibi" face the game shows in its map windows, and the full face
// (decision 35). From the fireemblem8u decompilation (src/portrait_data.c, src/face.c,
// include/types.h FaceData): a table of 0x1C-byte records at 0x8ACBE0, one per portrait id from 1
// (GetPortraitData(fid) is entry fid - 1), each pointing at its face sheet (LZ77, 32 x 4 tiles), its
// chibi image (LZ77, 16 4bpp tiles laid out 4 x 4 in order) and its 16-colour palette. A character's
// portrait id is at +0x06 of its record.

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

const FACE_POINTER = 0x00;
/** The face sheet: 4 rows of 32 tiles, as Face_OnInit decompresses it into sprite memory. */
const SHEET_COLUMNS = 32;
const SHEET_ROWS = 4;
export const FACE_WIDTH = 96;
export const FACE_HEIGHT = 80;

/**
 * The pieces of a full face (gSprite_Face96x96): each takes `w` x `h` tiles from the sheet, from
 * column `col` and row `row`, and goes `x`, `y` pixels from the face's top centre.
 */
const FACE_PIECES: readonly { col: number; row: number; w: number; h: number; x: number; y: number }[] = [
  { col: 0, row: 0, w: 8, h: 4, x: -32, y: 0 },
  { col: 8, row: 0, w: 8, h: 4, x: -32, y: 32 },
  { col: 16, row: 0, w: 4, h: 2, x: -32, y: 64 },
  { col: 16, row: 2, w: 4, h: 2, x: 0, y: 64 },
  { col: 20, row: 0, w: 2, h: 4, x: -48, y: 48 },
  { col: 22, row: 0, w: 2, h: 4, x: 32, y: 48 },
];

/**
 * Portrait `id`'s full face, 96 x 80 with its top centre at (48, 0), colour 0 transparent, as the
 * game shows it when it doesn't blink or talk (the sheet's own eyes and mouth); null if it has none.
 */
export function readPortrait(rom: GbaRom, id: number): Image | null {
  if (id < 1 || id > LAST_PORTRAIT) return null;
  const record = FE8U_PORTRAIT_TABLE + (id - 1) * PORTRAIT_STRIDE;
  const face = rom.u32(record + FACE_POINTER);
  const palette = rom.u32(record + PALETTE_POINTER);
  if (!rom.isPointer(face) || !rom.isPointer(palette)) return null;
  let tiles: Uint8Array;
  try {
    tiles = decompressLz77(rom.bytes, rom.offsetOf(face));
  } catch {
    return null;
  }
  if (tiles.length < SHEET_COLUMNS * SHEET_ROWS * 32) return null;
  const [colours] = readPalettes(rom, rom.offsetOf(palette), 1);
  const image = createImage(FACE_WIDTH, FACE_HEIGHT);
  for (const p of FACE_PIECES) {
    for (let ty = 0; ty < p.h; ty++) {
      for (let tx = 0; tx < p.w; tx++) {
        const tile = (p.row + ty) * SHEET_COLUMNS + p.col + tx;
        drawTile4bpp(image, tiles, tile, colours!, FACE_WIDTH / 2 + p.x + tx * 8, p.y + ty * 8, false, false, true);
      }
    }
  }
  return image;
}

