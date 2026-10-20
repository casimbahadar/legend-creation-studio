// Checks against a real clean FE8 US ROM. Set LCS_FE8_ROM to its path to run them; skipped otherwise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { FE8_US_CRC32 } from './fe8';
import { readRom } from './gba-rom';
import { decompressLz77 } from './lz77';
import { decodeText, findTextTable } from './text';

const romPath = process.env.LCS_FE8_ROM;

describe.skipIf(!romPath)('clean FE8 US ROM (LCS_FE8_ROM)', () => {
  const bytes = romPath ? new Uint8Array(readFileSync(romPath)) : new Uint8Array();
  const rom = readRom(bytes);

  it('is the clean ROM', () => {
    expect(crc32(bytes)).toBe(FE8_US_CRC32);
    expect(rom.gameCode).toBe('BE8E');
  });

  it('decodes text, including a known name', () => {
    const table = findTextTable(rom);
    expect(table).not.toBeNull();
    const all = Array.from({ length: table!.count }, (_, id) => decodeText(rom, table!, id));
    expect(all).toContain('Eirika');
  });

  it('decompresses the first chapter map layer', () => {
    // FE8 US addresses from Endless Chronicle: chapter table 0x8B0894, map asset table 0x8B363C.
    const mainMap = rom.u8(0x8b0894 + 4);
    const layer = decompressLz77(bytes, rom.offsetOf(rom.u32(0x8b363c + mainMap * 4)));
    const w = layer[0]!;
    const h = layer[1]!;
    expect(layer.length).toBe(2 + w * h * 2);
  });
});
