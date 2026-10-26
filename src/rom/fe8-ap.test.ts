import { describe, expect, it } from 'vitest';
import { apFrameAt, drawApFrame, readApAnimation, readApFrame } from './fe8-ap';
import { readRom } from './gba-rom';
import type { Palette } from './gba-graphics';

/** Halfwords written little-endian from `at`. */
function put(bytes: Uint8Array, at: number, words: readonly number[]) {
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint16(at + i * 2, w & 0xffff, true));
}

// An AP at 0x100: frame table at +0x10, animation table at +0x40.
// Frame 0: one 8x8 piece at (-4, -8), tile 1, palette 0. Frame 1: a 16x8 piece (shape 1, size 0) at
// (2, 0), tile 2, flipped across. Frame 2: one scale/rotate entry (angle 0, scale 1), then an 8x8
// affine piece with a doubled box at (0, 0), tile 1.
// Animation 0: frame 0 for 3 frames, frame 1 for 2, then loop. Animation 1: frame 2 for 4, then remove.
const AP = 0x100;
function rom() {
  const bytes = new Uint8Array(0x1000);
  put(bytes, AP, [0x10, 0x40]);
  put(bytes, AP + 0x10, [6, 14, 22]);
  put(bytes, AP + 0x16, [1, -8 & 0xff, -4 & 0x1ff, 0x0001]);
  put(bytes, AP + 0x1e, [1, (1 << 14) | 0, 2 | 0x1000, 0x0002]);
  put(bytes, AP + 0x26, [0x8001, 0, 0x100, 0x100, 1, 0x100 | 0x200, 0, 0x0001]);
  put(bytes, AP + 0x40, [4, 16]);
  put(bytes, AP + 0x44, [3, 0, 2, 1, 0, 0xffff]);
  put(bytes, AP + 0x50, [4, 2, 0, 1]);
  return readRom(bytes);
}

describe('FE8 AP animations', () => {
  it('reads frames and their pieces', () => {
    const r = rom();
    expect(readApFrame(r, AP, 0)).toEqual([{ x: -4, y: -8, width: 8, height: 8, tile: 1, palette: 0, hflip: false, vflip: false, affine: null, doubleSize: false }]);
    expect(readApFrame(r, AP, 1)![0]).toMatchObject({ x: 2, y: 0, width: 16, height: 8, tile: 2, hflip: true });
    expect(readApFrame(r, AP, 2)![0]).toMatchObject({ affine: [256, 0, 0, 256], doubleSize: true });
  });

  it('plays the steps, looping, stopping or removing itself at the end', () => {
    const r = rom();
    const loop = readApAnimation(r, AP, 0)!;
    expect(loop).toEqual({ steps: [{ frames: 3, frame: 0 }, { frames: 2, frame: 1 }], end: 'loop' });
    expect([0, 2, 3, 4, 5, 8].map((t) => apFrameAt(loop, t))).toEqual([0, 0, 1, 1, 0, 1]);
    const once = readApAnimation(r, AP, 1)!;
    expect(once.end).toBe('remove');
    expect([0, 3, 4].map((t) => apFrameAt(once, t))).toEqual([2, 2, null]);
    expect(apFrameAt({ ...once, end: 'stop' }, 99)).toBe(2);
  });

  it('draws pieces from the 2D sheet, with the base added, flips and scale/rotate', () => {
    const r = rom();
    // Sheet from sprite tile 0: tile 1 all colour 1; tile 2 colour 2 in its left half; tile 3 colour 3.
    const sheet = new Uint8Array(4 * 32);
    sheet.fill(0x11, 32, 64);
    for (let y = 0; y < 8; y++) sheet.set([0x22, 0x22, 0, 0], 64 + y * 4);
    sheet.fill(0x33, 96, 128);
    const pal: Palette = Array.from({ length: 16 }, (_, i) => [i * 10, 0, 0] as const);
    const drawn = drawApFrame(readApFrame(r, AP, 0)!, sheet, 0, 0, () => pal);
    expect([drawn.image.width, drawn.image.height, drawn.originX, drawn.originY]).toEqual([8, 8, 4, 8]);
    expect(drawn.image.rgba[0]).toBe(10);
    // Frame 1 flipped: tile 2 then tile 3 across, so the left 8 pixels are tile 3, then tile 2's half mirrored.
    const flipped = drawApFrame(readApFrame(r, AP, 1)!, sheet, 0, 0, () => pal);
    const at = (img: typeof flipped.image, x: number, y: number) => img.rgba[(y * img.width + x) * 4];
    expect([at(flipped.image, 2, 0), at(flipped.image, 9, 0), at(flipped.image, 15, 0)]).toEqual([30, 0, 20]);
    // The base moves every piece one tile on: frame 0 then draws tile 2.
    expect(drawApFrame(readApFrame(r, AP, 0)!, sheet, 0, 1, () => pal).image.rgba[0]).toBe(20);
    // An identity matrix in a doubled box draws the 8x8 piece in the middle of a 16x16 box.
    const affine = drawApFrame(readApFrame(r, AP, 2)!, sheet, 0, 0, () => pal).image;
    expect([affine.width, at(affine, 4, 4), at(affine, 1, 1)]).toEqual([16, 10, 0]);
  });
});
