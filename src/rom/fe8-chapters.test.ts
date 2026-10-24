import { describe, expect, it } from 'vitest';
import { ROM_BASE, readRom } from './gba-rom';
import { ASSET_TABLE, CHAPTER_STRIDE, CHAPTER_TABLE, readChapter, readPlayerUnits, readUnitDefinition } from './fe8-chapters';
import { findCharacterTable, readCharacters } from './fe8-characters';
import type { TextTable } from './text';

describe('FE8 chapters', () => {
  // A ROM just big enough for the chapter and asset tables, with chapter 0 set up.
  const bytes = new Uint8Array(ASSET_TABLE + 0x400);
  const view = new DataView(bytes.buffer);
  const TEXT = 0x100;
  bytes.set([...'Prologue'].map((c) => c.charCodeAt(0)).concat(0), 0x200);
  view.setUint32(TEXT + 4 * 7, (ROM_BASE + 0x200) | 0x80000000, true);
  const text: TextTable = { root: 0, nodes: 0, table: TEXT, count: 10 };
  const ch0 = CHAPTER_TABLE;
  bytes.set([1, 2, 3, 4, 5, 6, 7, 8], ch0 + 4);
  view.setUint16(ch0 + 0x70, 7, true);
  bytes[ch0 + 0x74] = 0x20;
  const GROUP = 0x300;
  view.setUint32(ASSET_TABLE + 0x20 * 4, ROM_BASE + GROUP, true);
  const UNITS = 0x400;
  view.setUint32(GROUP + 0x28, ROM_BASE + UNITS, true);
  // Eirika (1), Lord (2), player, level 1, at (13, 8), Rapier (9) and Vulnerary (0x6C). Then the end.
  bytes.set([1, 2, 0, (1 << 3) | (0 << 1) | 0], UNITS);
  view.setUint16(UNITS + 4, 13 | (8 << 6), true);
  bytes.set([9, 0x6c, 0, 0], UNITS + 12);
  // An autolevelled enemy, level 4, at (63, 63).
  bytes.set([0x80, 0x41, 0, (4 << 3) | (2 << 1) | 1], UNITS + 20);
  view.setUint16(UNITS + 24, 63 | (63 << 6), true);
  const rom = readRom(bytes);

  it('reads the title, map ids and event group', () => {
    expect(readChapter(rom, text, 0)).toEqual({ index: 0, title: 'Prologue', mapIds: [1, 2, 3, 4, 5, 6, 7, 8], eventDataId: 0x20, eventGroup: GROUP });
    expect(CHAPTER_TABLE + 79 * CHAPTER_STRIDE).toBe(ASSET_TABLE);
  });

  it('unpacks unit placements', () => {
    expect(readUnitDefinition(rom, UNITS)).toEqual({ character: 1, classId: 2, leader: 0, autolevel: false, allegiance: 'player', level: 1, x: 13, y: 8, items: [9, 0x6c], ai: [0, 0, 0, 0] });
    expect(readUnitDefinition(rom, UNITS + 20)).toMatchObject({ autolevel: true, allegiance: 'enemy', level: 4, x: 63, y: 63 });
  });

  it("reads a chapter's player units up to the end marker", () => {
    expect(readPlayerUnits(rom, readChapter(rom, text, 0)).map((u) => u.character)).toEqual([1, 0x80]);
  });
});

describe('FE8 characters', () => {
  it('finds the table by numbering and reads names', () => {
    const bytes = new Uint8Array(0x4000);
    const view = new DataView(bytes.buffer);
    const T = 0x200;
    for (let k = 0; k < 0x50; k++) bytes[T + k * 0x34 + 4] = k + 1;
    bytes.set([...'Eirika'].map((c) => c.charCodeAt(0)).concat(0), 0x100);
    view.setUint32(0x40 + 4, (ROM_BASE + 0x100) | 0x80000000, true);
    view.setUint16(T, 1, true);
    bytes[T + 5] = 2;
    bytes[T + 0x0b] = 1;
    // Personal bases HP to Con, one of them negative as FE8 stores it; then growths HP to Luck.
    bytes.set([2, 0, 0xff, 0xfd, 3, 0, 5, 1], T + 0x0c);
    bytes.set([70, 40, 60, 60, 30, 30, 60], T + 0x1c);
    const rom = readRom(bytes);
    expect(findCharacterTable(rom)).toBe(T);
    expect(readCharacters(rom, { root: 0, nodes: 0, table: 0x40, count: 4 }, T)[0]).toEqual({
      id: 1,
      name: 'Eirika',
      defaultClass: 2,
      portrait: 0,
      baseLevel: 1,
      base: { hp: 2, str: 0, skl: -1, spd: -3, def: 3, res: 0, lck: 5, con: 1 },
      growths: { hp: 70, str: 40, skl: 60, spd: 60, def: 30, res: 30, lck: 60, con: 0 },
    });
  });
});
