import { describe, expect, it } from 'vitest';
import { readRom } from './gba-rom';
import { FE8U_PHASE_BAND, FE8U_PHASE_NAMES, FE8U_PHASE_PALETTES, PHASE_INTRO_FRAMES, phaseIntroAt, readPhaseBanner } from './fe8-phase';

/** LZ77 with literal blocks only, which the GBA's decompressor reads like any other. */
function lz77(data: Uint8Array): Uint8Array {
  const out = [0x10, data.length & 0xff, (data.length >> 8) & 0xff, data.length >> 16];
  for (let i = 0; i < data.length; i += 8) out.push(0, ...data.subarray(i, i + 8));
  return Uint8Array.from(out);
}

describe('FE8 phase intro', () => {
  it('lays out the band from a grid 32 tiles wide and the name in order', () => {
    const bytes = new Uint8Array(0x5b0000);
    const view = new DataView(bytes.buffer);
    // Band: tile 32 (the second grid row's first) colour 1. Name: tile 33 (second row, second column) colour 2.
    const band = new Uint8Array(4 * 32 * 32);
    band.fill(0x11, 32 * 32, 33 * 32);
    const name = new Uint8Array(3 * 32 * 32);
    name.fill(0x22, 33 * 32, 34 * 32);
    bytes.set(lz77(band), FE8U_PHASE_BAND);
    bytes.set(lz77(name), FE8U_PHASE_NAMES.enemy);
    view.setUint16(FE8U_PHASE_PALETTES.enemy + 2, 31, true);
    view.setUint16(FE8U_PHASE_PALETTES.enemy + 4, 31 << 10, true);
    const b = readPhaseBanner(readRom(bytes), 'enemy')!;
    const px = (img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    expect([b.band.width, b.band.height, b.name.width, b.name.height]).toEqual([240, 32, 256, 24]);
    expect(px(b.band, 0, 8)).toEqual([248, 0, 0, 255]);
    expect(px(b.band, 0, 0)[3]).toBe(0);
    expect(px(b.name, 8, 8)).toEqual([0, 0, 248, 255]);
    expect(readPhaseBanner(readRom(bytes), 'player')).toBeNull();
  });

  it('times the band and name as the game does', () => {
    expect(phaseIntroAt(0)).toEqual({ bandScale: 0, nameX: null, nameOpacity: 0 });
    // First frame: the band a sixteenth high, the name at 8 and a sixteenth visible.
    expect(phaseIntroAt(6)).toEqual({ bandScale: 1 / 16, nameX: 8, nameOpacity: 1 / 16 });
    expect(phaseIntroAt(21)).toEqual({ bandScale: 1, nameX: 28, nameOpacity: 1 });
    expect(phaseIntroAt(40)).toEqual({ bandScale: 1, nameX: 28, nameOpacity: 1 });
    expect(phaseIntroAt(52)).toEqual({ bandScale: 1, nameX: 33, nameOpacity: 15 / 16 });
    expect(phaseIntroAt(67)).toEqual({ bandScale: expect.any(Number), nameX: 56, nameOpacity: 0 });
    expect(phaseIntroAt(68)!.bandScale).toBe(1 / 16);
    expect(phaseIntroAt(68)!.nameX).toBeNull();
    expect(phaseIntroAt(PHASE_INTRO_FRAMES)).toBeNull();
  });
});
