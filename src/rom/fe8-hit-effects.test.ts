import { describe, expect, it } from 'vitest';
import { FE8U_MISS_AP, FE8U_MISS_TILES, FE8U_NO_DAMAGE_AP, FE8U_NO_DAMAGE_TILES, hitEffect, readHitEffects } from './fe8-hit-effects';
import { FE8U_MISC_UI_PALETTE } from './fe8-cursor';
import { readRom } from './gba-rom';

/** Halfwords written little-endian from `at`. */
function put(bytes: Uint8Array, at: number, words: readonly number[]) {
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint16(at + i * 2, w & 0xffff, true));
}

describe('FE8 MISS and NO DAMAGE', () => {
  // Each: one tile of colour 1 (LZ77, all literal), and an AP showing one 8x8 piece for 10 frames, then removing itself.
  const bytes = new Uint8Array(FE8U_NO_DAMAGE_AP + 0x40);
  for (const [tiles, ap] of [
    [FE8U_MISS_TILES, FE8U_MISS_AP],
    [FE8U_NO_DAMAGE_TILES, FE8U_NO_DAMAGE_AP],
  ] as const) {
    bytes.set([0x10, 32, 0, 0], tiles);
    for (let i = 0; i < 32; i++) bytes[tiles + 4 + Math.floor(i / 8) * 9 + 1 + (i % 8)] = 0x11;
    put(bytes, ap, [4, 14, 2, 1, 0, 0, 0, 2, 10, 0, 0, 1]);
  }
  put(bytes, FE8U_MISC_UI_PALETTE + 2, [31]);

  it('reads both, their tiles and sprite palette 0', () => {
    const fx = readHitEffects(readRom(bytes))!;
    expect(fx.miss.length).toBe(32);
    expect(fx.noDamage[0]).toBe(0x11);
    expect(fx.palette[1]).toEqual([248, 0, 0]);
  });

  it('shows MISS for a miss and NO DAMAGE for a hit that does none', () => {
    expect(hitEffect({ hit: false, damage: 0 })).toBe('miss');
    expect(hitEffect({ hit: true, damage: 0 })).toBe('noDamage');
    expect(hitEffect({ hit: true, damage: 3 })).toBeNull();
  });

  it("isn't read from a ROM without them", () => {
    expect(readHitEffects(readRom(new Uint8Array(FE8U_NO_DAMAGE_AP + 0x40)))).toBeNull();
  });
});
