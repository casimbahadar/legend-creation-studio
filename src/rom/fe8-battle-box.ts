// FE8 US's HP boxes for a battle on the map (decision 35), from the fireemblem8u decompilation
// (src/mapanim_infobox.c, src/mapanim.c MapAnim_InitInfoBox, src/mapanim_scanline.c,
// data/data_9A31F8.s, data/data_A195B0.s):
// - BG1: each unit's box (Img_MapBattleInfoBox, LZ77, loaded from tile 1) laid out by its tilemap
//   (LZ77: Tsa_MapBattleBoxGfx1 for one unit; Gfx3 for the first of two, Gfx2 for the second), the
//   first unit's in BG palette 1 and the second's in 2, each its team's (Pal_MapBattleInfoBlue, Red,
//   Green). The second is laid out after the first, over it where they meet.
// - Colour 1 of both palettes is shaded line by line (StartManimFrameGradientScanlineEffect): its own
//   at the boxes' top, halved 32 lines down and below.
// - BG0: each box's name centred in 9 tiles from tile (2, 1); its HP in 3 tiles ending at tile (3, 3)
//   in Img_MapBattleInfoNum's digits (LZ77, loaded at tile 0x20), two of the 11th tile from 100 on; and
//   its HP bar, 7 tiles from tile (4, 3) (Img_MapBattleInfoHpBar, LZ77, loaded at tile 43), all in
//   Pal_MapBattleInfoNum.
// - The boxes sit at tile 15 across less 5 for one unit, 1 and 11 for the first and second of two, on a
//   row chosen from where the units are; they open from their third row out, and the HP shown runs to
//   the HP left a point a frame down and a quarter point a frame up.

import { bgr555ToRgb, createImage, readPalettes, type Image, type Palette, type Rgb } from './gba-graphics';
import { readRom, type GbaRom } from './gba-rom';
import { fillLevels } from './fe8-expbar';
import { readTilemap, type Team, type Tilemap } from './fe8-windows';
import { decompressLz77 } from './lz77';

export const FE8U_BATTLE_BOX_TILES = 0x9ad500;
/** Pal_MapBattleInfoBlue, then Red and Green, 0x20 bytes apart. */
export const FE8U_BATTLE_BOX_PALETTES = 0x9ad648;
export const FE8U_BATTLE_BOX_ONE = 0x9ad6c8;
export const FE8U_BATTLE_BOX_SECOND = 0x9ad714;
export const FE8U_BATTLE_BOX_FIRST = 0x9ad74c;
export const FE8U_BATTLE_BOX_BAR = 0x9ad78c;
export const FE8U_BATTLE_BOX_DIGITS = 0x9ad868;
export const FE8U_BATTLE_BOX_DIGIT_PALETTE = 0xa1d79c;

const TILE_BYTES = 32;
/** BG0's tiles as the box loads them: the digits from 0x20, the bar from 43, up to 64 tiles. */
const DIGITS = 0x20;
const BAR = 43;
const NUMBER_TILES = 64;
const NUMBER_PALETTE = 5;
/** The bar (gUnknown_089A3648): a left end over 5 steps from tile 0x2B, 5 middles over 8 from 0x31 and a right end over 5 from 0x3A. */
const HP_BAR: readonly (readonly [number, number])[] = [[5, 0x2b], ...Array.from({ length: 5 }, () => [8, 0x31] as const), [5, 0x3a]];
/** Lines from the boxes' top to where colour 1 is halved. */
const SHADE_LINES = 32;
/** The first frame the boxes show, and the first they're whole and their HP starts moving. */
const OPEN_FROM = 2;
const OPEN_UNTIL = 9;

export interface BattleBoxArt {
  /** BG1's tiles: the box's from tile 1. */
  readonly tiles: Uint8Array;
  /** BG0's tiles: the digits and the bar. */
  readonly numbers: Uint8Array;
  readonly teams: Readonly<Record<Team, Palette>>;
  readonly numberPalette: Palette;
  readonly one: Tilemap;
  readonly first: Tilemap;
  readonly second: Tilemap;
}

