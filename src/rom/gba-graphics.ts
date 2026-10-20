// GBA drawing helpers: BGR555 palettes and 4bpp 8x8 tiles, drawn into plain RGBA arrays (no DOM).
// Ported from Endless Chronicle (index.html, Game().pals and mapCanvas).

import type { GbaRom } from './gba-rom';

export type Rgb = readonly [number, number, number];
/** 16 colours. */
export type Palette = readonly Rgb[];

/** RGBA pixels, 4 bytes per pixel, row by row. Matches ImageData so the editor can draw it directly. */
export interface Image {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Converts one BGR555 colour to 8-bit RGB the same way EC does (shift left by 3). */
export function bgr555ToRgb(v: number): Rgb {
  return [(v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3];
}

/** Reads `count` 16-colour palettes starting at `offset`. */
export function readPalettes(rom: GbaRom, offset: number, count: number): Palette[] {
  const out: Palette[] = [];
  for (let p = 0; p < count; p++) {
    const colours: Rgb[] = [];
    for (let c = 0; c < 16; c++) colours.push(bgr555ToRgb(rom.u16(offset + (p * 16 + c) * 2)));
    out.push(colours);
  }
  return out;
}

export function createImage(width: number, height: number): Image {
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
}

/**
 * Draws one 4bpp 8x8 tile (32 bytes, low nibble = left pixel) at pixel (x, y), optionally flipped.
 * Missing tile data draws as colour 0. Colour 0 is drawn opaque unless `transparentZero` is set.
 */
export function drawTile4bpp(
  image: Image,
  tiles: Uint8Array,
  tileIndex: number,
  palette: Palette,
  x: number,
  y: number,
  hflip = false,
  vflip = false,
  transparentZero = false,
): void {
  const { width, height, rgba } = image;
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 8; px++) {
      const sx = hflip ? 7 - px : px;
      const sy = vflip ? 7 - py : py;
      const byte = tiles[tileIndex * 32 + sy * 4 + (sx >> 1)] ?? 0;
      const ci = sx & 1 ? byte >> 4 : byte & 15;
      if (transparentZero && ci === 0) continue;
      const dx = x + px;
      const dy = y + py;
      if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
      const colour = palette[ci] ?? palette[0] ?? [0, 0, 0];
      const o = (dy * width + dx) * 4;
      rgba[o] = colour[0];
      rgba[o + 1] = colour[1];
      rgba[o + 2] = colour[2];
      rgba[o + 3] = 255;
    }
  }
}
