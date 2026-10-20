// FE8 US chapter maps: layout, tileset and terrain from a clean ROM.
// Ported from Endless Chronicle (index.html, Game().maps, tileset and mapCanvas). EC finds these tables
// by their shape for other games and hacks; for the clean FE8 US ROM it uses the fixed addresses below.

import { createImage, drawTile4bpp, readPalettes, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

const CHAPTER_TABLE = 0x8b0894;
const CHAPTER_STRIDE = 0x94;
const MAP_ASSET_TABLE = 0x8b363c;
/** EC scans this many chapter entries; invalid ones are skipped. */
const MAX_CHAPTER_ENTRIES = 0x90;
/** A tile config holds 1024 metatiles of 4 tile entries (8 bytes each), then one terrain byte per metatile. */
const METATILE_BYTES = 0x2000;
const MIN_CONFIG_BYTES = 0x2400;

export interface Tileset {
  /** 4bpp tile graphics: object set 1 followed by object set 2. */
  readonly tiles: Uint8Array;
  /** Metatile definitions (first 0x2000 bytes) and terrain ids (from 0x2000). */
  readonly config: Uint8Array;
  readonly palettes: Palette[];
}

export interface ChapterMap {
  /** Index of the first chapter-table entry that uses this map. */
  readonly chapter: number;
  /** Size in 16x16 metatiles. */
  readonly width: number;
  readonly height: number;
  /** Metatile id per cell, row by row. */
  readonly cells: Uint16Array;
  /** Terrain id per cell, row by row. */
  readonly terrain: Uint8Array;
  readonly tileset: Tileset;
}

function asset(rom: GbaRom, index: number): Uint8Array {
  return decompressLz77(rom.bytes, rom.offsetOf(rom.u32(MAP_ASSET_TABLE + index * 4)));
}

/** Reads one chapter-table entry's map, or null if the entry does not hold a valid map. */
export function readChapterMap(rom: GbaRom, chapter: number): ChapterMap | null {
  const p = CHAPTER_TABLE + chapter * CHAPTER_STRIDE;
  try {
    const [obj1, obj2, palette, config, main] = [0, 1, 2, 3, 4].map((k) => rom.u8(p + k)) as [number, number, number, number, number];
    const layer = asset(rom, main);
    const width = layer[0]!;
    const height = layer[1]!;
    if (layer.length !== 2 + width * height * 2 || width < 15 || height < 10 || width > 64 || height > 64) return null;
    const conf = asset(rom, config);
    if (conf.length < MIN_CONFIG_BYTES) return null;
    const t1 = asset(rom, obj1);
    const t2 = obj2 ? asset(rom, obj2) : new Uint8Array();
    const tiles = new Uint8Array(t1.length + t2.length);
    tiles.set(t1);
    tiles.set(t2, t1.length);
    const palettes = readPalettes(rom, rom.offsetOf(rom.u32(MAP_ASSET_TABLE + palette * 4)), 16);

    const cells = new Uint16Array(width * height);
    const terrain = new Uint8Array(width * height);
    for (let i = 0; i < cells.length; i++) {
      const c = (layer[2 + i * 2]! | (layer[3 + i * 2]! << 8)) >> 2;
      cells[i] = c;
      terrain[i] = conf[METATILE_BYTES + c] ?? 0;
    }
    return { chapter, width, height, cells, terrain, tileset: { tiles, config: conf, palettes } };
  } catch {
    return null; // not a map entry
  }
}

/** Every distinct map in the chapter table, in table order. Chapters that reuse a layout are listed once. */
export function readAllChapterMaps(rom: GbaRom): ChapterMap[] {
  const out: ChapterMap[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < MAX_CHAPTER_ENTRIES; k++) {
    const map = readChapterMap(rom, k);
    if (!map) continue;
    const key = `${map.width}x${map.height}:${map.cells.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(map);
  }
  return out;
}

/** Draws a map at 1:1, 16x16 pixels per metatile. */
export function renderMap(map: Pick<ChapterMap, 'width' | 'height' | 'cells' | 'tileset'>): Image {
  const image = createImage(map.width * 16, map.height * 16);
  const { tiles, config, palettes } = map.tileset;
  for (let i = 0; i < map.cells.length; i++) {
    const mt = map.cells[i]!;
    if (mt * 8 + 8 > METATILE_BYTES) continue;
    const ox = (i % map.width) * 16;
    const oy = Math.floor(i / map.width) * 16;
    for (let q = 0; q < 4; q++) {
      const e = config[mt * 8 + q * 2]! | (config[mt * 8 + q * 2 + 1]! << 8);
      const palette = palettes[e >> 12];
      if (!palette) continue;
      drawTile4bpp(image, tiles, e & 0x3ff, palette, ox + (q & 1) * 8, oy + (q >> 1) * 8, ((e >> 10) & 1) === 1, ((e >> 11) & 1) === 1);
    }
  }
  return image;
}
