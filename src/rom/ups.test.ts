import { describe, expect, it } from 'vitest';
import { randomNumbers } from '../core/combat';
import { applyUps, createUps, encodeNumber } from './ups';

const enc = (n: number) => {
  const out: number[] = [];
  encodeNumber(n, out);
  return out;
};

describe('UPS', () => {
  it('encodes numbers the way UPS does', () => {
    expect(enc(0)).toEqual([0x80]);
    expect(enc(127)).toEqual([0xff]);
    expect(enc(128)).toEqual([0x00, 0x80]);
    // 16 MB, the size of an FE8 ROM.
    expect(enc(16 * 1024 * 1024)).toEqual([0x00, 0x7f, 0x7e, 0x86]);
  });

  it('writes a small patch byte for byte', () => {
    const source = Uint8Array.from([1, 2, 3, 4, 5]);
    const target = Uint8Array.from([1, 9, 3, 4, 7, 6]);
    const p = createUps(source, target);
    // "UPS1", sizes 5 and 6, skip 1 then 2^9 and end, skip 1 (byte 3 is the end marker's) then 5^7 and
    // 0^6 then end, then three CRC32s.
    expect(Array.from(p.subarray(0, 4 + 2 + 3 + 4))).toEqual([0x55, 0x50, 0x53, 0x31, 0x85, 0x86, 0x81, 2 ^ 9, 0, 0x81, 5 ^ 7, 6, 0]);
    expect(p.length).toBe(13 + 12);
    expect(Array.from(applyUps(p, source))).toEqual(Array.from(target));
  });

  it('round-trips scattered changes, growth and shrinking', () => {
    const rn = randomNumbers(7);
    const source = Uint8Array.from({ length: 5000 }, () => rn());
    for (const size of [5000, 6000, 4000]) {
      const target = Uint8Array.from({ length: size }, (_, i) => (i < source.length ? source[i]! : 0));
      for (let k = 0; k < 60; k++) target[(rn() * 61) % size] = rn();
      target[size - 1] = 0xaa;
      expect(applyUps(createUps(source, target), source)).toEqual(target);
    }
  });

  it('rejects the wrong ROM, damage and non-patches in plain words', () => {
    const source = Uint8Array.from([1, 2, 3]);
    const p = createUps(source, Uint8Array.from([1, 2, 4]));
    expect(() => applyUps(p, Uint8Array.from([1, 2, 9]))).toThrow('different ROM');
    const damaged = p.slice();
    damaged[6] = damaged[6]! ^ 1;
    expect(() => applyUps(damaged, source)).toThrow('damaged');
    expect(() => applyUps(Uint8Array.from('not a patch at all!!'.split('').map((c) => c.charCodeAt(0))), source)).toThrow("isn't a UPS patch");
  });
});