/** The boxes' art, or null if it isn't readable. */
export function readBattleBoxArt(rom: GbaRom): BattleBoxArt | null {
  const lz = (at: number) => {
    try {
      return decompressLz77(rom.bytes, at);
    } catch {
      return null;
    }
  };
  const box = lz(FE8U_BATTLE_BOX_TILES);
  const digits = lz(FE8U_BATTLE_BOX_DIGITS);
  const bar = lz(FE8U_BATTLE_BOX_BAR);
  const map = (at: number) => {
    const bytes = lz(at);
    return bytes && bytes.length >= 2 ? readTilemap(readRom(bytes), 0) : null;
  };
  const one = map(FE8U_BATTLE_BOX_ONE);
  const first = map(FE8U_BATTLE_BOX_FIRST);
  const second = map(FE8U_BATTLE_BOX_SECOND);
  if (!box?.length || !digits?.length || !bar?.length || !one || !first || !second) return null;
  if (FE8U_BATTLE_BOX_DIGIT_PALETTE + 0x20 > rom.size) return null;
  const tiles = new Uint8Array(TILE_BYTES + box.length);
  tiles.set(box, TILE_BYTES);
  // As the game loads them, the bar after the digits, over any that run past tile 43.
  const numbers = new Uint8Array(NUMBER_TILES * TILE_BYTES);
  numbers.set(digits.subarray(0, (NUMBER_TILES - DIGITS) * TILE_BYTES), DIGITS * TILE_BYTES);
  numbers.set(bar.subarray(0, (NUMBER_TILES - BAR) * TILE_BYTES), BAR * TILE_BYTES);
  const [player, enemy, ally] = readPalettes(rom, FE8U_BATTLE_BOX_PALETTES, 3);
  const [numberPalette] = readPalettes(rom, FE8U_BATTLE_BOX_DIGIT_PALETTE, 1);
  return { tiles, numbers, teams: { player: player!, enemy: enemy!, ally: ally! }, numberPalette: numberPalette!, one, first, second };
}

/** The tile column of each box with `count` units, `centre` tiles across (15, the screen's middle). */
export function battleBoxColumns(count: 1 | 2, centre = 15): number[] {
  return count === 1 ? [centre - 5] : [centre - 1, centre - 11];
}

/**
 * The boxes' tile row (MapAnim_InitInfoBox) from the top of each unit's square on the screen, in
 * pixels, the attacker's first: for one unit, 24 below it, or 40 above if it's in the bottom 48
 * pixels; for two, row 8 if they're 80 or more apart, else 24 below the lower, or 40 above the higher
 * if the lower is in the bottom 48.
 */
export function battleBoxRow(ys: readonly number[]): number {
  let y: number;
  if (ys.length === 1) y = ys[0]! >= 112 ? ys[0]! - 40 : ys[0]! + 24;
  else {
    const [a, b] = [ys[0]!, ys[1]!];
    if (Math.abs(a - b) >= 80) y = 64;
    else {
      const lower = a > b ? 0 : 1;
      y = ys[lower]! >= 112 ? ys[1 - lower]! - 40 : ys[lower]! + 24;
    }
  }
  return Math.max(0, Math.trunc(y / 8));
}

/** Colour 1 on line `line` of the boxes (PrepareGradientScanlineBuf): from `c` at the top to half of it 32 lines down. */
export function shadeLine(c: Rgb, line: number): Rgb {
  const raw = (c[0] >> 3) | ((c[1] >> 3) << 5) | ((c[2] >> 3) << 10);
  let out = 0;
  for (const mask of [0x1f, 0x3e0, 0x7c00]) {
    const lo = raw & mask;
    const hi = ((raw & mask) >> 1) & mask;
    const t = Math.max(0, Math.min(SHADE_LINES, line));
    out |= (lo + Math.trunc(((hi - lo) * t) / SHADE_LINES)) & mask;
  }
  return bgr555ToRgb(out);
}

/** The HP shown a frame later (sub_807BCA8), in sixteenths of a point, as `hp` is left. */
export function stepShownHp(shown: number, hp: number): number {
  let r = shown;
  if (r > hp * 16) r -= 16;
  if (r < hp * 16) r += 4;
  return r;
}

/** Whether the HP shown moves on `frame` frames after the battle starts: once the boxes are whole. */
export const shownHpMoves = (frame: number) => frame >= OPEN_UNTIL;

/**
 * How the boxes show `frame` frames after the battle starts (MapInfoBoxShake): 'hidden', 'whole', or
 * how many lines show either side of the boxes' third row, 2 more a frame.
 */
