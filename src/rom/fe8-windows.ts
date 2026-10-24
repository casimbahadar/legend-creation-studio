// FE8 US's window art, for drawing play's windows as the game does (decision 35). From the fireemblem8u
// decompilation:
// - src/uiutils.c, data/data_5B65C0.s: the map's background tiles start with gUiFrameImage (LZ77, 4bpp),
//   coloured by gUiFramePaletteA (window colour A, the default) in background palette 1. DrawUiFrame
//   lays a window of any size out of 16 model tiles; menus use model 0.
// - src/player_interface.c, data/data_A167C8.s: the map's unit window and goal window are fixed
//   tilemaps over those tiles (the unit window in its team's palette, the goal window in palette 1);
//   the interface tiles (labels, digits, HP bar) are loaded after them at tile 0x100.
// - asm/arm.s TmApplyTsa: a tilemap is a byte width - 1, a byte height - 1, then 16-bit entries row by
//   row from the bottom row up. An entry is a tile number (10 bits), horizontal and vertical flip, and
//   a palette (top 4 bits), and the caller adds a base to every entry.

import { createImage, drawTile4bpp, readPalettes, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_UI_FRAME_IMAGE = 0x5b65c0;
export const FE8U_UI_FRAME_PALETTE = 0x5b6bb4;
export const FE8U_INTERFACE_TILES = 0xa167c8;
/** The unit window's palettes: blue, red, green. */
export const FE8U_INTERFACE_PALETTES = 0xa1738c;
export const FE8U_UNIT_WINDOW_TILEMAP = 0xa17484;
export const FE8U_GOAL_ONE_LINE_TILEMAP = 0xa17744;
export const FE8U_GOAL_TWO_LINES_TILEMAP = 0xa176bc;

const INTERFACE_FIRST_TILE = 0x100;
const TILE_BYTES = 32;
/** The background palette the frame tiles use (BGPAL_WINDOW_FRAME) and the one the unit window is drawn in. */
export const FRAME_PALETTE = 1;
export const UNIT_WINDOW_PALETTE = 3;

export interface Tilemap {
  /** In tiles. */
  readonly width: number;
  readonly height: number;
  /** Entries row by row from the top. */
  readonly entries: Uint16Array;
}

export type Team = 'player' | 'enemy' | 'ally';

export interface WindowArt {
  /** 4bpp tiles from tile 0, the interface tiles from 0x100. */
  readonly tiles: Uint8Array;
  readonly framePalette: Palette;
  readonly teamPalettes: Readonly<Record<Team, Palette>>;
  readonly unitWindow: Tilemap;
  readonly goalOneLine: Tilemap;
  readonly goalTwoLines: Tilemap;
}

/** The tilemap at `at`, or null if it runs off the ROM. */
export function readTilemap(rom: GbaRom, at: number): Tilemap | null {
  if (at + 2 > rom.size) return null;
  const width = rom.u8(at) + 1;
  const height = rom.u8(at + 1) + 1;
  if (at + 2 + width * height * 2 > rom.size) return null;
  const entries = new Uint16Array(width * height);
  let src = at + 2;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++, src += 2) entries[y * width + x] = rom.u16(src);
  }
  return { width, height, entries };
}

/** FE8's window art, or null if it isn't readable. */
export function readWindowArt(rom: GbaRom): WindowArt | null {
  let frame: Uint8Array;
  let iface: Uint8Array;
  try {
    frame = decompressLz77(rom.bytes, FE8U_UI_FRAME_IMAGE);
    iface = decompressLz77(rom.bytes, FE8U_INTERFACE_TILES);
  } catch {
    return null;
  }
  if (frame.length > INTERFACE_FIRST_TILE * TILE_BYTES) return null;
  const tiles = new Uint8Array(INTERFACE_FIRST_TILE * TILE_BYTES + iface.length);
  tiles.set(frame);
  tiles.set(iface, INTERFACE_FIRST_TILE * TILE_BYTES);
  const unitWindow = readTilemap(rom, FE8U_UNIT_WINDOW_TILEMAP);
  const goalOneLine = readTilemap(rom, FE8U_GOAL_ONE_LINE_TILEMAP);
  const goalTwoLines = readTilemap(rom, FE8U_GOAL_TWO_LINES_TILEMAP);
  if (!unitWindow || !goalOneLine || !goalTwoLines) return null;
  const [framePalette] = readPalettes(rom, FE8U_UI_FRAME_PALETTE, 1);
  const [blue, red, green] = readPalettes(rom, FE8U_INTERFACE_PALETTES, 3);
  return {
    tiles,
    framePalette: framePalette!,
    teamPalettes: { player: blue!, enemy: red!, ally: green! },
    unitWindow,
    goalOneLine,
    goalTwoLines,
  };
}

