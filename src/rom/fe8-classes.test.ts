import { describe, expect, it } from 'vitest';
import { readClasses } from './fe8-classes';
import { ROM_BASE, readRom } from './gba-rom';
import type { TextTable } from './text';

describe('readClasses', () => {
  it('keeps printable characters only and reads the map sprite id', () => {
    const CLASS_TABLE = 0x807110;
    const bytes = new Uint8Array(CLASS_TABLE + 0x66 * 0x54);
    const view = new DataView(bytes.buffer);
    const TABLE = 0x100;
    const STRINGS = 0x200;
    // Text 1: "Paladin" followed by control code 0x1F, stored uncompressed.
    bytes.set([...'Paladin'].map((c) => c.charCodeAt(0)).concat(0x1f, 0), STRINGS);
    view.setUint32(TABLE + 4, (ROM_BASE + STRINGS) | 0x80000000, true);
    const text: TextTable = { root: 0, nodes: 0, table: TABLE, count: 2 };
    // Class 7 uses text 1 and map sprite 0x2A.
    view.setUint16(CLASS_TABLE + 7 * 0x54, 1, true);
    bytes[CLASS_TABLE + 7 * 0x54 + 6] = 0x2a;
    // Mov 8 and a move cost table at 0x300 (plains cost 1, terrain 2 impassable).
    bytes[CLASS_TABLE + 7 * 0x54 + 0x12] = 8;
    view.setUint32(CLASS_TABLE + 7 * 0x54 + 0x38, ROM_BASE + 0x300, true);
    bytes.set([255, 1, 255], 0x300);
    // Sword rank E (1), lance rank D (31).
    bytes.set([1, 31], CLASS_TABLE + 7 * 0x54 + 0x2c);

    const paladin = readClasses(readRom(bytes), text).find((c) => c.id === 7);
    expect(paladin).toMatchObject({ id: 7, name: 'Paladin', mapSprite: 0x2a, mov: 8 });
    expect(Array.from(paladin!.moveCosts!.subarray(0, 3))).toEqual([255, 1, 255]);
    expect(paladin!.moveCosts!.length).toBe(0x41);
    expect(Array.from(paladin!.weaponRanks)).toEqual([1, 31, 0, 0, 0, 0, 0, 0]);
    // A class with no table pointer gets none.
    expect(readClasses(readRom(bytes), text).find((c) => c.id === 8)?.moveCosts).toBeNull();
  });
});
