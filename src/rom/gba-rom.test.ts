import { describe, expect, it } from 'vitest';
import { ROM_BASE, readRom } from './gba-rom';

describe('readRom', () => {
  const bytes = new Uint8Array(0x100);
  bytes.set([0x42, 0x45, 0x38, 0x45], 0xac); // "BE8E"
  bytes.set([0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff], 0x10);
  const rom = readRom(bytes);

  it('reads the game code', () => {
    expect(rom.gameCode).toBe('BE8E');
  });

  it('reads little-endian values, unsigned', () => {
    expect(rom.u8(0x10)).toBe(0x78);
    expect(rom.u16(0x10)).toBe(0x5678);
    expect(rom.u32(0x10)).toBe(0x12345678);
    expect(rom.u32(0x14)).toBe(0xffffffff);
  });

  it('rejects reads past the end', () => {
    expect(() => rom.u32(0xfe)).toThrow(RangeError);
    expect(() => rom.u8(-1)).toThrow(RangeError);
  });

  it('converts pointers', () => {
    expect(rom.isPointer(ROM_BASE + 0xff)).toBe(true);
    expect(rom.isPointer(ROM_BASE + 0x100)).toBe(false);
    expect(rom.offsetOf(ROM_BASE + 0x20)).toBe(0x20);
    expect(() => rom.offsetOf(0x20)).toThrow(RangeError);
  });
});
