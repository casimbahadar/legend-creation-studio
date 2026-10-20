import { describe, expect, it } from 'vitest';
import { crc32, formatCrc32 } from './crc32';

describe('crc32', () => {
  it('matches the standard check value for "123456789"', () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('formatCrc32', () => {
  it('pads to 8 uppercase hex digits', () => {
    expect(formatCrc32(0xcbf43926)).toBe('CBF43926');
    expect(formatCrc32(0x1a)).toBe('0000001A');
  });
});
