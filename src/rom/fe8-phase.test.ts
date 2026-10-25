import { describe, expect, it } from 'vitest';
import { readRom } from './gba-rom';
import { FE8U_PHASE_BAND, FE8U_PHASE_NAMES, FE8U_PHASE_PALETTES, FE8U_PHASE_SQUARES, PHASE_INTRO_FRAMES, phaseIntroAt, phaseSquaresAt, readPhaseBanner } from './fe8-phase';

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
    // Squares: tile 0x23 (size 1's bottom right) colour 1.
    const squares = new Uint8Array(2 * 32 * 32);
    squares.fill(0x11, 0x23 * 32, 0x24 * 32);
    bytes.set(lz77(squares), FE8U_PHASE_SQUARES);
    view.setUint16(FE8U_PHASE_PALETTES.enemy + 2, 31, true);
    view.setUint16(FE8U_PHASE_PALETTES.enemy + 4, 31 << 10, true);
    const b = readPhaseBanner(readRom(bytes), 'enemy')!;
    const px = (img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    expect([b.band.width, b.band.height, b.name.width, b.name.height]).toEqual([240, 32, 256, 24]);
    expect(px(b.band, 0, 8)).toEqual([248, 0, 0, 255]);
    expect(px(b.band, 0, 0)[3]).toBe(0);
    expect(px(b.name, 8, 8)).toEqual([0, 0, 248, 255]);
    expect(b.squares.length).toBe(9);
    expect(px(b.squares[1]!, 8, 8)).toEqual([248, 0, 0, 255]);
    expect(px(b.squares[1]!, 0, 0)[3]).toBe(0);
    expect(px(b.squares[0]!, 8, 8)[3]).toBe(0);
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

  it('sweeps the squares and closes the window as the game does', () => {
    const first = phaseSquaresAt(0)!;
    // Timer 4: the bottom left cell is size 4 (val (0 - 4) + 12 = 8, so 16 - 8), the top right empty.
    expect(first.cells[9 * 15]).toBe(4);
    expect(first.cells[14]).toBe(0);
    expect(first.mirrored).toBe(false);
    expect(first.opacity).toBe(0);
    // Blend timer 4: yoff 16 + 44 - 44 * 28^3 / 32^3.
    expect(first.windowTop).toBe(8 + 60 - Math.trunc((44 * 28 ** 3) / 32 ** 3));
    const closed = phaseSquaresAt(27)!;
    expect(closed.opacity).toBe(6 / 16);
    // The last frame in (timer 33): full squares but the top right one, a size short.
    const last = phaseSquaresAt(29)!.cells;
    expect([last[9 * 15], last[14]]).toEqual([8, 7]);
    const out = phaseSquaresAt(28)!;
    expect(out.mirrored).toBe(false);
    expect([out.opacity, out.windowTop, out.windowBottom]).toEqual([7 / 16, 68, 100]);
    expect(phaseSquaresAt(30)!.mirrored).toBe(true);
    expect(phaseSquaresAt(60)!.opacity).toBe(0);
    expect(phaseSquaresAt(61)).toBeNull();
  });
});
