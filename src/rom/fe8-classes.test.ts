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

    const paladin = readClasses(readRom(bytes), text).find((c) => c.id === 7);
    expect(paladin).toEqual({ id: 7, name: 'Paladin', mapSprite: 0x2a });
  });
});
