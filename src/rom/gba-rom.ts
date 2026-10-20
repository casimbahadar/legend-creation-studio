// Read-only view of a GBA ROM: little-endian reads, pointers and header fields.
// Ported from Endless Chronicle (index.html, Game()).

/** GBA cartridge ROM is mapped at this address; pointers in ROM data are offsets plus this. */
export const ROM_BASE = 0x08000000;

export interface GbaRom {
  readonly bytes: Uint8Array;
  readonly size: number;
  /** Four-letter game code from the header, e.g. "BE8E" for FE8 US. */
  readonly gameCode: string;
  u8(offset: number): number;
  u16(offset: number): number;
  u32(offset: number): number;
  /** True if `value` is a pointer into this ROM. */
  isPointer(value: number): boolean;
  /** Converts a ROM pointer to a file offset. */
  offsetOf(pointer: number): number;
}

export function readRom(bytes: Uint8Array): GbaRom {
  const size = bytes.length;
  const check = (offset: number, width: number) => {
    if (!Number.isInteger(offset) || offset < 0 || offset + width > size) {
      throw new RangeError(`ROM read out of range: 0x${offset.toString(16)}`);
    }
  };
  const u8 = (o: number) => {
    check(o, 1);
    return bytes[o]!;
  };
  const u16 = (o: number) => {
    check(o, 2);
    return bytes[o]! | (bytes[o + 1]! << 8);
  };
  const u32 = (o: number) => {
    check(o, 4);
    return (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) >>> 0;
  };
  const isPointer = (v: number) => v >= ROM_BASE && v < ROM_BASE + size;
  const offsetOf = (p: number) => {
    if (!isPointer(p)) throw new RangeError(`Not a ROM pointer: 0x${p.toString(16)}`);
    return p - ROM_BASE;
  };
  const gameCode = size >= 0xb0 ? String.fromCharCode(bytes[0xac]!, bytes[0xad]!, bytes[0xae]!, bytes[0xaf]!) : '';
  return { bytes, size, gameCode, u8, u16, u32, isPointer, offsetOf };
}