/**
 * Model 0 of DrawUiFrame (gUnknown_080DA2F4), by position: top left 2 x 2 [0, 1 / 4, 5], top right 3,
 * bottom left 12, bottom right 15, top edge 2, bottom edge 13 and 14, left edge 8, right edge 7 and 11,
 * and the inside in 2 x 2 blocks [6, 6 / 9, 10].
 */
const FRAME_MODEL = [0x01, 0x02, 0x03, 0x05, 0x07, 0x08, 0x09, 0x0a, 0x06, 0x09, 0x09, 0x0a, 0x1a, 0x1b, 0x1b, 0x21];

/** A window `width` x `height` tiles laid out as DrawUiFrame lays it out, in palette 1. */
export function frameTilemap(width: number, height: number): Tilemap {
  const entries = new Uint16Array(width * height);
  const m = (i: number) => FRAME_MODEL[i]! | (FRAME_PALETTE << 12);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) entries[y * width + x] = v;
  };
  const xMax = width - 1;
  const yMax = height - 1;
  for (let y = 1; y < yMax; y += 2) {
    for (let x = 1; x < xMax; x += 2) {
      set(x, y, m(6));
      set(x + 1, y, m(6));
      set(x, y + 1, m(9));
      set(x + 1, y + 1, m(10));
    }
    set(0, y, m(8));
    set(xMax, y, m(7));
    set(0, y + 1, m(8));
    set(xMax, y + 1, m(11));
  }
  for (let x = 1; x < xMax; x += 2) {
    set(x, 0, m(2));
    set(x + 1, 0, m(2));
    set(x, yMax, m(13));
    set(x + 1, yMax, m(14));
  }
  set(0, 0, m(0));
  set(1, 0, m(1));
  set(0, 1, m(4));
  set(1, 1, m(5));
  set(xMax, 0, m(3));
  set(0, yMax, m(12));
  set(xMax, yMax, m(15));
  return { width, height, entries };
}

/**
 * `map` drawn with `palette` giving each background palette number, `paletteBase` added to every entry
 * as the game adds it. Colour 0 and tiles in a palette it doesn't give are left transparent.
 */
export function drawTilemap(tiles: Uint8Array, map: Tilemap, palette: (n: number) => Palette | undefined, paletteBase = 0): Image {
  const image = createImage(map.width * 8, map.height * 8);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const e = map.entries[y * map.width + x]!;
      const colours = palette(((e >> 12) + paletteBase) & 15);
      if (!colours) continue;
      drawTile4bpp(image, tiles, e & 0x3ff, colours, x * 8, y * 8, (e & 0x400) !== 0, (e & 0x800) !== 0, true);
    }
  }
  return image;
}

/** A window frame `width` x `height` tiles. */
export function drawFrame(art: WindowArt, width: number, height: number): Image {
  return drawTilemap(art.tiles, frameTilemap(width, height), (n) => (n === FRAME_PALETTE ? art.framePalette : undefined));
}

/** The top left of `map`, at most `width` x `height` tiles. */
export function clipTilemap(map: Tilemap, width: number, height: number): Tilemap {
  const w = Math.min(width, map.width);
  const h = Math.min(height, map.height);
  const entries = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) entries.set(map.entries.subarray(y * map.width, y * map.width + w), y * w);
  return { width: w, height: h, entries };
}

/** The map's unit window box in `team`'s colours: the 13 x 6 tiles the game copies to the screen (MMB_Loop_SlideIn). */
export function drawUnitWindow(art: WindowArt, team: Team): Image {
  return drawTilemap(art.tiles, clipTilemap(art.unitWindow, 13, 6), (n) => (n === UNIT_WINDOW_PALETTE ? art.teamPalettes[team] : undefined), UNIT_WINDOW_PALETTE);
}

/** The map's goal window box, for one line of text or two: at most the 12 x 6 tiles the game copies to the screen. */
export function drawGoalWindow(art: WindowArt, lines: 1 | 2): Image {
  const map = clipTilemap(lines === 1 ? art.goalOneLine : art.goalTwoLines, 12, 6);
  return drawTilemap(art.tiles, map, (n) => (n === FRAME_PALETTE ? art.framePalette : undefined), FRAME_PALETTE);
}

/** The smallest rectangle holding every visible pixel of `image`, or null if it has none. */
export function contentBounds(image: Image): { x: number; y: number; width: number; height: number } | null {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
