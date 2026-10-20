// Checks against a real clean FE8 US ROM. Set LCS_FE8_ROM to its path to run them; skipped otherwise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { FE8_US_CRC32 } from './fe8';
import { readRom } from './gba-rom';
import { readClasses } from './fe8-classes';
import { readMapSprite, readTeamPalettes, renderMapSprite } from './fe8-map-sprites';
import { readAllChapterMaps, renderMap } from './fe8-maps';
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

  it('reads and draws the chapter maps', () => {
    const maps = readAllChapterMaps(rom);
    expect(maps.length).toBeGreaterThan(10);
    for (const map of maps) {
      expect(map.cells.length).toBe(map.width * map.height);
      const image = renderMap(map);
      expect(image.rgba.length).toBe(map.width * 16 * map.height * 16 * 4);
    }
  });

  it('reads class names and draws class map sprites', () => {
    const classes = readClasses(rom, findTextTable(rom)!);
    expect(classes.map((c) => c.name)).toContain('Lord');
    const palettes = readTeamPalettes(rom);
    let drawn = 0;
    for (const c of classes) {
      try {
        const sprite = readMapSprite(rom, c.mapSprite);
        renderMapSprite(sprite, palettes.enemy, 2);
        drawn++;
      } catch {
        // some class slots may have no usable sprite; the page skips those too
      }
    }
    expect(drawn).toBeGreaterThan(50);
  });
});
