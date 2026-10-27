// FE8 US's Game Over screen (decision 35), from the fireemblem8u decompilation (src/gameoverbgfx.c,
// src/chapterintrofx.c PutScreenFogEffect and PutScreenFogEffectOverlayed, asm/arm.s ColorFadeTick):
// - BG0: "GAME OVER" (Img_GameOverText, LZ77) laid out by Tsa_GameOverFx at tile (7, 9), in palette 0
//   (Pal_GameOverText2), whose first colour is also the backdrop.
// - BG2 and BG3: fog (Img_ChapterIntroFog, LZ77, 32 x 8 tiles) in palette 4 (Pal_GameOverText1), BG3
//   repeating its left half over rows 0-7 and 16-23 and its right half over 8-15 and 24-31, BG2 the
//   same mirrored; each drifts by its own steps in 256ths of a pixel a frame.
// - BG2 is blended over BG3 with both weights set each line (GameOverScreenHBlank): 0 at the top and
//   bottom of the screen, rising by a sixteenth every 3 lines to full in the middle.
// - The palettes fade in from black (ColorFadeTick: each tick brings every channel a step nearer, a
//   channel showing its value less the ticks still to come): 10 ticks at once, then one every 8 frames;
//   leaving fades them out a tick a frame.

import { readTilemap, type Tilemap } from './fe8-windows';
import { createImage, readPalettes, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';
import { decompressLz77 } from './lz77';

export const FE8U_GAME_OVER_TEXT = 0xa0ab0c;
export const FE8U_GAME_OVER_PALETTE_TEXT = 0xa0ae44;
export const FE8U_GAME_OVER_PALETTE_FOG = 0xa0ae64;
export const FE8U_GAME_OVER_TILEMAP = 0xa0ae84;
export const FE8U_CHAPTER_INTRO_FOG = 0xa07dd8;

const SCREEN_W = 240;
const SCREEN_H = 160;
const TEXT_X = 7 * 8;
const TEXT_Y = 9 * 8;
const FOG_TILES = 32 * 8;
const FADE_TICKS = 32;
/** How long the screen waits for a button before leaving by itself (GameOverScreen_BeginIdle). */
export const GAME_OVER_IDLE_FRAMES = 1500;

export interface GameOverArt {
  readonly text: Uint8Array;
  readonly textMap: Tilemap;
  readonly fog: Uint8Array;
  /** Pal_GameOverText2 (the text, BG palette 0) and Pal_GameOverText1 (the fog, BG palette 4). */
  readonly textPalette: Palette;
  readonly fogPalette: Palette;
}

/** The Game Over screen's art, or null if it isn't readable. */
export function readGameOverArt(rom: GbaRom): GameOverArt | null {
  let text: Uint8Array;
  let fog: Uint8Array;
  try {
    text = decompressLz77(rom.bytes, FE8U_GAME_OVER_TEXT);
    fog = decompressLz77(rom.bytes, FE8U_CHAPTER_INTRO_FOG);
  } catch {
    return null;
  }
  const textMap = readTilemap(rom, FE8U_GAME_OVER_TILEMAP);
  if (!text.length || fog.length < FOG_TILES * 32 || !textMap) return null;
  const [textPalette] = readPalettes(rom, FE8U_GAME_OVER_PALETTE_TEXT, 1);
  const [fogPalette] = readPalettes(rom, FE8U_GAME_OVER_PALETTE_FOG, 1);
  return textPalette && fogPalette ? { text, textMap, fog, textPalette, fogPalette } : null;
}

/** A 4bpp tile's pixel, 0 for transparent. */
function texel(tiles: Uint8Array, tile: number, x: number, y: number): number {
  const byte = tiles[tile * 32 + y * 4 + (x >> 1)] ?? 0;
  return x & 1 ? byte >> 4 : byte & 15;
}

/** The fog's colour index at (x, y) of a 256 x 256 background, mirrored for BG2. */
function fogAt(fog: Uint8Array, x: number, y: number, mirrored: boolean): number {
  const tx = (x >> 3) & 31;
  const ty = (y >> 3) & 31;
  // Rows 0-7 and 16-23 take the sheet's left 16 tiles, 8-15 and 24-31 its right 16, 32 tiles to a row.
  const col = mirrored ? 15 - (tx & 15) : tx & 15;
  const tile = (ty & 7) * 32 + ((ty >> 3) & 1) * 16 + col;
  const px = mirrored ? 7 - (x & 7) : x & 7;
  return texel(fog, tile, px, y & 7);
}

/**
 * How many fade ticks have run `frame` frames after the screen began (`leaving`: frames since a button
 * or the wait ended): 32 is fully shown, 0 black.
 */
export function gameOverFade(frame: number, leaving: number | null): number {
  // The game ticks when its clock is a multiple of 8, wherever that falls; here every 8th frame.
  const shown = Math.min(FADE_TICKS, 10 + Math.floor(frame / 8));
  return leaving === null ? shown : Math.max(0, shown - leaving);
}

/** A palette colour with `ticks` of 32 fade ticks run. */
const faded = (c: readonly [number, number, number], ticks: number): [number, number, number] =>
  c.map((v) => Math.max(0, (v >> 3) - (FADE_TICKS - ticks))) as [number, number, number];

/** The 240 x 160 screen `frame` frames in, with `ticks` fade ticks run (gameOverFade). */
export function drawGameOver(art: GameOverArt, frame: number, ticks: number): Image {
  const image = createImage(SCREEN_W, SCREEN_H);
  const text = art.textPalette.map((c) => faded(c, ticks));
  const fog = art.fogPalette.map((c) => faded(c, ticks));
  // GameOverScreen_RandomScroll: 16-bit positions in 256ths of a pixel, the background offset by
  // (-position) >> 8.
  const s16 = (v: number) => (((v + 0x8000) & 0xffff) - 0x8000);
  const offset = (start: number, step: number) => -s16(start + step * frame) >> 8;
  const bg2x = offset(1234, 46);
  const bg2y = offset(5678, -90);
  const bg3x = offset(6346, -16);
  const bg3y = offset(8536, -53);
  for (let y = 0; y < SCREEN_H; y++) {
    const fromEdge = y > SCREEN_H / 2 ? SCREEN_H - y : y;
    const weight = Math.min(16, Math.floor(fromEdge / 3));
    for (let x = 0; x < SCREEN_W; x++) {
      let rgb: readonly number[] = text[0]!;
      const tx = x - TEXT_X;
      const ty = y - TEXT_Y;
      let c = 0;
      if (tx >= 0 && ty >= 0 && tx < art.textMap.width * 8 && ty < art.textMap.height * 8) {
        const e = art.textMap.entries[(ty >> 3) * art.textMap.width + (tx >> 3)]!;
        const u = e & 0x400 ? 7 - (tx & 7) : tx & 7;
        const v = e & 0x800 ? 7 - (ty & 7) : ty & 7;
        c = texel(art.text, e & 0x3ff, u, v);
        // The text's own palette bits go on top of palette 0 (TILEREF(BGCHR_GAMEOVER_TEXT, 0)).
        if (c) rgb = ((e >> 12) & 15) === 4 ? fog[c]! : text[c]!;
      }
      if (!c) {
        const a = fogAt(art.fog, (x + bg2x) & 255, (y + bg2y) & 255, true);
        const b = fogAt(art.fog, (x + bg3x) & 255, (y + bg3y) & 255, false);
        if (a && b) rgb = fog[a]!.map((v, i) => Math.min(31, (v * weight + fog[b]![i]! * weight) >> 4));
        else if (a) rgb = fog[a]!;
        else if (b) rgb = fog[b]!;
      }
      const i = (y * SCREEN_W + x) * 4;
      // As bgr555ToRgb shows colours.
      image.rgba[i] = rgb[0]! << 3;
      image.rgba[i + 1] = rgb[1]! << 3;
      image.rgba[i + 2] = rgb[2]! << 3;
      image.rgba[i + 3] = 255;
    }
  }
  return image;
}
