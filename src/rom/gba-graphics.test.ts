import { describe, expect, it } from 'vitest';
import { bgr555ToRgb, createImage, drawTile4bpp, readPalettes } from './gba-graphics';
import { readRom } from './gba-rom';

const pixel = (img: ReturnType<typeof createImage>, x: number, y: number) =>
  Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('palettes', () => {
  it('converts BGR555 channels', () => {
    expect(bgr555ToRgb(0x001f)).toEqual([248, 0, 0]);
    expect(bgr555ToRgb(0x03e0)).toEqual([0, 248, 0]);
    expect(bgr555ToRgb(0x7c00)).toEqual([0, 0, 248]);
  });

  it('reads 16-colour palettes from the ROM', () => {
    const bytes = new Uint8Array(64);
    bytes.set([0x1f, 0x00], 2); // palette 0 colour 1: red
    bytes.set([0x00, 0x7c], 32 + 30); // palette 1 colour 15: blue
    const [p0, p1] = readPalettes(readRom(bytes), 0, 2);
    expect(p0![1]).toEqual([248, 0, 0]);
    expect(p1![15]).toEqual([0, 0, 248]);
  });
});

describe('drawTile4bpp', () => {
  const palette = Array.from({ length: 16 }, (_, i) => [i, i, i] as const);
  // First row: pixel 0 = colour 1, pixel 1 = colour 2 (low nibble is the left pixel). Everything else colour 0.
  const tiles = new Uint8Array(32);
  tiles[0] = 0x21;

  it('draws nibbles left to right at an offset', () => {
    const img = createImage(10, 10);
    drawTile4bpp(img, tiles, 0, palette, 2, 1);
    expect(pixel(img, 2, 1)).toEqual([1, 1, 1, 255]);
    expect(pixel(img, 3, 1)).toEqual([2, 2, 2, 255]);
    expect(pixel(img, 4, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(img, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('flips', () => {
    const img = createImage(8, 8);
    drawTile4bpp(img, tiles, 0, palette, 0, 0, true, true);
    expect(pixel(img, 7, 7)).toEqual([1, 1, 1, 255]);
    expect(pixel(img, 6, 7)).toEqual([2, 2, 2, 255]);
  });

  it('can leave colour 0 transparent and clips at the edge', () => {
    const img = createImage(4, 4);
    drawTile4bpp(img, tiles, 0, palette, -1, 0, false, false, true);
    expect(pixel(img, 0, 0)).toEqual([2, 2, 2, 255]);
    expect(pixel(img, 1, 0)).toEqual([0, 0, 0, 0]);
  });
});