export function battleBoxOpening(frame: number): 'hidden' | 'whole' | number {
  const f = Math.floor(frame);
  if (f < OPEN_FROM) return 'hidden';
  if (f >= OPEN_UNTIL) return 'whole';
  return 2 * (f - 1);
}

export interface BattleBoxUnit {
  readonly team: Team;
  /** The HP shown, a whole number. */
  readonly hp: number;
  readonly maxHp: number;
}

/** A 4bpp tile's pixel, 0 for transparent, through the entry's flips. */
function texel(tiles: Uint8Array, e: number, x: number, y: number): number {
  const u = e & 0x400 ? 7 - x : x;
  const v = e & 0x800 ? 7 - y : y;
  const byte = tiles[(e & 0x3ff) * TILE_BYTES + v * 4 + (u >> 1)] ?? 0;
  return u & 1 ? byte >> 4 : byte & 15;
}

/**
 * The boxes for one unit or two (the attacker first), on a strip `centre` x 2 tiles across from the
 * boxes' row, as tall as the tallest box; the names are left to the caller (at `battleBoxColumns` + 2,
 * row 1, 9 tiles wide).
 */
export function drawBattleBoxes(art: BattleBoxArt, units: readonly BattleBoxUnit[], centre = 15): Image {
  const count = units.length === 1 ? 1 : 2;
  const maps = count === 1 ? [art.one] : [art.first, art.second];
  const columns = battleBoxColumns(count, centre);
  const w = centre * 2;
  const h = Math.max(4, ...maps.map((m) => m.height));
  const bg1 = new Uint16Array(w * h);
  const bg0 = new Uint16Array(w * h);
  const put = (layer: Uint16Array, x: number, y: number, e: number) => {
    if (x >= 0 && x < w && y >= 0 && y < h) layer[y * w + x] = e & 0xffff;
  };
  const number = (tile: number) => tile | (NUMBER_PALETTE << 12);
  units.slice(0, count).forEach((u, i) => {
    const map = maps[i]!;
    const x0 = columns[i]!;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) put(bg1, x0 + x, y, map.entries[y * map.width + x]! + 1 + ((1 + i) << 12));
    // sub_807BA28: three tiles cleared, then the number ending at column 3, or two of the 11th tile from 100.
    const hp = Math.max(0, Math.trunc(u.hp));
    for (let x = 1; x <= 3; x++) put(bg0, x0 + x, 3, 0);
    if (hp >= 100) {
      put(bg0, x0 + 3, 3, number(DIGITS + 10));
      put(bg0, x0 + 2, 3, number(DIGITS + 10));
    } else {
      put(bg0, x0 + 3, 3, number(DIGITS + (hp % 10)));
      if (hp >= 10) put(bg0, x0 + 2, 3, number(DIGITS + Math.trunc(hp / 10)));
    }
    fillLevels(HP_BAR, Math.min(hp, u.maxHp), u.maxHp).forEach((level, j) => put(bg0, x0 + 4 + j, 3, number(HP_BAR[j]![1] + level)));
  });
  const palettes = units.slice(0, count).map((u) => art.teams[u.team]);
  const image = createImage(w * 8, h * 8);
  for (let py = 0; py < h * 8; py++) {
    const shaded = palettes.map((p) => shadeLine(p[1]!, py));
    for (let px = 0; px < w * 8; px++) {
      const at = (py >> 3) * w + (px >> 3);
      let rgb: Rgb | undefined;
      const top = bg0[at]!;
      const c0 = top ? texel(art.numbers, top, px & 7, py & 7) : 0;
      if (c0 && (top >> 12) === NUMBER_PALETTE) rgb = art.numberPalette[c0];
      else {
        const e = bg1[at]!;
        const p = ((e >> 12) & 15) - 1;
        const c = e ? texel(art.tiles, e, px & 7, py & 7) : 0;
        if (c && palettes[p]) rgb = c === 1 ? shaded[p] : palettes[p]![c];
      }
      if (!rgb) continue;
      const o = (py * image.width + px) * 4;
      image.rgba[o] = rgb[0];
      image.rgba[o + 1] = rgb[1];
      image.rgba[o + 2] = rgb[2];
      image.rgba[o + 3] = 255;
    }
  }
  return image;
}
