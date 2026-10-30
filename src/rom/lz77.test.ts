import { describe, expect, it } from 'vitest';
import { decompress, decompressLz77 } from './lz77';

describe('decompressLz77', () => {
  it('expands literals and a back-reference', () => {
    // 8 bytes out; flags 0x20 = third block is a back-reference (length 6, distance 2).
    const data = Uint8Array.from([0x10, 0x08, 0x00, 0x00, 0x20, 0x41, 0x42, 0x30, 0x01]);
    expect(new TextDecoder().decode(decompressLz77(data, 0))).toBe('ABABABAB');
  });

  it('reads from an offset', () => {
    const data = Uint8Array.from([0xff, 0xff, 0x10, 0x02, 0x00, 0x00, 0x00, 0x58, 0x59]);
    expect(Array.from(decompressLz77(data, 2))).toEqual([0x58, 0x59]);
  });

  it('rejects data without the LZ77 header', () => {
    expect(() => decompressLz77(Uint8Array.from([0x11, 0, 0, 0]), 0)).toThrow('No LZ77 data');
  });

  it('rejects a back-reference before the start', () => {
    expect(() => decompressLz77(Uint8Array.from([0x10, 0x04, 0, 0, 0x80, 0x00, 0x00]), 0)).toThrow('back-reference');
  });

  it('rejects truncated data', () => {
    expect(() => decompressLz77(Uint8Array.from([0x10, 0x04, 0, 0, 0x00, 0x41]), 0)).toThrow('past the end');
  });
});

describe('decompress', () => {
  it('takes raw data, its size counting its 4-byte header, as UnpackRaw does', () => {
    expect(Array.from(decompress(Uint8Array.from([9, 0x00, 6, 0, 0, 7, 8, 99]), 1))).toEqual([7, 8]);
  });

  it('takes LZ77 data too, and refuses another kind', () => {
    expect(Array.from(decompress(Uint8Array.from([0x10, 2, 0, 0, 0, 5, 6]), 0))).toEqual([5, 6]);
    expect(() => decompress(Uint8Array.from([0x20, 2, 0, 0, 0]), 0)).toThrow();
  });
});

