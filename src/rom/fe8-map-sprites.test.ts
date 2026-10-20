import { describe, expect, it } from 'vitest';
import { idleFrame, renderMapSprite, spriteOrigin } from './fe8-map-sprites';

describe('renderMapSprite', () => {
  const palette = Array.from({ length: 16 }, (_, i) => [i * 10, 0, 0] as const);

  it('draws the chosen frame with colour 0 transparent', () => {
    // 16x16 sprite: 4 tiles per frame. Frame 1's first tile is solid colour 3.
    const tiles = new Uint8Array(3 * 4 * 32);
    tiles.fill(0x33, 4 * 32, 5 * 32);
    const sprite = { width: 16, height: 16, tiles };
    const f1 = renderMapSprite(sprite, palette, 1);
    expect(Array.from(f1.rgba.subarray(0, 4))).toEqual([30, 0, 0, 255]);
    const f0 = renderMapSprite(sprite, palette, 0);
    expect(f0.rgba.every((v) => v === 0)).toBe(true);
  });

  it('lays out tiles row by row for tall sprites', () => {
    // 16x32: 2 tiles wide, 4 high. Tile 2 of frame 0 is the start of the second tile row.
    const tiles = new Uint8Array(3 * 8 * 32);
    tiles.fill(0x11, 2 * 32, 3 * 32);
    const img = renderMapSprite({ width: 16, height: 32, tiles }, palette, 0);
    const at = (x: number, y: number) => img.rgba[(y * 16 + x) * 4 + 3];
    expect(at(0, 8)).toBe(255);
    expect(at(0, 7)).toBe(0);
    expect(at(8, 8)).toBe(0);
  });
});

describe('timing and placement', () => {
  it('cycles idle frames like EC', () => {
    expect([0, 532, 533, 599, 600, 1132, 1133, 1199, 1200].map(idleFrame)).toEqual([0, 0, 1, 1, 2, 2, 1, 1, 0]);
  });

  it('stands sprites bottom-centred on their cell', () => {
    expect(spriteOrigin({ width: 16, height: 16 }, 2, 3)).toEqual([32, 48]);
    expect(spriteOrigin({ width: 16, height: 32 }, 2, 3)).toEqual([32, 32]);
    expect(spriteOrigin({ width: 32, height: 32 }, 2, 3)).toEqual([24, 32]);
  });
});
