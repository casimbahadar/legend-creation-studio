// FE8 US's text font, for drawing text as the game does (decision 35). From the fireemblem8u
// decompilation (include/fontgrp.h, data/fonts/glyphs_*.h, src/fontgrp.c): an English font is a table
// of 256 glyph pointers, one per byte value (NULL for none); a glyph is a 0x48-byte record holding its
// width at +0x05 and a 16 x 16 bitmap at +0x08, a 32-bit row per line, 2 bits per pixel from the
// lowest bits up. Pixel values 1 to 3 take colours 1 to 3 of a colour set in the text palette.

import { bgr555ToRgb, createImage, type Image, type Palette } from './gba-graphics';
import type { GbaRom } from './gba-rom';

/** The system font (menus and windows) and the talk font (dialogue). Each table ends where the next glyphs begin. */
export const FE8U_SYSTEM_GLYPHS = 0x58c7ec;
export const FE8U_TALK_GLYPHS = 0x58f6f4;
/** Pal_Text: the text palette, 16 colours. */
export const FE8U_TEXT_PALETTE = 0x59ef00;

const GLYPH_WIDTH = 0x05;
const GLYPH_BITMAP = 0x08;
export const GLYPH_SIZE = 16;

export interface Glyph {
  readonly width: number;
  /** 16 x 16 pixel values 0 to 3, row by row. */
  readonly pixels: Uint8Array;
}

/** Glyphs by byte value. */
export type Font = ReadonlyMap<number, Glyph>;

/**
 * The game's text colours (TEXT_COLOR_SYSTEM_* in include/fontgrp.h): the palette colour each pixel value
 * 1 to 3 takes, 0 for none. Each is named for its digits there: white is TEXT_COLOR_0123, black is
 * TEXT_COLOR_0030 (only value 2 drawn, in colour 3).
 */
export const TEXT_COLOURS = {
  white: [1, 2, 3],
  gray: [4, 5, 6],
  blue: [7, 8, 9],
  gold: [10, 11, 12],
  green: [13, 14, 15],
  black: [0, 3, 0],
} as const;
export type TextColour = keyof typeof TEXT_COLOURS;

/** The font whose glyph table is at `table`, or null if it doesn't look like one. */
export function readFont(rom: GbaRom, table: number): Font | null {
  if (table + 256 * 4 > rom.size) return null;
  const font = new Map<number, Glyph>();
  for (let c = 0; c < 256; c++) {
    const p = rom.u32(table + c * 4);
    if (p === 0) continue;
    if (!rom.isPointer(p)) return null;
    const a = rom.offsetOf(p);
    if (a + GLYPH_BITMAP + 64 > rom.size) return null;
    const width = rom.u8(a + GLYPH_WIDTH);
    if (width > GLYPH_SIZE) return null;
    const pixels = new Uint8Array(GLYPH_SIZE * GLYPH_SIZE);
    for (let y = 0; y < GLYPH_SIZE; y++) {
      const row = rom.u32(a + GLYPH_BITMAP + y * 4);
      for (let x = 0; x < GLYPH_SIZE; x++) pixels[y * GLYPH_SIZE + x] = (row >>> (2 * x)) & 3;
    }
    font.set(c, { width, pixels });
  }
  // A real font has the letters.
  return font.has(0x41) && font.has(0x61) ? font : null;
}

export function readTextPalette(rom: GbaRom): Palette {
  return Array.from({ length: 16 }, (_, c) => bgr555ToRgb(rom.u16(FE8U_TEXT_PALETTE + c * 2)));
}

/** How wide `text` is in pixels; characters the font lacks count as "?", as the game draws them. */
export function textWidth(font: Font, text: string): number {
  let w = 0;
  for (const ch of text) w += (font.get(ch.charCodeAt(0)) ?? font.get(0x3f))?.width ?? 0;
  return w;
}

/** `text` drawn in `colour` on a transparent 16-pixel-high strip, glyph by glyph as the game draws it. */
export function drawText(font: Font, palette: Palette, text: string, colour: TextColour = 'white'): Image {
  const image = createImage(Math.max(1, textWidth(font, text)), GLYPH_SIZE);
  const lut = TEXT_COLOURS[colour];
  let x0 = 0;
  for (const ch of text) {
    const glyph = font.get(ch.charCodeAt(0)) ?? font.get(0x3f);
    if (!glyph) continue;
    for (let y = 0; y < GLYPH_SIZE; y++) {
      for (let x = 0; x < GLYPH_SIZE; x++) {
        const v = glyph.pixels[y * GLYPH_SIZE + x]!;
        const dx = x0 + x;
        const c = v === 0 ? 0 : lut[v - 1]!;
        if (c === 0 || dx >= image.width) continue;
        const [r, g, b] = palette[c] ?? [255, 255, 255];
        const i = (y * image.width + dx) * 4;
        image.rgba[i] = r;
        image.rgba[i + 1] = g;
        image.rgba[i + 2] = b;
        image.rgba[i + 3] = 255;
      }
    }
    x0 += glyph.width;
  }
  return image;
}
